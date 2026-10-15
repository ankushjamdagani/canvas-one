import { TaskRepository, type CollaborationTask, type TaskCommand, type TaskScope, type Proposal } from '@canvas-one/agents';
import { CollaborationBrowserClient, isBridgeRequest, type ExecutionIdentity, type LocalAgentProvider, type ProviderAvailability, type CollaborationEvent, type BrowserAuthorityRequest } from '@canvas-one/agent-bridge';
import type { RecordChange } from '@canvas-one/system-design';
import type { SessionController } from '../session/controller';
import type { StudioRepository } from '../../persistence/studio/types';
import { emptyConversationLedger, parseConversationLedger, serializeConversationLedger, type AgentConversationStorage, type ConversationLedger, type ConversationJson } from '../../persistence/studio/agent-conversations';
import { SystemAgentSession, type AgentSelection } from './controller';
import { attemptBinding, readAuthorizedTask } from './task-authority';
import { planAgentTaskUndo } from '../../persistence/studio/agent-action-journal';

export type ConversationMessage = { readonly id: string; readonly taskId?: string; readonly attemptId?: string; readonly clarificationQuestionId?: string; readonly startingContext?: AgentSelection & { readonly omittedCount: number }; readonly role: 'user' | 'agent' | 'system'; readonly text: string; readonly delivery: 'queued' | 'delivered' | 'acknowledged' | 'failed' };
export type ConversationProposal = { readonly taskId: string; readonly proposal: Proposal<RecordChange> };
export type ConversationState = { readonly connection: 'disconnected' | 'pairing' | 'connected'; readonly tasks: readonly CollaborationTask[]; readonly messages: readonly ConversationMessage[]; readonly outstandingQuestions?: readonly ConversationMessage[]; readonly proposals: readonly ConversationProposal[]; readonly providers: readonly ProviderAvailability[]; readonly error: string | null; readonly hasEarlierMessages?: boolean; readonly historyWindowGap?: boolean; readonly blockedActions: readonly { readonly taskId: string; readonly operationId: string }[]; readonly activity?: { readonly taskId: string; readonly attemptId: string; readonly kind: 'reading' | 'applying' | 'reviewing'; readonly targetIds: readonly string[] } };
export type ConversationControllerOptions = { readonly session: SessionController; readonly repository: StudioRepository; readonly selection?: () => AgentSelection; readonly mintId: () => string; readonly client?: CollaborationBrowserClient; readonly now?: () => number; readonly leaseMs: number; readonly pollMs: number; readonly heartbeatMs: number; readonly ownership?: { load(): readonly string[]; save(ids: readonly string[]): void }; readonly recoverOwnedAfterReload?: boolean };
const json = (value: unknown): ConversationJson => JSON.parse(JSON.stringify(value)) as ConversationJson;
const canonical = (value: unknown): string => JSON.stringify((function sort(input: unknown): unknown { if (Array.isArray(input)) return input.map(sort); if (input && typeof input === 'object') return Object.fromEntries(Object.keys(input).sort().map(key => [key, sort((input as Record<string, unknown>)[key])])); return input; })(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sameScope = (a: TaskScope, b: TaskScope) => a.projectId === b.projectId && a.branchId === b.branchId && a.boardId === b.boardId;
const execution = (task: CollaborationTask): ExecutionIdentity => { const attempt = task.attempts.at(-1)!; return { taskId: task.id, attemptId: attempt.id, actorId: task.actorId, generation: task.generation, ...task.scope }; };
const targets = (changes: unknown): readonly string[] => Array.isArray(changes) ? [...new Set(changes.slice(0, 1000).flatMap(change => { if (!object(change)) return []; const id = change.kind === 'remove' ? change.id : object(change.value) && object(change.value.record) ? change.value.record.id : undefined; return typeof id === 'string' && id.length > 0 && id.length <= 200 ? [id] : []; }))] : [];

/** Workspace-owned lifetime. Closing the panel neither stops work nor revokes permission. */
export class AgentConversationController {
  readonly ready: Promise<void>;
  private reviewed: SystemAgentSession;
  private readonly now: () => number;
  private state: ConversationState = { connection: 'disconnected', tasks: [], messages: [], proposals: [], providers: [], error: null, blockedActions: [] };
  private readonly listeners = new Set<() => void>();
  private scope: TaskScope | null = null;
  private tasks: TaskRepository | null = null;
  private artifacts: ConversationLedger | null = null;
  private artifactStorage: AgentConversationStorage | null = null;
  private artifactRevision: number | null = null;
  private artifactTail: Promise<unknown> = Promise.resolve();
  private artifactUnknown = false;
  private client: CollaborationBrowserClient | null;
  private token: string | null = null;
  private serviceSessionId: string | null = null;
  private lifetime = new AbortController();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private initialized = false;
  private changingScope = false;
  private loadGeneration = 0;
  private loopGeneration = 0;
  private readonly owned = new Set<string>();
  private polling = false;
  private readonly started = new Map<string, ExecutionIdentity>();
  private readonly pendingStops = new Map<string, { binding: ExecutionIdentity; repository: TaskRepository | null; client: CollaborationBrowserClient; token: string; serviceSessionId: string | null }>();
  private readonly tokenInstances = new Map<string, string>();
  private readonly attemptInstances = new Map<string, string>();
  private readonly stopping = new Map<string, Promise<boolean>>();
  private readonly proposalOwners = new Map<string, string>();
  private readonly startingContexts = new Map<string, NonNullable<ConversationMessage['startingContext']>>();
  private historyBefore: number | undefined;
  private historyHasMore: boolean | undefined;
  private historyOlderWindow = false;
  private historyWindowGap = false;
  private historyGeneration = 0;
  private readonly restoredQuestions = new Map<string, ConversationMessage>();
  private earlierMessages: ConversationMessage[] = [];
  async loadEarlierMessages(): Promise<readonly ConversationMessage[]> {
    const storage = this.artifactStorage, generation = this.historyGeneration; if (!storage?.loadMessagesPage || this.historyHasMore === false) return [];
    const anchor = this.earlierMessages[0]?.id ?? this.artifacts?.messages[0]?.id;
    if (this.historyBefore === undefined && storage.loadMessageOrdinal && anchor) {
      const ordinal = await storage.loadMessageOrdinal(anchor);
      if (storage !== this.artifactStorage || generation !== this.historyGeneration) return [];
      this.historyBefore = ordinal ?? undefined;
    }
    const page = await storage.loadMessagesPage(this.historyBefore, 100); if (storage !== this.artifactStorage || generation !== this.historyGeneration) return [];
    this.historyOlderWindow = true;
    this.historyBefore = page.before; this.historyHasMore = page.hasMore;
    const known = new Set([...this.state.messages, ...this.earlierMessages].map(message => message.id));
    this.earlierMessages = [...page.messages.map(entry => entry.payload as unknown as ConversationMessage).filter(message => !known.has(message.id)), ...this.earlierMessages];
    this.publish(); return page.messages.map(entry => entry.payload as unknown as ConversationMessage);
  }
  returnToRecentMessages(): void {
    this.historyGeneration++;
    this.earlierMessages = []; this.historyBefore = undefined; this.historyHasMore = undefined; this.historyOlderWindow = false; this.historyWindowGap = false;
    this.update({ messages: [] }); this.publish();
  }
  async openTaskHistory(taskId: string): Promise<readonly ConversationProposal[]> {
    const storage = this.artifactStorage; const entries = await storage?.loadTaskProposals?.(taskId) ?? [];
    if (storage !== this.artifactStorage) return [];
    return entries.map(entry => ({ taskId, proposal: entry.payload as unknown as Proposal<RecordChange> }));
  }
  private readonly unsubscribe: () => void;
  constructor(private readonly options: ConversationControllerOptions) {
    for (const limit of [options.leaseMs, options.pollMs, options.heartbeatMs]) if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Explicit conversation timing limits required');
    this.now = options.now ?? (() => performance.now()); this.client = options.client ?? null;
    for (const id of options.ownership?.load() ?? []) this.owned.add(id);
    this.reviewed = new SystemAgentSession(options.session, options.selection);
    this.ready = this.load().catch(error => { this.problem(error); });
    this.unsubscribe = options.session.subscribe(() => { if (!this.scopeMatches()) { if (this.scope) this.options.repository.agentExecutionLeases?.revokeScope(this.scope); void this.reconcileScope(); } });
  }
  getState = (): ConversationState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<ConversationState>): void { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot break authority. */ } } }
  private problem(error: unknown): void { this.update({ error: error instanceof Error ? error.message : 'Conversation operation failed' }); }
  private currentScope(): TaskScope | null { const state = this.options.session.getState(); return state.document && state.projectId && state.branchId ? { projectId: state.projectId, branchId: state.branchId, boardId: state.document.id } : null; }
  private scopeMatches(): boolean { const current = this.currentScope(); return this.scope === null ? current === null : current !== null && sameScope(this.scope, current); }
  private assertCurrentBoard(): void { if (!this.initialized || this.changingScope || !this.scopeMatches() || this.options.session.getState().needsReload) throw new Error('Open and reload the current board before continuing'); }
  private async reconcileScope(): Promise<void> {
    if (this.changingScope || this.disposed) return;
    this.changingScope = true;
    try {
      do {
        const activeOwned = this.tasks?.getSnapshot().tasks.some(task => this.owned.has(task.id) && ['requested', 'working', 'waiting'].includes(task.status) && task.attempts.at(-1)?.status !== 'finished');
        if (activeOwned || this.started.size) await this.depart(); else if (this.scope) this.options.repository.agentExecutionLeases?.revokeScope(this.scope);
        await this.artifactTail; if (this.disposed) return; this.reviewed.dispose(); this.reviewed = new SystemAgentSession(this.options.session, this.options.selection); await this.load();
      } while (!this.disposed && !this.scopeMatches());
    } catch (error) { this.problem(error); }
    finally { this.changingScope = false; if (!this.disposed && !this.scopeMatches()) void this.reconcileScope(); }
  }
  private async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.initialized = false;
    this.tasks = null; this.artifacts = null; this.artifactStorage = null; this.artifactRevision = null;
    this.historyGeneration++; this.restoredQuestions.clear(); this.startingContexts.clear(); this.earlierMessages = []; this.historyBefore = undefined; this.historyHasMore = undefined; this.historyOlderWindow = false; this.historyWindowGap = false;
    this.update({ tasks: [], messages: [], proposals: [], blockedActions: [], outstandingQuestions: [], hasEarlierMessages: false, historyWindowGap: false, activity: undefined });
    const scope = this.currentScope(); this.scope = scope;
    if (!scope) { this.update({ tasks: [], messages: [], proposals: [] }); return; }
    if (!this.options.repository.createAgentTaskStorage || !this.options.repository.createAgentConversationStorage) throw new Error('Durable agent storage is unavailable');
    const opened = await TaskRepository.open(this.options.repository.createAgentTaskStorage(scope)); if (generation !== this.loadGeneration || this.disposed) return; if (!opened.ok) throw new Error(opened.code);
    this.tasks = opened.repository;
    if (this.options.recoverOwnedAfterReload) await this.recoverOwned(this.tasks, scope);
    if (generation !== this.loadGeneration || this.disposed) return;
    this.artifactStorage = this.options.repository.createAgentConversationStorage(scope);
    const raw = await this.artifactStorage.load();
    if (generation !== this.loadGeneration || this.disposed) return;
    const artifacts = raw === null ? emptyConversationLedger(scope) : parseConversationLedger(raw);
    if (!artifacts || !sameScope(artifacts.scope, scope)) throw new Error('Conversation storage is invalid');
    this.artifacts = artifacts; this.artifactRevision = raw === null ? null : artifacts.revision; this.artifactUnknown = false;
    const openOperations = await this.artifactStorage.loadOpenOperations?.() ?? [];
    if (generation !== this.loadGeneration || this.disposed) return;
    this.update({ blockedActions: [...new Map([...openOperations, ...artifacts.operations].map(entry => [entry.operationId, entry])).values()].filter(entry => object(entry.payload) && object(entry.payload.result) && entry.payload.result.code === 'conflict' && entry.payload.decision !== 'skip-and-replan').map(entry => ({ taskId: entry.taskId, operationId: entry.operationId })) });
    for (const task of this.tasks.getSnapshot().tasks) {
      if (task.status !== 'waiting' || task.waitReason !== 'clarification') continue;
      const question = await this.artifactStorage.loadClarificationQuestion?.(task.id, task.attempts.at(-1)!.id);
      if (generation !== this.loadGeneration || this.disposed) return;
      if (question) this.restoredQuestions.set(question.id, question.payload as unknown as ConversationMessage);
    }
    this.proposalOwners.clear();
    const open = await this.artifactStorage.loadOpenProposals?.() ?? [];
    if (generation !== this.loadGeneration || this.disposed) return;
    const merged = [...new Map([...open, ...artifacts.proposals].map(entry => [entry.id, entry])).values()];
    const unresolved = merged.filter(entry => !object(entry.payload) || !['accepted', 'rejected'].includes(String(entry.payload.status)));
    if (unresolved.length > 200) throw new Error('Resolve pending proposal reviews before restoring more than 200 decisions');
    const terminal = merged.filter(entry => object(entry.payload) && ['accepted', 'rejected'].includes(String(entry.payload.status)));
    const remaining = 200 - unresolved.length;
    const saved = [...unresolved, ...(remaining > 0 ? terminal.slice(-remaining) : [])].map(entry => { if (entry.taskId) this.proposalOwners.set(entry.id, entry.taskId); return entry.payload as unknown as Proposal<RecordChange>; });
    const restored = this.reviewed.proposals.restore(saved); if (!restored.ok) throw new Error('Stored proposals require recovery');
    if (this.serviceSessionId && artifacts.eventsSessionId !== this.serviceSessionId) await this.persist(ledger => ({ ...ledger, eventsSessionId: this.serviceSessionId!, eventsCursor: 0 }));
    this.initialized = true; this.publish();
  }
  private publish(): void {
    if (this.artifacts) {
      const headerIds = new Set(this.artifacts.messages.map(entry => entry.id));
      const previous = this.state.messages.filter(message => !headerIds.has(message.id));
      const retained = [...new Map([...this.earlierMessages, ...previous].map(message => [message.id, message])).values()];
      if (retained.length > 2000) { if (this.historyOlderWindow) this.historyWindowGap = true; else { this.historyGeneration++; this.historyBefore = undefined; this.historyHasMore = true; } }
      this.earlierMessages = this.historyOlderWindow ? retained.slice(0, 2000) : retained.slice(-2000);
    }
    this.update({ historyWindowGap: this.historyWindowGap, hasEarlierMessages: this.historyHasMore ?? this.artifacts?.hasArchivedMessages ?? false });
    const visibleIds = new Set([...this.earlierMessages.map(message => message.id), ...(this.artifacts?.messages.map(entry => entry.id) ?? [])]);
    for (const [id, question] of this.restoredQuestions) if (!this.tasks?.getSnapshot().tasks.some(task => task.id === question.taskId && task.status === 'waiting' && task.waitReason === 'clarification' && task.attempts.at(-1)?.id === question.attemptId)) this.restoredQuestions.delete(id);
    this.update({ outstandingQuestions: [...this.restoredQuestions.values()].filter(question => !visibleIds.has(question.id)) });
    this.update({ tasks: this.tasks?.getSnapshot().tasks ?? [], messages: [...this.earlierMessages, ...(this.artifacts?.messages.map(entry => entry.payload) ?? [])] as unknown as ConversationMessage[], proposals: this.reviewed.proposals.list().map(proposal => ({ taskId: this.proposalOwners.get(proposal.operationId) ?? '', proposal })) });
  }
  private async recoverOwned(repository: TaskRepository, scope: TaskScope): Promise<void> {
    for (const taskId of this.owned) {
      const refreshed = await repository.refresh(); if (!refreshed.ok) throw new Error(refreshed.code);
      const task = repository.getSnapshot().tasks.find(value => value.id === taskId);
      if (!task || !sameScope(task.scope, scope) || !['requested', 'working', 'waiting'].includes(task.status) || task.attempts.at(-1)?.status === 'finished') continue;
      const result = await this.executeCurrent(repository, { ...attemptBinding(execution(task)), type: 'interrupt' });
      if (!result.ok && !['stale-attempt', 'invalid-transition'].includes(result.code)) throw new Error(result.code);
    }
  }
  private persist(change: (ledger: ConversationLedger) => ConversationLedger): Promise<void> {
    const storage = this.artifactStorage, scope = this.scope;
    const run = this.artifactTail.then(async () => {
      if (!this.artifacts || !storage || storage !== this.artifactStorage || !scope || !sameScope(scope, this.artifacts.scope) || this.artifactUnknown) throw new Error('Conversation persistence requires reload');
      const next = { ...change(this.artifacts), revision: this.artifacts.revision + 1 };
      let saved: ConversationLedger | null;
      try { saved = storage.commit ? await storage.commit(this.artifactRevision, next) : await storage.compareAndSwap(this.artifactRevision, serializeConversationLedger(next)) ? next : null; }
      catch { this.artifactUnknown = true; this.scope && this.options.repository.agentExecutionLeases?.revokeScope(this.scope); throw new Error('Conversation persistence outcome is unknown; reload before continuing'); }
      if (!saved) { this.artifactUnknown = true; this.scope && this.options.repository.agentExecutionLeases?.revokeScope(this.scope); throw new Error('Conversation changed elsewhere; reload before continuing'); }
      this.artifacts = saved; this.artifactRevision = saved.revision; this.publish();
    });
    this.artifactTail = run.catch(() => undefined); return run;
  }
  private async message(message: ConversationMessage, cursor?: number): Promise<void> { await this.persist(ledger => { const entry = { id: message.id, ...(message.taskId ? { taskId: message.taskId } : {}), payload: json(message) }; return { ...ledger, ...(cursor === undefined ? {} : { eventsCursor: cursor }), messages: ledger.messages.some(value => value.id === message.id) ? ledger.messages.map(value => value.id === message.id ? entry : value) : [...ledger.messages, entry] }; }); }
  private async executeCurrent(repository: TaskRepository, command: TaskCommand) {
    for (let retry = 0; retry < 3; retry++) {
      const refreshed = await repository.refresh(); if (!refreshed.ok) throw new Error(refreshed.code);
      const result = await repository.executeCurrent(command);
      if (result.ok || !['stale-ledger', 'storage-conflict'].includes(result.code) || retry === 2) return result;
    }
    throw new Error('Task decision retry exhausted');
  }
  private async command(command: TaskCommand): Promise<CollaborationTask> {
    const repository = this.tasks; if (!repository) throw new Error('Open a board before assigning work');
    const refreshed = await repository.refresh(); if (!refreshed.ok) throw new Error(refreshed.code);
    if (repository !== this.tasks) throw new Error('Task board changed before the decision');
    const result = await this.executeCurrent(repository, command); if (!result.ok) throw new Error(result.code); if (repository === this.tasks) this.publish(); return result.task;
  }
  private async recordCancellation(binding: ExecutionIdentity, outcome: 'acknowledged' | 'failed', repository = this.tasks): Promise<void> {
    if (outcome !== 'acknowledged' || !repository) return;
    const refreshed = await repository.refresh(); if (!refreshed.ok) throw new Error(refreshed.code);
    const task = repository.getSnapshot().tasks.find(value => value.id === binding.taskId);
    if (task?.attempts.find(value => value.id === binding.attemptId)?.cancellation !== 'pending') return;
    const result = await this.executeCurrent(repository, { type: 'acknowledgeCancellation', taskId: task.id, actorId: task.actorId, scope: task.scope, attemptId: binding.attemptId });
    if (!result.ok) throw new Error(result.code); if (repository === this.tasks) this.publish();
  }
  private async interruptExact(binding: ExecutionIdentity, repository = this.tasks): Promise<void> {
    if (!repository) return;
    const refreshed = await repository.refresh(); if (!refreshed.ok) throw new Error(refreshed.code);
    const task = repository.getSnapshot().tasks.find(value => value.id === binding.taskId);
    if (!task || task.generation !== binding.generation || task.attempts.at(-1)?.id !== binding.attemptId || !['requested', 'working', 'waiting'].includes(task.status) || task.attempts.at(-1)?.status === 'finished') return;
    const result = await this.executeCurrent(repository, { ...attemptBinding(binding), type: 'interrupt' });
    if (!result.ok && result.code !== 'stale-attempt' && result.code !== 'invalid-transition') throw new Error(result.code); if (repository === this.tasks) this.publish();
  }
  private requestHostStop(binding: ExecutionIdentity, client: CollaborationBrowserClient, token: string, repository = this.tasks): Promise<boolean> {
    const inFlight = this.stopping.get(binding.attemptId); if (inFlight) return inFlight;
    this.pendingStops.set(binding.attemptId, { binding, repository, client, token, serviceSessionId: this.pendingStops.get(binding.attemptId)?.serviceSessionId ?? this.attemptInstances.get(binding.attemptId) ?? this.tokenInstances.get(token) ?? null });
    const promise = (async () => {
      try {
        const outcome = await client.stop(token, binding);
        if (outcome.cancellation !== 'acknowledged') { this.problem(new Error('Agent cancellation is unacknowledged; retry Stop or reconnect the host')); return false; }
        await this.recordCancellation(binding, outcome.cancellation, repository);
        this.pendingStops.delete(binding.attemptId); this.started.delete(binding.attemptId); return true;
      } catch { this.problem(new Error('Agent cancellation is unacknowledged; retry Stop or reconnect the host')); return false; }
      finally { this.stopping.delete(binding.attemptId); }
    })();
    this.stopping.set(binding.attemptId, promise); return promise;
  }
  async retryStop(taskId: string): Promise<void> {
    const { client, token } = this.connection();
    await this.restoreStopObligations(taskId);
    const obligations = [...this.pendingStops.values()].filter(value => value.binding.taskId === taskId);
    if (!obligations.length) throw new Error('No pending cancellation receipt is available in this browser');
    for (const obligation of obligations) {
      if (!obligation.serviceSessionId || obligation.serviceSessionId !== this.serviceSessionId) throw new Error('Reconnect the original running agent host to retry this cancellation');
      if (!await this.requestHostStop(obligation.binding, client, token, obligation.repository)) throw new Error('Execution cancellation remains unacknowledged');
    }
  }
  private async restoreStopObligations(taskId?: string): Promise<void> {
    const storage = this.artifactStorage, repository = this.tasks; if (!storage?.loadOperation || !repository || !this.client || !this.token || !this.serviceSessionId) return;
    const client = this.client, token = this.token, service = this.serviceSessionId;
    for (const task of repository.getSnapshot().tasks.filter(task => taskId ? task.id === taskId : this.owned.has(task.id))) for (const attempt of task.attempts.filter(attempt => attempt.cancellation === 'pending')) {
      if (this.pendingStops.has(attempt.id)) continue;
      const metadata = await storage.loadOperation('host-execution:' + attempt.id);
      if (storage !== this.artifactStorage || service !== this.serviceSessionId) return;
      if (!metadata || metadata.taskId !== task.id || !object(metadata.payload) || metadata.payload.kind !== 'host-execution' || metadata.payload.serviceSessionId !== service) continue;
      const binding = { ...execution(task), attemptId: attempt.id, generation: attempt.generation };
      if (canonical(metadata.payload.identity) !== canonical(binding)) continue;
      this.pendingStops.set(attempt.id, { binding, repository, client, token, serviceSessionId: service });
      this.attemptInstances.set(attempt.id, service);
    }
  }
  private task(taskId: string): CollaborationTask { const task = this.tasks?.getSnapshot().tasks.find(value => value.id === taskId); if (!task) throw new Error('Task was not found'); return task; }
  private assertProviderAvailable(providerId: string | undefined): void {
    const provider = this.state.providers.find(value => value.id === providerId);
    if (!provider) throw new Error('The selected agent is not available from this authenticated host');
    if (!provider.available) throw new Error(provider.detail || 'The selected agent is unavailable');
  }
  private saveOwnership(): void {
    const tasks = this.tasks?.getSnapshot().tasks ?? [];
    const ids = tasks.filter(task => this.owned.has(task.id) && (task.attempts.some(attempt => attempt.cancellation === 'pending') || ['requested', 'working', 'waiting'].includes(task.status) && task.attempts.at(-1)?.status !== 'finished')).map(task => task.id);
    this.options.ownership?.save(ids);
    for (const task of tasks) this.owned.delete(task.id); for (const id of ids) this.owned.add(id);
  }
  private connection(): { client: CollaborationBrowserClient; token: string } { if (!this.client || !this.token || this.state.connection !== 'connected') throw new Error('Connect a desktop agent host first'); return { client: this.client, token: this.token }; }
  async pair(url: string, secret: string): Promise<void> {
    await this.ready; await this.disconnect(); this.lifetime = new AbortController();
    const generation = this.loopGeneration, signal = this.lifetime.signal;
    if (!this.options.client) this.client = new CollaborationBrowserClient({ url, fetch: globalThis.fetch.bind(globalThis), now: this.now });
    const client = this.client; if (!client) throw new Error('Conversation client is unavailable');
    this.update({ connection: 'pairing', error: null });
    try { const paired = await client.pair(secret, signal); if (generation !== this.loopGeneration || signal.aborted) throw new Error('Pairing was cancelled'); this.token = paired.token; const status = await client.status(this.token, signal); if (!this.loopCurrent(generation, signal)) throw new Error('Pairing was cancelled'); this.serviceSessionId = status.sessionId; this.tokenInstances.set(paired.token, status.sessionId); if (this.artifacts && this.artifacts.eventsSessionId !== status.sessionId) await this.persist(ledger => ({ ...ledger, eventsSessionId: status.sessionId, eventsCursor: 0 })); if (!this.loopCurrent(generation, signal)) throw new Error('Pairing was cancelled'); this.update({ connection: 'connected', providers: status.providers }); await this.restoreStopObligations(); for (const obligation of [...this.pendingStops.values()]) if (obligation.serviceSessionId === status.sessionId) void this.requestHostStop(obligation.binding, client, this.token, obligation.repository); this.schedule(); }
    catch (error) { if (generation === this.loopGeneration) { this.update({ connection: 'disconnected' }); this.problem(error); } throw error; }
  }
  async start(provider: LocalAgentProvider, prompt: string, kind: 'edit' | 'question' = 'edit'): Promise<string> {
    if (!prompt.trim() || prompt.length > 64000) throw new Error('Instructions must be nonempty and at most 64000 characters');
    await this.ready; this.connection(); this.assertProviderAvailable(provider); if (!this.scope || !this.initialized || this.changingScope) throw new Error('Open and load a board before assigning work');
    this.assertCurrentBoard();
    if (kind === 'edit' && this.options.session.getState().branchId === this.options.session.getState().mainBranchId) throw new Error('Create or switch to a draft before starting editing work');
    const selection = this.options.selection?.() ?? { ids: [] }; const ids = selection.ids.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 200).slice(0, 200);
    const startingContext = { ids: [...ids], viewId: typeof selection.viewId === 'string' && selection.viewId.length <= 200 ? selection.viewId : null, omittedCount: selection.ids.length - ids.length };
    const scope = this.scope, repository = this.tasks, taskId = this.options.mintId();
    this.owned.add(taskId);
    const task = await this.command({ type: 'create', taskId, attemptId: this.options.mintId(), actorId: this.options.mintId(), providerId: provider, scope, instruction: prompt, kind });
    if (!this.scopeMatches() || this.changingScope || !this.scope || !sameScope(scope, this.scope)) { await this.interruptExact(execution(task), repository); throw new Error('Task board changed before execution'); }
    let launchAttempted = false;
    try {
      this.saveOwnership();
      await this.message({ id: this.options.mintId(), taskId: task.id, role: 'user', text: prompt, delivery: 'queued', startingContext });
      launchAttempted = true; await this.launch(task); return task.id;
    } catch (error) {
      if (repository) { const failed = await this.executeCurrent(repository, { ...attemptBinding(execution(task)), type: 'fail', reason: 'Task setup could not be saved' }); if (!failed.ok && !['stale-attempt', 'invalid-transition'].includes(failed.code)) this.problem(new Error(failed.code)); if (!launchAttempted) await this.recordCancellation(execution(task), 'acknowledged', repository); if (repository === this.tasks) this.publish(); }
      throw error;
    }
  }
  async loadStartingContext(taskId: string): Promise<ConversationMessage['startingContext']> {
    const cached = this.startingContexts.get(taskId); if (cached) return cached;
    const storage = this.artifactStorage, scope = this.scope;
    const stored = await storage?.loadStartingMessage?.(taskId);
    if (storage !== this.artifactStorage || scope !== this.scope) throw new Error('Starting context board changed');
    const message = stored?.payload as unknown as ConversationMessage | undefined;
    const context = message?.startingContext ?? this.state.messages.find(value => value.taskId === taskId && value.role === 'user' && value.startingContext)?.startingContext;
    if (context) this.startingContexts.set(taskId, context); return context;
  }
  private async startingContext(taskId: string): Promise<AgentSelection> { return await this.loadStartingContext(taskId) ?? { ids: [] }; }
  private async launch(requested: CollaborationTask, providerSessionId?: string, prompt?: string): Promise<void> {
    const binding = execution(requested), leases = this.options.repository.agentExecutionLeases, repository = this.tasks, signal = this.lifetime.signal;
    let connection: ReturnType<AgentConversationController['connection']> | undefined;
    let dispatched = false;
    try {
      connection = this.connection(); const { client, token } = connection;
      const active = await this.command({ ...attemptBinding(binding), type: 'start', ...(providerSessionId ? { providerSessionId } : {}) });
      this.owned.add(active.id); this.saveOwnership();
      if (!leases) throw new Error('Trusted browser execution leases are unavailable');
      const requestStartedAt = this.now(); const begun = leases.begin(attemptBinding(binding), requestStartedAt, this.options.leaseMs); if (!begun.ok) throw new Error(begun.code);
      if (!this.options.repository.createAgentTaskStorage || signal.aborted) throw new Error('Execution was stopped before launch');
      await readAuthorizedTask(this.options.repository.createAgentTaskStorage(active.scope), this.options.session, binding, { provider: active.providerId as LocalAgentProvider, mode: active.kind === 'question' ? 'question' : 'task', ...(providerSessionId ? { providerSessionId } : {}) });
      if (signal.aborted || !leases.permits(attemptBinding(binding))) throw new Error('Execution was stopped before launch');
      const operationId = 'host-execution:' + binding.attemptId;
      const serviceSessionId = this.tokenInstances.get(token); if (!serviceSessionId) throw new Error('Authenticated execution host identity is unavailable');
      await this.persist(ledger => ({ ...ledger, operations: [...ledger.operations.filter(entry => entry.operationId !== operationId), { taskId: binding.taskId, operationId, payload: json({ kind: 'host-execution', identity: binding, serviceSessionId }) }] }));
      this.attemptInstances.set(binding.attemptId, serviceSessionId);
      if (signal.aborted || !leases.permits(attemptBinding(binding))) throw new Error('Execution was stopped before launch');
      const launchPrompt = (prompt ?? active.instruction) + '\n\nStarting context (reference only; does not grant editing permission): ' + JSON.stringify(await this.startingContext(active.id));
      dispatched = true;
      const ack = await client.start(token, { identity: binding, provider: active.providerId as LocalAgentProvider, mode: active.kind === 'question' ? 'question' : 'task', prompt: launchPrompt, ...(providerSessionId ? { providerSessionId } : {}) }, signal);
      const renewed = leases.renew(attemptBinding(binding), ack.requestStartedAt, this.options.leaseMs); if (!renewed.ok && !(renewed.code === 'stale-binding' && leases.permits(attemptBinding(binding)))) throw new Error(renewed.code);
      this.started.set(binding.attemptId, binding);
      const original = this.state.messages.find(message => message.taskId === active.id && message.role === 'user' && message.delivery === 'queued'); if (original) await this.message({ ...original, delivery: 'delivered' });
    } catch (error) { leases?.revoke(attemptBinding(binding)); try { if (repository) { const failed = await this.executeCurrent(repository, { ...attemptBinding(binding), type: 'fail', reason: error instanceof Error ? error.message : 'Agent startup failed' }); if (!failed.ok && !['stale-attempt', 'invalid-transition'].includes(failed.code)) this.problem(new Error(failed.code)); if (!dispatched) await this.recordCancellation(binding, 'acknowledged', repository); if (repository === this.tasks) this.publish(); } } finally { if (dispatched && connection) await this.requestHostStop(binding, connection.client, connection.token, repository); } this.problem(error); throw error; }
  }
  async grantLive(taskId: string, attemptId: string): Promise<void> { this.assertCurrentBoard(); const task = this.task(taskId); if (task.attempts.at(-1)?.id !== attemptId) throw new Error('This Live grant belongs to an earlier attempt'); if (this.options.session.getState().branchId === this.options.session.getState().mainBranchId) throw new Error('Create or switch to a draft before allowing Live edits'); await this.command({ ...attemptBinding(execution(task)), type: 'grantLive' }); }
  preview(operationId: string) { return this.reviewed.proposals.preview(operationId); }
  async stop(taskId: string): Promise<void> {
    const task = this.task(taskId), binding = execution(task); this.options.repository.agentExecutionLeases?.revoke(attemptBinding(binding)); this.started.delete(binding.attemptId);
    this.options.repository.clearAgentTaskOverlap?.(attemptBinding(binding));
    if (this.state.activity?.taskId === taskId) this.update({ activity: undefined });
    const repository = this.tasks, connection = this.token && this.client ? { client: this.client, token: this.token } : undefined;
    try { const result = repository && await this.executeCurrent(repository, { ...attemptBinding(binding), type: 'stop' }); if (result && !result.ok && !['stale-attempt', 'invalid-transition'].includes(result.code)) throw new Error(result.code); if (repository === this.tasks) this.publish(); }
    finally { if (connection) await this.requestHostStop(binding, connection.client, connection.token, repository); }
  }
  async resume(taskId: string): Promise<void> {
    this.connection();
    if (this.state.blockedActions.some(action => action.taskId === taskId)) throw new Error('Resolve the affected action before resuming');
    const previous = this.task(taskId); this.assertProviderAvailable(previous.providerId); const scope = this.currentScope(); if (!scope || !sameScope(scope, previous.scope) || this.options.session.getState().needsReload) throw new Error('Reload and validate this board before resuming');
    const oldAttempt = previous.attempts.at(-1);
    const task = await this.command({ type: 'resume', taskId, actorId: previous.actorId, scope, attemptId: this.options.mintId(), permission: 'suggest', currentBoardValidated: true }); await this.launch(task, oldAttempt?.cancellation === 'acknowledged' ? oldAttempt.providerSessionId : undefined);
  }
  async send(taskId: string, text: string, target: 'task' | 'clarification' | 'proposal-revision' = 'task'): Promise<void> {
    this.connection();
    const task = this.task(taskId);
    if (target === 'clarification' && task.status === 'waiting' && task.waitReason === 'clarification' && task.attempts.at(-1)?.status === 'finished') this.assertProviderAvailable(task.providerId);
    const savedQuestion = target === 'clarification' ? await this.artifactStorage?.loadClarificationQuestion?.(taskId, task.attempts.at(-1)!.id) : undefined;
    const question = target === 'clarification' ? savedQuestion?.payload as unknown as ConversationMessage ?? [...this.restoredQuestions.values(), ...this.state.messages].reverse().find(value => value.taskId === taskId && value.role === 'agent' && value.clarificationQuestionId && value.attemptId === task.attempts.at(-1)?.id) : undefined;
    if (this.task(taskId).attempts.at(-1)?.id !== task.attempts.at(-1)?.id) throw new Error('Clarification attempt changed before replying');
    const message: ConversationMessage = { id: this.options.mintId(), taskId, role: 'user', text, delivery: 'queued', ...(question?.clarificationQuestionId ? { clarificationQuestionId: question.clarificationQuestionId } : {}) }; await this.message(message);
    if (target === 'clarification' && task.status === 'waiting' && task.waitReason === 'clarification' && task.attempts.at(-1)?.status === 'finished') {
      const scope = this.currentScope(); if (!scope || !sameScope(scope, task.scope) || this.options.session.getState().needsReload || !question) throw new Error('Reload and validate the clarification board before replying');
      const next = await this.command({ type: 'answer', taskId, actorId: task.actorId, scope, attemptId: this.options.mintId(), currentBoardValidated: true });
      await this.launch(next, task.attempts.at(-1)?.providerSessionId, `Answer to clarification ${question.clarificationQuestionId}: ${text}\nContinue the original request: ${task.instruction}`); return;
    }
    try { const { client, token } = this.connection(); const outcome = await client.send(token, execution(task), { messageId: message.id, text, target }, this.lifetime.signal); await this.message({ ...message, delivery: outcome.acknowledged ? 'acknowledged' : outcome.delivered ? 'delivered' : 'failed' }); if (!outcome.delivered) throw new Error('Feedback was not delivered; explicitly stop or resume before retrying'); }
    catch (error) { await this.message({ ...message, delivery: 'failed' }); this.problem(error); throw error; }
  }
  async requestChanges(operationId: string, text: string): Promise<void> {
    this.assertCurrentBoard();
    this.connection();
    const taskId = this.proposalOwners.get(operationId); if (!taskId) throw new Error('Proposal task was not found');
    const task = this.task(taskId);
    if (task.status === 'completed' || task.status === 'stopped') { await this.message({ id: this.options.mintId(), taskId, role: 'system', text: `Refinement requested for task reversal ${operationId}: ${text}. The existing reversal remains available for human review; prepare a new safe reversal after editing the board.`, delivery: 'acknowledged' }); return; }
    if (task.status !== 'waiting' || task.waitReason !== 'review' || task.attempts.at(-1)?.status !== 'finished') throw new Error('Wait for the current proposal review before requesting a revision');
    this.assertProviderAvailable(task.providerId);
    if (task.attempts.at(-1)?.status === 'finished') { await this.message({ id: this.options.mintId(), taskId, role: 'user', text: `Request changes to ${operationId}: ${text}`, delivery: 'queued' }); const revised = await this.command({ type: 'revise', taskId, actorId: task.actorId, scope: task.scope, attemptId: this.options.mintId(), permission: 'suggest', currentBoardValidated: true }); try { this.reviewed.proposals.reject(operationId, this.reviewed.reviewer); await this.saveProposals(); } catch (error) { await this.command({ ...attemptBinding(execution(revised)), type: 'fail', reason: 'Proposal revision could not be saved' }); throw error; } await this.launch(revised, task.attempts.at(-1)?.providerSessionId, `Revise proposal ${operationId}: ${text}`); }
    else await this.send(taskId, text, 'proposal-revision');
  }
  private async saveProposals(): Promise<void> { await this.persist(ledger => ({ ...ledger, proposals: this.reviewed.proposals.list().map(proposal => ({ id: proposal.operationId, ...(this.proposalOwners.get(proposal.operationId) ? { taskId: this.proposalOwners.get(proposal.operationId)! } : {}), payload: json(proposal) })) })); this.reviewed.proposals.pruneTerminal(20); }
  async accept(operationId: string): Promise<void> {
    this.assertCurrentBoard();
    const reviewed = this.reviewed, storage = this.artifactStorage, repository = this.tasks, scope = this.scope, proposalOwners = new Map(this.proposalOwners);
    const taskId = this.proposalOwners.get(operationId);
    const proposal = reviewed.proposals.list().find(value => value.operationId === operationId);
    if (!proposal || this.options.session.getState().branchId === this.options.session.getState().mainBranchId) throw new Error('Open the proposal draft before accepting');
    if (!storage || !repository || !scope) throw new Error('Proposal storage is unavailable');
    // Persist the in-flight review before the authored apply; crash recovery never re-applies it silently.
    await this.persist(ledger => ({ ...ledger, proposals: this.reviewed.proposals.list().map(value => ({ id: value.operationId, ...(this.proposalOwners.get(value.operationId) ? { taskId: this.proposalOwners.get(value.operationId)! } : {}), payload: json(value.operationId === operationId ? { ...value, status: 'accepting' } : value) })) }));
    const result = await reviewed.proposals.accept(operationId, reviewed.reviewer);
    const outcome = result.ok ? result.proposal : reviewed.proposals.list().find(value => value.operationId === operationId) ?? { ...proposal, status: 'failed' as const };
    // The authored apply may finish after navigation. Its receipt belongs to the captured board.
    const saved = await this.persistReviewOutcome(storage, scope, operationId, outcome);
    reviewed.proposals.pruneTerminal(20);
    if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join('; '));
    const archivedOpen = await storage.loadOpenProposals?.() ?? [];
    const unresolvedReview = reviewed.proposals.list().some(value => proposalOwners.get(value.operationId) === taskId && !['accepted', 'rejected'].includes(value.status)) || archivedOpen.some(entry => entry.taskId === taskId && object(entry.payload) && !['accepted', 'rejected'].includes(String(entry.payload.status)));
    if (taskId && !unresolvedReview) {
      const refreshed = await repository.refresh(); if (!refreshed.ok) throw new Error(refreshed.code);
      const task = repository.getSnapshot().tasks.find(value => value.id === taskId);
      if (task?.status === 'waiting' && task.waitReason === 'review') { const completed = await this.executeCurrent(repository, { ...attemptBinding(execution(task)), type: 'complete', pendingWrites: 0, unresolvedDecisions: 0 }); if (!completed.ok) throw new Error(completed.code); if (repository === this.tasks) this.publish(); }
    }
  }
  private persistReviewOutcome(storage: AgentConversationStorage, scope: TaskScope, operationId: string, proposal: Proposal<RecordChange>): Promise<ConversationLedger> {
    const run = this.artifactTail.then(async () => {
      const raw = await storage.load(), current = raw === null ? null : parseConversationLedger(raw);
      const archived = await storage.loadProposal?.(operationId);
      if (!current || !sameScope(current.scope, scope) || (!current.proposals.some(entry => entry.id === operationId) && !archived)) throw new Error('The proposal board storage is unavailable');
      const entries = current.proposals.some(entry => entry.id === operationId) ? current.proposals : [...current.proposals, archived!];
      const next = { ...current, revision: current.revision + 1, proposals: entries.map(entry => entry.id === operationId ? { ...entry, payload: json(proposal) } : entry) };
      let acknowledged: ConversationLedger | null;
      try { acknowledged = storage.commit ? await storage.commit(current.revision, next) : await storage.compareAndSwap(current.revision, serializeConversationLedger(next)) ? next : null; if (!acknowledged) throw new Error('Proposal receipt changed elsewhere; reload its board'); }
      catch (error) { if (storage === this.artifactStorage) { this.artifactUnknown = true; this.options.repository.agentExecutionLeases?.revokeScope(scope); } throw error; }
      if (storage === this.artifactStorage && this.scope && sameScope(scope, this.scope)) { this.artifacts = acknowledged; this.artifactRevision = acknowledged.revision; this.publish(); }
      return acknowledged;
    });
    this.artifactTail = run.catch(() => undefined); return run;
  }
  /** Explicitly skip the held action; a separate Resume must re-plan from the current board. */
  async resolveOverlap(taskId: string): Promise<void> {
    const task = this.task(taskId), binding = { ...execution(task), generation: task.attempts.at(-1)!.generation };
    if (task.status === 'waiting' && task.waitReason === 'overlap') {
      this.options.repository.agentExecutionLeases?.revoke(attemptBinding(binding)); this.started.delete(binding.attemptId);
      const { client, token } = this.connection(); if (!await this.requestHostStop(binding, client, token)) throw new Error('Cannot resolve until execution cancellation is acknowledged');
      await this.command({ ...attemptBinding(binding), type: 'interrupt' });
      await this.recordCancellation(binding, 'acknowledged');
    } else if (!['interrupted', 'stopped', 'failed'].includes(task.status)) throw new Error('The held action is no longer awaiting a decision');
    this.options.repository.clearAgentTaskOverlap?.(attemptBinding(binding));
    const storage = this.artifactStorage, scope = this.scope;
    const archived = await Promise.all(this.state.blockedActions.filter(action => action.taskId === taskId).map(action => storage?.loadOperation?.(action.operationId)));
    if (storage !== this.artifactStorage || scope !== this.scope) throw new Error('Overlap board changed before the decision');
    await this.persist(ledger => ({ ...ledger, operations: [...new Map([...ledger.operations, ...archived.filter(entry => entry !== null && entry !== undefined)].map(entry => [entry.operationId, entry])).values()].map(entry => entry.taskId === taskId && object(entry.payload) && object(entry.payload.result) && entry.payload.result.code === 'conflict' ? { ...entry, payload: json({ ...entry.payload, decision: 'skip-and-replan' }) } : entry) }));
    this.update({ blockedActions: this.state.blockedActions.filter(action => action.taskId !== taskId) });
  }
  async reject(operationId: string): Promise<void> { const result = this.reviewed.proposals.reject(operationId, this.reviewed.reviewer); await this.saveProposals(); if (!result.ok) throw new Error(result.issues.map(issue => issue.message).join('; ')); await this.finishReviewed(this.proposalOwners.get(operationId)); }
  async undo(taskId: string): Promise<string | null> {
    this.assertCurrentBoard();
    const task = this.task(taskId), scope = this.currentScope(), state = this.options.session.getState();
    const assertNoActiveAuthoring = () => { if (this.state.tasks.some(value => value.kind !== 'question' && ['requested', 'working', 'waiting'].includes(value.status) && value.attempts.at(-1)?.status !== 'finished')) throw new Error('Stop the active authoring attempt before preparing Undo'); };
    assertNoActiveAuthoring();
    if (!scope || !sameScope(scope, task.scope) || !state.document || state.workingRevision === null || state.branchId === state.mainBranchId || !this.options.repository.listAgentTaskActions) throw new Error('Open this task draft before preparing Undo');
    const rows = await this.options.repository.listAgentTaskActions(scope, taskId);
    assertNoActiveAuthoring();
    if (rows.some(row => row.taskId !== taskId || row.binding.actorId !== task.actorId)) throw new Error('Task reversal attribution is invalid');
    const after = this.options.session.getState(); if (!after.document || !sameScope(scope, this.currentScope()!) || after.workingRevision !== state.workingRevision) throw new Error('The board changed; prepare Undo again');
    const plan = planAgentTaskUndo(after.document, rows);
    if (plan.status === 'empty') { await this.message({ id: this.options.mintId(), taskId, role: 'system', text: 'There are no remaining task changes to undo.', delivery: 'acknowledged' }); return null; }
    if (plan.status === 'invalid-journal') throw new Error(plan.message);
    if (!plan.proposal.preview || !plan.proposal.changes.length) { await this.message({ id: this.options.mintId(), taskId, role: 'system', text: 'Undo needs refinement because later human edits or dependencies prevent a safe reversal.', delivery: 'acknowledged' }); throw new Error('No safe reversal is ready; preserve the human edits and refine the proposal'); }
    const operationId = this.options.mintId();
    const submitted = this.reviewed.proposals.submit({ operationId, actor: { actorId: task.actorId, displayName: task.providerId ?? 'Agent', kind: 'agent' }, scope: { projectId: scope.projectId, branchId: scope.branchId }, expectedRevision: after.workingRevision!, label: plan.status === 'ready' ? 'Undo task' : 'Review task revert preserving human edits', changes: plan.proposal.changes });
    if (!submitted.ok) throw new Error(submitted.issues.map(issue => issue.message).join('; '));
    this.proposalOwners.set(operationId, taskId); await this.saveProposals();
    if (plan.status === 'review-required') await this.message({ id: this.options.mintId(), taskId, role: 'system', text: 'Review this partial task reversal. Content changed by people remains untouched.', delivery: 'acknowledged' });
    return operationId;
  }
  private unresolved(taskId: string): boolean { return this.state.proposals.some(entry => entry.taskId === taskId && !['accepted', 'rejected'].includes(entry.proposal.status)); }
  private async finishReviewed(taskId?: string): Promise<void> { if (!taskId) return; const task = this.task(taskId); if (task.status === 'waiting' && task.waitReason === 'review' && !this.unresolved(taskId)) await this.command({ ...attemptBinding(execution(task)), type: 'complete', pendingWrites: 0, unresolvedDecisions: 0 }); }
  private loopCurrent(generation: number, signal: AbortSignal): boolean { return !this.disposed && generation === this.loopGeneration && !signal.aborted && this.token !== null; }
  private schedule(): void {
    const generation = this.loopGeneration, signal = this.lifetime.signal;
    const poll = () => {
      if (!this.loopCurrent(generation, signal)) return;
      this.pollTimer = setTimeout(() => {
        if (!this.loopCurrent(generation, signal)) return;
        void this.pollOnce().catch(error => { if (this.loopCurrent(generation, signal)) this.problem(error); }).finally(() => { if (this.loopCurrent(generation, signal)) poll(); });
      }, this.options.pollMs);
    };
    const heartbeat = () => {
      if (!this.loopCurrent(generation, signal)) return;
      this.heartbeatTimer = setTimeout(() => {
        if (!this.loopCurrent(generation, signal)) return;
        void this.heartbeatOnce().catch(error => { if (this.loopCurrent(generation, signal)) this.problem(error); }).finally(() => { if (this.loopCurrent(generation, signal)) heartbeat(); });
      }, this.options.heartbeatMs);
    };
    poll(); heartbeat();
  }
  async pollOnce(): Promise<void> {
    if (this.polling || this.changingScope || !this.initialized) return; this.polling = true;
    const epoch = this.serviceSessionId, repository = this.tasks, scope = this.scope;
    try { const { client, token } = this.connection(), signal = this.lifetime.signal; const requests = await client.requests(token, signal); if (signal.aborted) return; for (const request of requests) { if (signal.aborted) return; await this.handleRequest(request); } const batch = await client.events(token, this.artifacts?.eventsCursor ?? 0, signal); if (signal.aborted) return; for (const event of batch.events) { if (signal.aborted) return; await this.event(event); } if (batch.cursor !== this.artifacts?.eventsCursor) await this.persist(ledger => ({ ...ledger, eventsCursor: batch.cursor })); }
    catch (error) {
      if (object(error) && error.code === 'event-gap' && object(error.gap) && typeof error.gap.latestCursor === 'number' && Number.isSafeInteger(error.gap.latestCursor) && error.gap.latestCursor >= 0 && epoch === this.serviceSessionId && repository === this.tasks && scope && this.scope && sameScope(scope, this.scope)) {
        const bindings = repository?.getSnapshot().tasks.filter(task => this.owned.has(task.id) && task.attempts.at(-1)?.status === 'working' && ['working', 'waiting'].includes(task.status)).map(execution) ?? [];
        this.options.repository.agentExecutionLeases?.revokeScope(scope); this.update({ activity: undefined });
        const { client, token } = this.connection();
        for (const binding of bindings) { this.started.delete(binding.attemptId); this.options.repository.clearAgentTaskOverlap?.(attemptBinding(binding)); try { await this.interruptExact(binding, repository); } finally { void this.requestHostStop(binding, client, token, repository); } }
        if (epoch === this.serviceSessionId && repository === this.tasks) await this.message({ id: this.options.mintId(), role: 'system', text: 'Some agent activity is no longer available. Execution was interrupted; completed changes remain. Resume explicitly to continue.', delivery: 'acknowledged' }, error.gap.latestCursor);
      }
      throw error;
    }
    finally { this.polling = false; }
  }
  async heartbeatOnce(): Promise<void> {
    const { client, token } = this.connection(), signal = this.lifetime.signal, repository = this.tasks;
    for (const binding of [...this.started.values()]) {
      try {
        if (!repository || !(await this.currentWorking(binding, repository))) { this.started.delete(binding.attemptId); void this.requestHostStop(binding, client, token, repository); continue; }
        const ack = await client.heartbeat(token, binding, signal);
        if (signal.aborted || repository !== this.tasks || !(await this.currentWorking(binding, repository))) { this.started.delete(binding.attemptId); continue; }
        const leases = this.options.repository.agentExecutionLeases;
        const renewed = leases?.renew(attemptBinding(binding), ack.requestStartedAt, this.options.leaseMs);
        if (!renewed?.ok && !(renewed?.code === 'stale-binding' && leases?.permits(attemptBinding(binding)))) throw new Error(renewed?.code ?? 'lease-unavailable');
      } catch (error) {
        this.options.repository.agentExecutionLeases?.revoke(attemptBinding(binding)); this.started.delete(binding.attemptId);
        try { await this.interruptExact(binding, repository); } catch (persistenceError) { this.problem(persistenceError); } finally { void this.requestHostStop(binding, client, token, repository); }
        if (!signal.aborted) this.problem(error);
      }
    }
    for (const obligation of [...this.pendingStops.values()]) if (obligation.serviceSessionId === this.serviceSessionId) void this.requestHostStop(obligation.binding, client, token, obligation.repository);
  }
  private async currentWorking(binding: ExecutionIdentity, repository: TaskRepository): Promise<boolean> {
    const refreshed = await repository.refresh(); if (!refreshed.ok) throw new Error(refreshed.code);
    const task = repository.getSnapshot().tasks.find(value => value.id === binding.taskId);
    return !!task && task.generation === binding.generation && task.actorId === binding.actorId && task.attempts.at(-1)?.id === binding.attemptId && task.attempts.at(-1)?.status === 'working' && ['working', 'waiting'].includes(task.status);
  }
  private async handleRequest(request: BrowserAuthorityRequest): Promise<void> {
    const { client, token } = this.connection();
    try {
      if (!this.scope || !this.options.repository.createAgentTaskStorage) throw new Error('Task authority is unavailable');
      const metadata = request.payload.kind === 'authorize' ? request.payload.data : undefined;
      if (request.payload.kind === 'authorize' && (!object(metadata) || typeof metadata.provider !== 'string' || !['claude', 'codex', 'agy'].includes(metadata.provider) || typeof metadata.mode !== 'string' || !['task', 'question'].includes(metadata.mode))) throw new Error('Invalid startup metadata');
      const task = await readAuthorizedTask(this.options.repository.createAgentTaskStorage(this.scope), this.options.session, request.identity, metadata as Parameters<typeof readAuthorizedTask>[3]);
      if (!this.options.repository.agentExecutionLeases?.permits(attemptBinding(request.identity))) throw new Error('Execution lease is expired or revoked');
      if (request.payload.kind === 'authorize') { await client.result(token, request, { result: true }, this.lifetime.signal); this.started.set(request.identity.attemptId, request.identity); return; }
      const tool = request.payload.data; if (!isBridgeRequest(tool)) throw new Error('Unknown board tool');
      if (task.kind === 'question' && !['board_inspect', 'component_schemas', 'document_validate', 'proposal_status', 'clarification_request'].includes(tool.tool)) throw new Error('Questions cannot edit this board');
      let result: unknown;
      const toolName: string = tool.tool;
      const input = object(tool.input) ? tool.input : {};
      if (typeof input.operationId === 'string' && input.operationId.startsWith('host-execution:')) throw new Error('Operation identity is reserved for trusted execution metadata');
      if (['proposal_submit', 'diagram_create'].includes(toolName) && typeof input.operationId === 'string') {
        const prior = await this.artifactStorage?.loadOperation?.(input.operationId) ?? this.artifacts?.operations.find(entry => entry.operationId === input.operationId);
        if (prior) {
          if (prior.taskId !== task.id || !object(prior.payload) || prior.payload.tool !== toolName || canonical(prior.payload.input) !== canonical(tool.input)) throw new Error('Operation identity was reused with different input');
          const latest = await this.artifactStorage?.loadProposal?.(input.operationId) ?? this.artifacts?.proposals.find(entry => entry.id === input.operationId);
          const replay = latest && object(prior.payload.result) && object(prior.payload.result.proposal) ? { ...prior.payload.result, proposal: latest.payload } : prior.payload.result;
          await client.result(token, request, { result: replay }, this.lifetime.signal); return;
        }
        if (this.reviewed.proposals.list().length >= 200) throw new Error('Resolve pending proposal reviews before submitting another proposal (200 decision limit)');
      }
      if (toolName === 'proposal_status' && typeof input.operationId === 'string') {
        const archived = await this.artifactStorage?.loadProposal?.(input.operationId);
        if (archived) { await client.result(token, request, { result: archived.payload }, this.lifetime.signal); return; }
      }
      const startingContext = await this.startingContext(task.id);
      this.update({ activity: { taskId: task.id, attemptId: request.identity.attemptId, kind: toolName === 'action_submit' ? 'applying' : ['proposal_submit', 'diagram_create', 'proposal_status'].includes(toolName) ? 'reviewing' : 'reading', targetIds: toolName === 'board_inspect' ? input.selectionOnly === true ? [...startingContext.ids] : [] : targets(input.changes) } });
      if (toolName === 'board_inspect') {
        result = { ...this.reviewed.context(input.selectionOnly === true, startingContext), task: { id: task.id, attemptId: request.identity.attemptId, kind: task.kind ?? 'edit', permission: task.permission } };
      } else if (toolName === 'clarification_request') {
        const input = tool.input;
        if (!object(input) || typeof input.questionId !== 'string' || !input.questionId.trim() || input.questionId.length > 200 || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 2000) throw new Error('Clarification requires a bounded question identity and text');
        if (task.status !== 'working' && !(task.status === 'waiting' && task.waitReason === 'clarification')) throw new Error('Resolve the current task decision before asking another clarification');
        const existing = this.state.messages.find(value => value.taskId === task.id && value.clarificationQuestionId === input.questionId && value.role === 'agent');
        if (existing && existing.text !== input.question) throw new Error('Clarification identity was reused with different text');
        const questionMessage: ConversationMessage = { id: existing?.id ?? this.options.mintId(), taskId: task.id, attemptId: request.identity.attemptId, clarificationQuestionId: input.questionId, role: 'agent', text: input.question, delivery: 'acknowledged' };
        await this.message(questionMessage);
        this.restoredQuestions.set(questionMessage.id, questionMessage);
        if (task.status === 'working') await this.command({ ...attemptBinding(request.identity), type: 'wait', reason: 'clarification' });
        else this.publish();
        result = { waiting: true, questionId: input.questionId };
      } else if (toolName === 'action_submit') {
        if (!object(tool.input)) throw new Error('Invalid live action');
        const action = tool.input;
        result = await this.options.session.applyLiveTaskAction({ operationId: action.operationId as string, label: action.label as string, changes: action.changes as readonly RecordChange[], expectedRecords: action.expectedRecords as never, binding: attemptBinding(request.identity) });
        if (object(result) && result.status === 'failed' && result.code === 'conflict') {
          const document = this.options.session.getState().document;
          if (document) this.options.repository.holdAgentTaskAction?.(attemptBinding(request.identity), document, action.changes as readonly RecordChange[]);
          if (task.status === 'working') await this.command({ ...attemptBinding(request.identity), type: 'wait', reason: 'overlap' });
          this.update({ blockedActions: [...this.state.blockedActions, { taskId: task.id, operationId: action.operationId as string }] });
        } else if (!object(result) || result.status !== 'applied') {
          await this.command({ ...attemptBinding(request.identity), type: 'fail', reason: 'A board action was rejected; review the diagnostic before retrying' });
          this.options.repository.agentExecutionLeases?.revoke(attemptBinding(request.identity)); this.started.delete(request.identity.attemptId);
          const taskRepository = this.tasks;
          void this.requestHostStop(request.identity, client, token, taskRepository);
        }
        await this.persist(ledger => ({ ...ledger, operations: [...ledger.operations.filter(entry => entry.taskId !== task.id || entry.operationId !== action.operationId), { taskId: task.id, operationId: action.operationId as string, payload: json({ request: action, result }) }] }));
      } else {
        if (['proposal_submit', 'diagram_create'].includes(tool.tool)) {
          if (!object(tool.input) || !object(tool.input.scope) || tool.input.scope.projectId !== task.scope.projectId || tool.input.scope.branchId !== task.scope.branchId) throw new Error('Proposal scope does not match its task');
          if (typeof tool.input.operationId !== 'string') throw new Error('Proposal operation identity is required');
          this.proposalOwners.set(tool.input.operationId, task.id);
        }
        result = await this.reviewed.executeReviewedTool(tool, { actorId: task.actorId, displayName: task.providerId ?? 'Agent', kind: 'agent' });
        if (toolName === 'diagram_create' && object(result) && object(result.proposal)) this.update({ activity: { taskId: task.id, attemptId: request.identity.attemptId, kind: 'reviewing', targetIds: targets(result.proposal.changes) } });
        if (['proposal_submit', 'diagram_create'].includes(tool.tool)) {
          await this.persist(ledger => ({ ...ledger, proposals: this.reviewed.proposals.list().map(proposal => ({ id: proposal.operationId, taskId: this.proposalOwners.get(proposal.operationId) ?? task.id, payload: json(proposal) })), operations: [...ledger.operations.filter(entry => entry.operationId !== input.operationId), { taskId: task.id, operationId: input.operationId as string, payload: json({ tool: toolName, input: tool.input, result }) }] }));
          this.reviewed.proposals.pruneTerminal(20);
        }
      }
      await client.result(token, request, { result: result ?? null }, this.lifetime.signal);
    } catch (error) { this.problem(error); await client.result(token, request, { error: error instanceof Error ? error.message : 'Board tool failed' }, this.lifetime.signal); }
    finally { if (this.state.activity?.taskId === request.identity.taskId && this.state.activity.attemptId === request.identity.attemptId) this.update({ activity: undefined }); }
  }
  private async event(event: CollaborationEvent): Promise<void> {
    if (event.cursor <= (this.artifacts?.eventsCursor ?? 0)) return;
    if (event.payload.kind === 'attempt-ended') await this.recordCancellation(event.identity, 'acknowledged');
    const task = this.tasks?.getSnapshot().tasks.find(value => value.id === event.identity.taskId);
    if (!task) { await this.persist(ledger => ({ ...ledger, eventsCursor: event.cursor })); return; }
    const binding = execution(task);
    if (!Object.keys(binding).every(key => binding[key as keyof ExecutionIdentity] === event.identity[key as keyof ExecutionIdentity])) { await this.persist(ledger => ({ ...ledger, eventsCursor: event.cursor })); return; }
    const payload = event.payload;
    if (payload.kind === 'session') await this.command({ ...attemptBinding(binding), type: 'recordSession', providerSessionId: payload.sessionId });
    if (payload.kind === 'text') {
      const prior = this.state.messages.at(-1); const append = payload.format === 'delta' && prior?.role === 'agent' && prior.taskId === task.id && prior.attemptId === binding.attemptId && prior.text.length + payload.text.length <= 64000;
      if (append || payload.text.length <= 64000) await this.message({ id: append ? prior.id : this.options.mintId(), taskId: task.id, attemptId: binding.attemptId, role: 'agent', text: append ? prior.text + payload.text : payload.text, delivery: 'acknowledged' }, event.cursor);
      else {
        const chunks: ConversationMessage[] = [];
        for (let offset = 0; offset < payload.text.length; offset += 64000) chunks.push({ id: this.options.mintId(), taskId: task.id, attemptId: binding.attemptId, role: 'agent', text: payload.text.slice(offset, offset + 64000), delivery: 'acknowledged' });
        await this.persist(ledger => ({ ...ledger, eventsCursor: event.cursor, messages: [...ledger.messages, ...chunks.map(message => ({ id: message.id, taskId: task.id, payload: json(message) }))] }));
      }
    }
    if (payload.kind === 'diagnostic') await this.message({ id: this.options.mintId(), taskId: task.id, attemptId: binding.attemptId, role: 'system', text: `${payload.code}: ${payload.message.slice(0, 2000)}`, delivery: 'acknowledged' }, event.cursor);
    if (payload.kind === 'provider-result' || payload.kind === 'attempt-ended') {
      if (this.state.activity?.taskId === task.id) this.update({ activity: undefined });
      if (task.attempts.at(-1)?.status === 'finished') { await this.persist(ledger => ({ ...ledger, eventsCursor: event.cursor })); return; }
      this.options.repository.agentExecutionLeases?.revoke(attemptBinding(binding)); this.started.delete(binding.attemptId);
      // A provider turn result is not process-close acknowledgement. Fence and close it explicitly.
      if (payload.kind === 'provider-result') {
        const { client, token } = this.connection();
        if (!await this.requestHostStop(binding, client, token)) { await this.interruptExact(binding); await this.message({ id: this.options.mintId(), taskId: task.id, role: 'system', text: 'Execution is fenced, but process cancellation is unacknowledged. The host will retry Stop; Resume will use a fresh provider session.', delivery: 'acknowledged' }, event.cursor); return; }
        if (!this.tasks || !(await this.currentWorking(binding, this.tasks))) { await this.persist(ledger => ({ ...ledger, eventsCursor: event.cursor })); return; }
      }
      if (task.status === 'waiting' && task.waitReason === 'clarification' && payload.outcome === 'succeeded') { await this.command({ ...attemptBinding(binding), type: 'finishWaiting', processClosed: true }); await this.persist(ledger => ({ ...ledger, eventsCursor: event.cursor })); return; }
      if (task.status === 'waiting' && task.waitReason === 'overlap') { await this.interruptExact(binding); await this.recordCancellation(binding, 'acknowledged'); await this.persist(ledger => ({ ...ledger, eventsCursor: event.cursor })); return; }
      if (payload.outcome !== 'succeeded') await this.command({ ...attemptBinding(binding), type: 'fail', reason: `Agent attempt ${payload.outcome}` });
      else if (this.unresolved(task.id)) await this.command({ ...attemptBinding(binding), type: 'wait', reason: 'review', attemptFinished: true });
      else await this.command({ ...attemptBinding(binding), type: 'complete', unresolvedDecisions: 0, pendingWrites: 0 });
    }
    if (event.cursor > (this.artifacts?.eventsCursor ?? 0)) await this.persist(ledger => ({ ...ledger, eventsCursor: event.cursor }));
  }
  async disconnect(): Promise<void> {
    this.loopGeneration++;
    clearTimeout(this.pollTimer); clearTimeout(this.heartbeatTimer);
    const client = this.client, token = this.token, repository = this.tasks, scope = this.scope;
    const bindings = repository?.getSnapshot().tasks.filter(task => this.owned.has(task.id) && ['requested', 'working', 'waiting'].includes(task.status) && task.attempts.at(-1)?.status !== 'finished').map(execution) ?? [];
    this.token = null; this.serviceSessionId = null; this.lifetime.abort(); this.started.clear();
    if (this.scope) this.options.repository.agentExecutionLeases?.revokeScope(this.scope);
    this.update({ connection: 'disconnected', activity: undefined });
    try { if (repository && scope) await this.recoverOwned(repository, scope); }
    finally { if (client && token) { await Promise.all(bindings.map(binding => this.requestHostStop(binding, client, token, repository))); await client.disconnect(token).catch(() => {}); } }
  }
  async depart(): Promise<void> {
    if (this.scope) this.options.repository.agentExecutionLeases?.revokeScope(this.scope);
    const held = this.tasks?.getSnapshot().tasks.filter(task => this.owned.has(task.id)).map(task => attemptBinding({ ...execution(task), generation: task.attempts.at(-1)!.generation })) ?? [];
    for (const binding of held) this.options.repository.clearAgentTaskOverlap?.(binding);
    await this.disconnect();
    if (this.tasks && this.scope) await this.recoverOwned(this.tasks, this.scope);
    this.publish();
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.loadGeneration++; this.unsubscribe(); void this.depart().catch(error => this.problem(error)); this.reviewed.dispose(); this.listeners.clear(); }
}

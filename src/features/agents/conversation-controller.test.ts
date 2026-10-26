import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserTaskLeaseRegistry, type TaskStorage } from '@canvas-one/agents';
import type { CollaborationBrowserClient, CollaborationEvent, ExecutionIdentity, BrowserAuthorityRequest } from '@canvas-one/agent-bridge';
import type { StudioRepository } from '../../persistence/studio/types';
import type { SessionController } from '../session/controller';
import { AgentConversationController } from './conversation-controller';
import { prepareAgentTaskAction } from '../../persistence/studio/agent-action-journal';
import type { Document, Element } from '../../domain/studio/model';

const reviewedCalls = vi.hoisted(() => ({ tools: vi.fn(), failNextSubmit: false, beforeAccept: undefined as (() => Promise<void>) | undefined }));
vi.mock('./controller', () => ({ SystemAgentSession: class {
  private proposalsMap = new Map<string, any>();
  reviewer = { actorId: 'human', kind: 'human', displayName: 'Human' };
  proposals = {
    list: () => [...this.proposalsMap.values()],
    pruneTerminal: (_retain: number) => 0,
    restore: (saved: any[]) => { for (const proposal of saved) this.proposalsMap.set(proposal.operationId, proposal); return { ok: true }; },
    submit: (request: any) => { if (reviewedCalls.failNextSubmit) { reviewedCalls.failNextSubmit = false; return { ok: false, issues: [{ message: 'Review limit reached' }] }; } const proposal = { ...request, status: 'pending', issues: [] }; this.proposalsMap.set(proposal.operationId, proposal); return { ok: true, proposal }; },
    preview: (id: string) => this.proposalsMap.get(id),
    accept: async (id: string) => { await reviewedCalls.beforeAccept?.(); const proposal = { ...this.proposalsMap.get(id), status: 'accepted', acceptedBy: this.reviewer, receipt: { status: 'applied' } }; this.proposalsMap.set(id, proposal); return { ok: true, proposal }; },
    reject: (id: string) => { const proposal = { ...this.proposalsMap.get(id), status: 'rejected' }; this.proposalsMap.set(id, proposal); return { ok: true, proposal }; },
  };
  executeReviewedTool(request: any, participant: any) {
    reviewedCalls.tools(request, participant);
    if (request.tool === 'proposal_submit' || request.tool === 'diagram_create') { const proposal = { ...request.input, actor: participant, status: 'pending', issues: [] }; this.proposalsMap.set(proposal.operationId, proposal); return { ok: true, proposal }; }
    return { inspected: true };
  }
  context(selectionOnly: boolean, selection: any) { return { selectionOnly, selection }; }
  dispose() {}
} }));

const controllers: AgentConversationController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); reviewedCalls.tools.mockClear(); reviewedCalls.beforeAccept = undefined; reviewedCalls.failNextSubmit = false; });
function setup(shared?: ReturnType<typeof stores>, options: { main?: boolean; owned?: string[]; recover?: boolean; boardId?: string; document?: Document; enforce?: boolean; selection?: () => { ids: readonly string[]; viewId?: string | null } } = {}) {
  const storage = shared ?? stores(); let now = 0, count = 0;
  const state = { projectId: 'project', branchId: options.main ? 'main' : 'draft', mainBranchId: 'main', workingRevision: 1, needsReload: false, document: options.document ?? { id: options.boardId ?? 'board' } };
  const listeners = new Set<() => void>();
  const scoped = new Map<string, ReturnType<typeof stores>>([[state.branchId, storage]]);
  const scopeStore = (branch: string) => { let value = scoped.get(branch); if (!value) { value = stores(); scoped.set(branch, value); } return value; };
  const session = { getState: () => state, getActor: () => ({ actorId: 'human', kind: 'local-human', displayName: 'Human' }), subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }, applyLiveTaskAction: vi.fn(async () => ({ status: 'applied' })) } as unknown as SessionController;
  const leases = new BrowserTaskLeaseRegistry(() => now, { maxActiveEntries: 32, maxTombstones: 1000 });
  const repository = { createAgentTaskStorage: (scope: { branchId: string }) => scopeStore(scope.branchId).task, createAgentConversationStorage: (scope: { branchId: string }) => scopeStore(scope.branchId).conversation, agentExecutionLeases: leases, holdAgentTaskAction: vi.fn(), clearAgentTaskOverlap: vi.fn(), listAgentTaskActions: vi.fn(async () => []) } as unknown as StudioRepository;
  let queue: BrowserAuthorityRequest[] = [], events: CollaborationEvent[] = []; let requestCount = 0;
  const client = {
    pair: vi.fn(async () => ({ token: 'token', expiresAt: 10000 })), status: vi.fn(async () => ({ sessionId: 'epoch', providers: [{ id: 'claude', available: true, detail: 'Fixture' }, { id: 'codex', available: true, detail: 'Fixture' }], attempts: [] })),
    start: vi.fn(async (_token, input) => ({ lease: { ...input.identity, deadline: now + 15000 }, requestStartedAt: now })),
    requests: vi.fn(async () => queue), events: vi.fn(async (_token, after) => ({ cursor: events.at(-1)?.cursor ?? after, events: events.filter(event => event.cursor > after) })),
    result: vi.fn(async (_token, request, _reply) => { queue = queue.filter(item => item.requestId !== request.requestId); }),
    stop: vi.fn(async (_token: string, _binding: ExecutionIdentity) => ({ fenced: true, cancellation: 'acknowledged' })), disconnect: vi.fn(async () => {}),
    heartbeat: vi.fn(async (_token, binding) => ({ lease: { ...binding, deadline: now + 15000 }, requestStartedAt: now })), send: vi.fn(async () => ({ delivered: true, acknowledged: false })),
  };
  let owned = options.owned ?? [];
  const controller = new AgentConversationController({ session, repository, selection: options.selection, enforceSelectionScope: options.enforce, client: client as unknown as CollaborationBrowserClient, now: () => now, mintId: () => `id-${++count}-${controllers.length}`, leaseMs: 15000, pollMs: 60000, heartbeatMs: 60000, ownership: { load: () => owned, save: ids => { owned = [...ids]; } }, recoverOwnedAfterReload: options.recover }); controllers.push(controller);
  const identity = (): ExecutionIdentity => client.start.mock.calls.at(-1)![1].identity;
  const enqueue = (payload: BrowserAuthorityRequest['payload'], binding = identity()) => { queue.push({ version: 1, requestId: `request-${requestCount++}`, identity: binding, payload }); };
  const emit = (payload: CollaborationEvent['payload'], binding = identity()) => { events.push({ version: 1, cursor: events.length + 1, provider: 'claude', identity: binding, payload }); };
  return { controller, client, session, state, leases, repository, storage, scopeStore, identity, enqueue, emit, setTime: (value: number) => { now = value; }, navigate: (branch = 'other') => { state.branchId = branch; for (const listener of listeners) listener(); } };
}
function stores() {
  let taskRaw: string | null = null, conversationRaw: string | null = null;
  let failConversation = false, taskConflicts = 0;
  const task: TaskStorage = { load: async () => taskRaw, compareAndSwap: async (expected, raw) => { if (taskConflicts > 0) { taskConflicts--; return false; } if ((taskRaw === null ? null : JSON.parse(taskRaw).revision) !== expected) return false; taskRaw = raw; return true; } };
  const conversation = { load: async () => conversationRaw, compareAndSwap: async (expected: number | null, raw: string) => { if (failConversation) throw new Error('Disk failure'); if ((conversationRaw === null ? null : JSON.parse(conversationRaw).revision) !== expected) return false; conversationRaw = raw; return true; } };
  return { task, conversation, taskData: () => taskRaw && JSON.parse(taskRaw), conversationData: () => conversationRaw && JSON.parse(conversationRaw), failConversation: () => { failConversation = true; }, conflictTask: (count: number) => { taskConflicts = count; } };
}
async function connected() { const fixture = setup(); await fixture.controller.ready; await fixture.controller.pair('http://127.0.0.1:47831', 'secret'); return fixture; }
describe('workspace-owned agent conversation authority', () => {
  it('captures an explicit object scope before asynchronous startup and rejects wider proposals and Live actions', async () => {
    const element = (id: string): Element => ({ id, label: id, description: '', visualKind: 'host', ports: [], behavior: { kind: 'unmodeled', version: 1, reason: 'Diagram' } });
    const document: Document = { schema: 'studio-model/1', id: 'board', title: 'Board', elements: [element('a'), element('b')], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [] };
    const fixture = setup(undefined, { document, enforce: true });
    await fixture.controller.ready; await fixture.controller.pair('http://127.0.0.1:47831', 'secret');
    const ids = ['a'];
    const started = fixture.controller.start('claude', 'Rename this', 'edit', undefined, { ids });
    ids[0] = 'b';
    const taskId = await started;
    expect(await fixture.controller.loadStartingContext(taskId)).toMatchObject({ ids: ['a'], writeScopeIds: ['a'] });
    const changes = [{ kind: 'replace', value: { recordKind: 'element', record: { ...document.elements[1], label: 'Outside' } } }];
    fixture.enqueue({ kind: 'tool', data: { requestId: 'outside', tool: 'proposal_submit', input: { operationId: 'outside', scope: { projectId: 'project', branchId: 'draft' }, changes } } });
    await fixture.controller.pollOnce();
    expect(fixture.controller.getState().proposals).toHaveLength(0);
    expect(fixture.client.result.mock.calls.at(-1)?.[2]).toMatchObject({ error: expect.stringContaining('Expand the conversation scope') });
    await fixture.controller.grantLive(taskId, fixture.identity().attemptId);
    fixture.enqueue({ kind: 'tool', data: { requestId: 'outside-live', tool: 'action_submit', input: { operationId: 'outside-live', label: 'Outside', changes, expectedRecords: [] } } });
    await fixture.controller.pollOnce();
    expect(fixture.session.applyLiveTaskAction).not.toHaveBeenCalled();
    fixture.enqueue({ kind: 'tool', data: { requestId: 'inside', tool: 'proposal_submit', input: { operationId: 'inside', scope: { projectId: 'project', branchId: 'draft' }, changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...document.elements[0], label: 'Inside' } } }] } } });
    await fixture.controller.pollOnce();
    expect(fixture.controller.getState().proposals[0]?.proposal.operationId).toBe('inside');
  });
  it('coalesces repeated Read downgrades while process cancellation is still pending', async () => {
    const fixture = await connected(), taskId = await fixture.controller.start('claude', 'Edit');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'coalesce', tool: 'proposal_submit', input: { operationId: 'coalesced-read', scope: { projectId: 'project', branchId: 'draft' }, changes: [] } } });
    await fixture.controller.pollOnce();
    let acknowledge!: () => void;
    fixture.client.stop.mockImplementationOnce(async () => { await new Promise<void>(resolve => { acknowledge = resolve; }); return { fenced: true, cancellation: 'acknowledged' }; });
    const first = fixture.controller.restrictToRead([taskId]), second = fixture.controller.restrictToRead([taskId]);
    while (!acknowledge) await Promise.resolve();
    acknowledge();
    await Promise.all([first, second]);
    expect(fixture.controller.getState().proposals[0]?.proposal.status).toBe('rejected');
    expect(fixture.client.stop).toHaveBeenCalledTimes(1);
  });
  it('revalidates recovered proposals against the durable object scope before accepting', async () => {
    const element = (id: string): Element => ({ id, label: id, description: '', visualKind: 'host', ports: [], behavior: { kind: 'unmodeled', version: 1, reason: 'Diagram' } });
    const document: Document = { schema: 'studio-model/1', id: 'board', title: 'Board', elements: [element('a'), element('b')], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [] };
    // Emulate a pre-boundary stored proposal; recovery must not trust its old admission.
    const old = setup(undefined, { document, selection: () => ({ ids: ['a'] }) });
    await old.controller.ready; await old.controller.pair('http://127.0.0.1:47831', 'secret');
    await old.controller.start('claude', 'Rename a');
    old.enqueue({ kind: 'tool', data: { requestId: 'old-scope', tool: 'proposal_submit', input: { operationId: 'old-outside-scope', scope: { projectId: 'project', branchId: 'draft' }, changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...document.elements[1], label: 'Outside' } } }] } } });
    await old.controller.pollOnce();
    const recovered = setup(old.storage, { document, enforce: true });
    await recovered.controller.ready;
    await expect(recovered.controller.accept('old-outside-scope')).rejects.toThrow('Expand the conversation scope');
    expect(recovered.controller.getState().proposals[0]?.proposal.status).toBe('pending');
  });
  it('attaches a durable request to its thread before provider launch, including failed launches', async () => {
    const fixture = await connected();
    const attached: string[] = [];
    fixture.client.start.mockImplementationOnce(async () => { throw new Error('Provider unavailable'); });
    await expect(fixture.controller.start('claude', 'Explain this context', 'question', async id => {
      expect(fixture.client.start).not.toHaveBeenCalled();
      expect(fixture.storage.conversationData().messages[0].taskId).toBe(id);
      attached.push(id);
    })).rejects.toThrow('Provider unavailable');
    expect(attached).toHaveLength(1);
    expect(fixture.controller.getState().tasks.find(task => task.id === attached[0])?.status).toBe('failed');
  });
  it('does not launch when the thread association cannot be saved', async () => {
    const fixture = await connected();
    await expect(fixture.controller.start('claude', 'Update context', 'edit', async () => { throw new Error('Thread storage failed'); })).rejects.toThrow('Thread storage failed');
    expect(fixture.client.start).not.toHaveBeenCalled();
    expect(fixture.controller.getState().tasks[0]).toMatchObject({ status: 'failed', cancellation: 'acknowledged' });
  });
  it('cannot launch a request downgraded while its thread association is saving', async () => {
    const fixture = await connected();
    await expect(fixture.controller.start('claude', 'Update context', 'edit', async id => {
      await fixture.controller.restrictToRead([id]);
    })).rejects.toThrow('restricted to Read');
    expect(fixture.client.start).not.toHaveBeenCalled();
    expect(fixture.controller.getState().tasks[0]?.status).toBe('stopped');
  });
  it('fences a downgraded thread synchronously before waiting for process cancellation', async () => {
    const fixture = await connected();
    const taskId = await fixture.controller.start('claude', 'Update this object');
    const identity = fixture.identity();
    await fixture.controller.grantLive(taskId, identity.attemptId);
    let acknowledge!: () => void;
    fixture.client.stop.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { acknowledge = resolve; });
      return { fenced: true, cancellation: 'acknowledged' };
    });
    const downgrade = fixture.controller.restrictToRead([taskId]);
    expect(fixture.leases.permits({ taskId, attemptId: identity.attemptId, actorId: identity.actorId, generation: identity.generation, scope: { projectId: identity.projectId, branchId: identity.branchId, boardId: identity.boardId } })).toBe(false);
    await expect(fixture.controller.grantLive(taskId, identity.attemptId)).rejects.toThrow('restricted to Read');
    while (!acknowledge) await Promise.resolve();
    acknowledge();
    await downgrade;
    expect(fixture.controller.getState().tasks.find(task => task.id === taskId)).toMatchObject({ status: 'stopped', permission: 'suggest' });
    await expect(fixture.controller.resume(taskId)).rejects.toThrow('restricted to Read');
    await fixture.controller.start('claude', 'Explain the board', 'question');
    expect(fixture.client.start.mock.calls.at(-1)?.[1].mode).toBe('question');
  });
  it('invalidates a downgraded thread preview and cannot reuse it after returning to Write', async () => {
    const fixture = await connected();
    const taskId = await fixture.controller.start('claude', 'Propose a change');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'read-boundary', tool: 'proposal_submit', input: { operationId: 'read-preview', scope: { projectId: 'project', branchId: 'draft' }, changes: [] } } });
    await fixture.controller.pollOnce();
    expect(fixture.controller.getState().proposals[0]?.proposal.status).toBe('pending');
    await fixture.controller.restrictToRead([taskId]);
    expect(fixture.controller.getState().proposals[0]?.proposal.status).toBe('rejected');
    expect(() => fixture.controller.preview('read-preview')).toThrow('restricted to Read');
    await expect(fixture.controller.accept('read-preview')).rejects.toThrow('restricted to Read');
    await expect(fixture.controller.requestChanges('read-preview', 'Try again')).rejects.toThrow('restricted to Read');
    const next = await fixture.controller.start('claude', 'A new Write request');
    expect(next).not.toBe(taskId);
    expect(fixture.controller.getState().tasks.find(task => task.id === next)?.permission).toBe('suggest');
  });
  it('persists Suggest task/provider/message before execution and preserves independent read-only questions', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Draw flow');
    expect(fixture.controller.getState().tasks[0]).toMatchObject({ id: taskId, providerId: 'claude', permission: 'suggest', status: 'working' });
    expect(fixture.storage.taskData().tasks[0].providerId).toBe('claude'); expect(fixture.storage.conversationData().messages[0].payload.delivery).toBe('delivered');
    await fixture.controller.start('codex', 'Explain the board', 'question'); expect(fixture.controller.getState().tasks).toHaveLength(2);
    expect(fixture.client.start.mock.calls[1]?.[1].mode).toBe('question');
  });
  it('serializes editing starts while allowing an independent question', async () => {
    const fixture = await connected();
    const outcomes = await Promise.allSettled([fixture.controller.start('claude', 'First edit'), fixture.controller.start('codex', 'Duplicate edit')]);
    expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    await expect(fixture.controller.start('claude', 'Another edit')).rejects.toThrow('active editing');
    await fixture.controller.start('codex', 'Question', 'question'); expect(fixture.controller.getState().tasks).toHaveLength(2);
  });
  it('coalesces interleaved text deltas by attempt instead of global message order', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Edit'); const editing = fixture.identity();
    await fixture.controller.start('codex', 'Explain', 'question'); const question = fixture.identity();
    fixture.emit({ kind: 'text', text: 'Hel', format: 'delta' }, editing); fixture.emit({ kind: 'text', text: 'Wor', format: 'delta' }, question);
    fixture.emit({ kind: 'text', text: 'lo', format: 'delta' }, editing); fixture.emit({ kind: 'text', text: 'ld', format: 'delta' }, question);
    await fixture.controller.pollOnce();
    expect(fixture.controller.getState().messages.filter(message => message.role === 'agent').map(message => message.text)).toEqual(['Hello', 'World']);
  });
  it('rejects stale explicit Stop without cancelling the newer attempt', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); const old = fixture.identity();
    vi.mocked(fixture.session.applyLiveTaskAction).mockResolvedValueOnce({ status: 'invalid', issues: [] } as never);
    fixture.enqueue({ kind: 'tool', data: { requestId: 'reject', tool: 'action_submit', input: { operationId: 'invalid', label: 'Invalid', changes: [], expectedRecords: [] } } }); await fixture.controller.pollOnce();
    await fixture.controller.resume(taskId); const current = fixture.identity();
    await expect(fixture.controller.stop(taskId, old.attemptId)).rejects.toThrow('newer attempt');
    expect(fixture.leases.permits({ taskId, attemptId: current.attemptId, actorId: current.actorId, generation: current.generation, scope: { projectId: current.projectId, branchId: current.branchId, boardId: current.boardId } })).toBe(true);
  });
  it('classifies diagnostics and retains successful board feedback across normal task completion', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Inspect');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'inspect', tool: 'board_inspect', input: {} } }); await fixture.controller.pollOnce();
    fixture.emit({ kind: 'diagnostic', code: 'provider-error', message: 'Technical detail' }); await fixture.controller.pollOnce();
    expect(fixture.controller.getState().messages.at(-1)).toMatchObject({ classification: 'diagnostic', role: 'system' });
    fixture.emit({ kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false }); await fixture.controller.pollOnce();
    expect(fixture.controller.getState().tasks[0]?.status).toBe('completed'); expect(fixture.controller.getState().activity?.status).toBe('succeeded');
  });
  it('rejects edits on main without inventing a draft, while questions remain available', async () => {
    const fixture = setup(undefined, { main: true }); await fixture.controller.ready; await fixture.controller.pair('http://127.0.0.1:47831', 'secret');
    await expect(fixture.controller.start('claude', 'Edit')).rejects.toThrow('draft'); expect(fixture.client.start).not.toHaveBeenCalled();
    await fixture.controller.start('claude', 'Question', 'question'); expect(fixture.client.start).toHaveBeenCalledTimes(1);
  });
  it('binds grant dialogs to attempts and closes Stop authority before durable/process cancellation', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); const binding = fixture.identity();
    await expect(fixture.controller.grantLive(taskId, 'foreign')).rejects.toThrow('earlier');
    await fixture.controller.grantLive(taskId, binding.attemptId);
    fixture.client.stop.mockImplementationOnce(async () => { expect(fixture.leases.permits({ taskId, attemptId: binding.attemptId, actorId: binding.actorId, generation: binding.generation, scope: { projectId: binding.projectId, branchId: binding.branchId, boardId: binding.boardId } })).toBe(false); expect(fixture.storage.taskData().tasks[0].status).toBe('stopped'); return { fenced: true, cancellation: 'acknowledged' }; });
    await fixture.controller.stop(taskId); expect(fixture.controller.getState().tasks[0]?.cancellation).toBe('acknowledged');
  });
  it('uses fresh task authority and derives actors from persisted identity rather than tool input', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Edit'); const binding = fixture.identity();
    fixture.enqueue({ kind: 'tool', data: { requestId: 'tool', tool: 'proposal_submit', input: { operationId: 'actor-test', scope: {projectId:'project',branchId:'draft'}, actor: { actorId: 'attacker' } } } }); await fixture.controller.pollOnce();
    expect(reviewedCalls.tools.mock.calls[0]?.[1].actorId).toBe(binding.actorId);
    fixture.setTime(15000); fixture.enqueue({ kind: 'tool', data: { requestId: 'late', tool: 'board_inspect', input: {} } }); await fixture.controller.pollOnce();
    expect(reviewedCalls.tools).toHaveBeenCalledTimes(1); expect(fixture.client.result.mock.calls.at(-1)?.[2]).toHaveProperty('error');
  });
  it('persists proposals before acknowledging tools and records text with its cursor atomically', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Propose');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'tool', tool: 'proposal_submit', input: { operationId: 'proposal', scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 1, label: 'Proposal', changes: [] } } });
    fixture.client.result.mockImplementationOnce(async (_token, request) => { expect(fixture.storage.conversationData().proposals[0].id).toBe('proposal'); expect(fixture.storage.conversationData().proposals[0].taskId).toBe(taskId); });
    fixture.emit({ kind: 'text', text: 'Hello', format: 'delta' }); await fixture.controller.pollOnce();
    const ledger = fixture.storage.conversationData(); expect(ledger.eventsCursor).toBe(1); expect(ledger.messages.at(-1).payload.text).toBe('Hello');
    await fixture.controller.pollOnce(); expect(fixture.controller.getState().messages.at(-1)?.text).toBe('Hello');
  });
  it('closes successful provider turns before review and retains invalid proposals as unresolved', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Propose');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'tool', tool: 'proposal_submit', input: { operationId: 'proposal', scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 1, label: 'Proposal', changes: [] } } }); await fixture.controller.pollOnce();
    fixture.emit({ kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false }); await fixture.controller.pollOnce();
    expect(fixture.client.stop).toHaveBeenCalled(); expect(fixture.controller.getState().tasks[0]).toMatchObject({ status: 'waiting', waitReason: 'review' }); expect(fixture.controller.getState().tasks[0]?.attempts[0]?.status).toBe('finished');
    await fixture.controller.accept('proposal'); expect(fixture.controller.getState().tasks[0]?.status).toBe('completed');
  });
  it('does not revoke other instances on load and recovers only explicitly tab-owned tasks after reload', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit');
    const observer = setup(fixture.storage); await observer.controller.ready; expect(observer.controller.getState().tasks[0]?.status).toBe('working');
    const recovery = setup(fixture.storage, { owned: [taskId], recover: true }); await recovery.controller.ready; expect(recovery.controller.getState().tasks[0]?.status).toBe('interrupted');
    expect(recovery.client.start).not.toHaveBeenCalled();
  });
  it('refuses tool success when artifact durability fails and fences the local board lease', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Propose'); const binding = fixture.identity(); fixture.storage.failConversation();
    fixture.enqueue({ kind: 'tool', data: { requestId: 'tool', tool: 'proposal_submit', input: { operationId: 'proposal', scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 1, label: 'Proposal', changes: [] } } }); await fixture.controller.pollOnce();
    expect(fixture.client.result.mock.calls.at(-1)?.[2]).toHaveProperty('error');
    expect(fixture.leases.permits({ taskId: binding.taskId, attemptId: binding.attemptId, actorId: binding.actorId, generation: binding.generation, scope: { projectId: binding.projectId, branchId: binding.branchId, boardId: binding.boardId } })).toBe(false);
  });
  it('renews startup authority after the authenticated mailbox ACK without reviving it from a stale start ACK', async () => {
    const fixture = await connected(); let finish!: () => void;
    fixture.client.start.mockImplementationOnce(async (_token, input) => {
      fixture.enqueue({ kind: 'authorize', data: { provider: 'claude', mode: 'task' } }, input.identity);
      await new Promise<void>(resolve => { finish = resolve; });
      return { lease: { ...input.identity, deadline: 15000 }, requestStartedAt: 0 };
    });
    const pending = fixture.controller.start('claude', 'Start slowly');
    await vi.waitFor(() => expect(fixture.client.start).toHaveBeenCalled()); await fixture.controller.pollOnce();
    fixture.setTime(5000); await fixture.controller.heartbeatOnce(); finish(); await pending;
    expect(fixture.controller.getState().tasks[0]?.status).toBe('working'); expect(fixture.client.heartbeat).toHaveBeenCalledTimes(1);
  });
  it('records an explicit clarification and resumes the same task with the answer only after actual close', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'clarify', tool: 'clarification_request', input: { questionId: 'question', question: 'Which API?' } } }); await fixture.controller.pollOnce();
    expect(fixture.controller.getState().tasks[0]).toMatchObject({ status: 'waiting', waitReason: 'clarification' });
    fixture.emit({ kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false }); await fixture.controller.pollOnce();
    expect(fixture.controller.getState().tasks[0]?.attempts[0]?.status).toBe('finished');
    await fixture.controller.send(taskId, 'The public API', 'clarification');
    expect(fixture.controller.getState().tasks).toHaveLength(1); expect(fixture.controller.getState().tasks[0]?.attempts).toHaveLength(2);
    expect(fixture.client.start.mock.calls.at(-1)?.[1].prompt).toContain('The public API'); expect(fixture.client.send).not.toHaveBeenCalled();
    expect(fixture.controller.getState().messages.some(message => message.clarificationQuestionId === 'question' && message.role === 'user')).toBe(true);
  });
  it('skips only the held action after cancellation, requires explicit Resume and preserves the conflict history', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); const binding = fixture.identity(); await fixture.controller.grantLive(taskId, binding.attemptId);
    vi.mocked(fixture.session.applyLiveTaskAction).mockResolvedValueOnce({ status: 'failed', code: 'conflict', issues: [] } as never);
    fixture.enqueue({ kind: 'tool', data: { requestId: 'action', tool: 'action_submit', input: { operationId: 'held', label: 'Change', changes: [], expectedRecords: [] } } }); await fixture.controller.pollOnce();
    expect(fixture.controller.getState().tasks[0]?.waitReason).toBe('overlap'); expect(fixture.repository.holdAgentTaskAction).toHaveBeenCalled();
    await expect(fixture.controller.resume(taskId)).rejects.toThrow('Resolve');
    await fixture.controller.resolveOverlap(taskId); expect(fixture.controller.getState().tasks[0]?.status).toBe('interrupted');
    expect(fixture.storage.conversationData().operations.find((entry:any)=>entry.payload.result?.code==='conflict').payload.decision).toBe('skip-and-replan');
    expect(fixture.client.start).toHaveBeenCalledTimes(1); await fixture.controller.resume(taskId);
    expect(fixture.controller.getState().tasks[0]?.permission).toBe('suggest'); expect(fixture.client.start).toHaveBeenCalledTimes(2);
  });
  it('reports empty task Undo without applying or fabricating a board reversal', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); await fixture.controller.stop(taskId); await fixture.controller.undo(taskId);
    expect(fixture.controller.getState().messages.at(-1)?.text).toContain('no remaining'); expect(fixture.session.applyLiveTaskAction).not.toHaveBeenCalled(); expect(fixture.controller.getState().proposals).toHaveLength(0);
  });
  it.each(['stopped', 'failed'] as const)('durably skips an archived held action after the task is %s while disconnected', async status => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); const binding = fixture.identity();
    await fixture.controller.grantLive(taskId, binding.attemptId);
    vi.mocked(fixture.session.applyLiveTaskAction).mockResolvedValueOnce({ status: 'failed', code: 'conflict', issues: [] } as never);
    fixture.enqueue({ kind: 'tool', data: { requestId: 'hold', tool: 'action_submit', input: { operationId: 'archived-held', label: 'Hold', changes: [], expectedRecords: [] } } }); await fixture.controller.pollOnce();
    if (status === 'stopped') await fixture.controller.stop(taskId);
    else {
      vi.mocked(fixture.session.applyLiveTaskAction).mockResolvedValueOnce({ status: 'failed', code: 'invalid', issues: [] } as never);
      fixture.enqueue({ kind: 'tool', data: { requestId: 'invalid', tool: 'action_submit', input: { operationId: 'invalid', label: 'Invalid', changes: [], expectedRecords: [] } } }); await fixture.controller.pollOnce();
    }
    expect(fixture.controller.getState().tasks[0]?.status).toBe(status);
    await fixture.controller.disconnect();
    const ledger = fixture.storage.conversationData(), operation = ledger.operations.find((entry: any) => entry.operationId === 'archived-held');
    await fixture.storage.conversation.compareAndSwap(ledger.revision, JSON.stringify({ ...ledger, revision: ledger.revision + 1, operations: [] }));
    Object.assign(fixture.storage.conversation, { loadOpenOperations: async () => [operation], loadOperation: async () => operation });
    const recovered = setup(fixture.storage); await recovered.controller.ready;
    await recovered.controller.resolveOverlap(taskId);
    expect(recovered.controller.getState().tasks[0]?.status).toBe(status);
    expect(fixture.storage.conversationData().operations[0].payload.decision).toBe('skip-and-replan');
    expect(recovered.repository.clearAgentTaskOverlap).toHaveBeenCalledWith({ taskId, attemptId: binding.attemptId, actorId: binding.actorId, generation: binding.generation, scope: { projectId: binding.projectId, branchId: binding.branchId, boardId: binding.boardId } });
    expect(recovered.controller.getState().blockedActions).toHaveLength(0); expect(recovered.client.start).not.toHaveBeenCalled(); expect(recovered.client.stop).not.toHaveBeenCalled();
  });
  it('blocks Undo before journal reads while an authoring attempt is active', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit');
    await expect(fixture.controller.undo(taskId)).rejects.toThrow('Stop the active authoring');
    expect(fixture.repository.listAgentTaskActions).not.toHaveBeenCalled(); expect(fixture.controller.getState().proposals).toHaveLength(0);
  });
  it('rejects an Undo journal read that finishes after leaving its board', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); await fixture.controller.stop(taskId);
    let finish!: (rows: never[]) => void;
    vi.mocked(fixture.repository.listAgentTaskActions!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = fixture.controller.undo(taskId); fixture.navigate(); finish([]);
    await expect(pending).rejects.toThrow(/board/i);
    expect(fixture.controller.getState().proposals).toEqual([]);
  });
  it('prepares a reviewed Undo for completed changes from a failed task without applying it', async () => {
    const fixture = setup(undefined, { boardId: '00000000-0000-4000-8000-000000000001' }); await fixture.controller.ready; await fixture.controller.pair('http://127.0.0.1:47831', 'secret');
    const taskId = await fixture.controller.start('claude', 'Edit'); const identity = fixture.identity();
    await fixture.controller.grantLive(taskId, identity.attemptId);
    vi.mocked(fixture.session.applyLiveTaskAction).mockResolvedValueOnce({ status: 'failed', code: 'invalid', issues: [] } as never);
    fixture.enqueue({ kind: 'tool', data: { requestId: 'invalid', tool: 'action_submit', input: { operationId: 'invalid', label: 'Invalid', changes: [], expectedRecords: [] } } }); await fixture.controller.pollOnce();
    const original: Element = { id: '00000000-0000-4000-8000-000000000002', label: 'Before', description: '', visualKind: 'host', ports: [], behavior: { kind: 'unmodeled', version: 1, reason: 'Annotation' } }, edited = { ...original, label: 'After' };
    const before: Document = { schema: 'studio-model/1', id: identity.boardId, title: 'Board', elements: [original], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [] }, after = { ...before, elements: [edited] };
    Object.assign(fixture.state, { document: after });
    const row = prepareAgentTaskAction({ binding: { taskId, attemptId: identity.attemptId, actorId: identity.actorId, generation: identity.generation, scope: { projectId: identity.projectId, branchId: identity.branchId, boardId: identity.boardId } }, operationId: 'completed-change', sequence: 1, before, after, changes: [{ kind: 'replace', value: { recordKind: 'element', record: edited } }] });
    vi.mocked(fixture.repository.listAgentTaskActions!).mockResolvedValue([row]); fixture.session.applyLiveTaskAction = vi.fn();
    const [operationId, duplicate] = await Promise.all([fixture.controller.undo(taskId), fixture.controller.undo(taskId)]);
    expect(operationId).toBe(duplicate); expect(await fixture.controller.undo(taskId)).toBe(operationId);
    expect(fixture.controller.getState().proposals).toHaveLength(1);
    expect(fixture.controller.getState().tasks[0]?.status).toBe('failed');
    expect(fixture.controller.getState().proposals[0]?.proposal).toMatchObject({ operationId, status: 'pending', label: 'Review undo', changes: [{ kind: 'replace', value: { recordKind: 'element', record: original } }] });
    expect(fixture.state.document).toEqual(after); expect(fixture.session.applyLiveTaskAction).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fixture.controller.getState().undoableTaskIds).toEqual([taskId]));
    expect(fixture.controller.getState().pendingUndoTaskIds).toEqual([taskId]);
    expect(fixture.storage.conversationData().operations).toContainEqual(expect.objectContaining({ operationId: `host-execution:undo:${operationId}`, payload: expect.objectContaining({ tool: 'host-undo', initiatedBy: expect.objectContaining({ kind: 'human' }) }) }));
    fixture.state.workingRevision = 2; reviewedCalls.failNextSubmit = true;
    await expect(fixture.controller.undo(taskId)).rejects.toThrow('Review limit reached');
    expect(fixture.controller.getState().proposals.find(entry => entry.proposal.operationId === operationId)?.proposal.status).toBe('pending');
    expect(fixture.storage.conversationData().proposals.find((entry: any) => entry.id === operationId).payload.status).toBe('pending');
    const replacement = await fixture.controller.undo(taskId);
    expect(replacement).not.toBe(operationId); expect(fixture.controller.getState().proposals.find(entry => entry.proposal.operationId === operationId)?.proposal.status).toBe('rejected');
    reviewedCalls.beforeAccept = async () => { Object.assign(fixture.state, { document: before, workingRevision: 3 }); };
    await fixture.controller.accept(replacement!);
    await vi.waitFor(() => expect(fixture.controller.getState().undoableTaskIds).toEqual([]));
    expect(fixture.controller.getState().pendingUndoTaskIds).toEqual([]);
  });
  it('shares concurrent Accept work and rejects subsequent terminal acceptance', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Propose');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'tool', tool: 'proposal_submit', input: { operationId: 'proposal', scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 1, label: 'Proposal', changes: [] } } }); await fixture.controller.pollOnce();
    let release!: () => void; const apply = vi.fn(() => new Promise<void>(resolve => { release = resolve; })); reviewedCalls.beforeAccept = apply;
    const first = fixture.controller.accept('proposal'), second = fixture.controller.accept('proposal'); expect(second).toBe(first);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1)); release(); await Promise.all([first, second]);
    await expect(fixture.controller.accept('proposal')).rejects.toThrow('pending proposal'); expect(apply).toHaveBeenCalledTimes(1);
  });
  it.each(['proposal_submit', 'diagram_create'] as const)('rejects reserved normalized Undo labels from %s', async tool => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Propose');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'tool', tool, input: { operationId: 'spoof', scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 1, label: '  Review   UNDO  ', changes: [] } } }); await fixture.controller.pollOnce();
    expect(fixture.controller.getState().proposals).toEqual([]); expect(reviewedCalls.tools).not.toHaveBeenCalled();
    expect(fixture.client.result.mock.calls.at(-1)?.[2]).toMatchObject({ error: expect.stringContaining('reserved') });
  });
  it('rejects ended-task refinement of an ordinary agent proposal', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Propose');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'tool', tool: 'proposal_submit', input: { operationId: 'spoof', scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 1, label: 'Ordinary proposal', changes: [] } } }); await fixture.controller.pollOnce();
    await fixture.controller.stop(taskId);
    await expect(fixture.controller.requestChanges('spoof', 'Change it')).rejects.toThrow('task has ended');
    expect(fixture.controller.getState().pendingUndoTaskIds).toEqual([]);
  });
  it('persists accepting before authored review and preserves its captured board receipt across navigation', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Propose');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'tool', tool: 'proposal_submit', input: { operationId: 'proposal', scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 1, label: 'Proposal', changes: [] } } }); await fixture.controller.pollOnce();
    fixture.emit({ kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false }); await fixture.controller.pollOnce();
    reviewedCalls.beforeAccept = async () => { expect(fixture.storage.conversationData().proposals[0].payload.status).toBe('accepting'); fixture.navigate(); await Promise.resolve(); };
    await fixture.controller.accept('proposal');
    expect(fixture.storage.conversationData().scope.branchId).toBe('draft'); expect(fixture.storage.conversationData().proposals[0].payload.status).toBe('accepted');
    expect(fixture.storage.taskData().tasks[0].status).toBe('completed');
  });
  it('publishes identified tool activity and retains truthful completion without inventing targets from text', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); const activity: unknown[] = [];
    fixture.controller.subscribe(() => { const current = fixture.controller.getState().activity; if (current) activity.push(current); });
    fixture.enqueue({ kind: 'tool', data: { requestId: 'inspect', tool: 'board_inspect', input: {} } }); await fixture.controller.pollOnce();
    expect(activity).toContainEqual(expect.objectContaining({ id: 'request-0', taskId, attemptId: fixture.identity().attemptId, generation: 1, kind: 'reading', targetIds: [], status: 'running' }));
    expect(fixture.controller.getState().activity).toMatchObject({ status: 'succeeded', label: 'Board inspection complete' });
    expect(fixture.controller.getState().activityLog).toHaveLength(1);
    fixture.emit({ kind: 'text', text: 'I might edit fictional-node', format: 'delta' }); await fixture.controller.pollOnce(); expect(fixture.controller.getState().activity?.targetIds).toEqual([]);
    await fixture.controller.stop(taskId); expect(fixture.controller.getState().activity).toBeUndefined();
  });
  it('never lets an older completion clear newer activity or revive activity after Stop', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); await fixture.controller.grantLive(taskId, fixture.identity().attemptId);
    let resolveOld!: (value: never) => void, resolveNew!: (value: never) => void;
    vi.mocked(fixture.session.applyLiveTaskAction).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
    const handler = fixture.controller as unknown as { handleRequest(request: BrowserAuthorityRequest): Promise<void> };
    const request = (id: string): BrowserAuthorityRequest => ({ version: 1, requestId: id, identity: fixture.identity(), payload: { kind: 'tool', data: { requestId: id, tool: 'action_submit', input: { operationId: id, label: 'Change', changes: [], expectedRecords: [] } } } });
    const old = handler.handleRequest(request('old')); await vi.waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    const next = handler.handleRequest(request('new')); await vi.waitFor(() => expect(resolveNew).toBeTypeOf('function'));
    resolveOld({ status: 'applied' } as never); await old;
    expect(fixture.controller.getState().activity).toMatchObject({ id: 'new', status: 'running' });
    await fixture.controller.stop(taskId); resolveNew({ status: 'applied' } as never); await next;
    expect(fixture.controller.getState().activity).toBeUndefined();
    expect(fixture.controller.getState().activityLog?.find(entry => entry.id === 'new')?.status).toBe('failed');
  });
  it('bounds current-session activity and clears it on disconnect', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Inspect');
    for (let index = 0; index < 105; index++) { fixture.enqueue({ kind: 'tool', data: { requestId: `tool-${index}`, tool: 'board_inspect', input: {} } }); await fixture.controller.pollOnce(); }
    expect(fixture.controller.getState().activityLog).toHaveLength(100);
    expect(fixture.controller.getState().activityLog?.[0]?.id).toBe('request-5');
    await fixture.controller.disconnect(); expect(fixture.controller.getState().activityLog).toEqual([]);
  });
  it('does not let an old failed heartbeat interrupt a resumed attempt', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit');
    let rejectHeartbeat!: (reason: Error) => void;
    fixture.client.heartbeat.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectHeartbeat = reject; }));
    const heartbeat = fixture.controller.heartbeatOnce(); await vi.waitFor(() => expect(fixture.client.heartbeat).toHaveBeenCalled());
    vi.mocked(fixture.session.applyLiveTaskAction).mockResolvedValueOnce({ status: 'invalid', issues: [] } as never);
    fixture.enqueue({ kind: 'tool', data: { requestId: 'reject', tool: 'action_submit', input: { operationId: 'invalid', label: 'Invalid', changes: [], expectedRecords: [] } } }); await fixture.controller.pollOnce();
    await fixture.controller.resume(taskId); const resumed = fixture.identity(); rejectHeartbeat(new Error('Old connection failed')); await heartbeat;
    expect(fixture.controller.getState().tasks[0]?.status).toBe('working'); expect(fixture.controller.getState().tasks[0]?.attempts.at(-1)?.id).toBe(resumed.attemptId);
  });
  it('cancels and acknowledges a dispatched process when the post-start transcript save fails', async () => {
    const fixture = await connected(); fixture.client.start.mockImplementationOnce(async (_token, input) => { fixture.storage.failConversation(); return { lease: { ...input.identity, deadline: 15000 }, requestStartedAt: 0 }; });
    await expect(fixture.controller.start('claude', 'Edit')).rejects.toThrow('persistence');
    expect(fixture.client.stop).toHaveBeenCalledTimes(1); expect(fixture.controller.getState().tasks[0]).toMatchObject({ status: 'failed', cancellation: 'acknowledged' });
  });
  it('blocks a late lease begin when Stop lands during launch', async () => {
    const fixture = await connected(); const begin = fixture.leases.begin.bind(fixture.leases); let stopped!: Promise<void>;
    vi.spyOn(fixture.leases, 'begin').mockImplementationOnce((binding, startedAt, leaseMs) => { stopped = fixture.controller.stop(binding.taskId); return begin(binding, startedAt, leaseMs); });
    await expect(fixture.controller.start('claude', 'Edit')).rejects.toThrow(); await stopped;
    expect(fixture.client.start).not.toHaveBeenCalled(); expect(fixture.controller.getState().tasks[0]?.status).toBe('stopped');
  });
  it('advances past unacknowledged cancellation so independent question events remain visible', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Edit'); const edit = fixture.identity(); await fixture.controller.start('codex', 'Explain', 'question'); const question = fixture.identity();
    fixture.client.stop.mockResolvedValueOnce({ fenced: true, cancellation: 'failed' } as never);
    fixture.emit({ kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false }, edit); fixture.emit({ kind: 'text', text: 'Independent answer', format: 'delta' }, question);
    await fixture.controller.pollOnce();
    expect(fixture.controller.getState().tasks[0]).toMatchObject({ status: 'interrupted', cancellation: 'pending' }); expect(fixture.storage.conversationData().eventsCursor).toBe(2); expect(fixture.controller.getState().messages.at(-1)?.text).toBe('Independent answer');
  });
  it('omits provider continuation when process-close cancellation evidence is pending', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); fixture.emit({ kind: 'session', sessionId: 'old-provider-session' }); await fixture.controller.pollOnce();
    fixture.client.stop.mockResolvedValueOnce({ fenced: true, cancellation: 'failed' } as never);
    fixture.emit({ kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false }); await fixture.controller.pollOnce();
    await fixture.controller.resume(taskId); expect(fixture.client.start.mock.calls.at(-1)?.[1]).not.toHaveProperty('providerSessionId');
  });
  it('leaves a reviewed proposal intact when Request Changes is no longer an agent revision', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Propose');
    fixture.enqueue({ kind: 'tool', data: { requestId: 'proposal', tool: 'proposal_submit', input: { operationId: 'proposal', scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 1, label: 'Proposal', changes: [] } } }); await fixture.controller.pollOnce();
    fixture.state.needsReload = true;
    await expect(fixture.controller.requestChanges('proposal', 'Change it')).rejects.toThrow('reload'); expect(fixture.controller.getState().proposals[0]?.proposal.status).toBe('pending'); expect(fixture.client.start).toHaveBeenCalledTimes(1);
  });
  it('reconciles a second navigation during asynchronous board loading and keeps an idle connection', async () => {
    const fixture = await connected(); let finishB!: (value: string | null) => void;
    const loadB = vi.spyOn(fixture.scopeStore('B').conversation, 'load').mockImplementationOnce(() => new Promise(resolve => { finishB = resolve; }));
    const loadC = vi.spyOn(fixture.scopeStore('C').conversation, 'load');
    fixture.navigate('B'); await vi.waitFor(() => expect(loadB).toHaveBeenCalled()); fixture.navigate('C'); finishB(null);
    await vi.waitFor(() => expect(loadC).toHaveBeenCalled()); await vi.waitFor(() => expect(fixture.controller.getState().connection).toBe('connected'));
    await fixture.controller.start('claude', 'Work on C'); expect(fixture.controller.getState().tasks[0]?.scope.branchId).toBe('C'); expect(fixture.storage.taskData()).toBeNull();
  });
  it('does not restart the old heartbeat timer after re-pairing during an in-flight ACK', async () => {
    vi.useFakeTimers();
    try {
      const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); const old = fixture.identity(); let finishHeartbeat!: () => void;
      fixture.client.heartbeat.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finishHeartbeat = resolve; }); return { lease: { ...old, deadline: 15000 }, requestStartedAt: 0 }; });
      await vi.advanceTimersByTimeAsync(60000); expect(fixture.client.heartbeat).toHaveBeenCalledTimes(1);
      await fixture.controller.disconnect(); await fixture.controller.pair('http://127.0.0.1:47831', 'fresh-secret'); await fixture.controller.resume(taskId); finishHeartbeat(); await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60000); expect(fixture.client.heartbeat).toHaveBeenCalledTimes(2);
      fixture.controller.dispose();
    } finally { vi.useRealTimers(); }
  });
  it('clears departure overlap using the original attempt generation and records provider diagnostics', async () => {
    const fixture = await connected(); await fixture.controller.start('claude', 'Edit'); const identity = fixture.identity();
    fixture.emit({ kind: 'diagnostic', code: 'provider-error', message: 'CLI sign-in failed' }); await fixture.controller.pollOnce();
    expect(fixture.controller.getState().messages.at(-1)?.text).toBe('provider-error: CLI sign-in failed');
    await fixture.controller.depart();
    expect(fixture.repository.clearAgentTaskOverlap).toHaveBeenCalledWith(expect.objectContaining({ attemptId: identity.attemptId, generation: identity.generation }));
    expect(fixture.controller.getState().tasks[0]?.generation).toBeGreaterThan(identity.generation);
  });
  it('preserves bounded starting selection through inspection and explicit Resume', async () => {
    let selection = { ids: Array.from({ length: 203 }, (_, index) => 'record-' + index), viewId: 'original-view' };
    const fixture = setup(undefined, { selection: () => selection }); await fixture.controller.ready; await fixture.controller.pair('http://127.0.0.1:47831', 'secret');
    const taskId = await fixture.controller.start('claude', 'Inspect'); selection = { ids: ['new-selection'], viewId: 'new-view' };
    expect(fixture.storage.conversationData().messages[0].payload.startingContext).toMatchObject({ omittedCount: 3, viewId: 'original-view', ids: expect.arrayContaining(['record-0']) });
    fixture.enqueue({ kind: 'tool', data: { requestId: 'inspect-start', tool: 'board_inspect', input: { selectionOnly: true } } }); await fixture.controller.pollOnce();
    const reply = fixture.client.result.mock.calls.at(-1)![2] as any;
    expect(reply.result.selection.ids).toHaveLength(200); expect(reply.result.selection.viewId).toBe('original-view');
    expect(reply.result.task).toMatchObject({ id: taskId, kind: 'edit', permission: 'suggest' });
    await fixture.controller.disconnect(); await fixture.controller.pair('http://127.0.0.1:47831', 'secret'); await fixture.controller.resume(taskId);
    expect(fixture.client.start.mock.calls.at(-1)![1].prompt).toContain('original-view'); expect(fixture.client.start.mock.calls.at(-1)![1].prompt).not.toContain('new-selection');
  });
  it('fences execution on an event gap and preserves artifacts while advancing the same epoch cursor', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); const binding = fixture.identity(); await fixture.controller.grantLive(taskId, binding.attemptId);
    fixture.client.events.mockRejectedValueOnce(Object.assign(new Error('Activity lost'), { code: 'event-gap', gap: { earliestCursor: 9, latestCursor: 12 } }));
    await expect(fixture.controller.pollOnce()).rejects.toThrow('Activity lost');
    expect(fixture.leases.permits({ ...binding, scope: { projectId: binding.projectId, branchId: binding.branchId, boardId: binding.boardId } })).toBe(false);
    expect(fixture.controller.getState().tasks[0]?.status).toBe('interrupted'); expect(fixture.storage.conversationData().eventsCursor).toBe(12);
    expect(fixture.controller.getState().messages.some(message => message.text === 'Edit')).toBe(true);
    expect(fixture.controller.getState().messages.at(-1)?.text).toContain('Resume explicitly'); expect(fixture.client.stop).toHaveBeenCalled();
  });
  it('retries revision conflicts but always requests process cancellation when durable Stop cannot commit', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit');
    fixture.storage.conflictTask(2); await fixture.controller.stop(taskId); expect(fixture.controller.getState().tasks[0]?.status).toBe('stopped');
    const other = await connected(); const otherTask = await other.controller.start('claude', 'Edit'); other.storage.conflictTask(3);
    await expect(other.controller.stop(otherTask)).rejects.toThrow('storage-conflict'); expect(other.client.stop).toHaveBeenCalled();
    expect(other.leases.permits({ ...other.identity(), scope: { projectId:'project',branchId:'draft',boardId:'board' } })).toBe(false);
  });
  it('does not create a stranded requested attempt when Resume is disconnected', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); await fixture.controller.disconnect();
    const generation = fixture.controller.getState().tasks[0]?.generation;
    await expect(fixture.controller.resume(taskId)).rejects.toThrow(); expect(fixture.controller.getState().tasks[0]).toMatchObject({ status:'interrupted',generation });
  });
  it('updates delivery in place while agent replies arrive during feedback delivery', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); let release!:()=>void;
    fixture.client.send.mockImplementationOnce(async()=> { await new Promise<void>(resolve=>{release=resolve;}); return {delivered:true,acknowledged:false}; });
    const sending=fixture.controller.send(taskId,'Feedback'); while (!release) await Promise.resolve();
    fixture.emit({kind:'text',text:'Reply',format:'delta'}); await fixture.controller.pollOnce(); release(); await sending;
    const messages=fixture.controller.getState().messages; expect(messages.at(-2)?.text).toBe('Feedback'); expect(messages.at(-1)?.text).toBe('Reply');
  });
  it('retains a retry obligation when cancellation of a rejected Live action is unacknowledged', async () => {
    const fixture = await connected(); const taskId = await fixture.controller.start('claude', 'Edit'); await fixture.controller.grantLive(taskId,fixture.identity().attemptId);
    (fixture.session.applyLiveTaskAction as any).mockResolvedValueOnce({status:'failed',code:'invalid'});
    fixture.client.stop.mockResolvedValueOnce({fenced:true,cancellation:'failed'} as any);
    fixture.enqueue({kind:'tool',data:{requestId:'rejected',tool:'action_submit',input:{operationId:'rejected',label:'Rejected',changes:[],expectedRecords:[]}}}); await fixture.controller.pollOnce();
    await fixture.controller.heartbeatOnce(); await Promise.resolve(); await Promise.resolve();
    expect(fixture.client.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
  it('uses compacted commit acknowledgements and archived starting context and operation replay', async () => {
    const fixture=setup(undefined,{selection:()=>({ids:['original'],viewId:'view'})}); const storage=fixture.storage.conversation as any;
    const archivedMessages=new Map<string,any>(), archivedOperations=new Map<string,any>();
    storage.commit=async(expected:number|null,next:any)=>{
      for(const entry of next.messages) archivedMessages.set(entry.id,entry);
      for(const entry of next.operations) archivedOperations.set(entry.operationId,entry);
      const compacted={...next,messages:[],operations:[],hasArchivedMessages:true};
      return await storage.compareAndSwap(expected,JSON.stringify(compacted))?compacted:null;
    };
    storage.loadStartingMessage=async(taskId:string)=>[...archivedMessages.values()].find(entry=>entry.taskId===taskId&&entry.payload.startingContext)??null;
    storage.loadOperation=async(operationId:string)=>archivedOperations.get(operationId)??null;
    storage.loadMessagesPage=async()=>({messages:[...archivedMessages.values()],hasMore:false});
    await fixture.controller.ready; await fixture.controller.pair('http://127.0.0.1:47831','secret'); const taskId=await fixture.controller.start('claude','Edit');
    expect(fixture.storage.conversationData().messages).toEqual([]); expect(fixture.client.start.mock.calls[0]![1].prompt).toContain('original');
    const data={requestId:'proposal',tool:'proposal_submit',input:{operationId:'archived-operation',scope:{projectId:'project',branchId:'draft'},changes:[]}};
    fixture.enqueue({kind:'tool',data}); await fixture.controller.pollOnce(); fixture.enqueue({kind:'tool',data:{...data,input:{changes:[],scope:{branchId:'draft',projectId:'project'},operationId:'archived-operation'}}}); await fixture.controller.pollOnce();
    expect(reviewedCalls.tools).toHaveBeenCalledTimes(1); expect(archivedOperations.get('archived-operation').payload.tool).toBe('proposal_submit');
    const diagram={requestId:'diagram',tool:'diagram_create',input:{operationId:'archived-diagram',scope:{projectId:'project',branchId:'draft'},diagram:{elements:[]}}};
    fixture.enqueue({kind:'tool',data:diagram}); await fixture.controller.pollOnce(); fixture.enqueue({kind:'tool',data:diagram}); await fixture.controller.pollOnce();
    expect(reviewedCalls.tools).toHaveBeenCalledTimes(2); expect(archivedOperations.get('archived-diagram').payload.tool).toBe('diagram_create');
    await fixture.controller.loadEarlierMessages(); expect(fixture.controller.getState().messages.some(message=>message.text==='Edit')).toBe(true);
    expect(fixture.controller.getState().hasEarlierMessages).toBe(false);
    await fixture.controller.disconnect();
    const recovered=setup(fixture.storage,{selection:()=>({ids:['changed'],viewId:'new-view'})}); await recovered.controller.ready; await recovered.controller.pair('http://127.0.0.1:47831','secret'); await recovered.controller.resume(taskId);
    expect(recovered.client.start.mock.calls[0]![1].prompt).toContain('original'); expect(recovered.client.start.mock.calls[0]![1].prompt).not.toContain('new-view');
  });
  it('chunks a large provider text event without losing content or replaying its cursor', async () => {
    const fixture=await connected(); await fixture.controller.start('claude','Edit');
    const text='x'.repeat(130000); fixture.emit({kind:'text',text,format:'delta'}); await fixture.controller.pollOnce();
    const messages=fixture.controller.getState().messages.filter(message=>message.role==='agent');
    expect(messages.map(message=>message.text).join('')).toBe(text); expect(messages.every(message=>message.text.length<=64000)).toBe(true);
    expect(fixture.storage.conversationData().eventsCursor).toBe(1); await fixture.controller.pollOnce(); expect(fixture.controller.getState().messages.filter(message=>message.role==='agent')).toHaveLength(3);
  });
  it('saves ownership after task publication and fails requested setup when the first transcript write fails', async () => {
    const fixture=await connected(); const options=(fixture.controller as any).options; const saved:string[][]=[];
    options.ownership.save=(ids:string[])=>saved.push(ids.filter(id=>fixture.controller.getState().tasks.some(task=>task.id===id)));
    fixture.storage.failConversation(); await expect(fixture.controller.start('claude','Edit')).rejects.toThrow();
    expect(saved[0]).toHaveLength(1); expect(fixture.controller.getState().tasks[0]).toMatchObject({status:'failed',cancellation:'acknowledged'}); expect(fixture.client.start).not.toHaveBeenCalled();
  });
  it('rebinds pending Stop to the new bearer only on the same authenticated service instance', async () => {
    const fixture=await connected(); const taskId=await fixture.controller.start('claude','Edit');
    fixture.client.stop.mockImplementation(async(token:any)=>({fenced:true,cancellation:token==='new-token'?'acknowledged':'failed'} as any));
    await fixture.controller.disconnect(); fixture.client.pair.mockResolvedValueOnce({token:'new-token',expiresAt:10000});
    await fixture.controller.pair('http://127.0.0.1:47831','secret'); await fixture.controller.retryStop(taskId);
    expect(fixture.client.stop.mock.calls.some(call=>(call as any)[0]==='new-token')).toBe(true); expect(fixture.controller.getState().tasks[0]?.cancellation).toBe('acknowledged');
    const other=await connected(); const otherTask=await other.controller.start('claude','Edit'); other.client.stop.mockResolvedValue({fenced:true,cancellation:'failed'} as any); await other.controller.disconnect();
    other.client.status.mockResolvedValueOnce({sessionId:'unrelated',providers:[],attempts:[]}); await other.controller.pair('http://127.0.0.1:47832','secret');
    await expect(other.controller.retryStop(otherTask)).rejects.toThrow('original');
  });
  it('continues other heartbeat checks after a task fence persistence failure', async () => {
    const fixture=await connected(); await fixture.controller.start('claude','Edit'); await fixture.controller.start('claude','Question','question');
    fixture.storage.conflictTask(3); fixture.client.heartbeat.mockRejectedValueOnce(new Error('Heartbeat unavailable'));
    await fixture.controller.heartbeatOnce(); expect(fixture.client.heartbeat).toHaveBeenCalledTimes(2); expect(fixture.client.stop).toHaveBeenCalled();
  });
  it('does not complete review while another unresolved proposal is outside the compacted header', async () => {
    const fixture=await connected(); const storage=fixture.storage.conversation as any; const archived=new Map<string,any>();
    storage.commit=async(expected:number|null,next:any)=>{for(const entry of next.proposals)archived.set(entry.id,entry);const compacted={...next,proposals:next.proposals.slice(-1)};return await storage.compareAndSwap(expected,JSON.stringify(compacted))?compacted:null;};
    storage.loadProposal=async(id:string)=>archived.get(id)??null; storage.loadOpenProposals=async()=>[...archived.values()].filter(entry=>!['accepted','rejected'].includes(entry.payload.status));
    const taskId=await fixture.controller.start('claude','Edit');
    for(const operationId of ['older-open','newer-review']) {fixture.enqueue({kind:'tool',data:{requestId:operationId,tool:'proposal_submit',input:{operationId,scope:{projectId:'project',branchId:'draft'},changes:[]}}});await fixture.controller.pollOnce();}
    fixture.emit({kind:'provider-result',outcome:'succeeded',cancellationAcknowledged:false});await fixture.controller.pollOnce();await fixture.controller.accept('newer-review');
    expect(fixture.controller.getState().tasks.find(task=>task.id===taskId)?.status).toBe('waiting');expect(archived.get('older-open').payload.status).toBe('pending');
  });
  it('retains visible messages when a compacted header slides after the last earlier page', async () => {
    const fixture=await connected(); const storage=fixture.storage.conversation as any; const archived=new Map<string,any>();
    storage.commit=async(expected:number|null,next:any)=>{for(const entry of next.messages)archived.set(entry.id,entry);const compacted={...next,messages:next.messages.slice(-1),hasArchivedMessages:true};return await storage.compareAndSwap(expected,JSON.stringify(compacted))?compacted:null;};
    storage.loadMessagesPage=async()=>({messages:[...archived.values()],hasMore:false});
    await fixture.controller.start('claude','Edit');
    fixture.emit({kind:'text',text:'First',format:'message'});await fixture.controller.pollOnce();await fixture.controller.loadEarlierMessages();
    fixture.emit({kind:'text',text:'Second',format:'message'});await fixture.controller.pollOnce();fixture.emit({kind:'text',text:'Third',format:'message'});await fixture.controller.pollOnce();
    expect(fixture.controller.getState().messages.map(message=>message.text)).toEqual(['Edit','First','Second','Third']);
  });
  it('restores exact pending cancellation after reload from trusted host metadata', async () => {
    const fixture=await connected();const taskId=await fixture.controller.start('claude','Edit');const original=fixture.identity();
    const storage=fixture.storage.conversation as any;storage.loadOperation=async(id:string)=>fixture.storage.conversationData().operations.find((entry:any)=>entry.operationId===id)??null;
    fixture.client.stop.mockResolvedValue({fenced:true,cancellation:'failed'});await fixture.controller.disconnect();
    const recovered=setup(fixture.storage,{owned:[taskId]});await recovered.controller.ready;await recovered.controller.pair('http://127.0.0.1:47831','secret');
    for(let tick=0;tick<30&&recovered.controller.getState().tasks[0]?.cancellation!=='acknowledged';tick++)await Promise.resolve();
    expect(recovered.client.stop).toHaveBeenCalledWith('token',original);expect(recovered.controller.getState().tasks[0]?.cancellation).toBe('acknowledged');
  });
  it('recovers and durably resolves a held operation outside the recent header', async () => {
    const fixture=await connected();const taskId=await fixture.controller.start('claude','Edit');await fixture.controller.grantLive(taskId,fixture.identity().attemptId);
    (fixture.session.applyLiveTaskAction as any).mockResolvedValueOnce({status:'failed',code:'conflict'});
    fixture.enqueue({kind:'tool',data:{requestId:'hold',tool:'action_submit',input:{operationId:'held-archive',label:'Hold',changes:[],expectedRecords:[]}}});await fixture.controller.pollOnce();await fixture.controller.disconnect();
    const original=fixture.storage.conversationData();const operation=original.operations.find((entry:any)=>entry.operationId==='held-archive');const storage=fixture.storage.conversation as any;
    await storage.compareAndSwap(original.revision,JSON.stringify({...original,revision:original.revision+1,operations:[]}));
    storage.loadOpenOperations=async()=>[operation];storage.loadOperation=async(id:string)=>id===operation.operationId?operation:null;
    const recovered=setup(fixture.storage);await recovered.controller.ready;await recovered.controller.pair('http://127.0.0.1:47831','secret');
    await expect(recovered.controller.resume(taskId)).rejects.toThrow('Resolve');await recovered.controller.resolveOverlap(taskId);
    expect(fixture.storage.conversationData().operations.find((entry:any)=>entry.operationId==='held-archive').payload.decision).toBe('skip-and-replan');
  });
  it('restores an evicted clarification and answers only its exact finished attempt', async () => {
    const fixture=await connected();const taskId=await fixture.controller.start('claude','Edit');
    fixture.enqueue({kind:'tool',data:{requestId:'question',tool:'clarification_request',input:{questionId:'clarify-archive',question:'Which direction?'}}});await fixture.controller.pollOnce();
    fixture.emit({kind:'provider-result',outcome:'succeeded',cancellationAcknowledged:false});await fixture.controller.pollOnce();
    const current=fixture.storage.conversationData();const question=current.messages.find((entry:any)=>entry.payload.clarificationQuestionId);const first=current.messages.find((entry:any)=>entry.payload.startingContext);const storage=fixture.storage.conversation as any;
    const latest={id:'latest-header',payload:{id:'latest-header',role:'agent',text:'Recent unrelated activity',delivery:'acknowledged'}};
    await storage.compareAndSwap(current.revision,JSON.stringify({...current,revision:current.revision+1,messages:[latest],hasArchivedMessages:true}));
    storage.loadClarificationQuestion=async(id:string,attempt:string)=>id===taskId&&attempt===question.payload.attemptId?question:null;storage.loadStartingMessage=async()=>first;
    storage.loadMessageOrdinal=vi.fn(async(id:string)=>id==='latest-header'?100:5);
    storage.loadMessagesPage=async()=>({messages:[{id:'middle-history',payload:{id:'middle-history',role:'agent',text:'Middle activity',delivery:'acknowledged'}}],before:99,hasMore:false});
    const recovered=setup(fixture.storage);await recovered.controller.ready;expect(recovered.controller.getState().outstandingQuestions?.some(message=>message.text==='Which direction?')).toBe(true);
    await recovered.controller.loadEarlierMessages();expect(storage.loadMessageOrdinal).toHaveBeenCalledWith('latest-header');expect(recovered.controller.getState().messages.some(message=>message.text==='Middle activity')).toBe(true);
    recovered.controller.returnToRecentMessages();expect(recovered.controller.getState().outstandingQuestions?.some(message=>message.text==='Which direction?')).toBe(true);
    await recovered.controller.pair('http://127.0.0.1:47831','secret');await recovered.controller.send(taskId,'Left','clarification');
    expect(recovered.client.start.mock.calls[0]![1].prompt).toContain('clarify-archive: Left');expect(recovered.controller.getState().tasks[0]?.permission).toBe('suggest');
  });
  it('persists ownership for active execution without accumulating completed historical tasks', async () => {
    const fixture=await connected(); const saved:string[][]=[];(fixture.controller as any).options.ownership.save=(ids:string[])=>saved.push([...ids]);
    const oldTask=await fixture.controller.start('claude','First');fixture.emit({kind:'provider-result',outcome:'succeeded',cancellationAcknowledged:false});await fixture.controller.pollOnce();
    const newTask=await fixture.controller.start('claude','Second');expect(saved.at(-1)).toEqual([newTask]);expect(saved.at(-1)).not.toContain(oldTask);
  });
  it('reclaims resumed execution ownership after a new question prunes its finished review marker', async () => {
    const fixture=await connected();const taskId=await fixture.controller.start('claude','Edit');fixture.enqueue({kind:'tool',data:{requestId:'review',tool:'proposal_submit',input:{operationId:'review-owned',scope:{projectId:'project',branchId:'draft'},changes:[]}}});await fixture.controller.pollOnce();
    fixture.emit({kind:'provider-result',outcome:'succeeded',cancellationAcknowledged:false});await fixture.controller.pollOnce();
    await fixture.controller.start('claude','Question','question');await fixture.controller.requestChanges('review-owned','Revise');
    await fixture.controller.disconnect();expect(fixture.controller.getState().tasks.find(task=>task.id===taskId)?.status).toBe('interrupted');
  });
  it('never rebinds a late old startup failure to a newly paired service instance', async () => {
    const fixture=await connected();let reject!: (error:Error)=>void;fixture.client.start.mockImplementationOnce(async()=>await new Promise<any>((_resolve,rejectPromise)=>{reject=rejectPromise;}));
    const launch=fixture.controller.start('claude','Edit').catch(error=>error);while(!reject)await Promise.resolve();
    fixture.client.stop.mockResolvedValue({fenced:true,cancellation:'failed'});fixture.client.pair.mockResolvedValueOnce({token:'other-token',expiresAt:10000});fixture.client.status.mockResolvedValueOnce({sessionId:'other-instance',providers:[],attempts:[]});
    await fixture.controller.pair('http://127.0.0.1:47832','secret');reject(new Error('Old launch failed'));await launch;await fixture.controller.heartbeatOnce();
    expect(fixture.client.stop.mock.calls.some(call=>call[0]==='other-token')).toBe(false);
  });
  it('keeps requested history beyond 2000 messages in an explicit older window and can return to recent', async () => {
    const storage=stores(); const rows=Array.from({length:2200},(_,index)=>({id:'history-'+index,payload:{id:'history-'+index,role:'user',text:'Old '+index,delivery:'acknowledged'}})); const adapter=storage.conversation as any;
    adapter.loadMessageOrdinal=async(id:string)=>rows.findIndex(row=>row.id===id)+1;
    adapter.loadMessagesPage=async(before=2201,limit=100)=>{const available=rows.slice(0,before-1);const messages=available.slice(-limit);return {messages,before:rows.findIndex(row=>row.id===messages[0]?.id)+1,hasMore:available.length>messages.length};};
    await adapter.compareAndSwap(null,JSON.stringify({schema:'canvas-one/conversation/1',scope:{projectId:'project',branchId:'draft',boardId:'board'},revision:0,messages:rows.slice(-64),proposals:[],operations:[],eventsCursor:0,hasArchivedMessages:true}));
    const fixture=setup(storage);await fixture.controller.ready;
    for(let page=0;page<30&&fixture.controller.getState().hasEarlierMessages;page++)await fixture.controller.loadEarlierMessages();
    expect(fixture.controller.getState().messages[0]?.text).toBe('Old 0');expect(fixture.controller.getState().messages).toHaveLength(2064);expect(fixture.controller.getState().historyWindowGap).toBe(true);expect(fixture.controller.getState().hasEarlierMessages).toBe(false);
    fixture.controller.returnToRecentMessages();expect(fixture.controller.getState().messages).toHaveLength(64);expect(fixture.controller.getState().historyWindowGap).toBe(false);
    await fixture.controller.loadEarlierMessages();expect(fixture.controller.getState().messages[0]?.text).toBe('Old 2036');
  });
  it('ignores an earlier page that arrives after Return to recent', async () => {
    const fixture=await connected();await fixture.controller.start('claude','Edit');let resolve!: (value:any)=>void;
    (fixture.storage.conversation as any).loadMessagesPage=async()=>await new Promise(value=>{resolve=value;});
    const paging=fixture.controller.loadEarlierMessages();while(!resolve)await Promise.resolve();fixture.controller.returnToRecentMessages();
    resolve({messages:[{id:'late-page',payload:{id:'late-page',role:'user',text:'Late old page',delivery:'acknowledged'}}],before:1,hasMore:false});
    expect(await paging).toEqual([]);expect(fixture.controller.getState().messages.some(message=>message.text==='Late old page')).toBe(false);expect(fixture.controller.getState().historyWindowGap).toBe(false);
  });
  it('does not label trimmed older recent-mode messages as missing newer history', async () => {
    const fixture=await connected();const adapter=fixture.storage.conversation as any;
    adapter.commit=async(expected:number|null,next:any)=>{const compacted={...next,messages:next.messages.slice(-1),hasArchivedMessages:true};return await adapter.compareAndSwap(expected,JSON.stringify(compacted))?compacted:null;};
    await fixture.controller.start('claude','Edit');
    for(let index=0;index<2001;index++){fixture.emit({kind:'text',text:'Recent '+index,format:'message'});await fixture.controller.pollOnce();}
    expect(fixture.controller.getState().historyWindowGap).toBe(false);expect(fixture.controller.getState().hasEarlierMessages).toBe(true);expect(fixture.controller.getState().messages.at(-1)?.text).toBe('Recent 2000');
  });
  it('keeps a received clarification available after header eviction and Return without reloading', async () => {
    const fixture=await connected();const adapter=fixture.storage.conversation as any;
    adapter.commit=async(expected:number|null,next:any)=>{const compacted={...next,messages:next.messages.slice(-1),hasArchivedMessages:true};return await adapter.compareAndSwap(expected,JSON.stringify(compacted))?compacted:null;};
    const taskId=await fixture.controller.start('claude','Edit');const edit=fixture.identity();
    fixture.enqueue({kind:'tool',data:{requestId:'question',tool:'clarification_request',input:{questionId:'in-session',question:'Where?'}}},edit);await fixture.controller.pollOnce();
    await fixture.controller.start('claude','Independent question','question');fixture.controller.returnToRecentMessages();
    expect(fixture.controller.getState().outstandingQuestions?.some(message=>message.text==='Where?')).toBe(true);
    fixture.emit({kind:'provider-result',outcome:'succeeded',cancellationAcknowledged:false},edit);await fixture.controller.pollOnce();await fixture.controller.send(taskId,'Here','clarification');
    expect(fixture.controller.getState().outstandingQuestions).toEqual([]);
  });
  it('preflights authenticated provider availability before creating or resuming an attempt', async () => {
    const fixture=setup();await fixture.controller.ready;fixture.client.status.mockResolvedValueOnce({sessionId:'epoch',providers:[{id:'claude',available:false,detail:'Claude CLI compatibility blocked'}],attempts:[]});
    await fixture.controller.pair('http://127.0.0.1:47831','secret');
    await expect(fixture.controller.start('claude','Edit')).rejects.toThrow('compatibility blocked');expect(fixture.storage.taskData()?.tasks??[]).toEqual([]);expect(fixture.client.start).not.toHaveBeenCalled();
    await expect(fixture.controller.start('agy','Edit')).rejects.toThrow('authenticated host');
    const resumed=await connected();const taskId=await resumed.controller.start('claude','Edit');await resumed.controller.disconnect();const before=resumed.storage.taskData();
    resumed.client.status.mockResolvedValueOnce({sessionId:'epoch',providers:[{id:'claude',available:false,detail:'Sign-in unavailable'}],attempts:[]});await resumed.controller.pair('http://127.0.0.1:47831','secret');
    await expect(resumed.controller.resume(taskId)).rejects.toThrow('Sign-in unavailable');expect(resumed.storage.taskData()).toEqual(before);expect(resumed.client.start).toHaveBeenCalledTimes(1);
  });
});

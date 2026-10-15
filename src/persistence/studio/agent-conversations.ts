import type { TaskScope } from '@canvas-one/agents';
import type { StudioDatabase } from './db';
import { Dexie } from 'dexie';
import type { AgentConversationRecord, AgentConversationArchiveRecord } from './types';

export type ConversationJson = null | boolean | number | string | readonly ConversationJson[] | { readonly [key: string]: ConversationJson };
export type ConversationArtifact = { readonly id: string; readonly taskId?: string; readonly payload: ConversationJson };
export type ConversationOperation = { readonly taskId: string; readonly operationId: string; readonly payload: ConversationJson };
export type ConversationLedger = {
  readonly schema: 'canvas-one/conversation/1';
  readonly scope: TaskScope;
  readonly revision: number;
  readonly messages: readonly ConversationArtifact[];
  readonly proposals: readonly ConversationArtifact[];
  readonly operations: readonly ConversationOperation[];
  readonly eventsCursor: number;
  readonly eventsSessionId?: string;
  readonly archiveOrdinal?: number;
  readonly hasArchivedMessages?: boolean;
};
export interface AgentConversationStorage {
  load(): Promise<string | null>;
  compareAndSwap(expectedRevision: number | null, serializedConversation: string): Promise<boolean>;
  commit?(expectedRevision: number | null, next: ConversationLedger): Promise<ConversationLedger | null>;
  loadStartingMessage?(taskId: string): Promise<ConversationArtifact | null>;
  loadOpenProposals?(): Promise<readonly ConversationArtifact[]>;
  loadTaskProposals?(taskId: string): Promise<readonly ConversationArtifact[]>;
  loadProposal?(operationId: string): Promise<ConversationArtifact | null>;
  loadOperation?(operationId: string): Promise<ConversationOperation | null>;
  loadOpenOperations?(): Promise<readonly ConversationOperation[]>;
  loadClarificationQuestion?(taskId: string, attemptId: string): Promise<ConversationArtifact | null>;
  loadMessageOrdinal?(messageId: string): Promise<number | null>;
  loadMessagesPage?(before?: number, limit?: number): Promise<{ readonly messages: readonly ConversationArtifact[]; readonly before?: number; readonly hasMore: boolean }>;
}
export const MAX_CONVERSATION_BYTES = 1024 * 1024;
export const MAX_CONVERSATION_CANDIDATE_BYTES = 32 * MAX_CONVERSATION_BYTES;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const scopeValid = (value: unknown): value is TaskScope => object(value) && keys(value, ['projectId', 'branchId', 'boardId']) && text(value.projectId) && text(value.branchId) && text(value.boardId);
const sameScope = (a: TaskScope, b: TaskScope) => a.projectId === b.projectId && a.branchId === b.branchId && a.boardId === b.boardId;
export function agentConversationKey(scope: TaskScope): string {
  if (!scopeValid(scope)) throw new TypeError('Invalid conversation scope');
  return JSON.stringify(['canvas-one/conversation/1', scope.projectId, scope.branchId, scope.boardId]);
}
export const emptyConversationLedger = (scope: TaskScope): ConversationLedger => {
  agentConversationKey(scope);
  return { schema: 'canvas-one/conversation/1', scope: { ...scope }, revision: 0, messages: [], proposals: [], operations: [], eventsCursor: 0 };
};

/** Parsed JSON is still bounded by depth, finite numbers and total encoded size. */
function json(value: unknown, depth = 0): boolean {
  if (depth > 100) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => json(item, depth + 1));
  return object(value) && Object.values(value).every(item => json(item, depth + 1));
}
function artifacts(value: unknown, maximum: number): boolean {
  if (!Array.isArray(value) || value.length > maximum) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!object(item) || !keys(item, ['id', 'taskId', 'payload']) || !text(item.id) || ids.has(item.id) || item.taskId !== undefined && !text(item.taskId) || !('payload' in item) || !json(item.payload)) return false;
    ids.add(item.id); return true;
  });
}
function parseLedger(serialized: string, candidate = false): ConversationLedger | null {
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).byteLength > (candidate ? MAX_CONVERSATION_CANDIDATE_BYTES : MAX_CONVERSATION_BYTES)) return null;
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { return null; }
  if (!object(value) || !keys(value, ['schema', 'scope', 'revision', 'messages', 'proposals', 'operations', 'eventsCursor', 'eventsSessionId', 'archiveOrdinal', 'hasArchivedMessages']) || value.schema !== 'canvas-one/conversation/1' || !scopeValid(value.scope) || !integer(value.revision) || !integer(value.eventsCursor) || value.eventsSessionId !== undefined && !text(value.eventsSessionId) || value.archiveOrdinal !== undefined && !integer(value.archiveOrdinal) || value.hasArchivedMessages !== undefined && typeof value.hasArchivedMessages !== 'boolean' || !artifacts(value.messages, candidate ? 1001 : 1000) || !artifacts(value.proposals, 200) || !Array.isArray(value.operations) || value.operations.length > (candidate ? 2001 : 2000)) return null;
  const operations = new Set<string>();
  for (const operation of value.operations) {
    if (!object(operation) || !keys(operation, ['taskId', 'operationId', 'payload']) || !text(operation.taskId) || !text(operation.operationId) || operations.has(operation.operationId) || !('payload' in operation) || !json(operation.payload)) return null;
    operations.add(operation.operationId);
  }
  return value as unknown as ConversationLedger;
}
export function parseConversationLedger(serialized: string): ConversationLedger | null { return parseLedger(serialized); }
function plain(value: unknown, depth = 0): boolean {
  if (depth > 100) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return Object.keys(value).length === value.length && value.every(item => plain(item, depth + 1));
  return object(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) && Object.values(value).every(item => plain(item, depth + 1));
}
export function serializeConversationLedger(ledger: ConversationLedger): string {
  // Reject lossy serialization (undefined, non-finite numbers, functions and unsupported objects).
  if (!plain(ledger)) throw new TypeError('Conversation must contain plain JSON');
  const serialized = JSON.stringify(ledger);
  if (!parseConversationLedger(serialized)) throw new TypeError('Invalid conversation ledger');
  return serialized;
}

type ArchiveKind = AgentConversationArchiveRecord['kind'];
const archiveKey = (scopeKey: string, kind: ArchiveKind, id: string) => JSON.stringify(['canvas-one/conversation-archive/1', scopeKey, kind, id]);
const proposalState = (artifact: ConversationArtifact): 'open' | 'closed' => object(artifact.payload) && ['accepted', 'rejected'].includes(String(artifact.payload.status)) ? 'closed' : 'open';
const operationState = (operation: ConversationOperation): 'open' | 'closed' => object(operation.payload) && object(operation.payload.result) && operation.payload.result.code === 'conflict' && operation.payload.decision !== 'skip-and-replan' ? 'open' : 'closed';
const clarificationId = (taskId: string, attemptId: string) => JSON.stringify([taskId, attemptId]);

/** CAS never changes authored content, preferences, or the separate task authority ledger. */
export class StudioConversationStorage implements AgentConversationStorage {
  readonly key: string;
  private readonly scope: TaskScope;
  constructor(private readonly db: StudioDatabase, scope: TaskScope) {
    this.key = agentConversationKey(scope); this.scope = Object.freeze({ ...scope });
  }
  private ledger(serialized: unknown): ConversationLedger {
    const ledger = typeof serialized === 'string' ? parseConversationLedger(serialized) : null;
    if (!ledger || !sameScope(ledger.scope, this.scope)) throw new TypeError('Invalid or cross-board conversation');
    return ledger;
  }
  private row(row: AgentConversationRecord): ConversationLedger {
    if (!row || row.key !== this.key || !integer(row.revision)) throw new TypeError('Invalid conversation row');
    const ledger = this.ledger(row.serializedConversation);
    if (ledger.revision !== row.revision) throw new TypeError('Conversation revision mismatch');
    return ledger;
  }
  async load(): Promise<string | null> {
    return this.db.transaction('r', this.db.agentConversations, async () => {
      const row = await this.db.agentConversations.get(this.key);
      if (!row) return null;
      this.row(row); return row.serializedConversation;
    });
  }
  async compareAndSwap(expectedRevision: number | null, serializedConversation: string): Promise<boolean> {
    if (expectedRevision !== null && !integer(expectedRevision)) throw new TypeError('Invalid expected conversation revision');
    const next = this.ledger(serializedConversation);
    if (next.revision <= (expectedRevision ?? 0)) return false;
    return this.db.transaction('rw', this.db.agentConversations, async () => {
      const row = await this.db.agentConversations.get(this.key);
      const current = row ? this.row(row) : null;
      if (current ? expectedRevision === null || current.revision !== expectedRevision : expectedRevision !== null) return false;
      if (current && next.eventsCursor < current.eventsCursor && (!next.eventsSessionId || next.eventsSessionId === current.eventsSessionId)) throw new TypeError('Conversation cursor cannot regress within a service session');
      if (next.archiveOrdinal !== current?.archiveOrdinal || current?.hasArchivedMessages === true && next.hasArchivedMessages !== true) throw new TypeError('Archived conversation metadata must be retained');
      await this.db.agentConversations.put({ key: this.key, revision: next.revision, serializedConversation });
      return true;
    });
  }
  private archiveRow(row: AgentConversationArchiveRecord): AgentConversationArchiveRecord {
    if (!row || row.scopeKey !== this.key || (row.kind === 'clarification' ? typeof row.id !== 'string' || row.id.length > 2500 : !text(row.id)) || !['message', 'proposal', 'operation', 'context', 'clarification'].includes(row.kind) || row.key !== archiveKey(this.key, row.kind, row.id) || !integer(row.ordinal) || row.ordinal === 0 || !['open', 'closed'].includes(row.state) || row.taskId !== undefined && !text(row.taskId) || !plain(row.artifact)) throw new TypeError('Invalid conversation archive row');
    if (row.kind === 'operation') {
      const operation = row.artifact as ConversationOperation;
      if (!object(operation) || !keys(operation, ['taskId', 'operationId', 'payload']) || !text(operation.taskId) || operation.taskId !== row.taskId || operation.operationId !== row.id || !('payload' in operation) || !json(operation.payload) || row.state !== operationState(operation)) throw new TypeError('Invalid archived operation');
    } else {
      const artifact = row.artifact as ConversationArtifact;
      if (!artifacts([artifact], 1) || artifact.taskId !== row.taskId || !['context', 'clarification'].includes(row.kind) && artifact.id !== row.id || row.kind === 'context' && (!row.taskId || row.id !== row.taskId || !object(artifact.payload) || artifact.payload.role !== 'user' || !object(artifact.payload.startingContext)) || row.kind === 'clarification' && (!row.taskId || !object(artifact.payload) || artifact.payload.role !== 'agent' || !text(artifact.payload.attemptId) || !text(artifact.payload.clarificationQuestionId) || row.id !== clarificationId(row.taskId, artifact.payload.attemptId)) || row.state !== (row.kind === 'proposal' ? proposalState(artifact) : 'closed')) throw new TypeError('Invalid archived artifact');
    }
    if (new TextEncoder().encode(JSON.stringify(row.artifact)).byteLength > MAX_CONVERSATION_CANDIDATE_BYTES) throw new TypeError('Archived artifact exceeds its bound');
    return row;
  }
  async commit(expectedRevision: number | null, next: ConversationLedger): Promise<ConversationLedger | null> {
    if (expectedRevision !== null && !integer(expectedRevision)) throw new TypeError('Invalid expected conversation revision');
    if (!plain(next)) throw new TypeError('Conversation must contain plain JSON');
    const candidate = parseLedger(JSON.stringify(next), true);
    if (!candidate || !sameScope(candidate.scope, this.scope)) throw new TypeError('Invalid or cross-board conversation candidate');
    if (candidate.revision <= (expectedRevision ?? 0)) return null;
    return this.db.transaction('rw', this.db.agentConversations, this.db.agentConversationArchive, async () => {
      const header = await this.db.agentConversations.get(this.key);
      const current = header ? this.row(header) : null;
      if (current ? expectedRevision === null || current.revision !== expectedRevision : expectedRevision !== null) return null;
      if (current && candidate.eventsCursor < current.eventsCursor && (!candidate.eventsSessionId || candidate.eventsSessionId === current.eventsSessionId)) throw new TypeError('Conversation cursor cannot regress within a service session');
      let ordinal = current?.archiveOrdinal ?? 0;
      const saved = new Map<string, AgentConversationArchiveRecord>();
      // The first archive commit also captures an existing version3 header before pruning it.
      const incomingByKey = new Map<string, { kind: ArchiveKind; id: string; artifact: ConversationArtifact | ConversationOperation }>();
      for (const ledger of [current, candidate]) if (ledger) {
        for (const artifact of ledger.messages) incomingByKey.set(archiveKey(this.key, 'message', artifact.id), { kind: 'message', id: artifact.id, artifact });
        for (const artifact of ledger.proposals) incomingByKey.set(archiveKey(this.key, 'proposal', artifact.id), { kind: 'proposal', id: artifact.id, artifact });
        for (const artifact of ledger.operations) incomingByKey.set(archiveKey(this.key, 'operation', artifact.operationId), { kind: 'operation', id: artifact.operationId, artifact });
      }
      const incoming = [...incomingByKey.values()];
      const archive = async (kind: ArchiveKind, id: string, artifact: ConversationArtifact | ConversationOperation) => {
        const key = archiveKey(this.key, kind, id);
        const stored = saved.get(key) ?? await this.db.agentConversationArchive.get(key);
        const previous = stored ? this.archiveRow(stored) : undefined;
        if (previous && (previous.ordinal > (current?.archiveOrdinal ?? 0) && !saved.has(key) || previous.taskId !== artifact.taskId)) throw new TypeError('Archived identity or ordinal changed');
        if (kind === 'context' && previous) {
          const before = previous.artifact as ConversationArtifact;
          if (before.id !== (artifact as ConversationArtifact).id) return previous;
          if (!object(before.payload) || !object(artifact.payload) || JSON.stringify(before.payload.startingContext) !== JSON.stringify(artifact.payload.startingContext)) throw new TypeError('Starting context cannot change');
        }
        if (kind === 'clarification' && previous) {
          const before = previous.artifact as ConversationArtifact;
          const previousMessage = saved.get(archiveKey(this.key, 'message', before.id)) ?? await this.db.agentConversationArchive.get(archiveKey(this.key, 'message', before.id));
          const incomingMessage = saved.get(archiveKey(this.key, 'message', (artifact as ConversationArtifact).id));
          if (previousMessage && incomingMessage && previousMessage.ordinal > incomingMessage.ordinal) return previous;
        }
        if (!previous && ordinal === Number.MAX_SAFE_INTEGER) throw new TypeError('Conversation ordinal exhausted');
        const row: AgentConversationArchiveRecord = { key, scopeKey: this.key, id, ...(artifact.taskId ? { taskId: artifact.taskId } : {}), kind, state: kind === 'proposal' ? proposalState(artifact as ConversationArtifact) : kind === 'operation' ? operationState(artifact as ConversationOperation) : 'closed', ordinal: previous?.ordinal ?? ++ordinal, artifact };
        this.archiveRow(row); saved.set(key, row); return row;
      };
      for (const entry of incoming) {
        await archive(entry.kind, entry.id, entry.artifact);
        if (entry.kind === 'message' && entry.artifact.taskId && object(entry.artifact.payload) && entry.artifact.payload.role === 'user' && object(entry.artifact.payload.startingContext)) await archive('context', entry.artifact.taskId, entry.artifact);
        if (entry.kind === 'message' && entry.artifact.taskId && object(entry.artifact.payload) && entry.artifact.payload.role === 'agent' && text(entry.artifact.payload.attemptId) && text(entry.artifact.payload.clarificationQuestionId)) await archive('clarification', clarificationId(entry.artifact.taskId, entry.artifact.payload.attemptId), entry.artifact);
      }
      if (saved.size) await this.db.agentConversationArchive.bulkPut([...saved.values()]);
      if (await this.db.agentConversationArchive.where('[scopeKey+kind+state]').equals([this.key, 'proposal', 'open']).count() > 200) throw new TypeError('Resolve outstanding proposals before adding another');
      if (await this.db.agentConversationArchive.where('[scopeKey+kind+state]').equals([this.key, 'operation', 'open']).count() > 200) throw new TypeError('Resolve held actions before adding another');
      const ordered = <T extends ConversationArtifact | ConversationOperation>(kind: ArchiveKind, values: readonly T[], maximum: number): T[] => [...values].sort((a, b) => saved.get(archiveKey(this.key, kind, 'operationId' in a ? a.operationId : a.id))!.ordinal - saved.get(archiveKey(this.key, kind, 'operationId' in b ? b.operationId : b.id))!.ordinal).slice(-maximum);
      const messages = ordered('message', candidate.messages, 64), proposals = ordered('proposal', candidate.proposals, 20), operations = ordered('operation', candidate.operations, 64);
      const notices: ConversationArtifact[] = [];
      for (const [kind, values] of [['message', messages], ['proposal', proposals], ['operation', operations]] as const) {
        for (let index = values.length - 1; index >= 0; index -= 1) {
          const artifact = values[index];
          if (new TextEncoder().encode(JSON.stringify(artifact)).byteLength <= MAX_CONVERSATION_BYTES - 4096) continue;
          const artifactId = 'operationId' in artifact ? artifact.operationId : artifact.id;
          const savedOrdinal = saved.get(archiveKey(this.key, kind, artifactId))!.ordinal;
          let noticeId = `archive-notice-${candidate.revision}-${savedOrdinal}`, suffix = 0;
          while (candidate.messages.some(message => message.id === noticeId) || await this.db.agentConversationArchive.get(archiveKey(this.key, 'message', noticeId))) noticeId = `archive-notice-${candidate.revision}-${savedOrdinal}-${++suffix}`;
          notices.push({ id: noticeId, ...(artifact.taskId ? { taskId: artifact.taskId } : {}), payload: { id: noticeId, role: 'system', text: `The full ${kind} ${artifactId} is saved in task history; its content is too large for the recent conversation view.`, delivery: 'acknowledged' } });
          values.splice(index, 1);
        }
      }
      messages.push(...notices);
      const archivedMessageCount = await this.db.agentConversationArchive.where('[scopeKey+kind+state]').equals([this.key, 'message', 'closed']).count();
      let compacted: ConversationLedger = { ...candidate, archiveOrdinal: ordinal, hasArchivedMessages: current?.hasArchivedMessages === true || archivedMessageCount > candidate.messages.length || candidate.messages.length > messages.length || notices.length > 0, messages, proposals, operations };
      let serialized = JSON.stringify(compacted);
      while (new TextEncoder().encode(serialized).byteLength > MAX_CONVERSATION_BYTES) {
        const pools = [messages, proposals, operations];
        const pool = pools.find(values => values.length > 1) ?? pools.find(values => values.length > 0);
        if (!pool) throw new TypeError('Conversation metadata exceeds its header bound');
        if (pool === messages) compacted = { ...compacted, hasArchivedMessages: true };
        pool.shift(); serialized = JSON.stringify(compacted);
      }
      if (!parseConversationLedger(serialized)) throw new TypeError('Invalid compacted conversation header');
      await this.db.agentConversations.put({ key: this.key, revision: compacted.revision, serializedConversation: serialized });
      return compacted;
    });
  }
  private async archived(kind: ArchiveKind, id: string): Promise<AgentConversationArchiveRecord | null> {
    if (kind === 'clarification' ? typeof id !== 'string' || id.length > 2500 : !text(id)) throw new TypeError('Invalid archive identity');
    const row = await this.db.agentConversationArchive.get(archiveKey(this.key, kind, id));
    return row ? this.archiveRow(row) : null;
  }
  async loadStartingMessage(taskId: string): Promise<ConversationArtifact | null> { return (await this.archived('context', taskId))?.artifact as ConversationArtifact ?? null; }
  async loadProposal(operationId: string): Promise<ConversationArtifact | null> { return (await this.archived('proposal', operationId))?.artifact as ConversationArtifact ?? null; }
  async loadOperation(operationId: string): Promise<ConversationOperation | null> { return (await this.archived('operation', operationId))?.artifact as ConversationOperation ?? null; }
  async loadMessageOrdinal(messageId: string): Promise<number | null> { return (await this.archived('message', messageId))?.ordinal ?? null; }
  async loadClarificationQuestion(taskId: string, attemptId: string): Promise<ConversationArtifact | null> {
    if (!text(taskId) || !text(attemptId)) throw new TypeError('Invalid clarification identity');
    return (await this.archived('clarification', clarificationId(taskId, attemptId)))?.artifact as ConversationArtifact ?? null;
  }
  async loadOpenOperations(): Promise<readonly ConversationOperation[]> {
    const rows = await this.db.agentConversationArchive.where('[scopeKey+kind+state]').equals([this.key, 'operation', 'open']).limit(201).toArray();
    if (rows.length > 200) throw new TypeError('Held action archive exceeds its bound');
    return rows.map(row => this.archiveRow(row).artifact as ConversationOperation);
  }
  async loadOpenProposals(): Promise<readonly ConversationArtifact[]> {
    const rows = await this.db.agentConversationArchive.where('[scopeKey+kind+state]').equals([this.key, 'proposal', 'open']).limit(201).toArray();
    if (rows.length > 200) throw new TypeError('Outstanding proposal archive exceeds its bound');
    return rows.map(row => this.archiveRow(row).artifact as ConversationArtifact);
  }
  async loadTaskProposals(taskId: string): Promise<readonly ConversationArtifact[]> {
    if (!text(taskId)) throw new TypeError('Invalid task identity');
    const rows = await this.db.agentConversationArchive.where('[scopeKey+taskId+kind+ordinal]').between([this.key, taskId, 'proposal', Dexie.minKey], [this.key, taskId, 'proposal', Dexie.maxKey]).reverse().limit(100).toArray();
    return rows.reverse().map(row => this.archiveRow(row).artifact as ConversationArtifact);
  }
  async loadMessagesPage(before?: number, limit = 100): Promise<{ readonly messages: readonly ConversationArtifact[]; readonly before?: number; readonly hasMore: boolean }> {
    if (before !== undefined && (!integer(before) || before === 0) || !integer(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid conversation page');
    const rows = await this.db.agentConversationArchive.where('[scopeKey+kind+ordinal]').between([this.key, 'message', Dexie.minKey], [this.key, 'message', before ?? Dexie.maxKey], true, before === undefined).reverse().limit(limit + 1).toArray();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse().map(row => this.archiveRow(row));
    return { messages: page.map(row => row.artifact as ConversationArtifact), ...(hasMore && page[0] ? { before: page[0].ordinal } : {}), hasMore };
  }
}

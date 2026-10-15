import type { AttemptBinding } from '@canvas-one/agents';
import { insertImmutable, type TransactionStores } from '@canvas-one/storage';
import type { Document } from '../../domain/studio/model';
import type { EditableRecord, RecordChange, RecordKind } from '../../domain/studio/records';
import { canonicalJson } from '../../domain/studio/canonical';
import { applyRecordChanges } from './apply-records';
import type { Issue } from '../../domain/studio/validate';
import type { LiveTaskTarget } from '@canvas-one/system-design/session/contracts';

export type AgentTaskActionRecord = {
  readonly schema: 'canvas-one/task-action/1'; readonly key: string;
  readonly projectId: string; readonly branchId: string; readonly boardId: string;
  readonly taskId: string; readonly operationId: string; readonly binding: AttemptBinding;
  /** Authoritative branch revision produced by this action, never an agent-provided timestamp. */
  readonly sequence: number;
  readonly targets: readonly { readonly recordKind: RecordKind; readonly id: string; readonly before: EditableRecord | null; readonly after: EditableRecord | null }[];
};
type JournalRows = { agentTaskActions: AgentTaskActionRecord };
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const collections = { element: 'elements', connection: 'connections', relation: 'relations', schema: 'schemas', fixture: 'fixtures', refinement: 'refinements', scenario: 'scenarios', view: 'views' } as const;
function equal(left: unknown, right: unknown): boolean { const a = canonicalJson(left), b = canonicalJson(right); return a.ok && b.ok && a.text === b.text; }
function find(document: Document, kind: RecordKind, id: string): EditableRecord | null {
  const record = document[collections[kind]].find(value => value.id === id);
  return record ? { recordKind: kind, record } as EditableRecord : null;
}
export function agentTaskActionKey(projectId: string, operationId: string): string {
  if (!text(projectId) || !text(operationId)) throw new TypeError('Invalid task action identity');
  return JSON.stringify(['canvas-one/task-action/1', projectId, operationId]);
}
/** Validate durable metadata before using it to derive a reversal; corruption must not become authority. */
export function isAgentTaskActionRecord(value: unknown): value is AgentTaskActionRecord {
  if (!object(value) || value.schema !== 'canvas-one/task-action/1' || !text(value.projectId) || !text(value.branchId) || !text(value.boardId) || !text(value.taskId) || !text(value.operationId) || value.key !== agentTaskActionKey(value.projectId, value.operationId) || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return false;
  const binding = value.binding;
  if (!object(binding) || !object(binding.scope) || binding.taskId !== value.taskId || !text(binding.actorId) || !text(binding.attemptId) || !Number.isSafeInteger(binding.generation) || (binding.generation as number) < 1 || binding.scope.projectId !== value.projectId || binding.scope.branchId !== value.branchId || binding.scope.boardId !== value.boardId) return false;
  if (!Array.isArray(value.targets) || value.targets.length === 0 || value.targets.length > 1000) return false;
  const seen = new Set<string>();
  for (const target of value.targets) {
    if (!object(target) || !text(target.id) || typeof target.recordKind !== 'string' || !Object.hasOwn(collections, target.recordKind)) return false;
    const key = JSON.stringify([target.recordKind, target.id]);
    if (seen.has(key) || target.before === null && target.after === null) return false;
    seen.add(key);
    for (const record of [target.before, target.after]) if (record !== null && (!object(record) || record.recordKind !== target.recordKind || !object(record.record) || record.record.id !== target.id)) return false;
  }
  return canonicalJson(value).ok;
}
/** Prepare from host-owned before/after snapshots before starting its atomic transaction. */
export function prepareAgentTaskAction(input: { readonly binding: AttemptBinding; readonly operationId: string; readonly sequence: number; readonly before: Document; readonly after: Document; readonly changes: readonly RecordChange[] }): AgentTaskActionRecord {
  const { binding } = input;
  if (input.before.id !== binding.scope.boardId || input.after.id !== binding.scope.boardId) throw new TypeError('Task action board mismatch');
  const targets = input.changes.map(change => {
    const recordKind = change.kind === 'remove' ? change.recordKind : change.value.recordKind;
    const id = change.kind === 'remove' ? change.id : change.value.record.id;
    return { recordKind, id, before: find(input.before, recordKind, id), after: find(input.after, recordKind, id) };
  });
  const record: AgentTaskActionRecord = structuredClone({ schema: 'canvas-one/task-action/1', key: agentTaskActionKey(binding.scope.projectId, input.operationId), ...binding.scope, taskId: binding.taskId, operationId: input.operationId, binding, sequence: input.sequence, targets });
  if (!isAgentTaskActionRecord(record)) throw new TypeError('Invalid task action journal record');
  return record;
}
/** Call only from AtomicDocumentCoordinator.participants with agentTaskActions in its transaction stores. */
export async function appendAgentTaskAction(stores: TransactionStores<JournalRows>, record: AgentTaskActionRecord): Promise<void> {
  if (!isAgentTaskActionRecord(record)) throw new TypeError('Invalid task action journal record');
  await insertImmutable({ get: key => stores.agentTaskActions.get(key), add: row => stores.agentTaskActions.add(row.key, structuredClone(row)) }, record, record.key, equal, () => new Error('Task action ID reused with different journal content'));
}
export type TaskUndoConflict = { readonly recordKind: RecordKind; readonly id: string; readonly reason: 'human-edit-after-task' | 'human-edit-between-actions' };
export type TaskUndoProposal = { readonly changes: readonly RecordChange[]; readonly expectedRecords: readonly LiveTaskTarget[]; readonly preview: Document | null; readonly issues: readonly Issue[] };
export type TaskUndoPlan =
  | { readonly status: 'ready'; readonly proposal: TaskUndoProposal }
  | { readonly status: 'review-required'; readonly conflicts: readonly TaskUndoConflict[]; readonly proposal: TaskUndoProposal }
  | { readonly status: 'empty' }
  | { readonly status: 'invalid-journal'; readonly message: string };

/** Pure coherent reversal proposal. It never writes, authorizes or restores an old whole-board snapshot. */
export function planAgentTaskUndo(current: Document, actions: readonly AgentTaskActionRecord[]): TaskUndoPlan {
  if (actions.length === 0) return { status: 'empty' };
  if (actions.length > 1000 || actions.some(action => !isAgentTaskActionRecord(action))) return { status: 'invalid-journal', message: 'Task action metadata is invalid or exceeds its limit' };
  const first = actions[0];
  if (current.id !== first.boardId || actions.some(action => action.projectId !== first.projectId || action.branchId !== first.branchId || action.boardId !== first.boardId || action.taskId !== first.taskId || action.binding.actorId !== first.binding.actorId)) return { status: 'invalid-journal', message: 'Task action metadata crosses task or board scope' };
  const ordered = [...actions].sort((a, b) => a.sequence - b.sequence);
  const operations = new Map<string, AgentTaskActionRecord>(), revisions = new Map<number, string>();
  const records = new Map<string, { recordKind: RecordKind; id: string; before: EditableRecord | null; after: EditableRecord | null; lastSequence: number; broken: boolean }>();
  for (const action of ordered) {
    const replay = operations.get(action.operationId);
    if (replay) { if (!equal(replay, action)) return { status: 'invalid-journal', message: 'Task action ID has conflicting content' }; continue; }
    if (revisions.has(action.sequence)) return { status: 'invalid-journal', message: 'Task action revision has conflicting operations' };
    operations.set(action.operationId, action); revisions.set(action.sequence, action.operationId);
    for (const target of action.targets) {
      const key = JSON.stringify([target.recordKind, target.id]), previous = records.get(key);
      if (!previous && records.size >= 1000) return { status: 'invalid-journal', message: 'Task reversal exceeds the bounded record limit' };
      records.set(key, { ...target, before: previous ? previous.before : target.before, lastSequence: action.sequence, broken: !!previous && (previous.broken || !equal(previous.after, target.before)) });
    }
  }
  const changes: RecordChange[] = [], expectedRecords: LiveTaskTarget[] = [], conflicts: TaskUndoConflict[] = [];
  for (const target of [...records.values()].sort((a, b) => b.lastSequence - a.lastSequence)) {
    const present = find(current, target.recordKind, target.id);
    if (equal(target.before, target.after) && !target.broken) continue;
    if (target.broken) conflicts.push({ recordKind: target.recordKind, id: target.id, reason: 'human-edit-between-actions' });
    if (!equal(present, target.after)) conflicts.push({ recordKind: target.recordKind, id: target.id, reason: 'human-edit-after-task' });
    // A review candidate preserves human-affected records too. Never sneak an overwrite into Accept.
    if (target.broken || !equal(present, target.after)) continue;
    const priorCount = changes.length;
    if (target.before === null) { if (present) changes.push({ kind: 'remove', recordKind: target.recordKind, id: target.id }); }
    else changes.push({ kind: present === null ? 'insert' : 'replace', value: structuredClone(target.before) });
    if (changes.length !== priorCount) expectedRecords.push({ recordKind: target.recordKind, id: target.id, before: structuredClone(present) });
  }
  const candidate = applyRecordChanges(current, changes);
  const proposal: TaskUndoProposal = { changes, expectedRecords, preview: candidate.ok ? candidate.document : null, issues: candidate.ok ? [] : candidate.issues };
  if (conflicts.length || !candidate.ok) return { status: 'review-required', conflicts, proposal };
  return changes.length ? { status: 'ready', proposal } : { status: 'empty' };
}

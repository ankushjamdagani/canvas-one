import { describe, expect, it } from 'vitest';
import { AtomicDocumentCoordinator, MemoryBackend, type OperationReceipt } from '@canvas-one/storage';
import type { Document, Element } from '../../domain/studio/model';
import type { RecordChange } from '../../domain/studio/records';
import { appendAgentTaskAction, prepareAgentTaskAction, planAgentTaskUndo, type AgentTaskActionRecord } from './agent-action-journal';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const element = (n: number, label: string): Element => ({ id: id(n), label, description: '', visualKind: 'host', ports: [], behavior: { kind: 'unmodeled', version: 1, reason: 'Annotation' } });
const doc = (...elements: Element[]): Document => ({ schema: 'studio-model/1', id: id(1), title: 'Fixture', elements, connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [] });
const binding = { taskId: 'task', attemptId: 'attempt', actorId: 'claude', generation: 1, scope: { projectId: 'project', branchId: 'draft', boardId: id(1) } };
const replace = (record: Element): RecordChange => ({ kind: 'replace', value: { recordKind: 'element', record } });
const action = (sequence: number, before: Document, after: Document, changes: RecordChange[]) => prepareAgentTaskAction({ binding, operationId: `operation-${sequence}`, sequence, before, after, changes });
describe('coherent task Undo', () => {
  it('merges chronological edits and preserves unrelated human content', () => {
    const a = element(2, 'Original'), b = { ...a, label: 'First' }, c = { ...a, label: 'Last' }, human = element(3, 'Human');
    const one = action(1, doc(a), doc(b), [replace(b)]), two = action(3, doc(b, human), doc(c, human), [replace(c)]);
    const plan = planAgentTaskUndo(doc(c, human), [two, one, structuredClone(one)]);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') throw new Error('Expected ready');
    expect(plan.proposal.changes).toEqual([replace(a)]);
    expect(plan.proposal.preview?.elements).toEqual([a, human]);
  });
  it('requires review for later and interleaved human edits without changing current content', () => {
    const a = element(2, 'Original'), b = { ...a, label: 'Agent' }, human = { ...a, label: 'Human' }, c = { ...a, label: 'Last agent' };
    const one = action(1, doc(a), doc(b), [replace(b)]);
    const current = doc(human);
    expect(planAgentTaskUndo(current, [one])).toMatchObject({ status: 'review-required', conflicts: [{ reason: 'human-edit-after-task' }], proposal: { changes: [], preview: { elements: [human] } } });
    expect(current.elements).toEqual([human]);
    const two = action(3, doc(human), doc(c), [replace(c)]);
    expect(planAgentTaskUndo(doc(c), [one, two])).toMatchObject({ status: 'review-required', conflicts: [{ reason: 'human-edit-between-actions' }], proposal: { changes: [], preview: { elements: [c] } } });
  });
  it('rejects mixed boards and conflicting journal replays', () => {
    const a = element(2, 'Original'), b = { ...a, label: 'Agent' }, one = action(1, doc(a), doc(b), [replace(b)]);
    expect(planAgentTaskUndo({ ...doc(b), id: id(99) }, [one])).toMatchObject({ status: 'invalid-journal' });
    expect(planAgentTaskUndo(doc(b), [one, { ...one, sequence: 2 }])).toMatchObject({ status: 'invalid-journal' });
  });
  it('keeps mixed conflict review candidates human-safe and validates full inverse dependencies', () => {
    const a = element(2, 'Original'), b = { ...a, label: 'Agent' }, human = { ...a, label: 'Human' }, added = element(3, 'Agent insertion');
    const changes: RecordChange[] = [replace(b), { kind: 'insert', value: { recordKind: 'element', record: added } }];
    const record = action(1, doc(a), doc(b, added), changes);
    const plan = planAgentTaskUndo(doc(human, added), [record]);
    expect(plan).toMatchObject({ status: 'review-required', proposal: { changes: [{ kind: 'remove', recordKind: 'element', id: added.id }], preview: { elements: [human] } } });
    const current: Document = { ...doc(added), views: [{ id: id(4), label: 'Human layout', placements: [{ id: id(5), elementId: added.id, x: 0, y: 0, width: 200, expanded: false }], connectionIds: [], relationIds: [], groups: [], notes: [] }] };
    const inserted: RecordChange = { kind: 'insert', value: { recordKind: 'element', record: added } };
    const dependency = planAgentTaskUndo(current, [action(1, doc(), doc(added), [inserted])]);
    expect(dependency.status).toBe('review-required');
    if (dependency.status !== 'review-required') throw new Error('Expected review');
    expect(dependency.proposal.preview).toBeNull();
    expect(dependency.proposal.issues.length).toBeGreaterThan(0);
    expect(current.elements).toEqual([added]);
  });
});
type Result = { status: 'applied' | 'failed' };
type Rows = { projects: { id: string; revision: number; updatedAt: number }; branches: { projectId: string; id: string; workingRevision: number; workingSnapshotId: string }; snapshots: { projectId: string; id: string; document: Document }; operations: OperationReceipt<Result>; agentTaskActions: AgentTaskActionRecord };
async function fixture() {
  const backend = new MemoryBackend<Rows>(['projects', 'branches', 'snapshots', 'operations', 'agentTaskActions']);
  const a = element(2, 'Before'), b = { ...a, label: 'After' }, journal = action(1, doc(a), doc(b), [replace(b)]);
  await backend.transaction(async s => { await s.projects.add('project', { id: 'project', revision: 0, updatedAt: 0 }); await s.branches.add(['project', 'draft'], { projectId: 'project', id: 'draft', workingRevision: 0, workingSnapshotId: 'before' }); });
  const prepared = { operationId: journal.operationId, projectId: 'project', branchId: 'draft', expectedRevision: 0, requestHash: 'hash', snapshot: { projectId: 'project', id: 'after', document: doc(b) } };
  const coordinator = (failJournal = false, finalGuard?: () => boolean, afterJournal?: () => void) => new AtomicDocumentCoordinator<Rows, Result>({ backend, decodeReceipt: r => r as Result, missing: () => ({ status: 'failed' }), stale: () => ({ status: 'failed' }), reused: () => ({ status: 'failed' }), failed: () => ({ status: 'failed' }), applied: () => ({ status: 'applied' }), equalSnapshot: (a, b) => JSON.stringify(a) === JSON.stringify(b), snapshotCollision: () => new Error('Collision'), participants: [async s => { await appendAgentTaskAction(s, journal); afterJournal?.(); if (failJournal) throw new Error('Journal failed'); }], finalGuard });
  return { backend, prepared, journal, coordinator };
}
describe('atomic journal and final guard', () => {
  it('persists one journal and receipt on identical retry', async () => {
    const h = await fixture(), c = h.coordinator();
    expect(await c.commit(h.prepared)).toEqual({ status: 'applied' }); expect(await c.commit(h.prepared)).toEqual({ status: 'applied' });
    await h.backend.transaction(async s => { expect((await s.branches.get(['project', 'draft']))?.workingRevision).toBe(1); expect(await s.agentTaskActions.get(h.journal.key)).toEqual(h.journal); });
  });
  it('rolls all writes back on metadata failure or final expiry/Stop', async () => {
    for (const failJournal of [true, false]) {
      const h = await fixture();
      expect(await h.coordinator(failJournal, () => false).commit(h.prepared)).toEqual({ status: 'failed' });
      await h.backend.transaction(async s => { expect((await s.projects.get('project'))?.revision).toBe(0); expect((await s.branches.get(['project', 'draft']))?.workingRevision).toBe(0); expect(await s.snapshots.get(['project', 'after'])).toBeUndefined(); expect(await s.operations.get(['project', h.journal.operationId])).toBeUndefined(); expect(await s.agentTaskActions.get(h.journal.key)).toBeUndefined(); });
    }
  });
  it('rechecks a lease revoked after an awaited metadata write', async () => {
    const h = await fixture(); let eligible = true;
    expect(await h.coordinator(false, () => eligible, () => { eligible = false; }).commit(h.prepared)).toEqual({ status: 'failed' });
    await h.backend.transaction(async s => { expect((await s.branches.get(['project', 'draft']))?.workingRevision).toBe(0); expect(await s.agentTaskActions.get(h.journal.key)).toBeUndefined(); expect(await s.operations.get(['project', h.journal.operationId])).toBeUndefined(); });
  });
});

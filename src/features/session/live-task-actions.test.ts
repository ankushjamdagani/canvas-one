import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRepository, type AttemptBinding } from '@canvas-one/agents';
import type { LiveTaskAction } from '@canvas-one/system-design/session/contracts';
import type { Document, Element } from '@canvas-one/system-design';
import { LocalRepository } from '../../persistence/studio/repository';
import { StudioDatabase } from '../../persistence/studio/db';
import { SessionController } from './controller';

let counter = 810000;
const mintId = () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;
const actor = { actorId: 'local-reviewer', displayName: 'Reviewer', kind: 'local-human' as const };
const databases: StudioDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) { db.close(); await db.delete(); } });
async function setup(options: { live?: boolean; lease?: boolean; defaultLease?: boolean; independent?: boolean } = {}) {
  const db = new StudioDatabase(`live-task-${mintId()}`); databases.push(db); await db.open();
  let lease = options.lease ?? true;
  const repository = new LocalRepository(db, { mintId, ...(options.defaultLease ? {} : { checkExecutionLease: () => lease }), ...(options.independent !== undefined ? { checkTaskActionIndependence: () => options.independent! } : {}) });
  const session = new SessionController({ repository, mintId, actor });
  const document: Document = { schema: 'studio-model/1', id: mintId(), title: 'Live task fixture', elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [] };
  expect((await session.createProject({ title: document.title, initialDocument: document })).status).toBe('applied');
  const state = session.getState();
  const scope = { projectId: state.projectId!, branchId: state.branchId!, boardId: state.document!.id };
  const storage = repository.createAgentTaskStorage(scope);
  const opened = await TaskRepository.open(storage); if (!opened.ok) throw new Error(opened.code);
  const tasks = opened.repository;
  const binding: AttemptBinding = { scope, taskId: 'task-live', attemptId: 'attempt-live', actorId: 'claude', generation: 1 };
  expect((await tasks.execute({ type: 'create', ...binding, instruction: 'Add a note' }, tasks.getSnapshot().revision)).ok).toBe(true);
  expect((await tasks.execute({ type: 'start', ...binding }, tasks.getSnapshot().revision)).ok).toBe(true);
  if (options.live !== false) expect((await tasks.execute({ type: 'grantLive', ...binding }, tasks.getSnapshot().revision)).ok).toBe(true);
  const element: Element = { id: mintId(), label: 'Agent note', description: '', visualKind: 'host', ports: [], behavior: { kind: 'unmodeled', version: 1, reason: 'Annotation' } };
  const action: LiveTaskAction = { operationId: mintId(), binding, label: 'Add agent note', changes: [{ kind: 'insert', value: { recordKind: 'element', record: element } }], expectedRecords: [{ recordKind: 'element', id: element.id, before: null }] };
  return { db, repository, session, tasks, binding, scope, element, action, setLease: (value: boolean) => { lease = value; } };
}

describe('live task authored authority', () => {
  it('uses the existing writer, persists task provenance and replays one immutable write/undo', async () => {
    const h = await setup();
    const before = h.session.getState().workingRevision!;
    const first = await h.session.applyLiveTaskAction(h.action);
    expect(first).toMatchObject({ status: 'applied', task: h.binding });
    expect(h.session.getState().workingRevision).toBe(before + 1);
    expect(h.session.undoStack).toHaveLength(1);
    const second = await h.session.applyLiveTaskAction(h.action);
    expect(second).toEqual(first);
    expect(h.session.getState().workingRevision).toBe(before + 1);
    expect(h.session.undoStack).toHaveLength(1);
    expect((await h.db.operations.get([h.scope.projectId, h.action.operationId]))?.result).toMatchObject({ task: h.binding });
    const journal = await h.repository.listAgentTaskActions(h.scope, h.binding.taskId);
    expect(journal).toHaveLength(1);
    expect(journal[0].targets).toEqual([{ recordKind: 'element', id: h.element.id, before: null, after: { recordKind: 'element', record: h.element } }]);
    const reopened = new SessionController({ repository: h.repository, mintId, actor });
    await reopened.openProject(h.scope.projectId, h.scope.branchId);
    expect(await reopened.applyLiveTaskAction(h.action)).toEqual(first);
    expect(reopened.getState().workingRevision).toBe(before + 1);
    expect(reopened.undoStack).toHaveLength(0);
  });

  it('journals accepted Suggest task changes with human authority and no Live grant', async () => {
    const h = await setup({ live: false });
    const state = h.session.getState();
    const request = { operationId: mintId(), label: 'Reviewed task note', scope: { projectId: h.scope.projectId, branchId: h.scope.branchId }, expectedRevision: state.workingRevision!,
      actor: { actorId: h.binding.actorId, displayName: 'Claude', kind: 'agent' as const }, changes: h.action.changes };
    expect(await h.session.applyReviewedProposal(request, { actorId: actor.actorId, displayName: actor.displayName, kind: 'human' })).toMatchObject({ status: 'applied' });
    expect(await h.repository.listAgentTaskActions(h.scope, h.binding.taskId)).toHaveLength(1);
    expect(h.tasks.getSnapshot().tasks[0].permission).toBe('suggest');
  });

  it('denies Suggest, missing tasks, wrong actor/scope and expired/default-denied leases', async () => {
    for (const options of [{ live: false }, { lease: false }, { defaultLease: true }]) {
      const h = await setup(options);
      expect(await h.session.applyLiveTaskAction(h.action)).toMatchObject({ status: 'failed', code: 'ineligible' });
      expect(h.session.getState().document!.elements).toHaveLength(0);
    }
    const h = await setup();
    for (const binding of [{ ...h.binding, taskId: 'missing' }, { ...h.binding, actorId: 'other-agent' }]) expect(await h.session.applyLiveTaskAction({ ...h.action, binding })).toMatchObject({ status: 'failed', code: 'ineligible' });
    expect(await h.session.applyLiveTaskAction({ ...h.action, binding: { ...h.binding, scope: { ...h.scope, boardId: 'wrong-board' } } })).toMatchObject({ status: 'invalid' });
    expect(await h.session.applyLiveTaskAction({ ...h.action, binding: undefined as never })).toMatchObject({ status: 'invalid' });
  });

  it('rechecks a Stop persisted after snapshot pre-read inside the authored transaction', async () => {
    const h = await setup();
    const original = h.db.snapshots.get.bind(h.db.snapshots);
    let fenced = false;
    vi.spyOn(h.db.snapshots, 'get').mockImplementation(key => original(key).then(async snapshot => {
      if (!fenced) {
        fenced = true;
        expect((await h.tasks.execute({ type: 'stop', ...h.binding }, h.tasks.getSnapshot().revision)).ok).toBe(true);
      }
      return snapshot;
    }));
    expect(await h.session.applyLiveTaskAction(h.action)).toMatchObject({ status: 'failed', code: 'ineligible' });
    expect(fenced).toBe(true);
    expect(h.session.getState().document!.elements).toHaveLength(0);
    expect(await h.db.operations.get([h.scope.projectId, h.action.operationId])).toBeUndefined();
  });

  it('permits independent work during overlap only when the trusted host verifies it', async () => {
    for (const independent of [false, true]) {
      const h = await setup({ independent });
      expect((await h.tasks.execute({ type: 'wait', ...h.binding, reason: 'overlap' }, h.tasks.getSnapshot().revision)).ok).toBe(true);
      expect(await h.session.applyLiveTaskAction(h.action)).toMatchObject(independent ? { status: 'applied' } : { status: 'failed', code: 'ineligible' });
    }
  });

  it('rejects an overlapping human edit and preserves independent human changes', async () => {
    const h = await setup();
    expect((await h.session.apply(h.action.changes, 'Human initial note')).status).toBe('applied');
    const expected = { recordKind: 'element' as const, record: h.element };
    const action: LiveTaskAction = { ...h.action, operationId: mintId(), changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...h.element, label: 'Agent replacement' } } }], expectedRecords: [{ recordKind: 'element', id: h.element.id, before: expected }] };
    const human = { ...h.element, label: 'Human replacement' };
    await h.session.apply([{ kind: 'replace', value: { recordKind: 'element', record: human } }], 'Human edit');
    expect(await h.session.applyLiveTaskAction(action)).toMatchObject({ status: 'failed', code: 'conflict' });
    expect(h.session.getState().document!.elements[0]?.label).toBe('Human replacement');
    const independent = { ...h.element, id: mintId(), label: 'Independent human note' };
    await h.session.apply([{ kind: 'insert', value: { recordKind: 'element', record: independent } }], 'Independent edit');
    const target = { ...h.element, id: mintId() };
    expect(await h.session.applyLiveTaskAction({ ...h.action, operationId: mintId(), changes: [{ kind: 'insert', value: { recordKind: 'element', record: target } }], expectedRecords: [{ recordKind: 'element', id: target.id, before: null }] })).toMatchObject({ status: 'applied' });
    expect(h.session.getState().document!.elements).toContainEqual(independent);
    expect(h.session.getState().document!.elements).toContainEqual(human);
  });

  it('rejects operation ID reuse with different changes and never auto-transfers live authority to main', async () => {
    const h = await setup();
    expect((await h.session.applyLiveTaskAction(h.action)).status).toBe('applied');
    expect(await h.session.applyLiveTaskAction({ ...h.action, changes: [{ kind: 'insert', value: { recordKind: 'element', record: { ...h.element, label: 'Different request' } } }] })).toMatchObject({ status: 'failed', code: 'operation-id-reused' });
    const mainBranchId = h.session.getState().mainBranchId!;
    await h.session.openProject(h.scope.projectId, mainBranchId);
    expect(await h.session.applyLiveTaskAction({ ...h.action, binding: { ...h.binding, scope: { ...h.scope, branchId: mainBranchId } } })).toMatchObject({ status: 'failed', code: 'ineligible' });
    expect(h.session.getState().branchId).toBe(mainBranchId);
  });
});

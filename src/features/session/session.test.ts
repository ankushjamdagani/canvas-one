import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import type { Document, Element, Id } from '../../domain/studio/model';
import {
  StudioDatabase,
  LocalRepository,
  type Actor,
  type BranchCreateCommand,
  type RecordChange,
} from '../../persistence/studio';
import {
  computeInverseChanges,
  openStudioRepository,
  SessionController,
} from './index';

let idCounter = 0;
function createMintId(): () => Id {
  return () => {
    idCounter++;
    const hex = idCounter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
}

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

function makeElement(id: Id, label = 'Test Element'): Element {
  return {
    id,
    label,
    description: 'Test description',
    visualKind: 'host',
    ports: [],
    behavior: {
      kind: 'unmodeled',
      version: 1,
      reason: 'Testing',
    },
  };
}

function createTestDocument(id: Id, title = 'Untitled'): Document {
  return {
    schema: 'studio-model/1',
    id,
    title,
    elements: [],
    connections: [],
    relations: [],
    schemas: [],
    fixtures: [],
    refinements: [],
    scenarios: [],
    views: [],
  };
}

describe('Session Layer', () => {
  it('creates from saved work or the branch head and reopens with a fresh revision before switching', async () => {
    const db = new StudioDatabase(`test-branch-controls-${Date.now()}-${idCounter++}`);
    await db.open();
    const repository = new LocalRepository(db);
    const mintId = createMintId();
    const controller = new SessionController({ repository, mintId, actor: testActor });

    await controller.createProject({
      title: 'Branch controls',
      initialDocument: createTestDocument(mintId(), 'Branch controls'),
    });
    const sourceBranchId = controller.getState().branchId!;
    const projectId = controller.getState().projectId!;
    const element = makeElement(mintId(), 'Saved work');
    expect((await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: element } }],
      'Add element',
    )).status).toBe('applied');

    const working = await controller.createBranch('From working copy', 'working');
    expect(working.status).toBe('applied');
    const workingBranchId = controller.getState().branchId!;
    expect(workingBranchId).not.toBe(sourceBranchId);
    expect(controller.getState().document?.elements.map((item) => item.id)).toEqual([element.id]);

    await db.branches.update([projectId, workingBranchId], { state: 'closed' });
    const reopened = await controller.reopenBranch(workingBranchId);
    expect(reopened.status).toBe('applied');
    expect(controller.getState().branchId).toBe(workingBranchId);
    expect(controller.getState().workingRevision).toBe(1);
    const reopenedBranch = await repository.loadBranch(projectId, workingBranchId);
    expect(reopenedBranch?.state).toBe('open');
    expect(reopenedBranch?.workingSnapshotId).toBe(controller.getState().workingSnapshotId);

    const fromHead = await controller.createBranch('From committed head', 'head');
    expect(fromHead.status).toBe('applied');
    expect(controller.getState().document?.elements).toEqual([]);
    const headBranch = await repository.loadBranch(projectId, controller.getState().branchId!);
    expect(headBranch?.headCommitId).toBe(reopenedBranch?.headCommitId);

    db.close();
  });

  it('constructor validation: requires repository, mintId, actor; no defaults or randomUUID fallback', () => {
    const mintId = createMintId();
    // @ts-expect-error testing missing repository
    expect(() => new SessionController({ mintId, actor: testActor })).toThrow(TypeError);
    // @ts-expect-error testing missing mintId
    expect(() => new SessionController({ repository: {} as any, actor: testActor })).toThrow(
      TypeError,
    );
    // @ts-expect-error testing missing actor
    expect(() => new SessionController({ repository: {} as any, mintId })).toThrow(TypeError);
    expect(
      () =>
        new SessionController({
          repository: {} as any,
          mintId,
          // @ts-expect-error testing invalid actor kind
          actor: { actorId: 'u1', kind: 'unknown', displayName: 'U' },
        }),
    ).toThrow(TypeError);
  });

  it('boot ok', async () => {
    const dbName = `test-boot-${Date.now()}-${idCounter++}`;
    const bootResult = await openStudioRepository({ dbName, mintId: createMintId() });
    expect(bootResult.ok).toBe(true);
    expect(bootResult.status).toBe('ready');
    if (bootResult.ok) {
      expect(bootResult.repository).toBeDefined();
    }
  });

  it('boot failure (unavailable/quota) maps to typed boot result, never throws raw', async () => {
    // Test unavailable error mapping (e.g. OpenFailedError)
    const openSpy = vi
      .spyOn(StudioDatabase.prototype, 'open')
      .mockRejectedValueOnce(new Dexie.OpenFailedError('Database blocked or open failed'));

    const unavailableResult = await openStudioRepository({
      dbName: 'failing-unavailable-db',
      mintId: createMintId(),
    });
    expect(unavailableResult.ok).toBe(false);
    if (!unavailableResult.ok) {
      expect(unavailableResult.status).toBe('failed');
      expect(unavailableResult.code).toBe('unavailable');
      expect(unavailableResult.issues.length).toBeGreaterThan(0);
    }

    // Test quota exceeded error mapping
    openSpy.mockRejectedValueOnce(new Dexie.QuotaExceededError('Disk full'));
    const quotaResult = await openStudioRepository({
      dbName: 'failing-quota-db',
      mintId: createMintId(),
    });
    expect(quotaResult.ok).toBe(false);
    if (!quotaResult.ok) {
      expect(quotaResult.status).toBe('failed');
      expect(quotaResult.code).toBe('quota');
      expect(quotaResult.issues.length).toBeGreaterThan(0);
    }

    openSpy.mockRestore();
  });

  it('create → ready with revision 0 draft branch', async () => {
    const dbName = `test-create-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    expect(bootResult.ok).toBe(true);
    if (!bootResult.ok) return;

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    // Initial state before project creation
    expect(controller.getState()).toEqual({
      status: 'empty',
      projectId: null,
      branchId: null,
      mainBranchId: null,
      projectRevision: null,
      workingRevision: null,
      workingSnapshotId: null,
      document: null,
      canUndo: false,
      canRedo: false,
      lastError: null,
      needsReload: false,
    });

    const createRes = await controller.createProject({
      title: 'My Studio Project',
      initialDocument: createTestDocument(mintId(), 'My Studio Project'),
    });
    expect(createRes.status).toBe('applied');

    const state = controller.getState();
    expect(state.status).toBe('ready');
    expect(state.projectId).toBeDefined();
    expect(state.branchId).toBeDefined();
    expect(state.projectRevision).toBe(0);
    expect(state.workingRevision).toBe(0);
    expect(state.document).toBeDefined();
    expect(state.document?.title).toBe('My Studio Project');
    expect(state.document?.elements).toHaveLength(0);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(state.lastError).toBeNull();
  });

  it('createProject with no views seeds one empty "Main" view (id from mintId, not a client default)', async () => {
    const dbName = `test-blank-view-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    const createRes = await controller.createProject({
      title: 'Blank Project',
      initialDocument: createTestDocument(mintId(), 'Blank Project'),
    });
    expect(createRes.status).toBe('applied');

    const { document } = controller.getState();
    expect(document?.views).toHaveLength(1);
    const view = document?.views[0];
    expect(view?.label).toBe('Main');
    expect(view?.placements).toEqual([]);
    expect(view?.connectionIds).toEqual([]);
    expect(view?.relationIds).toEqual([]);
    expect(view?.groups).toEqual([]);
    expect(view?.notes).toEqual([]);
    // The id is minted, not a hardcoded/client-invented value.
    expect(view?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('createProject with an existing view (e.g. a template) is left untouched', async () => {
    const dbName = `test-template-views-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    const templateView = {
      id: mintId(),
      label: 'Overview',
      placements: [],
      connectionIds: [],
      relationIds: [],
      groups: [],
      notes: [],
    };
    const templateDoc: Document = { ...createTestDocument(mintId(), 'Template Project'), views: [templateView] };

    const createRes = await controller.createProject({
      title: 'Template Project',
      initialDocument: templateDoc,
    });
    expect(createRes.status).toBe('applied');

    const { document } = controller.getState();
    expect(document?.views).toHaveLength(1);
    expect(document?.views[0]).toEqual(templateView);
  });

  it('apply insert element → document + revision updated, one undo entry', async () => {
    const dbName = `test-apply-insert-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Apply Insert Project',
      initialDocument: createTestDocument(mintId(), 'Apply Insert Project'),
    });

    const el1 = makeElement(mintId(), 'Element Alpha');
    const change: RecordChange = {
      kind: 'insert',
      value: { recordKind: 'element', record: el1 },
    };

    const applyRes = await controller.apply([change], 'Insert Element Alpha');
    expect(applyRes.status).toBe('applied');

    const state = controller.getState();
    expect(state.status).toBe('ready');
    expect(state.workingRevision).toBe(1);
    expect(state.document?.elements).toHaveLength(1);
    expect(state.document?.elements[0].id).toBe(el1.id);
    expect(state.document?.elements[0].label).toBe('Element Alpha');
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(false);

    expect(controller.undoStack).toHaveLength(1);
    expect(controller.undoStack[0].label).toBe('Insert Element Alpha');
    expect(controller.redoStack).toHaveLength(0);
  });

  it('invalid change → state untouched, no undo entry', async () => {
    const dbName = `test-invalid-change-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Invalid Change Project',
      initialDocument: createTestDocument(mintId(), 'Invalid Change Project'),
    });

    const el1 = makeElement(mintId(), 'Element Alpha');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Insert Element Alpha',
    );
    expect(controller.getState().workingRevision).toBe(1);
    expect(controller.undoStack).toHaveLength(1);

    // Attempt invalid change: duplicate insertion of el1
    const invalidRes = await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Duplicate Insert',
    );
    expect(invalidRes.status).toBe('invalid');

    const state = controller.getState();
    expect(state.status).toBe('ready');
    expect(state.workingRevision).toBe(1); // untouched
    expect(state.document?.elements).toHaveLength(1); // untouched
    expect(state.canUndo).toBe(true);
    expect(controller.undoStack).toHaveLength(1); // no new undo entry pushed
    expect(state.lastError).toBe(invalidRes);
  });

  it('stale (bump the branch through a second controller on the same DB) → stale result, document unchanged, no overwrite', async () => {
    const dbName = `test-stale-edit-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller1 = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller1.createProject({
      title: 'Stale Edit Project',
      initialDocument: createTestDocument(mintId(), 'Stale Edit Project'),
    });
    const { projectId, branchId } = controller1.getState();

    // Controller 1 applies change 1 -> revision 1
    const el1 = makeElement(mintId(), 'Element 1');
    await controller1.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Change 1',
    );
    expect(controller1.getState().workingRevision).toBe(1);

    // Controller 2 opens the same project and branch
    const controller2 = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });
    await controller2.openProject(projectId!, branchId!);
    expect(controller2.getState().workingRevision).toBe(1);

    // Controller 2 applies change 2 -> bumps branch revision to 2 in DB
    const el2 = makeElement(mintId(), 'Element 2');
    const c2Res = await controller2.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el2 } }],
      'Controller 2 Edit',
    );
    expect(c2Res.status).toBe('applied');
    expect(controller2.getState().workingRevision).toBe(2);

    // Controller 1 (whose in-memory workingRevision is still 1) attempts an edit
    const el3 = makeElement(mintId(), 'Element 3');
    const c1Res = await controller1.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el3 } }],
      'Controller 1 Stale Edit',
    );

    // Verify stale result returned, never retried with new revision, never overwrites
    expect(c1Res.status).toBe('stale');
    if (c1Res.status === 'stale') {
      expect(c1Res.scope).toBe('branch');
      expect(c1Res.expected).toBe(1);
      expect(c1Res.actual).toBe(2);
    }

    const c1State = controller1.getState();
    expect(c1State.workingRevision).toBe(1); // unchanged
    expect(c1State.document?.elements).toHaveLength(1); // unchanged (only el1)
    expect(controller1.undoStack).toHaveLength(1); // unchanged

    // Check DB document was NOT overwritten and has controller2's el1 and el2
    const branchInDb = await bootResult.repository.loadBranch(projectId!, branchId!);
    const snapshotInDb = await bootResult.repository.loadSnapshot(
      projectId!,
      branchInDb!.workingSnapshotId,
    );
    expect(snapshotInDb!.document.elements).toHaveLength(2);
    expect(snapshotInDb!.document.elements.map((e) => e.id)).toEqual([el1.id, el2.id]);
  });

  it('busy while a save is pending', async () => {
    const dbName = `test-busy-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const repo = bootResult.repository;
    const originalExecute = repo.execute.bind(repo);

    let resolveSlowExecute: (() => void) | null = null;
    let slowExecuteActive = false;

    // Intercept execute to simulate an in-flight command
    vi.spyOn(repo, 'execute').mockImplementation(async (command) => {
      if (slowExecuteActive) {
        await new Promise<void>((resolve) => {
          resolveSlowExecute = resolve;
        });
      }
      return originalExecute(command);
    });

    const controller = new SessionController({
      repository: repo,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Busy Test Project',
      initialDocument: createTestDocument(mintId(), 'Busy Test Project'),
    });

    // Enable slow execution for the next apply
    slowExecuteActive = true;
    const el1 = makeElement(mintId(), 'Slow Element');
    const slowApplyPromise = controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Slow Apply',
    );

    // State must now be saving
    expect(controller.getState().status).toBe('saving');

    // While save is pending, apply/undo/redo/rename return typed busy
    const el2 = makeElement(mintId(), 'Concurrent Element');
    const busyApply = await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el2 } }],
      'Concurrent Apply',
    );
    expect(busyApply.status).toBe('busy');

    const busyUndo = await controller.undo();
    expect(busyUndo.status).toBe('busy');

    const busyRedo = await controller.redo();
    expect(busyRedo.status).toBe('busy');

    const busyRename = await controller.renameProject('New Title While Busy');
    expect(busyRename.status).toBe('busy');

    // Resolve in-flight save
    slowExecuteActive = false;
    if (resolveSlowExecute) {
      (resolveSlowExecute as () => void)();
    }
    const applyRes = await slowApplyPromise;
    expect(applyRes.status).toBe('applied');

    // Now state transitions to ready
    expect(controller.getState().status).toBe('ready');
    expect(controller.getState().document?.elements).toHaveLength(1);
    expect(controller.getState().document?.elements[0].id).toBe(el1.id);
  });

  it('undo restores the prior document via a new command (revision increments, not rewinds)', async () => {
    const dbName = `test-undo-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Undo Test Project',
      initialDocument: createTestDocument(mintId(), 'Undo Test Project'),
    });
    expect(controller.getState().workingRevision).toBe(0);

    const el1 = makeElement(mintId(), 'Element Alpha');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Insert Element',
    );
    expect(controller.getState().workingRevision).toBe(1);
    expect(controller.getState().document?.elements).toHaveLength(1);
    expect(controller.getState().canUndo).toBe(true);
    expect(controller.getState().canRedo).toBe(false);

    // Undo: issues inverse change (remove) as a NEW command with current revision
    const undoRes = await controller.undo();
    expect(undoRes.status).toBe('applied');

    const stateAfterUndo = controller.getState();
    // Revision increments (1 -> 2), NOT rewinds!
    expect(stateAfterUndo.workingRevision).toBe(2);
    expect(stateAfterUndo.document?.elements).toHaveLength(0); // restored prior document
    expect(stateAfterUndo.canUndo).toBe(false);
    expect(stateAfterUndo.canRedo).toBe(true);

    expect(controller.undoStack).toHaveLength(0);
    expect(controller.redoStack).toHaveLength(1);
    expect(controller.redoStack[0].label).toBe('Insert Element');
  });

  it('redo', async () => {
    const dbName = `test-redo-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Redo Test Project',
      initialDocument: createTestDocument(mintId(), 'Redo Test Project'),
    });

    const el1 = makeElement(mintId(), 'Element Alpha');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Insert Element',
    );
    await controller.undo();

    // Redo: issues forward change as a NEW command
    const redoRes = await controller.redo();
    expect(redoRes.status).toBe('applied');

    const stateAfterRedo = controller.getState();
    expect(stateAfterRedo.workingRevision).toBe(3); // increments again (2 -> 3)
    expect(stateAfterRedo.document?.elements).toHaveLength(1);
    expect(stateAfterRedo.document?.elements[0].id).toBe(el1.id);
    expect(stateAfterRedo.canUndo).toBe(true);
    expect(stateAfterRedo.canRedo).toBe(false);

    expect(controller.undoStack).toHaveLength(1);
    expect(controller.redoStack).toHaveLength(0);
  });

  it('new apply clears redo', async () => {
    const dbName = `test-clear-redo-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Clear Redo Project',
      initialDocument: createTestDocument(mintId(), 'Clear Redo Project'),
    });

    const el1 = makeElement(mintId(), 'Element Alpha');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Insert Alpha',
    );
    await controller.undo();
    expect(controller.getState().canRedo).toBe(true);
    expect(controller.redoStack).toHaveLength(1);

    // New apply clears redo
    const el2 = makeElement(mintId(), 'Element Beta');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el2 } }],
      'Insert Beta',
    );

    expect(controller.getState().canRedo).toBe(false);
    expect(controller.redoStack).toHaveLength(0);
    expect(controller.getState().document?.elements).toHaveLength(1);
    expect(controller.getState().document?.elements[0].id).toBe(el2.id);
  });

  it('101 applies keep 100 entries', async () => {
    const dbName = `test-101-applies-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: '101 Applies Project',
      initialDocument: createTestDocument(mintId(), '101 Applies Project'),
    });

    // Apply 101 changes (1 insert followed by 100 replaces, respecting document 100-element limit)
    const el = makeElement(mintId(), 'Initial Label');
    const firstRes = await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el } }],
      'Insert 1',
    );
    expect(firstRes.status).toBe('applied');

    for (let i = 2; i <= 101; i++) {
      const elUpdated: Element = { ...el, label: `Label ${i}` };
      const res = await controller.apply(
        [{ kind: 'replace', value: { recordKind: 'element', record: elUpdated } }],
        `Replace ${i}`,
      );
      expect(res.status).toBe('applied');
    }

    expect(controller.getState().workingRevision).toBe(101);
    expect(controller.getState().document?.elements).toHaveLength(1);
    expect(controller.getState().document?.elements[0].label).toBe('Label 101');

    // Maximum 100 entries: oldest was dropped (Insert 1 dropped)
    expect(controller.undoStack).toHaveLength(100);
    expect(controller.undoStack[0].label).toBe('Replace 2');
    expect(controller.undoStack[99].label).toBe('Replace 101');
    expect(controller.getState().canUndo).toBe(true);

    // Can undo exactly 100 times
    for (let i = 0; i < 100; i++) {
      const undoRes = await controller.undo();
      expect(undoRes.status).toBe('applied');
    }

    // Document is now restored to state after 'Insert 1' (Initial Label)
    expect(controller.getState().document?.elements[0].label).toBe('Initial Label');
    expect(controller.getState().canUndo).toBe(false);
    expect(controller.undoStack).toHaveLength(0);
    expect(controller.redoStack).toHaveLength(100);

    // Attempting 101st undo returns empty
    const noopUndo = await controller.undo();
    expect(noopUndo.status).toBe('empty');
  });

  it('undo/redo of replace and remove', async () => {
    const dbName = `test-replace-remove-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Replace & Remove Project',
      initialDocument: createTestDocument(mintId(), 'Replace & Remove Project'),
    });

    const el1 = makeElement(mintId(), 'Original Label');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Insert Element',
    );

    // 1. Test replace
    const el1Modified: Element = { ...el1, label: 'Modified Label' };
    const replaceRes = await controller.apply(
      [{ kind: 'replace', value: { recordKind: 'element', record: el1Modified } }],
      'Replace Label',
    );
    expect(replaceRes.status).toBe('applied');
    expect(controller.getState().document?.elements[0].label).toBe('Modified Label');

    // Undo replace: restores 'Original Label'
    await controller.undo();
    expect(controller.getState().document?.elements[0].label).toBe('Original Label');

    // Redo replace: reapplies 'Modified Label'
    await controller.redo();
    expect(controller.getState().document?.elements[0].label).toBe('Modified Label');

    // 2. Test remove
    const removeRes = await controller.apply(
      [{ kind: 'remove', recordKind: 'element', id: el1.id }],
      'Remove Element',
    );
    expect(removeRes.status).toBe('applied');
    expect(controller.getState().document?.elements).toHaveLength(0);

    // Undo remove: re-inserts the element with 'Modified Label'
    await controller.undo();
    expect(controller.getState().document?.elements).toHaveLength(1);
    expect(controller.getState().document?.elements[0].id).toBe(el1.id);
    expect(controller.getState().document?.elements[0].label).toBe('Modified Label');

    // Redo remove: removes the element again
    await controller.redo();
    expect(controller.getState().document?.elements).toHaveLength(0);
  });

  it('open another branch clears stacks', async () => {
    const dbName = `test-open-branch-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Branch Switching Project',
      initialDocument: createTestDocument(mintId(), 'Branch Switching Project'),
    });
    const { projectId, branchId: draftBranchId } = controller.getState();

    // Make an edit on draft branch
    const el1 = makeElement(mintId(), 'Draft Element');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Draft edit',
    );
    expect(controller.undoStack).toHaveLength(1);
    expect(controller.getState().canUndo).toBe(true);

    // Create a feature branch in repository
    const featureBranchId = mintId();
    const branchCmd: BranchCreateCommand = {
      commandId: 'branch.create',
      operationId: mintId(),
      projectId: projectId!,
      branchId: draftBranchId!,
      expectedWorkingRevision: controller.getState().workingRevision!,
      actor: testActor,
      payload: {
        newBranchId: featureBranchId,
        label: 'feature-1',
        source: 'working',
        expectedHeadId: null,
      },
    };
    const branchCreateRes = await bootResult.repository.execute(branchCmd);
    expect(branchCreateRes.status).toBe('applied');

    // Open the new branch via controller.openProject
    const openRes = await controller.openProject(projectId!, featureBranchId);
    expect(openRes.status).toBe('ready');

    const state = controller.getState();
    expect(state.branchId).toBe(featureBranchId);
    // Stacks must be cleared
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(controller.undoStack).toHaveLength(0);
    expect(controller.redoStack).toHaveLength(0);
  });

  it('subscribe notifies once per change and snapshot identity is stable between changes', async () => {
    const dbName = `test-subscribe-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    // Stability when nothing changes
    const snapshot1 = controller.getState();
    const snapshot2 = controller.getState();
    expect(snapshot1).toBe(snapshot2);

    const notifications: Array<{ status: string; revision: number | null }> = [];
    const unsubscribe = controller.subscribe(() => {
      const state = controller.getState();
      notifications.push({
        status: state.status,
        revision: state.workingRevision,
      });
    });

    await controller.createProject({
      title: 'Subscribe Test Project',
      initialDocument: createTestDocument(mintId(), 'Subscribe Test Project'),
    });

    // Transitions: saving -> ready (rev 0)
    expect(notifications).toEqual([
      { status: 'saving', revision: null },
      { status: 'ready', revision: 0 },
    ]);

    const snapshotAfterCreate = controller.getState();
    expect(controller.getState()).toBe(snapshotAfterCreate);

    notifications.length = 0;
    const el1 = makeElement(mintId(), 'Element Alpha');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Insert Alpha',
    );

    // Transitions: saving (rev 0) -> ready (rev 1)
    expect(notifications).toEqual([
      { status: 'saving', revision: 0 },
      { status: 'ready', revision: 1 },
    ]);

    // Unsubscribe verification
    unsubscribe();
    notifications.length = 0;
    const el2 = makeElement(mintId(), 'Element Beta');
    await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el2 } }],
      'Insert Beta',
    );
    expect(notifications).toHaveLength(0); // no notifications after unsubscribe
  });

  it('reload (new controller, new Dexie connection) → document persisted, stacks empty', async () => {
    const dbName = `test-reload-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult1 = await openStudioRepository({ dbName, mintId });
    if (!bootResult1.ok) throw new Error('Boot 1 failed');

    const controller1 = new SessionController({
      repository: bootResult1.repository,
      mintId,
      actor: testActor,
    });

    await controller1.createProject({
      title: 'Reload Test Project',
      initialDocument: createTestDocument(mintId(), 'Reload Test Project'),
    });
    const { projectId, branchId: draftBranchId } = controller1.getState();

    const el1 = makeElement(mintId(), 'Persisted Element');
    await controller1.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Add element to persist',
    );
    expect(controller1.getState().document?.elements).toHaveLength(1);
    expect(controller1.getState().canUndo).toBe(true);

    // Simulate page reload: new Dexie connection, new repository, new controller
    const bootResult2 = await openStudioRepository({ dbName, mintId });
    expect(bootResult2.ok).toBe(true);
    if (!bootResult2.ok) return;

    const controller2 = new SessionController({
      repository: bootResult2.repository,
      mintId,
      actor: testActor,
    });

    await controller2.openProject(projectId!, draftBranchId!);

    const state2 = controller2.getState();
    expect(state2.status).toBe('ready');
    expect(state2.workingRevision).toBe(1);
    expect(state2.document?.elements).toHaveLength(1);
    expect(state2.document?.elements[0].id).toBe(el1.id);
    expect(state2.document?.elements[0].label).toBe('Persisted Element');

    // Stacks are empty on reload (never persisted)
    expect(state2.canUndo).toBe(false);
    expect(state2.canRedo).toBe(false);
    expect(controller2.undoStack).toHaveLength(0);
    expect(controller2.redoStack).toHaveLength(0);
  });

  it('renameProject updates title, projectRevision, workingRevision and document.title', async () => {
    const dbName = `test-rename-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Original Title',
      initialDocument: createTestDocument(mintId(), 'Original Title'),
    });
    expect(controller.getState().projectRevision).toBe(0);
    expect(controller.getState().workingRevision).toBe(0);
    expect(controller.getState().document?.title).toBe('Original Title');

    const renameRes = await controller.renameProject('Renamed Title');
    expect(renameRes.status).toBe('applied');

    const state = controller.getState();
    expect(state.projectRevision).toBe(1);
    expect(state.workingRevision).toBe(1);
    expect(state.document?.title).toBe('Renamed Title');
    // Stacks are not affected by rename
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
  });

  it('undo on a stale revision → stale result, stacks unchanged', async () => {
    const dbName = `test-undo-stale-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller1 = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller1.createProject({
      title: 'Undo Stale Project',
      initialDocument: createTestDocument(mintId(), 'Undo Stale Project'),
    });
    const { projectId, branchId } = controller1.getState();

    const el1 = makeElement(mintId(), 'Element 1');
    await controller1.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
      'Insert 1',
    );
    expect(controller1.getState().workingRevision).toBe(1);
    expect(controller1.undoStack).toHaveLength(1);

    // Controller 2 bumps the branch revision in DB
    const controller2 = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });
    await controller2.openProject(projectId!, branchId!);
    const el2 = makeElement(mintId(), 'Element 2');
    await controller2.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el2 } }],
      'Controller 2 Insert',
    );
    expect(controller2.getState().workingRevision).toBe(2);

    // Now Controller 1 (at revision 1) calls undo()
    const undoRes = await controller1.undo();
    expect(undoRes.status).toBe('stale');

    // Stacks unchanged!
    expect(controller1.undoStack).toHaveLength(1);
    expect(controller1.redoStack).toHaveLength(0);
    expect(controller1.getState().workingRevision).toBe(1);
    expect(controller1.getState().document?.elements).toHaveLength(1);
    expect(controller1.getState().canUndo).toBe(true);
  });

  it('openProject(projectId, null) loads the main branch', async () => {
    const dbName = `test-open-main-${Date.now()}-${idCounter++}`;
    const mintId = createMintId();
    const bootResult = await openStudioRepository({ dbName, mintId });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    await controller.createProject({
      title: 'Main Branch Test',
      initialDocument: createTestDocument(mintId(), 'Main Branch Test'),
    });
    const { projectId } = controller.getState();

    const projRecord = await bootResult.repository.loadProject(projectId!);
    expect(projRecord).toBeDefined();

    // openProject with branchId = null loads main branch
    const openRes = await controller.openProject(projectId!, null);
    expect(openRes.status).toBe('ready');
    expect(controller.getState().branchId).toBe(projRecord!.mainBranchId);
  });

  it('switchBranch convenience method works and validates project is open', async () => {
    const mintId = createMintId();
    const bootResult = await openStudioRepository({
      dbName: `test-switch-branch-${Date.now()}-${idCounter++}`,
      mintId,
    });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    // Calling switchBranch when no project is open returns invalid
    const invalidSwitch = await controller.switchBranch(mintId());
    expect(invalidSwitch.status).toBe('invalid');

    await controller.createProject({
      title: 'Switch Branch Project',
      initialDocument: createTestDocument(mintId(), 'Switch Branch Project'),
    });
    const { projectId } = controller.getState();

    const projRecord = await bootResult.repository.loadProject(projectId!);
    const switchRes = await controller.switchBranch(projRecord!.mainBranchId);
    expect(switchRes.status).toBe('ready');
    expect(controller.getState().branchId).toBe(projRecord!.mainBranchId);
  });

  it('computeInverseChanges produces reversed inverse changes for multiple operations', () => {
    const mintId = createMintId();
    const el1 = makeElement(mintId(), 'Element 1');
    const el2 = makeElement(mintId(), 'Element 2');
    const doc = createTestDocument(mintId(), 'Test Doc');
    const docWithEl1: Document = { ...doc, elements: [el1] };

    const changes: RecordChange[] = [
      { kind: 'remove', recordKind: 'element', id: el1.id },
      { kind: 'insert', value: { recordKind: 'element', record: el2 } },
    ];

    const inverse = computeInverseChanges(docWithEl1, changes);
    expect(inverse.ok).toBe(true);
    if (inverse.ok) {
      // Reversed: insert of el2 inverted -> remove of el2; remove of el1 inverted -> insert of el1
      expect(inverse.changes).toEqual([
        { kind: 'remove', recordKind: 'element', id: el2.id },
        { kind: 'insert', value: { recordKind: 'element', record: el1 } },
      ]);
    }
  });

  it('operations when controller is empty return invalid and do not mutate state', async () => {
    const mintId = createMintId();
    const bootResult = await openStudioRepository({
      dbName: `test-empty-ctrl-${Date.now()}-${idCounter++}`,
      mintId,
    });
    if (!bootResult.ok) throw new Error('Boot failed');

    const controller = new SessionController({
      repository: bootResult.repository,
      mintId,
      actor: testActor,
    });

    const el = makeElement(mintId(), 'Element');
    const applyRes = await controller.apply(
      [{ kind: 'insert', value: { recordKind: 'element', record: el } }],
      'Apply while empty',
    );
    expect(applyRes.status).toBe('invalid');

    const undoRes = await controller.undo();
    expect(undoRes.status).toBe('invalid');

    const redoRes = await controller.redo();
    expect(redoRes.status).toBe('invalid');

    const renameRes = await controller.renameProject('New Title');
    expect(renameRes.status).toBe('invalid');

    expect(controller.getState().status).toBe('empty');
  });

  describe('Session invariants', () => {
    it('Branch/Bootstrap command returning applied with null branchRevision throws contract violation error', async () => {
      const mintId = createMintId();
      const boot = await openStudioRepository({ dbName: `test-r1-item1-${Date.now()}-${idCounter++}`, mintId });
      if (!boot.ok) throw new Error('Boot failed');

      const controller = new SessionController({
        repository: boot.repository,
        mintId,
        actor: testActor,
      });

      const initDoc = createTestDocument(mintId(), 'Init Doc');
      vi.spyOn(boot.repository, 'execute').mockResolvedValueOnce({
        status: 'applied',
        operationId: mintId(),
        projectRevision: 0,
        branchRevision: null,
        changedIds: [],
        undo: null,
        value: { kind: 'project', projectId: mintId(), branchId: mintId() },
      });

      await expect(
        controller.createProject({ title: 'Violating Project', initialDocument: initDoc }),
      ).rejects.toThrow(/contract violation.*branchRevision/i);
    });

    it('on branch/snapshot load failure after applied, sets needsReload: true, lastError: missing, and refuses further apply/undo/redo', async () => {
      const mintId = createMintId();
      const boot = await openStudioRepository({ dbName: `test-r1-item2-${Date.now()}-${idCounter++}`, mintId });
      if (!boot.ok) throw new Error('Boot failed');

      const controller = new SessionController({
        repository: boot.repository,
        mintId,
        actor: testActor,
      });

      const initDoc = createTestDocument(mintId(), 'Doc');
      await controller.createProject({ title: 'Doc', initialDocument: initDoc });

      // Mock loadSnapshot to return null after applied
      vi.spyOn(boot.repository, 'loadSnapshot').mockResolvedValueOnce(null);

      const el = makeElement(mintId(), 'El 1');
      const applyRes = await controller.apply(
        [{ kind: 'insert', value: { recordKind: 'element', record: el } }],
        'Insert El 1',
      );

      expect(applyRes.status).toBe('missing');
      const state = controller.getState();
      expect(state.status).toBe('ready');
      expect((state as any).needsReload).toBe(true);
      expect((state.lastError as any)?.status).toBe('missing');

      // Refuses further apply
      const applyAfter = await controller.apply(
        [{ kind: 'insert', value: { recordKind: 'element', record: makeElement(mintId()) } }],
        'Another apply',
      );
      expect(applyAfter.status).toBe('invalid');

      // Refuses further undo
      const undoAfter = await controller.undo();
      expect(undoAfter.status).toBe('invalid');

      // Refuses further redo
      const redoAfter = await controller.redo();
      expect(redoAfter.status).toBe('invalid');

      // openProject succeeds and clears needsReload
      const openRes = await controller.openProject(state.projectId!, state.branchId);
      expect(openRes.status).toBe('ready');
      expect((controller.getState() as any).needsReload).toBe(false);
    });

    it('computeInverseChanges returns {ok:false, issues} with change index when prior missing; apply returns invalid without sending command', async () => {
      const mintId = createMintId();
      const doc = createTestDocument(mintId(), 'Test Doc');
      const missingId = mintId();

      const result = computeInverseChanges(doc, [
        { kind: 'remove', recordKind: 'element', id: missingId },
      ]) as any;

      expect(result.ok).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].path).toContain(0);

      // Apply with missing prior record should return invalid without calling repository.execute
      const boot = await openStudioRepository({ dbName: `test-r1-item3-${Date.now()}-${idCounter++}`, mintId });
      if (!boot.ok) throw new Error('Boot failed');
      const controller = new SessionController({
        repository: boot.repository,
        mintId,
        actor: testActor,
      });
      await controller.createProject({ title: 'Test Doc', initialDocument: doc });

      const execSpy = vi.spyOn(boot.repository, 'execute');
      const applyRes = await controller.apply(
        [{ kind: 'remove', recordKind: 'element', id: missingId }],
        'Remove missing',
      );
      expect(applyRes.status).toBe('invalid');
      expect(execSpy).not.toHaveBeenCalled();
    });

    it('UndoEntry carries only {label, inverseChanges, forwardChanges}', async () => {
      const mintId = createMintId();
      const boot = await openStudioRepository({ dbName: `test-r1-item4-${Date.now()}-${idCounter++}`, mintId });
      if (!boot.ok) throw new Error('Boot failed');
      const controller = new SessionController({
        repository: boot.repository,
        mintId,
        actor: testActor,
      });
      const doc = createTestDocument(mintId(), 'Doc');
      await controller.createProject({ title: 'Doc', initialDocument: doc });

      const el = makeElement(mintId(), 'El');
      await controller.apply(
        [{ kind: 'insert', value: { recordKind: 'element', record: el } }],
        'Insert El',
      );

      expect(controller.undoStack.length).toBe(1);
      const entry = controller.undoStack[0];
      expect(Object.keys(entry).sort()).toEqual(['forwardChanges', 'inverseChanges', 'label']);
      expect('inverse' in entry).toBe(false);
      expect('forward' in entry).toBe(false);
    });

    it('openProject has in-flight guard, status loading in state, concurrent apply returns busy', async () => {
      const mintId = createMintId();
      const boot = await openStudioRepository({ dbName: `test-r1-item5-${Date.now()}-${idCounter++}`, mintId });
      if (!boot.ok) throw new Error('Boot failed');
      const controller = new SessionController({
        repository: boot.repository,
        mintId,
        actor: testActor,
      });
      const doc = createTestDocument(mintId(), 'Doc');
      await controller.createProject({ title: 'Doc', initialDocument: doc });
      const { projectId, branchId } = controller.getState();

      let resolveLoad: () => void = () => {};
      const loadPromise = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      const origLoadProject = boot.repository.loadProject.bind(boot.repository);
      vi.spyOn(boot.repository, 'loadProject').mockImplementation(async (id) => {
        await loadPromise;
        return origLoadProject(id);
      });

      // Start openProject in background
      const openPromise = controller.openProject(projectId!, branchId);

      // State status must be 'loading'
      expect(controller.getState().status).toBe('loading');

      // Concurrent apply must return busy
      const el = makeElement(mintId(), 'El');
      const busyApply = await controller.apply(
        [{ kind: 'insert', value: { recordKind: 'element', record: el } }],
        'Insert while open',
      );
      expect(busyApply.status).toBe('busy');

      // Concurrent open must also return busy
      const busyOpen = await controller.openProject(projectId!, branchId);
      expect(busyOpen.status).toBe('busy');

      // Complete the open
      resolveLoad();
      const openRes = await openPromise;
      expect(openRes.status).toBe('ready');
      expect(controller.getState().status).toBe('ready');
    });

    it('openStudioRepository requires mintId in options', async () => {
      // @ts-expect-error testing missing options
      await expect(openStudioRepository()).rejects.toThrow(TypeError);
      // @ts-expect-error testing missing mintId in options
      await expect(openStudioRepository({})).rejects.toThrow(TypeError);
      // @ts-expect-error testing non-function mintId
      await expect(openStudioRepository({ mintId: 'not-a-fn' })).rejects.toThrow(TypeError);
    });
  });

  describe('auto-draft from main and workingSnapshotId pairing', () => {
    it('first edit on main creates "Draft from main", switches to it, applies the edit there; main is unchanged; one undo entry reverts only the edit', async () => {
      const dbName = `test-d40-${Date.now()}-${idCounter++}`;
      const mintId = createMintId();
      const bootResult = await openStudioRepository({ dbName, mintId });
      if (!bootResult.ok) throw new Error('Boot failed');

      const controller = new SessionController({
        repository: bootResult.repository,
        mintId,
        actor: testActor,
      });

      await controller.createProject({
        title: 'Main draft Project',
        initialDocument: createTestDocument(mintId(), 'Main draft Project'),
      });
      const { projectId, mainBranchId } = controller.getState();
      expect(projectId).toBeDefined();
      expect(mainBranchId).toBeDefined();

      // Move onto main explicitly (createProject opens the starter draft, not main)
      const openMainRes = await controller.openProject(projectId!, mainBranchId!);
      expect(openMainRes.status).toBe('ready');
      expect(controller.getState().branchId).toBe(mainBranchId);

      const el1 = makeElement(mintId(), 'First edit on main');
      const applyRes = await controller.apply(
        [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
        'Insert element',
      );
      expect(applyRes.status).toBe('applied');

      const state = controller.getState();
      // Session switched off main onto a new draft branch
      expect(state.branchId).not.toBe(mainBranchId);
      expect(state.document?.elements).toHaveLength(1);
      expect(state.document?.elements[0].id).toBe(el1.id);

      const newBranch = await bootResult.repository.loadBranch(projectId!, state.branchId!);
      expect(newBranch?.label).toBe('Draft from main');

      // Main is untouched: still revision 0, no elements
      const mainBranch = await bootResult.repository.loadBranch(projectId!, mainBranchId!);
      expect(mainBranch?.workingRevision).toBe(0);
      const mainSnapshot = await bootResult.repository.loadSnapshot(
        projectId!,
        mainBranch!.workingSnapshotId,
      );
      expect(mainSnapshot?.document.elements).toHaveLength(0);

      // Branch creation isn't undoable; only the edit is on the undo stack
      expect(controller.undoStack).toHaveLength(1);
      expect(controller.undoStack[0].label).toBe('Insert element');

      // Undo reverts only the edit, staying on the same (draft) branch
      const undoRes = await controller.undo();
      expect(undoRes.status).toBe('applied');
      const afterUndo = controller.getState();
      expect(afterUndo.branchId).toBe(newBranch!.id);
      expect(afterUndo.document?.elements).toHaveLength(0);
    });

    it('label collision on an existing "Draft from main" branch appends " 2"', async () => {
      const dbName = `test-d40-collision-${Date.now()}-${idCounter++}`;
      const mintId = createMintId();
      const bootResult = await openStudioRepository({ dbName, mintId });
      if (!bootResult.ok) throw new Error('Boot failed');

      const controller = new SessionController({
        repository: bootResult.repository,
        mintId,
        actor: testActor,
      });

      await controller.createProject({
        title: 'Main draft Collision Project',
        initialDocument: createTestDocument(mintId(), 'Main draft Collision Project'),
      });
      const { projectId, mainBranchId } = controller.getState();

      // Pre-seed a branch already labeled "Draft from main" straight off main
      const mainBranch = await bootResult.repository.loadBranch(projectId!, mainBranchId!);
      const preseedCommand: BranchCreateCommand = {
        commandId: 'branch.create',
        operationId: mintId(),
        projectId: projectId!,
        branchId: mainBranchId!,
        expectedWorkingRevision: mainBranch!.workingRevision,
        actor: testActor,
        payload: {
          newBranchId: mintId(),
          label: 'Draft from main',
          source: 'working',
          expectedHeadId: mainBranch!.headCommitId,
        },
      };
      const preseedRes = await bootResult.repository.execute(preseedCommand);
      expect(preseedRes.status).toBe('applied');

      await controller.openProject(projectId!, mainBranchId!);
      const el1 = makeElement(mintId(), 'Second draft from main');
      const applyRes = await controller.apply(
        [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
        'Insert element',
      );
      expect(applyRes.status).toBe('applied');

      const newBranch = await bootResult.repository.loadBranch(
        projectId!,
        controller.getState().branchId!,
      );
      expect(newBranch?.label).toBe('Draft from main 2');
    });

    it('workingSnapshotId is read from the same reloaded branch row as document, across open/apply/undo/redo', async () => {
      const dbName = `test-working-snapshot-id-${Date.now()}-${idCounter++}`;
      const mintId = createMintId();
      const bootResult = await openStudioRepository({ dbName, mintId });
      if (!bootResult.ok) throw new Error('Boot failed');

      const controller = new SessionController({
        repository: bootResult.repository,
        mintId,
        actor: testActor,
      });

      await controller.createProject({
        title: 'Snapshot Pairing Project',
        initialDocument: createTestDocument(mintId(), 'Snapshot Pairing Project'),
      });
      const { projectId, branchId } = controller.getState();

      const assertPaired = async () => {
        const state = controller.getState();
        const branch = await bootResult.repository.loadBranch(projectId!, state.branchId!);
        expect(state.workingSnapshotId).toBe(branch?.workingSnapshotId);
        const snapshot = await bootResult.repository.loadSnapshot(
          projectId!,
          state.workingSnapshotId!,
        );
        expect(snapshot?.document).toEqual(state.document);
      };

      await assertPaired();

      const el1 = makeElement(mintId(), 'Paired element');
      await controller.apply(
        [{ kind: 'insert', value: { recordKind: 'element', record: el1 } }],
        'Insert',
      );
      await assertPaired();

      await controller.undo();
      await assertPaired();

      await controller.redo();
      await assertPaired();

      // Re-opening the branch also pairs document with workingSnapshotId
      const controller2 = new SessionController({
        repository: bootResult.repository,
        mintId,
        actor: testActor,
      });
      await controller2.openProject(projectId!, branchId!);
      const state2 = controller2.getState();
      const branch2 = await bootResult.repository.loadBranch(projectId!, branchId!);
      expect(state2.workingSnapshotId).toBe(branch2?.workingSnapshotId);
    });
  });
});

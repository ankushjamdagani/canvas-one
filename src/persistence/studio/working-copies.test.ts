import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { computeSnapshotId } from './primitives';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import { getSaveFailureRecoveryOptions } from './recovery';
import { switchBranch } from './switch-branch';
import type {
  Actor,
  BranchReopenCommand,
  HistoryCheckpointCommand,
  HistoryRestoreCommand,
  ModelApplyRecordsCommand,
  RecordChange,
} from './types';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Local User',
};

async function createTestProject(repo: LocalRepository) {
  const projectId = crypto.randomUUID();
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();

  const createRes = await repo.execute({
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: {
      newProjectId: projectId,
      title: 'Working Copies Test Project',
      initialDocument: s01Doc,
      mainBranchId,
      draftBranchId,
    },
  });

  expect(createRes.status).toBe('applied');

  const project = await repo.loadProject(projectId);
  const mainBranch = await repo.loadBranch(projectId, mainBranchId);
  const draftBranch = await repo.loadBranch(projectId, draftBranchId);

  return {
    projectId,
    mainBranchId,
    draftBranchId,
    initialSnapshotId: project!.initialSnapshotId,
    project: project!,
    mainBranch: mainBranch!,
    draftBranch: draftBranch!,
  };
}

describe('RV-08b: Branch Working Copies, Autosave, Checkpoints, Restore, Reopen, Switch', () => {
  describe('model.apply-records', () => {
    it('happy path: revision++, project revision++, snapshot id = content hash, receipt retry returns original', async () => {
      const db = createStudioDatabase(`test-apply-happy-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId } = await createTestProject(repo);

      const targetEl = s01Doc.elements[0];
      const updatedEl = { ...targetEl, label: 'Modified Element Label' };

      const change: RecordChange = {
        kind: 'replace',
        value: {
          recordKind: 'element',
          record: updatedEl,
        },
      };

      const operationId = crypto.randomUUID();
      const command: ModelApplyRecordsCommand = {
        commandId: 'model.apply-records',
        operationId,
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          changes: [change],
        },
      };

      const result = await repo.execute(command);
      expect(result.status).toBe('applied');

      if (result.status === 'applied') {
        expect(result.branchRevision).toBe(1);
        expect(result.projectRevision).toBe(1);
        expect(result.changedIds).toEqual([targetEl.id]);
        expect(result.value).toEqual({ kind: 'none' });
      }

      // Verify branch and project in DB
      const branchAfter = await repo.loadBranch(projectId, draftBranchId);
      expect(branchAfter?.workingRevision).toBe(1);

      const projectAfter = await repo.loadProject(projectId);
      expect(projectAfter?.revision).toBe(1);

      // Verify snapshot id in DB equals content hash
      const snapshot = await db.snapshots.get([projectId, branchAfter!.workingSnapshotId]);
      expect(snapshot).toBeDefined();
      const expectedHash = await computeSnapshotId(snapshot!.document);
      expect(branchAfter!.workingSnapshotId).toBe(expectedHash);

      // Receipt retry with same operationId returns the original applied result
      const retryResult = await repo.execute(command);
      expect(retryResult).toEqual(result);

      // Reused operationId with different payload fails with operation-id-reused
      const conflictingCommand: ModelApplyRecordsCommand = {
        ...command,
        payload: {
          changes: [],
        },
      };
      const reusedResult = await repo.execute(conflictingCommand);
      expect(reusedResult.status).toBe('failed');
      if (reusedResult.status === 'failed') {
        expect(reusedResult.code).toBe('operation-id-reused');
      }

      db.close();
    });

    it('is allowed on main branch (main may hold working edits)', async () => {
      const db = createStudioDatabase(`test-apply-main-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, mainBranchId } = await createTestProject(repo);

      const targetEl = s01Doc.elements[0];
      const updatedEl = { ...targetEl, label: 'Main Working Edit' };

      const result = await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          changes: [
            {
              kind: 'replace',
              value: { recordKind: 'element', record: updatedEl },
            },
          ],
        },
      });

      expect(result.status).toBe('applied');
      const branchAfter = await repo.loadBranch(projectId, mainBranchId);
      expect(branchAfter?.workingRevision).toBe(1);

      db.close();
    });

    it('each rejection rule leaves everything unchanged: missing target', async () => {
      const db = createStudioDatabase(`test-reject-missing-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      const nonExistentId = crypto.randomUUID();
      const result = await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          changes: [
            {
              kind: 'replace',
              value: {
                recordKind: 'element',
                record: { ...s01Doc.elements[0], id: nonExistentId },
              },
            },
          ],
        },
      });

      expect(result.status).toBe('invalid');

      // Verify DB is completely untouched
      const branch = await repo.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(0);
      expect(branch?.workingSnapshotId).toBe(initialSnapshotId);
      const project = await repo.loadProject(projectId);
      expect(project?.revision).toBe(0);

      db.close();
    });

    it('each rejection rule leaves everything unchanged: duplicate targets', async () => {
      const db = createStudioDatabase(`test-reject-dup-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      const targetEl = s01Doc.elements[0];
      const result = await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          changes: [
            {
              kind: 'replace',
              value: { recordKind: 'element', record: { ...targetEl, label: 'Update 1' } },
            },
            {
              kind: 'replace',
              value: { recordKind: 'element', record: { ...targetEl, label: 'Update 2' } },
            },
          ],
        },
      });

      expect(result.status).toBe('invalid');

      const branch = await repo.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(0);
      expect(branch?.workingSnapshotId).toBe(initialSnapshotId);

      db.close();
    });

    it('each rejection rule leaves everything unchanged: unknown id', async () => {
      const db = createStudioDatabase(`test-reject-id-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      const result = await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          changes: [
            {
              kind: 'remove',
              recordKind: 'element',
              id: 'not-a-valid-uuid',
            },
          ],
        },
      });

      expect(result.status).toBe('invalid');

      const branch = await repo.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(0);
      expect(branch?.workingSnapshotId).toBe(initialSnapshotId);

      db.close();
    });

    it('each rejection rule leaves everything unchanged: invalid cross-reference', async () => {
      const db = createStudioDatabase(`test-reject-xref-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      // Removing an element that is referenced by existing connections causes invalid cross-reference
      const referencedElementId = s01Doc.connections[0].source.elementId;

      const result = await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          changes: [
            {
              kind: 'remove',
              recordKind: 'element',
              id: referencedElementId,
            },
          ],
        },
      });

      expect(result.status).toBe('invalid');

      const branch = await repo.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(0);
      expect(branch?.workingSnapshotId).toBe(initialSnapshotId);

      db.close();
    });

    it('each rejection rule leaves everything unchanged: >1,000 changes', async () => {
      const db = createStudioDatabase(`test-reject-1000-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      const changes: RecordChange[] = [];
      for (let i = 0; i < 1001; i++) {
        changes.push({
          kind: 'remove',
          recordKind: 'element',
          id: crypto.randomUUID(),
        });
      }

      const result = await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: { changes },
      });

      expect(result.status).toBe('invalid');

      const branch = await repo.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(0);
      expect(branch?.workingSnapshotId).toBe(initialSnapshotId);

      db.close();
    });

    it('stale expectedWorkingRevision → stale', async () => {
      const db = createStudioDatabase(`test-stale-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId } = await createTestProject(repo);

      const targetEl = s01Doc.elements[0];
      const result = await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 42, // Expected 42 but actual is 0
        actor: testActor,
        payload: {
          changes: [
            {
              kind: 'replace',
              value: { recordKind: 'element', record: { ...targetEl, label: 'Stale Edit' } },
            },
          ],
        },
      });

      expect(result.status).toBe('stale');
      if (result.status === 'stale') {
        expect(result.scope).toBe('branch');
        expect(result.expected).toBe(42);
        expect(result.actual).toBe(0);
      }

      db.close();
    });

    it('a quota failure during apply-records → quota and no rows', async () => {
      const db = createStudioDatabase(`test-quota-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      // Simulate QuotaExceededError on snapshots.add
      const originalAdd = db.snapshots.add;
      db.snapshots.add = (async () => {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }) as any;

      const targetEl = s01Doc.elements[0];
      const result = await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          changes: [
            {
              kind: 'replace',
              value: { recordKind: 'element', record: { ...targetEl, label: 'Quota Edit' } },
            },
          ],
        },
      });

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.code).toBe('quota');
      }

      // Restore add method
      db.snapshots.add = originalAdd;

      // Verify no changes were committed
      const branch = await repo.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(0);
      expect(branch?.workingSnapshotId).toBe(initialSnapshotId);
      const project = await repo.loadProject(projectId);
      expect(project?.revision).toBe(0);

      db.close();
    });

    it('two tabs: tab A saves revision n+1, then tab B save from revision n → stale (no overwrite)', async () => {
      const db = createStudioDatabase(`test-tabs-${crypto.randomUUID()}`);
      const repoTabA = new LocalRepository(db);
      const repoTabB = new LocalRepository(db);
      const { projectId, draftBranchId } = await createTestProject(repoTabA);

      const targetEl = s01Doc.elements[0];

      // Tab A saves from revision 0 -> revision 1
      const saveTabA = await repoTabA.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: { ...testActor, displayName: 'Tab A' },
        payload: {
          changes: [
            {
              kind: 'replace',
              value: { recordKind: 'element', record: { ...targetEl, label: 'Tab A Edit' } },
            },
          ],
        },
      });
      expect(saveTabA.status).toBe('applied');

      // Tab B tries to save from revision 0 -> rejects as stale
      const saveTabB = await repoTabB.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: { ...testActor, displayName: 'Tab B' },
        payload: {
          changes: [
            {
              kind: 'replace',
              value: { recordKind: 'element', record: { ...targetEl, label: 'Tab B Overwrite Attempt' } },
            },
          ],
        },
      });

      expect(saveTabB.status).toBe('stale');
      if (saveTabB.status === 'stale') {
        expect(saveTabB.expected).toBe(0);
        expect(saveTabB.actual).toBe(1);
      }

      // Verify Tab A's edit is retained in the database
      const branch = await repoTabA.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(1);
      const storedSnapshot = await db.snapshots.get([projectId, branch!.workingSnapshotId]);
      expect(storedSnapshot?.document.elements[0].label).toBe('Tab A Edit');

      db.close();
    });
  });

  describe('history.checkpoint', () => {
    it('creates immutable named checkpoint: working copy intact, project revision++, artifact value', async () => {
      const db = createStudioDatabase(`test-checkpoint-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      const checkpointId = crypto.randomUUID();
      const command: HistoryCheckpointCommand = {
        commandId: 'history.checkpoint',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          checkpointId,
          label: 'My Checkpoint',
        },
      };

      const result = await repo.execute(command);
      expect(result.status).toBe('applied');
      if (result.status === 'applied') {
        expect(result.projectRevision).toBe(1);
        expect(result.branchRevision).toBe(0); // working copy intact
        expect(result.changedIds).toEqual([checkpointId]);
        expect(result.value).toEqual({
          kind: 'artifact',
          artifactType: 'checkpoint',
          id: checkpointId,
          revision: null,
        });
      }

      // Checkpoint row in DB
      const cpRow = await db.checkpoints.get([projectId, checkpointId]);
      expect(cpRow).toBeDefined();
      expect(cpRow?.label).toBe('My Checkpoint');
      expect(cpRow?.snapshotId).toBe(initialSnapshotId);
      expect(cpRow?.sourceBranchId).toBe(draftBranchId);

      // Working copy intact
      const branch = await repo.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(0);
      expect(branch?.workingSnapshotId).toBe(initialSnapshotId);

      // Project revision++
      const project = await repo.loadProject(projectId);
      expect(project?.revision).toBe(1);

      db.close();
    });

    it('enforces 100 checkpoints per project limit', async () => {
      const db = createStudioDatabase(`test-cp-limit-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      // Seed 100 checkpoints directly into DB
      for (let i = 0; i < 100; i++) {
        await db.checkpoints.add({
          projectId,
          id: crypto.randomUUID(),
          snapshotId: initialSnapshotId,
          sourceBranchId: draftBranchId,
          label: `Checkpoint ${i}`,
          actor: testActor,
          createdAt: Date.now() + i,
        });
      }

      // 101st checkpoint must fail with limit
      const result = await repo.execute({
        commandId: 'history.checkpoint',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          checkpointId: crypto.randomUUID(),
          label: 'Over Limit Checkpoint',
        },
      });

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.code).toBe('limit');
      }

      const totalCheckpoints = await db.checkpoints.where('projectId').equals(projectId).count();
      expect(totalCheckpoints).toBe(100);

      db.close();
    });
  });

  describe('history.restore', () => {
    it('rejects restore on main branch with invalid status and clear issue', async () => {
      const db = createStudioDatabase(`test-restore-main-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, mainBranchId, initialSnapshotId } = await createTestProject(repo);

      const result = await repo.execute({
        commandId: 'history.restore',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          snapshotId: initialSnapshotId,
          checkpointId: crypto.randomUUID(),
          label: 'Pre-restore backup',
        },
      });

      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.issues[0].message).toContain('main');
      }

      db.close();
    });

    it('rejects restore of a missing snapshot with missing status and IDs', async () => {
      const db = createStudioDatabase(`test-restore-missing-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId } = await createTestProject(repo);

      const missingSnapshotId = 'a'.repeat(64);
      const result = await repo.execute({
        commandId: 'history.restore',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          snapshotId: missingSnapshotId,
          checkpointId: crypto.randomUUID(),
          label: 'Pre-restore backup',
        },
      });

      expect(result.status).toBe('missing');
      if (result.status === 'missing') {
        expect(result.ids).toContain(missingSnapshotId);
      }

      db.close();
    });

    it('happy path: checkpoints current working state first then replaces working content with target snapshot', async () => {
      const db = createStudioDatabase(`test-restore-happy-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      // Make an edit on the draft branch so workingSnapshotId != initialSnapshotId
      const targetEl = s01Doc.elements[0];
      await repo.execute({
        commandId: 'model.apply-records',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          changes: [
            {
              kind: 'replace',
              value: { recordKind: 'element', record: { ...targetEl, label: 'Draft Edit Before Restore' } },
            },
          ],
        },
      });

      const branchBeforeRestore = await repo.loadBranch(projectId, draftBranchId);
      const editedSnapshotId = branchBeforeRestore!.workingSnapshotId;
      expect(editedSnapshotId).not.toBe(initialSnapshotId);
      expect(branchBeforeRestore!.workingRevision).toBe(1);

      // Restore back to initialSnapshotId
      const checkpointId = crypto.randomUUID();
      const restoreResult = await repo.execute({
        commandId: 'history.restore',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 1,
        actor: testActor,
        payload: {
          snapshotId: initialSnapshotId,
          checkpointId,
          label: 'Saved before restore',
        },
      });

      expect(restoreResult.status).toBe('applied');
      if (restoreResult.status === 'applied') {
        expect(restoreResult.branchRevision).toBe(2);
        expect(restoreResult.projectRevision).toBe(2);
        expect(restoreResult.value).toEqual({
          kind: 'artifact',
          artifactType: 'checkpoint',
          id: checkpointId,
          revision: null,
        });
      }

      // Verify the pre-restore state was saved as a checkpoint
      const cpRow = await db.checkpoints.get([projectId, checkpointId]);
      expect(cpRow).toBeDefined();
      expect(cpRow?.snapshotId).toBe(editedSnapshotId);
      expect(cpRow?.label).toBe('Saved before restore');

      // Verify branch now points to restored target snapshot
      const branchAfterRestore = await repo.loadBranch(projectId, draftBranchId);
      expect(branchAfterRestore?.workingSnapshotId).toBe(initialSnapshotId);
      expect(branchAfterRestore?.workingRevision).toBe(2);

      db.close();
    });

    it('restore checkpoints first then replaces atomically (injected failure between writes leaves nothing changed)', async () => {
      const db = createStudioDatabase(`test-restore-atomic-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, initialSnapshotId } = await createTestProject(repo);

      const checkpointId = crypto.randomUUID();
      const originalUpdate = db.branches.update;

      // Inject crash right after checkpoint is inserted, when branches.update is called
      let crashed = false;
      db.branches.update = (async () => {
        crashed = true;
        throw new Error('Simulated failure during branch replacement write');
      }) as any;

      const result = await repo.execute({
        commandId: 'history.restore',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          snapshotId: initialSnapshotId,
          checkpointId,
          label: 'Atomic Checkpoint',
        },
      });

      expect(crashed).toBe(true);
      expect(result.status).toBe('failed');

      // Restore update function
      db.branches.update = originalUpdate;

      // Verify transaction rolled back: no checkpoint was saved and branch was not updated
      const cpRow = await db.checkpoints.get([projectId, checkpointId]);
      expect(cpRow).toBeUndefined();

      const branch = await repo.loadBranch(projectId, draftBranchId);
      expect(branch?.workingRevision).toBe(0);
      expect(branch?.workingSnapshotId).toBe(initialSnapshotId);

      db.close();
    });
  });

  describe('branch.reopen', () => {
    it('happy path: closed non-main branch sets open, branch revision++, history and main unchanged', async () => {
      const db = createStudioDatabase(`test-reopen-happy-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId, mainBranchId, initialSnapshotId } = await createTestProject(repo);

      // Seed branch as closed (as if closed by publish)
      await db.branches.update([projectId, draftBranchId], {
        state: 'closed',
      });

      const branchClosed = await repo.loadBranch(projectId, draftBranchId);
      expect(branchClosed?.state).toBe('closed');
      expect(branchClosed?.workingRevision).toBe(0);

      const reopenCommand: BranchReopenCommand = {
        commandId: 'branch.reopen',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          expectedHeadId: null, // Draft branch is unborn with null head
        },
      };

      const result = await repo.execute(reopenCommand);
      expect(result.status).toBe('applied');
      if (result.status === 'applied') {
        expect(result.branchRevision).toBe(1);
        expect(result.projectRevision).toBe(1);
        expect(result.changedIds).toEqual([draftBranchId]);
        expect(result.value).toEqual({ kind: 'branch', branchId: draftBranchId });
      }

      // Branch state is now open
      const branchAfter = await repo.loadBranch(projectId, draftBranchId);
      expect(branchAfter?.state).toBe('open');
      expect(branchAfter?.workingRevision).toBe(1);

      // Main branch and history unchanged
      const mainAfter = await repo.loadBranch(projectId, mainBranchId);
      expect(mainAfter?.workingRevision).toBe(0);
      expect(mainAfter?.workingSnapshotId).toBe(initialSnapshotId);

      db.close();
    });

    it('rejects reopen on an already open branch with invalid status', async () => {
      const db = createStudioDatabase(`test-reopen-open-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId } = await createTestProject(repo);

      const result = await repo.execute({
        commandId: 'branch.reopen',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: { expectedHeadId: null },
      });

      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.issues[0].message).toContain('already open');
      }

      db.close();
    });

    it('rejects reopen on main branch with invalid status', async () => {
      const db = createStudioDatabase(`test-reopen-main-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, mainBranchId } = await createTestProject(repo);

      const result = await repo.execute({
        commandId: 'branch.reopen',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: { expectedHeadId: null },
      });

      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.issues[0].message).toContain('main');
      }

      db.close();
    });
  });

  describe('branch.switch controller', () => {
    it('flush failure keeps source branch active and returns typed failure naming flush-pending-save', async () => {
      const db = createStudioDatabase(`test-switch-flush-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

      const result = await switchBranch(
        { repo, currentBranchId: mainBranchId },
        { projectId, targetBranchId: draftBranchId },
        {
          flushPendingSave: async () => {
            throw new Error('Disk flush error');
          },
          resolveDraft: async () => 'clean',
        },
      );

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.step).toBe('flush-pending-save');
        expect(result.activeBranchId).toBe(mainBranchId);
        expect(result.reason).toContain('Disk flush error');
      }

      db.close();
    });

    it('stay resolution keeps source branch active and returns typed failure naming resolve-draft', async () => {
      const db = createStudioDatabase(`test-switch-stay-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

      const result = await switchBranch(
        { repo, currentBranchId: mainBranchId },
        { projectId, targetBranchId: draftBranchId },
        {
          flushPendingSave: async () => ({ ok: true }),
          resolveDraft: async () => 'stay',
        },
      );

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.step).toBe('resolve-draft');
        expect(result.activeBranchId).toBe(mainBranchId);
      }

      db.close();
    });

    it('load failure keeps source branch active and returns typed failure naming load-target-branch', async () => {
      const db = createStudioDatabase(`test-switch-load-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, mainBranchId } = await createTestProject(repo);

      const nonExistentTargetId = crypto.randomUUID();
      const result = await switchBranch(
        { repo, currentBranchId: mainBranchId },
        { projectId, targetBranchId: nonExistentTargetId },
        {
          flushPendingSave: async () => ({ ok: true }),
          resolveDraft: async () => 'clean',
        },
      );

      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.step).toBe('load-target-branch');
        expect(result.activeBranchId).toBe(mainBranchId);
      }

      db.close();
    });

    it('success loads target branch and returns done with target branch active', async () => {
      const db = createStudioDatabase(`test-switch-success-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

      const result = await switchBranch(
        { repo, currentBranchId: mainBranchId },
        { projectId, targetBranchId: draftBranchId },
        {
          flushPendingSave: async () => ({ ok: true }),
          resolveDraft: async () => 'clean',
        },
      );

      expect(result.status).toBe('done');
      if (result.status === 'done') {
        expect(result.activeBranchId).toBe(draftBranchId);
        expect(result.branch.id).toBe(draftBranchId);
        expect(result.value).toEqual({ kind: 'branch', branchId: draftBranchId });
      }

      db.close();
    });
  });

  describe('save failure recovery options helper', () => {
    it('provides structured recovery options for stale failures', () => {
      const options = getSaveFailureRecoveryOptions({
        status: 'stale',
        scope: 'branch',
        expected: 1,
        actual: 2,
      });

      expect(options.reason).toBe('stale');
      expect(options.keepInMemoryCopy).toBe(true);
      expect(options.options.map((o) => o.action)).toEqual(['reload', 'retry', 'export']);
    });

    it('provides structured recovery options for quota failures', () => {
      const options = getSaveFailureRecoveryOptions({
        status: 'failed',
        code: 'quota',
        issues: [],
      });

      expect(options.reason).toBe('quota');
      expect(options.keepInMemoryCopy).toBe(true);
      expect(options.options.map((o) => o.action)).toEqual(['export', 'retry', 'reload']);
    });
  });
});

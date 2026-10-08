import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import { computeSnapshotId } from './primitives';
import {
  PREFERENCES_SCHEMA,
  type Actor,
  type BranchCreateCommand,
  type ProjectCreateCommand,
  type ProjectRenameCommand,
} from './types';
import type { Document } from '../../domain/studio/model';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'src/features/entry/examples/s01.json'), 'utf8'),
) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Local Human User',
};

describe('LocalRepository', () => {
  describe('Preferences CAS', () => {
    it('loads a cloned preference record and returns null when none exists', async () => {
      const db = createStudioDatabase(`test-pref-load-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      expect(await repo.loadPreferences()).toBeNull();

      const value = { camera: { x: 100, y: 200, zoom: 1 } };
      expect((await repo.savePreferences(0, value)).status).toBe('applied');

      const first = await repo.loadPreferences();
      expect(first).toMatchObject({
        key: 'user',
        schema: PREFERENCES_SCHEMA,
        revision: 1,
        value,
      });

      (first!.value as { camera: { x: number } }).camera.x = -1;
      const second = await repo.loadPreferences();
      expect(second?.value).toEqual(value);
      expect(second).not.toBe(first);

      db.close();
    });

    it('manages preferences CAS independently of workingRevision with schema studio-preferences/1', async () => {
      const db = createStudioDatabase(`test-pref-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      // Create a project to monitor workingRevision
      const projectId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Project for Pref Test',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      const initialProject = await repo.loadProject(projectId);
      const initialBranch = await repo.loadBranch(projectId, initialProject!.mainBranchId);
      expect(initialBranch?.workingRevision).toBe(0);

      // 1. Initial write with expectedRevision 0 -> applied, revision 1
      const prefVal1 = { camera: { x: 100, y: 200, zoom: 1 } };
      const save1 = await repo.savePreferences(0, prefVal1);
      expect(save1.status).toBe('applied');
      if (save1.status === 'applied') {
        expect(save1.revision).toBe(1);
        expect(save1.value).toEqual(prefVal1);
      }

      // Check stored preference record
      const storedPref = await db.preferences.get('user');
      expect(storedPref?.schema).toBe(PREFERENCES_SCHEMA);
      expect(storedPref?.revision).toBe(1);
      expect(storedPref?.value).toEqual(prefVal1);

      // Verify branch workingRevision is completely untouched
      const branchAfter1 = await repo.loadBranch(projectId, initialProject!.mainBranchId);
      expect(branchAfter1?.workingRevision).toBe(0);

      // 2. Second write with expectedRevision 1 -> applied, revision 2
      const prefVal2 = { camera: { x: 150, y: 250, zoom: 1.2 } };
      const save2 = await repo.savePreferences(1, prefVal2);
      expect(save2.status).toBe('applied');
      if (save2.status === 'applied') {
        expect(save2.revision).toBe(2);
        expect(save2.value).toEqual(prefVal2);
      }

      // 3. Stale write with expectedRevision 1 (actual is now 2) -> stale
      const staleSave = await repo.savePreferences(1, { camera: { x: 0, y: 0, zoom: 1 } });
      expect(staleSave.status).toBe('stale');
      if (staleSave.status === 'stale') {
        expect(staleSave.scope).toBe('preferences');
        expect(staleSave.expected).toBe(1);
        expect(staleSave.actual).toBe(2);
      }

      // Verify workingRevision is still 0
      const branchAfterStale = await repo.loadBranch(projectId, initialProject!.mainBranchId);
      expect(branchAfterStale?.workingRevision).toBe(0);

      db.close();
    });
  });

  describe('project.create', () => {
    it('rejects an invalid document with invalid status and passes validator issues through', async () => {
      const db = createStudioDatabase(`test-create-invalid-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const invalidDoc = {
        ...s01Doc,
        schema: 'invalid-schema/99',
      } as any;

      const createCmd: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: crypto.randomUUID(),
          title: 'Invalid Doc Project',
          initialDocument: invalidDoc,
          mainBranchId: crypto.randomUUID(),
          draftBranchId: crypto.randomUUID(),
        },
      };

      const result = await repo.execute(createCmd);
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues.some((i) => i.path.includes('schema'))).toBe(true);
      }

      // Verify no records written
      const count = await db.projects.count();
      expect(count).toBe(0);

      db.close();
    });

    it('rejects missing or non-UUID branch IDs with invalid status and proper issue paths', async () => {
      const db = createStudioDatabase(`test-create-missing-ids-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      // Missing mainBranchId
      const missingMainResult = await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: crypto.randomUUID(),
          title: 'Test',
          initialDocument: s01Doc,
          draftBranchId: crypto.randomUUID(),
        } as any,
      });
      expect(missingMainResult.status).toBe('invalid');
      if (missingMainResult.status === 'invalid') {
        expect(missingMainResult.issues.some((i) => i.path.join('.') === 'payload.mainBranchId')).toBe(true);
      }

      // Non-UUID draftBranchId
      const nonUuidDraftResult = await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: crypto.randomUUID(),
          title: 'Test',
          initialDocument: s01Doc,
          mainBranchId: crypto.randomUUID(),
          draftBranchId: 'not-a-uuid',
        },
      });
      expect(nonUuidDraftResult.status).toBe('invalid');
      if (nonUuidDraftResult.status === 'invalid') {
        expect(nonUuidDraftResult.issues.some((i) => i.path.join('.') === 'payload.draftBranchId')).toBe(true);
      }

      db.close();
    });

    it('creates exactly the expected rows for valid document, with snapshot ID equal to content hash', async () => {
      const db = createStudioDatabase(`test-create-valid-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const opId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();

      const expectedSnapshotId = await computeSnapshotId(s01Doc);

      const createCmd: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: opId,
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Valid Studio Project',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      };

      const result = await repo.execute(createCmd);
      expect(result.status).toBe('applied');
      if (result.status === 'applied') {
        expect(result.operationId).toBe(opId);
        expect(result.projectRevision).toBe(0);
        expect(result.branchRevision).toBe(0);
        expect(result.value.kind).toBe('project');
        if (result.value.kind === 'project') {
          expect(result.value.projectId).toBe(projectId);
          expect(result.value.branchId).toBe(draftBranchId);
        }
      }

      // Introspect table counts: exactly 1 project, 2 branches (main + draft), 1 snapshot, 1 receipt
      expect(await db.projects.count()).toBe(1);
      expect(await db.branches.count()).toBe(2);
      expect(await db.snapshots.count()).toBe(1);
      expect(await db.operations.count()).toBe(1);
      expect(await db.commits.count()).toBe(0);
      expect(await db.publications.count()).toBe(0);
      expect(await db.checkpoints.count()).toBe(0);
      expect(await db.runs.count()).toBe(0);
      expect(await db.parts.count()).toBe(0);
      expect(await db.traceChunks.count()).toBe(0);

      // Verify snapshot id equals content hash
      const snapshot = await db.snapshots.get([projectId, expectedSnapshotId]);
      expect(snapshot).toBeDefined();
      expect(snapshot?.id).toBe(expectedSnapshotId);
      expect(snapshot?.document.id).toBe(s01Doc.id);

      // Verify project row
      const project = await repo.loadProject(projectId);
      expect(project?.id).toBe(projectId);
      expect(project?.title).toBe('Valid Studio Project');
      expect(project?.revision).toBe(0);
      expect(project?.initialSnapshotId).toBe(expectedSnapshotId);
      expect(project?.importSourceId).toBeNull();

      // Verify main branch
      const mainBranch = await repo.loadBranch(projectId, project!.mainBranchId);
      expect(mainBranch?.label).toBe('main');
      expect(mainBranch?.state).toBe('open');
      expect(mainBranch?.headCommitId).toBeNull();
      expect(mainBranch?.workingSnapshotId).toBe(expectedSnapshotId);
      expect(mainBranch?.workingRevision).toBe(0);

      // Verify loadProject returns cloned, frozen read-only records
      expect(Object.isFrozen(project)).toBe(true);

      db.close();
    });
  });

  describe('project.rename', () => {
    it('updates project title and active document title together via new snapshot; other branches untouched', async () => {
      const db = createStudioDatabase(`test-rename-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Original Title',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      const initialProject = await repo.loadProject(projectId);
      const initialSnapshotId = initialProject!.initialSnapshotId;

      // Create an auxiliary branch
      const auxBranchId = crypto.randomUUID();
      await repo.execute({
        commandId: 'branch.create',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: initialProject!.mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          newBranchId: auxBranchId,
          label: 'aux-branch',
          source: 'working',
          expectedHeadId: null,
        },
      });

      const projectAfterBranch = await repo.loadProject(projectId);
      expect(projectAfterBranch?.revision).toBe(1);

      // Rename project
      const renameCmd: ProjectRenameCommand = {
        commandId: 'project.rename',
        operationId: crypto.randomUUID(),
        projectId,
        expectedProjectRevision: 1,
        branchId: initialProject!.mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          title: 'Updated Global Title',
          expectedProjectRevision: 1,
        },
      };

      const renameResult = await repo.execute(renameCmd);
      expect(renameResult.status).toBe('applied');
      if (renameResult.status === 'applied') {
        expect(renameResult.projectRevision).toBe(2);
        expect(renameResult.branchRevision).toBe(1);
        expect(renameResult.value.kind).toBe('none');
      }

      // Verify project record title updated
      const updatedProject = await repo.loadProject(projectId);
      expect(updatedProject?.title).toBe('Updated Global Title');
      expect(updatedProject?.revision).toBe(2);

      // Verify active branch has new snapshot with updated title
      const updatedMain = await repo.loadBranch(projectId, initialProject!.mainBranchId);
      expect(updatedMain?.workingRevision).toBe(1);
      expect(updatedMain?.workingSnapshotId).not.toBe(initialSnapshotId);

      const updatedSnapshot = await db.snapshots.get([projectId, updatedMain!.workingSnapshotId]);
      expect(updatedSnapshot?.document.title).toBe('Updated Global Title');

      // Verify auxiliary branch was untouched
      const auxBranch = await repo.loadBranch(projectId, auxBranchId);
      expect(auxBranch?.workingSnapshotId).toBe(initialSnapshotId);
      expect(auxBranch?.workingRevision).toBe(0);

      const auxSnapshot = await db.snapshots.get([projectId, auxBranch!.workingSnapshotId]);
      expect(auxSnapshot?.document.title).toBe(s01Doc.title);

      db.close();
    });

    it('rejects missing or non-UUID branchId or missing revisions with invalid status', async () => {
      const db = createStudioDatabase(`test-rename-invalid-env-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Env Test',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      // Missing branchId
      const missingBranchResult = await repo.execute({
        commandId: 'project.rename',
        operationId: crypto.randomUUID(),
        projectId,
        expectedWorkingRevision: 0,
        expectedProjectRevision: 0,
        actor: testActor,
        payload: { title: 'New Title' },
      } as any);
      expect(missingBranchResult.status).toBe('invalid');
      if (missingBranchResult.status === 'invalid') {
        expect(missingBranchResult.issues.some((i) => i.path.join('.') === 'branchId')).toBe(true);
      }

      // Non-UUID branchId
      const nonUuidBranchResult = await repo.execute({
        commandId: 'project.rename',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: 'invalid-branch-uuid',
        expectedWorkingRevision: 0,
        expectedProjectRevision: 0,
        actor: testActor,
        payload: { title: 'New Title' },
      } as any);
      expect(nonUuidBranchResult.status).toBe('invalid');
      if (nonUuidBranchResult.status === 'invalid') {
        expect(nonUuidBranchResult.issues.some((i) => i.path.join('.') === 'branchId')).toBe(true);
      }

      // Missing expectedWorkingRevision
      const missingWorkingRevResult = await repo.execute({
        commandId: 'project.rename',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedProjectRevision: 0,
        actor: testActor,
        payload: { title: 'New Title' },
      } as any);
      expect(missingWorkingRevResult.status).toBe('invalid');
      if (missingWorkingRevResult.status === 'invalid') {
        expect(missingWorkingRevResult.issues.some((i) => i.path.join('.') === 'expectedWorkingRevision')).toBe(true);
      }

      // Missing expectedProjectRevision
      const missingProjRevResult = await repo.execute({
        commandId: 'project.rename',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: { title: 'New Title' },
      } as any);
      expect(missingProjRevResult.status).toBe('invalid');
      if (missingProjRevResult.status === 'invalid') {
        expect(missingProjRevResult.issues.some((i) => i.path.join('.') === 'expectedProjectRevision')).toBe(true);
      }

      db.close();
    });

    it('stale branch revision or project revision returns stale with scope branch or project', async () => {
      const db = createStudioDatabase(`test-rename-stale-scopes-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Stale Scopes Test',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      // 1. Stale project revision
      const staleProjResult = await repo.execute({
        commandId: 'project.rename',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        expectedProjectRevision: 99,
        actor: testActor,
        payload: { title: 'New Title' },
      });
      expect(staleProjResult.status).toBe('stale');
      if (staleProjResult.status === 'stale') {
        expect(staleProjResult.scope).toBe('project');
        expect(staleProjResult.expected).toBe(99);
        expect(staleProjResult.actual).toBe(0);
      }

      // 2. Stale branch revision
      const staleBranchResult = await repo.execute({
        commandId: 'project.rename',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 99,
        expectedProjectRevision: 0,
        actor: testActor,
        payload: { title: 'New Title' },
      });
      expect(staleBranchResult.status).toBe('stale');
      if (staleBranchResult.status === 'stale') {
        expect(staleBranchResult.scope).toBe('branch');
        expect(staleBranchResult.expected).toBe(99);
        expect(staleBranchResult.actual).toBe(0);
      }

      db.close();
    });
  });

  describe('branch.create', () => {
    it('creates branch from working content, copies ancestry, and increments project revision', async () => {
      const db = createStudioDatabase(`test-branch-create-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Branch Source Project',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      const project = await repo.loadProject(projectId);
      const newBranchId = crypto.randomUUID();

      const branchCmd: BranchCreateCommand = {
        commandId: 'branch.create',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: project!.mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          newBranchId,
          label: 'new-feature',
          source: 'working',
          expectedHeadId: null,
        },
      };

      const result = await repo.execute(branchCmd);
      expect(result.status).toBe('applied');
      if (result.status === 'applied') {
        expect(result.projectRevision).toBe(1);
        expect(result.branchRevision).toBe(0);
        expect(result.value.kind).toBe('branch');
        if (result.value.kind === 'branch') {
          expect(result.value.branchId).toBe(newBranchId);
        }
      }

      const newBranch = await repo.loadBranch(projectId, newBranchId);
      expect(newBranch?.label).toBe('new-feature');
      expect(newBranch?.state).toBe('open');
      expect(newBranch?.headCommitId).toBeNull();
      expect(newBranch?.workingSnapshotId).toBe(project!.initialSnapshotId);
      expect(newBranch?.workingRevision).toBe(0);

      // Source branch is untouched
      const mainBranch = await repo.loadBranch(projectId, project!.mainBranchId);
      expect(mainBranch?.workingRevision).toBe(0);

      db.close();
    });
  });

  describe('deleteProject', () => {
    it('deletes project with CAS on main branch head and returns missing on retry', async () => {
      const db = createStudioDatabase(`test-delete-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'To Be Deleted',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      // Stale delete attempt (wrong expectedMainHead)
      const staleDelete = await repo.deleteProject(projectId, 'wrong-head');
      expect(staleDelete.status).toBe('stale');

      // Valid delete (expectedMainHead: null)
      const validDelete = await repo.deleteProject(projectId, null);
      expect(validDelete.status).toBe('applied');
      if (validDelete.status === 'applied') {
        expect(validDelete.projectId).toBe(projectId);
      }

      // Verify all project records deleted
      expect(await repo.loadProject(projectId)).toBeNull();
      expect(await db.branches.where('projectId').equals(projectId).count()).toBe(0);
      expect(await db.snapshots.where('projectId').equals(projectId).count()).toBe(0);
      expect(await db.operations.where('projectId').equals(projectId).count()).toBe(0);

      // Retry delete on already absent project -> missing (missing/already-absent on retry)
      const retryDelete = await repo.deleteProject(projectId, null);
      expect(retryDelete.status).toBe('missing');
      if (retryDelete.status === 'missing') {
        expect(retryDelete.ids).toEqual([projectId]);
      }

      db.close();
    });
  });

  describe('Unsupported methods and commands', () => {
    it('returns typed missing/stale results for transfer methods called with unknown data', async () => {
      const db = createStudioDatabase(`test-unsupported-${crypto.randomUUID()}`);
      // A repository constructed WITH an injected mintId, so exportProject's 'missing'
      // path (unknown project) is exercised independently of the mintId gate below.
      const repo = new LocalRepository(db, { mintId: () => crypto.randomUUID() });

      // importProject: an unresolvable fileToken (never registered) is 'missing'.
      const importRes = await repo.importProject({
        commandId: 'project.import',
        operationId: crypto.randomUUID(),
        actor: { actorId: 'u1', kind: 'local-human', displayName: 'U' },
        payload: { fileToken: {}, newProjectId: crypto.randomUUID() },
      });
      expect(importRes.status).toBe('missing');

      // exportProject: an unknown project is 'missing'.
      const exportRes = await repo.exportProject({ projectId: 'p1', expectedProjectRevision: 0 });
      expect(exportRes.status).toBe('missing');

      // pruneUnreferenced: an unknown project is 'missing'.
      const pruneRes = await repo.pruneUnreferenced({
        projectId: 'p1',
        expectedProjectRevision: 0,
        selection: { runIds: [], traceRunIds: [], snapshotIds: [] },
      });
      expect(pruneRes.status).toBe('missing');

      const prepPublishCmd = await repo.execute({ commandId: 'history.prepare-publish' } as any);
      expect(prepPublishCmd.status).toBe('unsupported');

      db.close();
    });

    it('exportProject fails invalid naming mintId when constructed without one', async () => {
      const db = createStudioDatabase(`test-no-mintid-${crypto.randomUUID()}`);
      // No mintId injected -- there must be NO fallback of any kind (not even a
      // deterministic one): exportProject must refuse rather than invent a downloadId.
      const repo = new LocalRepository(db);
      const res = await repo.exportProject({ projectId: 'p1', expectedProjectRevision: 0 });
      expect(res.status).toBe('invalid');
      if (res.status === 'invalid') {
        expect(res.issues.some((i) => i.path.includes('mintId'))).toBe(true);
      }
      db.close();
    });
  });

  describe('Offline and credential-free', () => {
    it('contains no network calls, credentials or vendor IDs', () => {
      // Introspect source code of the persistence layer
      const srcFiles = ['types.ts', 'errors.ts', 'db.ts', 'limits.ts', 'primitives.ts', 'repository.ts', 'index.ts'];
      const dir = join(process.cwd(), 'src/persistence/studio');

      const forbiddenTokens = [
        'fetch(',
        'XMLHttpRequest',
        'WebSocket',
        'http://',
        'https://',
        'AWS',
        'GCP',
        'Azure',
        'apiKey',
        'secretKey',
        'accessToken',
      ];

      for (const file of srcFiles) {
        const content = readFileSync(join(dir, file), 'utf8');
        for (const token of forbiddenTokens) {
          expect(content).not.toContain(token);
        }
      }
    });
  });

  describe('listProjects', () => {
    it('returns empty array when no projects exist', async () => {
      const db = createStudioDatabase(`test-list-empty-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db, { mintId: () => crypto.randomUUID() });
      const projects = await repo.listProjects();
      expect(projects).toEqual([]);
      expect(Object.isFrozen(projects)).toBe(true);
      db.close();
    });

    it('returns cloned, read-only projects sorted by title then id', async () => {
      const db = createStudioDatabase(`test-list-sort-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db, { mintId: () => crypto.randomUUID() });

      const idB = '22222222-2222-4222-8222-222222222222';
      const idA2 = '11111111-1111-4111-8111-111111111112';
      const idA1 = '11111111-1111-4111-8111-111111111111';

      // Insert Project "Beta"
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: idB,
          title: 'Beta Project',
          initialDocument: s01Doc,
          mainBranchId: crypto.randomUUID(),
          draftBranchId: crypto.randomUUID(),
        },
      });

      // Insert Project "Alpha" with idA2
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: idA2,
          title: 'Alpha Project',
          initialDocument: s01Doc,
          mainBranchId: crypto.randomUUID(),
          draftBranchId: crypto.randomUUID(),
        },
      });

      // Insert Project "Alpha" with idA1
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: idA1,
          title: 'Alpha Project',
          initialDocument: s01Doc,
          mainBranchId: crypto.randomUUID(),
          draftBranchId: crypto.randomUUID(),
        },
      });

      const list = await repo.listProjects();
      expect(list.length).toBe(3);
      // Sorted by title then id:
      // 1. Alpha Project (idA1)
      // 2. Alpha Project (idA2)
      // 3. Beta Project (idB)
      expect(list[0].id).toBe(idA1);
      expect(list[0].title).toBe('Alpha Project');
      expect(list[1].id).toBe(idA2);
      expect(list[1].title).toBe('Alpha Project');
      expect(list[2].id).toBe(idB);
      expect(list[2].title).toBe('Beta Project');

      // Verify read-only / frozen
      expect(Object.isFrozen(list)).toBe(true);
      expect(Object.isFrozen(list[0])).toBe(true);

      db.close();
    });
  });
});

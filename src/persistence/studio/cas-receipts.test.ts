import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import type { Actor, BranchCreateCommand, ProjectCreateCommand, ProjectRenameCommand } from './types';
import type { Document } from '../../domain/studio/model';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

describe('CAS and Operation Receipts', () => {
  describe('Operation Receipts & Idempotency', () => {
    it('retry with same operationId + same content returns identical original result without new mutation', async () => {
      const db = createStudioDatabase(`test-receipt-idempotency-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const opId = crypto.randomUUID();

      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();

      const createCmd: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: opId,
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Idempotent Project',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      };

      // First execution
      const result1 = await repo.execute(createCmd);
      expect(result1.status).toBe('applied');

      const projectAfter1 = await repo.loadProject(projectId);
      expect(projectAfter1?.revision).toBe(0);

      const opCount1 = await db.operations.count();
      expect(opCount1).toBe(1);

      // Retry with same operationId + exact same content
      const result2 = await repo.execute(createCmd);
      expect(result2.status).toBe('applied');
      expect(result2).toEqual(result1);

      // Revisions and counts remain completely unchanged
      const projectAfter2 = await repo.loadProject(projectId);
      expect(projectAfter2?.revision).toBe(0);

      const opCount2 = await db.operations.count();
      expect(opCount2).toBe(1);

      db.close();
    });

    it('retry with same operationId + different content fails with operation-id-reused', async () => {
      const db = createStudioDatabase(`test-receipt-reused-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const opId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();

      const createCmd: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: opId,
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Project Initial Title',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      };

      const result1 = await repo.execute(createCmd);
      expect(result1.status).toBe('applied');

      // Now attempt to reuse opId with a different title/content
      const conflictingCmd: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: opId,
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Different Title Reusing Operation ID',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      };

      const result2 = await repo.execute(conflictingCmd);
      expect(result2.status).toBe('failed');
      if (result2.status === 'failed') {
        expect(result2.code).toBe('operation-id-reused');
        expect(result2.issues[0].code).toBe('duplicate-id');
      }

      db.close();
    });

    it('retry with same operationId + different IDs fails with operation-id-reused', async () => {
      const db = createStudioDatabase(`test-receipt-reused-ids-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const opId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();

      const createCmd1: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: opId,
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Initial Project',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      };

      const result1 = await repo.execute(createCmd1);
      expect(result1.status).toBe('applied');

      // Reusing same operationId with different branch IDs results in a different request hash
      const differentDraftBranchId = crypto.randomUUID();
      const createCmd2: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: opId,
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Initial Project',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId: differentDraftBranchId,
        },
      };

      const result2 = await repo.execute(createCmd2);
      expect(result2.status).toBe('failed');
      if (result2.status === 'failed') {
        expect(result2.code).toBe('operation-id-reused');
        expect(result2.issues[0].code).toBe('duplicate-id');
      }

      db.close();
    });

    it('retry is detected BEFORE the stale check', async () => {
      const db = createStudioDatabase(`test-retry-before-stale-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const createOpId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();

      // 1. Create project (rev 0)
      await repo.execute({
        commandId: 'project.create',
        operationId: createOpId,
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Project Title',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      // 2. Perform a rename (op A, expectedProjectRevision: 0) -> bumps project revision to 1
      const renameOpId = crypto.randomUUID();
      const renameCmd: ProjectRenameCommand = {
        commandId: 'project.rename',
        operationId: renameOpId,
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        expectedProjectRevision: 0,
        actor: testActor,
        payload: {
          title: 'New Renamed Title',
          expectedProjectRevision: 0,
        },
      };

      const renameResult1 = await repo.execute(renameCmd);
      expect(renameResult1.status).toBe('applied');
      if (renameResult1.status === 'applied') {
        expect(renameResult1.projectRevision).toBe(1);
      }

      const project = await repo.loadProject(projectId);
      expect(project?.revision).toBe(1);

      // 3. Now retry renameCmd (which still has expectedProjectRevision: 0).
      // If stale check ran first, it would fail with status: 'stale' because actual is 1.
      // But because retry check happens BEFORE stale check, it must succeed with the original result!
      const renameResult2 = await repo.execute(renameCmd);
      expect(renameResult2.status).toBe('applied');
      expect(renameResult2).toEqual(renameResult1);

      db.close();
    });
  });

  describe('Compare-and-Set (CAS)', () => {
    it('stale project revision returns stale with no partial writes', async () => {
      const db = createStudioDatabase(`test-cas-project-${crypto.randomUUID()}`);
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
          title: 'Project Rev 0',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      // Execute rename with wrong expected revision (e.g. 99 instead of 0)
      const renameCmd: ProjectRenameCommand = {
        commandId: 'project.rename',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        expectedProjectRevision: 99,
        actor: testActor,
        payload: {
          title: 'Should Not Persist',
          expectedProjectRevision: 99,
        },
      };

      const result = await repo.execute(renameCmd);
      expect(result.status).toBe('stale');
      if (result.status === 'stale') {
        expect(result.scope).toBe('project');
        expect(result.expected).toBe(99);
        expect(result.actual).toBe(0);
      }

      // Verify no changes were persisted
      const proj = await repo.loadProject(projectId);
      expect(proj?.title).toBe('Project Rev 0');
      expect(proj?.revision).toBe(0);

      db.close();
    });

    it('stale branch revision returns stale with no partial writes', async () => {
      const db = createStudioDatabase(`test-cas-branch-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();
      const createRes = await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Branch Test Project',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });
      expect(createRes.status).toBe('applied');

      // Attempt to create a branch from main with wrong expectedWorkingRevision (99 instead of 0)
      const branchCmd: BranchCreateCommand = {
        commandId: 'branch.create',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 99,
        actor: testActor,
        payload: {
          newBranchId: crypto.randomUUID(),
          label: 'feature-1',
          source: 'working',
          expectedHeadId: null,
        },
      };

      const result = await repo.execute(branchCmd);
      expect(result.status).toBe('stale');
      if (result.status === 'stale') {
        expect(result.scope).toBe('branch');
        expect(result.expected).toBe(99);
        expect(result.actual).toBe(0);
      }

      // Verify no new branch and project revision untouched
      const branchCount = await db.branches.where('projectId').equals(projectId).count();
      expect(branchCount).toBe(2); // main and draft only

      const projAfter = await repo.loadProject(projectId);
      expect(projAfter?.revision).toBe(0);

      db.close();
    });

    it('branch.create returns failed/conflict with HEAD_MOVED on head mismatch', async () => {
      const db = createStudioDatabase(`test-head-moved-${crypto.randomUUID()}`);
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
          title: 'Head Moved Project',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      const project = await repo.loadProject(projectId);
      expect(project?.mainBranchId).toBe(mainBranchId);

      // Source branch head is currently null (unborn), but command expects commit 'c-123'
      const branchCmd: BranchCreateCommand = {
        commandId: 'branch.create',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          newBranchId: crypto.randomUUID(),
          label: 'feature-moved',
          source: 'working',
          expectedHeadId: 'c-123',
        },
      };

      const result = await repo.execute(branchCmd);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.code).toBe('conflict');
        expect(result.issues[0].message).toContain('HEAD_MOVED');
      }

      db.close();
    });
  });
});

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import { type Actor, type BranchCreateCommand, type ProjectCreateCommand } from './types';
import type { Document } from '../../domain/studio/model';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

describe('Quota and Limits enforcement', () => {
  describe('Quota handling', () => {
    it('simulated QuotaExceededError maps to quota with no partial project', async () => {
      const db = createStudioDatabase(`test-quota-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();

      // Intercept db.branches.add to simulate a browser QuotaExceededError mid-project.create
      const originalAdd = db.branches.add.bind(db.branches);
      let callCount = 0;
      db.branches.add = (async (...args: any[]) => {
        callCount++;
        if (callCount === 1) {
          const quotaErr = new Error('QuotaExceededError: The quota has been exceeded');
          quotaErr.name = 'QuotaExceededError';
          throw quotaErr;
        }
        return originalAdd(...(args as [any]));
      }) as any;

      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();

      const createCmd: ProjectCreateCommand = {
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Quota Test Project',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      };

      const result = await repo.execute(createCmd);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.code).toBe('quota');
        expect(result.issues[0].code).toBe('too-large');
      }

      // Restore
      db.branches.add = originalAdd;

      // Verify no partial project or branches were persisted
      const loadedProject = await repo.loadProject(projectId);
      expect(loadedProject).toBeNull();

      const branchCount = await db.branches.where('projectId').equals(projectId).count();
      expect(branchCount).toBe(0);

      const snapshotCount = await db.snapshots.where('projectId').equals(projectId).count();
      expect(snapshotCount).toBe(0);

      db.close();
    });
  });

  describe('Count limits', () => {
    it('rejects creating more than 100 branches per project with limit before mutation', async () => {
      const db = createStudioDatabase(`test-branch-limit-${crypto.randomUUID()}`);
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
          title: 'Branch Limit Test',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      const project = await repo.loadProject(projectId);
      expect(project?.mainBranchId).toBe(mainBranchId);

      // Current count is 2 (main + draft).
      // Pre-seed 98 more branches to reach exactly 100 branches (the limit).
      const now = Date.now();
      for (let i = 3; i <= 100; i++) {
        await db.branches.add({
          projectId,
          id: `branch-${i}`,
          label: `Branch ${i}`,
          state: 'open',
          headCommitId: null,
          workingSnapshotId: project!.initialSnapshotId,
          workingRevision: 0,
          createdAt: now,
        });
      }

      const totalBranches = await db.branches.where('projectId').equals(projectId).count();
      expect(totalBranches).toBe(100);

      // Attempt to create the 101st branch via branch.create
      const branch101Cmd: BranchCreateCommand = {
        commandId: 'branch.create',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          newBranchId: crypto.randomUUID(),
          label: 'Branch 101 Over Limit',
          source: 'working',
          expectedHeadId: null,
        },
      };

      const result = await repo.execute(branch101Cmd);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.code).toBe('limit');
        expect(result.issues[0].code).toBe('too-many');
        expect(result.issues[0].message).toContain('100');
      }

      // Verify count is still exactly 100
      const finalCount = await db.branches.where('projectId').equals(projectId).count();
      expect(finalCount).toBe(100);

      // Verify project revision was not bumped
      const finalProject = await repo.loadProject(projectId);
      expect(finalProject?.revision).toBe(0);

      db.close();
    });
  });

  describe('Byte accounting and capacity limits', () => {
    it('rejects a write that would exceed the 128 MiB local cap or 64 MiB export cap before mutation', async () => {
      const db = createStudioDatabase(`test-byte-limit-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);

      const projectId = crypto.randomUUID();

      // Seed a project near the 64 MiB export ceiling
      const mainBranchId = crypto.randomUUID();
      const draftBranchId = crypto.randomUUID();
      await repo.execute({
        commandId: 'project.create',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: {
          newProjectId: projectId,
          title: 'Byte Cap Test',
          initialDocument: s01Doc,
          mainBranchId,
          draftBranchId,
        },
      });

      // Insert large snapshots to push total export bytes over 64 MiB (67,108,864 bytes).
      const largePadding = 'x'.repeat(15 * 1024 * 1024); // 15 MB string
      for (let i = 0; i < 5; i++) {
        await db.snapshots.add({
          projectId,
          id: `large-snap-${i}`,
          document: { ...s01Doc, title: `Snapshot ${i}`, description: largePadding } as any,
        });
      }

      // Now attempting branch.create or project.rename that adds bytes exceeding the export cap must fail with limit
      const project = await repo.loadProject(projectId);
      const branchCmd: BranchCreateCommand = {
        commandId: 'branch.create',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: project!.mainBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          newBranchId: crypto.randomUUID(),
          label: 'Branch Over Byte Cap',
          source: 'working',
          expectedHeadId: null,
        },
      };

      const result = await repo.execute(branchCmd);
      expect(result.status).toBe('failed');
      if (result.status === 'failed') {
        expect(result.code).toBe('limit');
        expect(result.issues[0].code).toBe('too-large');
        expect(result.issues[0].message).toContain('64 MiB');
      }

      db.close();
    }, 20000);
  });
});

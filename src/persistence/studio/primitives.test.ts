import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStudioDatabase } from './db';
import { insertImmutable, validateActor } from './primitives';
import { RepositoryError } from './errors';
import type { SnapshotRecord } from './types';
import type { Document } from '../../domain/studio/model';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
) as Document;

describe('Persistence primitives', () => {
  describe('insertImmutable', () => {
    it('equal re-insert is a no-op and never overwrites', async () => {
      const db = createStudioDatabase(`test-immutable-equal-${crypto.randomUUID()}`);
      await db.open();

      const snapshot: SnapshotRecord = {
        projectId: 'p1',
        id: 'hash1',
        document: s01Doc,
      };

      // First insert
      await insertImmutable(db.snapshots, snapshot, ['p1', 'hash1']);
      const count1 = await db.snapshots.count();
      expect(count1).toBe(1);

      // Second identical insert -> must be a no-op
      await insertImmutable(db.snapshots, structuredClone(snapshot), ['p1', 'hash1']);
      const count2 = await db.snapshots.count();
      expect(count2).toBe(1);

      const stored = await db.snapshots.get(['p1', 'hash1']);
      expect(stored?.document.title).toBe(s01Doc.title);

      db.close();
    });

    it('conflicting re-insert fails with invalid and original row is unchanged', async () => {
      const db = createStudioDatabase(`test-immutable-conflict-${crypto.randomUUID()}`);
      await db.open();

      const original: SnapshotRecord = {
        projectId: 'p1',
        id: 'hash1',
        document: s01Doc,
      };

      await insertImmutable(db.snapshots, original, ['p1', 'hash1']);

      // Attempt to insert with same key but different document
      const conflictingDoc: Document = {
        ...s01Doc,
        title: 'Conflicting Title',
      };
      const conflicting: SnapshotRecord = {
        projectId: 'p1',
        id: 'hash1',
        document: conflictingDoc,
      };

      let threw = false;
      try {
        await insertImmutable(db.snapshots, conflicting, ['p1', 'hash1']);
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(RepositoryError);
        expect((err as RepositoryError).code).toBe('invalid');
      }

      expect(threw).toBe(true);

      // Verify original is still intact and unchanged
      const stored = await db.snapshots.get(['p1', 'hash1']);
      expect(stored?.document.title).toBe(s01Doc.title);

      db.close();
    });
  });

  describe('aborted transaction rollback', () => {
    it('aborted transaction (mid-transaction failure) leaves all old rows intact', async () => {
      const db = createStudioDatabase(`test-abort-${crypto.randomUUID()}`);
      await db.open();

      // Seed with initial project and branch
      await db.projects.add({
        id: 'p1',
        title: 'Initial Project',
        revision: 0,
        mainBranchId: 'b1',
        initialSnapshotId: 's1',
        importSourceId: null,
        createdAt: 100,
        updatedAt: 100,
      });

      await db.branches.add({
        projectId: 'p1',
        id: 'b1',
        label: 'main',
        state: 'open',
        headCommitId: null,
        workingSnapshotId: 's1',
        workingRevision: 0,
        createdAt: 100,
      });

      // Execute a transaction that modifies project and adds a branch, but then throws
      let txError: unknown;
      try {
        await db.transaction('rw', [db.projects, db.branches], async () => {
          // Mutate project
          await db.projects.update('p1', { title: 'Corrupted Project', revision: 5 });

          // Add a new branch
          await db.branches.add({
            projectId: 'p1',
            id: 'b2',
            label: 'uncommitted',
            state: 'open',
            headCommitId: null,
            workingSnapshotId: 's2',
            workingRevision: 0,
            createdAt: 200,
          });

          // Simulate mid-transaction failure
          throw new Error('Simulated failure before transaction commit');
        });
      } catch (err) {
        txError = err;
      }

      expect(txError).toBeDefined();

      // Verify all old rows are intact
      const project = await db.projects.get('p1');
      expect(project?.title).toBe('Initial Project');
      expect(project?.revision).toBe(0);

      // Verify the new branch was not persisted
      const b2 = await db.branches.get(['p1', 'b2']);
      expect(b2).toBeUndefined();

      const branchCount = await db.branches.where('projectId').equals('p1').count();
      expect(branchCount).toBe(1);

      db.close();
    });
  });

  describe('validateActor', () => {
    it('accepts local-human kind with valid id and display name', () => {
      const issues = validateActor({
        actorId: 'user-1',
        kind: 'local-human',
        displayName: 'Alice',
      });
      expect(issues).toBeNull();
    });

    it('rejects unknown or invalid actor kinds', () => {
      const issues = validateActor({
        actorId: 'user-1',
        kind: 'ai-agent',
        displayName: 'Bot',
      });
      expect(issues).not.toBeNull();
      expect(issues![0].code).toBe('invalid-literal');
    });

    it('rejects empty actorId or non-object actor', () => {
      expect(validateActor(null)).not.toBeNull();
      expect(validateActor({ actorId: '', kind: 'local-human', displayName: 'A' })).not.toBeNull();
    });
  });
});

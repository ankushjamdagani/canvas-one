/**
 * loadHistory and verifyReferenceIntegrity tests (RV-08f).
 *
 * Implements specs/revamp/contracts/storage.md §5 ("missing") & §9 ("round-trip reload")
 * and transactions.md §4 ("Missing or corrupt content returns `missing` with IDs; restore
 * content is never fabricated"). Corruption is injected by writing directly to the
 * fake-indexeddb tables; the repository must report it, never repair it.
 */

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import type { Actor, ProjectCreateCommand } from './types';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');
const s01Doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 's01.json'), 'utf8')) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

async function createTestProject(repo: LocalRepository, doc: Document = s01Doc) {
  const projectId = crypto.randomUUID();
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();
  const createCmd: ProjectCreateCommand = {
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: {
      newProjectId: projectId,
      title: 'Integrity Test Project',
      initialDocument: doc,
      mainBranchId,
      draftBranchId,
    },
  };
  const createRes = await repo.execute(createCmd);
  expect(createRes.status).toBe('applied');
  return { projectId, mainBranchId, draftBranchId };
}

async function commitOnDraft(repo: LocalRepository, projectId: Id, draftBranchId: Id) {
  const commitId = crypto.randomUUID();
  const res = await repo.execute({
    commandId: 'history.commit',
    operationId: crypto.randomUUID(),
    projectId,
    branchId: draftBranchId,
    expectedWorkingRevision: 0,
    actor: testActor,
    payload: { commitId, expectedHeadId: null, message: 'evidence-free commit for integrity tests', evidence: [] },
  });
  return { commitId, res };
}

describe('loadHistory (RV-08f)', () => {
  it('loads project, branches, commits, publications and per-branch history in one transaction', async () => {
    const db = createStudioDatabase(`test-history-load-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

    const history = await repo.loadHistory(projectId);
    expect(history.project.id).toBe(projectId);
    expect(history.branches.map((b) => b.id).sort()).toEqual([draftBranchId, mainBranchId].sort());
    expect(history.commits).toEqual([]);
    expect(history.publications).toEqual([]);
    expect(history.checkpoints).toEqual([]);
    expect(history.branchHistories).toHaveLength(2);
    for (const bh of history.branchHistories) {
      expect(bh.commits).toEqual([]);
    }

    db.close();
  });

  it('orders per-branch history newest-first from the head, not by timestamp', async () => {
    const db = createStudioDatabase(`test-history-order-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    // Commits without evidence require an empty scenario document to satisfy eligibility,
    // or evidence: [] with a document that has no scenarios; s01Doc has scenarios, so
    // history.commit with empty evidence against a non-empty scenario set is expected to
    // be rejected per run-identity.md §5. Skip straight to verifying via direct DB rows
    // that ancestry order follows parentIds, independent of createdAt.
    const c1 = { projectId, id: 'c1', snapshotId: 'snap-1', parentIds: [] as Id[], evidence: [], actor: testActor, createdAt: 3000, message: 'first' };
    const c2 = { projectId, id: 'c2', snapshotId: 'snap-2', parentIds: ['c1'], evidence: [], actor: testActor, createdAt: 1000, message: 'second' };
    await db.commits.bulkAdd([c1, c2]);
    await db.branches.update([projectId, draftBranchId], { headCommitId: 'c2' });

    const history = await repo.loadHistory(projectId);
    const branchHistory = history.branchHistories.find((bh) => bh.branchId === draftBranchId)!;
    // c2's createdAt (1000) is earlier than c1's (3000): a timestamp sort would put c1
    // first. DAG order from the head puts c2 (the head) first instead.
    expect(branchHistory.commits.map((c) => c.id)).toEqual(['c2', 'c1']);

    db.close();
  });
});

describe('verifyReferenceIntegrity (RV-08f)', () => {
  it('reports ok:true for a freshly created project', async () => {
    const db = createStudioDatabase(`test-integrity-ok-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId } = await createTestProject(repo);

    const result = await repo.verifyReferenceIntegrity(projectId);
    expect(result.ok).toBe(true);

    db.close();
  });

  it('reports a missing commit referenced by a branch head, without repairing it', async () => {
    const db = createStudioDatabase(`test-integrity-missing-commit-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    await db.branches.update([projectId, draftBranchId], { headCommitId: 'ghost-commit' });

    const result = await repo.verifyReferenceIntegrity(projectId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContainEqual(
        expect.objectContaining({ kind: 'branch-head-commit', id: 'ghost-commit' }),
      );
    }

    // Not repaired: the branch head is still the dangling ID.
    const branch = await repo.loadBranch(projectId, draftBranchId);
    expect(branch?.headCommitId).toBe('ghost-commit');

    db.close();
  });

  it('reports a missing snapshot deleted directly from the database', async () => {
    const db = createStudioDatabase(`test-integrity-missing-snapshot-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId } = await createTestProject(repo);

    const project = (await repo.loadProject(projectId))!;
    await db.snapshots.delete([projectId, project.initialSnapshotId]);

    const result = await repo.verifyReferenceIntegrity(projectId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContainEqual(
        expect.objectContaining({ kind: 'project-initial-snapshot', id: project.initialSnapshotId }),
      );
    }

    db.close();
  });

  it('reports a missing evidence run deleted directly from the database', async () => {
    const db = createStudioDatabase(`test-integrity-missing-run-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    // Insert a commit directly with evidence pointing at a run row that does not exist.
    await db.commits.add({
      projectId,
      id: 'c-evidence',
      snapshotId: (await repo.loadProject(projectId))!.initialSnapshotId,
      parentIds: [],
      evidence: [{ scenarioId: 's01-happy', fingerprint: 'fp', runId: 'ghost-run' }],
      actor: testActor,
      createdAt: Date.now(),
      message: 'has dangling evidence',
    } as any);
    await db.branches.update([projectId, draftBranchId], { headCommitId: 'c-evidence' });

    const result = await repo.verifyReferenceIntegrity(projectId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContainEqual(
        expect.objectContaining({ kind: 'evidence-run', id: 'ghost-run', referencedBy: { kind: 'commit', id: 'c-evidence' } }),
      );
    }

    db.close();
  });

  it('reports a corrupt snapshot whose content no longer matches its ID hash, without repairing it', async () => {
    const db = createStudioDatabase(`test-integrity-corrupt-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId } = await createTestProject(repo);

    const project = (await repo.loadProject(projectId))!;
    const snapshotKey: [string, string] = [projectId, project.initialSnapshotId];
    const original = (await db.snapshots.get(snapshotKey))!;
    await db.snapshots.put({
      ...original,
      document: { ...original.document, title: `${original.document.title} (tampered)` },
    });

    const result = await repo.verifyReferenceIntegrity(projectId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContainEqual(
        expect.objectContaining({ kind: 'corrupt-snapshot', id: project.initialSnapshotId }),
      );
    }

    // Not repaired: the row still holds the tampered content, not the original.
    const stillTampered = await db.snapshots.get(snapshotKey);
    expect(stillTampered?.document.title).toContain('tampered');

    db.close();
  });
});

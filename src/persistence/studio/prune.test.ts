/**
 * pruneUnreferenced tests (RV-16b, storage.md §7).
 *
 * "Any selected pinned run or snapshot -> failed/referenced-artifact with IDs, and
 *  nothing deleted." / "traceRunIds deletes those runs' trace chunks and sets traceState
 *  'pruned' only; checks, status and summary are unchanged." / "A snapshot is deleted only
 *  if unpinned after the recheck." / "Already-absent IDs on retry -> a missing/already-
 *  absent result, not an error."
 *
 * CONTRACT GAP: the task's TESTS section lists "a pinned run -> referenced-artifact"
 * without distinguishing `runIds` (full delete) from `traceRunIds` (trace-only). Narrowest
 * reading chosen: a pinned run is rejected from EITHER selection list, since storage.md
 * §7's evidence-pinning guarantee is about the run record as a whole, not specifically
 * about its trace bytes -- see the longer comment in repository.ts's `pruneUnreferenced`.
 */

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { prepareScenario } from '../../domain/studio/runner/compile';
import { runScenario } from '../../domain/studio/runner/scenario-runner';
import { createStudioDatabase, DB_NAME } from './db';
import { computeSnapshotId } from './primitives';
import { LocalRepository } from './repository';
import { mintRunStartToken } from './token';
import { DEFAULT_BUILD_VERSIONS, type Actor, type ProjectCreateCommand } from './types';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');
const s01Doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 's01.json'), 'utf8')) as Document;

const testActor: Actor = { actorId: 'test-user', kind: 'local-human', displayName: 'Test User' };

async function runAndSaveScenario(repo: LocalRepository, projectId: Id, doc: Document, scenarioId: Id) {
  const snapshotId = await computeSnapshotId(doc);
  const prep = await prepareScenario(
    { id: snapshotId, document: doc },
    scenarioId,
    new AbortController().signal,
    DEFAULT_BUILD_VERSIONS,
  );
  if (prep.status !== 'ready') throw new Error(`prepareScenario failed: ${JSON.stringify(prep)}`);
  const runId = crypto.randomUUID();
  const runResult = await runScenario(doc, scenarioId, runId);
  const token = mintRunStartToken({
    projectId,
    runId,
    snapshotId,
    manifest: prep.manifest,
    fingerprint: prep.fingerprint,
    document: doc,
  });
  const terminalResult = { ...runResult, runId, fingerprint: prep.fingerprint, snapshotId };
  const saveRes = await repo.saveRun(token, terminalResult, runResult.events, { projectId, document: doc });
  if (saveRes.status !== 'applied') throw new Error(`saveRun failed: ${JSON.stringify(saveRes)}`);
  return { scenarioId, fingerprint: prep.fingerprint, runId, snapshotId };
}

async function setup() {
  const dbName = `${DB_NAME}-prune-${crypto.randomUUID()}`;
  const db = createStudioDatabase(dbName);
  const repo = new LocalRepository(db);

  const projectId = crypto.randomUUID();
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();
  const createCmd: ProjectCreateCommand = {
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: { newProjectId: projectId, title: 'Prune Test Project', initialDocument: s01Doc, mainBranchId, draftBranchId },
  };
  expect((await repo.execute(createCmd)).status).toBe('applied');

  // Eligibility requires evidence for EVERY scenario in the document (run-identity.md §5:
  // "no required subset"), so all 3 s01 scenarios are run and committed as pinned evidence.
  const pinnedEvidence = [];
  for (const scenario of s01Doc.scenarios) {
    pinnedEvidence.push(await runAndSaveScenario(repo, projectId, s01Doc, scenario.id));
  }

  const draftBranch = (await repo.loadBranch(projectId, draftBranchId))!;
  const commitId = crypto.randomUUID();
  const commitRes = await repo.execute({
    commandId: 'history.commit',
    operationId: crypto.randomUUID(),
    projectId,
    branchId: draftBranchId,
    expectedWorkingRevision: draftBranch.workingRevision,
    actor: testActor,
    payload: {
      commitId,
      expectedHeadId: draftBranch.headCommitId,
      message: 'pin all scenario runs',
      evidence: pinnedEvidence.map((e) => ({ scenarioId: e.scenarioId, fingerprint: e.fingerprint, runId: e.runId })),
    },
  });
  expect(commitRes.status).toBe('applied');

  // A second, unpinned run against a document with a different (presentation-only) title,
  // so it gets its own snapshot referenced by nothing else.
  const doc2: Document = { ...s01Doc, title: `${s01Doc.title} (mutated)` };
  const unpinnedEvidence = await runAndSaveScenario(repo, projectId, doc2, s01Doc.scenarios[0].id);

  return {
    db,
    repo,
    projectId,
    pinnedRunId: pinnedEvidence[0].runId,
    unpinnedRunId: unpinnedEvidence.runId,
    unpinnedSnapshotId: unpinnedEvidence.snapshotId,
  };
}

describe('pruneUnreferenced (RV-16b, storage.md §7)', () => {
  it('rejects selecting a pinned run for deletion, deleting nothing', async () => {
    const { db, repo, projectId, pinnedRunId } = await setup();
    const project = (await repo.loadProject(projectId))!;
    const res = await repo.pruneUnreferenced({
      projectId,
      expectedProjectRevision: project.revision,
      selection: { runIds: [pinnedRunId], traceRunIds: [], snapshotIds: [] },
    });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.code).toBe('referenced-artifact');
      expect(res.issues.some((i) => i.entityId === pinnedRunId)).toBe(true);
    }
    // Nothing deleted; run and project revision unchanged.
    expect(await repo.loadRun(projectId, pinnedRunId)).not.toBeNull();
    const projectAfter = (await repo.loadProject(projectId))!;
    expect(projectAfter.revision).toBe(project.revision);
    db.close();
  });

  it('allows trace-only pruning of a PINNED run: chunks go, row/checks/status/summary stay (review round 1, item 3)', async () => {
    const { db, repo, projectId, pinnedRunId } = await setup();
    const before = (await repo.loadRun(projectId, pinnedRunId))!;
    const project = (await repo.loadProject(projectId))!;
    const res = await repo.pruneUnreferenced({
      projectId,
      expectedProjectRevision: project.revision,
      selection: { runIds: [], traceRunIds: [pinnedRunId], snapshotIds: [] },
    });
    // storage.md §7: "Pruning trace chunks changes only traceState, never checks or
    // status" -- pinning protects the run ROW, not its trace bytes, so trace-only pruning
    // of a pinned run is allowed, never referenced-artifact.
    expect(res.status).toBe('applied');
    if (res.status === 'applied') {
      expect(res.tracePrunedRunIds).toEqual([pinnedRunId]);
    }
    const after = (await repo.loadRun(projectId, pinnedRunId))!;
    expect(after.traceState).toBe('pruned');
    expect(after.checks).toEqual(before.checks);
    expect(after.status).toEqual(before.status);
    expect(after.summary).toEqual(before.summary);
    const chunkCount = await db.traceChunks.where('[projectId+runId]').equals([projectId, pinnedRunId]).count();
    expect(chunkCount).toBe(0);
    db.close();
  });

  it('still rejects selecting a pinned run for FULL row deletion via runIds', async () => {
    const { db, repo, projectId, pinnedRunId } = await setup();
    const project = (await repo.loadProject(projectId))!;
    const res = await repo.pruneUnreferenced({
      projectId,
      expectedProjectRevision: project.revision,
      selection: { runIds: [pinnedRunId], traceRunIds: [], snapshotIds: [] },
    });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') expect(res.code).toBe('referenced-artifact');
    expect(await repo.loadRun(projectId, pinnedRunId)).not.toBeNull();
    db.close();
  });

  it('prunes only the trace of an unpinned run, keeping checks/status/summary', async () => {
    const { db, repo, projectId, unpinnedRunId } = await setup();
    const before = (await repo.loadRun(projectId, unpinnedRunId))!;
    const project = (await repo.loadProject(projectId))!;

    const res = await repo.pruneUnreferenced({
      projectId,
      expectedProjectRevision: project.revision,
      selection: { runIds: [], traceRunIds: [unpinnedRunId], snapshotIds: [] },
    });
    expect(res.status).toBe('applied');
    if (res.status === 'applied') {
      expect(res.tracePrunedRunIds).toEqual([unpinnedRunId]);
      expect(res.projectRevision).toBe(project.revision + 1);
    }

    const after = (await repo.loadRun(projectId, unpinnedRunId))!;
    expect(after.traceState).toBe('pruned');
    expect(after.checks).toEqual(before.checks);
    expect(after.status).toEqual(before.status);
    expect(after.summary).toEqual(before.summary);

    const chunkCount = await db.traceChunks.where('[projectId+runId]').equals([projectId, unpinnedRunId]).count();
    expect(chunkCount).toBe(0);

    db.close();
  });

  it('deletes an unpinned run and releases its only-referencing snapshot in one call', async () => {
    const { db, repo, projectId, unpinnedRunId, unpinnedSnapshotId } = await setup();
    const project = (await repo.loadProject(projectId))!;

    const res = await repo.pruneUnreferenced({
      projectId,
      expectedProjectRevision: project.revision,
      selection: { runIds: [unpinnedRunId], traceRunIds: [], snapshotIds: [unpinnedSnapshotId] },
    });
    expect(res.status).toBe('applied');
    if (res.status === 'applied') {
      expect(res.deletedRunIds).toEqual([unpinnedRunId]);
      expect(res.deletedSnapshotIds).toEqual([unpinnedSnapshotId]);
      expect(res.alreadyAbsentIds).toEqual([]);
    }

    expect(await repo.loadRun(projectId, unpinnedRunId)).toBeNull();
    expect(await repo.loadSnapshot(projectId, unpinnedSnapshotId)).toBeNull();

    // Retry with the same (now-absent) IDs -> missing/already-absent, not an error.
    const projectAfter = (await repo.loadProject(projectId))!;
    const retry = await repo.pruneUnreferenced({
      projectId,
      expectedProjectRevision: projectAfter.revision,
      selection: { runIds: [unpinnedRunId], traceRunIds: [], snapshotIds: [unpinnedSnapshotId] },
    });
    expect(retry.status).toBe('applied');
    if (retry.status === 'applied') {
      expect([...retry.alreadyAbsentIds].sort()).toEqual([unpinnedRunId, unpinnedSnapshotId].sort());
      expect(retry.deletedRunIds).toEqual([]);
      expect(retry.deletedSnapshotIds).toEqual([]);
    }

    db.close();
  });

  it('rejects a stale expectedProjectRevision', async () => {
    const { db, repo, projectId } = await setup();
    const project = (await repo.loadProject(projectId))!;
    const res = await repo.pruneUnreferenced({
      projectId,
      expectedProjectRevision: project.revision + 1,
      selection: { runIds: [], traceRunIds: [], snapshotIds: [] },
    });
    expect(res.status).toBe('stale');
    db.close();
  });
});

/**
 * Recovery journey integration tests (RV-16b task prompt, item 6).
 *
 * (a) saveRun at the 21st unpinned run fails typed -> prune one selected unpinned run ->
 *     the retry of the same save succeeds.
 * (b) a quota failure on model.apply-records (simulated the same way as RV-08b's own
 *     tests) -> the branch's stored working state is untouched -> exportProject still
 *     succeeds -> import into a fresh project -> loadHistory is equal modulo projectId,
 *     importSourceId, revision and run provenance/traceState.
 * (c) deleteProject with a stale expected main head -> rejected; a correct one ->
 *     removed; a retry -> already-absent.
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

async function createTestProject(repo: LocalRepository) {
  const projectId = crypto.randomUUID();
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();
  const createCmd: ProjectCreateCommand = {
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: { newProjectId: projectId, title: 'Recovery Test Project', initialDocument: s01Doc, mainBranchId, draftBranchId },
  };
  const res = await repo.execute(createCmd);
  expect(res.status).toBe('applied');
  return { projectId, mainBranchId, draftBranchId };
}

async function prepareRunSave(repo: LocalRepository, projectId: Id, doc: Document, scenarioId: Id) {
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
  return { token, terminalResult, chunks: runResult.events, runId };
}

async function runAndSaveScenario(repo: LocalRepository, projectId: Id, doc: Document, scenarioId: Id) {
  const prepared = await prepareRunSave(repo, projectId, doc, scenarioId);
  const saveRes = await repo.saveRun(prepared.token, prepared.terminalResult, prepared.chunks, { projectId, document: doc });
  if (saveRes.status !== 'applied') throw new Error(`saveRun failed: ${JSON.stringify(saveRes)}`);
  return prepared.runId;
}

describe('Recovery journeys (RV-16b)', () => {
  it('(a) 21st unpinned run fails typed limit; pruning one selected run lets the retry succeed', async () => {
    const dbName = `${DB_NAME}-recovery-a-${crypto.randomUUID()}`;
    const db = createStudioDatabase(dbName);
    const repo = new LocalRepository(db);
    const { projectId } = await createTestProject(repo);
    const scenarioId = s01Doc.scenarios[0].id;

    const runIds: Id[] = [];
    for (let i = 0; i < 20; i++) {
      runIds.push(await runAndSaveScenario(repo, projectId, s01Doc, scenarioId));
    }
    expect(runIds.length).toBe(20);

    // The 21st unpinned run fails typed with 'limit' (storage.md §7: "Before storing a
    // 21st, offer an explicit prune").
    const prepared21 = await prepareRunSave(repo, projectId, s01Doc, scenarioId);
    const firstAttempt = await repo.saveRun(prepared21.token, prepared21.terminalResult, prepared21.chunks, {
      projectId,
      document: s01Doc,
    });
    expect(firstAttempt.status).toBe('failed');
    if (firstAttempt.status === 'failed') {
      expect(firstAttempt.code).toBe('limit');
    }
    expect(await repo.loadRun(projectId, prepared21.runId)).toBeNull();

    // Prune one selected unpinned run (none of the 20 are pinned -- no commit references
    // any of them).
    const project = (await repo.loadProject(projectId))!;
    const pruneRes = await repo.pruneUnreferenced({
      projectId,
      expectedProjectRevision: project.revision,
      selection: { runIds: [runIds[0]], traceRunIds: [], snapshotIds: [] },
    });
    expect(pruneRes.status).toBe('applied');
    if (pruneRes.status === 'applied') {
      expect(pruneRes.deletedRunIds).toEqual([runIds[0]]);
    }

    // The retry of the SAME save now succeeds.
    const retryAttempt = await repo.saveRun(prepared21.token, prepared21.terminalResult, prepared21.chunks, {
      projectId,
      document: s01Doc,
    });
    expect(retryAttempt.status).toBe('applied');
    expect(await repo.loadRun(projectId, prepared21.runId)).not.toBeNull();

    db.close();
  });

  it('(b) quota failure on model.apply-records leaves stored state untouched; export/import still round-trips', async () => {
    const dbName = `${DB_NAME}-recovery-b-${crypto.randomUUID()}`;
    const db = createStudioDatabase(dbName);
    const repo = new LocalRepository(db, { mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branchBefore = (await repo.loadBranch(projectId, draftBranchId))!;

    // Simulate a browser QuotaExceededError mid-transaction (same technique as RV-08b's
    // own working-copies.test.ts "a quota failure during apply-records" case).
    const originalAdd = db.snapshots.add;
    db.snapshots.add = (async () => {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }) as any;

    const targetEl = s01Doc.elements[0];
    const quotaResult = await repo.execute({
      commandId: 'model.apply-records',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: branchBefore.workingRevision,
      actor: testActor,
      payload: {
        changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...targetEl, label: 'Quota Edit' } } }],
      },
    });
    expect(quotaResult.status).toBe('failed');
    if (quotaResult.status === 'failed') {
      expect(quotaResult.code).toBe('quota');
    }

    db.snapshots.add = originalAdd;

    // The stored branch state is exactly what it was before the failed apply -- "the
    // in-memory document is untouched" reads, at the repository boundary, as: no partial
    // mutation reached storage, so the branch the caller still holds locally remains
    // accurate.
    const branchAfter = (await repo.loadBranch(projectId, draftBranchId))!;
    expect(branchAfter).toEqual(branchBefore);

    // exportProject still succeeds after the failed write.
    const project = (await repo.loadProject(projectId))!;
    const exportRes = await repo.exportProject({ projectId, expectedProjectRevision: project.revision });
    expect(exportRes.status).toBe('done');
    if (exportRes.status !== 'done') throw new Error('unreachable');

    // Import into a fresh project.
    const fileToken = await repo.fileTokens.registerFile(exportRes.bytes, () => crypto.randomUUID());
    const newProjectId = crypto.randomUUID();
    const importRes = await repo.importProject({
      commandId: 'project.import',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: { fileToken, newProjectId },
    });
    expect(importRes.status).toBe('applied');

    const historyBefore = await repo.loadHistory(projectId);
    const historyAfter = await repo.loadHistory(newProjectId);

    // Equal modulo projectId, importSourceId, revision and run provenance/traceState.
    const stripProject = (p: any) => {
      const { id, importSourceId, revision, ...rest } = p;
      return rest;
    };
    expect(stripProject(historyAfter.project)).toEqual(stripProject(historyBefore.project));
    expect(historyAfter.branches.map((b) => ({ ...b, projectId: undefined }))).toEqual(
      historyBefore.branches.map((b) => ({ ...b, projectId: undefined })),
    );
    expect(historyAfter.commits.map((c) => ({ ...c, projectId: undefined }))).toEqual(
      historyBefore.commits.map((c) => ({ ...c, projectId: undefined })),
    );

    const runsBefore = await repo.listRuns(projectId);
    const runsAfter = await repo.listRuns(newProjectId);
    const stripRun = (r: any) => {
      const { projectId: _p, provenance, traceState, ...rest } = r;
      return rest;
    };
    expect(runsAfter.map(stripRun)).toEqual(runsBefore.map(stripRun));
    expect(runsAfter.every((r) => r.provenance === 'imported-unverified')).toBe(true);

    db.close();
  });

  it('(c) deleteProject: stale head rejected, correct head removes, retry is already-absent', async () => {
    const dbName = `${DB_NAME}-recovery-c-${crypto.randomUUID()}`;
    const db = createStudioDatabase(dbName);
    const repo = new LocalRepository(db);
    const { projectId, mainBranchId } = await createTestProject(repo);

    const mainBranch = (await repo.loadBranch(projectId, mainBranchId))!;
    expect(mainBranch.headCommitId).toBeNull();

    // Stale expected main head (a fabricated non-null commit ID when the real head is null).
    const staleRes = await repo.deleteProject(projectId, crypto.randomUUID());
    expect(staleRes.status).toBe('stale');
    expect(await repo.loadProject(projectId)).not.toBeNull();

    // Correct expected head removes the project.
    const okRes = await repo.deleteProject(projectId, mainBranch.headCommitId);
    expect(okRes.status).toBe('applied');
    expect(await repo.loadProject(projectId)).toBeNull();

    // Retry -> already-absent (missing), not an error.
    const retryRes = await repo.deleteProject(projectId, mainBranch.headCommitId);
    expect(retryRes.status).toBe('missing');
    if (retryRes.status === 'missing') {
      expect(retryRes.ids).toEqual([projectId]);
    }

    db.close();
  });
});

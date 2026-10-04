/**
 * Retention and pinning tests (RV-08f).
 *
 * Implements specs/revamp/contracts/storage.md §7:
 *   "Keep the 20 latest unpinned runs by (completedAt,id)."
 *   "A run is pinned when a retained commit references it."
 * saveRun never auto-prunes: before storing a 21st unpinned run it returns a typed
 * failure (status 'failed', code 'limit') asking for an explicit prune, and nothing is
 * written.
 */

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { prepareScenario } from '../../domain/studio/runner/compile';
import { runScenario } from '../../domain/studio/runner/scenario-runner';
import type { CheckResult, RunSummary, TerminalStatus } from '../../domain/studio/runner/types';
import { createStudioDatabase } from './db';
import { computeSnapshotId } from './primitives';
import { LocalRepository } from './repository';
import { mintRunStartToken } from './token';
import { DEFAULT_BUILD_VERSIONS, type Actor, type ProjectCreateCommand } from './types';
import { emptyCycleSummary } from '../../domain/studio/runner/cycles';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');
const s01Doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 's01.json'), 'utf8')) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

function createMockSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    mode: 'logical',
    cycles: emptyCycleSummary(),
    consumedInputs: 1,
    rootCounts: { generated: 1, succeeded: 1, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
    messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
    elementMetrics: [],
    finalStates: [{ elementId: 'checkout', stateId: 'succeeded', context: {} }],
    outputs: [],
    coverage: { includedElementIds: ['checkout'], excludedElementIds: [] },
    processedEvents: 4,
    elapsedMs: null,
    rowOutcomes: [],
    ...overrides,
  };
}

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
      title: 'Retention Test Project',
      initialDocument: doc,
      mainBranchId,
      draftBranchId,
    },
  };
  const createRes = await repo.execute(createCmd);
  expect(createRes.status).toBe('applied');

  const snapshotId = await computeSnapshotId(doc);
  return { projectId, mainBranchId, draftBranchId, snapshotId };
}

/** Saves an arbitrary, unqualified run bound to the project's existing initial snapshot. */
async function saveDummyRun(repo: LocalRepository, projectId: Id, snapshotId: string, tag: string) {
  const runId = crypto.randomUUID();
  const fingerprint = `dummy-fingerprint-${tag}`;
  const token = mintRunStartToken({
    projectId,
    runId,
    snapshotId,
    manifest: { tag },
    fingerprint,
  });
  const terminalResult = {
    runId,
    fingerprint,
    status: 'completed' as TerminalStatus,
    checks: [] as CheckResult[],
    summary: createMockSummary(),
  };
  const res = await repo.saveRun(token, terminalResult, []);
  return { runId, res };
}

/** Runs and saves genuine evidence for every scenario in `doc`, returning evidence refs. */
async function runAndSaveAllScenarios(repo: LocalRepository, projectId: Id, doc: Document, snapshotId: string) {
  const evidence: { scenarioId: Id; fingerprint: string; runId: Id }[] = [];
  for (const scenario of doc.scenarios) {
    const prep = await prepareScenario(
      { id: snapshotId, document: doc },
      scenario.id,
      new AbortController().signal,
      DEFAULT_BUILD_VERSIONS,
    );
    if (prep.status !== 'ready') throw new Error(`prepareScenario failed: ${JSON.stringify(prep)}`);

    const runId = crypto.randomUUID();
    const runResult = await runScenario(doc, scenario.id, runId);
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId,
      manifest: prep.manifest,
      fingerprint: prep.fingerprint,
      document: doc,
    });
    const terminalResult = { ...runResult, runId, fingerprint: prep.fingerprint };
    const saveRes = await repo.saveRun(token, terminalResult, runResult.events, { projectId, document: doc });
    if (saveRes.status !== 'applied') throw new Error(`saveRun failed: ${JSON.stringify(saveRes)}`);

    evidence.push({ scenarioId: scenario.id, fingerprint: prep.fingerprint, runId });
  }
  return evidence;
}

describe('Retention and pinning (RV-08f)', () => {
  it('pinned runs (referenced by a retained commit) do not count toward the 20-unpinned limit', async () => {
    const db = createStudioDatabase(`test-retention-pinned-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId, snapshotId } = await createTestProject(repo);

    // 3 genuine runs, committed with evidence -> pinned.
    const evidence = await runAndSaveAllScenarios(repo, projectId, s01Doc, snapshotId);
    const commitRes = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: { commitId: crypto.randomUUID(), expectedHeadId: null, message: 'pin evidence', evidence },
    });
    expect(commitRes.status).toBe('applied');

    // 20 additional unrelated unpinned runs must all succeed: the 3 pinned runs are excluded.
    for (let i = 0; i < 20; i++) {
      const { res } = await saveDummyRun(repo, projectId, snapshotId, `a${i}`);
      expect(res.status).toBe('applied');
    }

    const totalRuns = await db.runs.where('projectId').equals(projectId).count();
    expect(totalRuns).toBe(23);

    db.close();
  });

  it('the 21st unpinned run returns a typed failure and writes nothing', async () => {
    const db = createStudioDatabase(`test-retention-21st-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await createTestProject(repo);

    for (let i = 0; i < 20; i++) {
      const { res } = await saveDummyRun(repo, projectId, snapshotId, `b${i}`);
      expect(res.status).toBe('applied');
    }

    const { runId: rejectedRunId, res: rejected } = await saveDummyRun(repo, projectId, snapshotId, 'b20');
    expect(rejected.status).toBe('failed');
    if (rejected.status === 'failed') {
      expect(rejected.code).toBe('limit');
    }

    // Nothing was written for the rejected run; total count stays at 20.
    const loaded = await repo.loadRun(projectId, rejectedRunId);
    expect(loaded).toBeNull();
    const totalRuns = await db.runs.where('projectId').equals(projectId).count();
    expect(totalRuns).toBe(20);

    db.close();
  });

  it('a run is excluded from the unpinned count once a retained commit references it, freeing a slot', async () => {
    const db = createStudioDatabase(`test-retention-exclude-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId, snapshotId } = await createTestProject(repo);

    // 3 genuine (currently unpinned) runs + 17 dummy runs = 20 unpinned.
    const evidence = await runAndSaveAllScenarios(repo, projectId, s01Doc, snapshotId);
    for (let i = 0; i < 17; i++) {
      const { res } = await saveDummyRun(repo, projectId, snapshotId, `c${i}`);
      expect(res.status).toBe('applied');
    }

    // 21st unpinned run is rejected: quota is exhausted.
    const attempt1 = await saveDummyRun(repo, projectId, snapshotId, 'c17');
    expect(attempt1.res.status).toBe('failed');

    // Commit pins the 3 genuine runs, dropping the unpinned count from 20 to 17.
    const commitRes = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: { commitId: crypto.randomUUID(), expectedHeadId: null, message: 'pin evidence', evidence },
    });
    expect(commitRes.status).toBe('applied');

    // The previously-rejected slot now succeeds.
    const attempt2 = await saveDummyRun(repo, projectId, snapshotId, 'c17-retry');
    expect(attempt2.res.status).toBe('applied');

    db.close();
  });
});

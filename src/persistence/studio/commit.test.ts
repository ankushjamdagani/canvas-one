import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { computeSnapshotId } from './primitives';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import { mintRunStartToken } from './token';
import { prepareScenario } from '../../domain/studio/runner/compile';
import { runScenario } from '../../domain/studio/runner/scenario-runner';
import { DEFAULT_BUILD_VERSIONS, type Actor, type HistoryCommitCommand } from './types';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');
const s01Doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 's01.json'), 'utf8')) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

async function createTestProject(repo: LocalRepository, initialDoc: Document = s01Doc) {
  const projectId = crypto.randomUUID();
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();

  const createRes = await repo.execute({
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: {
      newProjectId: projectId,
      title: 'Commit Test Project',
      initialDocument: initialDoc,
      mainBranchId,
      draftBranchId,
    },
  });
  expect(createRes.status).toBe('applied');

  return {
    projectId,
    mainBranchId,
    draftBranchId,
  };
}

async function runAndSaveScenario(
  repo: LocalRepository,
  projectId: string,
  doc: Document,
  scenarioId: string,
  options?: { makeFailing?: boolean; makeIncomplete?: boolean },
) {
  const snapshotId = await computeSnapshotId(doc);
  const prep = await prepareScenario(
    { id: snapshotId, document: doc },
    scenarioId,
    new AbortController().signal,
    DEFAULT_BUILD_VERSIONS,
  );
  if (prep.status !== 'ready') {
    throw new Error(`prepScenario failed: ${JSON.stringify(prep)}`);
  }

  const runId = crypto.randomUUID();
  const rawRunResult = await runScenario(doc, scenarioId, runId);

  let runResult = rawRunResult;
  if (options?.makeFailing) {
    runResult = {
      ...rawRunResult,
      checks: rawRunResult.checks.map((c) => ({
        ...c,
        status: 'failed' as const,
        reason: 'Simulated assertion failure',
      })),
    };
  } else if (options?.makeIncomplete) {
    runResult = {
      ...rawRunResult,
      status: 'incomplete' as const,
    };
  }

  const token = mintRunStartToken({
    projectId,
    runId,
    snapshotId,
    manifest: prep.manifest,
    fingerprint: prep.fingerprint,
    document: doc,
  });

  const terminalResult = {
    ...runResult,
    runId,
    fingerprint: prep.fingerprint,
    snapshotId,
  };

  const saveRes = await repo.saveRun(token, terminalResult, runResult.events, {
    projectId,
    document: doc,
  });
  if (saveRes.status !== 'applied') {
    throw new Error(`saveRun failed: ${JSON.stringify(saveRes)}`);
  }

  return {
    scenarioId,
    fingerprint: prep.fingerprint,
    runId,
  };
}

describe('history.commit', () => {
  it('happy path: advances head, records parentIds ([] for unborn, [head] for next), stores pins and evidence manifest, supports receipt retry', async () => {
    const db = createStudioDatabase(`test-commit-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    // Run and save evidence for all 3 scenarios of S01
    const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
    for (const scenario of s01Doc.scenarios) {
      const ref = await runAndSaveScenario(repo, projectId, s01Doc, scenario.id);
      evidence.push(ref);
    }

    const commitId1 = crypto.randomUUID();
    const opId1 = crypto.randomUUID();

    const commitCmd1: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: opId1,
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: commitId1,
        expectedHeadId: null, // unborn branch
        message: 'First commit on draft',
        evidence,
      },
    };

    const res1 = await repo.execute(commitCmd1);
    expect(res1.status).toBe('applied');
    if (res1.status === 'applied') {
      expect(res1.undo).toBeNull();
      expect(res1.value).toEqual({
        kind: 'artifact',
        artifactType: 'commit',
        id: commitId1,
        revision: null,
      });
      expect(res1.branchRevision).toBe(1);
      expect(res1.projectRevision).toBe(1);
    }

    // Verify branch head is advanced
    const branch1 = await repo.loadBranch(projectId, draftBranchId);
    expect(branch1?.headCommitId).toBe(commitId1);
    expect(branch1?.workingRevision).toBe(1);

    // Verify commit record in DB
    const commitRecord1 = await repo.loadCommit(projectId, commitId1);
    expect(commitRecord1).not.toBeNull();
    expect(commitRecord1?.id).toBe(commitId1);
    expect(commitRecord1?.parentIds).toEqual([]); // unborn parentIds = []
    expect(commitRecord1?.evidence).toEqual(evidence);
    expect(commitRecord1?.evidenceManifest).toBeDefined();
    expect(commitRecord1?.evidenceManifest?.scenarioIds).toEqual(s01Doc.scenarios.map((s) => s.id));
    expect(commitRecord1?.evidenceManifest?.entries).toHaveLength(3);

    // Verify receipt retry: exact same request returns original result
    const retryRes = await repo.execute(commitCmd1);
    expect(retryRes.status).toBe('applied');
    if (retryRes.status === 'applied') {
      expect(retryRes.operationId).toBe(opId1);
      expect(retryRes.value).toEqual({
        kind: 'artifact',
        artifactType: 'commit',
        id: commitId1,
        revision: null,
      });
    }

    // Now make a second commit on the branch
    const commitId2 = crypto.randomUUID();
    const opId2 = crypto.randomUUID();

    const commitCmd2: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: opId2,
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        commitId: commitId2,
        expectedHeadId: commitId1, // parent head
        message: 'Second commit on draft',
        evidence,
      },
    };

    const res2 = await repo.execute(commitCmd2);
    expect(res2.status).toBe('applied');

    const branch2 = await repo.loadBranch(projectId, draftBranchId);
    expect(branch2?.headCommitId).toBe(commitId2);
    expect(branch2?.workingRevision).toBe(2);

    const commitRecord2 = await repo.loadCommit(projectId, commitId2);
    expect(commitRecord2?.parentIds).toEqual([commitId1]); // parent = [head]

    db.close();
  });

  it('commit on main → invalid', async () => {
    const db = createStudioDatabase(`test-commit-main-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, mainBranchId } = await createTestProject(repo);

    const commitCmd: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: mainBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit on main',
        evidence: [],
      },
    };

    const res = await repo.execute(commitCmd);
    expect(res.status).toBe('invalid');
    if (res.status === 'invalid') {
      expect(res.issues[0].message).toContain('Direct commit on main branch is rejected');
    }

    db.close();
  });

  it('HEAD_MOVED: expectedHeadId mismatch → failed/conflict issue HEAD_MOVED', async () => {
    const db = createStudioDatabase(`test-commit-head-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    const commitCmd: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: crypto.randomUUID(), // mismatch: branch is unborn (null)
        message: 'Commit with bad head',
        evidence: [],
      },
    };

    const res = await repo.execute(commitCmd);
    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.code).toBe('conflict');
      expect(res.issues[0].message).toContain('HEAD_MOVED');
    }

    db.close();
  });

  it('stale: expectedWorkingRevision mismatch → stale', async () => {
    const db = createStudioDatabase(`test-commit-stale-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    const commitCmd: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 999, // mismatch: branch is revision 0
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit with stale revision',
        evidence: [],
      },
    };

    const res = await repo.execute(commitCmd);
    expect(res.status).toBe('stale');
    if (res.status === 'stale') {
      expect(res.scope).toBe('branch');
      expect(res.expected).toBe(999);
      expect(res.actual).toBe(0);
    }

    db.close();
  });

  it('missing/failing/incomplete evidence → ineligible with reasons', async () => {
    const db = createStudioDatabase(`test-commit-evidence-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    // 1. Missing evidence (no runs at all)
    const commitMissing: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit with missing evidence',
        evidence: [],
      },
    };
    const resMissing = await repo.execute(commitMissing);
    expect(resMissing.status).toBe('failed');
    if (resMissing.status === 'failed') {
      expect(resMissing.code).toBe('ineligible');
      expect(resMissing.issues.length).toBeGreaterThan(0);
      expect(resMissing.issues[0].message).toContain('has no qualifying evidence run');
    }

    // 2. Failing checks evidence
    const failRef = await runAndSaveScenario(repo, projectId, s01Doc, s01Doc.scenarios[0].id, {
      makeFailing: true,
    });
    const goodRef1 = await runAndSaveScenario(repo, projectId, s01Doc, s01Doc.scenarios[1].id);
    const goodRef2 = await runAndSaveScenario(repo, projectId, s01Doc, s01Doc.scenarios[2].id);

    const commitFailing: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit with failing evidence',
        evidence: [failRef, goodRef1, goodRef2],
      },
    };
    const resFailing = await repo.execute(commitFailing);
    expect(resFailing.status).toBe('failed');
    if (resFailing.status === 'failed') {
      expect(resFailing.code).toBe('ineligible');
      const failIssue = resFailing.issues.find((i) => i.entityId === s01Doc.scenarios[0].id);
      expect(failIssue?.message).toContain('check-failed');
    }

    // 3. Incomplete run evidence
    const incRef = await runAndSaveScenario(repo, projectId, s01Doc, s01Doc.scenarios[0].id, {
      makeIncomplete: true,
    });
    const commitIncomplete: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit with incomplete evidence',
        evidence: [incRef, goodRef1, goodRef2],
      },
    };
    const resIncomplete = await repo.execute(commitIncomplete);
    expect(resIncomplete.status).toBe('failed');
    if (resIncomplete.status === 'failed') {
      expect(resIncomplete.code).toBe('ineligible');
      const incIssue = resIncomplete.issues.find((i) => i.entityId === s01Doc.scenarios[0].id);
      expect(incIssue?.message).toContain('incomplete');
    }

    db.close();
  });

  it('a run changed between evaluation and the transaction → rejected', async () => {
    const db = createStudioDatabase(`test-commit-run-changed-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    // Save good runs
    const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
    for (const scenario of s01Doc.scenarios) {
      const ref = await runAndSaveScenario(repo, projectId, s01Doc, scenario.id);
      evidence.push(ref);
    }

    // Mutate the run in the database right inside an interceptor / hook
    // To simulate a race where the run changed between outside-transaction eval and inside-transaction check:
    const targetRun = await db.runs.get([projectId, evidence[0].runId]);
    expect(targetRun).toBeDefined();

    // Directly alter the transaction checks by tampering with run in db
    // We can do this by wrapping `db.transaction`:
    const origTransaction = db.transaction.bind(db);
    let tampered = false;
    (db as any).transaction = function (...args: any[]) {
      if (!tampered) {
        tampered = true;
        // Tamper with the run before the rw transaction executes
        db.runs.update([projectId, evidence[0].runId], {
          status: 'failed',
        });
      }
      return (origTransaction as any)(...args);
    };

    const commitCmd: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit with tampered run in race',
        evidence,
      },
    };

    const res = await repo.execute(commitCmd);
    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.code).toBe('ineligible');
      expect(res.issues[0].message).toContain('changed between evaluation and transaction');
    }

    db.close();
  });

  it('enforces 1,000-commit limit', async () => {
    const db = createStudioDatabase(`test-commit-limit-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
    for (const scenario of s01Doc.scenarios) {
      const ref = await runAndSaveScenario(repo, projectId, s01Doc, scenario.id);
      evidence.push(ref);
    }

    // Populate 1,000 dummy commit rows
    const dummyCommits: any[] = [];
    for (let i = 0; i < 1000; i++) {
      dummyCommits.push({
        projectId,
        id: `dummy-commit-${i}`,
        snapshotId: 'dummy-snapshot',
        parentIds: [],
        evidence: [],
        actor: testActor,
        createdAt: Date.now(),
        message: `Dummy commit ${i}`,
      });
    }
    await db.commits.bulkPut(dummyCommits);

    const commitCmd: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: '1001st commit',
        evidence,
      },
    };

    const res = await repo.execute(commitCmd);
    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.code).toBe('limit');
      expect(res.issues[0].message).toContain('exceed maximum limit of 1000');
    }

    db.close();
  });

  // ========================================================================
  // Edge cases
  // ========================================================================

  it('a run saved with a different compilerVersion does not qualify', async () => {
    const db = createStudioDatabase(`test-diff-compiler-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    // Save evidence for all scenarios, but one scenario has an older compilerVersion in its manifest
    const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
    for (let i = 0; i < s01Doc.scenarios.length; i++) {
      const scenario = s01Doc.scenarios[i];
      if (i === 0) {
        // Run with an older compilerVersion
        const oldVersions = {
          compilerVersion: 'studio-compiler/0-ancient',
          runnerVersions: [{ runnerId: 'studio-runner', version: 'studio-runner/1' }],
        };
        const snapshotId = await computeSnapshotId(s01Doc);
        const prep = await prepareScenario(
          { id: snapshotId, document: s01Doc },
          scenario.id,
          new AbortController().signal,
          oldVersions,
        );
        expect(prep.status).toBe('ready');
        if (prep.status !== 'ready') return;

        const runId = crypto.randomUUID();
        const runResult = await runScenario(s01Doc, scenario.id, runId);
        const token = mintRunStartToken({
          projectId,
          runId,
          snapshotId,
          manifest: prep.manifest,
          fingerprint: prep.fingerprint,
          document: s01Doc,
        });
        const terminalResult = {
          ...runResult,
          runId,
          fingerprint: prep.fingerprint,
          snapshotId,
        };
        const saveRes = await repo.saveRun(token, terminalResult, runResult.events, {
          projectId,
          document: s01Doc,
        });
        expect(saveRes.status).toBe('applied');

        evidence.push({
          scenarioId: scenario.id,
          fingerprint: prep.fingerprint,
          runId,
        });
      } else {
        const ref = await runAndSaveScenario(repo, projectId, s01Doc, scenario.id);
        evidence.push(ref);
      }
    }

    // Attempting commit must fail/ineligible because the repo's current compilerVersion
    // (DEFAULT_BUILD_VERSIONS: 'studio-compiler/1') produces a different fingerprint!
    const res = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit with outdated compiler run',
        evidence,
      },
    });

    expect(res.status).toBe('failed');
    if (res.status === 'failed') {
      expect(res.code).toBe('ineligible');
      expect(res.issues[0].message).toContain('not qualifying');
    }

    db.close();
  });

  it('evidence refs with invalid shape -> invalid at payload.evidence[i]', async () => {
    const db = createStudioDatabase(`test-evidence-shape-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    const badEvidence = [
      { scenarioId: 'not-a-uuid', fingerprint: 'fp1', runId: crypto.randomUUID() },
    ];

    const res = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit with bad evidence shape',
        evidence: badEvidence as any,
      },
    });

    expect(res.status).toBe('invalid');
    if (res.status === 'invalid') {
      expect(res.issues.length).toBeGreaterThan(0);
      expect(res.issues[0].path).toEqual(['payload', 'evidence', 0]);
    }

    db.close();
  });

  it('duplicate ref for scenarioId or ref for scenario not in document -> invalid', async () => {
    const db = createStudioDatabase(`test-evidence-dup-unknown-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    const s0 = s01Doc.scenarios[0];
    const ref0 = await runAndSaveScenario(repo, projectId, s01Doc, s0.id);

    // Duplicate ref for s0
    const resDup = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Duplicate ref',
        evidence: [ref0, ref0],
      },
    });
    expect(resDup.status).toBe('invalid');

    // Ref for non-existent scenario
    const resUnknown = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Unknown scenario ref',
        evidence: [
          ref0,
          {
            scenarioId: crypto.randomUUID(),
            fingerprint: 'some-fingerprint',
            runId: crypto.randomUUID(),
          },
        ],
      },
    });
    expect(resUnknown.status).toBe('invalid');

    db.close();
  });

  it('ref whose run is missing -> failed/ineligible naming the run; scenarioId or fingerprint mismatch -> failed/ineligible', async () => {
    const db = createStudioDatabase(`test-evidence-mismatch-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
    for (const scenario of s01Doc.scenarios) {
      const ref = await runAndSaveScenario(repo, projectId, s01Doc, scenario.id);
      evidence.push(ref);
    }

    // Missing run
    const missingRunId = crypto.randomUUID();
    const resMissingRun = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Missing run',
        evidence: [
          { ...evidence[0], runId: missingRunId },
          evidence[1],
          evidence[2],
        ],
      },
    });
    expect(resMissingRun.status).toBe('failed');
    if (resMissingRun.status === 'failed') {
      expect(resMissingRun.code).toBe('ineligible');
      expect(resMissingRun.issues[0].message).toContain(missingRunId);
    }

    // Fingerprint mismatch between ref and run
    const resFpMismatch = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Fingerprint mismatch',
        evidence: [
          { ...evidence[0], fingerprint: 'wrong-fingerprint' },
          evidence[1],
          evidence[2],
        ],
      },
    });
    expect(resFpMismatch.status).toBe('failed');
    if (resFpMismatch.status === 'failed') {
      expect(resFpMismatch.code).toBe('ineligible');
    }

    // scenarioId mismatch between ref and run
    const resScenMismatch = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Scenario mismatch',
        evidence: [
          { ...evidence[0], scenarioId: evidence[1].scenarioId }, // citing run 0 under scenario 1
          evidence[2],
        ],
      },
    });
    expect(resScenMismatch.status === 'invalid' || resScenMismatch.status === 'failed').toBe(true);

    db.close();
  });

  it('every scenario in document must have exactly one ref, and THAT ref run must qualify (no stand-ins)', async () => {
    const db = createStudioDatabase(`test-evidence-no-standin-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    // Save evidence for scenario 0 and 1, but omit scenario 2
    const ref0 = await runAndSaveScenario(repo, projectId, s01Doc, s01Doc.scenarios[0].id);
    const ref1 = await runAndSaveScenario(repo, projectId, s01Doc, s01Doc.scenarios[1].id);

    const resIncomplete = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Missing scenario 2 ref',
        evidence: [ref0, ref1],
      },
    });
    expect(resIncomplete.status).toBe('failed');
    if (resIncomplete.status === 'failed') {
      expect(resIncomplete.code).toBe('ineligible');
      expect(resIncomplete.issues[0].message).toContain(s01Doc.scenarios[2].id);
    }

    db.close();
  });

  it('history.commit on a closed branch -> invalid', async () => {
    const db = createStudioDatabase(`test-commit-closed-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, draftBranchId } = await createTestProject(repo);

    const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
    for (const scenario of s01Doc.scenarios) {
      const ref = await runAndSaveScenario(repo, projectId, s01Doc, scenario.id);
      evidence.push(ref);
    }

    // Set branch state to closed in DB
    await db.branches.update([projectId, draftBranchId], { state: 'closed' });

    const res = await repo.execute({
      commandId: 'history.commit',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        commitId: crypto.randomUUID(),
        expectedHeadId: null,
        message: 'Commit on closed branch',
        evidence,
      },
    });

    expect(res.status).toBe('invalid');
    if (res.status === 'invalid') {
      expect(res.issues[0].message).toContain('closed');
    }

    db.close();
  });
});


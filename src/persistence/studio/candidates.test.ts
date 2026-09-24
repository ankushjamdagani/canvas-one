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
import {
  CandidateController,
  createCandidateController,
} from './candidates';
import {
  DEFAULT_BUILD_VERSIONS,
  type Actor,
  type HistoryCommitCommand,
  type SnapshotRecord,
  type CommitRecord,
} from './types';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');
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
      title: 'Candidate Test Project',
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
  const runResult = await runScenario(doc, scenarioId, runId);

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

async function commitBranch(
  repo: LocalRepository,
  projectId: string,
  branchId: string,
  doc: Document,
  expectedHeadId: string | null = null,
  expectedWorkingRevision = 0,
) {
  const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
  for (const scenario of doc.scenarios) {
    const ref = await runAndSaveScenario(repo, projectId, doc, scenario.id);
    evidence.push(ref);
  }

  const commitId = crypto.randomUUID();
  const res = await repo.execute({
    commandId: 'history.commit',
    operationId: crypto.randomUUID(),
    projectId,
    branchId,
    expectedWorkingRevision,
    actor: testActor,
    payload: {
      commitId,
      expectedHeadId,
      message: 'Test branch commit',
      evidence,
    },
  });
  expect(res.status).toBe('applied');

  return { commitId, evidence };
}

describe('CandidateController (RV-08d)', () => {
  it('prepare preconditions: source not main, stale revisions, moved heads, unborn source, uncommitted edits', async () => {
    const db = createStudioDatabase(`test-cand-pre-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = new CandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

    // 1. Source is main -> invalid
    const resMain = await controller.prepare(repo, {
      projectId,
      sourceBranchId: mainBranchId,
      sourceRevision: 0,
      sourceHeadId: null,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(resMain.status).toBe('invalid');
    if (resMain.status === 'invalid') {
      expect(resMain.issues[0].message).toContain('Source branch cannot be main');
    }

    // 2. Unborn source (no commit yet) -> invalid
    const resUnborn = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 0,
      sourceHeadId: null,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(resUnborn.status).toBe('invalid');
    if (resUnborn.status === 'invalid') {
      expect(resUnborn.issues[0].message).toContain('cannot prepare candidate from unborn branch');
    }

    // Commit source branch so it has a head
    const { commitId: draftCommitId } = await commitBranch(repo, projectId, draftBranchId, s01Doc);

    // 3. Stale source revision
    const resStaleSource = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 999, // actual is 1
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(resStaleSource.status).toBe('stale');

    // 4. Stale main revision
    const resStaleMain = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 999, // actual is 0
      mainHeadId: null,
    });
    expect(resStaleMain.status).toBe('stale');

    // 5. Moved source head
    const resMovedSource = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: crypto.randomUUID(), // mismatch
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(resMovedSource.status).toBe('failed');
    if (resMovedSource.status === 'failed') {
      expect(resMovedSource.code).toBe('conflict');
      expect(resMovedSource.issues[0].message).toContain('HEAD_MOVED');
    }

    // 6. Moved main head
    const resMovedMain = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: crypto.randomUUID(), // mismatch
    });
    expect(resMovedMain.status).toBe('failed');
    if (resMovedMain.status === 'failed') {
      expect(resMovedMain.code).toBe('conflict');
      expect(resMovedMain.issues[0].message).toContain('HEAD_MOVED');
    }

    // 7. Uncommitted source edits (workingSnapshotId != head snapshotId)
    await db.branches.update([projectId, draftBranchId], {
      workingSnapshotId: 'uncommitted-snapshot-id',
    });
    const resUncommittedSource = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(resUncommittedSource.status).toBe('invalid');
    if (resUncommittedSource.status === 'invalid') {
      expect(resUncommittedSource.issues[0].message).toContain('Source branch has uncommitted changes');
    }

    // Restore draft branch workingSnapshotId
    const draftCommitRec = await repo.loadCommit(projectId, draftCommitId);
    await db.branches.update([projectId, draftBranchId], {
      workingSnapshotId: draftCommitRec!.snapshotId,
    });

    // 8. Uncommitted main edits while unborn (workingSnapshotId != initialSnapshotId)
    await db.branches.update([projectId, mainBranchId], {
      workingSnapshotId: 'dirty-main-snapshot-id',
    });
    const resUncommittedMain = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(resUncommittedMain.status).toBe('invalid');
    if (resUncommittedMain.status === 'invalid') {
      expect(resUncommittedMain.issues[0].message).toContain('Main branch has uncommitted changes');
    }

    db.close();
  });

  it('prepare clean merge: zero conflicts, returns candidate with conflictIds: []', async () => {
    const db = createStudioDatabase(`test-cand-clean-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = new CandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const { commitId: draftCommitId } = await commitBranch(repo, projectId, draftBranchId, s01Doc);

    const res = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });

    expect(res.status).toBe('done');
    if (res.status === 'done') {
      expect(res.value.kind).toBe('candidate');
      expect(res.value.candidateId).toBeDefined();
      expect(res.value.snapshotId).toBeDefined();
      expect(res.value.conflictIds).toEqual([]);

      const cand = controller.get(res.value.candidateId);
      expect(cand).not.toBeNull();
      expect(cand?.superseded).toBe(false);
      expect(cand?.snapshotId).toBe(res.value.snapshotId);
      expect(Object.isFrozen(cand)).toBe(true);
    }

    db.close();
  });

  it('conflicting merge: lists conflictIds, candidate cannot run, resolve produces new candidate while superseding old', async () => {
    const db = createStudioDatabase(`test-cand-conflict-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    let idCounter = 1;
    const controller = new CandidateController({
      mintId: () => `cand-${idCounter++}`,
    });
    const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo, s01Doc);

    // Setup 3-way merge conflict:
    // Base: s01Doc (element[0].label = original)
    // Ours (main): element[0].label = 'Main Label'
    // Theirs (draft): element[0].label = 'Draft Label'
    const elemId = s01Doc.elements[0].id;

    // Simulate committed head on main
    const mainDoc: Document = {
      ...s01Doc,
      elements: s01Doc.elements.map((e) =>
        e.id === elemId ? { ...e, label: 'Main Label' } : e,
      ),
    };
    const mainSnapshotId = await computeSnapshotId(mainDoc);
    const mainSnapshotRow: SnapshotRecord = {
      projectId,
      id: mainSnapshotId,
      document: mainDoc,
    };
    await db.snapshots.add(mainSnapshotRow);

    const mainCommitId = crypto.randomUUID();
    const mainCommitRow: CommitRecord = {
      projectId,
      id: mainCommitId,
      snapshotId: mainSnapshotId,
      parentIds: [],
      evidence: [],
      actor: testActor,
      createdAt: Date.now(),
      message: 'Main prior commit',
    };
    await db.commits.add(mainCommitRow);
    await db.branches.update([projectId, mainBranchId], {
      headCommitId: mainCommitId,
      workingSnapshotId: mainSnapshotId,
      workingRevision: 1,
    });

    // On draft branch, update element[0].label to 'Draft Label' and commit
    const draftDoc: Document = {
      ...s01Doc,
      elements: s01Doc.elements.map((e) =>
        e.id === elemId ? { ...e, label: 'Draft Label' } : e,
      ),
    };
    const draftSnapshotId = await computeSnapshotId(draftDoc);
    await db.snapshots.add({
      projectId,
      id: draftSnapshotId,
      document: draftDoc,
    });
    await db.branches.update([projectId, draftBranchId], {
      workingSnapshotId: draftSnapshotId,
    });

    const { commitId: draftCommitId } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      draftDoc,
      null,
      0,
    );

    // Prepare candidate
    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 1,
      mainHeadId: mainCommitId,
    });

    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    expect(prepRes.value.candidateId).toBe('cand-1');
    expect(prepRes.value.conflictIds.length).toBeGreaterThan(0);
    const conflictId = prepRes.value.conflictIds[0];

    // Candidate with conflicts cannot run
    const runAttempt = await controller.startCandidateRun(repo, {
      candidateId: 'cand-1',
      scenarioId: s01Doc.scenarios[0].id,
      runId: crypto.randomUUID(),
    });
    expect(runAttempt.status).toBe('failed');
    if (runAttempt.status === 'failed') {
      expect(runAttempt.code).toBe('conflict');
      expect(runAttempt.issues[0].message).toContain('unresolved conflicts');
    }

    // Candidate evaluate also fails readiness due to conflicts
    const evalAttempt = await controller.evaluate(repo, 'cand-1');
    expect(evalAttempt.status).toBe('failed');
    expect(evalAttempt.eligible).toBe(false);

    // Resolve conflict with unknown candidate -> missing
    const resUnknown = await controller.resolveConflict(repo, {
      candidateId: 'cand-non-existent',
      conflictId,
      resolution: { kind: 'ours' },
    });
    expect(resUnknown.status).toBe('missing');

    // Resolve conflict with 'ours' -> creates cand-2
    const resResolve = await controller.resolveConflict(repo, {
      candidateId: 'cand-1',
      conflictId,
      resolution: { kind: 'ours' },
    });
    expect(resResolve.status).toBe('done');
    if (resResolve.status !== 'done') return;

    expect(resResolve.value.candidateId).toBe('cand-2');
    expect(resResolve.value.conflictIds).toEqual([]);

    // Old candidate (cand-1) is now superseded
    const oldCand = controller.get('cand-1');
    expect(oldCand?.superseded).toBe(true);

    // Attempting to resolve on superseded candidate returns failed/ineligible
    const resSuperseded = await controller.resolveConflict(repo, {
      candidateId: 'cand-1',
      conflictId,
      resolution: { kind: 'theirs' },
    });
    expect(resSuperseded.status).toBe('failed');
    if (resSuperseded.status === 'failed') {
      expect(resSuperseded.code).toBe('ineligible');
      expect(resSuperseded.issues[0].message).toContain('superseded');
    }

    // Evaluating superseded candidate returns failed/ineligible
    const evalSuperseded = await controller.evaluate(repo, 'cand-1');
    expect(evalSuperseded.status).toBe('failed');
    expect(evalSuperseded.eligible).toBe(false);

    // Running superseded candidate returns failed/ineligible
    const runSuperseded = await controller.startCandidateRun(repo, {
      candidateId: 'cand-1',
      scenarioId: s01Doc.scenarios[0].id,
      runId: crypto.randomUUID(),
    });
    expect(runSuperseded.status).toBe('failed');
    if (runSuperseded.status === 'failed') {
      expect(runSuperseded.code).toBe('ineligible');
    }

    db.close();
  });

  it('reload semantics: a new controller instance has no candidates', async () => {
    const db = createStudioDatabase(`test-cand-reload-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller1 = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const { commitId: draftCommitId } = await commitBranch(repo, projectId, draftBranchId, s01Doc);

    const prep = await controller1.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prep.status).toBe('done');
    if (prep.status !== 'done') return;

    const candidateId = prep.value.candidateId;
    expect(controller1.get(candidateId)).not.toBeNull();

    // Fresh controller instance represents reload
    const controller2 = createCandidateController({ mintId: () => crypto.randomUUID() });
    expect(controller2.get(candidateId)).toBeNull();

    const evalRes = await controller2.evaluate(repo, candidateId);
    expect(evalRes.status).toBe('missing');
    expect(evalRes.eligible).toBe(false);

    db.close();
  });

  it('clean candidate run: executes, mints token, saves run, leaves candidate and branches unchanged', async () => {
    const db = createStudioDatabase(`test-cand-run-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId, mainBranchId } = await createTestProject(repo);

    const { commitId: draftCommitId } = await commitBranch(repo, projectId, draftBranchId, s01Doc);

    const prep = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prep.status).toBe('done');
    if (prep.status !== 'done') return;

    const candidateId = prep.value.candidateId;
    const candBefore = controller.get(candidateId);
    const draftBefore = await repo.loadBranch(projectId, draftBranchId);
    const mainBefore = await repo.loadBranch(projectId, mainBranchId);

    const runId = crypto.randomUUID();
    const scenarioId = s01Doc.scenarios[0].id;

    const runRes = await controller.startCandidateRun(repo, {
      candidateId,
      scenarioId,
      runId,
    });

    expect(runRes.status).toBe('done');
    if (runRes.status === 'done') {
      expect(runRes.runId).toBe(runId);
      expect(runRes.saveResult.status).toBe('applied');
      expect(runRes.value).toEqual({ kind: 'run', runId });
    }

    // Verify run is stored in repo
    const runs = await repo.listRuns(projectId);
    const saved = runs.find((r) => r.id === runId);
    expect(saved).toBeDefined();
    expect((saved?.manifest as any)?.scenario?.id).toBe(scenarioId);

    // Verify candidate in memory is unchanged
    const candAfter = controller.get(candidateId);
    expect(candAfter).toEqual(candBefore);

    // Verify branches are unchanged
    const draftAfter = await repo.loadBranch(projectId, draftBranchId);
    const mainAfter = await repo.loadBranch(projectId, mainBranchId);

    expect(draftAfter?.workingRevision).toBe(draftBefore?.workingRevision);
    expect(draftAfter?.headCommitId).toBe(draftBefore?.headCommitId);
    expect(draftAfter?.workingSnapshotId).toBe(draftBefore?.workingSnapshotId);

    expect(mainAfter?.workingRevision).toBe(mainBefore?.workingRevision);
    expect(mainAfter?.headCommitId).toBe(mainBefore?.headCommitId);
    expect(mainAfter?.workingSnapshotId).toBe(mainBefore?.workingSnapshotId);

    db.close();
  });

  // ========================================================================
  // Review Round 1 Tests
  // ========================================================================

  it('item 3: prepare with closed source branch -> invalid', async () => {
    const db = createStudioDatabase(`test-cand-closed-source-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = new CandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const { commitId: draftCommitId } = await commitBranch(repo, projectId, draftBranchId, s01Doc);

    // Close draft branch
    await db.branches.update([projectId, draftBranchId], { state: 'closed' });

    const prep = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });

    expect(prep.status).toBe('invalid');
    if (prep.status === 'invalid') {
      expect(prep.issues[0].message).toContain('closed');
    }

    db.close();
  });

  it('item 4: mintId must be required in CandidateControllerOptions', () => {
    // Calling constructor without options or without mintId must throw
    expect(() => new (CandidateController as any)()).toThrow(/mintId/);
    expect(() => new CandidateController({} as any)).toThrow(/mintId/);
  });

  it('item 5: startCandidateRun handles cancelled signal explicitly', async () => {
    const db = createStudioDatabase(`test-cand-run-cancel-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = new CandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const { commitId: draftCommitId } = await commitBranch(repo, projectId, draftBranchId, s01Doc);

    const prep = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prep.status).toBe('done');
    if (prep.status !== 'done') return;

    const abortController = new AbortController();
    abortController.abort(); // already aborted signal

    const runRes = await controller.startCandidateRun(
      repo,
      {
        candidateId: prep.value.candidateId,
        scenarioId: s01Doc.scenarios[0].id,
        runId: crypto.randomUUID(),
      },
      { signal: abortController.signal },
    );

    expect(runRes.status).toBe('cancelled');
    db.close();
  });

  it('item 5: if candidate is superseded after run finishes, still saves run and returns superseded: true', async () => {
    const db = createStudioDatabase(`test-cand-run-superseded-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = new CandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const { commitId: draftCommitId } = await commitBranch(repo, projectId, draftBranchId, s01Doc);

    const prep = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: draftCommitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prep.status).toBe('done');
    if (prep.status !== 'done') return;

    const candidateId = prep.value.candidateId;
    const runId = crypto.randomUUID();

    // Hook candidates.get to return superseded: true on the second check (after run finishes)
    // to simulate a concurrent conflict resolution or action that supersedes the candidate while running
    const originalGet = (controller as any).candidates.get.bind((controller as any).candidates);
    let getCount = 0;
    (controller as any).candidates.get = (id: Id) => {
      getCount++;
      const val = originalGet(id);
      if (getCount > 1 && val) {
        return { ...val, superseded: true };
      }
      return val;
    };

    const runRes = await controller.startCandidateRun(repo, {
      candidateId,
      scenarioId: s01Doc.scenarios[0].id,
      runId,
    });

    expect(runRes.status).toBe('done');
    if (runRes.status === 'done') {
      expect((runRes as any).superseded).toBe(true);
      // Run must still be saved to the database as evidence for that snapshot
      const savedRun = await repo.loadRun(projectId, runId);
      expect(savedRun).not.toBeNull();
      expect(savedRun?.id).toBe(runId);
    }

    db.close();
  });
});


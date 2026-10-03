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
import { buildManifest } from '../../domain/studio/manifest';
import { CandidateController } from './candidates';
import { DEFAULT_BUILD_VERSIONS, type Actor, type HistoryCommitCommand } from './types';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');

function loadFixture(family: string): Document {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${family}.json`), 'utf8')) as Document;
}

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

async function createTestProject(repo: LocalRepository, initialDoc: Document) {
  const projectId = crypto.randomUUID();
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();

  const createRes = await repo.execute({
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: {
      newProjectId: projectId,
      title: 'Family Test Project',
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
    throw new Error(`prepScenario failed for ${scenarioId}: ${JSON.stringify(prep)}`);
  }

  const runId = crypto.randomUUID();
  const runResult = await runScenario(doc, scenarioId, runId);
  expect(runResult.status).toBe('completed');

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
    throw new Error(`saveRun failed for ${scenarioId}: ${JSON.stringify(saveRes)}`);
  }

  return {
    scenarioId,
    fingerprint: prep.fingerprint,
    runId,
  };
}

async function commitSourceBranch(
  repo: LocalRepository,
  projectId: string,
  branchId: string,
  doc: Document,
) {
  const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
  for (const scenario of doc.scenarios) {
    const ref = await runAndSaveScenario(repo, projectId, doc, scenario.id);
    evidence.push(ref);
  }

  const commitId = crypto.randomUUID();
  const commitCmd: HistoryCommitCommand = {
    commandId: 'history.commit',
    operationId: crypto.randomUUID(),
    projectId,
    branchId,
    expectedWorkingRevision: 0,
    actor: testActor,
    payload: {
      commitId,
      expectedHeadId: null, // unborn
      message: 'Source branch initial fixture commit',
      evidence,
    },
  };

  const res = await repo.execute(commitCmd);
  expect(res.status).toBe('applied');

  return { commitId, evidence };
}

describe('Eligibility across all five model families (S01–S05)', () => {
  const families = ['s01', 's02', 's03', 's04', 's05'] as const;

  for (const family of families) {
    it(`Family ${family.toUpperCase()}: candidate against main becomes eligible only after last scenario is saved`, async () => {
      const db = createStudioDatabase(`test-family-${family}-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const controller = new CandidateController({ mintId: () => crypto.randomUUID() });
      const fixtureDoc = loadFixture(family);

      const { projectId, mainBranchId, draftBranchId } = await createTestProject(
        repo,
        fixtureDoc,
      );

      // 1. Source branch changes something executable (scenario 0's seed)
      const sourceDoc: Document = {
        ...fixtureDoc,
        scenarios: fixtureDoc.scenarios.map((s, idx) =>
          idx === 0
            ? {
                ...s,
                seed: s.seed + 1001,
              }
            : s,
        ),
      };

      const sourceSnapshotId = await computeSnapshotId(sourceDoc);
      await db.snapshots.add({
        projectId,
        id: sourceSnapshotId,
        document: sourceDoc,
      });
      await db.branches.update([projectId, draftBranchId], {
        workingSnapshotId: sourceSnapshotId,
        workingRevision: 0,
      });

      // Run and save real evidence for all scenarios of sourceDoc
      const sourceEvidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
      for (const scenario of sourceDoc.scenarios) {
        const ref = await runAndSaveScenario(repo, projectId, sourceDoc, scenario.id);
        sourceEvidence.push(ref);
      }

      // Commit source branch via history.commit with real evidence
      const draftCommitId = crypto.randomUUID();
      const commitRes = await repo.execute({
        commandId: 'history.commit',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 0,
        actor: testActor,
        payload: {
          commitId: draftCommitId,
          expectedHeadId: null, // unborn
          message: 'Source branch executable seed change commit',
          evidence: sourceEvidence,
        },
      });
      expect(commitRes.status).toBe('applied');

      // 2. Main's seeded head changes a different scenario or field:
      // Adds an executable assumption to scenarios (a different field from seed)
      const mainAssumptionIds = fixtureDoc.scenarios.map(() => crypto.randomUUID());
      const mainDoc: Document = {
        ...fixtureDoc,
        scenarios: fixtureDoc.scenarios.map((s, idx) => ({
          ...s,
          assumptions: [
            ...s.assumptions,
            {
              id: mainAssumptionIds[idx],
              key: `main_assumption_${family}_${idx}`,
              value: `main_val_${family}`,
              source: 'author' as const,
              description: 'Main branch different field assumption',
            },
          ],
        })),
      };

      const mainSnapshotId = await computeSnapshotId(mainDoc);
      await db.snapshots.add({
        projectId,
        id: mainSnapshotId,
        document: mainDoc,
      });

      const mainCommitId = crypto.randomUUID();
      await db.commits.add({
        projectId,
        id: mainCommitId,
        snapshotId: mainSnapshotId,
        parentIds: [],
        evidence: [],
        actor: testActor,
        createdAt: Date.now(),
        message: 'Main seeded head commit with different field assumption',
      });

      await db.branches.update([projectId, mainBranchId], {
        headCommitId: mainCommitId,
        workingSnapshotId: mainSnapshotId,
        workingRevision: 1,
      });

      // Prepare candidate against main
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

      const candidateId = prepRes.value.candidateId;
      // Assert: zero conflicts
      expect(prepRes.value.conflictIds).toEqual([]);

      const cand = controller.get(candidateId);
      expect(cand).not.toBeNull();
      const candidateDoc = cand!.mergeState.document;
      expect(candidateDoc.scenarios).toHaveLength(fixtureDoc.scenarios.length);

      // Assert: candidate document contains BOTH changes
      const candScenario0 = candidateDoc.scenarios[0];
      const sourceScenario0 = sourceDoc.scenarios[0];
      expect(candScenario0.seed).toBe(sourceScenario0.seed); // source branch's change
      expect(candScenario0.assumptions.some((a) => a.id === mainAssumptionIds[0])).toBe(true); // main's change

      // Assert: every changed scenario's candidate fingerprint differs from both source-branch evidence and main's
      const candManifestRes = await buildManifest(candidateDoc, candScenario0.id, DEFAULT_BUILD_VERSIONS);
      expect(candManifestRes.status).toBe('ok');
      if (candManifestRes.status !== 'ok') return;
      const candFingerprint0 = candManifestRes.fingerprint;

      const sourceRef0 = sourceEvidence.find((e) => e.scenarioId === candScenario0.id)!;
      expect(candFingerprint0).not.toBe(sourceRef0.fingerprint);

      const mainManifestRes = await buildManifest(mainDoc, candScenario0.id, DEFAULT_BUILD_VERSIONS);
      expect(mainManifestRes.status).toBe('ok');
      if (mainManifestRes.status !== 'ok') return;
      expect(candFingerprint0).not.toBe(mainManifestRes.fingerprint);

      // Record branches and candidate before candidate runs
      const draftBefore = await repo.loadBranch(projectId, draftBranchId);
      const mainBefore = await repo.loadBranch(projectId, mainBranchId);
      const candBefore = controller.get(candidateId);

      // Before running candidate scenarios, evaluate must NOT be eligible
      const evalInitial = await controller.evaluate(repo, candidateId);
      expect(evalInitial.status).toBe('done');
      expect(evalInitial.eligible).toBe(false);

      // Run each scenario of the candidate one by one via startCandidateRun
      for (let i = 0; i < candidateDoc.scenarios.length; i++) {
        const scenario = candidateDoc.scenarios[i];
        const runId = crypto.randomUUID();

        const runRes = await controller.startCandidateRun(repo, {
          candidateId,
          scenarioId: scenario.id,
          runId,
        });

        expect(runRes.status).toBe('done');
        if (runRes.status !== 'done') return;
        expect(runRes.runResult.status).toBe('completed');

        const evalStep = await controller.evaluate(repo, candidateId);
        expect(evalStep.status).toBe('done');
        if (evalStep.status !== 'done') return;

        if (i < candidateDoc.scenarios.length - 1) {
          // Candidate becomes eligible ONLY after the last candidate scenario run is saved
          expect(evalStep.eligible).toBe(false);
        } else {
          expect(evalStep.eligible).toBe(true);
          expect(evalStep.evaluation.scenarios.every((s) => s.evaluation.status === 'qualified')).toBe(
            true,
          );
        }
      }

      // Assert: branches and candidate are unchanged by the runs (compare revisions and snapshot IDs before and after)
      const draftAfter = await repo.loadBranch(projectId, draftBranchId);
      const mainAfter = await repo.loadBranch(projectId, mainBranchId);
      const candAfter = controller.get(candidateId);

      expect(draftAfter?.workingRevision).toBe(draftBefore?.workingRevision);
      expect(draftAfter?.workingSnapshotId).toBe(draftBefore?.workingSnapshotId);
      expect(draftAfter?.headCommitId).toBe(draftBefore?.headCommitId);

      expect(mainAfter?.workingRevision).toBe(mainBefore?.workingRevision);
      expect(mainAfter?.workingSnapshotId).toBe(mainBefore?.workingSnapshotId);
      expect(mainAfter?.headCommitId).toBe(mainBefore?.headCommitId);

      expect(candAfter?.snapshotId).toBe(candBefore?.snapshotId);
      expect(candAfter?.candidateId).toBe(candBefore?.candidateId);
      expect(candAfter?.superseded).toBe(candBefore?.superseded);
      expect(candAfter?.expectedSourceRevision).toBe(candBefore?.expectedSourceRevision);
      expect(candAfter?.expectedMainRevision).toBe(candBefore?.expectedMainRevision);

      db.close();
    });
  }
});

describe('"Rerun merged candidate"', () => {
  it('when the merged document changes a scenario fingerprint, the source branch evidence does not qualify the candidate', async () => {
    const db = createStudioDatabase(`test-rerun-diff-fp-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = new CandidateController({ mintId: () => crypto.randomUUID() });
    const fixtureDoc = loadFixture('s01');

    const { projectId, mainBranchId, draftBranchId } = await createTestProject(
      repo,
      fixtureDoc,
    );

    // Commit source branch with original fixture runs
    const { commitId: draftCommitId } = await commitSourceBranch(
      repo,
      projectId,
      draftBranchId,
      fixtureDoc,
    );

    // Main has a commit that modifies execution manifest for scenario 0
    const mainDoc: Document = {
      ...fixtureDoc,
      scenarios: fixtureDoc.scenarios.map((s, idx) =>
        idx === 0
          ? {
              ...s,
              assumptions: [
                ...s.assumptions,
                {
                  id: crypto.randomUUID(),
                  key: 's01_diff_key',
                  value: 42,
                  source: 'author' as const,
                  description: 'Diff fingerprint assumption',
                },
              ],
            }
          : s,
      ),
    };

    const mainSnapshotId = await computeSnapshotId(mainDoc);
    await db.snapshots.add({
      projectId,
      id: mainSnapshotId,
      document: mainDoc,
    });

    const mainCommitId = crypto.randomUUID();
    await db.commits.add({
      projectId,
      id: mainCommitId,
      snapshotId: mainSnapshotId,
      parentIds: [],
      evidence: [],
      actor: testActor,
      createdAt: Date.now(),
      message: 'Main diff commit',
    });
    await db.branches.update([projectId, mainBranchId], {
      headCommitId: mainCommitId,
      workingSnapshotId: mainSnapshotId,
      workingRevision: 1,
    });

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

    // Evaluated against repo runs: source branch evidence run does NOT match scenario 0 fingerprint
    const evalRes = await controller.evaluate(repo, prepRes.value.candidateId);
    expect(evalRes.status).toBe('done');
    if (evalRes.status !== 'done') return;
    expect(evalRes.eligible).toBe(false);

    const s0Eval = evalRes.evaluation.scenarios.find(
      (s) => s.scenarioId === fixtureDoc.scenarios[0].id,
    );
    expect(s0Eval?.evaluation.status).toBe('not-qualifying');
    if (s0Eval?.evaluation.status === 'not-qualifying') {
      expect(s0Eval.evaluation.reasons).toContain('fingerprint-mismatch');
    }

    db.close();
  });

  it('when only views changed, the existing evidence still qualifies it', async () => {
    const db = createStudioDatabase(`test-rerun-view-only-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = new CandidateController({ mintId: () => crypto.randomUUID() });
    const fixtureDoc = loadFixture('s01');

    const { projectId, mainBranchId, draftBranchId } = await createTestProject(
      repo,
      fixtureDoc,
    );

    // Commit source branch with original fixture runs
    const { commitId: draftCommitId } = await commitSourceBranch(
      repo,
      projectId,
      draftBranchId,
      fixtureDoc,
    );

    // Main has a commit that changes ONLY presentation (views), not execution fields
    const mainDoc: Document = {
      ...fixtureDoc,
      views: fixtureDoc.views.map((v, idx) =>
        idx === 0
          ? {
              ...v,
              label: 'Updated Presentation View Label',
              notes: [
                ...v.notes,
                {
                  id: crypto.randomUUID(),
                  text: 'Visual note only',
                  x: 100,
                  y: 200,
                  width: 300,
                  tone: 'paper' as const,
                  attachedElementIds: [],
                },
              ],
            }
          : v,
      ),
    };

    const mainSnapshotId = await computeSnapshotId(mainDoc);
    await db.snapshots.add({
      projectId,
      id: mainSnapshotId,
      document: mainDoc,
    });

    const mainCommitId = crypto.randomUUID();
    await db.commits.add({
      projectId,
      id: mainCommitId,
      snapshotId: mainSnapshotId,
      parentIds: [],
      evidence: [],
      actor: testActor,
      createdAt: Date.now(),
      message: 'Main view-only commit',
    });
    await db.branches.update([projectId, mainBranchId], {
      headCommitId: mainCommitId,
      workingSnapshotId: mainSnapshotId,
      workingRevision: 1,
    });

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

    // View-only change leaves scenario execution manifests and fingerprints identical;
    // thus the source branch's existing evidence STILL qualifies the candidate!
    const evalRes = await controller.evaluate(repo, prepRes.value.candidateId);
    expect(evalRes.status).toBe('done');
    if (evalRes.status !== 'done') return;
    expect(evalRes.eligible).toBe(true);
    expect(evalRes.evaluation.scenarios.every((s) => s.evaluation.status === 'qualified')).toBe(
      true,
    );

    db.close();
  });
});

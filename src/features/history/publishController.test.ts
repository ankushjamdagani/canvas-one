/**
 * PublishController integration tests, against a real LocalRepository
 * (fake-indexeddb) and the real CandidateController — no mocked merge, eligibility
 * or persistence logic.
 *
 * Covers:
 * - Happy path: prepare -> (no conflicts) -> run a candidate scenario via the
 *   injected run function -> enter metadata -> publish.
 * - Duplicate and lower version rejection surfaced from the real repository.
 * - Conflicts -> resolve (edited) -> new candidate -> scenarios need a rerun ->
 *   run via the injected function -> publish.
 * - Missing/no-candidate guard behavior.
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Element, Id } from '../../domain/studio/model';
import { computeSnapshotId } from '../../persistence/studio/primitives';
import { createStudioDatabase } from '../../persistence/studio/db';
import { LocalRepository } from '../../persistence/studio/repository';
import { createCandidateController } from '../../persistence/studio/candidates';
import { prepareScenario } from '../../domain/studio/runner/compile';
import { runScenario } from '../../domain/studio/runner/scenario-runner';
import { mintRunStartToken } from '../../persistence/studio/token';
import {
  DEFAULT_BUILD_VERSIONS,
  type Actor,
  type HistoryCommitCommand,
  type PublicationMetadata,
} from '../../persistence/studio/types';
import { SessionController } from '../session/controller';
import { PublishController } from './publishController';
import { setAtPath } from './CompareAndResolvePanel';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');
const s01Doc: Document = JSON.parse(readFileSync(join(FIXTURES_DIR, 's01.json'), 'utf8'));
const s02Doc: Document = JSON.parse(readFileSync(join(FIXTURES_DIR, 's02.json'), 'utf8'));

const testActor: Actor = { actorId: 'test-user', kind: 'local-human', displayName: 'Test User' };

// ============================================================================
// Shared test helpers (test-only; not application code)
// ============================================================================

async function runAndSaveScenario(
  repo: LocalRepository,
  projectId: Id,
  doc: Document,
  scenarioId: Id,
) {
  const snapshotId = await computeSnapshotId(doc);
  const prep = await prepareScenario(
    { id: snapshotId, document: doc },
    scenarioId,
    new AbortController().signal,
    DEFAULT_BUILD_VERSIONS,
  );
  if (prep.status !== 'ready') {
    throw new Error(`prepareScenario failed for ${scenarioId}: ${JSON.stringify(prep)}`);
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
  const terminalResult = { ...runResult, runId, fingerprint: prep.fingerprint, snapshotId };
  const saveRes = await repo.saveRun(token, terminalResult, runResult.events, { projectId, document: doc });
  if (saveRes.status !== 'applied') {
    throw new Error(`saveRun failed for ${scenarioId}: ${JSON.stringify(saveRes)}`);
  }
  return { scenarioId, fingerprint: prep.fingerprint, runId };
}

/** Runs every scenario in `doc` and commits the branch with that evidence. */
async function runAllAndCommit(
  repo: LocalRepository,
  projectId: Id,
  branchId: Id,
  doc: Document,
  message: string,
) {
  const branch = await repo.loadBranch(projectId, branchId);
  if (!branch) throw new Error('branch not found');

  const evidence = [];
  for (const scenario of doc.scenarios) {
    evidence.push(await runAndSaveScenario(repo, projectId, doc, scenario.id));
  }

  const commitCmd: HistoryCommitCommand = {
    commandId: 'history.commit',
    operationId: crypto.randomUUID(),
    projectId,
    branchId,
    expectedWorkingRevision: branch.workingRevision,
    actor: testActor,
    payload: {
      commitId: crypto.randomUUID(),
      expectedHeadId: branch.headCommitId,
      message,
      evidence,
    },
  };
  const res = await repo.execute(commitCmd);
  if (res.status !== 'applied') {
    throw new Error(`commit failed: ${JSON.stringify(res)}`);
  }
  return res;
}

/** Raw prepare + run every candidate scenario + publish, bypassing PublishController
 * (used to seed prior publications in tests that exercise PublishController on a
 * later branch). */
async function rawPrepareAndPublish(
  repo: LocalRepository,
  candidateController: ReturnType<typeof createCandidateController>,
  projectId: Id,
  sourceBranchId: Id,
  metadata: PublicationMetadata,
) {
  const project = (await repo.loadProject(projectId))!;
  const sourceBranch = (await repo.loadBranch(projectId, sourceBranchId))!;
  const mainBranch = (await repo.loadBranch(projectId, project.mainBranchId))!;

  const prepRes = await candidateController.prepare(repo, {
    projectId,
    sourceBranchId,
    sourceRevision: sourceBranch.workingRevision,
    sourceHeadId: sourceBranch.headCommitId,
    mainRevision: mainBranch.workingRevision,
    mainHeadId: mainBranch.headCommitId,
  });
  if (prepRes.status !== 'done') {
    throw new Error(`prepare failed: ${JSON.stringify(prepRes)}`);
  }
  const { candidateId } = prepRes.value;
  const candidate = candidateController.get(candidateId)!;

  const evidence = [];
  for (const scenario of candidate.mergeState.document.scenarios) {
    const runRes = await candidateController.startCandidateRun(repo, {
      candidateId,
      scenarioId: scenario.id,
      runId: crypto.randomUUID(),
    });
    if (runRes.status !== 'done') {
      throw new Error(`candidate run failed: ${JSON.stringify(runRes)}`);
    }
    evidence.push({
      scenarioId: scenario.id,
      fingerprint: runRes.saveResult.status === 'applied' ? runRes.saveResult.run.fingerprint : '',
      runId: runRes.runId,
    });
  }

  const freshCandidate = candidateController.get(candidateId)!;
  const freshProject = (await repo.loadProject(projectId))!;

  const pubRes = await candidateController.publish(repo, {
    commandId: 'history.publish',
    operationId: crypto.randomUUID(),
    projectId,
    branchId: freshCandidate.sourceBranchId,
    expectedWorkingRevision: freshCandidate.expectedSourceRevision,
    actor: testActor,
    payload: {
      candidateId,
      publicationId: crypto.randomUUID(),
      mergeCommitId: crypto.randomUUID(),
      metadata,
      evidence,
      keepSourceOpen: false,
      expectedProjectRevision: freshProject.revision,
    },
  });
  if (pubRes.status !== 'applied') {
    throw new Error(`publish failed: ${JSON.stringify(pubRes)}`);
  }
  return pubRes;
}

async function createBranchFromMainHead(
  repo: LocalRepository,
  projectId: Id,
  mainBranchId: Id,
  label: string,
) {
  const main = (await repo.loadBranch(projectId, mainBranchId))!;
  const newBranchId = crypto.randomUUID();
  const res = await repo.execute({
    commandId: 'branch.create',
    operationId: crypto.randomUUID(),
    projectId,
    branchId: mainBranchId,
    expectedWorkingRevision: main.workingRevision,
    actor: testActor,
    payload: {
      newBranchId,
      label,
      source: 'head',
      expectedHeadId: main.headCommitId,
    },
  });
  if (res.status !== 'applied') {
    throw new Error(`branch.create failed: ${JSON.stringify(res)}`);
  }
  return newBranchId;
}

async function editCapacity(
  repo: LocalRepository,
  projectId: Id,
  branchId: Id,
  elementId: Id,
  capacity: number,
): Promise<Document> {
  const branch = (await repo.loadBranch(projectId, branchId))!;
  const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;
  const target = snap.document.elements.find((e) => e.id === elementId);
  if (!target || target.behavior.kind !== 'resource') {
    throw new Error(`element '${elementId}' is not a resource element`);
  }
  const updated: Element = {
    ...target,
    behavior: { ...target.behavior, config: { ...target.behavior.config, capacity } },
  };
  const res = await repo.execute({
    commandId: 'model.apply-records',
    operationId: crypto.randomUUID(),
    projectId,
    branchId,
    expectedWorkingRevision: branch.workingRevision,
    actor: testActor,
    payload: { changes: [{ kind: 'replace', value: { recordKind: 'element', record: updated } }] },
  });
  if (res.status !== 'applied') {
    throw new Error(`edit failed: ${JSON.stringify(res)}`);
  }
  const newBranch = (await repo.loadBranch(projectId, branchId))!;
  const newSnap = (await repo.loadSnapshot(projectId, newBranch.workingSnapshotId))!;
  return newSnap.document;
}

function makePublishController(
  repo: LocalRepository,
  session: SessionController,
  candidateController: ReturnType<typeof createCandidateController>,
) {
  return new PublishController({
    repository: repo,
    session,
    candidateController,
    mintId: () => crypto.randomUUID(),
    actor: testActor,
    runScenario: (params) => candidateController.startCandidateRun(repo, params),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('PublishController (real LocalRepository, real CandidateController)', () => {
  it('has no active candidate until prepare() is called, and rejects acting on one', async () => {
    const db = createStudioDatabase(`test-publish-noop-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const session = new SessionController({ repository: repo, mintId: () => crypto.randomUUID(), actor: testActor });
    const candidateController = createCandidateController({ mintId: () => crypto.randomUUID() });
    const controller = makePublishController(repo, session, candidateController);

    expect(controller.getState().status).toBe('idle');
    await expect(controller.runScenario('does-not-matter')).rejects.toThrow();
    await expect(controller.resolveConflict('does-not-matter', { kind: 'ours' })).rejects.toThrow();

    db.close();
  });

  it('reports blocked with a real message when no project is open', async () => {
    const db = createStudioDatabase(`test-publish-blocked-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const session = new SessionController({ repository: repo, mintId: () => crypto.randomUUID(), actor: testActor });
    const candidateController = createCandidateController({ mintId: () => crypto.randomUUID() });
    const controller = makePublishController(repo, session, candidateController);

    const res = await controller.prepare();
    expect(res.status).toBe('invalid');
    expect(controller.getState().status).toBe('blocked');
    expect(controller.getState().blockedMessage).toMatch(/no project is open/i);

    db.close();
  });

  it('happy path: prepare (no conflicts), run a scenario via the injected function, propose 0.1.0, publish, close source by default', async () => {
    const db = createStudioDatabase(`test-publish-happy-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const mintId = () => crypto.randomUUID();
    const session = new SessionController({ repository: repo, mintId, actor: testActor });
    const candidateController = createCandidateController({ mintId });

    const created = await session.createProject({ title: 'Happy Path', initialDocument: s01Doc });
    expect(created.status).toBe('applied');
    const { projectId, branchId: draftBranchId, mainBranchId } = session.getState();
    if (!projectId || !draftBranchId || !mainBranchId) throw new Error('session not ready');

    await runAllAndCommit(repo, projectId, draftBranchId, s01Doc, 'Initial checkout scenarios');

    const controller = makePublishController(repo, session, candidateController);
    const prepRes = await controller.prepare();
    expect(prepRes.status).toBe('done');

    let state = controller.getState();
    expect(state.status).toBe('review');
    expect(state.conflicts.length).toBe(0); // unborn main: one-sided change, no conflict
    expect(state.scenarios.length).toBe(s01Doc.scenarios.length);
    // Evidence carries over (fingerprint is content-based, not snapshot-based) so the
    // candidate is already eligible from the branch commit's saved runs.
    expect(state.eligible).toBe(true);
    expect(state.scenarios.every((s) => s.status.kind === 'passed')).toBe(true);

    // Real commit-since-fork/components-touched/fork data
    // for the "What goes onto main" section, not fabricated.
    expect(state.commitsSinceFork.length).toBe(1);
    expect(state.commitsSinceFork[0].message).toBe('Initial checkout scenarios');
    // No element edits were made on top of the initial document in this
    // fixture, so the real components-touched count is 0 — never invented.
    expect(state.componentsTouchedCount).toBe(0);
    expect(state.sourceBranchLabel).not.toBeNull();
    expect(state.mainBranchLabel).not.toBeNull();
    expect(state.versionsPublishedSinceFork).toBe(0); // no publications exist yet
    expect(state.forkVersionKey).toBeNull(); // forked before any publication existed
    expect(state.resolvedFields).toEqual([]); // nothing resolved yet

    // Exercise the injected run function directly even though the scenario already
    // passed, proving the wiring: PublishController -> injected fn -> the existing
    // candidate runner (CandidateController.startCandidateRun), never a bespoke one.
    const firstScenarioId = state.scenarios[0].scenario.id;
    const runRes = await controller.runScenario(firstScenarioId);
    expect(runRes.status).toBe('done');
    state = controller.getState();
    expect(state.eligible).toBe(true);

    expect(state.versionSuggestions?.isFirst).toBe(true);
    expect(state.versionSuggestions?.proposedKey).toBe('0.1.0');

    const pubRes = await controller.publish(
      {
        version: state.versionSuggestions!.proposed,
        title: 'Initial release',
        rationale: '',
        ticketUrl: null,
      },
      false,
    );
    expect(pubRes.status).toBe('applied');

    state = controller.getState();
    expect(state.status).toBe('published');
    expect(state.publication?.versionKey).toBe('0.1.0');
    expect(state.publication?.metadata.title).toBe('Initial release');

    const sourceAfter = await repo.loadBranch(projectId, draftBranchId);
    expect(sourceAfter?.state).toBe('closed'); // closes by default
    expect(session.getState().branchId).toBe(mainBranchId);

    const mainAfter = await repo.loadBranch(projectId, mainBranchId);
    expect(mainAfter?.headCommitId).not.toBeNull();

    db.close();
  });

  it('surfaces duplicate-version and lower-version rejection from the real repository', async () => {
    const db = createStudioDatabase(`test-publish-dupver-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const mintId = () => crypto.randomUUID();
    const session = new SessionController({ repository: repo, mintId, actor: testActor });
    const candidateController = createCandidateController({ mintId });

    const created = await session.createProject({ title: 'Version Test', initialDocument: s01Doc });
    expect(created.status).toBe('applied');
    const { projectId, branchId: b1, mainBranchId } = session.getState();
    if (!projectId || !b1 || !mainBranchId) throw new Error('session not ready');

    await runAllAndCommit(repo, projectId, b1, s01Doc, 'B1 commit');
    await rawPrepareAndPublish(repo, candidateController, projectId, b1, {
      version: { major: 0, minor: 1, patch: 0 },
      title: 'First',
      rationale: '',
      ticketUrl: null,
    });

    // A second branch off main's new head, with its own (trivial) commit.
    const b2 = await createBranchFromMainHead(repo, projectId, mainBranchId, 'b2');
    const b2Branch = (await repo.loadBranch(projectId, b2))!;
    const b2Snap = (await repo.loadSnapshot(projectId, b2Branch.workingSnapshotId))!;
    await runAllAndCommit(repo, projectId, b2, b2Snap.document, 'B2 commit');

    await session.openProject(projectId, b2);
    const controller = makePublishController(repo, session, candidateController);
    const prepRes = await controller.prepare();
    expect(prepRes.status).toBe('done');
    expect(controller.getState().conflicts.length).toBe(0);

    // Duplicate: same version as the first publication.
    const dupRes = await controller.publish(
      { version: { major: 0, minor: 1, patch: 0 }, title: 'Dup', rationale: '', ticketUrl: null },
      false,
    );
    expect(dupRes.status).toBe('failed');
    if (dupRes.status === 'failed') expect(dupRes.code).toBe('duplicate-version');
    expect(controller.getState().status).toBe('review'); // stays in review, candidate not consumed
    expect(controller.getState().lastError).toEqual(dupRes);

    // Lower: below the latest published version.
    const lowerRes = await controller.publish(
      { version: { major: 0, minor: 0, patch: 1 }, title: 'Lower', rationale: '', ticketUrl: null },
      false,
    );
    expect(lowerRes.status).toBe('invalid');

    db.close();
  });

  it('conflicts -> resolve (edited) -> new candidate -> scenarios need a rerun -> run via injected function -> publish', async () => {
    const db = createStudioDatabase(`test-publish-conflict-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const mintId = () => crypto.randomUUID();
    const session = new SessionController({ repository: repo, mintId, actor: testActor });
    const candidateController = createCandidateController({ mintId });

    const created = await session.createProject({ title: 'Conflict Test', initialDocument: s02Doc });
    expect(created.status).toBe('applied');
    const { projectId, branchId: b1, mainBranchId } = session.getState();
    if (!projectId || !b1 || !mainBranchId) throw new Error('session not ready');

    const workerElementId = s02Doc.elements.find((e) => e.label === 'Fulfillment worker')!.id;

    // B1: capacity 10 -> 20, commit, publish. Main is now at capacity 20 (M1).
    const b1Doc = await editCapacity(repo, projectId, b1, workerElementId, 20);
    await runAllAndCommit(repo, projectId, b1, b1Doc, 'B1: capacity 20');
    await rawPrepareAndPublish(repo, candidateController, projectId, b1, {
      version: { major: 0, minor: 1, patch: 0 },
      title: 'M1',
      rationale: '',
      ticketUrl: null,
    });

    // B2 and B3 both branch from main's head at M1 (capacity 20).
    const b2 = await createBranchFromMainHead(repo, projectId, mainBranchId, 'b2');
    const b3 = await createBranchFromMainHead(repo, projectId, mainBranchId, 'b3');

    // B2: capacity 20 -> 30, commit, publish. Main is now at capacity 30 (M2).
    const b2Doc = await editCapacity(repo, projectId, b2, workerElementId, 30);
    await runAllAndCommit(repo, projectId, b2, b2Doc, 'B2: capacity 30');
    await rawPrepareAndPublish(repo, candidateController, projectId, b2, {
      version: { major: 0, minor: 2, patch: 0 },
      title: 'M2',
      rationale: '',
      ticketUrl: null,
    });

    // B3: capacity 20 -> 40 (diverging from the same base M1 that B2 also diverged
    // from), commit. Publishing B3 now must conflict against main's M2 (capacity 30).
    const b3Doc = await editCapacity(repo, projectId, b3, workerElementId, 40);
    await runAllAndCommit(repo, projectId, b3, b3Doc, 'B3: capacity 40');

    await session.openProject(projectId, b3);
    const controller = makePublishController(repo, session, candidateController);
    const prepRes = await controller.prepare();
    expect(prepRes.status).toBe('done');

    const preResolveCandidateId = controller.getState().candidateId!;
    const conflicts = controller.getState().conflicts;
    expect(conflicts.length).toBeGreaterThan(0);
    const capacityConflict = conflicts.find(
      (c) => c.recordKind === 'element' && c.recordId === workerElementId,
    );
    expect(capacityConflict).toBeDefined();
    // Not a document-kind conflict, so 'edited' is allowed here.
    expect(capacityConflict!.recordKind).not.toBe('document');

    // Resolve with an explicit edit to a value neither prior side used (25), so the
    // resulting candidate genuinely needs fresh evidence (never re-using B1/B2/B3's
    // already-saved runs for capacity 20/30/40).
    const candidateBefore = candidateController.get(preResolveCandidateId)!;
    const oursElement = candidateBefore.mergeState.inputs.ours.elements.find(
      (e) => e.id === workerElementId,
    )!;
    if (oursElement.behavior.kind !== 'resource') throw new Error('expected resource element');
    const editedElement = setAtPath(oursElement, capacityConflict!.path, 25);
    expect(editedElement).toEqual({ ...oursElement, behavior: { ...oursElement.behavior, config: { ...oursElement.behavior.config, capacity: 25 } } });

    const resolveRes = await controller.resolveConflict(capacityConflict!.id, {
      kind: 'edited',
      record: editedElement,
    });
    expect(resolveRes.status).toBe('done');

    const state = controller.getState();
    expect(state.status).toBe('review');
    expect(state.conflicts.length).toBe(0);
    expect(state.candidateId).not.toBe(preResolveCandidateId); // new candidate

    // The resolution is tracked for the "resolved ·
    // field · side" display, with the real recordId/path/kind, not invented.
    expect(state.resolvedFields).toEqual([
      {
        recordKind: 'element',
        recordId: workerElementId,
        path: ['behavior', 'config', 'capacity'],
        resolution: 'edited',
      },
    ]);
    expect(state.mergedDocument).not.toBeNull();
    expect(state.mergeInputs).not.toBeNull();

    // The superseded candidate is no longer independently usable.
    const supersededEval = await candidateController.evaluate(repo, preResolveCandidateId);
    expect(supersededEval.eligible).toBe(false);
    expect(supersededEval.status).toBe('failed');

    // Scenarios need a rerun: capacity 25 matches none of the previously saved
    // fingerprints (20, 30, 40).
    expect(state.scenarios.length).toBeGreaterThan(0);
    expect(state.scenarios.every((s) => s.status.kind === 'needs-rerun')).toBe(true);
    expect(state.eligible).toBe(false);

    for (const { scenario } of state.scenarios) {
      const runRes = await controller.runScenario(scenario.id);
      expect(runRes.status).toBe('done');
    }

    const readyState = controller.getState();
    expect(readyState.eligible).toBe(true);
    expect(readyState.scenarios.every((s) => s.status.kind === 'passed')).toBe(true);

    const pubRes = await controller.publish(
      {
        version: readyState.versionSuggestions!.proposed,
        title: 'M3: resolved capacity conflict',
        rationale: 'Resolved a capacity conflict between B2 and B3.',
        ticketUrl: 'https://example.com/tickets/SYS-1',
      },
      false,
    );
    expect(pubRes.status).toBe('applied');
    expect(controller.getState().status).toBe('published');

    db.close();
  });

  it('resolveAllConflicts resolves every open conflict with the same real side, one at a time', async () => {
    const db = createStudioDatabase(`test-publish-resolve-all-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const mintId = () => crypto.randomUUID();
    const session = new SessionController({ repository: repo, mintId, actor: testActor });
    const candidateController = createCandidateController({ mintId });

    const created = await session.createProject({ title: 'Resolve All Test', initialDocument: s02Doc });
    expect(created.status).toBe('applied');
    const { projectId, branchId: b1, mainBranchId } = session.getState();
    if (!projectId || !b1 || !mainBranchId) throw new Error('session not ready');

    const workerElementId = s02Doc.elements.find((e) => e.label === 'Fulfillment worker')!.id;

    const b1Doc = await editCapacity(repo, projectId, b1, workerElementId, 20);
    await runAllAndCommit(repo, projectId, b1, b1Doc, 'B1: capacity 20');
    await rawPrepareAndPublish(repo, candidateController, projectId, b1, {
      version: { major: 0, minor: 1, patch: 0 },
      title: 'M1',
      rationale: '',
      ticketUrl: null,
    });

    const b2 = await createBranchFromMainHead(repo, projectId, mainBranchId, 'b2');
    const b3 = await createBranchFromMainHead(repo, projectId, mainBranchId, 'b3');

    const b2Doc = await editCapacity(repo, projectId, b2, workerElementId, 30);
    await runAllAndCommit(repo, projectId, b2, b2Doc, 'B2: capacity 30');
    await rawPrepareAndPublish(repo, candidateController, projectId, b2, {
      version: { major: 0, minor: 2, patch: 0 },
      title: 'M2',
      rationale: '',
      ticketUrl: null,
    });

    const b3Doc = await editCapacity(repo, projectId, b3, workerElementId, 40);
    await runAllAndCommit(repo, projectId, b3, b3Doc, 'B3: capacity 40');

    await session.openProject(projectId, b3);
    const controller = makePublishController(repo, session, candidateController);
    const prepRes = await controller.prepare();
    expect(prepRes.status).toBe('done');
    expect(controller.getState().conflicts.length).toBeGreaterThan(0);

    const result = await controller.resolveAllConflicts('theirs');
    expect(result?.status).toBe('done');

    const state = controller.getState();
    expect(state.conflicts.length).toBe(0);
    expect(state.resolvedFields.length).toBeGreaterThan(0);
    expect(state.resolvedFields.every((r) => r.resolution === 'theirs')).toBe(true);
    const resolvedField = state.resolvedFields[0];
    const previousId = state.candidateId;
    await controller.reopenConflict(resolvedField);
    const reopened = controller.getState();
    expect(reopened.status).toBe('review');
    expect(reopened.candidateId).not.toBe(previousId);
    expect(reopened.conflicts.some((c) => c.recordId === resolvedField.recordId && JSON.stringify(c.path) === JSON.stringify(resolvedField.path))).toBe(true);
    expect(reopened.resolvedFields).not.toContainEqual(resolvedField);

    // "theirs" (the source branch, B3) chose capacity 40: resolving with theirs
    // everywhere must land that real value, not an invented one.
    const mergedWorker = state.mergedDocument!.elements.find((e) => e.id === workerElementId);
    if (!mergedWorker || mergedWorker.behavior.kind !== 'resource') throw new Error('expected resource element');
    expect(mergedWorker.behavior.config.capacity).toBe(40);

    db.close();
  });
});

/**
 * Round-trip reload test.
 *
 * Builds a real history through the repository (project -> two branches -> edits ->
 * checkpoints -> commits with evidence -> prepare -> candidate runs -> publish branch A;
 * reopen A -> publish B -> restore on A), closes the Dexie connection, opens a NEW
 * LocalRepository on a NEW Dexie instance with the SAME database name (the reload), and
 * asserts every read-visible invariant survives it untouched.
 *
 * Expected revisions are always read live from the repository right before each command
 * rather than hand-computed, so the test does not silently drift if an intermediate
 * command's revision bump changes.
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
import { CandidateController, createCandidateController } from './candidates';
import { DEFAULT_BUILD_VERSIONS, type Actor, type PublicationMetadata, type ProjectCreateCommand } from './types';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');
const s01Doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 's01.json'), 'utf8')) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

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

  return { scenarioId, fingerprint: prep.fingerprint, runId };
}

async function commitBranch(
  repo: LocalRepository,
  projectId: Id,
  branchId: Id,
  doc: Document,
): Promise<{ commitId: Id; command: Record<string, unknown> }> {
  const evidence: { scenarioId: Id; fingerprint: string; runId: Id }[] = [];
  for (const scenario of doc.scenarios) {
    evidence.push(await runAndSaveScenario(repo, projectId, doc, scenario.id));
  }
  const branch = (await repo.loadBranch(projectId, branchId))!;
  const commitId = crypto.randomUUID();
  const command = {
    commandId: 'history.commit' as const,
    operationId: crypto.randomUUID(),
    projectId,
    branchId,
    expectedWorkingRevision: branch.workingRevision,
    actor: testActor,
    payload: { commitId, expectedHeadId: branch.headCommitId, message: 'round-trip test commit', evidence },
  };
  const res = await repo.execute(command);
  expect(res.status).toBe('applied');
  return { commitId, command };
}

async function runAllCandidateScenarios(
  controller: CandidateController,
  repo: LocalRepository,
  candidateId: Id,
  doc: Document,
) {
  const evidence: { scenarioId: Id; fingerprint: string; runId: Id }[] = [];
  for (const scenario of doc.scenarios) {
    const res = await controller.startCandidateRun(repo, {
      candidateId,
      scenarioId: scenario.id,
      runId: crypto.randomUUID(),
    });
    if (res.status !== 'done') {
      throw new Error(`candidate run failed: ${JSON.stringify(res)}`);
    }
    evidence.push({
      scenarioId: scenario.id,
      fingerprint: (res.saveResult as any).run.fingerprint,
      runId: res.runId,
    });
  }
  return evidence;
}

async function publishBranch(
  repo: LocalRepository,
  controller: CandidateController,
  projectId: Id,
  sourceBranchId: Id,
  doc: Document,
  metadata: PublicationMetadata,
  keepSourceOpen: boolean,
) {
  const project = (await repo.loadProject(projectId))!;
  const source = (await repo.loadBranch(projectId, sourceBranchId))!;
  const main = (await repo.loadBranch(projectId, project.mainBranchId))!;

  const prep = await controller.prepare(repo, {
    projectId,
    sourceBranchId,
    sourceRevision: source.workingRevision,
    sourceHeadId: source.headCommitId,
    mainRevision: main.workingRevision,
    mainHeadId: main.headCommitId,
  });
  if (prep.status !== 'done') throw new Error(`prepare failed: ${JSON.stringify(prep)}`);
  const evidence = await runAllCandidateScenarios(controller, repo, prep.value.candidateId, doc);

  const publicationId = crypto.randomUUID();
  const publishRes = await controller.publish(repo, {
    commandId: 'history.publish',
    operationId: crypto.randomUUID(),
    projectId,
    branchId: sourceBranchId,
    expectedWorkingRevision: source.workingRevision,
    actor: testActor,
    payload: {
      candidateId: prep.value.candidateId,
      publicationId,
      mergeCommitId: crypto.randomUUID(),
      metadata,
      evidence,
      keepSourceOpen,
      expectedProjectRevision: project.revision,
    },
  });
  return { publicationId, publishRes, candidateId: prep.value.candidateId };
}

describe('Round-trip reload', () => {
  it('preserves history, heads, snapshots, receipts, publications and the version rule across a fresh Dexie connection', async () => {
    const dbName = `${DB_NAME}-roundtrip-${crypto.randomUUID()}`;
    const db1 = createStudioDatabase(dbName);
    const repo1 = new LocalRepository(db1);
    const controller1 = createCandidateController({ mintId: () => crypto.randomUUID() });

    // 1. project -> two branches
    const projectId = crypto.randomUUID();
    const mainBranchId = crypto.randomUUID();
    const branchAId = crypto.randomUUID();
    const createCmd: ProjectCreateCommand = {
      commandId: 'project.create',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: {
        newProjectId: projectId,
        title: 'Round Trip Project',
        initialDocument: s01Doc,
        mainBranchId,
        draftBranchId: branchAId,
      },
    };
    expect((await repo1.execute(createCmd)).status).toBe('applied');

    const mainForBranchCreate = (await repo1.loadBranch(projectId, mainBranchId))!;
    const branchCreateRes = await repo1.execute({
      commandId: 'branch.create',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: mainBranchId,
      expectedWorkingRevision: mainForBranchCreate.workingRevision,
      actor: testActor,
      payload: { newBranchId: crypto.randomUUID(), label: 'branch-b', source: 'working', expectedHeadId: null },
    });
    expect(branchCreateRes.status).toBe('applied');
    if (branchCreateRes.status !== 'applied' || branchCreateRes.value.kind !== 'branch') {
      throw new Error('branch.create did not return a branch value');
    }
    const branchBId = branchCreateRes.value.branchId;

    // 2. edit on branch A (touches element[0] only; branch B below touches element[1],
    // so the two branches never conflict on the same field -- conflict resolution UI is
    // out of scope for this round-trip test, which exercises history/storage, not merge.ts)
    const targetElA = s01Doc.elements[0];
    const branchABeforeEdit = (await repo1.loadBranch(projectId, branchAId))!;
    const editARes = await repo1.execute({
      commandId: 'model.apply-records',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: branchAId,
      expectedWorkingRevision: branchABeforeEdit.workingRevision,
      actor: testActor,
      payload: {
        changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...targetElA, label: 'Branch A Edit' } } }],
      },
    });
    expect(editARes.status).toBe('applied');
    const branchAAfterEdit = (await repo1.loadBranch(projectId, branchAId))!;
    const snapA = (await repo1.loadSnapshot(projectId, branchAAfterEdit.workingSnapshotId))!;

    // 3. checkpoint on branch A
    const checkpointAId = crypto.randomUUID();
    const checkpointARes = await repo1.execute({
      commandId: 'history.checkpoint',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: branchAId,
      expectedWorkingRevision: branchAAfterEdit.workingRevision,
      actor: testActor,
      payload: { checkpointId: checkpointAId, label: 'Branch A checkpoint' },
    });
    expect(checkpointARes.status).toBe('applied');

    // 4. commit with evidence on branch A
    const { commitId: commitAId, command: commitACommand } = await commitBranch(repo1, projectId, branchAId, snapA.document);

    // 5. prepare + candidate runs + publish branch A (closed by default)
    const metadataA: PublicationMetadata = {
      version: { major: 0, minor: 1, patch: 0 },
      title: 'Publish A',
      rationale: 'First publication',
      ticketUrl: null,
    };
    const { publishRes: publishARes, candidateId: candidateAId } = await publishBranch(
      repo1,
      controller1,
      projectId,
      branchAId,
      snapA.document,
      metadataA,
      false,
    );
    expect(publishARes.status).toBe('applied');

    // 6. reopen branch A
    const branchAClosed = (await repo1.loadBranch(projectId, branchAId))!;
    const reopenRes = await repo1.execute({
      commandId: 'branch.reopen',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: branchAId,
      expectedWorkingRevision: branchAClosed.workingRevision,
      actor: testActor,
      payload: { expectedHeadId: commitAId },
    });
    expect(reopenRes.status).toBe('applied');

    // 7. edit -> commit -> prepare -> candidate runs -> publish branch B (kept open, so the
    // post-reload version-rule check below can prepare against it again)
    const targetElB = s01Doc.elements[1];
    const branchBBeforeEdit = (await repo1.loadBranch(projectId, branchBId))!;
    const editBRes = await repo1.execute({
      commandId: 'model.apply-records',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: branchBId,
      expectedWorkingRevision: branchBBeforeEdit.workingRevision,
      actor: testActor,
      payload: {
        changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...targetElB, label: 'Branch B Edit' } } }],
      },
    });
    expect(editBRes.status).toBe('applied');
    const branchBAfterEdit = (await repo1.loadBranch(projectId, branchBId))!;
    const snapB = (await repo1.loadSnapshot(projectId, branchBAfterEdit.workingSnapshotId))!;

    await commitBranch(repo1, projectId, branchBId, snapB.document);

    const metadataB: PublicationMetadata = {
      version: { major: 0, minor: 2, patch: 0 },
      title: 'Publish B',
      rationale: 'Second publication',
      ticketUrl: null,
    };
    const { publishRes: publishBRes, candidateId: candidateBId } = await publishBranch(
      repo1,
      controller1,
      projectId,
      branchBId,
      snapB.document,
      metadataB,
      true,
    );
    expect(publishBRes.status).toBe('applied');

    // 8. restore on A (non-main branch): back to the original creation snapshot
    const projectRow = (await repo1.loadProject(projectId))!;
    const branchAOpen = (await repo1.loadBranch(projectId, branchAId))!;
    const restoreCheckpointId = crypto.randomUUID();
    const restoreRes = await repo1.execute({
      commandId: 'history.restore',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: branchAId,
      expectedWorkingRevision: branchAOpen.workingRevision,
      actor: testActor,
      payload: {
        snapshotId: projectRow.initialSnapshotId,
        checkpointId: restoreCheckpointId,
        label: 'Pre-restore backup',
      },
    });
    expect(restoreRes.status).toBe('applied');

    // ---- Capture full pre-reload state ----
    const historyBefore = await repo1.loadHistory(projectId);
    const integrityBefore = await repo1.verifyReferenceIntegrity(projectId);
    expect(integrityBefore).toEqual({ ok: true });
    const publicationsBefore = await repo1.listPublications(projectId);
    const branchesBefore = await Promise.all(historyBefore.branches.map((b) => repo1.loadBranch(projectId, b.id)));

    for (const commit of historyBefore.commits) {
      const snap = (await repo1.loadSnapshot(projectId, commit.snapshotId))!;
      expect(await computeSnapshotId(snap.document)).toBe(snap.id);
    }

    db1.close();

    // ---- Reload: brand-new Dexie instance, same DB name ----
    const db2 = createStudioDatabase(dbName);
    const repo2 = new LocalRepository(db2);

    const historyAfter = await repo2.loadHistory(projectId);
    expect(historyAfter).toEqual(historyBefore);

    const integrityAfter = await repo2.verifyReferenceIntegrity(projectId);
    expect(integrityAfter).toEqual({ ok: true });

    // Heads, working snapshots and revisions unchanged.
    const branchesAfter = await Promise.all(historyAfter.branches.map((b) => repo2.loadBranch(projectId, b.id)));
    expect(branchesAfter).toEqual(branchesBefore);

    // Every snapshot re-hashes to its ID after reload.
    for (const commit of historyAfter.commits) {
      const snap = (await repo2.loadSnapshot(projectId, commit.snapshotId))!;
      expect(await computeSnapshotId(snap.document)).toBe(snap.id);
    }

    // A same-operationId retry of an earlier command returns its original receipt result.
    const retryOfCommitA = await repo2.execute(commitACommand as any);
    expect(retryOfCommitA.status).toBe('applied');
    if (retryOfCommitA.status === 'applied') {
      expect(retryOfCommitA.value).toEqual({
        kind: 'artifact',
        artifactType: 'commit',
        id: commitAId,
        revision: null,
      });
    }

    // A new CandidateController has no candidates.
    const controller2 = createCandidateController({ mintId: () => crypto.randomUUID() });
    expect(controller2.get(candidateAId)).toBeNull();
    expect(controller2.get(candidateBId)).toBeNull();

    // Publications, commits and ordinals are intact.
    const publicationsAfter = await repo2.listPublications(projectId);
    expect(publicationsAfter).toEqual(publicationsBefore);
    expect(publicationsAfter.map((p) => p.ordinal).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(publicationsAfter.map((p) => p.versionKey).sort()).toEqual(['0.1.0', '0.2.0']);

    // The version rule still holds: a lower version than the latest publication is invalid.
    const controller3 = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { publishRes: lowVersionRes } = await publishBranch(
      repo2,
      controller3,
      projectId,
      branchBId,
      snapB.document,
      {
        version: { major: 0, minor: 1, patch: 5 }, // lower than the latest published 0.2.0
        title: 'Should be rejected',
        rationale: '',
        ticketUrl: null,
      },
      true,
    );
    expect(lowVersionRes.status).toBe('invalid');
    if (lowVersionRes.status === 'invalid') {
      expect(lowVersionRes.issues.some((issue) => issue.path.includes('version'))).toBe(true);
    }

    db2.close();
  });
});

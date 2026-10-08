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
import { mintPublishTicket } from './publish-ticket';
import {
  DEFAULT_BUILD_VERSIONS,
  type Actor,
  type HistoryPublishCommand,
  type PublicationMetadata,
} from './types';

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
      title: 'Publish Test Project',
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

async function runAllCandidateScenarios(
  controller: CandidateController,
  repo: LocalRepository,
  candidateId: string,
  doc: Document,
) {
  const evidence: { scenarioId: Id; fingerprint: string; runId: string }[] = [];
  for (const scenario of doc.scenarios) {
    const res = await controller.startCandidateRun(repo, {
      candidateId,
      scenarioId: scenario.id,
      runId: crypto.randomUUID(),
    });
    expect(res.status).toBe('done');
    if (res.status !== 'done') throw new Error('candidate run failed');
    evidence.push({
      scenarioId: scenario.id,
      fingerprint: (res.saveResult as any).run.fingerprint,
      runId: res.runId,
    });
  }
  return evidence;
}

describe('Publish and Publication Lifecycle', () => {
  it('happy path end to end with real history: project -> branch -> edit -> commit -> prepare -> candidate runs -> publish', async () => {
    const db = createStudioDatabase(`test-pub-happy-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

    // 1. Edit branch by updating an element
    const targetEl = s01Doc.elements[0];
    const updatedEl = { ...targetEl, label: 'Publish Branch Element' };

    const editRes = await repo.execute({
      commandId: 'model.apply-records',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        changes: [
          {
            kind: 'replace',
            value: {
              recordKind: 'element',
              record: updatedEl,
            },
          },
        ],
      },
    });
    expect(editRes.status).toBe('applied');

    // Load updated branch working snapshot
    const branchRecord = (await repo.loadBranch(projectId, draftBranchId))!;
    expect(branchRecord.workingRevision).toBe(1);
    const snap = (await repo.loadSnapshot(projectId, branchRecord.workingSnapshotId))!;

    // 2. Commit with evidence
    const { commitId } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      1,
    );

    // 3. Prepare publish candidate
    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 2, // bumped after commit
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;
    const candidateId = prepRes.value.candidateId;
    const candidateSnapshotId = prepRes.value.snapshotId;

    // 4. Candidate runs
    const candRunEvidence = await runAllCandidateScenarios(
      controller,
      repo,
      candidateId,
      snap.document,
    );

    // 5. Publish v0.1.0
    const publicationId = crypto.randomUUID();
    const mergeCommitId = crypto.randomUUID();
    const metadata: PublicationMetadata = {
      version: { major: 0, minor: 1, patch: 0 },
      title: 'Initial Release',
      rationale: 'First production-ready publication',
      ticketUrl: 'https://example.com/tickets/SYS-101',
    };

    const pubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 2,
      actor: testActor,
      payload: {
        candidateId,
        publicationId,
        mergeCommitId,
        metadata,
        evidence: candRunEvidence,
        keepSourceOpen: false,
        expectedProjectRevision: 2, // project.create (0) -> edit (1) -> commit (2)
      },
    });
    expect(pubRes.status).toBe('applied');
    if (pubRes.status !== 'applied') return;

    expect(pubRes.projectRevision).toBe(3);
    expect(pubRes.branchRevision).toBe(3); // source workingRevision bumped from 2 to 3
    expect(pubRes.value).toEqual({
      kind: 'artifact',
      artifactType: 'publication',
      id: publicationId,
      revision: null,
    });

    // 6. Verify main branch state: head and working snapshot moved together
    const mainAfter = (await repo.loadBranch(projectId, mainBranchId))!;
    expect(mainAfter.headCommitId).toBe(mergeCommitId);
    expect(mainAfter.workingSnapshotId).toBe(candidateSnapshotId);
    expect(mainAfter.workingRevision).toBe(1); // bumped from 0 to 1

    // 7. Verify source branch: head and snapshot kept, closed by default, revision bumped
    const sourceAfter = (await repo.loadBranch(projectId, draftBranchId))!;
    expect(sourceAfter.state).toBe('closed');
    expect(sourceAfter.headCommitId).toBe(commitId);
    expect(sourceAfter.workingSnapshotId).toBe(branchRecord.workingSnapshotId);
    expect(sourceAfter.workingRevision).toBe(3);

    // 8. Verify merge commit: parent is [source head] since main was unborn
    const mergeCommit = (await repo.loadCommit(projectId, mergeCommitId))!;
    expect(mergeCommit.snapshotId).toBe(candidateSnapshotId);
    expect(mergeCommit.parentIds).toEqual([commitId]);
    expect(mergeCommit.message).toBe('Initial Release');
    expect(mergeCommit.actor).toEqual(testActor);

    // 9. Verify publication record: ordinal 1 with v0.1.0
    const pub = (await repo.loadPublication(projectId, publicationId))!;
    expect(pub.id).toBe(publicationId);
    expect(pub.commitId).toBe(mergeCommitId);
    expect(pub.sourceBranchId).toBe(draftBranchId);
    expect(pub.previousMainHeadId).toBeNull();
    expect(pub.ordinal).toBe(1);
    expect(pub.versionKey).toBe('0.1.0');
    expect(pub.metadata).toEqual(metadata);

    db.close();
  });

  it('keepSourceOpen true keeps source branch open', async () => {
    const db = createStudioDatabase(`test-pub-keep-open-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    const pubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Keep open publication',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: true,
        expectedProjectRevision: 1,
      },
    });

    expect(pubRes.status).toBe('applied');

    // Verify source is still open
    const sourceAfter = (await repo.loadBranch(projectId, draftBranchId))!;
    expect(sourceAfter.state).toBe('open');
    expect(sourceAfter.workingRevision).toBe(2);

    db.close();
  });

  it('receipt retry returns the original result without re-executing', async () => {
    const db = createStudioDatabase(`test-pub-receipt-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    const operationId = crypto.randomUUID();
    const publicationId = crypto.randomUUID();
    const mergeCommitId = crypto.randomUUID();

    const publishCmd: HistoryPublishCommand = {
      commandId: 'history.publish',
      operationId,
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId,
        mergeCommitId,
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Retry test',
          rationale: 'Idempotency test',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 1,
      },
    };

    const firstRes = await controller.publish(repo, publishCmd);
    expect(firstRes.status).toBe('applied');

    // Retry with identical command and operationId
    const retryRes = await controller.publish(repo, publishCmd);
    expect(retryRes.status).toBe('applied');
    if (firstRes.status === 'applied' && retryRes.status === 'applied') {
      expect(retryRes.operationId).toBe(firstRes.operationId);
      expect(retryRes.projectRevision).toBe(firstRes.projectRevision);
      expect(retryRes.value).toEqual(firstRes.value);
    }

    db.close();
  });

  it('rejects duplicate version with failed/duplicate-version', async () => {
    const db = createStudioDatabase(`test-pub-dup-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    // First publish 0.1.0
    const pubRes1 = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Initial 0.1.0',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: true,
        expectedProjectRevision: 1,
      },
    });
    expect(pubRes1.status).toBe('applied');

    // Re-prepare from updated source branch (revision 2) and main (revision 1)
    const prepRes2 = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 2,
      sourceHeadId: commitId,
      mainRevision: 1,
      mainHeadId: (pubRes1 as any).changedIds[1],
    });
    expect(prepRes2.status).toBe('done');
    if (prepRes2.status !== 'done') return;

    // Try to publish 0.1.0 again
    const pubRes2 = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 2,
      actor: testActor,
      payload: {
        candidateId: prepRes2.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Duplicate 0.1.0',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 2,
      },
    });

    expect(pubRes2.status).toBe('failed');
    if (pubRes2.status === 'failed') {
      expect(pubRes2.code).toBe('duplicate-version');
    }

    db.close();
  });

  it('rejects lower version with status invalid at metadata.version', async () => {
    const db = createStudioDatabase(`test-pub-lower-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    // Publish v1.0.0 first
    const pubRes1 = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 1, minor: 0, patch: 0 },
          title: 'Major v1.0.0',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: true,
        expectedProjectRevision: 1,
      },
    });
    expect(pubRes1.status).toBe('applied');

    // Re-prepare
    const prepRes2 = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 2,
      sourceHeadId: commitId,
      mainRevision: 1,
      mainHeadId: (pubRes1 as any).changedIds[1],
    });
    expect(prepRes2.status).toBe('done');
    if (prepRes2.status !== 'done') return;

    // Try to publish lower version v0.9.9
    const pubRes2 = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 2,
      actor: testActor,
      payload: {
        candidateId: prepRes2.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 9, patch: 9 },
          title: 'Lower version v0.9.9',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 2,
      },
    });

    expect(pubRes2.status).toBe('invalid');
    if (pubRes2.status === 'invalid') {
      expect(pubRes2.issues.some((i) => i.path.includes('version'))).toBe(true);
    }

    db.close();
  });

  it('rejects publish when main moved after prepare, leaving source branch intact and open', async () => {
    const db = createStudioDatabase(`test-pub-main-moved-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    // Prepare candidate
    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    // Simulate main moving: bump main revision directly in DB
    await db.branches.update([projectId, mainBranchId], {
      workingRevision: 99,
    });

    const pubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Stale main test',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 1,
      },
    });

    expect(pubRes.status).toBe('stale');
    if (pubRes.status === 'stale') {
      expect(pubRes.scope).toBe('branch');
    }

    // Assert nothing was written: source branch is still open and unchanged
    const sourceAfter = (await repo.loadBranch(projectId, draftBranchId))!;
    expect(sourceAfter.state).toBe('open');
    expect(sourceAfter.workingRevision).toBe(1);

    const publications = await repo.listPublications(projectId);
    expect(publications).toHaveLength(0);

    db.close();
  });

  it('rejects publish when source revision changed after prepare', async () => {
    const db = createStudioDatabase(`test-pub-source-rev-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    // Edit source branch to bump workingRevision
    const editRes = await repo.execute({
      commandId: 'model.apply-records',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        changes: [
          {
            kind: 'replace',
            value: {
              recordKind: 'scenario',
              record: snap.document.scenarios[0],
            },
          },
        ],
      },
    });
    expect(editRes.status).toBe('applied');

    // Attempt publish of prepared candidate
    const pubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Source moved test',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 2,
      },
    });

    expect(pubRes.status).toBe('stale');
    if (pubRes.status === 'stale') {
      expect(pubRes.scope).toBe('branch');
    }

    db.close();
  });

  it('rejects publish when expectedProjectRevision is stale', async () => {
    const db = createStudioDatabase(`test-pub-proj-stale-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    // Publish with wrong expectedProjectRevision (e.g. 999 instead of 1)
    const pubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Project stale test',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 999,
      },
    });

    expect(pubRes.status).toBe('stale');
    if (pubRes.status === 'stale') {
      expect(pubRes.scope).toBe('project');
      expect(pubRes.expected).toBe(999);
      expect(pubRes.actual).toBe(1);
    }

    db.close();
  });

  it('handles unknown candidate (missing) and a re-publish of an already-published candidate (rejected on moved tokens, not superseded)', async () => {
    const db = createStudioDatabase(`test-pub-candidate-lifecycle-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    // 1. Unknown candidateId -> missing
    const unknownId = crypto.randomUUID();
    const unknownRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: unknownId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Unknown test',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 1,
      },
    });
    expect(unknownRes.status).toBe('missing');
    if (unknownRes.status === 'missing') {
      expect(unknownRes.ids).toEqual([unknownId]);
    }

    // 2. Publish candidate -> succeeds
    const pubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Success publish',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: true,
        expectedProjectRevision: 1,
      },
    });
    expect(pubRes.status).toBe('applied');

    // The candidate must NOT be marked superseded by a successful publish.
    const candAfterPublish = controller.get(prepRes.value.candidateId);
    expect(candAfterPublish).not.toBeNull();
    expect(candAfterPublish!.superseded).toBe(false);

    // 3. Trying to publish again with a NEW operationId is rejected because main/source
    // tokens captured at prepare-time have moved (HEAD_MOVED or stale), never because of
    // a superseded-candidate shortcut.
    const republishRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 2, patch: 0 },
          title: 'Repeated publish attempt',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 2,
      },
    });
    expect(republishRes.status).not.toBe('applied');
    expect(['stale', 'failed']).toContain(republishRes.status);
    if (republishRes.status === 'failed') {
      expect(republishRes.code).toBe('conflict');
    }

    // Only the first publication exists; nothing extra was written.
    const publicationsAfter = await repo.listPublications(projectId);
    expect(publicationsAfter).toHaveLength(1);

    db.close();
  });

  it('rejects a forged ticket (plain object) with failed/ineligible', async () => {
    const db = createStudioDatabase(`test-pub-forged-ticket-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

    const forgedTicket = {
      candidateId: crypto.randomUUID(),
      projectId,
      sourceBranchId: draftBranchId,
      mainBranchId,
      expectedSourceRevision: 0,
      expectedSourceHeadId: null,
      expectedMainRevision: 0,
      expectedMainHeadId: null,
      snapshotId: 'fake-snapshot',
      document: s01Doc,
    };

    const forgedCmd: HistoryPublishCommand = {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        candidateId: forgedTicket.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Forged ticket test',
          rationale: '',
          ticketUrl: null,
        },
        evidence: [],
        keepSourceOpen: false,
        expectedProjectRevision: 0,
      },
    };

    // 1. Direct call to repo.publish with plain object
    const res1 = await repo.publish(forgedTicket, forgedCmd);
    expect(res1.status).toBe('failed');
    if (res1.status === 'failed') {
      expect(res1.code).toBe('ineligible');
    }

    // 2. Direct call to repo.execute() for history.publish (no ticket path at all; always rejected)
    const res2 = await repo.execute(forgedCmd);
    expect(res2.status).toBe('failed');
    if (res2.status === 'failed') {
      expect(res2.code).toBe('ineligible');
    }

    db.close();
  });

  it('candidate with changed fingerprint and only source-branch evidence fails ineligible, then after candidate runs publishes', async () => {
    const db = createStudioDatabase(`test-pub-fingerprint-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    // 1. Commit source branch with original s01Doc evidence
    const { commitId, evidence: sourceEvidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    // 2. Prepare candidate
    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;
    const candidateId = prepRes.value.candidateId;

    // 3. Suppose candidate document's scenario input was changed during conflict resolution or merge
    // Let's create a modified candidate using resolveConflict or modifying candidate
    // To cleanly test: let's resolve a conflict or simulate a candidate whose scenario fingerprint changed
    const cand = controller.get(candidateId)!;
    const modifiedDoc: Document = {
      ...cand.mergeState.document,
      scenarios: cand.mergeState.document.scenarios.map((s) => ({
        ...s,
        seed: s.seed + 9999,
      })),
    };
    const modifiedSnapshotId = await computeSnapshotId(modifiedDoc);

    // Replace candidate in controller with modified document
    const modifiedCand = Object.freeze({
      ...cand,
      mergeState: {
        ...cand.mergeState,
        document: modifiedDoc,
      },
      snapshotId: modifiedSnapshotId,
    });
    (controller as any).candidates.set(candidateId, modifiedCand);

    // 4. Try to publish using ONLY the source branch's evidence
    // Fingerprint of modifiedDoc scenario differs from source evidence fingerprint!
    const failPubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Changed fingerprint test',
          rationale: '',
          ticketUrl: null,
        },
        evidence: sourceEvidence,
        keepSourceOpen: false,
        expectedProjectRevision: 1,
      },
    });

    expect(failPubRes.status).toBe('failed');
    if (failPubRes.status === 'failed') {
      expect(failPubRes.code).toBe('ineligible');
      expect(
        failPubRes.issues.some(
          (i) => i.message.includes('not qualifying') || i.message.includes('fingerprint'),
        ),
      ).toBe(true);
    }

    // 5. Now run candidate run on the candidate document itself
    const newEvidence = await runAllCandidateScenarios(
      controller,
      repo,
      candidateId,
      modifiedDoc,
    );

    // 6. Publish with the candidate's own run evidence -> succeeds!
    const successPubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Candidate run verified publication',
          rationale: '',
          ticketUrl: null,
        },
        evidence: newEvidence,
        keepSourceOpen: false,
        expectedProjectRevision: 1,
      },
    });

    expect(successPubRes.status).toBe('applied');

    db.close();
  });

  it('injected failure between writes aborts everything and changes nothing', async () => {
    const db = createStudioDatabase(`test-pub-rollback-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    const prepRes = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prepRes.status).toBe('done');
    if (prepRes.status !== 'done') return;

    const pubId = crypto.randomUUID();
    const mergeCommitId = crypto.randomUUID();

    // Pre-insert a conflicting commit record with the SAME mergeCommitId but different content
    // so insertImmutable throws an error inside the publish transaction!
    await db.commits.put({
      projectId,
      id: mergeCommitId,
      snapshotId: 'conflicting-snapshot-id',
      parentIds: [],
      evidence: [],
      actor: testActor,
      createdAt: Date.now(),
      message: 'Conflicting commit',
    });

    const pubRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prepRes.value.candidateId,
        publicationId: pubId,
        mergeCommitId,
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Collision test',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false,
        expectedProjectRevision: 1,
      },
    });

    // Publish must fail
    expect(pubRes.status).toBe('failed');

    // Verify atomic rollback: source branch is still open, main head is still null
    const sourceAfter = (await repo.loadBranch(projectId, draftBranchId))!;
    expect(sourceAfter.state).toBe('open');
    expect(sourceAfter.workingRevision).toBe(1);

    const mainAfter = (await repo.loadBranch(projectId, mainBranchId))!;
    expect(mainAfter.headCommitId).toBeNull();
    expect(mainAfter.workingRevision).toBe(0);

    db.close();
  });

  it('reopen closed source branch then publish a higher version succeeds and lower is invalid', async () => {
    const db = createStudioDatabase(`test-pub-reopen-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, mainBranchId, draftBranchId } = await createTestProject(repo);

    const branch = (await repo.loadBranch(projectId, draftBranchId))!;
    const snap = (await repo.loadSnapshot(projectId, branch.workingSnapshotId))!;

    const { commitId, evidence } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      null,
      0,
    );

    // 1. Prepare and publish v0.1.0 -> source closes
    const prep1 = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 1,
      sourceHeadId: commitId,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prep1.status).toBe('done');
    if (prep1.status !== 'done') return;

    const pub1 = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prep1.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Release v0.1.0',
          rationale: '',
          ticketUrl: null,
        },
        evidence,
        keepSourceOpen: false, // default close
        expectedProjectRevision: 1,
      },
    });
    expect(pub1.status).toBe('applied');

    // Confirm source branch is closed
    const closedSource = (await repo.loadBranch(projectId, draftBranchId))!;
    expect(closedSource.state).toBe('closed');
    expect(closedSource.workingRevision).toBe(2);

    // 2. Reopen branch using branch.reopen
    const reopenRes = await repo.execute({
      commandId: 'branch.reopen',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 2,
      actor: testActor,
      payload: {
        expectedHeadId: commitId,
      },
    });
    expect(reopenRes.status).toBe('applied');

    const reopenedSource = (await repo.loadBranch(projectId, draftBranchId))!;
    expect(reopenedSource.state).toBe('open');
    expect(reopenedSource.workingRevision).toBe(3); // reopen increments revision

    // 3. Make another commit on reopened branch
    const { commitId: commitId2, evidence: evidence2 } = await commitBranch(
      repo,
      projectId,
      draftBranchId,
      snap.document,
      commitId,
      3,
    );

    const mainRecord = (await repo.loadBranch(projectId, mainBranchId))!;

    // 4. Prepare candidate from reopened branch against main
    const prep2 = await controller.prepare(repo, {
      projectId,
      sourceBranchId: draftBranchId,
      sourceRevision: 4, // 3 + 1 after commit
      sourceHeadId: commitId2,
      mainRevision: mainRecord.workingRevision,
      mainHeadId: mainRecord.headCommitId,
    });
    expect(prep2.status).toBe('done');
    if (prep2.status !== 'done') return;

    // 5. Try to publish same version v0.1.0 -> rejected failed/duplicate-version
    const dupRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 4,
      actor: testActor,
      payload: {
        candidateId: prep2.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Duplicate v0.1.0',
          rationale: '',
          ticketUrl: null,
        },
        evidence: evidence2,
        keepSourceOpen: false,
        expectedProjectRevision: (await repo.loadProject(projectId))!.revision,
      },
    });
    expect(dupRes.status).toBe('failed');
    if (dupRes.status === 'failed') {
      expect(dupRes.code).toBe('duplicate-version');
    }

    // 6. Try to publish lower version v0.0.5 -> invalid
    const lowerRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 4,
      actor: testActor,
      payload: {
        candidateId: prep2.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 0, patch: 5 },
          title: 'Lower v0.0.5',
          rationale: '',
          ticketUrl: null,
        },
        evidence: evidence2,
        keepSourceOpen: false,
        expectedProjectRevision: (await repo.loadProject(projectId))!.revision,
      },
    });
    expect(lowerRes.status).toBe('invalid');

    // 7. Publish higher version v0.2.0 -> succeeds!
    const higherRes = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: draftBranchId,
      expectedWorkingRevision: 4,
      actor: testActor,
      payload: {
        candidateId: prep2.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 2, patch: 0 },
          title: 'Higher v0.2.0',
          rationale: '',
          ticketUrl: null,
        },
        evidence: evidence2,
        keepSourceOpen: false,
        expectedProjectRevision: (await repo.loadProject(projectId))!.revision,
      },
    });
    expect(higherRes.status).toBe('applied');

    const pubs = await repo.listPublications(projectId);
    expect(pubs).toHaveLength(2);
    expect(pubs[0].versionKey).toBe('0.1.0');
    expect(pubs[0].ordinal).toBe(1);
    expect(pubs[1].versionKey).toBe('0.2.0');
    expect(pubs[1].ordinal).toBe(2);

    db.close();
  });

  it('second branch publishes after the first: merge base is first merge commit and main parents correct', async () => {
    const db = createStudioDatabase(`test-pub-two-branches-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
    const { projectId, mainBranchId, draftBranchId: branch1Id } = await createTestProject(repo);

    const branch1 = (await repo.loadBranch(projectId, branch1Id))!;
    const snap1 = (await repo.loadSnapshot(projectId, branch1.workingSnapshotId))!;

    // 1. Commit on branch 1
    const { commitId: commit1Id, evidence: evidence1 } = await commitBranch(
      repo,
      projectId,
      branch1Id,
      snap1.document,
      null,
      0,
    );

    // 2. Publish branch 1 as v0.1.0
    const prep1 = await controller.prepare(repo, {
      projectId,
      sourceBranchId: branch1Id,
      sourceRevision: 1,
      sourceHeadId: commit1Id,
      mainRevision: 0,
      mainHeadId: null,
    });
    expect(prep1.status).toBe('done');
    if (prep1.status !== 'done') return;

    const mergeCommit1Id = crypto.randomUUID();
    const pub1Res = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: branch1Id,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        candidateId: prep1.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: mergeCommit1Id,
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Branch 1 release',
          rationale: '',
          ticketUrl: null,
        },
        evidence: evidence1,
        keepSourceOpen: false,
        expectedProjectRevision: 1,
      },
    });
    expect(pub1Res.status).toBe('applied');

    // 3. Create branch 2 from main head
    const branch2Id = crypto.randomUUID();
    const createB2Res = await repo.execute({
      commandId: 'branch.create',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: mainBranchId,
      expectedWorkingRevision: 1,
      actor: testActor,
      payload: {
        newBranchId: branch2Id,
        label: 'Feature Branch 2',
        source: 'head',
        expectedHeadId: mergeCommit1Id,
      },
    });
    expect(createB2Res.status).toBe('applied');

    // 4. Edit and commit on branch 2
    const b2Record = (await repo.loadBranch(projectId, branch2Id))!;
    const b2Snap = (await repo.loadSnapshot(projectId, b2Record.workingSnapshotId))!;

    const targetEl2 = b2Snap.document.elements[0];
    const updatedEl2 = { ...targetEl2, label: 'Branch 2 Element' };

    const editB2 = await repo.execute({
      commandId: 'model.apply-records',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: branch2Id,
      expectedWorkingRevision: 0,
      actor: testActor,
      payload: {
        changes: [
          {
            kind: 'replace',
            value: {
              recordKind: 'element',
              record: updatedEl2,
            },
          },
        ],
      },
    });
    expect(editB2.status).toBe('applied');

    const b2AfterEdit = (await repo.loadBranch(projectId, branch2Id))!;
    const b2UpdatedSnap = (await repo.loadSnapshot(projectId, b2AfterEdit.workingSnapshotId))!;

    const { commitId: commit2Id, evidence: evidence2 } = await commitBranch(
      repo,
      projectId,
      branch2Id,
      b2UpdatedSnap.document,
      mergeCommit1Id, // parent is mergeCommit1Id
      1,
    );

    // 5. Prepare candidate for branch 2 against main
    const mainAfterPub1 = (await repo.loadBranch(projectId, mainBranchId))!;
    expect(mainAfterPub1.headCommitId).toBe(mergeCommit1Id);

    const prep2 = await controller.prepare(repo, {
      projectId,
      sourceBranchId: branch2Id,
      sourceRevision: 2, // 1 + 1 after commit
      sourceHeadId: commit2Id,
      mainRevision: mainAfterPub1.workingRevision,
      mainHeadId: mergeCommit1Id,
    });
    expect(prep2.status).toBe('done');
    if (prep2.status !== 'done') return;

    // Verify merge base was mergeCommit1Id
    const cand2 = controller.get(prep2.value.candidateId)!;
    expect(cand2.mergeBase.commitId).toBe(mergeCommit1Id);

    // 6. Publish branch 2 as v0.2.0
    const mergeCommit2Id = crypto.randomUUID();
    const pub2Res = await controller.publish(repo, {
      commandId: 'history.publish',
      operationId: crypto.randomUUID(),
      projectId,
      branchId: branch2Id,
      expectedWorkingRevision: 2,
      actor: testActor,
      payload: {
        candidateId: prep2.value.candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: mergeCommit2Id,
        metadata: {
          version: { major: 0, minor: 2, patch: 0 },
          title: 'Branch 2 release',
          rationale: '',
          ticketUrl: null,
        },
        evidence: evidence2,
        keepSourceOpen: false,
        expectedProjectRevision: (await repo.loadProject(projectId))!.revision,
      },
    });
    expect(pub2Res.status).toBe('applied');

    // 7. Verify merge commit 2 parent IDs: [main head, source head] = [mergeCommit1Id, commit2Id]
    const mergeCommit2 = (await repo.loadCommit(projectId, mergeCommit2Id))!;
    expect(mergeCommit2.parentIds).toEqual([mergeCommit1Id, commit2Id]);

    // 8. Verify main head is now mergeCommit2Id
    const mainFinal = (await repo.loadBranch(projectId, mainBranchId))!;
    expect(mainFinal.headCommitId).toBe(mergeCommit2Id);

    // 9. Verify publications list: 2 publications, ordinals 1 and 2
    const allPubs = await repo.listPublications(projectId);
    expect(allPubs).toHaveLength(2);
    expect(allPubs[0].ordinal).toBe(1);
    expect(allPubs[0].versionKey).toBe('0.1.0');
    expect(allPubs[0].commitId).toBe(mergeCommit1Id);
    expect(allPubs[0].previousMainHeadId).toBeNull();

    expect(allPubs[1].ordinal).toBe(2);
    expect(allPubs[1].versionKey).toBe('0.2.0');
    expect(allPubs[1].commitId).toBe(mergeCommit2Id);
    expect(allPubs[1].previousMainHeadId).toBe(mergeCommit1Id);

    db.close();
  });

  describe('Publish validation and ticket handling', () => {
    it('CandidateController.publish strictly validates envelope and payload without fallbacks', async () => {
      const db = createStudioDatabase(`test-pub-strict-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
      const { projectId, draftBranchId } = await createTestProject(repo);

      const commitRes = await commitBranch(repo, projectId, draftBranchId, s01Doc, null, 0);
      const prepRes = await controller.prepare(repo, {
        projectId,
        sourceBranchId: draftBranchId,
        sourceRevision: 1,
        sourceHeadId: commitRes.commitId,
        mainRevision: 0,
        mainHeadId: null,
      });
      expect(prepRes.status).toBe('done');
      if (prepRes.status !== 'done') return;

      const candidateId = prepRes.value.candidateId;

      // 1. Missing expectedWorkingRevision on envelope -> invalid at expectedWorkingRevision
      const missingRevCmd = {
        commandId: 'history.publish' as const,
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        actor: testActor,
        payload: {
          candidateId,
          publicationId: crypto.randomUUID(),
          mergeCommitId: crypto.randomUUID(),
          metadata: {
            version: { major: 0, minor: 1, patch: 0 },
            title: 'Strict envelope test',
            rationale: '',
            ticketUrl: null,
          },
          evidence: commitRes.evidence,
          expectedProjectRevision: 1,
        },
      };
      const res1 = await controller.publish(repo, missingRevCmd as any);
      expect(res1.status).toBe('invalid');
      if (res1.status === 'invalid') {
        expect(res1.issues.some((i) => i.path.includes('expectedWorkingRevision'))).toBe(true);
      }

      // 2. Missing evidence on payload (must NOT fallback to []) -> invalid at ['payload', 'evidence']
      const missingEvidenceCmd: any = {
        commandId: 'history.publish',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 1,
        actor: testActor,
        payload: {
          candidateId,
          publicationId: crypto.randomUUID(),
          mergeCommitId: crypto.randomUUID(),
          metadata: {
            version: { major: 0, minor: 1, patch: 0 },
            title: 'Missing evidence test',
            rationale: '',
            ticketUrl: null,
          },
          expectedProjectRevision: 1,
        },
      };
      const res2 = await controller.publish(repo, missingEvidenceCmd);
      expect(res2.status).toBe('invalid');
      if (res2.status === 'invalid') {
        expect(res2.issues.some((i) => i.path.join('.').includes('evidence'))).toBe(true);
      }

      // 3. keepSourceOpen wrong type -> invalid at ['payload', 'keepSourceOpen']
      const wrongKeepOpenCmd: any = {
        commandId: 'history.publish',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 1,
        actor: testActor,
        payload: {
          candidateId,
          publicationId: crypto.randomUUID(),
          mergeCommitId: crypto.randomUUID(),
          metadata: {
            version: { major: 0, minor: 1, patch: 0 },
            title: 'Wrong keepOpen test',
            rationale: '',
            ticketUrl: null,
          },
          evidence: commitRes.evidence,
          keepSourceOpen: 'not-a-bool',
          expectedProjectRevision: 1,
        },
      };
      const res3 = await controller.publish(repo, wrongKeepOpenCmd);
      expect(res3.status).toBe('invalid');
      if (res3.status === 'invalid') {
        expect(res3.issues.some((i) => i.path.includes('keepSourceOpen'))).toBe(true);
      }

      db.close();
    });

    it('CandidateController.publish rejects context mismatch without falling back', async () => {
      const db = createStudioDatabase(`test-pub-mismatch-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
      const { projectId, draftBranchId } = await createTestProject(repo);

      const commitRes = await commitBranch(repo, projectId, draftBranchId, s01Doc, null, 0);
      const prepRes = await controller.prepare(repo, {
        projectId,
        sourceBranchId: draftBranchId,
        sourceRevision: 1,
        sourceHeadId: commitRes.commitId,
        mainRevision: 0,
        mainHeadId: null,
      });
      expect(prepRes.status).toBe('done');
      if (prepRes.status !== 'done') return;

      const candidateId = prepRes.value.candidateId;
      const basePayload = {
        candidateId,
        publicationId: crypto.randomUUID(),
        mergeCommitId: crypto.randomUUID(),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Mismatch test',
          rationale: '',
          ticketUrl: null,
        },
        evidence: commitRes.evidence,
        expectedProjectRevision: 1,
      };

      // 1. ProjectId mismatch
      const wrongProjRes = await controller.publish(repo, {
        commandId: 'history.publish',
        operationId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        branchId: draftBranchId,
        expectedWorkingRevision: 1,
        actor: testActor,
        payload: basePayload,
      });
      expect(wrongProjRes.status).toBe('invalid');
      if (wrongProjRes.status === 'invalid') {
        expect(wrongProjRes.issues.some((i) => i.path.includes('projectId'))).toBe(true);
      }

      // 2. BranchId mismatch
      const wrongBranchRes = await controller.publish(repo, {
        commandId: 'history.publish',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: crypto.randomUUID(),
        expectedWorkingRevision: 1,
        actor: testActor,
        payload: basePayload,
      });
      expect(wrongBranchRes.status).toBe('invalid');
      if (wrongBranchRes.status === 'invalid') {
        expect(wrongBranchRes.issues.some((i) => i.path.includes('branchId'))).toBe(true);
      }

      // 3. ExpectedWorkingRevision mismatch
      const wrongRevRes = await controller.publish(repo, {
        commandId: 'history.publish',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 999,
        actor: testActor,
        payload: basePayload,
      });
      expect(wrongRevRes.status).toBe('invalid');
      if (wrongRevRes.status === 'invalid') {
        expect(wrongRevRes.issues.some((i) => i.path.includes('expectedWorkingRevision'))).toBe(true);
      }

      db.close();
    });

    it('repo.publish checks command.expectedWorkingRevision against ticket expectedSourceRevision', async () => {
      const db = createStudioDatabase(`test-repo-check-rev-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
      const { projectId, draftBranchId } = await createTestProject(repo);

      const commitRes = await commitBranch(repo, projectId, draftBranchId, s01Doc, null, 0);
      const prepRes = await controller.prepare(repo, {
        projectId,
        sourceBranchId: draftBranchId,
        sourceRevision: 1,
        sourceHeadId: commitRes.commitId,
        mainRevision: 0,
        mainHeadId: null,
      });
      expect(prepRes.status).toBe('done');
      if (prepRes.status !== 'done') return;

      const cand = controller.get(prepRes.value.candidateId)!;
      const opId = crypto.randomUUID();
      const ticket = mintPublishTicket({
        candidateId: cand.candidateId,
        projectId: cand.projectId,
        sourceBranchId: cand.sourceBranchId,
        mainBranchId: cand.mainBranchId,
        expectedSourceRevision: cand.expectedSourceRevision,
        expectedSourceHeadId: cand.expectedSourceHeadId,
        expectedMainRevision: cand.expectedMainRevision,
        expectedMainHeadId: cand.expectedMainHeadId,
        snapshotId: cand.snapshotId,
        document: cand.mergeState.document,
        operationId: opId,
      } as any);

      // Pass mismatched expectedWorkingRevision directly to repo.publish
      const mismatchedCmd: HistoryPublishCommand = {
        commandId: 'history.publish',
        operationId: opId,
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: cand.expectedSourceRevision + 42,
        actor: testActor,
        payload: {
          candidateId: cand.candidateId,
          publicationId: crypto.randomUUID(),
          mergeCommitId: crypto.randomUUID(),
          metadata: {
            version: { major: 0, minor: 1, patch: 0 },
            title: 'Mismatched rev',
            rationale: '',
            ticketUrl: null,
          },
          evidence: commitRes.evidence,
          expectedProjectRevision: 1,
        },
      };

      const res = await repo.publish(ticket, mismatchedCmd);
      expect(res.status).toBe('invalid');
      if (res.status === 'invalid') {
        expect(res.issues.some((i) => i.path.includes('expectedWorkingRevision'))).toBe(true);
      }

      db.close();
    });

    it('successful publish does NOT mark candidate superseded; retry with same opId succeeds; new opId fails on moved tokens', async () => {
      const db = createStudioDatabase(`test-pub-no-superseded-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
      const { projectId, draftBranchId } = await createTestProject(repo);

      const commitRes = await commitBranch(repo, projectId, draftBranchId, s01Doc, null, 0);
      const prepRes = await controller.prepare(repo, {
        projectId,
        sourceBranchId: draftBranchId,
        sourceRevision: 1,
        sourceHeadId: commitRes.commitId,
        mainRevision: 0,
        mainHeadId: null,
      });
      expect(prepRes.status).toBe('done');
      if (prepRes.status !== 'done') return;

      const candidateId = prepRes.value.candidateId;
      const opId = crypto.randomUUID();

      const publishCmd: HistoryPublishCommand = {
        commandId: 'history.publish',
        operationId: opId,
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 1,
        actor: testActor,
        payload: {
          candidateId,
          publicationId: crypto.randomUUID(),
          mergeCommitId: crypto.randomUUID(),
          metadata: {
            version: { major: 0, minor: 1, patch: 0 },
            title: 'Non-superseding publish',
            rationale: '',
            ticketUrl: null,
          },
          evidence: commitRes.evidence,
          keepSourceOpen: true,
          expectedProjectRevision: 1,
        },
      };

      // 1. Initial publish
      const pubRes1 = await controller.publish(repo, publishCmd);
      expect(pubRes1.status).toBe('applied');

      // Candidate must NOT be marked superseded!
      const candAfter = controller.get(candidateId);
      expect(candAfter).not.toBeNull();
      expect(candAfter!.superseded).toBe(false);

      // 2. Retry with identical operationId -> identical applied result from receipt
      const retryRes = await controller.publish(repo, publishCmd);
      expect(retryRes.status).toBe('applied');
      expect(retryRes).toEqual(pubRes1);

      // 3. Different operationId after success -> rejected (moved main tokens / HEAD_MOVED), nothing written
      const diffOpCmd: HistoryPublishCommand = {
        ...publishCmd,
        operationId: crypto.randomUUID(),
      };
      const diffOpRes = await controller.publish(repo, diffOpCmd);
      expect(diffOpRes.status).not.toBe('applied');
      // Should not be 'ineligible' due to candidate superseded; should be conflict or stale due to moved tokens
      if (diffOpRes.status === 'failed') {
        expect(diffOpRes.code).toBe('conflict');
      }

      // Verify nothing additional was written
      const publications = await repo.listPublications(projectId);
      expect(publications).toHaveLength(1);

      db.close();
    });

    it('repo.execute() without registered ticket returns failed/ineligible', async () => {
      const db = createStudioDatabase(`test-execute-no-ticket-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const { projectId, draftBranchId } = await createTestProject(repo);

      const publishCmd = {
        commandId: 'history.publish',
        operationId: crypto.randomUUID(),
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: 1,
        actor: testActor,
        payload: {
          candidateId: crypto.randomUUID(),
          publicationId: crypto.randomUUID(),
          mergeCommitId: crypto.randomUUID(),
          metadata: {
            version: { major: 0, minor: 1, patch: 0 },
            title: 'No ticket test',
            rationale: '',
            ticketUrl: null,
          },
          evidence: [],
          expectedProjectRevision: 1,
        },
      };

      const res = await repo.execute(publishCmd as any);
      expect(res.status).toBe('failed');
      if (res.status === 'failed') {
        expect(res.code).toBe('ineligible');
      }

      db.close();
    });

    it('ticket is single-use for one operationId and rejects different operationId', async () => {
      const db = createStudioDatabase(`test-ticket-single-use-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const controller = createCandidateController({ mintId: () => crypto.randomUUID() });
      const { projectId, draftBranchId } = await createTestProject(repo);

      const commitRes = await commitBranch(repo, projectId, draftBranchId, s01Doc, null, 0);
      const prepRes = await controller.prepare(repo, {
        projectId,
        sourceBranchId: draftBranchId,
        sourceRevision: 1,
        sourceHeadId: commitRes.commitId,
        mainRevision: 0,
        mainHeadId: null,
      });
      expect(prepRes.status).toBe('done');
      if (prepRes.status !== 'done') return;

      const cand = controller.get(prepRes.value.candidateId)!;
      const opId1 = crypto.randomUUID();
      const opId2 = crypto.randomUUID();

      const ticket = mintPublishTicket({
        candidateId: cand.candidateId,
        projectId: cand.projectId,
        sourceBranchId: cand.sourceBranchId,
        mainBranchId: cand.mainBranchId,
        expectedSourceRevision: cand.expectedSourceRevision,
        expectedSourceHeadId: cand.expectedSourceHeadId,
        expectedMainRevision: cand.expectedMainRevision,
        expectedMainHeadId: cand.expectedMainHeadId,
        snapshotId: cand.snapshotId,
        document: cand.mergeState.document,
        operationId: opId1,
      } as any);

      // Reusing ticket with a different operationId -> rejected
      const reusedTicketCmd: HistoryPublishCommand = {
        commandId: 'history.publish',
        operationId: opId2,
        projectId,
        branchId: draftBranchId,
        expectedWorkingRevision: cand.expectedSourceRevision,
        actor: testActor,
        payload: {
          candidateId: cand.candidateId,
          publicationId: crypto.randomUUID(),
          mergeCommitId: crypto.randomUUID(),
          metadata: {
            version: { major: 0, minor: 1, patch: 0 },
            title: 'Reused ticket test',
            rationale: '',
            ticketUrl: null,
          },
          evidence: commitRes.evidence,
          expectedProjectRevision: 1,
        },
      };

      const res = await repo.publish(ticket, reusedTicketCmd);
      expect(res.status).toBe('invalid');
      if (res.status === 'invalid') {
        expect(res.issues.some((i) => i.path.includes('operationId'))).toBe(true);
      }

      db.close();
    });
  });
});

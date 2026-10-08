/**
 * Export/import round trip and rejection tests.
 *
 * Builds a real repository-driven history (branches, commits with evidence, a publication,
 * checkpoints, runs) using the same repository-driven helpers as reload.test.ts, exports
 * it, mutates the bytes to exercise every rejection path, and re-imports the untouched bytes to assert a lossless round trip modulo the
 * fields the bundle format excludes.
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
import {
  DEFAULT_BUILD_VERSIONS,
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
  STORAGE_LIMITS,
  type Actor,
  type PublicationMetadata,
  type ProjectCreateCommand,
} from './types';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');
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
  return { scenarioId, fingerprint: prep.fingerprint, runId };
}

async function commitBranch(repo: LocalRepository, projectId: Id, branchId: Id, doc: Document) {
  const evidence: { scenarioId: Id; fingerprint: string; runId: Id }[] = [];
  for (const scenario of doc.scenarios) {
    evidence.push(await runAndSaveScenario(repo, projectId, doc, scenario.id));
  }
  const branch = (await repo.loadBranch(projectId, branchId))!;
  const commitId = crypto.randomUUID();
  const res = await repo.execute({
    commandId: 'history.commit',
    operationId: crypto.randomUUID(),
    projectId,
    branchId,
    expectedWorkingRevision: branch.workingRevision,
    actor: testActor,
    payload: { commitId, expectedHeadId: branch.headCommitId, message: 'export/import test commit', evidence },
  });
  expect(res.status).toBe('applied');
  return commitId;
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
    if (res.status !== 'done') throw new Error(`candidate run failed: ${JSON.stringify(res)}`);
    evidence.push({ scenarioId: scenario.id, fingerprint: (res.saveResult as any).run.fingerprint, runId: res.runId });
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
  const publishRes = await controller.publish(repo, {
    commandId: 'history.publish',
    operationId: crypto.randomUUID(),
    projectId,
    branchId: sourceBranchId,
    expectedWorkingRevision: source.workingRevision,
    actor: testActor,
    payload: {
      candidateId: prep.value.candidateId,
      publicationId: crypto.randomUUID(),
      mergeCommitId: crypto.randomUUID(),
      metadata,
      evidence,
      keepSourceOpen: false,
      expectedProjectRevision: project.revision,
    },
  });
  expect(publishRes.status).toBe('applied');
}

/** Builds a real repository-driven history: branch, commit with evidence, checkpoint, publication. */
async function buildHistory(): Promise<{ repo: LocalRepository; db: ReturnType<typeof createStudioDatabase>; projectId: Id }> {
  const dbName = `${DB_NAME}-export-${crypto.randomUUID()}`;
  const db = createStudioDatabase(dbName);
  const repo = new LocalRepository(db, { mintId: () => crypto.randomUUID() });
  const controller = createCandidateController({ mintId: () => crypto.randomUUID() });

  const projectId = crypto.randomUUID();
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();
  const createCmd: ProjectCreateCommand = {
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: { newProjectId: projectId, title: 'Export Test Project', initialDocument: s01Doc, mainBranchId, draftBranchId },
  };
  expect((await repo.execute(createCmd)).status).toBe('applied');

  // checkpoint on the draft branch
  const draftBranch = (await repo.loadBranch(projectId, draftBranchId))!;
  const checkpointRes = await repo.execute({
    commandId: 'history.checkpoint',
    operationId: crypto.randomUUID(),
    projectId,
    branchId: draftBranchId,
    expectedWorkingRevision: draftBranch.workingRevision,
    actor: testActor,
    payload: { checkpointId: crypto.randomUUID(), label: 'cp1' },
  });
  expect(checkpointRes.status).toBe('applied');

  await commitBranch(repo, projectId, draftBranchId, s01Doc);

  const metadata: PublicationMetadata = {
    version: { major: 0, minor: 1, patch: 0 },
    title: 'First publish',
    rationale: 'export test',
    ticketUrl: null,
  };
  await publishBranch(repo, controller, projectId, draftBranchId, s01Doc, metadata);

  return { repo, db, projectId };
}

describe('Export/import round trip and rejections', () => {
  it('exports a real history and round-trips it into a fresh project, lossless modulo the excluded fields', async () => {
    const { repo, db, projectId } = await buildHistory();
    const integrity = await repo.verifyReferenceIntegrity(projectId);
    expect(integrity).toEqual({ ok: true });

    const project = (await repo.loadProject(projectId))!;
    const exportRes1 = await repo.exportProject({ projectId, expectedProjectRevision: project.revision });
    expect(exportRes1.status).toBe('done');
    if (exportRes1.status !== 'done') throw new Error('unreachable');

    // Exporting twice gives byte-identical output with the same sha256.
    const exportRes2 = await repo.exportProject({ projectId, expectedProjectRevision: project.revision });
    expect(exportRes2.status).toBe('done');
    if (exportRes2.status !== 'done') throw new Error('unreachable');
    expect(Buffer.from(exportRes1.bytes)).toEqual(Buffer.from(exportRes2.bytes));
    expect(exportRes1.sha256).toBe(exportRes2.sha256);

    const envelope = JSON.parse(new TextDecoder().decode(exportRes1.bytes));
    expect(envelope.format).toBe(PORTABLE_FORMAT);
    expect(envelope.version).toBe(PORTABLE_VERSION);
    expect(envelope.project.id).toBe(projectId);
    // Excluded fields never appear.
    expect(envelope.project.revision).toBeUndefined();
    expect(envelope.project.importSourceId).toBeUndefined();
    for (const run of envelope.project.runs) {
      expect(run.traceState).toBe('not-saved');
    }

    // Stale export is rejected.
    const staleExport = await repo.exportProject({ projectId, expectedProjectRevision: project.revision + 1 });
    expect(staleExport.status).toBe('stale');

    // ---- Import into a fresh project ----
    const importRepo = repo; // same repository instance owns the file token registry
    const fileToken = await importRepo.fileTokens.registerFile(exportRes1.bytes, () => crypto.randomUUID());
    const newProjectId = crypto.randomUUID();
    const importRes = await importRepo.importProject({
      commandId: 'project.import',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: { fileToken, newProjectId },
    });
    expect(importRes.status).toBe('applied');

    const historyBefore = await repo.loadHistory(projectId);
    const historyAfter = await repo.loadHistory(newProjectId);

    function normalizeBranch(b: any) {
      const { headCommitId, ...rest } = b;
      return rest;
    }
    // Branch/commit/publication/checkpoint IDs and content are identical modulo projectId.
    expect(historyAfter.branches.map((b) => normalizeBranch({ ...b, projectId: undefined }))).toEqual(
      historyBefore.branches.map((b) => normalizeBranch({ ...b, projectId: undefined })),
    );
    expect(historyAfter.commits.map((c) => ({ ...c, projectId: undefined }))).toEqual(
      historyBefore.commits.map((c) => ({ ...c, projectId: undefined })),
    );
    expect(historyAfter.publications.map((p) => ({ ...p, projectId: undefined }))).toEqual(
      historyBefore.publications.map((p) => ({ ...p, projectId: undefined })),
    );
    expect(historyAfter.checkpoints.map((c) => ({ ...c, projectId: undefined }))).toEqual(
      historyBefore.checkpoints.map((c) => ({ ...c, projectId: undefined })),
    );

    const newProject = (await repo.loadProject(newProjectId))!;
    expect(newProject.importSourceId).toBe(projectId);
    expect(newProject.revision).toBe(0);

    const importedRuns = await repo.listRuns(newProjectId);
    expect(importedRuns.length).toBeGreaterThan(0);
    for (const run of importedRuns) {
      expect(run.provenance).toBe('imported-unverified');
      expect(run.traceState).toBe('not-saved');
    }

    const integrityAfterImport = await repo.verifyReferenceIntegrity(newProjectId);
    expect(integrityAfterImport).toEqual({ ok: true });

    // Same operationId retry returns the original result.
    const retry = await repo.importProject({
      commandId: 'project.import',
      operationId: importRes.status === 'applied' ? importRes.operationId : '',
      actor: testActor,
      payload: { fileToken, newProjectId },
    });
    expect(retry).toEqual(importRes);

    // Importing the SAME bytes again under a different newProjectId creates a second,
    // fully independent project.
    const fileToken2 = await importRepo.fileTokens.registerFile(exportRes1.bytes, () => crypto.randomUUID());
    const secondProjectId = crypto.randomUUID();
    const secondImport = await importRepo.importProject({
      commandId: 'project.import',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: { fileToken: fileToken2, newProjectId: secondProjectId },
    });
    expect(secondImport.status).toBe('applied');
    expect(secondProjectId).not.toBe(newProjectId);
    const secondHistory = await repo.loadHistory(secondProjectId);
    expect(secondHistory.commits.length).toBe(historyBefore.commits.length);

    // Imported evidence never qualifies: commit + publish on the imported project need
    // fresh local runs (the run rows exist but are provenance 'imported-unverified', so
    // runQualifies must reject them for eligibility -- exercised at the eligibility layer
    // in eligibility.test.ts; here we assert the persisted provenance directly, which is
    // the fact that predicate depends on).
    const allImportedRuns = await repo.listRuns(newProjectId);
    expect(allImportedRuns.every((r) => r.provenance === 'imported-unverified')).toBe(true);

    db.close();
  });

  it('rejects a forged/plain file token (unknown to the registry) as missing', async () => {
    const db = createStudioDatabase(`test-import-forged-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const res = await repo.importProject({
      commandId: 'project.import',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: { fileToken: { id: crypto.randomUUID() }, newProjectId: crypto.randomUUID() },
    });
    expect(res.status).toBe('missing');
    db.close();
  });

  describe('import rejections write nothing', () => {
    async function importBytes(bytes: Uint8Array) {
      const db = createStudioDatabase(`test-import-reject-${crypto.randomUUID()}`);
      const repo = new LocalRepository(db);
      const fileToken = await repo.fileTokens.registerFile(bytes, () => crypto.randomUUID());
      const newProjectId = crypto.randomUUID();
      const res = await repo.importProject({
        commandId: 'project.import',
        operationId: crypto.randomUUID(),
        actor: testActor,
        payload: { fileToken, newProjectId },
      });
      const projectCount = await db.projects.count();
      db.close();
      return { res, projectCount };
    }

    function envelopeBytes(project: unknown, overrides: Record<string, unknown> = {}) {
      const envelope = { format: PORTABLE_FORMAT, version: PORTABLE_VERSION, project, ...overrides };
      return new TextEncoder().encode(JSON.stringify(envelope));
    }

    let goodEnvelope: any;
    let goodBytes: Uint8Array;

    it('sets up a valid baseline bundle to mutate', async () => {
      const { repo, db, projectId } = await buildHistory();
      const project = (await repo.loadProject(projectId))!;
      const exportRes = await repo.exportProject({ projectId, expectedProjectRevision: project.revision });
      if (exportRes.status !== 'done') throw new Error('export failed');
      goodBytes = exportRes.bytes;
      goodEnvelope = JSON.parse(new TextDecoder().decode(goodBytes));
      db.close();
      expect(goodEnvelope.project.commits.length).toBeGreaterThan(0);
    });

    it('rejects version 7', async () => {
      const { res, projectCount } = await importBytes(envelopeBytes(goodEnvelope.project, { version: 7 }));
      expect(res.status).toBe('failed');
      if (res.status === 'failed') expect(res.code).toBe('unsupported-version');
      expect(projectCount).toBe(0);
    });

    it('rejects version 8', async () => {
      const { res, projectCount } = await importBytes(envelopeBytes(goodEnvelope.project, { version: 8 }));
      expect(res.status).toBe('failed');
      if (res.status === 'failed') expect(res.code).toBe('unsupported-version');
      expect(projectCount).toBe(0);
    });

    it('rejects version 99 (unknown)', async () => {
      const { res, projectCount } = await importBytes(envelopeBytes(goodEnvelope.project, { version: 99 }));
      expect(res.status).toBe('failed');
      if (res.status === 'failed') expect(res.code).toBe('unsupported-version');
      expect(projectCount).toBe(0);
    });

    it('rejects a JSON object without a string format with a plain message and typed code', async () => {
      for (const body of [{ hello: 'world' }, { format: 3 }]) {
        const { res, projectCount } = await importBytes(new TextEncoder().encode(JSON.stringify(body)));
        expect(res.status).toBe('failed');
        if (res.status === 'failed') {
          expect(res.code).toBe('unsupported-version');
          expect(JSON.stringify(res)).not.toContain('undefined');
          expect(JSON.stringify(res)).toContain("isn't a CanvasOne project export");
        }
        expect(projectCount).toBe(0);
      }
    });

    it('rejects a file over 64 MiB, checked before parse', async () => {
      // A crude but valid JSON payload padded past the 64 MiB cap.
      const padding = 'x'.repeat(65 * 1024 * 1024);
      const bytes = new TextEncoder().encode(`{"format":"system-studio","version":9,"padding":"${padding}"}`);
      const { res, projectCount } = await importBytes(bytes);
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects raw depth 41', async () => {
      // 41 nested arrays -> raw depth 41 (root = 1), which exceeds the 40 cap.
      let deep = '0';
      for (let i = 0; i < 41; i++) deep = `[${deep}]`;
      const bytes = new TextEncoder().encode(`{"format":"system-studio","version":9,"project":${deep}}`);
      const { res, projectCount } = await importBytes(bytes);
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects 100,001 containers', async () => {
      const items = new Array(100_001).fill('{}').join(',');
      const bytes = new TextEncoder().encode(`{"format":"system-studio","version":9,"project":[${items}]}`);
      const { res, projectCount } = await importBytes(bytes);
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects a tampered snapshot hash', async () => {
      const project = structuredClone(goodEnvelope.project);
      project.snapshots[0] = { ...project.snapshots[0], id: '0'.repeat(64) };
      const { res, projectCount } = await importBytes(envelopeBytes(project));
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects a dangling commit parent', async () => {
      const project = structuredClone(goodEnvelope.project);
      project.commits[0] = { ...project.commits[0], parentIds: [crypto.randomUUID()] };
      const { res, projectCount } = await importBytes(envelopeBytes(project));
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects a commit cycle', async () => {
      const project = structuredClone(goodEnvelope.project);
      if (project.commits.length < 2) throw new Error('fixture needs >=2 commits for a cycle');
      const a = project.commits[0];
      const b = project.commits[1];
      project.commits[0] = { ...a, parentIds: [b.id] };
      project.commits[1] = { ...b, parentIds: [a.id] };
      const { res, projectCount } = await importBytes(envelopeBytes(project));
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects a non-contiguous publication ordinal', async () => {
      const project = structuredClone(goodEnvelope.project);
      if (project.publications.length === 0) throw new Error('fixture needs a publication');
      project.publications[0] = { ...project.publications[0], ordinal: 2 };
      const { res, projectCount } = await importBytes(envelopeBytes(project));
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects a decreasing publication version', async () => {
      const project = structuredClone(goodEnvelope.project);
      // Add a second publication with a lower version than the first.
      project.publications.push({
        ...project.publications[0],
        id: crypto.randomUUID(),
        ordinal: 2,
        versionKey: '0.0.1',
        metadata: { ...project.publications[0].metadata, version: { major: 0, minor: 0, patch: 1 } },
      });
      const { res, projectCount } = await importBytes(envelopeBytes(project));
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects a versionKey mismatch', async () => {
      const project = structuredClone(goodEnvelope.project);
      project.publications[0] = { ...project.publications[0], versionKey: '9.9.9' };
      const { res, projectCount } = await importBytes(envelopeBytes(project));
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects an evidence ref to a missing run', async () => {
      const project = structuredClone(goodEnvelope.project);
      const commitWithEvidence = project.commits.find((c: any) => c.evidence.length > 0);
      if (!commitWithEvidence) throw new Error('fixture needs a commit with evidence');
      commitWithEvidence.evidence = [
        { scenarioId: crypto.randomUUID(), fingerprint: 'x'.repeat(64), runId: crypto.randomUUID() },
      ];
      const { res, projectCount } = await importBytes(envelopeBytes(project));
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('rejects an unknown extra key', async () => {
      const project = { ...structuredClone(goodEnvelope.project), extraField: 'nope' };
      const { res, projectCount } = await importBytes(envelopeBytes(project));
      expect(res.status).toBe('invalid');
      expect(projectCount).toBe(0);
    });

    it('enforces byte limits on import: over-cap -> failed/limit, nothing written', async () => {
      // Same technique as limits.test.ts's own byte-cap tests: STORAGE_LIMITS is a plain
      // object (not frozen), so the ceiling can be lowered under the bundle's real
      // accounted size for this one assertion, then restored.
      const originalMaxLocalProjectBytes = STORAGE_LIMITS.maxLocalProjectBytes;
      (STORAGE_LIMITS as { maxLocalProjectBytes: number }).maxLocalProjectBytes = 10;
      try {
        const { res, projectCount } = await importBytes(envelopeBytes(goodEnvelope.project));
        expect(res.status).toBe('failed');
        if (res.status === 'failed') expect(res.code).toBe('limit');
        expect(projectCount).toBe(0);
      } finally {
        (STORAGE_LIMITS as { maxLocalProjectBytes: number }).maxLocalProjectBytes = originalMaxLocalProjectBytes;
      }
    });
  });
});

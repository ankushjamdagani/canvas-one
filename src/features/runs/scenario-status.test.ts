import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '../../domain/studio/model';
import { createStudioDatabase } from '../../persistence/studio/db';
import { LocalRepository } from '../../persistence/studio/repository';
import { computeSnapshotId } from '../../persistence/studio/primitives';
import { mintRunStartToken } from '../../persistence/studio/token';
import { buildManifest } from '../../domain/studio/manifest';
import { DEFAULT_BUILD_VERSIONS, type Actor, type ProjectCreateCommand } from '../../persistence/studio/types';
import { deriveScenarioStatus, loadScenarioStatuses } from './scenarioStatus';

const s01Doc = JSON.parse(
  readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

async function setupTestProject(repo: LocalRepository, doc: Document, projectId = crypto.randomUUID()) {
  const mainBranchId = crypto.randomUUID();
  const draftBranchId = crypto.randomUUID();
  const createCmd: ProjectCreateCommand = {
    commandId: 'project.create',
    operationId: crypto.randomUUID(),
    actor: testActor,
    payload: {
      newProjectId: projectId,
      title: 'ScenarioStatus Test Project',
      initialDocument: doc,
      mainBranchId,
      draftBranchId,
    },
  };
  await repo.execute(createCmd);
  const snapshotId = await computeSnapshotId(doc);
  return { projectId, branchId: draftBranchId, snapshotId };
}

describe('scenarioStatus derivation and loader', () => {
  it('pure deriveScenarioStatus covers not-run, passed, needs-rerun, failed', () => {
    const scenarioId = s01Doc.scenarios[0].id;
    const currentFingerprint = 'ss-run-v1:fp-current';
    const compiledScope = s01Doc.scenarios[0].scopeElementIds;

    // 1. not-run: no runs exist
    const statusNotRun = deriveScenarioStatus(scenarioId, currentFingerprint, [], compiledScope);
    expect(statusNotRun.kind).toBe('not-run');

    // 2. passed: qualifying run exists for current fingerprint
    const passingRun: any = {
      id: 'run-pass',
      projectId: 'proj-1',
      snapshotId: 'snap-1',
      manifest: {
        scenario: { id: scenarioId, assertions: [{ subject: { kind: 'final-state', elementId: compiledScope[0] } }] },
      },
      fingerprint: currentFingerprint,
      status: 'completed',
      provenance: 'local',
      checks: [{ assertionId: 'a1', status: 'passed', actual: 'succeeded', reason: null }],
      summary: {
        mode: 'logical',
        consumedInputs: 1,
        rootCounts: { generated: 1, succeeded: 1, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
      },
      completedAt: 1000,
    };

    const statusPassed = deriveScenarioStatus(
      scenarioId,
      currentFingerprint,
      [passingRun],
      compiledScope,
    );
    expect(statusPassed.kind).toBe('passed');

    // 3. needs-rerun: latest run had a different fingerprint (document was edited)
    const oldRun: any = {
      ...passingRun,
      id: 'run-old',
      fingerprint: 'ss-run-v1:fp-old-version',
      completedAt: 2000,
    };
    const statusNeedsRerun = deriveScenarioStatus(
      scenarioId,
      currentFingerprint,
      [oldRun],
      compiledScope,
    );
    expect(statusNeedsRerun.kind).toBe('needs-rerun');

    // 4. failed: latest run for current fingerprint failed checks
    const failingRun: any = {
      ...passingRun,
      id: 'run-fail',
      fingerprint: currentFingerprint,
      checks: [
        { assertionId: 'a1', status: 'passed', actual: 'succeeded', reason: null },
        { assertionId: 'a2', status: 'failed', actual: 'editing', reason: 'State mismatch' },
      ],
      completedAt: 3000,
    };
    const statusFailed = deriveScenarioStatus(
      scenarioId,
      currentFingerprint,
      [failingRun],
      compiledScope,
    );
    expect(statusFailed.kind).toBe('failed');
    if (statusFailed.kind === 'failed') {
      expect(statusFailed.passedChecks).toBe(1);
      expect(statusFailed.totalChecks).toBe(2);
    }
  });

  it('a runner version bump alone makes a saved passing run need a rerun (D47-D50)', async () => {
    const scenario = s01Doc.scenarios[0];
    const older = { ...DEFAULT_BUILD_VERSIONS, runnerVersions: [{ runnerId: 'studio-runner', version: 'studio-runner/4' }] };
    const before = await buildManifest(s01Doc, scenario.id, older);
    const now = await buildManifest(s01Doc, scenario.id, DEFAULT_BUILD_VERSIONS);
    if (before.status !== 'ok' || now.status !== 'ok') throw new Error('manifest not built');
    expect(DEFAULT_BUILD_VERSIONS.runnerVersions[0].version).not.toBe('studio-runner/4');
    expect(now.fingerprint).not.toBe(before.fingerprint);

    const runUnderOldRunner: any = {
      id: 'run-old-runner',
      manifest: before.manifest,
      fingerprint: before.fingerprint,
      status: 'completed',
      provenance: 'local',
      checks: [{ assertionId: 'a1', status: 'passed', actual: 'succeeded', reason: null }],
      summary: { mode: 'logical', consumedInputs: 1, rootCounts: { generated: 1, succeeded: 1, rejected: 0, failed: 0, expired: 0, inFlight: 0 } },
      completedAt: 1000,
    };
    const scope = now.manifest.scope.includedElementIds;
    expect(deriveScenarioStatus(scenario.id, before.fingerprint, [runUnderOldRunner], scope).kind).toBe('passed');
    expect(deriveScenarioStatus(scenario.id, now.fingerprint, [runUnderOldRunner], scope).kind).toBe('needs-rerun');
  });

  it('Item 6: deriveScenarioStatus returns not-ready when the manifest cannot be built, taking priority over run-derived status', () => {
    const scenarioId = s01Doc.scenarios[0].id;
    const compiledScope = s01Doc.scenarios[0].scopeElementIds;
    const issues = [
      {
        code: 'structural-rule' as const,
        path: [],
        entityId: null,
        severity: 'error' as const,
        message: 'Scenario references a deleted element.',
      },
    ];

    // Even with a passing run on record, an unbuildable current manifest is not-ready,
    // never 'needs-rerun' or 'not-run' (there's no reliable current fingerprint to compare).
    const passingRun: any = {
      id: 'run-pass',
      fingerprint: 'ss-run-v1:fp-current',
      status: 'completed',
      provenance: 'local',
      checks: [{ assertionId: 'a1', status: 'passed', actual: 'succeeded', reason: null }],
      summary: { mode: 'logical', consumedInputs: 1, rootCounts: { generated: 1, succeeded: 1, rejected: 0, failed: 0, expired: 0, inFlight: 0 } },
      completedAt: 1000,
    };

    const statusWithRuns = deriveScenarioStatus(scenarioId, null, [passingRun], compiledScope, issues);
    expect(statusWithRuns.kind).toBe('not-ready');
    if (statusWithRuns.kind === 'not-ready') {
      expect(statusWithRuns.issues).toEqual(issues);
    }

    const statusWithNoRuns = deriveScenarioStatus(scenarioId, null, [], compiledScope, issues);
    expect(statusWithNoRuns.kind).toBe('not-ready');

    // No issues -> normal derivation still applies.
    const normalStatus = deriveScenarioStatus(scenarioId, null, [], compiledScope, null);
    expect(normalStatus.kind).toBe('not-run');
  });

  it('async loadScenarioStatuses transitions from not-run -> passed -> needs-rerun -> failed', async () => {
    const db = createStudioDatabase(`test-status-trans-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);
    const { projectId, snapshotId } = await setupTestProject(repo, s01Doc);

    const scenarioId = s01Doc.scenarios[0].id;

    // 1. Initial state: not-run
    const res1 = await loadScenarioStatuses(repo, projectId, s01Doc);
    const s0Status1 = res1.scenarios.find((s) => s.scenario.id === scenarioId);
    expect(s0Status1?.status.kind).toBe('not-run');
    expect(res1.commitLine.passing).toBe(0);
    expect(res1.commitLine.total).toBe(s01Doc.scenarios.length);

    // 2. Perform a passing qualifying run
    const manifestRes1 = await buildManifest(s01Doc, scenarioId, DEFAULT_BUILD_VERSIONS);
    if (manifestRes1.status !== 'ok') throw new Error('Build manifest failed');

    const runId1 = crypto.randomUUID();
    const token1 = mintRunStartToken({
      projectId,
      runId: runId1,
      snapshotId,
      manifest: manifestRes1.manifest,
      fingerprint: manifestRes1.fingerprint,
      document: s01Doc,
    });

    await repo.saveRun(
      token1,
      {
        runId: runId1,
        fingerprint: manifestRes1.fingerprint,
        status: 'completed',
        checks: [
          { assertionId: s01Doc.scenarios[0].assertions[0].id, status: 'passed', actual: 'editing', reason: null },
          { assertionId: s01Doc.scenarios[0].assertions[1].id, status: 'passed', actual: 'editing', reason: null },
        ],
        summary: {
          mode: 'logical',
          consumedInputs: 1,
          rootCounts: { generated: 1, succeeded: 1, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
          messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
          elementMetrics: [],
          finalStates: [],
          outputs: [],
          coverage: { includedElementIds: ['checkout'], excludedElementIds: [] },
          processedEvents: 4,
          elapsedMs: null,
          rowOutcomes: [],
        },
      },
      [],
      { projectId, document: s01Doc },
    );

    const res2 = await loadScenarioStatuses(repo, projectId, s01Doc);
    const s0Status2 = res2.scenarios.find((s) => s.scenario.id === scenarioId);
    expect(s0Status2?.status.kind).toBe('passed');
    expect(res2.commitLine.passing).toBe(1);

    // 3. Edit document (change an input or add a step): fingerprint changes -> needs-rerun
    const editedDoc: Document = {
      ...s01Doc,
      scenarios: [
        { ...s01Doc.scenarios[0], seed: 999999 },
        ...s01Doc.scenarios.slice(1),
      ],
    };

    const res3 = await loadScenarioStatuses(repo, projectId, editedDoc);
    const s0Status3 = res3.scenarios.find((s) => s.scenario.id === scenarioId);
    expect(s0Status3?.status.kind).toBe('needs-rerun');

    // 4. Save a failing run on this new version -> failed
    const manifestRes3 = await buildManifest(editedDoc, scenarioId, DEFAULT_BUILD_VERSIONS);
    if (manifestRes3.status !== 'ok') throw new Error('Build manifest failed');
    const snapshotId3 = await computeSnapshotId(editedDoc);

    const runId3 = crypto.randomUUID();
    const token3 = mintRunStartToken({
      projectId,
      runId: runId3,
      snapshotId: snapshotId3,
      manifest: manifestRes3.manifest,
      fingerprint: manifestRes3.fingerprint,
      document: editedDoc,
    });

    await repo.saveRun(
      token3,
      {
        runId: runId3,
        fingerprint: manifestRes3.fingerprint,
        status: 'completed',
        checks: [
          { assertionId: editedDoc.scenarios[0].assertions[0].id, status: 'failed', actual: 'bad-state', reason: 'Assertion failed' },
          { assertionId: editedDoc.scenarios[0].assertions[1].id, status: 'passed', actual: 'editing', reason: null },
        ],
        summary: {
          mode: 'logical',
          consumedInputs: 1,
          rootCounts: { generated: 1, succeeded: 1, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
          messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
          elementMetrics: [],
          finalStates: [],
          outputs: [],
          coverage: { includedElementIds: ['checkout'], excludedElementIds: [] },
          processedEvents: 4,
          elapsedMs: null,
          rowOutcomes: [],
        },
      },
      [],
      { projectId, document: editedDoc },
    );

    const res4 = await loadScenarioStatuses(repo, projectId, editedDoc);
    const s0Status4 = res4.scenarios.find((s) => s.scenario.id === scenarioId);
    expect(s0Status4?.status.kind).toBe('failed');
    if (s0Status4?.status.kind === 'failed') {
      expect(s0Status4.status.passedChecks).toBe(1);
      expect(s0Status4.status.totalChecks).toBe(2);
    }

    db.close();
  });
});

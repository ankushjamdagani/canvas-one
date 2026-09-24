import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '../../domain/studio/model';
import { prepareScenario } from '../../domain/studio/runner/compile';
import { runScenario } from '../../domain/studio/runner/scenario-runner';
import { buildEvidenceManifest, evaluateCandidate } from '../../domain/versioning';
import { createStudioDatabase } from './db';
import { LocalRepository } from './repository';
import { mintRunStartToken } from './token';
import { computeSnapshotId } from './primitives';
import type { Actor, ProjectCreateCommand, RunRecord } from './types';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');
const s01Doc = JSON.parse(readFileSync(join(FIXTURES_DIR, 's01.json'), 'utf8')) as Document;

const testActor: Actor = {
  actorId: 'test-user',
  kind: 'local-human',
  displayName: 'Test User',
};

const VERSIONS = {
  compilerVersion: 'studio-compiler/1',
  runnerVersions: [{ runnerId: 'studio-runner', version: 'studio-runner/1' }],
};

describe('RV-08a End-to-end: S01 prepare, run, save, load, and candidate eligibility', () => {
  it('runs all three S01 scenarios, saves with tokens, loads them, and achieves eligibility only when all three are saved', async () => {
    const db = createStudioDatabase(`test-e2e-${crypto.randomUUID()}`);
    const repo = new LocalRepository(db);

    const projectId = crypto.randomUUID();
    const mainBranchId = crypto.randomUUID();
    const draftBranchId = crypto.randomUUID();

    // 1. Create project with S01 document as initial snapshot
    const createCmd: ProjectCreateCommand = {
      commandId: 'project.create',
      operationId: crypto.randomUUID(),
      actor: testActor,
      payload: {
        newProjectId: projectId,
        title: 'S01 E2E Test',
        initialDocument: s01Doc,
        mainBranchId,
        draftBranchId,
      },
    };
    const createRes = await repo.execute(createCmd);
    expect(createRes.status).toBe('applied');

    const snapshotId = await computeSnapshotId(s01Doc);
    expect(s01Doc.scenarios).toHaveLength(3);

    // 2. Prepare all 3 scenarios via prepareScenario
    const preparedScenarios: {
      readonly scenarioId: string;
      readonly manifest: any;
      readonly fingerprint: string;
    }[] = [];

    for (const scenario of s01Doc.scenarios) {
      const prepRes = await prepareScenario(
        { id: snapshotId, document: s01Doc },
        scenario.id,
        new AbortController().signal,
        VERSIONS,
      );
      expect(prepRes.status).toBe('ready');
      if (prepRes.status === 'ready') {
        preparedScenarios.push({
          scenarioId: scenario.id,
          manifest: prepRes.manifest,
          fingerprint: prepRes.fingerprint,
        });
      }
    }

    expect(preparedScenarios).toHaveLength(3);

    // Build CandidateScenario descriptors for evaluateCandidate
    const candidateScenarios = preparedScenarios.map((p) => ({
      scenarioId: p.scenarioId,
      fingerprint: p.fingerprint,
      scope: p.manifest.scope,
    }));

    // Before any scenario runs are saved: candidate is not eligible (all 3 missing)
    const initialEval = evaluateCandidate(candidateScenarios, []);
    expect(initialEval.eligible).toBe(false);
    expect(initialEval.scenarios.map((s) => s.evaluation.status)).toEqual([
      'missing',
      'missing',
      'missing',
    ]);

    const savedRuns: RunRecord[] = [];

    // 3. Step through each scenario: runScenario -> mintRunStartToken -> saveRun -> loadRun -> evaluateCandidate
    for (let i = 0; i < s01Doc.scenarios.length; i++) {
      const scenario = s01Doc.scenarios[i];
      const prepared = preparedScenarios[i];
      const runId = crypto.randomUUID();

      // Execute scenario
      const runResult = await runScenario(s01Doc, scenario.id, runId);
      expect(runResult.status).toBe('completed');
      expect(runResult.checks.length).toBeGreaterThan(0);
      expect(runResult.checks.every((c) => c.status === 'passed')).toBe(true);

      // Mint unforgeable start token
      const token = mintRunStartToken({
        projectId,
        runId,
        snapshotId,
        manifest: prepared.manifest,
        fingerprint: prepared.fingerprint,
      });

      // Save run atomically
      const terminalResult = {
        ...runResult,
        runId,
        fingerprint: prepared.fingerprint,
      };
      const saveRes = await repo.saveRun(token, terminalResult, runResult.events);
      expect(saveRes.status).toBe('applied');
      if (saveRes.status === 'applied') {
        expect(saveRes.runId).toBe(runId);
        expect(saveRes.run.provenance).toBe('local');
        expect(saveRes.run.traceState).toBe('complete');
      }

      // Load run from repository
      const loaded = await repo.loadRun(projectId, runId);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(runId);
      expect(loaded?.fingerprint).toBe(prepared.fingerprint);
      expect(loaded?.provenance).toBe('local');
      expect(loaded?.checks).toEqual(runResult.checks);
      expect(loaded?.summary.finalStates).toEqual(runResult.summary.finalStates);

      savedRuns.push(loaded!);

      // Check candidate evaluation after this save
      const currentEval = evaluateCandidate(candidateScenarios, savedRuns);

      if (i < 2) {
        // With fewer than 3 scenarios saved, candidate must NOT be eligible yet
        expect(currentEval.eligible).toBe(false);
        const qualifiedCount = currentEval.scenarios.filter(
          (s) => s.evaluation.status === 'qualified',
        ).length;
        expect(qualifiedCount).toBe(i + 1);
      } else {
        // With all 3 scenarios saved, candidate must be eligible!
        expect(currentEval.eligible).toBe(true);
        expect(
          currentEval.scenarios.every((s) => s.evaluation.status === 'qualified'),
        ).toBe(true);
      }
    }

    // 4. Verify buildEvidenceManifest produces complete manifest
    const evidenceManifest = buildEvidenceManifest(candidateScenarios, savedRuns);
    expect(evidenceManifest.scenarioIds).toEqual(s01Doc.scenarios.map((s) => s.id));
    expect(evidenceManifest.entries).toHaveLength(3);
    for (const entry of evidenceManifest.entries) {
      expect(entry.completion).toBe('completed');
      expect(entry.checks.length).toBeGreaterThan(0);
      expect(entry.checks.every((c) => c.status === 'passed')).toBe(true);
      expect(entry.scope.includedElementIds).toContain(s01Doc.elements[0].id);
    }

    db.close();
  });
});

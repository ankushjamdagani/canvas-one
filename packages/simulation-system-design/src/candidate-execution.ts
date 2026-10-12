import type { Document, Id } from '@canvas-one/system-design/studio/model';
import type { Issue } from '@canvas-one/system-design/studio/validate';
import { createIssue } from '@canvas-one/system-design/studio/issue';
import type { BuildManifestVersions } from '@canvas-one/system-design/studio/manifest';
import type { CancellationSignal } from './cancellation.js';
import type { ScenarioRunnerOptions, ScenarioRunResult } from './runner/scenario-runner.js';
import type { prepareScenario } from './runner/compile.js';
import type { runScenario } from './runner/scenario-runner.js';
import { mintRunStartToken } from './token.js';
import { DEFAULT_BUILD_VERSIONS, type RunArtifactStore, type SaveRunResult } from './artifacts.js';

export type CandidateExecutionSnapshot = {
  readonly projectId: Id; readonly snapshotId: string; readonly superseded: boolean;
  readonly document: Document; readonly conflictIds: readonly Id[]; readonly issues: readonly Issue[];
};
export type StartCandidateRunParams = { readonly candidateId: Id; readonly scenarioId: Id; readonly runId: Id };
export type CandidateRunOptions = {
  readonly signal?: CancellationSignal; readonly versions?: BuildManifestVersions; readonly runnerOptions?: ScenarioRunnerOptions;
};
export type CandidateExecutionProvider = { readonly prepareScenario: typeof prepareScenario; readonly runScenario: typeof runScenario };
export type CandidateExecutionPorts<Code extends string> = {
  readonly getCandidate: (candidateId: Id) => CandidateExecutionSnapshot | null;
  readonly artifacts: RunArtifactStore<Code>;
  readonly execution?: CandidateExecutionProvider;
};
export type StartCandidateRunResult<Code extends string = string> =
  | { readonly status: 'done'; readonly runId: Id; readonly saveResult: Extract<SaveRunResult<Code>, { status: 'applied' }>; readonly runResult: ScenarioRunResult; readonly value: { readonly kind: 'run'; readonly runId: Id }; readonly superseded?: boolean }
  | { readonly status: 'cancelled' }
  | { readonly status: 'missing'; readonly ids: readonly Id[] }
  | { readonly status: 'invalid'; readonly issues: readonly Issue[] }
  | { readonly status: 'failed'; readonly code: Code | 'ineligible' | 'conflict'; readonly issues: readonly Issue[] };

async function loadExecution(): Promise<CandidateExecutionProvider> {
  const [compiler, runner] = await Promise.all([import('./runner/compile.js'), import('./runner/scenario-runner.js')]);
  return { prepareScenario: compiler.prepareScenario, runScenario: runner.runScenario };
}

/** Runs an immutable candidate snapshot and retains its evidence even if superseded during execution. */
export async function startCandidateRun<Code extends string>(ports: CandidateExecutionPorts<Code>, params: StartCandidateRunParams, options?: CandidateRunOptions): Promise<StartCandidateRunResult<Code>> {
    const cand = ports.getCandidate(params.candidateId);
    if (!cand) {
      return { status: 'missing', ids: [params.candidateId] };
    }

    if (cand.superseded) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${params.candidateId}' is superseded`,
            ['candidateId'],
            params.candidateId,
          ),
        ],
      };
    }

    if (cand.conflictIds.length > 0) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${params.candidateId}' has ${cand.conflictIds.length} unresolved conflicts`,
            ['conflicts'],
          ),
        ],
      };
    }

    if (cand.issues.length > 0) {
      return {
        status: 'invalid',
        issues: cand.issues,
      };
    }

    const scenario = cand.document.scenarios.find((s) => s.id === params.scenarioId);
    if (!scenario) {
      return { status: 'missing', ids: [params.scenarioId] };
    }

    const versions = options?.versions ?? DEFAULT_BUILD_VERSIONS;
    const signal = options?.signal ?? { aborted: false };

    // Candidate runs happen only while publishing: load the compiler and runner on demand
    // so they stay out of the app's initial bundle.
    const { prepareScenario, runScenario } = ports.execution ?? await loadExecution();

    const prepRes = await prepareScenario(
      { id: cand.snapshotId, document: cand.document },
      params.scenarioId,
      signal,
      versions,
    );

    if (prepRes.status === 'cancelled') {
      return { status: 'cancelled' };
    }

    if (prepRes.status === 'invalid') {
      return {
        status: 'invalid',
        issues: prepRes.issues as readonly Issue[],
      };
    }

    if (prepRes.status !== 'ready') {
      throw new Error(`Unhandled prepareScenario status: ${(prepRes as any).status}`);
    }

    const token = mintRunStartToken({
      projectId: cand.projectId,
      runId: params.runId,
      snapshotId: cand.snapshotId,
      manifest: prepRes.manifest,
      fingerprint: prepRes.fingerprint,
      document: cand.document, // pass document so saveRun can insert snapshot row!
    });

    const runResult = await runScenario(
      cand.document,
      params.scenarioId,
      params.runId,
      options?.runnerOptions,
    );

    // Recheck if candidate was superseded after the run finished and before saveRun.
    // If superseded, we still save the run (saved outcomes are evidence for that snapshot),
    // but return the result with a superseded: true flag.
    const currentCand = ports.getCandidate(params.candidateId);
    const wasSuperseded = !currentCand || currentCand.superseded;

    const repo = ports.artifacts;
    const terminalResult = {
      ...runResult,
      runId: params.runId,
      fingerprint: prepRes.fingerprint,
      snapshotId: cand.snapshotId,
    };

    const saveRes = await repo.saveRun(
      token,
      terminalResult,
      runResult.events,
      {
        projectId: cand.projectId,
        document: cand.document,
      },
    );

    if (saveRes.status !== 'applied') {
      return saveRes;
    }

    return {
      status: 'done',
      runId: params.runId,
      saveResult: saveRes,
      runResult,
      value: {
        kind: 'run',
        runId: params.runId,
      },
      ...(wasSuperseded ? { superseded: true } : {}),
    };
  }

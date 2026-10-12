import { createIssue, type ValidationIssue } from '@canvas-one/whiteboard';
import type { CandidateState } from './candidates.js';

export type CandidateEvaluationResult<Code extends string, Evaluation> =
  | { readonly status: 'done'; readonly eligible: boolean; readonly evaluation: Evaluation }
  | { readonly status: 'missing'; readonly ids: readonly string[]; readonly eligible: false }
  | { readonly status: 'invalid'; readonly issues: readonly ValidationIssue<Code>[]; readonly eligible: false }
  | { readonly status: 'failed'; readonly code: 'ineligible' | 'conflict'; readonly issues: readonly ValidationIssue<'structural-rule'>[]; readonly eligible: false };
export type CandidateEvaluationPorts<Merge, Code extends string, Scenario, Run, Evaluation extends { readonly eligible: boolean }> = {
  readonly getCandidate: (id: string) => CandidateState<Merge> | null;
  readonly conflictIds: (merge: Merge) => readonly string[];
  readonly issues: (merge: Merge) => readonly ValidationIssue<Code>[];
  readonly prepare: (merge: Merge) => Promise<{ readonly status: 'ready'; readonly scenarios: readonly Scenario[] } | { readonly status: 'invalid'; readonly issues: readonly ValidationIssue<Code>[] }>;
  readonly listRuns: (projectId: string) => Promise<readonly Run[]>;
  readonly evaluate: (scenarios: readonly Scenario[], runs: readonly Run[]) => Evaluation;
};

/** Evaluates live candidate readiness before asking a host's evidence policy for qualification. */
export async function evaluateCandidateState<Merge, Code extends string, Scenario, Run, Evaluation extends { readonly eligible: boolean }>(
  ports: CandidateEvaluationPorts<Merge, Code, Scenario, Run, Evaluation>, candidateId: string,
): Promise<CandidateEvaluationResult<Code, Evaluation>> {
    const cand = ports.getCandidate(candidateId);
    if (!cand) {
      return { status: 'missing', ids: [candidateId], eligible: false };
    }

    if (cand.superseded) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${candidateId}' is superseded`,
            ['candidateId'],
            candidateId,
          ),
        ],
        eligible: false,
      };
    }

    // Readiness requires zero conflicts and no validation issues
    if (ports.conflictIds(cand.mergeState).length > 0) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            `Candidate '${candidateId}' has ${ports.conflictIds(cand.mergeState).length} unresolved conflicts`,
            ['conflicts'],
          ),
        ],
        eligible: false,
      };
    }

    if (ports.issues(cand.mergeState).length > 0) {
      return {
        status: 'invalid',
        issues: ports.issues(cand.mergeState),
        eligible: false,
      };
    }

    const readiness = await ports.prepare(cand.mergeState);
    if (readiness.status === 'invalid') return { status: 'invalid', issues: readiness.issues, eligible: false };
    const candidateScenarios = readiness.scenarios;

    const runs = await ports.listRuns(cand.projectId);
    const evalResult = ports.evaluate(candidateScenarios, runs);

    return {
      status: 'done',
      eligible: evalResult.eligible,
      evaluation: evalResult,
    };
  }

/** Domain aliases instantiate the history-owned evidence qualification contracts. */
import type { CheckResult, RunSummary } from '../studio/runner/types';
import type * as History from '@canvas-one/history';
export type { QualificationReasonCode, RunQualifiesExpected, RunQualifiesResult, CandidateScenarioScope, CandidateScenario } from '@canvas-one/history';
export type RunCandidate = History.RunCandidate<CheckResult, RunSummary>;
export type CandidateScenarioStatus = History.CandidateScenarioStatus<RunCandidate>;
export type ScenarioEvaluation = History.ScenarioEvaluation<RunCandidate>;
export type EvaluateCandidateResult = History.EvaluateCandidateResult<RunCandidate>;

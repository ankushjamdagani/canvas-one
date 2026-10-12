/**
 * Eligibility and versioning types.
 */

type Id = string;
export type EvidenceCheck = { readonly status: string };
export type EvidenceSummary = { readonly consumedInputs?: number; readonly rootCounts?: { readonly generated: number } };


// ============================================================================
// Reason codes for run qualification
// ============================================================================

const QUALIFICATION_REASON_CODES = [
  'status-not-completed',
  'provenance-not-local',
  'fingerprint-mismatch',
  'scenario-mismatch',
  'check-failed',
  'no-passing-assertions',
  'no-consumed-inputs',
  'assertion-subject-out-of-scope',
] as const;

export type QualificationReasonCode = (typeof QUALIFICATION_REASON_CODES)[number];

// ============================================================================
// Run candidate interface (structural interface satisfied by RunRecord)
// ============================================================================

export type RunCandidate<Check extends EvidenceCheck = EvidenceCheck, Summary extends EvidenceSummary = EvidenceSummary> = {
  readonly id: string;
  readonly status: string;
  readonly provenance: 'local' | 'imported-unverified' | string;
  readonly fingerprint: string;
  readonly checks: readonly Check[];
  readonly summary: Summary;
  readonly manifest?: unknown;
  readonly completedAt?: number;
};

// ============================================================================
// runQualifies expected interface
// ============================================================================

export type RunQualifiesExpected = {
  readonly scenarioId: Id;
  readonly fingerprint: string;
  readonly compiledScopeElementIds: readonly Id[];
};

export type RunQualifiesResult = {
  readonly qualifies: boolean;
  readonly reasons: readonly QualificationReasonCode[];
};

// ============================================================================
// evaluateCandidate interfaces
// ============================================================================

export type CandidateScenarioScope =
  | {
      readonly includedElementIds?: readonly Id[];
      readonly excludedElementIds?: readonly Id[];
    }
  | readonly Id[];

export type CandidateScenario = {
  readonly scenarioId: Id;
  readonly fingerprint: string;
  readonly scope?: CandidateScenarioScope;
};

export type CandidateScenarioStatus<Run extends RunCandidate = RunCandidate> =
  | { readonly status: 'qualified'; readonly runId: string; readonly run: Run }
  | { readonly status: 'missing' }
  | { readonly status: 'incomplete'; readonly runId?: string }
  | {
      readonly status: 'not-qualifying';
      readonly reasons: readonly QualificationReasonCode[];
      readonly runId?: string;
    };

export type ScenarioEvaluation<Run extends RunCandidate = RunCandidate> = {
  readonly scenarioId: Id;
  readonly evaluation: CandidateScenarioStatus<Run>;
};

export type EvaluateCandidateResult<Run extends RunCandidate = RunCandidate> = {
  readonly eligible: boolean;
  readonly scenarios: readonly ScenarioEvaluation<Run>[];
};

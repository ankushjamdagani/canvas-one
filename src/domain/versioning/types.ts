/**
 * Eligibility and Versioning types (RV-08a).
 *
 * Implements specs/revamp/contracts/run-identity.md §5 (Eligibility),
 * specs/revamp/contracts/storage.md §2 (EvidenceRef), and
 * specs/revamp/contracts/model-and-runner.md §6 & §9.
 */

import type { Id } from '../studio/model';
import type { CheckResult, RunSummary, TerminalStatus } from '../studio/runner/types';
import type { EvidenceManifest } from '../studio/runner/evidence';

// ============================================================================
// Reason codes for run qualification (§5)
// ============================================================================

export const QUALIFICATION_REASON_CODES = [
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

export type RunCandidate = {
  readonly id: string;
  readonly status: TerminalStatus | string;
  readonly provenance: 'local' | 'imported-unverified' | string;
  readonly fingerprint: string;
  readonly checks: readonly CheckResult[];
  readonly summary: RunSummary;
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

export type CandidateScenarioStatus =
  | { readonly status: 'qualified'; readonly runId: string; readonly run: RunCandidate }
  | { readonly status: 'missing' }
  | { readonly status: 'incomplete'; readonly runId?: string }
  | {
      readonly status: 'not-qualifying';
      readonly reasons: readonly QualificationReasonCode[];
      readonly runId?: string;
    };

export type ScenarioEvaluation = {
  readonly scenarioId: Id;
  readonly evaluation: CandidateScenarioStatus;
};

export type EvaluateCandidateResult = {
  readonly eligible: boolean;
  readonly scenarios: readonly ScenarioEvaluation[];
};

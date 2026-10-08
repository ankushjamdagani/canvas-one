/**
 * Pure scenario status derivation and async loader.
 *
 * Status rules:
 * - Passed = a saved qualifying run exists for the scenario's current fingerprint;
 * - Needs a rerun = the latest saved run's fingerprint differs from the current one;
 * - Failed = the latest saved run for the current fingerprint didn't qualify;
 * - Not run yet = no saved run;
 * - Can't run · n issues (not-ready) = the scenario's current manifest can't be built
 *   (validation or readiness issues) — Run is disabled for it with the first issue as the
 *   reason, and Run all is disabled while any scenario is not-ready.
 *
 * Computes the commit line data: { total, passing }.
 * Uses DEFAULT_BUILD_VERSIONS matching the LocalRepository.
 */

import type { Document, Id, Scenario } from '../../domain/studio/model';
import {
  buildManifest,
  type BuildManifestVersions,
} from '../../domain/studio/manifest';
import type { ReadinessIssue } from '../../domain/studio/readiness';
import {
  runQualifies,
  sortQualifyingRuns,
} from '../../domain/versioning/eligibility';
import type { RunCandidate } from '../../domain/versioning/types';
import type { StudioRepository } from '../../persistence/studio/types';
import {
  DEFAULT_BUILD_VERSIONS,
  type RunRecord,
} from '../../persistence/studio/types';

// ============================================================================
// RunRecord -> RunCandidate mapping (explicit mapping, not a cast)
// ============================================================================

/**
 * Maps a persisted RunRecord to the RunCandidate shape runQualifies/sortQualifyingRuns
 * expect, field by field, so a future shape change to either type fails tsc instead of
 * silently passing through an `as unknown as` cast.
 */
export function toRunCandidate(run: RunRecord): RunCandidate {
  return {
    id: run.id,
    status: run.status,
    provenance: run.provenance,
    fingerprint: run.fingerprint,
    checks: run.checks,
    summary: run.summary,
    manifest: run.manifest,
    completedAt: run.completedAt,
  };
}

function toRunCandidates(runs: readonly RunRecord[]): RunCandidate[] {
  return runs.map(toRunCandidate);
}

// ============================================================================
// Types
// ============================================================================

export type ScenarioStatus =
  | { readonly kind: 'passed' }
  | { readonly kind: 'needs-rerun' }
  | { readonly kind: 'failed'; readonly passedChecks: number; readonly totalChecks: number }
  | { readonly kind: 'not-run' }
  | { readonly kind: 'not-ready'; readonly issues: readonly ReadinessIssue[] };

/** Plain-language status line shown beside a scenario in the commit and publish gates. */
export function scenarioStatusLabel(status: ScenarioStatus): string {
  switch (status.kind) {
    case 'passed':
      return 'Passed on exactly this version';
    case 'needs-rerun':
      return 'Ran on an earlier version';
    case 'failed':
      return `Failed · ${status.passedChecks} of ${status.totalChecks} checks`;
    case 'not-run':
      return 'Not run yet';
    case 'not-ready':
      return `Can't run · ${status.issues.length} issue${status.issues.length === 1 ? '' : 's'}`;
  }
}

export type ScenarioWithStatus = {
  readonly scenario: Scenario;
  readonly status: ScenarioStatus;
  readonly currentFingerprint: string | null;
  readonly latestRun: RunRecord | null;
};

export type ScenariosStatusResult = {
  readonly scenarios: readonly ScenarioWithStatus[];
  readonly commitLine: {
    readonly total: number;
    readonly passing: number;
  };
};

// ============================================================================
// Pure Derivation
// ============================================================================

/**
 * Pure function deriving scenario status:
 * - not-ready: the scenario's current manifest can't be built (readiness/validation
 *   issues) — takes priority over run-derived statuses, since there is no reliable
 *   current fingerprint to compare saved runs against.
 * - not-run: no saved runs for this scenario.
 * - passed: a saved qualifying run exists for current fingerprint.
 * - needs-rerun: the latest saved run's fingerprint differs from the current one.
 * - failed: the latest saved run for the current fingerprint didn't qualify.
 */
export function deriveScenarioStatus(
  scenarioId: Id,
  currentFingerprint: string | null,
  runsForScenario: readonly RunRecord[],
  compiledScopeElementIds: readonly Id[],
  manifestIssues: readonly ReadinessIssue[] | null = null,
): ScenarioStatus {
  if (manifestIssues && manifestIssues.length > 0) {
    return { kind: 'not-ready', issues: manifestIssues };
  }

  if (runsForScenario.length === 0) {
    return { kind: 'not-run' };
  }

  // Sort deterministically: latest completedAt first, ID tie-breaker
  const sorted = sortQualifyingRuns(toRunCandidates(runsForScenario));
  const latestRun = sorted[0];

  if (!currentFingerprint) {
    return { kind: 'needs-rerun' };
  }

  // 1. "Passed = a saved qualifying run exists for the scenario's current fingerprint"
  const qualifyingRun = sorted.find((r) => {
    if (r.fingerprint !== currentFingerprint) return false;
    const q = runQualifies(r, {
      scenarioId,
      fingerprint: currentFingerprint,
      compiledScopeElementIds,
    });
    return q.qualifies;
  });

  if (qualifyingRun) {
    return { kind: 'passed' };
  }

  // 2. "Needs a rerun = the latest saved run's fingerprint differs from the current one"
  if (latestRun.fingerprint !== currentFingerprint) {
    return { kind: 'needs-rerun' };
  }

  // 3. "Failed = the latest saved run for the current fingerprint didn't qualify"
  const checks = Array.isArray(latestRun.checks) ? latestRun.checks : [];
  const passedChecks = checks.filter((c) => c.status === 'passed').length;
  const totalChecks = checks.length;
  return { kind: 'failed', passedChecks, totalChecks };
}

// ============================================================================
// Async Loader
// ============================================================================

/**
 * Asynchronously loads and computes scenario statuses for all scenarios of a document.
 */
export async function loadScenarioStatuses(
  repository: StudioRepository,
  projectId: Id,
  document: Document,
  versions: BuildManifestVersions = DEFAULT_BUILD_VERSIONS,
): Promise<ScenariosStatusResult> {
  const allRuns = await repository.listRuns(projectId);

  const scenarioResults: ScenarioWithStatus[] = [];

  for (const scenario of document.scenarios) {
    // Filter runs belonging to this scenario
    const runsForScenario = allRuns.filter((r) => {
      const runScenarioId = (r.manifest as { scenario?: { id?: Id } })?.scenario?.id;
      return runScenarioId === scenario.id;
    });

    let currentFingerprint: string | null = null;
    let compiledScopeElementIds: readonly Id[] = [];
    let manifestIssues: readonly ReadinessIssue[] | null = null;

    try {
      const manifestRes = await buildManifest(document, scenario.id, versions);
      if (manifestRes.status === 'ok') {
        currentFingerprint = manifestRes.fingerprint;
        compiledScopeElementIds = manifestRes.manifest.scope.includedElementIds;
      } else if (manifestRes.status === 'not-ready') {
        manifestIssues = manifestRes.issues;
      } else {
        // identity-unavailable / analysis-limit / cancelled: the manifest still can't be
        // built for this version, but carries no per-field issues of its own.
        manifestIssues = [
          {
            code: 'structural-rule',
            path: [],
            entityId: null,
            severity: 'error',
            message:
              manifestRes.status === 'analysis-limit'
                ? 'Scenario analysis exceeded its limit.'
                : manifestRes.status === 'cancelled'
                  ? 'Scenario analysis was cancelled.'
                  : 'Scenario manifest could not be identified.',
          },
        ];
      }
    } catch {
      // Manifest could not be computed (e.g. document not ready or structural defect)
      manifestIssues = [
        {
          code: 'structural-rule',
          path: [],
          entityId: null,
          severity: 'error',
          message: 'Scenario manifest could not be built due to an unexpected error.',
        },
      ];
    }

    const status = deriveScenarioStatus(
      scenario.id,
      currentFingerprint,
      runsForScenario,
      compiledScopeElementIds,
      manifestIssues,
    );

    const sorted = sortQualifyingRuns(toRunCandidates(runsForScenario));
    const latestRun = sorted.length > 0 ? (runsForScenario.find((r) => r.id === sorted[0].id) ?? null) : null;

    scenarioResults.push({
      scenario,
      status,
      currentFingerprint,
      latestRun,
    });
  }

  const total = document.scenarios.length;
  const passing = scenarioResults.filter((s) => s.status.kind === 'passed').length;

  return {
    scenarios: scenarioResults,
    commitLine: {
      total,
      passing,
    },
  };
}

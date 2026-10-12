/**
 * Pure eligibility predicates and evidence manifest builder.
 *
 * - runQualifies: checks every qualification rule with stable reason codes
 * - evaluateCandidate: per-scenario evaluation and overall eligibility (≥1 scenario, all qualified)
 * - buildEvidenceManifest: compiles EvidenceManifest reusing evidenceEntryFromTerminal
 *
 * Pure logic without Dexie or side effects.
 */

type Id = string;
import type {
  CandidateScenario, EvaluateCandidateResult, QualificationReasonCode, RunCandidate,
  RunQualifiesExpected, RunQualifiesResult, ScenarioEvaluation,
} from './eligibility-types.js';

// ============================================================================
// Helper: Extract Assertion Subject Element IDs
// ============================================================================

/**
 * Extracts all non-null target element IDs from assertions defined in the manifest.
 * Used to verify: "all assertion subjects in compiled scope".
 *
 * Subjects:
 * - final-state: elementId
 * - context: elementId
 * - output: port.elementId
 * - count: elementId (only if scope is 'element'; root/message counts have null elementId)
 * - trace-count: elementId
 * - metric: elementId
 */
function extractAssertionSubjectElementIds(manifest: unknown): readonly Id[] {
  if (!manifest || typeof manifest !== 'object') {
    return [];
  }

  const assertions = (manifest as { scenario?: { assertions?: readonly any[] } })?.scenario
    ?.assertions;
  if (!Array.isArray(assertions)) {
    return [];
  }

  const elementIds: Id[] = [];

  for (const assertion of assertions) {
    if (!assertion || typeof assertion !== 'object') continue;
    const subject = assertion.subject;
    if (!subject || typeof subject !== 'object') continue;

    switch (subject.kind) {
      case 'final-state':
      case 'context':
      case 'trace-count':
      case 'metric': {
        if (typeof subject.elementId === 'string' && subject.elementId.length > 0) {
          elementIds.push(subject.elementId);
        }
        break;
      }
      case 'output': {
        if (
          subject.port &&
          typeof subject.port === 'object' &&
          typeof subject.port.elementId === 'string' &&
          subject.port.elementId.length > 0
        ) {
          elementIds.push(subject.port.elementId);
        }
        break;
      }
      case 'count': {
        if (
          subject.scope === 'element' &&
          typeof subject.elementId === 'string' &&
          subject.elementId.length > 0
        ) {
          elementIds.push(subject.elementId);
        }
        break;
      }
    }
  }

  return elementIds;
}

// ============================================================================
// runQualifies
// ============================================================================

/**
 * Evaluates whether a given run qualifies a scenario:
 *
 * All of the following must hold:
 * 1. status 'completed'
 * 2. provenance 'local' (imported runs are always imported-unverified; never qualify)
 * 3. fingerprint matches the candidate's manifest for that scenario
 * 4. every configured check was evaluated and passed (skipped, errored or unevaluated checks fail)
 * 5. non-vacuous: ≥1 passing assertion
 * 6. non-vacuous: ≥1 consumed input or workload root
 * 7. non-vacuous: all assertion subjects in compiled scope
 */
export function runQualifies(
  run: RunCandidate,
  expected: RunQualifiesExpected,
): RunQualifiesResult {
  const reasons: QualificationReasonCode[] = [];

  // Rule 1: status completed
  if (run.status !== 'completed') {
    reasons.push('status-not-completed');
  }

  // Rule 2: provenance local
  if (run.provenance !== 'local') {
    reasons.push('provenance-not-local');
  }

  // Rule 3: fingerprint matches candidate manifest
  if (run.fingerprint !== expected.fingerprint) {
    reasons.push('fingerprint-mismatch');
  }

  // Rule 3b: scenario ID matches (when scenario ID is known on manifest)
  const manifestScenarioId = (run.manifest as { scenario?: { id?: Id } })?.scenario?.id;
  if (manifestScenarioId && manifestScenarioId !== expected.scenarioId) {
    reasons.push('scenario-mismatch');
  }

  // Rule 4: every configured check evaluated and passed
  const checks = Array.isArray(run.checks) ? run.checks : [];
  const allChecksPassed =
    checks.length > 0 && checks.every((check) => check.status === 'passed');
  if (checks.length > 0 && !allChecksPassed) {
    reasons.push('check-failed');
  }

  // Rule 5: non-vacuous: ≥1 passing assertion
  const passingChecksCount = checks.filter((check) => check.status === 'passed').length;
  if (passingChecksCount < 1) {
    reasons.push('no-passing-assertions');
  }

  // Rule 6: non-vacuous: ≥1 consumed input or workload root
  const consumedInputs = run.summary?.consumedInputs ?? 0;
  const rootGenerated = run.summary?.rootCounts?.generated ?? 0;
  if (consumedInputs < 1 && rootGenerated < 1) {
    reasons.push('no-consumed-inputs');
  }

  // Rule 7: non-vacuous: all assertion subjects in compiled scope
  const subjectElementIds = extractAssertionSubjectElementIds(run.manifest);
  const compiledScopeSet = new Set(expected.compiledScopeElementIds);
  const allSubjectsInScope = subjectElementIds.every((elemId) => compiledScopeSet.has(elemId));
  if (!allSubjectsInScope) {
    reasons.push('assertion-subject-out-of-scope');
  }

  return {
    qualifies: reasons.length === 0,
    reasons: Object.freeze(reasons),
  };
}

// ============================================================================
// Deterministic choice helper
// ============================================================================

/**
 * Deterministically sorts qualifying runs:
 * 1. Latest completedAt first (descending numerical order)
 * 2. ID descending as tie-breaker (lexicographical order)
 */
export function sortQualifyingRuns<Run extends RunCandidate>(runs: readonly Run[]): Run[] {
  return [...runs].sort((a, b) => {
    const timeA = a.completedAt ?? 0;
    const timeB = b.completedAt ?? 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return b.id.localeCompare(a.id);
  });
}

// ============================================================================
// evaluateCandidate
// ============================================================================

/**
 * Normalizes CandidateScenario.scope to an array of compiled scope element IDs.
 */
function normalizeScopeElementIds(scope: CandidateScenario['scope']): readonly Id[] {
  if (!scope) return [];
  if (Array.isArray(scope)) return scope;
  if ('includedElementIds' in scope && Array.isArray(scope.includedElementIds)) {
    return scope.includedElementIds;
  }
  return [];
}

/**
 * Evaluates candidate scenarios against available runs:
 * - per-scenario status: 'qualified' with runId | 'missing' | 'not-qualifying' with reasons | 'incomplete'
 * - overall eligible only if ≥1 scenario and every one qualifies (no subset, no bypass)
 * - evidence may come from any run with matching fingerprint (other branches allowed)
 * - when several qualify, chooses deterministically (latest completedAt, then id)
 */
export function evaluateCandidate<Run extends RunCandidate>(
  candidateScenarios: readonly CandidateScenario[],
  runs: readonly Run[],
): EvaluateCandidateResult<Run> {
  // If zero scenarios: overall not eligible
  if (candidateScenarios.length === 0) {
    return {
      eligible: false,
      scenarios: [],
    };
  }

  const scenarioEvaluations: ScenarioEvaluation<Run>[] = [];

  for (const candidate of candidateScenarios) {
    const compiledScopeElementIds = normalizeScopeElementIds(candidate.scope);
    const expected: RunQualifiesExpected = {
      scenarioId: candidate.scenarioId,
      fingerprint: candidate.fingerprint,
      compiledScopeElementIds,
    };

    // Filter runs matching the exact fingerprint
    const matchingRuns = runs.filter((r) => r.fingerprint === candidate.fingerprint);

    // Check which matching runs qualify
    const qualifyingRuns = matchingRuns.filter((r) => runQualifies(r, expected).qualifies);

    if (qualifyingRuns.length > 0) {
      // Deterministic choice: latest completedAt, then id
      const sorted = sortQualifyingRuns(qualifyingRuns);
      const chosen = sorted[0];
      scenarioEvaluations.push({
        scenarioId: candidate.scenarioId,
        evaluation: {
          status: 'qualified',
          runId: chosen.id,
          run: chosen,
        },
      });
      continue;
    }

    // No qualifying run with matching fingerprint.
    // Determine the most informative non-qualifying reason:
    if (matchingRuns.length > 0) {
      // Look for incomplete runs first
      const incompleteRun = matchingRuns.find((r) => r.status === 'incomplete');
      if (incompleteRun) {
        scenarioEvaluations.push({
          scenarioId: candidate.scenarioId,
          evaluation: {
            status: 'incomplete',
            runId: incompleteRun.id,
          },
        });
        continue;
      }

      // Sort matching non-qualifying runs deterministically to inspect latest attempt
      const sortedMatching = sortQualifyingRuns(matchingRuns);
      const latestRun = sortedMatching[0];
      const qualResult = runQualifies(latestRun, expected);
      scenarioEvaluations.push({
        scenarioId: candidate.scenarioId,
        evaluation: {
          status: 'not-qualifying',
          reasons: qualResult.reasons,
          runId: latestRun.id,
        },
      });
      continue;
    }

    // No run matches the fingerprint.
    // Check if any runs exist for this scenarioId with an old/different fingerprint
    const scenarioRuns = runs.filter((r) => {
      const manifestId = (r.manifest as { scenario?: { id?: Id } })?.scenario?.id;
      return manifestId === candidate.scenarioId;
    });

    if (scenarioRuns.length > 0) {
      const incompleteRun = scenarioRuns.find((r) => r.status === 'incomplete');
      if (incompleteRun) {
        scenarioEvaluations.push({
          scenarioId: candidate.scenarioId,
          evaluation: {
            status: 'incomplete',
            runId: incompleteRun.id,
          },
        });
        continue;
      }

      const sortedScenarioRuns = sortQualifyingRuns(scenarioRuns);
      const latestScenarioRun = sortedScenarioRuns[0];
      const qualResult = runQualifies(latestScenarioRun, expected);
      scenarioEvaluations.push({
        scenarioId: candidate.scenarioId,
        evaluation: {
          status: 'not-qualifying',
          reasons: qualResult.reasons,
          runId: latestScenarioRun.id,
        },
      });
      continue;
    }

    // No runs found at all for this scenario/fingerprint
    scenarioEvaluations.push({
      scenarioId: candidate.scenarioId,
      evaluation: {
        status: 'missing',
      },
    });
  }

  const eligible =
    scenarioEvaluations.length > 0 &&
    scenarioEvaluations.every((s) => s.evaluation.status === 'qualified');

  return {
    eligible,
    scenarios: Object.freeze(scenarioEvaluations),
  };
}

// ============================================================================
// buildEvidenceManifest
// ============================================================================

/**
 * Builds an EvidenceManifest conforming to runner/evidence.ts.
 * Full scenario inventory, fingerprint, run ID, completion, checks, tested scope.
 * Reuses evidenceEntryFromTerminal.
 */
export function buildEvidenceManifest<Run extends RunCandidate, Entry>(
  candidateScenarios: readonly CandidateScenario[],
  runs: readonly Run[] | ReadonlyMap<string, Run>,
  entryFromRun: (scenarioId: string, fingerprint: string, run: Run) => Entry,
): { readonly scenarioIds: readonly string[]; readonly entries: readonly Entry[] } {
  const scenarioIds = candidateScenarios.map((c) => c.scenarioId);
  const entries: Entry[] = [];

  for (const candidate of candidateScenarios) {
    // Find qualifying or matching run
    let targetRun: Run | undefined;

    if (runs instanceof Map) {
      targetRun =
        runs.get(candidate.scenarioId) ??
        runs.get(candidate.fingerprint);
    }

    if (!targetRun && Array.isArray(runs)) {
      const compiledScopeElementIds = normalizeScopeElementIds(candidate.scope);
      const matchingRuns = (runs as readonly Run[]).filter(
        (r) => r.fingerprint === candidate.fingerprint,
      );
      const qualifying = matchingRuns.filter(
        (r) =>
          runQualifies(r, {
            scenarioId: candidate.scenarioId,
            fingerprint: candidate.fingerprint,
            compiledScopeElementIds,
          }).qualifies,
      );

      if (qualifying.length > 0) {
        targetRun = sortQualifyingRuns(qualifying)[0];
      } else if (matchingRuns.length > 0) {
        targetRun = sortQualifyingRuns(matchingRuns)[0];
      }
    }

    if (targetRun) {
      entries.push(entryFromRun(candidate.scenarioId, candidate.fingerprint, targetRun));
    }
  }

  return {
    scenarioIds: Object.freeze(scenarioIds),
    entries: Object.freeze(entries),
  };
}

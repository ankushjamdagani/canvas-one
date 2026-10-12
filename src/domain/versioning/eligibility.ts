/** Evidence conversion is an optional simulator binding; qualification mechanics stay headless. */
import { buildEvidenceManifest as buildHistoryEvidenceManifest } from '@canvas-one/history';
import { evidenceEntryFromTerminal, type EvidenceManifest } from '../studio/runner/evidence';
import type { TerminalStatus } from '../studio/runner/types';
import type { CandidateScenario, RunCandidate } from './types';
export { runQualifies, sortQualifyingRuns, evaluateCandidate } from '@canvas-one/history';
export function buildEvidenceManifest(
  candidateScenarios: readonly CandidateScenario[],
  runs: readonly RunCandidate[] | ReadonlyMap<string, RunCandidate>,
): EvidenceManifest {
  return buildHistoryEvidenceManifest(candidateScenarios, runs, (scenarioId, fingerprint, run) =>
    evidenceEntryFromTerminal(scenarioId, fingerprint, {
      kind: 'terminal', runId: run.id, status: run.status as TerminalStatus,
      checks: run.checks, summary: run.summary, reason: null,
    }));
}

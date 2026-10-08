/**
 * Evidence interface: the shapes of an `EvidenceRef` and an evidence manifest, plus a
 * pure constructor from a terminal RunUpdate.
 *
 * SCOPE: interface only. Eligibility predicates (whether a run qualifies a scenario)
 * are NOT implemented here.
 */

import type { Id } from '../model';
import type { CheckResult, RunUpdate, TerminalStatus } from './types';

/** `EvidenceRef={scenarioId, fingerprint, runId}`. */
export type EvidenceRef = {
  readonly scenarioId: Id;
  readonly fingerprint: string;
  readonly runId: string;
};

/**
 * One scenario's evidence in a commit/publish manifest: fingerprint, run ID, completion,
 * check outcomes and tested scope.
 */
export type EvidenceEntry = {
  readonly scenarioId: Id;
  readonly fingerprint: string;
  readonly runId: string;
  readonly completion: TerminalStatus;
  readonly checks: readonly CheckResult[];
  readonly scope: {
    readonly includedElementIds: readonly Id[];
    readonly excludedElementIds: readonly Id[];
  };
};

/**
 * Evidence manifest for an immutable candidate. `scenarioIds` is the full inventory (every scenario in the
 * candidate, whether or not it has evidence yet); `entries` holds the evidence gathered
 * so far.
 */
export type EvidenceManifest = {
  readonly scenarioIds: readonly Id[];
  readonly entries: readonly EvidenceEntry[];
};

/**
 * Builds one `EvidenceEntry` from a run's terminal `RunUpdate`. This is a pure copy: it
 * never edits, reorders or reinterprets `checks` or `scope` outcomes (eligibility — e.g.
 * "every configured check was evaluated and passed" — is not this
 * constructor's job), and it never mutates its `terminalUpdate` argument.
 */
export function evidenceEntryFromTerminal(
  scenarioId: Id,
  fingerprint: string,
  terminalUpdate: Extract<RunUpdate, { kind: 'terminal' }>,
): EvidenceEntry {
  return {
    scenarioId,
    fingerprint,
    runId: terminalUpdate.runId,
    completion: terminalUpdate.status,
    checks: terminalUpdate.checks.map((check) => ({ ...check })),
    scope: {
      includedElementIds: [...terminalUpdate.summary.coverage.includedElementIds],
      excludedElementIds: [...terminalUpdate.summary.coverage.excludedElementIds],
    },
  };
}

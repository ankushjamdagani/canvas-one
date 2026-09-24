/**
 * Scenario compile front end (RV-14a).
 *
 * Implements the `compileScenario` half of model-and-runner.md §8's runner interface,
 * under the name `prepareScenario` (see below for why it isn't `compileScenario` yet).
 * Pipeline: storable validation (./validate.ts's `validateDocument`) → execution
 * manifest + fingerprint (./manifest.ts's `buildManifest`, which itself runs
 * `checkReadiness`/scope closure).
 *
 * SCOPE: this module deliberately does NOT implement plan handles, a worker session, or
 * `startRun` (model-and-runner.md §8's `plan:{workerSessionId,planId}` and `RunHandle`
 * machinery). Delivery order §12 puts "characterize the retained resource runner" and
 * the worker/adapter wiring after this step; RV-14a is scoped to "no UI and no worker
 * yet" per its task brief. Hence this export is named `prepareScenario` rather than the
 * contract's `compileScenario`: the contract's `compileScenario` returns a `plan` field
 * on success that nothing here can honestly produce yet. A later step should rename/wrap
 * this into the full `compileScenario` once a worker session exists.
 *
 * Cancellation: the signal is checked before validation, again before handing off to
 * `buildManifest`, and again after it resolves — `buildManifest` takes no AbortSignal
 * (see CONTRACT GAPS in the task report), so cancellation between its internal awaits
 * can't be observed mid-call; this is the narrowest boundary-only workaround available
 * without editing manifest.ts.
 */

import type { Id } from '../model';
import { validateDocument, type Issue } from '../validate';
import { buildManifest, type BuildManifestVersions, type ExecutionManifest } from '../manifest';
import type { ReadinessIssue } from '../readiness';
import type { AuthoredSnapshot } from './types';

/**
 * `buildManifest`'s `not-ready` status carries `ReadinessIssue[]`, whose `code` type is
 * a strict superset of `Issue['code']` (readiness/closure codes plus the base issue
 * codes). `prepareScenario` surfaces whichever issue shape produced the failure rather
 * than lossily narrowing readiness codes back down to `Issue`'s closed catalog.
 *
 * `IdentityUnavailableIssue` is the CONTRACT GAPS sentinel described below: neither
 * `Issue` nor `ReadinessIssue` declares an `'identity-unavailable'` code (it names a
 * hashing failure, not a document/readiness defect), so it's added as its own arm here
 * rather than smuggled into either closed catalog.
 */
export type IdentityUnavailableIssue = {
  readonly code: 'identity-unavailable';
  readonly path: readonly (string | number)[];
  readonly entityId: Id | null;
  readonly severity: 'error';
  readonly message: string;
};

export type PrepareIssue = Issue | ReadinessIssue | IdentityUnavailableIssue;

export type PrepareScenarioResult =
  | { readonly status: 'ready'; readonly manifest: ExecutionManifest; readonly fingerprint: string }
  | {
      readonly status: 'invalid' | 'analysis-limit' | 'cancelled';
      readonly issues: readonly PrepareIssue[];
    };

function cancelled(): PrepareScenarioResult {
  return { status: 'cancelled', issues: [] };
}

/**
 * `prepareScenario(snapshot, scenarioId, signal, versions)`.
 *
 * Status mapping from `buildManifest` (run-identity.md §3 / model-and-runner.md §9):
 * - `ok` → `ready` (manifest + fingerprint passed through unchanged).
 * - `not-ready` → `invalid`, keeping its issues verbatim.
 * - `analysis-limit` / `cancelled` → pass through unchanged (contract has these exact
 *   statuses already).
 * - `identity-unavailable` has no corresponding contract status for this front end
 *   (run-identity.md §3 only says hash-unavailable "blocks qualifying runs, commit and
 *   publish" — it doesn't name a `compileScenario` status). Narrowest reading: treat it
 *   as `invalid` with a single sentinel issue carrying code `'identity-unavailable'`,
 *   since it is not a modeled document/readiness defect. See CONTRACT GAPS.
 */
export async function prepareScenario(
  snapshot: AuthoredSnapshot,
  scenarioId: Id,
  signal: AbortSignal,
  versions: BuildManifestVersions,
): Promise<PrepareScenarioResult> {
  if (signal.aborted) {
    return cancelled();
  }

  const validation = validateDocument(snapshot.document);

  if (signal.aborted) {
    return cancelled();
  }

  if (!validation.ok) {
    return { status: 'invalid', issues: validation.issues };
  }

  const result = await buildManifest(validation.document, scenarioId, versions);

  if (signal.aborted) {
    return cancelled();
  }

  switch (result.status) {
    case 'ok':
      return { status: 'ready', manifest: result.manifest, fingerprint: result.fingerprint };
    case 'not-ready':
      return { status: 'invalid', issues: result.issues };
    case 'analysis-limit':
      return { status: 'analysis-limit', issues: [] };
    case 'cancelled':
      return cancelled();
    case 'identity-unavailable':
      return {
        status: 'invalid',
        issues: [
          {
            code: 'identity-unavailable',
            path: [],
            entityId: null,
            severity: 'error',
            message:
              'Execution manifest hashing is unavailable (Web Crypto missing or failed); run identity cannot be computed.',
          },
        ],
      };
    default: {
      const exhaustive: never = result;
      throw new Error(`prepareScenario: unhandled buildManifest status: ${JSON.stringify(exhaustive)}`);
    }
  }
}

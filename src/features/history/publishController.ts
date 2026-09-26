/**
 * PublishController: publish review, draft-behind-main and conflict resolution
 * for System Studio (RV-11b).
 *
 * Implements specifications from:
 * - specs/revamp/design.md screen family: 22C publish review, 22D published,
 *   22E draft behind main, 22F compare and resolve (image assets not present in
 *   this checkout; behavior is taken from the contracts and decisions below).
 * - specs/revamp/contracts/commands.md (history.prepare-publish, history.resolve-conflict, history.publish)
 * - specs/revamp/contracts/transactions.md §4 & §5 (Prepare publish, merge, publish, no undo)
 * - specs/revamp/contracts/storage.md §3 (PublicationMetadata, version suggestions)
 * - specs/revamp/contracts/run-identity.md §5 (Eligibility)
 * - specs/revamp/decisions.md D25 (sequence conflicts: ours/theirs/edit, no guessed
 *   interleaving), D26 (no publish undo — irreversible, confirm required), D29
 *   (source branch closes by default after publish).
 *
 * Candidates are controller-owned and ephemeral (CandidateController never writes
 * to the DB). This controller only orchestrates the existing CandidateController +
 * StudioRepository + scenarioStatus (features/runs) surfaces; it never reimplements
 * merge, eligibility or scenario execution itself.
 *
 * Scenario execution ("run the candidate's scenarios") is provided by the caller
 * as an injected `runScenario` function rather than built here, per the task's
 * explicit "do NOT build a new runner." In production this is wired to the
 * existing candidate runner, `CandidateController.startCandidateRun` (which
 * itself is the officially specified, already-tested mechanism for executing a
 * scenario against an isolated candidate — see persistence/studio/candidates.ts
 * and publish.test.ts), never a bespoke runner built for this feature.
 */

import type { Id } from '../../domain/studio/model';
import type { EvidenceRef } from '../../domain/studio/runner/evidence';
import { createIssue, mapErrorToFailedResult } from '../../persistence/studio/errors';
import type {
  Actor,
  AuthoredResult,
  PublicationMetadata,
  PublicationRecord,
  StudioRepository,
} from '../../persistence/studio';
import type {
  Candidate,
  CandidateController,
  PrepareCandidateResult,
  ResolveConflictResult,
  StartCandidateRunResult,
} from '../../persistence/studio/candidates';
import type { ConflictResolution } from '../../domain/versioning/resolve';
import type { MergeConflict } from '../../domain/versioning/merge';
import {
  proposeVersionSuggestions,
  type VersionSuggestions,
} from '../../domain/versioning/publication';
import {
  runQualifies,
  sortQualifyingRuns,
} from '../../domain/versioning/eligibility';
import {
  loadScenarioStatuses,
  toRunCandidate,
  type ScenarioWithStatus,
} from '../runs/scenarioStatus';
import type { SessionController } from '../session/controller';

// ============================================================================
// Injected run function
// ============================================================================

export type PublishRunScenarioParams = {
  readonly candidateId: Id;
  readonly scenarioId: Id;
  readonly runId: Id;
};

export type PublishRunScenarioFn = (
  params: PublishRunScenarioParams,
) => Promise<StartCandidateRunResult>;

// ============================================================================
// Controller Options & State
// ============================================================================

export type PublishControllerOptions = {
  readonly repository: StudioRepository;
  readonly session: SessionController;
  readonly candidateController: CandidateController;
  readonly mintId: () => Id;
  readonly actor: Actor;
  readonly runScenario: PublishRunScenarioFn;
};

export type PublishStaleInfo = {
  readonly scope: 'project' | 'branch' | 'preferences';
  readonly expected: unknown;
  readonly actual: unknown;
};

export type PublishStatus =
  | 'idle'
  | 'preparing'
  | 'behind-main'
  | 'blocked'
  | 'review'
  | 'publishing'
  | 'published'
  | 'error';

export type PublishControllerState = {
  readonly status: PublishStatus;
  readonly candidateId: Id | null;
  /** Real merge conflicts on the current candidate (22F compare and resolve). */
  readonly conflicts: readonly Readonly<MergeConflict>[];
  /** Per-scenario status computed on the candidate's merged document. */
  readonly scenarios: readonly ScenarioWithStatus[];
  /** Authoritative eligibility from CandidateController.evaluate. */
  readonly eligible: boolean;
  readonly versionSuggestions: VersionSuggestions | null;
  /** Set when prepare-publish returns stale (22E draft behind main). */
  readonly staleInfo: PublishStaleInfo | null;
  /** First real issue message when prepare/resolve is blocked outright (missing/invalid/failed). */
  readonly blockedMessage: string | null;
  /** Set once history.publish applies (22D published). */
  readonly publication: Readonly<PublicationRecord> | null;
  readonly lastError: unknown | null;
};

const INITIAL_STATE: PublishControllerState = Object.freeze({
  status: 'idle',
  candidateId: null,
  conflicts: Object.freeze([]),
  scenarios: Object.freeze([]),
  eligible: false,
  versionSuggestions: null,
  staleInfo: null,
  blockedMessage: null,
  publication: null,
  lastError: null,
});

function firstIssueMessage(res: { readonly issues?: readonly { readonly message: string }[] }): string | null {
  return res.issues?.[0]?.message ?? null;
}

export class PublishController {
  private readonly repository: StudioRepository;
  private readonly session: SessionController;
  private readonly candidateController: CandidateController;
  private readonly mintId: () => Id;
  private readonly actor: Actor;
  private readonly injectedRunScenario: PublishRunScenarioFn;

  private state: PublishControllerState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();

  constructor(options: PublishControllerOptions) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('PublishController requires options object');
    }
    if (!options.repository) {
      throw new TypeError('PublishController requires repository');
    }
    if (!options.session) {
      throw new TypeError('PublishController requires session');
    }
    if (!options.candidateController) {
      throw new TypeError('PublishController requires candidateController');
    }
    if (typeof options.mintId !== 'function') {
      throw new TypeError('PublishController requires mintId function');
    }
    if (!options.actor || options.actor.kind !== 'local-human') {
      throw new TypeError('PublishController requires valid Actor (kind: local-human)');
    }
    if (typeof options.runScenario !== 'function') {
      throw new TypeError('PublishController requires an injected runScenario function');
    }

    this.repository = options.repository;
    this.session = options.session;
    this.candidateController = options.candidateController;
    this.mintId = options.mintId;
    this.actor = options.actor;
    this.injectedRunScenario = options.runScenario;
  }

  // ==========================================================================
  // External Store API
  // ==========================================================================

  getState = (): PublishControllerState => {
    return this.state;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Listener errors should not break controller loop
      }
    }
  }

  private updateState(partial: Partial<PublishControllerState>): void {
    this.state = Object.freeze({
      ...this.state,
      ...partial,
    });
    this.notifyListeners();
  }

  /** Discards any in-progress review/candidate and returns to idle. */
  reset(): void {
    this.updateState(INITIAL_STATE);
  }

  // ==========================================================================
  // Prepare (history.prepare-publish)
  // ==========================================================================

  async prepare(): Promise<PrepareCandidateResult> {
    const sessionState = this.session.getState();
    if (!sessionState.projectId || !sessionState.branchId) {
      const result: PrepareCandidateResult = {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open in session', [])],
      };
      this.updateState({
        status: 'blocked',
        blockedMessage: firstIssueMessage(result) ?? 'No project is open in session',
      });
      return result;
    }

    this.updateState({ status: 'preparing', staleInfo: null, blockedMessage: null, lastError: null });

    try {
      const project = await this.repository.loadProject(sessionState.projectId);
      if (!project) {
        const result: PrepareCandidateResult = { status: 'missing', ids: [sessionState.projectId] };
        this.updateState({ status: 'blocked', blockedMessage: `Project '${sessionState.projectId}' not found` });
        return result;
      }

      if (sessionState.branchId === project.mainBranchId) {
        const result: PrepareCandidateResult = {
          status: 'invalid',
          issues: [
            createIssue(
              'structural-rule',
              'Publish is prepared from a non-main branch; the active branch is main',
              ['branchId'],
            ),
          ],
        };
        this.updateState({
          status: 'blocked',
          blockedMessage: firstIssueMessage(result),
        });
        return result;
      }

      const [sourceBranch, mainBranch] = await Promise.all([
        this.repository.loadBranch(sessionState.projectId, sessionState.branchId),
        this.repository.loadBranch(sessionState.projectId, project.mainBranchId),
      ]);

      if (!sourceBranch) {
        const result: PrepareCandidateResult = { status: 'missing', ids: [sessionState.branchId] };
        this.updateState({ status: 'blocked', blockedMessage: `Branch '${sessionState.branchId}' not found` });
        return result;
      }
      if (!mainBranch) {
        const result: PrepareCandidateResult = { status: 'missing', ids: [project.mainBranchId] };
        this.updateState({ status: 'blocked', blockedMessage: `Main branch not found` });
        return result;
      }

      const result = await this.candidateController.prepare(this.repository, {
        projectId: sessionState.projectId,
        sourceBranchId: sourceBranch.id,
        sourceRevision: sourceBranch.workingRevision,
        sourceHeadId: sourceBranch.headCommitId,
        mainRevision: mainBranch.workingRevision,
        mainHeadId: mainBranch.headCommitId,
      });

      if (result.status === 'done') {
        this.updateState({ candidateId: result.value.candidateId });
        await this.refreshFromCandidate();
        await this.loadVersionSuggestions(sessionState.projectId);
        return result;
      }

      if (result.status === 'stale') {
        this.updateState({
          status: 'behind-main',
          staleInfo: { scope: result.scope, expected: result.expected, actual: result.actual },
        });
        return result;
      }

      // invalid / missing / failed: nothing to resolve, source or main isn't in a
      // preparable state (e.g. uncommitted changes, closed branch, ambiguous base).
      const message =
        'issues' in result
          ? firstIssueMessage(result) ?? `prepare-publish failed with status '${result.status}'`
          : `prepare-publish failed with status '${result.status}'`;
      this.updateState({ status: 'blocked', blockedMessage: message });
      return result;
    } catch (err) {
      const failed = mapErrorToFailedResult(err);
      this.updateState({ status: 'error', lastError: failed });
      return failed as PrepareCandidateResult;
    }
  }

  // ==========================================================================
  // Refresh candidate-derived state (conflicts, scenario statuses, eligibility)
  // ==========================================================================

  private getCandidateOrThrow(): Readonly<Candidate> {
    const candidateId = this.state.candidateId;
    if (!candidateId) {
      throw new Error('PublishController has no active candidate');
    }
    const candidate = this.candidateController.get(candidateId);
    if (!candidate) {
      throw new Error(`Candidate '${candidateId}' not found in CandidateController`);
    }
    return candidate;
  }

  private async refreshFromCandidate(): Promise<void> {
    const candidateId = this.state.candidateId;
    if (!candidateId) return;

    const candidate = this.candidateController.get(candidateId);
    if (!candidate) {
      this.updateState({
        status: 'error',
        lastError: `Candidate '${candidateId}' no longer exists (superseded or reloaded)`,
      });
      return;
    }

    const statusResult = await loadScenarioStatuses(
      this.repository,
      candidate.projectId,
      candidate.mergeState.document,
    );

    const evalResult = await this.candidateController.evaluate(this.repository, candidateId);

    this.updateState({
      status: 'review',
      conflicts: candidate.mergeState.conflicts,
      scenarios: statusResult.scenarios,
      eligible: evalResult.status === 'done' && evalResult.eligible,
    });
  }

  // ==========================================================================
  // Conflict resolution (history.resolve-conflict)
  // ==========================================================================

  async resolveConflict(
    conflictId: Id,
    resolution: ConflictResolution,
  ): Promise<ResolveConflictResult> {
    const candidateId = this.state.candidateId;
    if (!candidateId) {
      throw new Error('PublishController has no active candidate to resolve a conflict on');
    }

    const result = await this.candidateController.resolveConflict(this.repository, {
      candidateId,
      conflictId,
      resolution,
    });

    if (result.status === 'done') {
      this.updateState({ candidateId: result.value.candidateId });
      await this.refreshFromCandidate();
    }

    return result;
  }

  // ==========================================================================
  // Scenario run (needs evidence per scenario on the candidate)
  // ==========================================================================

  async runScenario(scenarioId: Id): Promise<StartCandidateRunResult> {
    const candidateId = this.state.candidateId;
    if (!candidateId) {
      throw new Error('PublishController has no active candidate to run a scenario on');
    }

    const runId = this.mintId();
    const result = await this.injectedRunScenario({ candidateId, scenarioId, runId });

    // Refresh scenario statuses regardless of outcome: a saved run (pass or fail)
    // changes status, and a superseded/failed attempt should still surface via
    // the real evaluate/loadScenarioStatuses read rather than an assumed state.
    if (this.state.candidateId === candidateId) {
      await this.refreshFromCandidate();
    }

    return result;
  }

  // ==========================================================================
  // Version suggestions (storage.md §3)
  // ==========================================================================

  private async loadVersionSuggestions(projectId: Id): Promise<void> {
    const publications = await this.repository.listPublications(projectId);
    let latestVersion = null;
    if (publications.length > 0) {
      const sorted = [...publications].sort((a, b) => b.ordinal - a.ordinal);
      latestVersion = sorted[0].metadata.version;
    }
    this.updateState({ versionSuggestions: proposeVersionSuggestions(latestVersion) });
  }

  // ==========================================================================
  // Publish (history.publish)
  // ==========================================================================

  /**
   * Publishes the current eligible candidate. Callers are responsible for their
   * own explicit confirmation step before calling this — publication is
   * irreversible (D26): there is no undo command, compensating record or main
   * rewind.
   */
  async publish(
    metadata: PublicationMetadata,
    keepSourceOpen: boolean,
  ): Promise<AuthoredResult> {
    const candidate = this.getCandidateOrThrow();
    const sessionState = this.session.getState();

    if (!sessionState.projectId) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open in session', [])],
      };
    }

    this.updateState({ status: 'publishing', lastError: null });

    try {
      // Build evidence from the latest qualifying saved run per scenario for the
      // candidate's current fingerprint, exactly as HistoryController.commit does
      // for a branch commit (run-identity.md §5) — never invented, never reused
      // across a different fingerprint.
      const evidence: EvidenceRef[] = [];
      for (const scenarioWithStatus of this.state.scenarios) {
        const { scenario, currentFingerprint } = scenarioWithStatus;
        if (!currentFingerprint) {
          const result = {
            status: 'invalid' as const,
            issues: [
              createIssue(
                'structural-rule',
                `Scenario "${scenario.label}" does not have a valid current fingerprint`,
                ['scenarios', scenario.id],
                scenario.id,
              ),
            ],
          };
          this.updateState({ status: 'review', lastError: result });
          return result;
        }

        const runs = await this.repository.runsByFingerprint(candidate.projectId, currentFingerprint);
        const candidates = runs.map(toRunCandidate);
        const qualifying = candidates.filter((r) => {
          const qual = runQualifies(r, {
            scenarioId: scenario.id,
            fingerprint: currentFingerprint,
            compiledScopeElementIds: scenario.scopeElementIds,
          });
          return qual.qualifies;
        });
        const sorted = sortQualifyingRuns(qualifying);
        if (sorted.length === 0) {
          const result = {
            status: 'failed' as const,
            code: 'ineligible' as const,
            issues: [
              createIssue(
                'structural-rule',
                `Scenario "${scenario.label}" has no qualifying run for fingerprint ${currentFingerprint}`,
                ['scenarios', scenario.id],
                scenario.id,
              ),
            ],
          };
          this.updateState({ status: 'review', lastError: result });
          return result;
        }

        evidence.push({
          scenarioId: scenario.id,
          fingerprint: currentFingerprint,
          runId: sorted[0].id,
        });
      }

      const project = await this.repository.loadProject(candidate.projectId);
      if (!project) {
        const result = { status: 'missing' as const, ids: [candidate.projectId] };
        this.updateState({ status: 'review', lastError: result });
        return result;
      }

      const publicationId = this.mintId();
      const mergeCommitId = this.mintId();

      const result = await this.candidateController.publish(this.repository, {
        commandId: 'history.publish',
        operationId: this.mintId(),
        projectId: candidate.projectId,
        branchId: candidate.sourceBranchId,
        expectedWorkingRevision: candidate.expectedSourceRevision,
        actor: this.actor,
        payload: {
          candidateId: candidate.candidateId,
          publicationId,
          mergeCommitId,
          metadata,
          evidence,
          keepSourceOpen,
          expectedProjectRevision: project.revision,
        },
      });

      if (result.status === 'applied') {
        const publication = await this.repository.loadPublication(candidate.projectId, publicationId);
        // Reload session so the source branch's (possibly now closed) state and
        // main's advanced head are reflected, mirroring HistoryController's
        // post-commit/-restore reload.
        await this.session.openProject(candidate.projectId, sessionState.branchId ?? null);
        this.updateState({
          status: 'published',
          publication,
          lastError: null,
        });
        return result;
      }

      this.updateState({ status: 'review', lastError: result });
      return result;
    } catch (err) {
      const failed = mapErrorToFailedResult(err);
      this.updateState({ status: 'review', lastError: failed });
      return failed;
    }
  }
}

/**
 * The public surface PublishFlow depends on. A `Pick` of PublishController's own
 * public members (never a hand-maintained duplicate) so PublishFlow can be driven
 * by a real controller in the app, or by a lightweight stub in a render test,
 * without needing PublishController's private repository/session/candidate fields.
 */
export type PublishControllerLike = Pick<
  PublishController,
  'getState' | 'subscribe' | 'prepare' | 'resolveConflict' | 'runScenario' | 'publish' | 'reset'
>;

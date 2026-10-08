/**
 * PublishController: publish review, draft-behind-main and conflict resolution
 * for System Studio.
 *
 * Candidates are controller-owned and ephemeral (CandidateController never writes
 * to the DB). This controller only orchestrates the existing CandidateController +
 * StudioRepository + scenarioStatus (features/runs) surfaces; it never reimplements
 * merge, eligibility or scenario execution itself.
 *
 * Scenario execution ("run the candidate's scenarios") is provided by the caller
 * as an injected `runScenario` function. In production this is wired to
 * `CandidateController.startCandidateRun` (see persistence/studio/candidates.ts),
 * which executes a scenario against an isolated candidate.
 */

import type { Document, Id } from '../../domain/studio/model';
import type { EvidenceRef } from '../../domain/studio/runner/evidence';
import { createIssue, mapErrorToFailedResult } from '../../persistence/studio/errors';
import type {
  Actor,
  AuthoredResult,
  CommitRecord,
  PublicationMetadata,
  PublicationRecord,
  StudioRepository,
} from '../../persistence/studio';
import { diffDocuments } from '../../domain/versioning/diff';
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
import { requireResultMessage, ResultMessageContractError } from './resultMessage';

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

export type ResolvedFieldRecord = {
  readonly recordKind: string;
  readonly recordId: Id;
  readonly path: readonly (string | number)[];
  readonly resolution: 'ours' | 'theirs' | 'edited';
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
  /** Real merge conflicts on the current candidate. */
  readonly conflicts: readonly Readonly<MergeConflict>[];
  /** Per-scenario status computed on the candidate's merged document. */
  readonly scenarios: readonly ScenarioWithStatus[];
  /** The candidate's merged document and the three real inputs the merge was
   * computed from (compare and resolve needs both — labels and auto-merged
   * detection read the inputs; the field list reads the merged document). */
  readonly mergedDocument: Document | null;
  readonly mergeInputs: { readonly base: Document; readonly ours: Document; readonly theirs: Document } | null;
  /** Authoritative eligibility from CandidateController.evaluate. */
  readonly eligible: boolean;
  readonly versionSuggestions: VersionSuggestions | null;
  /** The latest published version's key, or null before any publication ("current X · nothing chosen yet"). */
  readonly currentVersionKey: string | null;
  /** Real branch labels ("async-fulfilment · 6 commits → main"), never a raw ID. */
  readonly sourceBranchLabel: string | null;
  readonly mainBranchLabel: string | null;
  /** Commits on the source branch since the merge base, newest first ("What goes onto main"). */
  readonly commitsSinceFork: readonly Readonly<CommitRecord>[];
  /** Distinct elements changed between the merge base and the source head ("M components touched"). */
  readonly componentsTouchedCount: number;
  /** How many publications landed on main since this branch's fork point, and the
   * fork point's own version (null when the branch forked before any publication
   * existed), e.g. "2 versions published since you forked at 2.2.1". */
  readonly versionsPublishedSinceFork: number;
  readonly forkVersionKey: string | null;
  /** Fields resolved so far on this candidate lineage ("resolved · field ·
   * side"). Accumulated across resolveConflict calls within one prepare(); reset
   * on the next prepare() since a fresh merge has no resolution history yet. */
  readonly resolvedFields: readonly Readonly<ResolvedFieldRecord>[];
  /** Set when prepare-publish returns stale (draft behind main). */
  readonly staleInfo: PublishStaleInfo | null;
  /** First real issue message when prepare/resolve is blocked outright (missing/invalid/failed). */
  readonly blockedMessage: string | null;
  /** Set once history.publish applies (published). */
  readonly publication: Readonly<PublicationRecord> | null;
  readonly publishedSourceClosed: boolean | null;
  readonly lastError: unknown | null;
};

const INITIAL_STATE: PublishControllerState = Object.freeze({
  status: 'idle',
  candidateId: null,
  conflicts: Object.freeze([]),
  scenarios: Object.freeze([]),
  mergedDocument: null,
  mergeInputs: null,
  eligible: false,
  versionSuggestions: null,
  currentVersionKey: null,
  sourceBranchLabel: null,
  mainBranchLabel: null,
  commitsSinceFork: Object.freeze([]),
  componentsTouchedCount: 0,
  versionsPublishedSinceFork: 0,
  forkVersionKey: null,
  resolvedFields: Object.freeze([]),
  staleInfo: null,
  blockedMessage: null,
  publication: null,
  publishedSourceClosed: null,
  lastError: null,
});

function firstIssueMessage(res: { readonly issues?: readonly { readonly message: string }[] }): string {
  return requireResultMessage(res);
}

export class PublishController {
  private readonly repository: StudioRepository;
  private readonly session: SessionController;
  private readonly candidateController: CandidateController;
  private readonly mintId: () => Id;
  private readonly actor: Actor;
  private readonly injectedRunScenario: PublishRunScenarioFn;

  private state: PublishControllerState = INITIAL_STATE;
  private resolutions: { conflict: Readonly<MergeConflict>; resolution: ConflictResolution }[] = [];
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
    this.resolutions = [];
    this.updateState(INITIAL_STATE);
  }

  // ==========================================================================
  // Prepare (history.prepare-publish)
  // ==========================================================================

  async prepare(): Promise<PrepareCandidateResult> {
    this.resolutions = [];
    const sessionState = this.session.getState();
    if (!sessionState.projectId || !sessionState.branchId) {
      const result: PrepareCandidateResult = {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open in session', [])],
      };
      this.updateState({
        status: 'blocked',
        blockedMessage: firstIssueMessage(result),
      });
      return result;
    }

    this.updateState({
      status: 'preparing',
      staleInfo: null,
      blockedMessage: null,
      lastError: null,
      resolvedFields: Object.freeze([]),
    });

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

      this.updateState({
        sourceBranchLabel: sourceBranch.label,
        mainBranchLabel: mainBranch.label,
      });

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
          ? firstIssueMessage(result)
          : `Missing records: ${result.ids.join(', ')}`;
      this.updateState({ status: 'blocked', blockedMessage: message });
      return result;
    } catch (err) {
      if (err instanceof ResultMessageContractError) throw err;
      const failed = mapErrorToFailedResult(err);
      this.updateState({ status: 'error', lastError: failed });
      return failed;
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

  /**
   * Walks the source branch's real commit ancestry from its head back to (but
   * excluding) the merge base, newest first — "What goes onto main".
   * Never invents a commit list: an unreachable/missing link throws rather than
   * silently truncating the walk.
   */
  private async loadCommitsSinceFork(
    projectId: Id,
    sourceHeadId: Id | null,
    mergeBaseCommitId: Id | null,
  ): Promise<readonly Readonly<CommitRecord>[]> {
    const commits: CommitRecord[] = [];
    const seen = new Set<Id>();
    let cursor = sourceHeadId;
    while (cursor !== null && cursor !== mergeBaseCommitId) {
      if (seen.has(cursor)) throw new Error('Cycle in source commit ancestry');
      seen.add(cursor);
      const commit = await this.repository.loadCommit(projectId, cursor);
      if (!commit) {
        throw new Error(`Commit '${cursor}' referenced by branch ancestry was not found`);
      }
      commits.push(commit);
      // History transitions are linear per commit (parent =
      // branch head); a merge commit's ancestry is walked via its first parent,
      // which is always the branch that carried it forward.
      cursor = commit.parentIds[0] ?? null;
    }
    if (cursor !== mergeBaseCommitId) throw new Error('Source commit ancestry does not reach the merge base');
    return commits;
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

    const [statusResult, evalResult, commitsSinceFork, publications] = await Promise.all([
      loadScenarioStatuses(this.repository, candidate.projectId, candidate.mergeState.document),
      this.candidateController.evaluate(this.repository, candidateId),
      this.loadCommitsSinceFork(
        candidate.projectId,
        // "theirs" is the source branch's head document; its head commit id is
        // stored on the candidate as expectedSourceHeadId.
        candidate.expectedSourceHeadId,
        candidate.mergeBase.commitId,
      ),
      this.repository.listPublications(candidate.projectId),
    ]);

    // Components touched: distinct elements that differ between the merge base
    // and the source head — both already held in full by the merge inputs, so
    // no extra snapshot reads are needed.
    const componentsTouchedCount = diffDocuments(
      candidate.mergeState.inputs.base,
      candidate.mergeState.inputs.theirs,
    ).filter((d) => d.recordKind === 'element').length;

    // Versions published since the fork: the merge base is either a real commit
    // (some publication's commitId matches it — count publications strictly
    // after that one by ordinal) or the project's initial snapshot with no
    // publication yet (every existing publication happened after the fork).
    const forkPublication = candidate.mergeBase.commitId
      ? publications.find((p) => p.commitId === candidate.mergeBase.commitId)
      : undefined;
    const versionsPublishedSinceFork = forkPublication
      ? publications.filter((p) => p.ordinal > forkPublication.ordinal).length
      : publications.length;

    this.updateState({
      status: 'review',
      conflicts: candidate.mergeState.conflicts,
      scenarios: statusResult.scenarios,
      mergedDocument: candidate.mergeState.document,
      mergeInputs: candidate.mergeState.inputs,
      eligible: evalResult.status === 'done' && evalResult.eligible,
      commitsSinceFork,
      componentsTouchedCount,
      versionsPublishedSinceFork,
      forkVersionKey: forkPublication?.versionKey ?? null,
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

    const targetConflict = this.state.conflicts.find((c) => c.id === conflictId);

    const result = await this.candidateController.resolveConflict(this.repository, {
      candidateId,
      conflictId,
      resolution,
    });

    if (result.status === 'done') {
      if (targetConflict) {
        if (resolution.kind === 'edited') this.resolutions = this.resolutions.filter(({ conflict }) => conflict.recordKind !== targetConflict.recordKind || conflict.recordId !== targetConflict.recordId);
        this.resolutions.push({ conflict: targetConflict, resolution });
      }
      const nextCandidate = this.candidateController.get(result.value.candidateId);
      if (!nextCandidate) throw new Error('Resolved candidate was not found');
      const removed = this.state.conflicts.filter((conflict) => !nextCandidate.mergeState.conflicts.some((next) => next.id === conflict.id));
      const resolvedFields = targetConflict
        ? Object.freeze([
            ...this.state.resolvedFields.map((field) => resolution.kind === 'edited' && field.recordKind === targetConflict.recordKind && field.recordId === targetConflict.recordId ? { ...field, resolution: resolution.kind } : field),
            ...removed.map((conflict) => ({
              recordKind: conflict.recordKind,
              recordId: conflict.recordId,
              path: conflict.path,
              resolution: resolution.kind,
            })),
          ])
        : this.state.resolvedFields;

      this.updateState({ candidateId: result.value.candidateId, resolvedFields });
      await this.refreshFromCandidate();
    }

    return result;
  }

  /** Rebuild through the existing candidate API and replay the remaining choices.
   * An edited resolution replaces its record, so reopening one of its fields
   * reopens all conflicts cleared by that record edit. */
  async reopenConflict(field: ResolvedFieldRecord): Promise<void> {
    const remaining = this.resolutions.filter(({ conflict, resolution }) =>
      conflict.recordKind !== field.recordKind || conflict.recordId !== field.recordId ||
      (resolution.kind !== 'edited' && JSON.stringify(conflict.path) !== JSON.stringify(field.path)),
    );
    const prepared = await this.prepare();
    if (prepared.status !== 'done') return;
    for (const choice of remaining) {
      const conflict = this.state.conflicts.find((c) => c.recordKind === choice.conflict.recordKind && c.recordId === choice.conflict.recordId && JSON.stringify(c.path) === JSON.stringify(choice.conflict.path));
      if (!conflict) continue;
      const result = await this.resolveConflict(conflict.id, choice.resolution);
      if (result.status !== 'done') throw new Error('Candidate replay failed while reopening a conflict');
    }
  }

  /**
   * Bulk "ours everywhere" / "theirs everywhere": resolves every currently
   * open conflict with the same side, one at a time — each resolution supersedes
   * the candidate and yields a new one, exactly as a single resolveConflict call
   * does, so this is a loop over the real one-at-a-time contract, never a new
   * bulk-merge code path.
   */
  async resolveAllConflicts(side: 'ours' | 'theirs'): Promise<ResolveConflictResult | null> {
    let last: ResolveConflictResult | null = null;
    while (this.state.conflicts.length > 0) {
      const conflictId = this.state.conflicts[0].id;
      last = await this.resolveConflict(conflictId, { kind: side });
      if (last.status !== 'done') {
        return last;
      }
    }
    return last;
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
  // Version suggestions
  // ==========================================================================

  private async loadVersionSuggestions(projectId: Id): Promise<void> {
    const publications = await this.repository.listPublications(projectId);
    let latestVersion = null;
    let currentVersionKey: string | null = null;
    if (publications.length > 0) {
      const sorted = [...publications].sort((a, b) => b.ordinal - a.ordinal);
      latestVersion = sorted[0].metadata.version;
      currentVersionKey = sorted[0].versionKey;
    }
    this.updateState({
      versionSuggestions: proposeVersionSuggestions(latestVersion),
      currentVersionKey,
    });
  }

  // ==========================================================================
  // Publish (history.publish)
  // ==========================================================================

  /**
   * Publishes the current eligible candidate. Callers are responsible for their
   * own explicit confirmation step before calling this — publication is
   * irreversible: there is no undo command, compensating record or main
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
      // for a branch commit — never invented, never reused
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
        if (!publication) throw new Error('Applied publication record is missing');
        await this.session.openProject(candidate.projectId, candidate.mainBranchId);
        this.updateState({
          status: 'published',
          publication,
          publishedSourceClosed: !keepSourceOpen,
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
  | 'getState'
  | 'subscribe'
  | 'prepare'
  | 'resolveConflict'
  | 'resolveAllConflicts'
  | 'reopenConflict'
  | 'runScenario'
  | 'publish'
  | 'reset'
>;

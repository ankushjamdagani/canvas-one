/**
 * HistoryController implementation for System Studio (RV-11a).
 *
 * Implements specifications from:
 * - specs/revamp/decisions.md (D11, D20, D26, D27, D28, D29, D37, D40, D41)
 * - specs/revamp/design-revalidation.md (§2 exclusions & §3 item 10)
 * - specs/revamp/requirements.md (R08)
 * - specs/revamp/contracts/transactions.md §4
 * - specs/revamp/contracts/commands.md §3 & "Scenarios (D41)"
 * - specs/revamp/contracts/storage.md §2–§5
 * - specs/revamp/contracts/run-identity.md §5
 */

import type { Document, Id } from '../../domain/studio/model';
import type { EvidenceRef } from '../../domain/studio/runner/evidence';
import {
  createIssue,
  mapErrorToFailedResult,
} from '../../persistence/studio/errors';
import type {
  Actor,
  BranchRecord,
  CheckpointRecord,
  CommitRecord,
  HistoryCheckpointCommand,
  HistoryCommitCommand,
  HistoryLoadResult,
  HistoryRestoreCommand,
  PublicationRecord,
  RunRecord,
  StudioRepository,
} from '../../persistence/studio';
import {
  runQualifies,
  sortQualifyingRuns,
} from '../../domain/versioning/eligibility';
import {
  loadScenarioStatuses,
  toRunCandidate,
  type ScenarioStatus,
  type ScenarioWithStatus,
} from '../runs/scenarioStatus';
import type { SessionController } from '../session/controller';
import {
  computeAheadOfVersion,
  computeChangesList,
  computeFieldsChanged,
} from './diffSummary';
import type {
  CommitActionOptions,
  CommitIneligibleResult,
  CommitPreview,
  CommitResult,
  HistoryControllerOptions,
  HistoryControllerState,
  RestoreResult,
  SaveCheckpointResult,
} from './types';

const INITIAL_HISTORY_STATE: HistoryControllerState = Object.freeze({
  status: 'empty',
  branch: null,
  isMain: false,
  workingEdits: Object.freeze([]),
  workingEditsNotice: 'This session only: uncommitted edit history resets upon session reload',
  checkpoints: Object.freeze([]),
  commits: Object.freeze([]),
  publications: Object.freeze([]),
  aheadOfVersion: null,
  lastError: null,
});

function formatScenarioStatusReason(status: ScenarioStatus): string {
  switch (status.kind) {
    case 'not-run':
      return 'not run yet';
    case 'needs-rerun':
      return 'needs a rerun (ran on an earlier version)';
    case 'failed':
      return `failed ${status.totalChecks - status.passedChecks} of ${status.totalChecks} checks`;
    case 'not-ready': {
      const firstIssue = status.issues[0];
      if (!firstIssue) {
        // Contract violation: a not-ready status must carry the issue(s) that made it
        // not ready. Never invent a generic reason in its place.
        throw new Error('Scenario status "not-ready" has no issues; contract violation');
      }
      return `not ready: ${firstIssue.message}`;
    }
    case 'passed':
      return 'passed';
  }
}

export class HistoryController {
  private readonly repository: StudioRepository;
  private readonly session: SessionController;
  private readonly mintId: () => Id;
  private readonly actor: Actor;

  private state: HistoryControllerState = INITIAL_HISTORY_STATE;
  private currentHistory: HistoryLoadResult | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly commitDiffCache = new Map<Id, string | null>();

  constructor(options: HistoryControllerOptions) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('HistoryController requires options object');
    }
    if (!options.repository) {
      throw new TypeError('HistoryController requires repository');
    }
    if (!options.session) {
      throw new TypeError('HistoryController requires session');
    }
    if (typeof options.mintId !== 'function') {
      throw new TypeError('HistoryController requires mintId function');
    }
    if (!options.actor || options.actor.kind !== 'local-human') {
      throw new TypeError('HistoryController requires valid Actor (kind: local-human)');
    }

    this.repository = options.repository;
    this.session = options.session;
    this.mintId = options.mintId;
    this.actor = options.actor;

    // Bound so callers (HistoryLadder/CommitPanel's `controller` prop via
    // React.useSyncExternalStore, or any other extracted reference) can pass
    // these bare without losing `this`, matching SessionController and
    // PublishController.
    this.getState = this.getState.bind(this);
    this.subscribe = this.subscribe.bind(this);

    // React to session state changes (edits, branch switch, reload)
    this.session.subscribe(() => {
      this.handleSessionChange();
    });

    // Initial check
    this.handleSessionChange();
  }

  // ==========================================================================
  // External Store API
  // ==========================================================================

  getState(): HistoryControllerState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Listener errors should not break controller loop
      }
    }
  }

  private updateState(partial: Partial<HistoryControllerState>): void {
    this.state = Object.freeze({
      ...this.state,
      ...partial,
    });
    this.notifyListeners();
  }

  // ==========================================================================
  // Getters for convenient access
  // ==========================================================================

  get branch(): Readonly<BranchRecord> | null {
    return this.state.branch;
  }

  get isMain(): boolean {
    return this.state.isMain;
  }

  get workingEdits(): readonly string[] {
    return this.state.workingEdits;
  }

  get checkpoints(): readonly Readonly<CheckpointRecord>[] {
    return this.state.checkpoints;
  }

  get commits(): readonly Readonly<CommitRecord>[] {
    return this.state.commits;
  }

  get publications(): readonly Readonly<PublicationRecord>[] {
    return this.state.publications;
  }

  get aheadOfVersion(): { readonly aheadCount: number; readonly versionKey: string } | null {
    return this.state.aheadOfVersion;
  }

  // ==========================================================================
  // Session Synchronization
  // ==========================================================================

  private lastSyncedProjectId: Id | null = null;
  private lastSyncedBranchId: Id | null = null;

  private handleSessionChange(): void {
    const sessionState = this.session.getState();
    const workingEdits = Object.freeze(
      this.session.undoStack.map((entry) => entry.label).reverse(),
    );

    const branchChanged =
      sessionState.projectId !== this.lastSyncedProjectId ||
      sessionState.branchId !== this.lastSyncedBranchId;

    if (branchChanged) {
      this.lastSyncedProjectId = sessionState.projectId;
      this.lastSyncedBranchId = sessionState.branchId;
      this.commitDiffCache.clear();
      void this.loadHistory();
      return;
    }

    // If only working edits or revisions changed, update state immediately
    if (this.state.workingEdits.length !== workingEdits.length || workingEdits.some((e, i) => e !== this.state.workingEdits[i])) {
      this.updateState({ workingEdits });
    }
  }

  // ==========================================================================
  // History Loading
  // ==========================================================================

  async loadHistory(): Promise<HistoryLoadResult | null> {
    const sessionState = this.session.getState();
    if (!sessionState.projectId) {
      this.updateState({
        status: 'empty',
        branch: null,
        isMain: false,
        workingEdits: Object.freeze([]),
        checkpoints: Object.freeze([]),
        commits: Object.freeze([]),
        publications: Object.freeze([]),
        aheadOfVersion: null,
        lastError: null,
      });
      return null;
    }

    try {
      const history = await this.repository.loadHistory(sessionState.projectId);
      this.currentHistory = history;

      const activeBranchId = sessionState.branchId ?? history.project.mainBranchId;
      const branch = history.branches.find((b) => b.id === activeBranchId) ?? null;
      const isMain = activeBranchId === history.project.mainBranchId;

      // Commits reachable from the branch's head in DAG order, newest first (storage.md §9)
      const branchCommits =
        history.branchHistories.find((bh) => bh.branchId === activeBranchId)?.commits ??
        Object.freeze([]);

      // Checkpoints for this branch, sorted newest first
      const branchCheckpoints = Object.freeze(
        history.checkpoints
          .filter((cp) => cp.sourceBranchId === activeBranchId)
          .sort((a, b) => b.createdAt - a.createdAt),
      );

      // Publications on main
      const publications = Object.freeze(
        [...history.publications].sort((a, b) => b.ordinal - a.ordinal),
      );

      // Computable ahead of version info
      const aheadOfVersion = isMain ? null : computeAheadOfVersion(branchCommits, publications);

      // Working edits from session undo stack (this session only)
      const workingEdits = Object.freeze(
        this.session.undoStack.map((entry) => entry.label).reverse(),
      );

      this.updateState({
        status: 'ready',
        branch,
        isMain,
        workingEdits,
        checkpoints: branchCheckpoints,
        commits: branchCommits,
        publications,
        aheadOfVersion,
        lastError: null,
      });

      return history;
    } catch (err) {
      const failed = mapErrorToFailedResult(err);
      this.updateState({
        status: 'error',
        lastError: failed,
      });
      return null;
    }
  }

  // ==========================================================================
  // Checkpoint Action
  // ==========================================================================

  async saveCheckpoint(label: string): Promise<SaveCheckpointResult> {
    if (typeof label !== 'string') {
      throw new TypeError('saveCheckpoint requires a string label');
    }
    // Checkpoint label bound per contracts/storage.md §5 ("labels/title 1-80 code points"),
    // matching the repository's own history.checkpoint validation (repository.ts).
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > 80) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'too-long',
            'Checkpoint label must be between 1 and 80 code points',
            ['payload', 'label'],
          ),
        ],
      };
    }

    const sessionState = this.session.getState();
    if (
      !sessionState.projectId ||
      !sessionState.branchId ||
      sessionState.workingRevision === null
    ) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open in session', [])],
      };
    }

    const checkpointId = this.mintId();
    const command: HistoryCheckpointCommand = {
      commandId: 'history.checkpoint',
      operationId: this.mintId(),
      projectId: sessionState.projectId,
      branchId: sessionState.branchId,
      expectedWorkingRevision: sessionState.workingRevision,
      actor: this.actor,
      payload: {
        checkpointId,
        label: trimmed,
      },
    };

    try {
      const res = await this.repository.execute(command);
      if (res.status === 'applied') {
        await this.loadHistory();
      }
      return res;
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  // ==========================================================================
  // Restore Action
  // ==========================================================================

  async restore(targetId: string, label: string): Promise<RestoreResult> {
    if (typeof label !== 'string') {
      throw new TypeError('restore requires a string label for the pre-restore checkpoint');
    }
    // Pre-restore checkpoint label bound identically to saveCheckpoint (contracts/storage.md
    // §5 "labels/title 1-80 code points"); never invented — the caller must supply it
    // (commands.md history.restore payload {snapshotId, checkpointId, label}).
    const trimmedLabel = label.trim();
    if (trimmedLabel.length < 1 || trimmedLabel.length > 80) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'too-long',
            'Pre-restore checkpoint label must be between 1 and 80 code points',
            ['payload', 'label'],
          ),
        ],
      };
    }

    const sessionState = this.session.getState();
    if (
      !sessionState.projectId ||
      !sessionState.branchId ||
      sessionState.workingRevision === null
    ) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open in session', [])],
      };
    }

    // Direct restore on main is rejected (transactions.md §4)
    if (this.state.isMain) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Direct restore on main branch is rejected; main is changed only by publication',
            ['branchId'],
          ),
        ],
      };
    }

    // Resolve snapshotId: targetId can be a checkpointId or snapshotId
    let snapshotId = targetId;
    const checkpoint = this.state.checkpoints.find((c) => c.id === targetId);
    if (checkpoint) {
      snapshotId = checkpoint.snapshotId;
    } else if (this.currentHistory) {
      const anyCheckpoint = this.currentHistory.checkpoints.find((c) => c.id === targetId);
      if (anyCheckpoint) {
        snapshotId = anyCheckpoint.snapshotId;
      }
    }

    // Contract: Checkpoints current work first, then replaces it in the same transaction
    const checkpointId = this.mintId();

    const command: HistoryRestoreCommand = {
      commandId: 'history.restore',
      operationId: this.mintId(),
      projectId: sessionState.projectId,
      branchId: sessionState.branchId,
      expectedWorkingRevision: sessionState.workingRevision,
      actor: this.actor,
      payload: {
        snapshotId,
        checkpointId,
        label: trimmedLabel,
      },
    };

    try {
      const res = await this.repository.execute(command);
      if (res.status === 'applied') {
        // Adopt restored Document and reload workingRevision in session
        await this.session.openProject(sessionState.projectId, sessionState.branchId);
        // Reload history to reflect the pre-restore checkpoint
        await this.loadHistory();
      }
      return res;
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  // ==========================================================================
  // Commit Action
  // ==========================================================================

  async commit(message: string, options?: CommitActionOptions): Promise<CommitResult> {
    const sessionState = this.session.getState();
    if (
      !sessionState.projectId ||
      !sessionState.branchId ||
      sessionState.workingRevision === null ||
      !sessionState.document
    ) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open in session', [])],
      };
    }

    // D40: Main never holds unpublished edits
    if (this.state.isMain) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Direct commit on main branch is rejected; main never holds edits (D40)',
            ['branchId'],
          ),
        ],
      };
    }

    if (typeof message !== 'string') {
      throw new TypeError('commit requires a string message');
    }
    // Commit message bound per contracts/storage.md §5 (rationale/message 0-4000 code
    // points) with a required minimum of 1, matching the repository's own
    // history.commit validation (repository.ts).
    const trimmedMsg = message.trim();
    if (trimmedMsg.length < 1 || trimmedMsg.length > 4000) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'missing-property',
            'Commit message is required and must be between 1 and 4000 code points',
            ['message'],
          ),
        ],
      };
    }

    const doc = sessionState.document;
    if (doc.scenarios.length === 0) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            'Commit requires at least one passing scenario (document has 0 scenarios)',
            ['scenarios'],
          ),
        ],
        ineligibleScenarios: [],
      };
    }

    // 1. Evaluate scenario statuses on the current working version
    const statusResult = await loadScenarioStatuses(
      this.repository,
      sessionState.projectId,
      doc,
    );

    const nonPassing = statusResult.scenarios.filter((s) => s.status.kind !== 'passed');
    if (nonPassing.length > 0) {
      const ineligibleScenarios = nonPassing.map((s) => ({
        scenarioId: s.scenario.id,
        label: s.scenario.label,
        status: s.status,
      }));

      const issues = nonPassing.map((s) =>
        createIssue(
          'structural-rule',
          `Scenario "${s.scenario.label}" (${s.scenario.id}) does not qualify: ${formatScenarioStatusReason(s.status)}`,
          ['scenarios', s.scenario.id],
          s.scenario.id,
        ),
      );

      return {
        status: 'failed',
        code: 'ineligible',
        issues,
        ineligibleScenarios,
      };
    }

    // 2. Build evidence refs from latest qualifying saved run per scenario for current fingerprint
    const evidence: EvidenceRef[] = [];
    for (const scenarioWithStatus of statusResult.scenarios) {
      const { scenario, currentFingerprint } = scenarioWithStatus;
      if (!currentFingerprint) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Scenario "${scenario.label}" does not have a valid current fingerprint`,
              ['scenarios', scenario.id],
              scenario.id,
            ),
          ],
          ineligibleScenarios: [
            {
              scenarioId: scenario.id,
              label: scenario.label,
              status: scenarioWithStatus.status,
            },
          ],
        };
      }

      // Query saved runs for this fingerprint and find latest qualifying run
      const runs = await this.repository.runsByFingerprint(
        sessionState.projectId,
        currentFingerprint,
      );
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
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Scenario "${scenario.label}" has no qualifying run for fingerprint ${currentFingerprint}`,
              ['scenarios', scenario.id],
              scenario.id,
            ),
          ],
          ineligibleScenarios: [
            {
              scenarioId: scenario.id,
              label: scenario.label,
              status: scenarioWithStatus.status,
            },
          ],
        };
      }

      evidence.push({
        scenarioId: scenario.id,
        fingerprint: currentFingerprint,
        runId: sorted[0].id,
      });
    }

    // 3. Expected head ID (from options or current branch head)
    let expectedHeadId = options?.expectedHeadId;
    if (expectedHeadId === undefined) {
      const branch = await this.repository.loadBranch(
        sessionState.projectId,
        sessionState.branchId,
      );
      expectedHeadId = branch?.headCommitId ?? null;
    }

    const expectedWorkingRevision =
      options?.expectedWorkingRevision !== undefined
        ? options.expectedWorkingRevision
        : sessionState.workingRevision;

    const command: HistoryCommitCommand = {
      commandId: 'history.commit',
      operationId: this.mintId(),
      projectId: sessionState.projectId,
      branchId: sessionState.branchId,
      expectedWorkingRevision,
      actor: this.actor,
      payload: {
        commitId: this.mintId(),
        expectedHeadId,
        message: trimmedMsg,
        evidence: Object.freeze(evidence),
      },
    };

    try {
      const res = await this.repository.execute(command);
      if (res.status === 'applied') {
        // Reload session to adopt new head snapshot & reset undo stack
        await this.session.openProject(sessionState.projectId, sessionState.branchId);
        // Reload history to update ladder commits
        await this.loadHistory();
      }
      return res;
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  // ==========================================================================
  // Commit Preview (CommitPanel's public data surface)
  // ==========================================================================

  /**
   * Everything CommitPanel needs to render: the working document, its diff base
   * (branch head snapshot, or the project's initial snapshot if the branch has
   * no commits yet), the resulting CHANGES list, and per-scenario status for
   * the scenario gate. CommitPanel calls this instead of reaching into the
   * controller's private session/repository.
   */
  async loadCommitPreview(): Promise<CommitPreview> {
    const sessionState = this.session.getState();
    const workingDocument = sessionState.document ?? null;

    if (!sessionState.projectId || !workingDocument) {
      return {
        workingDocument,
        baseDocument: null,
        changes: Object.freeze([]),
        scenarios: Object.freeze([]),
      };
    }

    let baseDocument: Document | null = null;
    try {
      const branch = sessionState.branchId
        ? await this.repository.loadBranch(sessionState.projectId, sessionState.branchId)
        : null;
      if (branch?.headCommitId) {
        const headCommit = await this.repository.loadCommit(
          sessionState.projectId,
          branch.headCommitId,
        );
        if (headCommit) {
          const headSnap = await this.repository.loadSnapshot(
            sessionState.projectId,
            headCommit.snapshotId,
          );
          baseDocument = headSnap?.document ?? null;
        }
      } else {
        const project = await this.repository.loadProject(sessionState.projectId);
        if (project?.initialSnapshotId) {
          const initSnap = await this.repository.loadSnapshot(
            sessionState.projectId,
            project.initialSnapshotId,
          );
          baseDocument = initSnap?.document ?? null;
        }
      }
    } catch {
      baseDocument = null;
    }

    const changes = computeChangesList(baseDocument, workingDocument);

    let scenarios: readonly ScenarioWithStatus[] = Object.freeze([]);
    try {
      const statusResult = await loadScenarioStatuses(
        this.repository,
        sessionState.projectId,
        workingDocument,
      );
      scenarios = statusResult.scenarios;
    } catch {
      scenarios = Object.freeze([]);
    }

    return { workingDocument, baseDocument, changes, scenarios };
  }

  // ==========================================================================
  // Commit Diff Calculation
  // ==========================================================================

  async getCommitDiffSummary(commitId: Id): Promise<string | null> {
    if (this.commitDiffCache.has(commitId)) {
      return this.commitDiffCache.get(commitId)!;
    }

    const commit = this.state.commits.find((c) => c.id === commitId);
    if (!commit || commit.parentIds.length !== 1 || !this.lastSyncedProjectId) {
      this.commitDiffCache.set(commitId, null);
      return null;
    }

    const parentCommit = this.state.commits.find((c) => c.id === commit.parentIds[0]);
    if (!parentCommit) {
      this.commitDiffCache.set(commitId, null);
      return null;
    }

    try {
      const [parentSnap, commitSnap] = await Promise.all([
        this.repository.loadSnapshot(this.lastSyncedProjectId, parentCommit.snapshotId),
        this.repository.loadSnapshot(this.lastSyncedProjectId, commit.snapshotId),
      ]);

      if (!parentSnap || !commitSnap) {
        this.commitDiffCache.set(commitId, null);
        return null;
      }

      const summary = computeFieldsChanged(parentSnap.document, commitSnap.document);
      this.commitDiffCache.set(commitId, summary);
      return summary;
    } catch {
      this.commitDiffCache.set(commitId, null);
      return null;
    }
  }
}

/**
 * The public surface HistoryLadder and CommitPanel depend on. A `Pick` of the
 * controller's own members so the workspace can hand them a facade whose
 * actions execute the registry's history commands (RV-03s).
 */
export type HistoryControllerLike = Pick<
  HistoryController,
  | 'getState'
  | 'subscribe'
  | 'saveCheckpoint'
  | 'restore'
  | 'commit'
  | 'loadCommitPreview'
  | 'getCommitDiffSummary'
>;

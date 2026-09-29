/**
 * SessionController implementation for System Studio (RV-12c1).
 *
 * Implements specifications from:
 * - specs/revamp/decisions.md (D37)
 * - specs/revamp/contracts/transactions.md §1–§3
 * - specs/revamp/contracts/commands.md §1–§4
 * - specs/revamp/contracts/storage.md §5 & session undo bullet
 */

import type { Document, Id, View } from '../../domain/studio/model';
import {
  createIssue,
  mapErrorToFailedResult,
  type Actor,
  type AuthoredResult,
  type BranchCreateCommand,
  type BranchReopenCommand,
  type BranchRecord,
  type MissingResult,
  type ModelApplyRecordsCommand,
  type ProjectCreateCommand,
  type ProjectRenameCommand,
  type RecordChange,
  type SnapshotRecord,
  type StudioRepository,
  type PartCaptureCommand,
  type PartImportCommand,
  type UnsupportedResult,
} from '../../persistence/studio';
import { computeInverseChanges } from './inverse';
import type {
  CreateProjectParams,
  CreateProjectResult,
  OpenProjectResult,
  SessionApplyResult,
  BusyResult,
  SessionControllerOptions,
  SessionRedoResult,
  SessionRenameResult,
  SessionState,
  SessionUndoResult,
  UndoEntry,
} from './types';

const INITIAL_SESSION_STATE: SessionState = Object.freeze({
  status: 'empty',
  projectId: null,
  branchId: null,
  mainBranchId: null,
  projectRevision: null,
  workingRevision: null,
  workingSnapshotId: null,
  document: null,
  canUndo: false,
  canRedo: false,
  lastError: null,
  needsReload: false,
});

const MAX_UNDO_STACK_SIZE = 100;

export class SessionController {
  private readonly repository: StudioRepository;
  private readonly mintId: () => Id;
  private readonly actor: Actor;

  private state: SessionState = INITIAL_SESSION_STATE;
  private isInFlight = false;

  private readonly undoStackInternal: UndoEntry[] = [];
  private readonly redoStackInternal: UndoEntry[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(options: SessionControllerOptions) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('SessionController requires options object');
    }
    if (!options.repository) {
      throw new TypeError('SessionController requires repository');
    }
    if (typeof options.mintId !== 'function') {
      throw new TypeError('SessionController requires mintId function');
    }
    if (!options.actor || options.actor.kind !== 'local-human') {
      throw new TypeError('SessionController requires valid Actor');
    }

    this.repository = options.repository;
    this.mintId = options.mintId;
    this.actor = options.actor;

    this.getState = this.getState.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  /**
   * Returns current immutable session state snapshot.
   * Identity is stable until something changes.
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * Subscribes a listener to session state changes (suitable for useSyncExternalStore).
   * Notifies once per state change.
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Read-only view of current session undo stack (oldest to newest).
   */
  get undoStack(): readonly UndoEntry[] {
    return Object.freeze([...this.undoStackInternal]);
  }

  /**
   * Read-only view of current session redo stack (oldest to newest).
   */
  get redoStack(): readonly UndoEntry[] {
    return Object.freeze([...this.redoStackInternal]);
  }

  /**
   * Loads branch row and working snapshot as a consistent pair.
   */
  private async reloadBranchAndSnapshot(
    projectId: Id,
    branchId: Id,
  ): Promise<
    | { readonly ok: true; readonly branch: BranchRecord; readonly snapshot: SnapshotRecord }
    | { readonly ok: false; readonly missing: MissingResult }
  > {
    const branch = await this.repository.loadBranch(projectId, branchId);
    if (!branch) {
      return { ok: false, missing: { status: 'missing', ids: [branchId] } };
    }
    const snapshot = await this.repository.loadSnapshot(projectId, branch.workingSnapshotId);
    if (!snapshot) {
      return { ok: false, missing: { status: 'missing', ids: [branch.workingSnapshotId] } };
    }
    return { ok: true, branch, snapshot };
  }

  /**
   * Creates a new project via project.create (Bootstrap envelope) and opens its draft branch.
   */
  async createProject(params: CreateProjectParams): Promise<CreateProjectResult> {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }

    if (!params || !params.initialDocument) {
      throw new TypeError('createProject requires initialDocument');
    }

    const newProjectId = this.mintId();
    const mainBranchId = this.mintId();
    const draftBranchId = this.mintId();
    const operationId = this.mintId();

    // D43(a): a blank project (no views yet) is created with one empty view
    // labelled "Main" so components can be placed immediately -- a caller
    // that starts from a template (S01-S05) already supplies its own views
    // and is left untouched. The id comes from this session's own mintId,
    // never a client-invented default.
    const initialDocument: Document =
      params.initialDocument.views.length === 0
        ? {
            ...params.initialDocument,
            views: [
              {
                id: this.mintId(),
                label: 'Main',
                placements: [],
                connectionIds: [],
                relationIds: [],
                groups: [],
                notes: [],
              } satisfies View,
            ],
          }
        : params.initialDocument;

    const command: ProjectCreateCommand = {
      commandId: 'project.create',
      operationId,
      actor: this.actor,
      payload: {
        newProjectId,
        title: params.title,
        initialDocument,
        mainBranchId,
        draftBranchId,
      },
    };

    this.isInFlight = true;
    this.updateState({ status: 'saving' });

    try {
      const res = await this.repository.execute(command);
      if (res.status === 'applied') {
        if (res.branchRevision === null) {
          throw new Error('Contract violation: Bootstrap command returned applied with null branchRevision');
        }

        const reloaded = await this.reloadBranchAndSnapshot(newProjectId, draftBranchId);
        if (!reloaded.ok) {
          this.updateState({
            status: 'ready',
            projectId: newProjectId,
            branchId: draftBranchId,
            lastError: reloaded.missing,
            needsReload: true,
          });
          return reloaded.missing;
        }

        this.undoStackInternal.length = 0;
        this.redoStackInternal.length = 0;

        this.updateState({
          status: 'ready',
          projectId: newProjectId,
          branchId: draftBranchId,
          mainBranchId,
          projectRevision: res.projectRevision,
          workingRevision: reloaded.branch.workingRevision,
          workingSnapshotId: reloaded.branch.workingSnapshotId,
          document: reloaded.snapshot.document,
          canUndo: false,
          canRedo: false,
          lastError: null,
          needsReload: false,
        });

        return res;
      }

      this.updateState({
        status: this.state.projectId ? 'ready' : 'empty',
        lastError: res,
      });
      return res;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Contract violation:')) {
        throw err;
      }
      const failed = mapErrorToFailedResult(err);
      this.updateState({
        status: this.state.projectId ? 'ready' : 'empty',
        lastError: failed,
      });
      return failed;
    } finally {
      this.isInFlight = false;
    }
  }

  /**
   * Opens an existing project and branch (null = main branch).
   * Loads project + branch + working Document. Stacks are cleared on branch open.
   */
  async openProject(projectId: Id, branchId: Id | null): Promise<OpenProjectResult> {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }

    this.isInFlight = true;
    this.updateState({ status: 'loading' });

    try {
      const project = await this.repository.loadProject(projectId);
      if (!project) {
        const missing: MissingResult = { status: 'missing', ids: [projectId] };
        this.updateState({
          status: this.state.projectId ? 'ready' : 'empty',
          lastError: missing,
        });
        return missing;
      }

      const targetBranchId = branchId ?? project.mainBranchId;
      const branch = await this.repository.loadBranch(projectId, targetBranchId);
      if (!branch) {
        const missing: MissingResult = { status: 'missing', ids: [targetBranchId] };
        this.updateState({
          status: this.state.projectId ? 'ready' : 'empty',
          lastError: missing,
        });
        return missing;
      }

      const snapshot = await this.repository.loadSnapshot(projectId, branch.workingSnapshotId);
      if (!snapshot) {
        const missing: MissingResult = { status: 'missing', ids: [branch.workingSnapshotId] };
        this.updateState({
          status: this.state.projectId ? 'ready' : 'empty',
          lastError: missing,
        });
        return missing;
      }

      this.undoStackInternal.length = 0;
      this.redoStackInternal.length = 0;

      this.updateState({
        status: 'ready',
        projectId: project.id,
        branchId: branch.id,
        mainBranchId: project.mainBranchId,
        projectRevision: project.revision,
        workingRevision: branch.workingRevision,
        workingSnapshotId: branch.workingSnapshotId,
        document: snapshot.document,
        canUndo: false,
        canRedo: false,
        lastError: null,
        needsReload: false,
      });

      return {
        status: 'ready',
        projectId: project.id,
        branchId: branch.id,
        projectRevision: project.revision,
        workingRevision: branch.workingRevision,
        document: snapshot.document,
      };
    } catch (err) {
      const failed = mapErrorToFailedResult(err);
      this.updateState({
        status: this.state.projectId ? 'ready' : 'empty',
        lastError: failed,
      });
      return failed;
    } finally {
      this.isInFlight = false;
    }
  }

  /**
   * Convenience helper to switch branches within the currently open project.
   */
  async switchBranch(branchId: Id): Promise<OpenProjectResult> {
    if (!this.state.projectId) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open', [])],
      };
    }
    return this.openProject(this.state.projectId, branchId);
  }

  /**
   * Creates a branch from the current autosaved working copy or its head, then
   * opens it. The repository checks both the live working revision and head
   * supplied here, so an interleaving edit or publication can't be copied
   * silently.
   */
  async createBranch(
    label: string,
    source: 'working' | 'head',
  ): Promise<AuthoredResult | BusyResult | UnsupportedResult | OpenProjectResult> {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }
    const state = this.state;
    if (!state.projectId || !state.branchId || state.workingRevision === null) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project branch is open in session', [])],
      };
    }

    const projectId = state.projectId;
    const sourceBranchId = state.branchId;
    const newBranchId = this.mintId();
    const command: BranchCreateCommand = {
      commandId: 'branch.create',
      operationId: this.mintId(),
      projectId,
      branchId: sourceBranchId,
      expectedWorkingRevision: state.workingRevision,
      actor: this.actor,
      payload: {
        newBranchId,
        label,
        source,
        expectedHeadId: null,
      },
    };

    this.isInFlight = true;
    this.updateState({ status: 'saving' });
    let result: AuthoredResult | UnsupportedResult;
    try {
      const sourceBranch = await this.repository.loadBranch(projectId, sourceBranchId);
      if (!sourceBranch) {
        result = { status: 'missing', ids: [sourceBranchId] };
      } else {
        // Use the head read with the source branch. The working revision in the
        // session is still the CAS token for the autosaved working snapshot.
        const commandWithHead: BranchCreateCommand = {
          ...command,
          payload: { ...command.payload, expectedHeadId: sourceBranch.headCommitId },
        };
        result = await this.repository.execute(commandWithHead);
      }
    } catch (err) {
      result = mapErrorToFailedResult(err);
    } finally {
      this.isInFlight = false;
    }

    if (result.status !== 'applied') {
      this.updateState({
        status: state.projectId ? 'ready' : 'empty',
        lastError: result,
      });
      return result;
    }

    this.updateState({ status: 'ready', projectRevision: result.projectRevision, lastError: null });
    const opened = await this.openProject(projectId, newBranchId);
    return opened.status === 'ready' ? result : opened;
  }

  /**
   * Reopens a closed non-main branch with its current persisted head/revision,
   * then switches to it. Reopening changes branch state only; it never rewinds
   * or edits its work/history.
   */
  async reopenBranch(
    branchId: Id,
  ): Promise<AuthoredResult | BusyResult | UnsupportedResult | OpenProjectResult> {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }
    const projectId = this.state.projectId;
    if (!projectId) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open in session', [])],
      };
    }

    this.isInFlight = true;
    this.updateState({ status: 'saving' });
    let result: AuthoredResult | UnsupportedResult;
    try {
      const project = await this.repository.loadProject(projectId);
      const branch = await this.repository.loadBranch(projectId, branchId);
      if (!project || !branch) {
        result = { status: 'missing', ids: [!project ? projectId : branchId] };
      } else {
        const command: BranchReopenCommand = {
          commandId: 'branch.reopen',
          operationId: this.mintId(),
          projectId,
          branchId,
          expectedWorkingRevision: branch.workingRevision,
          actor: this.actor,
          payload: { expectedHeadId: branch.headCommitId },
        };
        result = await this.repository.execute(command);
      }
    } catch (err) {
      result = mapErrorToFailedResult(err);
    } finally {
      this.isInFlight = false;
    }

    if (result.status !== 'applied') {
      this.updateState({ status: 'ready', lastError: result });
      return result;
    }

    this.updateState({ status: 'ready', projectRevision: result.projectRevision, lastError: null });
    const opened = await this.openProject(projectId, branchId);
    return opened.status === 'ready' ? result : opened;
  }

  /**
   * Renames the project and reloads the active branch Document and revision via repository.
   */
  async renameProject(title: string): Promise<SessionRenameResult> {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }

    if (this.state.needsReload) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'Session requires reload before renaming project', [])],
      };
    }

    if (
      this.state.status !== 'ready' ||
      !this.state.projectId ||
      !this.state.branchId ||
      this.state.workingRevision === null ||
      this.state.projectRevision === null ||
      !this.state.document
    ) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'No project is open to rename', [])],
      };
    }

    const command: ProjectRenameCommand = {
      commandId: 'project.rename',
      operationId: this.mintId(),
      projectId: this.state.projectId,
      branchId: this.state.branchId,
      expectedWorkingRevision: this.state.workingRevision,
      expectedProjectRevision: this.state.projectRevision,
      actor: this.actor,
      payload: {
        title,
        expectedProjectRevision: this.state.projectRevision,
      },
    };

    this.isInFlight = true;
    this.updateState({ status: 'saving' });

    try {
      const res = await this.repository.execute(command);
      if (res.status === 'applied') {
        const reloaded = await this.reloadBranchAndSnapshot(
          this.state.projectId,
          this.state.branchId,
        );
        if (!reloaded.ok) {
          this.updateState({
            status: 'ready',
            lastError: reloaded.missing,
            needsReload: true,
          });
          return reloaded.missing;
        }

        this.updateState({
          status: 'ready',
          projectRevision: res.projectRevision,
          workingRevision: reloaded.branch.workingRevision,
          workingSnapshotId: reloaded.branch.workingSnapshotId,
          document: reloaded.snapshot.document,
          lastError: null,
          needsReload: false,
        });

        return res;
      }

      this.updateState({
        status: 'ready',
        lastError: res,
      });
      return res;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Contract violation:')) {
        throw err;
      }
      const failed = mapErrorToFailedResult(err);
      this.updateState({
        status: 'ready',
        lastError: failed,
      });
      return failed;
    } finally {
      this.isInFlight = false;
    }
  }

  /** Part artifacts advance project revision without changing content or undo history. */
  async savePart(command: PartCaptureCommand | PartImportCommand): Promise<SessionApplyResult> {
    if (this.isInFlight) return { status: 'busy', message: 'An operation is currently in flight' };
    if (this.state.status !== 'ready' || this.state.needsReload || command.projectId !== this.state.projectId) {
      return { status: 'invalid', issues: [createIssue('structural-rule', 'Open the source project before saving a part.', [])] };
    }
    if (command.commandId === 'part.capture' && command.branchId !== this.state.branchId) {
      return { status: 'invalid', issues: [createIssue('structural-rule', 'The source branch changed. Review the selection again.', [])] };
    }
    this.isInFlight = true;
    this.updateState({ status: 'saving' });
    try {
      const result = await this.repository.execute(command);
      this.updateState(result.status === 'applied'
        ? { status: 'ready', projectRevision: result.projectRevision, lastError: null }
        : { status: 'ready', lastError: result });
      return result;
    } catch (error) {
      const result = mapErrorToFailedResult(error);
      this.updateState({ status: 'ready', lastError: result });
      return result;
    } finally { this.isInFlight = false; }
  }

  /**
   * D40: the first authored edit on main creates a draft branch from main's
   * working content (branch.create, source:'working') and switches the
   * session to it, before the edit itself is applied. Branch creation is not
   * undoable (like other branch history) — only the edit gets an undo entry.
   *
   * CONTRACT GAP: decisions.md D40 names the label "Draft from main" but is
   * silent on collisions with an existing branch label. Narrowest reading:
   * append " 2", " 3", … (first free suffix), checked against every branch
   * on the project (open and closed) via loadHistory.
   */
  private async autoDraftFromMainIfNeeded(): Promise<
    { readonly ok: true } | { readonly ok: false; readonly error: SessionApplyResult }
  > {
    if (
      !this.state.projectId ||
      !this.state.branchId ||
      this.state.mainBranchId === null ||
      this.state.branchId !== this.state.mainBranchId ||
      this.state.workingRevision === null
    ) {
      return { ok: true };
    }

    const projectId = this.state.projectId;
    const mainBranchId = this.state.branchId;

    let history;
    try {
      history = await this.repository.loadHistory(projectId);
    } catch (err) {
      const failed = mapErrorToFailedResult(err);
      return { ok: false, error: failed };
    }

    const mainBranch = history.branches.find((b) => b.id === mainBranchId);
    if (!mainBranch) {
      return { ok: false, error: { status: 'missing', ids: [mainBranchId] } };
    }

    const existingLabels = new Set(history.branches.map((b) => b.label));
    let label = 'Draft from main';
    let suffix = 2;
    while (existingLabels.has(label)) {
      label = `Draft from main ${suffix}`;
      suffix += 1;
    }

    const newBranchId = this.mintId();
    const command: BranchCreateCommand = {
      commandId: 'branch.create',
      operationId: this.mintId(),
      projectId,
      branchId: mainBranchId,
      expectedWorkingRevision: this.state.workingRevision,
      actor: this.actor,
      payload: {
        newBranchId,
        label,
        source: 'working',
        expectedHeadId: mainBranch.headCommitId,
      },
    };

    let res;
    try {
      res = await this.repository.execute(command);
    } catch (err) {
      const failed = mapErrorToFailedResult(err);
      return { ok: false, error: failed };
    }

    if (res.status !== 'applied') {
      return { ok: false, error: res };
    }

    const reloaded = await this.reloadBranchAndSnapshot(projectId, newBranchId);
    if (!reloaded.ok) {
      this.updateState({
        status: 'ready',
        lastError: reloaded.missing,
        needsReload: true,
      });
      return { ok: false, error: reloaded.missing };
    }

    // Branch creation itself isn't undoable; the stacks stay empty so the
    // edit that follows becomes the first (and only) undo entry.
    this.undoStackInternal.length = 0;
    this.redoStackInternal.length = 0;

    this.updateState({
      status: 'ready',
      branchId: newBranchId,
      projectRevision: res.projectRevision,
      workingRevision: reloaded.branch.workingRevision,
      workingSnapshotId: reloaded.branch.workingSnapshotId,
      document: reloaded.snapshot.document,
      canUndo: false,
      canRedo: false,
      lastError: null,
      needsReload: false,
    });

    return { ok: true };
  }

  /**
   * Applies authored RecordChanges via model.apply-records.
   * On applied: adopts returned revision and new Document, pushes one undo entry, clears redo.
   * On invalid/stale/failed: state unchanged, typed result returned.
   *
   * D40: if the active branch is main, this first creates and switches to a
   * draft branch (see `autoDraftFromMainIfNeeded`) before applying the edit,
   * so main never ends up holding unpublished edits.
   */
  async apply(changes: readonly RecordChange[], label: string): Promise<SessionApplyResult> {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }

    if (this.state.needsReload) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'Session requires reload before applying changes', [])],
      };
    }

    if (
      this.state.status !== 'ready' ||
      !this.state.projectId ||
      !this.state.branchId ||
      this.state.workingRevision === null ||
      !this.state.document
    ) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'Cannot apply changes: no project is open', [])],
      };
    }

    this.isInFlight = true;
    this.updateState({ status: 'saving' });

    try {
      if (this.state.branchId === this.state.mainBranchId) {
        const drafted = await this.autoDraftFromMainIfNeeded();
        if (!drafted.ok) {
          this.updateState({ status: 'ready', lastError: drafted.error });
          return drafted.error;
        }
      }

      // Re-read state: autoDraftFromMainIfNeeded may have switched branchId,
      // workingRevision and document to the new draft.
      if (
        !this.state.projectId ||
        !this.state.branchId ||
        this.state.workingRevision === null ||
        !this.state.document
      ) {
        return {
          status: 'invalid',
          issues: [createIssue('structural-rule', 'Cannot apply changes: no project is open', [])],
        };
      }

      // Compute inverse changes from pre-apply Document before mutation
      const inverseRes = computeInverseChanges(this.state.document, changes);
      if (!inverseRes.ok) {
        this.updateState({ status: 'ready' });
        return {
          status: 'invalid',
          issues: inverseRes.issues,
        };
      }
      const inverseChanges = inverseRes.changes;
      const forwardChanges = [...changes];

      const command: ModelApplyRecordsCommand = {
        commandId: 'model.apply-records',
        operationId: this.mintId(),
        projectId: this.state.projectId,
        branchId: this.state.branchId,
        expectedWorkingRevision: this.state.workingRevision,
        actor: this.actor,
        payload: {
          changes,
        },
      };

      const res = await this.repository.execute(command);
      if (res.status === 'applied') {
        if (res.branchRevision === null) {
          throw new Error('Contract violation: Branch command returned applied with null branchRevision');
        }

        const reloaded = await this.reloadBranchAndSnapshot(
          this.state.projectId,
          this.state.branchId,
        );
        if (!reloaded.ok) {
          this.updateState({
            status: 'ready',
            lastError: reloaded.missing,
            needsReload: true,
          });
          return reloaded.missing;
        }

        const undoEntry: UndoEntry = {
          label,
          inverseChanges,
          forwardChanges,
        };

        this.undoStackInternal.push(undoEntry);
        if (this.undoStackInternal.length > MAX_UNDO_STACK_SIZE) {
          this.undoStackInternal.shift();
        }
        this.redoStackInternal.length = 0; // new apply clears redo

        this.updateState({
          status: 'ready',
          projectRevision: res.projectRevision,
          workingRevision: reloaded.branch.workingRevision,
          workingSnapshotId: reloaded.branch.workingSnapshotId,
          document: reloaded.snapshot.document,
          canUndo: this.undoStackInternal.length > 0,
          canRedo: false,
          lastError: null,
          needsReload: false,
        });

        return res;
      }

      // On invalid/stale/failed, state unchanged and typed result returned
      this.updateState({
        status: 'ready',
        lastError: res,
      });
      return res;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Contract violation:')) {
        throw err;
      }
      const failed = mapErrorToFailedResult(err);
      this.updateState({
        status: 'ready',
        lastError: failed,
      });
      return failed;
    } finally {
      this.isInFlight = false;
    }
  }

  /**
   * Undoes the last accepted edit by issuing inverse changes as a NEW apply-records command.
   * On success: moves entry to redo stack and adopts new Document and incremented revision.
   * On stale/failed: state and stacks unchanged.
   */
  async undo(): Promise<SessionUndoResult> {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }

    if (this.state.needsReload) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'Session requires reload before undo', [])],
      };
    }

    if (
      this.state.status !== 'ready' ||
      !this.state.projectId ||
      !this.state.branchId ||
      this.state.workingRevision === null ||
      !this.state.document
    ) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'Cannot undo: no project is open', [])],
      };
    }

    if (this.undoStackInternal.length === 0) {
      return { status: 'empty', message: 'Nothing to undo' };
    }

    const entry = this.undoStackInternal[this.undoStackInternal.length - 1];

    const command: ModelApplyRecordsCommand = {
      commandId: 'model.apply-records',
      operationId: this.mintId(),
      projectId: this.state.projectId,
      branchId: this.state.branchId,
      expectedWorkingRevision: this.state.workingRevision,
      actor: this.actor,
      payload: {
        changes: entry.inverseChanges,
      },
    };

    this.isInFlight = true;
    this.updateState({ status: 'saving' });

    try {
      const res = await this.repository.execute(command);
      if (res.status === 'applied') {
        if (res.branchRevision === null) {
          throw new Error('Contract violation: Branch command returned applied with null branchRevision');
        }

        const reloaded = await this.reloadBranchAndSnapshot(
          this.state.projectId,
          this.state.branchId,
        );
        if (!reloaded.ok) {
          this.updateState({
            status: 'ready',
            lastError: reloaded.missing,
            needsReload: true,
          });
          return reloaded.missing;
        }

        this.undoStackInternal.pop();
        this.redoStackInternal.push(entry);
        if (this.redoStackInternal.length > MAX_UNDO_STACK_SIZE) {
          this.redoStackInternal.shift();
        }

        this.updateState({
          status: 'ready',
          projectRevision: res.projectRevision,
          workingRevision: reloaded.branch.workingRevision,
          workingSnapshotId: reloaded.branch.workingSnapshotId,
          document: reloaded.snapshot.document,
          canUndo: this.undoStackInternal.length > 0,
          canRedo: this.redoStackInternal.length > 0,
          lastError: null,
          needsReload: false,
        });

        return res;
      }

      this.updateState({
        status: 'ready',
        lastError: res,
      });
      return res;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Contract violation:')) {
        throw err;
      }
      const failed = mapErrorToFailedResult(err);
      this.updateState({
        status: 'ready',
        lastError: failed,
      });
      return failed;
    } finally {
      this.isInFlight = false;
    }
  }

  /**
   * Redoes the last undone edit by issuing forward changes as a NEW apply-records command.
   * On success: moves entry to undo stack and adopts new Document and incremented revision.
   * On stale/failed: state and stacks unchanged.
   */
  async redo(): Promise<SessionRedoResult> {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }

    if (this.state.needsReload) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'Session requires reload before redo', [])],
      };
    }

    if (
      this.state.status !== 'ready' ||
      !this.state.projectId ||
      !this.state.branchId ||
      this.state.workingRevision === null ||
      !this.state.document
    ) {
      return {
        status: 'invalid',
        issues: [createIssue('structural-rule', 'Cannot redo: no project is open', [])],
      };
    }

    if (this.redoStackInternal.length === 0) {
      return { status: 'empty', message: 'Nothing to redo' };
    }

    const entry = this.redoStackInternal[this.redoStackInternal.length - 1];

    const command: ModelApplyRecordsCommand = {
      commandId: 'model.apply-records',
      operationId: this.mintId(),
      projectId: this.state.projectId,
      branchId: this.state.branchId,
      expectedWorkingRevision: this.state.workingRevision,
      actor: this.actor,
      payload: {
        changes: entry.forwardChanges,
      },
    };

    this.isInFlight = true;
    this.updateState({ status: 'saving' });

    try {
      const res = await this.repository.execute(command);
      if (res.status === 'applied') {
        if (res.branchRevision === null) {
          throw new Error('Contract violation: Branch command returned applied with null branchRevision');
        }

        const reloaded = await this.reloadBranchAndSnapshot(
          this.state.projectId,
          this.state.branchId,
        );
        if (!reloaded.ok) {
          this.updateState({
            status: 'ready',
            lastError: reloaded.missing,
            needsReload: true,
          });
          return reloaded.missing;
        }

        this.redoStackInternal.pop();
        this.undoStackInternal.push(entry);
        if (this.undoStackInternal.length > MAX_UNDO_STACK_SIZE) {
          this.undoStackInternal.shift();
        }

        this.updateState({
          status: 'ready',
          projectRevision: res.projectRevision,
          workingRevision: reloaded.branch.workingRevision,
          workingSnapshotId: reloaded.branch.workingSnapshotId,
          document: reloaded.snapshot.document,
          canUndo: this.undoStackInternal.length > 0,
          canRedo: this.redoStackInternal.length > 0,
          lastError: null,
          needsReload: false,
        });

        return res;
      }

      this.updateState({
        status: 'ready',
        lastError: res,
      });
      return res;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Contract violation:')) {
        throw err;
      }
      const failed = mapErrorToFailedResult(err);
      this.updateState({
        status: 'ready',
        lastError: failed,
      });
      return failed;
    } finally {
      this.isInFlight = false;
    }
  }

  /**
   * Internal helper to update state and notify subscribers if any field changed.
   */
  private updateState(partial: Partial<SessionState>): void {
    const nextState: SessionState = Object.freeze({
      ...this.state,
      ...partial,
    });

    let changed = false;
    for (const key of Object.keys(nextState) as (keyof SessionState)[]) {
      if (nextState[key] !== this.state[key]) {
        changed = true;
        break;
      }
    }

    if (!changed) return;

    this.state = nextState;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        // Prevent listener error from disrupting other listeners
        console.error('Error in SessionController listener:', e);
      }
    }
  }
}

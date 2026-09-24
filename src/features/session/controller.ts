/**
 * SessionController implementation for System Studio (RV-12c1).
 *
 * Implements specifications from:
 * - specs/revamp/decisions.md (D37)
 * - specs/revamp/contracts/transactions.md §1–§3
 * - specs/revamp/contracts/commands.md §1–§4
 * - specs/revamp/contracts/storage.md §5 & session undo bullet
 */

import type { Document, Id } from '../../domain/studio/model';
import {
  createIssue,
  mapErrorToFailedResult,
  type Actor,
  type BranchRecord,
  type MissingResult,
  type ModelApplyRecordsCommand,
  type ProjectCreateCommand,
  type ProjectRenameCommand,
  type RecordChange,
  type SnapshotRecord,
  type StudioRepository,
} from '../../persistence/studio';
import { computeInverseChanges } from './inverse';
import type {
  CreateProjectParams,
  CreateProjectResult,
  OpenProjectResult,
  SessionApplyResult,
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
  projectRevision: null,
  workingRevision: null,
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

    const command: ProjectCreateCommand = {
      commandId: 'project.create',
      operationId,
      actor: this.actor,
      payload: {
        newProjectId,
        title: params.title,
        initialDocument: params.initialDocument,
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
          projectRevision: res.projectRevision,
          workingRevision: reloaded.branch.workingRevision,
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
        projectRevision: project.revision,
        workingRevision: branch.workingRevision,
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

  /**
   * Applies authored RecordChanges via model.apply-records.
   * On applied: adopts returned revision and new Document, pushes one undo entry, clears redo.
   * On invalid/stale/failed: state unchanged, typed result returned.
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

    // Compute inverse changes from pre-apply Document before mutation
    const inverseRes = computeInverseChanges(this.state.document, changes);
    if (!inverseRes.ok) {
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

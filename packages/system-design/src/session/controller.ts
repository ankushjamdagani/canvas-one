import { LocalUndoHistory } from '@canvas-one/history';
declare const console: { error(...values: unknown[]): void };
import type { AgentActor, ProposalRequest } from '@canvas-one/agents';
/**
 * SessionController implementation for System Studio: the in-memory editing session
 * (open project and branch, working document, undo/redo) over the repository commands.
 */

import type { Document, Id, View } from '../studio/model.js';
import { createBoardRuntime, createExtensionHost, type BoardRuntime, type AtomicCommitResult, type TransactionIntent } from '@canvas-one/whiteboard';
import type { SystemRecordMap } from '../studio/records.js';
import { projectSystemDesignDocument } from '../projection.js';
import {canonicalJson} from '../studio/canonical.js';
import {CATALOG_ENTRIES} from '../catalog/catalog.js';
import { validateDocument, type Issue } from '../studio/validate.js';
import { applyRecordChanges } from '../authoring/apply-records.js';
import type { ProjectExposure } from '../studio/exposure.js';
import { createIssue } from '../studio/issue.js';
import {
  type Actor,
  type AuthoredResult,
  type BranchCreateCommand,
  type FailedResult,
  type InvalidResult,
  type BranchReopenCommand,
  type BranchRecord,
  type MissingResult,
  type ModelApplyRecordsCommand,
  type ProjectCreateCommand,
  type ProjectRenameCommand,
  type ProjectUpdateDetailsCommand,
  type RecordChange,
  type SnapshotRecord,
  type SessionRepository,
  type PartCaptureCommand,
  type PartImportCommand,
  type UnsupportedResult,
} from './contracts.js';
import { computeInverseChanges } from './inverse.js';
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
} from './types.js';

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


type OpenBranch = {
  readonly projectId: Id;
  readonly branchId: Id;
  readonly workingRevision: number;
  readonly projectRevision: number;
  readonly document: Document;
};

export class SessionController {
  private readonly repository: SessionRepository;
  private readonly mapErrorToFailedResult: SessionControllerOptions['mapError'];
  private readonly mintId: () => Id;
  private readonly actor: Actor;
  private readonly extensionHost = createExtensionHost();
  private disposed = false;

  private state: SessionState = INITIAL_SESSION_STATE;
  /** The facade only references this kernel's immutable authored snapshot. */
  private authoring: BoardRuntime<Document, SystemRecordMap> | null = null;
  private activeRecordCommand: {
    readonly command: ModelApplyRecordsCommand;
    result?: AuthoredResult | UnsupportedResult;
    loaded?: { readonly branch: BranchRecord; readonly snapshot: SnapshotRecord; readonly projectRevision: number };
    needsReload?: boolean;
  } | null = null;
  private isInFlight = false;

  private readonly localHistory = new LocalUndoHistory<RecordChange>();
  private readonly listeners = new Set<() => void>();

  constructor(options: SessionControllerOptions) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('SessionController requires options object');
    }
    if (!options.repository) {
      throw new TypeError('SessionController requires repository');
    }
    if (typeof options.mapError !== 'function') {
      throw new TypeError('SessionController requires backend error classification');
    }
    if (typeof options.mintId !== 'function') {
      throw new TypeError('SessionController requires mintId function');
    }
    if (!options.actor || options.actor.kind !== 'local-human') {
      throw new TypeError('SessionController requires valid Actor');
    }

    this.repository = options.repository;
    this.mapErrorToFailedResult = options.mapError;
    this.mintId = options.mintId;
    this.actor = options.actor;
    for (const definition of options.extensions ?? []) {
      if (definition.contributions.some(contribution => contribution.kind === 'component' && CATALOG_ENTRIES.some(entry => contribution.id === `system-design/${entry.entryId}`))) {
        this.extensionHost.dispose(); throw new TypeError('A custom component cannot replace a built-in semantic type; override its presentation separately');
      }
      const registration = this.extensionHost.register(definition);
      if (!registration.ok) { this.extensionHost.dispose(); throw new TypeError(registration.message); }
    }

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

  /** Pure candidate projection shared by proposal validation and host-selected previews. */
  previewChanges(changes: readonly RecordChange[]): ReturnType<typeof applyRecordChanges> {
    if (this.disposed || !this.state.document) return {ok: false, issues: [createIssue('structural-rule', 'Open a session before projecting changes')]};
    const candidate = applyRecordChanges(this.state.document, changes);
    if (!candidate.ok) return candidate;
    const issues = this.extensionHost.validateBoard(projectSystemDesignDocument(candidate.document)) as readonly Issue[];
    return issues.length ? {ok: false, issues} : candidate;
  }

  /** Bounded serializable schemas; executable validators and clients never leave this host. */
  discoverComponents() {
    return this.extensionHost.listContributions('component').slice(0, 32).map(({contribution}) => {
      const schemaContribution = this.extensionHost.getContribution('schema', contribution.id)?.contribution;
      const value = schemaContribution?.value ?? (contribution.value && typeof contribution.value === 'object' && 'schema' in contribution.value ? contribution.value.schema : null);
      const schema = value && typeof value === 'object' && 'schema' in value ? value.schema : value;
      const encoded = canonicalJson(schema, 8192);
      return {type: contribution.id, version: contribution.version, schema: encoded.ok ? JSON.parse(encoded.text) as unknown : null};
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.authoring?.dispose();
    this.authoring = null;
    this.extensionHost.dispose();
    this.localHistory.clear();
    this.state = Object.freeze({...INITIAL_SESSION_STATE, needsReload: true});
    this.listeners.clear();
  }

  private closedResult(): FailedResult {
    return {status: 'failed', code: 'unavailable', issues: [createIssue('structural-rule', 'Session is closed', [])]};
  }

  getActor(): Actor { return { ...this.actor }; }

  /**
   * Subscribes a listener to session state changes (suitable for useSyncExternalStore).
   * Notifies once per state change.
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Read-only view of current session undo stack (oldest to newest).
   */
  get undoStack(): readonly UndoEntry[] {
    return this.localHistory.getSnapshot().undo;
  }

  /**
   * Read-only view of current session redo stack (oldest to newest).
   */
  get redoStack(): readonly UndoEntry[] {
    return this.localHistory.getSnapshot().redo;
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

  /** The open branch's identity and revisions, or null when no project is open. */
  private currentOpenBranch(): OpenBranch | null {
    const { projectId, branchId, workingRevision, projectRevision, document } = this.state;
    if (
      !projectId ||
      !branchId ||
      workingRevision === null ||
      projectRevision === null ||
      !document
    ) {
      return null;
    }
    return { projectId, branchId, workingRevision, projectRevision, document };
  }

  /** Busy / needs-reload / nothing-open checks shared by the branch-scoped commands. */
  private openBranchOrReject(
    reloadMessage: string,
    noProjectMessage: string,
  ): OpenBranch | BusyResult | InvalidResult {
    if (this.isInFlight) {
      return { status: 'busy', message: 'An operation is currently in flight' };
    }
    if (this.state.needsReload) {
      return { status: 'invalid', issues: [createIssue('structural-rule', reloadMessage, [])] };
    }
    return (
      (this.state.status === 'ready' ? this.currentOpenBranch() : null) ?? {
        status: 'invalid',
        issues: [createIssue('structural-rule', noProjectMessage, [])],
      }
    );
  }

  /** The envelope every command on the open branch carries. */
  private branchEnvelope(open: OpenBranch) {
    return {
      operationId: this.mintId(),
      projectId: open.projectId,
      branchId: open.branchId,
      expectedWorkingRevision: open.workingRevision,
      actor: this.actor,
    };
  }

  /**
   * Runs `work` as the one in-flight operation: the session reads `saving` meanwhile and
   * `ready` again after, and an unexpected error becomes a typed failed result (contract
   * violations still throw).
   */
  private async runSaving<T>(work: () => Promise<T>): Promise<T | FailedResult> {
    this.isInFlight = true;
    this.updateState({ status: 'saving' });
    try {
      return await work();
    } catch (err) {
      if (err instanceof Error && err.message.includes('Contract violation:')) {
        throw err;
      }
      const failed = this.mapErrorToFailedResult(err);
      this.updateState({ status: 'ready', lastError: failed });
      return failed;
    } finally {
      this.isInFlight = false;
    }
  }

  /**
   * Executes a branch command and, when applied, adopts the reloaded working copy. A
   * non-applied result leaves the document untouched and is recorded as `lastError`.
   * `onApplied` runs once the reload succeeded (undo-stack bookkeeping) and returns any
   * extra state to publish with the new revision.
   */
  private async executeAndAdopt(
    command: ModelApplyRecordsCommand | ProjectRenameCommand,
    onApplied: () => Partial<SessionState> = () => ({}),
    intent: TransactionIntent = 'normal',
  ) {
    if (command.commandId === 'model.apply-records') return this.executeAuthoredRecords(command, onApplied, intent);
    const res = await this.repository.execute(command);
    if (this.disposed) return res;
    if (res.status !== 'applied') {
      this.updateState({ status: 'ready', lastError: res });
      return res;
    }
    if (res.branchRevision === null) {
      throw new Error('Contract violation: Branch command returned applied with null branchRevision');
    }

    const reloaded = await this.reloadBranchAndSnapshot(command.projectId, command.branchId);
    if (this.disposed) return res;
    if (!reloaded.ok) {
      this.updateState({ status: 'ready', lastError: reloaded.missing, needsReload: true });
      return reloaded.missing;
    }

    this.updateState({
      status: 'ready',
      projectRevision: res.projectRevision,
      workingRevision: reloaded.branch.workingRevision,
      workingSnapshotId: reloaded.branch.workingSnapshotId,
      document: reloaded.snapshot.document,
      ...onApplied(),
      lastError: null,
      needsReload: false,
    });
    return res;
  }

  /** Real record edits are planned, serialized and adopted by the whiteboard authority. */
  private async executeAuthoredRecords(command: ModelApplyRecordsCommand, onApplied: () => Partial<SessionState>, intent: TransactionIntent) {
    const kernel = this.authoring;
    if (!kernel) throw new Error('Contract violation: Authored command requires an active whiteboard authority');
    const context: NonNullable<SessionController['activeRecordCommand']> = { command };
    this.activeRecordCommand = context;
    try {
      const result = await kernel.dispatch({
        operationId: command.operationId, actor: command.actor,
        scope: { projectId: command.projectId, branchId: command.branchId },
        expectedRevision: command.expectedWorkingRevision, changes: command.payload.changes, intent,
      });
      if (this.disposed) return context.result ?? this.closedResult();
      if (result.status === 'applied' && context.loaded && context.result?.status === 'applied') {
        const head = kernel.getSnapshot();
        this.updateState({ status: 'ready', projectRevision: context.loaded.projectRevision,
          workingRevision: head.revision, workingSnapshotId: context.loaded.branch.workingSnapshotId,
          document: head.document, ...onApplied(), lastError: null, needsReload: false });
        return context.result;
      }
      if (result.status === 'failed' && result.error instanceof Error && result.error.message.includes('Contract violation:')) throw result.error;
      const failure = context.result && context.result.status !== 'applied' ? context.result
        : result.status === 'invalid' ? { status: 'invalid' as const, issues: result.issues as readonly Issue[] }
          : result.status === 'stale' ? { status: 'stale' as const, scope: 'branch' as const, expected: command.expectedWorkingRevision, actual: result.actualRevision }
            : result.status === 'busy' ? { status: 'busy' as const, message: 'An operation is currently in flight' }
              : this.mapErrorToFailedResult(result.status === 'failed' ? result.error : new Error('Authored board is unavailable'));
      this.updateState({ status: 'ready', lastError: failure,
        needsReload: Boolean(context.needsReload || kernel.getSnapshot().needsReload) });
      return failure;
    } finally {
      this.activeRecordCommand = null;
    }
  }

  /** Preserve the existing repository's atomic receipt and paired snapshot reload. */
  private async commitAuthoredRecords(): Promise<AtomicCommitResult<Document>> {
    const context = this.activeRecordCommand;
    if (!context) throw new Error('Contract violation: Missing authored commit context');
    const command = context.command;
    const result = await this.repository.execute(command);
    context.result = result;
    if (result.status !== 'applied') {
      if (result.status === 'stale') return { status: 'stale', actualRevision: typeof result.actual === 'number' ? result.actual : command.expectedWorkingRevision };
      if (result.status === 'invalid') return result;
      return { status: 'failed', error: result };
    }
    if (result.branchRevision === null) throw new Error('Contract violation: Branch command returned applied with null branchRevision');
    const reloaded = await this.reloadBranchAndSnapshot(command.projectId, command.branchId);
    if (!reloaded.ok) {
      context.result = reloaded.missing;
      context.needsReload = true;
      return { status: 'failed', error: reloaded.missing };
    }
    context.loaded = { ...reloaded, projectRevision: result.projectRevision };
    return { status: 'applied', document: reloaded.snapshot.document, revision: reloaded.branch.workingRevision };
  }

  /**
   * Creates a new project via project.create (Bootstrap envelope) and opens its draft branch.
   */
  async createProject(params: CreateProjectParams): Promise<CreateProjectResult> {
    if (this.disposed) return this.closedResult();
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

    // A blank project (no views yet) is created with one empty view
    // labelled "Main" so components can be placed immediately -- a caller
    // that starts from a template already supplies its own views
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

    const checked = validateDocument(initialDocument);
    const initialIssues = checked.ok
      ? this.extensionHost.validateBoard(projectSystemDesignDocument(checked.document)) as readonly Issue[]
      : checked.issues;
    if (initialIssues.length) {
      const invalid: InvalidResult = {status: 'invalid', issues: initialIssues};
      this.updateState({lastError: invalid});
      return invalid;
    }

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

        this.localHistory.clear();

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
      const failed = this.mapErrorToFailedResult(err);
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
    if (this.disposed) return this.closedResult();
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

      const checked = validateDocument(snapshot.document);
      const issues = checked.ok
        ? this.extensionHost.validateBoard(projectSystemDesignDocument(checked.document)) as readonly Issue[]
        : checked.issues;
      if (issues.length) {
        const invalid: InvalidResult = {status: 'invalid', issues};
        this.updateState({status: this.state.projectId ? 'ready' : 'empty', lastError: invalid});
        return invalid;
      }
      this.localHistory.clear();

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
      const failed = this.mapErrorToFailedResult(err);
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
    if (this.disposed) return this.closedResult();
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
    if (this.disposed) return this.closedResult();
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
      result = this.mapErrorToFailedResult(err);
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
    if (this.disposed) return this.closedResult();
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
      result = this.mapErrorToFailedResult(err);
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

  async renameProject(title: string): Promise<SessionRenameResult> {
    if (this.disposed) return this.closedResult();
    const open = this.openBranchOrReject(
      'Session requires reload before renaming project',
      'No project is open to rename',
    );
    if ('status' in open) return open;

    const command: ProjectRenameCommand = {
      commandId: 'project.rename',
      ...this.branchEnvelope(open),
      expectedProjectRevision: open.projectRevision,
      payload: {
        title,
        expectedProjectRevision: open.projectRevision,
      },
    };

    return this.runSaving(() => this.executeAndAdopt(command));
  }

  /** Description and team live on the project record, so no snapshot, undo entry or reload is involved. */
  async updateProjectDetails(details: {
    readonly description: string;
    readonly team: string;
    readonly exposures?: readonly ProjectExposure[];
  }): Promise<SessionRenameResult> {
    if (this.disposed) return this.closedResult();
    const open = this.openBranchOrReject(
      'Session requires reload before editing project details',
      'No project is open to edit',
    );
    if ('status' in open) return open;

    const command: ProjectUpdateDetailsCommand = {
      commandId: 'project.update-details',
      operationId: this.mintId(),
      projectId: open.projectId,
      expectedProjectRevision: open.projectRevision,
      actor: this.actor,
      payload: {
        description: details.description,
        team: details.team,
        ...(details.exposures ? { exposures: details.exposures } : {}),
      },
    };

    return this.runSaving(async () => {
      const result = await this.repository.execute(command);
      this.updateState(
        result.status === 'applied'
          ? { status: 'ready', projectRevision: result.projectRevision, lastError: null }
          : { status: 'ready', lastError: result },
      );
      return result;
    });
  }

  /** Part artifacts advance project revision without changing content or undo history. */
  async savePart(command: PartCaptureCommand | PartImportCommand): Promise<SessionApplyResult> {
    if (this.disposed) return this.closedResult();
    if (this.isInFlight) return { status: 'busy', message: 'An operation is currently in flight' };
    if (this.state.status !== 'ready' || this.state.needsReload || command.projectId !== this.state.projectId) {
      return { status: 'invalid', issues: [createIssue('structural-rule', 'Open the source project before saving a part.', [])] };
    }
    if (command.commandId === 'part.capture' && command.branchId !== this.state.branchId) {
      return { status: 'invalid', issues: [createIssue('structural-rule', 'The source branch changed. Review the selection again.', [])] };
    }
    return this.runSaving(async () => {
      const result = await this.repository.execute(command);
      this.updateState(
        result.status === 'applied'
          ? { status: 'ready', projectRevision: result.projectRevision, lastError: null }
          : { status: 'ready', lastError: result },
      );
      return result;
    });
  }

  /**
   * The first authored edit on main creates a draft branch from main's
   * working content (branch.create, source:'working') and switches the
   * session to it, before the edit itself is applied. Branch creation is not
   * undoable (like other branch history) — only the edit gets an undo entry.
   *
   * The branch is labelled "Draft from main"; on a collision with an existing
   * branch label, " 2", " 3", … is appended (first free suffix), checked against
   * every branch on the project (open and closed) via loadHistory.
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
      const failed = this.mapErrorToFailedResult(err);
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
      const failed = this.mapErrorToFailedResult(err);
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
    this.localHistory.clear();

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
   * If the active branch is main, this first creates and switches to a
   * draft branch (see `autoDraftFromMainIfNeeded`) before applying the edit,
   * so main never ends up holding unpublished edits.
   */
  async apply(changes: readonly RecordChange[], label: string): Promise<SessionApplyResult> {
    if (this.disposed) return this.closedResult();
    return this.applyWithProposal(changes, label);
  }

  /** Human-reviewed agent edits retain the normal atomic write and single undo behavior. */
  async applyReviewedProposal(request: ProposalRequest<RecordChange>, reviewer: AgentActor): Promise<SessionApplyResult> {
    if (this.disposed) return this.closedResult();
    if (reviewer.kind !== 'human' || reviewer.actorId !== this.actor.actorId || request.actor.kind !== 'agent') {
      return { status: 'invalid', issues: [createIssue('structural-rule', 'Only the active local participant can accept an agent proposal', ['actor'])] };
    }
    return this.applyWithProposal(request.changes, request.label, request);
  }

  private async applyWithProposal(changes: readonly RecordChange[], label: string, proposal?: ProposalRequest<RecordChange>): Promise<SessionApplyResult> {
    const initial = this.openBranchOrReject(
      'Session requires reload before applying changes',
      'Cannot apply changes: no project is open',
    );
    if ('status' in initial) return initial;

    return this.runSaving(async () => {
      if (proposal && (initial.projectId !== proposal.scope.projectId || initial.branchId !== proposal.scope.branchId || initial.workingRevision !== proposal.expectedRevision)) {
        this.updateState({ status: 'ready' });
        return { status: 'stale' as const, scope: 'branch' as const, expected: proposal.expectedRevision, actual: initial.workingRevision };
      }
      if (this.state.branchId === this.state.mainBranchId) {
        const drafted = await this.autoDraftFromMainIfNeeded();
        if (!drafted.ok) {
          this.updateState({ status: 'ready', lastError: drafted.error });
          return drafted.error;
        }
      }

      // Re-read state: autoDraftFromMainIfNeeded may have switched branchId,
      // workingRevision and document to the new draft.
      const open = this.currentOpenBranch();
      if (!open) {
        this.updateState({ status: 'ready' });
        return {
          status: 'invalid' as const,
          issues: [createIssue('structural-rule', 'Cannot apply changes: no project is open', [])],
        };
      }

      // Compute inverse changes from pre-apply Document before mutation
      const inverseRes = computeInverseChanges(open.document, changes);
      if (!inverseRes.ok) {
        this.updateState({ status: 'ready' });
        return { status: 'invalid' as const, issues: inverseRes.issues };
      }
      const undoEntry: UndoEntry = {
        label,
        inverseChanges: inverseRes.changes,
        forwardChanges: [...changes],
      };

      const command: ModelApplyRecordsCommand = {
        commandId: 'model.apply-records',
        ...this.branchEnvelope(open),
        payload: { changes, ...(proposal ? { proposal: { operationId: proposal.operationId, actor: { ...proposal.actor, kind: 'agent' as const } } } : {}) },
      };

      return this.executeAndAdopt(command, () => {
        this.localHistory.recordAccepted(undoEntry);
        return this.undoRedoAvailability();
      });
    });
  }

  /**
   * Undoes the last accepted edit by issuing inverse changes as a NEW apply-records command.
   * On success: moves entry to redo stack and adopts new Document and incremented revision.
   * On stale/failed: state and stacks unchanged.
   */
  async undo(): Promise<SessionUndoResult> {
    if (this.disposed) return this.closedResult();
    const open = this.openBranchOrReject(
      'Session requires reload before undo',
      'Cannot undo: no project is open',
    );
    if ('status' in open) return open;

    const ticket = this.localHistory.prepare('undo');
    if (!ticket) {
      return { status: 'empty', message: 'Nothing to undo' };
    }
    const entry = ticket.entry;

    const command: ModelApplyRecordsCommand = {
      commandId: 'model.apply-records',
      ...this.branchEnvelope(open),
      payload: { changes: entry.inverseChanges },
    };

    return this.runSaving(() =>
      this.executeAndAdopt(command, () => {
        this.localHistory.commit(ticket);
        return this.undoRedoAvailability();
      }, 'undo'),
    );
  }

  /**
   * Redoes the last undone edit by issuing forward changes as a NEW apply-records command.
   * On success: moves entry to undo stack and adopts new Document and incremented revision.
   * On stale/failed: state and stacks unchanged.
   */
  async redo(): Promise<SessionRedoResult> {
    if (this.disposed) return this.closedResult();
    const open = this.openBranchOrReject(
      'Session requires reload before redo',
      'Cannot redo: no project is open',
    );
    if ('status' in open) return open;

    const ticket = this.localHistory.prepare('redo');
    if (!ticket) {
      return { status: 'empty', message: 'Nothing to redo' };
    }
    const entry = ticket.entry;

    const command: ModelApplyRecordsCommand = {
      commandId: 'model.apply-records',
      ...this.branchEnvelope(open),
      payload: { changes: entry.forwardChanges },
    };

    return this.runSaving(() =>
      this.executeAndAdopt(command, () => {
        this.localHistory.commit(ticket);
        return this.undoRedoAvailability();
      }, 'redo'),
    );
  }

  private undoRedoAvailability(): Pick<SessionState, 'canUndo' | 'canRedo'> {
    const { canUndo, canRedo } = this.localHistory;
    return { canUndo, canRedo };
  }

  /**
   * Internal helper to update state and notify subscribers if any field changed.
   */
  private updateState(partial: Partial<SessionState>): void {
    if (this.disposed) return;
    let nextState: SessionState = Object.freeze({
      ...this.state,
      ...partial,
    });

    if (nextState.document && nextState.projectId && nextState.branchId && nextState.workingRevision !== null) {
      const head = this.authoring?.getSnapshot();
      if (!head || head.document !== nextState.document || head.scope.projectId !== nextState.projectId || head.scope.branchId !== nextState.branchId || head.revision !== nextState.workingRevision) {
        const replacement = createBoardRuntime<Document, SystemRecordMap>({
          document: nextState.document, scope: { projectId: nextState.projectId, branchId: nextState.branchId },
          revision: nextState.workingRevision, validate: validateDocument, apply: applyRecordChanges,
          lookup: () => null, invert: computeInverseChanges,
          validateExtensions: document => this.extensionHost.validateBoard(projectSystemDesignDocument(document)),
          commit: () => this.commitAuthoredRecords(),
        });
        this.authoring?.dispose();
        this.authoring = replacement;
      }
      nextState = Object.freeze({ ...nextState, document: this.authoring!.getSnapshot().document });
    } else if (this.authoring) {
      this.authoring.dispose();
      this.authoring = null;
    }

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

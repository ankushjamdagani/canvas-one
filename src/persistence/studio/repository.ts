import { exportProjectArchive } from '@canvas-one/simulation-system-design/archive';
import { BrowserTaskLeaseRegistry, authorizeTaskWrite, parseTaskLedger, type AttemptBinding, type TaskScope, type TaskLedger } from '@canvas-one/agents';
import { StudioConversationStorage } from './agent-conversations';
import { appendAgentTaskAction, prepareAgentTaskAction, type AgentTaskActionRecord } from './agent-action-journal';
import { TaskOverlapRegistry } from './agent-overlap';
import { liveTaskTargetsMatch } from '@canvas-one/system-design/session/contracts';
import { StudioTaskStorage, agentTaskLedgerKey } from './agent-tasks';
/**
 * Local Repository implementation for System Studio.
 *
 * Implements the repository API over Dexie: idempotent operation receipts, compare-and-swap
 * revision checks and immutable content-addressed rows, with each command in one atomic
 * transaction.
 */

import { canonicalJson, sha256Hex } from '../../domain/studio/canonical';
import { AtomicDocumentCoordinator, AtomicOperationCoordinator, type OperationWrite, ImmutableArtifactCoordinator, ArtifactPruningCoordinator, insertImmutableRecords, deleteIndexMatches, type ImmutableRecordPolicy, type ImmutableRecord, PreferenceService, ProjectCatalogReader, ProjectLifecycleCoordinator } from '@canvas-one/storage';
import { HistoryTransitionPlanner } from '@canvas-one/history';
import { RunPersistenceService } from '@canvas-one/simulation-system-design/run-persistence';
import { RepositoryEvidencePolicy } from '@canvas-one/simulation-system-design/repository-evidence';
import { IndexedDbBackend } from '@canvas-one/storage-indexeddb';
import { validateDocument, type Issue } from '../../domain/studio/validate';
import type { Document, Id, Scenario } from '../../domain/studio/model';
import { isExposureList } from '../../domain/studio/exposure';
import { TERMINAL_STATUSES, type TraceEvent } from '../../domain/studio/runner/types';
import { codePointLength } from '../../domain/studio/text';
import { createStudioDatabase, StudioDatabase } from './db';
import { createIssue } from '../../domain/studio/issue';
import { mapErrorToFailedResult, RepositoryError } from './errors';
import {
  calculateRecordBytes,
  enforceProjectLimits,
  enforceRunRetentionLimits,
} from './limits';
import {
  computeRequestHash,
  computeSnapshotId,
  isValidUuid,
  replayedResult,
  validateActor,
  validateCommandEnvelope,
  validateEvidenceRefs,
  validateRevision,
  validateUuid,
} from './primitives';
import { applyRecordChanges } from './apply-records';
import { validateRunStartToken } from './token';
import { validatePublishTicket } from './publish-ticket';
import { FileTokenRegistry } from './file-tokens';
import { PartRepository, type PartCaptureCommand, type PartCaptureSource, type PartImportCommand } from './parts';
import { validatePortableBundle } from './bundle-validate';
import { computePinClosure } from '../../domain/versioning/pin-closure';
import {
  validatePublicationMetadata,
  deriveVersionKey,
  compareSemanticVersions,
} from '../../domain/versioning/publication';
import { buildManifest, type BuildManifestVersions } from '../../domain/studio/manifest';
import {
  buildEvidenceManifest,
  runQualifies,
  type CandidateScenario,
} from '../../domain/versioning';
import type { EvidenceManifest, EvidenceRef } from '../../domain/studio/runner/evidence';
import {
  DEFAULT_BUILD_VERSIONS,
  PREFERENCES_SCHEMA,
  type AppliedResult,
  type AuthoredCommand,
  type AuthoredResult,
  type BranchCreateCommand,
  type BranchRecord,
  type BranchReopenCommand,
  type CheckpointRecord,
  type CommitRecord,
  type FailedResult,
  type InvalidResult,
  type MissingResult,
  type DeleteProjectResult,
  type ExpectedHead,
  type ExportProjectParams,
  type ExportProjectResult,
  type HistoryCheckpointCommand,
  type HistoryCommitCommand,
  type HistoryLoadResult,
  type HistoryPublishCommand,
  type HistoryRestoreCommand,
  type ModelApplyRecordsCommand,
  type PartRecord,
  type PreferenceRecord,
  type ProjectBundle,
  type ProjectCreateCommand,
  type ProjectImportCommand,
  type ProjectRecord,
  type ProjectRenameCommand,
  type ProjectUpdateDetailsCommand,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_TEAM_MAX_LENGTH,
  type PruneUnreferencedParams,
  type PruneUnreferencedResult,
  type PublicationRecord,
  type ReferenceIntegrityIssue,
  type ReferenceIntegrityResult,
  type RunRecord,
  type SavePreferencesResult,
  type SaveRunResult,
  type SnapshotRecord,
  type StaleResult,
  type StudioRepository,
  type TraceChunkRecord,
  type UnsupportedResult,
  PORTABLE_FORMAT,
  PORTABLE_VERSION,
  STORAGE_LIMITS,
} from './types';
import { manifestFailureIssues } from './manifest-issues';
import { toPinClosureState } from './pin-state';

/**
 * Orders a branch's commit ancestry newest-first by DAG order from the head (never by
 * timestamp): breadth-first from the head following `parentIds` in array order,
 * deduplicating merge ancestors shared between parents on first visit. A dangling parent
 * (absent from `commitById`) is skipped, never fabricated -- `verifyReferenceIntegrity`
 * is the authority that reports it.
 */
function computeBranchHistoryOrder(
  headCommitId: Id | null,
  commitById: Map<Id, CommitRecord>,
): CommitRecord[] {
  if (headCommitId === null) return [];
  const visited = new Set<Id>();
  const result: CommitRecord[] = [];
  const queue: Id[] = [headCommitId];
  while (queue.length > 0) {
    const commitId = queue.shift()!;
    if (visited.has(commitId)) continue;
    const commit = commitById.get(commitId);
    if (!commit) continue;
    visited.add(commitId);
    result.push(commit);
    for (const parentId of commit.parentIds) {
      queue.push(parentId);
    }
  }
  return result;
}

function getProjectTables(db: StudioDatabase) {
  return [
    db.projects,
    db.branches,
    db.snapshots,
    db.commits,
    db.publications,
    db.checkpoints,
    db.runs,
    db.parts,
    db.operations,
    db.traceChunks,
  ];
}

export type ProjectStorageRows = {
  projects: ProjectRecord; branches: BranchRecord; snapshots: SnapshotRecord;
  operations: import('./types').OperationRecord; commits: CommitRecord;
  publications: PublicationRecord; checkpoints: CheckpointRecord; runs: RunRecord;
  parts: PartRecord; traceChunks: TraceChunkRecord;
};
type ProjectLifecycleRows = ProjectStorageRows & {
  agentTaskLedgers: import('./types').AgentTaskLedgerRecord;
  agentConversations: import('./types').AgentConversationRecord;
  agentConversationArchive: import('./types').AgentConversationArchiveRecord;
  agentTaskActions: AgentTaskActionRecord;
};
function immutablePolicy<Rows>(): ImmutableRecordPolicy<Rows> {
  return {
    equal: (_store, left, right) => {
      const a = canonicalJson(left); const b = canonicalJson(right);
      return a.ok && b.ok && a.text === b.text;
    },
    collision: () => new RepositoryError({
      code: 'invalid', message: 'Immutable record collision with conflicting content; row will not be overwritten',
      issues: [createIssue('structural-rule', 'Conflicting immutable row collision', [])],
    }),
  };
}

export type LocalRepositoryOptions = {
  /** Trusted synchronous host lease check, consulted inside the authored transaction. */
  readonly checkExecutionLease?: (binding: AttemptBinding) => boolean;
  /** Host-derived overlap independence; never accepted from provider request booleans. */
  readonly checkTaskActionIndependence?: (binding: AttemptBinding, changes: readonly import('./types').RecordChange[]) => boolean;
  readonly buildVersions?: BuildManifestVersions;
  /** Injected ID minting for transfer (download IDs). */
  readonly mintId?: () => Id;
  /** Injected FileToken registry; defaults to a private instance owned by this repository. */
  readonly fileTokens?: FileTokenRegistry;
};

function validTaskBinding(value: unknown): value is AttemptBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as AttemptBinding;
  const text = (input: unknown) => typeof input === 'string' && input.length > 0 && input.length <= 200;
  return Object.keys(binding).every(key => ['taskId', 'actorId', 'scope', 'attemptId', 'generation'].includes(key)) &&
    text(binding.taskId) && text(binding.actorId) && text(binding.attemptId) && Number.isSafeInteger(binding.generation) && binding.generation > 0 &&
    !!binding.scope && typeof binding.scope === 'object' && !Array.isArray(binding.scope) &&
    Object.keys(binding.scope).every(key => ['projectId', 'branchId', 'boardId'].includes(key)) &&
    text(binding.scope.projectId) && text(binding.scope.branchId) && text(binding.scope.boardId);
}

export class LocalRepository implements StudioRepository {
  private readonly agentOverlaps = new TaskOverlapRegistry();
  holdAgentTaskAction(binding: AttemptBinding, document: Document, changes: readonly import('./types').RecordChange[]): void { this.agentOverlaps.hold(binding, document, changes); }
  clearAgentTaskOverlap(binding: AttemptBinding): void { this.agentOverlaps.clear(binding); }
  /** Trusted browser host only; provider tools cannot renew execution authority. */
  readonly agentExecutionLeases = new BrowserTaskLeaseRegistry(() => performance.now(), { maxActiveEntries: 32, maxTombstones: 10000 });
  private readonly checkExecutionLease: (binding: AttemptBinding) => boolean;
  private readonly checkTaskActionIndependence: NonNullable<LocalRepositoryOptions['checkTaskActionIndependence']>;
  private readonly db: StudioDatabase;
  private readonly catalog: ProjectCatalogReader<ProjectRecord>;
  private readonly preferences: PreferenceService<typeof PREFERENCES_SCHEMA, unknown, FailedResult>;
  private readonly buildVersions: BuildManifestVersions;
  /**
   * Injected downloadId minting. There is no fallback generator of any kind (not even a
   * deterministic one): a repository built
   * without one simply cannot mint a downloadId, and `exportProject` reports that as a
   * typed `invalid` naming `mintId` rather than inventing an ID.
   */
  private readonly mintId: (() => Id) | undefined;
  readonly fileTokens: FileTokenRegistry;
  private readonly partRepository: PartRepository;

  createAgentTaskStorage(scope: TaskScope): StudioTaskStorage { return new StudioTaskStorage(this.db, scope); }
  createAgentConversationStorage(scope: TaskScope): StudioConversationStorage { return new StudioConversationStorage(this.db, scope); }
  async listAgentTaskActions(scope: TaskScope, taskId: string): Promise<readonly AgentTaskActionRecord[]> {
    return this.db.agentTaskActions.where('[projectId+branchId+boardId+taskId]').equals([scope.projectId, scope.branchId, scope.boardId, taskId]).limit(1001).toArray();
  }
  async replayAgentTaskAction(command: ModelApplyRecordsCommand): Promise<AuthoredResult | null> {
    if (!validTaskBinding(command.payload?.taskAuthority)) return null;
    const requestHash = await computeRequestHash({ ...command, expectedWorkingRevision: 0 });
    return replayedResult(this.db, command.projectId, command.operationId, requestHash);
  }

  constructor(
    db?: StudioDatabase,
    options?: LocalRepositoryOptions | BuildManifestVersions,
  ) {
    this.db = db ?? createStudioDatabase();
    this.checkExecutionLease = options && !('compilerVersion' in options) ? options.checkExecutionLease ?? (binding => this.agentExecutionLeases.permits(binding)) : binding => this.agentExecutionLeases.permits(binding);
    this.checkTaskActionIndependence = options && !('compilerVersion' in options) ? options.checkTaskActionIndependence ?? ((binding, changes) => this.agentOverlaps.independent(binding, changes)) : (binding, changes) => this.agentOverlaps.independent(binding, changes);
    this.catalog = new ProjectCatalogReader(new IndexedDbBackend<{ projects: ProjectRecord }>(this.db, ['projects']));
    this.preferences = new PreferenceService({ backend: new IndexedDbBackend<{ preferences: PreferenceRecord }>(this.db, ['preferences']), schema: PREFERENCES_SCHEMA, failed: mapErrorToFailedResult });
    if (options && 'compilerVersion' in options) {
      this.buildVersions = options;
      this.mintId = undefined;
      this.fileTokens = new FileTokenRegistry();
    } else if (options && 'buildVersions' in options && options.buildVersions) {
      this.buildVersions = options.buildVersions;
      this.mintId = (options as LocalRepositoryOptions).mintId;
      this.fileTokens = (options as LocalRepositoryOptions).fileTokens ?? new FileTokenRegistry();
    } else {
      this.buildVersions = DEFAULT_BUILD_VERSIONS;
      this.mintId = (options as LocalRepositoryOptions | undefined)?.mintId;
      this.fileTokens =
        (options as LocalRepositoryOptions | undefined)?.fileTokens ?? new FileTokenRegistry();
    }
    this.partRepository = new PartRepository(this.db, this.fileTokens, this.mintId);
  }

  previewPart(source: PartCaptureSource) { return this.partRepository.preview(source); }
  listParts(projectId: Id) { return this.partRepository.list(projectId); }
  exportPart(projectId: Id, partId: Id, revision: number) { return this.partRepository.export(projectId, partId, revision); }

  /**
   * Loads a project by ID. Returns a cloned, read-only record or null if not found.
   */
  async loadProject(projectId: Id): Promise<Readonly<ProjectRecord> | null> {
    try {
      return await this.catalog.load(projectId);
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to load project from database',
        issues: [createIssue('structural-rule', String(err), [], projectId)],
      });
    }
  }

  /**
   * Lists all projects sorted by title then id. Returns cloned, read-only records.
   */
  async listProjects(): Promise<readonly ProjectRecord[]> {
    try {
      return await this.catalog.list();
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to list projects from database',
        issues: [createIssue('structural-rule', String(err), [])],
      });
    }
  }

  /**
   * Loads a branch by [projectId, branchId]. Returns a cloned, read-only record or null if not found.
   */
  async loadBranch(projectId: Id, branchId: Id): Promise<Readonly<BranchRecord> | null> {
    try {
      const record = await this.db.branches.get([projectId, branchId]);
      if (!record) return null;
      return Object.freeze(structuredClone(record));
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to load branch from database',
        issues: [createIssue('structural-rule', String(err), [], branchId)],
      });
    }
  }

  /**
   * Loads a commit by [projectId, commitId]. Returns a cloned, read-only record or null if not found.
   */
  async loadCommit(projectId: Id, commitId: Id): Promise<Readonly<CommitRecord> | null> {
    try {
      const record = await this.db.commits.get([projectId, commitId]);
      if (!record) return null;
      return Object.freeze(structuredClone(record));
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to load commit from database',
        issues: [createIssue('structural-rule', String(err), [], commitId)],
      });
    }
  }

  /**
   * Loads a snapshot by [projectId, snapshotId]. Returns a cloned, read-only record or null if not found.
   */
  async loadSnapshot(projectId: Id, snapshotId: string): Promise<Readonly<SnapshotRecord> | null> {
    try {
      const record = await this.db.snapshots.get([projectId, snapshotId]);
      if (!record) return null;
      return Object.freeze(structuredClone(record));
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to load snapshot from database',
        issues: [createIssue('structural-rule', String(err), [], snapshotId)],
      });
    }
  }

  /**
   * Loads the browser-local user preference record. Preferences are outside
   * project content and therefore use their own singleton key and revision.
   */
  async loadPreferences(): Promise<Readonly<PreferenceRecord> | null> {
    try {
      return await this.preferences.load();
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to load preferences from database',
        issues: [createIssue('structural-rule', String(err), [], 'preferences')],
      });
    }
  }

  /**
   * Saves user preferences with own compare-and-set on preference revision.
   * Independent of and never touches workingRevision.
   */
  async savePreferences(
    expectedRevision: number,
    value: unknown,
    key = 'user',
  ): Promise<SavePreferencesResult> {
    return this.preferences.save(expectedRevision, value, key);
  }

  private historyOperation(): AtomicOperationCoordinator<ProjectStorageRows, AuthoredResult> {
    return new AtomicOperationCoordinator({
      backend: new IndexedDbBackend<ProjectStorageRows>(this.db, getProjectTables(this.db).map(table => table.name as keyof ProjectStorageRows)),
      policy: immutablePolicy<ProjectStorageRows>(),
      decodeReceipt: value => value as AuthoredResult,
      reused: operationId => ({ status: 'failed', code: 'operation-id-reused', issues: [createIssue('duplicate-id', `Operation ID ${operationId} has already been used with a different request payload`, ['operationId'], operationId)] }),
      failed: mapErrorToFailedResult,
    });
  }

  private projectLifecycle<Result>(): ProjectLifecycleCoordinator<ProjectLifecycleRows, Result> {
    type Rows = ProjectLifecycleRows;
    return new ProjectLifecycleCoordinator<Rows, Result>({
      // Domain policies and portable related-row writes share this complete transaction.
backend: new IndexedDbBackend<Rows>(this.db, [...getProjectTables(this.db), this.db.agentTaskLedgers, this.db.agentConversations, this.db.agentConversationArchive, this.db.agentTaskActions].map(table => table.name as keyof Rows), {
        agentTaskActions: [{ name: 'project', keyPath: 'projectId' }],
        branches: [{ name: 'project', keyPath: 'projectId' }], snapshots: [{ name: 'project', keyPath: 'projectId' }],
        commits: [{ name: 'project', keyPath: 'projectId' }], publications: [{ name: 'project', keyPath: 'projectId' }],
        checkpoints: [{ name: 'project', keyPath: 'projectId' }], runs: [{ name: 'project', keyPath: 'projectId' }],
        parts: [{ name: 'project', keyPath: 'projectId' }], operations: [{ name: 'project', keyPath: 'projectId' }],
        traceChunks: [{ name: 'run', keyPath: ['projectId', 'runId'] }],
      }),
      missing: id => ({ status: 'missing', ids: [id] }) as Result,
      stale: (expected, actual) => ({ status: 'stale', scope: 'project', expected, actual }) as Result,
      reused: operationId => ({ status: 'failed', code: 'operation-id-reused', issues: [createIssue('duplicate-id', `Operation ID ${operationId} has already been used with a different request payload`, ['operationId'], operationId)] }) as Result,
      decodeReceipt: value => value as Result,
      failed: error => mapErrorToFailedResult(error) as Result,
    });
  }

  /** Deletes atomically after main-head protection; retries report missing. */
  async deleteProject(
    projectId: Id,
    expectedMainHead: ExpectedHead,
  ): Promise<DeleteProjectResult> {
    return this.projectLifecycle<DeleteProjectResult>().delete(projectId, {
      protect: async (stores, project) => {
        const mainBranch = await stores.branches.get([projectId, project.mainBranchId]);
        if (!mainBranch) return { status: 'missing', ids: [projectId] };
        if (mainBranch.headCommitId !== expectedMainHead) return {
          status: 'stale', scope: 'branch', expected: expectedMainHead, actual: mainBranch.headCommitId,
        };
        return null;
      },
      cleanup: async stores => {
        await deleteIndexMatches(stores.agentTaskActions, 'project', projectId);
        // Earlier task ledgers intentionally have no project index. Their scoped
        // tuple keys still permit bounded cleanup without decoding user payloads.
        for (const name of ['agentTaskLedgers', 'agentConversations', 'agentConversationArchive'] as const) {
          let after: import('@canvas-one/storage').StorageKey | undefined;
          for (;;) {
            const page = await stores[name].scan({ limit: 1000, ...(after === undefined ? {} : { after }) });
            for (const entry of page.entries) {
              let identity: unknown;
              try { identity = JSON.parse('scopeKey' in entry.row ? entry.row.scopeKey : entry.row.key); } catch { continue; }
              if (Array.isArray(identity) && identity[1] === projectId) await stores[name].delete(entry.key);
            }
            if (!page.truncated || !page.entries.length) break;
            after = page.entries.at(-1)!.key;
          }
        }
        for (const name of ['branches', 'snapshots', 'commits', 'publications', 'checkpoints', 'runs', 'parts', 'operations'] as const) {
          await deleteIndexMatches(stores[name], 'project', projectId);
        }
        for (;;) {
          const page = await stores.traceChunks.queryRange('run', [projectId, ''], [projectId, '\uffff'], 1000);
          for (const entry of page.entries) await stores.traceChunks.delete(entry.key);
          if (!page.truncated) break;
        }
      },
      applied: () => ({ status: 'applied', projectId }),
    });
  }

  /**
   * Executes an authored command within a single atomic read-write transaction.
   * Implements exactly:
   * - project.create
   * - project.rename
   * - branch.create
   *
   * All other commands return typed UnsupportedResult naming the unsupported command.
   */
  async execute(command: AuthoredCommand): Promise<AuthoredResult | UnsupportedResult> {
    switch (command.commandId) {
      case 'part.capture':
      case 'part.import':
        return this.partRepository.execute(command as PartCaptureCommand | PartImportCommand);
      case 'project.create':
        return this.handleProjectCreate(command as ProjectCreateCommand);
      case 'project.rename':
        return this.handleProjectRename(command as ProjectRenameCommand);
      case 'project.update-details':
        return this.handleProjectUpdateDetails(command as ProjectUpdateDetailsCommand);
      case 'branch.create':
        return this.handleBranchCreate(command as BranchCreateCommand);
      case 'model.apply-records':
        return this.handleModelApplyRecords(command as ModelApplyRecordsCommand);
      case 'history.checkpoint':
        return this.handleHistoryCheckpoint(command as HistoryCheckpointCommand);
      case 'history.restore':
        return this.handleHistoryRestore(command as HistoryRestoreCommand);
      case 'branch.reopen':
        return this.handleBranchReopen(command as BranchReopenCommand);
      case 'history.commit':
        return this.handleHistoryCommit(command as HistoryCommitCommand);
      case 'history.publish':
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              'history.publish cannot be executed directly; candidates can only be published through CandidateController.publish or repo.publish with a registered ticket',
              ['commandId'],
            ),
          ],
        };
      case 'history.prepare-publish':
      case 'history.resolve-conflict':
        return {
          status: 'unsupported',
          message: `Command ${command.commandId} is not yet implemented`,
        };
      default:
        return {
          status: 'unsupported',
          message: `Command ${command.commandId} is not supported in this repository version`,
        };
    }
  }

  /**
   * Inside a command transaction: the branch the command targets, or `missing` / `stale`
   * when it is gone or no longer at the working revision the command was authored against.
   */
  private async loadBranchAtRevision(command: {
    readonly projectId: Id;
    readonly branchId: Id;
    readonly expectedWorkingRevision: number;
  }, branchStore: { get(key: [string, string]): Promise<BranchRecord | undefined> } = this.db.branches): Promise<BranchRecord | MissingResult | StaleResult> {
    const branch = await branchStore.get([command.projectId, command.branchId]);
    if (!branch) {
      return { status: 'missing', ids: [command.branchId] };
    }
    if (branch.workingRevision !== command.expectedWorkingRevision) {
      return {
        status: 'stale',
        scope: 'branch',
        expected: command.expectedWorkingRevision,
        actual: branch.workingRevision,
      };
    }
    return branch;
  }

  /**
   * project.create:
   * Validated blank or template document -> creation snapshot, main branch, draft branch, receipt.
   */
  private async handleProjectCreate(
    command: ProjectCreateCommand,
  ): Promise<AuthoredResult> {
    // 1. Actor validation
    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    // 2. Validate envelope operationId
    const opIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIssue) {
      return { status: 'invalid', issues: [opIssue] };
    }

    // 3. Validate payload IDs
    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'command.payload is required', ['payload'])],
      };
    }

    const projIdIssue = validateUuid(
      command.payload.newProjectId,
      ['payload', 'newProjectId'],
      'newProjectId',
    );
    if (projIdIssue) {
      return { status: 'invalid', issues: [projIdIssue] };
    }

    const mainBranchIdIssue = validateUuid(
      command.payload.mainBranchId,
      ['payload', 'mainBranchId'],
      'mainBranchId',
    );
    if (mainBranchIdIssue) {
      return { status: 'invalid', issues: [mainBranchIdIssue] };
    }

    const draftBranchIdIssue = validateUuid(
      command.payload.draftBranchId,
      ['payload', 'draftBranchId'],
      'draftBranchId',
    );
    if (draftBranchIdIssue) {
      return { status: 'invalid', issues: [draftBranchIdIssue] };
    }

    if (command.payload.mainBranchId === command.payload.draftBranchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'duplicate-id',
            'mainBranchId and draftBranchId must be distinct IDs',
            ['payload', 'draftBranchId'],
            command.payload.draftBranchId,
          ),
        ],
      };
    }

    // 4. Validate title
    const title = command.payload?.title?.trim() ?? '';
    if (title.length < 1 || title.length > 80) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'too-long',
            'Project title must be between 1 and 80 code points',
            ['payload', 'title'],
          ),
        ],
      };
    }

    // 5. Validate initial document with storable validator
    const docValidation = validateDocument(command.payload?.initialDocument);
    if (!docValidation.ok) {
      return {
        status: 'invalid',
        issues: docValidation.issues,
      };
    }
    const document = docValidation.document;

    // 6. Compute request hash and snapshot ID BEFORE the transaction
    let requestHash: string;
    let snapshotId: string;
    try {
      requestHash = await computeRequestHash(command);
      snapshotId = await computeSnapshotId(document);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const projectId = command.payload.newProjectId;
    const now = Date.now();
    const mainBranchId = command.payload.mainBranchId;
    const draftBranchId = command.payload.draftBranchId;

    const snapshotRow: SnapshotRecord = {
      projectId,
      id: snapshotId,
      document,
    };

    const mainBranchRow: BranchRecord = {
      projectId,
      id: mainBranchId,
      label: 'main',
      state: 'open',
      headCommitId: null,
      workingSnapshotId: snapshotId,
      workingRevision: 0,
      createdAt: now,
    };

    const draftBranchRow: BranchRecord = {
      projectId,
      id: draftBranchId,
      label: 'draft',
      state: 'open',
      headCommitId: null,
      workingSnapshotId: snapshotId,
      workingRevision: 0,
      createdAt: now,
    };

    const projectRow: ProjectRecord = {
      id: projectId,
      title,
      revision: 0,
      mainBranchId,
      initialSnapshotId: snapshotId,
      importSourceId: null,
      createdAt: now,
      updatedAt: now,
    };

    const appliedResult: AppliedResult = {
      status: 'applied',
      operationId: command.operationId,
      projectRevision: 0,
      branchRevision: 0,
      changedIds: [projectId, mainBranchId, draftBranchId],
      undo: null,
      value: { kind: 'project', projectId, branchId: draftBranchId },
    };

    // 5. Pre-transaction byte accounting check
    const localBytes =
      calculateRecordBytes(projectRow) +
      calculateRecordBytes(mainBranchRow) +
      calculateRecordBytes(draftBranchRow) +
      calculateRecordBytes(snapshotRow) +
      calculateRecordBytes({ projectId, id: command.operationId, requestHash, result: appliedResult, createdAt: now });

    const exportBytes =
      calculateRecordBytes(projectRow) +
      calculateRecordBytes(mainBranchRow) +
      calculateRecordBytes(draftBranchRow) +
      calculateRecordBytes(snapshotRow);

    return this.projectLifecycle<AuthoredResult>().create(
      { projectId, operationId: command.operationId, requestHash }, projectRow, {
        exists: () => ({ status: 'failed', code: 'conflict', issues: [createIssue('duplicate-id', `Project ${projectId} already exists`, ['payload', 'newProjectId'], projectId)] }),
        check: stores => enforceProjectLimits(this.db, {
          projectId, additionalBranches: 2, additionalReceipts: 1,
          additionalLocalBytes: localBytes, additionalExportBytes: exportBytes,
        }, stores),
        initialize: async stores => {
          await insertImmutableRecords(stores, [{ store: 'snapshots', key: [projectId, snapshotId], row: snapshotRow }], immutablePolicy<ProjectStorageRows>());
          await stores.branches.add([projectId, mainBranchId], mainBranchRow);
          await stores.branches.add([projectId, draftBranchId], draftBranchRow);
        },
        result: appliedResult,
      },
    );
  }

  /**
   * project.rename:
   * Updates project title and the active Document.title together via a new snapshot;
   * other branches untouched.
   */
private async handleProjectRename(
    command: ProjectRenameCommand,
  ): Promise<AuthoredResult> {
    const envelopeInvalid = validateCommandEnvelope(command);
    if (envelopeInvalid) return envelopeInvalid;

    const projectRevIssue = validateRevision(
      command.expectedProjectRevision,
      ['expectedProjectRevision'],
      'expectedProjectRevision',
    );
    if (projectRevIssue) {
      return { status: 'invalid', issues: [projectRevIssue] };
    }

    if (
      command.payload?.expectedProjectRevision !== undefined &&
      command.payload.expectedProjectRevision !== command.expectedProjectRevision
    ) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'payload.expectedProjectRevision must match envelope expectedProjectRevision',
            ['payload', 'expectedProjectRevision'],
          ),
        ],
      };
    }

    // 3. Validate new title
    const newTitle = command.payload?.title?.trim() ?? '';
    if (newTitle.length < 1 || newTitle.length > 80) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'too-long',
            'Project title must be between 1 and 80 code points',
            ['payload', 'title'],
          ),
        ],
      };
    }

    // 4. Compute request hash BEFORE transaction
    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    // 5. Pre-read current state to compute new snapshot hash BEFORE transaction
    const project = await this.db.projects.get(command.projectId);
    if (!project) {
      return { status: 'missing', ids: [command.projectId] };
    }

    const branch = await this.db.branches.get([command.projectId, command.branchId]);
    if (!branch) {
      return { status: 'missing', ids: [command.branchId] };
    }

    const currentSnapshot = await this.db.snapshots.get([
      command.projectId,
      branch.workingSnapshotId,
    ]);
    if (!currentSnapshot) {
      return { status: 'missing', ids: [branch.workingSnapshotId] };
    }

    const updatedDocument: Document = {
      ...currentSnapshot.document,
      title: newTitle,
    };

    const docValidation = validateDocument(updatedDocument);
    if (!docValidation.ok) {
      return { status: 'invalid', issues: docValidation.issues };
    }

    let newSnapshotId: string;
    try {
      newSnapshotId = await computeSnapshotId(updatedDocument);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const newSnapshotRow: SnapshotRecord = {
      projectId: command.projectId,
      id: newSnapshotId,
      document: updatedDocument,
    };

    return this.projectLifecycle<AuthoredResult>().update(
      { projectId: command.projectId, operationId: command.operationId, requestHash },
      command.expectedProjectRevision,
      async (stores, currentProject, nextProjectRev, now) => {
        const currentBranch = await this.loadBranchAtRevision(command, stores.branches);
        if ('status' in currentBranch) return { rejected: currentBranch };
        const addedLocalBytes = calculateRecordBytes(newSnapshotRow);
        const limit = await enforceProjectLimits(this.db, {
          projectId: command.projectId, additionalReceipts: 1,
          additionalLocalBytes: addedLocalBytes, additionalExportBytes: addedLocalBytes,
        }, stores);
        if (limit) return { rejected: limit };
        const nextBranchRev = currentBranch.workingRevision + 1;
        const result: AppliedResult = {
          status: 'applied', operationId: command.operationId,
          projectRevision: nextProjectRev, branchRevision: nextBranchRev,
          changedIds: [command.projectId, command.branchId], undo: null, value: { kind: 'none' },
        };
        return {
          project: { ...currentProject, title: newTitle, revision: nextProjectRev, updatedAt: now },
          result,
          apply: async () => {
            await insertImmutableRecords(stores, [{ store: 'snapshots', key: [command.projectId, newSnapshotId], row: newSnapshotRow }], immutablePolicy<ProjectStorageRows>());
            await stores.branches.update([command.projectId, command.branchId], {
              workingSnapshotId: newSnapshotId, workingRevision: nextBranchRev,
            });
          },
        };
      },
    );
  }

  /**
   * project.update-details:
   * Sets the project record's description and team. Advances the project revision only;
   * snapshots, branches and undo history are untouched.
   */
  private async handleProjectUpdateDetails(
    command: ProjectUpdateDetailsCommand,
  ): Promise<AuthoredResult> {
    const actorIssues = validateActor(command.actor);
    if (actorIssues) return { status: 'invalid', issues: actorIssues };
    const envelopeIssue =
      validateUuid(command.operationId, ['operationId'], 'operationId') ??
      validateUuid(command.projectId, ['projectId'], 'projectId') ??
      validateRevision(command.expectedProjectRevision, ['expectedProjectRevision'], 'expectedProjectRevision');
    if (envelopeIssue) return { status: 'invalid', issues: [envelopeIssue] };

    const payload = command.payload;
    const issues: Issue[] = [];
    if (typeof payload?.description !== 'string') {
      issues.push(createIssue('wrong-type', 'description must be a string', ['payload', 'description']));
    } else if (codePointLength(payload.description) > PROJECT_DESCRIPTION_MAX_LENGTH) {
      issues.push(createIssue('too-long', `Description must be ${PROJECT_DESCRIPTION_MAX_LENGTH} characters or fewer`, ['payload', 'description']));
    }
    if (typeof payload?.team !== 'string') {
      issues.push(createIssue('wrong-type', 'team must be a string', ['payload', 'team']));
    } else if (codePointLength(payload.team) > PROJECT_TEAM_MAX_LENGTH) {
      issues.push(createIssue('too-long', `Team must be ${PROJECT_TEAM_MAX_LENGTH} characters or fewer`, ['payload', 'team']));
    }
    if (payload?.exposures !== undefined && !isExposureList(payload.exposures)) {
      issues.push(createIssue('invalid-literal', 'exposures must list each connection type once, from the supported types', ['payload', 'exposures']));
    }
    if (issues.length > 0) return { status: 'invalid', issues };
    const description = payload.description.trim();
    const team = payload.team.trim();
    const exposures = payload.exposures;

    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    return this.projectLifecycle<AuthoredResult>().update(
      { projectId: command.projectId, operationId: command.operationId, requestHash },
      command.expectedProjectRevision,
      async (stores, project, nextProjectRev, now) => {
        const updated: ProjectRecord = { ...project, description, team, ...(exposures ? { exposures } : {}), revision: nextProjectRev, updatedAt: now };
        const limit = await enforceProjectLimits(this.db, {
          projectId: command.projectId, additionalReceipts: 1,
          additionalLocalBytes: calculateRecordBytes(updated) - calculateRecordBytes(project),
          additionalExportBytes: 0,
        }, stores);
        if (limit) return { rejected: limit };
        const result: AppliedResult = {
          status: 'applied', operationId: command.operationId,
          projectRevision: nextProjectRev, branchRevision: null,
          changedIds: [command.projectId], undo: null, value: { kind: 'none' },
        };
        return { project: updated, result };
      },
    );
  }

  /**
   * branch.create:
   * Creates a new branch from working content or head snapshot.
   * A head mismatch returns failed/conflict (HEAD_MOVED); a revision mismatch returns stale.
   */
  private async handleBranchCreate(
    command: BranchCreateCommand,
  ): Promise<AuthoredResult> {
    const envelopeInvalid = validateCommandEnvelope(command);
    if (envelopeInvalid) return envelopeInvalid;

    // 3. Validate payload
    const label = command.payload?.label?.trim() ?? '';
    if (label.length < 1 || label.length > 80) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'too-long',
            'Branch label must be between 1 and 80 code points',
            ['payload', 'label'],
          ),
        ],
      };
    }

    const newBranchIssue = validateUuid(
      command.payload?.newBranchId,
      ['payload', 'newBranchId'],
      'newBranchId',
    );
    if (newBranchIssue) {
      return { status: 'invalid', issues: [newBranchIssue] };
    }

    const newBranchId = command.payload.newBranchId;
    if (newBranchId === command.branchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'duplicate-id',
            'newBranchId must be distinct from source branchId',
            ['payload', 'newBranchId'],
            newBranchId,
          ),
        ],
      };
    }

    // 3. Compute request hash BEFORE transaction
    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    return this.historyOperation().execute(
      { projectId: command.projectId, operationId: command.operationId, requestHash },
      async stores => {
        // Load project and source branch
        const project = await stores.projects.get(command.projectId);
        if (!project) {
          return { status: 'missing', ids: [command.projectId] };
        }

        const sourceBranch = await stores.branches.get([
          command.projectId,
          command.branchId,
        ]);
        if (!sourceBranch) {
          return { status: 'missing', ids: [command.branchId] };
        }

        // Check HEAD mismatch -> failed/conflict HEAD_MOVED
        if (sourceBranch.headCommitId !== command.payload.expectedHeadId) {
          return {
            status: 'failed',
            code: 'conflict',
            issues: [
              createIssue(
                'structural-rule',
                'HEAD_MOVED: Source branch head commit does not match expectedHeadId',
                ['payload', 'expectedHeadId'],
                command.payload.expectedHeadId,
              ),
            ],
          };
        }

        // Check working revision mismatch -> stale
        if (sourceBranch.workingRevision !== command.expectedWorkingRevision) {
          return {
            status: 'stale',
            scope: 'branch',
            expected: command.expectedWorkingRevision,
            actual: sourceBranch.workingRevision,
          };
        }

        // Check if branch ID already exists
        const existingBranch = await stores.branches.get([
          command.projectId,
          newBranchId,
        ]);
        if (existingBranch) {
          return {
            status: 'failed',
            code: 'conflict',
            issues: [
              createIssue(
                'duplicate-id',
                `Branch ${newBranchId} already exists in project`,
                ['payload', 'newBranchId'],
                newBranchId,
              ),
            ],
          };
        }

        // Determine new branch snapshot and head
        let workingSnapshotId: string;
        let headCommitId: ExpectedHead;

        if (command.payload.source === 'working') {
          workingSnapshotId = sourceBranch.workingSnapshotId;
          headCommitId = sourceBranch.headCommitId;
        } else {
          // source === 'head'
          if (sourceBranch.headCommitId !== null) {
            const headCommit = await stores.commits.get([
              command.projectId,
              sourceBranch.headCommitId,
            ]);
            if (!headCommit) {
              return { status: 'missing', ids: [sourceBranch.headCommitId] };
            }
            workingSnapshotId = headCommit.snapshotId;
            headCommitId = sourceBranch.headCommitId;
          } else {
            // Unborn branch: head is null, snapshot is the project's creation snapshot
            workingSnapshotId = project.initialSnapshotId;
            headCommitId = null;
          }
        }

        const now = Date.now();
        const planner = new HistoryTransitionPlanner();
        const newBranchRow = planner.fork(sourceBranch, { id: newBranchId, label, snapshotId: workingSnapshotId, headCommitId, now });

        // Check limits before mutation
        const branchBytes = calculateRecordBytes(newBranchRow);
        const limitError = await enforceProjectLimits(this.db, {
          projectId: command.projectId,
          additionalBranches: 1,
          additionalReceipts: 1,
          additionalLocalBytes: branchBytes,
          additionalExportBytes: branchBytes,
        }, stores);
        if (limitError) return limitError;

        const updatedProject = planner.project(project, now);
        const nextProjectRev = updatedProject.revision;
        const writes: OperationWrite<ProjectStorageRows>[] = [
          { kind: 'add', store: 'branches', key: [command.projectId, newBranchId], row: newBranchRow },
          { kind: 'update', store: 'projects', key: command.projectId, row: updatedProject },
        ];

        const appliedResult: AppliedResult = {
          status: 'applied',
          operationId: command.operationId,
          projectRevision: nextProjectRev,
          branchRevision: 0,
          changedIds: [newBranchId],
          undo: null,
          value: { kind: 'branch', branchId: newBranchId },
        };

        return { writes, result: appliedResult };
      },
    );
  }

  /**
   * model.apply-records:
   * Applies insert/replace/remove changes of EditableRecord to the branch working document.
   * Allowed on main. Computes snapshot hash before transaction.
   */
  private async handleModelApplyRecords(
    command: ModelApplyRecordsCommand,
  ): Promise<AuthoredResult> {
    const envelopeInvalid = validateCommandEnvelope(command);
    if (envelopeInvalid) return envelopeInvalid;
    command = structuredClone(command);

    // 3. Validate payload
    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'command.payload is required', ['payload'])],
      };
    }

    const changes = command.payload.changes;
    const proposal = command.payload.proposal;
    const taskAuthority = command.payload.taskAuthority;
    if (taskAuthority !== undefined && (!validTaskBinding(taskAuthority) || proposal !== undefined || taskAuthority.scope.projectId !== command.projectId || taskAuthority.scope.branchId !== command.branchId || !Array.isArray(command.payload.expectedRecords))) {
      return { status: 'invalid', issues: [createIssue('structural-rule', 'Live task authority must bind the exact board attempt and expected targets', ['payload', 'taskAuthority'])] };
    }
    if (proposal !== undefined && (
      !proposal || typeof proposal !== 'object' ||
      typeof proposal.operationId !== 'string' || proposal.operationId.length < 1 || proposal.operationId.length > 200 ||
      !proposal.actor || typeof proposal.actor !== 'object' || proposal.actor.kind !== 'agent' ||
      typeof proposal.actor.actorId !== 'string' || proposal.actor.actorId.length < 1 || proposal.actor.actorId.length > 200 ||
      typeof proposal.actor.displayName !== 'string' || proposal.actor.displayName.length < 1 || proposal.actor.displayName.length > 200 ||
      Object.keys(proposal).some(key => !['operationId', 'actor'].includes(key)) ||
      Object.keys(proposal.actor).some(key => !['actorId', 'displayName', 'kind'].includes(key))
    )) return {status: 'invalid', issues: [createIssue('wrong-type', 'Proposal attribution must identify the paired agent and proposal operation', ['payload', 'proposal'])]};
    if (!Array.isArray(changes)) {
      return {
        status: 'invalid',
        issues: [createIssue('wrong-type', 'payload.changes must be an array', ['payload', 'changes'])],
      };
    }

    if (changes.length > 1000) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'too-many',
            `payload.changes exceeds maximum limit of 1,000 changes (got ${changes.length})`,
            ['payload', 'changes'],
          ),
        ],
      };
    }

    // An immutable receipt must replay before domain application: an accepted
    // insertion is no longer valid against the subsequently updated document.
    let requestHash: string;
    try {
      requestHash = await computeRequestHash(taskAuthority ? { ...command, expectedWorkingRevision: 0 } : command);
      const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
      if (replay) return replay;
    } catch (err) { return mapErrorToFailedResult(err); }

    // 4. Pre-read current branch & snapshot to compute updated document BEFORE transaction
    const project = await this.db.projects.get(command.projectId);
    if (!project) {
      return { status: 'missing', ids: [command.projectId] };
    }

    const branch = await this.db.branches.get([command.projectId, command.branchId]);
    if (!branch) {
      return { status: 'missing', ids: [command.branchId] };
    }

    const currentSnapshot = await this.db.snapshots.get([
      command.projectId,
      branch.workingSnapshotId,
    ]);
    if (!currentSnapshot) {
      return { status: 'missing', ids: [branch.workingSnapshotId] };
    }
    if (taskAuthority && (currentSnapshot.document.id !== taskAuthority.scope.boardId || !liveTaskTargetsMatch(currentSnapshot.document, changes, command.payload.expectedRecords!))) {
      return { status: 'failed', code: 'conflict', issues: [createIssue('structural-rule', 'Live task targets changed; pause this action for a decision', ['payload', 'expectedRecords'])] };
    }

    // A human-reviewed proposal uses human write authority, while its task still
    // receives an atomic journal entry for a later task-specific reversal.
    let journalBinding: AttemptBinding | undefined = taskAuthority;
    if (!journalBinding && proposal) {
      try {
        const scope = { projectId: command.projectId, branchId: command.branchId, boardId: currentSnapshot.document.id };
        const raw = await this.createAgentTaskStorage(scope).load();
        const ledger = raw === null ? null : parseTaskLedger(raw);
        if (raw !== null && !ledger) throw new Error('Invalid task attribution ledger');
        const matching = ledger?.tasks.filter(task => task.actorId === proposal.actor.actorId && task.kind !== 'question') ?? [];
        if (matching.length > 1) throw new Error('Ambiguous task attribution');
        const task = matching[0], attempt = task?.attempts.at(-1);
        if (task && attempt) journalBinding = { taskId: task.id, actorId: task.actorId, scope: task.scope, attemptId: attempt.id, generation: attempt.generation };
      } catch (error) { return mapErrorToFailedResult(error); }
    }

    // Apply changes using pure applyRecordChanges domain helper
    const applied = applyRecordChanges(currentSnapshot.document, changes);
    if (!applied.ok) {
      return { status: 'invalid', issues: applied.issues };
    }

    const updatedDocument = applied.document;

    // 5. Compute snapshot hash and request hash BEFORE beginning transaction
    let newSnapshotId: string;
    try {
      newSnapshotId = await computeSnapshotId(updatedDocument);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const newSnapshotRow: SnapshotRecord = {
      projectId: command.projectId,
      id: newSnapshotId,
      document: updatedDocument,
    };

    // 6. Storage owns receipt replay, CAS and the authored atomic write. Domain
    // application, hashing and limits retain their existing policies.
    type WriteRows = {
      projects: ProjectRecord; branches: BranchRecord; snapshots: SnapshotRecord;
      operations: import('./types').OperationRecord; commits: CommitRecord;
      publications: PublicationRecord; checkpoints: CheckpointRecord; runs: RunRecord;
      parts: PartRecord; traceChunks: TraceChunkRecord;
      agentTaskLedgers: import('./types').AgentTaskLedgerRecord;
      agentTaskActions: AgentTaskActionRecord;
    };
    const coordinator = new AtomicDocumentCoordinator<WriteRows, AuthoredResult>({
      backend: new IndexedDbBackend<WriteRows>(this.db, [...getProjectTables(this.db), this.db.agentTaskLedgers, this.db.agentTaskActions].map(table => table.name as keyof WriteRows)),
      decodeReceipt: result => result as AuthoredResult,
      missing: id => ({ status: 'missing', ids: [id] }),
      stale: (expected, actual) => ({ status: 'stale', scope: 'branch', expected, actual }),
      reused: operationId => ({ status: 'failed', code: 'operation-id-reused', issues: [createIssue('duplicate-id', `Operation ID ${operationId} has already been used with a different request payload`, ['operationId'], operationId)] }),
      failed: mapErrorToFailedResult,
      equalSnapshot: (left, right) => {
        const a = canonicalJson(left); const b = canonicalJson(right);
        return a.ok && b.ok && a.text === b.text;
      },
      snapshotCollision: () => new RepositoryError({ code: 'invalid', message: 'Immutable record collision with conflicting content; row will not be overwritten', issues: [createIssue('structural-rule', 'Conflicting immutable row collision', [])] }),
      check: async (stores, _prepared, actualBranch, actualProject) => {
        let liveLedger: TaskLedger | null = null;
        if (taskAuthority) {
          if (actualBranch.id === actualProject.mainBranchId) return { status: 'failed', code: 'ineligible', issues: [createIssue('structural-rule', 'Live editing requires the current draft; authority cannot transfer to a new branch', ['branchId'])] };
          const snapshot = await stores.snapshots.get([command.projectId, actualBranch.workingSnapshotId]);
          if (!snapshot || snapshot.document.id !== taskAuthority.scope.boardId || !liveTaskTargetsMatch(snapshot.document, changes, command.payload.expectedRecords!)) return { status: 'failed', code: 'conflict', issues: [createIssue('structural-rule', 'Live task targets changed; pause this action for a decision', ['payload', 'expectedRecords'])] };
          const key = agentTaskLedgerKey(taskAuthority.scope);
          const row = await stores.agentTaskLedgers.get(key);
          const ledger = row && typeof row.serializedLedger === 'string' ? parseTaskLedger(row.serializedLedger) : null;
          if (!ledger || row!.key !== key || row!.revision !== ledger.revision || ledger.tasks.some(task => agentTaskLedgerKey(task.scope) !== key)) return { status: 'failed', code: 'ineligible', issues: [createIssue('structural-rule', 'Live task authority is missing or invalid', ['payload', 'taskAuthority'])] };
          liveLedger = ledger;
        }
        const addedLocalBytes = calculateRecordBytes(newSnapshotRow);
        const limits = await enforceProjectLimits(this.db, { projectId: command.projectId, additionalReceipts: 1, additionalLocalBytes: addedLocalBytes, additionalExportBytes: addedLocalBytes }, stores);
        if (limits) return limits;
        // No await after the trusted monotonic lease check and before handing back write eligibility.
        if (taskAuthority && liveLedger) {
          const task = liveLedger.tasks.find(value => value.id === taskAuthority.taskId);
          const independentOfOverlap = task?.status === 'waiting' && task.waitReason === 'overlap' ? this.checkTaskActionIndependence(structuredClone(taskAuthority), structuredClone(changes)) === true : false;
          const authorized = authorizeTaskWrite(liveLedger, taskAuthority, { dependenciesValidated: true, leaseValid: this.checkExecutionLease(structuredClone(taskAuthority)) === true, independentOfOverlap });
          if (!authorized.ok) return { status: 'failed', code: 'ineligible', issues: [createIssue('structural-rule', `Live task write denied: ${authorized.code}`, ['payload', 'taskAuthority'])] };
        }
        return null;
      },
      applied: revisions => ({ status: 'applied', ...revisions, changedIds: applied.changedIds, undo: null, value: { kind: 'none' }, ...(proposal ? { proposal: structuredClone(proposal) } : {}), ...(taskAuthority ? { task: structuredClone(taskAuthority) } : {}) }),
      participants: journalBinding ? [stores => appendAgentTaskAction(stores, prepareAgentTaskAction({ binding: journalBinding!, operationId: command.operationId,
        sequence: command.expectedWorkingRevision + 1, before: currentSnapshot.document, after: updatedDocument, changes }))] : [],
      finalGuard: taskAuthority ? () => this.checkExecutionLease(structuredClone(taskAuthority)) === true : undefined,
    });
    return coordinator.commit({ operationId: command.operationId, projectId: command.projectId, branchId: command.branchId,
      expectedRevision: command.expectedWorkingRevision, requestHash, snapshot: newSnapshotRow });
  }

  /**
   * history.checkpoint:
   * Immutable named checkpoint of the current working snapshot, no commit status, 100-per-project limit.
   */
  private async handleHistoryCheckpoint(
    command: HistoryCheckpointCommand,
  ): Promise<AuthoredResult> {
    const envelopeInvalid = validateCommandEnvelope(command);
    if (envelopeInvalid) return envelopeInvalid;

    // 3. Validate payload
    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'command.payload is required', ['payload'])],
      };
    }

    const cpIssue = validateUuid(
      command.payload.checkpointId,
      ['payload', 'checkpointId'],
      'checkpointId',
    );
    if (cpIssue) {
      return { status: 'invalid', issues: [cpIssue] };
    }

    const label = command.payload.label?.trim() ?? '';
    if (label.length < 1 || label.length > 80) {
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

    // 4. Compute request hash BEFORE transaction
    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    // 5. Pre-read state to compute checkpoint record bytes
    const project = await this.db.projects.get(command.projectId);
    if (!project) {
      return { status: 'missing', ids: [command.projectId] };
    }

    const branch = await this.db.branches.get([command.projectId, command.branchId]);
    if (!branch) {
      return { status: 'missing', ids: [command.branchId] };
    }

    const now = Date.now();
    const checkpointRow: CheckpointRecord = {
      projectId: command.projectId,
      id: command.payload.checkpointId,
      snapshotId: branch.workingSnapshotId,
      sourceBranchId: command.branchId,
      label,
      actor: command.actor,
      createdAt: now,
    };

    const checkpointBytes = calculateRecordBytes(checkpointRow);

    // 6. Execute atomic transaction
    return this.historyOperation().execute(
      { projectId: command.projectId, operationId: command.operationId, requestHash },
      async stores => {
        // Compare-and-set check on branch workingRevision
        const curBranch = await this.loadBranchAtRevision(command, stores.branches);
        if ('status' in curBranch) return curBranch;

        const curProject = await stores.projects.get(command.projectId);
        if (!curProject) {
          return { status: 'missing', ids: [command.projectId] };
        }

        // Enforce 100-per-project checkpoint limit and limits
        const limitError = await enforceProjectLimits(this.db, {
          projectId: command.projectId,
          additionalCheckpoints: 1,
          additionalReceipts: 1,
          additionalLocalBytes: checkpointBytes,
          additionalExportBytes: checkpointBytes,
        }, stores);
        if (limitError) return limitError;

        const updatedProject = new HistoryTransitionPlanner().project(curProject, now);
        const nextProjectRev = updatedProject.revision;
        const writes: OperationWrite<ProjectStorageRows>[] = [
          { kind: 'immutable', store: 'checkpoints', key: [command.projectId, command.payload.checkpointId], row: checkpointRow },
          { kind: 'update', store: 'projects', key: command.projectId, row: updatedProject },
        ];

        const appliedResult: AppliedResult = {
          status: 'applied',
          operationId: command.operationId,
          projectRevision: nextProjectRev,
          branchRevision: curBranch.workingRevision,
          changedIds: [command.payload.checkpointId],
          undo: null,
          value: {
            kind: 'artifact',
            artifactType: 'checkpoint',
            id: command.payload.checkpointId,
            revision: null,
          },
        };

        return { writes, result: appliedResult };
      },
    );
  }

  /**
   * history.restore:
   * Non-main only. In ONE transaction: checkpoint current working state under checkpointId/label,
   * then replace working content with target snapshot. Heads unchanged, no evidence.
   */
  private async handleHistoryRestore(
    command: HistoryRestoreCommand,
  ): Promise<AuthoredResult> {
    const envelopeInvalid = validateCommandEnvelope(command);
    if (envelopeInvalid) return envelopeInvalid;

    // 3. Validate payload
    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'command.payload is required', ['payload'])],
      };
    }

    const cpIssue = validateUuid(
      command.payload.checkpointId,
      ['payload', 'checkpointId'],
      'checkpointId',
    );
    if (cpIssue) {
      return { status: 'invalid', issues: [cpIssue] };
    }

    const label = command.payload.label?.trim() ?? '';
    if (label.length < 1 || label.length > 80) {
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

    const snapshotId = command.payload.snapshotId;
    if (typeof snapshotId !== 'string' || snapshotId.trim().length === 0) {
      return {
        status: 'invalid',
        issues: [
          createIssue('missing-property', 'payload.snapshotId is required', ['payload', 'snapshotId']),
        ],
      };
    }

    // 4. Pre-read project & branch; verify non-main only
    const project = await this.db.projects.get(command.projectId);
    if (!project) {
      return { status: 'missing', ids: [command.projectId] };
    }

    if (command.branchId === project.mainBranchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Direct restore on main branch is rejected; main is changed only by publication',
            ['branchId'],
            command.branchId,
          ),
        ],
      };
    }

    const branch = await this.db.branches.get([command.projectId, command.branchId]);
    if (!branch) {
      return { status: 'missing', ids: [command.branchId] };
    }

    // 5. Pre-read and verify target snapshot exists and is storable
    const targetSnapshot = await this.db.snapshots.get([command.projectId, snapshotId]);
    if (!targetSnapshot) {
      return { status: 'missing', ids: [snapshotId] };
    }

    // Check if target snapshot document is corrupt
    const docCheck = validateDocument(targetSnapshot.document);
    if (!docCheck.ok) {
      return { status: 'missing', ids: [snapshotId] };
    }

    // 6. Compute request hash BEFORE transaction
    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const now = Date.now();
    const checkpointRow: CheckpointRecord = {
      projectId: command.projectId,
      id: command.payload.checkpointId,
      snapshotId: branch.workingSnapshotId,
      sourceBranchId: command.branchId,
      label,
      actor: command.actor,
      createdAt: now,
    };

    const checkpointBytes = calculateRecordBytes(checkpointRow);

    // 7. Execute atomic transaction: checkpoint first, then replace working content
    return this.historyOperation().execute(
      { projectId: command.projectId, operationId: command.operationId, requestHash },
      async stores => {
        // Verify project and non-main
        const curProject = await stores.projects.get(command.projectId);
        if (!curProject) {
          return { status: 'missing', ids: [command.projectId] };
        }
        if (command.branchId === curProject.mainBranchId) {
          return {
            status: 'invalid',
            issues: [
              createIssue(
                'structural-rule',
                'Direct restore on main branch is rejected; main is changed only by publication',
                ['branchId'],
                command.branchId,
              ),
            ],
          };
        }

        // Compare-and-set check on branch workingRevision
        const curBranch = await this.loadBranchAtRevision(command, stores.branches);
        if ('status' in curBranch) return curBranch;

        // Re-verify target snapshot in transaction
        const curTarget = await stores.snapshots.get([command.projectId, snapshotId]);
        if (!curTarget) {
          return { status: 'missing', ids: [snapshotId] };
        }

        // Enforce checkpoint count limit (100) and storage limits
        const limitError = await enforceProjectLimits(this.db, {
          projectId: command.projectId,
          additionalCheckpoints: 1,
          additionalReceipts: 1,
          additionalLocalBytes: checkpointBytes,
          additionalExportBytes: checkpointBytes,
        }, stores);
        if (limitError) return limitError;

        const planner = new HistoryTransitionPlanner();
        const updatedBranch = planner.restore(curBranch, snapshotId);
        const updatedProject = planner.project(curProject, now);
        const nextBranchRev = updatedBranch.workingRevision;
        const nextProjectRev = updatedProject.revision;
        const writes: OperationWrite<ProjectStorageRows>[] = [
          { kind: 'immutable', store: 'checkpoints', key: [command.projectId, command.payload.checkpointId], row: checkpointRow },
          { kind: 'update', store: 'branches', key: [command.projectId, command.branchId], row: updatedBranch },
          { kind: 'update', store: 'projects', key: command.projectId, row: updatedProject },
        ];

        const appliedResult: AppliedResult = {
          status: 'applied',
          operationId: command.operationId,
          projectRevision: nextProjectRev,
          branchRevision: nextBranchRev,
          changedIds: [command.branchId, command.payload.checkpointId],
          undo: null,
          value: {
            kind: 'artifact',
            artifactType: 'checkpoint',
            id: command.payload.checkpointId,
            revision: null,
          },
        };

        return { writes, result: appliedResult };
      },
    );
  }

  /**
   * branch.reopen:
   * Closed non-main branches only; set open via revision check; branch revision++; history and main unchanged.
   */
  private async handleBranchReopen(
    command: BranchReopenCommand,
  ): Promise<AuthoredResult> {
    const envelopeInvalid = validateCommandEnvelope(command);
    if (envelopeInvalid) return envelopeInvalid;

    // 3. Pre-read project & branch
    const project = await this.db.projects.get(command.projectId);
    if (!project) {
      return { status: 'missing', ids: [command.projectId] };
    }

    // Closed non-main branches only!
    if (command.branchId === project.mainBranchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue('structural-rule', 'Cannot reopen main branch', ['branchId'], command.branchId),
        ],
      };
    }

    const branch = await this.db.branches.get([command.projectId, command.branchId]);
    if (!branch) {
      return { status: 'missing', ids: [command.branchId] };
    }

    if (branch.state !== 'closed') {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Branch is already open; only closed branches can be reopened',
            ['branchId'],
            command.branchId,
          ),
        ],
      };
    }

    // 4. Compute request hash BEFORE transaction
    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    // 5. Execute atomic transaction
    return this.historyOperation().execute(
      { projectId: command.projectId, operationId: command.operationId, requestHash },
      async stores => {
        const curProject = await stores.projects.get(command.projectId);
        if (!curProject) {
          return { status: 'missing', ids: [command.projectId] };
        }

        if (command.branchId === curProject.mainBranchId) {
          return {
            status: 'invalid',
            issues: [
              createIssue('structural-rule', 'Cannot reopen main branch', ['branchId'], command.branchId),
            ],
          };
        }

        const curBranch = await stores.branches.get([command.projectId, command.branchId]);
        if (!curBranch) {
          return { status: 'missing', ids: [command.branchId] };
        }

        if (curBranch.state !== 'closed') {
          return {
            status: 'invalid',
            issues: [
              createIssue(
                'structural-rule',
                'Branch is already open; only closed branches can be reopened',
                ['branchId'],
                command.branchId,
              ),
            ],
          };
        }

        // Check head mismatch
        if (curBranch.headCommitId !== command.payload.expectedHeadId) {
          return {
            status: 'failed',
            code: 'conflict',
            issues: [
              createIssue(
                'structural-rule',
                'HEAD_MOVED: Branch head commit does not match expectedHeadId',
                ['payload', 'expectedHeadId'],
                command.payload.expectedHeadId,
              ),
            ],
          };
        }

        // Compare-and-set check on branch workingRevision
        if (curBranch.workingRevision !== command.expectedWorkingRevision) {
          return {
            status: 'stale',
            scope: 'branch',
            expected: command.expectedWorkingRevision,
            actual: curBranch.workingRevision,
          };
        }

        // Enforce limits
        const limitError = await enforceProjectLimits(this.db, {
          projectId: command.projectId,
          additionalReceipts: 1,
        }, stores);
        if (limitError) return limitError;

        const now = Date.now();
        const planner = new HistoryTransitionPlanner();
        const updatedBranch = planner.reopen(curBranch);
        const updatedProject = planner.project(curProject, now);
        const nextBranchRev = updatedBranch.workingRevision;
        const nextProjectRev = updatedProject.revision;
        const writes: OperationWrite<ProjectStorageRows>[] = [
          { kind: 'update', store: 'branches', key: [command.projectId, command.branchId], row: updatedBranch },
          { kind: 'update', store: 'projects', key: command.projectId, row: updatedProject },
        ];

        const appliedResult: AppliedResult = {
          status: 'applied',
          operationId: command.operationId,
          projectRevision: nextProjectRev,
          branchRevision: nextBranchRev,
          changedIds: [command.branchId],
          undo: null,
          value: { kind: 'branch', branchId: command.branchId },
        };

        return { writes, result: appliedResult };
      },
    );
  }

  /**
   * Inside a transaction: a failed/ineligible result when a cited run is gone or its
   * fingerprint, status, provenance or checks differ from the copy evaluated beforehand.
   */
  private async findChangedCitedRun(
    projectId: Id, evidence: readonly EvidenceRef[], citedRuns: readonly RunRecord[],
    runs: import('@canvas-one/storage').TransactionStore<RunRecord>,
  ): Promise<FailedResult | null> {
    return new RepositoryEvidencePolicy({
      buildVersions: this.buildVersions,
      loadRun: (scope, id) => runs.get([scope, id]),
    }).recheck(projectId, evidence, citedRuns);
  }
  /**
   * Validates cited evidence against `doc` outside any transaction (shared by commit and
   * publish): refs are well formed per scenario, every scenario has one, each cited run
   * exists and matches, and the run qualifies for a manifest built with the repository's
   * current build versions (never taken from the evidence).
   */
  private async checkEvidence(
    projectId: Id, doc: Document, evidence: readonly EvidenceRef[],
    labels: { readonly document: 'working' | 'candidate'; readonly zeroScenarios: string },
  ): Promise<
    | { readonly status: 'ok'; readonly evidenceManifest: EvidenceManifest; readonly citedRuns: RunRecord[] }
    | InvalidResult | FailedResult
  > {
    return new RepositoryEvidencePolicy({
      buildVersions: this.buildVersions,
      loadRun: (scope, id) => this.db.runs.get([scope, id]),
    }).check(projectId, doc, evidence, labels);
  }
  /**
   * history.commit:
   * Non-main branch; passing evidence for every scenario.
   * Commit with parent = branch head (or [] when unborn); advance head; revision++.
   * 1,000-commit limit. Retried commitId with same request returns original result.
   */
  private async handleHistoryCommit(
    command: HistoryCommitCommand,
  ): Promise<AuthoredResult> {
    const envelopeInvalid = validateCommandEnvelope(command);
    if (envelopeInvalid) return envelopeInvalid;

    // 3. Validate payload
    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'command.payload is required', ['payload'])],
      };
    }

    const commitIdIssue = validateUuid(
      command.payload.commitId,
      ['payload', 'commitId'],
      'commitId',
    );
    if (commitIdIssue) {
      return { status: 'invalid', issues: [commitIdIssue] };
    }

    if (command.payload.expectedHeadId !== null) {
      const headIssue = validateUuid(
        command.payload.expectedHeadId,
        ['payload', 'expectedHeadId'],
        'expectedHeadId',
      );
      if (headIssue) {
        return { status: 'invalid', issues: [headIssue] };
      }
    }

    const message = command.payload.message?.trim() ?? '';
    if (message.length < 1 || message.length > 4000) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'too-long',
            'Commit message must be between 1 and 4,000 code points',
            ['payload', 'message'],
          ),
        ],
      };
    }

    const evidenceInvalid = validateEvidenceRefs(command.payload.evidence);
    if (evidenceInvalid) return evidenceInvalid;

    // 4. Compute request hash BEFORE transaction and check receipt first
    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
    if (replay) return replay;

    // 5. Pre-read project & branch state outside transaction
    const project = await this.db.projects.get(command.projectId);
    if (!project) {
      return { status: 'missing', ids: [command.projectId] };
    }

    // Not on main (invalid)
    if (command.branchId === project.mainBranchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Direct commit on main branch is rejected; main is changed only by publication',
            ['branchId'],
            command.branchId,
          ),
        ],
      };
    }

    const branch = await this.db.branches.get([command.projectId, command.branchId]);
    if (!branch) {
      return { status: 'missing', ids: [command.branchId] };
    }

    // Closed branch cannot be committed to (invalid).
    // Narrowest reading of closed branch semantics; closed branches are read-only until reopened.
    if (branch.state === 'closed') {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Cannot commit to a closed branch',
            ['branchId'],
            command.branchId,
          ),
        ],
      };
    }

    // Working revision compare
    if (branch.workingRevision !== command.expectedWorkingRevision) {
      return {
        status: 'stale',
        scope: 'branch',
        expected: command.expectedWorkingRevision,
        actual: branch.workingRevision,
      };
    }

    // Head compare (HEAD_MOVED)
    if (branch.headCommitId !== command.payload.expectedHeadId) {
      return {
        status: 'failed',
        code: 'conflict',
        issues: [
          createIssue(
            'structural-rule',
            'HEAD_MOVED: Branch head commit does not match expectedHeadId',
            ['payload', 'expectedHeadId'],
            command.payload.expectedHeadId,
          ),
        ],
      };
    }

    // Load branch's working snapshot
    const workingSnapshot = await this.db.snapshots.get([
      command.projectId,
      branch.workingSnapshotId,
    ]);
    if (!workingSnapshot) {
      return { status: 'missing', ids: [branch.workingSnapshotId] };
    }

    const evidenceCheck = await this.checkEvidence(command.projectId, workingSnapshot.document, command.payload.evidence, {
      document: 'working',
      zeroScenarios:
        'Branch working document has zero scenarios; at least one qualified scenario is required to commit',
    });
    if (evidenceCheck.status !== 'ok') return evidenceCheck;
    const { evidenceManifest, citedRuns } = evidenceCheck;

    const now = Date.now();
    const parentIds: readonly Id[] = branch.headCommitId !== null ? [branch.headCommitId] : [];
    const commitRow: CommitRecord = {
      projectId: command.projectId,
      id: command.payload.commitId,
      snapshotId: branch.workingSnapshotId,
      parentIds,
      evidence: command.payload.evidence,
      evidenceManifest,
      actor: command.actor,
      createdAt: now,
      message,
    };

    const commitBytes = calculateRecordBytes(commitRow);

    // 7. Atomic transaction
    return this.historyOperation().execute(
      { projectId: command.projectId, operationId: command.operationId, requestHash },
      async stores => {
        // Recheck branch
        const curBranch = await stores.branches.get([
          command.projectId,
          command.branchId,
        ]);
        if (!curBranch) {
          return { status: 'missing', ids: [command.branchId] };
        }

        if (curBranch.state === 'closed') {
          return {
            status: 'invalid',
            issues: [
              createIssue(
                'structural-rule',
                'Cannot commit to a closed branch',
                ['branchId'],
                command.branchId,
              ),
            ],
          };
        }

        if (curBranch.workingRevision !== command.expectedWorkingRevision) {
          return {
            status: 'stale',
            scope: 'branch',
            expected: command.expectedWorkingRevision,
            actual: curBranch.workingRevision,
          };
        }

        if (curBranch.headCommitId !== command.payload.expectedHeadId) {
          return {
            status: 'failed',
            code: 'conflict',
            issues: [
              createIssue(
                'structural-rule',
                'HEAD_MOVED: Branch head commit does not match expectedHeadId',
                ['payload', 'expectedHeadId'],
                command.payload.expectedHeadId,
              ),
            ],
          };
        }

        // Recheck project
        const curProject = await stores.projects.get(command.projectId);
        if (!curProject) {
          return { status: 'missing', ids: [command.projectId] };
        }

        // Inside the transaction, recheck that each cited run is unchanged since evaluation
        const changedRun = await this.findChangedCitedRun(command.projectId, command.payload.evidence, citedRuns, stores.runs);
        if (changedRun) return changedRun;

        // Enforce 1,000-commit limit and storage limits
        const limitError = await enforceProjectLimits(this.db, {
          projectId: command.projectId,
          additionalCommits: 1,
          additionalReceipts: 1,
          additionalLocalBytes: commitBytes,
          additionalExportBytes: commitBytes,
        }, stores);
        if (limitError) return limitError;

        const planner = new HistoryTransitionPlanner();
        const updatedBranch = planner.commit(curBranch, command.payload.commitId);
        const updatedProject = planner.project(curProject, now);
        const nextBranchRev = updatedBranch.workingRevision;
        const nextProjectRev = updatedProject.revision;
        const writes: OperationWrite<ProjectStorageRows>[] = [
          { kind: 'immutable', store: 'commits', key: [command.projectId, command.payload.commitId], row: commitRow },
          { kind: 'update', store: 'branches', key: [command.projectId, command.branchId], row: updatedBranch },
          { kind: 'update', store: 'projects', key: command.projectId, row: updatedProject },
        ];

        const appliedResult: AppliedResult = {
          status: 'applied',
          operationId: command.operationId,
          projectRevision: nextProjectRev,
          branchRevision: nextBranchRev,
          changedIds: [command.payload.commitId],
          undo: null,
          value: {
            kind: 'artifact',
            artifactType: 'commit',
            id: command.payload.commitId,
            revision: null,
          },
        };

        return { writes, result: appliedResult };
      },
    );
  }

  /**
   * Publishes an eligible candidate to main atomically (history.publish):
   * - Validated by unforgeable PublishTicket from CandidateController
   * - OUTSIDE: metadata validation, manifest build with current build versions, evidence qualification
   * - INSIDE: receipt check, project CAS, source & main CAS, main clean, recheck runs,
   *   version strictly greater, ordinal max + 1, limits, writes, source closed unless keepSourceOpen
   */
  async publish(
    ticket: unknown,
    command: HistoryPublishCommand,
  ): Promise<AuthoredResult> {
    // 1. Verify publish ticket against unforgeable WeakMap registry
    const ticketBinding = validatePublishTicket(ticket);
    if (!ticketBinding) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            'Publish ticket is missing, invalid, or forged; candidate tickets can only be minted by CandidateController',
            ['ticket'],
          ),
        ],
      };
    }

    const envelopeInvalid = validateCommandEnvelope(command);
    if (envelopeInvalid) return envelopeInvalid;

    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'command.payload is required', ['payload'])],
      };
    }

    const expProjRevIssue = validateRevision(
      command.payload.expectedProjectRevision,
      ['payload', 'expectedProjectRevision'],
      'expectedProjectRevision',
    );
    if (expProjRevIssue) {
      return { status: 'invalid', issues: [expProjRevIssue] };
    }

    const candIdIssue = validateUuid(
      command.payload.candidateId,
      ['payload', 'candidateId'],
      'candidateId',
    );
    if (candIdIssue) {
      return { status: 'invalid', issues: [candIdIssue] };
    }

    const pubIdIssue = validateUuid(
      command.payload.publicationId,
      ['payload', 'publicationId'],
      'publicationId',
    );
    if (pubIdIssue) {
      return { status: 'invalid', issues: [pubIdIssue] };
    }

    const mergeCommitIdIssue = validateUuid(
      command.payload.mergeCommitId,
      ['payload', 'mergeCommitId'],
      'mergeCommitId',
    );
    if (mergeCommitIdIssue) {
      return { status: 'invalid', issues: [mergeCommitIdIssue] };
    }

    // 4. Ticket binding consistency checks
    if (ticketBinding.candidateId !== command.payload.candidateId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Publish ticket candidateId '${ticketBinding.candidateId}' does not match command payload candidateId '${command.payload.candidateId}'`,
            ['payload', 'candidateId'],
            command.payload.candidateId,
          ),
        ],
      };
    }

    if (ticketBinding.projectId !== command.projectId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Publish ticket projectId '${ticketBinding.projectId}' does not match command projectId '${command.projectId}'`,
            ['projectId'],
            command.projectId,
          ),
        ],
      };
    }

    if (ticketBinding.sourceBranchId !== command.branchId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Publish ticket sourceBranchId '${ticketBinding.sourceBranchId}' does not match command branchId '${command.branchId}'`,
            ['branchId'],
            command.branchId,
          ),
        ],
      };
    }

    if (ticketBinding.expectedSourceRevision !== command.expectedWorkingRevision) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Publish ticket expectedSourceRevision '${ticketBinding.expectedSourceRevision}' does not match command expectedWorkingRevision '${command.expectedWorkingRevision}'`,
            ['expectedWorkingRevision'],
          ),
        ],
      };
    }

    if (ticketBinding.operationId !== command.operationId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Publish ticket operationId '${ticketBinding.operationId}' does not match command operationId '${command.operationId}'`,
            ['operationId'],
            command.operationId,
          ),
        ],
      };
    }

    // 5. Validate publication metadata
    const metadataIssues = validatePublicationMetadata(command.payload.metadata);
    if (metadataIssues.length > 0) {
      return { status: 'invalid', issues: metadataIssues };
    }
    const versionKey = deriveVersionKey(command.payload.metadata.version);

    // 6. Validate keepSourceOpen (defaults false when omitted)
    const keepSourceOpen = command.payload.keepSourceOpen ?? false;
    if (typeof keepSourceOpen !== 'boolean') {
      return {
        status: 'invalid',
        issues: [
          createIssue('wrong-type', 'payload.keepSourceOpen must be a boolean', [
            'payload',
            'keepSourceOpen',
          ]),
        ],
      };
    }

    const evidenceInvalid = validateEvidenceRefs(command.payload.evidence);
    if (evidenceInvalid) return evidenceInvalid;

    // 8. Candidate document validation against evidence
    const evidenceCheck = await this.checkEvidence(command.projectId, ticketBinding.document, command.payload.evidence, {
      document: 'candidate',
      zeroScenarios:
        'Candidate document has zero scenarios; at least one qualified scenario is required to publish',
    });
    if (evidenceCheck.status !== 'ok') return evidenceCheck;
    const { evidenceManifest, citedRuns } = evidenceCheck;

    // 10. Compute request hash BEFORE transaction and check early receipt
    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
    if (replay) return replay;

    // 11. Atomic transaction
    return this.historyOperation().execute(
      { projectId: command.projectId, operationId: command.operationId, requestHash },
      async stores => {
        // Project check
        const curProject = await stores.projects.get(command.projectId);
        if (!curProject) {
          return { status: 'missing', ids: [command.projectId] };
        }

        if (curProject.revision !== command.payload.expectedProjectRevision) {
          return {
            status: 'stale',
            scope: 'project',
            expected: command.payload.expectedProjectRevision,
            actual: curProject.revision,
          };
        }

        // Source branch check
        const curSource = await stores.branches.get([
          command.projectId,
          ticketBinding.sourceBranchId,
        ]);
        if (!curSource) {
          return { status: 'missing', ids: [ticketBinding.sourceBranchId] };
        }

        if (curSource.state === 'closed') {
          return {
            status: 'invalid',
            issues: [
              createIssue(
                'structural-rule',
                'Source branch is closed; cannot publish from a closed branch',
                ['branchId'],
                ticketBinding.sourceBranchId,
              ),
            ],
          };
        }

        if (curSource.workingRevision !== ticketBinding.expectedSourceRevision) {
          return {
            status: 'stale',
            scope: 'branch',
            expected: ticketBinding.expectedSourceRevision,
            actual: curSource.workingRevision,
          };
        }

        if (curSource.headCommitId !== ticketBinding.expectedSourceHeadId) {
          return {
            status: 'failed',
            code: 'conflict',
            issues: [
              createIssue(
                'structural-rule',
                'HEAD_MOVED: Source branch head commit changed since candidate was prepared',
                ['payload', 'candidateId'],
                ticketBinding.expectedSourceHeadId,
              ),
            ],
          };
        }

        // Main branch check
        const curMain = await stores.branches.get([
          command.projectId,
          ticketBinding.mainBranchId,
        ]);
        if (!curMain) {
          return { status: 'missing', ids: [ticketBinding.mainBranchId] };
        }

        if (curMain.workingRevision !== ticketBinding.expectedMainRevision) {
          return {
            status: 'stale',
            scope: 'branch',
            expected: ticketBinding.expectedMainRevision,
            actual: curMain.workingRevision,
          };
        }

        if (curMain.headCommitId !== ticketBinding.expectedMainHeadId) {
          return {
            status: 'failed',
            code: 'conflict',
            issues: [
              createIssue(
                'structural-rule',
                'HEAD_MOVED: Main branch head commit changed since candidate was prepared',
                ['payload', 'candidateId'],
                ticketBinding.expectedMainHeadId,
              ),
            ],
          };
        }

        // Main working snapshot == main head snapshot (or creation snapshot while unborn)
        if (curMain.headCommitId === null) {
          if (curMain.workingSnapshotId !== curProject.initialSnapshotId) {
            return {
              status: 'invalid',
              issues: [
                createIssue(
                  'structural-rule',
                  'Main branch has uncommitted working changes (working snapshot differs from creation snapshot while unborn)',
                  ['mainBranchId'],
                  curMain.id,
                ),
              ],
            };
          }
        } else {
          const mainHeadCommit = await stores.commits.get([
            command.projectId,
            curMain.headCommitId,
          ]);
          if (!mainHeadCommit) {
            return { status: 'missing', ids: [curMain.headCommitId] };
          }
          if (curMain.workingSnapshotId !== mainHeadCommit.snapshotId) {
            return {
              status: 'invalid',
              issues: [
                createIssue(
                  'structural-rule',
                  'Main branch has uncommitted working changes (working snapshot differs from head commit snapshot)',
                  ['mainBranchId'],
                  curMain.id,
                ),
              ],
            };
          }
        }

        // Inside the transaction, recheck that each cited run is unchanged since evaluation
        const changedRun = await this.findChangedCitedRun(command.projectId, command.payload.evidence, citedRuns, stores.runs);
        if (changedRun) return changedRun;

        // Check existing publications and version ordering
        const existingPublications = await this.db.publications
          .where('projectId')
          .equals(command.projectId)
          .toArray();

        const duplicateKeyPub = existingPublications.find(
          (p) => p.versionKey === versionKey,
        );
        if (duplicateKeyPub) {
          return {
            status: 'failed',
            code: 'duplicate-version',
            issues: [
              createIssue(
                'structural-rule',
                `Publication version '${versionKey}' already exists in project`,
                ['metadata', 'version'],
              ),
            ],
          };
        }

        if (existingPublications.length > 0) {
          existingPublications.sort((a, b) => a.ordinal - b.ordinal);
          const latestPub = existingPublications[existingPublications.length - 1];
          const cmp = compareSemanticVersions(
            command.payload.metadata.version,
            latestPub.metadata.version,
          );
          if (cmp === 0) {
            return {
              status: 'failed',
              code: 'duplicate-version',
              issues: [
                createIssue(
                  'structural-rule',
                  `Publication version '${versionKey}' already exists in project`,
                  ['metadata', 'version'],
                ),
              ],
            };
          }
          if (cmp < 0) {
            return {
              status: 'invalid',
              issues: [
                createIssue(
                  'out-of-range',
                  `Publication version '${versionKey}' must be strictly greater than latest publication version '${latestPub.versionKey}'`,
                  ['metadata', 'version'],
                ),
              ],
            };
          }
        }

        const previousMaxOrdinal = existingPublications.reduce(
          (max, p) => Math.max(max, p.ordinal),
          0,
        );
        const ordinal = previousMaxOrdinal + 1;

        // Merge commit parent IDs: [main head, source head] deduplicated (just [source head] when main is unborn)
        const planner = new HistoryTransitionPlanner();
        const parentIds = planner.publicationParents(curMain, curSource);

        const now = Date.now();
        const commitRow: CommitRecord = {
          projectId: command.projectId,
          id: command.payload.mergeCommitId,
          snapshotId: ticketBinding.snapshotId,
          parentIds,
          evidence: command.payload.evidence,
          evidenceManifest,
          actor: command.actor,
          createdAt: now,
          message: command.payload.metadata.title,
        };

        const publicationRow: PublicationRecord = {
          projectId: command.projectId,
          id: command.payload.publicationId,
          commitId: command.payload.mergeCommitId,
          sourceBranchId: ticketBinding.sourceBranchId,
          previousMainHeadId: curMain.headCommitId,
          ordinal,
          actor: command.actor,
          createdAt: now,
          metadata: command.payload.metadata,
          versionKey,
        };

        const snapshotRow: SnapshotRecord = {
          projectId: command.projectId,
          id: ticketBinding.snapshotId,
          document: ticketBinding.document,
        };

        // Project limits check
        const existingSnapshot = await stores.snapshots.get([
          command.projectId,
          ticketBinding.snapshotId,
        ]);
        let additionalBytes =
          calculateRecordBytes(commitRow) + calculateRecordBytes(publicationRow);
        if (!existingSnapshot) {
          additionalBytes += calculateRecordBytes(snapshotRow);
        }

        const limitError = await enforceProjectLimits(this.db, {
          projectId: command.projectId,
          additionalCommits: 1,
          additionalReceipts: 1,
          additionalLocalBytes: additionalBytes,
          additionalExportBytes: additionalBytes,
        }, stores);
        if (limitError) return limitError;

        const transitions = planner.publish(curMain, curSource, {
          commitId: command.payload.mergeCommitId, snapshotId: ticketBinding.snapshotId, keepSourceOpen,
        });
        const updatedProject = planner.project(curProject, now);
        const nextSourceRev = transitions.source.workingRevision;
        const nextProjectRev = updatedProject.revision;
        const writes: OperationWrite<ProjectStorageRows>[] = [];
        if (!existingSnapshot) writes.push({ kind: 'immutable', store: 'snapshots', key: [command.projectId, ticketBinding.snapshotId], row: snapshotRow });
        writes.push(
          { kind: 'immutable', store: 'commits', key: [command.projectId, command.payload.mergeCommitId], row: commitRow },
          { kind: 'immutable', store: 'publications', key: [command.projectId, command.payload.publicationId], row: publicationRow },
          { kind: 'update', store: 'branches', key: [command.projectId, curMain.id], row: transitions.main },
          { kind: 'update', store: 'branches', key: [command.projectId, curSource.id], row: transitions.source },
          { kind: 'update', store: 'projects', key: command.projectId, row: updatedProject },
        );

        const appliedResult: AppliedResult = {
          status: 'applied',
          operationId: command.operationId,
          projectRevision: nextProjectRev,
          branchRevision: nextSourceRev,
          changedIds: [command.payload.publicationId, command.payload.mergeCommitId],
          undo: null,
          value: {
            kind: 'artifact',
            artifactType: 'publication',
            id: command.payload.publicationId,
            revision: null,
          },
        };

        return { writes, result: appliedResult };
      },
    );
  }

  /**
   * Loads a publication by [projectId, publicationId]. Returns cloned, read-only record or null.
   */
  async loadPublication(
    projectId: Id,
    publicationId: Id,
  ): Promise<Readonly<PublicationRecord> | null> {
    try {
      const record = await this.db.publications.get([projectId, publicationId]);
      if (!record) return null;
      return Object.freeze(structuredClone(record));
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to load publication from database',
        issues: [createIssue('structural-rule', String(err), [], publicationId)],
      });
    }
  }

  /**
   * Lists all publications for a project. Returns cloned, read-only records.
   */
  async listPublications(projectId: Id): Promise<readonly Readonly<PublicationRecord>[]> {
    try {
      const records = await this.db.publications
        .where('projectId')
        .equals(projectId)
        .sortBy('ordinal');
      return Object.freeze(records.map((r) => Object.freeze(structuredClone(r))));
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to list publications from database',
        issues: [createIssue('structural-rule', String(err), [], projectId)],
      });
    }
  }

  // ==========================================================================
  // Run persistence and reads
  // ==========================================================================

  async saveRun(
    startToken: unknown, terminalResult: unknown, chunks?: unknown,
    options?: { projectId?: Id; document?: Document } | Id,
  ): Promise<SaveRunResult> {
    const service = new RunPersistenceService<FailedResult['code']>({
      validateToken: validateRunStartToken,
      loadSnapshot: (projectId, snapshotId) => this.db.snapshots.get([projectId, snapshotId]),
      loadRun: (projectId, runId) => this.db.runs.get([projectId, runId]),
      computeSnapshotId, calculateRecordBytes,
      checkRetention: (projectId, runId) => enforceRunRetentionLimits(this.db, projectId, runId),
      checkLimits: additions => enforceProjectLimits(this.db, additions),
      commit: artifacts => {
        type Rows = { runs: RunRecord; traceChunks: TraceChunkRecord; snapshots: SnapshotRecord };
        const records: ImmutableRecord<Rows>[] = [];
        if (artifacts.snapshot) records.push({ store: 'snapshots', key: [artifacts.snapshot.projectId, artifacts.snapshot.id], row: artifacts.snapshot });
        records.push({ store: 'runs', key: [artifacts.run.projectId, artifacts.run.id], row: artifacts.run });
        for (const row of artifacts.chunks) records.push({ store: 'traceChunks', key: [row.projectId, row.runId, row.index], row });
        return new ImmutableArtifactCoordinator<Rows, SaveRunResult>({
          backend: new IndexedDbBackend<Rows>(this.db, ['runs', 'traceChunks', 'snapshots']),
          policy: immutablePolicy<Rows>(),
          failed: error => {
            if (error instanceof RepositoryError && error.code === 'invalid') return {
              status: 'invalid', issues: error.issues ?? [createIssue('structural-rule', error.message)],
            };
            return mapErrorToFailedResult(error);
          },
        }).save(records, () => ({ status: 'applied', runId: artifacts.run.id, run: Object.freeze(structuredClone(artifacts.run)) }));
      },
    });
    return service.save(startToken, terminalResult, chunks, options);
  }
  async loadRun(projectId: Id, runId: Id): Promise<Readonly<RunRecord> | null> {
    try {
      const record = await this.db.runs.get([projectId, runId]);
      if (!record) return null;
      return Object.freeze(structuredClone(record));
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to load run from database',
        issues: [createIssue('structural-rule', String(err), [], runId)],
      });
    }
  }

  async listRuns(projectId: Id): Promise<readonly Readonly<RunRecord>[]> {
    try {
      const records = await this.db.runs.where('projectId').equals(projectId).toArray();
      return Object.freeze(records.map((r) => Object.freeze(structuredClone(r))));
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to list runs from database',
        issues: [createIssue('structural-rule', String(err), [], projectId)],
      });
    }
  }

  async runsByFingerprint(projectId: Id, fingerprint: string): Promise<readonly Readonly<RunRecord>[]> {
    try {
      const records = await this.db.runs
        .where('[projectId+fingerprint]')
        .equals([projectId, fingerprint])
        .toArray();
      return Object.freeze(records.map((r) => Object.freeze(structuredClone(r))));
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to query runs by fingerprint from database',
        issues: [createIssue('structural-rule', String(err), [], projectId)],
      });
    }
  }

  /**
   * Loads project, branches, commits, publications (by ordinal), checkpoints and
   * per-branch history in one consistent read-only transaction.
   *
   * Per-branch history is the commits reachable from that branch's head, newest first by
   * DAG order from the head, never by timestamp.
   * Order is breadth-first from the head following
   * `parentIds` in array order (head first, then its parents, then their parents, ...),
   * deduplicating shared merge ancestors on first visit. A dangling parent is skipped
   * here (never fabricated) -- `verifyReferenceIntegrity` is the authority that reports it.
   */
  async loadHistory(projectId: Id): Promise<HistoryLoadResult> {
    try {
      return await this.db.transaction(
        'r',
        [this.db.projects, this.db.branches, this.db.commits, this.db.publications, this.db.checkpoints],
        async () => {
          const project = await this.db.projects.get(projectId);
          if (!project) {
            throw new RepositoryError({
              code: 'not-found',
              message: `Project '${projectId}' not found`,
              id: projectId,
            });
          }
          const [branches, commits, publications, checkpoints] = await Promise.all([
            this.db.branches.where('projectId').equals(projectId).toArray(),
            this.db.commits.where('projectId').equals(projectId).toArray(),
            this.db.publications.where('projectId').equals(projectId).toArray(),
            this.db.checkpoints.where('projectId').equals(projectId).toArray(),
          ]);

          const commitById = new Map<Id, CommitRecord>(commits.map((c) => [c.id, c]));
          const sortedPublications = [...publications].sort((a, b) => a.ordinal - b.ordinal);

          const branchHistories = branches.map((branch) => ({
            branchId: branch.id,
            commits: computeBranchHistoryOrder(branch.headCommitId, commitById),
          }));

          return Object.freeze({
            project: Object.freeze(structuredClone(project)),
            branches: Object.freeze(branches.map((b) => Object.freeze(structuredClone(b)))),
            commits: Object.freeze(commits.map((c) => Object.freeze(structuredClone(c)))),
            publications: Object.freeze(
              sortedPublications.map((p) => Object.freeze(structuredClone(p))),
            ),
            checkpoints: Object.freeze(
              checkpoints.map((cp) => Object.freeze(structuredClone(cp))),
            ),
            branchHistories: Object.freeze(
              branchHistories.map((bh) =>
                Object.freeze({
                  branchId: bh.branchId,
                  commits: Object.freeze(bh.commits.map((c) => Object.freeze(structuredClone(c)))),
                }),
              ),
            ),
          });
        },
      );
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to load history from database',
        issues: [createIssue('structural-rule', String(err), [], projectId)],
      });
    }
  }

  /**
   * Verifies every stored reference resolves and every snapshot re-hashes to its own ID
   * Checks: commit parents and snapshots, branch head/working snapshots,
   * publication commits, checkpoint snapshots, evidence runs, and run snapshots. Never
   * repairs or fabricates content.
   */
  async verifyReferenceIntegrity(projectId: Id): Promise<ReferenceIntegrityResult> {
    let readResult: { missing: ReferenceIntegrityIssue[]; snapshots: readonly SnapshotRecord[] };
    try {
      // All reads and the (synchronous) reference-resolution checks happen inside one
      // consistent read-only transaction. Re-hashing (below, outside the transaction) is
      // pure computation over the snapshot documents this transaction already captured,
      // so it needs no further DB consistency guarantee; it is kept out of the
      // transaction because Dexie's transaction zone does not track awaits on
      // non-IndexedDB async work (e.g. Web Crypto), which would otherwise commit the
      // transaction prematurely ("PrematureCommitError").
      readResult = await this.db.transaction(
        'r',
        [
          this.db.projects,
          this.db.branches,
          this.db.commits,
          this.db.publications,
          this.db.checkpoints,
          this.db.runs,
          this.db.snapshots,
        ],
        async () => {
          const project = await this.db.projects.get(projectId);
          if (!project) {
            throw new RepositoryError({
              code: 'not-found',
              message: `Project '${projectId}' not found`,
              id: projectId,
            });
          }

          const [branches, commits, publications, checkpoints, runs, snapshots] = await Promise.all([
            this.db.branches.where('projectId').equals(projectId).toArray(),
            this.db.commits.where('projectId').equals(projectId).toArray(),
            this.db.publications.where('projectId').equals(projectId).toArray(),
            this.db.checkpoints.where('projectId').equals(projectId).toArray(),
            this.db.runs.where('projectId').equals(projectId).toArray(),
            this.db.snapshots.where('projectId').equals(projectId).toArray(),
          ]);

          const commitById = new Map(commits.map((c) => [c.id, c]));
          const runById = new Map(runs.map((r) => [r.id, r]));
          const snapshotById = new Map(snapshots.map((s) => [s.id, s]));
          const missing: ReferenceIntegrityIssue[] = [];

          const checkSnapshot = (
            snapshotId: string,
            kind: Extract<
              ReferenceIntegrityIssue['kind'],
              'project-initial-snapshot' | 'branch-working-snapshot' | 'commit-snapshot' | 'checkpoint-snapshot' | 'run-snapshot'
            >,
            referencedBy: { kind: string; id: string },
          ) => {
            if (!snapshotById.has(snapshotId)) {
              missing.push({ kind, id: snapshotId, referencedBy });
            }
          };

          checkSnapshot(project.initialSnapshotId, 'project-initial-snapshot', {
            kind: 'project',
            id: project.id,
          });

          for (const branch of branches) {
            checkSnapshot(branch.workingSnapshotId, 'branch-working-snapshot', {
              kind: 'branch',
              id: branch.id,
            });
            if (branch.headCommitId !== null && !commitById.has(branch.headCommitId)) {
              missing.push({
                kind: 'branch-head-commit',
                id: branch.headCommitId,
                referencedBy: { kind: 'branch', id: branch.id },
              });
            }
          }

          for (const commit of commits) {
            checkSnapshot(commit.snapshotId, 'commit-snapshot', { kind: 'commit', id: commit.id });
            for (const parentId of commit.parentIds) {
              if (!commitById.has(parentId)) {
                missing.push({
                  kind: 'commit-parent',
                  id: parentId,
                  referencedBy: { kind: 'commit', id: commit.id },
                });
              }
            }
            for (const ref of commit.evidence ?? []) {
              if (!runById.has(ref.runId)) {
                missing.push({
                  kind: 'evidence-run',
                  id: ref.runId,
                  referencedBy: { kind: 'commit', id: commit.id },
                });
              }
            }
          }

          for (const publication of publications) {
            if (!commitById.has(publication.commitId)) {
              missing.push({
                kind: 'publication-commit',
                id: publication.commitId,
                referencedBy: { kind: 'publication', id: publication.id },
              });
            }
          }

          for (const checkpoint of checkpoints) {
            checkSnapshot(checkpoint.snapshotId, 'checkpoint-snapshot', {
              kind: 'checkpoint',
              id: checkpoint.id,
            });
          }

          for (const run of runs) {
            checkSnapshot(run.snapshotId, 'run-snapshot', { kind: 'run', id: run.id });
          }

          return { missing, snapshots };
        },
      );
    } catch (err) {
      if (err instanceof RepositoryError) throw err;
      throw new RepositoryError({
        code: 'unavailable',
        message: 'Failed to verify reference integrity',
        issues: [createIssue('structural-rule', String(err), [], projectId)],
      });
    }

    // Re-hash every snapshot row captured by the transaction above: an ID that no longer
    // equals its content hash is reported as corrupt, never repaired.
    const missing = [...readResult.missing];
    for (const snapshot of readResult.snapshots) {
      let recomputed: string;
      try {
        recomputed = await computeSnapshotId(snapshot.document);
      } catch (err) {
        missing.push({
          kind: 'corrupt-snapshot',
          id: snapshot.id,
          referencedBy: { kind: 'snapshot', id: snapshot.id },
          detail: `snapshot document failed to canonicalize: ${String(err)}`,
        });
        continue;
      }
      if (recomputed !== snapshot.id) {
        missing.push({
          kind: 'corrupt-snapshot',
          id: snapshot.id,
          referencedBy: { kind: 'snapshot', id: snapshot.id },
          detail: `content hash '${recomputed}' does not match snapshot ID`,
        });
      }
    }

    if (missing.length === 0) {
      return { ok: true };
    }
    return { ok: false, missing };
  }

  /**
   * project.export-json. One consistent read-only
   * transaction; the canonical-json-v1 envelope is built and hashed OUTSIDE the
   * transaction (async Web Crypto is never awaited inside a Dexie transaction).
   * Excluded: operation receipts, preferences,
   * trace chunks, device-local actors/credentials, project revision, importSourceId.
   * Every exported run gets `traceState:'not-saved'`; checks/status/summary/manifest are
   * unchanged.
   */
  async exportProject(params: ExportProjectParams): Promise<ExportProjectResult> {
    return exportProjectArchive(params, {
      missingMintIdMessage: 'exportProject requires a LocalRepository constructed with an injected mintId; none was provided',
      mintId: this.mintId ?? undefined,
      limits: STORAGE_LIMITS,
      mapError: mapErrorToFailedResult,
      reader: { read: async ({ projectId, expectedProjectRevision }) => this.db.transaction(
        'r',
        [
          this.db.projects,
          this.db.branches,
          this.db.snapshots,
          this.db.commits,
          this.db.publications,
          this.db.checkpoints,
          this.db.runs,
          this.db.parts,
        ],
        async () => {
          const project = await this.db.projects.get(projectId);
          if (!project) {
            return { status: 'missing' as const, ids: [projectId] };
          }
          if (project.revision !== expectedProjectRevision) {
            return {
              status: 'stale' as const,
              scope: 'project' as const,
              expected: expectedProjectRevision,
              actual: project.revision,
            };
          }
          const [branches, snapshots, commits, publications, checkpoints, runs, parts] =
            await Promise.all([
              this.db.branches.where('projectId').equals(projectId).toArray(),
              this.db.snapshots.where('projectId').equals(projectId).toArray(),
              this.db.commits.where('projectId').equals(projectId).toArray(),
              this.db.publications.where('projectId').equals(projectId).toArray(),
              this.db.checkpoints.where('projectId').equals(projectId).toArray(),
              this.db.runs.where('projectId').equals(projectId).toArray(),
              this.db.parts.where('projectId').equals(projectId).toArray(),
            ]);
          return {
            status: 'read' as const,
            data: { project, branches, snapshots, commits, publications, checkpoints, runs, parts },
          };
        },
      ) },
    });
  }

  /**
   * project.import. Validates the bundle bound
   * to `fileToken` OUTSIDE any transaction (bundle-validate.ts is pure), then creates a
   * fresh project namespace in one transaction: receipt first, then the newProjectId
   * collision check, then the write. Every imported run becomes `imported-unverified`
   * with `traceState:'not-saved'` regardless of its exported traceState (the bundle is lossless
   * for authored content, history and check summaries, not for traces; an imported project
   * never carries trusted-local trace evidence in from outside).
   */
  async importProject(command: ProjectImportCommand): Promise<AuthoredResult> {
    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }
    const opIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIssue) {
      return { status: 'invalid', issues: [opIssue] };
    }
    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'command.payload is required', ['payload'])],
      };
    }
    const newProjectIdIssue = validateUuid(
      command.payload.newProjectId,
      ['payload', 'newProjectId'],
      'newProjectId',
    );
    if (newProjectIdIssue) {
      return { status: 'invalid', issues: [newProjectIdIssue] };
    }
    const newProjectId = command.payload.newProjectId;

    // FileToken resolution and bundle validation happen entirely OUTSIDE any transaction.
    const binding = this.fileTokens.resolveFile(command.payload.fileToken);
    if (!binding) {
      return { status: 'missing', ids: [] };
    }

    const validation = await validatePortableBundle(binding.bytes);
    if (!validation.ok) {
      if (validation.kind === 'unsupported-version') {
        return { status: 'failed', code: 'unsupported-version', issues: validation.issues };
      }
      return { status: 'invalid', issues: validation.issues };
    }
    const bundle = validation.bundle;

    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const now = Date.now();
    const projectRow: ProjectRecord = {
      id: newProjectId,
      title: bundle.title,
      revision: 0,
      mainBranchId: bundle.mainBranchId,
      initialSnapshotId: bundle.initialSnapshotId,
      importSourceId: bundle.id,
      createdAt: bundle.createdAt,
      updatedAt: bundle.updatedAt,
    };
    const branchRows: BranchRecord[] = bundle.branches.map((b) => ({ ...b, projectId: newProjectId }));
    const snapshotRows: SnapshotRecord[] = bundle.snapshots.map((s) => ({ ...s, projectId: newProjectId }));
    const commitRows: CommitRecord[] = bundle.commits.map((c) => ({ ...c, projectId: newProjectId }));
    const publicationRows: PublicationRecord[] = bundle.publications.map((p) => ({
      ...p,
      projectId: newProjectId,
    }));
    const checkpointRows: CheckpointRecord[] = bundle.checkpoints.map((cp) => ({
      ...cp,
      projectId: newProjectId,
    }));
    // Only the local repository sets provenance; portable input cannot claim
    // trusted-local. Every imported run is
    // 'imported-unverified' with traceState 'not-saved', regardless of the exported value.
    const runRows: RunRecord[] = bundle.runs.map((r) => ({
      ...r,
      projectId: newProjectId,
      provenance: 'imported-unverified' as const,
      traceState: 'not-saved' as const,
    }));
    // Parts remain in the backup for fidelity, but enter another Library only
    // through a standalone part import with a fresh identity.
    const partRows: PartRecord[] = [];

    const changedIds: Id[] = [
      newProjectId,
      ...branchRows.map((b) => b.id),
      ...commitRows.map((c) => c.id),
      ...publicationRows.map((p) => p.id),
    ];

    const appliedResult: AppliedResult = {
      status: 'applied',
      operationId: command.operationId,
      projectRevision: 0,
      branchRevision: null,
      changedIds,
      undo: null,
      value: { kind: 'project', projectId: newProjectId, branchId: bundle.mainBranchId },
    };

    // Import must also enforce byte limits, per-record
    // canonical sizes exactly as every other authored write does (see handleProjectCreate).
    // localBytes accounts every row this import will write, INCLUDING the operation
    // receipt (operations are local-only, per limits.ts's getProjectAccountedBytes);
    // exportBytes mirrors what exportProject would later re-derive (no receipts/trace
    // chunks -- runs already carry traceState:'not-saved' above).
    const receiptRow = { projectId: newProjectId, id: command.operationId, requestHash, result: appliedResult, createdAt: now };
    const sumBytes = (rows: readonly unknown[]): number =>
      rows.reduce((total: number, row) => total + calculateRecordBytes(row), 0);
    const localBytes =
      calculateRecordBytes(projectRow) +
      sumBytes(branchRows) +
      sumBytes(snapshotRows) +
      sumBytes(commitRows) +
      sumBytes(publicationRows) +
      sumBytes(checkpointRows) +
      sumBytes(runRows) +
      sumBytes(partRows) +
      calculateRecordBytes(receiptRow);
    const exportBytes =
      calculateRecordBytes(projectRow) +
      sumBytes(branchRows) +
      sumBytes(snapshotRows) +
      sumBytes(commitRows) +
      sumBytes(publicationRows) +
      sumBytes(checkpointRows) +
      sumBytes(runRows) +
      sumBytes(partRows);

    const records: ImmutableRecord<ProjectStorageRows>[] = [
      ...snapshotRows.map(row => ({ store: 'snapshots' as const, key: [row.projectId, row.id], row })),
      ...commitRows.map(row => ({ store: 'commits' as const, key: [row.projectId, row.id], row })),
      ...publicationRows.map(row => ({ store: 'publications' as const, key: [row.projectId, row.id], row })),
      ...checkpointRows.map(row => ({ store: 'checkpoints' as const, key: [row.projectId, row.id], row })),
      ...runRows.map(row => ({ store: 'runs' as const, key: [row.projectId, row.id], row })),
      ...partRows.map(row => ({ store: 'parts' as const, key: [row.projectId, row.id, row.revision], row })),
    ];
    return this.projectLifecycle<AuthoredResult>().create(
      { projectId: newProjectId, operationId: command.operationId, requestHash }, projectRow, {
        exists: () => ({ status: 'failed', code: 'conflict', issues: [
          createIssue('duplicate-id', `Project ${newProjectId} already exists`, ['payload', 'newProjectId'], newProjectId),
        ] }),
        check: stores => enforceProjectLimits(this.db, {
          projectId: newProjectId, additionalBranches: branchRows.length,
          additionalCommits: commitRows.length, additionalCheckpoints: checkpointRows.length,
          additionalRuns: runRows.length, additionalParts: partRows.length, additionalReceipts: 1,
          additionalLocalBytes: localBytes, additionalExportBytes: exportBytes,
        }, stores),
        initialize: async stores => {
          for (const row of branchRows) await stores.branches.add([row.projectId, row.id], row);
          await insertImmutableRecords(stores, records, immutablePolicy<ProjectStorageRows>());
        },
        result: appliedResult,
      },
    );
  }

  /**
   * pruneUnreferenced. Explicit only; recomputes the pin closure
   * from CURRENT rows inside the transaction (never a stale, pre-computed closure). A
   * selected pinned run in `runIds` (full row deletion) or a selected pinned snapshot
   * fails the whole call with `referenced-artifact` and deletes nothing. `traceRunIds`
   * MAY include pinned runs: it only ever deletes trace chunks and sets `traceState` to
   * `'pruned'`, leaving the run row (and its checks/status/summary) untouched, so it can
   * never break evidence pinning. Already-absent IDs on retry are reported, not treated as
   * an error.
   */
  async pruneUnreferenced(params: PruneUnreferencedParams): Promise<PruneUnreferencedResult> {
    const coordinator = new ArtifactPruningCoordinator<ProjectStorageRows, PruneUnreferencedResult>({
      backend: new IndexedDbBackend<ProjectStorageRows>(this.db, getProjectTables(this.db).map(table => table.name as keyof ProjectStorageRows), {
        traceChunks: [{ name: 'run', keyPath: ['projectId', 'runId'] }],
      }),
      traceIndex: 'run',
      missing: id => ({ status: 'missing', ids: [id] }),
      stale: (expected, actual) => ({ status: 'stale', scope: 'project', expected, actual }),
      failed: mapErrorToFailedResult,
      applied: changes => ({ status: 'applied', ...changes }),
      protect: async (_stores, project, { projectId, selection }) => {
        const [branches, commits, publications, checkpoints, runs] = await Promise.all([
          this.db.branches.where('projectId').equals(projectId).toArray(),
          this.db.commits.where('projectId').equals(projectId).toArray(),
          this.db.publications.where('projectId').equals(projectId).toArray(),
          this.db.checkpoints.where('projectId').equals(projectId).toArray(),
          this.db.runs.where('projectId').equals(projectId).toArray(),
        ]);

        const closure = computePinClosure(
          toPinClosureState({ project, branches, commits, publications, checkpoints, runs }),
        );
        const pinnedRunIds = new Set(closure.pinnedRunIds);

        // Pin closure treats every stored run as pinning its own snapshot "pinned or
        // not" (pin-closure.ts: "every stored run is retained until an explicit prune
        // removes it"). For deciding whether a SELECTED snapshot may be released by
        // THIS prune call, "any retained run" therefore means any run
        // that will still exist after this call -- so the gate and the later deletion
        // both use a closure computed with `selection.runIds` (full deletions, not
        // trace-only prunes) already removed, never the raw pre-mutation closure. This
        // is why selecting a run together with the snapshot it alone referenced can
        // succeed in one call ("a snapshot referenced only by a pruned run gets
        // released"), while a snapshot still reachable via a branch, commit, checkpoint,
        // or a run NOT in `selection.runIds` stays pinned and rejected.
        const runsExcludingDeletions = runs.filter((r) => !selection.runIds.includes(r.id));
        const closureExcludingDeletions = computePinClosure(
          toPinClosureState({ project, branches, commits, publications, checkpoints, runs: runsExcludingDeletions }),
        );
        const releasableSnapshotPins = new Set(closureExcludingDeletions.pinnedSnapshotIds);

        // Any selected pinned run (full row deletion) or pinned snapshot -> referenced-
        // artifact; nothing deleted. A pinned run in `traceRunIds` is NOT rejected here
        // : pruning trace chunks changes only traceState,
        // never checks or status, and pinning protects the evidence
        // run ROW (its fingerprint, checks, status, summary), not its trace bytes.
        // Trace-only pruning never removes the row a commit's evidence points at, so it
        // cannot break `referenced-artifact` integrity even when the run is pinned.
        const referencedIssues: Issue[] = [];
        for (const runId of selection.runIds) {
          if (pinnedRunIds.has(runId)) {
            referencedIssues.push(
              createIssue('structural-rule', `run '${runId}' is pinned (referenced as commit evidence)`, ['selection', 'runIds'], runId),
            );
          }
        }
        for (const snapshotId of selection.snapshotIds) {
          if (releasableSnapshotPins.has(snapshotId)) {
            referencedIssues.push(
              createIssue('structural-rule', `snapshot '${snapshotId}' is pinned`, ['selection', 'snapshotIds'], snapshotId),
            );
          }
        }
        if (referencedIssues.length > 0) {
          return { status: 'failed', code: 'referenced-artifact', issues: referencedIssues } as const;
        }

        return null;
      },
    });
    return coordinator.prune(params);
  }
}

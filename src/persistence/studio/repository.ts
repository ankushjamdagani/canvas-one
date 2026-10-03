/**
 * Local Repository implementation for System Studio (RV-16a).
 *
 * Implements specs/revamp/contracts/storage.md §5 (Repository API),
 * specs/revamp/contracts/transactions.md §1 & §2 (Idempotency, CAS, immutability),
 * and specs/revamp/contracts/commands.md (§2 Envelopes & Results, §3 Commands).
 */

import { canonicalJson, sha256Hex } from '../../domain/studio/canonical';
import { validateDocument, type Issue } from '../../domain/studio/validate';
import type { Document, Id, Scenario } from '../../domain/studio/model';
import { TERMINAL_STATUSES, type TraceEvent } from '../../domain/studio/runner/types';
import { codePointLength } from '../../domain/studio/text';
import { createStudioDatabase, StudioDatabase } from './db';
import { createIssue, mapErrorToFailedResult, RepositoryError } from './errors';
import {
  calculateRecordBytes,
  enforceProjectLimits,
  enforceRunRetentionLimits,
} from './limits';
import {
  computeRequestHash,
  computeSnapshotId,
  insertImmutable,
  isValidUuid,
  recordOperationReceipt,
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

export type LocalRepositoryOptions = {
  readonly buildVersions?: BuildManifestVersions;
  /** Injected downloadId/newProjectId-adjacent ID minting for transfer (RV-16b). */
  readonly mintId?: () => Id;
  /** Injected FileToken registry; defaults to a private instance owned by this repository. */
  readonly fileTokens?: FileTokenRegistry;
};

export class LocalRepository implements StudioRepository {
  private readonly db: StudioDatabase;
  private readonly buildVersions: BuildManifestVersions;
  /**
   * Injected downloadId minting (RV-16b review round 1, item 1). storage.md §5:
   * "downloadId comes from an injected mintId, never randomUUID by default" -- there is
   * no fallback generator of any kind (not even a deterministic one): a repository built
   * without one simply cannot mint a downloadId, and `exportProject` reports that as a
   * typed `invalid` naming `mintId` rather than inventing an ID.
   */
  private readonly mintId: (() => Id) | undefined;
  readonly fileTokens: FileTokenRegistry;
  private readonly partRepository: PartRepository;

  constructor(
    db?: StudioDatabase,
    options?: LocalRepositoryOptions | BuildManifestVersions,
  ) {
    this.db = db ?? createStudioDatabase();
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
      const record = await this.db.projects.get(projectId);
      if (!record) return null;
      return Object.freeze(structuredClone(record));
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
      const records = await this.db.projects.toArray();
      records.sort((a, b) => {
        if (a.title < b.title) return -1;
        if (a.title > b.title) return 1;
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      });
      return Object.freeze(records.map((r) => Object.freeze(structuredClone(r))));
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
      const record = await this.db.preferences.get('user');
      return record ? Object.freeze(structuredClone(record)) : null;
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
    try {
      return await this.db.transaction('rw', this.db.preferences, async () => {
        const existing = await this.db.preferences.get(key);

        if (existing) {
          if (existing.revision !== expectedRevision) {
            return {
              status: 'stale',
              scope: 'preferences',
              expected: expectedRevision,
              actual: existing.revision,
            };
          }
          const nextRevision = existing.revision + 1;
          const updated: PreferenceRecord = {
            key,
            schema: PREFERENCES_SCHEMA,
            revision: nextRevision,
            value: structuredClone(value),
          };
          await this.db.preferences.put(updated);
          return {
            status: 'applied',
            revision: nextRevision,
            value: Object.freeze(structuredClone(value)),
          };
        } else {
          if (expectedRevision !== 0) {
            return {
              status: 'stale',
              scope: 'preferences',
              expected: expectedRevision,
              actual: 0,
            };
          }
          const nextRevision = 1;
          const record: PreferenceRecord = {
            key,
            schema: PREFERENCES_SCHEMA,
            revision: nextRevision,
            value: structuredClone(value),
          };
          await this.db.preferences.put(record);
          return {
            status: 'applied',
            revision: nextRevision,
            value: Object.freeze(structuredClone(value)),
          };
        }
      });
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  /**
   * Deletes a project atomically using CAS on the main branch's head commit.
   * Returns missing/already-absent on retry.
   */
  async deleteProject(
    projectId: Id,
    expectedMainHead: ExpectedHead,
  ): Promise<DeleteProjectResult> {
    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const project = await this.db.projects.get(projectId);
          if (!project) {
            return { status: 'missing', ids: [projectId] };
          }

          const mainBranch = await this.db.branches.get([projectId, project.mainBranchId]);
          if (!mainBranch) {
            return { status: 'missing', ids: [projectId] };
          }

          if (mainBranch.headCommitId !== expectedMainHead) {
            return {
              status: 'stale',
              scope: 'branch',
              expected: expectedMainHead,
              actual: mainBranch.headCommitId,
            };
          }

          // Delete all records belonging to this projectId across all project-scoped tables
          await this.db.projects.delete(projectId);
          await this.db.branches.where('projectId').equals(projectId).delete();
          await this.db.snapshots.where('projectId').equals(projectId).delete();
          await this.db.commits.where('projectId').equals(projectId).delete();
          await this.db.publications.where('projectId').equals(projectId).delete();
          await this.db.checkpoints.where('projectId').equals(projectId).delete();
          await this.db.runs.where('projectId').equals(projectId).delete();
          await this.db.parts.where('projectId').equals(projectId).delete();
          await this.db.operations.where('projectId').equals(projectId).delete();
          await this.db.traceChunks
            .where('[projectId+runId]')
            .between([projectId, ''], [projectId, '\uffff'], true, true)
            .delete();

          return { status: 'applied', projectId };
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  /**
   * Executes an authored command within a single atomic read-write transaction.
   * In RV-16a, implements exactly:
   * - project.create
   * - project.rename
   * - branch.create
   *
   * All other commands return typed UnsupportedResult naming the owning task.
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
          task: 'RV-08',
          message: `Command ${command.commandId} is not yet implemented (owned by RV-08)`,
        };
      default:
        return {
          status: 'unsupported',
          task: 'RV-08',
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
  }): Promise<BranchRecord | MissingResult | StaleResult> {
    const branch = await this.db.branches.get([command.projectId, command.branchId]);
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

    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          // Check receipt FIRST before any other checks
          const replay = await replayedResult(this.db, projectId, command.operationId, requestHash);
          if (replay) return replay;

          // Check if project already exists
          const existingProject = await this.db.projects.get(projectId);
          if (existingProject) {
            return {
              status: 'failed',
              code: 'conflict',
              issues: [
                createIssue(
                  'duplicate-id',
                  `Project ${projectId} already exists`,
                  ['payload', 'newProjectId'],
                  projectId,
                ),
              ],
            };
          }

          // Check limits
          const limitError = await enforceProjectLimits(this.db, {
            projectId,
            additionalBranches: 2,
            additionalReceipts: 1,
            additionalLocalBytes: localBytes,
            additionalExportBytes: exportBytes,
          });
          if (limitError) return limitError;

          // Insert rows
          await insertImmutable(this.db.snapshots, snapshotRow, [projectId, snapshotId]);
          await this.db.branches.add(mainBranchRow);
          await this.db.branches.add(draftBranchRow);
          await this.db.projects.add(projectRow);

          // Store receipt
          await recordOperationReceipt(
            this.db,
            projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
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

    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
          if (replay) return replay;

          // Compare-and-set check on project revision
          const currentProject = await this.db.projects.get(command.projectId);
          if (!currentProject) {
            return { status: 'missing', ids: [command.projectId] };
          }

          if (currentProject.revision !== command.expectedProjectRevision) {
            return {
              status: 'stale',
              scope: 'project',
              expected: command.expectedProjectRevision,
              actual: currentProject.revision,
            };
          }

          // Compare-and-set check on active branch workingRevision
          const currentBranch = await this.loadBranchAtRevision(command);
          if ('status' in currentBranch) return currentBranch;

          // Check limits before mutation
          const addedLocalBytes = calculateRecordBytes(newSnapshotRow);
          const limitError = await enforceProjectLimits(this.db, {
            projectId: command.projectId,
            additionalReceipts: 1,
            additionalLocalBytes: addedLocalBytes,
            additionalExportBytes: addedLocalBytes,
          });
          if (limitError) return limitError;

          // Apply mutations
          await insertImmutable(this.db.snapshots, newSnapshotRow, [
            command.projectId,
            newSnapshotId,
          ]);

          const now = Date.now();
          const nextProjectRev = currentProject.revision + 1;
          const nextBranchRev = currentBranch.workingRevision + 1;

          await this.db.branches.update([command.projectId, command.branchId], {
            workingSnapshotId: newSnapshotId,
            workingRevision: nextBranchRev,
          });

          await this.db.projects.update(command.projectId, {
            title: newTitle,
            revision: nextProjectRev,
            updatedAt: now,
          });

          const appliedResult: AppliedResult = {
            status: 'applied',
            operationId: command.operationId,
            projectRevision: nextProjectRev,
            branchRevision: nextBranchRev,
            changedIds: [command.projectId, command.branchId],
            undo: null,
            value: { kind: 'none' },
          };

          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  /**
   * project.update-details (D52):
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
    if (issues.length > 0) return { status: 'invalid', issues };
    const description = payload.description.trim();
    const team = payload.team.trim();

    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    try {
      return await this.db.transaction('rw', getProjectTables(this.db), async () => {
        const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
        if (replay) return replay;

        const project = await this.db.projects.get(command.projectId);
        if (!project) return { status: 'missing', ids: [command.projectId] };
        if (project.revision !== command.expectedProjectRevision) {
          return {
            status: 'stale',
            scope: 'project',
            expected: command.expectedProjectRevision,
            actual: project.revision,
          };
        }

        const now = Date.now();
        const nextProjectRev = project.revision + 1;
        const updated: ProjectRecord = { ...project, description, team, revision: nextProjectRev, updatedAt: now };
        const limit = await enforceProjectLimits(this.db, {
          projectId: command.projectId,
          additionalReceipts: 1,
          additionalLocalBytes: calculateRecordBytes(updated) - calculateRecordBytes(project),
          additionalExportBytes: 0,
        });
        if (limit) return limit;

        await this.db.projects.update(command.projectId, { description, team, revision: nextProjectRev, updatedAt: now });

        const appliedResult: AppliedResult = {
          status: 'applied',
          operationId: command.operationId,
          projectRevision: nextProjectRev,
          branchRevision: null,
          changedIds: [command.projectId],
          undo: null,
          value: { kind: 'none' },
        };
        await recordOperationReceipt(this.db, command.projectId, command.operationId, requestHash, appliedResult);
        return appliedResult;
      });
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
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

    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
          if (replay) return replay;

          // Load project and source branch
          const project = await this.db.projects.get(command.projectId);
          if (!project) {
            return { status: 'missing', ids: [command.projectId] };
          }

          const sourceBranch = await this.db.branches.get([
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
          const existingBranch = await this.db.branches.get([
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
              const headCommit = await this.db.commits.get([
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
          const newBranchRow: BranchRecord = {
            projectId: command.projectId,
            id: newBranchId,
            label,
            state: 'open',
            headCommitId,
            workingSnapshotId,
            workingRevision: 0,
            createdAt: now,
          };

          // Check limits before mutation
          const branchBytes = calculateRecordBytes(newBranchRow);
          const limitError = await enforceProjectLimits(this.db, {
            projectId: command.projectId,
            additionalBranches: 1,
            additionalReceipts: 1,
            additionalLocalBytes: branchBytes,
            additionalExportBytes: branchBytes,
          });
          if (limitError) return limitError;

          // Add branch and bump project revision (source is not altered)
          await this.db.branches.add(newBranchRow);

          const nextProjectRev = project.revision + 1;
          await this.db.projects.update(command.projectId, {
            revision: nextProjectRev,
            updatedAt: now,
          });

          const appliedResult: AppliedResult = {
            status: 'applied',
            operationId: command.operationId,
            projectRevision: nextProjectRev,
            branchRevision: 0,
            changedIds: [newBranchId],
            undo: null,
            value: { kind: 'branch', branchId: newBranchId },
          };

          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
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

    // 3. Validate payload
    if (!command.payload || typeof command.payload !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'command.payload is required', ['payload'])],
      };
    }

    const changes = command.payload.changes;
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

    let requestHash: string;
    try {
      requestHash = await computeRequestHash(command);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const newSnapshotRow: SnapshotRecord = {
      projectId: command.projectId,
      id: newSnapshotId,
      document: updatedDocument,
    };

    // 6. Execute atomic transaction
    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
          if (replay) return replay;

          // Compare-and-set check on branch workingRevision
          const curBranch = await this.loadBranchAtRevision(command);
          if ('status' in curBranch) return curBranch;

          const curProject = await this.db.projects.get(command.projectId);
          if (!curProject) {
            return { status: 'missing', ids: [command.projectId] };
          }

          // Enforce limits before mutation
          const addedLocalBytes = calculateRecordBytes(newSnapshotRow);
          const limitError = await enforceProjectLimits(this.db, {
            projectId: command.projectId,
            additionalReceipts: 1,
            additionalLocalBytes: addedLocalBytes,
            additionalExportBytes: addedLocalBytes,
          });
          if (limitError) return limitError;

          // Write snapshot (insert-if-absent)
          await insertImmutable(this.db.snapshots, newSnapshotRow, [
            command.projectId,
            newSnapshotId,
          ]);

          const now = Date.now();
          const nextBranchRev = curBranch.workingRevision + 1;
          const nextProjectRev = curProject.revision + 1;

          await this.db.branches.update([command.projectId, command.branchId], {
            workingSnapshotId: newSnapshotId,
            workingRevision: nextBranchRev,
          });

          await this.db.projects.update(command.projectId, {
            revision: nextProjectRev,
            updatedAt: now,
          });

          const appliedResult: AppliedResult = {
            status: 'applied',
            operationId: command.operationId,
            projectRevision: nextProjectRev,
            branchRevision: nextBranchRev,
            changedIds: applied.changedIds,
            undo: null,
            value: { kind: 'none' },
          };

          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
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
    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
          if (replay) return replay;

          // Compare-and-set check on branch workingRevision
          const curBranch = await this.loadBranchAtRevision(command);
          if ('status' in curBranch) return curBranch;

          const curProject = await this.db.projects.get(command.projectId);
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
          });
          if (limitError) return limitError;

          // Insert immutable checkpoint
          await insertImmutable(this.db.checkpoints, checkpointRow, [
            command.projectId,
            command.payload.checkpointId,
          ]);

          // Working copy intact; project revision++
          const nextProjectRev = curProject.revision + 1;
          await this.db.projects.update(command.projectId, {
            revision: nextProjectRev,
            updatedAt: now,
          });

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

          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
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
    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
          if (replay) return replay;

          // Verify project and non-main
          const curProject = await this.db.projects.get(command.projectId);
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
          const curBranch = await this.loadBranchAtRevision(command);
          if ('status' in curBranch) return curBranch;

          // Re-verify target snapshot in transaction
          const curTarget = await this.db.snapshots.get([command.projectId, snapshotId]);
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
          });
          if (limitError) return limitError;

          // 1. Checkpoint current working state
          await insertImmutable(this.db.checkpoints, checkpointRow, [
            command.projectId,
            command.payload.checkpointId,
          ]);

          // 2. Replace working content with target snapshot (workingRevision++)
          const nextBranchRev = curBranch.workingRevision + 1;
          await this.db.branches.update([command.projectId, command.branchId], {
            workingSnapshotId: snapshotId,
            workingRevision: nextBranchRev,
          });

          // 3. Project revision++
          const nextProjectRev = curProject.revision + 1;
          await this.db.projects.update(command.projectId, {
            revision: nextProjectRev,
            updatedAt: now,
          });

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

          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
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
    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
          if (replay) return replay;

          const curProject = await this.db.projects.get(command.projectId);
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

          const curBranch = await this.db.branches.get([command.projectId, command.branchId]);
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
          });
          if (limitError) return limitError;

          // Set open via revision check; branch revision++; history and main unchanged
          const now = Date.now();
          const nextBranchRev = curBranch.workingRevision + 1;
          const nextProjectRev = curProject.revision + 1;

          await this.db.branches.update([command.projectId, command.branchId], {
            state: 'open',
            workingRevision: nextBranchRev,
          });

          await this.db.projects.update(command.projectId, {
            revision: nextProjectRev,
            updatedAt: now,
          });

          const appliedResult: AppliedResult = {
            status: 'applied',
            operationId: command.operationId,
            projectRevision: nextProjectRev,
            branchRevision: nextBranchRev,
            changedIds: [command.branchId],
            undo: null,
            value: { kind: 'branch', branchId: command.branchId },
          };

          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  /**
   * Inside a transaction: a failed/ineligible result when a cited run is gone or its
   * fingerprint, status, provenance or checks differ from the copy evaluated beforehand.
   */
  private async findChangedCitedRun(
    projectId: Id,
    evidence: readonly EvidenceRef[],
    citedRuns: readonly RunRecord[],
  ): Promise<FailedResult | null> {
    const ineligible = (ref: EvidenceRef, message: string): FailedResult => ({
      status: 'failed',
      code: 'ineligible',
      issues: [createIssue('structural-rule', message, ['evidence', ref.scenarioId], ref.runId)],
    });

    for (const ref of evidence) {
      const cachedRun = citedRuns.find((r) => r.id === ref.runId);
      const curRun = await this.db.runs.get([projectId, ref.runId]);
      if (!curRun || !cachedRun) {
        return ineligible(ref, `Cited evidence run '${ref.runId}' missing from database`);
      }

      const curChecks = canonicalJson(curRun.checks);
      const cachedChecks = canonicalJson(cachedRun.checks);
      if (
        curRun.fingerprint !== cachedRun.fingerprint ||
        curRun.status !== cachedRun.status ||
        curRun.provenance !== cachedRun.provenance ||
        !curChecks.ok ||
        !cachedChecks.ok ||
        curChecks.text !== cachedChecks.text
      ) {
        return ineligible(ref, `Cited evidence run '${ref.runId}' changed between evaluation and transaction`);
      }
    }
    return null;
  }

  /**
   * Validates cited evidence against `doc` outside any transaction (shared by commit and
   * publish): refs are well formed per scenario, every scenario has one, each cited run
   * exists and matches, and the run qualifies for a manifest built with the repository's
   * current build versions (never taken from the evidence).
   */
  private async checkEvidence(
    projectId: Id,
    doc: Document,
    evidence: readonly EvidenceRef[],
    labels: { readonly document: 'working' | 'candidate'; readonly zeroScenarios: string },
  ): Promise<
    | { readonly status: 'ok'; readonly evidenceManifest: EvidenceManifest; readonly citedRuns: RunRecord[] }
    | InvalidResult
    | FailedResult
  > {
    if (!doc.scenarios || doc.scenarios.length === 0) {
      return {
        status: 'failed',
        code: 'ineligible',
        issues: [
          createIssue(
            'structural-rule',
            labels.zeroScenarios,
            ['scenarios'],
          ),
        ],
      };
    }

    // Evidence ref validation against working document:
    // at most one ref per scenarioId; a ref for a scenario that isn't in the working document -> invalid
    const seenScenarioIds = new Set<Id>();
    const docScenarioMap = new Map<Id, Scenario>(doc.scenarios.map((s) => [s.id, s]));
    const refValidationIssues: Issue[] = [];

    for (let i = 0; i < evidence.length; i++) {
      const ref = evidence[i];
      if (seenScenarioIds.has(ref.scenarioId)) {
        refValidationIssues.push(
          createIssue(
            'duplicate-id',
            `Duplicate evidence ref for scenario '${ref.scenarioId}'`,
            ['payload', 'evidence', i],
            ref.scenarioId,
          ),
        );
      } else {
        seenScenarioIds.add(ref.scenarioId);
      }

      if (!docScenarioMap.has(ref.scenarioId)) {
        refValidationIssues.push(
          createIssue(
            'dangling-reference',
            `Evidence ref cites scenario '${ref.scenarioId}' which does not exist in ${labels.document} document`,
            ['payload', 'evidence', i],
            ref.scenarioId,
          ),
        );
      }
    }

    if (refValidationIssues.length > 0) {
      return { status: 'invalid', issues: refValidationIssues };
    }

    // Every scenario in the document must have a ref
    const refByScenarioId = new Map<Id, EvidenceRef>();
    for (const ref of evidence) {
      refByScenarioId.set(ref.scenarioId, ref);
    }

    for (const scenario of doc.scenarios) {
      if (!refByScenarioId.has(scenario.id)) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Scenario '${scenario.id}' has no qualifying evidence run`,
              ['evidence', scenario.id],
              scenario.id,
            ),
          ],
        };
      }
    }

    // A ref whose run is missing -> failed/ineligible naming the run;
    // run.scenarioId !== ref.scenarioId or run.fingerprint !== ref.fingerprint -> failed/ineligible
    for (const ref of evidence) {
      const runRec = await this.db.runs.get([projectId, ref.runId]);
      if (!runRec) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Cited evidence run '${ref.runId}' missing from database`,
              ['evidence', ref.scenarioId],
              ref.runId,
            ),
          ],
        };
      }

      // The run's scenario comes from its stored manifest; a run without one can't back a ref.
      const runScenarioId: unknown = (runRec.manifest as { scenario?: { id?: unknown } } | null)?.scenario?.id;
      if (typeof runScenarioId !== 'string' || runScenarioId !== ref.scenarioId) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Cited evidence run '${ref.runId}' scenarioId '${runScenarioId}' does not match ref scenarioId '${ref.scenarioId}'`,
              ['evidence', ref.scenarioId],
              ref.runId,
            ),
          ],
        };
      }

      if (runRec.fingerprint !== ref.fingerprint) {
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              `Cited evidence run '${ref.runId}' fingerprint '${runRec.fingerprint}' does not match ref fingerprint '${ref.fingerprint}'`,
              ['evidence', ref.scenarioId],
              ref.runId,
            ),
          ],
        };
      }
    }

    // 5. Eligibility computed OUTSIDE the transaction from the working snapshot:
    // Build manifest and fingerprint for each scenario using the repository's current build versions (never from evidence)
    // and verify that THAT ref's run qualifies (no other cited run stands in).
    const candidateScenarios: CandidateScenario[] = [];
    const citedRuns: RunRecord[] = [];

    for (const scenario of doc.scenarios) {
      const manifestRes = await buildManifest(doc, scenario.id, this.buildVersions);
      if (manifestRes.status !== 'ok') {
        const issues = manifestFailureIssues(scenario.id, manifestRes);
        return {
          status: 'failed',
          code: 'ineligible',
          issues,
        };
      }

      const ref = refByScenarioId.get(scenario.id)!;
      const runRec = (await this.db.runs.get([projectId, ref.runId]))!;

      const qualResult = runQualifies(runRec, {
        scenarioId: scenario.id,
        fingerprint: manifestRes.fingerprint,
        compiledScopeElementIds: manifestRes.manifest.scope.includedElementIds,
      });

      if (!qualResult.qualifies) {
        const message =
          runRec.status === 'incomplete'
            ? `Scenario '${scenario.id}' evidence run is incomplete`
            : `Scenario '${scenario.id}' evidence run is not qualifying: ${qualResult.reasons.join(', ')}`;
        return {
          status: 'failed',
          code: 'ineligible',
          issues: [
            createIssue(
              'structural-rule',
              message,
              ['evidence', scenario.id],
              scenario.id,
            ),
          ],
        };
      }

      candidateScenarios.push({
        scenarioId: scenario.id,
        fingerprint: manifestRes.fingerprint,
        scope: manifestRes.manifest.scope,
      });
      citedRuns.push(runRec);
    }


    return { status: 'ok', evidenceManifest: buildEvidenceManifest(candidateScenarios, citedRuns), citedRuns };
  }

  /**
   * history.commit:
   * Non-main branch; passing evidence for every scenario (run-identity.md §5).
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
    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
          if (replay) return replay;

          // Recheck branch
          const curBranch = await this.db.branches.get([
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
          const curProject = await this.db.projects.get(command.projectId);
          if (!curProject) {
            return { status: 'missing', ids: [command.projectId] };
          }

          // Inside the transaction, recheck that each cited run is unchanged since evaluation
          const changedRun = await this.findChangedCitedRun(command.projectId, command.payload.evidence, citedRuns);
          if (changedRun) return changedRun;

          // Enforce 1,000-commit limit and storage limits
          const limitError = await enforceProjectLimits(this.db, {
            projectId: command.projectId,
            additionalCommits: 1,
            additionalReceipts: 1,
            additionalLocalBytes: commitBytes,
            additionalExportBytes: commitBytes,
          });
          if (limitError) return limitError;

          // Insert immutable commit
          await insertImmutable(this.db.commits, commitRow, [
            command.projectId,
            command.payload.commitId,
          ]);

          // Advance branch head and increment workingRevision
          const nextBranchRev = curBranch.workingRevision + 1;
          await this.db.branches.update([command.projectId, command.branchId], {
            headCommitId: command.payload.commitId,
            workingRevision: nextBranchRev,
          });

          // Advance project revision
          const nextProjectRev = curProject.revision + 1;
          await this.db.projects.update(command.projectId, {
            revision: nextProjectRev,
            updatedAt: now,
          });

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

          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  /**
   * Publishes an eligible candidate to main atomically (RV-08e).
   *
   * storage.md §2 & §3, commands.md (history.publish), transactions.md §4:
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

    // 5. Validate metadata per storage.md §3
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
    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const replay = await replayedResult(this.db, command.projectId, command.operationId, requestHash);
          if (replay) return replay;

          // Project check
          const curProject = await this.db.projects.get(command.projectId);
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
          const curSource = await this.db.branches.get([
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
          const curMain = await this.db.branches.get([
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
            const mainHeadCommit = await this.db.commits.get([
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
          const changedRun = await this.findChangedCitedRun(command.projectId, command.payload.evidence, citedRuns);
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
          const parentIds: readonly Id[] =
            curMain.headCommitId === null
              ? [curSource.headCommitId!]
              : curMain.headCommitId === curSource.headCommitId
                ? [curMain.headCommitId]
                : [curMain.headCommitId, curSource.headCommitId!];

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
          const existingSnapshot = await this.db.snapshots.get([
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
          });
          if (limitError) return limitError;

          // Write snapshot (insert-if-absent)
          if (!existingSnapshot) {
            await insertImmutable(this.db.snapshots, snapshotRow, [
              command.projectId,
              ticketBinding.snapshotId,
            ]);
          }

          // Write merge commit
          await insertImmutable(this.db.commits, commitRow, [
            command.projectId,
            command.payload.mergeCommitId,
          ]);

          // Write publication
          await insertImmutable(this.db.publications, publicationRow, [
            command.projectId,
            command.payload.publicationId,
          ]);

          // Advance main head AND working snapshot to the merge commit/snapshot together
          const nextMainRev = curMain.workingRevision + 1;
          await this.db.branches.update([command.projectId, curMain.id], {
            headCommitId: command.payload.mergeCommitId,
            workingSnapshotId: ticketBinding.snapshotId,
            workingRevision: nextMainRev,
          });

          // Source branch: keeps its head and snapshot and is closed unless keepSourceOpen
          const nextSourceRev = curSource.workingRevision + 1;
          await this.db.branches.update([command.projectId, curSource.id], {
            state: keepSourceOpen ? 'open' : 'closed',
            workingRevision: nextSourceRev,
          });

          // Advance project revision
          const nextProjectRev = curProject.revision + 1;
          await this.db.projects.update(command.projectId, {
            revision: nextProjectRev,
            updatedAt: now,
          });

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

          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
            appliedResult,
          );

          return appliedResult;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
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
  // storage.md §5: Run persistence and reads (RV-08a)
  // ==========================================================================

  async saveRun(
    startToken: unknown,
    terminalResult: unknown,
    chunks?: unknown,
    options?: { projectId?: Id; document?: Document } | Id,
  ): Promise<SaveRunResult> {
    // 1. Verify start token against unforgeable registry
    const tokenBinding = validateRunStartToken(startToken);
    if (!tokenBinding) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Start token is invalid, forged, or not registered in the runner registry',
            ['startToken'],
          ),
        ],
      };
    }

    // 2. Validate token object against registry binding
    if (
      typeof startToken === 'object' &&
      startToken !== null &&
      ((startToken as any).runId !== tokenBinding.runId ||
        (startToken as any).snapshotId !== tokenBinding.snapshotId ||
        (startToken as any).fingerprint !== tokenBinding.fingerprint ||
        (startToken as any).projectId !== tokenBinding.projectId)
    ) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            'Start token object properties do not match registered binding',
            ['startToken'],
          ),
        ],
      };
    }

    // 3. Resolve project ID ONLY from the start token registry binding
    const projectId: Id = tokenBinding.projectId;
    if (!projectId || !isValidUuid(projectId)) {
      return {
        status: 'invalid',
        issues: [createIssue('invalid-id', 'Valid projectId is required in start token binding', ['projectId'])],
      };
    }

    // If caller-supplied projectId (options or terminalResult) disagrees with the binding -> invalid
    const callerProjectId = typeof options === 'string' ? options : options?.projectId;
    if (callerProjectId !== undefined && callerProjectId !== projectId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Caller-supplied projectId (${callerProjectId}) does not match start token binding (${projectId})`,
            ['projectId'],
          ),
        ],
      };
    }

    const termProjectId = (terminalResult as any)?.projectId;
    if (termProjectId !== undefined && termProjectId !== projectId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Terminal result projectId (${termProjectId}) does not match start token binding (${projectId})`,
            ['projectId'],
          ),
        ],
      };
    }

    // 4. Verify terminal result
    if (!terminalResult || typeof terminalResult !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('wrong-type', 'Terminal result must be an object', ['terminalResult'])],
      };
    }
    const term = terminalResult as any;

    // Requirement 3: terminalResult.runId must equal the binding's runId
    if (term.runId !== tokenBinding.runId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Run ID in terminal result (${String(term.runId)}) does not match start token binding (${tokenBinding.runId})`,
            ['runId'],
          ),
        ],
      };
    }

    // Requirement 3: terminal manifest fingerprint must equal the binding's fingerprint
    let termFingerprint =
      term.fingerprint ?? term.manifestFingerprint ?? (term.manifest as any)?.fingerprint;
    if (termFingerprint === undefined && term.manifest && typeof term.manifest === 'object') {
      try {
        const canon = canonicalJson(term.manifest);
        if (canon.ok) {
          termFingerprint = `ss-run-v1:${await sha256Hex(canon.text)}`;
        }
      } catch {
        // ignore error and let check fail below
      }
    }

    if (termFingerprint !== tokenBinding.fingerprint) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Manifest fingerprint in terminal result (${String(termFingerprint)}) does not match start token binding (${tokenBinding.fingerprint})`,
            ['fingerprint'],
          ),
        ],
      };
    }

    // Verify snapshotId match (if present on terminal result)
    if (term.snapshotId !== undefined && term.snapshotId !== tokenBinding.snapshotId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'structural-rule',
            `Snapshot ID in terminal result (${term.snapshotId}) does not match start token binding (${tokenBinding.snapshotId})`,
            ['snapshotId'],
          ),
        ],
      };
    }

    // Verify terminal status: only terminal statuses persist
    const status = term.status;
    if (!TERMINAL_STATUSES.includes(status)) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'invalid-literal',
            `Only terminal statuses persist; received non-terminal or unknown status '${String(status)}'`,
            ['status'],
          ),
        ],
      };
    }

    // Verify summary
    const summary = term.summary;
    if (!summary || typeof summary !== 'object') {
      return {
        status: 'invalid',
        issues: [createIssue('missing-property', 'Run summary is required to save run', ['summary'])],
      };
    }
    const checks = Array.isArray(term.checks) ? term.checks : [];

    // 5. Verify snapshot row exists or insert-if-absent from supplied document
    const snapshotKey: [string, string] = [projectId, tokenBinding.snapshotId];
    const existingSnapshot = await this.db.snapshots.get(snapshotKey);
    const documentToInsert: Document | undefined =
      typeof options === 'object' && options?.document
        ? options.document
        : tokenBinding.document ?? term.document;

    if (!existingSnapshot) {
      if (documentToInsert) {
        try {
          const computedSnapId = await computeSnapshotId(documentToInsert);
          if (computedSnapId !== tokenBinding.snapshotId) {
            return {
              status: 'invalid',
              issues: [
                createIssue(
                  'structural-rule',
                  `Provided document snapshot ID (${computedSnapId}) does not match token snapshot ID (${tokenBinding.snapshotId})`,
                  ['snapshotId'],
                ),
              ],
            };
          }
        } catch (err) {
          if (err instanceof RepositoryError && err.code === 'invalid') {
            return {
              status: 'invalid',
              issues: err.issues ?? [createIssue('structural-rule', err.message, ['document'])],
            };
          }
          throw err;
        }
      } else {
        return {
          status: 'invalid',
          issues: [
            createIssue(
              'dangling-reference',
              `Snapshot '${tokenBinding.snapshotId}' does not exist for project '${projectId}' and no document was supplied`,
              ['snapshotId'],
            ),
          ],
        };
      }
    }

    // 5. Check retention & limits before mutation
    const retentionLimitResult = await enforceRunRetentionLimits(this.db, projectId, tokenBinding.runId);
    if (retentionLimitResult) {
      return retentionLimitResult;
    }

    // Normalize chunks
    const chunkRecords: TraceChunkRecord[] = [];
    let chunksAreSaved = false;

    if (chunks !== null && chunks !== undefined) {
      chunksAreSaved = true;
      if (Array.isArray(chunks)) {
        if (chunks.length > 0) {
          if ('events' in chunks[0] && Array.isArray((chunks[0] as any).events)) {
            for (let i = 0; i < chunks.length; i++) {
              const c = chunks[i] as any;
              const events = c.events;
              const firstSeq = c.firstSequence ?? (events.length > 0 ? events[0].sequence : 0);
              const payloads = c.payloads ?? null;
              const bLength = c.byteLength ?? calculateRecordBytes(events);
              chunkRecords.push({
                projectId,
                runId: tokenBinding.runId,
                index: c.index ?? i,
                firstSequence: firstSeq,
                events,
                payloads,
                byteLength: bLength,
              });
            }
          } else if ('kind' in chunks[0] && 'sequence' in chunks[0]) {
            const events = chunks as readonly TraceEvent[];
            chunkRecords.push({
              projectId,
              runId: tokenBinding.runId,
              index: 0,
              firstSequence: events[0].sequence,
              events,
              payloads: null,
              byteLength: calculateRecordBytes(events),
            });
          }
        }
      }
    }

    const now = Date.now();
    const runRecord: RunRecord = {
      projectId,
      id: tokenBinding.runId,
      snapshotId: tokenBinding.snapshotId,
      manifest: tokenBinding.manifest,
      fingerprint: tokenBinding.fingerprint,
      status,
      provenance: 'local', // set ONLY by the repository!
      checks,
      summary,
      traceState: chunksAreSaved ? 'complete' : 'not-saved',
      createdAt: tokenBinding.createdAt ?? now,
      completedAt: term.completedAt ?? now,
    };

    // Calculate added bytes for project limits
    let addLocalBytes = calculateRecordBytes(runRecord);
    let addExportBytes = calculateRecordBytes({ ...runRecord, traceState: 'not-saved' });
    for (const chunk of chunkRecords) {
      addLocalBytes += calculateRecordBytes(chunk);
    }
    if (!existingSnapshot && documentToInsert) {
      const snapRecord = { projectId, id: tokenBinding.snapshotId, document: documentToInsert };
      const snapBytes = calculateRecordBytes(snapRecord);
      addLocalBytes += snapBytes;
      addExportBytes += snapBytes;
    }

    const byteLimitResult = await enforceProjectLimits(this.db, {
      projectId,
      additionalLocalBytes: addLocalBytes,
      additionalExportBytes: addExportBytes,
      additionalRuns: (await this.db.runs.get([projectId, tokenBinding.runId])) ? 0 : 1,
    });
    if (byteLimitResult) {
      return byteLimitResult;
    }

    // 6. Commit atomically in one transaction
    try {
      return await this.db.transaction(
        'rw',
        [this.db.runs, this.db.traceChunks, this.db.snapshots],
        async () => {
          if (!existingSnapshot && documentToInsert) {
            await insertImmutable(
              this.db.snapshots,
              {
                projectId,
                id: tokenBinding.snapshotId,
                document: documentToInsert,
              },
              [projectId, tokenBinding.snapshotId],
            );
          }

          // insertImmutable guarantees immutability (insert-if-absent, conflicting content fails with invalid)
          await insertImmutable(
            this.db.runs,
            runRecord,
            [projectId, tokenBinding.runId],
          );

          for (const chunk of chunkRecords) {
            await insertImmutable(
              this.db.traceChunks,
              chunk,
              [projectId, tokenBinding.runId, chunk.index],
            );
          }

          return {
            status: 'applied',
            runId: tokenBinding.runId,
            run: Object.freeze(structuredClone(runRecord)),
          };
        },
      );
    } catch (err: unknown) {
      if (err instanceof RepositoryError && err.code === 'invalid') {
        return {
          status: 'invalid',
          issues: err.issues ?? [createIssue('structural-rule', err.message)],
        };
      }
      return mapErrorToFailedResult(err);
    }
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
   * per-branch history in one consistent read-only transaction (RV-08f).
   *
   * Per-branch history is the commits reachable from that branch's head, newest first by
   * DAG order from the head, never by timestamp (storage.md §9 "round-trip reload").
   * CONTRACT GAP: the contract specifies "newest first by DAG order," not an exact
   * algorithm; narrowest reading chosen is breadth-first from the head following
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
   * (RV-08f). Checks: commit parents and snapshots, branch head/working snapshots,
   * publication commits, checkpoint snapshots, evidence runs, and run snapshots. Never
   * repairs or fabricates content (transactions.md §4).
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
   * project.export-json (RV-16b, storage.md §4 & §5). One consistent read-only
   * transaction; the canonical-json-v1 envelope is built and hashed OUTSIDE the
   * transaction (async Web Crypto is never awaited inside a Dexie transaction --
   * transactions.md §2). Excluded per storage.md §4: operation receipts, preferences,
   * trace chunks, device-local actors/credentials, project revision, importSourceId.
   * Every exported run gets `traceState:'not-saved'`; checks/status/summary/manifest are
   * unchanged.
   */
  async exportProject(params: ExportProjectParams): Promise<ExportProjectResult> {
    const { projectId, expectedProjectRevision } = params;

    // No `mintId` was injected at construction -- fail fast, before doing any work, rather
    // than inventing a downloadId (review round 1, item 1).
    if (!this.mintId) {
      return {
        status: 'invalid',
        issues: [
          createIssue(
            'missing-property',
            'exportProject requires a LocalRepository constructed with an injected mintId; none was provided',
            ['mintId'],
          ),
        ],
      };
    }
    const mintId = this.mintId;

    let read: {
      project: ProjectRecord;
      branches: BranchRecord[];
      snapshots: SnapshotRecord[];
      commits: CommitRecord[];
      publications: PublicationRecord[];
      checkpoints: CheckpointRecord[];
      runs: RunRecord[];
      parts: PartRecord[];
    };
    try {
      const outcome = await this.db.transaction(
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
      );
      if (outcome.status === 'missing' || outcome.status === 'stale') {
        return outcome;
      }
      read = outcome.data;
    } catch (err) {
      return mapErrorToFailedResult(err);
    }

    const stripProjectId = <T extends { projectId: Id }>(row: T): Omit<T, 'projectId'> => {
      const { projectId: _drop, ...rest } = row;
      return rest;
    };

    const bundle: ProjectBundle = {
      id: read.project.id,
      title: read.project.title,
      createdAt: read.project.createdAt,
      updatedAt: read.project.updatedAt,
      mainBranchId: read.project.mainBranchId,
      initialSnapshotId: read.project.initialSnapshotId,
      branches: read.branches.map(stripProjectId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      snapshots: read.snapshots
        .map(stripProjectId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      commits: read.commits.map(stripProjectId).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      publications: read.publications
        .map(stripProjectId)
        .sort((a, b) => a.ordinal - b.ordinal),
      checkpoints: read.checkpoints
        .map(stripProjectId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      runs: read.runs
        .map((r) => ({ ...stripProjectId(r), traceState: 'not-saved' as const }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      parts: read.parts
        .map(stripProjectId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision)),
    };

    const envelope = { format: PORTABLE_FORMAT, version: PORTABLE_VERSION, project: bundle };
    const canon = canonicalJson(envelope);
    if (!canon.ok) {
      return {
        status: 'failed',
        code: 'limit',
        issues: canon.issues,
      };
    }
    if (canon.bytes > STORAGE_LIMITS.maxExportEnvelopeBytes) {
      return {
        status: 'failed',
        code: 'limit',
        issues: [
          createIssue(
            'too-large',
            `Export envelope is ${canon.bytes} bytes, exceeding the ${STORAGE_LIMITS.maxExportEnvelopeBytes}-byte (64 MiB) cap; nothing was written`,
            [],
            projectId,
          ),
        ],
      };
    }

    let sha256: string;
    try {
      sha256 = await sha256Hex(canon.text);
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
    const bytes = new TextEncoder().encode(canon.text);
    const downloadId = mintId();

    return {
      status: 'done',
      value: { kind: 'download', downloadId },
      bytes,
      sha256,
    };
  }

  /**
   * project.import (RV-16b, commands.md §2/§3, storage.md §4). Validates the bundle bound
   * to `fileToken` OUTSIDE any transaction (bundle-validate.ts is pure), then creates a
   * fresh project namespace in one transaction: receipt first, then the newProjectId
   * collision check, then the write. Every imported run becomes `imported-unverified`
   * with `traceState:'not-saved'` regardless of its exported traceState (storage.md §4:
   * "the bundle is lossless for authored content, history and check summaries, not for
   * traces" -- an imported project never carries trusted-local trace evidence in from
   * outside).
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
    // storage.md §5: "Only the local repository sets provenance; portable input can't
    // claim trusted-local" (run-identity.md §5/§6). Every imported run is
    // 'imported-unverified' with traceState 'not-saved', regardless of the exported value.
    const runRows: RunRecord[] = bundle.runs.map((r) => ({
      ...r,
      projectId: newProjectId,
      provenance: 'imported-unverified' as const,
      traceState: 'not-saved' as const,
    }));
    // Parts remain in the backup for fidelity, but enter another Library only
    // through a standalone part import with a fresh identity (storage.md §4).
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

    // Review round 1, item 4: import must also enforce §6 byte limits, per-record
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

    try {
      return await this.db.transaction('rw', getProjectTables(this.db), async () => {
        const replay = await replayedResult(this.db, newProjectId, command.operationId, requestHash);
        if (replay) return replay;

        // 2. newProjectId already used by a different import -> rejected.
        const existingProject = await this.db.projects.get(newProjectId);
        if (existingProject) {
          return {
            status: 'failed',
            code: 'conflict',
            issues: [
              createIssue(
                'duplicate-id',
                `Project ${newProjectId} already exists`,
                ['payload', 'newProjectId'],
                newProjectId,
              ),
            ],
          } as const;
        }

        // 3. Project limits on the new namespace (§6, before writing anything): counts
        // AND accounted bytes (128 MiB local / 64 MiB export), exactly as every other
        // authored write enforces them.
        const limitError = await enforceProjectLimits(this.db, {
          projectId: newProjectId,
          additionalBranches: branchRows.length,
          additionalCommits: commitRows.length,
          additionalCheckpoints: checkpointRows.length,
          additionalRuns: runRows.length,
          additionalParts: partRows.length,
          additionalReceipts: 1,
          additionalLocalBytes: localBytes,
          additionalExportBytes: exportBytes,
        });
        if (limitError) return limitError;

        // 4. Write everything. Nothing becomes visible unless this whole transaction commits.
        await this.db.projects.add(projectRow);
        for (const row of branchRows) await this.db.branches.add(row);
        for (const row of snapshotRows) await insertImmutable(this.db.snapshots, row, [row.projectId, row.id]);
        for (const row of commitRows) await insertImmutable(this.db.commits, row, [row.projectId, row.id]);
        for (const row of publicationRows) {
          await insertImmutable(this.db.publications, row, [row.projectId, row.id]);
        }
        for (const row of checkpointRows) {
          await insertImmutable(this.db.checkpoints, row, [row.projectId, row.id]);
        }
        for (const row of runRows) await insertImmutable(this.db.runs, row, [row.projectId, row.id]);
        for (const row of partRows) {
          await insertImmutable(this.db.parts, row, [row.projectId, row.id, row.revision]);
        }

        await recordOperationReceipt(this.db, newProjectId, command.operationId, requestHash, appliedResult);

        return appliedResult;
      });
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }

  /**
   * pruneUnreferenced (RV-16b, storage.md §7). Explicit only; recomputes the pin closure
   * from CURRENT rows inside the transaction (never a stale, pre-computed closure). A
   * selected pinned run in `runIds` (full row deletion) or a selected pinned snapshot
   * fails the whole call with `referenced-artifact` and deletes nothing. `traceRunIds`
   * MAY include pinned runs: it only ever deletes trace chunks and sets `traceState` to
   * `'pruned'`, leaving the run row (and its checks/status/summary) untouched, so it can
   * never break evidence pinning. Already-absent IDs on retry are reported, not treated as
   * an error.
   */
  async pruneUnreferenced(params: PruneUnreferencedParams): Promise<PruneUnreferencedResult> {
    const { projectId, expectedProjectRevision, selection } = params;
    try {
      return await this.db.transaction(
        'rw',
        getProjectTables(this.db),
        async () => {
          const project = await this.db.projects.get(projectId);
          if (!project) {
            return { status: 'missing', ids: [projectId] } as const;
          }
          if (project.revision !== expectedProjectRevision) {
            return {
              status: 'stale',
              scope: 'project',
              expected: expectedProjectRevision,
              actual: project.revision,
            } as const;
          }

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
          const runById = new Map(runs.map((r) => [r.id, r]));

          // Pin closure treats every stored run as pinning its own snapshot "pinned or
          // not" (pin-closure.ts: "every stored run is retained until an explicit prune
          // removes it"). For deciding whether a SELECTED snapshot may be released by
          // THIS prune call, storage.md §7's "any retained run" therefore means any run
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
          // (review round 1, item 3): storage.md §7 says "Pruning trace chunks changes
          // only traceState, never checks or status," and pinning protects the evidence
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

          const alreadyAbsentIds: Id[] = [];
          const deletedRunIds: Id[] = [];
          const tracePrunedRunIds: Id[] = [];

          // traceRunIds: delete trace chunks and set traceState 'pruned' only.
          for (const runId of selection.traceRunIds) {
            const run = runById.get(runId);
            if (!run) {
              alreadyAbsentIds.push(runId);
              continue;
            }
            await this.db.traceChunks
              .where('[projectId+runId]')
              .equals([projectId, runId])
              .delete();
            if (run.traceState !== 'pruned') {
              await this.db.runs.put({ ...run, traceState: 'pruned' });
            }
            tracePrunedRunIds.push(runId);
          }

          // Selected unpinned runs: delete the run row and its chunks entirely.
          for (const runId of selection.runIds) {
            const run = runById.get(runId);
            if (!run) {
              alreadyAbsentIds.push(runId);
              continue;
            }
            await this.db.traceChunks
              .where('[projectId+runId]')
              .equals([projectId, runId])
              .delete();
            await this.db.runs.delete([projectId, runId]);
            deletedRunIds.push(runId);
          }

          // A snapshot is deleted only if unpinned in `closureExcludingDeletions`, computed
          // above BEFORE any mutation (the same closure already used for the
          // referenced-artifact gate, so every requested snapshotId here is guaranteed
          // either absent or already known-unpinned).
          const deletedSnapshotIds: Id[] = [];
          for (const snapshotId of selection.snapshotIds) {
            const existing = await this.db.snapshots.get([projectId, snapshotId]);
            if (!existing) {
              alreadyAbsentIds.push(snapshotId);
              continue;
            }
            await this.db.snapshots.delete([projectId, snapshotId]);
            deletedSnapshotIds.push(snapshotId);
          }

          const nextRevision = project.revision + 1;
          await this.db.projects.put({ ...project, revision: nextRevision, updatedAt: Date.now() });

          return {
            status: 'applied',
            projectRevision: nextRevision,
            deletedRunIds,
            tracePrunedRunIds,
            deletedSnapshotIds,
            alreadyAbsentIds,
          } as const;
        },
      );
    } catch (err) {
      return mapErrorToFailedResult(err);
    }
  }
}

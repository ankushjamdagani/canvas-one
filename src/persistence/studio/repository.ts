/**
 * Local Repository implementation for System Studio (RV-16a).
 *
 * Implements specs/revamp/contracts/storage.md §5 (Repository API),
 * specs/revamp/contracts/transactions.md §1 & §2 (Idempotency, CAS, immutability),
 * and specs/revamp/contracts/commands.md (§2 Envelopes & Results, §3 Commands).
 */

import { canonicalJson, sha256Hex } from '../../domain/studio/canonical';
import { validateDocument } from '../../domain/studio/validate';
import type { Document, Id } from '../../domain/studio/model';
import { TERMINAL_STATUSES, type TraceEvent } from '../../domain/studio/runner/types';
import { createStudioDatabase, StudioDatabase } from './db';
import { createIssue, mapErrorToFailedResult, RepositoryError } from './errors';
import {
  calculateRecordBytes,
  enforceProjectLimits,
  enforceRunRetentionLimits,
} from './limits';
import {
  checkOperationReceipt,
  computeRequestHash,
  computeSnapshotId,
  insertImmutable,
  isValidUuid,
  recordOperationReceipt,
  validateActor,
  validateRevision,
  validateUuid,
} from './primitives';
import { applyRecordChanges } from './apply-records';
import { validateRunStartToken } from './token';
import {
  PREFERENCES_SCHEMA,
  type AppliedResult,
  type AuthoredCommand,
  type AuthoredResult,
  type BranchCreateCommand,
  type BranchRecord,
  type BranchReopenCommand,
  type CheckpointRecord,
  type DeleteProjectResult,
  type ExpectedHead,
  type HistoryCheckpointCommand,
  type HistoryRestoreCommand,
  type ModelApplyRecordsCommand,
  type PreferenceRecord,
  type ProjectCreateCommand,
  type ProjectRecord,
  type ProjectRenameCommand,
  type RunRecord,
  type SavePreferencesResult,
  type SaveRunResult,
  type SnapshotRecord,
  type StudioRepository,
  type TraceChunkRecord,
  type UnsupportedResult,
} from './types';

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

export class LocalRepository implements StudioRepository {
  private readonly db: StudioDatabase;

  constructor(db?: StudioDatabase) {
    this.db = db ?? createStudioDatabase();
  }

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
      case 'project.create':
        return this.handleProjectCreate(command as ProjectCreateCommand);
      case 'project.rename':
        return this.handleProjectRename(command as ProjectRenameCommand);
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
      case 'history.prepare-publish':
      case 'history.publish':
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
          const receiptCheck = await checkOperationReceipt(
            this.db,
            projectId,
            command.operationId,
            requestHash,
          );
          if ('status' in receiptCheck) {
            return receiptCheck;
          }
          if (receiptCheck.isRetry) {
            return receiptCheck.result;
          }

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
    // 1. Actor validation
    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    // 2. Validate envelope IDs and revisions
    const opIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIssue) {
      return { status: 'invalid', issues: [opIssue] };
    }

    const projIssue = validateUuid(command.projectId, ['projectId'], 'projectId');
    if (projIssue) {
      return { status: 'invalid', issues: [projIssue] };
    }

    const branchIssue = validateUuid(command.branchId, ['branchId'], 'branchId');
    if (branchIssue) {
      return { status: 'invalid', issues: [branchIssue] };
    }

    const workingRevIssue = validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
    if (workingRevIssue) {
      return { status: 'invalid', issues: [workingRevIssue] };
    }

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
          // Check receipt FIRST before stale checks
          const receiptCheck = await checkOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
          );
          if ('status' in receiptCheck) {
            return receiptCheck;
          }
          if (receiptCheck.isRetry) {
            return receiptCheck.result;
          }

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
          const currentBranch = await this.db.branches.get([command.projectId, command.branchId]);
          if (!currentBranch) {
            return { status: 'missing', ids: [command.branchId] };
          }

          if (currentBranch.workingRevision !== command.expectedWorkingRevision) {
            return {
              status: 'stale',
              scope: 'branch',
              expected: command.expectedWorkingRevision,
              actual: currentBranch.workingRevision,
            };
          }

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
   * branch.create:
   * Creates a new branch from working content or head snapshot.
   * A head mismatch returns failed/conflict (HEAD_MOVED); a revision mismatch returns stale.
   */
  private async handleBranchCreate(
    command: BranchCreateCommand,
  ): Promise<AuthoredResult> {
    // 1. Actor validation
    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    // 2. Validate envelope IDs and revisions
    const opIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIssue) {
      return { status: 'invalid', issues: [opIssue] };
    }

    const projIssue = validateUuid(command.projectId, ['projectId'], 'projectId');
    if (projIssue) {
      return { status: 'invalid', issues: [projIssue] };
    }

    const branchIssue = validateUuid(command.branchId, ['branchId'], 'branchId');
    if (branchIssue) {
      return { status: 'invalid', issues: [branchIssue] };
    }

    const workingRevIssue = validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
    if (workingRevIssue) {
      return { status: 'invalid', issues: [workingRevIssue] };
    }

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
          // Check receipt FIRST before stale checks
          const receiptCheck = await checkOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
          );
          if ('status' in receiptCheck) {
            return receiptCheck;
          }
          if (receiptCheck.isRetry) {
            return receiptCheck.result;
          }

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
    // 1. Actor validation
    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    // 2. Validate envelope IDs and revisions
    const opIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIssue) {
      return { status: 'invalid', issues: [opIssue] };
    }

    const projIssue = validateUuid(command.projectId, ['projectId'], 'projectId');
    if (projIssue) {
      return { status: 'invalid', issues: [projIssue] };
    }

    const branchIssue = validateUuid(command.branchId, ['branchId'], 'branchId');
    if (branchIssue) {
      return { status: 'invalid', issues: [branchIssue] };
    }

    const workingRevIssue = validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
    if (workingRevIssue) {
      return { status: 'invalid', issues: [workingRevIssue] };
    }

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
          // Check receipt FIRST before stale checks
          const receiptCheck = await checkOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
          );
          if ('status' in receiptCheck) {
            return receiptCheck;
          }
          if (receiptCheck.isRetry) {
            return receiptCheck.result;
          }

          // Compare-and-set check on branch workingRevision
          const curBranch = await this.db.branches.get([command.projectId, command.branchId]);
          if (!curBranch) {
            return { status: 'missing', ids: [command.branchId] };
          }

          if (curBranch.workingRevision !== command.expectedWorkingRevision) {
            return {
              status: 'stale',
              scope: 'branch',
              expected: command.expectedWorkingRevision,
              actual: curBranch.workingRevision,
            };
          }

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
    // 1. Actor validation
    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    // 2. Validate envelope IDs and revisions
    const opIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIssue) {
      return { status: 'invalid', issues: [opIssue] };
    }

    const projIssue = validateUuid(command.projectId, ['projectId'], 'projectId');
    if (projIssue) {
      return { status: 'invalid', issues: [projIssue] };
    }

    const branchIssue = validateUuid(command.branchId, ['branchId'], 'branchId');
    if (branchIssue) {
      return { status: 'invalid', issues: [branchIssue] };
    }

    const workingRevIssue = validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
    if (workingRevIssue) {
      return { status: 'invalid', issues: [workingRevIssue] };
    }

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
          // Check receipt FIRST before stale checks
          const receiptCheck = await checkOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
          );
          if ('status' in receiptCheck) {
            return receiptCheck;
          }
          if (receiptCheck.isRetry) {
            return receiptCheck.result;
          }

          // Compare-and-set check on branch workingRevision
          const curBranch = await this.db.branches.get([command.projectId, command.branchId]);
          if (!curBranch) {
            return { status: 'missing', ids: [command.branchId] };
          }

          if (curBranch.workingRevision !== command.expectedWorkingRevision) {
            return {
              status: 'stale',
              scope: 'branch',
              expected: command.expectedWorkingRevision,
              actual: curBranch.workingRevision,
            };
          }

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
    // 1. Actor validation
    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    // 2. Validate envelope IDs and revisions
    const opIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIssue) {
      return { status: 'invalid', issues: [opIssue] };
    }

    const projIssue = validateUuid(command.projectId, ['projectId'], 'projectId');
    if (projIssue) {
      return { status: 'invalid', issues: [projIssue] };
    }

    const branchIssue = validateUuid(command.branchId, ['branchId'], 'branchId');
    if (branchIssue) {
      return { status: 'invalid', issues: [branchIssue] };
    }

    const workingRevIssue = validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
    if (workingRevIssue) {
      return { status: 'invalid', issues: [workingRevIssue] };
    }

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
          // Check receipt FIRST before stale checks
          const receiptCheck = await checkOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
          );
          if ('status' in receiptCheck) {
            return receiptCheck;
          }
          if (receiptCheck.isRetry) {
            return receiptCheck.result;
          }

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
          const curBranch = await this.db.branches.get([command.projectId, command.branchId]);
          if (!curBranch) {
            return { status: 'missing', ids: [command.branchId] };
          }

          if (curBranch.workingRevision !== command.expectedWorkingRevision) {
            return {
              status: 'stale',
              scope: 'branch',
              expected: command.expectedWorkingRevision,
              actual: curBranch.workingRevision,
            };
          }

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
    // 1. Actor validation
    const actorIssues = validateActor(command.actor);
    if (actorIssues) {
      return { status: 'invalid', issues: actorIssues };
    }

    // 2. Validate envelope IDs and revisions
    const opIssue = validateUuid(command.operationId, ['operationId'], 'operationId');
    if (opIssue) {
      return { status: 'invalid', issues: [opIssue] };
    }

    const projIssue = validateUuid(command.projectId, ['projectId'], 'projectId');
    if (projIssue) {
      return { status: 'invalid', issues: [projIssue] };
    }

    const branchIssue = validateUuid(command.branchId, ['branchId'], 'branchId');
    if (branchIssue) {
      return { status: 'invalid', issues: [branchIssue] };
    }

    const workingRevIssue = validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
    if (workingRevIssue) {
      return { status: 'invalid', issues: [workingRevIssue] };
    }

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
          // Check receipt FIRST before stale checks
          const receiptCheck = await checkOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            requestHash,
          );
          if ('status' in receiptCheck) {
            return receiptCheck;
          }
          if (receiptCheck.isRetry) {
            return receiptCheck.result;
          }

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

  async importProject(_validatedBundle: unknown): Promise<UnsupportedResult> {
    return {
      status: 'unsupported',
      task: 'RV-16b',
      message: 'importProject is not yet implemented (owned by RV-16b)',
    };
  }

  async exportProject(_projectId: Id): Promise<UnsupportedResult> {
    return {
      status: 'unsupported',
      task: 'RV-16b',
      message: 'exportProject is not yet implemented (owned by RV-16b)',
    };
  }

  async pruneUnreferenced(
    _projectId: Id,
    _selection: unknown,
  ): Promise<UnsupportedResult> {
    return {
      status: 'unsupported',
      task: 'RV-16b',
      message: 'pruneUnreferenced is not yet implemented (owned by RV-16b)',
    };
  }
}

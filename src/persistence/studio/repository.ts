/**
 * Local Repository implementation for System Studio (RV-16a).
 *
 * Implements specs/revamp/contracts/storage.md §5 (Repository API),
 * specs/revamp/contracts/transactions.md §1 & §2 (Idempotency, CAS, immutability),
 * and specs/revamp/contracts/commands.md (§2 Envelopes & Results, §3 Commands).
 */

import { validateDocument } from '../../domain/studio/validate';
import type { Document, Id } from '../../domain/studio/model';
import { createStudioDatabase, StudioDatabase } from './db';
import { createIssue, mapErrorToFailedResult, RepositoryError } from './errors';
import {
  calculateRecordBytes,
  enforceProjectLimits,
} from './limits';
import {
  checkOperationReceipt,
  computeRequestHash,
  computeSnapshotId,
  insertImmutable,
  recordOperationReceipt,
  validateActor,
  validateRevision,
  validateUuid,
} from './primitives';
import {
  PREFERENCES_SCHEMA,
  type AppliedResult,
  type AuthoredCommand,
  type AuthoredResult,
  type BranchCreateCommand,
  type BranchRecord,
  type DeleteProjectResult,
  type ExpectedHead,
  type PreferenceRecord,
  type ProjectCreateCommand,
  type ProjectRecord,
  type ProjectRenameCommand,
  type SavePreferencesResult,
  type SnapshotRecord,
  type StudioRepository,
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

  // ==========================================================================
  // storage.md §5: Unsupported port methods (owned by later tasks)
  // ==========================================================================

  async saveRun(
    _startToken: unknown,
    _terminalResult: unknown,
    _chunks: unknown,
  ): Promise<UnsupportedResult> {
    return {
      status: 'unsupported',
      task: 'RV-08a/RV-16b',
      message: 'saveRun is not yet implemented (owned by RV-08a/RV-16b)',
    };
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

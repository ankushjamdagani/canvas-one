/**
 * Storage and Repository types for System Studio: table records, command values and
 * results, the error model, the repository port and the portable bundle format.
 */

import type {
  Document,
  Id,
} from '../../domain/studio/model';
import type { RecordChange } from '../../domain/studio/records';
export { RECORD_KINDS } from '../../domain/studio/records';
export type { EditableRecord, RecordChange, RecordKind } from '../../domain/studio/records';
import type { ProjectExposure } from '../../domain/studio/exposure';
import type { CheckResult, RunSummary, TerminalStatus } from '../../domain/studio/runner/types';
import type { EvidenceRef, EvidenceManifest } from '../../domain/studio/runner/evidence';
import type { Issue } from '../../domain/studio/validate';
import type { BuildManifestVersions } from '../../domain/studio/manifest';

// ============================================================================
// Versions
// ============================================================================

export const DB_NAME = 'system-studio-local-v1';
export const DB_VERSION = 4;

export type AgentConversationArchiveRecord = {
  readonly key: string;
  readonly scopeKey: string;
  readonly id: string;
  readonly taskId?: string;
  readonly kind: 'message' | 'proposal' | 'operation' | 'context' | 'clarification';
  readonly state: 'open' | 'closed';
  readonly ordinal: number;
  readonly artifact: import('./agent-conversations').ConversationArtifact | import('./agent-conversations').ConversationOperation;
};

export type AgentConversationRecord = {
  readonly key: string;
  readonly revision: number;
  readonly serializedConversation: string;
};
export const PREFERENCES_SCHEMA = 'studio-preferences/1';

/** Durable board-scoped AI task metadata, separate from authored document mutations. */
export type AgentTaskLedgerRecord = {
  readonly key: string;
  readonly revision: number;
  readonly serializedLedger: string;
};

export { DEFAULT_BUILD_VERSIONS } from '@canvas-one/simulation-system-design/artifacts';

// ============================================================================
// Ceilings and Limits
// ============================================================================

export const STORAGE_LIMITS = {
  /** Maximum accounted local bytes per project: 128 MiB (134,217,728 bytes). */
  maxLocalProjectBytes: 128 * 1024 * 1024,
  /** Maximum export canonical envelope bytes: 64 MiB (67,108,864 bytes). */
  maxExportEnvelopeBytes: 64 * 1024 * 1024,
  /** Maximum branches per local project: 100. */
  maxBranchesPerProject: 100,
  /** Maximum commits per local project: 1,000. */
  maxCommitsPerProject: 1_000,
  /** Maximum checkpoints per local project: 100. */
  maxCheckpointsPerProject: 100,
  /** Maximum run summaries per local project: 200. */
  maxRunSummariesPerProject: 200,
  /** Maximum part revisions per local project: 100. */
  maxPartRevisionsPerProject: 100,
  /** Maximum operation receipts per local project: 100,000. */
  maxReceiptsPerProject: 100_000,
} as const;

// ============================================================================
// Actor
// ============================================================================

/**
 * Actor envelope:
 * { actorId, kind: 'local-human', displayName }
 * Unknown kinds are rejected.
 */
export type Actor = import('@canvas-one/whiteboard').Actor<'local-human'>;

// ============================================================================
// Publication Metadata
// ============================================================================

export type SemanticVersion = import('@canvas-one/history').SemanticVersion;

export type PublicationMetadata = import('@canvas-one/history').PublicationMetadata;

// ============================================================================
// Table Record Types
// ============================================================================

/**
 * projects table: primary key id
 * Fields: id, title, revision, mainBranchId, initialSnapshotId, importSourceId: Id | null, createdAt, updatedAt
 * Indexes: updatedAt
 */
export type ProjectRecord = import('@canvas-one/storage').ProjectRecord<{
  readonly mainBranchId: Id;
  readonly initialSnapshotId: string; // Hash
  readonly importSourceId: Id | null;
  /** Free-text details other projects show when they link here. Absent on older rows. */
  readonly description?: string;
  readonly team?: string;
  /** connection types other projects can connect to when they link here. Absent means none. */
  readonly exposures?: readonly ProjectExposure[];
}>;

export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;
export const PROJECT_TEAM_MAX_LENGTH = 60;

/** Details with absent fields read as empty (rows written before this field existed have none). */
export function projectDetails(project: Pick<ProjectRecord, 'description' | 'team'>): {
  readonly description: string;
  readonly team: string;
} {
  return { description: project.description ?? '', team: project.team ?? '' };
}

/** a project's exposed connection types; absent reads as none. */
export function projectExposures(project: Pick<ProjectRecord, 'exposures'>): readonly ProjectExposure[] {
  return project.exposures ?? [];
}

/**
 * branches table: primary key [projectId+id]
 * Fields: projectId, id, label, state: 'open' | 'closed', headCommitId: Id | null, workingSnapshotId, workingRevision, createdAt
 * Indexes: projectId
 */
export type BranchRecord = import('@canvas-one/history').BranchRecord;

/**
 * snapshots table: primary key [projectId+id] (id = content hash)
 * Fields: projectId, id, document
 * Indexes: projectId
 */
export type SnapshotRecord = import('@canvas-one/storage').SnapshotRecord<Document>;

/**
 * commits table: primary key [projectId+id]
 * Fields: projectId, id, snapshotId, parentIds, evidence: EvidenceRef[], actor, createdAt, message
 * Indexes: projectId
 */
export type CommitRecord = import('@canvas-one/history').CommitRecord<Actor, EvidenceRef, EvidenceManifest>;

/**
 * publications table: primary key [projectId+id]
 * Fields: projectId, id, commitId, sourceBranchId, previousMainHeadId: Id | null, ordinal, actor, createdAt, metadata, versionKey
 * Indexes: projectId; unique [projectId+ordinal]; unique [projectId+versionKey]
 */
export type PublicationRecord = import('@canvas-one/history').PublicationRecord<Actor>;

/**
 * checkpoints table: primary key [projectId+id]
 * Fields: projectId, id, snapshotId, sourceBranchId, label, actor, createdAt
 * Indexes: projectId
 */
export type CheckpointRecord = import('@canvas-one/history').CheckpointRecord<Actor>;

/**
 * runs table: primary key [projectId+id]
 * Fields: projectId, id, snapshotId, manifest, fingerprint, status, provenance, checks, summary, traceState, createdAt, completedAt
 * Indexes: projectId; [projectId+fingerprint]
 */
export type RunRecord = import('@canvas-one/simulation-system-design/artifacts').RunRecord;

/**
 * traceChunks table: primary key [projectId+runId+index]
 * Fields: projectId, runId, index, firstSequence, events, payloads, byteLength
 * Indexes: [projectId+runId]
 */
export type TraceChunkRecord = import('@canvas-one/simulation-system-design/artifacts').TraceChunkRecord;

/**
 * operations table: primary key [projectId+id]
 * Fields: projectId, id (operationId), requestHash, result, createdAt
 * Indexes: projectId
 */
export type OperationRecord = import('@canvas-one/storage').OperationReceipt<unknown>;

/**
 * parts table: primary key [projectId+id+revision]
 * Fields: projectId, id, revision, label, description, content, createdAt
 * Indexes: projectId; [projectId+id]
 */
export type PartRecord = import('@canvas-one/simulation-system-design/archive/contracts').PartRecord;

/**
 * preferences table: primary key key
 * Fields: key, schema: 'studio-preferences/1', revision, value
 * Indexes: none
 */
export type PreferenceRecord = import('@canvas-one/storage').PreferenceRecord<typeof PREFERENCES_SCHEMA, unknown>;

// ============================================================================
// Error Model
// ============================================================================

/**
 * Exactly the 9 error codes:
 * "not-found | invalid | stale | referenced-artifact | quota | unavailable |
 *  unsupported-version | operation-id-reused | limit", with structured issue paths and IDs.
 */
export type StorageErrorCode = import('@canvas-one/storage').StorageErrorCode;

// ============================================================================
// Command Values and Results
// ============================================================================

export type ExpectedHead = Id | null;

export type CommandValue =
  | { readonly kind: 'none' }
  | { readonly kind: 'project'; readonly projectId: Id; readonly branchId: Id }
  | { readonly kind: 'branch'; readonly branchId: Id }
  | {
      readonly kind: 'artifact';
      readonly artifactType: 'checkpoint' | 'commit' | 'publication' | 'part';
      readonly id: Id;
      readonly revision: number | null;
    }
  | { readonly kind: 'run'; readonly runId: Id }
  | {
      readonly kind: 'candidate';
      readonly candidateId: Id;
      readonly snapshotId: string;
      readonly conflictIds: readonly Id[];
    }
  | { readonly kind: 'draft'; readonly draftId: Id }
  | { readonly kind: 'download'; readonly downloadId: Id };

export type ProposalAttribution = import('@canvas-one/agents').ProposalAttribution;
export type AppliedResult = {
  readonly status: 'applied';
  readonly operationId: Id;
  readonly projectRevision: number;
  readonly branchRevision: number | null;
  readonly changedIds: readonly Id[];
  readonly undo: { readonly entryId: Id; readonly label: string } | null;
  readonly value: CommandValue;
  readonly proposal?: ProposalAttribution;
  readonly task?: import('@canvas-one/agents').AttemptBinding;
};

export type InvalidResult = {
  readonly status: 'invalid';
  readonly issues: readonly Issue[];
};

export type StaleResult = {
  readonly status: 'stale';
  readonly scope: 'project' | 'branch' | 'preferences';
  readonly expected: unknown;
  readonly actual: unknown;
};

export type MissingResult = {
  readonly status: 'missing';
  readonly ids: readonly Id[];
};

export type FailedCode = import('@canvas-one/storage').StorageFailedCode
  | 'ineligible'
  | 'conflict'
  | 'duplicate-version';

export type FailedResult = import('@canvas-one/storage').StorageFailure<Issue, FailedCode>;

export type UnsupportedResult = {
  readonly status: 'unsupported';
  readonly message: string;
};

export type AuthoredResult =
  | AppliedResult
  | InvalidResult
  | StaleResult
  | MissingResult
  | FailedResult;

export type SavePreferencesResult =
  | { readonly status: 'applied'; readonly revision: number; readonly value: unknown }
  | StaleResult
  | FailedResult;

export type DeleteProjectResult =
  | { readonly status: 'applied'; readonly projectId: Id }
  | MissingResult
  | StaleResult
  | FailedResult;

export type SaveRunResult = import('@canvas-one/simulation-system-design/artifacts').SaveRunResult<FailedCode>;

// ============================================================================
// History reads and reference integrity
// ============================================================================

/**
 * One branch's history for round-trip reload: the commits reachable
 * from that branch's head, newest first by DAG order from the head (never by timestamp).
 */
export type BranchHistoryEntry = {
  readonly branchId: Id;
  readonly commits: readonly Readonly<CommitRecord>[];
};

/**
 * `loadHistory(projectId)` result: project, branches, commits, publications (by ordinal)
 * and checkpoints, plus per-branch history, all read in one consistent read-only
 * transaction.
 */
export type HistoryLoadResult = {
  readonly project: Readonly<ProjectRecord>;
  readonly branches: readonly Readonly<BranchRecord>[];
  readonly commits: readonly Readonly<CommitRecord>[];
  readonly publications: readonly Readonly<PublicationRecord>[];
  readonly checkpoints: readonly Readonly<CheckpointRecord>[];
  readonly branchHistories: readonly BranchHistoryEntry[];
};

/**
 * A single broken or corrupt reference found by `verifyReferenceIntegrity`. Never
 * repaired or fabricated: missing or corrupt content returns
 * `missing` with IDs, and restore content is never fabricated.
 */
export type ReferenceIntegrityIssue = {
  readonly kind:
    | 'project-initial-snapshot'
    | 'branch-head-commit'
    | 'branch-working-snapshot'
    | 'commit-snapshot'
    | 'commit-parent'
    | 'evidence-run'
    | 'publication-commit'
    | 'checkpoint-snapshot'
    | 'run-snapshot'
    | 'corrupt-snapshot';
  readonly id: string;
  readonly referencedBy: { readonly kind: string; readonly id: string };
  readonly detail?: string;
};

/**
 * `verifyReferenceIntegrity(projectId)` result: {ok:true} when every
 * reference resolves and every snapshot re-hashes to its own ID; otherwise {ok:false,
 * missing:[{kind,id,referencedBy}]}.
 */
export type ReferenceIntegrityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: readonly ReferenceIntegrityIssue[] };

// ============================================================================
// Supported Authored Commands
// ============================================================================

export type ProjectCreateCommand = {
  readonly commandId: 'project.create';
  readonly operationId: Id;
  readonly actor: Actor;
  readonly payload: {
    readonly newProjectId: Id;
    readonly title: string;
    readonly initialDocument: Document;
    readonly mainBranchId: Id;
    readonly draftBranchId: Id;
  };
};

export type ProjectRenameCommand = {
  readonly commandId: 'project.rename';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly expectedProjectRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly title: string;
    readonly expectedProjectRevision?: number;
  };
};

/** edits the project record's description, team and exposed connection types only; no snapshot or branch changes. */
export type ProjectUpdateDetailsCommand = {
  readonly commandId: 'project.update-details';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly expectedProjectRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly description: string;
    readonly team: string;
    /** when present, replaces the project's exposed connection types. */
    readonly exposures?: readonly ProjectExposure[];
  };
};

export type BranchCreateCommand = {
  readonly commandId: 'branch.create';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id; // source branch
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly newBranchId: Id;
    readonly label: string;
    readonly source: 'working' | 'head';
    readonly expectedHeadId: ExpectedHead;
  };
};

export type ModelApplyRecordsCommand = {
  readonly commandId: 'model.apply-records';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly changes: readonly RecordChange[];
    readonly proposal?: ProposalAttribution;
    readonly taskAuthority?: import('@canvas-one/agents').AttemptBinding;
    readonly expectedRecords?: readonly import('@canvas-one/system-design/session/contracts').LiveTaskTarget[];
  };
};

export type HistoryCheckpointCommand = import('@canvas-one/history').HistoryCheckpointCommand<Actor>;

export type HistoryRestoreCommand = import('@canvas-one/history').HistoryRestoreCommand<Actor>;

export type BranchReopenCommand = {
  readonly commandId: 'branch.reopen';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly expectedHeadId: ExpectedHead;
  };
};

export type HistoryCommitCommand = import('@canvas-one/history').HistoryCommitCommand<Actor, EvidenceRef>;

export type HistoryPublishPayload = import('@canvas-one/history').HistoryPublishPayload<EvidenceRef>;

export type HistoryPublishCommand = import('@canvas-one/history').HistoryPublishCommand<Actor, EvidenceRef>;

export type GenericCommand = {
  readonly commandId: string;
  readonly operationId?: Id;
  readonly projectId?: Id;
  readonly branchId?: Id;
  readonly expectedWorkingRevision?: number;
  readonly expectedProjectRevision?: number;
  readonly actor?: Actor;
  readonly payload?: unknown;
};

export type AuthoredCommand =
  | ProjectCreateCommand
  | ProjectRenameCommand
  | ProjectUpdateDetailsCommand
  | BranchCreateCommand
  | ModelApplyRecordsCommand
  | HistoryCheckpointCommand
  | HistoryRestoreCommand
  | HistoryCommitCommand
  | BranchReopenCommand
  | HistoryPublishCommand
  | GenericCommand;

// ============================================================================
// Controller commands & Branch Switch
// ============================================================================

export type DraftResolution = 'clean' | 'applied' | 'discarded' | 'stay';

export type SwitchBranchFailedStep =
  | 'flush-pending-save'
  | 'resolve-draft'
  | 'load-target-branch';

export type SwitchBranchSuccess = {
  readonly status: 'done';
  readonly activeBranchId: Id;
  readonly branch: Readonly<BranchRecord>;
  readonly value: { readonly kind: 'branch'; readonly branchId: Id };
};

export type SwitchBranchFailure = {
  readonly status: 'failed';
  readonly step: SwitchBranchFailedStep;
  readonly activeBranchId: Id | null;
  readonly reason: string;
  readonly error?: unknown;
};

export type SwitchBranchResult = SwitchBranchSuccess | SwitchBranchFailure;

export type SwitchBranchContext =
  | {
      readonly repo: StudioRepository;
      readonly currentBranchId?: Id | null;
    }
  | StudioRepository;

export type SwitchBranchOptions = {
  readonly flushPendingSave?: () => Promise<unknown>;
  readonly resolveDraft?: () => Promise<DraftResolution>;
};

// ============================================================================
// Save Failure & Recovery
// ============================================================================

export type SaveFailureRecoveryAction = import('@canvas-one/storage').SaveFailureRecoveryAction;

export type SaveFailureRecoveryOption = import('@canvas-one/storage').SaveFailureRecoveryOption;

export type SaveFailureRecoveryInfo = import('@canvas-one/storage').SaveFailureRecoveryInfo;

// ============================================================================
// Repository API
// ============================================================================

/**
 * Repository port interface.
 * All nine methods of the repository contract.
 */
export interface StudioRepository {
  holdAgentTaskAction?(binding: import('@canvas-one/agents').AttemptBinding, document: Document, changes: readonly RecordChange[]): void;
  clearAgentTaskOverlap?(binding: import('@canvas-one/agents').AttemptBinding): void;
  listAgentTaskActions?(scope: import('@canvas-one/agents').TaskScope, taskId: string): Promise<readonly import('./agent-action-journal').AgentTaskActionRecord[]>;
  readonly agentExecutionLeases?: import('@canvas-one/agents').BrowserTaskLeaseRegistry;
  createAgentConversationStorage?(scope: import('@canvas-one/agents').TaskScope): import('./agent-conversations').AgentConversationStorage;
  createAgentTaskStorage?(scope: import('@canvas-one/agents').TaskScope): import('@canvas-one/agents').TaskStorage;
  replayAgentTaskAction?(command: ModelApplyRecordsCommand): Promise<AuthoredResult | null>;
  /** Detached parts belong only to this project's Library. */
  previewPart(source: import('./parts').PartCaptureSource): Promise<import('./parts').PartCapturePreview | AuthoredResult>;
  listParts(projectId: Id): Promise<readonly PartRecord[]>;
  exportPart(projectId: Id, partId: Id, revision: number): Promise<ExportProjectResult>;
  /** Queries return cloned, read-only project record or null if not found. */
  loadProject(projectId: Id): Promise<Readonly<ProjectRecord> | null>;

  /** Lists all projects sorted by title then id. Returns cloned, read-only records. */
  listProjects(): Promise<readonly ProjectRecord[]>;

  /** Queries return cloned, read-only branch record or null if not found. */
  loadBranch(projectId: Id, branchId: Id): Promise<Readonly<BranchRecord> | null>;

  /** Queries return cloned, read-only commit record or null if not found. */
  loadCommit(projectId: Id, commitId: Id): Promise<Readonly<CommitRecord> | null>;

  /** Queries return cloned, read-only snapshot record or null if not found. */
  loadSnapshot(projectId: Id, snapshotId: string): Promise<Readonly<SnapshotRecord> | null>;

  /** Authored commands resolve to one transaction plus an operation receipt. */
  execute(command: AuthoredCommand): Promise<AuthoredResult | UnsupportedResult>;

  /** Preferences have their own compare-and-set and schema studio-preferences/1. */
  loadPreferences(): Promise<Readonly<PreferenceRecord> | null>;

  /** Preferences have their own compare-and-set and schema studio-preferences/1. */
  savePreferences(expectedRevision: number, value: unknown): Promise<SavePreferencesResult>;

  /** CAS deletion by expected main branch head commit ID. Missing/already-absent on retry. */
  deleteProject(projectId: Id, expectedMainHead: ExpectedHead): Promise<DeleteProjectResult>;

  /**
   * Commits the terminal summary, manifest, checks and retained chunks atomically.
   * Verified by unforgeable RunStartToken; snapshot insert-if-absent from document;
   * provenance 'local' set ONLY by repository; traceState 'complete' when chunks saved.
   */
  saveRun(
    startToken: unknown,
    terminalResult: unknown,
    chunks?: unknown,
    options?: { projectId?: Id; document?: Document } | Id,
  ): Promise<SaveRunResult>;

  /** Loads a run by [projectId, runId]. Returns cloned, read-only record or null if not found. */
  loadRun(projectId: Id, runId: Id): Promise<Readonly<RunRecord> | null>;

  /** Lists all runs for a project. Returns cloned, read-only records. */
  listRuns(projectId: Id): Promise<readonly Readonly<RunRecord>[]>;

  /** Finds runs for a project matching an execution fingerprint using [projectId+fingerprint] index. */
  runsByFingerprint(projectId: Id, fingerprint: string): Promise<readonly Readonly<RunRecord>[]>;

  /**
   * Publishes a candidate to main atomically.
   * Verified by unforgeable PublishTicket from CandidateController;
   * source and main CAS, runs rechecked, version strictly greater, source closed by default.
   */
  publish(
    ticket: unknown,
    command: HistoryPublishCommand,
  ): Promise<AuthoredResult>;

  /** Loads a publication by [projectId, publicationId]. Returns cloned, read-only record or null. */
  loadPublication(projectId: Id, publicationId: Id): Promise<Readonly<PublicationRecord> | null>;

  /** Lists all publications for a project. Returns cloned, read-only records. */
  listPublications(projectId: Id): Promise<readonly Readonly<PublicationRecord>[]>;

  /**
   * project.import: validates the bundle bound to `fileToken` outside any
   * transaction, then creates a fresh project namespace in one transaction. Unknown or
   * expired token -> missing; invalid bundle -> invalid; reused newProjectId -> failed/conflict.
   */
  importProject(command: ProjectImportCommand): Promise<AuthoredResult>;

  /**
   * project.export-json: one consistent read-only transaction; canonical-json-v1
   * envelope bytes of `{format:'system-studio',version:9,project:ProjectBundle}`, capped
   * at 64 MiB (export always fits).
   */
  exportProject(params: ExportProjectParams): Promise<ExportProjectResult>;

  /**
   * pruneUnreferenced: explicit-only trace/run/snapshot pruning in one
   * transaction, recomputing the pin closure from current rows.
   */
  pruneUnreferenced(params: PruneUnreferencedParams): Promise<PruneUnreferencedResult>;

  /**
   * Loads project, branches, commits, publications (by ordinal), checkpoints and
   * per-branch history in one consistent read-only transaction
   * (round-trip reload). Throws a `RepositoryError` (code `not-found`) if the project
   * does not exist.
   */
  loadHistory(projectId: Id): Promise<HistoryLoadResult>;

  /**
   * Verifies every stored reference resolves and every snapshot re-hashes to its own ID.
   * Never repairs or fabricates content.
   * Throws a `RepositoryError` (code `not-found`) if the project does not exist.
   */
  verifyReferenceIntegrity(projectId: Id): Promise<ReferenceIntegrityResult>;
}

export type { MintRunStartTokenParams, RunStartToken } from './token';
export type { MintPublishTicketParams, PublishTicket, PublishTicketBinding } from './publish-ticket';
export type { FileToken, FileTokenBinding } from './file-tokens';

// ============================================================================
// Portable bundle
// ============================================================================

/** The portable file's fixed format discriminator and version. */
export { PORTABLE_FORMAT, PORTABLE_VERSION } from '@canvas-one/simulation-system-design/archive/contracts';
export type BundleBranchRecord = import('@canvas-one/simulation-system-design/archive/contracts').BundleBranchRecord;
export type BundleSnapshotRecord = import('@canvas-one/simulation-system-design/archive/contracts').BundleSnapshotRecord;
export type BundleCommitRecord = import('@canvas-one/simulation-system-design/archive/contracts').BundleCommitRecord;
export type BundlePublicationRecord = import('@canvas-one/simulation-system-design/archive/contracts').BundlePublicationRecord;
export type BundleCheckpointRecord = import('@canvas-one/simulation-system-design/archive/contracts').BundleCheckpointRecord;
export type BundleRunRecord = import('@canvas-one/simulation-system-design/archive/contracts').BundleRunRecord;
export type BundlePartRecord = import('@canvas-one/simulation-system-design/archive/contracts').BundlePartRecord;
export type ProjectBundle = import('@canvas-one/simulation-system-design/archive/contracts').ProjectBundle;
export type PortableFile = import('@canvas-one/simulation-system-design/archive/contracts').PortableFile;

// ============================================================================
// Transfer, import, export, prune
// ============================================================================

/** `{fileToken, newProjectId, operationId}` (Bootstrap envelope). */
export type ProjectImportCommand = {
  readonly commandId: 'project.import';
  readonly operationId: Id;
  readonly actor: Actor;
  readonly payload: {
    readonly fileToken: unknown;
    readonly newProjectId: Id;
  };
};

/** Controller command `project.export-json {projectId, expectedProjectRevision}`. */
export type ExportProjectParams = import('@canvas-one/simulation-system-design/archive/contracts').ExportProjectParams;
export type ExportProjectResult = import('@canvas-one/simulation-system-design/archive/contracts').ExportProjectResult;

/**
 * `pruneUnreferenced({projectId, expectedProjectRevision, selection})`. Explicit only
 * ("No auto-pruning anywhere").
 */
export type PruneSelection = {
  readonly runIds: readonly Id[];
  readonly traceRunIds: readonly Id[];
  readonly snapshotIds: readonly string[];
};

export type PruneUnreferencedParams = {
  readonly projectId: Id;
  readonly expectedProjectRevision: number;
  readonly selection: PruneSelection;
};

export type PruneUnreferencedResult =
  | {
      readonly status: 'applied';
      readonly projectRevision: number;
      readonly deletedRunIds: readonly Id[];
      readonly tracePrunedRunIds: readonly Id[];
      readonly deletedSnapshotIds: readonly Id[];
      readonly alreadyAbsentIds: readonly Id[];
    }
  | StaleResult
  | MissingResult
  | { readonly status: 'failed'; readonly code: 'referenced-artifact'; readonly issues: readonly Issue[] }
  | FailedResult;

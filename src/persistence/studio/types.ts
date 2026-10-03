/**
 * Storage and Repository types for System Studio (RV-16a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/storage.md (§1 versions, §2 tables, §3 publication metadata,
 *   §5 repository API, §6 limits)
 * - specs/revamp/contracts/transactions.md (§1 Actor & Idempotency, §2 Revisions & CAS)
 * - specs/revamp/contracts/commands.md (Envelopes, results, project.create, project.rename, branch.create)
 */

import type {
  Connection,
  Document,
  Element,
  Fixture,
  Id,
  PayloadSchema,
  Refinement,
  Relation,
  Scenario,
  View,
} from '../../domain/studio/model';
import type { CheckResult, RunSummary, TerminalStatus, TraceEvent } from '../../domain/studio/runner/types';
import type { EvidenceRef, EvidenceManifest } from '../../domain/studio/runner/evidence';
import type { Issue } from '../../domain/studio/validate';
import type { BuildManifestVersions } from '../../domain/studio/manifest';

// ============================================================================
// storage.md §1: Versions
// ============================================================================

export const DB_NAME = 'system-studio-local-v1';
export const DB_VERSION = 1;
export const PREFERENCES_SCHEMA = 'studio-preferences/1';

export const DEFAULT_BUILD_VERSIONS: BuildManifestVersions = Object.freeze({
  compilerVersion: 'studio-compiler/1',
  runnerVersions: Object.freeze([{ runnerId: 'studio-runner', version: 'studio-runner/5' }]),
});

// ============================================================================
// storage.md §6: Ceilings and Limits
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
// transactions.md §1 & storage.md §2: Actor
// ============================================================================

/**
 * Actor per transactions.md §1:
 * { actorId, kind: 'local-human', displayName }
 * Unknown kinds are rejected.
 */
export type Actor = {
  readonly actorId: string;
  readonly kind: 'local-human';
  readonly displayName: string;
};

// ============================================================================
// storage.md §3: Publication Metadata
// ============================================================================

export type SemanticVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

export type PublicationMetadata = {
  readonly version: SemanticVersion;
  readonly title: string;
  readonly rationale: string;
  readonly ticketUrl: string | null;
};

// ============================================================================
// storage.md §2: Table Record Types
// ============================================================================

/**
 * projects table: primary key id
 * Fields: id, title, revision, mainBranchId, initialSnapshotId, importSourceId: Id | null, createdAt, updatedAt
 * Indexes: updatedAt
 */
export type ProjectRecord = {
  readonly id: Id;
  readonly title: string;
  readonly revision: number;
  readonly mainBranchId: Id;
  readonly initialSnapshotId: string; // Hash
  readonly importSourceId: Id | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

/**
 * branches table: primary key [projectId+id]
 * Fields: projectId, id, label, state: 'open' | 'closed', headCommitId: Id | null, workingSnapshotId, workingRevision, createdAt
 * Indexes: projectId
 */
export type BranchRecord = {
  readonly projectId: Id;
  readonly id: Id;
  readonly label: string;
  readonly state: 'open' | 'closed';
  readonly headCommitId: Id | null;
  readonly workingSnapshotId: string; // Hash
  readonly workingRevision: number;
  readonly createdAt: number;
};

/**
 * snapshots table: primary key [projectId+id] (id = content hash)
 * Fields: projectId, id, document
 * Indexes: projectId
 */
export type SnapshotRecord = {
  readonly projectId: Id;
  readonly id: string; // lowercase SHA-256 hex
  readonly document: Document;
};

/**
 * commits table: primary key [projectId+id]
 * Fields: projectId, id, snapshotId, parentIds, evidence: EvidenceRef[], actor, createdAt, message
 * Indexes: projectId
 */
export type CommitRecord = {
  readonly projectId: Id;
  readonly id: Id;
  readonly snapshotId: string; // Hash
  readonly parentIds: readonly Id[];
  readonly evidence: readonly EvidenceRef[];
  readonly evidenceManifest?: EvidenceManifest;
  readonly actor: Actor;
  readonly createdAt: number;
  readonly message: string;
};

/**
 * publications table: primary key [projectId+id]
 * Fields: projectId, id, commitId, sourceBranchId, previousMainHeadId: Id | null, ordinal, actor, createdAt, metadata, versionKey
 * Indexes: projectId; unique [projectId+ordinal]; unique [projectId+versionKey]
 */
export type PublicationRecord = {
  readonly projectId: Id;
  readonly id: Id;
  readonly commitId: Id;
  readonly sourceBranchId: Id;
  readonly previousMainHeadId: Id | null;
  readonly ordinal: number;
  readonly actor: Actor;
  readonly createdAt: number;
  readonly metadata: PublicationMetadata;
  readonly versionKey: string; // 'M.m.p' with no leading zeros
};

/**
 * checkpoints table: primary key [projectId+id]
 * Fields: projectId, id, snapshotId, sourceBranchId, label, actor, createdAt
 * Indexes: projectId
 */
export type CheckpointRecord = {
  readonly projectId: Id;
  readonly id: Id;
  readonly snapshotId: string; // Hash
  readonly sourceBranchId: Id;
  readonly label: string;
  readonly actor: Actor;
  readonly createdAt: number;
};

/**
 * runs table: primary key [projectId+id]
 * Fields: projectId, id, snapshotId, manifest, fingerprint, status, provenance, checks, summary, traceState, createdAt, completedAt
 * Indexes: projectId; [projectId+fingerprint]
 */
export type RunRecord = {
  readonly projectId: Id;
  readonly id: Id;
  readonly snapshotId: string; // Hash
  readonly manifest: unknown;
  readonly fingerprint: string;
  readonly status: TerminalStatus;
  readonly provenance: 'local' | 'imported-unverified';
  readonly checks: readonly CheckResult[];
  readonly summary: RunSummary;
  readonly traceState: 'complete' | 'pruned' | 'not-saved';
  readonly createdAt: number;
  readonly completedAt: number;
};

/**
 * traceChunks table: primary key [projectId+runId+index]
 * Fields: projectId, runId, index, firstSequence, events, payloads, byteLength
 * Indexes: [projectId+runId]
 */
export type TraceChunkRecord = {
  readonly projectId: Id;
  readonly runId: Id;
  readonly index: number;
  readonly firstSequence: number;
  readonly events: readonly TraceEvent[];
  readonly payloads: unknown;
  readonly byteLength: number;
};

/**
 * operations table: primary key [projectId+id]
 * Fields: projectId, id (operationId), requestHash, result, createdAt
 * Indexes: projectId
 */
export type OperationRecord = {
  readonly projectId: Id;
  readonly id: Id;
  readonly requestHash: string; // lowercase SHA-256 hex
  readonly result: unknown;
  readonly createdAt: number;
};

/**
 * parts table: primary key [projectId+id+revision]
 * Fields: projectId, id, revision, label, description, content, createdAt
 * Indexes: projectId; [projectId+id]
 */
export type PartRecord = {
  readonly projectId: Id;
  readonly id: Id;
  readonly revision: number;
  readonly label: string;
  readonly description: string;
  readonly content: unknown;
  readonly createdAt: number;
};

/**
 * preferences table: primary key key
 * Fields: key, schema: 'studio-preferences/1', revision, value
 * Indexes: none
 */
export type PreferenceRecord = {
  readonly key: string;
  readonly schema: typeof PREFERENCES_SCHEMA;
  readonly revision: number;
  readonly value: unknown;
};

// ============================================================================
// storage.md §5: Error Model
// ============================================================================

/**
 * Exactly the 9 error codes specified in storage.md §5:
 * "Errors: not-found | invalid | stale | referenced-artifact | quota | unavailable |
 *  unsupported-version | operation-id-reused | limit, with structured issue paths and IDs"
 */
const STORAGE_ERROR_CODES = [
  'not-found',
  'invalid',
  'stale',
  'referenced-artifact',
  'quota',
  'unavailable',
  'unsupported-version',
  'operation-id-reused',
  'limit',
] as const;

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];

// ============================================================================
// commands.md §2: Command Values and Results
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

export type AppliedResult = {
  readonly status: 'applied';
  readonly operationId: Id;
  readonly projectRevision: number;
  readonly branchRevision: number | null;
  readonly changedIds: readonly Id[];
  readonly undo: { readonly entryId: Id; readonly label: string } | null;
  readonly value: CommandValue;
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

export type FailedCode =
  | 'quota'
  | 'unavailable'
  | 'referenced-artifact'
  | 'operation-id-reused'
  | 'limit'
  | 'ineligible'
  | 'conflict'
  | 'unsupported-version'
  | 'duplicate-version';

export type FailedResult = {
  readonly status: 'failed';
  readonly code: FailedCode;
  readonly issues: readonly Issue[];
};

export type UnsupportedResult = {
  readonly status: 'unsupported';
  readonly task: string;
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

export type SaveRunResult =
  | { readonly status: 'applied'; readonly runId: Id; readonly run: RunRecord }
  | InvalidResult
  | FailedResult;

// ============================================================================
// storage.md §7 / §9: History reads and reference integrity (RV-08f)
// ============================================================================

/**
 * One branch's history per storage.md §9 "round-trip reload": the commits reachable
 * from that branch's head, newest first by DAG order from the head (never by timestamp).
 */
export type BranchHistoryEntry = {
  readonly branchId: Id;
  readonly commits: readonly Readonly<CommitRecord>[];
};

/**
 * `loadHistory(projectId)` result: project, branches, commits, publications (by ordinal)
 * and checkpoints, plus per-branch history, all read in one consistent read-only
 * transaction (storage.md §5).
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
 * repaired or fabricated -- transactions.md §4: "Missing or corrupt content returns
 * `missing` with IDs; restore content is never fabricated."
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
 * `verifyReferenceIntegrity(projectId)` result per storage.md §5/§9: {ok:true} when every
 * reference resolves and every snapshot re-hashes to its own ID; otherwise {ok:false,
 * missing:[{kind,id,referencedBy}]}.
 */
export type ReferenceIntegrityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: readonly ReferenceIntegrityIssue[] };

// ============================================================================
// commands.md §2 & §3: Supported Authored Commands (RV-16a scope)
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

export const RECORD_KINDS = [
  'element',
  'connection',
  'relation',
  'schema',
  'fixture',
  'refinement',
  'scenario',
  'view',
] as const;

export type RecordKind = (typeof RECORD_KINDS)[number];

export type EditableRecord =
  | { readonly recordKind: 'element'; readonly record: Element }
  | { readonly recordKind: 'connection'; readonly record: Connection }
  | { readonly recordKind: 'relation'; readonly record: Relation }
  | { readonly recordKind: 'schema'; readonly record: PayloadSchema }
  | { readonly recordKind: 'fixture'; readonly record: Fixture }
  | { readonly recordKind: 'refinement'; readonly record: Refinement }
  | { readonly recordKind: 'scenario'; readonly record: Scenario }
  | { readonly recordKind: 'view'; readonly record: View };

export type RecordChange =
  | { readonly kind: 'insert'; readonly value: EditableRecord }
  | { readonly kind: 'replace'; readonly value: EditableRecord }
  | { readonly kind: 'remove'; readonly recordKind: RecordKind; readonly id: Id };

export type ModelApplyRecordsCommand = {
  readonly commandId: 'model.apply-records';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly changes: readonly RecordChange[];
  };
};

export type HistoryCheckpointCommand = {
  readonly commandId: 'history.checkpoint';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly checkpointId: Id;
    readonly label: string;
  };
};

export type HistoryRestoreCommand = {
  readonly commandId: 'history.restore';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly snapshotId: string;
    readonly checkpointId: Id;
    readonly label: string;
  };
};

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

export type HistoryCommitCommand = {
  readonly commandId: 'history.commit';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: {
    readonly commitId: Id;
    readonly expectedHeadId: ExpectedHead;
    readonly message: string;
    readonly evidence: readonly EvidenceRef[];
  };
};

export type HistoryPublishPayload = {
  readonly candidateId: Id;
  readonly publicationId: Id;
  readonly mergeCommitId: Id;
  readonly metadata: PublicationMetadata;
  readonly evidence: readonly EvidenceRef[];
  readonly keepSourceOpen?: boolean;
  readonly expectedProjectRevision: number;
};

export type HistoryPublishCommand = {
  readonly commandId: 'history.publish';
  readonly operationId: Id;
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly actor: Actor;
  readonly payload: HistoryPublishPayload;
};

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
  | BranchCreateCommand
  | ModelApplyRecordsCommand
  | HistoryCheckpointCommand
  | HistoryRestoreCommand
  | HistoryCommitCommand
  | BranchReopenCommand
  | HistoryPublishCommand
  | GenericCommand;

// ============================================================================
// Controller commands & Branch Switch (RV-08b)
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
// Save Failure & Recovery (RV-08b)
// ============================================================================

export type SaveFailureRecoveryAction = 'retry' | 'reload' | 'export';

export type SaveFailureRecoveryOption = {
  readonly action: SaveFailureRecoveryAction;
  readonly label: string;
  readonly description: string;
  readonly recommended?: boolean;
};

export type SaveFailureRecoveryInfo = {
  readonly reason: 'stale' | 'quota' | 'limit' | 'unavailable' | 'other';
  readonly message: string;
  readonly keepInMemoryCopy: true;
  readonly options: readonly SaveFailureRecoveryOption[];
};

// ============================================================================
// storage.md §5: Repository API
// ============================================================================

/**
 * storage.md §5 Repository Port interface.
 * All nine methods specified in the contract.
 */
export interface StudioRepository {
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
   * Commits the terminal summary, manifest, checks and retained chunks atomically (RV-08a).
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
   * Publishes a candidate to main atomically (RV-08e).
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
   * project.import (RV-16b): validates the bundle bound to `fileToken` outside any
   * transaction, then creates a fresh project namespace in one transaction. Unknown or
   * expired token -> missing; invalid bundle -> invalid; reused newProjectId -> failed/conflict.
   */
  importProject(command: ProjectImportCommand): Promise<AuthoredResult>;

  /**
   * project.export-json (RV-16b): one consistent read-only transaction; canonical-json-v1
   * envelope bytes of `{format:'system-studio',version:9,project:ProjectBundle}`, capped
   * at 64 MiB (storage.md §5 "Export always fits").
   */
  exportProject(params: ExportProjectParams): Promise<ExportProjectResult>;

  /**
   * pruneUnreferenced (RV-16b): explicit-only trace/run/snapshot pruning in one
   * transaction, recomputing the pin closure from current rows (storage.md §7).
   */
  pruneUnreferenced(params: PruneUnreferencedParams): Promise<PruneUnreferencedResult>;

  /**
   * Loads project, branches, commits, publications (by ordinal), checkpoints and
   * per-branch history in one consistent read-only transaction (RV-08f, storage.md §9
   * "round-trip reload"). Throws a `RepositoryError` (code `not-found`) if the project
   * does not exist.
   */
  loadHistory(projectId: Id): Promise<HistoryLoadResult>;

  /**
   * Verifies every stored reference resolves and every snapshot re-hashes to its own ID
   * (RV-08f, storage.md §5/§9, transactions.md §4). Never repairs or fabricates content.
   * Throws a `RepositoryError` (code `not-found`) if the project does not exist.
   */
  verifyReferenceIntegrity(projectId: Id): Promise<ReferenceIntegrityResult>;
}

export type { MintRunStartTokenParams, RunStartToken } from './token';
export type { MintPublishTicketParams, PublishTicket, PublishTicketBinding } from './publish-ticket';
export type { FileToken, FileTokenBinding } from './file-tokens';

// ============================================================================
// storage.md §1 & §4: Portable bundle (RV-16b)
// ============================================================================

/** storage.md §1: the portable file's fixed format discriminator and version. */
export const PORTABLE_FORMAT = 'system-studio' as const;
export const PORTABLE_VERSION = 9 as const;

/** Bundle rows are the table rows with `projectId` omitted (storage.md §4). */
export type BundleBranchRecord = Omit<BranchRecord, 'projectId'>;
export type BundleSnapshotRecord = Omit<SnapshotRecord, 'projectId'>;
export type BundleCommitRecord = Omit<CommitRecord, 'projectId'>;
export type BundlePublicationRecord = Omit<PublicationRecord, 'projectId'>;
export type BundleCheckpointRecord = Omit<CheckpointRecord, 'projectId'>;
export type BundleRunRecord = Omit<RunRecord, 'projectId'>;
export type BundlePartRecord = Omit<PartRecord, 'projectId'>;

/**
 * storage.md §4 "Portable bundle" fields exactly:
 * `ProjectBundle={id,title,createdAt,updatedAt,mainBranchId,initialSnapshotId,branches,
 * snapshots,commits,publications,checkpoints,runs,parts}`. Arrays omit `projectId`.
 * Excludes operation receipts, preferences, trace chunks, device-local actors/credentials,
 * project revision and `importSourceId`.
 */
export type ProjectBundle = {
  readonly id: Id;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly mainBranchId: Id;
  readonly initialSnapshotId: string;
  readonly branches: readonly BundleBranchRecord[];
  readonly snapshots: readonly BundleSnapshotRecord[];
  readonly commits: readonly BundleCommitRecord[];
  readonly publications: readonly BundlePublicationRecord[];
  readonly checkpoints: readonly BundleCheckpointRecord[];
  readonly runs: readonly BundleRunRecord[];
  readonly parts: readonly BundlePartRecord[];
};

/** storage.md §1: `{format:'system-studio',version:9,project:ProjectBundle}`. */
export type PortableFile = {
  readonly format: typeof PORTABLE_FORMAT;
  readonly version: typeof PORTABLE_VERSION;
  readonly project: ProjectBundle;
};

// ============================================================================
// commands.md §3 / storage.md §4-§6: Transfer, import, export, prune (RV-16b)
// ============================================================================

/** commands.md "File tokens": `{fileToken, newProjectId, operationId}` (Bootstrap envelope). */
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
export type ExportProjectParams = {
  readonly projectId: Id;
  readonly expectedProjectRevision: number;
};

export type ExportProjectResult =
  | {
      readonly status: 'done';
      readonly value: { readonly kind: 'download'; readonly downloadId: Id };
      readonly bytes: Uint8Array;
      readonly sha256: string;
    }
  | InvalidResult
  | StaleResult
  | MissingResult
  | FailedResult;

/**
 * `pruneUnreferenced({projectId, expectedProjectRevision, selection})`. Explicit only
 * (storage.md §7: "No auto-pruning anywhere").
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

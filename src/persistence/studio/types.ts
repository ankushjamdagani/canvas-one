/**
 * Storage and Repository types for System Studio (RV-16a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/storage.md (§1 versions, §2 tables, §3 publication metadata,
 *   §5 repository API, §6 limits)
 * - specs/revamp/contracts/transactions.md (§1 Actor & Idempotency, §2 Revisions & CAS)
 * - specs/revamp/contracts/commands.md (Envelopes, results, project.create, project.rename, branch.create)
 */

import type { Document, Id, Json } from '../../domain/studio/model';
import type { CheckResult, RunSummary, TerminalStatus, TraceEvent } from '../../domain/studio/runner/types';
import type { EvidenceRef } from '../../domain/studio/runner/evidence';
import type { Issue } from '../../domain/studio/validate';

// ============================================================================
// storage.md §1: Versions
// ============================================================================

export const DB_NAME = 'system-studio-local-v1';
export const DB_VERSION = 1;
export const PREFERENCES_SCHEMA = 'studio-preferences/1';

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
export const STORAGE_ERROR_CODES = [
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
  | GenericCommand;

// ============================================================================
// storage.md §5: Repository API
// ============================================================================

/**
 * storage.md §5 Repository Port interface.
 * All nine methods specified in the contract.
 */
export interface StudioRepository {
  /** Queries return cloned, read-only project record or null if not found. */
  loadProject(projectId: Id): Promise<Readonly<ProjectRecord> | null>;

  /** Queries return cloned, read-only branch record or null if not found. */
  loadBranch(projectId: Id, branchId: Id): Promise<Readonly<BranchRecord> | null>;

  /** Authored commands resolve to one transaction plus an operation receipt. */
  execute(command: AuthoredCommand): Promise<AuthoredResult | UnsupportedResult>;

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

  /** Not implemented in RV-16a; owned by RV-16b. */
  importProject(validatedBundle: unknown): Promise<UnsupportedResult>;

  /** Not implemented in RV-16a; owned by RV-16b. */
  exportProject(projectId: Id): Promise<UnsupportedResult>;

  /** Not implemented in RV-16a; owned by RV-16b. */
  pruneUnreferenced(projectId: Id, selection: unknown): Promise<UnsupportedResult>;
}

export type { MintRunStartTokenParams, RunStartToken } from './token';


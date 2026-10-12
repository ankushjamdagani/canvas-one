/**
 * Headless history workflow contracts for simulation-gated system design.
 */

import type { Document, Id } from '@canvas-one/system-design/studio/model';
import type {
  Actor,
  AppliedResult,
  AuthoredResult,
  BranchRecord,
  CheckpointRecord,
  CommitRecord,
  ExpectedHead,
  FailedResult,
  InvalidResult,
  MissingResult,
  PublicationRecord,
  StaleResult,
  HistoryRepository,
  UnsupportedResult,
} from './contracts.js';
import type { HistorySession } from './contracts.js';
import type { ScenarioStatus, ScenarioWithStatus } from './scenario-status.js';
import type { ChangeType, DiffRecordKind } from '@canvas-one/system-design/versioning/diff';

// ============================================================================
// Controller Options & State
// ============================================================================

export type HistoryControllerOptions = {
  readonly repository: HistoryRepository;
  readonly session: HistorySession;
  readonly mintId: () => Id;
  readonly actor: Actor;
  readonly mapError: (error: unknown) => FailedResult;
  /** Host-provided interface copy; consumers may render history with any presentation. */
  readonly workingEditsNotice?: string;
};

export type AheadOfVersionInfo = {
  readonly aheadCount: number;
  readonly versionKey: string;
};

export type HistoryControllerStatus = 'empty' | 'loading' | 'ready' | 'error';

export type HistoryControllerState = {
  readonly status: HistoryControllerStatus;
  readonly branch: Readonly<BranchRecord> | null;
  readonly isMain: boolean;
  /** Working edit labels from the current session's undo stack (this session only). */
  readonly workingEdits: readonly string[];
  /** Explicit notice: working edits are tracked for this session only. */
  readonly workingEditsNotice: string;
  readonly checkpoints: readonly Readonly<CheckpointRecord>[];
  readonly commits: readonly Readonly<CommitRecord>[];
  readonly publications: readonly Readonly<PublicationRecord>[];
  readonly aheadOfVersion: AheadOfVersionInfo | null;
  readonly lastError: unknown | null;
};

// ============================================================================
// Action Results
// ============================================================================

export type CommitIneligibleScenarioInfo = {
  readonly scenarioId: Id;
  readonly label: string;
  readonly status: ScenarioStatus;
};

export type CommitIneligibleResult = FailedResult & {
  readonly ineligibleScenarios: readonly CommitIneligibleScenarioInfo[];
};

export type CommitResult =
  | AppliedResult
  | StaleResult
  | FailedResult
  | InvalidResult
  | MissingResult
  | UnsupportedResult
  | CommitIneligibleResult;

export type CommitActionOptions = {
  readonly expectedHeadId?: ExpectedHead;
  readonly expectedWorkingRevision?: number;
};

export type SaveCheckpointResult = AuthoredResult | UnsupportedResult;

export type RestoreResult = AuthoredResult | UnsupportedResult;

// ============================================================================
// View Model Types
// ============================================================================

export type RecordChangeItem = {
  readonly recordKind: DiffRecordKind;
  readonly id: Id;
  readonly change: ChangeType;
  readonly label: string;
  readonly detail: string;
};

/**
 * Everything CommitPanel needs to render (CommitPanel never reads the
 * controller's private session or repository directly — this is the one
 * public, typed surface it consumes for the CHANGES list and scenario gate).
 */
export type CommitPreview = {
  readonly workingDocument: Document | null;
  readonly baseDocument: Document | null;
  readonly changes: readonly RecordChangeItem[];
  readonly scenarios: readonly ScenarioWithStatus[];
};

export type CommitViewModel = {
  readonly commit: Readonly<CommitRecord>;
  readonly time: string;
  readonly message: string;
  readonly isCurrent: boolean;
  readonly fieldsChangedText: string | null;
  readonly evidenceSummary: string | null;
};

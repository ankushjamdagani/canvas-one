/**
 * History panel and controller types for System Studio (RV-11a).
 *
 * Implements specifications from:
 * - specs/revamp/decisions.md (D11, D20, D26, D27, D28, D29, D37, D40, D41)
 * - specs/revamp/design-revalidation.md (§2 exclusions & §3 item 10)
 * - specs/revamp/requirements.md (R08)
 * - specs/revamp/contracts/transactions.md §4
 * - specs/revamp/contracts/commands.md §3 & "Scenarios (D41)"
 * - specs/revamp/contracts/storage.md §2–§5
 * - specs/revamp/contracts/run-identity.md §5
 */

import type { Document, Id } from '../../domain/studio/model';
import type { Issue } from '../../domain/studio/validate';
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
  StudioRepository,
  UnsupportedResult,
} from '../../persistence/studio';
import type { SessionController } from '../session/controller';
import type { ScenarioStatus, ScenarioWithStatus } from '../runs/scenarioStatus';
import type { ChangeType, DiffRecordKind } from '../../domain/versioning/diff';

// ============================================================================
// Controller Options & State
// ============================================================================

export type HistoryControllerOptions = {
  readonly repository: StudioRepository;
  readonly session: SessionController;
  readonly mintId: () => Id;
  readonly actor: Actor;
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
  /** Explicit contract notice: working edits are tracked for this session only. */
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
 * Everything CommitPanel needs to render (§: CommitPanel never reads the
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

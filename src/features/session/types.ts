/**
 * Session layer types for System Studio.
 */

import type { Document, Id } from '../../domain/studio/model';
import type { Issue } from '../../domain/studio/validate';
import type {
  Actor,
  AuthoredResult,
  LocalRepository,
  MissingResult,
  RecordChange,
  StaleResult,
  StudioRepository,
  UnsupportedResult,
} from '../../persistence/studio';

export type SessionStatus = 'empty' | 'ready' | 'saving' | 'loading';

export type SessionState = {
  readonly status: SessionStatus;
  readonly projectId: Id | null;
  readonly branchId: Id | null;
  /** The project's main branch id, so callers can tell "on main" apart from a draft. */
  readonly mainBranchId: Id | null;
  readonly projectRevision: number | null;
  readonly workingRevision: number | null;
  /**
   * The active branch's working snapshot hash, read from the same reloaded
   * branch row as `document` (paired, never a stale mix) so the runs lane can
   * pin a run target to the exact working content.
   */
  readonly workingSnapshotId: string | null;
  readonly document: Document | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastError: unknown | null;
  readonly needsReload: boolean;
};

export type BusyResult = {
  readonly status: 'busy';
  readonly message: string;
};

export type UndoEntry = {
  readonly label: string;
  readonly inverseChanges: readonly RecordChange[];
  readonly forwardChanges: readonly RecordChange[];
};

export type BootStudioRepositorySuccess = {
  readonly ok: true;
  readonly status: 'ready';
  readonly repository: LocalRepository;
};

export type BootStudioRepositoryFailure = {
  readonly ok: false;
  readonly status: 'failed';
  readonly code: 'unavailable' | 'quota';
  readonly issues: readonly Issue[];
  readonly error?: unknown;
};

export type BootStudioRepositoryResult =
  | BootStudioRepositorySuccess
  | BootStudioRepositoryFailure;

export type SessionControllerOptions = {
  readonly repository: StudioRepository;
  readonly mintId: () => Id;
  readonly actor: Actor;
};

export type CreateProjectParams = {
  readonly title: string;
  readonly initialDocument: Document;
};

export type OpenProjectSuccess = {
  readonly status: 'ready';
  readonly projectId: Id;
  readonly branchId: Id;
  readonly projectRevision: number;
  readonly workingRevision: number;
  readonly document: Document;
};

export type OpenProjectResult =
  | OpenProjectSuccess
  | MissingResult
  | StaleResult
  | BusyResult
  | AuthoredResult;

export type CreateProjectResult = AuthoredResult | BusyResult | UnsupportedResult;

export type SessionApplyResult = AuthoredResult | BusyResult | UnsupportedResult;

export type EmptyResult = {
  readonly status: 'empty';
  readonly message?: string;
};

export type SessionUndoResult =
  | AuthoredResult
  | BusyResult
  | EmptyResult
  | UnsupportedResult;

export type SessionRedoResult =
  | AuthoredResult
  | BusyResult
  | EmptyResult
  | UnsupportedResult;

export type SessionRenameResult = AuthoredResult | BusyResult | UnsupportedResult;


/**
 * Session layer types for System Studio.
 */

import type { Document, Id } from '../studio/model.js';
import type { UndoEntry as HistoryUndoEntry } from '@canvas-one/history';
import type { Issue } from '../studio/validate.js';
import type { Actor, AuthoredResult, MissingResult, RecordChange, StaleResult, SessionRepository, UnsupportedResult, FailedResult } from './contracts.js';

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

export type UndoEntry = HistoryUndoEntry<RecordChange>;

export type SessionControllerOptions = {
  readonly repository: SessionRepository;
  readonly mapError: (error: unknown) => FailedResult;
  readonly mintId: () => Id;
  readonly actor: Actor;
  readonly extensions?: readonly import('@canvas-one/whiteboard').ExtensionDefinition[];
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

/**
 * Error model and exception mappers for System Studio repository (RV-16a).
 *
 * Implements storage.md §5 & prompt error model:
 * exactly `not-found | invalid | stale | referenced-artifact | quota | unavailable |
 * unsupported-version | operation-id-reused | limit`, with structured issue paths and IDs,
 * never raw browser exception text alone.
 */

import Dexie from 'dexie';
import type { Issue } from '../../domain/studio/validate';
import { createIssue } from '../../domain/studio/issue';
import type { FailedCode, FailedResult, StorageErrorCode } from './types';

export { createIssue };

export type StorageErrorDetail = {
  readonly code: StorageErrorCode;
  readonly message: string;
  readonly path?: readonly (string | number)[];
  readonly id?: string | null;
  readonly issues?: readonly Issue[];
};

export class RepositoryError extends Error {
  readonly code: StorageErrorCode;
  readonly path?: readonly (string | number)[];
  readonly id?: string | null;
  readonly issues?: readonly Issue[];

  constructor(detail: StorageErrorDetail) {
    super(detail.message);
    this.name = 'RepositoryError';
    this.code = detail.code;
    this.path = detail.path;
    this.id = detail.id;
    this.issues = detail.issues;
  }
}

/**
 * Checks if an error is a browser storage quota exceeded error.
 */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err instanceof Dexie.QuotaExceededError) return true;
  const name = (err as { name?: string }).name;
  return name === 'QuotaExceededError';
}

/**
 * Checks if an error indicates that the database is unavailable, blocked, or closed.
 */
function isUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (
    err instanceof Dexie.DatabaseClosedError ||
    err instanceof Dexie.OpenFailedError
  ) {
    return true;
  }
  const name = (err as { name?: string }).name;
  return (
    name === 'DatabaseClosedError' ||
    name === 'BlockedError' ||
    name === 'OpenFailedError' ||
    name === 'InvalidStateError' ||
    name === 'VersionError'
  );
}

/**
 * Maps any error encountered in persistence transactions to a structured FailedResult,
 * ensuring no raw browser exception text escapes without a typed structured representation.
 */
export function mapErrorToFailedResult(err: unknown): FailedResult {
  if (err instanceof RepositoryError) {
    const code: FailedCode =
      err.code === 'quota'
        ? 'quota'
        : err.code === 'unavailable'
          ? 'unavailable'
          : err.code === 'referenced-artifact'
            ? 'referenced-artifact'
            : err.code === 'operation-id-reused'
              ? 'operation-id-reused'
              : err.code === 'limit'
                ? 'limit'
                : err.code === 'unsupported-version'
                  ? 'unsupported-version'
                  : 'unavailable';

    const issues: readonly Issue[] =
      err.issues && err.issues.length > 0
        ? err.issues
        : [createIssue('structural-rule', err.message, err.path ?? [], err.id ?? null)];

    return {
      status: 'failed',
      code,
      issues,
    };
  }

  if (isQuotaExceededError(err)) {
    return {
      status: 'failed',
      code: 'quota',
      issues: [
        createIssue('too-large', 'Storage quota exceeded; write rejected with no partial mutations', []),
      ],
    };
  }

  if (isUnavailableError(err)) {
    return {
      status: 'failed',
      code: 'unavailable',
      issues: [
        createIssue('structural-rule', 'Database is unavailable, closed, or blocked by another connection', []),
      ],
    };
  }

  // Fallback for unexpected internal errors
  const message = err instanceof Error ? err.message : String(err);
  return {
    status: 'failed',
    code: 'unavailable',
    issues: [
      createIssue('structural-rule', `Persistence operation failed: ${message}`, []),
    ],
  };
}

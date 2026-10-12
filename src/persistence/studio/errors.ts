import { RepositoryError as StorageRepositoryError, mapStorageError } from '@canvas-one/storage';
import { isQuotaExceededError, isUnavailableError } from '@canvas-one/storage-indexeddb';
import { createIssue } from '../../domain/studio/issue';
import type { Issue } from '../../domain/studio/validate';
import type { FailedResult } from './types';
export { createIssue, isQuotaExceededError };
export type StorageErrorDetail = import('@canvas-one/storage').StorageErrorDetail<Issue>;
export class RepositoryError extends StorageRepositoryError<Issue> {}
export function mapErrorToFailedResult(error: unknown): FailedResult {
  return mapStorageError<Issue>(error, { isQuota: isQuotaExceededError, isUnavailable: isUnavailableError, issue: createIssue });
}

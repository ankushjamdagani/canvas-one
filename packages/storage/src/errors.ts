import type { ValidationIssue } from '@canvas-one/whiteboard';
export const STORAGE_ERROR_CODES = ['not-found', 'invalid', 'stale', 'referenced-artifact', 'quota', 'unavailable', 'unsupported-version', 'operation-id-reused', 'limit'] as const;
export type StorageErrorCode = typeof STORAGE_ERROR_CODES[number];
export type StorageFailedCode = 'quota' | 'unavailable' | 'referenced-artifact' | 'operation-id-reused' | 'limit' | 'unsupported-version';
export type StorageFailure<Issue = ValidationIssue, Code extends string = StorageFailedCode> = { readonly status: 'failed'; readonly code: Code; readonly issues: readonly Issue[] };
export type StorageErrorDetail<Issue = ValidationIssue> = { readonly code: StorageErrorCode; readonly message: string; readonly path?: readonly (string | number)[]; readonly id?: string | null; readonly issues?: readonly Issue[] };
export class RepositoryError<Issue = ValidationIssue> extends Error {
  readonly code: StorageErrorCode;
  readonly path?: readonly (string | number)[];
  readonly id?: string | null;
  readonly issues?: readonly Issue[];
  constructor(detail: StorageErrorDetail<Issue>) { super(detail.message); this.name = 'RepositoryError'; this.code = detail.code; this.path = detail.path; this.id = detail.id; this.issues = detail.issues; }
}
export type StorageErrorPolicy<Issue> = {
  readonly isQuota: (error: unknown) => boolean;
  readonly isUnavailable: (error: unknown) => boolean;
  readonly issue: (code: 'structural-rule' | 'too-large', message: string, path: readonly (string | number)[], id?: string | null) => Issue;
};
/** Error classification is backend supplied; issue vocabulary is consumer supplied. */
export function mapStorageError<Issue>(error: unknown, policy: StorageErrorPolicy<Issue>): StorageFailure<Issue> {
  if (error instanceof RepositoryError) {
    const retained: readonly string[] = ['quota', 'unavailable', 'referenced-artifact', 'operation-id-reused', 'limit', 'unsupported-version'];
    return { status: 'failed', code: retained.includes(error.code) ? error.code as StorageFailedCode : 'unavailable',
      issues: error.issues?.length ? error.issues as readonly Issue[] : [policy.issue('structural-rule', error.message, error.path ?? [], error.id ?? null)] };
  }
  if (policy.isQuota(error)) return { status: 'failed', code: 'quota', issues: [policy.issue('too-large', 'Storage quota exceeded; write rejected with no partial mutations', [])] };
  if (policy.isUnavailable(error)) return { status: 'failed', code: 'unavailable', issues: [policy.issue('structural-rule', 'Database is unavailable, closed, or blocked by another connection', [])] };
  return { status: 'failed', code: 'unavailable', issues: [policy.issue('structural-rule', `Persistence operation failed: ${error instanceof Error ? error.message : String(error)}`, [])] };
}

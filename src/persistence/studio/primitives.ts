import { validateActor } from '@canvas-one/system-design/session/validate-actor';
export { validateActor };
/**
 * Persistence primitives for System Studio repository.
 *
 * - insertImmutable (insert-if-absent; equal content -> no-op; conflict -> invalid; never overwrite)
 * - snapshot content hashing outside transactions
 * - operation receipts (idempotency, retry before stale checks, operation-id-reused)
 * - Actor validation (local-human kind only)
 */

import type { Table } from 'dexie';
import { insertImmutable as insertStorageImmutable, checkReceipt } from '@canvas-one/storage';
import { canonicalJson, sha256Hex } from '../../domain/studio/canonical';
import type { Document } from '../../domain/studio/model';
import type { Issue } from '../../domain/studio/validate';
import type { StudioDatabase } from './db';
import { createIssue } from '../../domain/studio/issue';
import { RepositoryError } from './errors';
import type { AuthoredResult, FailedResult, InvalidResult } from './types';

/**
 * Canonical lowercase UUID format: 8-4-4-4-12 lowercase hex with version 1-5 and variant [89ab].
 * Matches the UUID check in validate.ts.
 */
export { UUID_REGEX, isValidUuid } from '../../domain/studio/ids';
import { UUID_REGEX, isValidUuid } from '../../domain/studio/ids';

/**
 * Validates a required UUID field, returning a structured Issue if missing or invalid.
 */
export function validateUuid(
  val: unknown,
  path: readonly (string | number)[],
  fieldName: string,
): Issue | null {
  if (val === undefined || val === null || val === '') {
    return createIssue('invalid-id', `${fieldName} is required and must be a valid UUID`, path);
  }
  if (typeof val !== 'string' || !UUID_REGEX.test(val)) {
    return createIssue(
      'invalid-id',
      `${fieldName} must be a valid canonical lowercase UUID`,
      path,
      typeof val === 'string' ? val : null,
    );
  }
  return null;
}

/**
 * Validates a non-negative safe integer revision field, returning a structured Issue if missing or invalid.
 */
export function validateRevision(
  val: unknown,
  path: readonly (string | number)[],
  fieldName: string,
): Issue | null {
  if (val === undefined || val === null) {
    return createIssue('missing-property', `${fieldName} is required`, path);
  }
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
    return createIssue(
      'out-of-range',
      `${fieldName} must be a non-negative safe integer revision`,
      path,
    );
  }
  return null;
}

/**
 * Validates an Actor envelope.
 * Only kind: 'local-human' is accepted; unknown kinds are rejected.
 */

/**
 * Validates the envelope shared by every branch-scoped authored command: actor, operation,
 * project and branch ids, and the expected working revision (checked in that order; the
 * first failure wins). Returns the `invalid` result to hand back, or null when well formed.
 */
export function validateCommandEnvelope(command: {
  readonly actor: unknown;
  readonly operationId: unknown;
  readonly projectId: unknown;
  readonly branchId: unknown;
  readonly expectedWorkingRevision: unknown;
}): InvalidResult | null {
  const actorIssues = validateActor(command.actor);
  if (actorIssues) return { status: 'invalid', issues: actorIssues };

  const issue =
    validateUuid(command.operationId, ['operationId'], 'operationId') ??
    validateUuid(command.projectId, ['projectId'], 'projectId') ??
    validateUuid(command.branchId, ['branchId'], 'branchId') ??
    validateRevision(
      command.expectedWorkingRevision,
      ['expectedWorkingRevision'],
      'expectedWorkingRevision',
    );
  return issue ? { status: 'invalid', issues: [issue] } : null;
}

/**
 * Checks that `evidence` is an array of well-formed refs, `{scenarioId: UUID, fingerprint:
 * non-empty string, runId: UUID}`. Whether the refs match the document is checked later.
 */
export function validateEvidenceRefs(evidence: unknown): InvalidResult | null {
  if (!Array.isArray(evidence)) {
    return {
      status: 'invalid',
      issues: [createIssue('wrong-type', 'payload.evidence must be an array', ['payload', 'evidence'])],
    };
  }

  const issues: Issue[] = [];
  evidence.forEach((ref: unknown, i) => {
    const r = ref as Partial<Record<'scenarioId' | 'fingerprint' | 'runId', unknown>> | null;
    if (
      !r ||
      typeof r !== 'object' ||
      Array.isArray(r) ||
      !isValidUuid(r.scenarioId) ||
      typeof r.fingerprint !== 'string' ||
      r.fingerprint.trim().length === 0 ||
      !isValidUuid(r.runId)
    ) {
      issues.push(
        createIssue(
          'wrong-type',
          `Invalid evidence ref at index ${i}: expected {scenarioId: UUID, fingerprint: string, runId: UUID}`,
          ['payload', 'evidence', i],
        ),
      );
    }
  });
  return issues.length > 0 ? { status: 'invalid', issues } : null;
}

/**
 * Computes snapshot ID (lowercase SHA-256 hex of canonical JSON) for an authored document.
 * MUST be computed BEFORE beginning an IndexedDB transaction.
 */
export async function computeSnapshotId(document: Document): Promise<string> {
  const canon = canonicalJson(document);
  if (!canon.ok) {
    throw new RepositoryError({
      code: 'invalid',
      message: 'Failed to serialize document to canonical JSON',
      issues: canon.issues,
    });
  }
  return sha256Hex(canon.text);
}

/**
 * Computes request hash (lowercase SHA-256 hex of canonical JSON) for an authored command.
 * MUST be computed BEFORE beginning an IndexedDB transaction.
 */
export async function computeRequestHash(command: unknown): Promise<string> {
  const canon = canonicalJson(command);
  if (!canon.ok) {
    throw new RepositoryError({
      code: 'invalid',
      message: 'Failed to serialize command to canonical JSON',
      issues: canon.issues,
    });
  }
  return sha256Hex(canon.text);
}

/**
 * Inserts an immutable row if absent.
 * On collision:
 * - If canonical content is equal: no-op (never overwrites).
 * - If canonical content differs: rejects with RepositoryError('invalid').
 */
export async function insertImmutable<T>(
  table: Table<T, any>,
  row: T,
  key: any,
): Promise<void> {
  await insertStorageImmutable(table, row, key, (existing, incoming) => {
    const left = canonicalJson(existing);
    const right = canonicalJson(incoming);
    return left.ok && right.ok && left.text === right.text;
  }, () => new RepositoryError({
    code: 'invalid',
    message: 'Immutable record collision with conflicting content; row will not be overwritten',
    issues: [createIssue('structural-rule', 'Conflicting immutable row collision', [])],
  }));
}

export type ReceiptCheckResult =
  | { readonly isRetry: true; readonly result: AuthoredResult }
  | { readonly isRetry: false }
  | FailedResult;

/**
 * Checks operation receipts before compare-and-set checks.
 * - Same operationId + same requestHash -> returns original durable result.
 * - Same operationId + different requestHash -> returns operation-id-reused failure.
 * - Not found -> indicates first execution.
 */
export async function checkOperationReceipt(
  db: StudioDatabase,
  projectId: string,
  operationId: string,
  requestHash: string,
): Promise<ReceiptCheckResult> {
  const replay = await checkReceipt(
    { get: key => db.operations.get([key[0], key[1]]) }, projectId, operationId, requestHash,
  );
  if (replay.kind === 'new') {
    return { isRetry: false };
  }

  if (replay.kind === 'replay') {
    return {
      isRetry: true,
      result: replay.result as AuthoredResult,
    };
  }

  return {
    status: 'failed',
    code: 'operation-id-reused',
    issues: [
      createIssue(
        'duplicate-id',
        `Operation ID ${operationId} has already been used with a different request payload`,
        ['operationId'],
        operationId,
      ),
    ],
  };
}

/**
 * The result to hand back instead of executing again: the original durable result for an
 * exact retry, or the operation-id-reused failure; null on first execution. Call it before
 * any compare-and-set check.
 */
export async function replayedResult(
  db: StudioDatabase,
  projectId: string,
  operationId: string,
  requestHash: string,
): Promise<AuthoredResult | null> {
  const receipt = await checkOperationReceipt(db, projectId, operationId, requestHash);
  if ('status' in receipt) return receipt;
  return receipt.isRetry ? receipt.result : null;
}

/**
 * Durably records an operation receipt atomically with command mutations.
 */
export async function recordOperationReceipt(
  db: StudioDatabase,
  projectId: string,
  operationId: string,
  requestHash: string,
  result: unknown,
): Promise<void> {
  await db.operations.add({
    projectId,
    id: operationId,
    requestHash,
    result,
    createdAt: Date.now(),
  });
}

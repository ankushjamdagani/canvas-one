/**
 * Persistence primitives for System Studio repository (RV-16a).
 *
 * Implements specs/revamp/contracts/transactions.md §1 & §2:
 * - insertImmutable (insert-if-absent; equal content -> no-op; conflict -> invalid; never overwrite)
 * - snapshot content hashing outside transactions
 * - operation receipts (idempotency, retry before stale checks, operation-id-reused)
 * - Actor validation (local-human kind only)
 */

import type { Table } from 'dexie';
import { canonicalJson, sha256Hex } from '../../domain/studio/canonical';
import type { Document, Id } from '../../domain/studio/model';
import type { Issue } from '../../domain/studio/validate';
import type { StudioDatabase } from './db';
import { createIssue, RepositoryError } from './errors';
import type { Actor, AuthoredResult, FailedResult } from './types';

/**
 * Canonical lowercase UUID format: 8-4-4-4-12 lowercase hex with version 1-5 and variant [89ab].
 * Conforms to model-and-runner.md §8 and validate.ts.
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Checks if a value conforms to canonical lowercase UUID format.
 */
export function isValidUuid(val: unknown): val is Id {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

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
 * Validates an Actor envelope per transactions.md §1.
 * Only kind: 'local-human' is accepted; unknown kinds are rejected.
 */
export function validateActor(actor: unknown): Issue[] | null {
  if (!actor || typeof actor !== 'object') {
    return [createIssue('wrong-type', 'Actor must be an object', ['actor'])];
  }
  const a = actor as Partial<Actor>;
  const issues: Issue[] = [];

  if (typeof a.actorId !== 'string' || a.actorId.trim().length === 0) {
    issues.push(
      createIssue('invalid-id', 'actor.actorId must be a non-empty string', ['actor', 'actorId']),
    );
  }

  if (a.kind !== 'local-human') {
    issues.push(
      createIssue(
        'invalid-literal',
        `Unknown actor kind: ${String(a.kind)}; expected 'local-human'`,
        ['actor', 'kind'],
      ),
    );
  }

  if (typeof a.displayName !== 'string') {
    issues.push(
      createIssue('wrong-type', 'actor.displayName must be a string', ['actor', 'displayName']),
    );
  }

  return issues.length > 0 ? issues : null;
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
  const existing = await table.get(key);

  if (existing !== undefined) {
    const canonExisting = canonicalJson(existing);
    const canonNew = canonicalJson(row);

    if (canonExisting.ok && canonNew.ok && canonExisting.text === canonNew.text) {
      // Equal collision: exact idempotent no-op
      return;
    }

    // Conflicting content on immutable row
    throw new RepositoryError({
      code: 'invalid',
      message: 'Immutable record collision with conflicting content; row will not be overwritten',
      issues: [
        createIssue('structural-rule', 'Conflicting immutable row collision', []),
      ],
    });
  }

  try {
    await table.add(row);
  } catch (err: unknown) {
    // If a concurrent write inserted the same row
    if (err && typeof err === 'object' && (err as { name?: string }).name === 'ConstraintError') {
      const concurrent = await table.get(key);
      if (concurrent !== undefined) {
        const canonExisting = canonicalJson(concurrent);
        const canonNew = canonicalJson(row);
        if (canonExisting.ok && canonNew.ok && canonExisting.text === canonNew.text) {
          return;
        }
      }
      throw new RepositoryError({
        code: 'invalid',
        message: 'Immutable record collision with conflicting content; row will not be overwritten',
        issues: [
          createIssue('structural-rule', 'Conflicting immutable row collision', []),
        ],
      });
    }
    throw err;
  }
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
  const existing = await db.operations.get([projectId, operationId]);

  if (!existing) {
    return { isRetry: false };
  }

  if (existing.requestHash === requestHash) {
    return {
      isRetry: true,
      result: existing.result as AuthoredResult,
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

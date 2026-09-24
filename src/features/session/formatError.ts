/**
 * Structured error formatting for System Studio (RV-12c2).
 *
 * Implements requirement: No raw exception text in the UI.
 * Shows messages derived strictly from typed result status/code
 * (missing, stale, invalid with issue messages, unavailable, quota).
 * Unexpected throws show a fixed generic message and are logged with console.error.
 */

import { RepositoryError } from '../../persistence/studio/errors';
import type { Issue } from '../../domain/studio/validate';

export function formatStudioError(
  err: unknown,
  fallbackGeneric = 'An unexpected error occurred',
): string {
  if (!err) return fallbackGeneric;

  // 1. RepositoryError instances from persistence
  if (err instanceof RepositoryError) {
    if (err.code === 'quota') return 'Storage quota exceeded. Please free up disk space.';
    if (err.code === 'unavailable') return 'Storage is currently unavailable.';
    if (err.code === 'not-found') return 'Requested project or resource not found.';
    if (err.code === 'stale') return 'Data conflict: repository record is stale.';
    if (err.code === 'limit') return 'Storage limit reached.';
    if (err.issues && err.issues.length > 0) {
      return err.issues.map((i) => i.message).filter(Boolean).join('; ');
    }
    return `Storage error (${err.code})`;
  }

  // 2. Typed result objects from session/repository
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;

    if (obj.status === 'invalid') {
      const issues = Array.isArray(obj.issues) ? (obj.issues as Issue[]) : [];
      const msg = issues.map((i) => i.message).filter(Boolean).join('; ');
      return msg || 'Invalid operation';
    }

    if (obj.status === 'missing') {
      const ids = Array.isArray(obj.ids) ? (obj.ids as string[]) : [];
      return ids.length > 0 ? `Resource missing: ${ids.join(', ')}` : 'Resource not found';
    }

    if (obj.status === 'stale') {
      const scope = typeof obj.scope === 'string' ? obj.scope : 'record';
      return `Conflict: ${scope} revision is stale. Please reload.`;
    }

    if (obj.status === 'busy') {
      return 'An operation is currently in progress. Please wait.';
    }

    if (obj.status === 'unsupported') {
      const task = typeof obj.task === 'string' ? obj.task : '';
      return task ? `Unsupported operation: ${task}` : 'Operation is not supported';
    }

    if (obj.status === 'failed' || typeof obj.code === 'string') {
      const code = (obj.code as string) ?? '';
      if (code === 'quota') return 'Storage quota exceeded. Please free up disk space.';
      if (code === 'unavailable') return 'Storage is currently unavailable.';
      if (code === 'not-found') return 'Resource not found.';
      if (code === 'stale') return 'Data conflict: record is stale.';
      if (code === 'limit') return 'Storage limit reached.';
      const issues = Array.isArray(obj.issues) ? (obj.issues as Issue[]) : [];
      if (issues.length > 0) {
        return issues.map((i) => i.message).filter(Boolean).join('; ');
      }
      if (code) return `Operation failed (${code})`;
    }
  }

  return fallbackGeneric;
}

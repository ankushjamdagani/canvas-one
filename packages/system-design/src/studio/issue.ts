import { createIssue as createBoardIssue } from '@canvas-one/whiteboard';
import type { Id } from './model.js';
import type { Issue, IssueCode } from './validate.js';

/** An Issue with the given code and location; severity defaults to `error`. */
export function createIssue(
  code: IssueCode,
  message: string,
  path: readonly (string | number)[] = [],
  entityId: Id | null = null,
  severity: Issue['severity'] = 'error',
): Issue {
  return createBoardIssue(code, message, path, entityId, severity);
}

/** An error-severity Issue, positional in the order validators naturally have to hand. */
export function errorIssue(
  code: IssueCode,
  path: readonly (string | number)[],
  entityId: Id | null,
  message: string,
): Issue {
  return { code, path, entityId, severity: 'error', message };
}

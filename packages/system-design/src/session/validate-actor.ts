import type { Actor } from './contracts.js';
import type { Issue } from '../studio/validate.js';
import { createIssue } from '../studio/issue.js';

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

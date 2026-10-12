/** Missing error details are a broken controller contract, never user-facing copy. */
export class ResultMessageContractError extends Error {}

export function requireResultMessage(result: unknown): string {
  if (typeof result === 'string' && result.trim()) return result;
  if (result && typeof result === 'object') {
    if ('issues' in result && Array.isArray(result.issues)) {
      const issue: unknown = result.issues[0];
      if (
        issue &&
        typeof issue === 'object' &&
        'message' in issue &&
        typeof issue.message === 'string' &&
        issue.message.trim()
      )
        return issue.message;
    }
    if ('message' in result && typeof result.message === 'string' && result.message.trim()) return result.message;
  }
  throw new ResultMessageContractError('Controller failure has no real message; contract violation');
}

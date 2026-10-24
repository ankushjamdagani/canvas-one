const messages: Readonly<Record<string, string>> = {
  'invalid-pairing': 'The pairing secret expired or was already used. Restart the local service and use its new secret.',
  'invalid-session': 'The local session expired. Restart the service and reconnect; your completed changes remain saved.',
  'session-expired': 'The local session expired. Restart the service and reconnect; your completed changes remain saved.',
  'provider-unavailable': 'This agent cannot run board tasks yet. Choose another connected agent.',
  'explicit-resume-required': 'This attempt ended. Resume the task explicitly to continue.',
  'execution-identity-reused': 'This attempt already ended. Resume the task to start a new attempt.',
  'session-attempt-limit': 'The local service reached its session limit. Restart it, reconnect, and resume the task.',
  'stale-attempt': 'This attempt already ended. Check the current task before retrying.',
  'stale-ledger': 'The task changed while this action was pending. Check its current state before retrying.',
  'storage-conflict': 'Task history changed elsewhere. Reload the board before continuing.',
  'invalid-storage': 'Saved task history could not be read. It has been preserved; reload before continuing.',
  'unknown-outcome': 'The saved result could not be confirmed. Inspect the current board and reload before continuing.',
  busy: 'An editing task is already active on this board. Stop it or finish its review before starting another.',
  'invalid-transition': 'This action is no longer available for the task’s current state.',
};
export function conversationErrorMessage(error: unknown): string {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : 'The action could not finish. Please try again.';
  return messages[message] ?? message;
}

/** Serializable task metadata. The host persists it alongside authored transactions. */
export type TaskScope = { readonly projectId: string; readonly branchId: string; readonly boardId: string };
export type TaskStatus = 'requested' | 'working' | 'waiting' | 'interrupted' | 'completed' | 'stopped' | 'failed';
export type TaskWaitReason = 'review' | 'clarification' | 'overlap' | 'feedbackDelivery';
export type TaskPermission = 'suggest' | 'live';
export type TaskAttempt = { readonly id: string; readonly generation: number; readonly status: 'requested' | 'working' | 'finished' | 'revoked'; readonly cancellation: 'none' | 'pending' | 'acknowledged'; readonly providerSessionId?: string };
export type CollaborationTask = {
  readonly id: string; readonly actorId: string; readonly scope: TaskScope; readonly instruction: string;
  /** Immutable execution provider identity; absent on ledgers created before provider binding. */
  readonly providerId?: string;
  readonly permission: TaskPermission; readonly status: TaskStatus; readonly generation: number;
  /** Questions use independent read-only execution and never reserve an editing slot. */
  readonly kind?: 'edit' | 'question';
  readonly attempts: readonly TaskAttempt[]; readonly waitReason?: TaskWaitReason; readonly failure?: string;
  readonly cancellation: 'none' | 'pending' | 'acknowledged';
  /** Display-only recovery hint, never write authority. */
  readonly interruptedPermission?: TaskPermission;
};
export type TaskLedger = { readonly schema: 'canvas-one/tasks/1'; readonly revision: number; readonly tasks: readonly CollaborationTask[] };
export const emptyTaskLedger = (): TaskLedger => ({ schema: 'canvas-one/tasks/1', revision: 0, tasks: [] });
export type TaskBinding = { readonly taskId: string; readonly actorId: string; readonly scope: TaskScope };
export type AttemptBinding = TaskBinding & { readonly attemptId: string; readonly generation: number };
export type TaskCommand =
  | { readonly type: 'create'; readonly taskId: string; readonly attemptId: string; readonly actorId: string; readonly scope: TaskScope; readonly instruction: string; readonly kind?: 'edit' | 'question'; readonly providerId?: string }
  | (AttemptBinding & { readonly type: 'stop' | 'interrupt' })
  | (AttemptBinding & { readonly type: 'grantLive' })
  | (TaskBinding & { readonly type: 'acknowledgeCancellation'; readonly attemptId: string })
  | (TaskBinding & { readonly type: 'resume'; readonly attemptId: string; readonly permission: TaskPermission; readonly currentBoardValidated: boolean })
  | (TaskBinding & { readonly type: 'revise'; readonly attemptId: string; readonly currentBoardValidated: boolean; readonly permission?: TaskPermission })
  | (TaskBinding & { readonly type: 'answer'; readonly attemptId: string; readonly currentBoardValidated: boolean; readonly permission?: TaskPermission })
  | (AttemptBinding & { readonly type: 'finishWaiting'; readonly processClosed: boolean })
  | (AttemptBinding & { readonly type: 'start'; readonly providerSessionId?: string })
  | (AttemptBinding & { readonly type: 'recordSession'; readonly providerSessionId: string })
  | (AttemptBinding & { readonly type: 'wait'; readonly reason: TaskWaitReason; readonly attemptFinished?: boolean })
  | (AttemptBinding & { readonly type: 'continue'; readonly dependenciesValidated: boolean })
  | (AttemptBinding & { readonly type: 'complete'; readonly unresolvedDecisions: number; readonly pendingWrites: number })
  | (AttemptBinding & { readonly type: 'fail'; readonly reason: string });
export type TaskError = 'stale-ledger' | 'not-found' | 'invalid-input' | 'scope-mismatch' | 'actor-mismatch' | 'busy' | 'duplicate-id' | 'invalid-transition' | 'stale-attempt' | 'unresolved-work';
export type TaskResult = { readonly ok: true; readonly ledger: TaskLedger; readonly task: CollaborationTask } | { readonly ok: false; readonly code: TaskError };
const active = (status: TaskStatus) => status === 'requested' || status === 'working' || status === 'waiting';
const sameScope = (a: TaskScope, b: TaskScope) => a.boardId === b.boardId && a.projectId === b.projectId && a.branchId === b.branchId;
const validText = (value: string) => typeof value === 'string' && value.trim().length > 0;
const validScope = (scope: unknown): scope is TaskScope => !!scope && typeof scope === 'object' && !Array.isArray(scope) && validText((scope as TaskScope).boardId) && validText((scope as TaskScope).projectId) && validText((scope as TaskScope).branchId);
const validInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;
const error = (code: TaskError): TaskResult => ({ ok: false, code });

/**
 * Pure transition: persist the returned ledger with compare-and-swap on expectedRevision.
 * Run this and authorizeTaskWrite inside the host's serialized authority transaction.
 * Never publish success before persistence, or use a cached ledger to authorize a write.
 * Commands are issued by the authenticated host, not accepted directly from provider text.
 */
export function transitionTask(ledger: TaskLedger, expectedRevision: number, command: TaskCommand): TaskResult {
  if (!validInteger(expectedRevision) || !validInteger(ledger.revision) || ledger.revision === Number.MAX_SAFE_INTEGER) return error('invalid-input');
  if (ledger.revision !== expectedRevision) return error('stale-ledger');
  if (!command || typeof command !== 'object' || Array.isArray(command) || !['create', 'grantLive', 'stop', 'interrupt', 'acknowledgeCancellation', 'resume', 'revise', 'answer', 'finishWaiting', 'start', 'recordSession', 'wait', 'continue', 'complete', 'fail'].includes(command.type)) return error('invalid-input');
  if (!validText(command.taskId) || !validText(command.actorId) || !validScope(command.scope)) return error('invalid-input');
  if (['grantLive', 'start', 'recordSession', 'wait', 'continue', 'complete', 'fail', 'finishWaiting', 'stop', 'interrupt'].includes(command.type) && !('generation' in command)) return error('invalid-input');
  if ('generation' in command && (!validInteger(command.generation) || command.generation === 0 || !validText(command.attemptId))) return error('invalid-input');
  if ((command.type === 'start' && command.providerSessionId !== undefined || command.type === 'recordSession') && (!validText(command.providerSessionId!) || command.providerSessionId!.length > 200)) return error('invalid-input');
  if (command.type === 'wait' && command.attemptFinished !== undefined && typeof command.attemptFinished !== 'boolean') return error('invalid-input');
  if (command.type === 'complete' && (!validInteger(command.unresolvedDecisions) || !validInteger(command.pendingWrites))) return error('invalid-input');
  const index = ledger.tasks.findIndex(task => task.id === command.taskId);
  let task: CollaborationTask;
  const busy = () => ledger.tasks.some(other => other.id !== command.taskId && other.kind !== 'question' && sameScope(other.scope, command.scope) && active(other.status));
  if (command.type === 'create') {
    if (index !== -1 || ledger.tasks.some(other => other.attempts.some(attempt => attempt.id === command.attemptId))) return error('duplicate-id');
    if (!validText(command.attemptId) || !validText(command.instruction)) return error('invalid-input');
    if (command.providerId !== undefined && (!validText(command.providerId) || command.providerId.length > 200)) return error('invalid-input');
    if (command.kind !== undefined && command.kind !== 'edit' && command.kind !== 'question') return error('invalid-input');
    if (command.kind !== 'question' && busy()) return error('busy');
    task = { id: command.taskId, actorId: command.actorId, scope: { ...command.scope }, instruction: command.instruction, ...(command.providerId !== undefined ? { providerId: command.providerId } : {}), kind: command.kind ?? 'edit', permission: 'suggest', status: 'requested', generation: 1, attempts: [{ id: command.attemptId, generation: 1, status: 'requested', cancellation: 'none' }], cancellation: 'none' };
  } else {
    if (index === -1) return error('not-found');
    task = ledger.tasks[index]!;
    if (!sameScope(task.scope, command.scope)) return error('scope-mismatch');
    if (task.actorId !== command.actorId) return error('actor-mismatch');
    const current = task.attempts.at(-1)!;
    if (['complete', 'stop', 'interrupt', 'fail', 'resume', 'revise', 'answer'].includes(command.type) && task.generation === Number.MAX_SAFE_INTEGER) return error('invalid-input');
    if ('generation' in command && (command.generation !== task.generation || command.attemptId !== current.id || current.status === 'revoked')) return error('stale-attempt');
    const attempt = (patch: Partial<TaskAttempt>) => task.attempts.map((value, i) => i === task.attempts.length - 1 ? { ...value, ...patch } : value);
    switch (command.type) {
      case 'grantLive':
        if (!active(task.status) || task.kind === 'question') return error('invalid-transition');
        task = { ...task, permission: 'live' }; break;
      case 'start':
        if (task.status !== 'requested') return error('invalid-transition');
        if (command.providerSessionId && current.providerSessionId && current.providerSessionId !== command.providerSessionId) return error('invalid-transition');
        task = { ...task, status: 'working', attempts: attempt({ status: 'working', ...(command.providerSessionId ? { providerSessionId: command.providerSessionId } : {}) }) }; break;
      case 'recordSession':
        if (!active(task.status) || current.providerSessionId && current.providerSessionId !== command.providerSessionId) return error('invalid-transition');
        task = { ...task, attempts: attempt({ providerSessionId: command.providerSessionId }) }; break;
      case 'finishWaiting':
        if (task.status !== 'waiting' || task.waitReason !== 'clarification' || current.status !== 'working' || command.processClosed !== true) return error('invalid-transition');
        task = { ...task, attempts: attempt({ status: 'finished' }) }; break;
      case 'wait':
        if (task.status !== 'working' || !['review', 'clarification', 'overlap', 'feedbackDelivery'].includes(command.reason)) return error('invalid-transition');
        if (command.attemptFinished && command.reason !== 'review') return error('invalid-transition');
        task = { ...task, status: 'waiting', waitReason: command.reason, attempts: command.attemptFinished ? attempt({ status: 'finished' }) : task.attempts }; break;
      case 'continue':
        if (task.status !== 'waiting' || current.status !== 'working') return error('invalid-transition');
        if (command.dependenciesValidated !== true) return error('unresolved-work');
        task = { ...task, status: 'working', waitReason: undefined }; break;
      case 'complete':
        if (task.status !== 'working' && task.status !== 'waiting') return error('invalid-transition');
        if (command.unresolvedDecisions !== 0 || command.pendingWrites !== 0) return error('unresolved-work');
        task = { ...task, status: 'completed', waitReason: undefined, generation: task.generation + 1, attempts: attempt({ status: 'finished' }) }; break;
      case 'stop': case 'interrupt': case 'fail':
        if (!active(task.status)) return error('invalid-transition');
        if (command.type === 'fail' && !validText(command.reason)) return error('invalid-input');
        task = { ...task, status: command.type === 'stop' ? 'stopped' : command.type === 'interrupt' ? 'interrupted' : 'failed', generation: task.generation + 1, waitReason: undefined, permission: 'suggest', interruptedPermission: command.type === 'interrupt' ? task.permission : undefined, attempts: attempt({ status: 'revoked', cancellation: 'pending' }), cancellation: 'pending', failure: command.type === 'fail' ? command.reason : undefined }; break;
      case 'acknowledgeCancellation':
        {
          const cancelled = task.attempts.find(value => value.id === command.attemptId);
          if (!cancelled) return error('stale-attempt');
          if (cancelled.cancellation !== 'pending') return error('invalid-transition');
          task = { ...task, cancellation: command.attemptId === current.id ? 'acknowledged' : task.cancellation, attempts: task.attempts.map(value => value.id === command.attemptId ? { ...value, cancellation: 'acknowledged' } : value) }; break;
        }
      case 'resume': case 'revise': case 'answer':
        if (command.type === 'resume' ? task.status !== 'interrupted' && task.status !== 'failed' : task.status !== 'waiting' || task.waitReason !== (command.type === 'answer' ? 'clarification' : 'review') || current.status !== 'finished') return error('invalid-transition');
        if (command.currentBoardValidated !== true) return error('unresolved-work');
        if (task.kind !== 'question' && busy()) return error('busy');
        if (task.kind === 'question' && command.permission === 'live') return error('invalid-transition');
        if (!validText(command.attemptId) || (command.type === 'resume' ? command.permission !== 'suggest' && command.permission !== 'live' : command.permission !== undefined && command.permission !== 'suggest' && command.permission !== 'live')) return error('invalid-input');
        if (ledger.tasks.some(other => other.attempts.some(value => value.id === command.attemptId))) return error('duplicate-id');
        task = { ...task, status: 'requested', generation: task.generation + 1, permission: command.type === 'resume' ? command.permission : command.permission ?? 'suggest', interruptedPermission: undefined, waitReason: undefined, failure: undefined, cancellation: 'none', attempts: [...task.attempts, { id: command.attemptId, generation: task.generation + 1, status: 'requested', cancellation: 'none' }] }; break;
    }
  }
  return { ok: true, task, ledger: { ...ledger, revision: ledger.revision + 1, tasks: index === -1 ? [...ledger.tasks, task] : ledger.tasks.map((value, i) => i === index ? task : value) } };
}

/** Additional dependency and lease checks remain the authored host's responsibility. */
export function authorizeTaskWrite(ledger: TaskLedger, binding: AttemptBinding, action: { readonly dependenciesValidated: boolean; readonly leaseValid: boolean; readonly independentOfOverlap?: boolean }): { readonly ok: true } | { readonly ok: false; readonly code: TaskError | 'suggest-only' | 'expired' | 'blocked' } {
  if (!binding || !validScope(binding.scope) || !validText(binding.taskId) || !validText(binding.actorId) || !validText(binding.attemptId) || !validInteger(binding.generation)) return { ok: false, code: 'invalid-input' };
  const task = ledger.tasks.find(value => value.id === binding.taskId);
  if (!task) return { ok: false, code: 'not-found' };
  if (!sameScope(task.scope, binding.scope)) return { ok: false, code: 'scope-mismatch' };
  if (task.actorId !== binding.actorId) return { ok: false, code: 'actor-mismatch' };
  if (task.kind === 'question') return { ok: false, code: 'blocked' };
  const attempt = task.attempts.at(-1)!;
  if (binding.generation !== task.generation || binding.attemptId !== attempt.id || attempt.status !== 'working') return { ok: false, code: 'stale-attempt' };
  if (!action || action.leaseValid !== true) return { ok: false, code: 'expired' };
  if (task.permission !== 'live') return { ok: false, code: 'suggest-only' };
  if (action.dependenciesValidated !== true || (task.status !== 'working' && !(task.status === 'waiting' && task.waitReason === 'overlap' && action.independentOfOverlap === true))) return { ok: false, code: 'blocked' };
  return { ok: true };
}

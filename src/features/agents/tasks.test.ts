import { describe, expect, it } from 'vitest';
import { authorizeTaskWrite, emptyTaskLedger, transitionTask, type TaskCommand, type TaskLedger } from '@canvas-one/agents';

const scope = { boardId: 'board', projectId: 'project', branchId: 'branch' };
const binding = { taskId: 'task', actorId: 'claude', scope };
const attempt = { ...binding, attemptId: 'attempt', generation: 1 };
function apply(ledger: TaskLedger, command: TaskCommand): TaskLedger {
  const result = transitionTask(ledger, ledger.revision, command);
  if (!result.ok) throw new Error(result.code);
  return result.ledger;
}
const create = () => apply(emptyTaskLedger(), { ...binding, type: 'create', instruction: 'Draw flow', attemptId: 'attempt' });
const working = () => apply(create(), { ...attempt, type: 'start' });
const live = () => apply(working(), { ...attempt, type: 'grantLive' });
const check = (ledger: TaskLedger, overrides = {}) => authorizeTaskWrite(ledger, { ...attempt, ...overrides }, { dependenciesValidated: true, leaseValid: true });

describe('collaboration task authority', () => {
  it('rejects delayed Stop and interruption from an older execution attempt', () => {
    const interrupted = apply(working(), { ...attempt, type: 'interrupt' });
    const resumed = apply(interrupted, { ...binding, type: 'resume', attemptId: 'new', permission: 'suggest', currentBoardValidated: true });
    const running = apply(resumed, { ...binding, attemptId: 'new', generation: 3, type: 'start' });
    for (const type of ['stop', 'interrupt'] as const) expect(transitionTask(running, running.revision, { ...attempt, type })).toEqual({ ok: false, code: 'stale-attempt' });
    expect(running.tasks[0].status).toBe('working');
  });
  it('keeps an explicit clarification recoverable and requires process close before answering', () => {
    let ledger = apply(live(), { ...attempt, type: 'wait', reason: 'clarification' });
    expect(transitionTask(ledger, ledger.revision, { ...binding, type: 'answer', attemptId: 'answer', currentBoardValidated: true })).toMatchObject({ ok: false, code: 'invalid-transition' });
    expect(transitionTask(ledger, ledger.revision, { ...attempt, type: 'finishWaiting', processClosed: false })).toMatchObject({ ok: false });
    ledger = apply(ledger, { ...attempt, type: 'finishWaiting', processClosed: true });
    ledger = apply(ledger, { ...binding, type: 'answer', attemptId: 'answer', currentBoardValidated: true });
    expect(ledger.tasks[0]).toMatchObject({ status: 'requested', permission: 'suggest', generation: 2 });
    expect(ledger.tasks[0].attempts.at(-1)).toMatchObject({ id: 'answer', generation: 2, status: 'requested' });
    expect(check(ledger)).toMatchObject({ ok: false, code: 'stale-attempt' });
  });
  it('binds the provider at creation and preserves it through execution and resume', () => {
    let ledger = apply(emptyTaskLedger(), { ...binding, type: 'create', instruction: 'Draw flow', attemptId: 'attempt', providerId: 'claude' });
    ledger = apply(ledger, { ...attempt, type: 'start' });
    ledger = apply(ledger, { ...attempt, type: 'grantLive' });
    ledger = apply(ledger, { ...attempt, type: 'interrupt' });
    ledger = apply(ledger, { ...binding, type: 'resume', attemptId: 'resumed', permission: 'suggest', currentBoardValidated: true });
    expect(ledger.tasks[0]?.providerId).toBe('claude');
    expect(create().tasks[0]?.providerId).toBeUndefined();
  });
  it('rejects malformed provider identities without creating a task', () => {
    for (const providerId of ['', '  ', 'x'.repeat(201), null, 42, {}]) {
      expect(transitionTask(emptyTaskLedger(), 0, { ...binding, type: 'create', instruction: 'Draw flow', attemptId: 'attempt', providerId } as unknown as TaskCommand)).toEqual({ ok: false, code: 'invalid-input' });
    }
    expect(apply(emptyTaskLedger(), { ...binding, type: 'create', instruction: 'Draw flow', attemptId: 'attempt', providerId: 'x'.repeat(200) }).tasks[0]?.providerId).toHaveLength(200);
  });
  it('defaults every new task to Suggest and serializes cleanly', () => {
    const ledger = working();
    expect(JSON.parse(JSON.stringify(ledger))).toEqual(ledger);
    expect(check(ledger)).toEqual({ ok: false, code: 'suggest-only' });
    expect(check(live())).toEqual({ ok: true });
  });
  it('uses compare-and-swap and reserves the board while waiting for review', () => {
    const ledger = apply(working(), { ...attempt, type: 'wait', reason: 'review', attemptFinished: true });
    expect(transitionTask(ledger, 0, { ...attempt, type: 'stop' })).toEqual({ ok: false, code: 'stale-ledger' });
    expect(transitionTask(ledger, ledger.revision, { ...binding, taskId: 'second', attemptId: 'second-attempt', type: 'create', instruction: 'Other work' })).toEqual({ ok: false, code: 'busy' });
    const otherBoard = apply(ledger, { ...binding, scope: { ...scope, boardId: 'other' }, taskId: 'second', attemptId: 'second-attempt', type: 'create', instruction: 'Other work' });
    expect(otherBoard.tasks).toHaveLength(2);
  });
  it('fences queued writes when Stop wins and rejects late provider completion', () => {
    const before = live();
    const stopped = apply(before, { ...attempt, type: 'stop' });
    expect(check(stopped)).toEqual({ ok: false, code: 'stale-attempt' });
    expect(transitionTask(stopped, stopped.revision, { ...attempt, type: 'complete', unresolvedDecisions: 0, pendingWrites: 0 })).toEqual({ ok: false, code: 'stale-attempt' });
    expect(before.tasks[0]?.status).toBe('working');
    expect(stopped.tasks[0]?.cancellation).toBe('pending');
    expect(apply(stopped, { ...binding, type: 'acknowledgeCancellation', attemptId: 'attempt' }).tasks[0]?.status).toBe('stopped');
  });
  it('requires validated explicit recovery and prevents old-attempt authority reuse', () => {
    const interrupted = apply(live(), { ...attempt, type: 'interrupt' });
    expect(interrupted.tasks[0]?.permission).toBe('suggest');
    expect(transitionTask(interrupted, interrupted.revision, { ...binding, type: 'resume', attemptId: 'new', permission: 'live', currentBoardValidated: false })).toEqual({ ok: false, code: 'unresolved-work' });
    const resumed = apply(interrupted, { ...binding, type: 'resume', attemptId: 'new', permission: 'suggest', currentBoardValidated: true });
    const next = { ...binding, attemptId: 'new', generation: 3 };
    const running = apply(resumed, { ...next, type: 'start' });
    expect(check(running)).toEqual({ ok: false, code: 'stale-attempt' });
    expect(authorizeTaskWrite(running, next, { dependenciesValidated: true, leaseValid: true })).toEqual({ ok: false, code: 'suggest-only' });
    const stoppedAgain = apply(running, { ...next, type: 'stop' });
    const oldAcknowledged = apply(stoppedAgain, { ...binding, type: 'acknowledgeCancellation', attemptId: 'attempt' });
    expect(oldAcknowledged.tasks[0]?.attempts[0]?.cancellation).toBe('acknowledged');
    expect(oldAcknowledged.tasks[0]?.attempts[1]?.cancellation).toBe('pending');
    expect(oldAcknowledged.tasks[0]?.cancellation).toBe('pending');
  });
  it('binds permission to actor, board, branch and project', () => {
    for (const override of [{ actorId: 'codex' }, { scope: { ...scope, boardId: 'other' } }, { scope: { ...scope, branchId: 'other' } }, { scope: { ...scope, projectId: 'other' } }]) {
      expect(check(live(), override).ok).toBe(false);
    }
    expect(transitionTask(live(), live().revision, { ...attempt, actorId: 'codex', type: 'stop' })).toEqual({ ok: false, code: 'actor-mismatch' });
  });
  it('allows only independently validated work during overlap and respects lease expiry', () => {
    const waiting = apply(live(), { ...attempt, type: 'wait', reason: 'overlap' });
    expect(check(waiting)).toEqual({ ok: false, code: 'blocked' });
    expect(authorizeTaskWrite(waiting, attempt, { dependenciesValidated: true, leaseValid: true, independentOfOverlap: true })).toEqual({ ok: true });
    expect(authorizeTaskWrite(waiting, attempt, { dependenciesValidated: false, leaseValid: true, independentOfOverlap: true }).ok).toBe(false);
    expect(authorizeTaskWrite(live(), attempt, { dependenciesValidated: true, leaseValid: false })).toEqual({ ok: false, code: 'expired' });
    const review = apply(live(), { ...attempt, type: 'wait', reason: 'review' });
    expect(authorizeTaskWrite(review, attempt, { dependenciesValidated: true, leaseValid: true, independentOfOverlap: true }).ok).toBe(false);
  });
  it('retains a finished attempt for human review and refuses premature completion', () => {
    const waiting = apply(working(), { ...attempt, type: 'wait', reason: 'review', attemptFinished: true });
    expect(transitionTask(waiting, waiting.revision, { ...attempt, type: 'continue', dependenciesValidated: true })).toEqual({ ok: false, code: 'invalid-transition' });
    expect(transitionTask(waiting, waiting.revision, { ...attempt, type: 'complete', unresolvedDecisions: 1, pendingWrites: 0 })).toEqual({ ok: false, code: 'unresolved-work' });
    const completed = apply(waiting, { ...attempt, type: 'complete', unresolvedDecisions: 0, pendingWrites: 0 });
    expect(completed.tasks[0]?.status).toBe('completed');
    expect(transitionTask(completed, completed.revision, { ...attempt, type: 'grantLive' })).toEqual({ ok: false, code: 'stale-attempt' });
    expect(transitionTask(completed, completed.revision, { ...binding, type: 'resume', attemptId: 'new', permission: 'live', currentBoardValidated: true })).toEqual({ ok: false, code: 'invalid-transition' });
  });
  it('does not resume into another task holding the board or reuse attempt identities', () => {
    const interrupted = apply(working(), { ...attempt, type: 'interrupt' });
    const occupied = apply(interrupted, { ...binding, taskId: 'other', attemptId: 'other', type: 'create', instruction: 'Other' });
    expect(transitionTask(occupied, occupied.revision, { ...binding, type: 'resume', attemptId: 'new', permission: 'suggest', currentBoardValidated: true })).toEqual({ ok: false, code: 'busy' });
    expect(transitionTask(interrupted, interrupted.revision, { ...binding, type: 'resume', attemptId: 'attempt', permission: 'suggest', currentBoardValidated: true })).toEqual({ ok: false, code: 'duplicate-id' });
  });
  it('revises a finished proposal in the same task with a fresh attempt', () => {
    const waiting = apply(working(), { ...attempt, type: 'wait', reason: 'review', attemptFinished: true });
    const revised = apply(waiting, { ...binding, type: 'revise', attemptId: 'revision-attempt', currentBoardValidated: true });
    expect(revised.tasks[0]?.id).toBe('task');
    expect(revised.tasks[0]?.attempts).toHaveLength(2);
    expect(revised.tasks[0]?.permission).toBe('suggest');
    expect(transitionTask(revised, revised.revision, { ...attempt, type: 'complete', unresolvedDecisions: 0, pendingWrites: 0 })).toEqual({ ok: false, code: 'stale-attempt' });
  });
  it('rejects malformed runtime commands, coercive validation and counter overflow', () => {
    const ledger = working();
    for (const command of [null, undefined, {}, { ...binding, type: 'invented' }, { ...binding, scope: null, type: 'stop' }, { ...attempt, type: 'complete', unresolvedDecisions: -1, pendingWrites: 0 }, { ...attempt, type: 'wait', reason: 'review', attemptFinished: 'true' }]) {
      expect(transitionTask(ledger, ledger.revision, command as unknown as TaskCommand)).toEqual({ ok: false, code: 'invalid-input' });
    }
    const waiting = apply(ledger, { ...attempt, type: 'wait', reason: 'overlap' });
    expect(transitionTask(waiting, waiting.revision, { ...attempt, type: 'continue', dependenciesValidated: 'true' } as unknown as TaskCommand)).toEqual({ ok: false, code: 'unresolved-work' });
    expect(transitionTask({ ...ledger, revision: Number.MAX_SAFE_INTEGER }, Number.MAX_SAFE_INTEGER, { ...attempt, type: 'stop' })).toEqual({ ok: false, code: 'invalid-input' });
    const maxGeneration = { ...ledger, tasks: [{ ...ledger.tasks[0]!, generation: Number.MAX_SAFE_INTEGER }] };
    expect(transitionTask(maxGeneration, maxGeneration.revision, { ...attempt, type: 'stop' })).toEqual({ ok: false, code: 'invalid-input' });
    expect(authorizeTaskWrite(live(), { ...attempt, scope: null } as unknown as typeof attempt, { dependenciesValidated: true, leaseValid: true })).toEqual({ ok: false, code: 'invalid-input' });
    expect(transitionTask(ledger, ledger.revision, { ...attempt, type: 'wait', reason: 'clarification', attemptFinished: true })).toEqual({ ok: false, code: 'invalid-transition' });
  });
  it('rejects stale Live dialogs and defaults revision authority to Suggest unless explicitly chosen', () => {
    const interrupted = apply(live(), { ...attempt, type: 'interrupt' });
    const resumed = apply(interrupted, { ...binding, type: 'resume', attemptId: 'new', permission: 'suggest', currentBoardValidated: true });
    expect(transitionTask(resumed, resumed.revision, { ...attempt, type: 'grantLive' })).toEqual({ ok: false, code: 'stale-attempt' });
    expect(resumed.tasks[0]?.attempts[0]?.cancellation).toBe('pending');
    const finished = apply(live(), { ...attempt, type: 'wait', reason: 'review', attemptFinished: true });
    expect(apply(finished, { ...binding, type: 'revise', attemptId: 'revision', currentBoardValidated: true }).tasks[0]?.permission).toBe('suggest');
    expect(apply(finished, { ...binding, type: 'revise', attemptId: 'revision', currentBoardValidated: true, permission: 'live' }).tasks[0]?.permission).toBe('live');
  });
  it('runs questions alongside editing without transferring Live authority or reserving another edit slot', () => {
    const editing = live();
    const questionBinding = { ...binding, taskId: 'question', attemptId: 'question-attempt', generation: 1 };
    const questioning = apply(editing, { ...questionBinding, type: 'create', kind: 'question', instruction: 'Explain this board' });
    const running = apply(questioning, { ...questionBinding, type: 'start' });
    expect(running.tasks.map(task => task.kind)).toEqual(['edit', 'question']);
    expect(transitionTask(running, running.revision, { ...questionBinding, type: 'grantLive' })).toEqual({ ok: false, code: 'invalid-transition' });
    expect(authorizeTaskWrite(running, questionBinding, { dependenciesValidated: true, leaseValid: true })).toEqual({ ok: false, code: 'blocked' });
    expect(check(running)).toEqual({ ok: true });
    expect(transitionTask(running, running.revision, { ...binding, taskId: 'other', attemptId: 'other', type: 'create', instruction: 'Other edit' })).toEqual({ ok: false, code: 'busy' });
    const interrupted = apply(running, { ...questionBinding, type: 'interrupt' });
    expect(transitionTask(interrupted, interrupted.revision, { ...binding, taskId: 'question', type: 'resume', attemptId: 'new-question', permission: 'live', currentBoardValidated: true })).toEqual({ ok: false, code: 'invalid-transition' });
    expect(apply(interrupted, { ...binding, taskId: 'question', type: 'resume', attemptId: 'new-question', permission: 'suggest', currentBoardValidated: true }).tasks[1]?.status).toBe('requested');
  });
  it('records provider sessions on the current attempt once without accepting foreign replacement or late attempts', () => {
    const recorded = apply(working(), { ...attempt, type: 'recordSession', providerSessionId: 'provider-session' });
    expect(recorded.tasks[0]?.attempts[0]?.providerSessionId).toBe('provider-session');
    expect(apply(recorded, { ...attempt, type: 'recordSession', providerSessionId: 'provider-session' }).tasks[0]?.attempts).toHaveLength(1);
    expect(transitionTask(recorded, recorded.revision, { ...attempt, type: 'recordSession', providerSessionId: 'foreign' })).toEqual({ ok: false, code: 'invalid-transition' });
    expect(transitionTask(recorded, recorded.revision, { ...attempt, type: 'recordSession', providerSessionId: 'x'.repeat(201) })).toEqual({ ok: false, code: 'invalid-input' });
    const interrupted = apply(recorded, { ...attempt, type: 'interrupt' });
    expect(transitionTask(interrupted, interrupted.revision, { ...attempt, type: 'recordSession', providerSessionId: 'provider-session' })).toEqual({ ok: false, code: 'stale-attempt' });
  });
});

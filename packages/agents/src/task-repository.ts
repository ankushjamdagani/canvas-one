import { emptyTaskLedger, transitionTask, type TaskCommand, type TaskLedger, type TaskResult, type TaskScope } from './tasks.js';

/** Host-owned durable storage. CAS must atomically compare and persist the entire JSON value. */
export interface TaskStorage {
  load(): Promise<string | null>;
  /** null means no record exists; a resolved true means persistence has acknowledged durability. */
  compareAndSwap(expectedRevision: number | null, serializedLedger: string): Promise<boolean>;
}
export type TaskRepositoryError = 'invalid-storage' | 'invalid-input' | 'persistence-failed' | 'storage-conflict' | 'unknown-outcome';
export type RepositoryResult = TaskResult | { readonly ok: false; readonly code: TaskRepositoryError };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const permission = (value: unknown) => value === 'suggest' || value === 'live';
const optionalText = (value: unknown) => value === undefined || text(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const active = (value: unknown) => value === 'requested' || value === 'working' || value === 'waiting';
const enumValue = (value: unknown, choices: readonly string[]) => typeof value === 'string' && choices.includes(value);

/** Reject malformed persisted data rather than resetting it or manufacturing missing identity. */
export function parseTaskLedger(serialized: string): TaskLedger | null {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { return null; }
  if (!object(value) || !keys(value, ['schema', 'revision', 'tasks']) || value.schema !== 'canvas-one/tasks/1' || !integer(value.revision) || !Array.isArray(value.tasks)) return null;
  const taskIds = new Set<string>(), attemptIds = new Set<string>(), occupied = new Set<string>();
  for (const task of value.tasks) {
    if (!object(task) || !keys(task, ['id', 'actorId', 'scope', 'instruction', 'providerId', 'kind', 'permission', 'status', 'generation', 'attempts', 'waitReason', 'failure', 'cancellation', 'interruptedPermission']) || !text(task.id) || taskIds.has(task.id) || !text(task.actorId) || !text(task.instruction) || !permission(task.permission) || !integer(task.generation, 1)) return null;
    if (task.providerId !== undefined && (!text(task.providerId) || task.providerId.length > 200)) return null;
    if (task.kind !== undefined && !enumValue(task.kind, ['edit', 'question']) || task.kind === 'question' && (task.permission === 'live' || task.interruptedPermission === 'live')) return null;
    taskIds.add(task.id);
    if (!object(task.scope) || !keys(task.scope, ['projectId', 'branchId', 'boardId']) || !text(task.scope.projectId) || !text(task.scope.branchId) || !text(task.scope.boardId)) return null;
    if (!enumValue(task.status, ['requested', 'working', 'waiting', 'interrupted', 'completed', 'stopped', 'failed']) || !enumValue(task.cancellation, ['none', 'pending', 'acknowledged']) || !optionalText(task.failure)) return null;
    if (task.status === 'waiting' ? !enumValue(task.waitReason, ['review', 'clarification', 'overlap', 'feedbackDelivery']) : task.waitReason !== undefined) return null;
    if (task.interruptedPermission !== undefined && (task.status !== 'interrupted' || !permission(task.interruptedPermission))) return null;
    if (task.status === 'failed' ? !text(task.failure) : task.failure !== undefined) return null;
    if (!Array.isArray(task.attempts) || task.attempts.length === 0) return null;
    let previousGeneration = 0;
    for (const [index, attempt] of task.attempts.entries()) {
      if (!object(attempt) || !keys(attempt, ['id', 'generation', 'status', 'cancellation', 'providerSessionId']) || !text(attempt.id) || attemptIds.has(attempt.id) || !integer(attempt.generation, 1) || attempt.generation <= previousGeneration || attempt.generation > task.generation || !enumValue(attempt.status, ['requested', 'working', 'finished', 'revoked']) || !enumValue(attempt.cancellation, ['none', 'pending', 'acknowledged']) || !optionalText(attempt.providerSessionId)) return null;
      if (typeof attempt.providerSessionId === 'string' && attempt.providerSessionId.length > 200) return null;
      if (attempt.status === 'revoked' ? attempt.cancellation === 'none' : attempt.cancellation !== 'none') return null;
      if (index === 0 ? attempt.generation !== 1 : attempt.generation !== previousGeneration + (task.attempts[index - 1].status === 'revoked' ? 2 : 1)) return null;
      if (index < task.attempts.length - 1 && attempt.status !== 'finished' && attempt.status !== 'revoked') return null;
      attemptIds.add(attempt.id); previousGeneration = attempt.generation;
    }
    const last = task.attempts.at(-1)!;
    if (task.cancellation !== last.cancellation) return null;
    if (active(task.status)) {
      const board = JSON.stringify([task.scope.projectId, task.scope.branchId, task.scope.boardId]);
      if (task.kind !== 'question' && occupied.has(board) || last.generation !== task.generation || task.cancellation !== 'none') return null;
      if (task.kind !== 'question') occupied.add(board);
      if (task.status === 'requested' && last.status !== 'requested' || task.status === 'working' && last.status !== 'working' || task.status === 'waiting' && last.status !== 'working' && last.status !== 'finished') return null;
      if (last.status === 'finished' && task.waitReason !== 'review' && task.waitReason !== 'clarification') return null;
    } else {
      if (last.generation + 1 !== task.generation) return null;
      if (task.status === 'completed' ? last.status !== 'finished' || task.cancellation !== 'none' : last.status !== 'revoked' || task.permission !== 'suggest' || task.cancellation === 'none') return null;
    }
  }
  return freeze(value as unknown as TaskLedger);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** Call on an actual host departure/recovery boundary, never on ordinary second-client load. */
export function recoverTasksOnReload(ledger: TaskLedger, departed: { readonly actorId: string; readonly scope: TaskScope }): TaskLedger {
  if (!departed || !text(departed.actorId) || !object(departed.scope) || !text(departed.scope.boardId) || !text(departed.scope.projectId) || !text(departed.scope.branchId)) throw new Error('Invalid departure identity');
  let recovered = ledger;
  for (const task of ledger.tasks) {
    if (!active(task.status) || task.actorId !== departed.actorId || task.scope.boardId !== departed.scope.boardId || task.scope.projectId !== departed.scope.projectId || task.scope.branchId !== departed.scope.branchId || task.attempts.at(-1)?.status === 'finished') continue;
    const result = transitionTask(recovered, recovered.revision, { type: 'interrupt', taskId: task.id, actorId: task.actorId, scope: task.scope, attemptId: task.attempts.at(-1)!.id, generation: task.generation });
    if (!result.ok) throw new Error(`Cannot fence task: ${result.code}`);
    recovered = result.ledger;
  }
  return recovered;
}

/** Queues local mutations; cross-instance exclusion belongs to the storage CAS implementation. */
export class TaskRepository {
  private tail: Promise<unknown> = Promise.resolve();
  private outcomeUnknown = false;
  private constructor(private readonly storage: TaskStorage, private ledger: TaskLedger, private storedRevision: number | null) {}
  static async open(storage: TaskStorage): Promise<{ readonly ok: true; readonly repository: TaskRepository } | { readonly ok: false; readonly code: TaskRepositoryError }> {
    try {
      const raw = await storage.load();
      const ledger = raw === null ? freeze(emptyTaskLedger()) : parseTaskLedger(raw);
      return ledger ? { ok: true, repository: new TaskRepository(storage, ledger, raw === null ? null : ledger.revision) } : { ok: false, code: 'invalid-storage' };
    } catch { return { ok: false, code: 'persistence-failed' }; }
  }
  getSnapshot(): TaskLedger { return this.ledger; }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async save(next: TaskLedger): Promise<TaskRepositoryError | null> {
    if (this.outcomeUnknown) return 'unknown-outcome';
    let serialized: string, validated: TaskLedger | null;
    try {
      serialized = JSON.stringify(next);
      validated = parseTaskLedger(serialized);
      if (!validated) return 'invalid-storage';
    } catch { return 'persistence-failed'; }
    try {
      if (!await this.storage.compareAndSwap(this.storedRevision, serialized)) return 'storage-conflict';
      this.ledger = validated; this.storedRevision = validated.revision;
      return null;
    } catch { this.outcomeUnknown = true; return 'unknown-outcome'; }
  }
  execute(command: TaskCommand, expectedRevision: number): Promise<RepositoryResult> {
    return this.executeQueued(command, expectedRevision);
  }
  /** Trusted host decisions bind attempts; choose revision only once prior queued decisions settle. */
  executeCurrent(command: TaskCommand): Promise<RepositoryResult> {
    return this.executeQueued(command, 'current');
  }
  private executeQueued(command: TaskCommand, expectedRevision: number | 'current'): Promise<RepositoryResult> {
    // Capture now: external callers cannot mutate a command while it waits in our queue.
    let captured: TaskCommand;
    try { captured = JSON.parse(JSON.stringify(command)) as TaskCommand; }
    catch { return Promise.resolve({ ok: false, code: 'invalid-input' }); }
    return this.enqueue(async () => {
      if (this.outcomeUnknown) return { ok: false, code: 'unknown-outcome' };
      const result = transitionTask(this.ledger, expectedRevision === 'current' ? this.ledger.revision : expectedRevision, captured);
      if (!result.ok) return result;
      const failure = await this.save(result.ledger);
      return failure ? { ok: false, code: failure } : { ok: true, ledger: this.ledger, task: this.ledger.tasks.find(task => task.id === result.task.id)! };
    });
  }
  refresh(): Promise<{ readonly ok: true; readonly ledger: TaskLedger } | { readonly ok: false; readonly code: TaskRepositoryError }> {
    return this.enqueue(async () => {
      try {
        const raw = await this.storage.load();
        const next = raw === null ? freeze(emptyTaskLedger()) : parseTaskLedger(raw);
        if (!next) return { ok: false, code: 'invalid-storage' };
        if (this.storedRevision !== null && (raw === null || next.revision < this.storedRevision)) return { ok: false, code: 'invalid-storage' };
        this.ledger = next; this.storedRevision = raw === null ? null : next.revision;
        this.outcomeUnknown = false;
        return { ok: true, ledger: next };
      } catch { return { ok: false, code: 'persistence-failed' }; }
    });
  }
  recoverAfterDeparture(departed: { readonly actorId: string; readonly scope: TaskScope }): Promise<{ readonly ok: true; readonly ledger: TaskLedger } | { readonly ok: false; readonly code: TaskRepositoryError }> {
    let captured: typeof departed;
    try { captured = JSON.parse(JSON.stringify(departed)) as typeof departed; }
    catch { return Promise.resolve({ ok: false, code: 'invalid-input' }); }
    return this.enqueue(async () => {
      if (this.outcomeUnknown) return { ok: false, code: 'unknown-outcome' };
      let next: TaskLedger;
      try { next = recoverTasksOnReload(this.ledger, captured); } catch { return { ok: false, code: 'invalid-input' }; }
      if (next === this.ledger) return { ok: true, ledger: this.ledger };
      const failure = await this.save(next);
      return failure ? { ok: false, code: failure } : { ok: true, ledger: this.ledger };
    });
  }
}

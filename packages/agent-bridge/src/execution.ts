/** A supervisor fences the relay before requesting process cancellation. It never owns board writes. */
export type ExecutionIdentity = {
  readonly taskId: string;
  readonly attemptId: string;
  readonly projectId: string;
  readonly branchId: string;
  readonly boardId: string;
  readonly actorId: string;
  readonly generation: number;
};
export type ExecutionProcess = { cancel(): Promise<void>; readonly finished: Promise<void> };
export type ExecutionLease = ExecutionIdentity & { readonly deadline: number };
export type CancellationOutcome = 'acknowledged' | 'failed';
type Attempt = {
  lease: ExecutionLease; process: ExecutionProcess | null; fenced: boolean; settled: boolean;
  startup: Promise<void>; cancellationPromise?: Promise<CancellationOutcome>;
  cancellation: 'none' | 'requested' | 'acknowledged' | 'failed';
};

function sameIdentity(a: ExecutionIdentity, b: ExecutionIdentity): boolean {
  return a.taskId === b.taskId && a.attemptId === b.attemptId && a.projectId === b.projectId &&
    a.branchId === b.branchId && a.boardId === b.boardId && a.actorId === b.actorId && a.generation === b.generation;
}

export class ExecutionSupervisor {
  private readonly attempts = new Map<string, Attempt>();
  private readonly generations = new Map<string, number>();
  private readonly boards = new Map<string, string>();
  private disposed = false;
  private lastTime = -Infinity;
  constructor(private readonly now: () => number, private readonly leaseMs: number) {
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new RangeError('A tested positive lease duration is required');
  }
  private board(identity: ExecutionIdentity): string { return JSON.stringify([identity.projectId, identity.branchId, identity.boardId]); }
  private time(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < this.lastTime) throw new Error('Invalid monotonic clock');
    this.lastTime = value;
    return value;
  }

  /** Called only with an authorization issued by the board authority, never with agent-controlled identity. */
  async start(identity: ExecutionIdentity, launch: () => Promise<ExecutionProcess>, options: { readonly reserveBoard?: boolean } = {}): Promise<ExecutionLease> {
    if (this.disposed || Object.values(identity).some(value => typeof value === 'string' && !value) ||
        !Number.isSafeInteger(identity.generation) || identity.generation < 1) throw new Error('Invalid execution authorization');
    const board = this.board(identity);
    const previous = options.reserveBoard === false ? undefined : this.boards.get(board);
    if (previous && this.eligible(this.attempts.get(previous)!)) throw new Error('This board already has an active editing attempt');
    if (this.attempts.has(identity.attemptId) || identity.generation <= (this.generations.get(identity.taskId) ?? 0)) throw new Error('Execution identity cannot be reused');
    if (this.attempts.size >= 1000) throw new Error('Execution supervisor requires archival before accepting more attempts');
    if (previous) {
      const expired = this.attempts.get(previous)!;
      expired.fenced = true;
      void this.cancel(expired).catch(() => {});
    }
    let startupFinished!: () => void;
    const entry: Attempt = { lease: { ...identity, deadline: this.time() + this.leaseMs }, process: null,
      fenced: false, settled: false, cancellation: 'none', startup: new Promise(resolve => { startupFinished = resolve; }) };
    this.generations.set(identity.taskId, identity.generation);
    this.attempts.set(identity.attemptId, entry);
    if (options.reserveBoard !== false) this.boards.set(board, identity.attemptId);
    try {
      entry.process = await launch();
      startupFinished();
      const settle = () => {
        entry.fenced = true; entry.settled = true;
        if (entry.cancellation !== 'none') entry.cancellation = 'acknowledged';
      };
      void entry.process.finished.then(settle, settle);
      // Stop/departure may race with slow process startup. Never resurrect that attempt.
      if (!this.eligible(entry)) { await this.cancel(entry); throw new Error('Execution authorization expired or was revoked during startup'); }
      return { ...entry.lease };
    } catch (error) {
      entry.fenced = true;
      if (!entry.process) entry.settled = true;
      startupFinished();
      if (entry.process && !entry.settled) void this.cancel(entry);
      throw error;
    }
  }

  /** Renewal is accepted only from the authenticated current board session while its existing lease is live. */
  renew(identity: ExecutionIdentity): ExecutionLease {
    const entry = this.require(identity);
    if (!this.eligible(entry)) throw new Error('Explicit resume with new authorization is required');
    entry.lease = { ...entry.lease, deadline: this.time() + this.leaseMs };
    return { ...entry.lease };
  }
  permits(identity: ExecutionIdentity): boolean {
    const entry = this.attempts.get(identity.attemptId);
    return !!entry && sameIdentity(entry.lease, identity) && this.eligible(entry);
  }
  /** Check again inside the authored transaction; a pre-relay check alone cannot authorize a commit. */
  assertEligible(identity: ExecutionIdentity): void { if (!this.permits(identity)) throw new Error('Execution write fence is closed'); }
  stop(identity: ExecutionIdentity): Promise<CancellationOutcome> {
    const entry = this.require(identity);
    entry.fenced = true;
    return this.cancel(entry);
  }
  cancellation(identity: ExecutionIdentity): 'none' | 'requested' | 'acknowledged' | 'failed' { return this.require(identity).cancellation; }
  /** Remove settled runtime records only. Task generation tombstones remain to reject identity reuse. */
  archive(identity: ExecutionIdentity): void {
    const entry = this.require(identity);
    if (!entry.fenced || !entry.settled || entry.cancellation === 'requested') throw new Error('Only fenced settled attempts can be archived');
    this.attempts.delete(identity.attemptId);
    if (this.boards.get(this.board(identity)) === identity.attemptId) this.boards.delete(this.board(identity));
  }
  async dispose(): Promise<readonly CancellationOutcome[]> {
    this.disposed = true;
    const entries = [...this.attempts.values()];
    for (const entry of entries) entry.fenced = true;
    const results = await Promise.allSettled(entries.map(entry => this.cancel(entry)));
    return results.map(result => result.status === 'fulfilled' ? result.value : 'failed');
  }
  private eligible(entry: { lease: ExecutionLease; fenced: boolean }): boolean {
    return !this.disposed && !entry.fenced && this.time() < entry.lease.deadline;
  }
  private require(identity: ExecutionIdentity) {
    const entry = this.attempts.get(identity.attemptId);
    if (!entry || !sameIdentity(entry.lease, identity)) throw new Error('Execution scope does not match');
    return entry;
  }
  private cancel(entry: Attempt): Promise<CancellationOutcome> {
    if (entry.cancellationPromise) return entry.cancellationPromise;
    if (entry.settled) { entry.cancellation = 'acknowledged'; return Promise.resolve('acknowledged'); }
    entry.cancellation = 'requested';
    entry.cancellationPromise = (async () => {
      await entry.startup;
      try {
        // A rejected launcher has no returned process. A successful launcher must cancel through actual close.
        if (entry.process) await entry.process.cancel();
        entry.settled = true;
        entry.cancellation = 'acknowledged';
        return 'acknowledged';
      } catch {
        entry.cancellation = entry.settled ? 'acknowledged' : 'failed';
        entry.cancellationPromise = undefined;
        return entry.cancellation;
      }
    })();
    return entry.cancellationPromise;
  }
}

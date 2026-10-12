import type { SimLifecycleFact } from '../engine/open/kernel.js';
import type { Cycle, CycleOutcome, CycleSummary } from './types.js';

/** Worst last: a cycle takes the highest-ranked outcome among its units. */
const RANK: Readonly<Record<CycleOutcome, number>> = {
  ok: 0,
  expired: 1,
  rejected: 2,
  'timed-out': 3,
  failed: 4,
  lost: 5,
  stuck: 6,
};
const OUTCOMES = Object.keys(RANK) as CycleOutcome[];

export const emptyOutcomeCounts = (): Record<CycleOutcome, number> =>
  Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<CycleOutcome, number>;

export const emptyCycleSummary = (): CycleSummary => ({
  total: 0,
  open: 0,
  byOutcome: emptyOutcomeCounts(),
  responseLatencyMs: null,
  completionLatencyMs: null,
});

type Open = {
  id: string;
  workloadId: string;
  startedAtMs: number;
  responseAtMs: number | null;
  completedAtMs: number | null;
  outcome: CycleOutcome | null;
  counts: Record<CycleOutcome, number>;
  /** Units (the root and its messages) that have not settled yet. */
  open: Set<string>;
  worst: CycleOutcome | null;
  rootSettled: boolean;
};

/** A message identity is `${parent}:${path}:${edge}:${subscription}`, and a root's has no colon. */
const rootOf = (identity: string): string => identity.split(':')[0];
const ms = (seconds: number): number => Math.round(seconds * 1000);

function mapOutcome(category: 'root' | 'message', outcome: string): CycleOutcome {
  if (outcome === 'succeeded') return 'ok';
  if (outcome === 'rejected') return 'rejected';
  if (outcome === 'failed') return 'failed';
  return category === 'root' ? 'timed-out' : 'expired';
}

/**
 * Assembles cycles from the kernel's lifecycle facts. A cycle opens with its root request and
 * completes when the response has reached the source and every descendant message has settled.
 */
export class CycleTracker {
  private readonly byId = new Map<string, Open>();
  /** Cycles dropped from `byId` after being handed out (see `drainFinished`). */
  private discarded = 0;
  /** Ids that completed since the last `drainFinished`, in completion order. */
  private finished: string[] = [];
  private revisions: Cycle[] = [];
  private readonly pendingDiscard = new Set<string>();
  private observedAtMs = -Infinity;
  /** Running totals over completed cycles, so the summary survives discarding. */
  private readonly byOutcome = emptyOutcomeCounts();
  private readonly response = { n: 0, sum: 0, max: 0 };
  private readonly completion = { n: 0, sum: 0, max: 0 };

  /** `discardFinished`: a stream's cycles leave memory once handed out; the summary still counts them. */
  constructor(private readonly options: { readonly discardFinished?: boolean } = {}) {}

  record(fact: SimLifecycleFact): void {
    this.observedAtMs = Math.max(this.observedAtMs, ms(fact.time));
    if ((fact.kind === 'admitted' || fact.kind === 'rejected') && fact.category === 'root') {
      this.open(fact.unitIdentity, fact.time);
    } else if (fact.kind === 'message_created') {
      const c = this.byId.get(rootOf(fact.unitIdentity));
      if (!c) return;
      c.open.add(fact.unitIdentity);
      const reopened = c.outcome !== null;
      if (reopened) this.pendingDiscard.delete(c.id);
      // Work born after the cycle looked complete (a consumer publishing on) reopens it.
      if (c.outcome !== null) this.uncount(c);
      c.completedAtMs = null;
      c.outcome = null;
      if (reopened) this.revisions.push(this.snapshot(c, ms(fact.time)));
    } else if (fact.kind === 'unit_settled' && fact.outcome !== undefined) {
      const c = this.byId.get(rootOf(fact.unitIdentity));
      if (!c) return;
      const category = fact.category ?? 'root';
      this.settle(c, fact.unitIdentity, mapOutcome(category, fact.outcome), ms(fact.time), category === 'message');
    }
  }

  /** Quiescence: these units can never settle, so they settle as stuck and complete their cycles. */
  markStuck(unitIdentities: readonly string[], atMs: number): void {
    for (const identity of unitIdentities) {
      const c = this.byId.get(rootOf(identity));
      if (c) this.settle(c, identity, 'stuck', atMs, identity.includes(':'));
    }
  }

  cycles(): readonly Cycle[] {
    return [...this.byId.values()].map((c) => this.snapshot(c));
  }

  openCycleIds(): readonly string[] {
    return [...this.byId.values()].filter((c) => c.outcome === null).map((c) => c.id);
  }

  /** Start, response and completion snapshots since the last call. */
  drainRevisions(ended = false): Cycle[] {
    const out = this.revisions;
    this.revisions = [];
    this.finished = [];
    if (this.options.discardFinished) {
      // Keep the latest scheduler instant across batch boundaries. Publications and parent
      // settlement can be separate same-time steps; a later instant confirms the lineage is closed.
      for (const id of this.pendingDiscard) {
        const cycle = this.byId.get(id);
        if (cycle?.completedAtMs == null || (!ended && cycle.completedAtMs >= this.observedAtMs)) continue;
        if (this.byId.delete(id)) this.discarded++;
        this.pendingDiscard.delete(id);
      }
    }
    return out;
  }

  /** Cycles that completed since the last call, once each, in completion order. */
  drainFinished(): Cycle[] {
    const out: Cycle[] = [];
    for (const id of new Set(this.finished)) {
      const c = this.byId.get(id);
      if (!c || c.outcome === null) continue;
      out.push(this.snapshot(c));
      if (this.options.discardFinished) {
        this.byId.delete(id);
        this.discarded++;
      }
    }
    this.finished = [];
    return out;
  }

  summary(): CycleSummary {
    let open = 0;
    for (const c of this.byId.values()) if (c.outcome === null) open++;
    const stat = (a: { n: number; sum: number; max: number }) => (a.n === 0 ? null : { mean: a.sum / a.n, max: a.max });
    return {
      total: this.byId.size + this.discarded,
      open,
      byOutcome: { ...this.byOutcome },
      responseLatencyMs: stat(this.response),
      completionLatencyMs: stat(this.completion),
    };
  }

  private count(c: Open): void {
    this.byOutcome[c.outcome!]++;
    const done = c.completedAtMs! - c.startedAtMs;
    this.completion.n++;
    this.completion.sum += done;
    this.completion.max = Math.max(this.completion.max, done);
  }

  /** A completed cycle reopened: take back what `count` added (max is not reversible, so it keeps the larger value). */
  private uncount(c: Open): void {
    this.byOutcome[c.outcome!]--;
    const done = c.completedAtMs! - c.startedAtMs;
    this.completion.n--;
    this.completion.sum -= done;
  }

  private snapshot(c: Open, observedAtMs?: number): Cycle {
    return {
      id: c.id,
      workloadId: c.workloadId,
      startedAtMs: c.startedAtMs,
      responseAtMs: c.responseAtMs,
      completedAtMs: c.completedAtMs,
      outcome: c.outcome,
      counts: { ...c.counts },
      ...(observedAtMs === undefined ? {} : { observedAtMs }),
    };
  }

  private open(id: string, time: number): void {
    if (this.byId.has(id)) return;
    const opened: Open = {
      id,
      workloadId: id.slice(0, id.lastIndexOf('-')),
      startedAtMs: ms(time),
      responseAtMs: null,
      completedAtMs: null,
      outcome: null,
      counts: emptyOutcomeCounts(),
      open: new Set([id]),
      worst: null,
      rootSettled: false,
    };
    this.byId.set(id, opened);
    this.revisions.push(this.snapshot(opened, ms(time)));
  }

  private settle(c: Open, identity: string, outcome: CycleOutcome, atMs: number, isMessage: boolean): void {
    if (!c.open.delete(identity)) return;
    c.counts[outcome]++;
    if (c.worst === null || RANK[outcome] > RANK[c.worst]) c.worst = outcome;
    if (!isMessage) {
      c.rootSettled = true;
      c.responseAtMs = atMs;
      const response = atMs - c.startedAtMs;
      this.response.n++; this.response.sum += response; this.response.max = Math.max(this.response.max, response);
      this.revisions.push(this.snapshot(c, atMs));
    }
    if (c.open.size === 0 && c.rootSettled) {
      c.completedAtMs = atMs;
      c.outcome = c.worst;
      this.count(c);
      this.finished.push(c.id);
      if (this.options.discardFinished) this.pendingDiscard.add(c.id);
      this.revisions.push(this.snapshot(c, atMs));
    }
  }
}

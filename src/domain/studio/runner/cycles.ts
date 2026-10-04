import type { SimLifecycleFact } from '../../../simulation/open/kernel';
import type { Cycle, CycleOutcome, CycleSummary } from './types';

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
 * D56: assembles cycles from the kernel's lifecycle facts. A cycle opens with its root request and
 * completes when the response has reached the source and every descendant message has settled.
 */
export class CycleTracker {
  private readonly byId = new Map<string, Open>();

  record(fact: SimLifecycleFact): void {
    if ((fact.kind === 'admitted' || fact.kind === 'rejected') && fact.category === 'root') {
      this.open(fact.unitIdentity, fact.time);
    } else if (fact.kind === 'message_created') {
      const c = this.byId.get(rootOf(fact.unitIdentity));
      if (!c) return;
      c.open.add(fact.unitIdentity);
      // Work born after the cycle looked complete (a consumer publishing on) reopens it.
      c.completedAtMs = null;
      c.outcome = null;
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
    return [...this.byId.values()].map((c) => ({
      id: c.id,
      workloadId: c.workloadId,
      startedAtMs: c.startedAtMs,
      responseAtMs: c.responseAtMs,
      completedAtMs: c.completedAtMs,
      outcome: c.outcome,
      counts: { ...c.counts },
    }));
  }

  openCycleIds(): readonly string[] {
    return [...this.byId.values()].filter((c) => c.outcome === null).map((c) => c.id);
  }

  summary(): CycleSummary {
    const byOutcome = emptyOutcomeCounts();
    const responses: number[] = [];
    const completions: number[] = [];
    let open = 0;
    for (const c of this.byId.values()) {
      if (c.outcome === null) {
        open++;
        continue;
      }
      byOutcome[c.outcome]++;
      completions.push(c.completedAtMs! - c.startedAtMs);
      if (c.responseAtMs !== null) responses.push(c.responseAtMs - c.startedAtMs);
    }
    const stat = (xs: number[]) =>
      xs.length === 0 ? null : { mean: xs.reduce((a, b) => a + b, 0) / xs.length, max: Math.max(...xs) };
    return { total: this.byId.size, open, byOutcome, responseLatencyMs: stat(responses), completionLatencyMs: stat(completions) };
  }

  private open(id: string, time: number): void {
    if (this.byId.has(id)) return;
    this.byId.set(id, {
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
    });
  }

  private settle(c: Open, identity: string, outcome: CycleOutcome, atMs: number, isMessage: boolean): void {
    if (!c.open.delete(identity)) return;
    c.counts[outcome]++;
    if (c.worst === null || RANK[outcome] > RANK[c.worst]) c.worst = outcome;
    if (!isMessage) {
      c.rootSettled = true;
      c.responseAtMs = atMs;
    }
    if (c.open.size === 0 && c.rootSettled) {
      c.completedAtMs = atMs;
      c.outcome = c.worst;
    }
  }
}

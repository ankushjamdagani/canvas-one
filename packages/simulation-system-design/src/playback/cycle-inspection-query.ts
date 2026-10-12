import type { Cycle, FlowRecord } from '../runner/types.js';
import type { PlaybackRange } from './playback.js';

export type CycleIntervalStatistics = {
  readonly starts: number;
  readonly responses: number;
  readonly completions: number;
  readonly failures: number;
  readonly activeAtStart: number;
  readonly activeAtEnd: number;
  readonly peakConcurrency: number;
  readonly responseLatenciesMs: readonly number[];
  readonly completionLatenciesMs: readonly number[];
};

export type CycleActivityEvent = {
  readonly atMs: number;
  readonly kind: 'start' | 'response' | 'completion';
  readonly cycle: Cycle;
};
export type CycleActivePeriod = { readonly startMs: number; readonly endMs: number | null };

type IndexedPeriod = { id: string; serial: number; startMs: number; endMs: number | null };
type IntervalNode = { period: IndexedPeriod; priority: number; maxEnd: number; left: IntervalNode | null; right: IntervalNode | null };

/** Treap interval index: overlap lookup visits matching intervals plus a logarithmic boundary. */
export class CycleOverlapIndex {
  private root: IntervalNode | null = null;
  private serial = 0;
  private readonly periodsByCycle = new Map<string, IndexedPeriod[]>();

  add(id: string, startMs: number, endMs: number | null): void {
    const period = { id, serial: this.serial++, startMs, endMs };
    const periods = this.periodsByCycle.get(id) ?? [];
    periods.push(period);
    this.periodsByCycle.set(id, periods);
    this.root = this.insert(this.root, { period, priority: hash(period.serial), maxEnd: endMs ?? Infinity, left: null, right: null });
  }

  closeMostRecent(id: string, endMs: number): void {
    const periods = this.periodsByCycle.get(id);
    const period = periods?.slice().reverse().find((item) => item.endMs === null);
    if (!period) return;
    period.endMs = endMs;
    this.root = this.update(this.root, period);
  }

  remove(id: string): void {
    for (const period of this.periodsByCycle.get(id) ?? []) this.root = this.removeNode(this.root, period);
    this.periodsByCycle.delete(id);
  }

  overlapping(range: PlaybackRange): Set<string> {
    return new Set(this.overlappingOrdered(range));
  }

  overlappingOrdered(range: PlaybackRange): string[] {
    const matches = new Set<string>();
    const visit = (node: IntervalNode | null): void => {
      if (!node || node.maxEnd <= range.startMs) return;
      visit(node.left);
      const { startMs, endMs } = node.period;
      if (startMs < range.endMs && (endMs === null || endMs > range.startMs)) matches.add(node.period.id);
      if (startMs < range.endMs) visit(node.right);
    };
    visit(this.root);
    return [...matches];
  }

  private insert(root: IntervalNode | null, node: IntervalNode): IntervalNode {
    if (!root) return node;
    if (comparePeriod(node.period, root.period) < 0) {
      root.left = this.insert(root.left, node);
      if (root.left.priority < root.priority) root = rotateRight(root);
    } else {
      root.right = this.insert(root.right, node);
      if (root.right.priority < root.priority) root = rotateLeft(root);
    }
    return refresh(root);
  }

  private update(root: IntervalNode | null, period: IndexedPeriod): IntervalNode | null {
    if (!root) return null;
    const comparison = comparePeriod(period, root.period);
    if (comparison === 0) root.period.endMs = period.endMs;
    else if (comparison < 0) root.left = this.update(root.left, period);
    else root.right = this.update(root.right, period);
    return refresh(root);
  }

  private removeNode(root: IntervalNode | null, period: IndexedPeriod): IntervalNode | null {
    if (!root) return null;
    const comparison = comparePeriod(period, root.period);
    if (comparison < 0) root.left = this.removeNode(root.left, period);
    else if (comparison > 0) root.right = this.removeNode(root.right, period);
    else return merge(root.left, root.right);
    return refresh(root);
  }
}

function comparePeriod(a: IndexedPeriod, b: IndexedPeriod): number { return a.startMs - b.startMs || a.serial - b.serial; }
function maxEnd(node: IntervalNode | null): number { return node?.maxEnd ?? -Infinity; }
function refresh(node: IntervalNode): IntervalNode { node.maxEnd = Math.max(node.period.endMs ?? Infinity, maxEnd(node.left), maxEnd(node.right)); return node; }
function rotateRight(root: IntervalNode): IntervalNode { const next = root.left!; root.left = next.right; next.right = refresh(root); return refresh(next); }
function rotateLeft(root: IntervalNode): IntervalNode { const next = root.right!; root.right = next.left; next.left = refresh(root); return refresh(next); }
function merge(left: IntervalNode | null, right: IntervalNode | null): IntervalNode | null {
  if (!left) return right;
  if (!right) return left;
  if (left.priority < right.priority) { left.right = merge(left.right, right); return refresh(left); }
  right.left = merge(left, right.left); return refresh(right);
}
function hash(value: number): number { let x = value + 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x21f0aaad); x = Math.imul(x ^ (x >>> 15), 0x735a2d97); return (x ^ (x >>> 15)) >>> 0; }

/** A lifetime overlaps [start,end) when it starts before the end and finishes after the start. */
export function cycleOverlapsRange(cycle: Cycle, range: PlaybackRange, periods?: readonly CycleActivePeriod[]): boolean {
  if (periods) return periods.some((period) => period.startMs < range.endMs && (period.endMs === null || period.endMs > range.startMs));
  return cycle.startedAtMs < range.endMs && (cycle.completedAtMs === null || cycle.completedAtMs > range.startMs);
}

/** Activity is attributed to the instant it happened. Cohort latencies use response/completion events in the interval. */
export function cycleIntervalStatistics(cycles: readonly Cycle[], range: PlaybackRange, activity?: { events: readonly CycleActivityEvent[]; periodsByCycle: ReadonlyMap<string, readonly CycleActivePeriod[]> }): CycleIntervalStatistics {
  let starts = 0, responses = 0, completions = 0, failures = 0, activeAtStart = 0, activeAtEnd = 0;
  const concurrencyChanges = new Map<number, { starts: number; completions: number }>();
  const responseLatenciesMs: number[] = [];
  const completionLatenciesMs: number[] = [];
  const consume = (cycle: Cycle, kind: CycleActivityEvent['kind'], atMs: number) => {
    if (kind === 'start' && atMs >= range.startMs && atMs < range.endMs) {
      starts++;
    } else if (kind === 'response' && atMs >= range.startMs && atMs < range.endMs) {
      responses++;
      responseLatenciesMs.push(atMs - cycle.startedAtMs);
    } else if (kind === 'completion' && atMs >= range.startMs && atMs < range.endMs) {
      completions++;
      completionLatenciesMs.push(atMs - cycle.startedAtMs);
      if (cycle.outcome !== 'ok') failures++;
    }
  };
  const cyclesById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
  let activityStart = 0;
  let activityEnd = activity?.events.length ?? 0;
  if (activity) {
    let lo = 0; let hi = activity.events.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (activity.events[mid].atMs < range.startMs) lo = mid + 1; else hi = mid; }
    activityStart = lo;
    lo = activityStart; hi = activity.events.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (activity.events[mid].atMs < range.endMs) lo = mid + 1; else hi = mid; }
    activityEnd = lo;
  }
  for (const cycle of cycles) {
    if (activity) continue;
    if (cycle.startedAtMs >= range.startMs && cycle.startedAtMs < range.endMs) {
      starts++;
      if (cycle.startedAtMs > range.startMs && (cycle.completedAtMs === null || cycle.completedAtMs > cycle.startedAtMs)) {
        const change = concurrencyChanges.get(cycle.startedAtMs) ?? { starts: 0, completions: 0 };
        change.starts++;
        concurrencyChanges.set(cycle.startedAtMs, change);
      }
    }
    if (cycle.responseAtMs !== null && cycle.responseAtMs >= range.startMs && cycle.responseAtMs < range.endMs) {
      responses++;
      responseLatenciesMs.push(cycle.responseAtMs - cycle.startedAtMs);
    }
    if (cycle.completedAtMs !== null && cycle.completedAtMs >= range.startMs && cycle.completedAtMs < range.endMs) {
      completions++;
      completionLatenciesMs.push(cycle.completedAtMs - cycle.startedAtMs);
      if (cycle.outcome !== 'ok') failures++;
      if (cycle.completedAtMs > range.startMs && cycle.completedAtMs > cycle.startedAtMs) {
        const change = concurrencyChanges.get(cycle.completedAtMs) ?? { starts: 0, completions: 0 };
        change.completions++;
        concurrencyChanges.set(cycle.completedAtMs, change);
      }
    }
    if (cycle.startedAtMs <= range.startMs && (cycle.completedAtMs === null || cycle.completedAtMs > range.startMs)) activeAtStart++;
    if (cycle.startedAtMs < range.endMs && (cycle.completedAtMs === null || cycle.completedAtMs > range.endMs)) activeAtEnd++;
  }
  if (activity) {
    for (let index = activityStart; index < activityEnd; index++) {
      const event = activity.events[index];
      consume(event.cycle, event.kind, event.atMs);
    }
    for (const [cycleId, periods] of activity.periodsByCycle) {
      const cycle = cyclesById.get(cycleId);
      if (!cycle) continue;
      for (const period of periods) {
        if (period.startMs <= range.startMs && (period.endMs === null || period.endMs > range.startMs)) activeAtStart++;
        if (period.startMs < range.endMs && (period.endMs === null || period.endMs > range.endMs)) activeAtEnd++;
        if (period.startMs > range.startMs && period.startMs < range.endMs) {
          const change = concurrencyChanges.get(period.startMs) ?? { starts: 0, completions: 0 };
          change.starts++;
          concurrencyChanges.set(period.startMs, change);
        }
        if (period.endMs !== null && period.endMs > range.startMs && period.endMs < range.endMs) {
          const change = concurrencyChanges.get(period.endMs) ?? { starts: 0, completions: 0 };
          change.completions++;
          concurrencyChanges.set(period.endMs, change);
        }
      }
    }
  }
  let concurrent = activeAtStart;
  let peakConcurrency = concurrent;
  for (const [, change] of [...concurrencyChanges.entries()].sort((a, b) => a[0] - b[0])) {
    concurrent += change.starts - change.completions;
    peakConcurrency = Math.max(peakConcurrency, concurrent);
  }
  return { starts, responses, completions, failures, activeAtStart, activeAtEnd, peakConcurrency, responseLatenciesMs, completionLatenciesMs };
}

export function cycleFlowEvents(records: readonly FlowRecord[], cycleId: string, range?: PlaybackRange): FlowRecord[] {
  return records.filter((record) => record.cycleId === cycleId &&
    (!range || (record.atMs >= range.startMs && record.atMs < range.endMs)))
    .sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key) || a.phase.localeCompare(b.phase));
}

import type { Cycle, CycleOutcome, CycleSummary } from '../runner/types.js';

export type CycleRevision = { atMs: number; cycle: Cycle };
const outcomes: CycleOutcome[] = ['ok', 'expired', 'rejected', 'timed-out', 'failed', 'lost', 'stuck'];
export const emptyCounts = (): Record<CycleOutcome, number> => Object.fromEntries(outcomes.map(o => [o, 0])) as Record<CycleOutcome, number>;

/** Two independent cursors let timeline read the computed edge without invalidating results playback. */
export class CycleIndex {
  at = -Infinity;
  cursor = 0;
  readonly cycles = new Map<string, Cycle>();
  private byOutcome = emptyCounts();
  private responseSum = 0;
  private completionSum = 0;
  private readonly responses = new Map<number, number>();
  private readonly completions = new Map<number, number>();
  private completed = 0;
  private responded = 0;
  private responseMax = 0;
  private completionMax = 0;
  private maxDirty = false;

  reset(): void {
    this.at = -Infinity; this.cursor = 0; this.cycles.clear(); this.byOutcome = emptyCounts();
    this.responseSum = 0; this.completionSum = 0; this.responses.clear(); this.completions.clear();
    this.completed = 0; this.responded = 0;
    this.responseMax = 0; this.completionMax = 0; this.maxDirty = false;
  }

  compact(removed: ReadonlySet<string>, consumedRemoved: number, boundary: number): void {
    if (this.at < boundary) { this.reset(); return; }
    this.cursor -= consumedRemoved;
    for (const id of removed) {
      const cycle = this.cycles.get(id);
      if (cycle) { this.contribute(cycle, -1); this.cycles.delete(id); }
    }
  }

  read(revisions: readonly CycleRevision[], at: number): void {
    if (at < this.at) this.reset();
    while (this.cursor < revisions.length && revisions[this.cursor].atMs <= at) {
      const cycle = revisions[this.cursor++].cycle;
      const previous = this.cycles.get(cycle.id);
      const sameResponse = previous !== undefined && previous.responseAtMs === cycle.responseAtMs;
      if (previous) this.contribute(previous, -1, sameResponse);
      this.cycles.set(cycle.id, cycle); this.contribute(cycle, 1, sameResponse);
    }
    this.at = at;
  }

  private contribute(cycle: Cycle, sign: number, skipResponse = false): void {
    if (!skipResponse && cycle.responseAtMs !== null) {
      const response = cycle.responseAtMs - cycle.startedAtMs;
      this.responded += sign; this.responseSum += sign * response; this.update(this.responses, response, sign);
      this.responseMax = Math.max(this.responseMax, response);
      if (sign < 0 && response === this.responseMax) this.maxDirty = true;
    }
    if (cycle.completedAtMs === null || cycle.outcome === null) return;
    this.completed += sign; this.byOutcome[cycle.outcome] += sign;
    const duration = cycle.completedAtMs - cycle.startedAtMs;
    this.completionSum += sign * duration;
    this.update(this.completions, duration, sign);
    this.completionMax = Math.max(this.completionMax, duration);
    if (sign < 0 && duration === this.completionMax) this.maxDirty = true;
  }

  private update(map: Map<number, number>, value: number, sign: number): void {
    const count = (map.get(value) ?? 0) + sign;
    if (count === 0) map.delete(value); else map.set(value, count);
  }

  summary(baseline: { total: number; byOutcome: Record<CycleOutcome, number>; response: { n: number; sum: number; max: number }; completion: { n: number; sum: number; max: number } }): CycleSummary {
    const responseN = this.responded + baseline.response.n;
    const completionN = this.completed + baseline.completion.n;
    if (this.maxDirty) {
      this.responseMax = 0; this.completionMax = 0;
      for (const value of this.responses.keys()) this.responseMax = Math.max(this.responseMax, value);
      for (const value of this.completions.keys()) this.completionMax = Math.max(this.completionMax, value);
      this.maxDirty = false;
    }
    const responseMax = Math.max(baseline.response.max, this.responseMax);
    const completionMax = Math.max(baseline.completion.max, this.completionMax);
    return {
      total: baseline.total + this.cycles.size, open: this.cycles.size - this.completed,
      byOutcome: Object.fromEntries(outcomes.map(o => [o, baseline.byOutcome[o] + this.byOutcome[o]])) as Record<CycleOutcome, number>,
      responseLatencyMs: responseN ? { mean: (this.responseSum + baseline.response.sum) / responseN, max: responseMax } : null,
      completionLatencyMs: completionN ? { mean: (this.completionSum + baseline.completion.sum) / completionN, max: completionMax } : null,
    };
  }
}

/**
 * The main thread's copy of a run's recording, and the playhead that plays it (D57).
 *
 * The worker computes ahead and posts flow records, finished cycles and summary checkpoints; this store
 * keeps them, owns the playhead clock, drops what has fallen out of the history window (streams only), and
 * answers "what was happening at time t". It is plain TypeScript with no timers: whoever drives it calls
 * `advance(realDtMs)`.
 */

import type { Cycle, FlowRecord, RunCheckpoint } from '../../domain/studio/runner/types';

/** How much history behind the playhead a stream keeps, in simulated ms. */
export const HISTORY_MS = 120_000;

/** The window only moves forward in steps of this much, so eviction is not paid for on every tick. */
const EVICT_STEP_MS = 1_000;

export type PlaybackOptions = {
  /** Connection id to the element it leads to, so queued and active counts land on elements. */
  readonly connectionTargets: ReadonlyMap<string, string>;
  /** Raw records older than `playhead - historyMs` are dropped; null keeps everything (a bulk). */
  readonly historyMs: number | null;
};

export type LegAt = {
  readonly key: string;
  readonly connectionId: string;
  readonly direction: 'out' | 'back';
  /** 0 at departure, 1 at arrival. */
  readonly progress: number;
};

export type NodeAt = { readonly queued: number; readonly active: number };

export type StateAt = {
  readonly atMs: number;
  readonly legs: readonly LegAt[];
  readonly nodes: ReadonlyMap<string, NodeAt>;
  /** Cycles started by `atMs`, and how many of those had finished by then. */
  readonly cycles: { readonly started: number; readonly finished: number };
  /** The newest checkpoint at or before `atMs`, or null before the first. */
  readonly checkpoint: RunCheckpoint | null;
};

export class PlaybackStore {
  private readonly options: PlaybackOptions;
  private flow: FlowRecord[] = [];
  private flowSorted = true;
  private cycles: Cycle[] = [];
  private readonly checkpoints: RunCheckpoint[] = [];
  private indexedAt = -Infinity;
  private cursor = 0;
  private readonly transit = new Map<number, FlowRecord>();
  private readonly occupancy = new Map<string, { elementId: string; phase: 'queued' | 'processing' }>();
  private readonly nodeCounts = new Map<string, NodeAt>();
  private cycleStarts: number[] = [];
  private cycleEnds: number[] = [];

  private playhead = 0;
  private computed = 0;
  private windowStart = 0;
  private endAt: number | null = null;

  /** Simulated seconds per real second; Infinity jumps to the live edge. */
  speed = 1;
  playing = false;

  constructor(options: PlaybackOptions) {
    this.options = options;
  }

  // --------------------------------------------------------------------------
  // Ingest (the worker is ahead of the playhead)
  // --------------------------------------------------------------------------

  ingestFlow(records: readonly FlowRecord[]): void {
    for (const r of records) {
      if (r.atMs <= this.indexedAt) this.resetIndex();
      const last = this.flow[this.flow.length - 1];
      if (last && r.atMs < last.atMs) this.flowSorted = false;
      this.flow.push(r);
    }
  }

  ingestCycles(cycles: readonly Cycle[]): void {
    this.cycles.push(...cycles);
    for (const cycle of cycles) {
      this.insertTime(this.cycleStarts, cycle.startedAtMs);
      if (cycle.completedAtMs !== null) this.insertTime(this.cycleEnds, cycle.completedAtMs);
    }
  }

  ingestCheckpoint(checkpoint: RunCheckpoint): void {
    this.checkpoints.push(checkpoint);
    this.checkpoints.sort((a, b) => a.atMs - b.atMs);
  }

  /** How far the worker has computed; only ever moves forward. */
  setComputedEdge(ms: number): void {
    if (ms > this.computed) this.computed = ms;
  }

  /** The run has finished computing at `endMs`; nothing more will arrive. */
  setEnded(endMs: number): void {
    this.endAt = endMs;
    this.setComputedEdge(endMs);
  }

  // --------------------------------------------------------------------------
  // Clock
  // --------------------------------------------------------------------------

  get playheadMs(): number {
    return this.playhead;
  }

  get computedMs(): number {
    return this.computed;
  }

  get windowStartMs(): number {
    return this.windowStart;
  }

  get ended(): boolean {
    return this.endAt !== null;
  }

  get endMs(): number | null {
    return this.endAt;
  }

  /** Moves the playhead by `realDtMs` of real time at `speed`, never past what is computed or the end of the run. */
  advance(realDtMs: number): void {
    if (!this.playing) return;
    const limit = Math.min(this.computed, this.endAt ?? Infinity);
    const target = this.speed === Infinity ? limit : this.playhead + (realDtMs / 1000) * this.speed * 1000;
    this.playhead = Math.max(this.playhead, Math.min(target, limit));
    this.evict();
  }

  /** Jumps the playhead within the retained window and what is computed. */
  seek(ms: number): void {
    const limit = Math.min(this.computed, this.endAt ?? Infinity);
    this.playhead = Math.max(this.windowStart, Math.min(ms, limit));
  }

  /** The playhead has caught up with the worker and is waiting for more. */
  atEdge(): boolean {
    return this.playhead >= this.computed;
  }

  atEnd(): boolean {
    return this.endAt !== null && this.playhead >= this.endAt;
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  /** Records with `fromMs < atMs <= toMs`, in order. */
  flowBetween(fromMs: number, toMs: number): FlowRecord[] {
    this.sortFlow();
    const out: FlowRecord[] = [];
    for (let i = this.firstAfter(fromMs); i < this.flow.length && this.flow[i].atMs <= toMs; i++) out.push(this.flow[i]);
    return out;
  }

  stateAt(atMs: number): StateAt {
    this.sortFlow();
    if (atMs < this.indexedAt) this.resetIndex();
    const legs: LegAt[] = [];
    for (; this.cursor < this.flow.length; this.cursor++) {
      const r = this.flow[this.cursor];
      if (r.atMs > atMs) break;
      if ((r.phase === 'sent' || r.phase === 'response') && r.connectionId !== null && r.arriveAtMs !== null && atMs < r.arriveAtMs) {
        this.transit.set(this.cursor, r);
      } else if (r.phase === 'settled' || r.phase === 'released') {
        this.setOccupancy(r.key, null);
      } else if (r.phase === 'queued' || r.phase === 'processing') {
        const elementId = r.elementId ?? (r.connectionId === null ? undefined : this.options.connectionTargets.get(r.connectionId));
        this.setOccupancy(r.key, elementId === undefined ? null : { elementId, phase: r.phase });
      }
    }
    this.indexedAt = atMs;
    for (const [index, r] of this.transit) {
      if (r.connectionId === null || r.arriveAtMs === null) continue;
      const arrival = r.arriveAtMs!;
      if (arrival <= atMs) {
        this.transit.delete(index);
        continue;
      }
      legs.push({ key: r.key, connectionId: r.connectionId,
        direction: r.phase === 'sent' ? 'out' : 'back',
        progress: (atMs - r.atMs) / (arrival - r.atMs) });
    }

    const nodes = new Map(this.nodeCounts);

    const started = this.countThrough(this.cycleStarts, atMs);
    const finished = this.countThrough(this.cycleEnds, atMs);

    let checkpoint: RunCheckpoint | null = null;
    for (const cp of this.checkpoints) {
      if (cp.atMs <= atMs) checkpoint = cp;
      else break;
    }

    return { atMs, legs, nodes, cycles: { started, finished }, checkpoint };
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private sortFlow(): void {
    if (this.flowSorted) return;
    // Array.prototype.sort is stable, so records that share a time keep the order the worker reported them in.
    this.flow.sort((a, b) => a.atMs - b.atMs);
    this.flowSorted = true;
    // ingestFlow resets for late facts. Future-only insertions cannot move the
    // consumed prefix, so its cursor and active-leg indexes stay valid.
  }

  private resetIndex(): void {
    this.indexedAt = -Infinity;
    this.cursor = 0;
    this.transit.clear();
    this.occupancy.clear();
    this.nodeCounts.clear();
  }

  private setOccupancy(key: string, next: { elementId: string; phase: 'queued' | 'processing' } | null): void {
    const adjust = (state: { elementId: string; phase: 'queued' | 'processing' }, delta: number) => {
      const element = state.elementId;
      const previous = this.nodeCounts.get(element) ?? { queued: 0, active: 0 };
      const count = { queued: previous.queued + (state.phase === 'queued' ? delta : 0),
        active: previous.active + (state.phase === 'processing' ? delta : 0) };
      if (count.queued === 0 && count.active === 0) this.nodeCounts.delete(element);
      else this.nodeCounts.set(element, count);
    };
    const previous = this.occupancy.get(key);
    if (previous) adjust(previous, -1);
    if (next) {
      this.occupancy.set(key, next);
      adjust(next, 1);
    } else this.occupancy.delete(key);
  }

  private countThrough(times: readonly number[], ms: number): number {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] <= ms) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Finished cycles normally arrive in order; insert delayed starts without
   * rebuilding the full count index in the next animation frame. */
  private insertTime(times: number[], ms: number): void {
    if (times.length === 0 || times[times.length - 1] <= ms) times.push(ms);
    else times.splice(this.countThrough(times, ms), 0, ms);
  }

  /** Index of the first record with `atMs > ms` (records are sorted). */
  private firstAfter(ms: number): number {
    let lo = 0;
    let hi = this.flow.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.flow[mid].atMs > ms) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  private evict(): void {
    const history = this.options.historyMs;
    if (history === null) return;
    const start = this.playhead - history;
    if (start < this.windowStart + EVICT_STEP_MS) return;
    this.windowStart = start;
    this.sortFlow();
    const cut = this.firstAfter(start - 1); // first record with atMs >= start
    if (cut > 0) {
      // A key that still has a record inside the window keeps its older records: its history is not over.
      const alive = new Set<string>();
      for (let i = cut; i < this.flow.length; i++) alive.add(this.flow[i].key);
      // A long queue/operation or transit may have no later fact yet. Keep its
      // history so occupancy at the window boundary remains reconstructible.
      const phases = new Map<string, FlowRecord>();
      for (let i = 0; i < cut; i++) {
        const r = this.flow[i];
        if (r.phase === 'queued' || r.phase === 'processing' || r.phase === 'settled' || r.phase === 'released') phases.set(r.key, r);
        if (r.arriveAtMs !== null && r.arriveAtMs >= start) alive.add(r.key);
      }
      for (const r of phases.values()) if (r.phase === 'queued' || r.phase === 'processing') alive.add(r.key);
      const retained: FlowRecord[] = [];
      const transit = new Map<number, FlowRecord>();
      let cursor = 0;
      for (let i = 0; i < this.flow.length; i++) {
        const r = this.flow[i];
        if (i < cut && !alive.has(r.key)) continue;
        if (this.transit.has(i)) transit.set(retained.length, r);
        retained.push(r);
        if (i < this.cursor) cursor++;
      }
      this.flow = retained;
      this.cursor = cursor;
      this.transit.clear();
      for (const [i, r] of transit) this.transit.set(i, r);
      // A jump can move the window past the indexed frame and remove a
      // settlement it has not consumed. Rebuild from the retained boundary.
      if (this.indexedAt < start) this.resetIndex();
    }
    this.cycles = this.cycles.filter((c) => c.completedAtMs === null || c.completedAtMs >= start);
    this.cycleStarts = this.cycles.map((c) => c.startedAtMs).sort((a, b) => a - b);
    this.cycleEnds = this.cycles.flatMap((c) => c.completedAtMs === null ? [] : [c.completedAtMs]).sort((a, b) => a - b);
  }
}

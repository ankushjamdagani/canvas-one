/**
 * The main thread's copy of a run's recording, and the playhead that plays it.
 *
 * The worker computes ahead and posts flow records, finished cycles and summary checkpoints; this store
 * keeps them, owns the playhead clock, drops what has fallen out of the history window (streams only), and
 * answers "what was happening at time t". It is plain TypeScript with no timers: whoever drives it calls
 * `advance(realDtMs)`.
 */

import type { Cycle, CycleOutcome, ElementMetric, FlowRecord, ResultDelta, RunCheckpoint } from '../../domain/studio/runner/types';
import { CycleIndex } from './playback-history';
import { FlashIndex, type FlashAt } from './playback-flashes';
import { TrafficIndex } from './playback-traffic';
import { CycleOverlapIndex, cycleFlowEvents, cycleIntervalStatistics } from './cycle-inspection-query';
import type { CycleActivePeriod, CycleActivityEvent, CycleIntervalStatistics } from './cycle-inspection-query';
export type { FlashAt } from './playback-flashes';
export type PlaybackRange = { readonly startMs: number; readonly endMs: number };

/** How much history behind the playhead a stream keeps, in simulated ms. */
export const HISTORY_MS = 120_000;

/** The window only moves forward in steps of this much, so eviction is not paid for on every tick. */
const EVICT_STEP_MS = 1_000;

export type PlaybackOptions = {
  /** Connection id to the element it leads to, so queued and active counts land on elements. */
  readonly connectionTargets: ReadonlyMap<string, string>;
  /** Raw records older than `playhead - historyMs` are dropped; null keeps everything (a bulk). */
  readonly historyMs: number | null;
  readonly connectionChannels?: ReadonlyMap<string, string>;
  readonly workloadEntries?: ReadonlyMap<string, string>;
  readonly nodeCapacities?: ReadonlyMap<string, number>;
  readonly nodeNames?: ReadonlyMap<string, string>;
  readonly nodeSlotHolds?: ReadonlyMap<string, boolean>;
  readonly connectionEndpoints?: ReadonlyMap<string, { source: string; target: string }>;
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
  readonly flashes: readonly FlashAt[];
  readonly nodes: ReadonlyMap<string, NodeAt>;
  /** Cycles started by `atMs`, and how many of those had finished by then. */
  readonly cycles: { readonly started: number; readonly finished: number };
  /** The newest checkpoint at or before `atMs`, or null before the first. */
  readonly checkpoint: RunCheckpoint | null;
};

export class PlaybackStore {
  private readonly options: PlaybackOptions;
  private readonly traffic: TrafficIndex;
  private readonly flashes = new FlashIndex();
  private readonly pendingArrivals = new Map<string, number>();
  private flow: FlowRecord[] = [];
  private flowsByCycle = new Map<string, FlowRecord[]>();
  private cyclesByComponent = new Map<string, Set<string>>();
  private cycleInspectionCache = new Map<string, { version: number; rows: FlowRecord[] }>();
  private cycleQueryCache: { key: string; result: { rows: Cycle[]; total: number } } | null = null;
  private cycleStatsCache: { key: string; result: CycleIntervalStatistics } | null = null;
  private flowSorted = true;
  private readonly cyclesById = new Map<string, Cycle>();
  private cycleActivityEvents: CycleActivityEvent[] = [];
  private cyclePeriodsById = new Map<string, CycleActivePeriod[]>();
  private readonly cycleOverlapIndex = new CycleOverlapIndex();
  private cycleInspectionVersion = 0;
  private flowVersion = 0;
  private cycleRevisions: { atMs: number; cycle: Cycle }[] = [];
  private readonly evictedCycles = {
    total: 0,
    byOutcome: emptyCycleCounts(),
    response: { n: 0, sum: 0, max: 0 },
    completion: { n: 0, sum: 0, max: 0 },
  };
  private readonly checkpoints: RunCheckpoint[] = [];
  private resultDeltas: ResultDelta[] = [];
  private readonly timelineIndex = new CycleIndex();
  private readonly resultsIndex = new CycleIndex();
  private resultsCache: { atMs: number; baseline: RunCheckpoint; cursor: number; rootCounts: RunCheckpoint['rootCounts']; messageCounts: RunCheckpoint['messageCounts']; metrics: Map<string, ElementMetric>; occupancyRates: Readonly<Record<string, number>> } | null = null;
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
  /** Changes when new cycle revisions arrive, including updates at the same computed instant. */
  version = 0;

  /** Simulated seconds per real second. */
  speed = 1;
  playing = false;
  /** Live recording may continue while the presentation stays on an earlier instant. */
  following = true;
  private range: PlaybackRange | null = null;

  get selection(): PlaybackRange | null { return this.range; }

  setSelection(range: PlaybackRange | null): void {
    if (range === null) { this.range = null; return; }
    if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)) return;
    const limit = Math.min(this.computed, this.endAt ?? Infinity);
    const startMs = Math.max(this.windowStart, Math.min(range.startMs, limit));
    const endMs = Math.max(this.windowStart, Math.min(range.endMs, limit));
    this.range = endMs - startMs >= 1 ? { startMs, endMs } : null;
  }

  atSelectionEnd(): boolean { return this.range !== null && this.playhead >= this.range.endMs; }

  constructor(options: PlaybackOptions) {
    this.options = options;
    this.traffic = new TrafficIndex(options);
  }

  // --------------------------------------------------------------------------
  // Ingest (the worker is ahead of the playhead)
  // --------------------------------------------------------------------------

  ingestFlow(records: readonly FlowRecord[]): void {
    this.traffic.ingest(records);
    if (records.length) { this.version++; this.flowVersion++; }
    for (const r of records) {
      if (r.cycleId !== undefined) {
        const indexed = this.flowsByCycle.get(r.cycleId) ?? [];
        indexed.push(r);
        this.flowsByCycle.set(r.cycleId, indexed);
        if (r.elementId !== undefined) {
          const cycleIds = this.cyclesByComponent.get(r.elementId) ?? new Set<string>();
          cycleIds.add(r.cycleId);
          this.cyclesByComponent.set(r.elementId, cycleIds);
        }
      }
      const base = { connectionId: r.connectionId, elementId: null, outcome: null };
      if (r.connectionId !== null) {
        const arrivalKey = `${r.connectionId}\u0000${r.key}`;
        const arrival = this.pendingArrivals.get(arrivalKey);
        if (r.phase === 'received' || (arrival === r.atMs &&
          (r.phase === 'queued' || r.phase === 'processing' || r.phase === 'settled'))) {
          this.flashes.add({ ...base, kind: 'arrived', progress: 1, atMs: r.atMs });
          this.pendingArrivals.delete(arrivalKey);
        } else if (r.phase === 'settled' || r.phase === 'released') this.pendingArrivals.delete(arrivalKey);
        if (r.phase === 'sent' || r.phase === 'response') {
          const back = r.phase === 'response';
          if (!back && r.arriveAtMs !== null) {
            // Normally the worker reports departure first. A late departure can
            // find already-ingested admission facts; this scan is ingestion-only.
            const last = this.flow[this.flow.length - 1];
            const confirmed = last && last.atMs > r.atMs && last.atMs >= r.arriveAtMs ? this.flow.find(f =>
              f.key === r.key && f.connectionId === r.connectionId && f.atMs === r.arriveAtMs &&
              (f.phase === 'received' || f.phase === 'queued' || f.phase === 'processing' || f.phase === 'settled')) : undefined;
            if (confirmed) {
              if (confirmed.phase !== 'received') this.flashes.add({ ...base, kind: 'arrived', progress: 1, atMs: confirmed.atMs });
            } else this.pendingArrivals.set(arrivalKey, r.arriveAtMs);
          }
          this.flashes.add({ ...base, kind: 'sent', progress: back ? 1 : 0, atMs: r.atMs });
          if (back && r.arriveAtMs !== null) {
            this.flashes.add({ ...base, kind: 'arrived', progress: 0, atMs: r.arriveAtMs });
            if (r.outcome !== null) this.flashes.add({ ...base, kind: 'outcome', progress: 0,
              outcome: r.outcome === 'succeeded' ? 'ok' : r.outcome, atMs: r.arriveAtMs });
          } else if (!back && r.arriveAtMs === null) {
            this.flashes.add({ ...base, kind: 'outcome', progress: 0.5, outcome: 'lost', atMs: r.atMs });
          }
        } else if (r.phase === 'settled' && r.outcome !== null && this.options.connectionChannels?.get(r.connectionId) === 'message') {
          this.flashes.add({ ...base, kind: 'outcome', progress: 0,
            outcome: r.outcome === 'succeeded' ? 'ok' : r.outcome, atMs: r.atMs });
        }
      }
      if (r.atMs <= this.indexedAt) this.resetIndex();
      const last = this.flow[this.flow.length - 1];
      if (last && r.atMs < last.atMs) this.flowSorted = false;
      this.flow.push(r);
    }
  }

  ingestCycles(cycles: readonly Cycle[]): void {
    if (cycles.length) { this.version++; this.cycleInspectionVersion++; }
    for (const cycle of cycles) {
      const previous = this.cyclesById.get(cycle.id);
      if (!previous) {
        this.insertCycleActivity({ atMs: cycle.startedAtMs, kind: 'start', cycle });
        this.cyclePeriodsById.set(cycle.id, [{ startMs: cycle.startedAtMs, endMs: null }]);
        this.cycleOverlapIndex.add(cycle.id, cycle.startedAtMs, null);
      }
      if (cycle.responseAtMs !== null && previous?.responseAtMs == null) {
        this.insertCycleActivity({ atMs: cycle.responseAtMs, kind: 'response', cycle });
      }
      if (cycle.completedAtMs !== null && previous?.completedAtMs !== cycle.completedAtMs) {
        const atMs = cycle.observedAtMs ?? cycle.completedAtMs;
        this.insertCycleActivity({ atMs, kind: 'completion', cycle });
        const periods = this.cyclePeriodsById.get(cycle.id) ?? [];
        let open = -1;
        for (let i = periods.length - 1; i >= 0; i--) if (periods[i].endMs === null) { open = i; break; }
        if (open >= 0) {
          this.cyclePeriodsById.set(cycle.id, periods.map((period, index) => index === open ? { ...period, endMs: atMs } : period));
          this.cycleOverlapIndex.closeMostRecent(cycle.id, atMs);
        }
      } else if (previous?.completedAtMs != null && cycle.completedAtMs === null) {
        const atMs = cycle.observedAtMs ?? cycle.startedAtMs;
        const periods = this.cyclePeriodsById.get(cycle.id) ?? [];
        this.cyclePeriodsById.set(cycle.id, [...periods, { startMs: atMs, endMs: null }]);
        this.cycleOverlapIndex.add(cycle.id, atMs, null);
      }
      const elementId = this.options.workloadEntries?.get(cycle.workloadId);
      if (elementId !== undefined && cycle.completedAtMs !== null && cycle.outcome !== null &&
        (previous?.completedAtMs !== cycle.completedAtMs || previous?.outcome !== cycle.outcome)) {
        this.flashes.add({ connectionId: null, elementId, kind: 'outcome', progress: 0,
          outcome: cycle.outcome, atMs: cycle.observedAtMs ?? cycle.completedAtMs });
      }
      this.cyclesById.set(cycle.id, cycle);
      if (!previous) this.addRevision(cycle.startedAtMs, { ...cycle, responseAtMs: null, completedAtMs: null, outcome: null, counts: emptyCycleCounts() });
      if (cycle.responseAtMs !== null && previous?.responseAtMs == null) {
        this.addRevision(cycle.responseAtMs, { ...cycle, completedAtMs: null, outcome: null, counts: emptyCycleCounts() });
      }
      if (cycle.completedAtMs !== null) this.addRevision(cycle.observedAtMs ?? cycle.completedAtMs, cycle);
      else if (previous?.completedAtMs != null && cycle.observedAtMs !== undefined) this.addRevision(cycle.observedAtMs, cycle);
      if (!previous) this.insertTime(this.cycleStarts, cycle.startedAtMs);
      if (previous?.completedAtMs != null && previous.completedAtMs !== cycle.completedAtMs) {
        const old = this.lowerBound(this.cycleEnds, previous.completedAtMs); this.cycleEnds.splice(old, 1);
      }
      if (cycle.completedAtMs !== null && previous?.completedAtMs !== cycle.completedAtMs) this.insertTime(this.cycleEnds, cycle.completedAtMs);
    }
  }

  private insertCycleActivity(event: CycleActivityEvent): void {
    const events = this.cycleActivityEvents;
    const last = events[events.length - 1];
    if (!last || last.atMs <= event.atMs) events.push(event);
    else {
      let lo = 0; let hi = events.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid].atMs <= event.atMs) lo = mid + 1; else hi = mid; }
      events.splice(lo, 0, event);
    }
  }

  private addRevision(atMs: number, cycle: Cycle): void {
    const last = this.cycleRevisions[this.cycleRevisions.length - 1];
    if (atMs <= this.timelineIndex.at) this.timelineIndex.reset();
    if (atMs <= this.resultsIndex.at) this.resultsIndex.reset();
    if (!last || last.atMs <= atMs) this.cycleRevisions.push({ atMs, cycle });
    else {
      let lo = 0; let hi = this.cycleRevisions.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.cycleRevisions[mid].atMs <= atMs) lo = mid + 1; else hi = mid; }
      this.cycleRevisions.splice(lo, 0, { atMs, cycle });
    }
  }

  ingestResults(records: readonly ResultDelta[]): void {
    if (records.some(r => r.atMs <= (this.resultsCache?.atMs ?? -Infinity))) this.resultsCache = null;
    const last = this.resultDeltas[this.resultDeltas.length - 1];
    this.resultDeltas.push(...records);
    if (last && records.some(r => r.atMs < last.atMs)) this.resultDeltas.sort((a, b) => a.atMs - b.atMs);
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
    this.setSelection(this.range);
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

  /** Bounded, overlap-based cycle page for the simulation inspection range. */
  cyclesOverlappingRange(range: PlaybackRange, options: { offset?: number; limit?: number; failuresOnly?: boolean; componentId?: string } = {}): { rows: Cycle[]; total: number } {
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50)));
    const key = `${this.cycleInspectionVersion}/${range.startMs}/${range.endMs}/${offset}/${limit}/${options.failuresOnly === true}/${options.componentId ?? ''}`;
    if (this.cycleQueryCache?.key === key) return this.cycleQueryCache.result;
    const overlappingIds = this.cycleOverlapIndex.overlappingOrdered(range);
    const componentCycles = options.componentId ? this.cyclesByComponent.get(options.componentId) : undefined;
    let total = 0;
    const rows: Cycle[] = [];
    for (const id of overlappingIds) {
      const cycle = this.cyclesById.get(id);
      if (cycle && (!options.failuresOnly || (cycle.outcome !== null && cycle.outcome !== 'ok')) &&
        (!options.componentId || componentCycles?.has(id))) {
        if (total >= offset && rows.length < limit) rows.push(cycle);
        total++;
      }
    }
    const result = { rows, total };
    this.cycleQueryCache = { key, result };
    return result;
  }

  /** Range events count starts/responses/completions observed in [start,end). */
  statisticsForRange(range: PlaybackRange): CycleIntervalStatistics {
    const key = `${this.cycleInspectionVersion}/${range.startMs}/${range.endMs}`;
    if (this.cycleStatsCache?.key === key) return this.cycleStatsCache.result;
    const ids = this.cycleOverlapIndex.overlapping(range);
    const cycles = [...ids].flatMap((id) => { const cycle = this.cyclesById.get(id); return cycle ? [cycle] : []; });
    const periodsByCycle = new Map([...ids].map((id) => [id, this.cyclePeriodsById.get(id) ?? []]));
    const result = cycleIntervalStatistics(cycles, range, { events: this.cycleActivityEvents, periodsByCycle });
    this.cycleStatsCache = { key, result };
    return result;
  }

  /** Indexed lifecycle details for one cycle, capped to keep detail rendering bounded. */
  flowEventsForCycle(cycleId: string, options: { offset?: number; limit?: number } = {}): { rows: FlowRecord[]; total: number } {
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
    const cached = this.cycleInspectionCache.get(cycleId);
    const events = cached?.version === this.flowVersion ? cached.rows : cycleFlowEvents(this.flowsByCycle.get(cycleId) ?? [], cycleId);
    if (cached?.version !== this.flowVersion) {
      this.cycleInspectionCache.delete(cycleId);
      this.cycleInspectionCache.set(cycleId, { version: this.flowVersion, rows: events });
      while (this.cycleInspectionCache.size > 16) this.cycleInspectionCache.delete(this.cycleInspectionCache.keys().next().value!);
    }
    return { rows: events.slice(offset, offset + limit), total: events.length };
  }

  componentActivityForCycle(cycleId: string): readonly { elementId: string; events: number }[] {
    const counts = new Map<string, number>();
    for (const event of this.flowsByCycle.get(cycleId) ?? []) {
      if (event.elementId) counts.set(event.elementId, (counts.get(event.elementId) ?? 0) + 1);
    }
    return [...counts].map(([elementId, events]) => ({ elementId, events })).sort((a, b) => b.events - a.events);
  }

  cycleTouchesComponent(cycleId: string, elementId: string): boolean {
    return this.cyclesByComponent.get(elementId)?.has(cycleId) ?? false;
  }

  get inspectionHistoryStartMs(): number { return this.windowStart; }
  get inspectionVersion(): number { return this.cycleInspectionVersion; }
  get flowInspectionVersion(): number { return this.flowVersion; }

  get isStream(): boolean {
    return this.options.historyMs !== null;
  }

  /** Moves the playhead by `realDtMs` of real time at `speed`, never past what is computed or the end of the run. */
  advance(realDtMs: number): void {
    if (!this.playing || (!this.ended && !this.following)) return;
    const limit = Math.min(this.computed, this.endAt ?? Infinity, !this.ended && this.following ? Infinity : this.range?.endMs ?? Infinity);
    const target = this.playhead + realDtMs * this.speed;
    this.playhead = Math.max(this.playhead, Math.min(target, limit));
    this.evict();
  }

  /** Jumps the playhead within the retained window and what is computed. */
  seek(ms: number): void {
    if (Number.isNaN(ms)) return;
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
    this.resultsIndex.read(this.cycleRevisions, atMs);
    const cycleSummary = this.resultsIndex.summary(this.evictedCycles);
    const finished = cycleSummary.total - cycleSummary.open - this.evictedCycles.total;

    let checkpoint: RunCheckpoint | null = null;
    for (const cp of this.checkpoints) {
      if (cp.atMs <= atMs) checkpoint = cp;
      else break;
    }

    return { atMs, legs, flashes: this.flashes.read(atMs), nodes, cycles: { started, finished }, checkpoint };
  }

  trafficAt(atMs: number) { return this.traffic.read(atMs); }

  /** Bound stream history by recording time even while reviewing an earlier instant. */
  retainThrough(atMs: number): void {
    this.evict(Math.min(atMs, this.computed));
    this.playhead = Math.max(this.playhead, this.windowStart);
  }

  /** Visible cycle state at t; no response, completion or outcome from the future leaks backward. */
  cyclesAt(atMs: number): readonly Cycle[] {
    this.timelineIndex.read(this.cycleRevisions, atMs);
    return [...this.timelineIndex.cycles.values()];
  }

  /** Nearest distinct cycle start strictly before/after t. */
  cycleStep(atMs: number, direction: -1 | 1): number | null {
    if (direction === -1) {
      const index = this.lowerBound(this.cycleStarts, atMs) - 1;
      return index >= 0 ? this.cycleStarts[index] : null;
    }
    const index = this.countThrough(this.cycleStarts, atMs);
    return index < this.cycleStarts.length ? this.cycleStarts[index] : null;
  }

  /** Reconstruct measured replacements with a forward cursor; backward seeks rebuild from a checkpoint. */
  resultsAt(atMs: number): RunCheckpoint | null {
    let baseline: RunCheckpoint | null = null;
    for (const cp of this.checkpoints) { if (cp.atMs <= atMs) baseline = cp; else break; }
    if (!baseline) return null;
    let cache = this.resultsCache;
    if (!cache || cache.baseline !== baseline || atMs < cache.atMs) {
      let lo = 0; let hi = this.resultDeltas.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.resultDeltas[mid].atMs < baseline.atMs) lo = mid + 1; else hi = mid; }
      cache = { atMs: baseline.atMs, baseline, cursor: lo, rootCounts: baseline.rootCounts,
        messageCounts: baseline.messageCounts, metrics: new Map(baseline.elementMetrics.map(m => [metricKey(m), m])),
        occupancyRates: {} };
      // Rates are state at each measurement, and may precede this checkpoint.
      for (let i = lo - 1; i >= 0; i--) if (this.resultDeltas[i].occupancyRates) {
        cache.occupancyRates = this.resultDeltas[i].occupancyRates!; break;
      }
      this.resultsCache = cache;
    }
    while (cache.cursor < this.resultDeltas.length && this.resultDeltas[cache.cursor].atMs <= atMs) {
      const delta = this.resultDeltas[cache.cursor++];
      if (delta.rootCounts) cache.rootCounts = delta.rootCounts;
      if (delta.messageCounts) cache.messageCounts = delta.messageCounts;
      if (delta.occupancyRates) cache.occupancyRates = delta.occupancyRates;
      for (const metric of delta.elementMetrics ?? []) cache.metrics.set(metricKey(metric), metric);
    }
    cache.atMs = atMs;
    this.resultsIndex.read(this.cycleRevisions, atMs);
    const metricRows = [...cache.metrics.values()].map((metric): ElementMetric => {
      if (metric.windowEndMs === atMs) return metric;
      if (metric.key === 'throughput' && atMs > 0) {
        const count = metric.scope === 'root' ? cache.rootCounts.succeeded
          : typeof metric.value === 'number' && metric.windowEndMs !== null ? metric.value * metric.windowEndMs / 1000 : 0;
        return { ...metric, value: count * 1000 / atMs, available: true, reason: null, windowEndMs: atMs };
      }
      if (metric.key === 'utilization' && typeof metric.value === 'number' && atMs > 0 && metric.windowEndMs !== null) {
        const measuredAt = metric.windowEndMs;
        const occupied = metric.value * measuredAt;
        const rate = cache.occupancyRates[metric.elementId ?? ''] ?? 0;
        return { ...metric, value: (occupied + rate * (atMs - measuredAt)) / atMs, windowEndMs: atMs };
      }
      return { ...metric, windowEndMs: atMs };
    });
    return { atMs, rootCounts: cache.rootCounts, messageCounts: cache.messageCounts,
      cycles: this.resultsIndex.summary(this.evictedCycles), elementMetrics: metricRows };
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

  private lowerBound(times: readonly number[], ms: number): number {
    let lo = 0; let hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (times[mid] < ms) lo = mid + 1; else hi = mid; }
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

  private evict(retainedAtMs = this.playhead): void {
    const history = this.options.historyMs;
    if (history === null) return;
    const start = retainedAtMs - history;
    if (start < this.windowStart + EVICT_STEP_MS) return;
    this.windowStart = start;
    this.version++;
    this.flowVersion++;
    this.cycleInspectionCache.clear();
    this.setSelection(this.range);
    this.flashes.evict(start);
    this.traffic.evict(start);
    for (const [key, arrival] of this.pendingArrivals) if (arrival < start) this.pendingArrivals.delete(key);
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
      this.rebuildCycleFlowIndex();
      this.cursor = cursor;
      this.transit.clear();
      for (const [i, r] of transit) this.transit.set(i, r);
      // A jump can move the window past the indexed frame and remove a
      // settlement it has not consumed. Rebuild from the retained boundary.
      if (this.indexedAt < start) this.resetIndex();
    }
    const removedCycles = new Set<string>();
    for (const [id, cycle] of this.cyclesById) {
      if (cycle.completedAtMs === null || cycle.completedAtMs >= start) continue;
      this.cyclesById.delete(id);
      removedCycles.add(id);
      this.evictedCycles.total++;
      if (cycle.outcome !== null) this.evictedCycles.byOutcome[cycle.outcome]++;
      const completion = cycle.completedAtMs - cycle.startedAtMs;
      this.evictedCycles.completion.n++; this.evictedCycles.completion.sum += completion;
      this.evictedCycles.completion.max = Math.max(this.evictedCycles.completion.max, completion);
      if (cycle.responseAtMs !== null) {
        const response = cycle.responseAtMs - cycle.startedAtMs;
        this.evictedCycles.response.n++; this.evictedCycles.response.sum += response;
        this.evictedCycles.response.max = Math.max(this.evictedCycles.response.max, response);
      }
    }
    let timelineConsumedRemoved = 0; let resultsConsumedRemoved = 0;
    this.cycleRevisions = this.cycleRevisions.filter((r, i) => {
      if (!removedCycles.has(r.cycle.id)) return true;
      if (i < this.timelineIndex.cursor) timelineConsumedRemoved++;
      if (i < this.resultsIndex.cursor) resultsConsumedRemoved++;
      return false;
    });
    if (removedCycles.size) {
      this.cycleInspectionVersion++;
      this.cycleQueryCache = null;
      this.cycleStatsCache = null;
      for (const id of removedCycles) { this.cyclePeriodsById.delete(id); this.cycleOverlapIndex.remove(id); }
      this.cycleActivityEvents = this.cycleActivityEvents.filter((event) => !removedCycles.has(event.cycle.id));
    }
    this.timelineIndex.compact(removedCycles, timelineConsumedRemoved, start);
    this.resultsIndex.compact(removedCycles, resultsConsumedRemoved, start);
    if (this.resultsCache && this.resultsCache.atMs < start) this.resultsCache = null;
    this.cycleStarts = [...this.cyclesById.values()].map((c) => c.startedAtMs).sort((a, b) => a - b);
    this.cycleEnds = [...this.cyclesById.values()].flatMap((c) => c.completedAtMs === null ? [] : [c.completedAtMs]).sort((a, b) => a - b);
    let baselineIndex = -1;
    for (let i = 0; i < this.checkpoints.length && this.checkpoints[i].atMs <= start; i++) baselineIndex = i;
    if (baselineIndex > 0) this.checkpoints.splice(0, baselineIndex);
    const baselineAt = this.checkpoints[0]?.atMs ?? 0;
    let occupancyRates: ResultDelta['occupancyRates'];
    for (const delta of this.resultDeltas) {
      if (delta.atMs > baselineAt) break;
      if (delta.occupancyRates) occupancyRates = delta.occupancyRates;
    }
    this.resultDeltas = this.resultDeltas.filter((delta) => delta.atMs >= baselineAt);
    if (occupancyRates) this.resultDeltas.unshift({ atMs: baselineAt, occupancyRates });
    if (this.resultsCache) {
      let lo = 0; let hi = this.resultDeltas.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.resultDeltas[mid].atMs <= this.resultsCache.atMs) lo = mid + 1; else hi = mid; }
      this.resultsCache.cursor = lo;
    }
  }

  private rebuildCycleFlowIndex(): void {
    this.flowsByCycle.clear();
    this.cyclesByComponent.clear();
    for (const record of this.flow) {
      if (record.cycleId === undefined) continue;
      const records = this.flowsByCycle.get(record.cycleId) ?? [];
      records.push(record);
      this.flowsByCycle.set(record.cycleId, records);
      if (record.elementId !== undefined) {
        const cycleIds = this.cyclesByComponent.get(record.elementId) ?? new Set<string>();
        cycleIds.add(record.cycleId);
        this.cyclesByComponent.set(record.elementId, cycleIds);
      }
    }
  }
}

const metricKey = (metric: ElementMetric): string => `${metric.elementId ?? ''}\u0000${metric.scope}\u0000${metric.key}`;
const emptyCycleCounts = (): Record<CycleOutcome, number> => ({ ok: 0, expired: 0, rejected: 0, 'timed-out': 0, failed: 0, lost: 0, stuck: 0 });

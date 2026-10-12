import type { PlaybackProvenance, TimeRange } from './index.js';

export type TrackWindow = {
  readonly retainedStartMs: number;
  readonly frontierMs: number;
  readonly durationMs: number | null;
  readonly live: boolean;
  readonly seekable: boolean;
};
/** Samples are authored/recorded data supplied by the track; null means unavailable. */
export interface TrackSource<Frame> {
  readonly id: string;
  readonly provenance: PlaybackProvenance;
  getWindow(): TrackWindow;
  read(timeMs: number): Frame | null;
  subscribe?(listener: () => void): () => void;
}
/** Milliseconds from a monotonic clock. Scheduling is optional for manual-tick hosts. */
export interface PlaybackClock {
  now(): number;
  subscribeTick?(listener: () => void): () => void;
}
export type PlaybackSnapshot<Frame> = {
  readonly phase: 'paused' | 'playing' | 'waiting' | 'disposed';
  readonly positionMs: number;
  readonly speed: number;
  readonly loop: boolean;
  readonly range: TimeRange | null;
  readonly available: TimeRange | null;
  readonly live: boolean;
  readonly tracks: readonly {readonly id: string; readonly provenance: PlaybackProvenance; readonly frame: Frame | null}[];
};
export type PlaybackControlResult = {readonly status: 'applied' | 'noop'} |
  {readonly status: 'invalid' | 'unavailable' | 'disposed'; readonly message: string};
declare const structuredClone: <T>(value: T) => T;
function immutable<T>(input: T): T {
  const value = structuredClone(input);
  const visited = new Set<object>();
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') {
      if (visited.has(item)) return;
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Playback snapshots require plain data frames');
      visited.add(item); Object.values(item).forEach(freeze); Object.freeze(item);
    }
  };
  freeze(value); return value;
}
function checkWindow(window: TrackWindow): void {
  if (!Number.isFinite(window.retainedStartMs) || !Number.isFinite(window.frontierMs) || window.retainedStartMs < 0 ||
    window.frontierMs < window.retainedStartMs || window.durationMs !== null && (!Number.isFinite(window.durationMs) || window.durationMs < window.frontierMs) ||
    typeof window.live !== 'boolean' || typeof window.seekable !== 'boolean') throw new TypeError('Track requires finite ordered retained/frontier/duration bounds');
}

/** Instance-local generic timeline. No simulator, renderer or browser clock is constructed. */
export class PlaybackController<Frame> {
  private state: PlaybackSnapshot<Frame>;
  private readonly listeners = new Set<() => void>();
  private readonly cleanup: (() => void)[] = [];
  private stopTicks: (() => void) | undefined;
  private scheduling = false;
  private lastTick: number;
  constructor(private readonly options: {readonly tracks: readonly TrackSource<Frame>[]; readonly clock: PlaybackClock;
    readonly onError?: (error: unknown) => void}) {
    this.options = {...options, tracks: Object.freeze([...options.tracks])};
    if (!options.tracks.length || new Set(options.tracks.map(track => track.id)).size !== options.tracks.length || options.tracks.some(track => !track.id)) throw new TypeError('Playback requires distinct nonempty track identifiers');
    for (const track of options.tracks) {
      if (!['authored', 'example', 'recorded'].includes(track.provenance.kind)) throw new TypeError('Track requires explicit provenance');
    }
    this.lastTick = this.now();
    const {available, live} = this.bounds();
    this.state = immutable({phase: 'paused', positionMs: available?.startMs ?? 0, speed: 1, loop: false, range: null, available, live, tracks: []});
    this.sample();
    try { for (const track of options.tracks) if (track.subscribe) this.cleanup.push(track.subscribe(() => this.refresh())); }
    catch (error) { this.cleanup.reverse().forEach(dispose => dispose()); throw error; }
  }
  getSnapshot = (): PlaybackSnapshot<Frame> => this.state;
  subscribe = (listener: () => void): (() => void) => {
    if (this.state.phase === 'disposed') return () => {};
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  };
  private now(): number { const time = this.options.clock.now(); if (!Number.isFinite(time)) throw new TypeError('Clock must return finite milliseconds'); return time; }
  private report(error: unknown): void { try { this.options.onError?.(error); } catch { /* isolate observers */ } }
  private bounds() {
    const windows = this.options.tracks.map(track => {const window = track.getWindow(); checkWindow(window); return window;});
    const startMs = Math.max(...windows.map(window => window.retainedStartMs));
    const endMs = Math.min(...windows.map(window => Math.min(window.frontierMs, window.durationMs ?? Infinity)));
    return {available: endMs >= startMs ? {startMs, endMs} : null, live: windows.some(window => window.live)};
  }
  private activeRange(): TimeRange | null { return this.state.range ?? this.state.available; }
  private sample(): void {
    const tracks = this.options.tracks.map(track => ({id: track.id, provenance: track.provenance,
      frame: this.state.available ? track.read(this.state.positionMs) : null}));
    this.state = immutable({...this.state, tracks});
  }
  private publish(next: PlaybackSnapshot<Frame>): void {
    this.state = immutable(next); this.sample();
    for (const listener of this.listeners) { try { listener(); } catch (error) { this.report(error); } }
  }
  private syncTicks(): void {
    const running = this.state.phase === 'playing' || this.state.phase === 'waiting';
    if (!running) { const cleanup = this.stopTicks; this.stopTicks = undefined; try {cleanup?.();} catch (error) {this.report(error);} }
    else if (!this.stopTicks && !this.scheduling && this.options.clock.subscribeTick) {
      this.scheduling = true;
      try {
        const cleanup = this.options.clock.subscribeTick(() => {
          try { this.tick(); } catch (error) { this.report(error); this.publish({...this.state, phase: 'paused'}); this.syncTicks(); }
        });
        if (this.state.phase === 'playing' || this.state.phase === 'waiting') this.stopTicks = cleanup;
        else cleanup();
      } finally { this.scheduling = false; }
    }
  }
  private closed(): PlaybackControlResult | null { return this.state.phase === 'disposed' ? {status: 'disposed', message: 'Playback is disposed'} : null; }
  play(): PlaybackControlResult {
    const closed = this.closed(); if (closed) return closed;
    const range = this.activeRange(); if (!range) return {status: 'unavailable', message: 'Tracks have no shared retained timeframe'};
    if (this.state.phase === 'playing' || this.state.phase === 'waiting') return {status: 'noop'};
    const followsFrontier = this.state.live && this.state.range === null;
    const positionMs = this.state.positionMs >= range.endMs && !followsFrontier ? range.startMs : this.state.positionMs;
    this.lastTick = this.now();
    this.publish({...this.state, positionMs, phase: positionMs >= range.endMs && followsFrontier ? 'waiting' : 'playing'});
    this.syncTicks(); return {status: 'applied'};
  }
  pause(): PlaybackControlResult {
    const closed = this.closed(); if (closed) return closed;
    if (this.state.phase === 'paused') return {status: 'noop'};
    this.tick();
    this.publish({...this.state, phase: 'paused'}); this.syncTicks(); return {status: 'applied'};
  }
  seek(timeMs: number): PlaybackControlResult {
    const closed = this.closed(); if (closed) return closed;
    if (!Number.isFinite(timeMs)) return {status: 'invalid', message: 'Seek requires finite milliseconds'};
    const range = this.activeRange(); if (!range) return {status: 'unavailable', message: 'Tracks have no shared retained timeframe'};
    if (this.options.tracks.some(track => !track.getWindow().seekable)) return {status: 'unavailable', message: 'A track does not support seeking'};
    const positionMs = Math.max(range.startMs, Math.min(timeMs, range.endMs));
    if (positionMs === this.state.positionMs) return {status: 'noop'};
    this.lastTick = this.now();
    this.publish({...this.state, positionMs, phase: this.state.phase === 'waiting' && positionMs < range.endMs ? 'playing' : this.state.phase});
    return {status: 'applied'};
  }
  setSpeed(speed: number): PlaybackControlResult {
    const closed = this.closed(); if (closed) return closed;
    if (!Number.isFinite(speed) || speed <= 0 || speed > 64) return {status: 'invalid', message: 'Speed must be greater than zero and at most 64'};
    if (speed === this.state.speed) return {status: 'noop'};
    this.tick(); this.lastTick = this.now(); this.publish({...this.state, speed}); return {status: 'applied'};
  }
  setRange(range: TimeRange | null): PlaybackControlResult {
    const closed = this.closed(); if (closed) return closed;
    const available = this.state.available;
    if (range && (!available || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs) || range.endMs <= range.startMs || range.startMs < available.startMs || range.endMs > available.endMs)) return {status: 'invalid', message: 'Range must be nonempty and within the retained frontier'};
    const active = range ?? available;
    this.lastTick = this.now();
    const positionMs = active ? Math.max(active.startMs, Math.min(this.state.positionMs, active.endMs)) : this.state.positionMs;
    const phase = this.state.phase === 'waiting' ? active && positionMs < active.endMs ? 'playing' : range ? 'paused' : 'waiting' : this.state.phase;
    this.publish({...this.state, range, positionMs, phase}); this.syncTicks();
    return {status: 'applied'};
  }
  setLoop(loop: boolean): PlaybackControlResult {
    const closed = this.closed(); if (closed) return closed;
    if (typeof loop !== 'boolean') return {status: 'invalid', message: 'Loop must be boolean'};
    if (loop === this.state.loop) return {status: 'noop'};
    this.publish({...this.state, loop}); return {status: 'applied'};
  }
  tick(timeMs?: number): PlaybackControlResult {
    const closed = this.closed(); if (closed) return closed;
    const atMs = timeMs === undefined ? this.now() : timeMs;
    if (!Number.isFinite(atMs) || atMs < this.lastTick) return {status: 'invalid', message: 'Tick requires a monotonic finite clock'};
    const elapsed = atMs - this.lastTick;
    if (!Number.isFinite(elapsed * this.state.speed)) return {status: 'invalid', message: 'Elapsed playback time exceeds the finite timeline limit'};
    this.lastTick = atMs;
    if (this.state.phase !== 'playing' || elapsed === 0) return {status: 'noop'};
    const range = this.activeRange(); if (!range) { this.publish({...this.state, phase: 'paused'}); this.syncTicks(); return {status: 'unavailable', message: 'Tracks have no shared timeframe'}; }
    let positionMs = this.state.positionMs + elapsed * this.state.speed;
    let phase: PlaybackSnapshot<Frame>['phase'] = this.state.phase;
    if (positionMs >= range.endMs) {
      const duration = range.endMs - range.startMs;
      if (this.state.loop && duration > 0) positionMs = range.startMs + (positionMs - range.startMs) % duration;
      else {positionMs = range.endMs; phase = this.state.live && !this.state.range ? 'waiting' : 'paused';}
    }
    this.publish({...this.state, positionMs, phase}); this.syncTicks(); return {status: 'applied'};
  }
  /** Track update ingress; shared availability is the intersection of retained frontiers. */
  refresh(): PlaybackControlResult {
    const closed = this.closed(); if (closed) return closed;
    const {available, live} = this.bounds();
    const range = this.state.range && available ? {startMs: Math.max(this.state.range.startMs, available.startMs), endMs: Math.min(this.state.range.endMs, available.endMs)} : null;
    const boundedRange = range && range.endMs > range.startMs ? range : null;
    const active = boundedRange ?? available;
    const positionMs = active ? Math.max(active.startMs, Math.min(this.state.positionMs, active.endMs)) : this.state.positionMs;
    const phase = !active ? 'paused' : this.state.phase === 'waiting' ? positionMs < active.endMs ? 'playing' : live ? 'waiting' : 'paused' : this.state.phase;
    this.lastTick = this.now(); this.publish({...this.state, available, live, range: boundedRange, positionMs, phase}); this.syncTicks(); return {status: 'applied'};
  }
  dispose(): void {
    if (this.state.phase === 'disposed') return;
    this.state = immutable({...this.state, phase: 'disposed'});
    const stop = this.stopTicks; this.stopTicks = undefined;
    try {stop?.();} catch (error) {this.report(error);}
    for (const cleanup of this.cleanup.reverse()) {try {cleanup();} catch (error) {this.report(error);} }
    this.listeners.clear();
  }
}

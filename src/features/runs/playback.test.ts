import { describe, expect, it } from 'vitest';
import type { Cycle, FlowRecord, RunCheckpoint } from '../../domain/studio/runner/types';
import { PlaybackStore } from './playback';

const targets = new Map([['c1', 'svc'], ['c2', 'db']]);
const store = (historyMs: number | null = null) => new PlaybackStore({ connectionTargets: targets, historyMs });
const rec = (p: Partial<FlowRecord> & Pick<FlowRecord, 'key' | 'phase' | 'atMs'>): FlowRecord => ({
  connectionId: 'c1',
  arriveAtMs: null,
  outcome: null,
  ...p,
});
const cycle = (id: string, start: number, end: number): Cycle => ({
  id,
  workloadId: 'w',
  startedAtMs: start,
  responseAtMs: end,
  completedAtMs: end,
  outcome: 'ok',
  counts: { ok: 1, expired: 0, rejected: 0, 'timed-out': 0, failed: 0, lost: 0, stuck: 0 },
});
const checkpoint = (atMs: number, generated: number): RunCheckpoint => ({
  atMs,
  rootCounts: { generated, succeeded: generated, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
  messageCounts: { generated: 0, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
  cycles: {
    total: generated,
    open: 0,
    byOutcome: { ok: generated, expired: 0, rejected: 0, 'timed-out': 0, failed: 0, lost: 0, stuck: 0 },
    responseLatencyMs: null,
    completionLatencyMs: null,
  },
  elementMetrics: [],
});

describe('PlaybackStore clock', () => {
  it('advances at the speed and waits at the computed edge', () => {
    const s = store();
    s.setComputedEdge(1000);
    s.playing = true;
    s.advance(400);
    expect(s.playheadMs).toBe(400);
    s.speed = 4;
    s.advance(400);
    expect(s.playheadMs).toBe(1000);
    expect(s.atEdge()).toBe(true);
    s.setComputedEdge(5000);
    s.advance(250);
    expect(s.playheadMs).toBe(2000);
  });

  it('does not move while paused, and Infinity jumps to the edge', () => {
    const s = store();
    s.setComputedEdge(3000);
    s.advance(500);
    expect(s.playheadMs).toBe(0);
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.playheadMs).toBe(3000);
  });

  it('never passes the end of an ended run, and reports atEnd', () => {
    const s = store();
    s.setComputedEdge(2000);
    s.setEnded(1500);
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.playheadMs).toBe(1500);
    expect(s.atEnd()).toBe(true);
  });

  it('seeks within the retained window', () => {
    const s = store();
    s.setComputedEdge(2000);
    s.seek(5000);
    expect(s.playheadMs).toBe(2000);
    s.seek(-5);
    expect(s.playheadMs).toBe(0);
  });

  it('the computed edge only moves forward', () => {
    const s = store();
    s.setComputedEdge(500);
    s.setComputedEdge(100);
    expect(s.computedMs).toBe(500);
  });
});

describe('PlaybackStore recording', () => {
  it('releases records between two playhead times, in order', () => {
    const s = store();
    s.ingestFlow([
      rec({ key: 'a', phase: 'sent', atMs: 100, arriveAtMs: 200 }),
      rec({ key: 'a', phase: 'received', atMs: 200 }),
      rec({ key: 'b', phase: 'sent', atMs: 300, arriveAtMs: 400 }),
    ]);
    expect(s.flowBetween(0, 250).map((r) => r.phase)).toEqual(['sent', 'received']);
    expect(s.flowBetween(250, 350).map((r) => r.key)).toEqual(['b']);
    expect(s.flowBetween(100, 100)).toEqual([]);
  });

  it('keeps records in time order when they arrive out of order', () => {
    const s = store();
    s.ingestFlow([rec({ key: 'b', phase: 'sent', atMs: 300, arriveAtMs: 400 })]);
    s.ingestFlow([rec({ key: 'a', phase: 'sent', atMs: 100, arriveAtMs: 200 })]);
    expect(s.flowBetween(0, 500).map((r) => r.key)).toEqual(['a', 'b']);
  });

  it('drops raw records and cycles older than the history window, keeps checkpoints', () => {
    const s = store(10_000);
    s.setComputedEdge(60_000);
    s.ingestFlow([
      rec({ key: 'old', phase: 'sent', atMs: 1000, arriveAtMs: 1100 }),
      rec({ key: 'new', phase: 'sent', atMs: 55_000, arriveAtMs: 55_100 }),
    ]);
    s.ingestCycles([cycle('c-old', 1000, 1100), cycle('c-new', 55_000, 55_100)]);
    s.ingestCheckpoint(checkpoint(5000, 10));
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.windowStartMs).toBe(50_000);
    expect(s.flowBetween(-1, 60_000).map((r) => r.key)).toEqual(['new']);
    expect(s.stateAt(60_000).cycles.started).toBe(1);
    expect(s.stateAt(60_000).checkpoint?.atMs).toBe(5000);
  });

  it('an old record whose key is still active inside the window is kept', () => {
    const s = store(10_000);
    s.setComputedEdge(60_000);
    s.ingestFlow([
      rec({ key: 'long', phase: 'sent', atMs: 1000, arriveAtMs: 1100 }),
      rec({ key: 'long', phase: 'settled', atMs: 58_000, outcome: 'succeeded' }),
    ]);
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.flowBetween(-1, 60_000)).toHaveLength(2);
  });

  it('a null history keeps everything', () => {
    const s = store(null);
    s.setComputedEdge(500_000);
    s.ingestFlow([rec({ key: 'old', phase: 'sent', atMs: 1, arriveAtMs: 2 })]);
    s.playing = true;
    s.speed = Infinity;
    s.advance(1);
    expect(s.windowStartMs).toBe(0);
    expect(s.flowBetween(-1, 10)).toHaveLength(1);
  });
});

describe('PlaybackStore.stateAt', () => {
  const trip = [
    rec({ key: 'a', phase: 'sent', atMs: 100, arriveAtMs: 200 }),
    rec({ key: 'a', phase: 'received', atMs: 200 }),
    rec({ key: 'a', phase: 'queued', atMs: 200 }),
    rec({ key: 'a', phase: 'processing', atMs: 300 }),
    rec({ key: 'a', phase: 'settled', atMs: 400, outcome: 'succeeded' }),
    rec({ key: 'a', phase: 'response', atMs: 400, arriveAtMs: 500, outcome: 'succeeded' }),
  ];

  it('places a request on the connection while it travels, with its progress', () => {
    const s = store();
    s.ingestFlow(trip);
    expect(s.stateAt(150).legs).toEqual([{ key: 'a', connectionId: 'c1', direction: 'out', progress: 0.5 }]);
    expect(s.stateAt(99).legs).toEqual([]);
    expect(s.stateAt(450).legs).toEqual([{ key: 'a', connectionId: 'c1', direction: 'back', progress: 0.5 }]);
    expect(s.stateAt(600).legs).toEqual([]);
  });

  it('counts queued then active work on the element the connection leads to', () => {
    const s = store();
    s.ingestFlow(trip);
    expect(s.stateAt(250).nodes.get('svc')).toEqual({ queued: 1, active: 0 });
    expect(s.stateAt(350).nodes.get('svc')).toEqual({ queued: 0, active: 1 });
    expect(s.stateAt(450).nodes.get('svc') ?? { queued: 0, active: 0 }).toEqual({ queued: 0, active: 0 });
  });

  it('counts each element separately', () => {
    const s = store();
    s.ingestFlow([
      rec({ key: 'a', phase: 'queued', atMs: 10, connectionId: 'c1' }),
      rec({ key: 'b', phase: 'queued', atMs: 10, connectionId: 'c2' }),
      rec({ key: 'c', phase: 'processing', atMs: 10, connectionId: 'c2' }),
    ]);
    const nodes = s.stateAt(20).nodes;
    expect(nodes.get('svc')).toEqual({ queued: 1, active: 0 });
    expect(nodes.get('db')).toEqual({ queued: 1, active: 1 });
  });

  it('a lost leg shows nothing once it has left', () => {
    const s = store();
    s.ingestFlow([rec({ key: 'x', phase: 'sent', atMs: 100, arriveAtMs: null })]);
    expect(s.stateAt(150).legs).toEqual([]);
  });

  it('counts cycles started and finished by the time, and picks the newest checkpoint at or before it', () => {
    const s = store();
    s.ingestCycles([cycle('a', 100, 300), cycle('b', 200, 900)]);
    s.ingestCheckpoint(checkpoint(2000, 9));
    s.ingestCheckpoint(checkpoint(1000, 5));
    expect(s.stateAt(250).cycles).toEqual({ started: 2, finished: 0 });
    expect(s.stateAt(350).cycles).toEqual({ started: 2, finished: 1 });
    expect(s.stateAt(250).checkpoint).toBeNull();
    expect(s.stateAt(1500).checkpoint?.atMs).toBe(1000);
    expect(s.stateAt(5000).checkpoint?.atMs).toBe(2000);
  });
});

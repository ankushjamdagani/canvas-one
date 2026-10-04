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

  it('does not move while paused, and finite speed advances to the edge', () => {
    const s = store();
    s.setComputedEdge(3000);
    s.advance(500);
    expect(s.playheadMs).toBe(0);
    s.playing = true;
    s.speed = 16;
    s.advance(1000);
    expect(s.playheadMs).toBe(3000);
  });

  it('never passes the end of an ended run, and reports atEnd', () => {
    const s = store();
    s.setComputedEdge(2000);
    s.setEnded(1500);
    s.playing = true;
    s.speed = 16;
    s.advance(1000);
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
    s.speed = 16;
    s.advance(4000);
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
    s.speed = 16;
    s.advance(4000);
    expect(s.flowBetween(-1, 60_000)).toHaveLength(2);
  });

  it('a null history keeps everything', () => {
    const s = store(null);
    s.setComputedEdge(500_000);
    s.ingestFlow([rec({ key: 'old', phase: 'sent', atMs: 1, arriveAtMs: 2 })]);
    s.playing = true;
    s.speed = 16;
    s.advance(40000);
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

  it('reconstructs occupancy and transit after a backward seek and late ingestion', () => {
    const s = store();
    s.ingestFlow(trip);
    expect(s.stateAt(450).legs[0].direction).toBe('back');
    expect(s.stateAt(250).nodes.get('svc')).toEqual({ queued: 1, active: 0 });
    s.ingestFlow([rec({ key: 'late', phase: 'processing', atMs: 210 })]);
    expect(s.stateAt(250).nodes.get('svc')).toEqual({ queued: 1, active: 1 });
    expect(s.stateAt(350).nodes.get('svc')).toEqual({ queued: 0, active: 2 });
    expect(s.stateAt(500).legs).toEqual([]);
    s.ingestFlow([rec({ key: 'late', phase: 'settled', atMs: 500 })]);
    expect(s.stateAt(500).nodes.size).toBe(0);
  });

  it('retains cached occupancy when new future records need sorting', () => {
    const s = store();
    s.ingestFlow([
      rec({ key: 'active', phase: 'processing', atMs: 10 }),
      rec({ key: 'active', phase: 'settled', atMs: 100 }),
    ]);
    expect(s.stateAt(20).nodes.get('svc')?.active).toBe(1);
    s.ingestFlow([rec({ key: 'queued', phase: 'queued', atMs: 50 })]);
    expect(s.stateAt(60).nodes.get('svc')).toEqual({ queued: 1, active: 1 });
    expect(s.stateAt(100).nodes.get('svc')).toEqual({ queued: 1, active: 0 });
  });

  it('preserves unfinished work across eviction, forward frames and a seek to the boundary', () => {
    const s = store(10_000);
    s.ingestFlow([
      rec({ key: 'done', phase: 'processing', atMs: 0 }),
      rec({ key: 'done', phase: 'settled', atMs: 100 }),
      rec({ key: 'queue', phase: 'queued', atMs: 1000 }),
      rec({ key: 'active', phase: 'processing', atMs: 1000 }),
      rec({ key: 'transit', phase: 'sent', atMs: 1000, arriveAtMs: 70_000 }),
    ]);
    s.stateAt(59_000);
    s.setComputedEdge(60_000);
    s.playing = true;
    s.speed = 16;
    s.advance(4000);
    expect(s.flowBetween(-1, 60_000).some((r) => r.key === 'done')).toBe(false);
    expect(s.stateAt(60_000).nodes.get('svc')).toEqual({ queued: 1, active: 1 });
    expect(s.stateAt(50_000).legs[0].progress).toBeCloseTo(49_000 / 69_000);
    s.ingestFlow([rec({ key: 'queue', phase: 'processing', atMs: 61_000 })]);
    expect(s.stateAt(61_000).nodes.get('svc')).toEqual({ queued: 0, active: 2 });
  });

  it('counts newly ingested cycles after cached reads and backward seeks', () => {
    const s = store();
    s.ingestCycles([cycle('a', 100, 300)]);
    expect(s.stateAt(500).cycles).toEqual({ started: 1, finished: 1 });
    s.ingestCycles([cycle('b', 50, 600)]);
    expect(s.stateAt(200).cycles).toEqual({ started: 2, finished: 0 });
    expect(s.stateAt(600).cycles).toEqual({ started: 2, finished: 2 });
  });

  it('clears dequeued occupancy without inventing processing or an outcome', () => {
    const s = store();
    s.ingestFlow([
      rec({ key: 'message', phase: 'queued', atMs: 0 }),
      rec({ key: 'message', phase: 'released', atMs: 100 }),
      rec({ key: 'message/child', connectionId: 'c2', phase: 'sent', atMs: 100, arriveAtMs: 200 }),
    ]);
    expect(s.stateAt(50).nodes.get('svc')).toEqual({ queued: 1, active: 0 });
    expect(s.stateAt(150).nodes.size).toBe(0);
    expect(s.stateAt(150).legs).toEqual([{ key: 'message/child', connectionId: 'c2', direction: 'out', progress: 0.5 }]);
    expect(s.stateAt(50).nodes.get('svc')?.queued).toBe(1);
  });

  it('counts direct workload entry occupancy without inventing a connection', () => {
    const s = store();
    s.ingestFlow([
      rec({ key: 'root', connectionId: null, elementId: 'svc', phase: 'queued', atMs: 0 }),
      rec({ key: 'root', connectionId: null, elementId: 'svc', phase: 'processing', atMs: 10 }),
      rec({ key: 'root', connectionId: null, elementId: 'svc', phase: 'released', atMs: 20 }),
    ]);
    expect(s.stateAt(5).nodes.get('svc')).toEqual({ queued: 1, active: 0 });
    expect(s.stateAt(15).nodes.get('svc')).toEqual({ queued: 0, active: 1 });
    expect(s.stateAt(15).legs).toEqual([]);
    expect(s.stateAt(20).nodes.size).toBe(0);
  });

  it('does not retain cached occupancy when a jump evicts its unseen settlement', () => {
    const s = store(10_000);
    s.ingestFlow([
      rec({ key: 'done', phase: 'processing', atMs: 0 }),
      rec({ key: 'done', phase: 'settled', atMs: 100 }),
    ]);
    expect(s.stateAt(0).nodes.get('svc')?.active).toBe(1);
    s.setComputedEdge(60_000);
    s.playing = true;
    s.speed = 16;
    s.advance(4000);
    expect(s.stateAt(60_000).nodes.size).toBe(0);
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

describe('PlaybackStore cycle revisions and historical results', () => {
  it('applies measurements at the checkpoint instant, including work emitted at zero', () => {
    const s = store(); s.ingestCheckpoint(checkpoint(0, 0));
    s.ingestResults([{ atMs: 0, rootCounts: checkpoint(0, 1).rootCounts }]);
    expect(s.resultsAt(0)?.rootCounts.generated).toBe(1);
    s.ingestCheckpoint(checkpoint(5000, 1));
    s.ingestResults([{ atMs: 5000, rootCounts: checkpoint(5000, 2).rootCounts }]);
    expect(s.resultsAt(5000)?.rootCounts.generated).toBe(2);
  });
  it('integrates occupied slots and normalizes cumulative throughput between events', () => {
    const s = store();
    s.ingestCheckpoint(checkpoint(0, 0));
    const metric = { elementId: 'svc', scope: 'element' as const, key: 'utilization' as const, value: 0.25, unit: 'ratio' as const, available: true, reason: null, windowStartMs: 0, windowEndMs: 1000 };
    s.ingestResults([{ atMs: 1000, occupancyRates: { svc: 1 }, elementMetrics: [metric,
      { ...metric, key: 'throughput', value: 2, unit: 'requests/s' }] }]);
    expect(s.resultsAt(2000)?.elementMetrics.find(m => m.key === 'utilization')?.value).toBe(0.625);
    expect(s.resultsAt(2000)?.elementMetrics.find(m => m.key === 'throughput')?.value).toBe(1);
    expect(s.resultsAt(1500)?.elementMetrics.find(m => m.key === 'utilization')?.value).toBe(0.5);
    // A checkpoint carries accumulated occupancy, while the last rate remains in earlier telemetry.
    s.ingestCheckpoint({ ...checkpoint(1500, 0), elementMetrics: [{ ...metric, value: 0.5, windowEndMs: 1500 }] });
    expect(s.resultsAt(2000)?.elementMetrics[0].value).toBe(0.625);
  });

  it('invalidates forward caches for late changes and independent timeline reads', () => {
    const s = store(); s.ingestCheckpoint(checkpoint(0, 0));
    s.ingestCycles([cycle('a', 100, 1000), cycle('b', 500, 1500)]);
    expect(s.cyclesAt(2000)).toHaveLength(2);
    expect(s.resultsAt(200)?.cycles.open).toBe(1);
    expect(s.resultsAt(600)?.cycles.open).toBe(2);
    s.ingestResults([{ atMs: 550, rootCounts: checkpoint(0, 5).rootCounts }]);
    expect(s.resultsAt(600)?.rootCounts.generated).toBe(5);
    expect(s.resultsAt(200)?.rootCounts.generated).toBe(0);
  });
  it('upserts revisions, masks future fields and counts a cycle once', () => {
    const s = store();
    const started = { ...cycle('one', 100, 400), responseAtMs: null, completedAtMs: null, outcome: null };
    const responded = { ...started, responseAtMs: 250 };
    const completed = cycle('one', 100, 400);
    s.ingestCycles([started, responded, completed]);
    expect(s.cyclesAt(150)).toEqual([{ ...started, counts: { ok: 0, expired: 0, rejected: 0, 'timed-out': 0, failed: 0, lost: 0, stuck: 0 } }]);
    expect(s.cyclesAt(300)[0].responseAtMs).toBe(250);
    expect(s.cyclesAt(300)[0].completedAtMs).toBeNull();
    s.ingestCheckpoint(checkpoint(0, 0));
    expect(s.resultsAt(300)?.cycles.responseLatencyMs).toEqual({ mean: 150, max: 150 });
    expect(s.resultsAt(300)?.cycles.completionLatencyMs).toBeNull();
    expect(s.cyclesAt(500)).toHaveLength(1);
    expect(s.stateAt(500).cycles).toEqual({ started: 1, finished: 1 });
  });

  it('steps to strictly earlier and later distinct cycle starts', () => {
    const s = store();
    s.ingestCycles([cycle('a', 100, 200), cycle('b', 100, 300), cycle('c', 500, 600)]);
    expect(s.cycleStep(100, -1)).toBeNull();
    expect(s.cycleStep(100, 1)).toBe(500);
    expect(s.cycleStep(500, -1)).toBe(100);
    expect(s.cycleStep(500, 1)).toBeNull();
  });

  it('reopens a cycle at the late descendant observation without double-counting completion', () => {
    const s = store(); s.ingestCheckpoint(checkpoint(0, 0));
    const done = cycle('late', 0, 100);
    s.ingestCycles([done]);
    s.ingestCycles([{ ...done, observedAtMs: 200, completedAtMs: null, outcome: null }]);
    expect(s.resultsAt(150)?.cycles.open).toBe(0);
    expect(s.stateAt(150).cycles.finished).toBe(1);
    expect(s.resultsAt(250)?.cycles.open).toBe(1);
    expect(s.stateAt(250).cycles.finished).toBe(0);
    expect(s.resultsAt(250)?.cycles.byOutcome.ok).toBe(0);
    s.ingestCycles([{ ...done, observedAtMs: 400, completedAtMs: 400 }]);
    expect(s.resultsAt(500)?.cycles.byOutcome.ok).toBe(1);
    expect(s.resultsAt(250)?.cycles.open).toBe(1);
    expect(s.stateAt(500).cycles.finished).toBe(1);
  });

  it('reconstructs exact counts and changed metrics between checkpoints and on backward reads', () => {
    const s = store();
    s.ingestCheckpoint(checkpoint(0, 0));
    s.ingestResults([
      { atMs: 100, rootCounts: { generated: 1, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 1 } },
      { atMs: 200, rootCounts: { generated: 1, succeeded: 1, rejected: 0, failed: 0, expired: 0, inFlight: 0 } },
    ]);
    expect(s.resultsAt(150)?.rootCounts).toEqual({ generated: 1, succeeded: 0, rejected: 0, failed: 0, expired: 0, inFlight: 1 });
    expect(s.resultsAt(50)?.rootCounts.generated).toBe(0);
    expect(s.resultsAt(250)?.rootCounts.succeeded).toBe(1);
    expect(s.resultsAt(150)?.rootCounts.succeeded).toBe(0);
  });

  it('retains cumulative completed-cycle results after stream eviction', () => {
    const s = store(1000);
    s.ingestCheckpoint(checkpoint(0, 0));
    s.ingestCycles([cycle('old', 100, 200), cycle('new', 1900, 2000)]);
    s.setComputedEdge(2500);
    s.playing = true;
    s.speed = 16;
    s.advance(1000);
    expect(s.cyclesAt(2500).map((c) => c.id)).toEqual(['new']);
    expect(s.resultsAt(2500)?.cycles.total).toBe(2);
    expect(s.resultsAt(2500)?.cycles.byOutcome.ok).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Document } from '../../domain/studio/model';
import { checkReadiness } from '../../domain/studio/readiness';
import { ScenarioRunner } from '../../domain/studio/runner/scenario-runner';
import type { Cycle, FlowRecord } from '../../domain/studio/runner/types';
import { PlaybackStore } from './playback';

const make = (historyMs: number | null = null) => new PlaybackStore({ historyMs,
  connectionTargets: new Map([['call', 'target'], ['message', 'target']]),
  connectionChannels: new Map([['call', 'call'], ['message', 'message']]),
  workloadEntries: new Map([['w', 'entry']]),
});
const record = (phase: FlowRecord['phase'], atMs: number, extra: Partial<FlowRecord> = {}): FlowRecord => ({
  key: 'unit', connectionId: 'call', phase, atMs, arriveAtMs: null, outcome: null, ...extra,
});
const cycle = (outcome: Cycle['outcome']): Cycle => ({ id: 'cycle', workloadId: 'w', startedAtMs: 0,
  responseAtMs: null, completedAtMs: 300, outcome,
  counts: { ok: 0, expired: 0, rejected: 0, 'timed-out': 0, failed: 0, lost: 0, stuck: 0 },
});

describe('recorded lifecycle flashes', () => {
  it('places sends and confirmed arrivals at direction endpoints without leaking return outcomes', () => {
    const s = make();
    s.ingestFlow([record('sent', 100, { arriveAtMs: 200 }), record('received', 200),
      record('settled', 220, { outcome: 'succeeded' }),
      record('response', 250, { arriveAtMs: 400, outcome: 'succeeded' })]);
    expect(s.stateAt(99).flashes).toEqual([]);
    expect(s.stateAt(100).flashes[0]).toMatchObject({ kind: 'sent', progress: 0, count: 1, age: 0 });
    expect(s.stateAt(250).flashes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'arrived', progress: 1 }),
      expect.objectContaining({ kind: 'sent', progress: 1 }),
    ]));
    expect(s.stateAt(399).flashes.some(f => f.kind === 'outcome')).toBe(false);
    expect(s.stateAt(400).flashes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'arrived', progress: 0, age: 0 }),
      expect.objectContaining({ kind: 'outcome', progress: 0, outcome: 'ok', age: 0 }),
    ]));
    expect(s.stateAt(640).flashes).toEqual([]);
  });

  it('groups all units exactly, ages from the newest fact, and stays fixed when paused', () => {
    const s = make();
    s.ingestFlow(Array.from({ length: 450 }, (_, i) => record('sent', 100 + i % 2, { key: String(i), arriveAtMs: 500 })));
    const flashes = s.stateAt(200).flashes;
    expect(flashes).toHaveLength(1);
    expect(flashes[0]).toMatchObject({ count: 450, age: 99 / 240 });
    s.setComputedEdge(500); s.seek(200); s.advance(1000);
    expect(s.stateAt(s.playheadMs).flashes).toEqual(flashes);
    expect(s.stateAt(100).flashes[0].count).toBe(225);
  });

  it('uses loss mid-line without inventing arrival, and settles messages at their source', () => {
    const s = make();
    s.ingestFlow([record('sent', 10), record('settled', 20, { connectionId: 'message', outcome: 'failed' }),
      record('response', 30, { outcome: 'failed' })]);
    const flashes = s.stateAt(100).flashes;
    expect(flashes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'outcome', outcome: 'lost', progress: 0.5 }),
      expect.objectContaining({ connectionId: 'message', kind: 'outcome', outcome: 'failed', progress: 0 }),
    ]));
    expect(flashes.some(f => f.kind === 'arrived')).toBe(false);
  });

  it('does not invent success or an outbound arrival from an estimated leg end', () => {
    const s = make();
    s.ingestFlow([record('sent', 10, { arriveAtMs: 20 }), record('response', 30, { arriveAtMs: 40 })]);
    expect(s.stateAt(25).flashes.some(f => f.kind === 'arrived')).toBe(false);
    expect(s.stateAt(40).flashes.filter(f => f.kind === 'arrived')).toEqual([
      expect.objectContaining({ progress: 0 }),
    ]);
    expect(s.stateAt(40).flashes.some(f => f.kind === 'outcome')).toBe(false);
  });

  it('confirms a descendant arrival once from its first local phase and omits cancellation before arrival', () => {
    const s = make();
    s.ingestFlow([record('sent', 10, { arriveAtMs: 20 }), record('queued', 20), record('processing', 20),
      record('sent', 30, { key: 'cancelled', arriveAtMs: 100 }), record('settled', 50, { key: 'cancelled', outcome: 'failed' })]);
    expect(s.stateAt(100).flashes.filter(f => f.kind === 'arrived')).toEqual([
      expect.objectContaining({ progress: 1, count: 1 }),
    ]);
  });

  it('shows real adapter descendant arrivals even though they have no received fact', async () => {
    const fixture = JSON.parse(readFileSync('specs/revamp/fixtures/s06.json', 'utf8')) as Document;
    const document: Document = { ...fixture, scenarios: fixture.scenarios.map(s => ({ ...s,
      workloads: s.workloads.map(w => ({ ...w, emission: { mode: 'bulk', requests: 1, arrival: 'instant' } })),
    })) };
    const scenarioId = document.scenarios[0].id;
    expect(checkReadiness(document, scenarioId).ready).toBe(true);
    const runner = new ScenarioRunner(document, scenarioId, 'arrival-regression');
    const records: FlowRecord[] = [];
    let more = true;
    while (more) { more = await runner.step(); records.push(...runner.drainFlow()); }
    const sent = records.find(r => r.phase === 'sent' && r.arriveAtMs !== null && records.some(next =>
      next.key === r.key && next.atMs === r.arriveAtMs && (next.phase === 'queued' || next.phase === 'processing')));
    expect(sent).toBeDefined();
    expect(records.some(r => r.key === sent!.key && r.phase === 'received')).toBe(false);
    const s = make();
    s.ingestFlow(records.filter(r => r.key === sent!.key));
    expect(s.stateAt(sent!.arriveAtMs!).flashes).toEqual(expect.arrayContaining([
      expect.objectContaining({ connectionId: sent!.connectionId, kind: 'arrived', progress: 1, count: 1 }),
    ]));
  });

  it.each(['ok', 'expired', 'rejected', 'timed-out', 'failed', 'lost', 'stuck'] as const)('marks completed source cycles as %s once', outcome => {
    const s = make(); s.ingestCycles([cycle(outcome), cycle(outcome)]);
    expect(s.stateAt(299).flashes).toEqual([]);
    expect(s.stateAt(300).flashes).toEqual([expect.objectContaining({ connectionId: null, elementId: 'entry', outcome, count: 1 })]);
  });

  it('rebuilds after late facts and preserves the flash window across stream eviction', () => {
    const s = make(1000);
    s.ingestFlow([record('received', 1900)]);
    s.stateAt(2050);
    s.ingestFlow([record('received', 1950, { key: 'late' })]);
    expect(s.stateAt(2050).flashes[0].count).toBe(2);
    s.setComputedEdge(3000); s.playing = true; s.advance(3000);
    expect(s.windowStartMs).toBe(2000);
    expect(s.stateAt(2000).flashes[0]).toMatchObject({ count: 2, age: 50 / 240 });
    expect(s.stateAt(2190).flashes).toEqual([]);
  });

  it('confirms a late departure from an already recorded descendant admission', () => {
    const s = make(); s.ingestFlow([record('processing', 200)]); s.stateAt(250);
    s.ingestFlow([record('sent', 100, { arriveAtMs: 200 })]);
    expect(s.stateAt(250).flashes.filter(f => f.kind === 'arrived')).toEqual([
      expect.objectContaining({ progress: 1, count: 1 }),
    ]);
  });

  it('preserves the consumed prefix when live batches insert before a projected return arrival', () => {
    const s = make();
    s.ingestFlow([record('response', 100, { arriveAtMs: 500, outcome: 'failed' })]);
    s.stateAt(150);
    s.ingestFlow([record('received', 200), record('received', 300, { key: 'next' })]);
    expect(s.stateAt(300).flashes.filter(f => f.kind === 'arrived')).toEqual([
      expect.objectContaining({ progress: 1, count: 2 }),
    ]);
    expect(s.stateAt(500).flashes.filter(f => f.kind === 'arrived')).toEqual(expect.arrayContaining([
      expect.objectContaining({ progress: 0, count: 1 }),
      expect.objectContaining({ progress: 1, count: 1 }),
    ]));
  });
});

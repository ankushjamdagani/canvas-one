import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '../../domain/studio/model';
import { checkReadiness } from '../../domain/studio/readiness';
import { ScenarioRunner } from '../../domain/studio/runner/scenario-runner';
import type { Cycle, FlowRecord } from '../../domain/studio/runner/types';
import { CycleOverlapIndex, cycleFlowEvents, cycleIntervalStatistics, cycleOverlapsRange } from './cycle-inspection-query';
import { PlaybackStore } from './playback';
import { ResourceAdapter } from '../../domain/studio/runner/resource-adapter';

const range = { startMs: 100, endMs: 300 };
const s06 = JSON.parse(readFileSync(join(process.cwd(), 'src/features/entry/examples/s06.json'), 'utf8')) as Document;
const cycle = (id: string, startedAtMs: number, responseAtMs: number | null, completedAtMs: number | null, outcome: Cycle['outcome'] = null): Cycle => ({
  id, workloadId: 'w', startedAtMs, responseAtMs, completedAtMs, outcome,
  counts: { ok: 0, expired: 0, rejected: 0, 'timed-out': 0, failed: 0, lost: 0, stuck: 0 },
});
const flow = (phase: FlowRecord['phase'], atMs: number, unitId: string, parentUnitId: string | null = null): FlowRecord => ({
  key: `${unitId}|path`, cycleId: 'root', unitId, parentUnitId, category: unitId === 'root' ? 'root' : 'message', attempt: 0,
  connectionId: null, elementId: unitId === 'root' ? 'api' : 'queue', phase, atMs, arriveAtMs: null, outcome: null,
});

describe('cycle inspection interval queries', () => {
  it('matches a brute-force overlap oracle as periods open, close, and leave the index', () => {
    const index = new CycleOverlapIndex();
    const periods = new Map<string, { startMs: number; endMs: number | null }[]>();
    for (let i = 0; i < 240; i++) {
      const id = `c${i}`;
      const startMs = (i * 7919) % 5000;
      const endMs = i % 4 === 0 ? null : startMs + 1 + (i * 313) % 1600;
      index.add(id, startMs, endMs);
      periods.set(id, [{ startMs, endMs }]);
    }
    for (let i = 0; i < 50; i++) {
      const id = `c${i * 3}`;
      if (periods.get(id)![0].endMs !== null) continue;
      const endMs = periods.get(id)![0].startMs + 900;
      index.closeMostRecent(id, endMs);
      periods.set(id, [{ ...periods.get(id)![0], endMs }]);
    }
    for (const id of ['c9', 'c27', 'c51']) { index.remove(id); periods.delete(id); }
    for (let startMs = 0; startMs < 5000; startMs += 137) {
      const interval = { startMs, endMs: startMs + 211 };
      const expected = [...periods.entries()].filter(([, spans]) => spans.some((span) => span.startMs < interval.endMs && (span.endMs === null || span.endMs > interval.startMs))).map(([id]) => id).sort();
      expect([...index.overlapping(interval)].sort()).toEqual(expected);
    }
  });

  it.skipIf(process.env.PROFILE_CYCLE_INSPECTION !== '1')('profiles cold and warm inspection queries on 72,732 cycles', () => {
    const store = new PlaybackStore({ connectionTargets: new Map(), historyMs: null });
    const cycles: Cycle[] = [];
    for (let i = 0; i < 72_732; i++) {
      const startedAtMs = i * 10;
      const base = cycle(`cycle-${i}`, startedAtMs, null, null);
      cycles.push(base, { ...base, responseAtMs: startedAtMs + 1 }, { ...base, responseAtMs: startedAtMs + 1, completedAtMs: startedAtMs + 3, outcome: 'ok' });
    }
    const ingestStart = performance.now();
    store.ingestCycles(cycles);
    const ingestMs = performance.now() - ingestStart;
    const range = { startMs: 360_000, endMs: 361_000 };
    const coldStart = performance.now();
    const cold = store.cyclesOverlappingRange(range, { limit: 100 });
    const coldMs = performance.now() - coldStart;
    const warmStart = performance.now();
    store.cyclesOverlappingRange(range, { limit: 100 });
    const warmMs = performance.now() - warmStart;
    const statsStart = performance.now();
    const stats = store.statisticsForRange(range);
    const statsMs = performance.now() - statsStart;
    const broadStart = performance.now();
    const broad = store.cyclesOverlappingRange({ startMs: 0, endMs: 800_000 }, { limit: 200 });
    const broadMs = performance.now() - broadStart;
    const broadWarmStart = performance.now();
    store.cyclesOverlappingRange({ startMs: 0, endMs: 800_000 }, { limit: 200 });
    const broadWarmMs = performance.now() - broadWarmStart;
    console.info('Cycle inspection profile', { ingested: 72_732, ingestMs, narrowMatches: cold.total, coldMs, warmMs, statsMs, starts: stats.starts, broadMatches: broad.total, broadMs, broadWarmMs });
  });

  it('emits root cycle and unit identity from real adapter lifecycle facts', () => {
    const element = {
      id: 'api', label: 'API', description: '', visualKind: 'service',
      ports: [{ id: 'in', label: 'in', direction: 'in', channel: 'call', protocol: 'http', schemaId: 's', responseSchemaId: 's' },
        { id: 'out', label: 'out', direction: 'out', channel: 'call', protocol: 'http', schemaId: 's', responseSchemaId: 's' }],
      behavior: { kind: 'resource', version: 1, config: { type: 'processor', capacity: 10, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }, entryPortId: 'in' },
    } as const;
    const adapter = new ResourceAdapter({ elements: [element], connections: [], seed: 1, durationMs: 1000 });
    adapter.admit({ rootId: 'w-1', journeyId: 'w-1', parentEventId: null, entryElementId: 'api', requestClassId: 'default', operation: 'read', key: 'k', tags: [], payloadRef: 'payload', atMs: 0, deadlineMs: 1000 });
    const records = adapter.drainFlow();
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record.cycleId === 'w-1' && record.unitId === 'w-1' && record.category === 'root')).toBe(true);
    expect(records.every((record) => record.parentUnitId === null)).toBe(true);
  });

  it('keeps explicit cycle and causal parent metadata on real S06 message branches', async () => {
    const doc: Document = {
      ...s06,
      scenarios: s06.scenarios.slice(0, 1).map((scenario) => ({
        ...scenario,
        workloads: scenario.workloads.map((workload) => ({
          ...workload,
          emission: { mode: 'bulk' as const, requests: 6, arrival: 'instant' as const },
        })),
      })),
    };
    expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'cycle-inspection-metadata');
    const records: FlowRecord[] = [];
    while (await runner.step()) records.push(...runner.drainFlow());
    records.push(...runner.drainFlow());
    const messageEvents = records.filter((record) => record.category === 'message');
    expect(messageEvents.length).toBeGreaterThan(0);
    expect(messageEvents.every((record) => record.cycleId && record.parentUnitId)).toBe(true);
    expect(records.filter((record) => record.phase === 'sent' || record.phase === 'response').every((record) => record.cycleId !== undefined && record.category !== undefined && record.elementId !== undefined)).toBe(true);
    expect(new Set(messageEvents.map((record) => record.cycleId)).size).toBeGreaterThan(0);
  });

  it('includes lifetimes crossing either boundary and excludes exact half-open endpoints', () => {
    expect(cycleOverlapsRange(cycle('before', 0, 100, 100, 'ok'), range)).toBe(false);
    expect(cycleOverlapsRange(cycle('left', 0, 100, 101, null), range)).toBe(true);
    expect(cycleOverlapsRange(cycle('inside', 100, null, null), range)).toBe(true);
    expect(cycleOverlapsRange(cycle('right', 299, 300, 300, 'ok'), range)).toBe(true);
    expect(cycleOverlapsRange(cycle('at-end', 300, null, null), range)).toBe(false);
  });

  it('counts activity at exact interval boundaries and keeps latency cohorts tied to observed events', () => {
    const cycles = [
      cycle('before', 50, 99, 99, 'ok'),
      cycle('starts-at-left', 100, 250, 290, 'failed'),
      cycle('ends-at-right', 200, 300, 300, 'ok'),
      cycle('starts-at-right', 300, null, null),
    ];
    expect(cycleIntervalStatistics(cycles, range)).toEqual({
      starts: 2, responses: 1, completions: 1, failures: 1, activeAtStart: 1, activeAtEnd: 0, peakConcurrency: 2,
      responseLatenciesMs: [150], completionLatenciesMs: [190],
    });
  });

  it('uses lifecycle revisions for a cycle completed, reopened, and completed again', () => {
    const store = new PlaybackStore({ connectionTargets: new Map(), historyMs: null });
    const started = cycle('reopened', 0, 500, null);
    const completed = { ...started, completedAtMs: 1000, outcome: 'ok' as const, observedAtMs: 1000 };
    const reopened = { ...completed, completedAtMs: null, outcome: null, observedAtMs: 2000 };
    const completedAgain = { ...reopened, completedAtMs: 4000, outcome: 'failed' as const, observedAtMs: 4000 };
    store.ingestCycles([started, completed, reopened, completedAgain]);

    expect(store.statisticsForRange({ startMs: 0, endMs: 1500 }).completions).toBe(1);
    expect(store.cyclesOverlappingRange({ startMs: 1200, endMs: 1500 }).total).toBe(0);
    expect(store.cyclesOverlappingRange({ startMs: 2000, endMs: 2500 }).total).toBe(1);
    expect(store.statisticsForRange({ startMs: 1500, endMs: 3000 })).toMatchObject({ completions: 0, activeAtStart: 0, activeAtEnd: 1, peakConcurrency: 1 });
    expect(store.statisticsForRange({ startMs: 3000, endMs: 4500 })).toMatchObject({ completions: 1, failures: 1, activeAtStart: 1, activeAtEnd: 0, peakConcurrency: 1 });
  });

  it('preserves same-time order deterministically and exposes causal messages even before root response', () => {
    const records = [flow('processing', 80, 'child', 'root'), flow('response', 120, 'root'), flow('sent', 80, 'child', 'root')];
    const events = cycleFlowEvents(records, 'root');
    expect(events.map((event) => [event.atMs, event.phase])).toEqual([[80, 'processing'], [80, 'sent'], [120, 'response']]);
    expect(events[0].category).toBe('message');
    expect(events[0].parentUnitId).toBe('root');
  });

  it('filters range cycles by lifecycle component facts', () => {
    const store = new PlaybackStore({ connectionTargets: new Map(), historyMs: null });
    const first = cycle('first', 0, null, null);
    const second = cycle('second', 1, null, null);
    store.ingestCycles([first, second]);
    store.ingestFlow([
      { ...flow('processing', 10, 'first'), cycleId: 'first', elementId: 'api' },
      { ...flow('processing', 11, 'second'), cycleId: 'second', elementId: 'worker' },
    ]);
    expect(store.cyclesOverlappingRange({ startMs: 0, endMs: 20 }, { componentId: 'api' }).rows.map((item) => item.id)).toEqual(['first']);
    expect(store.componentActivityForCycle('first')).toEqual([{ elementId: 'api', events: 1 }]);
  });

  it('drops evicted cycle events from the bounded stream inspection index', () => {
    const store = new PlaybackStore({ connectionTargets: new Map(), historyMs: 10_000 });
    store.ingestFlow([
      { ...flow('settled', 1000, 'root', null), key: 'root|old' },
      { ...flow('processing', 58_000, 'root', null), key: 'root|current' },
    ]);
    store.ingestCycles([cycle('root', 1000, 1000, 1000, 'ok')]);
    store.setComputedEdge(60_000);
    store.playing = true;
    store.speed = 16;
    store.advance(4000);
    expect(store.inspectionHistoryStartMs).toBe(50_000);
    expect(store.cyclesOverlappingRange({ startMs: 50_000, endMs: 60_000 }).total).toBe(0);
    expect(store.flowEventsForCycle('root').rows.map((event) => event.atMs)).toEqual([58_000]);
  });
});

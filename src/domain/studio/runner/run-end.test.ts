/**
 * D56: a run ends when every bulk has sent its requests and everything has settled; a stream ends
 * only at Stop. Built with the app's own planners, stepped like the worker steps it.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document, Emission, Id, Scenario } from '../model';
import { applyRecordChanges } from '../../../persistence/studio/apply-records';
import { checkReadiness } from '../readiness';
import { validateDocument } from '../validate';
import { placeEntry } from '../../../features/catalog/place';
import { DEFAULT_SCENARIO_BUDGETS } from '../../../features/scenarios/budgets';
import { ScenarioRunner, runScenario } from './scenario-runner';
import { ResourceAdapter } from './resource-adapter';

function build(emission: Emission, startDelayMs = 0): Document {
  let n = 0;
  const mint = () => `00000000-000a-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const viewId = mint();
  let doc: Document = {
    schema: 'studio-model/1', id: mint(), title: 'Run end', elements: [], connections: [], relations: [], schemas: [],
    fixtures: [], refinements: [], scenarios: [],
    views: [{ id: viewId, label: 'Main', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }],
  };
  const placed = placeEntry({ document: doc, viewId, entryId: 'service', anchor: { x: 0, y: 0 }, mintId: mint });
  if (!placed.ok) throw new Error(JSON.stringify(placed.issues));
  const applied = applyRecordChanges(doc, placed.changes);
  if (!applied.ok) throw new Error(JSON.stringify(applied.issues));
  doc = applied.document;
  const service = doc.elements[0];
  const entry = { elementId: service.id, portId: (service.behavior as { entryPortId: Id }).entryPortId };
  const scenario: Scenario = {
    id: mint(), label: 'Run', revision: 0, mode: 'timed', scopeElementIds: [service.id],
    entryPorts: [entry], inputs: [],
    workloads: [{
      id: mint(), entry, enabled: true, startDelayMs, emission, timeoutMs: 30000,
      classes: [{ id: mint(), name: 'Req', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 100, hotSubset: 1, hotShare: 100 } }],
    }],
    faults: [], boundaries: [], refinementSelections: [], initialContexts: [],
    assertions: [{ id: mint(), label: 'any', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'at-least', expected: 0 }],
    seed: 10, budgets: DEFAULT_SCENARIO_BUDGETS, assumptions: [],
  };
  return { ...doc, scenarios: [scenario] };
}

const bulk = (requests: number, arrival: Extract<Emission, { mode: 'bulk' }>['arrival'] = 'instant'): Emission => ({ mode: 'bulk', requests, arrival });
const stream = (ratePerSecond: number): Emission => ({ mode: 'stream', ratePerSecond, profile: { kind: 'steady' } });

function ready(doc: Document): void {
  const valid = validateDocument(doc);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
  expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
}

async function runToEnd(doc: Document, beforeEachStep?: (runner: ScenarioRunner, steps: number) => void, limit = 2_000_000) {
  ready(doc);
  const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'run-end');
  let steps = 0;
  while (steps < limit) {
    beforeEachStep?.(runner, steps);
    if (!(await runner.step())) break;
    steps++;
  }
  return { runner, steps, result: runner.getResult() };
}

describe('bulk runs (D56)', () => {
  it('complete by themselves once every cycle has settled', async () => {
    const { result } = await runToEnd(build(bulk(50, { spreadMs: 500 })));
    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();
    expect(result.summary.rootCounts).toMatchObject({ generated: 50, succeeded: 50 });
    expect(result.summary.cycles).toMatchObject({ total: 50, open: 0 });
    expect(result.summary.cycles.byOutcome.ok).toBe(50);
    expect(result.cycles).toHaveLength(50);
    expect(result.cycles.every((c) => c.outcome === 'ok' && c.completedAtMs !== null && c.responseAtMs !== null)).toBe(true);
  });

  it('takes as long as its arrivals span, not a fixed horizon', async () => {
    const { result } = await runToEnd(build(bulk(20, { spreadMs: 4000 })));
    expect(result.summary.elapsedMs).toBeGreaterThan(3500);
    expect(result.summary.elapsedMs).toBeLessThan(6000);
  });

  it('honors the start delay', async () => {
    const { result } = await runToEnd(build(bulk(5), 2000));
    expect(result.cycles.every((c) => c.startedAtMs >= 2000)).toBe(true);
  });

  it('is deterministic for the same seed', async () => {
    const a = await runToEnd(build(bulk(30, { spreadMs: 300 })));
    const b = await runToEnd(build(bulk(30, { spreadMs: 300 })));
    expect(b.result.cycles).toEqual(a.result.cycles);
    expect(b.result.summary.cycles).toEqual(a.result.summary.cycles);
  });

  it('a Stop before the bulk has sent everything reports sent M of N, completed', async () => {
    const { result } = await runToEnd(build(bulk(1000, { spreadMs: 10000 })), (r) => {
      if (r.simulatedMs >= 1000) r.requestStop();
    });
    expect(result.status).toBe('completed');
    expect(result.reason).toMatch(/^Stopped after sending \d+ of 1000 requests$/);
    expect(result.summary.cycles.open).toBe(0);
  });
});

describe('stream runs and Stop (D56)', () => {
  it('never end by themselves', async () => {
    const doc = build(stream(20));
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'stream');
    let alive = true;
    for (let i = 0; i < 20000 && runner.simulatedMs < 60000; i += 1) alive = await runner.step();
    expect(runner.simulatedMs).toBeGreaterThanOrEqual(60000);
    expect(alive).toBe(true);
  });

  it('stop arrivals at Stop, drain, and complete', async () => {
    let stopped = false;
    const { result, runner } = await runToEnd(build(stream(100)), (r) => {
      if (!stopped && r.simulatedMs >= 2000) {
        r.requestStop();
        stopped = true;
      }
    });
    expect(result.status).toBe('completed');
    expect(result.summary.rootCounts.generated).toBeGreaterThan(120);
    expect(result.summary.rootCounts.generated).toBeLessThan(300);
    expect(result.summary.cycles.open).toBe(0);
    expect(result.summary.cycles.total).toBe(result.summary.rootCounts.generated);
    expect(runner.simulatedMs).toBeLessThan(5000);
  });

  it('stop themselves at stopAtMs when run headless', async () => {
    const doc = build(stream(100));
    ready(doc);
    const result = await runScenario(doc, doc.scenarios[0].id, 'headless', { stopAtMs: 1500 });
    expect(result.status).toBe('completed');
    expect(result.summary.rootCounts.generated).toBeGreaterThan(80);
    expect(result.summary.rootCounts.generated).toBeLessThan(250);
  });

  it('a Stop on a finished run does nothing', async () => {
    const { runner } = await runToEnd(build(bulk(5)));
    runner.requestStop();
    expect(await runner.step()).toBe(false);
  });

  it('start after their delay', async () => {
    const doc = build(stream(100), 1000);
    ready(doc);
    const result = await runScenario(doc, doc.scenarios[0].id, 'delayed', { stopAtMs: 2000 });
    expect(Math.min(...result.cycles.map((c) => c.startedAtMs))).toBeGreaterThanOrEqual(1000);
  });
});

describe('a stored example as cycles (D56)', () => {
  it('S06 orders each get a response and a completion, and every cycle succeeds', async () => {
    const doc = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s06.json'), 'utf8')) as Document;
    const scenario = doc.scenarios[0];
    const small: Document = {
      ...doc,
      scenarios: [{ ...scenario, workloads: scenario.workloads.map((w) => ({ ...w, emission: bulk(20, { spreadMs: 1000 }) })) }, ...doc.scenarios.slice(1)],
    };
    expect(checkReadiness(small, scenario.id).ready).toBe(true);
    const result = await runScenario(small, scenario.id, 's06-cycles');
    expect(result.status).toBe('completed');
    expect(result.cycles).toHaveLength(20);
    expect(result.cycles.every((c) => c.outcome === 'ok' && c.responseAtMs !== null && c.completedAtMs! >= c.responseAtMs!)).toBe(true);
    // Each order is the request plus its fulfilment message.
    expect(result.cycles.every((c) => c.counts.ok === 2)).toBe(true);
  });
});

describe('work that can never settle (D56)', () => {
  it('is reported stuck, by where it is held, and ends the run incomplete', async () => {
    const doc = build(bulk(3));
    const holder = doc.elements[0];
    // The kernel itself rarely strands work (roots always time out, finite faults end), so simulate
    // the leftover it would report once nothing more can happen.
    const spy = vi.spyOn(ResourceAdapter.prototype, 'unsettled').mockReturnValue([
      { identity: 'ghost-0:p:e:', category: 'message', holderNodeId: holder.id, phase: 'queued' },
      { identity: 'ghost-1:p:e:', category: 'message', holderNodeId: holder.id, phase: 'queued' },
    ]);
    try {
      ready(doc);
      const result = await runScenario(doc, doc.scenarios[0].id, 'stuck');
      expect(result.status).toBe('incomplete');
      expect(result.reason).toBe(`2 units never settled: 2 in ${holder.label}`);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('stream traces truncate instead of ending the run (D57)', () => {
  const tinyBudgets = { ...DEFAULT_SCENARIO_BUDGETS, maxEvents: 200, maxTraceRows: 50 };
  const withBudgets = (doc: Document): Document => ({ ...doc, scenarios: [{ ...doc.scenarios[0], budgets: tinyBudgets }] });

  it('a stream keeps running past the trace and event budgets, with the trace marked truncated', async () => {
    const doc = withBudgets(build(stream(100)));
    ready(doc);
    const result = await runScenario(doc, doc.scenarios[0].id, 'stream-budget', { stopAtMs: 3000 });
    expect(result.status).toBe('completed');
    expect(result.summary.rootCounts.generated).toBeGreaterThan(200);
    expect(result.summary.trace?.truncatedBy).toBe('trace-rows');
    expect(result.events.length).toBeLessThanOrEqual(50);
    expect(result.summary.cycles.total).toBe(result.summary.rootCounts.generated);
  });

  it('a bulk still ends incomplete at its budgets', async () => {
    const doc = withBudgets(build(bulk(500, { spreadMs: 1000 })));
    ready(doc);
    const result = await runScenario(doc, doc.scenarios[0].id, 'bulk-budget');
    expect(result.status).toBe('incomplete');
    expect(result.reason).toMatch(/Budget exhausted/);
  });
});

describe('checkpoints and cycle draining (D57)', () => {
  it('checkpoint() reports cumulative counts and cycle summary at the current clock', async () => {
    const doc = build(bulk(40, { spreadMs: 2000 }));
    ready(doc);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'cp');
    while (runner.simulatedMs < 1000) await runner.step();
    const early = runner.checkpoint();
    while (await runner.step()) {
      // run to the end
    }
    const end = runner.checkpoint();
    expect(early.atMs).toBeGreaterThanOrEqual(1000);
    expect(early.rootCounts.generated).toBeGreaterThan(5);
    expect(end.rootCounts.generated).toBe(40);
    expect(end.cycles.total).toBe(40);
    expect(end.atMs).toBeGreaterThanOrEqual(early.atMs);
    expect(end.elementMetrics.length).toBeGreaterThan(0);
  });

  it('drainCycles() hands out finished cycles once; with streamOutCycles they leave memory', async () => {
    const doc = build(bulk(20, { spreadMs: 1000 }));
    ready(doc);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'drain', { streamOutCycles: true });
    const seen: string[] = [];
    while (await runner.step()) seen.push(...runner.drainCycles().map((c) => c.id));
    seen.push(...runner.drainCycles().map((c) => c.id));
    expect(new Set(seen).size).toBe(20);
    expect(seen).toHaveLength(20);
    expect(runner.getResult().cycles).toEqual([]);
    expect(runner.getResult().summary.cycles).toMatchObject({ total: 20, open: 0 });
  });
});

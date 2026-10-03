/**
 * D55: a run can end after a number of requests, after a number of seconds, or when the user stops
 * it. Built with the app's own planners, stepped like the worker steps it.
 */
import { describe, expect, it } from 'vitest';
import type { CompletionPolicy, Document, Id, Scenario } from '../model';
import { applyRecordChanges } from '../../../persistence/studio/apply-records';
import { checkReadiness } from '../readiness';
import { validateDocument } from '../validate';
import { placeEntry } from '../../../features/catalog/place';
import { DEFAULT_SCENARIO_BUDGETS } from '../../../features/scenarios/budgets';
import { ScenarioRunner } from './scenario-runner';

function build(completion: CompletionPolicy, rate = 100): Document {
  let n = 0;
  const mint = () => `00000000-000a-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const viewId = mint();
  let doc: Document = {
    schema: 'studio-model/1', id: mint(), title: 'Completion kinds', elements: [], connections: [], relations: [], schemas: [],
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
    id: mint(), label: 'Steady', revision: 0, mode: 'timed', scopeElementIds: [service.id],
    entryPorts: [entry], inputs: [],
    workloads: [{
      id: mint(), entry, enabled: true, rate, profile: { kind: 'steady' }, timeoutMs: 30000, intervalMs: null,
      classes: [{ id: mint(), name: 'Req', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 100, hotSubset: 1, hotShare: 100 } }],
    }],
    faults: [], boundaries: [], refinementSelections: [], initialContexts: [],
    assertions: [{ id: mint(), label: 'any', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'at-least', expected: 0 }],
    seed: 10, budgets: DEFAULT_SCENARIO_BUDGETS, completion, assumptions: [],
  };
  return { ...doc, scenarios: [scenario] };
}

async function runToEnd(doc: Document, beforeEachStep?: (runner: ScenarioRunner, steps: number) => void, limit = 2_000_000) {
  const valid = validateDocument(doc);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
  expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
  const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'completion');
  let steps = 0;
  while (steps < limit) {
    beforeEachStep?.(runner, steps);
    if (!(await runner.step())) break;
    steps++;
  }
  return { runner, steps, result: runner.getResult() };
}

describe('count completion (D55)', () => {
  it('generates exactly that many requests, then drains and completes', async () => {
    const { result } = await runToEnd(build({ kind: 'count', requests: 50, deadlineMs: 60000 }));
    expect(result.status).toBe('completed');
    expect(result.summary.rootCounts.generated).toBe(50);
    expect(result.summary.rootCounts.succeeded).toBe(50);
    // 50 requests at 100/s take about half a second, not the 60 s deadline.
    expect(result.summary.elapsedMs).toBeLessThan(3000);
  });

  it('is incomplete when the deadline comes before the requests have arrived or settled', async () => {
    const { result } = await runToEnd(build({ kind: 'count', requests: 100000, deadlineMs: 2000 }, 100));
    expect(result.status).toBe('incomplete');
    expect(result.summary.rootCounts.generated).toBeLessThan(1000);
  });

  it('with several workloads still sends that many in total', async () => {
    const doc = build({ kind: 'count', requests: 30, deadlineMs: 60000 }, 50);
    const wl = doc.scenarios[0].workloads[0];
    const second = { ...wl, id: '00000000-000a-4000-8000-0000000000f1', classes: wl.classes.map((c) => ({ ...c, id: '00000000-000a-4000-8000-0000000000f2' })) };
    const withTwo = { ...doc, scenarios: [{ ...doc.scenarios[0], workloads: [wl, second] }] };
    const { result } = await runToEnd(withTwo);
    expect(result.summary.rootCounts.generated).toBe(30);
  });
});

describe('open completion and Stop (D55)', () => {
  it('never ends by itself; Stop stops arrivals, drains and completes', async () => {
    let stoppedAt = -1;
    const { result, runner } = await runToEnd(build({ kind: 'open' }), (r, steps) => {
      if (stoppedAt < 0 && r.simulatedMs >= 2000) {
        r.requestStop();
        stoppedAt = steps;
      }
    });
    expect(stoppedAt).toBeGreaterThan(0);
    expect(result.status).toBe('completed');
    // About two simulated seconds of arrivals at 100/s, then nothing new.
    expect(result.summary.rootCounts.generated).toBeGreaterThan(120);
    expect(result.summary.rootCounts.generated).toBeLessThan(300);
    expect(result.summary.rootCounts.succeeded).toBe(result.summary.rootCounts.generated);
    expect(runner.simulatedMs).toBeLessThan(5000);
  });

  it('is still going after a long stretch of simulated time without a stop', async () => {
    const doc = build({ kind: 'open' }, 20);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'open');
    let alive = true;
    for (let i = 0; i < 20000 && runner.simulatedMs < 60000; i += 1) alive = await runner.step();
    expect(runner.simulatedMs).toBeGreaterThanOrEqual(60000);
    expect(alive).toBe(true);
  });

  it('a stop ends a fixed-horizon run early, completed, after the work in flight drains', async () => {
    const { result, runner } = await runToEnd(build({ kind: 'horizon', horizonMs: 30000 }), (r) => {
      if (r.simulatedMs >= 1000) r.requestStop();
    });
    expect(result.status).toBe('completed');
    expect(runner.simulatedMs).toBeLessThan(5000);
    expect(result.summary.rootCounts.generated).toBeLessThan(200);
  });

  it('a stop does nothing to a run that has already finished, and exposes the next event time for pacing', async () => {
    const { runner } = await runToEnd(build({ kind: 'count', requests: 5, deadlineMs: 5000 }));
    runner.requestStop();
    expect(await runner.step()).toBe(false);
    const doc = build({ kind: 'open' }, 10);
    const live = new ScenarioRunner(doc, doc.scenarios[0].id, 'pace');
    expect(live.nextEventAtMs()).not.toBeNull();
  });
});

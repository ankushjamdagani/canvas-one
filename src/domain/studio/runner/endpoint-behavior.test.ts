/**
 * D53: the simulated settings of an in-port (rate limit, failure rate, service time) override the
 * node's behavior for calls entering through it. Built with the app's own planners.
 */
import { describe, expect, it } from 'vitest';
import type { Assertion, Document, Id, Scenario } from '../model';
import { applyRecordChanges } from '../../../persistence/studio/apply-records';
import { checkReadiness } from '../readiness';
import { validateDocument } from '../validate';
import { placeEntry } from '../../../features/catalog/place';
import { DEFAULT_SCENARIO_BUDGETS } from '../../../features/scenarios/budgets';
import { runScenario } from './scenario-runner';

function build(settings: Record<string, unknown> | null): { doc: Document; service: Id } {
  let n = 0;
  const mint = () => `00000000-0008-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const viewId = mint();
  let doc: Document = {
    schema: 'studio-model/1', id: mint(), title: 'Endpoint behavior', elements: [], connections: [], relations: [], schemas: [],
    fixtures: [], refinements: [], scenarios: [],
    views: [{ id: viewId, label: 'Main', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }],
  };
  const placed = placeEntry({ document: doc, viewId, entryId: 'service', anchor: { x: 0, y: 0 }, mintId: mint });
  if (!placed.ok) throw new Error(JSON.stringify(placed.issues));
  const applied = applyRecordChanges(doc, placed.changes);
  if (!applied.ok) throw new Error(JSON.stringify(applied.issues));
  doc = applied.document;
  const service = doc.elements[0];
  if (settings) {
    doc = {
      ...doc,
      elements: [{ ...service, ports: service.ports.map((p) => (p.direction === 'in' ? { ...p, settings } : p)) } as never],
    };
  }
  const entry = { elementId: service.id, portId: (service.behavior as { entryPortId: Id }).entryPortId };
  const count = (outcome: 'succeeded' | 'failed' | 'rejected', operator: Assertion['operator'], expected: number): Assertion => ({
    id: mint(), label: outcome, subject: { kind: 'count', scope: 'root', elementId: null, outcome }, operator, expected,
  });
  const scenario: Scenario = {
    id: mint(), label: 'Steady', revision: 0, mode: 'timed', scopeElementIds: [service.id],
    entryPorts: [entry], inputs: [],
    workloads: [{
      id: mint(), entry, enabled: true, rate: 100, profile: { kind: 'steady' }, timeoutMs: 30000, intervalMs: null,
      classes: [{ id: mint(), name: 'Req', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 100, hotSubset: 1, hotShare: 100 } }],
    }],
    faults: [], boundaries: [], refinementSelections: [], initialContexts: [],
    assertions: [count('failed', 'at-least', 0), count('rejected', 'at-least', 0), count('succeeded', 'at-least', 0)],
    seed: 8, budgets: DEFAULT_SCENARIO_BUDGETS, completion: { kind: 'horizon', horizonMs: 5000 }, assumptions: [],
  };
  return { doc: { ...doc, scenarios: [scenario] }, service: service.id };
}

async function roots(settings: Record<string, unknown> | null) {
  const { doc } = build(settings);
  const valid = validateDocument(doc);
  expect(valid.ok ? [] : valid.issues).toEqual([]);
  expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
  const r = await runScenario(doc, doc.scenarios[0].id, 'endpoint');
  expect(r.status).toBe('completed');
  return r.summary.rootCounts as { generated: number; succeeded: number; failed: number; rejected: number };
}

describe('endpoint behavior overrides (D53)', () => {
  it('without settings nothing is rejected or failed', async () => {
    const c = await roots(null);
    expect(c.succeeded).toBe(c.generated);
  });

  it('a rate limit rejects calls beyond its token bucket', async () => {
    const c = await roots({ rateLimit: { rps: 20, burst: 5 } });
    expect(c.rejected).toBeGreaterThan(0);
    // 100/s offered for 5 s against 20/s plus a burst of 5: about 105 get in.
    expect(c.succeeded).toBeGreaterThan(80);
    expect(c.succeeded).toBeLessThan(130);
    expect(c.succeeded + c.rejected).toBe(c.generated);
  });

  it("a failure rate replaces the node's: 100% fails every call through the endpoint", async () => {
    const c = await roots({ failureRate: 100 });
    expect(c.failed).toBe(c.generated);
  });

  it('a service time slower than the node can serve makes calls queue up and be turned away', async () => {
    const fast = await roots({ serviceTimeMs: 1 });
    const slow = await roots({ serviceTimeMs: 500 });
    expect(fast.succeeded).toBe(fast.generated);
    expect(slow.succeeded).toBeLessThan(slow.generated);
  });
});

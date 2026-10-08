/**
 * S06 "Checkout under a traffic spike" example:
 * a gateway in front of replicas with caller retries, a third party with retries and an
 * attempt timeout, a queue absorbing a burst, and latency/throughput checks.
 *
 * The fixture is built with the app's own planners (placeEntry, planConnection,
 * completeConnection), so it carries the catalog's real defaults. `UPDATE_S06=1` rewrites
 * src/features/entry/examples/s06.json; otherwise this test checks the file still matches the
 * builder and that every scenario completes with every check passing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Assertion, CallRetryPolicy, Connection, Document, Element, Id, Scenario, Workload } from '../../domain/studio/model';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import { validateDocument } from '../../domain/studio/validate';
import { checkReadiness } from '../../domain/studio/readiness';
import { runScenario } from '../../domain/studio/runner/scenario-runner';
import { placeEntry } from '../catalog/place';
import { completeConnection, planConnection } from '../catalog/connect';
import { DEFAULT_SCENARIO_BUDGETS } from '../scenarios/budgets';

const FIXTURE = join(process.cwd(), 'src/features/entry/examples/s06.json');

function buildS06(): Document {
  let n = 0;
  const mint = () => `00000000-0006-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const viewId = mint();
  let doc: Document = {
    schema: 'studio-model/1', id: mint(), title: 'S06 Checkout under a traffic spike',
    elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [],
    views: [{ id: viewId, label: 'Main', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }],
  };
  const apply = (changes: Parameters<typeof applyRecordChanges>[1]) => {
    const r = applyRecordChanges(doc, changes);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    doc = r.document;
  };
  const el = (id: Id) => doc.elements.find((e) => e.id === id)!;
  const place = (entryId: string, label: string, x: number, y: number, description: string): Id => {
    const r = placeEntry({ document: doc, viewId, entryId, anchor: { x, y }, mintId: mint });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    apply(r.changes);
    apply([{ kind: 'replace', value: { recordKind: 'element', record: { ...el(r.elementId), label, description } } } as never]);
    return r.elementId;
  };
  const configure = (id: Id, patch: Record<string, unknown>) => {
    const e = el(id);
    if (e.behavior.kind !== 'resource') throw new Error('not a resource');
    apply([{ kind: 'replace', value: { recordKind: 'element', record: { ...e, behavior: { ...e.behavior, config: { ...e.behavior.config, ...patch } } } as Element } } as never]);
  };
  const orderClass = mint();
  const connect = (from: Id, to: Id, patch: Record<string, unknown> = {}): Id => {
    const out = el(from).ports.find((p) => p.direction === 'out' && p.channel !== 'event')!;
    const r = planConnection({ document: doc, viewId, source: { elementId: from, portId: out.id }, target: { elementId: to }, mintId: mint });
    if (r.kind === 'rejected') throw new Error(JSON.stringify(r.issues));
    let id: Id;
    if (r.kind === 'ready') {
      apply(r.changes);
      id = r.connectionId;
    } else {
      const c = completeConnection(r.draft);
      if (!c.ok) throw new Error(JSON.stringify(c.issues));
      apply(c.changes);
      id = c.connectionId;
    }
    // A caller's retries live on the out-port it calls through.
    const conn = doc.connections.find((x) => x.id === id)!;
    if (patch.retry) {
      const from = el(conn.source.elementId);
      apply([{ kind: 'replace', value: { recordKind: 'element', record: { ...from, ports: from.ports.map((p) => (p.id === conn.source.portId ? { ...p, settings: { ...(p.settings ?? {}), retry: patch.retry } } : p)) } } } as never]);
    }
    return id;
  };
  const retry = (o: Partial<CallRetryPolicy>): CallRetryPolicy => ({
    maxAttempts: 2, backoffMs: 50, backoffMultiplier: 2, maxBackoffMs: 1000, jitter: true, attemptTimeoutMs: null, ...o,
  });

  const gateway = place('gateway', 'Gateway', 0, 200, 'Entry point; retries a failed call on the other replica');
  const apiA = place('service', 'Checkout API A', 280, 60, 'Takes the order: writes it, charges the card, queues fulfilment');
  const apiB = place('service', 'Checkout API B', 280, 380, 'Second replica of the checkout API');
  const db = place('database', 'Orders DB', 760, 0, 'Order writes');
  const payments = place('service', 'Payment service', 660, 220, 'Charges the card through the card processor; 2% of calls fail');
  const processor = place('thirdparty', 'Card processor', 1000, 220, 'External payment provider (scripted boundary)');
  const queue = place('queue', 'Order queue', 560, 460, 'Buffers fulfilment work');
  const worker = place('worker', 'Fulfilment worker', 900, 460, 'Packs and ships; 200 orders/s');
  configure(payments, { failureRate: 2 });

  for (const api of [apiA, apiB]) connect(gateway, api, { retry: retry({ backoffMs: 0, jitter: false }) });
  for (const api of [apiA, apiB]) {
    connect(api, db);
    connect(api, payments, { retry: retry({ maxAttempts: 3 }) });
    connect(api, queue);
  }
  const charge = connect(payments, processor, { retry: retry({ attemptTimeoutMs: 1000 }) });
  void charge;
  connect(queue, worker);

  // The card processor's scripted reply (a boundary), 150 ms, succeeding.
  const chargeOut = el(payments).ports.find((p) => p.direction === 'out' && p.channel === 'call')!;
  const approval = { id: mint(), schemaId: chargeOut.responseSchemaId!, value: {} };
  doc = { ...doc, fixtures: [...doc.fixtures, approval] };

  const gatewayEntry = { elementId: gateway, portId: (el(gateway).behavior as { entryPortId: Id }).entryPortId };
  const workload = (emission: Workload['emission'], startDelayMs = 0): Workload => ({
    id: mint(), entry: gatewayEntry, enabled: true, startDelayMs, emission, timeoutMs: 30000,
    // Class IDs are unique per document; the name 'Order' matches the connections' class label.
    classes: [{ id: mint(), name: 'Order', weight: 1, operation: 'write', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10000, hotSubset: 1, hotShare: 100 } }],
  });
  const count = (scope: 'root' | 'message', outcome: 'succeeded' | 'failed' | 'rejected' | 'expired' | 'inFlight', operator: Assertion['operator'], expected: number, label: string): Assertion => ({
    id: mint(), label, subject: { kind: 'count', scope, elementId: null, outcome }, operator, expected,
  });
  const metricCheck = (elementId: Id, key: 'p95LatencyMs' | 'throughput', operator: Assertion['operator'], expected: number, label: string): Assertion => ({
    id: mint(), label, subject: { kind: 'metric', elementId, key }, operator, expected,
  });
  const scenario = (label: string, workloads: Workload[], assertions: Assertion[], maxEvents: number): Scenario => {
    const wl = workloads[0];
    return {
      // The card processor is outside the scope: the boundary on the payment call stands in for it.
      id: mint(), label, revision: 0, mode: 'timed', scopeElementIds: doc.elements.filter((e) => e.id !== processor).map((e) => e.id),
      entryPorts: [wl.entry], inputs: [], workloads, faults: [],
      boundaries: [{
        id: mint(), source: { elementId: payments, portId: chargeOut.id }, schemaId: chargeOut.responseSchemaId!,
        responses: [{ id: mint(), match: { op: 'exists', value: { kind: 'literal', value: true } }, responseFixtureId: approval.id, payloadBindings: [], delayMs: 150, afterInputId: null, outcome: 'succeeded', repeat: true }],
      }],
      refinementSelections: [], initialContexts: [], assertions, seed: 6, budgets: { ...DEFAULT_SCENARIO_BUDGETS, maxEvents }, assumptions: [],
    };
  };
  doc = {
    ...doc,
    scenarios: [
      // 100 orders/s for 30 s.
      scenario('Steady traffic', [workload({ mode: 'bulk', requests: 3000, arrival: { spreadMs: 30000 } })], CHECKS.steady(count, metricCheck, { gateway, worker }), DEFAULT_SCENARIO_BUDGETS.maxEvents),
      // The same 100 orders/s, plus a 500 orders/s spike (600/s in all) from 10 s to 20 s.
      scenario('Flash sale', [
        workload({ mode: 'bulk', requests: 3000, arrival: { spreadMs: 30000 } }),
        workload({ mode: 'bulk', requests: 5000, arrival: { spreadMs: 10000 } }, 10000),
      ], CHECKS.flash(count, metricCheck, { gateway, worker }), 1_000_000),
    ],
  };
  return doc;
}

type Count = (scope: 'root' | 'message', outcome: 'succeeded' | 'failed' | 'rejected' | 'expired' | 'inFlight', operator: Assertion['operator'], expected: number, label: string) => Assertion;
type MetricCheck = (elementId: Id, key: 'p95LatencyMs' | 'throughput', operator: Assertion['operator'], expected: number, label: string) => Assertion;
type Ids = { gateway: Id; worker: Id };

const CHECKS = {
  steady: (count: Count, metric: MetricCheck, ids: Ids): Assertion[] => [
    count('root', 'failed', 'at-most', 0, 'no failed orders'),
    metric(ids.gateway, 'p95LatencyMs', 'at-most', 400, 'p95 checkout under 400 ms'),
    metric(ids.gateway, 'throughput', 'at-least', 95, 'about 100 orders/s get through'),
  ],
  flash: (count: Count, metric: MetricCheck, ids: Ids): Assertion[] => [
    // At 600/s the two checkout replicas saturate: about 10% of orders are turned away,
    // the design lesson this scenario shows (add a replica and it passes at 0).
    count('root', 'rejected', 'at-most', 1000, 'at most 1,000 orders turned away at the peak'),
    count('message', 'expired', 'equals', 0, 'no fulfilment message expires'),
    count('message', 'inFlight', 'equals', 0, 'the fulfilment backlog drains'),
    count('root', 'failed', 'at-most', 0, 'no failed orders'),
    metric(ids.worker, 'throughput', 'at-least', 0, 'fulfilment keeps working through the spike'),
  ],
};

describe('S06 Checkout under a traffic spike', () => {
  const built = buildS06();

  it('is stored and ready', () => {
    if (process.env.UPDATE_S06 === '1') writeFileSync(FIXTURE, `${JSON.stringify(built, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(built);
    const valid = validateDocument(built);
    expect(valid.ok ? [] : valid.issues).toEqual([]);
    for (const s of built.scenarios) expect(checkReadiness(built, s.id).ready).toBe(true);
  });

  for (const [index, label] of ['Steady traffic', 'Flash sale'].entries()) {
    it(`"${label}" completes with every check passing`, async () => {
      const s = built.scenarios[index];
      expect(checkReadiness(built, s.id).ready).toBe(true);
      const r = await runScenario(built, s.id, `s06-${index}`);
      if (process.env.S06_REPORT === '1') {
        console.info(`[s06] ${label}: ${r.status} ${r.reason ?? ''} roots ${JSON.stringify(r.summary.rootCounts)} msgs ${JSON.stringify(r.summary.messageCounts)} checks ${JSON.stringify(r.checks.map((c) => [s.assertions.find((a) => a.id === c.assertionId)!.label, c.status, c.actual]))}`);
      }
      expect(r.status).toBe('completed');
      expect(r.checks.map((c) => c.status)).toEqual(s.assertions.map(() => 'passed'));
    }, 60_000);
  }
});

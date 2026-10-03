/**
 * D53: one service calls two dependencies whose request shapes differ. The connect gesture adds an
 * out port per contract, and a scenario run routes traffic through both. Built with the app's own
 * planners (LESSONS: no hand-built graphs).
 */
import { describe, expect, it } from 'vitest';
import type { Document, Id, Scenario } from '../../domain/studio/model';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import { validateDocument } from '../../domain/studio/validate';
import { checkReadiness } from '../../domain/studio/readiness';
import { runScenario } from '../../domain/studio/runner/scenario-runner';
import { DEFAULT_SCENARIO_BUDGETS } from '../scenarios/budgets';
import { placeEntry } from './place';
import { completeConnection, planConnection } from './connect';

function build(): { doc: Document; ids: { gateway: Id; service: Id; db: Id; payments: Id } } {
  let n = 0;
  const mint = () => `00000000-0007-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const viewId = mint();
  let doc: Document = {
    schema: 'studio-model/1', id: mint(), title: 'Fan-out', elements: [], connections: [], relations: [], schemas: [],
    fixtures: [], refinements: [], scenarios: [],
    views: [{ id: viewId, label: 'Main', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }],
  };
  const apply = (changes: Parameters<typeof applyRecordChanges>[1]) => {
    const r = applyRecordChanges(doc, changes);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    doc = r.document;
  };
  const el = (id: Id) => doc.elements.find((e) => e.id === id)!;
  const place = (entryId: string, x: number): Id => {
    const r = placeEntry({ document: doc, viewId, entryId, anchor: { x, y: 0 }, mintId: mint });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    apply(r.changes);
    return r.elementId;
  };
  const reshape = (id: Id, key: string) => {
    const inPort = el(id).ports.find((p) => p.direction === 'in')!;
    const schema = doc.schemas.find((s) => s.id === inPort.schemaId)!;
    apply([{ kind: 'replace', value: { recordKind: 'schema', record: { ...schema, shape: { type: 'record', nullable: false, fields: [{ id: mint(), key, optional: true, shape: { type: 'string', nullable: false } }] } } } } as never]);
  };
  const cls = mint();
  const connect = (from: Id, to: Id) => {
    const out = el(from).ports.find((p) => p.direction === 'out' && p.channel !== 'event')!;
    const r = planConnection({ document: doc, viewId, source: { elementId: from, portId: out.id }, target: { elementId: to }, mintId: mint });
    if (r.kind === 'rejected') throw new Error(JSON.stringify(r.issues));
    if (r.kind === 'ready') return apply(r.changes);
    const c = completeConnection(r.draft, { requestClassId: cls, requestClassLabel: 'Order', operation: 'read', deadlineDurationMs: 5000 });
    if (!c.ok) throw new Error(JSON.stringify(c.issues));
    apply(c.changes);
  };

  const gateway = place('gateway', 0);
  const service = place('service', 300);
  const db = place('service', 600);
  const payments = place('service', 900);
  reshape(db, 'orderId');
  reshape(payments, 'card');
  connect(gateway, service);
  connect(service, db);
  connect(service, payments);

  const entry = { elementId: gateway, portId: (el(gateway).behavior as { entryPortId: Id }).entryPortId };
  const scenario: Scenario = {
    id: mint(), label: 'Steady', revision: 0, mode: 'timed', scopeElementIds: doc.elements.map((e) => e.id),
    entryPorts: [entry], inputs: [],
    workloads: [{
      id: mint(), entry, enabled: true, rate: 50, profile: { kind: 'steady' }, timeoutMs: 30000, intervalMs: null,
      classes: [{ id: mint(), name: 'Order', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 1000, hotSubset: 1, hotShare: 100 } }],
    }],
    faults: [], boundaries: [], refinementSelections: [], initialContexts: [],
    assertions: [
      { id: mint(), label: 'no failed requests', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'failed' }, operator: 'at-most', expected: 0 },
      { id: mint(), label: 'db is called', subject: { kind: 'metric', elementId: db, key: 'throughput' }, operator: 'at-least', expected: 1 },
      { id: mint(), label: 'payments is called', subject: { kind: 'metric', elementId: payments, key: 'throughput' }, operator: 'at-least', expected: 1 },
    ],
    seed: 7, budgets: DEFAULT_SCENARIO_BUDGETS, completion: { kind: 'horizon', horizonMs: 5000 }, assumptions: [],
  };
  doc = { ...doc, scenarios: [scenario] };
  return { doc, ids: { gateway, service, db, payments } };
}

describe('service fan-out with different dependency shapes (D53)', () => {
  const { doc, ids } = build();

  it('gives the service one out call port per contract and validates', () => {
    const service = doc.elements.find((e) => e.id === ids.service)!;
    expect(service.ports.filter((p) => p.direction === 'out' && p.channel === 'call')).toHaveLength(3);
    const valid = validateDocument(doc);
    expect(valid.ok ? [] : valid.issues).toEqual([]);
    expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
  });

  it('runs traffic through both dependencies', async () => {
    const r = await runScenario(doc, doc.scenarios[0].id, 'fan-out');
    expect(r.status).toBe('completed');
    expect(r.checks.map((c) => c.status)).toEqual(['passed', 'passed', 'passed']);
  }, 60_000);
});

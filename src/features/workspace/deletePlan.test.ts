import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import type { RecordChange } from '../../persistence/studio/types';
import { placeEntry } from '../catalog/place';
import { planConnection } from '../catalog/connect';
import s05 from '../entry/examples/s05.json';
import { planDelete } from './deletePlan';

function createMintId(): () => Id {
  let counter = 1;
  return () => {
    const hex = (counter++).toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${hex}`;
  };
}

function makeBlankDocument(mintId: () => Id): { document: Document; viewId: Id } {
  const viewId = mintId();
  const document: Document = {
    schema: 'studio-model/1',
    id: mintId(),
    title: 'Delete Test System',
    elements: [],
    connections: [],
    relations: [],
    schemas: [],
    fixtures: [],
    refinements: [],
    scenarios: [],
    views: [
      {
        id: viewId,
        label: 'Main View',
        placements: [],
        connectionIds: [],
        relationIds: [],
        groups: [],
        notes: [],
      },
    ],
  };
  return { document, viewId };
}

function applyChanges(doc: Document, changes: readonly RecordChange[]): Document {
  const res = applyRecordChanges(doc, changes);
  if (!res.ok) {
    throw new Error(`applyRecordChanges failed: ${JSON.stringify(res.issues)}`);
  }
  return res.document;
}

function place(doc: Document, viewId: Id, entryId: string, anchor: { x: number; y: number }, mintId: () => Id) {
  const res = placeEntry({ document: doc, viewId, entryId, anchor, mintId });
  if (!res.ok) throw new Error(`placeEntry failed: ${JSON.stringify(res.issues)}`);
  return res;
}

describe('planDelete', () => {
  it('returns an empty, non-confirming plan for an unknown view', () => {
    const mintId = createMintId();
    const { document } = makeBlankDocument(mintId);
    const plan = planDelete(document, 'missing-view', { elementIds: ['x'], connectionIds: [] });
    expect(plan.removedElementIds).toEqual([]);
    expect(plan.changes).toEqual([]);
    expect(plan.requiresConfirmation).toBe(false);
  });

  it('removes a single element, its placement, and no connections when it has none', () => {
    const mintId = createMintId();
    const { document: base, viewId } = makeBlankDocument(mintId);
    const p1 = place(base, viewId, 'service', { x: 0, y: 0 }, mintId);
    const doc = applyChanges(base, p1.changes);

    const plan = planDelete(doc, viewId, { elementIds: [p1.elementId], connectionIds: [] });

    expect(plan.removedElementIds).toEqual([p1.elementId]);
    expect(plan.removedPlacementIds).toEqual([p1.placementId]);
    expect(plan.removedConnectionIds).toEqual([]);
    expect(plan.requiresConfirmation).toBe(false);

    const removeKinds = plan.changes.map((c) => `${c.kind}:${c.kind === 'remove' ? c.recordKind : c.value.recordKind}`);
    expect(removeKinds).toContain('remove:element');
    expect(removeKinds).toContain('replace:view');

    const after = applyChanges(doc, plan.changes);
    expect(after.elements.find((e) => e.id === p1.elementId)).toBeUndefined();
    const view = after.views.find((v) => v.id === viewId)!;
    expect(view.placements.find((pl) => pl.id === p1.placementId)).toBeUndefined();
  });

  it('removing an element also removes its connections and their view connectionIds', () => {
    const mintId = createMintId();
    const { document: base, viewId } = makeBlankDocument(mintId);
    const p1 = place(base, viewId, 'data-pipeline', { x: 0, y: 0 }, mintId);
    let doc = applyChanges(base, p1.changes);
    const p2 = place(doc, viewId, 'data-pipeline', { x: 300, y: 0 }, mintId);
    doc = applyChanges(doc, p2.changes);

    const el1 = doc.elements.find((e) => e.id === p1.elementId)!;
    const el2 = doc.elements.find((e) => e.id === p2.elementId)!;
    const sourcePort = el1.ports.find((p) => p.direction === 'out')!;
    const plan1 = planConnection({
      document: doc,
      viewId,
      source: { elementId: el1.id, portId: sourcePort.id },
      target: { elementId: el2.id },
      mintId,
    });
    expect(plan1.kind).toBe('ready');
    if (plan1.kind !== 'ready') throw new Error('expected ready');
    doc = applyChanges(doc, plan1.changes);

    const plan = planDelete(doc, viewId, { elementIds: [el1.id], connectionIds: [] });
    expect(plan.removedConnectionIds).toEqual([plan1.connectionId]);
    expect(plan.requiresConfirmation).toBe(false);

    const after = applyChanges(doc, plan.changes);
    expect(after.connections.find((c) => c.id === plan1.connectionId)).toBeUndefined();
    const view = after.views.find((v) => v.id === viewId)!;
    expect(view.connectionIds).not.toContain(plan1.connectionId);
  });

  it('deletes an explicitly-selected connection without touching its elements', () => {
    const mintId = createMintId();
    const { document: base, viewId } = makeBlankDocument(mintId);
    const p1 = place(base, viewId, 'data-pipeline', { x: 0, y: 0 }, mintId);
    let doc = applyChanges(base, p1.changes);
    const p2 = place(doc, viewId, 'data-pipeline', { x: 300, y: 0 }, mintId);
    doc = applyChanges(doc, p2.changes);
    const el1 = doc.elements.find((e) => e.id === p1.elementId)!;
    const el2 = doc.elements.find((e) => e.id === p2.elementId)!;
    const sourcePort = el1.ports.find((p) => p.direction === 'out')!;
    const plan1 = planConnection({
      document: doc,
      viewId,
      source: { elementId: el1.id, portId: sourcePort.id },
      target: { elementId: el2.id },
      mintId,
    });
    if (plan1.kind !== 'ready') throw new Error('expected ready');
    doc = applyChanges(doc, plan1.changes);

    const plan = planDelete(doc, viewId, { elementIds: [], connectionIds: [plan1.connectionId] });
    expect(plan.removedElementIds).toEqual([]);
    expect(plan.removedConnectionIds).toEqual([plan1.connectionId]);

    const after = applyChanges(doc, plan.changes);
    expect(after.elements.find((e) => e.id === el1.id)).toBeDefined();
    expect(after.elements.find((e) => e.id === el2.id)).toBeDefined();
    expect(after.connections.find((c) => c.id === plan1.connectionId)).toBeUndefined();
  });

  it('flags scenarios that reference a removed element and requires confirmation', () => {
    const mintId = createMintId();
    const { document: base, viewId } = makeBlankDocument(mintId);
    const p1 = place(base, viewId, 'service', { x: 0, y: 0 }, mintId);
    const doc: Document = {
      ...applyChanges(base, p1.changes),
      scenarios: [
        {
          id: mintId(),
          label: 'Checkout happy path',
          revision: 1,
          mode: 'logical',
          scopeElementIds: [p1.elementId],
          entryPorts: [],
          inputs: [],
          workloads: [],
          faults: [],
          boundaries: [],
          refinementSelections: [],
          initialContexts: [],
          assertions: [],
          seed: 1,
          budgets: { maxEvents: 10000, maxTraceRows: 1000, maxTraceBytes: 1000000, maxScheduledEvents: 10000, maxLiveRoots: 1000 },
          assumptions: [],
        },
      ],
    };

    const plan = planDelete(doc, viewId, { elementIds: [p1.elementId], connectionIds: [] });
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.affectedScenarioLabels).toEqual(['Checkout happy path']);
  });

  it('does not flag scenarios that reference unrelated elements', () => {
    const mintId = createMintId();
    const { document: base, viewId } = makeBlankDocument(mintId);
    const p1 = place(base, viewId, 'service', { x: 0, y: 0 }, mintId);
    const doc = applyChanges(base, p1.changes);
    const p2 = place(doc, viewId, 'data-pipeline', { x: 300, y: 0 }, mintId);
    const doc2: Document = {
      ...applyChanges(doc, p2.changes),
      scenarios: [
        {
          id: mintId(),
          label: 'Unrelated scenario',
          revision: 1,
          mode: 'logical',
          scopeElementIds: [p2.elementId],
          entryPorts: [],
          inputs: [],
          workloads: [],
          faults: [],
          boundaries: [],
          refinementSelections: [],
          initialContexts: [],
          assertions: [],
          seed: 1,
          budgets: { maxEvents: 10000, maxTraceRows: 1000, maxTraceBytes: 1000000, maxScheduledEvents: 10000, maxLiveRoots: 1000 },
          assumptions: [],
        },
      ],
    };

    const plan = planDelete(doc2, viewId, { elementIds: [p1.elementId], connectionIds: [] });
    expect(plan.requiresConfirmation).toBe(false);
    expect(plan.affectedScenarioLabels).toEqual([]);
  });

  it('deduplicates a connection that is both explicitly selected and touches a removed element', () => {
    const mintId = createMintId();
    const { document: base, viewId } = makeBlankDocument(mintId);
    const p1 = place(base, viewId, 'data-pipeline', { x: 0, y: 0 }, mintId);
    let doc = applyChanges(base, p1.changes);
    const p2 = place(doc, viewId, 'data-pipeline', { x: 300, y: 0 }, mintId);
    doc = applyChanges(doc, p2.changes);
    const el1 = doc.elements.find((e) => e.id === p1.elementId)!;
    const el2 = doc.elements.find((e) => e.id === p2.elementId)!;
    const sourcePort = el1.ports.find((p) => p.direction === 'out')!;
    const plan1 = planConnection({
      document: doc,
      viewId,
      source: { elementId: el1.id, portId: sourcePort.id },
      target: { elementId: el2.id },
      mintId,
    });
    if (plan1.kind !== 'ready') throw new Error('expected ready');
    doc = applyChanges(doc, plan1.changes);

    const plan = planDelete(doc, viewId, {
      elementIds: [el1.id],
      connectionIds: [plan1.connectionId],
    });
    expect(plan.removedConnectionIds).toEqual([plan1.connectionId]);
  });

  it('every element is deletable; scenario references are repaired in one valid batch', () => {
    const doc = s05 as unknown as Document;
    const view = doc.views[0];
    for (const element of doc.elements) {
      const plan = planDelete(doc, view.id, { elementIds: [element.id], connectionIds: [] });
      expect(plan.blockedReason, element.label).toBeNull();
      const res = applyRecordChanges(doc, plan.changes);
      expect(res.ok, element.label).toBe(true);
      if (!res.ok) continue;
      expect(res.document.elements.some((e) => e.id === element.id)).toBe(false);
      const json = JSON.stringify(res.document.scenarios);
      expect(json.includes(element.id), element.label).toBe(false);
    }
  });

  it('previews scenario repairs and requires confirmation for a scenario-referenced node', () => {
    const doc = s05 as unknown as Document;
    const checkout = doc.elements.find((e) => e.label === 'Checkout')!;
    const plan = planDelete(doc, doc.views[0].id, { elementIds: [checkout.id], connectionIds: [] });
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.affectedScenarioLabels).toContain('Accepted and fulfilled');
    expect(plan.scenarioRepairSummaries[0]).toMatch(/Accepted and fulfilled: .*input/);
  });

  it('blocks (does not offer a doomed confirm) when repairs cannot validate', () => {
    const doc = s05 as unknown as Document;
    // A fixture-referencing schema cannot be repaired by this plan: corrupt the doc so validation fails regardless.
    const broken: Document = { ...doc, views: doc.views.map((v) => ({ ...v, connectionIds: [...v.connectionIds, 'ghost'] })) };
    const el = doc.elements[0];
    const plan = planDelete(broken, doc.views[0].id, { elementIds: [el.id], connectionIds: [] });
    expect(plan.blockedReason).not.toBeNull();
    expect(plan.requiresConfirmation).toBe(true);
  });
});

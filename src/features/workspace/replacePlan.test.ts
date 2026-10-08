import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import s04 from '../entry/examples/s04.json';
import { planReplacePart } from './replacePlan';

function createMintId(): () => Id {
  let counter = 1;
  return () => `00000000-0000-4000-8000-${(counter++).toString(16).padStart(12, '0')}`;
}

const fixture = ((s04 as { document?: unknown }).document ?? s04) as Document;
const viewId = fixture.views[0].id;
const elementA = fixture.elements.find((e) => e.label === 'A')!;
const touchesA = (doc: Document) =>
  doc.connections.filter((c) => c.source.elementId === elementA.id || c.target.elementId === elementA.id).map((c) => c.id);

describe('planReplacePart (selection.replace-part)', () => {
  it('swaps in the catalog entry at the same position, keeps the label and accounts for every connection', () => {
    const result = planReplacePart(fixture, viewId, elementA.id, 'service', createMintId());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { plan } = result;
    expect(plan.blockedReason).toBeNull();

    // Every connection that touched A either moved to the replacement or is listed for removal.
    expect([...plan.movedConnectionIds, ...plan.removedConnectionIds].sort()).toEqual(touchesA(fixture).sort());

    const applied = applyRecordChanges(fixture, plan.changes);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const doc = applied.document;
    expect(doc.elements.some((e) => e.id === elementA.id)).toBe(false);
    const replacement = doc.elements.find((e) => e.id === plan.newElementId)!;
    expect(replacement.label).toBe('A');
    expect(replacement.visualKind).toBe('service');

    const oldPlacement = fixture.views[0].placements.find((p) => p.elementId === elementA.id)!;
    const newPlacement = doc.views[0].placements.find((p) => p.elementId === plan.newElementId)!;
    expect({ x: newPlacement.x, y: newPlacement.y }).toEqual({ x: oldPlacement.x, y: oldPlacement.y });

    // Nothing in the result still points at the old element.
    expect(JSON.stringify(doc)).not.toContain(elementA.id);
    for (const id of plan.movedConnectionIds) {
      const moved = doc.connections.find((c) => c.id === id)!;
      expect([moved.source.elementId, moved.target.elementId]).toContain(plan.newElementId);
    }
    for (const id of plan.removedConnectionIds) expect(doc.connections.some((c) => c.id === id)).toBe(false);
  });

  it('moves scenario scope and relations to the replacement', () => {
    const result = planReplacePart(fixture, viewId, elementA.id, 'service', createMintId());
    if (!result.ok) throw new Error(result.reason);
    const applied = applyRecordChanges(fixture, result.plan.changes);
    if (!applied.ok) throw new Error('replacement should apply');
    for (const [i, scenario] of applied.document.scenarios.entries()) {
      const before = fixture.scenarios[i];
      if (before.scopeElementIds.includes(elementA.id)) {
        expect(scenario.scopeElementIds).toContain(result.plan.newElementId);
      }
    }
    const relationsBefore = fixture.relations.filter((r) => JSON.stringify(r).includes(elementA.id)).length;
    const relationsAfter = applied.document.relations.filter((r) => JSON.stringify(r).includes(result.plan.newElementId)).length;
    expect(relationsAfter).toBe(relationsBefore);
  });

  it('requires confirmation exactly when something is removed or blocked', () => {
    const result = planReplacePart(fixture, viewId, elementA.id, 'database', createMintId());
    if (!result.ok) throw new Error(result.reason);
    const { plan } = result;
    const expected = plan.removedConnectionIds.length > 0 || plan.scenarioRepairSummaries.length > 0 || plan.blockedReason !== null;
    expect(plan.requiresConfirmation).toBe(expected);
  });

  it('refuses a refinement owner or member and an unplaced element', () => {
    const withRefinement: Document = {
      ...fixture,
      refinements: [{ id: '00000000-0000-4000-8000-00000000abcd', ownerElementId: elementA.id, memberElementIds: [], portMappings: [] }],
    };
    const refused = planReplacePart(withRefinement, viewId, elementA.id, 'service', createMintId());
    expect(refused).toEqual({ ok: false, reason: 'A refinement owner or member cannot be replaced' });

    const missing = planReplacePart(fixture, viewId, '00000000-0000-4000-8000-00000000ffff', 'service', createMintId());
    expect(missing.ok).toBe(false);
  });
});

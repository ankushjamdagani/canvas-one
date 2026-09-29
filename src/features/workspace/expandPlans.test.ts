import { describe, expect, it } from 'vitest';
import type { Document, View } from '../../domain/studio/model';
import { expansionStateOf, planExpansion } from './expandPlans';

function makeDocument(): Document {
  const view: View = {
    id: 'v',
    label: 'Main',
    placements: [
      { id: 'p-a', elementId: 'a', x: 0, y: 0, width: 184, expanded: false },
      { id: 'p-b', elementId: 'b', x: 300, y: 0, width: 184, expanded: true },
    ],
    connectionIds: [],
    relationIds: [],
    groups: [{ id: 'g', label: 'Pair', elementIds: ['a', 'b'], collapsed: false }],
    notes: [],
  };
  return {
    schema: 'studio-model/1',
    id: 'doc',
    title: 'Expand',
    elements: [],
    connections: [],
    relations: [],
    schemas: [],
    fixtures: [],
    refinements: [],
    scenarios: [],
    views: [view],
  };
}

const withoutViews = (doc: Document) => JSON.stringify({ ...doc, views: undefined });

describe('planExpansion', () => {
  it('collapses a group by replacing only the owning view record', () => {
    const doc = makeDocument();
    const plan = planExpansion(doc, 'v', { kind: 'group', id: 'g' }, 'collapse');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes).toHaveLength(1);
    const change = plan.changes[0];
    expect(change.kind).toBe('replace');
    if (change.kind !== 'replace' || change.value.recordKind !== 'view') throw new Error('expected view replace');
    expect(change.value.record.groups[0].collapsed).toBe(true);
    expect(change.value.record.placements).toEqual(doc.views[0].placements);
  });

  it('flips a placement flag and expands it back', () => {
    const doc = makeDocument();
    const plan = planExpansion(doc, 'v', { kind: 'placement', id: 'p-b' }, 'collapse');
    expect(plan.ok && plan.label).toBe('Collapse');
    if (!plan.ok) return;
    const change = plan.changes[0];
    if (change.kind !== 'replace' || change.value.recordKind !== 'view') throw new Error('expected view replace');
    expect(expansionStateOf(change.value.record)).toEqual({ 'p-a': false, 'p-b': false, g: true });
    const next = { ...doc, views: [change.value.record] };
    expect(planExpansion(next, 'v', { kind: 'placement', id: 'p-b' }, 'expand').ok).toBe(true);
  });

  it('never touches runner-relevant records (input document is unchanged, non-view JSON identical)', () => {
    const doc = makeDocument();
    const before = JSON.stringify(doc);
    const plan = planExpansion(doc, 'v', { kind: 'group', id: 'g' }, 'collapse');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(JSON.stringify(doc)).toBe(before);
    const change = plan.changes[0];
    if (change.kind !== 'replace' || change.value.recordKind !== 'view') throw new Error('expected view replace');
    expect(withoutViews({ ...doc, views: [change.value.record] })).toBe(withoutViews(doc));
  });

  it('refuses unknown views, unknown targets and no-op flips', () => {
    const doc = makeDocument();
    expect(planExpansion(doc, 'nope', { kind: 'group', id: 'g' }, 'collapse')).toEqual({
      ok: false,
      reason: 'The active view no longer exists',
    });
    expect(planExpansion(doc, 'v', { kind: 'group', id: 'missing' }, 'collapse').ok).toBe(false);
    expect(planExpansion(doc, 'v', { kind: 'placement', id: 'missing' }, 'expand').ok).toBe(false);
    expect(planExpansion(doc, 'v', { kind: 'group', id: 'g' }, 'expand')).toEqual({
      ok: false,
      reason: 'This group is already expanded',
    });
    expect(planExpansion(doc, 'v', { kind: 'placement', id: 'p-a' }, 'collapse')).toEqual({
      ok: false,
      reason: 'This component is already collapsed',
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { Document, Placement, View } from '../../domain/studio/model';
import {
  DEFAULT_NOTE_WIDTH,
  GROUP_LABEL_MAX_LENGTH,
  NOTE_TEXT_MAX_LENGTH,
  VIEW_GROUP_LIMIT,
  VIEW_NOTE_LIMIT,
  planAddNote,
  planAlign,
  planDistribute,
  planGroup,
  planUngroup,
  type SelectionPlan,
} from './selectionPlans';

const VIEW_ID = 'view';

function makeDocument(overrides: Partial<View> = {}): Document {
  const view: View = {
    id: VIEW_ID,
    label: 'Main',
    placements: [
      { id: 'p-a', elementId: 'a', x: 10, y: 20, width: 100, expanded: false },
      { id: 'p-b', elementId: 'b', x: 200, y: 100, width: 200, expanded: false },
      { id: 'p-c', elementId: 'c', x: 500, y: 300, width: 150, expanded: false },
    ],
    connectionIds: [],
    relationIds: [],
    groups: [],
    notes: [],
    ...overrides,
  };
  return {
    schema: 'studio-model/1',
    id: 'document',
    title: 'Selection plans',
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

function plannedView(plan: SelectionPlan): View {
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan.changes).toHaveLength(1);
  const change = plan.changes[0];
  if (change.kind !== 'replace' || change.value.recordKind !== 'view') {
    throw new Error('expected one view replacement');
  }
  return change.value.record;
}

function coordinates(view: View, ids: readonly string[]): Array<[number, number]> {
  return ids.map((id) => {
    const placement = view.placements.find((entry) => entry.elementId === id);
    if (!placement) throw new Error(`missing placement ${id}`);
    return [placement.x, placement.y];
  });
}

describe('planGroup', () => {
  it('adds one user-named, expanded presentation group through one view replacement', () => {
    const plan = planGroup(makeDocument(), VIEW_ID, ['a', 'b'], 'group-new', '  Checkout services  ');
    expect(plan).toMatchObject({ ok: true, label: 'Group' });
    expect(plannedView(plan).groups).toEqual([
      { id: 'group-new', label: 'Checkout services', elementIds: ['a', 'b'], collapsed: false },
    ]);
  });

  it.each([
    ['missing view', () => planGroup(makeDocument(), 'missing', ['a'], 'group-new', 'G')],
    ['empty selection', () => planGroup(makeDocument(), VIEW_ID, [], 'group-new', 'G')],
    ['duplicate selection', () => planGroup(makeDocument(), VIEW_ID, ['a', 'a'], 'group-new', 'G')],
    ['unplaced element', () => planGroup(makeDocument(), VIEW_ID, ['missing'], 'group-new', 'G')],
    ['blank label', () => planGroup(makeDocument(), VIEW_ID, ['a'], 'group-new', '   ')],
    ['long label', () => planGroup(makeDocument(), VIEW_ID, ['a'], 'group-new', 'x'.repeat(GROUP_LABEL_MAX_LENGTH + 1))],
    ['existing id', () => planGroup(makeDocument(), VIEW_ID, ['a'], VIEW_ID, 'G')],
    [
      'already grouped element',
      () => planGroup(makeDocument({ groups: [{ id: 'g1', label: 'One', elementIds: ['a'], collapsed: false }] }), VIEW_ID, ['a'], 'group-new', 'G'),
    ],
    [
      'group limit',
      () => planGroup(makeDocument({ groups: Array.from({ length: VIEW_GROUP_LIMIT }, (_, i) => ({ id: `g${i}`, label: `${i}`, elementIds: [], collapsed: false })) }), VIEW_ID, ['a'], 'group-new', 'G'),
    ],
  ])('rejects %s', (_name, run) => {
    expect(run()).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});

describe('planUngroup', () => {
  const grouped = makeDocument({
    groups: [
      { id: 'g1', label: 'One', elementIds: ['a', 'b'], collapsed: false },
      { id: 'g2', label: 'Two', elementIds: ['c'], collapsed: true },
    ],
  });

  it('removes only the requested presentation groups', () => {
    const before = grouped.views[0];
    const plan = planUngroup(grouped, VIEW_ID, ['g1']);
    const after = plannedView(plan);
    expect(plan).toMatchObject({ ok: true, label: 'Ungroup' });
    expect(after.groups.map((group) => group.id)).toEqual(['g2']);
    expect(after.placements).toEqual(before.placements);
  });

  it.each([
    ['missing view', () => planUngroup(grouped, 'missing', ['g1'])],
    ['empty group selection', () => planUngroup(grouped, VIEW_ID, [])],
    ['duplicate groups', () => planUngroup(grouped, VIEW_ID, ['g1', 'g1'])],
    ['unknown group', () => planUngroup(grouped, VIEW_ID, ['missing'])],
  ])('rejects %s', (_name, run) => {
    expect(run()).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});

describe('planAlign', () => {
  it.each([
    ['left', [[10, 20], [10, 100]]],
    ['center-x', [[155, 20], [105, 100]]],
    ['right', [[300, 20], [200, 100]]],
    ['top', [[10, 20], [200, 20]]],
    ['center-y', [[10, 60], [200, 60]]],
    ['bottom', [[10, 100], [200, 100]]],
  ] as const)('aligns exact bounding-box geometry for %s', (edge, expected) => {
    const plan = planAlign(makeDocument(), VIEW_ID, ['a', 'b'], edge);
    expect(coordinates(plannedView(plan), ['a', 'b'])).toEqual(expected);
  });

  it.each([
    ['missing view', () => planAlign(makeDocument(), 'missing', ['a', 'b'], 'left')],
    ['fewer than two', () => planAlign(makeDocument(), VIEW_ID, ['a'], 'left')],
    ['duplicate selection', () => planAlign(makeDocument(), VIEW_ID, ['a', 'a'], 'left')],
    ['unplaced element', () => planAlign(makeDocument(), VIEW_ID, ['a', 'missing'], 'left')],
  ])('rejects %s', (_name, run) => {
    expect(run()).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});

describe('planDistribute', () => {
  it('distributes horizontally with fixed endpoints and exact equal bounding-box gaps', () => {
    const placements: Placement[] = [
      { id: 'p-a', elementId: 'a', x: 0, y: 5, width: 20, expanded: false },
      { id: 'p-b', elementId: 'b', x: 50, y: 10, width: 30, expanded: false },
      { id: 'p-c', elementId: 'c', x: 140, y: 15, width: 40, expanded: false },
    ];
    const plan = planDistribute(makeDocument({ placements }), VIEW_ID, ['a', 'b', 'c'], 'x');
    expect(coordinates(plannedView(plan), ['a', 'b', 'c'])).toEqual([[0, 5], [65, 10], [140, 15]]);
  });

  it('distributes vertically using the shared 76px card height', () => {
    const placements: Placement[] = [
      { id: 'p-a', elementId: 'a', x: 5, y: 0, width: 20, expanded: false },
      { id: 'p-b', elementId: 'b', x: 10, y: 100, width: 30, expanded: false },
      { id: 'p-c', elementId: 'c', x: 15, y: 300, width: 40, expanded: false },
    ];
    const plan = planDistribute(makeDocument({ placements }), VIEW_ID, ['a', 'b', 'c'], 'y');
    expect(coordinates(plannedView(plan), ['a', 'b', 'c'])).toEqual([[5, 0], [10, 150], [15, 300]]);
  });

  it('breaks coordinate ties by stable element id when choosing endpoints', () => {
    const placements: Placement[] = [
      { id: 'p-b', elementId: 'b', x: 0, y: 0, width: 20, expanded: false },
      { id: 'p-a', elementId: 'a', x: 0, y: 0, width: 10, expanded: false },
      { id: 'p-c', elementId: 'c', x: 100, y: 0, width: 30, expanded: false },
    ];
    const plan = planDistribute(makeDocument({ placements }), VIEW_ID, ['b', 'c', 'a'], 'x');
    expect(coordinates(plannedView(plan), ['a', 'b', 'c'])).toEqual([[0, 0], [45, 0], [100, 0]]);
  });

  it.each([
    ['missing view', () => planDistribute(makeDocument(), 'missing', ['a', 'b', 'c'], 'x')],
    ['fewer than three', () => planDistribute(makeDocument(), VIEW_ID, ['a', 'b'], 'x')],
    ['duplicate selection', () => planDistribute(makeDocument(), VIEW_ID, ['a', 'b', 'a'], 'x')],
    ['unplaced element', () => planDistribute(makeDocument(), VIEW_ID, ['a', 'b', 'missing'], 'x')],
  ])('rejects %s', (_name, run) => {
    expect(run()).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});

describe('planAddNote', () => {
  it('adds detached paper note text at the exact point with the named default width', () => {
    const plan = planAddNote(makeDocument(), VIEW_ID, 'note-new', '  Watch retry budget  ', { x: 125.5, y: -40 });
    expect(plan).toMatchObject({ ok: true, label: 'Add note' });
    expect(plannedView(plan).notes).toEqual([
      {
        id: 'note-new',
        text: 'Watch retry budget',
        x: 125.5,
        y: -40,
        width: DEFAULT_NOTE_WIDTH,
        tone: 'paper',
        attachedElementIds: [],
      },
    ]);
  });

  it.each([
    ['missing view', () => planAddNote(makeDocument(), 'missing', 'note-new', 'Text', { x: 0, y: 0 })],
    ['blank text', () => planAddNote(makeDocument(), VIEW_ID, 'note-new', '   ', { x: 0, y: 0 })],
    ['long text', () => planAddNote(makeDocument(), VIEW_ID, 'note-new', 'x'.repeat(NOTE_TEXT_MAX_LENGTH + 1), { x: 0, y: 0 })],
    ['existing id', () => planAddNote(makeDocument(), VIEW_ID, VIEW_ID, 'Text', { x: 0, y: 0 })],
    ['non-finite point', () => planAddNote(makeDocument(), VIEW_ID, 'note-new', 'Text', { x: Number.NaN, y: 0 })],
    ['out-of-bounds point', () => planAddNote(makeDocument(), VIEW_ID, 'note-new', 'Text', { x: 1_000_001, y: 0 })],
    [
      'note limit',
      () => planAddNote(makeDocument({ notes: Array.from({ length: VIEW_NOTE_LIMIT }, (_, i) => ({ id: `n${i}`, text: `${i}`, x: 0, y: 0, width: 220, tone: 'paper' as const, attachedElementIds: [] })) }), VIEW_ID, 'note-new', 'Text', { x: 0, y: 0 }),
    ],
  ])('rejects %s', (_name, run) => {
    expect(run()).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});

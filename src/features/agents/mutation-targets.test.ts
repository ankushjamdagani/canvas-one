import { describe, expect, it } from 'vitest';
import type { CanvasElement, Document } from '../../domain/studio/model';
import { mutationTargetIds } from './mutation-targets';

describe('visual mutation activity targets', () => {
  it('identifies changed, inserted and deleted objects without animating unchanged siblings', () => {
    const fixture: Document = { schema: 'studio-model/1', id: 'board', title: 'Board', elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [{ id: 'view', label: 'View', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }] };
    const shape: CanvasElement = { id: 'shape', kind: 'rectangle', x: 0, y: 0, width: 160, height: 100, text: '', fill: '#ffffff', stroke: '#171717', strokeWidth: 1, fontSize: 16 };
    const unchanged = { ...shape, id: 'unchanged', x: 200 };
    const deleted = { ...shape, id: 'deleted', x: 400 };
    const inserted = { ...shape, id: 'inserted', x: 600 };
    const view = { ...fixture.views[0], canvasElements: [shape, unchanged, deleted] };
    const document = { ...fixture, views: [view] };
    const record = { ...view, canvasElements: [{ ...shape, text: 'Working' }, unchanged, inserted] };
    expect(mutationTargetIds([{ kind: 'replace', value: { recordKind: 'view', record } }], document)).toEqual(['view', 'shape', 'inserted', 'deleted']);
    expect(mutationTargetIds([{ kind: 'replace', value: { recordKind: 'view', record: view } }], document)).toEqual(['view']);
    expect(mutationTargetIds([{ kind: 'remove', recordKind: 'view', id: 'view' }], document)).toEqual(['view', 'shape', 'unchanged', 'deleted']);
  });
  it('retains ordinary record targets and safely ignores malformed envelopes', () => {
    expect(mutationTargetIds([null, false, { kind: 'replace', value: null }, { kind: 'replace', value: { recordKind: 'element', record: { id: 'api' } } }, { kind: 'remove', id: 'api' }, { kind: 'remove', id: 'edge' }])).toEqual(['api', 'edge']);
    expect(mutationTargetIds(null)).toEqual([]);
  });
});

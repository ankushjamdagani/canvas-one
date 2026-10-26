import { describe, expect, it } from 'vitest';
import type { Connection, Document, Element, View } from '../../domain/studio/model';
import type { RecordChange } from '../../domain/studio/records';
import { assertConversationChanges, conversationWriteScope } from './scoped-changes';

export function scopedFixture(): Document {
  const element = (id: string): Element => ({ id, label: id, description: '', visualKind: 'host', ports: [], behavior: { kind: 'unmodeled', version: 1, reason: 'Diagram' } });
  const connection: Connection = { id: 'ab', kind: 'call', source: { elementId: 'a', portId: 'out' }, target: { elementId: 'b', portId: 'in' }, config: { latencyMs: 1, returnLatencyMs: 1, linkClass: null, jitterMs: 0, lossRate: 0, bandwidthKbps: null, weight: 1, condition: null, fallback: false } };
  return { schema: 'studio-model/1', id: 'board', title: 'Scoped board', elements: [element('a'), element('b'), element('c')], connections: [connection], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [{ id: 'view', label: 'View', placements: ['a', 'b', 'c'].map((id, index) => ({ id: `placement-${id}`, elementId: id, x: index * 100, y: 0, width: 80, expanded: true })), connectionIds: ['ab'], relationIds: [], groups: [{ id: 'group', label: 'Group', elementIds: ['a', 'b'], collapsed: false }], notes: [{ id: 'note', text: 'Comment', x: 0, y: 0, width: 100, tone: 'paper', attachedElementIds: [] }] }] };
}
const replaceView = (view: View): RecordChange => ({ kind: 'replace', value: { recordKind: 'view', record: view } });

describe('captured conversation write scopes', () => {
  it('captures dependent connections without granting their other endpoint', () => {
    const document = scopedFixture();
    expect(conversationWriteScope(document, ['a'])).toEqual(['a', 'ab']);
    const check = (changes: readonly RecordChange[]) => assertConversationChanges(document, ['a'], ['a', 'ab'], changes);
    expect(() => check([{ kind: 'replace', value: { recordKind: 'element', record: { ...document.elements[0], label: 'Renamed' } } }, { kind: 'remove', recordKind: 'connection', id: 'ab' }])).not.toThrow();
    expect(() => check([{ kind: 'replace', value: { recordKind: 'element', record: { ...document.elements[1], label: 'Unrelated' } } }])).toThrow('Expand the conversation scope');
  });
  it('allows selected placements while blocking unrelated positions and view metadata', () => {
    const document = scopedFixture(), view = document.views[0];
    const moved = { ...view, placements: view.placements.map(item => item.elementId === 'a' ? { ...item, x: 40 } : item) };
    expect(() => assertConversationChanges(document, ['a'], ['a', 'ab'], [replaceView(moved)])).not.toThrow();
    for (const after of [{ ...view, label: 'A different view' }, { ...view, placements: view.placements.map(item => item.elementId === 'b' ? { ...item, x: 500 } : item) }, { ...view, notes: [] }, { ...view, groups: [] }]) {
      expect(() => assertConversationChanges(document, ['a'], ['a', 'ab'], [replaceView(after)])).toThrow('conversation scope');
    }
  });
  it('allows explicitly selected note text but rejects expanding its attachments', () => {
    const document = scopedFixture(), view = document.views[0];
    expect(() => assertConversationChanges(document, ['note'], ['note'], [replaceView({ ...view, notes: [{ ...view.notes[0], text: '**Markdown**' }] })])).not.toThrow();
    expect(() => assertConversationChanges(document, ['note'], ['note'], [replaceView({ ...view, notes: [{ ...view.notes[0], attachedElementIds: ['c'] }] })])).toThrow('conversation scope');
  });
  it('captures selected group members once and rejects membership expansion', () => {
    const document = scopedFixture(), view = document.views[0], captured = conversationWriteScope(document, ['group']);
    expect(captured).toEqual(['group', 'a', 'b', 'ab']);
    expect(() => assertConversationChanges(document, ['group'], captured, [replaceView({ ...view, groups: [{ ...view.groups[0], collapsed: true }] })])).not.toThrow();
    expect(() => assertConversationChanges(document, ['group'], captured, [replaceView({ ...view, groups: [{ ...view.groups[0], elementIds: ['a', 'b', 'c'] }] })])).toThrow('conversation scope');
  });
  it('rejects moving a selected note into another view to expand its attachments', () => {
    const document = scopedFixture(), original = document.views[0];
    const other = { ...original, id: 'other-view', notes: [] };
    const board = { ...document, views: [original, other] };
    const changes = [replaceView({ ...original, notes: [] }), replaceView({ ...other, notes: [{ ...original.notes[0], attachedElementIds: ['c'] }] })];
    expect(() => assertConversationChanges(board, ['note'], ['note'], changes)).toThrow('conversation scope');
  });
  it('does not admit newly created objects or connections after scope capture', () => {
    const document = scopedFixture(), captured = conversationWriteScope(document, ['a']);
    const later = { ...document, connections: [...document.connections, { ...document.connections[0], id: 'ac', target: { elementId: 'c', portId: 'in' } }] };
    expect(() => assertConversationChanges(later, ['a'], captured, [{ kind: 'remove', recordKind: 'connection', id: 'ac' }])).toThrow('conversation scope');
    expect(() => assertConversationChanges(document, ['a'], captured, [{ kind: 'insert', value: { recordKind: 'element', record: { ...document.elements[0], id: 'new' } } }])).toThrow('conversation scope');
  });
  it('requires orphaned conversation targets to be reattached before a new request', () => {
    expect(() => conversationWriteScope(scopedFixture(), ['missing-target'])).toThrow('Reattach the conversation');
  });
  it('cannot retarget a captured connection or move a placement to another object', () => {
    const document = scopedFixture(), view = document.views[0];
    expect(() => assertConversationChanges(document, ['a'], ['a', 'ab'], [{ kind: 'replace', value: { recordKind: 'connection', record: { ...document.connections[0], target: { elementId: 'c', portId: 'in' } } } }])).toThrow('conversation scope');
    expect(() => assertConversationChanges(document, ['a', 'b'], ['a', 'b', 'ab'], [replaceView({ ...view, placements: view.placements.map(item => item.elementId === 'a' ? { ...item, elementId: 'b' } : item) })])).toThrow('conversation scope');
  });
  it('requires a whole-board conversation for removing a whole view', () => {
    const document = scopedFixture(), change: RecordChange = { kind: 'remove', recordKind: 'view', id: 'view' };
    expect(() => assertConversationChanges(document, ['a'], ['a', 'ab'], [change])).toThrow('conversation scope');
    expect(() => assertConversationChanges(document, [], [], [change])).not.toThrow();
  });
});

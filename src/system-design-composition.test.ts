import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRecordChanges, canonicalJson, discoverSystemDesignComponents, planCustomComponent, planSystemDesignDiagram, projectSystemDesignDocument, readSystemDesignSource, type Document } from '@canvas-one/system-design';
import { mergeDocuments } from '@canvas-one/system-design/versioning/merge';
import { resolveConflict } from '@canvas-one/system-design/versioning/resolve';
import { diffDocuments } from '@canvas-one/system-design/versioning/diff';
import { validateBoardDocument } from '@canvas-one/whiteboard';

const fixture = (name: string): Document => JSON.parse(readFileSync(`src/features/entry/examples/${name}.json`, 'utf8'));
const uuid = (value: number) => `ab000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const blank = (): Document => ({ schema: 'studio-model/1', id: uuid(1), title: 'Diagram', elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [], views: [{ id: uuid(2), label: 'Overview', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }] });
const mint = () => { let next = 100; return () => uuid(next++); };

describe('system-design read-only projection', () => {
  it('keeps custom payloads and unknown extension records through semantic history merges', async () => {
    const original = blank();
    const plan = planCustomComponent(original, {viewId: original.views[0].id, elementId: uuid(3), placementId: uuid(4), label: 'Card', position: {x: 0, y: 0}, component: {type: 'example/card', data: {text: 'Base'}, extensions: {}}});
    if (!plan.ok) throw new Error('Invalid plan');
    const applied = applyRecordChanges(original, plan.changes);
    if (!applied.ok) throw new Error('Invalid document');
    const base = applied.document;
    const ours = {...base, elements: [{...base.elements[0], component: {...base.elements[0].component!, data: {text: 'Updated'}}}]};
    const extensions = {'unavailable/provider': {version: '1.0.0', data: {opaque: ['retain', 42]}}};
    const theirs = {...base, extensions};
    const merged = await mergeDocuments(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.document.elements[0].component!.data).toEqual({text: 'Updated'});
    expect(merged.document.extensions).toEqual(extensions);
    expect(diffDocuments(base, merged.document)).toEqual(expect.arrayContaining([
      expect.objectContaining({recordKind: 'element', fieldPaths: [['component']]}),
      expect.objectContaining({recordKind: 'document', fieldPaths: [['extensions']]}),
    ]));
    const competing = await mergeDocuments(base, {...base, extensions}, {...base, extensions: {'unavailable/provider': {version: '2.0.0', data: {opaque: 'different'}}}});
    expect(competing.conflicts).toHaveLength(1);
    const resolved = await resolveConflict(competing, competing.conflicts[0].id, {kind: 'theirs'});
    expect(resolved.conflicts).toEqual([]);
    expect(resolved.document.extensions!['unavailable/provider'].version).toBe('2.0.0');
  });
  it.each(['s01', 's02', 's03', 's04', 's05', 's06', 'combined'])('preserves complete %s semantics and canonical payload without rewriting snapshots', (name) => {
    const original = fixture(name); const before = canonicalJson(original);
    const board = projectSystemDesignDocument(original, { extensions: { 'unavailable/custom': { version: '9.0.0', data: { values: [null, 4, 'retained'] } } } });
    expect(validateBoardDocument(board).ok).toBe(true);
    expect(board.extensions['unavailable/custom'].data).toEqual({ values: [null, 4, 'retained'] });
    const decoded = readSystemDesignSource(board); expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('source');
    expect(canonicalJson(decoded.document)).toEqual(before);
    expect(canonicalJson(original)).toEqual(before);
    expect(Object.isFrozen(decoded.document.elements)).toBe(true);
  });
  it('shares one entity across views while preserving separate placements and caller-owned display heights', () => {
    const original = fixture('s01'); const first = original.views[0];
    const input = { ...original, views: [...original.views, { ...first, id: uuid(50), label: 'Another view', placements: first.placements.map((placement, index) => ({ ...placement, id: uuid(60 + index), x: placement.x + 100 })), notes: [], groups: [] }] };
    const board = projectSystemDesignDocument(input, { placementHeight: () => 123 });
    expect(board.entities.filter((entity) => entity.id === original.elements[0].id)).toHaveLength(1);
    expect(board.placements.filter((placement) => placement.entityId === original.elements[0].id)).toHaveLength(2);
    expect(board.placements[0].bounds.height).toBe(123);
  });
});

describe('agent-friendly semantic diagram planning', () => {
  it('turns readable aliases and component namespaces into one valid atomic batch with fresh internal IDs', () => {
    const document = blank();
    const result = planSystemDesignDiagram(document, { viewId: document.views[0].id, components: [{ id: 'api', type: 'system-design/service', label: 'API' }, { id: 'database', type: 'system-design/database' }], connections: [{ source: 'api', target: 'database' }] }, mint());
    expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join('; '));
    expect(result.elementIds.api).not.toBe('api'); expect(result.assumptions[0]).toContain('not measured');
    const applied = applyRecordChanges(document, result.changes); expect(applied.ok).toBe(true); if (!applied.ok) throw new Error('apply');
    expect(applied.document.elements.map((element) => element.label)).toContain('API');
    expect(applied.document.connections).toHaveLength(1);
    expect(applied.document.views[0].placements).toHaveLength(2);
    expect(result.changes.filter((change) => change.kind !== 'remove' && change.value.recordKind === 'view')).toHaveLength(1);
    expect(document.elements).toHaveLength(0);
  });
  it('rejects duplicate aliases, unknown types, missing endpoints and invalid views without authored mutations', () => {
    const document = blank(); const viewId = document.views[0].id;
    expect(planSystemDesignDiagram(document, { viewId, components: [{ id: 'same', type: 'system-design/service' }, { id: 'same', type: 'system-design/service' }] }, mint()).ok).toBe(false);
    expect(planSystemDesignDiagram(document, { viewId, components: [{ id: 'service', type: 'unavailable/component' }] }, mint()).ok).toBe(false);
    expect(planSystemDesignDiagram(document, { viewId, components: [], connections: [{ source: 'missing', target: 'missing' }] }, mint()).ok).toBe(false);
    expect(planSystemDesignDiagram(document, { viewId: uuid(99), components: [] }, mint()).ok).toBe(false);
    expect(document.elements).toHaveLength(0);
    expect(discoverSystemDesignComponents().map((entry) => entry.id)).toContain('system-design/service');
  });
});

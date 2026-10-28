import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CANVAS_ELEMENT_KINDS, type CanvasElement, type Document, type View } from './model';
import { validateDocument } from './validate';
import { buildManifest } from './manifest';
import { canonicalJson } from './canonical';
import { applyRecordChanges } from '@canvas-one/system-design/authoring/apply-records';
import { planAddCanvasElement, planUpdateCanvasElement, planDeleteCanvasElements, type SelectionPlan } from '@canvas-one/system-design/authoring/selectionPlans';
import { planDelete } from '@canvas-one/system-design/authoring/deletePlan';
import { buildMoveChange, projectDocumentToCanvas } from '@canvas-one/system-design/canvas/projection';
import { projectSystemDesignDocument, readSystemDesignSource } from '@canvas-one/system-design/projection';
import { mergeDocuments } from '../versioning/merge';
import { diffDocuments } from '../versioning/diff';
import { renderDiagramSvg } from '../../features/transfer/svg-export';
import { basicComponentTypes, validateBasicEntity } from '@canvas-one/components-basic';
import { computeInverseChanges } from '@canvas-one/system-design/session/inverse';

const id = (n: number) => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, '0')}`;
const fixture = (): Document => JSON.parse(readFileSync('src/features/entry/examples/s01.json', 'utf8'));
function apply(document: Document, plan: SelectionPlan): Document {
  if (!plan.ok) throw new Error(plan.reason);
  const result = applyRecordChanges(document, plan.changes);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.document;
}
function withShapes(): Document {
  let doc = fixture();
  CANVAS_ELEMENT_KINDS.forEach((kind, index) => { doc = apply(doc, planAddCanvasElement(doc, doc.views[0].id, id(index), kind, { x: index * 220, y: -200 })); });
  return doc;
}
const shape = (doc: Document): CanvasElement => doc.views[0].canvasElements![0];
const replaceView = (doc: Document, view: View): Document => ({ ...doc, views: [view, ...doc.views.slice(1)] });

describe('visual-only canvas elements', () => {
  it('adds every primitive without adding executable elements, ports or behavior', () => {
    const before = fixture(); const after = withShapes();
    expect(validateDocument(after).ok).toBe(true);
    expect(after.elements).toEqual(before.elements);
    expect(after.connections).toEqual(before.connections);
    expect(after.scenarios).toEqual(before.scenarios);
    expect(after.views[0].canvasElements?.map(item => item.kind)).toEqual(CANVAS_ELEMENT_KINDS);
    expect(before.views[0]).not.toHaveProperty('canvasElements');
    expect(canonicalJson(JSON.parse(JSON.stringify(before)))).toEqual(canonicalJson(before));
    const centered = apply(before, planAddCanvasElement(before, before.views[0].id, id(99), 'text', { x: 200, y: 150 }, { centered: true, stroke: '#ffffff' }));
    expect(shape(centered)).toMatchObject({ x: 80, y: 110, stroke: '#ffffff' });
  });

  it('rejects malformed, unsafe, oversized and globally duplicate content', () => {
    const doc = withShapes();
    for (const patch of [{ fill: 'url(https://example.com/a)' }, { stroke: 'red; color:black' }, { x: Infinity }, { width: 31 }, { height: 23 }, { fontSize: 97 }, { strokeWidth: -1 }, { text: 'a'.repeat(4001) }, { kind: 'bogus' }]) {
      expect(planUpdateCanvasElement(doc, doc.views[0].id, shape(doc).id, patch as Partial<CanvasElement>).ok).toBe(false);
    }
    expect(planAddCanvasElement(doc, doc.views[0].id, doc.elements[0].id, 'rectangle', { x: 0, y: 0 }).ok).toBe(false);
    expect(planUpdateCanvasElement(doc, doc.views[0].id, shape(doc).id, { id: id(99) } as Partial<CanvasElement>).ok).toBe(false);
    const tooMany = Array.from({ length: 201 }, (_, n) => ({ ...shape(doc), id: id(n + 100) }));
    expect(validateDocument(replaceView(doc, { ...doc.views[0], canvasElements: tooMany })).ok).toBe(false);
  });

  it('edits, moves and deletes through one view replacement, preserving unrelated records', () => {
    const doc = withShapes();
    const updated = apply(doc, planUpdateCanvasElement(doc, doc.views[0].id, shape(doc).id, { text: 'Decision', width: 360 }));
    expect(shape(updated)).toMatchObject({ text: 'Decision', width: 360 });
    const editPlan = planUpdateCanvasElement(doc, doc.views[0].id, shape(doc).id, { text: 'Decision', width: 360 });
    if (!editPlan.ok) throw new Error(editPlan.reason);
    const inverse = computeInverseChanges(doc, editPlan.changes);
    expect(inverse.ok).toBe(true);
    if (inverse.ok) expect(applyRecordChanges(updated, inverse.changes)).toMatchObject({ ok: true, document: doc });
    const move = buildMoveChange(updated.views[0], [{ id: shape(doc).id, position: { x: 15.4, y: 32.8 } }]);
    expect(move).not.toBeNull();
    const moved = applyRecordChanges(updated, [move!]);
    expect(moved.ok && shape(moved.document)).toMatchObject({ x: 15, y: 33 });
    const deleted = apply(updated, planDeleteCanvasElements(updated, updated.views[0].id, [shape(doc).id]));
    expect(deleted.views[0].canvasElements).toHaveLength(6);
    expect(deleted.elements).toEqual(doc.elements);
    const mixed = planDelete(doc, doc.views[0].id, { elementIds: [], connectionIds: [], canvasElementIds: [shape(doc).id] });
    expect(mixed.changes).toHaveLength(1);
    expect(mixed.blockedReason).toBeNull();
    const result = applyRecordChanges(doc, mixed.changes);
    expect(result.ok && result.document.views[0].canvasElements).toHaveLength(6);
  });

  it('projects actual bounds and generic renderable basic types while retaining source round-trip', () => {
    const doc = withShapes();
    const canvas = projectDocumentToCanvas(doc, doc.views[0].id);
    const nodes = canvas.nodes.filter(node => node.data.kind === 'canvas-element');
    expect(nodes).toHaveLength(7);
    expect(nodes[0]).toMatchObject({ id: shape(doc).id, type: 'canvasElementNode', style: { width: 180, height: 120 } });
    const board = projectSystemDesignDocument(doc);
    for (const item of doc.views[0].canvasElements!) {
      const entity = board.entities.find(entry => entry.id === item.id)!;
      expect(basicComponentTypes).toContain(entity.type);
      expect(validateBasicEntity(entity)).toEqual([]);
      expect(board.placements.find(entry => entry.entityId === item.id)?.bounds).toEqual({ x: item.x, y: item.y, width: item.width, height: item.height });
    }
    expect(readSystemDesignSource(board)).toEqual({ ok: true, document: doc });
  });

  it('diffs and independently merges visual fields without erasing old optional fields', async () => {
    const base = withShapes();
    const ours = apply(base, planUpdateCanvasElement(base, base.views[0].id, shape(base).id, { text: 'ours' }));
    const theirs = apply(base, planUpdateCanvasElement(base, base.views[0].id, shape(base).id, { width: 500 }));
    expect(diffDocuments(base, ours).some(change => change.fieldPaths.some(path => path.includes('canvasElements')))).toBe(true);
    const merged = await mergeDocuments(base, ours, theirs);
    expect(merged.conflicts).toEqual([]);
    expect(merged.issues).toEqual([]);
    expect(shape(merged.document)).toMatchObject({ text: 'ours', width: 500 });
    const old = fixture();
    expect((await mergeDocuments(old, old, old)).document.views[0]).not.toHaveProperty('canvasElements');
    const oldOurs = replaceView(old, { ...old.views[0], label: 'Renamed view' });
    const oldTheirs = replaceView(old, { ...old.views[0], placements: old.views[0].placements.map((item, index) => index ? item : { ...item, x: item.x + 20 }) });
    const legacyMerged = await mergeDocuments(old, oldOurs, oldTheirs);
    expect(legacyMerged.conflicts).toEqual([]);
    expect(legacyMerged.document.views[0]).not.toHaveProperty('canvasElements');
  });

  it('exports shape-only boards with safe text, true bounds and all geometry', () => {
    const source = withShapes();
    const doc: Document = { ...source, views: [{ ...source.views[0], placements: [], notes: [], groups: [], connectionIds: [], relationIds: [] }] };
    const changed = apply(doc, planUpdateCanvasElement(doc, doc.views[0].id, shape(doc).id, { text: '<script>alert("x")</script> & safe' }));
    const svg = renderDiagramSvg(changed);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('<polygon');
    expect(svg.match(/data-canvas-element-id=/g)).toHaveLength(7);
    expect(renderDiagramSvg(changed)).toBe(svg);
  });

  it('preserves manifest and fingerprint for every existing scenario', async () => {
    const before = fixture(); const after = withShapes();
    const versions = { compilerVersion: '0.1.0', runnerVersions: [{ runnerId: 'resource-kernel', version: '0.1.0' }, { runnerId: 'bridge', version: '0.1.0' }] };
    for (const scenario of before.scenarios) {
      const prior = await buildManifest(before, scenario.id, versions);
      expect(prior.status).toBe('ok');
      expect(await buildManifest(after, scenario.id, versions)).toEqual(prior);
    }
  });
});

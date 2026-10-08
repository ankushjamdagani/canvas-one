import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import type { Document, Element, Id } from '../studio/model';
import { validateDocument } from '../studio/validate';
import { captureSelection } from './capture';
import { planPlacement } from './place';

function mintFactory(start = 1): () => Id {
  let next = start;
  return () => `e0000000-0000-4000-8000-${(next++).toString(16).padStart(12, '0')}`;
}

describe('planPlacement', () => {
  it('returns one valid RecordChange batch with anchor-offset presentation', () => {
    const source = JSON.parse(readFileSync(join(process.cwd(), 'src/features/entry/examples/s03.json'), 'utf8')) as Document;
    const capture = captureSelection(source, source.views[0].id, { elementIds: [source.elements[0].id], noteIds: [] });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const plan = planPlacement(source, source.views[0].id, capture.content, { x: 24, y: 36 }, mintFactory());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.newElementIds).toHaveLength(1);
    const applied = applyRecordChanges(source, plan.changes);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const placement = applied.document.views[0].placements.find((entry) => entry.elementId === plan.newElementIds[0]);
    expect(placement).toMatchObject({ x: 24, y: 36 });
    expect(validateDocument(applied.document)).toMatchObject({ ok: true });
  });

  it('rejects placement near the destination element/view limits before returning changes', () => {
    const source = JSON.parse(readFileSync(join(process.cwd(), 'src/features/entry/examples/s03.json'), 'utf8')) as Document;
    const capture = captureSelection(source, source.views[0].id, { elementIds: [source.elements[0].id], noteIds: [] });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const id = (n: number): Id => `d0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    const elements: Element[] = Array.from({ length: 100 }, (_, index) => ({
      id: id(index + 1), label: `Host ${index + 1}`, description: '', visualKind: 'host', ports: [],
      behavior: { kind: 'host', version: 1 },
    }));
    const destination: Document = {
      schema: 'studio-model/1', id: id(500), title: 'Full destination', elements,
      connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [],
      views: [{
        id: id(501), label: 'Full',
        placements: elements.map((element, index) => ({ id: id(index + 200), elementId: element.id, x: index * 100, y: 0, width: 180, expanded: false })),
        connectionIds: [], relationIds: [], groups: [], notes: [],
      }],
    };
    expect(validateDocument(destination)).toMatchObject({ ok: true });
    const plan = planPlacement(destination, destination.views[0].id, capture.content, { x: 0, y: 0 }, mintFactory());
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.issues.some((entry) => entry.code === 'too-many')).toBe(true);
  });
});


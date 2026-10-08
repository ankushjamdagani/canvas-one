import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../studio/model';
import { validateDocument } from '../studio/validate';
import { captureSelection } from './capture';

function fixture(name: string): Document {
  return JSON.parse(readFileSync(join(process.cwd(), 'src/features/entry/examples', `${name}.json`), 'utf8')) as Document;
}

describe('captureSelection', () => {
  it('captures a self-contained machine with its fixture and schemas and previews external wiring', () => {
    const document = fixture('s05');
    const machine = document.elements.find((element) => element.behavior.kind === 'machine')!;
    const result = captureSelection(document, document.views[0].id, { elementIds: [machine.id], noteIds: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content.elements).toHaveLength(1);
    expect(result.content.fixtures.map((entry) => entry.id)).toContain(machine.behavior.kind === 'machine' ? machine.behavior.initialContextFixtureId : '');
    expect(result.preview.requiredSchemaIds.length).toBeGreaterThan(0);
    expect(result.preview.excludedConnectionIds.length).toBeGreaterThan(0);
    expect(result.content.connections.some((connection) => result.preview.excludedConnectionIds.includes(connection.id))).toBe(false);
    expect(result.preview.warnings[0]).toContain('require wiring');
  });

  it('captures pipeline schemas including validate-operation dependencies', () => {
    const document = fixture('s03');
    const pipeline = document.elements[0];
    const result = captureSelection(document, document.views[0].id, { elementIds: [pipeline.id], noteIds: [] });

    expect(result.ok).toBe(true);
    if (!result.ok || pipeline.behavior.kind !== 'pipeline') return;
    const expected = new Set([
      pipeline.behavior.inputSchemaId,
      pipeline.behavior.outputSchemaId,
      pipeline.behavior.errorSchemaId,
      ...pipeline.behavior.operations.filter((operation) => operation.kind === 'validate').map((operation) => operation.schemaId),
    ]);
    expect(new Set(result.preview.requiredSchemaIds)).toEqual(expected);
  });

  it('expands a selected refinement owner and blocks an internal member alone', () => {
    const base = fixture('s05');
    const owner = base.elements[0];
    const member = base.elements[1];
    const refinement = {
      id: '00000000-0000-4000-8000-000000000001',
      ownerElementId: owner.id,
      memberElementIds: [member.id],
      portMappings: [],
    } as const;
    const document: Document = { ...base, refinements: [refinement] };

    const ownerResult = captureSelection(document, document.views[0].id, { elementIds: [owner.id], noteIds: [] });
    expect(ownerResult.ok).toBe(true);
    if (ownerResult.ok) {
      expect(ownerResult.preview.includedElementIds).toContain(member.id);
      expect(ownerResult.preview.requiredRefinementIds).toEqual([refinement.id]);
    }

    const memberResult = captureSelection(document, document.views[0].id, { elementIds: [member.id], noteIds: [] });
    expect(memberResult.ok).toBe(false);
    if (!memberResult.ok) expect(memberResult.issues[0].message).toContain('internal refinement member');
  });

  it('includes whole groups and attached notes while previewing partial groups and mixed notes', () => {
    const base = fixture('s05');
    const [first, second, external] = base.elements;
    const view = {
      ...base.views[0],
      groups: [
        { id: '00000000-0000-4000-8000-000000000010', label: 'Whole', elementIds: [first.id, second.id], collapsed: false },
        { id: '00000000-0000-4000-8000-000000000011', label: 'Partial', elementIds: [first.id, external.id], collapsed: false },
      ],
      notes: [
        { id: '00000000-0000-4000-8000-000000000012', text: 'Attached', x: -20, y: -10, width: 180, tone: 'paper' as const, attachedElementIds: [first.id, second.id] },
        { id: '00000000-0000-4000-8000-000000000013', text: 'Mixed', x: 40, y: 40, width: 180, tone: 'neutral' as const, attachedElementIds: [first.id, external.id] },
      ],
    };
    const document: Document = { ...base, views: [view] };
    const result = captureSelection(document, view.id, { elementIds: [first.id, second.id], noteIds: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.includedGroupIds).toEqual([view.groups[0].id]);
    expect(result.preview.omittedPartialGroupIds).toEqual([view.groups[1].id]);
    expect(result.preview.includedNoteIds).toEqual([view.notes[0].id]);
    expect(result.preview.excludedNoteIds).toEqual([view.notes[1].id]);
    expect(result.content.view.notes[0].x).toBe(-20);
  });

  it('blocks deployed-on crossings', () => {
    const document = fixture('s04');
    const relation = document.relations.find((entry) => entry.kind === 'deployed-on')!;
    const result = captureSelection(document, document.views[0].id, { elementIds: [relation.elementId], noteIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((entry) => entry.message.includes('deployed-on'))).toBe(true);
  });

  it('rejects more than 50 captured elements without trimming', () => {
    const base = fixture('s03');
    const prototype = base.elements[0];
    const makeId = (n: number): Id => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    const elements = Array.from({ length: 51 }, (_, index) => ({ ...prototype, id: makeId(index + 1) }));
    const placements = elements.map((element, index) => ({
      id: makeId(index + 100), elementId: element.id, x: index * 10, y: 0, width: 180, expanded: false,
    }));
    const document: Document = {
      ...base,
      elements,
      connections: [],
      relations: [],
      refinements: [],
      views: [{ ...base.views[0], placements, connectionIds: [], relationIds: [], groups: [], notes: [] }],
    };
    const result = captureSelection(document, document.views[0].id, { elementIds: elements.map((element) => element.id), noteIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toContain('Select a smaller set');
  });

  it('rejects canonical part content over 512 KiB without mutating or trimming it', () => {
    const base = fixture('s03');
    const element = base.elements[0];
    const makeId = (n: number): Id => `20000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    const notes = Array.from({ length: 50 }, (_, index) => ({
      id: makeId(index + 1),
      text: '🧱'.repeat(4000),
      x: index,
      y: -index,
      width: 180,
      tone: 'paper' as const,
      attachedElementIds: [element.id],
    }));
    const document: Document = {
      ...base,
      views: [{ ...base.views[0], notes }],
    };
    expect(validateDocument(document)).toMatchObject({ ok: true });

    const result = captureSelection(document, document.views[0].id, { elementIds: [element.id], noteIds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'too-large', message: expect.stringContaining('512 KiB') }),
      ]));
    }
    expect(document.views[0].notes).toHaveLength(50);
  });
});

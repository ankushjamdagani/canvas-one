import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeDocuments } from './merge';
import { resolveConflict, ConflictResolutionError } from './resolve';
import type { Element, Connection } from '../studio/model';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

function cloneDoc(doc: any): any {
  return JSON.parse(JSON.stringify(doc));
}

describe('resolveConflict: resolving merge conflicts and re-validating', () => {
  it('resolving "ours" keeps the ours value and clears the conflict', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    ours.elements[0].label = 'Ours Label';
    theirs.elements[0].label = 'Theirs Label';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    expect(mergeRes.conflicts).toHaveLength(1);
    const conflictId = mergeRes.conflicts[0].id;

    const resolved = await resolveConflict(mergeRes, conflictId, { kind: 'ours' });
    expect(resolved.conflicts).toHaveLength(0);
    expect(resolved.document.elements[0].label).toBe('Ours Label');
  });

  it('resolving "theirs" updates the document with theirs value and clears the conflict', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    ours.elements[0].label = 'Ours Label';
    theirs.elements[0].label = 'Theirs Label';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    expect(mergeRes.conflicts).toHaveLength(1);
    const conflictId = mergeRes.conflicts[0].id;

    const resolved = await resolveConflict(mergeRes, conflictId, { kind: 'theirs' });
    expect(resolved.conflicts).toHaveLength(0);
    expect(resolved.document.elements[0].label).toBe('Theirs Label');
  });

  it('resolving "edited" with a record replaces the whole record and clears all conflicts owned by it', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    const elemId = base.elements[0].id;
    // Introduce multiple conflicts on the same element
    ours.elements[0].label = 'Ours Label';
    theirs.elements[0].label = 'Theirs Label';

    ours.elements[0].description = 'Ours Desc';
    theirs.elements[0].description = 'Theirs Desc';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const elemConflicts = mergeRes.conflicts.filter((c) => c.recordId === elemId);
    expect(elemConflicts.length).toBeGreaterThanOrEqual(2);

    const replacementRecord: Element = {
      ...base.elements[0],
      label: 'Manually Resolved Label',
      description: 'Manually Resolved Desc',
    };

    const resolved = await resolveConflict(mergeRes, elemConflicts[0].id, {
      kind: 'edited',
      record: replacementRecord,
    });

    // ALL conflicts owned by that record should be cleared
    expect(resolved.conflicts.filter((c) => c.recordId === elemId)).toHaveLength(0);
    const resolvedElem = resolved.document.elements.find((e) => e.id === elemId);
    expect(resolvedElem!.label).toBe('Manually Resolved Label');
    expect(resolvedElem!.description).toBe('Manually Resolved Desc');
  });

  it('resolving "edited" with null deletes the owning record and clears all its conflicts', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    const elemId = base.elements[0].id;
    ours.elements[0].label = 'Ours Label';
    theirs.elements[0].label = 'Theirs Label';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const conflict = mergeRes.conflicts.find((c) => c.recordId === elemId)!;

    const resolved = await resolveConflict(mergeRes, conflict.id, {
      kind: 'edited',
      record: null,
    });

    expect(resolved.conflicts.filter((c) => c.recordId === elemId)).toHaveLength(0);
    expect(resolved.document.elements.some((e) => e.id === elemId)).toBe(false);
  });

  it('resolving reference conflict yields a validating document', async () => {
    const base = loadFixture('s01.json');
    const extraElemId = '00000000-0000-5000-8000-000000000055';
    const extraPortId = '00000000-0000-5000-8000-000000000056';
    const extraElem: Element = {
      id: extraElemId,
      label: 'Extra Host',
      description: 'Desc',
      visualKind: 'host',
      ports: [
        {
          id: extraPortId,
          label: 'p',
          direction: 'in',
          channel: 'data',
          schemaId: base.schemas[0].id,
          responseSchemaId: null,
        },
      ],
      behavior: { kind: 'host', version: 1 },
    };
    base.elements.push(extraElem);

    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    // Ours deletes the extra element
    ours.elements = ours.elements.filter((e: any) => e.id !== extraElemId);

    // Theirs adds connection targeting that extra element
    const newConnId = '00000000-0000-5000-8000-000000000044';
    const newConn: Connection = {
      id: newConnId,
      kind: 'data',
      source: {
        elementId: base.elements[1].id,
        portId: base.elements[1].ports[0].id,
      },
      target: {
        elementId: extraElemId,
        portId: extraPortId,
      },
      config: {},
    };
    theirs.connections.push(newConn);

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const refConflict = mergeRes.conflicts.find((c) => c.kind === 'reference');
    expect(refConflict).toBeDefined();

    // Resolve by deleting the connection (edited with null)
    const resolved = await resolveConflict(mergeRes, refConflict!.id, {
      kind: 'edited',
      record: null,
    });

    expect(resolved.conflicts).toHaveLength(0);
    expect(resolved.issues).toHaveLength(0);
    expect(resolved.document.connections.some((c) => c.id === newConnId)).toBe(false);
  });

  it('throws ConflictResolutionError for unknown conflict ID', async () => {
    const base = loadFixture('s01.json');
    const mergeRes = await mergeDocuments(base, base, base);

    await expect(
      resolveConflict(mergeRes, '00000000-0000-5000-8000-000000000999', { kind: 'ours' }),
    ).rejects.toThrow(ConflictResolutionError);
  });

  it('returns deep-frozen state without mutating inputs', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    ours.elements[0].label = 'Ours';
    theirs.elements[0].label = 'Theirs';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const conflictId = mergeRes.conflicts[0].id;

    const originalTitle = mergeRes.document.title;
    const resolved = await resolveConflict(mergeRes, conflictId, { kind: 'theirs' });

    // Inputs not mutated
    expect(mergeRes.document.title).toBe(originalTitle);
    expect(mergeRes.conflicts).toHaveLength(1);

    // Results are frozen
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.document)).toBe(true);
    expect(Object.isFrozen(resolved.conflicts)).toBe(true);
  });

  it('Item 1: throws ConflictResolutionError(invalid-resolution) when resolving document conflict with edited', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);
    ours.title = 'Title Ours';
    theirs.title = 'Title Theirs';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const titleConflict = mergeRes.conflicts.find((c) => c.recordKind === 'document')!;

    await expect(
      resolveConflict(mergeRes, titleConflict.id, {
        kind: 'edited',
        record: null,
      }),
    ).rejects.toMatchObject({
      name: 'ConflictResolutionError',
      code: 'invalid-resolution',
    });
  });

  it('Item 1: throws ConflictResolutionError(invalid-resolution) when edited record id differs from conflict recordId', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);
    ours.elements[0].label = 'Label Ours';
    theirs.elements[0].label = 'Label Theirs';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const conflict = mergeRes.conflicts[0];

    await expect(
      resolveConflict(mergeRes, conflict.id, {
        kind: 'edited',
        record: { ...base.elements[0], id: '00000000-0000-5000-8000-000000009999' },
      }),
    ).rejects.toMatchObject({
      name: 'ConflictResolutionError',
      code: 'invalid-resolution',
    });
  });

  it('Item 1: throws ConflictResolutionError(invalid-resolution) when edited record is not of conflict recordKind', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);
    ours.elements[0].label = 'Label Ours';
    theirs.elements[0].label = 'Label Theirs';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const conflict = mergeRes.conflicts[0];

    const wrongKindRecord = {
      id: conflict.recordId,
      label: 'Fake Conn',
      kind: 'data',
      source: { elementId: base.elements[1].id, portId: base.elements[1].ports[0].id },
      target: { elementId: base.elements[1].id, portId: base.elements[1].ports[0].id },
      config: {},
    };

    await expect(
      resolveConflict(mergeRes, conflict.id, {
        kind: 'edited',
        record: wrongKindRecord as any,
      }),
    ).rejects.toMatchObject({
      name: 'ConflictResolutionError',
      code: 'invalid-resolution',
    });
  });

  it('Item 1: throws ConflictResolutionError(invalid-resolution) when applySideAtConflictPath cannot resolve path', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);
    ours.elements[0].label = 'Label Ours';
    theirs.elements[0].label = 'Label Theirs';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const corruptMergeRes = {
      ...mergeRes,
      conflicts: [
        {
          ...mergeRes.conflicts[0],
          path: ['nonexistentSegment', 'deep'],
        },
      ],
    };

    await expect(
      resolveConflict(corruptMergeRes, corruptMergeRes.conflicts[0].id, { kind: 'ours' }),
    ).rejects.toMatchObject({
      name: 'ConflictResolutionError',
      code: 'invalid-resolution',
    });
  });

  it('Item 2: throws assertDocumentKeysClassified error when edited record introduces unclassified keys', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);
    ours.elements[0].label = 'Label Ours';
    theirs.elements[0].label = 'Label Theirs';

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const conflict = mergeRes.conflicts[0];

    const editedElem = {
      ...base.elements[0],
      unclassifiedFieldXYZ: 'forbidden',
    };

    await expect(
      resolveConflict(mergeRes, conflict.id, {
        kind: 'edited',
        record: editedElem as any,
      }),
    ).rejects.toThrow(/unclassified field 'unclassifiedFieldXYZ'/);
  });

  it('Item 4: resolving reference conflict ours removes C; resolving theirs keeps C and recomputed conflict stays; then edited null removes C', async () => {
    const base = loadFixture('s01.json');
    const elemA = base.elements[0];
    const elemE: Element = {
      id: '00000000-0000-5000-8000-000000000088',
      label: 'Element E',
      description: 'Desc',
      visualKind: 'host',
      ports: [
        {
          id: '00000000-0000-5000-8000-000000000089',
          label: 'portE',
          direction: 'in',
          channel: 'data',
          schemaId: base.schemas[0].id,
          responseSchemaId: null,
        },
      ],
      behavior: { kind: 'host', version: 1 },
    };
    base.elements.push(elemE);

    const ours = cloneDoc(base);
    ours.elements = ours.elements.filter((e: any) => e.id !== elemE.id);

    const theirs = cloneDoc(base);
    const connC: Connection = {
      id: '00000000-0000-5000-8000-000000000099',
      kind: 'data',
      source: { elementId: elemA.id, portId: elemA.ports[0].id },
      target: { elementId: elemE.id, portId: elemE.ports[0].id },
      config: {},
    };
    // C is not first in the collection
    theirs.connections.push(connC);
    // Different collection orders on each side
    ours.connections.reverse();

    const mergeRes = await mergeDocuments(base, ours, theirs);
    const refConflict = mergeRes.conflicts.find((c) => c.kind === 'reference')!;
    expect(refConflict).toBeDefined();
    expect(refConflict.recordKind).toBe('connection');
    expect(refConflict.recordId).toBe(connC.id);
    expect(refConflict.base).toEqual({ present: false, value: null });
    expect(refConflict.ours).toEqual({ present: false, value: null });
    expect(refConflict.theirs).toEqual({ present: true, value: connC });

    // 1. Resolving 'ours' removes C and leaves a valid document with no conflicts
    const resOurs = await resolveConflict(mergeRes, refConflict.id, { kind: 'ours' });
    expect(resOurs.conflicts).toHaveLength(0);
    expect(resOurs.issues).toHaveLength(0);
    expect(resOurs.document.connections.some((c) => c.id === connC.id)).toBe(false);

    // 2. Resolving 'theirs' keeps C and the reference conflict stays (E is still gone)
    const resTheirs = await resolveConflict(mergeRes, refConflict.id, { kind: 'theirs' });
    expect(resTheirs.document.connections.some((c) => c.id === connC.id)).toBe(true);
    const stayRefConflict = resTheirs.conflicts.find((c) => c.kind === 'reference');
    expect(stayRefConflict).toBeDefined();
    expect(stayRefConflict!.recordId).toBe(connC.id);

    // 3. Resolving it with edited null removes C
    const resEdited = await resolveConflict(resTheirs, stayRefConflict!.id, {
      kind: 'edited',
      record: null,
    });
    expect(resEdited.conflicts).toHaveLength(0);
    expect(resEdited.issues).toHaveLength(0);
    expect(resEdited.document.connections.some((c) => c.id === connC.id)).toBe(false);
  });
});

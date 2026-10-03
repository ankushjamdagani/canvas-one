import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeDocuments, generateConflictId, convertIssuePathToIdPath } from './merge';
import type { Element, Connection } from '../studio/model';
import { UUID_REGEX } from '../../persistence/studio/primitives';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

function cloneDoc(doc: any): any {
  return JSON.parse(JSON.stringify(doc));
}

describe('mergeDocuments: typed three-way merge', () => {
  it('S01-S05 each merge with themselves to zero conflicts', async () => {
    const fixtureFiles = ['s01.json', 's02.json', 's03.json', 's04.json', 's05.json'];
    for (const file of fixtureFiles) {
      const doc = loadFixture(file);
      const res = await mergeDocuments(doc, doc, doc);
      expect(res.conflicts).toHaveLength(0);
      expect(res.issues).toHaveLength(0);
      expect(res.document.id).toBe(doc.id);
    }
  });

  it('unchanged: base, ours, theirs identical produces zero conflicts', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    const res = await mergeDocuments(base, ours, theirs);
    expect(res.conflicts).toHaveLength(0);
    expect(res.issues).toHaveLength(0);
    expect(res.document.title).toBe(base.title);
  });

  it('identical changes on both sides coalesce without conflict', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    ours.title = 'New Merged Title';
    theirs.title = 'New Merged Title';

    ours.elements[0].label = 'Shared New Label';
    theirs.elements[0].label = 'Shared New Label';

    const res = await mergeDocuments(base, ours, theirs);
    expect(res.conflicts).toHaveLength(0);
    expect(res.document.title).toBe('New Merged Title');
    expect(res.document.elements[0].label).toBe('Shared New Label');
  });

  it('disjoint fields of the same record merge cleanly', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    // Ours modifies label; theirs modifies description
    ours.elements[0].label = 'Ours Changed Label';
    theirs.elements[0].description = 'Theirs Changed Description';

    const res = await mergeDocuments(base, ours, theirs);
    expect(res.conflicts).toHaveLength(0);
    expect(res.document.elements[0].label).toBe('Ours Changed Label');
    expect(res.document.elements[0].description).toBe('Theirs Changed Description');
  });

  it('competing scalars conflict and hold the OURS value', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    ours.elements[0].label = 'Ours Label';
    theirs.elements[0].label = 'Theirs Label';

    const res = await mergeDocuments(base, ours, theirs);
    expect(res.conflicts).toHaveLength(1);

    const conflict = res.conflicts[0];
    expect(conflict.kind).toBe('value');
    expect(conflict.recordKind).toBe('element');
    expect(conflict.recordId).toBe(base.elements[0].id);
    expect(conflict.path).toEqual(['label']);
    expect(conflict.base).toEqual({ present: true, value: base.elements[0].label });
    expect(conflict.ours).toEqual({ present: true, value: 'Ours Label' });
    expect(conflict.theirs).toEqual({ present: true, value: 'Theirs Label' });

    // Working document holds OURS value
    expect(res.document.elements[0].label).toBe('Ours Label');
  });

  it('delete vs edit both directions on top-level records', async () => {
    const base = loadFixture('s01.json');
    const elem0Id = base.elements[0].id;
    const elem1Id = base.elements[1].id;

    // Direction 1: Ours deletes elem0; theirs edits elem0 label
    const ours1 = cloneDoc(base);
    const theirs1 = cloneDoc(base);
    ours1.elements = ours1.elements.filter((e: any) => e.id !== elem0Id);
    theirs1.elements[0].label = 'Theirs Edited';

    const res1 = await mergeDocuments(base, ours1, theirs1);
    const c1 = res1.conflicts.find((c) => c.recordId === elem0Id);
    expect(c1).toBeDefined();
    expect(c1!.kind).toBe('delete-edit');
    expect(c1!.ours.present).toBe(false);
    expect(c1!.theirs.present).toBe(true);
    // Working document holds OURS value -> elem0 is absent
    expect(res1.document.elements.some((e: any) => e.id === elem0Id)).toBe(false);

    // Direction 2: Ours edits elem1 label; theirs deletes elem1
    const ours2 = cloneDoc(base);
    const theirs2 = cloneDoc(base);
    ours2.elements[1].label = 'Ours Edited';
    theirs2.elements = theirs2.elements.filter((e: any) => e.id !== elem1Id);

    const res2 = await mergeDocuments(base, ours2, theirs2);
    const c2 = res2.conflicts.find((c) => c.recordId === elem1Id);
    expect(c2).toBeDefined();
    expect(c2!.kind).toBe('delete-edit');
    expect(c2!.ours.present).toBe(true);
    expect(c2!.theirs.present).toBe(false);
    // Working document holds OURS value -> elem1 is present with Ours Edited
    const kept = res2.document.elements.find((e) => e.id === elem1Id);
    expect(kept).toBeDefined();
    expect(kept!.label).toBe('Ours Edited');
  });

  it('delete vs edit both directions on nested members (port and placement)', async () => {
    const base = loadFixture('s01.json');
    const elemId = base.elements[0].id;
    const port0 = base.elements[0].ports[0];
    expect(port0).toBeDefined();

    // Direction 1: Ours deletes port; theirs edits port label
    const ours1 = cloneDoc(base);
    const theirs1 = cloneDoc(base);
    ours1.elements[0].ports = ours1.elements[0].ports.slice(1);
    theirs1.elements[0].ports[0].label = 'Theirs Edited Port';

    const res1 = await mergeDocuments(base, ours1, theirs1);
    const c1 = res1.conflicts.find(
      (c) => c.recordId === elemId && c.path.includes(port0.id),
    );
    expect(c1).toBeDefined();
    expect(c1!.kind).toBe('delete-edit');
    expect(c1!.ours.present).toBe(false);
    expect(c1!.theirs.present).toBe(true);
    // Working doc holds ours value -> port is absent
    expect(res1.document.elements[0].ports.some((p) => p.id === port0.id)).toBe(false);

    // Direction 2: Ours edits placement x; theirs deletes placement
    const viewId = base.views[0].id;
    const placement0 = base.views[0].placements[0];
    const ours2 = cloneDoc(base);
    const theirs2 = cloneDoc(base);
    ours2.views[0].placements[0].x = 999;
    theirs2.views[0].placements = theirs2.views[0].placements.slice(1);

    const res2 = await mergeDocuments(base, ours2, theirs2);
    const c2 = res2.conflicts.find(
      (c) => c.recordId === viewId && c.path.includes(placement0.id),
    );
    expect(c2).toBeDefined();
    expect(c2!.kind).toBe('delete-edit');
    expect(c2!.ours.present).toBe(true);
    expect(c2!.theirs.present).toBe(false);
    // Working doc holds ours value -> placement is present with x = 999
    const keptPlacement = res2.document.views[0].placements.find(
      (p) => p.id === placement0.id,
    );
    expect(keptPlacement).toBeDefined();
    expect(keptPlacement!.x).toBe(999);
  });

  it('add/add same content coalesces; add/add different content conflicts', async () => {
    const base = loadFixture('s01.json');
    const newId = '00000000-0000-5000-8000-000000000088';

    // Same content addition
    const newElemSame1: Element = {
      id: newId,
      label: 'Added Identical Element',
      description: 'Desc',
      visualKind: 'custom',
      ports: [],
      behavior: { kind: 'host', version: 1 },
    };
    const newElemSame2: Element = cloneDoc(newElemSame1 as any) as any;

    const ours1 = cloneDoc(base);
    const theirs1 = cloneDoc(base);
    ours1.elements.push(newElemSame1);
    theirs1.elements.push(newElemSame2);

    const res1 = await mergeDocuments(base, ours1, theirs1);
    expect(res1.conflicts.filter((c) => c.recordId === newId)).toHaveLength(0);
    expect(res1.document.elements.some((e) => e.id === newId)).toBe(true);

    // Different content addition
    const newElemDiffOurs: Element = {
      ...newElemSame1,
      label: 'Ours Version of Add',
    };
    const newElemDiffTheirs: Element = {
      ...newElemSame1,
      label: 'Theirs Version of Add',
    };

    const ours2 = cloneDoc(base);
    const theirs2 = cloneDoc(base);
    ours2.elements.push(newElemDiffOurs);
    theirs2.elements.push(newElemDiffTheirs);

    const res2 = await mergeDocuments(base, ours2, theirs2);
    const cAdd = res2.conflicts.find((c) => c.recordId === newId);
    expect(cAdd).toBeDefined();
    expect(cAdd!.kind).toBe('add-add');
    expect(cAdd!.base.present).toBe(false);
    expect(cAdd!.ours.present).toBe(true);
    expect(cAdd!.theirs.present).toBe(true);
    // Working document holds OURS value
    const kept = res2.document.elements.find((e) => e.id === newId);
    expect(kept!.label).toBe('Ours Version of Add');
  });

  it('union kind change conflicts when other side modifies inside it', async () => {
    const base = loadFixture('s01.json');
    const machineElem = base.elements.find((e: any) => e.behavior.kind === 'machine')!;

    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    // Ours changes behavior kind to 'host'
    const elemOurs = ours.elements.find((e: any) => e.id === machineElem.id)!;
    elemOurs.behavior = { kind: 'host', version: 1 };

    // Theirs edits transitions within machine behavior
    const elemTheirs = theirs.elements.find((e: any) => e.id === machineElem.id)!;
    if (elemTheirs.behavior.kind === 'machine') {
      elemTheirs.behavior.initialStateId = 'different-state-id';
    }

    const res = await mergeDocuments(base, ours, theirs);
    const conflict = res.conflicts.find(
      (c) => c.recordId === machineElem.id && c.kind === 'kind',
    );
    expect(conflict).toBeDefined();
    expect(conflict!.kind).toBe('kind');
    // Working document holds OURS value
    const mergedElem = res.document.elements.find((e: any) => e.id === machineElem.id)!;
    expect(mergedElem.behavior.kind).toBe('host');
  });

  it('union kind change applies one-sided when other side makes no changes', async () => {
    const base = loadFixture('s01.json');
    const machineElem = base.elements.find((e: any) => e.behavior.kind === 'machine')!;

    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    // Theirs changes behavior kind to 'host', ours made NO changes
    const elemTheirs = theirs.elements.find((e: any) => e.id === machineElem.id)!;
    elemTheirs.behavior = { kind: 'host', version: 1 };

    const res = await mergeDocuments(base, ours, theirs);
    expect(res.conflicts).toHaveLength(0);
    const mergedElem = res.document.elements.find((e) => e.id === machineElem.id)!;
    expect(mergedElem.behavior.kind).toBe('host');
  });

  it('atomic ordered lists (transitions, inputs) changed on both sides conflicts whole, one-sided applies', async () => {
    const base = loadFixture('s01.json');
    const scenarioId = base.scenarios[0].id;
    const initialInputs = base.scenarios[0].inputs;

    // One-sided change to inputs applies cleanly
    const ours1 = cloneDoc(base);
    const theirs1 = cloneDoc(base);
    theirs1.scenarios[0].inputs = [
      ...initialInputs,
      {
        id: '00000000-0000-5000-8000-000000000077',
        entry: initialInputs[0].entry,
        fixtureId: initialInputs[0].fixtureId,
        journeyId: initialInputs[0].journeyId,
        atMs: null,
        payloadBindings: [],
        resource: null,
      },
    ];

    const res1 = await mergeDocuments(base, ours1, theirs1);
    expect(res1.conflicts).toHaveLength(0);
    expect(res1.document.scenarios[0].inputs).toHaveLength(initialInputs.length + 1);

    // Both sides change inputs differently -> whole field conflicts
    const ours2 = cloneDoc(base);
    const theirs2 = cloneDoc(base);

    ours2.scenarios[0].inputs = [];
    theirs2.scenarios[0].inputs = [
      ...initialInputs,
      {
        id: '00000000-0000-5000-8000-000000000066',
        entry: initialInputs[0].entry,
        fixtureId: initialInputs[0].fixtureId,
        journeyId: initialInputs[0].journeyId,
        atMs: null,
        payloadBindings: [],
        resource: null,
      },
    ];

    const res2 = await mergeDocuments(base, ours2, theirs2);
    const cInputs = res2.conflicts.find(
      (c) => c.recordId === scenarioId && c.path.includes('inputs'),
    );
    expect(cInputs).toBeDefined();
    expect(cInputs!.kind).toBe('atomic');
    // Working document holds OURS value
    expect(res2.document.scenarios[0].inputs).toEqual(ours2.scenarios[0].inputs);
  });

  it('set add/remove both sides respects order and avoids duplicates', async () => {
    const base = loadFixture('s02.json');
    // Use valid connection IDs so validateDocument does not flag dangling references
    expect(base.connections.length).toBeGreaterThanOrEqual(3);
    const conn0 = base.connections[0].id;
    const conn1 = base.connections[1].id;
    const conn2 = base.connections[2].id;

    // Start with view having only conn0
    base.views[0].connectionIds = [conn0];

    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    // Ours adds conn1
    ours.views[0].connectionIds = [conn0, conn1];
    // Theirs removes conn0 and adds conn2
    theirs.views[0].connectionIds = [conn2];

    const res = await mergeDocuments(base, ours, theirs);
    expect(res.conflicts).toHaveLength(0);

    const mergedConnIds = res.document.views[0].connectionIds;
    // conn0 was removed by theirs
    expect(mergedConnIds).not.toContain(conn0);
    // conn1 and conn2 should be in result
    expect(mergedConnIds).toContain(conn1);
    expect(mergedConnIds).toContain(conn2);
    // Order: ours order, then theirs-only additions
    const indexOurs = mergedConnIds.indexOf(conn1);
    const indexTheirs = mergedConnIds.indexOf(conn2);
    expect(indexOurs).toBeLessThan(indexTheirs);
    // No duplicates
    expect(new Set(mergedConnIds).size).toBe(mergedConnIds.length);
  });

  it('broken reference creates a reference conflict owned by the referencing record', async () => {
    const base = loadFixture('s01.json');
    const elemToDelete = base.elements[0].id;

    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    // Ours deletes element
    ours.elements = ours.elements.filter((e: any) => e.id !== elemToDelete);

    // Theirs adds a new connection targeting the deleted element
    const newConnId = '00000000-0000-5000-8000-000000000044';
    const newConn: Connection = {
      id: newConnId,
      kind: 'data',
      source: {
        elementId: base.elements[1].id,
        portId: base.elements[1].ports[0].id,
      },
      target: {
        elementId: elemToDelete,
        portId: base.elements[0].ports[0].id,
      },
      config: {},
    };
    theirs.connections.push(newConn);

    const res = await mergeDocuments(base, ours, theirs);

    const refConflict = res.conflicts.find((c) => c.kind === 'reference');
    expect(refConflict).toBeDefined();
    expect(refConflict!.recordKind).toBe('connection');
    expect(refConflict!.recordId).toBe(newConnId);
    expect(refConflict!.path).toEqual(['target', 'elementId']);
  });

  it('scenario revision rule derives revision correctly', async () => {
    const base = loadFixture('s01.json');
    const scenId = base.scenarios[0].id;
    base.scenarios[0].revision = 5;

    // Case 1: identical to ours content -> ours.revision
    const ours1 = cloneDoc(base);
    const theirs1 = cloneDoc(base);
    ours1.scenarios[0].revision = 10;
    theirs1.scenarios[0].revision = 5;
    // No other changes to scenario
    const res1 = await mergeDocuments(base, ours1, theirs1);
    expect(res1.document.scenarios.find((s) => s.id === scenId)!.revision).toBe(10);

    // Case 2: identical to theirs content -> theirs.revision
    const ours2 = cloneDoc(base);
    const theirs2 = cloneDoc(base);
    ours2.scenarios[0].revision = 5;
    theirs2.scenarios[0].revision = 12;
    // Theirs edits label
    theirs2.scenarios[0].label = 'Updated Label by Theirs';
    const res2 = await mergeDocuments(base, ours2, theirs2);
    expect(res2.document.scenarios.find((s) => s.id === scenId)!.revision).toBe(12);

    // Case 3: content modified on both sides -> max(base, ours, theirs) + 1
    const ours3 = cloneDoc(base);
    const theirs3 = cloneDoc(base);
    ours3.scenarios[0].revision = 8;
    theirs3.scenarios[0].revision = 15;
    ours3.scenarios[0].label = 'Label A';
    theirs3.scenarios[0].seed = 999;
    const res3 = await mergeDocuments(base, ours3, theirs3);
    expect(res3.document.scenarios.find((s) => s.id === scenId)!.revision).toBe(16);
  });

  it('conflict IDs are stable across multiple runs and valid UUIDs satisfying UUID_REGEX', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    ours.elements[0].label = 'Conflicting Label A';
    theirs.elements[0].label = 'Conflicting Label B';

    const res1 = await mergeDocuments(base, ours, theirs);
    const res2 = await mergeDocuments(base, ours, theirs);

    expect(res1.conflicts).toHaveLength(1);
    expect(res2.conflicts).toHaveLength(1);

    const c1 = res1.conflicts[0];
    const c2 = res2.conflicts[0];

    expect(c1.id).toBe(c2.id);
    expect(c1.id).toMatch(UUID_REGEX);
  });

  it('fails with an issue when schema or id do not match across documents', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    theirs.id = '00000000-0000-5000-8000-999999999999';

    const res = await mergeDocuments(base, ours, theirs);
    expect(res.conflicts).toHaveLength(0);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0].code).toBe('structural-rule');
    expect(res.issues[0].message).toContain('Cannot merge across different documents');
  });

  it('Item 1: throws error naming the path when canonicalJson fails in generateConflictId', async () => {
    await expect(
      generateConflictId('element', '00000000-0000-5000-8000-000000000001', [1n as any, 'bad'], 'value'),
    ).rejects.toThrow(/canonicalJson failed for path '1.bad'/);
  });

  it('Item 2: mergeDocuments throws when base, ours, or theirs has unclassified keys', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);
    (theirs as any).unclassifiedProperty = 'bad';

    await expect(mergeDocuments(base, ours, theirs)).rejects.toThrow(
      /unclassified field 'unclassifiedProperty' on Document record/,
    );
  });

  it('Item 2: mergeObject does not write key: undefined for fields absent from the result', async () => {
    const base = loadFixture('s01.json');
    const ours = cloneDoc(base);
    const theirs = cloneDoc(base);

    delete (base.elements[0] as any).description;
    delete (ours.elements[0] as any).description;
    delete (theirs.elements[0] as any).description;

    const res = await mergeDocuments(base, ours, theirs);
    const mergedElem = res.document.elements[0];
    expect('description' in mergedElem).toBe(false);
  });

  it('Item 3: scenario revision: base rev 3, ours edits label rev 4, theirs edits seed rev 7 -> no conflict, merged revision 8', async () => {
    const base = loadFixture('s01.json');
    base.scenarios[0].revision = 3;

    const ours = cloneDoc(base);
    ours.scenarios[0].revision = 4;
    ours.scenarios[0].label = 'Ours Edited Scenario Label';

    const theirs = cloneDoc(base);
    theirs.scenarios[0].revision = 7;
    theirs.scenarios[0].seed = 88888;

    const res = await mergeDocuments(base, ours, theirs);
    expect(res.conflicts).toHaveLength(0);
    const mergedScen = res.document.scenarios.find((s) => s.id === base.scenarios[0].id)!;
    expect(mergedScen.label).toBe('Ours Edited Scenario Label');
    expect(mergedScen.seed).toBe(88888);
    expect(mergedScen.revision).toBe(8);
  });

  it('Item 4: ours deletes element E while theirs adds connection C to E, with C not first in collection and different collection orders -> one reference conflict with sides = whole C', async () => {
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
          channel: 'data', protocol: 'jdbc',
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
      source: {
        elementId: elemA.id,
        portId: elemA.ports[0].id,
      },
      target: {
        elementId: elemE.id,
        portId: elemE.ports[0].id,
      },
      config: {},
    };
    // C is not first in the collection
    theirs.connections.push(connC);
    // Different collection orders on each side
    ours.connections.reverse();

    const res = await mergeDocuments(base, ours, theirs);
    const refConflicts = res.conflicts.filter((c) => c.kind === 'reference');
    expect(refConflicts).toHaveLength(1);
    const cConflict = refConflicts[0];
    expect(cConflict.recordKind).toBe('connection');
    expect(cConflict.recordId).toBe(connC.id);
    expect(cConflict.base).toEqual({ present: false, value: null });
    expect(cConflict.ours).toEqual({ present: false, value: null });
    expect(cConflict.theirs).toEqual({ present: true, value: connC });
  });

  it('Item 4: convertIssuePathToIdPath converts numeric index of keyed array to member ID', () => {
    const doc = loadFixture('s01.json');
    const view = doc.views[0];
    const placement = view.placements[0];
    const idPath = convertIssuePathToIdPath(view, 'view', ['placements', 0, 'elementId']);
    expect(idPath).toEqual(['placements', placement.id, 'elementId']);
  });

  it('Item 5: mergeDocuments deep-freezes its result and inputs', async () => {
    const base = loadFixture('s01.json');
    const res = await mergeDocuments(base, base, base);
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.document)).toBe(true);
    expect(Object.isFrozen(res.conflicts)).toBe(true);
    expect(Object.isFrozen(res.inputs)).toBe(true);
    expect(Object.isFrozen(res.inputs.base)).toBe(true);
    expect(Object.isFrozen(res.inputs.ours)).toBe(true);
    expect(Object.isFrozen(res.inputs.theirs)).toBe(true);
  });
});

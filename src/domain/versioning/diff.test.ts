import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffDocuments } from './diff';
import type { Element } from '../studio/model';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');

function loadFixture(name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

function cloneDoc(doc: any): any {
  return JSON.parse(JSON.stringify(doc));
}

describe('diffDocuments: deterministic per-record changes', () => {
  it('returns empty array when comparing identical documents', () => {
    const docA = loadFixture('s01.json');
    const docB = cloneDoc(docA);
    const diffs = diffDocuments(docA, docB);
    expect(diffs).toEqual([]);
  });

  it('detects document title modification', () => {
    const docA = loadFixture('s01.json');
    const docB = cloneDoc(docA);
    docB.title = 'Updated Title';

    const diffs = diffDocuments(docA, docB);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({
      recordKind: 'document',
      id: docA.id,
      change: 'modified',
      fieldPaths: [['title']],
    });
  });

  it('detects added and removed records for RecordKinds', () => {
    const docA = loadFixture('s01.json');
    const docB = cloneDoc(docA);

    const removedElement = docA.elements[0];
    const newElement: Element = {
      id: '00000000-0000-5000-8000-000000000099',
      label: 'Brand New Element',
      description: 'Test description',
      visualKind: 'custom',
      ports: [],
      behavior: { kind: 'host', version: 1 },
    };

    docB.elements = [...docB.elements.slice(1), newElement];

    const diffs = diffDocuments(docA, docB);
    expect(diffs).toEqual(
      expect.arrayContaining([
        {
          recordKind: 'element',
          id: removedElement.id,
          change: 'removed',
          fieldPaths: [],
        },
        {
          recordKind: 'element',
          id: newElement.id,
          change: 'added',
          fieldPaths: [],
        },
      ]),
    );
  });

  it('detects scalar modifications on records', () => {
    const docA = loadFixture('s01.json');
    const docB = cloneDoc(docA);

    docB.elements[0].label = 'New Label';
    docB.elements[0].description = 'New Description';

    const diffs = diffDocuments(docA, docB);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({
      recordKind: 'element',
      id: docA.elements[0].id,
      change: 'modified',
      fieldPaths: [['description'], ['label']],
    });
  });

  it('detects nested keyed member modifications (e.g. port inside element)', () => {
    const docA = loadFixture('s01.json');
    const docB = cloneDoc(docA);

    const portId = docB.elements[0].ports[0].id;
    (docB.elements[0].ports[0] as any).label = 'Renamed Port';

    const diffs = diffDocuments(docA, docB);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({
      recordKind: 'element',
      id: docA.elements[0].id,
      change: 'modified',
      fieldPaths: [['ports', portId, 'label']],
    });
  });

  it('detects modifications on atomic lists (e.g. machine transitions)', () => {
    const docA = loadFixture('s01.json');
    const docB = cloneDoc(docA);

    // Find machine element
    const machineElemIdx = docB.elements.findIndex((e: any) => e.behavior.kind === 'machine');
    expect(machineElemIdx).toBeGreaterThanOrEqual(0);

    const machineElem = docB.elements[machineElemIdx];
    if (machineElem.behavior.kind === 'machine') {
      machineElem.behavior = {
        ...machineElem.behavior,
        transitions: machineElem.behavior.transitions.slice(1),
      };
    }

    const diffs = diffDocuments(docA, docB);
    expect(diffs).toContainEqual({
      recordKind: 'element',
      id: machineElem.id,
      change: 'modified',
      fieldPaths: [['behavior', 'transitions']],
    });
  });

  it('detects union kind change', () => {
    const docA = loadFixture('s01.json');
    const docB = cloneDoc(docA);

    // Switch behavior from machine to host
    const elem = docB.elements.find((e: any) => e.behavior.kind === 'machine')!;
    (elem as any).behavior = { kind: 'host', version: 1 };

    const diffs = diffDocuments(docA, docB);
    expect(diffs).toContainEqual({
      recordKind: 'element',
      id: elem.id,
      change: 'modified',
      fieldPaths: [['behavior', 'kind']],
    });
  });

  it('produces deterministically sorted diffs regardless of collection mutation order', () => {
    const docA = loadFixture('s01.json');
    const docB1 = cloneDoc(docA);
    const docB2 = cloneDoc(docA);

    docB1.title = 'Changed Title';
    docB1.elements[0].label = 'Changed Label';
    (docB1.connections.find((c: { kind: string }) => c.kind === 'call')!.config as { latencyMs: number }).latencyMs += 5;

    // Same changes in different order
    (docB2.connections.find((c: { kind: string }) => c.kind === 'call')!.config as { latencyMs: number }).latencyMs += 5;
    docB2.title = 'Changed Title';
    docB2.elements[0].label = 'Changed Label';

    const diffs1 = diffDocuments(docA, docB1);
    const diffs2 = diffDocuments(docA, docB2);

    expect(diffs1).toEqual(diffs2);
    // Document should be first, then element, then connection
    expect(diffs1.map((d) => d.recordKind)).toEqual(['document', 'element', 'connection']);
  });
});

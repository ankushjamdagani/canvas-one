import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDocument, ISSUE_CODES } from './validate';
import type { Issue } from './validate';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

describe('validateDocument reference fixtures', () => {
  const fixtureFiles = [
    's01.json',
    's02.json',
    's03.json',
    's04.json',
    's05.json',
    'combined.json',
  ];

  for (const file of fixtureFiles) {
    it(`validates ${file} ok with zero issues`, () => {
      const doc = loadFixture(file);
      const result = validateDocument(doc);
      if (!result.ok) {
        // If a fixture fails, print the issue list as required by spec
        console.error(`Fixture ${file} failed validation with issues:`, result.issues);
      }
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.document).toBe(doc);
      }
    });
  }
});

describe('validateDocument schema constants', () => {
  it('exports closed set of ISSUE_CODES', () => {
    expect(ISSUE_CODES).toContain('unknown-property');
    expect(ISSUE_CODES).toContain('missing-property');
    expect(ISSUE_CODES).toContain('wrong-type');
    expect(ISSUE_CODES).toContain('invalid-id');
    expect(ISSUE_CODES).toContain('duplicate-id');
    expect(ISSUE_CODES).toContain('dangling-reference');
    expect(ISSUE_CODES).toContain('wrong-reference-kind');
    expect(ISSUE_CODES).toContain('out-of-range');
    expect(ISSUE_CODES).toContain('too-many');
    expect(ISSUE_CODES).toContain('too-long');
    expect(ISSUE_CODES).toContain('too-deep');
    expect(ISSUE_CODES).toContain('invalid-literal');
    expect(ISSUE_CODES).toContain('duplicate-key');
    expect(ISSUE_CODES).toContain('prototype-key');
    expect(ISSUE_CODES).toContain('structural-rule');
  });
});

describe('validateDocument mutation tests', () => {
  const s01 = loadFixture('s01.json') as any;
  const s04 = loadFixture('s04.json') as any;

  it('detects unknown property on an element', () => {
    const doc = structuredClone(s01);
    doc.elements[0].unknownProp = 'not-allowed';
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'unknown-property',
            path: ['elements', 0, 'unknownProp'],
          }),
        ])
      );
    }
  });

  it('detects uppercase id', () => {
    const doc = structuredClone(s01);
    doc.elements[0].id = doc.elements[0].id.toUpperCase();
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid-id',
            path: ['elements', 0, 'id'],
          }),
        ])
      );
    }
  });

  it('detects duplicate id across element and nested port', () => {
    const doc = structuredClone(s01);
    doc.elements[0].ports[0].id = doc.elements[0].id;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'duplicate-id',
            path: ['elements', 0, 'ports', 0, 'id'],
          }),
        ])
      );
    }
  });

  it('detects dangling Endpoint.portId pointing at another element port', () => {
    const doc = structuredClone(s01);
    // Point connection 0 source portId to element 1 port 0 id
    doc.connections[0].source.portId = doc.elements[1].ports[0].id;
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'dangling-reference',
            path: ['connections', 0, 'source', 'portId'],
          }),
        ])
      );
    }
  });

  it('detects wrong connection kind vs port channel', () => {
    const doc = structuredClone(s01);
    doc.connections[0].kind = 'data';
    doc.connections[0].config = {};
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'structural-rule',
            path: ['connections', 0, 'kind'],
          }),
        ])
      );
    }
  });

  it('detects scalar-union with number+integer', () => {
    const doc = structuredClone(s01);
    doc.schemas[0].shape = {
      type: 'scalar-union',
      nullable: false,
      types: ['number', 'integer'],
    };
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'structural-rule',
            path: ['schemas', 0, 'shape', 'types'],
          }),
        ])
      );
    }
  });

  it('detects label of 81 code points using emoji-heavy string', () => {
    const doc = structuredClone(s01);
    // '😀' is 1 Unicode code point and 2 UTF-16 code units
    const emoji81 = '😀'.repeat(81);
    expect(emoji81.length).toBe(162);
    expect([...emoji81].length).toBe(81);
    doc.elements[0].label = emoji81;

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'too-long',
            path: ['elements', 0, 'label'],
          }),
        ])
      );
    }
  });

  it('detects __proto__ key in a fixture value constructed via JSON.parse', () => {
    const doc = structuredClone(s01);
    doc.fixtures[0].value = JSON.parse('{"__proto__": 123, "items": []}');
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'prototype-key',
            path: ['fixtures', 0, 'value', '__proto__'],
          }),
        ])
      );
    }
  });

  it('detects a 40-deep nested fixture value via raw depth check', () => {
    const doc = structuredClone(s01);
    let deep: any = { leaf: true };
    for (let i = 0; i < 40; i++) {
      deep = { nested: deep };
    }
    doc.fixtures[0].value = deep;

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'too-deep',
          }),
        ])
      );
    }
  });

  it('detects non-finite number via a value object', () => {
    const doc = structuredClone(s01);
    doc.elements[0].behavior.transitions[0].effects[1].value = {
      kind: 'literal',
      value: NaN,
    };
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'wrong-type',
            path: ['elements', 0, 'behavior', 'transitions', 0, 'effects', 1, 'value', 'value'],
          }),
        ])
      );
    }
  });

  it('detects 101 elements ceiling', () => {
    const doc = structuredClone(s01);
    while (doc.elements.length < 101) {
      const idx = doc.elements.length;
      doc.elements.push({
        id: `70000000-0000-4000-8000-${String(idx).padStart(12, '0')}`,
        label: `Element ${idx}`,
        description: '',
        visualKind: 'custom',
        ports: [],
        behavior: { kind: 'unmodeled', version: 1, reason: 'test' },
      });
    }

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'too-many',
            path: ['elements'],
          }),
        ])
      );
    }
  });

  it('detects contains cycle', () => {
    const doc = structuredClone(s01);
    const idA = doc.elements[0].id;
    const idB = doc.elements[1].id;
    doc.relations = [
      {
        id: '70000000-0000-4000-8000-0000000000a1',
        label: 'A contains B',
        kind: 'contains',
        parentId: idA,
        childId: idB,
      },
      {
        id: '70000000-0000-4000-8000-0000000000a2',
        label: 'B contains A',
        kind: 'contains',
        parentId: idB,
        childId: idA,
      },
    ];

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'structural-rule',
            path: ['relations', 1],
          }),
        ])
      );
    }
  });

  it('detects fault hostId referencing a non-host element (use s04)', () => {
    const doc = structuredClone(s04);
    // s04 elements[0] is resource "A" (not host)
    doc.scenarios[0].faults[0].hostId = doc.elements[0].id;

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'wrong-reference-kind',
            path: ['scenarios', 0, 'faults', 0, 'hostId'],
          }),
        ])
      );
    }
  });
});

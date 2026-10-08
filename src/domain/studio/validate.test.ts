import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateDocument, ISSUE_CODES } from './validate';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');

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
        // If a fixture fails, print the issue list
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
    expect(ISSUE_CODES).toContain('too-large');
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

  it('rejects document just over 2 MiB with too-large at path [] returned early', () => {
    const doc = structuredClone(s01);
    // Add many fixtures each under 16 KiB/256 KiB until > 2 MiB
    // 2 MiB = 2,097,152 bytes. 145 fixtures * 15,000 bytes = 2,175,000 bytes > 2 MiB.
    doc.fixtures = Array.from({ length: 145 }, (_, i) => ({
      id: `80000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      schemaId: s01.schemas[0].id,
      value: 'a'.repeat(15000),
    }));

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({
          code: 'too-large',
          path: [],
        }),
      ]);
    }
  });

  it('rejects a fixture value > 256 KiB with too-large', () => {
    const doc = structuredClone(s01);
    // 20 strings of 14,000 chars: each string < 16 KiB, total fixture value ~280 KiB > 256 KiB
    doc.fixtures[0].value = Array.from({ length: 20 }, () => 'a'.repeat(14000));

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'too-large',
            path: ['fixtures', 0, 'value'],
          }),
        ])
      );
    }
  });

  it('rejects a fixture string > 16 KiB with too-large', () => {
    const doc = structuredClone(s01);
    // Root fixture string value > 16 KiB (16 * 1024 + 1 bytes)
    doc.fixtures[0].value = 'a'.repeat(16 * 1024 + 1);

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'too-large',
            path: ['fixtures', 0, 'value'],
          }),
        ])
      );
    }
  });

  it('rejects a nested fixture string > 16 KiB with too-large', () => {
    const doc = structuredClone(s01);
    // Nested string value inside fixture value > 16 KiB
    doc.fixtures[0].value = { payload: 'b'.repeat(16 * 1024 + 1) };

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'too-large',
            path: ['fixtures', 0, 'value', 'payload'],
          }),
        ])
      );
    }
  });

  it('rejects aggregate fixture values > 1 MiB with too-large', () => {
    const doc = structuredClone(s01);
    // 6 fixtures of ~196 KiB each: each string < 16 KiB, each fixture < 256 KiB, total aggregate ~1.17 MiB > 1 MiB
    doc.fixtures = Array.from({ length: 6 }, (_, i) => ({
      id: `80000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      schemaId: s01.schemas[0].id,
      value: Array.from({ length: 14 }, () => 'c'.repeat(14000)),
    }));

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'too-large',
            path: ['fixtures'],
          }),
        ])
      );
    }
  });

  // Mode coherence (input atMs, completion kind, boundary delayMs/afterInputId vs
  // scenario mode) moved to readiness.ts; the storable validator only checks per-field
  // types/bounds, so mode-mismatch shapes are storable-valid.
  it('accepts a timed-mode scenario with logical-shaped fields (mode coherence is a readiness rule, not storable)', () => {
    const doc = structuredClone(s01);
    // Flip mode to 'timed' but leave every mode-coupled field in its logical shape:
    // atMs null, completion 'quiescent', boundary delayMs null / afterInputId null.
    doc.scenarios[0].mode = 'timed';
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
  });

  it('accepts a logical-mode scenario with a non-null input atMs (mode coherence is a readiness rule, not storable)', () => {
    const doc = structuredClone(s01);
    // mode stays 'logical'; atMs is a finite number >= 0, which is now a valid shape at
    // the storable level (only readiness enforces logical => atMs null).
    doc.scenarios[0].inputs[0].atMs = 500;
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
  });

  it('accepts a logical-mode scenario with a non-null boundary response delayMs and a set afterInputId (mode coherence is a readiness rule, not storable)', () => {
    const doc = structuredClone(s01);
    doc.scenarios[0].boundaries[0].responses[0].delayMs = 1000;
    doc.scenarios[0].boundaries[0].responses[0].afterInputId = doc.scenarios[0].inputs[0].id;
    const result = validateDocument(doc);
    expect(result.ok).toBe(true);
  });

  it('still rejects an out-of-range boundary response delayMs regardless of mode (per-field bound kept)', () => {
    const doc = structuredClone(s01);
    doc.scenarios[0].boundaries[0].responses[0].delayMs = 700000; // > 600000ms max
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['scenarios', 0, 'boundaries', 0, 'responses', 0, 'delayMs'],
          }),
        ])
      );
    }
  });

  it('still rejects a boundary response afterInputId that does not reference an input in this scenario (per-field reference kept)', () => {
    const doc = structuredClone(s01);
    doc.scenarios[0].boundaries[0].responses[0].afterInputId = '70000000-0000-4000-8000-0000000000ff';
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'dangling-reference',
            path: ['scenarios', 0, 'boundaries', 0, 'responses', 0, 'afterInputId'],
          }),
        ])
      );
    }
  });

  // Recursive refinement ownership is a storable structural error.
  it('detects self-membership refinement ownership as structural-rule', () => {
    const doc = structuredClone(s01);
    const idA = doc.elements[0].id;
    doc.refinements = [
      {
        id: '70000000-0000-4000-8000-0000000000c1',
        ownerElementId: idA,
        memberElementIds: [idA],
        portMappings: [],
      },
    ];

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'structural-rule',
            path: ['refinements', 0],
          }),
        ])
      );
    }
  });

  it('detects transitive recursive refinement ownership (2-cycle) as structural-rule on both refinements', () => {
    const doc = structuredClone(s01);
    const idA = doc.elements[0].id;
    const idB = doc.elements[1].id;
    doc.refinements = [
      {
        id: '70000000-0000-4000-8000-0000000000c2',
        ownerElementId: idA,
        memberElementIds: [idB],
        portMappings: [],
      },
      {
        id: '70000000-0000-4000-8000-0000000000c3',
        ownerElementId: idB,
        memberElementIds: [idA],
        portMappings: [],
      },
    ];

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'structural-rule', path: ['refinements', 0] }),
          expect.objectContaining({ code: 'structural-rule', path: ['refinements', 1] }),
        ])
      );
    }
  });

  it('reports missing nullable on a record shape exactly once', () => {
    const doc = structuredClone(s01);
    delete (doc.schemas[0].shape as any).nullable;

    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const nullableIssues = result.issues.filter(
        (iss) =>
          iss.code === 'missing-property' &&
          iss.path.join('.') === 'schemas.0.shape.nullable'
      );
      expect(nullableIssues).toHaveLength(1);
    }
  });
});

describe('workload emission', () => {
  const withWorkload = (patch: Record<string, unknown>) => {
    const doc = loadFixture('s06.json') as any;
    Object.assign(doc.scenarios[0].workloads[0], patch);
    return doc;
  };

  it('accepts a bulk and a stream emission', () => {
    expect(validateDocument(loadFixture('s06.json')).ok).toBe(true);
    expect(validateDocument(withWorkload({ emission: { mode: 'stream', ratePerSecond: 50, profile: { kind: 'steady' } } })).ok).toBe(true);
    expect(validateDocument(withWorkload({ emission: { mode: 'stream', ratePerSecond: 50, profile: { kind: 'ramp', endRate: 90, rampMs: 5000 } } })).ok).toBe(true);
    expect(validateDocument(withWorkload({ emission: { mode: 'bulk', requests: 10, arrival: { ramp: { spreadMs: 1000 } } } })).ok).toBe(true);
    expect(validateDocument(withWorkload({ emission: { mode: 'bulk', requests: 10, arrival: 'instant' } })).ok).toBe(true);
  });

  it('rejects a scenario that still carries completion', () => {
    const doc = loadFixture('s06.json') as any;
    doc.scenarios[0].completion = { kind: 'horizon', horizonMs: 5000 };
    const result = validateDocument(doc);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain('completion');
  });

  it('rejects the old rate and profile workload fields', () => {
    expect(validateDocument(withWorkload({ rate: 100, profile: { kind: 'steady' }, intervalMs: null })).ok).toBe(false);
  });

  it.each([
    [{ mode: 'bulk', requests: 0, arrival: 'instant' }],
    [{ mode: 'bulk', requests: 1.5, arrival: 'instant' }],
    [{ mode: 'bulk', requests: 100001, arrival: 'instant' }],
    [{ mode: 'bulk', requests: 10, arrival: { spreadMs: 0 } }],
    [{ mode: 'bulk', requests: 10, arrival: 'later' }],
    [{ mode: 'stream', ratePerSecond: -1, profile: { kind: 'steady' } }],
    [{ mode: 'stream', ratePerSecond: 5, profile: { kind: 'ramp', endRate: 10 } }],
    [{ mode: 'forever' }],
  ])('rejects bad emission %j', (emission) => {
    expect(validateDocument(withWorkload({ emission })).ok).toBe(false);
  });

  it('rejects a negative start delay', () => {
    expect(validateDocument(withWorkload({ startDelayMs: -1 })).ok).toBe(false);
  });
});

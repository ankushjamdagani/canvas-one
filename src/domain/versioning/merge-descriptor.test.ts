import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertDocumentKeysClassified, canonicalEqual } from './merge-descriptor';
import type { Document } from '../studio/model';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');

function loadFixture(name: string): Document {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as Document;
}

describe('merge-descriptor: S01-S05 coverage and closed key enforcement', () => {
  const fixtureFiles = ['s01.json', 's02.json', 's03.json', 's04.json', 's05.json'];

  for (const file of fixtureFiles) {
    it(`walks ${file} and proves every key of every record is classified`, () => {
      const doc = loadFixture(file);
      expect(() => assertDocumentKeysClassified(doc)).not.toThrow();
    });
  }

  it('throws when an unclassified key is added to the top-level document', () => {
    const doc = loadFixture('s01.json') as any;
    const modified = { ...doc, unclassifiedTopLevelProp: 'surprise' };
    expect(() => assertDocumentKeysClassified(modified)).toThrow(
      /unclassified field 'unclassifiedTopLevelProp' on Document record/,
    );
  });

  it('throws when an unclassified key is added to an element', () => {
    const doc = loadFixture('s01.json') as any;
    const modified = {
      ...doc,
      elements: [
        { ...doc.elements[0], rogueElementField: 42 },
        ...doc.elements.slice(1),
      ],
    };
    expect(() => assertDocumentKeysClassified(modified)).toThrow(
      /unclassified field 'rogueElementField' on Document\.elements record/,
    );
  });

  it('throws when an unclassified key is added to a port', () => {
    const doc = loadFixture('s01.json') as any;
    const elem = doc.elements[0];
    const modified = {
      ...doc,
      elements: [
        {
          ...elem,
          ports: [
            { ...elem.ports[0], unexpectedPortField: true },
            ...elem.ports.slice(1),
          ],
        },
        ...doc.elements.slice(1),
      ],
    };
    expect(() => assertDocumentKeysClassified(modified)).toThrow(
      /unclassified field 'unexpectedPortField' on Document\.elements\.ports record/,
    );
  });

  it('throws when an unclassified key is added to a behavior', () => {
    const doc = loadFixture('s01.json') as any;
    const elem = doc.elements[0];
    const modified = {
      ...doc,
      elements: [
        {
          ...elem,
          behavior: {
            ...elem.behavior,
            nonStandardBehaviorProp: 'invalid',
          },
        },
        ...doc.elements.slice(1),
      ],
    };
    expect(() => assertDocumentKeysClassified(modified)).toThrow(
      /unclassified field 'nonStandardBehaviorProp' on Document\.elements\.behavior:machine record/,
    );
  });

  it('canonicalEqual correctly compares scalars, JSON values, and objects', () => {
    expect(canonicalEqual(1, 1)).toBe(true);
    expect(canonicalEqual(1, 2)).toBe(false);
    expect(canonicalEqual('foo', 'foo')).toBe(true);
    expect(canonicalEqual('foo', 'bar')).toBe(false);
    expect(canonicalEqual(null, null)).toBe(true);
    expect(canonicalEqual(null, undefined)).toBe(false);

    // Key order should not matter in JSON values
    const objA = { b: 2, a: 1 };
    const objB = { a: 1, b: 2 };
    expect(canonicalEqual(objA, objB)).toBe(true);

    // Array order is preserved
    expect(canonicalEqual([1, 2], [2, 1])).toBe(false);
    expect(canonicalEqual([1, 2], [1, 2])).toBe(true);
  });

  it('Item 1: canonicalEqual throws when canonicalJson fails on non-serializable objects', () => {
    const a = { x: 1n };
    const b = { x: 1n };
    expect(() => canonicalEqual(a, b)).toThrow(/canonicalEqual: canonicalJson failed/);
  });
});

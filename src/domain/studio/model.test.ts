import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VALID_KINDS } from '../execution';
import {
  BEHAVIOR_KINDS,
  DOCUMENT_FIELDS,
  VISUAL_KINDS,
  type Document,
} from './model';

const FIXTURE_DIR = fileURLToPath(new URL('../../../src/features/entry/examples', import.meta.url));
const FIXTURE_FILES = ['s01.json', 's02.json', 's03.json', 's04.json', 's05.json'] as const;

describe('studio-model/1 type contracts and fixtures', () => {
  it('(a) top-level keys in fixtures s01..s05 equal Document field list and schema is studio-model/1', () => {
    const expectedKeys = [...DOCUMENT_FIELDS].sort();

    for (const fileName of FIXTURE_FILES) {
      const filePath = resolve(FIXTURE_DIR, fileName);
      const content = readFileSync(filePath, 'utf8');
      const doc = JSON.parse(content);

      expect(doc.schema).toBe('studio-model/1');
      expect(Object.keys(doc).sort()).toEqual(expectedKeys);
    }
  });

  it('(b) every element.visualKind in every fixture is in VISUAL_KINDS', () => {
    for (const fileName of FIXTURE_FILES) {
      const filePath = resolve(FIXTURE_DIR, fileName);
      const content = readFileSync(filePath, 'utf8');
      const doc = JSON.parse(content);

      expect(Array.isArray(doc.elements)).toBe(true);
      for (const el of doc.elements) {
        expect(VISUAL_KINDS).toContain(el.visualKind);
      }
    }
  });

  it('(c) every element.behavior.kind in every fixture is in BEHAVIOR_KINDS', () => {
    for (const fileName of FIXTURE_FILES) {
      const filePath = resolve(FIXTURE_DIR, fileName);
      const content = readFileSync(filePath, 'utf8');
      const doc = JSON.parse(content);

      expect(Array.isArray(doc.elements)).toBe(true);
      for (const el of doc.elements) {
        expect(el.behavior).toBeDefined();
        expect(BEHAVIOR_KINDS).toContain(el.behavior.kind);
      }
    }
  });

  it('(d) minimal Document literal compiles and passes type checking', () => {
    const minimalDoc: Document = {
      schema: 'studio-model/1',
      id: '00000000-0000-4000-8000-000000000000',
      title: 'Minimal Document',
      elements: [],
      connections: [],
      relations: [],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [],
    };

    expect(minimalDoc.schema).toBe('studio-model/1');
    expect(minimalDoc.elements).toHaveLength(0);
    expect(minimalDoc.connections).toHaveLength(0);
    expect(minimalDoc.relations).toHaveLength(0);
    expect(minimalDoc.schemas).toHaveLength(0);
    expect(minimalDoc.fixtures).toHaveLength(0);
    expect(minimalDoc.refinements).toHaveLength(0);
    expect(minimalDoc.scenarios).toHaveLength(0);
    expect(minimalDoc.views).toHaveLength(0);
  });

  it('verifies VISUAL_KINDS composition from VALID_KINDS and revamp additions', () => {
    expect(VISUAL_KINDS).toContain('state-machine');
    expect(VISUAL_KINDS).toContain('data-pipeline');
    expect(VISUAL_KINDS).toContain('host');
    for (const legacyKind of VALID_KINDS) {
      expect(VISUAL_KINDS).toContain(legacyKind);
    }
  });
});

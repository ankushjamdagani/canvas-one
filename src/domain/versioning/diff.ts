/**
 * Deterministic document diffing for System Studio (RV-08c).
 *
 * Implements:
 * - Deterministic per-record changes { recordKind, id, change: 'added' | 'removed' | 'modified', fieldPaths }
 *   for all eight RecordKinds plus document title.
 * - Uses the closed merge descriptor (merge-descriptor.ts) to identify modified fields.
 */

import type { Document, Id } from '../studio/model';
import type { RecordKind } from '../../persistence/studio/types';
import {
  canonicalEqual,
  DOCUMENT_DESCRIPTOR,
  getRecordDescriptor,
  type FieldDescriptor,
} from './merge-descriptor';

export type DiffRecordKind = RecordKind | 'document';

export type ChangeType = 'added' | 'removed' | 'modified';

export type FieldPath = readonly (string | number)[];

export type RecordDiff = {
  readonly recordKind: DiffRecordKind;
  readonly id: Id;
  readonly change: ChangeType;
  readonly fieldPaths: readonly FieldPath[];
};

const RECORD_KIND_ORDER: readonly DiffRecordKind[] = [
  'document',
  'element',
  'connection',
  'relation',
  'schema',
  'fixture',
  'refinement',
  'scenario',
  'view',
];

const COLLECTION_MAP: readonly {
  readonly key: keyof Document;
  readonly kind: RecordKind;
}[] = [
  { key: 'elements', kind: 'element' },
  { key: 'connections', kind: 'connection' },
  { key: 'relations', kind: 'relation' },
  { key: 'schemas', kind: 'schema' },
  { key: 'fixtures', kind: 'fixture' },
  { key: 'refinements', kind: 'refinement' },
  { key: 'scenarios', kind: 'scenario' },
  { key: 'views', kind: 'view' },
];

/**
 * Recursively inspects differences between two values using a FieldDescriptor.
 * Returns an array of paths relative to the root of the comparison.
 */
function findDifferences(
  va: unknown,
  vb: unknown,
  desc: FieldDescriptor,
  currentPath: readonly (string | number)[],
): FieldPath[] {
  if (canonicalEqual(va, vb)) {
    return [];
  }

  if (desc.type === 'scalar' || desc.type === 'atomic') {
    return [currentPath];
  }

  if (desc.type === 'set') {
    const setA = new Set(Array.isArray(va) ? va : []);
    const setB = new Set(Array.isArray(vb) ? vb : []);
    if (setA.size !== setB.size) {
      return [currentPath];
    }
    for (const item of setA) {
      if (!setB.has(item)) {
        return [currentPath];
      }
    }
    return [];
  }

  if (desc.type === 'union') {
    if (typeof va !== 'object' || va === null || typeof vb !== 'object' || vb === null) {
      return [currentPath];
    }
    const disc = desc.discriminant ?? 'kind';
    const kindA = (va as Record<string, unknown>)[disc];
    const kindB = (vb as Record<string, unknown>)[disc];
    if (kindA !== kindB) {
      return [[...currentPath, disc]];
    }
    const variantDesc = desc.variants[String(kindA)];
    if (!variantDesc) {
      return [currentPath];
    }
    return findDifferences(va, vb, variantDesc, currentPath);
  }

  if (desc.type === 'keyed') {
    const arrA = Array.isArray(va) ? (va as readonly (Record<string, unknown> & { id: string })[]) : [];
    const arrB = Array.isArray(vb) ? (vb as readonly (Record<string, unknown> & { id: string })[]) : [];

    const mapA = new Map<string, Record<string, unknown>>();
    const mapB = new Map<string, Record<string, unknown>>();
    for (const item of arrA) {
      if (item && typeof item.id === 'string') mapA.set(item.id, item);
    }
    for (const item of arrB) {
      if (item && typeof item.id === 'string') mapB.set(item.id, item);
    }

    const allIds = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();
    const diffs: FieldPath[] = [];

    for (const id of allIds) {
      const itemA = mapA.get(id);
      const itemB = mapB.get(id);

      if (!itemA || !itemB) {
        diffs.push([...currentPath, id]);
      } else {
        const itemDiffs = findDifferences(itemA, itemB, desc.item, [...currentPath, id]);
        diffs.push(...itemDiffs);
      }
    }
    return diffs;
  }

  if (desc.type === 'object') {
    if (typeof va !== 'object' || va === null || typeof vb !== 'object' || vb === null) {
      return [currentPath];
    }
    const objA = va as Record<string, unknown>;
    const objB = vb as Record<string, unknown>;
    const diffs: FieldPath[] = [];

    const fieldKeys = Object.keys(desc.fields).sort();
    for (const key of fieldKeys) {
      const fieldDesc = desc.fields[key];
      const childDiffs = findDifferences(objA[key], objB[key], fieldDesc, [...currentPath, key]);
      diffs.push(...childDiffs);
    }
    return diffs;
  }

  return [currentPath];
}

/**
 * Sorts field paths lexicographically for determinism.
 */
function sortFieldPaths(paths: readonly FieldPath[]): FieldPath[] {
  return [...paths].sort((a, b) => {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const segA = String(a[i]);
      const segB = String(b[i]);
      if (segA < segB) return -1;
      if (segA > segB) return 1;
    }
    return a.length - b.length;
  });
}

/**
 * Computes deterministic per-record changes between document a and document b.
 */
export function diffDocuments(a: Document, b: Document): readonly RecordDiff[] {
  const results: RecordDiff[] = [];

  // 1. Document title
  if (a.title !== b.title) {
    results.push({
      recordKind: 'document',
      id: b.id,
      change: 'modified',
      fieldPaths: [['title']],
    });
  }

  // 2. Each of the eight collections
  for (const { key, kind } of COLLECTION_MAP) {
    const arrA = a[key] as readonly (Record<string, unknown> & { id: string })[];
    const arrB = b[key] as readonly (Record<string, unknown> & { id: string })[];

    const mapA = new Map<string, Record<string, unknown>>();
    const mapB = new Map<string, Record<string, unknown>>();

    for (const item of arrA) {
      if (item && typeof item.id === 'string') mapA.set(item.id, item);
    }
    for (const item of arrB) {
      if (item && typeof item.id === 'string') mapB.set(item.id, item);
    }

    const allIds = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();
    const descriptor = getRecordDescriptor(kind);

    for (const id of allIds) {
      const itemA = mapA.get(id);
      const itemB = mapB.get(id);

      if (!itemA && itemB) {
        results.push({
          recordKind: kind,
          id,
          change: 'added',
          fieldPaths: [],
        });
      } else if (itemA && !itemB) {
        results.push({
          recordKind: kind,
          id,
          change: 'removed',
          fieldPaths: [],
        });
      } else if (itemA && itemB) {
        const rawDiffs = findDifferences(itemA, itemB, descriptor, []);
        if (rawDiffs.length > 0) {
          results.push({
            recordKind: kind,
            id,
            change: 'modified',
            fieldPaths: sortFieldPaths(rawDiffs),
          });
        }
      }
    }
  }

  // Deterministic sorting of all results:
  // First by RECORD_KIND_ORDER, then by record id
  return results.sort((r1, r2) => {
    const order1 = RECORD_KIND_ORDER.indexOf(r1.recordKind);
    const order2 = RECORD_KIND_ORDER.indexOf(r2.recordKind);
    if (order1 !== order2) {
      return order1 - order2;
    }
    if (r1.id < r2.id) return -1;
    if (r1.id > r2.id) return 1;
    return 0;
  });
}

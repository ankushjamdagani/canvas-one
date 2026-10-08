/**
 * Typed three-way document merge and reference conflict detection.
 *
 * - Identical changes coalesce; one-sided changes apply.
 * - Conflicts for competing scalars, delete vs edit (at any keyed level), add/add with same ID and different content,
 *   incompatible kinds (union kind changed and other side changed anything inside), atomic fields changed differently,
 *   and set fields (per-element 3-way add/remove, no duplicates).
 * - Keyed/set result order: ours order, then theirs-only additions in theirs order.
 * - Conflicted positions hold the OURS value in working document.
 * - Conflict record: { id, kind, recordKind, recordId, path, base, ours, theirs } with explicit present flag per side.
 * - Scenario revision rule: equal to ours content -> ours.revision, equal to theirs content -> theirs.revision,
 *   otherwise max(base, ours, theirs)+1.
 * - schema and id must match on all three or it fails with an issue (never merge across documents).
 * - Reference conflicts: validateDocument runs after structural merge; dangling references become 'reference' conflicts
 *   owned by referencing record. Other validation issues go in 'issues'.
 * - Conflict IDs: deterministic UUID-shaped IDs derived from SHA-256 of canonical JSON of (recordKind, recordId, path, kind)
 *   with version nibble 5 and variant 8-b satisfying UUID_REGEX.
 */

import type { Document, Id, Scenario } from '../studio/model';
import { canonicalJson, sha256Hex } from '../studio/canonical';
import { validateDocument, type Issue } from '../studio/validate';
import type { RecordKind } from '../../persistence/studio/types';
import {
  canonicalEqual,
  assertDocumentKeysClassified,
  ELEMENT_DESCRIPTOR,
  CONNECTION_DESCRIPTOR,
  RELATION_DESCRIPTOR,
  PAYLOAD_SCHEMA_DESCRIPTOR,
  FIXTURE_DESCRIPTOR,
  REFINEMENT_DESCRIPTOR,
  SCENARIO_DESCRIPTOR,
  VIEW_DESCRIPTOR,
  getRecordDescriptor,
  type FieldDescriptor,
  type ObjectFieldDescriptor,
  type UnionFieldDescriptor,
} from './merge-descriptor';
import type { DiffRecordKind } from './diff';
import { deepFreeze } from '../studio/freeze';

// ============================================================================
// Types
// ============================================================================

export type ConflictKind =
  | 'value'
  | 'delete-edit'
  | 'add-add'
  | 'kind'
  | 'atomic'
  | 'reference';

export type ConflictSide<T = unknown> = {
  readonly present: boolean;
  readonly value: T | null;
};

export type MergeConflict = {
  readonly id: Id;
  readonly kind: ConflictKind;
  readonly recordKind: DiffRecordKind;
  readonly recordId: Id;
  readonly path: readonly (string | number)[];
  readonly base: ConflictSide;
  readonly ours: ConflictSide;
  readonly theirs: ConflictSide;
};

export type MergeInputs = {
  readonly base: Document;
  readonly ours: Document;
  readonly theirs: Document;
};

export type MergeResult = {
  readonly document: Document;
  readonly conflicts: readonly MergeConflict[];
  readonly issues: readonly Issue[];
  readonly inputs: MergeInputs;
};

// ============================================================================
// Deep Freeze and Clone
// ============================================================================

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

type RawConflict = Omit<MergeConflict, 'id'>;

// ============================================================================
// Deterministic UUID formatting
// ============================================================================

/**
 * Formats a 64-char lowercase SHA-256 hex string into a UUID v5 conforming to UUID_REGEX.
 * Version nibble 5 at index 12, variant nibble 8-b at index 16.
 */
function formatDeterministicUuid(sha256HexStr: string): Id {
  const part1 = sha256HexStr.slice(0, 8);
  const part2 = sha256HexStr.slice(8, 12);
  const part3 = '5' + sha256HexStr.slice(13, 16);
  const variantNibble = ((parseInt(sha256HexStr[16], 16) & 0x3) | 0x8).toString(16);
  const part4 = variantNibble + sha256HexStr.slice(17, 20);
  const part5 = sha256HexStr.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

/**
 * Derives a deterministic UUID conflict ID from (recordKind, recordId, path, kind).
 */
export async function generateConflictId(
  recordKind: DiffRecordKind,
  recordId: Id,
  path: readonly (string | number)[],
  kind: ConflictKind,
): Promise<Id> {
  const jsonRes = canonicalJson([recordKind, recordId, path, kind]);
  if (!jsonRes.ok) {
    throw new Error(`canonicalJson failed for path '${path.join('.')}': ${jsonRes.issues.map((i) => i.message).join('; ')}`);
  }
  const hash = await sha256Hex(jsonRes.text);
  return formatDeterministicUuid(hash);
}

// ============================================================================
// Internal 3-Way Merge Engine
// ============================================================================

/**
 * Three-way merge of one field: a side that matches base yields to the other; competing
 * changes conflict and hold ours. `kind` records whether a scalar or a whole atomic value
 * conflicted.
 */
function mergeThreeWay(
  kind: 'value' | 'atomic',
  b: unknown,
  o: unknown,
  t: unknown,
  recordKind: DiffRecordKind,
  recordId: Id,
  path: readonly (string | number)[],
  conflicts: RawConflict[],
): unknown {
  if (canonicalEqual(o, t)) {
    return o;
  }
  if (canonicalEqual(o, b)) {
    return t;
  }
  if (canonicalEqual(t, b)) {
    return o;
  }

  conflicts.push({
    kind,
    recordKind,
    recordId,
    path,
    base: { present: b !== undefined, value: b !== undefined ? b : null },
    ours: { present: o !== undefined, value: o !== undefined ? o : null },
    theirs: { present: t !== undefined, value: t !== undefined ? t : null },
  });
  return o;
}

function mergeSet(
  b: unknown,
  o: unknown,
  t: unknown,
): unknown[] {
  const arrB = Array.isArray(b) ? (b as string[]) : [];
  const arrO = Array.isArray(o) ? (o as string[]) : [];
  const arrT = Array.isArray(t) ? (t as string[]) : [];

  const setB = new Set(arrB);
  const setO = new Set(arrO);
  const setT = new Set(arrT);

  const allElements = new Set([...arrB, ...arrO, ...arrT]);
  const resultSet = new Set<string>();

  for (const elem of allElements) {
    const inB = setB.has(elem);
    const inO = setO.has(elem);
    const inT = setT.has(elem);

    if (inB) {
      // Existed in base: kept if both kept. If either removed, one-sided remove applies.
      if (inO && inT) {
        resultSet.add(elem);
      }
    } else {
      // Did not exist in base: added if either added.
      if (inO || inT) {
        resultSet.add(elem);
      }
    }
  }

  // Result ordering: ours order, then theirs-only additions in theirs order
  const result: string[] = [];
  const seen = new Set<string>();

  for (const elem of arrO) {
    if (resultSet.has(elem) && !seen.has(elem)) {
      result.push(elem);
      seen.add(elem);
    }
  }
  for (const elem of arrT) {
    if (resultSet.has(elem) && !seen.has(elem)) {
      result.push(elem);
      seen.add(elem);
    }
  }
  return result;
}

function mergeUnion(
  b: unknown,
  o: unknown,
  t: unknown,
  desc: UnionFieldDescriptor,
  recordKind: DiffRecordKind,
  recordId: Id,
  path: readonly (string | number)[],
  conflicts: RawConflict[],
): unknown {
  const disc = desc.discriminant ?? 'kind';
  const kindB = b && typeof b === 'object' ? (b as Record<string, unknown>)[disc] : undefined;
  const kindO = o && typeof o === 'object' ? (o as Record<string, unknown>)[disc] : undefined;
  const kindT = t && typeof t === 'object' ? (t as Record<string, unknown>)[disc] : undefined;

  // If kinds agree:
  if (kindO === kindT && kindO !== undefined) {
    const variantDesc = desc.variants[String(kindO)];
    if (!variantDesc) {
      return o;
    }
    if (kindO === kindB) {
      // Both kept base kind -> recurse into fields
      return mergeObject(b, o, t, variantDesc, recordKind, recordId, path, conflicts);
    } else {
      // Both switched to the same new kind
      if (canonicalEqual(o, t)) {
        return o;
      }
      return mergeObject(null, o, t, variantDesc, recordKind, recordId, path, conflicts);
    }
  }

  // Kinds do not agree:
  // Check if one side changed kind while the other side made NO change at all
  if (kindO === kindB) {
    // Ours kept base kind; theirs changed kind
    if (canonicalEqual(o, b)) {
      // Ours made no change at all to union -> one-sided change to theirs applies
      return t;
    }
    // Incompatible kinds: theirs changed kind and ours changed fields inside it
    conflicts.push({
      kind: 'kind',
      recordKind,
      recordId,
      path,
      base: { present: b !== undefined, value: b !== undefined ? b : null },
      ours: { present: o !== undefined, value: o !== undefined ? o : null },
      theirs: { present: t !== undefined, value: t !== undefined ? t : null },
    });
    return o;
  }

  if (kindT === kindB) {
    // Theirs kept base kind; ours changed kind
    if (canonicalEqual(t, b)) {
      // Theirs made no change at all to union -> one-sided change to ours applies
      return o;
    }
    // Incompatible kinds: ours changed kind and theirs changed fields inside it
    conflicts.push({
      kind: 'kind',
      recordKind,
      recordId,
      path,
      base: { present: b !== undefined, value: b !== undefined ? b : null },
      ours: { present: o !== undefined, value: o !== undefined ? o : null },
      theirs: { present: t !== undefined, value: t !== undefined ? t : null },
    });
    return o;
  }

  // Both changed to different kinds
  conflicts.push({
    kind: 'kind',
    recordKind,
    recordId,
    path,
    base: { present: b !== undefined, value: b !== undefined ? b : null },
    ours: { present: o !== undefined, value: o !== undefined ? o : null },
    theirs: { present: t !== undefined, value: t !== undefined ? t : null },
  });
  return o;
}

function mergeObject(
  b: unknown,
  o: unknown,
  t: unknown,
  desc: ObjectFieldDescriptor,
  recordKind: DiffRecordKind,
  recordId: Id,
  path: readonly (string | number)[],
  conflicts: RawConflict[],
): Record<string, unknown> {
  const objB = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const objO = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
  const objT = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;

  const result: Record<string, unknown> = {};
  const fieldKeys = Object.keys(desc.fields);

  for (const key of fieldKeys) {
    const fieldDesc = desc.fields[key];
    const valB = objB[key];
    const valO = objO[key];
    const valT = objT[key];
    const fieldPath = [...path, key];
    const mergedVal = mergeField(valB, valO, valT, fieldDesc, recordKind, recordId, fieldPath, conflicts);
    if (mergedVal !== undefined) {
      result[key] = mergedVal;
    }
  }

  return result;
}

function mergeKeyed(
  b: unknown,
  o: unknown,
  t: unknown,
  itemDesc: ObjectFieldDescriptor | UnionFieldDescriptor,
  recordKind: DiffRecordKind,
  recordId: Id,
  path: readonly (string | number)[],
  conflicts: RawConflict[],
  isTopLevel = false,
): unknown[] {
  const arrB = Array.isArray(b) ? (b as (Record<string, unknown> & { id: string })[]) : [];
  const arrO = Array.isArray(o) ? (o as (Record<string, unknown> & { id: string })[]) : [];
  const arrT = Array.isArray(t) ? (t as (Record<string, unknown> & { id: string })[]) : [];

  const mapB = new Map<string, Record<string, unknown> & { id: string }>();
  const mapO = new Map<string, Record<string, unknown> & { id: string }>();
  const mapT = new Map<string, Record<string, unknown> & { id: string }>();

  for (const item of arrB) {
    if (item && typeof item.id === 'string') mapB.set(item.id, item);
  }
  for (const item of arrO) {
    if (item && typeof item.id === 'string') mapO.set(item.id, item);
  }
  for (const item of arrT) {
    if (item && typeof item.id === 'string') mapT.set(item.id, item);
  }

  const allIds = new Set([...mapB.keys(), ...mapO.keys(), ...mapT.keys()]);
  const resultMap = new Map<string, unknown>();

  for (const id of allIds) {
    const mB = mapB.get(id);
    const mO = mapO.get(id);
    const mT = mapT.get(id);

    // If this is a top-level collection, recordKind is the collection item kind and recordId is member id!
    const effectiveRecordKind = isTopLevel ? (recordKind as DiffRecordKind) : recordKind;
    const effectiveRecordId = isTopLevel ? id : recordId;
    const conflictPath = isTopLevel ? [] : [...path, id];

    // Case 1: Present in all three
    if (mB && mO && mT) {
      if (canonicalEqual(mO, mT)) {
        resultMap.set(id, mO);
      } else if (canonicalEqual(mO, mB)) {
        resultMap.set(id, mT);
      } else if (canonicalEqual(mT, mB)) {
        resultMap.set(id, mO);
      } else {
        // Both modified
        if (itemDesc.type === 'union') {
          const merged = mergeUnion(mB, mO, mT, itemDesc, effectiveRecordKind, effectiveRecordId, conflictPath, conflicts);
          resultMap.set(id, merged);
        } else {
          const merged = mergeObject(mB, mO, mT, itemDesc, effectiveRecordKind, effectiveRecordId, conflictPath, conflicts);
          resultMap.set(id, merged);
        }
      }
      continue;
    }

    // Case 2: Present in base, absent on one or both sides
    if (mB) {
      if (!mO && !mT) {
        // Both deleted: coalesces
        continue;
      }
      if (!mO && mT) {
        // Deleted on ours, present on theirs
        if (canonicalEqual(mT, mB)) {
          // Theirs didn't edit, ours deleted -> one-sided deletion applies
          continue;
        }
        // Delete vs Edit conflict!
        conflicts.push({
          kind: 'delete-edit',
          recordKind: effectiveRecordKind,
          recordId: effectiveRecordId,
          path: conflictPath,
          base: { present: true, value: mB },
          ours: { present: false, value: null },
          theirs: { present: true, value: mT },
        });
        // Ours value is absent, so keep absent in working document
        continue;
      }
      if (mO && !mT) {
        // Present on ours, deleted on theirs
        if (canonicalEqual(mO, mB)) {
          // Ours didn't edit, theirs deleted -> one-sided deletion applies
          continue;
        }
        // Delete vs Edit conflict!
        conflicts.push({
          kind: 'delete-edit',
          recordKind: effectiveRecordKind,
          recordId: effectiveRecordId,
          path: conflictPath,
          base: { present: true, value: mB },
          ours: { present: true, value: mO },
          theirs: { present: false, value: null },
        });
        // Ours value is present, so hold mO in working document
        resultMap.set(id, mO);
        continue;
      }
    }

    // Case 3: Absent in base, added on one or both sides
    if (!mB) {
      if (mO && !mT) {
        // One-sided addition on ours
        resultMap.set(id, mO);
        continue;
      }
      if (!mO && mT) {
        // One-sided addition on theirs
        resultMap.set(id, mT);
        continue;
      }
      if (mO && mT) {
        if (canonicalEqual(mO, mT)) {
          // Identical addition
          resultMap.set(id, mO);
        } else {
          // Add/add conflict
          conflicts.push({
            kind: 'add-add',
            recordKind: effectiveRecordKind,
            recordId: effectiveRecordId,
            path: conflictPath,
            base: { present: false, value: null },
            ours: { present: true, value: mO },
            theirs: { present: true, value: mT },
          });
          // Working document holds OURS value
          resultMap.set(id, mO);
        }
        continue;
      }
    }
  }

  // Order rule: ours order, then theirs-only additions in theirs order
  const result: unknown[] = [];
  const seenIds = new Set<string>();

  for (const item of arrO) {
    if (resultMap.has(item.id) && !seenIds.has(item.id)) {
      result.push(resultMap.get(item.id));
      seenIds.add(item.id);
    }
  }
  for (const item of arrT) {
    if (resultMap.has(item.id) && !seenIds.has(item.id)) {
      result.push(resultMap.get(item.id));
      seenIds.add(item.id);
    }
  }
  return result;
}

function mergeField(
  b: unknown,
  o: unknown,
  t: unknown,
  desc: FieldDescriptor,
  recordKind: DiffRecordKind,
  recordId: Id,
  path: readonly (string | number)[],
  conflicts: RawConflict[],
): unknown {
  switch (desc.type) {
    case 'scalar':
      return mergeThreeWay('value', b, o, t, recordKind, recordId, path, conflicts);
    case 'atomic':
      return mergeThreeWay('atomic', b, o, t, recordKind, recordId, path, conflicts);
    case 'set':
      return mergeSet(b, o, t);
    case 'union':
      return mergeUnion(b, o, t, desc, recordKind, recordId, path, conflicts);
    case 'object':
      return mergeObject(b, o, t, desc, recordKind, recordId, path, conflicts);
    case 'keyed':
      return mergeKeyed(b, o, t, desc.item, recordKind, recordId, path, conflicts, false);
  }
}

// ============================================================================
// Reference Conflict Extraction & Helpers
// ============================================================================

export const COLLECTION_KEY_TO_KIND: Record<string, RecordKind> = {
  elements: 'element',
  connections: 'connection',
  relations: 'relation',
  schemas: 'schema',
  fixtures: 'fixture',
  refinements: 'refinement',
  scenarios: 'scenario',
  views: 'view',
};

export function lookupRecordById(
  doc: Document,
  collectionKey: keyof Document,
  recordId: Id,
): (Record<string, unknown> & { id: string }) | null {
  const collection = doc[collectionKey] as readonly (Record<string, unknown> & { id: string })[] | undefined;
  if (!Array.isArray(collection)) return null;
  return collection.find((r) => r.id === recordId) ?? null;
}

export function convertIssuePathToIdPath(
  record: unknown,
  recordKind: RecordKind,
  relativePath: readonly (string | number)[],
): readonly (string | number)[] {
  let currVal: unknown = record;
  let currDesc: FieldDescriptor | undefined = getRecordDescriptor(recordKind);
  const idPath: (string | number)[] = [];

  for (let i = 0; i < relativePath.length; i++) {
    const seg = relativePath[i];
    if (currDesc?.type === 'keyed') {
      const idx = typeof seg === 'number' ? seg : parseInt(String(seg), 10);
      const arr = Array.isArray(currVal) ? currVal : [];
      const member = arr[idx];
      if (member && typeof member === 'object' && typeof (member as { id?: unknown }).id === 'string') {
        idPath.push((member as { id: string }).id);
      } else {
        idPath.push(seg);
      }
      currVal = member;
      currDesc = currDesc.item;
    } else if (currDesc?.type === 'object') {
      idPath.push(seg);
      currVal = currVal && typeof currVal === 'object' ? (currVal as Record<string, unknown>)[seg] : undefined;
      currDesc = currDesc.fields[String(seg)];
    } else if (currDesc?.type === 'union') {
      idPath.push(seg);
      const unionDesc: UnionFieldDescriptor = currDesc;
      const disc: string = unionDesc.discriminant ?? 'kind';
      const variantKey: unknown =
        currVal && typeof currVal === 'object' ? (currVal as Record<string, unknown>)[disc] : undefined;
      const variantDesc: ObjectFieldDescriptor | undefined =
        variantKey ? unionDesc.variants[String(variantKey)] : undefined;
      currVal = currVal && typeof currVal === 'object' ? (currVal as Record<string, unknown>)[seg] : undefined;
      currDesc = variantDesc?.fields[String(seg)];
    } else {
      // atomic, set, scalar, or past descriptor: indices stay numeric
      idPath.push(seg);
      currVal = currVal && typeof currVal === 'object' ? (currVal as Record<string, unknown>)[seg] : undefined;
      currDesc = undefined;
    }
  }

  return idPath;
}

// ============================================================================
// mergeDocuments
// ============================================================================

/**
 * Pure 3-way merge of System Studio documents.
 */
export async function mergeDocuments(
  base: Document,
  ours: Document,
  theirs: Document,
): Promise<MergeResult> {
  // Preconditions: schema and id must match across all three
  if (base.id !== ours.id || ours.id !== theirs.id) {
    return deepFreeze({
      document: ours,
      conflicts: [],
      issues: [
        {
          code: 'structural-rule',
          path: ['id'],
          entityId: ours.id,
          severity: 'error',
          message: `Cannot merge across different documents: base.id='${base.id}', ours.id='${ours.id}', theirs.id='${theirs.id}'`,
        },
      ],
      inputs: { base, ours, theirs },
    });
  }

  if (base.schema !== ours.schema || ours.schema !== theirs.schema) {
    return deepFreeze({
      document: ours,
      conflicts: [],
      issues: [
        {
          code: 'structural-rule',
          path: ['schema'],
          entityId: ours.id,
          severity: 'error',
          message: `Cannot merge across different schemas: base.schema='${base.schema}', ours.schema='${ours.schema}', theirs.schema='${theirs.schema}'`,
        },
      ],
      inputs: { base, ours, theirs },
    });
  }

  // Closed keys in the merge itself: assertDocumentKeysClassified on all three inputs
  assertDocumentKeysClassified(base);
  assertDocumentKeysClassified(ours);
  assertDocumentKeysClassified(theirs);

  const rawConflicts: RawConflict[] = [];

  // Merge Document title
  const mergedTitle = mergeThreeWay(
    'value',
    base.title,
    ours.title,
    theirs.title,
    'document',
    ours.id,
    ['title'],
    rawConflicts,
  ) as string;

  // Merge top-level keyed collections
  const mergedElements = mergeKeyed(
    base.elements,
    ours.elements,
    theirs.elements,
    ELEMENT_DESCRIPTOR,
    'element',
    ours.id,
    [],
    rawConflicts,
    true,
  ) as Document['elements'];

  const mergedConnections = mergeKeyed(
    base.connections,
    ours.connections,
    theirs.connections,
    CONNECTION_DESCRIPTOR,
    'connection',
    ours.id,
    [],
    rawConflicts,
    true,
  ) as Document['connections'];

  const mergedRelations = mergeKeyed(
    base.relations,
    ours.relations,
    theirs.relations,
    RELATION_DESCRIPTOR,
    'relation',
    ours.id,
    [],
    rawConflicts,
    true,
  ) as Document['relations'];

  const mergedSchemas = mergeKeyed(
    base.schemas,
    ours.schemas,
    theirs.schemas,
    PAYLOAD_SCHEMA_DESCRIPTOR,
    'schema',
    ours.id,
    [],
    rawConflicts,
    true,
  ) as Document['schemas'];

  const mergedFixtures = mergeKeyed(
    base.fixtures,
    ours.fixtures,
    theirs.fixtures,
    FIXTURE_DESCRIPTOR,
    'fixture',
    ours.id,
    [],
    rawConflicts,
    true,
  ) as Document['fixtures'];

  const mergedRefinements = mergeKeyed(
    base.refinements,
    ours.refinements,
    theirs.refinements,
    REFINEMENT_DESCRIPTOR,
    'refinement',
    ours.id,
    [],
    rawConflicts,
    true,
  ) as Document['refinements'];

  // Exclude `revision` from structural comparison and merging
  // (compare scenario content without revision), then apply the derivation rule.
  const stripScenarioRevision = (s: Scenario): Omit<Scenario, 'revision'> => {
    const { revision: _, ...content } = s;
    return content;
  };

  const SCENARIO_CONTENT_DESCRIPTOR: ObjectFieldDescriptor = {
    ...SCENARIO_DESCRIPTOR,
    fields: Object.fromEntries(
      Object.entries(SCENARIO_DESCRIPTOR.fields).filter(([k]) => k !== 'revision'),
    ),
  };

  const rawMergedScenarios = mergeKeyed(
    base.scenarios.map(stripScenarioRevision),
    ours.scenarios.map(stripScenarioRevision),
    theirs.scenarios.map(stripScenarioRevision),
    SCENARIO_CONTENT_DESCRIPTOR,
    'scenario',
    ours.id,
    [],
    rawConflicts,
    true,
  ) as Array<Omit<Scenario, 'revision'>>;

  // Scenario revision derivation rule:
  // Scenario `revision` is derived, not merged: equal to ours content → ours.revision,
  // equal to theirs content → theirs.revision, otherwise max(base, ours, theirs) versions that exist + 1.
  const mapBaseScenarios = new Map(base.scenarios.map((s) => [s.id, s]));
  const mapOursScenarios = new Map(ours.scenarios.map((s) => [s.id, s]));
  const mapTheirsScenarios = new Map(theirs.scenarios.map((s) => [s.id, s]));

  const mergedScenarios: Scenario[] = rawMergedScenarios.map((scenContent) => {
    const bScen = mapBaseScenarios.get(scenContent.id);
    const oScen = mapOursScenarios.get(scenContent.id);
    const tScen = mapTheirsScenarios.get(scenContent.id);

    const oursContent = oScen ? stripScenarioRevision(oScen) : null;
    const theirsContent = tScen ? stripScenarioRevision(tScen) : null;

    let derivedRevision: number;
    if (oursContent && canonicalEqual(scenContent, oursContent)) {
      derivedRevision = oScen!.revision;
    } else if (theirsContent && canonicalEqual(scenContent, theirsContent)) {
      derivedRevision = tScen!.revision;
    } else {
      const existingRevisions = [bScen?.revision, oScen?.revision, tScen?.revision]
        .filter((r): r is number => typeof r === 'number');
      const maxRev = existingRevisions.length > 0 ? Math.max(...existingRevisions) : 0;
      derivedRevision = maxRev + 1;
    }

    return {
      ...scenContent,
      revision: derivedRevision,
    } as Scenario;
  });

  const mergedViews = mergeKeyed(
    base.views,
    ours.views,
    theirs.views,
    VIEW_DESCRIPTOR,
    'view',
    ours.id,
    [],
    rawConflicts,
    true,
  ) as Document['views'];

  const workingDoc: Document = {
    schema: ours.schema,
    id: ours.id,
    title: mergedTitle,
    elements: mergedElements,
    connections: mergedConnections,
    relations: mergedRelations,
    schemas: mergedSchemas,
    fixtures: mergedFixtures,
    refinements: mergedRefinements,
    scenarios: mergedScenarios,
    views: mergedViews,
  };

  // Run validateDocument on the working document
  const validationRes = validateDocument(workingDoc);
  const rawIssues = validationRes.ok ? [] : validationRes.issues;
  const remainingIssues: Issue[] = [];

  for (const issue of rawIssues) {
    if (issue.code === 'dangling-reference') {
      const collectionKey = issue.path[0] as keyof Document;
      const recordKind = COLLECTION_KEY_TO_KIND[collectionKey];
      if (!recordKind) {
        throw new Error(
          `Dangling-reference issue path '${issue.path.join('.')}' cannot be mapped to an owning record: unknown collection '${String(collectionKey)}'`,
        );
      }
      const recordIdx = issue.path[1];
      if (typeof recordIdx !== 'number') {
        throw new Error(
          `Dangling-reference issue path '${issue.path.join('.')}' cannot be mapped to an owning record: missing record index`,
        );
      }
      const collection = workingDoc[collectionKey] as readonly (Record<string, unknown> & { id: string })[] | undefined;
      const rec = collection?.[recordIdx];
      if (!rec) {
        throw new Error(
          `Dangling-reference issue path '${issue.path.join('.')}' cannot be mapped to an owning record: index ${recordIdx} out of bounds`,
        );
      }
      const recordId = rec.id;
      const relativePath = issue.path.slice(2);
      const relativeIdPath = convertIssuePathToIdPath(rec, recordKind, relativePath);

      // A reference conflict is resolved at the owning record level (an edit replaces the whole owning typed record):
      // its base/ours/theirs sides are the WHOLE owning record looked up BY ID in base/ours/theirs documents (present=false when absent)
      const baseRec = lookupRecordById(base, collectionKey, recordId);
      const oursRec = lookupRecordById(ours, collectionKey, recordId);
      const theirsRec = lookupRecordById(theirs, collectionKey, recordId);

      rawConflicts.push({
        kind: 'reference',
        recordKind,
        recordId,
        path: relativeIdPath,
        base: { present: baseRec !== null, value: baseRec },
        ours: { present: oursRec !== null, value: oursRec },
        theirs: { present: theirsRec !== null, value: theirsRec },
      });
    } else {
      remainingIssues.push(issue);
    }
  }

  // Deduplicate and assign deterministic UUID conflict IDs
  const conflictList: MergeConflict[] = [];
  const seenConflictKeys = new Set<string>();

  for (const raw of rawConflicts) {
    const conflictKey = `${raw.recordKind}:${raw.recordId}:${raw.path.join('.')}:${raw.kind}`;
    if (seenConflictKeys.has(conflictKey)) continue;
    seenConflictKeys.add(conflictKey);

    const id = await generateConflictId(raw.recordKind, raw.recordId, raw.path, raw.kind);
    conflictList.push({
      ...raw,
      id,
    });
  }

  // Deterministically sort conflicts
  conflictList.sort((c1, c2) => {
    if (c1.recordKind !== c2.recordKind) return c1.recordKind < c2.recordKind ? -1 : 1;
    if (c1.recordId !== c2.recordId) return c1.recordId < c2.recordId ? -1 : 1;
    const p1 = c1.path.join('.');
    const p2 = c2.path.join('.');
    if (p1 !== p2) return p1 < p2 ? -1 : 1;
    if (c1.kind !== c2.kind) return c1.kind < c2.kind ? -1 : 1;
    return 0;
  });

  return deepFreeze({
    document: workingDoc,
    conflicts: conflictList,
    issues: remainingIssues,
    inputs: {
      base,
      ours,
      theirs,
    },
  });
}

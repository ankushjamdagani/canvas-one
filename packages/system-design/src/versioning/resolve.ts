/**
 * Conflict resolution and post-resolution re-validation for System Studio.
 *
 * - Resolution kinds: 'ours', 'theirs', or 'edited' (record or null).
 * - ours/theirs sets the value at the conflict path (for delete-edit / add-add at a keyed position this means present or absent).
 * - edited replaces the whole owning record (null = explicit deletion) and clears every conflict owned by that record.
 * - Recomputes reference conflicts and validation issues by re-validating.
 * - Unknown conflictId throws a typed ConflictResolutionError.
 * - Inputs are never mutated; returned state is deep-frozen.
 */

import type { Document, Id } from '../studio/model.js';
import type { EditableRecord, RecordKind } from '../studio/records.js';
import { validateDocument, type Issue } from '../studio/validate.js';
import { assertDocumentKeysClassified } from './merge-descriptor.js';
import {
  generateConflictId,
  convertIssuePathToIdPath,
  lookupRecordById,
  COLLECTION_KEY_TO_KIND,
  deepClone,
  type ConflictSide,
  type MergeConflict,
  type MergeResult,
} from './merge.js';
import type { DiffRecordKind } from './diff.js';
import { deepFreeze } from '../studio/freeze.js';

// ============================================================================
// Types
// ============================================================================

export type ConflictResolution =
  | { readonly kind: 'ours' | 'theirs' }
  | { readonly kind: 'edited'; readonly record: EditableRecord['record'] | null };

export class ConflictResolutionError extends Error {
  readonly code: 'unknown-conflict' | 'invalid-resolution';

  constructor(
    messageOrCode: string,
    code?: 'unknown-conflict' | 'invalid-resolution',
  ) {
    if (messageOrCode === 'unknown-conflict' || messageOrCode === 'invalid-resolution') {
      super(code ?? messageOrCode);
      this.code = (code ?? messageOrCode) as 'unknown-conflict' | 'invalid-resolution';
    } else {
      super(messageOrCode);
      this.code = code ?? 'unknown-conflict';
    }
    this.name = 'ConflictResolutionError';
  }
}

const KIND_TO_COLLECTION_KEY: Record<RecordKind, keyof Document> = {
  element: 'elements',
  connection: 'connections',
  relation: 'relations',
  schema: 'schemas',
  fixture: 'fixtures',
  refinement: 'refinements',
  scenario: 'scenarios',
  view: 'views',
};

// ============================================================================
// Record Kind Verification
// ============================================================================

function isRecordOfKind(record: unknown, recordKind: DiffRecordKind): boolean {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return false;
  }
  const obj = record as Record<string, unknown>;
  if (typeof obj.id !== 'string') {
    return false;
  }

  switch (recordKind) {
    case 'element':
      return (
        Array.isArray(obj.ports) &&
        obj.behavior !== null &&
        typeof obj.behavior === 'object' &&
        typeof obj.visualKind === 'string'
      );
    case 'connection':
      return (
        obj.source !== null &&
        typeof obj.source === 'object' &&
        typeof (obj.source as Record<string, unknown>).elementId === 'string' &&
        obj.target !== null &&
        typeof obj.target === 'object' &&
        typeof (obj.target as Record<string, unknown>).elementId === 'string' &&
        (obj.kind === 'data' || obj.kind === 'control')
      );
    case 'relation':
      return (
        typeof obj.sourceElementId === 'string' &&
        typeof obj.targetElementId === 'string' &&
        (obj.kind === 'contains' || obj.kind === 'associates')
      );
    case 'schema':
      return typeof obj.name === 'string' && Array.isArray(obj.fields);
    case 'fixture':
      return typeof obj.schemaId === 'string' && 'value' in obj;
    case 'refinement':
      return (
        typeof obj.abstractElementId === 'string' &&
        typeof obj.refinedElementId === 'string'
      );
    case 'scenario':
      return (
        typeof obj.revision === 'number' &&
        Array.isArray(obj.scopeElementIds) &&
        (obj.mode === 'discrete' || obj.mode === 'hybrid')
      );
    case 'view':
      return (
        Array.isArray(obj.placements) &&
        Array.isArray(obj.connectionIds) &&
        Array.isArray(obj.relationIds)
      );
    default:
      return false;
  }
}

// ============================================================================
// Path navigation and mutation on a cloned document
// ============================================================================

function applySideAtConflictPath(
  doc: Document,
  conflict: MergeConflict,
  side: ConflictSide,
): void {
  if (conflict.recordKind === 'document') {
    if (conflict.path.length === 1 && conflict.path[0] === 'extensions') {
      const mutable = doc as {extensions?: Document['extensions']};
      if (side.present) mutable.extensions = side.value as Document['extensions'];
      else delete mutable.extensions;
      return;
    }
    if (conflict.path.length === 1 && conflict.path[0] === 'title') {
      (doc as { title: string }).title = side.value as string;
      return;
    }
    throw new ConflictResolutionError(
      `Cannot resolve document conflict path '${conflict.path.join('.')}'`,
      'invalid-resolution',
    );
  }

  const collectionKey = KIND_TO_COLLECTION_KEY[conflict.recordKind as RecordKind];
  if (!collectionKey) {
    throw new ConflictResolutionError(
      `Unknown collection for recordKind '${conflict.recordKind}'`,
      'invalid-resolution',
    );
  }

  const collection = (doc[collectionKey] as unknown as (Record<string, unknown> & { id: string })[]);

  // Reference conflict: resolved at the owning record level (an edit replaces the whole owning typed record):
  // its base/ours/theirs sides are the WHOLE owning record looked up BY ID in base/ours/theirs
  // and ours/theirs resolution replaces the owning record with that side (absent -> remove)
  if (conflict.kind === 'reference') {
    const idx = collection.findIndex((r) => r.id === conflict.recordId);
    if (!side.present || side.value === null) {
      if (idx >= 0) {
        collection.splice(idx, 1);
      }
    } else {
      if (idx >= 0) {
        collection[idx] = side.value as Record<string, unknown> & { id: string };
      } else {
        collection.push(side.value as Record<string, unknown> & { id: string });
      }
    }
    return;
  }

  // If path is empty, resolution affects the top-level record itself (e.g. add-add, delete-edit)
  if (conflict.path.length === 0) {
    const idx = collection.findIndex((r) => r.id === conflict.recordId);
    if (!side.present || side.value === null) {
      if (idx >= 0) {
        collection.splice(idx, 1);
      }
    } else {
      if (idx >= 0) {
        collection[idx] = side.value as Record<string, unknown> & { id: string };
      } else {
        collection.push(side.value as Record<string, unknown> & { id: string });
      }
    }
    return;
  }

  // Nested path within the owning record
  const owningRecord = collection.find((r) => r.id === conflict.recordId);
  if (!owningRecord) {
    throw new ConflictResolutionError(
      `Cannot find owning record '${conflict.recordId}' for path '${conflict.path.join('.')}'`,
      'invalid-resolution',
    );
  }

  let parent: unknown = owningRecord;
  for (let i = 0; i < conflict.path.length - 1; i++) {
    const seg = conflict.path[i];
    if (parent === null || parent === undefined || typeof parent !== 'object') {
      throw new ConflictResolutionError(
        `Cannot resolve segment '${seg}' at path '${conflict.path.join('.')}'`,
        'invalid-resolution',
      );
    }
    if (Array.isArray(parent)) {
      parent = (parent as (Record<string, unknown> & { id?: string })[]).find(
        (m) => m && m.id === seg,
      );
    } else {
      parent = (parent as Record<string | number, unknown>)[seg];
    }
  }

  if (parent === null || parent === undefined || typeof parent !== 'object') {
    throw new ConflictResolutionError(
      `Cannot resolve path '${conflict.path.join('.')}'`,
      'invalid-resolution',
    );
  }

  const lastSeg = conflict.path[conflict.path.length - 1];

  if (Array.isArray(parent)) {
    // Keyed array (e.g. ports, placements) where lastSeg is member ID
    const members = parent as (Record<string, unknown> & { id?: string })[];
    const idx = members.findIndex((m) => m && m.id === lastSeg);
    if (!side.present || side.value === null) {
      if (idx >= 0) members.splice(idx, 1);
    } else {
      if (idx >= 0) members[idx] = side.value as Record<string, unknown> & { id: string };
      else members.push(side.value as Record<string, unknown> & { id: string });
    }
  } else {
    // Object property
    const obj = parent as Record<string | number, unknown>;
    if (!side.present) {
      delete obj[lastSeg];
    } else {
      obj[lastSeg] = side.value;
    }
  }
}

// ============================================================================
// resolveConflict
// ============================================================================

export async function resolveConflict(
  mergeState: MergeResult,
  conflictId: Id,
  resolution: ConflictResolution,
): Promise<MergeResult> {
  const targetConflict = mergeState.conflicts.find((c) => c.id === conflictId);
  if (!targetConflict) {
    throw new ConflictResolutionError(`Conflict not found: '${conflictId}'`, 'unknown-conflict');
  }

  const doc = deepClone(mergeState.document);
  let remainingConflicts: MergeConflict[] = [];

  if (resolution.kind === 'edited') {
    if (targetConflict.recordKind === 'document') {
      throw new ConflictResolutionError(
        'Cannot resolve document-kind conflict with edited',
        'invalid-resolution',
      );
    }

    if (resolution.record !== null) {
      if (resolution.record.id !== targetConflict.recordId) {
        throw new ConflictResolutionError(
          `Edited record id '${resolution.record.id}' differs from conflict recordId '${targetConflict.recordId}'`,
          'invalid-resolution',
        );
      }
      if (!isRecordOfKind(resolution.record, targetConflict.recordKind)) {
        throw new ConflictResolutionError(
          `Edited record is not of recordKind '${targetConflict.recordKind}'`,
          'invalid-resolution',
        );
      }
    }

    const recordKind = targetConflict.recordKind as RecordKind;
    const collectionKey = KIND_TO_COLLECTION_KEY[recordKind];
    if (!collectionKey) {
      throw new ConflictResolutionError(
        `Unknown collection for recordKind '${targetConflict.recordKind}'`,
        'invalid-resolution',
      );
    }

    const collection = (doc[collectionKey] as unknown as (Record<string, unknown> & { id: string })[]);
    const idx = collection.findIndex((r) => r.id === targetConflict.recordId);

    if (resolution.record === null) {
      // Explicit deletion of owning record
      if (idx >= 0) {
        collection.splice(idx, 1);
      }
    } else {
      // Replace or insert whole owning record
      if (idx >= 0) {
        collection[idx] = resolution.record as Record<string, unknown> & { id: string };
      } else {
        collection.push(resolution.record as Record<string, unknown> & { id: string });
      }
    }

    // Closed-key check on an edited record's owning document after resolution
    assertDocumentKeysClassified(doc);

    // Clear every conflict owned by that record
    remainingConflicts = mergeState.conflicts.filter(
      (c) =>
        !(
          c.recordKind === targetConflict.recordKind &&
          c.recordId === targetConflict.recordId
        ) && c.kind !== 'reference',
    );
  } else {
    // resolution.kind === 'ours' | 'theirs'
    const chosenSide = resolution.kind === 'ours' ? targetConflict.ours : targetConflict.theirs;
    applySideAtConflictPath(doc, targetConflict, chosenSide);

    // Clear only this resolved conflict
    remainingConflicts = mergeState.conflicts.filter(
      (c) => c.id !== conflictId && c.kind !== 'reference',
    );
  }

  // Re-run validation on the resulting document
  const validationRes = validateDocument(doc);
  const rawIssues = validationRes.ok ? [] : validationRes.issues;
  const remainingIssues: Issue[] = [];
  const recomputedRefConflicts: MergeConflict[] = [];

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
      const collection = doc[collectionKey] as readonly (Record<string, unknown> & { id: string })[] | undefined;
      const rec = collection?.[recordIdx];
      if (!rec) {
        throw new Error(
          `Dangling-reference issue path '${issue.path.join('.')}' cannot be mapped to an owning record: index ${recordIdx} out of bounds`,
        );
      }
      const recordId = rec.id;
      const relativePath = issue.path.slice(2);
      const relativeIdPath = convertIssuePathToIdPath(rec, recordKind, relativePath);

      // Recomputed reference conflicts after a resolution must take their sides from
      // the original base/ours/theirs documents, never from the current working document.
      const baseRec = lookupRecordById(mergeState.inputs.base, collectionKey, recordId);
      const oursRec = lookupRecordById(mergeState.inputs.ours, collectionKey, recordId);
      const theirsRec = lookupRecordById(mergeState.inputs.theirs, collectionKey, recordId);

      const id = await generateConflictId(recordKind, recordId, relativeIdPath, 'reference');

      recomputedRefConflicts.push({
        id,
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

  const updatedConflicts = [...remainingConflicts, ...recomputedRefConflicts];

  // Deterministically sort conflicts
  updatedConflicts.sort((c1, c2) => {
    if (c1.recordKind !== c2.recordKind) return c1.recordKind < c2.recordKind ? -1 : 1;
    if (c1.recordId !== c2.recordId) return c1.recordId < c2.recordId ? -1 : 1;
    const p1 = c1.path.join('.');
    const p2 = c2.path.join('.');
    if (p1 !== p2) return p1 < p2 ? -1 : 1;
    if (c1.kind !== c2.kind) return c1.kind < c2.kind ? -1 : 1;
    return 0;
  });

  return deepFreeze({
    document: doc,
    conflicts: updatedConflicts,
    issues: remainingIssues,
    inputs: mergeState.inputs,
  });
}

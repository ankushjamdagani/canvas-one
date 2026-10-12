/**
 * Pure functions for computing inverse changes from a pre-apply Document.
 *
 * Inverse changes are computed from the pre-apply Document:
 * - insert → remove
 * - replace → replace with the prior record
 * - remove → insert the prior record
 */

import { invertRecordChanges } from '@canvas-one/whiteboard';
import type { Document, Id } from '../studio/model.js';
import type { Issue } from '../studio/validate.js';
import { createIssue } from '../studio/issue.js';
import {
  type EditableRecord,
  type RecordChange,
  type RecordKind,
  type SystemRecordMap,
} from '../studio/records.js';

export type ComputeInverseSuccess = {
  readonly ok: true;
  readonly changes: readonly RecordChange[];
};

export type ComputeInverseFailure = {
  readonly ok: false;
  readonly issues: readonly Issue[];
};

export type ComputeInverseResult = ComputeInverseSuccess | ComputeInverseFailure;

/**
 * Finds a record in the Document by kind and ID, returning it as an EditableRecord.
 */
function findPriorRecord(
  doc: Document,
  recordKind: RecordKind,
  id: Id,
): EditableRecord | null {
  switch (recordKind) {
    case 'element': {
      const rec = doc.elements.find((item) => item.id === id);
      return rec ? { recordKind: 'element', record: rec } : null;
    }
    case 'connection': {
      const rec = doc.connections.find((item) => item.id === id);
      return rec ? { recordKind: 'connection', record: rec } : null;
    }
    case 'relation': {
      const rec = doc.relations.find((item) => item.id === id);
      return rec ? { recordKind: 'relation', record: rec } : null;
    }
    case 'schema': {
      const rec = doc.schemas.find((item) => item.id === id);
      return rec ? { recordKind: 'schema', record: rec } : null;
    }
    case 'fixture': {
      const rec = doc.fixtures.find((item) => item.id === id);
      return rec ? { recordKind: 'fixture', record: rec } : null;
    }
    case 'refinement': {
      const rec = doc.refinements.find((item) => item.id === id);
      return rec ? { recordKind: 'refinement', record: rec } : null;
    }
    case 'scenario': {
      const rec = doc.scenarios.find((item) => item.id === id);
      return rec ? { recordKind: 'scenario', record: rec } : null;
    }
    case 'view': {
      const rec = doc.views.find((item) => item.id === id);
      return rec ? { recordKind: 'view', record: rec } : null;
    }
  }
}

/**
 * Computes the inverse changes for a given list of changes against a pre-apply Document.
 * The resulting list of inverse changes is reversed to ensure correct dependency ordering
 * on rollback (e.g. child/connection removal precedes parent/element removal).
 *
 * If any replace or remove change has no prior record in the document, returns {ok: false, issues}
 * naming the change index.
 */
export function computeInverseChanges(
  currentDocument: Document,
  changes: readonly RecordChange[],
): ComputeInverseResult {
  const result = invertRecordChanges<SystemRecordMap>(changes, (kind, id) =>
    findPriorRecord(currentDocument, kind, id));
  if (result.ok) return result;
  return {
    ok: false,
    issues: result.missing.map(({ index, recordKind, id }) => createIssue(
      'dangling-reference',
      `Cannot invert change at index ${index}: prior record not found in document for ${recordKind} with ID ${id}`,
      ['changes', index],
      id,
    )),
  };
}

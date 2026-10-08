/**
 * Pure functions for computing inverse changes from a pre-apply Document.
 *
 * Inverse changes are computed from the pre-apply Document:
 * - insert → remove
 * - replace → replace with the prior record
 * - remove → insert the prior record
 */

import type { Document, Id } from '../../domain/studio/model';
import type { Issue } from '../../domain/studio/validate';
import {
  createIssue,
  type EditableRecord,
  type RecordChange,
  type RecordKind,
} from '../../persistence/studio';

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
      return rec ? { recordKind: 'element', record: structuredClone(rec) } : null;
    }
    case 'connection': {
      const rec = doc.connections.find((item) => item.id === id);
      return rec ? { recordKind: 'connection', record: structuredClone(rec) } : null;
    }
    case 'relation': {
      const rec = doc.relations.find((item) => item.id === id);
      return rec ? { recordKind: 'relation', record: structuredClone(rec) } : null;
    }
    case 'schema': {
      const rec = doc.schemas.find((item) => item.id === id);
      return rec ? { recordKind: 'schema', record: structuredClone(rec) } : null;
    }
    case 'fixture': {
      const rec = doc.fixtures.find((item) => item.id === id);
      return rec ? { recordKind: 'fixture', record: structuredClone(rec) } : null;
    }
    case 'refinement': {
      const rec = doc.refinements.find((item) => item.id === id);
      return rec ? { recordKind: 'refinement', record: structuredClone(rec) } : null;
    }
    case 'scenario': {
      const rec = doc.scenarios.find((item) => item.id === id);
      return rec ? { recordKind: 'scenario', record: structuredClone(rec) } : null;
    }
    case 'view': {
      const rec = doc.views.find((item) => item.id === id);
      return rec ? { recordKind: 'view', record: structuredClone(rec) } : null;
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
  const issues: Issue[] = [];

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    switch (change.kind) {
      case 'insert': {
        break;
      }
      case 'replace': {
        const prior = findPriorRecord(
          currentDocument,
          change.value.recordKind,
          change.value.record.id,
        );
        if (!prior) {
          issues.push(
            createIssue(
              'dangling-reference',
              `Cannot invert change at index ${i}: prior record not found in document for ${change.value.recordKind} with ID ${change.value.record.id}`,
              ['changes', i],
              change.value.record.id,
            ),
          );
        }
        break;
      }
      case 'remove': {
        const prior = findPriorRecord(
          currentDocument,
          change.recordKind,
          change.id,
        );
        if (!prior) {
          issues.push(
            createIssue(
              'dangling-reference',
              `Cannot invert change at index ${i}: prior record not found in document for ${change.recordKind} with ID ${change.id}`,
              ['changes', i],
              change.id,
            ),
          );
        }
        break;
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const inverseChanges: RecordChange[] = [];
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    switch (change.kind) {
      case 'insert': {
        inverseChanges.push({
          kind: 'remove',
          recordKind: change.value.recordKind,
          id: change.value.record.id,
        });
        break;
      }
      case 'replace': {
        const prior = findPriorRecord(
          currentDocument,
          change.value.recordKind,
          change.value.record.id,
        )!;
        inverseChanges.push({
          kind: 'replace',
          value: prior,
        });
        break;
      }
      case 'remove': {
        const prior = findPriorRecord(
          currentDocument,
          change.recordKind,
          change.id,
        )!;
        inverseChanges.push({
          kind: 'insert',
          value: prior,
        });
        break;
      }
    }
  }

  return { ok: true, changes: inverseChanges };
}

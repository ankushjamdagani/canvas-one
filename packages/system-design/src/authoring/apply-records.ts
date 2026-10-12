/**
 * Pure reducer and validator for applying RecordChange[] to a Document.
 *
 * Rules:
 * - Reject whole command on missing target (dangling-reference)
 * - Reject whole command on duplicate targets within changes or existing document (duplicate-id)
 * - Reject unknown IDs or fields (invalid-id, invalid-literal, unknown-property via validateDocument)
 * - Reject invalid cross-references (dangling-reference via validateDocument)
 * - Reject changes > 1,000 (too-many)
 * - Enforce document limits via validateDocument
 */

import type { Document, Id } from '../studio/model.js';
import { validateDocument, type Issue } from '../studio/validate.js';
import { createIssue } from '../studio/issue.js';
import { isValidUuid } from '../studio/ids.js';
import { RECORD_KINDS, type RecordChange, type RecordKind } from '../studio/records.js';

export type ApplyRecordChangesResult =
  | {
      readonly ok: true;
      readonly document: Document;
      readonly changedIds: readonly Id[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly Issue[];
    };

export function applyRecordChanges(
  currentDocument: Document,
  changes: readonly RecordChange[],
): ApplyRecordChangesResult {
  const issues: Issue[] = [];

  if (!Array.isArray(changes)) {
    return {
      ok: false,
      issues: [createIssue('wrong-type', 'payload.changes must be an array', ['payload', 'changes'])],
    };
  }

  if (changes.length > 1000) {
    return {
      ok: false,
      issues: [
        createIssue(
          'too-many',
          `payload.changes exceeds maximum limit of 1,000 changes (got ${changes.length})`,
          ['payload', 'changes'],
        ),
      ],
    };
  }

  // Clone document collections
  const elements = [...currentDocument.elements];
  const connections = [...currentDocument.connections];
  const relations = [...currentDocument.relations];
  const schemas = [...currentDocument.schemas];
  const fixtures = [...currentDocument.fixtures];
  const refinements = [...currentDocument.refinements];
  const scenarios = [...currentDocument.scenarios];
  const views = [...currentDocument.views];

  const collections: Record<RecordKind, { id: Id }[]> = {
    element: elements,
    connection: connections,
    relation: relations,
    schema: schemas,
    fixture: fixtures,
    refinement: refinements,
    scenario: scenarios,
    view: views,
  };

  const targetIds = new Set<string>();
  const targetKeys = new Set<string>();

  // Pass 1: Validate changes structure, IDs, recordKinds, duplicate targets
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const path = ['payload', 'changes', i];

    if (!change || typeof change !== 'object') {
      issues.push(createIssue('wrong-type', 'Each change must be an object', path));
      continue;
    }

    if (change.kind !== 'insert' && change.kind !== 'replace' && change.kind !== 'remove') {
      issues.push(
        createIssue(
          'invalid-literal',
          `Unknown change kind: ${String((change as { kind?: unknown }).kind)}; expected 'insert', 'replace', or 'remove'`,
          [...path, 'kind'],
        ),
      );
      continue;
    }

    let recordKind: RecordKind;
    let targetId: Id;
    let recordObj: { id?: unknown } | null = null;

    if (change.kind === 'remove') {
      recordKind = change.recordKind;
      targetId = change.id;
    } else {
      // insert or replace
      if (!change.value || typeof change.value !== 'object') {
        issues.push(createIssue('missing-property', 'change.value is required for insert/replace', [...path, 'value']));
        continue;
      }
      recordKind = change.value.recordKind;
      recordObj = change.value.record as { id?: unknown };
      if (!recordObj || typeof recordObj !== 'object') {
        issues.push(createIssue('missing-property', 'change.value.record is required', [...path, 'value', 'record']));
        continue;
      }
      targetId = recordObj.id as Id;
    }

    // Validate recordKind
    if (!RECORD_KINDS.includes(recordKind)) {
      issues.push(
        createIssue(
          'invalid-literal',
          `Unknown recordKind: ${String(recordKind)}; must be one of ${RECORD_KINDS.join(', ')}`,
          change.kind === 'remove' ? [...path, 'recordKind'] : [...path, 'value', 'recordKind'],
        ),
      );
      continue;
    }

    // Validate ID
    if (!isValidUuid(targetId)) {
      issues.push(
        createIssue(
          'invalid-id',
          `Record ID must be a canonical lowercase UUID: ${String(targetId)}`,
          change.kind === 'remove' ? [...path, 'id'] : [...path, 'value', 'record', 'id'],
          typeof targetId === 'string' ? targetId : null,
        ),
      );
      continue;
    }

    // Duplicate target within changes
    const targetKey = `${recordKind}:${targetId}`;
    if (targetKeys.has(targetKey) || targetIds.has(targetId)) {
      issues.push(
        createIssue(
          'duplicate-id',
          `Duplicate target for change: ${recordKind} with ID ${targetId}`,
          path,
          targetId,
        ),
      );
    }
    targetKeys.add(targetKey);
    targetIds.add(targetId);

    // Check targets against existing collections
    const collection = collections[recordKind];
    const existingIndex = collection.findIndex((item) => item.id === targetId);

    if (change.kind === 'insert') {
      if (existingIndex !== -1) {
        issues.push(
          createIssue(
            'duplicate-id',
            `Cannot insert: record with ID ${targetId} already exists in ${recordKind}s`,
            path,
            targetId,
          ),
        );
      }
    } else if (change.kind === 'replace') {
      if (existingIndex === -1) {
        issues.push(
          createIssue(
            'dangling-reference',
            `Cannot replace: target record with ID ${targetId} not found in ${recordKind}s`,
            path,
            targetId,
          ),
        );
      }
    } else if (change.kind === 'remove') {
      if (existingIndex === -1) {
        issues.push(
          createIssue(
            'dangling-reference',
            `Cannot remove: target record with ID ${targetId} not found in ${recordKind}s`,
            path,
            targetId,
          ),
        );
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // Pass 2: Apply changes
  const changedIds: Id[] = [];
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (change.kind === 'insert') {
      const recordKind: RecordKind = change.value.recordKind;
      const record = change.value.record as { id: Id };
      const targetCollection = collections[recordKind];
      targetCollection.push(record);
      changedIds.push(record.id);
    } else if (change.kind === 'replace') {
      const recordKind: RecordKind = change.value.recordKind;
      const record = change.value.record as { id: Id };
      const targetCollection = collections[recordKind];
      const idx = targetCollection.findIndex((item: { id: Id }) => item.id === record.id);
      targetCollection[idx] = record;
      changedIds.push(record.id);
    } else if (change.kind === 'remove') {
      const recordKind: RecordKind = change.recordKind;
      const id = change.id;
      const targetCollection = collections[recordKind];
      const idx = targetCollection.findIndex((item: { id: Id }) => item.id === id);
      targetCollection.splice(idx, 1);
      changedIds.push(id);
    }
  }

  const candidateDocument: Document = {
    ...currentDocument,
    elements: elements as any,
    connections: connections as any,
    relations: relations as any,
    schemas: schemas as any,
    fixtures: fixtures as any,
    refinements: refinements as any,
    scenarios: scenarios as any,
    views: views as any,
  };

  // Pass 3: Validate candidate document with storable validator
  const docValidation = validateDocument(candidateDocument);
  if (!docValidation.ok) {
    return { ok: false, issues: docValidation.issues };
  }

  return {
    ok: true,
    document: docValidation.document,
    changedIds: Array.from(new Set(changedIds)),
  };
}

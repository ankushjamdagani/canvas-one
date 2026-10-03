/**
 * Draft lifecycle (RV-05b).
 *
 * Implements specs/revamp/contracts/commands.md §6 "Draft lifecycle" and
 * specs/revamp/contracts/transactions.md §3 "Inspector Apply":
 * - openDraft/changeField/validateDraft/applyDraft/cancelDraft are the only bridge
 *   methods; field IDs are schema-owned (fields.ts); raw strings (including
 *   incomplete ones) never enter the Document until a successful Apply.
 * - Apply parses the whole draft, checks target existence, cross-references and
 *   revision, then submits ONE compound command = one undo entry.
 * - Invalid or stale Apply keeps the draft (fields stay); stale never silently
 *   rebases; a deleted target keeps its text until discarded.
 * - Cancel discards the draft and reloads accepted values.
 *
 * openDraft/changeField/validateDraft/cancelDraft are pure (Document in, DraftHandle
 * out). applyDraft is the one orchestration point that talks to the session, but it
 * depends only on the narrow `DraftSession` shape in types.ts so it stays testable
 * against a fake.
 */

import type { Connection, Document, Element, Id } from '../../domain/studio/model';
import { describeConnection } from '../../domain/studio/connection-label';
import type { RecordChange } from '../../persistence/studio/types';
import { fieldsForConnection, fieldsForElement, kindTagForConnection, kindTagForElement } from './fields';
import type {
  ApplyDraftResult,
  DraftHandle,
  DraftSession,
  DraftTarget,
  FieldSpec,
  ValidateDraftResult,
} from './types';

function findElement(document: Document, id: Id): Element | null {
  return document.elements.find((e) => e.id === id) ?? null;
}

function findConnection(document: Document, id: Id): Connection | null {
  return document.connections.find((c) => c.id === id) ?? null;
}

import { getCatalogLayer, CATALOG_LAYER_COLORS, type CatalogLayer } from '../workspace/projection';

function buildFieldsAndLabel(
  target: DraftTarget,
  document: Document,
): {
  readonly fields: readonly FieldSpec[];
  readonly record: Element | Connection | null;
  readonly label: string;
  readonly kindTag: string;
  readonly notSimulated: boolean;
  readonly layer: CatalogLayer | null;
  readonly stripeColor: string | null;
} {
  if (target.kind === 'element') {
    const record = findElement(document, target.ids[0]);
    if (!record) return { fields: [], record: null, label: '', kindTag: '', notSimulated: false, layer: null, stripeColor: null };
    const { tag, notSimulated } = kindTagForElement(record);
    const layer = getCatalogLayer(record.visualKind);
    const stripeColor = layer ? CATALOG_LAYER_COLORS[layer] : null;
    return { fields: fieldsForElement(record), record, label: record.label, kindTag: tag, notSimulated, layer, stripeColor };
  }
  const record = findConnection(document, target.ids[0]);
  if (!record) return { fields: [], record: null, label: '', kindTag: '', notSimulated: false, layer: null, stripeColor: null };
  return {
    fields: fieldsForConnection(record),
    record,
    label: describeConnection(document, record),
    kindTag: kindTagForConnection(record),
    notSimulated: false,
    layer: null,
    stripeColor: null,
  };
}

/**
 * Opens a draft for `target` against `document` (the session's current working
 * Document at `baseWorkingRevision`). commands.md §5: "An empty target is rejected" —
 * callers must not pass `target.ids.length === 0`.
 */
export function openDraft(
  draftId: Id,
  target: DraftTarget,
  baseWorkingRevision: number,
  document: Document,
): DraftHandle {
  if (target.ids.length === 0) {
    throw new Error('inspector.open: an empty target is rejected');
  }

  const multi = target.ids.length > 1;

  if (multi) {
    return Object.freeze({
      draftId,
      target,
      baseWorkingRevision,
      baseValues: {},
      fields: [],
      values: {},
      dirty: false,
      issues: {},
      status: 'clean',
      missing: false,
      multi: true,
      count: target.ids.length,
      label: `${target.ids.length} selected`,
      kindTag: '',
      notSimulated: false,
    });
  }

  const { fields, record, label, kindTag, notSimulated, layer, stripeColor } = buildFieldsAndLabel(target, document);

  if (!record) {
    return Object.freeze({
      draftId,
      target,
      baseWorkingRevision,
      baseValues: {},
      fields: [],
      values: {},
      dirty: false,
      issues: {},
      status: 'stale',
      missing: true,
      multi: false,
      count: 1,
      label: 'Deleted',
      kindTag: '',
      notSimulated: false,
      layer: null,
      stripeColor: null,
    });
  }

  const baseValues: Record<string, string> = {};
  for (const field of fields) {
    baseValues[field.id] = field.toRaw(record as never);
  }

  return Object.freeze({
    draftId,
    target,
    baseWorkingRevision,
    baseValues: Object.freeze({ ...baseValues }),
    fields,
    values: Object.freeze({ ...baseValues }),
    dirty: false,
    issues: {},
    status: 'clean',
    missing: false,
    multi: false,
    count: 1,
    label,
    kindTag,
    notSimulated,
    layer,
    stripeColor,
  });
}

function computeDirty(baseValues: Readonly<Record<string, string>>, values: Readonly<Record<string, string>>): boolean {
  for (const key of Object.keys(values)) {
    if (values[key] !== baseValues[key]) return true;
  }
  return false;
}

/**
 * commands.md §6: "The only bridge methods are changeField(fieldId, rawValue) ...
 * Raw strings (including incomplete ones) never enter the Document."
 */
export function changeField(handle: DraftHandle, fieldId: string, rawValue: string): DraftHandle {
  if (handle.missing || handle.multi) return handle;
  const values = { ...handle.values, [fieldId]: rawValue };
  const { [fieldId]: _removed, ...remainingIssues } = handle.issues;
  const dirty = computeDirty(handle.baseValues, values);
  return Object.freeze({
    ...handle,
    values: Object.freeze(values),
    issues: Object.freeze(remainingIssues),
    dirty,
    status: dirty ? 'editing' : 'clean',
  });
}

/**
 * Parses every field with its schema-owned parser and reports per-field issues.
 */
export function validateDraft(handle: DraftHandle): ValidateDraftResult {
  if (handle.missing || handle.multi) {
    return { handle, firstInvalidFieldId: null };
  }

  const issues: Record<string, string> = {};
  let firstInvalidFieldId: string | null = null;

  for (const field of handle.fields) {
    if (field.kind === 'readonly') continue;
    const raw = handle.values[field.id] ?? '';
    const result = field.parse(raw);
    if (!result.ok) {
      issues[field.id] = result.message;
      if (firstInvalidFieldId === null) firstInvalidFieldId = field.id;
    }
  }

  const dirty = computeDirty(handle.baseValues, handle.values);
  const status = firstInvalidFieldId ? 'invalid' : dirty ? 'editing' : 'clean';

  return {
    handle: Object.freeze({ ...handle, issues: Object.freeze(issues), dirty, status }),
    firstInvalidFieldId,
  };
}

/**
 * commands.md §6 Cancel: "discards the draft and reloads accepted values."
 */
export function cancelDraft(handle: DraftHandle): DraftHandle {
  return Object.freeze({
    ...handle,
    values: handle.baseValues,
    issues: Object.freeze({}),
    dirty: false,
    status: handle.missing ? 'stale' : 'clean',
  });
}

function buildChangedRecord(handle: DraftHandle, currentRecord: Element | Connection): Element | Connection {
  let record = currentRecord;
  for (const field of handle.fields) {
    if (field.kind === 'readonly') continue;
    const raw = handle.values[field.id] ?? '';
    if (raw === handle.baseValues[field.id]) continue; // only changed fields (transactions.md §3)
    const parsed = field.parse(raw);
    if (!parsed.ok) continue; // validateDraft() gates this before we get here
    record = field.apply(record as never, parsed.value) as Element | Connection;
  }
  return record;
}

/**
 * transactions.md §3: "Opening a draft captures {..., baseWorkingRevision, baseValues}.
 * Apply parses the whole draft, checks target existence, cross-references and revision,
 * then submits one compound command = one undo entry." Multi-target drafts have no
 * fields yet (RV-05b: no bulk editing), so applyDraft is a no-op for them.
 */
export async function applyDraft(handle: DraftHandle, session: DraftSession): Promise<ApplyDraftResult> {
  if (handle.multi) {
    return { handle, firstInvalidFieldId: null };
  }

  const validated = validateDraft(handle);
  if (validated.firstInvalidFieldId) {
    return { handle: { ...validated.handle, status: 'invalid' }, firstInvalidFieldId: validated.firstInvalidFieldId };
  }

  if (!validated.handle.dirty) {
    // Nothing changed: treat as a clean close, no command submitted.
    return { handle: { ...validated.handle, status: 'clean' }, firstInvalidFieldId: null };
  }

  const sessionState = session.getState();

  // Stale: the working revision moved under the draft (commands.md §6: "never
  // silently rebases" — Reload/Keep editing/Cancel navigation is the caller's UI).
  if (sessionState.workingRevision === null || sessionState.workingRevision !== handle.baseWorkingRevision) {
    return {
      handle: Object.freeze({ ...validated.handle, status: 'stale' }),
      firstInvalidFieldId: null,
    };
  }

  const document = sessionState.document;
  if (!document) {
    return { handle: Object.freeze({ ...validated.handle, status: 'stale', missing: true }), firstInvalidFieldId: null };
  }

  const currentRecord =
    handle.target.kind === 'element'
      ? findElement(document, handle.target.ids[0])
      : findConnection(document, handle.target.ids[0]);

  if (!currentRecord) {
    // Target deleted elsewhere: stale/missing, text kept (commands.md §6).
    return {
      handle: Object.freeze({ ...validated.handle, status: 'stale', missing: true }),
      firstInvalidFieldId: null,
    };
  }

  const updatedRecord = buildChangedRecord(validated.handle, currentRecord);

  const change: RecordChange =
    handle.target.kind === 'element'
      ? { kind: 'replace', value: { recordKind: 'element', record: updatedRecord as Element } }
      : { kind: 'replace', value: { recordKind: 'connection', record: updatedRecord as Connection } };

  const label = `Edit ${(updatedRecord as { label: string }).label || handle.label}`;

  const savingHandle = Object.freeze({ ...validated.handle, status: 'saving' as const });
  const result = await session.apply([change], label);

  if (result.status === 'applied') {
    const acceptedValues = { ...validated.handle.values };
    const newWorkingRevision = session.getState().workingRevision;
    if (newWorkingRevision === null) {
      // Contract violation: a successful apply-records result always leaves the
      // session with a numeric workingRevision. Falling back to the pre-apply
      // revision here would silently under-report it, so the *next* Apply would
      // be wrongly treated as stale even though nothing raced it.
      throw new Error(
        'Contract violation: session.getState().workingRevision is null after an applied inspector edit',
      );
    }
    // Some fields depend on the record (e.g. retry details appear once a call has a retry
    // policy, D49), so the field list is rebuilt from the applied record. Accepted values
    // stay as typed; fields that just appeared take the record's value.
    const refreshedFields =
      handle.target.kind === 'element'
        ? fieldsForElement(updatedRecord as Element)
        : fieldsForConnection(updatedRecord as Connection);
    for (const field of refreshedFields) {
      if (!(field.id in acceptedValues)) acceptedValues[field.id] = field.toRaw(updatedRecord as never);
    }
    for (const id of Object.keys(acceptedValues)) {
      if (!refreshedFields.some((f) => f.id === id)) delete acceptedValues[id];
    }
    const clean = Object.freeze({
      ...savingHandle,
      fields: refreshedFields,
      baseWorkingRevision: newWorkingRevision,
      baseValues: Object.freeze(acceptedValues),
      values: Object.freeze(acceptedValues),
      dirty: false,
      issues: Object.freeze({}),
      status: 'clean' as const,
    });
    return { handle: clean, firstInvalidFieldId: null };
  }

  if (result.status === 'stale') {
    return { handle: Object.freeze({ ...savingHandle, status: 'stale' }), firstInvalidFieldId: null };
  }

  if (result.status === 'missing') {
    return { handle: Object.freeze({ ...savingHandle, status: 'stale', missing: true }), firstInvalidFieldId: null };
  }

  if (result.status === 'invalid') {
    // Map issues to fields by matching the last path segment to a field id where
    // possible; anything unmatched still fails the Apply via the general message.
    const issues: Record<string, string> = {};
    let first: string | null = null;
    for (const issue of result.issues) {
      const last = issue.path[issue.path.length - 1];
      const fieldId = validated.handle.fields.find((f) => f.id === last || f.id.endsWith(String(last)))?.id;
      if (fieldId) {
        issues[fieldId] = issue.message;
        if (first === null) first = fieldId;
      }
    }
    return {
      handle: Object.freeze({ ...savingHandle, status: 'invalid', issues: Object.freeze(issues) }),
      firstInvalidFieldId: first,
    };
  }

  // failed (quota/unavailable/etc.): keep the draft, surface a general issue.
  return {
    handle: Object.freeze({
      ...savingHandle,
      status: 'invalid',
      issues: Object.freeze({ __general: 'Could not save. Try again.' }),
    }),
    firstInvalidFieldId: null,
  };
}

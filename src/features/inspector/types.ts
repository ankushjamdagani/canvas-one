/**
 * Inspector draft types: DraftTarget, field specs and DraftHandle.
 *
 * SCOPE: only `DraftTarget.kind` values `'element'` and `'connection'` are supported here;
 * scenario, workload and selection targets belong to other inspector tabs.
 */

import type { Connection, Document, Element, Id, Json } from '../../domain/studio/model';

// ============================================================================
// DraftTarget
// ============================================================================

export type InspectorTargetKind = 'element' | 'connection';

export type DraftTarget = {
  readonly kind: InspectorTargetKind;
  readonly ids: readonly Id[];
};

// ============================================================================
// Fields (field IDs are schema-owned)
// ============================================================================

export type FieldKind = 'text' | 'textarea' | 'number' | 'select' | 'readonly';

export type FieldOption = {
  readonly value: string;
  readonly label: string;
};

export type FieldParseResult =
  | { readonly ok: true; readonly value: Json }
  | { readonly ok: false; readonly message: string };

/**
 * One editable (or read-only) field on the currently open single-target draft.
 * `TRecord` is `Element` or `Connection` depending on the target kind; draft.ts
 * always pairs a field list built for one kind with a record of that same kind.
 */
export type FieldSpec<TRecord = Element | Connection> = {
  readonly id: string;
  readonly label: string;
  readonly kind: FieldKind;
  /** Rows with the same group are shown under one sub-heading (port settings). */
  readonly group?: string;
  readonly unit?: string;
  readonly options?: readonly FieldOption[];
  /** Static explanatory text shown under a readonly field (e.g. "Editing arrives later"). */
  readonly note?: string;
  // Method syntax (not arrow-typed properties) so a FieldSpec<Element> or
  // FieldSpec<Connection> list is still assignable to FieldSpec[] (bivariant
  // parameter checking) -- draft.ts stores one concrete kind's fields per open
  // draft and never actually calls a field with the other record type.
  toRaw(record: TRecord): string;
  parse(raw: string): FieldParseResult;
  apply(record: TRecord, value: Json): TRecord;
};

// ============================================================================
// DraftHandle
// ============================================================================

export type DraftStatus =
  | 'clean'
  | 'editing'
  | 'validating'
  | 'saving'
  | 'invalid'
  | 'stale';

export type DraftHandle = {
  readonly draftId: Id;
  readonly target: DraftTarget;
  readonly baseWorkingRevision: number;
  /** Raw string per field id, captured when the draft was opened or last accepted. */
  readonly baseValues: Readonly<Record<string, string>>;
  /** Empty for a multi-target draft ("n selected", no bulk editing yet). */
  readonly fields: readonly FieldSpec[];
  readonly values: Readonly<Record<string, string>>;
  readonly dirty: boolean;
  /** fieldId -> message. Populated by validateDraft() / a failed applyDraft(). */
  readonly issues: Readonly<Record<string, string>>;
  readonly status: DraftStatus;
  /** True once the target record could not be found in the current document. */
  readonly missing: boolean;
  readonly multi: boolean;
  readonly count: number;
  readonly label: string;
  readonly kindTag: string;
  readonly notSimulated: boolean;
  readonly layer?: import('../workspace/projection').CatalogLayer | null;
  readonly stripeColor?: string | null;
};

export type ValidateDraftResult = {
  readonly handle: DraftHandle;
  readonly firstInvalidFieldId: string | null;
};

/**
 * Minimal session shape applyDraft() depends on, narrowed so
 * draft.ts stays testable against a fake without importing SessionController.
 */
export type DraftSession = {
  getState: () => {
    readonly workingRevision: number | null;
    readonly document: Document | null;
  };
  apply: (
    changes: readonly import('../../persistence/studio/types').RecordChange[],
    label: string,
  ) => Promise<import('../../persistence/studio/types').AuthoredResult>;
};

export type ApplyDraftResult = {
  readonly handle: DraftHandle;
  readonly firstInvalidFieldId: string | null;
};

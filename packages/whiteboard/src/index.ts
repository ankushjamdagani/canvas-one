/** Attribution is parameterized so a consumer explicitly chooses supported actor kinds. */
export type Actor<Kind extends string = string> = {
  readonly actorId: string;
  readonly kind: Kind;
  readonly displayName: string;
};

export type ValidationIssue<Code extends string = string> = {
  readonly code: Code;
  readonly path: readonly (string | number)[];
  readonly entityId: string | null;
  readonly severity: 'error' | 'warning';
  readonly message: string;
};

/** Copy the location so subsequent mutation of the caller's path cannot change this issue. */
export function createIssue<Code extends string>(
  code: Code,
  message: string,
  path: readonly (string | number)[] = [],
  entityId: string | null = null,
  severity: ValidationIssue['severity'] = 'error',
): ValidationIssue<Code> {
  return { code, path: [...path], entityId, severity, message };
}

export type RecordMapConstraint<M> = { readonly [K in keyof M]: { readonly id: string } };
export type RecordKind<M> = Extract<keyof M, string>;
export type EditableRecord<M extends RecordMapConstraint<M>> = {
  [K in RecordKind<M>]: { readonly recordKind: K; readonly record: M[K] }
}[RecordKind<M>];
export type RecordChange<M extends RecordMapConstraint<M>> =
  | { readonly kind: 'insert'; readonly value: EditableRecord<M> }
  | { readonly kind: 'replace'; readonly value: EditableRecord<M> }
  | { readonly kind: 'remove'; readonly recordKind: RecordKind<M>; readonly id: string };

export type MissingPriorRecord<M> = {
  readonly index: number;
  readonly recordKind: RecordKind<M>;
  readonly id: string;
};
export type InvertRecordChangesResult<M extends RecordMapConstraint<M>> =
  | { readonly ok: true; readonly changes: readonly RecordChange<M>[] }
  | { readonly ok: false; readonly missing: readonly MissingPriorRecord<M>[] };
export type PriorRecordLookup<M extends RecordMapConstraint<M>> = (
  recordKind: RecordKind<M>, id: string,
) => EditableRecord<M> | null;

// A standard runtime API in Node and modern browsers; no DOM type dependency.
declare const structuredClone: <T>(value: T) => T;

/**
 * Invert against one immutable pre-transaction record set. Lookup must return the
 * requested kind/id and structured-cloneable authored data. This does not validate
 * commands or simulate intermediate writes; the authoring validator owns those rules.
 */
export function invertRecordChanges<M extends RecordMapConstraint<M>>(
  changes: readonly RecordChange<M>[],
  lookup: PriorRecordLookup<M>,
): InvertRecordChangesResult<M> {
  const missing: MissingPriorRecord<M>[] = [];
  const inverse: RecordChange<M>[] = [];
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (change.kind === 'insert') {
      inverse.push({ kind: 'remove', recordKind: change.value.recordKind, id: change.value.record.id });
      continue;
    }
    const recordKind = change.kind === 'remove' ? change.recordKind : change.value.recordKind;
    const id = change.kind === 'remove' ? change.id : change.value.record.id;
    const prior = lookup(recordKind, id);
    if (prior === null) {
      missing.push({ index, recordKind, id });
    } else {
      inverse.push({ kind: change.kind === 'remove' ? 'insert' : 'replace', value: structuredClone(prior) });
    }
  }
  return missing.length ? { ok: false, missing } : { ok: true, changes: inverse.reverse() };
}

export * from './document.js';
export * from './runtime.js';
export * from './extensions.js';
export * from './editor.js';
export * from './planners.js';

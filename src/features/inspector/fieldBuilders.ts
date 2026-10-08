/**
 * Generic inspector field builders, shared by the element, port and connection fields.
 */

import type { FieldOption, FieldParseResult, FieldSpec } from './types';

export function parseTrimmedString(raw: string, min: number, max: number, name: string): FieldParseResult {
  const value = raw;
  const codePoints = Array.from(value).length;
  if (codePoints < min) {
    return {
      ok: false,
      message: min === 1 ? `${name} is required` : `${name} must be at least ${min} characters`,
    };
  }
  if (codePoints > max) {
    return { ok: false, message: `${name} must be ${max} characters or fewer` };
  }
  return { ok: true, value };
}

export function parseNumber(
  raw: string,
  min: number,
  max: number,
  name: string,
  opts: { readonly integer?: boolean; readonly minExclusive?: boolean } = {},
): FieldParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, message: `${name} is required` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, message: `${name} must be a number` };
  }
  if (opts.integer && !Number.isSafeInteger(value)) {
    return { ok: false, message: `${name} must be a whole number` };
  }
  const tooSmall = opts.minExclusive ? value <= min : value < min;
  if (tooSmall || value > max) {
    const range = opts.minExclusive ? `(${min}, ${max}]` : `[${min}, ${max}]`;
    return { ok: false, message: `${name} must be in range ${range}` };
  }
  return { ok: true, value };
}

export function textField<TRecord>(opts: {
  readonly id: string;
  readonly label: string;
  readonly kind?: 'text' | 'textarea';
  readonly min: number;
  readonly max: number;
  readonly get: (record: TRecord) => string;
  readonly set: (record: TRecord, value: string) => TRecord;
}): FieldSpec<TRecord> {
  return {
    id: opts.id,
    label: opts.label,
    kind: opts.kind ?? 'text',
    toRaw: opts.get,
    parse: (raw) => parseTrimmedString(raw, opts.min, opts.max, opts.label),
    apply: (record, value) => opts.set(record, value as string),
  };
}

export function numberField<TRecord>(opts: {
  readonly id: string;
  readonly label: string;
  readonly unit?: string;
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
  readonly minExclusive?: boolean;
  readonly get: (record: TRecord) => number;
  readonly set: (record: TRecord, value: number) => TRecord;
}): FieldSpec<TRecord> {
  return {
    id: opts.id,
    label: opts.label,
    kind: 'number',
    unit: opts.unit,
    toRaw: (record) => String(opts.get(record)),
    parse: (raw) =>
      parseNumber(raw, opts.min, opts.max, opts.label, {
        integer: opts.integer,
        minExclusive: opts.minExclusive,
      }),
    apply: (record, value) => opts.set(record, value as number),
  };
}

export function selectField<TRecord>(opts: {
  readonly id: string;
  readonly label: string;
  readonly options: readonly FieldOption[];
  readonly get: (record: TRecord) => string;
  readonly set: (record: TRecord, value: string) => TRecord;
}): FieldSpec<TRecord> {
  const validValues = new Set(opts.options.map((o) => o.value));
  return {
    id: opts.id,
    label: opts.label,
    kind: 'select',
    options: opts.options,
    toRaw: opts.get,
    parse: (raw) =>
      validValues.has(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: `${opts.label} must be one of ${[...validValues].join(', ')}` },
    apply: (record, value) => opts.set(record, value as string),
  };
}

export function readonlyField<TRecord>(id: string, label: string, text: string, note?: string): FieldSpec<TRecord> {
  return {
    id,
    label,
    kind: 'readonly',
    note,
    toRaw: () => text,
    parse: () => ({ ok: true, value: text }),
    apply: (record) => record,
  };
}

/** A number that may be unset: blank means "not set", and applying it removes the setting. */
export function optionalNumberField<TRecord>(opts: {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly unit?: string;
  readonly note?: string;
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
  readonly minExclusive?: boolean;
  readonly get: (record: TRecord) => number | undefined;
  readonly set: (record: TRecord, value: number | null) => TRecord;
}): FieldSpec<TRecord> {
  return {
    id: opts.id,
    label: opts.label,
    group: opts.group,
    kind: 'number',
    unit: opts.unit,
    note: opts.note,
    toRaw: (record) => {
      const value = opts.get(record);
      return value === undefined ? '' : String(value);
    },
    parse: (raw) =>
      raw.trim() === ''
        ? { ok: true, value: null }
        : parseNumber(raw, opts.min, opts.max, opts.label, { integer: opts.integer, minExclusive: opts.minExclusive }),
    apply: (record, value) => opts.set(record, value as number | null),
  };
}

/** A choice that may be unset ('' = not set). */
export function optionalSelectField<TRecord>(opts: {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly note?: string;
  readonly options: readonly FieldOption[];
  readonly get: (record: TRecord) => string | undefined;
  readonly set: (record: TRecord, value: string | null) => TRecord;
}): FieldSpec<TRecord> {
  const valid = new Set(opts.options.map((o) => o.value));
  return {
    id: opts.id,
    label: opts.label,
    group: opts.group,
    kind: 'select',
    note: opts.note,
    options: [{ value: '', label: 'Not set' }, ...opts.options],
    toRaw: (record) => opts.get(record) ?? '',
    parse: (raw) =>
      raw === '' ? { ok: true, value: null } : valid.has(raw) ? { ok: true, value: raw } : { ok: false, message: `${opts.label} must be one of ${[...valid].join(', ')}` },
    apply: (record, value) => opts.set(record, value as string | null),
  };
}

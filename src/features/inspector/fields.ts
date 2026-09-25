/**
 * Field mapping per inspector target (RV-05b).
 *
 * Builds the CONFIGURATION section's FieldSpec[] for a single Element or Connection,
 * per specs/revamp/contracts/model-and-runner.md §2 (Element, Port, Connection) and
 * §4 (Behaviors, ResourceConfig, connection configs). Numeric bounds are copied
 * verbatim from src/domain/studio/validate.ts's storable validator (the "schema-owned
 * parser" the brief requires) rather than re-derived, so a draft can never Apply a
 * value the storable validator would then reject.
 *
 * Only `resource` behaviors get editable configuration fields; `machine` / `pipeline`
 * / `decision` / `host` show a read-only summary ("Editing arrives later" — their
 * editors are separate tasks per the brief) and `unmodeled` shows a "Not simulated"
 * note plus an editable reason. Connection `data` config is `{}` — no fields besides
 * label.
 */

import type {
  CallConnection,
  Connection,
  Element,
  Json,
  MessageConnection,
  ResourceConfig,
} from '../../domain/studio/model';
import type { FieldOption, FieldParseResult, FieldSpec } from './types';

// ============================================================================
// Generic field builders
// ============================================================================

function parseTrimmedString(raw: string, min: number, max: number, name: string): FieldParseResult {
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

function parseNumber(
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

function textField<TRecord>(opts: {
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

function numberField<TRecord>(opts: {
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

function selectField<TRecord>(opts: {
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

function readonlyField<TRecord>(id: string, label: string, text: string, note?: string): FieldSpec<TRecord> {
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

// ============================================================================
// Element fields
// ============================================================================

const LABEL_FIELD_ID = 'label';
const DESCRIPTION_FIELD_ID = 'description';

function elementLabelDescriptionFields(): readonly FieldSpec<Element>[] {
  return [
    textField<Element>({
      id: LABEL_FIELD_ID,
      label: 'Name',
      min: 1,
      max: 80,
      get: (el) => el.label,
      set: (el, value) => ({ ...el, label: value }),
    }),
    textField<Element>({
      id: DESCRIPTION_FIELD_ID,
      label: 'Description',
      kind: 'textarea',
      min: 0,
      max: 4000,
      get: (el) => el.description,
      set: (el, value) => ({ ...el, description: value }),
    }),
  ];
}

function resourceConfigFields(element: Element): readonly FieldSpec<Element>[] {
  const behavior = element.behavior;
  if (behavior.kind !== 'resource') return [];

  const withConfig = (
    el: Element,
    patch: (config: ResourceConfig) => ResourceConfig,
  ): Element => {
    if (el.behavior.kind !== 'resource') return el;
    return { ...el, behavior: { ...el.behavior, config: patch(el.behavior.config) } };
  };

  const common: FieldSpec<Element>[] = [
    numberField<Element>({
      id: 'config.capacity',
      label: 'Capacity per slot',
      unit: '/s',
      min: 1,
      max: 100000,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.capacity : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, capacity: value })),
    }),
    numberField<Element>({
      id: 'config.concurrency',
      label: 'Concurrency',
      min: 1,
      max: 16,
      integer: true,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.concurrency : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, concurrency: value })),
    }),
    numberField<Element>({
      id: 'config.queueLimit',
      label: 'Queue limit',
      min: 0,
      max: 10000,
      integer: true,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.queueLimit : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, queueLimit: value })),
    }),
    numberField<Element>({
      id: 'config.failureRate',
      label: 'Failure rate',
      unit: '%',
      min: 0,
      max: 100,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.failureRate : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, failureRate: value })),
    }),
    numberField<Element>({
      id: 'config.maxRetries',
      label: 'Max retries',
      min: 0,
      max: 5,
      integer: true,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.maxRetries : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, maxRetries: value })),
    }),
    numberField<Element>({
      id: 'config.retryDelayMs',
      label: 'Retry delay',
      unit: 'ms',
      min: 0,
      max: 10000,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.retryDelayMs : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, retryDelayMs: value })),
    }),
  ];

  const config = behavior.config;
  const variant: FieldSpec<Element>[] = [];

  if (config.type === 'storage') {
    variant.push(
      numberField<Element>({
        id: 'config.writeCapacity',
        label: 'Write capacity',
        unit: '/s',
        min: 1,
        max: 100000,
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'storage' ? el.behavior.config.writeCapacity : 0),
        set: (el, value) =>
          withConfig(el, (c) => (c.type === 'storage' ? { ...c, writeCapacity: value } : c)),
      }),
    );
  } else if (config.type === 'router') {
    variant.push(
      selectField<Element>({
        id: 'config.strategy',
        label: 'Strategy',
        options: [
          { value: 'round-robin', label: 'Round robin' },
          { value: 'weighted', label: 'Weighted' },
          { value: 'conditional', label: 'Conditional' },
        ],
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'router' ? el.behavior.config.strategy : 'round-robin'),
        set: (el, value) =>
          withConfig(el, (c) =>
            c.type === 'router' ? { ...c, strategy: value as 'round-robin' | 'weighted' | 'conditional' } : c,
          ),
      }),
    );
  } else if (config.type === 'cache') {
    variant.push(
      selectField<Element>({
        id: 'config.mode',
        label: 'Mode',
        options: [
          { value: 'fixed', label: 'Fixed' },
          { value: 'lru', label: 'LRU' },
        ],
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'cache' ? el.behavior.config.mode : 'fixed'),
        set: (el, value) => withConfig(el, (c) => (c.type === 'cache' ? { ...c, mode: value as 'fixed' | 'lru' } : c)),
      }),
      numberField<Element>({
        id: 'config.hitRate',
        label: 'Hit rate',
        unit: '%',
        min: 0,
        max: 100,
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'cache' ? el.behavior.config.hitRate : 0),
        set: (el, value) => withConfig(el, (c) => (c.type === 'cache' ? { ...c, hitRate: value } : c)),
      }),
      numberField<Element>({
        id: 'config.entries',
        label: 'Entries',
        min: 1,
        max: 100000,
        integer: true,
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'cache' ? el.behavior.config.entries : 0),
        set: (el, value) => withConfig(el, (c) => (c.type === 'cache' ? { ...c, entries: value } : c)),
      }),
      numberField<Element>({
        id: 'config.ttlMs',
        label: 'TTL',
        unit: 'ms',
        min: 1,
        max: 3600000,
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'cache' ? el.behavior.config.ttlMs : 0),
        set: (el, value) => withConfig(el, (c) => (c.type === 'cache' ? { ...c, ttlMs: value } : c)),
      }),
    );
  } else if (config.type === 'broker') {
    variant.push(
      selectField<Element>({
        id: 'config.delivery',
        label: 'Delivery',
        options: [
          { value: 'competing', label: 'Competing' },
          { value: 'broadcast', label: 'Broadcast' },
        ],
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'broker' ? el.behavior.config.delivery : 'competing'),
        set: (el, value) =>
          withConfig(el, (c) => (c.type === 'broker' ? { ...c, delivery: value as 'competing' | 'broadcast' } : c)),
      }),
    );
  }

  return [...common, ...variant];
}

function behaviorFields(element: Element): readonly FieldSpec<Element>[] {
  const behavior = element.behavior;
  switch (behavior.kind) {
    case 'resource':
      return resourceConfigFields(element);
    case 'unmodeled':
      return [
        readonlyField<Element>('behavior.note', 'Behavior', 'Not simulated'),
        textField<Element>({
          id: 'behavior.reason',
          label: 'Reason',
          kind: 'textarea',
          min: 0,
          max: 4000,
          get: (el) => (el.behavior.kind === 'unmodeled' ? el.behavior.reason : ''),
          set: (el, value) =>
            el.behavior.kind === 'unmodeled' ? { ...el, behavior: { ...el.behavior, reason: value } } : el,
        }),
      ];
    case 'machine':
      return [
        readonlyField<Element>(
          'behavior.summary',
          'Behavior',
          `${behavior.states.length} state${behavior.states.length === 1 ? '' : 's'}`,
          'Editing arrives later',
        ),
      ];
    case 'pipeline':
      return [
        readonlyField<Element>(
          'behavior.summary',
          'Behavior',
          `${behavior.operations.length} step${behavior.operations.length === 1 ? '' : 's'}`,
          'Editing arrives later',
        ),
      ];
    case 'decision':
      return [
        readonlyField<Element>(
          'behavior.summary',
          'Behavior',
          `${behavior.cases.length} case${behavior.cases.length === 1 ? '' : 's'}`,
          'Editing arrives later',
        ),
      ];
    case 'host':
      return [readonlyField<Element>('behavior.summary', 'Behavior', 'Host', 'Editing arrives later')];
    default:
      return [];
  }
}

export function fieldsForElement(element: Element): readonly FieldSpec<Element>[] {
  return [...elementLabelDescriptionFields(), ...behaviorFields(element)];
}

/** Uppercase kind tag(s) for the inspector header, per D42 caption words. */
export function kindTagForElement(element: Element): { readonly tag: string; readonly notSimulated: boolean } {
  const behavior = element.behavior;
  switch (behavior.kind) {
    case 'unmodeled':
      return { tag: 'NOT SIMULATED', notSimulated: true };
    case 'resource':
      return { tag: behavior.config.type.toUpperCase(), notSimulated: false };
    case 'machine':
      return { tag: 'STATE MACHINE', notSimulated: false };
    case 'pipeline':
      return { tag: 'DATA PIPELINE', notSimulated: false };
    case 'decision':
      return { tag: 'DECISION', notSimulated: false };
    case 'host':
      return { tag: 'HOST', notSimulated: false };
    default:
      return { tag: element.visualKind.toUpperCase(), notSimulated: false };
  }
}

// ============================================================================
// Connection fields
// ============================================================================

function connectionLabelField(): FieldSpec<Connection> {
  return textField<Connection>({
    id: LABEL_FIELD_ID,
    label: 'Label',
    min: 1,
    max: 80,
    get: (c) => c.label,
    set: (c, value) => ({ ...c, label: value }),
  });
}

function callFields(): readonly FieldSpec<Connection>[] {
  const withConfig = (c: Connection, patch: (config: CallConnection['config']) => CallConnection['config']): Connection =>
    c.kind === 'call' ? { ...c, config: patch(c.config) } : c;

  const fields: FieldSpec<Connection>[] = [
    numberField<Connection>({
      id: 'config.latencyMs',
      label: 'Latency',
      unit: 'ms',
      min: 0,
      max: 60000,
      get: (c) => (c.kind === 'call' ? c.config.latencyMs : 0),
      set: (c, value) => withConfig(c, (cfg) => ({ ...cfg, latencyMs: value })),
    }),
    numberField<Connection>({
      id: 'config.returnLatencyMs',
      label: 'Return latency',
      unit: 'ms',
      min: 0,
      max: 60000,
      get: (c) => (c.kind === 'call' ? c.config.returnLatencyMs : 0),
      set: (c, value) => withConfig(c, (cfg) => ({ ...cfg, returnLatencyMs: value })),
    }),
    numberField<Connection>({
      id: 'config.weight',
      label: 'Weight',
      min: 0,
      max: 1e6,
      minExclusive: true,
      get: (c) => (c.kind === 'call' ? c.config.weight : 0),
      set: (c, value) => withConfig(c, (cfg) => ({ ...cfg, weight: value })),
    }),
  ];
  return [...fields, ...readOnlyRoutingFields((c) => (c.kind === 'call' ? c.config : null))];
}

function messageFields(): readonly FieldSpec<Connection>[] {
  const withConfig = (
    c: Connection,
    patch: (config: MessageConnection['config']) => MessageConnection['config'],
  ): Connection => (c.kind === 'message' ? { ...c, config: patch(c.config) } : c);

  const fields: FieldSpec<Connection>[] = [
    numberField<Connection>({
      id: 'config.latencyMs',
      label: 'Latency',
      unit: 'ms',
      min: 0,
      max: 60000,
      get: (c) => (c.kind === 'message' ? c.config.latencyMs : 0),
      set: (c, value) => withConfig(c, (cfg) => ({ ...cfg, latencyMs: value })),
    }),
    numberField<Connection>({
      id: 'config.ackDelayMs',
      label: 'Ack delay',
      unit: 'ms',
      min: 0,
      max: 60000,
      get: (c) => (c.kind === 'message' ? c.config.ackDelayMs : 0),
      set: (c, value) => withConfig(c, (cfg) => ({ ...cfg, ackDelayMs: value })),
    }),
    numberField<Connection>({
      id: 'config.messageTtlMs',
      label: 'Message TTL',
      unit: 'ms',
      min: 1,
      max: 3600000,
      get: (c) => (c.kind === 'message' ? c.config.messageTtlMs : 0),
      set: (c, value) => withConfig(c, (cfg) => ({ ...cfg, messageTtlMs: value })),
    }),
    numberField<Connection>({
      id: 'config.weight',
      label: 'Weight',
      min: 0,
      max: 1e6,
      minExclusive: true,
      get: (c) => (c.kind === 'message' ? c.config.weight : 0),
      set: (c, value) => withConfig(c, (cfg) => ({ ...cfg, weight: value })),
    }),
  ];
  return [...fields, ...readOnlyRoutingFields((c) => (c.kind === 'message' ? c.config : null))];
}

/**
 * Brief §2: "condition/fallback shown read-only if present, resource metadata
 * class/operation/deadline". Only rendered when the connection actually carries
 * that data — never a fabricated placeholder row.
 */
function readOnlyRoutingFields(
  getConfig: (c: Connection) => CallConnection['config'] | MessageConnection['config'] | null,
): readonly FieldSpec<Connection>[] {
  const fields: FieldSpec<Connection>[] = [];

  fields.push(
    readonlyField<Connection>('config.condition', 'Condition', ''),
  );
  fields[fields.length - 1] = {
    ...fields[fields.length - 1],
    toRaw: (c) => {
      const cfg = getConfig(c);
      if (!cfg || !cfg.condition) return '';
      return `${cfg.condition.field} = ${cfg.condition.value}`;
    },
  };

  fields.push(readonlyField<Connection>('config.fallback', 'Fallback route', ''));
  fields[fields.length - 1] = {
    ...fields[fields.length - 1],
    toRaw: (c) => {
      const cfg = getConfig(c);
      return cfg?.fallback ? 'Yes' : 'No';
    },
  };

  fields.push(readonlyField<Connection>('config.resource', 'Resource request', ''));
  fields[fields.length - 1] = {
    ...fields[fields.length - 1],
    toRaw: (c) => {
      const cfg = getConfig(c);
      if (!cfg || !cfg.resource) return '';
      const r = cfg.resource;
      return `${r.operation} · deadline ${r.deadlineDurationMs} ms`;
    },
  };

  // Drop rows with nothing to show (never render an empty read-only row).
  return fields.filter((f) => f.toRaw as unknown);
}

export function fieldsForConnection(connection: Connection): readonly FieldSpec<Connection>[] {
  const base = [connectionLabelField()];
  if (connection.kind === 'call') {
    return [...base, ...callFields().filter((f) => shouldShowReadonly(connection, f))];
  }
  if (connection.kind === 'message') {
    return [...base, ...messageFields().filter((f) => shouldShowReadonly(connection, f))];
  }
  return base;
}

function shouldShowReadonly(connection: Connection, field: FieldSpec<Connection>): boolean {
  if (field.kind !== 'readonly') return true;
  const raw = field.toRaw(connection);
  return raw !== '';
}

export function kindTagForConnection(connection: Connection): string {
  return connection.kind.toUpperCase();
}

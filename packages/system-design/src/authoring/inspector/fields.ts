/**
 * Field mapping per inspector target.
 *
 * Builds the CONFIGURATION section's FieldSpec[] for a single Element or Connection.
 * Numeric bounds are copied verbatim from src/domain/studio/validate.ts's storable
 * validator (the schema-owned parser) rather than re-derived, so a draft can never Apply a
 * value the storable validator would then reject.
 *
 * Only `resource` behaviors get editable configuration fields; `machine` / `pipeline`
 * / `decision` / `host` show a read-only summary ("Editing arrives later"; they
 * have no editors yet) and `unmodeled` shows a "Not simulated"
 * note plus an editable reason. Connection `data` config is `{}` — no fields besides
 * label.
 */

import type {
  CallConnection,
  Connection,
  Document,
  Element,
  LinkClass,
  MessageConnection,
  ResourceConfig,
} from '../../studio/model.js';
import { LINK_CLASSES, LINK_CLASS_LATENCY_MS } from '../../studio/model.js';
import { connectionAdvisories, describeCalleeContract, describeCallerPolicy, findPort } from '../../studio/port-settings.js';
import type { FieldOption, FieldSpec } from './types.js';
import { portSettingsFields } from './portFields.js';
import { RESOURCE_CONFIG_COPY } from '../../catalog/resourceConfigCopy.js';
import { numberField, optionalNumberField, readonlyField, selectField, textField } from './fieldBuilders.js';

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
      label: RESOURCE_CONFIG_COPY.capacity.label,
      unit: RESOURCE_CONFIG_COPY.capacity.unit,
      min: 1,
      max: 100000,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.capacity : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, capacity: value })),
    }),
    numberField<Element>({
      id: 'config.concurrency',
      label: RESOURCE_CONFIG_COPY.concurrency.label,
      min: 1,
      max: 1024,
      integer: true,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.concurrency : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, concurrency: value })),
    }),
    numberField<Element>({
      id: 'config.queueLimit',
      label: RESOURCE_CONFIG_COPY.queueLimit.label,
      min: 0,
      max: 10000,
      integer: true,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.queueLimit : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, queueLimit: value })),
    }),
    numberField<Element>({
      id: 'config.failureRate',
      label: RESOURCE_CONFIG_COPY.failureRate.label,
      unit: RESOURCE_CONFIG_COPY.failureRate.unit,
      min: 0,
      max: 100,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.failureRate : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, failureRate: value })),
    }),
    numberField<Element>({
      id: 'config.maxRetries',
      label: RESOURCE_CONFIG_COPY.maxRetries.label,
      min: 0,
      max: 5,
      integer: true,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.maxRetries : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, maxRetries: value })),
    }),
    numberField<Element>({
      id: 'config.retryDelayMs',
      label: RESOURCE_CONFIG_COPY.retryDelayMs.label,
      unit: RESOURCE_CONFIG_COPY.retryDelayMs.unit,
      min: 0,
      max: 10000,
      get: (el) => (el.behavior.kind === 'resource' ? el.behavior.config.retryDelayMs : 0),
      set: (el, value) => withConfig(el, (c) => ({ ...c, retryDelayMs: value })),
    }),
    selectField<Element>({
      id: 'config.serviceTime',
      label: RESOURCE_CONFIG_COPY.serviceTime.label,
      options: [
        { value: 'exponential', label: RESOURCE_CONFIG_COPY.serviceTime.options.exponential },
        { value: 'lognormal', label: RESOURCE_CONFIG_COPY.serviceTime.options.lognormal },
        { value: 'fixed', label: RESOURCE_CONFIG_COPY.serviceTime.options.fixed },
      ],
      // Absent means 'fixed': configs created without a service time keep their behaviour.
      get: (el) => (el.behavior.kind === 'resource' ? (el.behavior.config.serviceTime ?? 'fixed') : 'fixed'),
      set: (el, value) =>
        withConfig(el, (c) => {
          const { serviceTimeCv, ...rest } = c;
          // Lognormal needs a variability; choosing it sets 2, shown and editable.
          return value === 'lognormal'
            ? { ...rest, serviceTime: 'lognormal', serviceTimeCv: serviceTimeCv ?? LOGNORMAL_CV_WHEN_CHOSEN }
            : { ...rest, serviceTime: value as 'fixed' | 'exponential' };
        }),
    }),
  ];
  if (behavior.config.serviceTime === 'lognormal') {
    common.push(
      numberField<Element>({
        id: 'config.serviceTimeCv',
        label: RESOURCE_CONFIG_COPY.serviceTimeCv.label,
        min: 0.1,
        max: 10,
        get: (el) => (el.behavior.kind === 'resource' ? (el.behavior.config.serviceTimeCv ?? LOGNORMAL_CV_WHEN_CHOSEN) : 0),
        set: (el, value) => withConfig(el, (c) => ({ ...c, serviceTimeCv: value })),
      }),
    );
  }

  const config = behavior.config;
  const variant: FieldSpec<Element>[] = [];

  if (config.type === 'storage') {
    variant.push(
      numberField<Element>({
        id: 'config.writeCapacity',
        label: RESOURCE_CONFIG_COPY.writeCapacity.label,
        unit: RESOURCE_CONFIG_COPY.writeCapacity.unit,
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
        label: RESOURCE_CONFIG_COPY.strategy.label,
        options: [
          { value: 'round-robin', label: RESOURCE_CONFIG_COPY.strategy.options['round-robin'] },
          { value: 'weighted', label: RESOURCE_CONFIG_COPY.strategy.options.weighted },
          { value: 'conditional', label: RESOURCE_CONFIG_COPY.strategy.options.conditional },
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
        label: RESOURCE_CONFIG_COPY.mode.label,
        options: [
          { value: 'fixed', label: RESOURCE_CONFIG_COPY.mode.options.fixed },
          { value: 'lru', label: RESOURCE_CONFIG_COPY.mode.options.lru },
        ],
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'cache' ? el.behavior.config.mode : 'fixed'),
        set: (el, value) => withConfig(el, (c) => (c.type === 'cache' ? { ...c, mode: value as 'fixed' | 'lru' } : c)),
      }),
      numberField<Element>({
        id: 'config.hitRate',
        label: RESOURCE_CONFIG_COPY.hitRate.label,
        unit: RESOURCE_CONFIG_COPY.hitRate.unit,
        min: 0,
        max: 100,
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'cache' ? el.behavior.config.hitRate : 0),
        set: (el, value) => withConfig(el, (c) => (c.type === 'cache' ? { ...c, hitRate: value } : c)),
      }),
      numberField<Element>({
        id: 'config.entries',
        label: RESOURCE_CONFIG_COPY.entries.label,
        min: 1,
        max: 100000,
        integer: true,
        get: (el) => (el.behavior.kind === 'resource' && el.behavior.config.type === 'cache' ? el.behavior.config.entries : 0),
        set: (el, value) => withConfig(el, (c) => (c.type === 'cache' ? { ...c, entries: value } : c)),
      }),
      numberField<Element>({
        id: 'config.ttlMs',
        label: RESOURCE_CONFIG_COPY.ttlMs.label,
        unit: RESOURCE_CONFIG_COPY.ttlMs.unit,
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
        label: RESOURCE_CONFIG_COPY.delivery.label,
        options: [
          { value: 'competing', label: RESOURCE_CONFIG_COPY.delivery.options.competing },
          { value: 'broadcast', label: RESOURCE_CONFIG_COPY.delivery.options.broadcast },
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

/** A linked-project node is a fixed black box; nothing about it is editable here. */
function linkedProjectFields(element: Element): readonly FieldSpec<Element>[] {
  return [
    readonlyField<Element>('linked.project', 'Linked project', element.label, 'Title, team and description are read from the linked project'),
    readonlyField<Element>('linked.id', 'Project ID', element.linkedProjectId ?? ''),
    readonlyField<Element>('behavior.summary', 'Behavior', 'Fixed black-box service', 'Its configuration cannot be changed from this project'),
  ];
}

export function fieldsForElement(element: Element): readonly FieldSpec<Element>[] {
  if (element.visualKind === 'linked-project') return linkedProjectFields(element);
  return [...elementLabelDescriptionFields(), ...behaviorFields(element), ...portSettingsFields(element)];
}

/** Sentence-case kind tags for the inspector header. */
function kindCaption(kind: string): string {
  const words = kind.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function kindTagForElement(element: Element): { readonly tag: string; readonly notSimulated: boolean } {
  const behavior = element.behavior;
  if (element.visualKind === 'linked-project') return { tag: 'Linked project', notSimulated: false };
  switch (behavior.kind) {
    case 'unmodeled':
      return { tag: 'Not simulated', notSimulated: true };
    case 'resource':
      return { tag: kindCaption(behavior.config.type), notSimulated: false };
    case 'machine':
      return { tag: 'State machine', notSimulated: false };
    case 'pipeline':
      return { tag: 'Data pipeline', notSimulated: false };
    case 'decision':
      return { tag: 'Decision', notSimulated: false };
    case 'host':
      return { tag: 'Host', notSimulated: false };
    default:
      return { tag: kindCaption(element.visualKind), notSimulated: false };
  }
}

// ============================================================================
// Connection fields
// ============================================================================

/** The variability a resource gets when its author chooses lognormal (an assumption, shown). */
const LOGNORMAL_CV_WHEN_CHOSEN = 2;

const LINK_CLASS_LABELS: Readonly<Record<LinkClass, string>> = {
  'same-host': 'Same host',
  'same-az': 'Same availability zone',
  'cross-az': 'Cross availability zone',
  'cross-region': 'Cross region',
  internet: 'Internet',
};

const LINK_CLASS_OPTIONS: readonly FieldOption[] = [
  ...LINK_CLASSES.map((c) => ({ value: c, label: `${LINK_CLASS_LABELS[c]} (${LINK_CLASS_LATENCY_MS[c]} ms each way)` })),
  { value: 'custom', label: 'Custom' },
];

type LinkConfig = CallConnection['config'] | MessageConnection['config'];

function withLinkConfig(c: Connection, patch: (config: LinkConfig) => LinkConfig): Connection {
  return c.kind === 'call' || c.kind === 'message' ? ({ ...c, config: patch(c.config) } as Connection) : c;
}

function linkFields(kind: 'call' | 'message'): FieldSpec<Connection>[] {
  const cfg = (c: Connection): LinkConfig | null => (c.kind === kind ? (c.config as LinkConfig) : null);
  const fields: FieldSpec<Connection>[] = [
    selectField<Connection>({
      id: 'config.linkClass',
      label: 'Link',
      options: LINK_CLASS_OPTIONS,
      get: (c) => cfg(c)?.linkClass ?? 'custom',
      set: (c, value) =>
        withLinkConfig(c, (config) => {
          if (value === 'custom') return { ...config, linkClass: null };
          const preset = LINK_CLASS_LATENCY_MS[value as LinkClass];
          return 'returnLatencyMs' in config
            ? { ...config, linkClass: value as LinkClass, latencyMs: preset, returnLatencyMs: preset }
            : { ...config, linkClass: value as LinkClass, latencyMs: preset };
        }),
    }),
    numberField<Connection>({
      id: 'config.latencyMs',
      label: kind === 'call' ? 'Latency (request leg)' : 'Latency',
      unit: 'ms',
      min: 0,
      max: 60000,
      get: (c) => cfg(c)?.latencyMs ?? 0,
      set: (c, value) =>
        withLinkConfig(c, (config) => ({
          ...config,
          latencyMs: value,
          linkClass: config.linkClass !== null && LINK_CLASS_LATENCY_MS[config.linkClass] === value ? config.linkClass : null,
        })),
    }),
  ];
  fields.push(
    numberField<Connection>({
      id: 'config.jitterMs',
      label: 'Jitter (up to, per leg)',
      unit: 'ms',
      min: 0,
      max: 60000,
      get: (c) => cfg(c)?.jitterMs ?? 0,
      set: (c, value) => withLinkConfig(c, (config) => ({ ...config, jitterMs: value })),
    }),
    numberField<Connection>({
      id: 'config.lossRate',
      label: 'Loss (per leg)',
      unit: '%',
      min: 0,
      max: 100,
      get: (c) => cfg(c)?.lossRate ?? 0,
      set: (c, value) => withLinkConfig(c, (config) => ({ ...config, lossRate: value })),
    }),
    optionalNumberField<Connection>({
      id: 'config.bandwidthKbps',
      label: 'Bandwidth (blank = unlimited)',
      unit: 'kbit/s',
      note: 'Adds transfer time when the ports give request and response sizes',
      min: 0,
      max: 1e9,
      minExclusive: true,
      get: (c) => cfg(c)?.bandwidthKbps ?? undefined,
      set: (c, value) => withLinkConfig(c, (config) => ({ ...config, bandwidthKbps: value })),
    }),
  );
  if (kind === 'call') {
    fields.push(
      numberField<Connection>({
        id: 'config.returnLatencyMs',
        label: 'Return latency (response leg)',
        unit: 'ms',
        min: 0,
        max: 60000,
        get: (c) => (c.kind === 'call' ? c.config.returnLatencyMs : 0),
        set: (c, value) =>
          withLinkConfig(c, (config) => ({
            ...config,
            returnLatencyMs: value,
            linkClass: config.linkClass !== null && LINK_CLASS_LATENCY_MS[config.linkClass] === value ? config.linkClass : null,
          })),
      }),
    );
  }
  fields.push(
    numberField<Connection>({
      id: 'config.weight',
      label: 'Route weight',
      min: 0,
      max: 1e6,
      minExclusive: true,
      get: (c) => cfg(c)?.weight ?? 0,
      set: (c, value) => withLinkConfig(c, (config) => ({ ...config, weight: value })),
    }),
  );
  return fields;
}

/** Condition and fallback are shown only when the route actually uses them; never a placeholder row. */
function routingReadonlyFields(): FieldSpec<Connection>[] {
  const config = (c: Connection): LinkConfig | null => (c.kind === 'data' ? null : c.config);
  return [
    {
      ...readonlyField<Connection>('config.condition', 'Route condition', ''),
      toRaw: (c) => {
        const cond = config(c)?.condition;
        return cond ? `${cond.field} = ${cond.value}` : '';
      },
    },
    {
      ...readonlyField<Connection>('config.fallback', 'Fallback route', ''),
      toRaw: (c) => (config(c)?.fallback ? 'Yes' : ''),
    },
  ];
}

/** What the two ends of the connection say about it, read-only here and edited on the nodes. */
function endsFields(connection: Connection, document: Pick<Document, 'elements'> | undefined): FieldSpec<Connection>[] {
  if (!document || connection.kind === 'data') return [];
  const source = findPort(document, connection.source);
  const target = findPort(document, connection.target);
  const fields: FieldSpec<Connection>[] = [];
  const row = (id: string, label: string, text: string, note?: string) => {
    if (text) fields.push(readonlyField<Connection>(id, label, text, note));
  };
  if (source) row('ends.caller', `Caller · ${source.element.label}`, describeCallerPolicy(source.port), 'Edit on the node');
  if (target) row('ends.callee', `Callee · ${target.element.label}`, describeCalleeContract(target.port), 'Edit on the node');
  connectionAdvisories(document, connection).forEach((text, i) => row(`ends.advisory.${i}`, 'Advisory', text));
  return fields;
}

export function fieldsForConnection(
  connection: Connection,
  document?: Pick<Document, 'elements'>,
): readonly FieldSpec<Connection>[] {
  if (connection.kind === 'data') return [];
  return [
    ...linkFields(connection.kind),
    ...routingReadonlyFields().filter((f) => shouldShowReadonly(connection, f)),
    ...endsFields(connection, document),
  ];
}

function shouldShowReadonly(connection: Connection, field: FieldSpec<Connection>): boolean {
  if (field.kind !== 'readonly') return true;
  const raw = field.toRaw(connection);
  return raw !== '';
}

export function kindTagForConnection(connection: Connection): string {
  return kindCaption(connection.kind);
}

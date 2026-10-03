/**
 * Port settings as inspector fields (D53). Each connectable port of the selected node gets its own
 * group: what the caller sends and how it retries on an out-port, what the callee promises or
 * enforces on an in-port. Rows are editable on the node, because the port belongs to the node;
 * the connection inspector only summarizes them.
 */

import type { CallRetryPolicy, Element, Port, RequestMeta } from '../../domain/studio/model';
import { DELIVERY_GUARANTEES, MESSAGE_ORDERINGS } from '../../domain/studio/model';
import { describeEndpoint } from '../../domain/studio/protocols';
import { numberField, optionalNumberField, optionalSelectField, readonlyField, textField } from './fieldBuilders';
import type { FieldSpec } from './types';

type Settings = Record<string, unknown>;

/** The caller's policy when its author raises Attempts above 1; each value is an assumption shown in the inspector. */
const RETRY_WHEN_ENABLED = {
  backoffMs: 100,
  backoffMultiplier: 2,
  maxBackoffMs: 10000,
  jitter: true,
  attemptTimeoutMs: null,
} as const;

function settingsOf(element: Element, portId: string): Settings {
  return (element.ports.find((p) => p.id === portId)?.settings ?? {}) as Settings;
}

/** Replaces one setting of a port, dropping the whole settings object when nothing is left. */
function withSetting(element: Element, portId: string, key: string, value: unknown): Element {
  return {
    ...element,
    ports: element.ports.map((port) => {
      if (port.id !== portId) return port;
      const next: Settings = { ...((port.settings ?? {}) as Settings) };
      if (value === undefined || value === null) delete next[key];
      else next[key] = value;
      const { settings: _drop, ...rest } = port;
      return Object.keys(next).length > 0 ? ({ ...rest, settings: next } as Port) : (rest as Port);
    }),
  };
}

function num(settings: Settings, key: string): number | undefined {
  return typeof settings[key] === 'number' ? (settings[key] as number) : undefined;
}

function portGroup(element: Element, port: Port): string {
  const base = `${port.direction === 'in' ? 'In' : 'Out'} · ${port.protocol ? describeEndpoint(port.protocol, port.path ?? '') : port.label}`;
  const twins = element.ports.filter(
    (p) => p.direction === port.direction && p.protocol === port.protocol && (p.path ?? '') === (port.path ?? ''),
  );
  return twins.length > 1 ? `${base} (${twins.indexOf(port) + 1})` : base;
}

function grouped(group: string, fields: readonly FieldSpec<Element>[]): FieldSpec<Element>[] {
  return fields.map((field) => ({ ...field, group }));
}

function inCallFields(element: Element, port: Port): FieldSpec<Element>[] {
  const id = (key: string) => `port.${port.id}.${key}`;
  const get = (key: string) => (el: Element) => num(settingsOf(el, port.id), key);
  const set = (key: string) => (el: Element, value: number | null) => withSetting(el, port.id, key, value);
  const fields: FieldSpec<Element>[] = [
    optionalNumberField<Element>({
      id: id('expectedP95Ms'), label: 'Expected p95 latency', unit: 'ms', note: 'Declared: shown to callers, not simulated',
      min: 0, max: 600000, minExclusive: true, get: get('expectedP95Ms'), set: set('expectedP95Ms'),
    }),
    optionalNumberField<Element>({
      id: id('availabilityPct'), label: 'Availability', unit: '%', note: 'Declared: shown to callers, not simulated',
      min: 0, max: 100, minExclusive: true, get: get('availabilityPct'), set: set('availabilityPct'),
    }),
    optionalSelectField<Element>({
      id: id('idempotent'), label: 'Safe to retry (idempotent)', note: 'Declared: a caller that retries a "No" endpoint gets an advisory',
      options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
      get: (el) => { const v = settingsOf(el, port.id).idempotent; return v === true ? 'yes' : v === false ? 'no' : undefined; },
      set: (el, value) => withSetting(el, port.id, 'idempotent', value === null ? null : value === 'yes'),
    }),
    optionalNumberField<Element>({
      id: id('maxConcurrency'), label: 'Max concurrency', note: 'Declared: shown to callers, not simulated',
      min: 1, max: 100000, integer: true, get: get('maxConcurrency'), set: set('maxConcurrency'),
    }),
  ];
  if (element.behavior.kind !== 'resource') return fields;

  // Simulated: these override the node's own behavior for calls entering through this endpoint.
  const limit = settingsOf(element, port.id).rateLimit as { rps: number; burst: number } | undefined;
  fields.push(
    optionalNumberField<Element>({
      id: id('rateLimit.rps'), label: 'Rate limit', unit: 'requests/s', note: 'Simulated: calls above it are rejected',
      min: 0, max: 1e6, minExclusive: true,
      get: (el) => (settingsOf(el, port.id).rateLimit as { rps: number } | undefined)?.rps,
      set: (el, value) => {
        const current = settingsOf(el, port.id).rateLimit as { rps: number; burst: number } | undefined;
        return withSetting(el, port.id, 'rateLimit', value === null ? null : { rps: value, burst: current?.burst ?? Math.max(1, Math.ceil(value)) });
      },
    }),
  );
  if (limit) {
    fields.push(
      numberField<Element>({
        id: id('rateLimit.burst'), label: 'Rate limit burst', min: 1, max: 1e6, integer: true,
        get: (el) => (settingsOf(el, port.id).rateLimit as { burst: number } | undefined)?.burst ?? 1,
        set: (el, value) => {
          const current = settingsOf(el, port.id).rateLimit as { rps: number; burst: number } | undefined;
          return current ? withSetting(el, port.id, 'rateLimit', { ...current, burst: value }) : el;
        },
      }),
    );
  }
  fields.push(
    optionalNumberField<Element>({
      id: id('failureRate'), label: 'Failure rate', unit: '%', note: 'Simulated: replaces the node\'s failure rate for this endpoint',
      min: 0, max: 100, get: get('failureRate'), set: set('failureRate'),
    }),
    optionalNumberField<Element>({
      id: id('serviceTimeMs'), label: 'Service time', unit: 'ms', note: 'Simulated: replaces 1 / capacity for this endpoint',
      min: 0, max: 600000, minExclusive: true, get: get('serviceTimeMs'), set: set('serviceTimeMs'),
    }),
  );
  return fields;
}

function inMessageFields(port: Port): FieldSpec<Element>[] {
  const id = (key: string) => `port.${port.id}.${key}`;
  return [
    optionalNumberField<Element>({
      id: id('ackDelayMs'), label: 'Ack delay', unit: 'ms', note: 'Simulated: the publisher is told the message arrived this long after delivery (default 0)',
      min: 0, max: 60000, get: (el) => num(settingsOf(el, port.id), 'ackDelayMs'), set: (el, value) => withSetting(el, port.id, 'ackDelayMs', value),
    }),
    optionalNumberField<Element>({
      id: id('messageTtlMs'), label: 'Message TTL', unit: 'ms', note: 'Simulated: a message expires this long after it was published (default 5 minutes)',
      min: 1, max: 3600000, get: (el) => num(settingsOf(el, port.id), 'messageTtlMs'), set: (el, value) => withSetting(el, port.id, 'messageTtlMs', value),
    }),
    optionalSelectField<Element>({
      id: id('delivery'), label: 'Delivery guarantee', note: 'Declared: not simulated',
      options: DELIVERY_GUARANTEES.map((v) => ({ value: v, label: v })),
      get: (el) => settingsOf(el, port.id).delivery as string | undefined,
      set: (el, value) => withSetting(el, port.id, 'delivery', value),
    }),
    optionalSelectField<Element>({
      id: id('ordering'), label: 'Ordering', note: 'Declared: not simulated',
      options: MESSAGE_ORDERINGS.map((v) => ({ value: v, label: v })),
      get: (el) => settingsOf(el, port.id).ordering as string | undefined,
      set: (el, value) => withSetting(el, port.id, 'ordering', value),
    }),
  ];
}

function inDataFields(port: Port): FieldSpec<Element>[] {
  const id = (key: string) => `port.${port.id}.${key}`;
  return [
    optionalNumberField<Element>({
      id: id('throughputPerSec'), label: 'Throughput', unit: '/s', note: 'Declared: not simulated',
      min: 0, max: 1e9, minExclusive: true, get: (el) => num(settingsOf(el, port.id), 'throughputPerSec'), set: (el, value) => withSetting(el, port.id, 'throughputPerSec', value),
    }),
    optionalNumberField<Element>({
      id: id('maxStalenessMs'), label: 'Max staleness', unit: 'ms', note: 'Declared: not simulated',
      min: 0, max: 31_536_000_000, minExclusive: true, get: (el) => num(settingsOf(el, port.id), 'maxStalenessMs'), set: (el, value) => withSetting(el, port.id, 'maxStalenessMs', value),
    }),
  ];
}

function retryFields(element: Element, port: Port): FieldSpec<Element>[] {
  const id = (key: string) => `port.${port.id}.retry.${key}`;
  const retryOf = (el: Element) => settingsOf(el, port.id).retry as CallRetryPolicy | undefined;
  const withRetry = (el: Element, patch: (r: CallRetryPolicy) => CallRetryPolicy): Element => {
    const r = retryOf(el);
    return r ? withSetting(el, port.id, 'retry', patch(r)) : el;
  };
  const fields: FieldSpec<Element>[] = [
    numberField<Element>({
      id: id('maxAttempts'), label: 'Attempts (1 = no retries)', min: 1, max: 10, integer: true,
      get: (el) => retryOf(el)?.maxAttempts ?? 1,
      set: (el, value) => {
        const r = retryOf(el);
        return withSetting(el, port.id, 'retry', value === 1 ? null : r ? { ...r, maxAttempts: value } : { ...RETRY_WHEN_ENABLED, maxAttempts: value });
      },
    }),
  ];
  if (!retryOf(element)) return fields;
  fields.push(
    numberField<Element>({
      id: id('backoffMs'), label: 'Retry backoff', unit: 'ms', min: 0, max: 60000,
      get: (el) => retryOf(el)?.backoffMs ?? 0, set: (el, value) => withRetry(el, (r) => ({ ...r, backoffMs: value })),
    }),
    numberField<Element>({
      id: id('backoffMultiplier'), label: 'Backoff multiplier', min: 1, max: 10,
      get: (el) => retryOf(el)?.backoffMultiplier ?? 1, set: (el, value) => withRetry(el, (r) => ({ ...r, backoffMultiplier: value })),
    }),
    numberField<Element>({
      id: id('maxBackoffMs'), label: 'Max backoff', unit: 'ms', min: 0, max: 600000,
      get: (el) => retryOf(el)?.maxBackoffMs ?? 0, set: (el, value) => withRetry(el, (r) => ({ ...r, maxBackoffMs: value })),
    }),
    optionalSelectField<Element>({
      id: id('jitter'), label: 'Jitter',
      options: [{ value: 'on', label: 'On (random up to the backoff)' }, { value: 'off', label: 'Off' }],
      get: (el) => (retryOf(el)?.jitter ? 'on' : 'off'),
      set: (el, value) => withRetry(el, (r) => ({ ...r, jitter: value !== 'off' })),
    }),
    numberField<Element>({
      id: id('attemptTimeoutMs'), label: 'Attempt timeout (0 = none)', unit: 'ms', min: 0, max: 600000,
      get: (el) => retryOf(el)?.attemptTimeoutMs ?? 0, set: (el, value) => withRetry(el, (r) => ({ ...r, attemptTimeoutMs: value === 0 ? null : value })),
    }),
  );
  return fields;
}

/** The caller's request class is set when the connection is made; here it can be edited, not invented. */
function requestFields(element: Element, port: Port): FieldSpec<Element>[] {
  const requestOf = (el: Element) => settingsOf(el, port.id).request as RequestMeta | undefined;
  const id = (key: string) => `port.${port.id}.request.${key}`;
  const withRequest = (el: Element, patch: (r: RequestMeta) => RequestMeta): Element => {
    const r = requestOf(el);
    return r ? withSetting(el, port.id, 'request', patch(r)) : el;
  };
  if (!requestOf(element)) {
    return [readonlyField<Element>(id('none'), 'Request class', 'Not set', 'Chosen when a connection from this endpoint is made')];
  }
  return [
    textField<Element>({
      id: id('requestClassLabel'), label: 'Request class', min: 1, max: 60,
      get: (el) => requestOf(el)?.requestClassLabel ?? '', set: (el, value) => withRequest(el, (r) => ({ ...r, requestClassLabel: value })),
    }),
    optionalSelectField<Element>({
      id: id('operation'), label: 'Operation',
      options: [{ value: 'read', label: 'Read' }, { value: 'write', label: 'Write' }],
      get: (el) => requestOf(el)?.operation,
      set: (el, value) => withRequest(el, (r) => ({ ...r, operation: value === 'write' ? 'write' : 'read' })),
    }),
    textField<Element>({
      id: id('key'), label: 'Key (blank = none)', min: 0, max: 80,
      get: (el) => requestOf(el)?.key ?? '', set: (el, value) => withRequest(el, (r) => ({ ...r, key: value === '' ? null : value })),
    }),
    textField<Element>({
      id: id('tags'), label: 'Tags (comma separated)', min: 0, max: 400,
      get: (el) => (requestOf(el)?.tags ?? []).join(', '),
      set: (el, value) => withRequest(el, (r) => ({ ...r, tags: value.split(',').map((t) => t.trim()).filter((t) => t !== '') })),
    }),
  ];
}

/** Traffic that originates in an unsimulated node needs a deadline and a request class; a simulated caller's requests inherit them. */
function originatingFields(element: Element, port: Port): FieldSpec<Element>[] {
  return [
    optionalNumberField<Element>({
      id: `port.${port.id}.deadlineDurationMs`, label: 'Deadline', unit: 'ms', note: 'Simulated: how long this caller waits for traffic it originates (default 60 s)',
      min: 0, max: 600000, minExclusive: true,
      get: (el) => num(settingsOf(el, port.id), 'deadlineDurationMs'), set: (el, value) => withSetting(el, port.id, 'deadlineDurationMs', value),
    }),
    ...requestFields(element, port),
  ];
}

function outCallFields(element: Element, port: Port): FieldSpec<Element>[] {
  const fields = retryFields(element, port);
  if (element.behavior.kind !== 'resource') fields.push(...originatingFields(element, port));
  return fields;
}

/** Every connectable port of the node, grouped, with the settings that make sense for its direction and channel. */
export function portSettingsFields(element: Element): readonly FieldSpec<Element>[] {
  const result: FieldSpec<Element>[] = [];
  for (const port of element.ports) {
    if (port.channel === 'event') continue;
    let fields: FieldSpec<Element>[] = [];
    if (port.direction === 'in' && port.channel === 'call') fields = inCallFields(element, port);
    else if (port.direction === 'in' && port.channel === 'message') fields = inMessageFields(port);
    else if (port.direction === 'in' && port.channel === 'data') fields = inDataFields(port);
    else if (port.direction === 'out' && port.channel === 'call') fields = outCallFields(element, port);
    else if (port.direction === 'out' && port.channel === 'message' && element.behavior.kind !== 'resource') fields = originatingFields(element, port);
    result.push(...grouped(portGroup(element, port), fields));
  }
  return result;
}

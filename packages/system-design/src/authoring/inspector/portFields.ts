/**
 * Port settings as inspector fields. Each connectable port of the selected node gets its own
 * group: what the caller sends and how it retries on an out-port, what the callee promises or
 * enforces on an in-port. Rows are editable on the node, because the port belongs to the node;
 * the connection inspector only summarizes them.
 */

import type { CallRetryPolicy, CircuitBreakerPolicy, Element, Port } from '../../studio/model.js';
import { DELIVERY_GUARANTEES, MESSAGE_ORDERINGS } from '../../studio/model.js';
import { describeEndpoint } from '../../studio/protocols.js';
import { numberField, optionalNumberField, optionalSelectField, readonlyField, selectField } from './fieldBuilders.js';
import type { FieldSpec } from './types.js';

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
    optionalNumberField<Element>({
      id: id('maxConcurrency'), label: 'Max concurrency', note: 'Simulated: calls beyond this many in service or queued through this endpoint are rejected',
      min: 1, max: 100000, integer: true, get: get('maxConcurrency'), set: set('maxConcurrency'),
    }),
    optionalNumberField<Element>({
      id: id('responseBytes'), label: 'Response size', unit: 'bytes', note: 'Simulated: adds transfer time on the way back over a link with a bandwidth',
      min: 0, max: 1e12, integer: true, minExclusive: true, get: get('responseBytes'), set: set('responseBytes'),
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
      id: id('messageTtlMs'), label: 'Message TTL', unit: 'ms', note: 'Simulated: a message expires this long after it was published; leave empty for no expiry (an unconsumed message is then reported stuck)',
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

/** An unsimulated node has no caller behavior to edit: what it sends is fixed. */
function unsimulatedCallerFields(port: Port): FieldSpec<Element>[] {
  return [
    readonlyField<Element>(
      `port.${port.id}.unsimulated`,
      'Calls from this node',
      'Not simulated',
      'It sends a default read request with a 60 s deadline. Shape traffic with a workload.',
    ),
  ];
}

const BREAKER_WHEN_ENABLED = { openMs: 30000, halfOpenProbes: 1 } as const;
/** A batch that is switched on waits this long for company (an assumption, shown in the inspector). */
const BATCH_WINDOW_WHEN_ENABLED_MS = 100;

function breakerFields(element: Element, port: Port): FieldSpec<Element>[] {
  const id = (key: string) => `port.${port.id}.circuitBreaker.${key}`;
  const breakerOf = (el: Element) => settingsOf(el, port.id).circuitBreaker as CircuitBreakerPolicy | undefined;
  const withBreaker = (el: Element, patch: (b: CircuitBreakerPolicy) => CircuitBreakerPolicy): Element => {
    const b = breakerOf(el);
    return b ? withSetting(el, port.id, 'circuitBreaker', patch(b)) : el;
  };
  const fields: FieldSpec<Element>[] = [
    optionalNumberField<Element>({
      id: id('failureThreshold'), label: 'Circuit breaker: consecutive failures to open', note: 'Simulated: after this many failures in a row the caller stops calling, then probes',
      min: 1, max: 1000, integer: true,
      get: (el) => breakerOf(el)?.failureThreshold,
      set: (el, value) => {
        const b = breakerOf(el);
        return withSetting(el, port.id, 'circuitBreaker', value === null ? null : b ? { ...b, failureThreshold: value } : { ...BREAKER_WHEN_ENABLED, failureThreshold: value });
      },
    }),
  ];
  if (!breakerOf(element)) return fields;
  fields.push(
    numberField<Element>({
      id: id('openMs'), label: 'Breaker open time', unit: 'ms', min: 1, max: 600000,
      get: (el) => breakerOf(el)?.openMs ?? BREAKER_WHEN_ENABLED.openMs, set: (el, value) => withBreaker(el, (b) => ({ ...b, openMs: value })),
    }),
    numberField<Element>({
      id: id('halfOpenProbes'), label: 'Probe calls when half-open', min: 1, max: 100, integer: true,
      get: (el) => breakerOf(el)?.halfOpenProbes ?? 1, set: (el, value) => withBreaker(el, (b) => ({ ...b, halfOpenProbes: value })),
    }),
  );
  return fields;
}

function callerPolicyFields(element: Element, port: Port): FieldSpec<Element>[] {
  const id = (key: string) => `port.${port.id}.${key}`;
  return [
    ...breakerFields(element, port),
    optionalNumberField<Element>({
      id: id('maxInFlight'), label: 'In-flight limit', note: 'Simulated: calls beyond this many outstanding through this endpoint fail fast',
      min: 1, max: 1e6, integer: true, get: (el) => num(settingsOf(el, port.id), 'maxInFlight'), set: (el, value) => withSetting(el, port.id, 'maxInFlight', value),
    }),
    optionalNumberField<Element>({
      id: id('hedge.afterMs'), label: 'Hedge after', unit: 'ms', note: 'Simulated: an attempt unanswered after this long is sent again; the first success wins',
      min: 0, max: 600000, minExclusive: true,
      get: (el) => (settingsOf(el, port.id).hedge as { afterMs: number } | undefined)?.afterMs,
      set: (el, value) => withSetting(el, port.id, 'hedge', value === null ? null : { afterMs: value }),
    }),
    optionalNumberField<Element>({
      id: id('requestBytes'), label: 'Request size', unit: 'bytes', note: 'Simulated: adds transfer time over a link with a bandwidth',
      min: 0, max: 1e12, integer: true, minExclusive: true, get: (el) => num(settingsOf(el, port.id), 'requestBytes'), set: (el, value) => withSetting(el, port.id, 'requestBytes', value),
    }),
  ];
}

function outMessagePolicyFields(element: Element, port: Port): FieldSpec<Element>[] {
  const id = (key: string) => `port.${port.id}.${key}`;
  const batchOf = (el: Element) => settingsOf(el, port.id).batch as { size: number; windowMs: number } | undefined;
  const fields: FieldSpec<Element>[] = [
    selectField<Element>({
      id: id('confirm'), label: 'Wait for acknowledgement',
      options: [{ value: 'yes', label: 'Yes: the publisher waits for the receiver to confirm' }, { value: 'no', label: 'No: fire and forget' }],
      get: (el) => (settingsOf(el, port.id).confirm === false ? 'no' : 'yes'),
      set: (el, value) => withSetting(el, port.id, 'confirm', value === 'no' ? false : null),
    }),
    optionalNumberField<Element>({
      id: id('batch.size'), label: 'Batch size', note: 'Simulated: publishes wait for this many (or the window), then travel together',
      min: 2, max: 1000, integer: true,
      get: (el) => batchOf(el)?.size,
      set: (el, value) => {
        const b = batchOf(el);
        return withSetting(el, port.id, 'batch', value === null ? null : { windowMs: b?.windowMs ?? BATCH_WINDOW_WHEN_ENABLED_MS, size: value });
      },
    }),
  ];
  if (batchOf(element)) {
    fields.push(
      numberField<Element>({
        id: id('batch.windowMs'), label: 'Batch window', unit: 'ms', min: 1, max: 600000,
        get: (el) => batchOf(el)?.windowMs ?? BATCH_WINDOW_WHEN_ENABLED_MS,
        set: (el, value) => {
          const b = batchOf(el);
          return b ? withSetting(el, port.id, 'batch', { ...b, windowMs: value }) : el;
        },
      }),
    );
  }
  fields.push(
    optionalNumberField<Element>({
      id: id('requestBytes'), label: 'Message size', unit: 'bytes', note: 'Simulated: adds transfer time over a link with a bandwidth',
      min: 0, max: 1e12, integer: true, minExclusive: true, get: (el) => num(settingsOf(el, port.id), 'requestBytes'), set: (el, value) => withSetting(el, port.id, 'requestBytes', value),
    }),
  );
  return fields;
}

function outCallFields(element: Element, port: Port): FieldSpec<Element>[] {
  if (element.behavior.kind !== 'resource') return unsimulatedCallerFields(port);
  return [...retryFields(element, port), ...callerPolicyFields(element, port)];
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
    else if (port.direction === 'out' && port.channel === 'message') fields = element.behavior.kind === 'resource' ? outMessagePolicyFields(element, port) : unsimulatedCallerFields(port);
    result.push(...grouped(portGroup(element, port), fields));
  }
  return result;
}

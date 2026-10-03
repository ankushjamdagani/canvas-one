import { describe, expect, it } from 'vitest';
import type { Connection, Element } from '../../domain/studio/model';
import {
  fieldsForConnection,
  fieldsForElement,
  kindTagForConnection,
  kindTagForElement,
} from './fields';

function processorElement(overrides: Partial<Element> = {}): Element {
  return {
    id: 'el-1',
    label: 'Checkout service',
    description: 'Handles checkout',
    visualKind: 'service',
    ports: [],
    behavior: {
      kind: 'resource',
      version: 1,
      entryPortId: 'p1',
      config: {
        type: 'processor',
        capacity: 2000,
        concurrency: 1,
        queueLimit: 0,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 0,
      },
    },
    ...overrides,
  };
}

function callConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c-1',
    kind: 'call',
    source: { elementId: 'a', portId: 'p-out' },
    target: { elementId: 'b', portId: 'p-in' },
    config: {
      latencyMs: 10,
      returnLatencyMs: 5,
      linkClass: null,
      weight: 1,
      condition: null,
      fallback: false,
    },
    ...overrides,
  } as Connection;
}

describe('fieldsForElement: label/description', () => {
  it('exposes label and description with round-trippable raw values', () => {
    const el = processorElement();
    const fields = fieldsForElement(el);
    const label = fields.find((f) => f.id === 'label')!;
    const description = fields.find((f) => f.id === 'description')!;
    expect(label.toRaw(el)).toBe('Checkout service');
    expect(description.toRaw(el)).toBe('Handles checkout');
  });

  it('rejects an empty label (1-80 bound) and a too-long label', () => {
    const el = processorElement();
    const label = fieldsForElement(el).find((f) => f.id === 'label')!;
    expect(label.parse('').ok).toBe(false);
    expect(label.parse('x'.repeat(81)).ok).toBe(false);
    expect(label.parse('x'.repeat(80)).ok).toBe(true);
  });
});

describe('fieldsForElement: resource variants', () => {
  it('processor/source: only the common ResourceConfig fields', () => {
    const el = processorElement();
    const fields = fieldsForElement(el);
    expect(fields.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        'label',
        'description',
        'config.capacity',
        'config.concurrency',
        'config.queueLimit',
        'config.failureRate',
        'config.maxRetries',
        'config.retryDelayMs',
      ]),
    );
    expect(fields.some((f) => f.id === 'config.writeCapacity')).toBe(false);
  });

  it('capacity bounds are [1, 100000] per validate.ts', () => {
    const el = processorElement();
    const capacity = fieldsForElement(el).find((f) => f.id === 'config.capacity')!;
    expect(capacity.parse('0').ok).toBe(false);
    expect(capacity.parse('100001').ok).toBe(false);
    expect(capacity.parse('1').ok).toBe(true);
    expect(capacity.parse('100000').ok).toBe(true);
    expect(capacity.parse('not-a-number').ok).toBe(false);
  });

  it('concurrency must be a safe integer in [1,1024] (D49)', () => {
    const el = processorElement();
    const concurrency = fieldsForElement(el).find((f) => f.id === 'config.concurrency')!;
    expect(concurrency.parse('1.5').ok).toBe(false);
    expect(concurrency.parse('1025').ok).toBe(false);
    expect(concurrency.parse('1024').ok).toBe(true);
  });

  it('service time: choosing lognormal sets a variability of 2 and shows its field; leaving it drops it (D50)', () => {
    const el = processorElement();
    const field = fieldsForElement(el).find((f) => f.id === 'config.serviceTime')!;
    const heavy = field.apply(el, 'lognormal');
    expect(heavy.behavior.kind === 'resource' && heavy.behavior.config).toMatchObject({ serviceTime: 'lognormal', serviceTimeCv: 2 });
    const cv = fieldsForElement(heavy).find((f) => f.id === 'config.serviceTimeCv')!;
    expect(cv.parse('0.05').ok).toBe(false);
    expect(cv.parse('4').ok).toBe(true);
    const back = field.apply(heavy, 'exponential');
    expect(back.behavior.kind === 'resource' && 'serviceTimeCv' in back.behavior.config).toBe(false);
    expect(fieldsForElement(back).some((f) => f.id === 'config.serviceTimeCv')).toBe(false);
  });

  it('service time: absent reads as fixed; choosing exponential writes it (D49)', () => {
    const el = processorElement();
    const field = fieldsForElement(el).find((f) => f.id === 'config.serviceTime')!;
    expect(field.toRaw(el)).toBe('fixed');
    const next = field.apply(el, 'exponential');
    expect(next.behavior.kind === 'resource' && next.behavior.config.serviceTime).toBe('exponential');
  });

  it('storage: adds writeCapacity [1,100000]', () => {
    const el = processorElement({
      behavior: {
        kind: 'resource',
        version: 1,
        entryPortId: 'p1',
        config: {
          type: 'storage',
          capacity: 500,
          concurrency: 1,
          queueLimit: 0,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
          writeCapacity: 500,
        },
      },
    });
    const fields = fieldsForElement(el);
    const writeCapacity = fields.find((f) => f.id === 'config.writeCapacity')!;
    expect(writeCapacity).toBeDefined();
    expect(writeCapacity.toRaw(el)).toBe('500');
    expect(writeCapacity.parse('100001').ok).toBe(false);
  });

  it('router: strategy select field with the three contract values', () => {
    const el = processorElement({
      behavior: {
        kind: 'resource',
        version: 1,
        entryPortId: 'p1',
        config: {
          type: 'router',
          strategy: 'round-robin',
          capacity: 100,
          concurrency: 1,
          queueLimit: 0,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    });
    const strategy = fieldsForElement(el).find((f) => f.id === 'config.strategy')!;
    expect(strategy.options?.map((o) => o.value)).toEqual(['round-robin', 'weighted', 'conditional']);
    expect(strategy.parse('weighted').ok).toBe(true);
    expect(strategy.parse('bogus').ok).toBe(false);
  });

  it('cache: mode/hitRate/entries/ttlMs fields with contract bounds', () => {
    const el = processorElement({
      behavior: {
        kind: 'resource',
        version: 1,
        entryPortId: 'p1',
        config: {
          type: 'cache',
          mode: 'fixed',
          hitRate: 80,
          entries: 1000,
          ttlMs: 60000,
          capacity: 100,
          concurrency: 1,
          queueLimit: 0,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    });
    const fields = fieldsForElement(el);
    expect(fields.find((f) => f.id === 'config.mode')?.options?.map((o) => o.value)).toEqual(['fixed', 'lru']);
    expect(fields.find((f) => f.id === 'config.hitRate')!.parse('101').ok).toBe(false);
    expect(fields.find((f) => f.id === 'config.entries')!.parse('0').ok).toBe(false);
    expect(fields.find((f) => f.id === 'config.ttlMs')!.parse('0').ok).toBe(false);
    expect(fields.find((f) => f.id === 'config.ttlMs')!.parse('3600000').ok).toBe(true);
  });

  it('broker: delivery select field', () => {
    const el = processorElement({
      behavior: {
        kind: 'resource',
        version: 1,
        entryPortId: 'p1',
        config: {
          type: 'broker',
          delivery: 'competing',
          capacity: 100,
          concurrency: 1,
          queueLimit: 0,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    });
    const delivery = fieldsForElement(el).find((f) => f.id === 'config.delivery')!;
    expect(delivery.options?.map((o) => o.value)).toEqual(['competing', 'broadcast']);
  });
});

describe('fieldsForElement: non-resource behaviors', () => {
  it('unmodeled: a Not simulated note plus an editable reason', () => {
    const el = processorElement({ behavior: { kind: 'unmodeled', version: 1, reason: 'external SaaS' } });
    const fields = fieldsForElement(el);
    const note = fields.find((f) => f.id === 'behavior.note')!;
    const reason = fields.find((f) => f.id === 'behavior.reason')!;
    expect(note.kind).toBe('readonly');
    expect(note.toRaw(el)).toBe('Not simulated');
    expect(reason.toRaw(el)).toBe('external SaaS');
    expect(reason.kind).not.toBe('readonly');
  });

  it('machine/pipeline/decision/host: read-only summary only, no editors', () => {
    const machine = processorElement({
      behavior: {
        kind: 'machine',
        version: 1,
        states: [{ id: 's1', label: 'A' }, { id: 's2', label: 'B' }],
        initialStateId: 's1',
        contextSchemaId: 'sch',
        initialContextFixtureId: 'fx',
        transitions: [],
        responseBindings: [],
      },
    });
    const summary = fieldsForElement(machine).find((f) => f.id === 'behavior.summary')!;
    expect(summary.kind).toBe('readonly');
    expect(summary.toRaw(machine)).toBe('2 states');
    expect(summary.note).toBe('Editing arrives later');

    const host = processorElement({ behavior: { kind: 'host', version: 1 } });
    expect(fieldsForElement(host).find((f) => f.id === 'behavior.summary')!.toRaw(host)).toBe('Host');
  });
});

describe('kindTagForElement', () => {
  it('resource elements show the ResourceConfig type uppercased', () => {
    expect(kindTagForElement(processorElement()).tag).toBe('PROCESSOR');
  });

  it('unmodeled elements are tagged NOT SIMULATED with notSimulated=true', () => {
    const el = processorElement({ behavior: { kind: 'unmodeled', version: 1, reason: 'x' } });
    const result = kindTagForElement(el);
    expect(result.tag).toBe('NOT SIMULATED');
    expect(result.notSimulated).toBe(true);
  });
});

describe('fieldsForConnection', () => {
  it('call: the link class sets both latencies, and editing a latency leaves the preset unless it matches one', () => {
    const conn = callConnection();
    const fields = fieldsForConnection(conn);
    const link = fields.find((f) => f.id === 'config.linkClass')!;
    expect(link.toRaw(conn)).toBe('custom');
    const crossRegion = link.apply(conn, 'cross-region');
    expect(crossRegion.kind === 'call' && crossRegion.config).toMatchObject({ linkClass: 'cross-region', latencyMs: 80, returnLatencyMs: 80 });
    const latency = fields.find((f) => f.id === 'config.latencyMs')!;
    const edited = latency.apply(crossRegion, 90);
    expect(edited.kind === 'call' && edited.config.linkClass).toBeNull();
    // Once custom, typing a preset's number stays custom: the author chose the numbers.
    const back = latency.apply(edited, 80);
    expect(back.kind === 'call' && back.config.linkClass).toBeNull();
    const reset = latency.apply(crossRegion, 80);
    expect(reset.kind === 'call' && reset.config.linkClass).toBe('cross-region');
    expect((link.apply(crossRegion, 'custom') as { config: { linkClass: unknown; latencyMs: number } }).config).toMatchObject({ linkClass: null, latencyMs: 80 });
  });

  it('call: latencyMs/returnLatencyMs/weight editable with contract bounds', () => {
    const conn = callConnection();
    const fields = fieldsForConnection(conn);
    expect(fields.find((f) => f.id === 'config.latencyMs')!.parse('60001').ok).toBe(false);
    expect(fields.find((f) => f.id === 'config.returnLatencyMs')!.parse('60000').ok).toBe(true);
    const weight = fields.find((f) => f.id === 'config.weight')!;
    expect(weight.parse('0').ok).toBe(false); // weight > 0 required (minExclusive)
    expect(weight.parse('1000000').ok).toBe(true);
    expect(weight.parse('1000001').ok).toBe(false);
  });

  it('a connection carries no caller policy or receiver terms any more', () => {
    const ids = fieldsForConnection(callConnection()).map((f) => f.id);
    expect(ids.some((id) => id.includes('retry') || id.includes('ackDelay') || id.includes('messageTtl') || id.includes('resource'))).toBe(false);
  });

  it('call: condition and fallback are shown read-only only when the route uses them', () => {
    const withExtras = callConnection({
      config: { latencyMs: 1, returnLatencyMs: 1, linkClass: null, weight: 1, condition: { field: 'class', value: 'premium' }, fallback: true },
    } as Partial<Connection>);
    const fields = fieldsForConnection(withExtras);
    const condition = fields.find((f) => f.id === 'config.condition')!;
    expect(condition.kind).toBe('readonly');
    expect(condition.toRaw(withExtras)).toBe('class = premium');
    expect(fields.find((f) => f.id === 'config.fallback')!.toRaw(withExtras)).toBe('Yes');

    const plainFields = fieldsForConnection(callConnection());
    expect(plainFields.some((f) => f.id === 'config.condition')).toBe(false);
    expect(plainFields.some((f) => f.id === 'config.fallback')).toBe(false);
  });

  it('message: latency and weight with contract bounds, no return latency', () => {
    const conn: Connection = {
      id: 'c-2',
      kind: 'message',
      source: { elementId: 'a', portId: 'p-out' },
      target: { elementId: 'b', portId: 'p-in' },
      config: { latencyMs: 0, linkClass: null, jitterMs: 0, lossRate: 0, bandwidthKbps: null, weight: 1, condition: null, fallback: false },
    };
    const fields = fieldsForConnection(conn);
    expect(fields.map((f) => f.id)).toEqual([
      'config.linkClass', 'config.latencyMs', 'config.jitterMs', 'config.lossRate', 'config.bandwidthKbps', 'config.weight',
    ]);
    const preset = fields.find((f) => f.id === 'config.linkClass')!.apply(conn, 'cross-az');
    expect(preset.kind === 'message' && preset.config).toMatchObject({ linkClass: 'cross-az', latencyMs: 5 });
  });

  it('data connections: no fields at all', () => {
    const conn: Connection = {
      id: 'c-3',
      kind: 'data',
      source: { elementId: 'a', portId: 'p-out' },
      target: { elementId: 'b', portId: 'p-in' },
      config: {},
    };
    expect(fieldsForConnection(conn)).toEqual([]);
  });

  it('summarizes both ends and flags where the caller and the callee disagree (D53)', () => {
    const port = (id: string, direction: 'in' | 'out', settings?: Record<string, unknown>) =>
      ({ id, label: id, direction, channel: 'call', protocol: 'http', schemaId: 's', responseSchemaId: 'r', ...(settings ? { settings } : {}) }) as Element['ports'][number];
    const caller = processorElement({ id: 'a', label: 'Caller', ports: [port('p-out', 'out', { deadlineDurationMs: 50, retry: { maxAttempts: 3, backoffMs: 1, backoffMultiplier: 1, maxBackoffMs: 1, jitter: false, attemptTimeoutMs: null } })] });
    const callee = processorElement({ id: 'b', label: 'Callee', ports: [port('p-in', 'in', { expectedP95Ms: 80, idempotent: false })] });
    const conn = callConnection();
    const rows = fieldsForConnection(conn, { elements: [caller, callee] });
    expect(rows.find((f) => f.id === 'ends.caller')!.toRaw(conn)).toBe('3 attempts · deadline 50 ms');
    expect(rows.find((f) => f.id === 'ends.callee')!.toRaw(conn)).toBe('p95 80 ms · not idempotent');
    const advisories = rows.filter((f) => f.id.startsWith('ends.advisory')).map((f) => f.toRaw(conn));
    expect(advisories).toEqual([
      "The caller's deadline (50 ms) is below the callee's expected p95 (80 ms).",
      'The caller retries an endpoint declared not idempotent.',
    ]);
  });
});

describe('fieldsForElement: port settings (D53)', () => {
  const outPort = { id: 'po', label: 'out', direction: 'out', channel: 'call', protocol: 'http', schemaId: 's', responseSchemaId: 'r' } as Element['ports'][number];
  const inPort = { id: 'pi', label: 'in', direction: 'in', channel: 'call', protocol: 'grpc', path: '/orders', schemaId: 's', responseSchemaId: 'r' } as Element['ports'][number];

  it('groups a node\'s fields per port, labelled by protocol and path', () => {
    const el = processorElement({ ports: [inPort, outPort] });
    const groups = [...new Set(fieldsForElement(el).map((f) => f.group).filter(Boolean))];
    expect(groups).toEqual(['In · gRPC /orders', 'Out · HTTP / REST']);
  });

  it('the caller retries from its out-port: Attempts 1 removes the policy, raising it adds one', () => {
    const el = processorElement({ ports: [outPort] });
    const attempts = fieldsForElement(el).find((f) => f.id === 'port.po.retry.maxAttempts')!;
    expect(attempts.toRaw(el)).toBe('1');
    const withRetry = attempts.apply(el, 3) as Element;
    expect(withRetry.ports[0].settings).toEqual({ retry: { maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 10000, jitter: true, attemptTimeoutMs: null } });
    expect(fieldsForElement(withRetry).some((f) => f.id === 'port.po.retry.attemptTimeoutMs')).toBe(true);
    const off = attempts.apply(withRetry, 1) as Element;
    expect(off.ports[0].settings).toBeUndefined();
  });

  it('a callee declares its contract and, on a simulated node, behavior for the endpoint; blank removes a setting', () => {
    const el = processorElement({ ports: [inPort] });
    const fields = fieldsForElement(el);
    const p95 = fields.find((f) => f.id === 'port.pi.expectedP95Ms')!;
    expect(p95.toRaw(el)).toBe('');
    const set = p95.apply(el, 80) as Element;
    expect(set.ports[0].settings).toEqual({ expectedP95Ms: 80 });
    expect((p95.apply(set, null) as Element).ports[0].settings).toBeUndefined();
    expect(fields.some((f) => f.id === 'port.pi.rateLimit.rps')).toBe(true);
    const limited = fields.find((f) => f.id === 'port.pi.rateLimit.rps')!.apply(el, 100) as Element;
    expect(limited.ports[0].settings).toEqual({ rateLimit: { rps: 100, burst: 100 } });
    expect(fieldsForElement(limited).some((f) => f.id === 'port.pi.rateLimit.burst')).toBe(true);
    // Behavior overrides only exist on nodes the runner simulates.
    const unmodeled = processorElement({ ports: [inPort], behavior: { kind: 'unmodeled', version: 1, reason: 'x' } });
    expect(fieldsForElement(unmodeled).some((f) => f.id === 'port.pi.rateLimit.rps')).toBe(false);
    expect(fieldsForElement(unmodeled).some((f) => f.id === 'port.pi.expectedP95Ms')).toBe(true);
  });

  it('a caller can open a circuit breaker, cap in-flight calls and hedge, and each is removed by blanking it (D54)', () => {
    const el = processorElement({ ports: [outPort] });
    const fields = fieldsForElement(el);
    const threshold = fields.find((f) => f.id === 'port.po.circuitBreaker.failureThreshold')!;
    expect(fieldsForElement(el).some((f) => f.id === 'port.po.circuitBreaker.openMs')).toBe(false);
    const open = threshold.apply(el, 5) as Element;
    expect(open.ports[0].settings).toEqual({ circuitBreaker: { failureThreshold: 5, openMs: 30000, halfOpenProbes: 1 } });
    const detail = fieldsForElement(open).find((f) => f.id === 'port.po.circuitBreaker.halfOpenProbes')!;
    expect((detail.apply(open, 3) as Element).ports[0].settings).toEqual({ circuitBreaker: { failureThreshold: 5, openMs: 30000, halfOpenProbes: 3 } });
    expect((threshold.apply(open, null) as Element).ports[0].settings).toBeUndefined();

    const inFlight = fields.find((f) => f.id === 'port.po.maxInFlight')!.apply(el, 20) as Element;
    expect(inFlight.ports[0].settings).toEqual({ maxInFlight: 20 });
    const hedge = fields.find((f) => f.id === 'port.po.hedge.afterMs')!.apply(inFlight, 80) as Element;
    expect(hedge.ports[0].settings).toEqual({ maxInFlight: 20, hedge: { afterMs: 80 } });
    const bytes = fields.find((f) => f.id === 'port.po.requestBytes')!.apply(el, 2048) as Element;
    expect(bytes.ports[0].settings).toEqual({ requestBytes: 2048 });
  });

  it('a publisher chooses fire-and-forget and batching; a callee caps concurrency and sizes its reply (D54)', () => {
    const msgOut = { id: 'pm', label: 'out', direction: 'out', channel: 'message', protocol: 'amqp', schemaId: 's', responseSchemaId: null } as Element['ports'][number];
    const el = processorElement({ ports: [msgOut] });
    const fields = fieldsForElement(el);
    const confirm = fields.find((f) => f.id === 'port.pm.confirm')!;
    expect(confirm.toRaw(el)).toBe('yes');
    const forgotten = confirm.apply(el, 'no') as Element;
    expect(forgotten.ports[0].settings).toEqual({ confirm: false });
    expect(confirm.toRaw(forgotten)).toBe('no');
    expect((confirm.apply(forgotten, 'yes') as Element).ports[0].settings).toBeUndefined();
    const batched = fields.find((f) => f.id === 'port.pm.batch.size')!.apply(el, 10) as Element;
    expect(batched.ports[0].settings).toEqual({ batch: { size: 10, windowMs: 100 } });
    expect(fieldsForElement(batched).some((f) => f.id === 'port.pm.batch.windowMs')).toBe(true);

    const callee = processorElement({ ports: [inPort] });
    const cap = fieldsForElement(callee).find((f) => f.id === 'port.pi.maxConcurrency')!.apply(callee, 8) as Element;
    expect(cap.ports[0].settings).toEqual({ maxConcurrency: 8 });
    expect(fieldsForElement(callee).find((f) => f.id === 'port.pi.maxConcurrency')!.note).toMatch(/^Simulated/);
    const sized = fieldsForElement(callee).find((f) => f.id === 'port.pi.responseBytes')!.apply(callee, 1000) as Element;
    expect(sized.ports[0].settings).toEqual({ responseBytes: 1000 });
  });

  it('a link takes jitter, loss and a bandwidth that blank clears (D54)', () => {
    const conn = callConnection();
    const fields = fieldsForConnection(conn);
    const bandwidth = fields.find((f) => f.id === 'config.bandwidthKbps')!;
    expect(bandwidth.toRaw(conn)).toBe('');
    const limited = bandwidth.apply(conn, 8000);
    expect(limited.kind === 'call' && limited.config.bandwidthKbps).toBe(8000);
    expect((bandwidth.apply(limited, null) as { config: { bandwidthKbps: unknown } }).config.bandwidthKbps).toBeNull();
    expect(fields.find((f) => f.id === 'config.lossRate')!.parse('101').ok).toBe(false);
    expect(fields.find((f) => f.id === 'config.jitterMs')!.parse('-1').ok).toBe(false);
  });

  it('an unsimulated caller also has a deadline and a request class; a simulated one inherits them', () => {
    const client = processorElement({ ports: [outPort], behavior: { kind: 'unmodeled', version: 1, reason: 'x' } });
    expect(fieldsForElement(client).some((f) => f.id === 'port.po.deadlineDurationMs')).toBe(true);
    expect(fieldsForElement(client).find((f) => f.id === 'port.po.request.none')).toBeDefined();
    expect(fieldsForElement(processorElement({ ports: [outPort] })).some((f) => f.id === 'port.po.deadlineDurationMs')).toBe(false);
  });
});

describe('kindTagForConnection', () => {
  it('uppercases the connection kind', () => {
    expect(kindTagForConnection(callConnection())).toBe('CALL');
  });
});

describe('linked-project elements (D52)', () => {
  const linked = processorElement({ visualKind: 'linked-project', label: 'Orders system', linkedProjectId: '00000000-0000-4000-8000-0000000000aa' });

  it('shows only read-only fields, so nothing can be edited or applied', () => {
    const fields = fieldsForElement(linked);
    expect(fields.map((f) => f.id)).toEqual(['linked.project', 'linked.id', 'behavior.summary']);
    expect(fields.every((f) => f.kind === 'readonly')).toBe(true);
    expect(fields[0].toRaw(linked)).toBe('Orders system');
    expect(fields.every((f) => f.apply(linked, 'x') === linked)).toBe(true);
  });

  it('tags the header as a linked project, not as a processor', () => {
    expect(kindTagForElement(linked)).toEqual({ tag: 'LINKED PROJECT', notSimulated: false });
  });
});

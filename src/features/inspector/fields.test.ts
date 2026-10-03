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
    label: 'authorize',
    kind: 'call',
    source: { elementId: 'a', portId: 'p-out' },
    target: { elementId: 'b', portId: 'p-in' },
    config: {
      latencyMs: 10,
      returnLatencyMs: 5,
      weight: 1,
      condition: null,
      fallback: false,
      resource: null,
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
  it('retries: Attempts 1 means none; raising it adds a policy and its detail fields (D49)', () => {
    const conn = callConnection();
    const attempts = fieldsForConnection(conn).find((f) => f.id === 'config.retry.maxAttempts')!;
    expect(attempts.toRaw(conn)).toBe('1');
    expect(fieldsForConnection(conn).some((f) => f.id === 'config.retry.backoffMs')).toBe(false);
    const withRetry = attempts.apply(conn, 3);
    expect(withRetry.kind === 'call' && withRetry.config.retry).toEqual({
      maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2, maxBackoffMs: 10000, jitter: true, attemptTimeoutMs: null,
    });
    const ids = fieldsForConnection(withRetry).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['config.retry.backoffMs', 'config.retry.jitter', 'config.retry.attemptTimeoutMs']));
    const timeout = fieldsForConnection(withRetry).find((f) => f.id === 'config.retry.attemptTimeoutMs')!;
    const timed = timeout.apply(withRetry, 250);
    expect(timed.kind === 'call' && timed.config.retry?.attemptTimeoutMs).toBe(250);
    const off = attempts.apply(timed, 1);
    expect(off.kind === 'call' && off.config.retry).toBeNull();
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

  it('call: condition/fallback/resource are shown read-only only when present', () => {
    const withExtras = callConnection({
      config: {
        latencyMs: 1,
        returnLatencyMs: 1,
        weight: 1,
        condition: { field: 'class', value: 'premium' },
        fallback: true,
        resource: { requestClassId: 'rc1', requestClassLabel: 'Order', operation: 'write', key: null, tags: [], deadlineDurationMs: 500 },
      },
    } as Partial<Connection>);
    const fields = fieldsForConnection(withExtras);
    const condition = fields.find((f) => f.id === 'config.condition')!;
    expect(condition.kind).toBe('readonly');
    expect(condition.toRaw(withExtras)).toBe('class = premium');
    expect(fields.find((f) => f.id === 'config.fallback')!.toRaw(withExtras)).toBe('Yes');
    expect(fields.find((f) => f.id === 'config.resource')!.toRaw(withExtras)).toContain('write');

    const plain = callConnection();
    const plainFields = fieldsForConnection(plain);
    expect(plainFields.some((f) => f.id === 'config.condition')).toBe(false);
    expect(plainFields.some((f) => f.id === 'config.resource')).toBe(false);
  });

  it('message: latencyMs/ackDelayMs/messageTtlMs/weight with contract bounds', () => {
    const conn: Connection = {
      id: 'c-2',
      label: 'enqueue',
      kind: 'message',
      source: { elementId: 'a', portId: 'p-out' },
      target: { elementId: 'b', portId: 'p-in' },
      config: {
        latencyMs: 0,
        ackDelayMs: 0,
        messageTtlMs: 10000,
        weight: 1,
        condition: null,
        fallback: false,
        resource: null,
      },
    };
    const fields = fieldsForConnection(conn);
    expect(fields.find((f) => f.id === 'config.messageTtlMs')!.parse('0').ok).toBe(false);
    expect(fields.find((f) => f.id === 'config.messageTtlMs')!.parse('3600000').ok).toBe(true);
  });

  it('data connections: label only, no config fields', () => {
    const conn: Connection = {
      id: 'c-3',
      label: 'copy',
      kind: 'data',
      source: { elementId: 'a', portId: 'p-out' },
      target: { elementId: 'b', portId: 'p-in' },
      config: {},
    };
    const fields = fieldsForConnection(conn);
    expect(fields.map((f) => f.id)).toEqual(['label']);
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

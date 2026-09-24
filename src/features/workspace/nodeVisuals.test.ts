import { describe, expect, it } from 'vitest';
import type { Element } from '../../domain/studio/model';
import { formatThousands, getNodeCaption, getNodeIcon } from './nodeVisuals';

function makeElement(overrides: Partial<Element> = {}): Element {
  return {
    id: 'el-1',
    label: 'Test element',
    description: '',
    visualKind: 'service',
    ports: [],
    behavior: { kind: 'unmodeled', version: 1, reason: 'test' },
    ...overrides,
  };
}

describe('nodeVisuals: icon mapping', () => {
  it('returns a distinct icon per catalog visualKind (spot checks)', () => {
    expect(getNodeIcon('service')).toBeDefined();
    expect(getNodeIcon('queue')).toBeDefined();
    expect(getNodeIcon('service')).not.toBe(getNodeIcon('queue'));
  });

  it('falls back to the neutral icon for an unmapped visualKind', () => {
    const icon = getNodeIcon('not-a-real-kind');
    expect(icon).toBeDefined();
  });

  it('covers state-machine, data-pipeline and host (D35/D42 stripe-gap kinds still get an icon)', () => {
    expect(getNodeIcon('state-machine')).toBeDefined();
    expect(getNodeIcon('data-pipeline')).toBeDefined();
    expect(getNodeIcon('host')).toBeDefined();
  });
});

describe('nodeVisuals: formatThousands (thin-space grouping)', () => {
  it('leaves values under 1000 unchanged', () => {
    expect(formatThousands(0)).toBe('0');
    expect(formatThousands(80)).toBe('80');
    expect(formatThousands(500)).toBe('500');
  });

  it('groups thousands with a thin space (U+2009)', () => {
    expect(formatThousands(2000)).toBe('2 000');
    expect(formatThousands(100000)).toBe('100 000');
  });

  it('rounds and preserves sign', () => {
    expect(formatThousands(2000.4)).toBe('2 000');
    expect(formatThousands(-1500)).toBe('-1 500');
  });
});

describe('nodeVisuals: caption mapping (D42 catalog.md item 10)', () => {
  it('unmodeled elements always show exactly "Not simulated" (items 7 & 12), regardless of visualKind', () => {
    for (const visualKind of ['email', 'monitoring', 'analytics', 'secrets', 'thirdparty', 'custom', 'traffic', 'client'] as const) {
      const el = makeElement({
        visualKind,
        behavior: { kind: 'unmodeled', version: 1, reason: 'not simulated' },
      });
      expect(getNodeCaption(el)).toBe('Not simulated');
    }
  });

  it('router resource: "router · <strategy>"', () => {
    const el = makeElement({
      visualKind: 'gateway',
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
    expect(getNodeCaption(el)).toBe('router · round-robin');
  });

  it('broker resource: "broker · <delivery>"', () => {
    const el = makeElement({
      visualKind: 'queue',
      behavior: {
        kind: 'resource',
        version: 1,
        entryPortId: 'p1',
        config: {
          type: 'broker',
          delivery: 'competing',
          capacity: 500,
          concurrency: 1,
          queueLimit: 100,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    });
    expect(getNodeCaption(el)).toBe('broker · competing');
  });

  it('cache resource: "cache · <hitRate>% hit"', () => {
    const el = makeElement({
      visualKind: 'cache',
      behavior: {
        kind: 'resource',
        version: 1,
        entryPortId: 'p1',
        config: {
          type: 'cache',
          mode: 'lru',
          hitRate: 80,
          entries: 100,
          ttlMs: 1000,
          capacity: 5000,
          concurrency: 1,
          queueLimit: 0,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    });
    expect(getNodeCaption(el)).toBe('cache · 80% hit');
  });

  it('storage resource: "storage · <capacity> /s cap"', () => {
    const el = makeElement({
      visualKind: 'database',
      behavior: {
        kind: 'resource',
        version: 1,
        entryPortId: 'p1',
        config: {
          type: 'storage',
          writeCapacity: 500,
          capacity: 500,
          concurrency: 1,
          queueLimit: 0,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    });
    expect(getNodeCaption(el)).toBe('storage · 500 /s cap');
  });

  it('processor/source resource: "<type> · <capacity> /s cap" with thin-space grouping', () => {
    const processor = makeElement({
      visualKind: 'service',
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
    });
    expect(getNodeCaption(processor)).toBe('processor · 2 000 /s cap');

    const source = makeElement({
      visualKind: 'traffic',
      behavior: {
        kind: 'resource',
        version: 1,
        entryPortId: 'p1',
        config: {
          type: 'source',
          capacity: 2000,
          concurrency: 1,
          queueLimit: 500,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 100,
        },
      },
    });
    expect(getNodeCaption(source)).toBe('source · 2 000 /s cap');
  });

  it('machine behavior: "state machine · n states"', () => {
    const el = makeElement({
      visualKind: 'state-machine',
      behavior: {
        kind: 'machine',
        version: 1,
        states: [{ id: 's1', label: 'A' }, { id: 's2', label: 'B' }],
        initialStateId: 's1',
        contextSchemaId: 'sc1',
        initialContextFixtureId: 'f1',
        transitions: [],
        responseBindings: [],
      },
    });
    expect(getNodeCaption(el)).toBe('state machine · 2 states');
  });

  it('machine behavior singular: "state machine · 1 state"', () => {
    const el = makeElement({
      visualKind: 'state-machine',
      behavior: {
        kind: 'machine',
        version: 1,
        states: [{ id: 's1', label: 'A' }],
        initialStateId: 's1',
        contextSchemaId: 'sc1',
        initialContextFixtureId: 'f1',
        transitions: [],
        responseBindings: [],
      },
    });
    expect(getNodeCaption(el)).toBe('state machine · 1 state');
  });

  it('pipeline behavior: "data pipeline · n steps"', () => {
    const el = makeElement({
      visualKind: 'data-pipeline',
      behavior: {
        kind: 'pipeline',
        version: 1,
        inputSchemaId: 'i1',
        outputSchemaId: 'o1',
        errorSchemaId: 'e1',
        inputPortId: 'p1',
        outputPortId: 'p2',
        errorPortId: 'p3',
        operations: [{} as never, {} as never, {} as never],
      },
    });
    expect(getNodeCaption(el)).toBe('data pipeline · 3 steps');
  });

  it('host behavior: exactly "host"', () => {
    const el = makeElement({
      visualKind: 'host',
      behavior: { kind: 'host', version: 1 },
    });
    expect(getNodeCaption(el)).toBe('host');
  });

  it('never renders measured/run-only fields like p99 or pressure', () => {
    const el = makeElement();
    const caption = getNodeCaption(el);
    expect(caption).not.toMatch(/p99|p95|pressure|headroom/i);
  });
});

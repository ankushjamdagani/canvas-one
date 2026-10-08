import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  Document,
  Element,
  Connection,
  Port,
  Scenario,
  Shape,
  CallConnectionConfig,
  MachineBehavior,
  PipelineBehavior,
  DecisionBehavior,
  ResourceBehavior,
  Transition,
  MachineResponseBinding,
  Guard,
  Value,
  Effect,
} from './model';
import { checkReadiness, normalizeShape, shapesCompatible } from './readiness';
import { validateDocument } from './validate';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');

function loadFixture(name: string): Document {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as Document;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

// ============================================================================
// Reference fixtures: every scenario must be ready.
// ============================================================================

describe('checkReadiness reference fixtures', () => {
  const fixtureFiles = ['s01.json', 's02.json', 's03.json', 's04.json', 's05.json'];

  for (const file of fixtureFiles) {
    it(`every scenario in ${file} is ready`, () => {
      const doc = loadFixture(file);
      expect(doc.scenarios.length).toBeGreaterThan(0);
      for (const scenario of doc.scenarios) {
        const result = checkReadiness(doc, scenario.id);
        if (!result.ready) {
          throw new Error(
            `Scenario ${scenario.id} in ${file} is not ready: ${JSON.stringify(result.issues, null, 1)}`,
          );
        }
        expect(result.ready).toBe(true);
      }
    });
  }

  it('every scenario in combined.json is ready', () => {
    const doc = loadFixture('combined.json');
    expect(doc.scenarios.length).toBeGreaterThan(0);
    for (const scenario of doc.scenarios) {
      const result = checkReadiness(doc, scenario.id);
      if (!result.ready) {
        throw new Error(`Scenario ${scenario.id} in combined.json is not ready: ${JSON.stringify(result.issues, null, 1)}`);
      }
      expect(result.ready).toBe(true);
    }
  });
});

// ============================================================================
// Synthetic minimal documents for isolated mutation testing.
// ============================================================================

const S_ID = 's-empty-record';

function port(id: string, direction: Port['direction'], channel: Port['channel'], schemaId: string, responseSchemaId: string | null = null): Port {
  return { id, label: id, direction, channel, protocol: channel === 'event' ? null : channel === 'message' ? 'amqp' : channel === 'data' ? 'jdbc' : 'http', schemaId, responseSchemaId };
}

function machineElement(
  id: string,
  ports: Port[],
  transitions: readonly Transition[] = [],
  responseBindings: readonly MachineResponseBinding[] = [],
): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'state-machine',
    ports,
    behavior: {
      kind: 'machine',
      version: 1,
      states: [{ id: 'st1', label: 'st1' }],
      initialStateId: 'st1',
      contextSchemaId: S_ID,
      initialContextFixtureId: 'fx-ctx',
      transitions,
      responseBindings,
    },
  };
}

function resourceElement(id: string, entryPortId: string, ports: Port[]): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'queue',
    ports,
    behavior: {
      kind: 'resource',
      version: 1,
      config: {
        type: 'processor',
        capacity: 10,
        concurrency: 1,
        queueLimit: 0,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 0,
      },
      entryPortId,
    },
  };
}

const callConfig: CallConnectionConfig = {
  latencyMs: 0,
  returnLatencyMs: 0,
  weight: 1,
  condition: null,
  fallback: false,
  linkClass: null, jitterMs: 0, lossRate: 0, bandwidthKbps: null,
};

function baseDoc(elements: Element[], connections: Connection[], scenario: Scenario, extraSchemas: { id: string; label: string; shape: Shape }[] = []): Document {
  return {
    schema: 'studio-model/1',
    id: 'doc1',
    title: 'doc',
    elements,
    connections,
    relations: [],
    schemas: [
      { id: S_ID, label: 'Empty', shape: { type: 'record', nullable: false, fields: [] } },
      ...extraSchemas,
    ],
    fixtures: [
      { id: 'fx-ctx', schemaId: S_ID, value: {} },
      { id: 'fx-input', schemaId: S_ID, value: {} },
    ],
    refinements: [],
    scenarios: [scenario],
    views: [],
  };
}

const defaultBudgets = {
  maxEvents: 100000,
  maxTraceRows: 10000,
  maxTraceBytes: 4194304,
  maxScheduledEvents: 100000,
  maxLiveRoots: 10000,
};

// -- Logical happy-path baseline: a single machine reached directly. --------

function logicalHappyDoc(): Document {
  const M = machineElement('m1', [port('p1', 'in', 'data', S_ID)]);
  const scenario: Scenario = {
    id: 'scn-logical',
    label: 'logical',
    revision: 0,
    mode: 'logical',
    scopeElementIds: ['m1'],
    entryPorts: [{ elementId: 'm1', portId: 'p1' }],
    inputs: [
      { id: 'in1', entry: { elementId: 'm1', portId: 'p1' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
    ],
    workloads: [],
    faults: [],
    boundaries: [],
    refinementSelections: [],
    initialContexts: [],
    assertions: [
      { id: 'a1', label: 'final', subject: { kind: 'final-state', elementId: 'm1' }, operator: 'equals', expected: 'st1' },
    ],
    seed: 1,
    budgets: defaultBudgets,
    assumptions: [],
  };
  return baseDoc([M], [], scenario);
}

// -- Timed happy-path baseline: a single resource reached directly. --------

function timedHappyDoc(): Document {
  const R = resourceElement('r1', 'rp1', [port('rp1', 'in', 'call', S_ID, S_ID)]);
  const scenario: Scenario = {
    id: 'scn-timed',
    label: 'timed',
    revision: 0,
    mode: 'timed',
    scopeElementIds: ['r1'],
    entryPorts: [{ elementId: 'r1', portId: 'rp1' }],
    inputs: [
      {
        id: 'in1',
        entry: { elementId: 'r1', portId: 'rp1' },
        fixtureId: 'fx-input',
        journeyId: 'j1',
        atMs: 0,
        payloadBindings: [],
        resource: { requestClassId: 'rc1', operation: 'read', key: null, tags: [], deadlineMs: 5000 },
      },
    ],
    workloads: [],
    faults: [],
    boundaries: [],
    refinementSelections: [],
    initialContexts: [],
    assertions: [
      { id: 'a1', label: 'succeeded', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 1 },
    ],
    seed: 1,
    budgets: defaultBudgets,
    assumptions: [],
  };
  return baseDoc([R], [], scenario);
}

describe('checkReadiness synthetic baselines are ready', () => {
  it('logical happy-path baseline is ready', () => {
    const result = checkReadiness(logicalHappyDoc(), 'scn-logical');
    expect(result.ready).toBe(true);
  });

  it('timed happy-path baseline is ready', () => {
    const result = checkReadiness(timedHappyDoc(), 'scn-timed');
    expect(result.ready).toBe(true);
  });
});

describe('checkReadiness mutation tests', () => {
  it('rejects a call port with null responseSchemaId', () => {
    const doc = clone(timedHappyDoc());
    (doc.elements[0].ports[0] as { responseSchemaId: string | null }).responseSchemaId = null;
    const result = checkReadiness(doc, 'scn-timed');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      const found = result.issues.find((i) => i.code === 'call-port-missing-response-schema');
      expect(found).toBeDefined();
      expect(found?.path).toEqual(['elements', 0, 'ports', 0, 'responseSchemaId']);
      expect(found?.entityId).toBe('rp1');
    }
  });

  it('rejects incompatible payload shapes across a connection', () => {
    const shapeA: Shape = { type: 'record', nullable: false, fields: [{ id: 'f1', key: 'x', optional: false, shape: { type: 'string', nullable: false } }] };
    const shapeB: Shape = { type: 'record', nullable: false, fields: [{ id: 'f2', key: 'x', optional: false, shape: { type: 'integer', nullable: false } }] };
    // Resource elements' connected outbound ports are always closure-reachable
    // (closure.ts: "resource -> all its outbound ports that have connections"),
    // so we use resources here purely to get the connection into the compiled
    // scope regardless of dispatch semantics.
    const A = resourceElement('a1', 'a-in', [port('a-in', 'in', 'call', S_ID, S_ID), port('ap1', 'out', 'data', 'schema-a')]);
    const B = resourceElement('b1', 'bp1', [port('bp1', 'in', 'data', 'schema-b')]);
    const conn: Connection = { id: 'c1', kind: 'data', source: { elementId: 'a1', portId: 'ap1' }, target: { elementId: 'b1', portId: 'bp1' }, config: {} };
    const scenario: Scenario = {
      id: 'scn-shapes',
      label: 'shapes',
      revision: 0,
      mode: 'logical',
      scopeElementIds: ['a1', 'b1'],
      entryPorts: [{ elementId: 'a1', portId: 'a-in' }],
      inputs: [{ id: 'in1', entry: { elementId: 'a1', portId: 'a-in' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null }],
      workloads: [],
      faults: [],
      boundaries: [],
      refinementSelections: [],
      initialContexts: [],
      assertions: [{ id: 'a1', label: 'final', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 0 }],
      seed: 1,
      budgets: defaultBudgets,
      assumptions: [],
    };
    const doc = baseDoc([A, B], [conn], scenario, [
      { id: 'schema-a', label: 'A', shape: shapeA },
      { id: 'schema-b', label: 'B', shape: shapeB },
    ]);
    const result = checkReadiness(doc, 'scn-shapes');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'incompatible-port-shapes')).toBe(true);
    }
  });

  it('normalizeShape/shapesCompatible: compatible when only field ids/labels/order differ', () => {
    const shapeA: Shape = {
      type: 'record',
      nullable: false,
      fields: [
        { id: 'id-1', key: 'b', optional: false, shape: { type: 'string', nullable: false } },
        { id: 'id-2', key: 'a', optional: true, shape: { type: 'integer', nullable: false } },
      ],
    };
    const shapeB: Shape = {
      type: 'record',
      nullable: false,
      fields: [
        { id: 'other-id-2', key: 'a', optional: true, shape: { type: 'integer', nullable: false } },
        { id: 'other-id-1', key: 'b', optional: false, shape: { type: 'string', nullable: false } },
      ],
    };
    expect(shapesCompatible(shapeA, shapeB)).toBe(true);
    expect(normalizeShape(shapeA)).toEqual(normalizeShape(shapeB));
  });

  it('normalizeShape/shapesCompatible: incompatible when a field type differs', () => {
    const shapeA: Shape = { type: 'record', nullable: false, fields: [{ id: 'f1', key: 'x', optional: false, shape: { type: 'string', nullable: false } }] };
    const shapeB: Shape = { type: 'record', nullable: false, fields: [{ id: 'f1', key: 'x', optional: false, shape: { type: 'integer', nullable: false } }] };
    expect(shapesCompatible(shapeA, shapeB)).toBe(false);
  });

  it('rejects a synchronous call cycle', () => {
    const R1 = resourceElement('r1', 'rp1', [port('rp1', 'in', 'call', S_ID, S_ID), port('rp1-out', 'out', 'call', S_ID, S_ID)]);
    const R2 = resourceElement('r2', 'rp2', [port('rp2', 'in', 'call', S_ID, S_ID), port('rp2-out', 'out', 'call', S_ID, S_ID)]);
    const conn1: Connection = { id: 'c1', kind: 'call', source: { elementId: 'r1', portId: 'rp1-out' }, target: { elementId: 'r2', portId: 'rp2' }, config: callConfig };
    const conn2: Connection = { id: 'c2', kind: 'call', source: { elementId: 'r2', portId: 'rp2-out' }, target: { elementId: 'r1', portId: 'rp1' }, config: callConfig };
    const scenario: Scenario = {
      id: 'scn-cycle',
      label: 'cycle',
      revision: 0,
      mode: 'timed',
      scopeElementIds: ['r1', 'r2'],
      entryPorts: [{ elementId: 'r1', portId: 'rp1' }],
      inputs: [
        {
          id: 'in1',
          entry: { elementId: 'r1', portId: 'rp1' },
          fixtureId: 'fx-input',
          journeyId: 'j1',
          atMs: 0,
          payloadBindings: [],
          resource: { requestClassId: 'rc1', operation: 'read', key: null, tags: [], deadlineMs: 5000 },
        },
      ],
      workloads: [],
      faults: [],
      boundaries: [],
      refinementSelections: [],
      initialContexts: [],
      assertions: [{ id: 'a1', label: 's', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 1 }],
      seed: 1,
      budgets: defaultBudgets,
      assumptions: [],
    };
    const doc = baseDoc([R1, R2], [conn1, conn2], scenario);
    const result = checkReadiness(doc, 'scn-cycle');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'sync-call-cycle')).toBe(true);
    }
  });

  it('rejects a logical scenario input with atMs 0 (must be null)', () => {
    const doc = clone(logicalHappyDoc());
    (doc.scenarios[0] as any).inputs[0].atMs = 0;
    const result = checkReadiness(doc, 'scn-logical');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      const found = result.issues.find((i) => i.code === 'invalid-input-timing');
      expect(found).toBeDefined();
      expect(found?.path).toEqual(['scenarios', 0, 'inputs', 0, 'atMs']);
    }
  });

  it('rejects a timed scenario input with atMs null (must be >= 0)', () => {
    const doc = clone(timedHappyDoc());
    (doc.scenarios[0] as any).inputs[0].atMs = null;
    const result = checkReadiness(doc, 'scn-timed');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'invalid-input-timing')).toBe(true);
    }
  });

  it('rejects a logical scenario that reaches a resource', () => {
    const R = resourceElement('r1', 'rp1', [port('rp1', 'in', 'call', S_ID, S_ID)]);
    const scenario: Scenario = {
      id: 'scn-logical-resource',
      label: 'logical-resource',
      revision: 0,
      mode: 'logical',
      scopeElementIds: ['r1'],
      entryPorts: [{ elementId: 'r1', portId: 'rp1' }],
      inputs: [{ id: 'in1', entry: { elementId: 'r1', portId: 'rp1' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: { requestClassId: 'rc1', operation: 'read', key: null, tags: [], deadlineMs: 5000 } }],
      workloads: [],
      faults: [],
      boundaries: [],
      refinementSelections: [],
      initialContexts: [],
      assertions: [{ id: 'a1', label: 's', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 1 }],
      seed: 1,
      budgets: defaultBudgets,
      assumptions: [],
    };
    const doc = baseDoc([R], [], scenario);
    const result = checkReadiness(doc, 'scn-logical-resource');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'logical-reaches-resource')).toBe(true);
    }
  });

  it('rejects a timed scenario with no inputs and no enabled workloads', () => {
    const doc = clone(timedHappyDoc());
    (doc.scenarios[0] as any).inputs = [];
    const result = checkReadiness(doc, 'scn-timed');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'no-arrivals')).toBe(true);
    }
  });

  const bulkWorkload = (emission: unknown, enabled = true) => ({
    id: 'w1',
    entry: { elementId: 'r1', portId: 'rp1' },
    enabled,
    startDelayMs: 0,
    emission,
    timeoutMs: 1000,
    classes: [{ id: 'c1', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 1 } }],
  });
  const withWorkload = (workload: unknown) => {
    const doc = clone(timedHappyDoc());
    (doc.scenarios[0] as any).inputs = [];
    (doc.scenarios[0] as any).workloads = [workload];
    return doc;
  };
  const codes = (doc: ReturnType<typeof timedHappyDoc>) => {
    const result = checkReadiness(doc, 'scn-timed');
    return result.ready ? [] : result.issues.map((i) => i.code);
  };

  it('accepts a bulk and a stream as the only traffic', () => {
    expect(checkReadiness(withWorkload(bulkWorkload({ mode: 'bulk', requests: 10, arrival: { spreadMs: 1000 } })), 'scn-timed').ready).toBe(true);
    expect(checkReadiness(withWorkload(bulkWorkload({ mode: 'stream', ratePerSecond: 5, profile: { kind: 'steady' } })), 'scn-timed').ready).toBe(true);
  });

  it('rejects a bulk with no requests or a spread under a millisecond', () => {
    expect(codes(withWorkload(bulkWorkload({ mode: 'bulk', requests: 0, arrival: 'instant' })))).toContain('workload-emission-range');
    expect(codes(withWorkload(bulkWorkload({ mode: 'bulk', requests: 5, arrival: { spreadMs: 0 } })))).toContain('workload-emission-range');
    expect(codes(withWorkload(bulkWorkload({ mode: 'bulk', requests: 2.5, arrival: 'instant' })))).toContain('workload-emission-range');
  });

  it('rejects an enabled stream with no rate, but not a disabled one', () => {
    const stream = { mode: 'stream', ratePerSecond: 0, profile: { kind: 'steady' } };
    expect(codes(withWorkload(bulkWorkload(stream)))).toContain('workload-emission-range');
    expect(codes(withWorkload(bulkWorkload(stream, false)))).not.toContain('workload-emission-range');
  });

  it('rejects a workload in a logical scenario', () => {
    const doc = clone(logicalHappyDoc());
    (doc.scenarios[0] as any).workloads = [bulkWorkload({ mode: 'bulk', requests: 1, arrival: 'instant' })];
    const result = checkReadiness(doc, 'scn-logical');
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.issues.map((i) => i.code)).toContain('workload-in-logical');
  });

  it('rejects a boundary delayMs set in logical mode', () => {
    const doc = clone(logicalHappyDoc());
    (doc.scenarios[0] as any).boundaries = [
      {
        id: 'b1',
        source: { elementId: 'm1', portId: 'p1' },
        schemaId: S_ID,
        responses: [
          {
            id: 'r1',
            match: { op: 'exists', value: { kind: 'literal', value: true } },
            responseFixtureId: 'fx-input',
            payloadBindings: [],
            delayMs: 100,
            afterInputId: null,
            outcome: 'succeeded',
          },
        ],
      },
    ];
    const result = checkReadiness(doc, 'scn-logical');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'boundary-timing-mode-mismatch')).toBe(true);
    }
  });

  it('rejects a scenario with zero assertions', () => {
    const doc = clone(logicalHappyDoc());
    (doc.scenarios[0] as any).assertions = [];
    const result = checkReadiness(doc, 'scn-logical');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'no-assertions')).toBe(true);
    }
  });

  it('rejects an assertion subject element outside compiled scope', () => {
    const doc = clone(logicalHappyDoc());
    (doc.scenarios[0] as any).assertions[0] = { id: 'a1', label: 'final', subject: { kind: 'final-state', elementId: 'ghost' }, operator: 'equals', expected: 'st1' };
    const result = checkReadiness(doc, 'scn-logical');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      const found = result.issues.find((i) => i.code === 'assertion-subject-out-of-scope');
      expect(found).toBeDefined();
      expect(found?.entityId).toBe('a1');
    }
  });

  it('rejects a workload targeting a non-resource port', () => {
    const doc = clone(timedHappyDoc());
    const D = machineElement('d1', [port('dp1', 'in', 'data', S_ID)]);
    (doc.elements as any).push(D);
    (doc.scenarios[0] as any).workloads = [
      {
        id: 'w1',
        entry: { elementId: 'd1', portId: 'dp1' },
        enabled: true,
        startDelayMs: 0,
        emission: { mode: 'bulk', requests: 1, arrival: 'instant' },
        timeoutMs: 1000,
        classes: [{ id: 'c1', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 1 } }],
      },
    ];
    const result = checkReadiness(doc, 'scn-timed');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'workload-target-not-resource-entry')).toBe(true);
    }
  });

  it('propagates an unresolved crossing from computeClosure', () => {
    const R = resourceElement('r1', 'rp1', [port('rp1', 'in', 'call', S_ID, S_ID), port('rp2', 'out', 'call', S_ID, S_ID)]);
    const X = machineElement('x1', [port('xp1', 'in', 'call', S_ID, S_ID)]);
    const conn: Connection = { id: 'c1', kind: 'call', source: { elementId: 'r1', portId: 'rp2' }, target: { elementId: 'x1', portId: 'xp1' }, config: callConfig };
    const scenario: Scenario = {
      id: 'scn-crossing',
      label: 'crossing',
      revision: 0,
      mode: 'timed',
      scopeElementIds: ['r1'],
      entryPorts: [{ elementId: 'r1', portId: 'rp1' }],
      inputs: [
        {
          id: 'in1',
          entry: { elementId: 'r1', portId: 'rp1' },
          fixtureId: 'fx-input',
          journeyId: 'j1',
          atMs: 0,
          payloadBindings: [],
          resource: { requestClassId: 'rc1', operation: 'read', key: null, tags: [], deadlineMs: 5000 },
        },
      ],
      workloads: [],
      faults: [],
      boundaries: [],
      refinementSelections: [],
      initialContexts: [],
      assertions: [{ id: 'a1', label: 's', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 1 }],
      seed: 1,
      budgets: defaultBudgets,
      assumptions: [],
    };
    const doc = baseDoc([R, X], [conn], scenario);
    const result = checkReadiness(doc, 'scn-crossing');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'unresolved-crossing')).toBe(true);
    }
  });

  it('reports an unmapped refinement crossing reached at depth two', () => {
    const source = machineElement('source', [
      port('source-in', 'in', 'data', S_ID),
      port('source-out', 'out', 'data', S_ID),
    ]);
    const outer = machineElement('outer', [port('outer-in', 'in', 'data', S_ID)]);
    const inner = machineElement('inner', [port('inner-in', 'in', 'data', S_ID)]);
    const deep = machineElement('deep', [port('deep-in', 'in', 'data', S_ID)]);
    const scenario: Scenario = {
      ...logicalHappyDoc().scenarios[0],
      id: 'scn-nested-crossing',
      scopeElementIds: ['source', 'outer', 'inner', 'deep'],
      entryPorts: [{ elementId: 'source', portId: 'source-in' }],
      inputs: [
        {
          id: 'nested-input',
          entry: { elementId: 'source', portId: 'source-in' },
          fixtureId: 'fx-input',
          journeyId: 'nested-journey',
          atMs: null,
          payloadBindings: [],
          resource: null,
        },
      ],
      refinementSelections: [
        { refinementId: 'outer-refinement', mode: 'refined' },
        { refinementId: 'inner-refinement', mode: 'refined' },
      ],
      assertions: [],
    };
    const doc = baseDoc(
      [source, outer, inner, deep],
      [
        {
          id: 'source-to-outer',
          kind: 'data',
          source: { elementId: 'source', portId: 'source-out' },
          target: { elementId: 'outer', portId: 'outer-in' },
          config: {},
        },
      ],
      scenario,
    );
    const nested: Document = {
      ...doc,
      refinements: [
        {
          id: 'outer-refinement',
          ownerElementId: 'outer',
          memberElementIds: ['inner'],
          portMappings: [
            {
              id: 'outer-in-map',
              outer: { elementId: 'outer', portId: 'outer-in' },
              inner: { elementId: 'inner', portId: 'inner-in' },
            },
          ],
        },
        {
          id: 'inner-refinement',
          ownerElementId: 'inner',
          memberElementIds: ['deep'],
          portMappings: [],
        },
      ],
    };

    const result = checkReadiness(nested, scenario.id);

    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid-refinement-selection',
            entityId: 'inner-refinement',
          }),
        ]),
      );
    }
  });
});

// ============================================================================
// Runnable-readiness rejects
// ============================================================================

function pipelineElement(
  id: string,
  inPortId: string,
  outPortId: string,
  errPortId: string,
  inSchemaId = S_ID,
  outSchemaId = S_ID,
  errSchemaId = S_ID,
): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'data-pipeline',
    ports: [
      port(inPortId, 'in', 'data', inSchemaId),
      port(outPortId, 'out', 'data', outSchemaId),
      port(errPortId, 'out', 'data', errSchemaId),
    ],
    behavior: {
      kind: 'pipeline',
      version: 1,
      inputSchemaId: inSchemaId,
      outputSchemaId: outSchemaId,
      errorSchemaId: errSchemaId,
      inputPortId: inPortId,
      outputPortId: outPortId,
      errorPortId: errPortId,
      operations: [],
    },
  };
}

function decisionElement(
  id: string,
  inPortId: string,
  outPortId: string,
  fbPortId: string,
  inSchemaId = S_ID,
): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'state-machine',
    ports: [
      port(inPortId, 'in', 'data', inSchemaId),
      port(outPortId, 'out', 'data', inSchemaId),
      port(fbPortId, 'out', 'data', inSchemaId),
    ],
    behavior: {
      kind: 'decision',
      version: 1,
      inputSchemaId: inSchemaId,
      inputPortId: inPortId,
      cases: [
        {
          id: 'case-1',
          guard: { op: 'exists', value: { kind: 'read', source: 'input', path: [] } },
          outputPortId: outPortId,
          value: { kind: 'read', source: 'input', path: [] },
        },
      ],
      fallback: {
        outputPortId: fbPortId,
        value: { kind: 'read', source: 'input', path: [] },
      },
    },
  };
}

describe('static expression readiness', () => {
  const string: Shape = { type: 'string', nullable: false };
  const integer: Shape = { type: 'integer', nullable: false };
  const record = (fields: Record<string, Shape>): Shape => ({
    type: 'record', nullable: false,
    fields: Object.entries(fields).map(([key, shape]) => ({ id: `field-${key}`, key, optional: false, shape })),
  });
  const read = (path: (string | number)[], source: 'input' | 'context' = 'input'): Value => ({ kind: 'read', source, path });
  const literal = (value: string | number | boolean | null): Value => ({ kind: 'literal', value });
  const inputShape = record({ name: string, count: integer, rows: { type: 'list', nullable: false, maxItems: 10, items: record({ count: integer }) } });
  const contextShape = record({ count: integer, name: string });
  function expressionDoc(guard: Guard | null = null, effects: readonly Effect[] = []): Document {
    const base = logicalHappyDoc();
    const machine = machineElement('m1', [port('p1', 'in', 'data', 'input'), port('out', 'out', 'data', 'output'), port('timer', 'in', 'event', 'output')], [
      { id: 'transition', fromStateId: 'st1', toStateId: 'st1', eventPortId: 'p1', guard, effects },
    ]);
    return {
      ...base,
      schemas: [...base.schemas, { id: 'input', label: '', shape: inputShape }, { id: 'output', label: '', shape: integer }, { id: 'context', label: '', shape: contextShape }],
      elements: [{ ...machine, behavior: { ...(machine.behavior as MachineBehavior), contextSchemaId: 'context' } }],
    };
  }
  function errors(doc: Document) {
    const result = checkReadiness(doc, doc.scenarios[0].id);
    return result.ready ? [] : result.issues.filter((i) => i.code === 'expression-type-error');
  }

  it.each<Guard>([
    { op: 'positiveInteger', value: read(['name']) },
    { op: 'positiveInteger', value: literal(1.5) },
    { op: 'nonEmpty', value: read(['count']) },
    { op: 'every', value: read(['name']), itemGuard: { op: 'exists', value: read([]) } },
    { op: 'equals', left: read(['absent']), right: literal(null) },
    { op: 'notEquals', left: literal(null), right: read(['rows', 'count']) },
    { op: 'any', guards: [{ op: 'all', guards: [{ op: 'nonEmpty', value: literal(false) }] }] },
  ])('rejects a provable guard error: %j', (guard) => {
    const found = errors(expressionDoc(guard));
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].entityId).toBe('transition');
    expect(found[0].path.slice(0, 6)).toEqual(['elements', 0, 'behavior', 'transitions', 0, 'guard']);
  });

  it('keeps exists/missing and cross-type canonical equality legal', () => {
    expect(errors(expressionDoc({ op: 'all', guards: [
      { op: 'exists', value: read(['absent']) },
      { op: 'equals', left: literal(1), right: literal('1') },
      { op: 'nonEmpty', value: { kind: 'literal', value: {} } },
    ] }))).toEqual([]);
  });

  it('uses the item schema in every while retaining machine context', () => {
    const good: Guard = { op: 'every', value: read(['rows']), itemGuard: { op: 'all', guards: [
      { op: 'positiveInteger', value: read(['count']) },
      { op: 'nonEmpty', value: read(['name'], 'context') },
    ] } };
    expect(errors(expressionDoc(good))).toEqual([]);
    expect(errors(expressionDoc({ ...good, itemGuard: { op: 'nonEmpty', value: read(['count']) } }))).toHaveLength(1);
  });

  it('does not reject optional, nullable, union, or numeric reads that can work at runtime', () => {
    const doc = expressionDoc({ op: 'positiveInteger', value: read(['count']) });
    for (const shape of [
      { type: 'integer', nullable: true },
      { type: 'number', nullable: false },
      { type: 'scalar-union', nullable: false, types: ['integer', 'string'] },
    ] as const) {
      const flexible: Shape = { type: 'record', nullable: false, fields: [{ id: 'field', key: 'count', optional: true, shape }] };
      expect(errors({ ...doc, schemas: doc.schemas.map((s) => s.id === 'input' ? { ...s, shape: flexible } : s) })).toEqual([]);
    }
  });

  it.each<Value>([
    literal('wrong'), literal(null), literal(1.5),
    { kind: 'record', fields: [{ key: 'extra', value: literal(1) }] },
    { kind: 'list', items: [literal(1)] },
  ])('checks emitted and scheduled values against their target schema: %j', (value) => {
    expect(errors(expressionDoc(null, [
      { id: 'emit', kind: 'emit', portId: 'out', value, correlation: { kind: 'current' } },
      { id: 'timer-effect', kind: 'schedule-event', eventPortId: 'timer', delayMs: 1, value },
    ]))).toHaveLength(2);
  });

  it('validates nested constructors, closed records and bounded lists', () => {
    const output = record({ rows: { type: 'list', nullable: false, maxItems: 1, items: record({ count: integer }) } });
    const value: Value = { kind: 'record', fields: [{ key: 'rows', value: { kind: 'list', items: [
      { kind: 'record', fields: [{ key: 'count', value: literal('wrong') }] },
    ] } }] };
    const doc = expressionDoc(null, [{ id: 'emit', kind: 'emit', portId: 'out', value, correlation: { kind: 'current' } }]);
    expect(errors({ ...doc, schemas: doc.schemas.map((s) => s.id === 'output' ? { ...s, shape: output } : s) })).toHaveLength(1);
    const list = { type: 'list', nullable: false, maxItems: 1, items: integer } as const;
    for (const constructed of [
      { kind: 'list', items: [literal(1), literal(2)] },
      { kind: 'list', items: [literal('bad')] },
    ] as Value[]) {
      const candidate = expressionDoc(null, [{ id: 'emit', kind: 'emit', portId: 'out', value: constructed, correlation: { kind: 'current' } }]);
      expect(errors({ ...candidate, schemas: candidate.schemas.map((s) => s.id === 'output' ? { ...s, shape: list } : s) })).toHaveLength(1);
    }
  });

  it('rejects missing constructor members but leaves missing assignment errors modeled', () => {
    expect(errors(expressionDoc(null, [{ id: 'assign', kind: 'assign', path: ['count'], value: read(['absent']) }]))).toEqual([]);
    expect(errors(expressionDoc({ op: 'exists', value: { kind: 'record', fields: [{ key: 'x', value: read(['absent']) }] } }))).toHaveLength(1);
    expect(errors(expressionDoc({ op: 'exists', value: { kind: 'list', items: [read(['absent'])] } }))).toHaveLength(1);
  });

  it('checks final context atomically, and reads prior effect assignments in order', () => {
    const assign: Effect = { id: 'assign', kind: 'assign', path: ['count'], value: literal('temporary') };
    const repair: Effect = { id: 'repair', kind: 'assign', path: ['count'], value: literal(2) };
    expect(errors(expressionDoc(null, [assign]))).toHaveLength(1);
    expect(errors(expressionDoc(null, [assign, repair]))).toEqual([]);
    expect(errors(expressionDoc(null, [assign, { id: 'emit', kind: 'emit', portId: 'out', value: read(['count'], 'context'), correlation: { kind: 'current' } }, repair]))).toHaveLength(1);
    expect(errors(expressionDoc(null, [{ id: 'request', kind: 'request-id', path: ['count'] }]))).toHaveLength(1);
  });

  it('checks locally known reply schemas and leaves descendant frame types unknown', () => {
    const doc = expressionDoc(null, [{ id: 'reply', kind: 'reply', value: literal('wrong'), outcome: 'succeeded' }]);
    expect(errors(doc)).toEqual([]);
    const callDoc = { ...doc, elements: doc.elements.map((el) => ({ ...el, ports: el.ports.map((p) => p.id === 'p1' ? { ...p, channel: 'call' as const, responseSchemaId: 'output' } : p) })) };
    expect(errors(callDoc)).toHaveLength(1);
  });

  it('checks request correlation after prior effects and treats outcome as nullable string', () => {
    const emit: Effect = { id: 'emit', kind: 'emit', portId: 'out', value: literal(1), correlation: { kind: 'context-request', path: ['name'] } };
    const assign: Effect = { id: 'assign', kind: 'assign', path: ['name'], value: literal(1) };
    const repair: Effect = { id: 'repair', kind: 'request-id', path: ['name'] };
    expect(errors(expressionDoc(null, [assign, emit, repair]))).toHaveLength(1);
    expect(errors(expressionDoc(null, [assign, repair, emit]))).toEqual([]);
    expect(errors(expressionDoc({ op: 'equals', left: { kind: 'outcome' }, right: literal(null) }))).toEqual([]);
    expect(errors(expressionDoc({ op: 'positiveInteger', value: { kind: 'outcome' } }))).toHaveLength(1);
  });

  it('checks decision cases and fallback values in empty context', () => {
    const doc = logicalHappyDoc();
    const decision = decisionElement('m1', 'p1', 'out', 'fallback');
    const behavior = decision.behavior as DecisionBehavior;
    const changed = { ...decision, behavior: {
      ...behavior,
      cases: behavior.cases.map((c) => ({ ...c, guard: { op: 'positiveInteger', value: literal(false) } as Guard, value: literal(1) })),
      fallback: { ...behavior.fallback, value: literal('bad') },
    } };
    expect(errors({ ...doc, elements: [changed] })).toHaveLength(3);
  });

  it('tracks pipeline row types after validate and map, with empty context', () => {
    const doc = expressionDoc();
    const pipeline = pipelineElement('m1', 'p1', 'out', 'err', 'rows', 'rows', 'rows');
    const behavior = pipeline.behavior as PipelineBehavior;
    const candidate: Document = {
      ...doc,
      schemas: [...doc.schemas, { id: 'rows', label: '', shape: { type: 'list', nullable: false, maxItems: 10, items: inputShape } }],
      elements: [{ ...pipeline, behavior: { ...behavior, operations: [
        { id: 'validate', kind: 'validate', schemaId: 'input' },
        { id: 'map', kind: 'map', fields: [{ id: 'map-field', targetKey: 'count', value: read(['name']) }] },
        { id: 'filter', kind: 'filter', guard: { op: 'positiveInteger', value: read(['count']) } },
      ] } }],
    };
    const found = errors(candidate);
    expect(found.filter((i) => i.entityId === 'filter')).toHaveLength(1);
    // The mapped record also cannot satisfy the declared final row schema.
    expect(found.filter((i) => i.path.at(-1) === 'outputSchemaId')).toHaveLength(1);
    const grouped: Document = { ...candidate, elements: [{ ...pipeline, behavior: { ...behavior, operations: [
      { id: 'group', kind: 'group-sum', keyPath: ['name'], valuePath: ['count'], keyName: 'region', sumName: 'total' },
      { id: 'filter-group', kind: 'filter', guard: { op: 'nonEmpty', value: read(['total']) } },
    ] } }] };
    expect(errors(grouped).filter((i) => i.entityId === 'filter-group')).toHaveLength(1);
    expect(errors(grouped).filter((i) => i.path.at(-1) === 'outputSchemaId')).toHaveLength(1);
  });

  it('checks boundary match guards and request-to-response binding types', () => {
    const doc = loadFixture('s01.json');
    const scenario = doc.scenarios.find((s) => s.boundaries.some((b) => b.responses.length))!;
    const boundary = scenario.boundaries.find((b) => b.responses.length)!;
    const response = boundary.responses[0];
    const modified: Document = { ...doc, scenarios: [{ ...scenario, boundaries: scenario.boundaries.map((b) => b.id === boundary.id ? {
      ...b, responses: [{ ...response, match: { op: 'positiveInteger', value: { kind: 'literal', value: false } }, payloadBindings: [{ targetPath: ['requestId'], requestPath: [] }] }],
    } : b) }] };
    expect(errors(modified).some((i) => i.path.includes('match'))).toBe(true);
    // A whole request record cannot be bound into the string requestId field.
    expect(errors(modified).some((i) => i.path.includes('payloadBindings'))).toBe(true);
  });

  it('keeps invalid expression types storable, and ignores excluded incomplete elements', () => {
    const doc = loadFixture('s01.json');
    const edited: Document = { ...doc, elements: doc.elements.map((el) => el.behavior.kind === 'machine' ? {
      ...el, behavior: { ...el.behavior, transitions: el.behavior.transitions.map((t, i) => i === 0 ? { ...t, guard: { op: 'nonEmpty', value: { kind: 'literal', value: false } } } : t) },
    } : el) };
    expect(validateDocument(edited).ok).toBe(true);
    expect(errors(edited).length).toBeGreaterThan(0);
    const excluded = expressionDoc({ op: 'nonEmpty', value: literal(false) }).elements[0];
    expect(errors({ ...doc, elements: [...doc.elements, excluded] })).toEqual([]);
  });
});

function unmodeledElement(id: string, ports: Port[] = []): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'service',
    ports,
    behavior: {
      kind: 'unmodeled',
      version: 1,
      reason: 'External service',
    },
  };
}

describe('runnable-readiness rejects', () => {
  // --------------------------------------------------------------------------
  // Check 1: Unbound call responses
  // --------------------------------------------------------------------------
  describe('unbound-call-response', () => {
    it('rejects an outbound call port used by an emit effect when response binding is missing', () => {
      const M = machineElement(
        'm1',
        [port('p1', 'in', 'data', S_ID), port('call-out', 'out', 'call', S_ID, S_ID)],
        [
          {
            id: 't1',
            fromStateId: 'st1',
            eventPortId: 'p1',
            guard: null,
            toStateId: 'st1',
            effects: [
              {
                id: 'eff1',
                kind: 'emit',
                portId: 'call-out',
                value: { kind: 'literal', value: {} },
                correlation: { kind: 'current' },
              },
            ],
          },
        ],
      );

      const scenario: Scenario = {
        id: 'scn-m1',
        label: 'm1',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['m1'],
        entryPorts: [{ elementId: 'm1', portId: 'p1' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'm1', portId: 'p1' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'final', subject: { kind: 'final-state', elementId: 'm1' }, operator: 'equals', expected: 'st1' },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([M], [], scenario);
      const result = checkReadiness(doc, 'scn-m1');
      expect(result.ready).toBe(false);
      if (!result.ready) {
        const found = result.issues.find((i) => i.code === 'unbound-call-response');
        expect(found).toBeDefined();
        expect(found?.path).toEqual(['elements', 0, 'ports', 1]);
        expect(found?.entityId).toBe('call-out');
      }
    });

    it('passes when the used outbound call port has exactly one compatible response binding', () => {
      const M = machineElement(
        'm1',
        [
          port('p1', 'in', 'data', S_ID),
          port('call-out', 'out', 'call', S_ID, S_ID),
          port('ev-in', 'in', 'event', S_ID),
        ],
        [
          {
            id: 't1',
            fromStateId: 'st1',
            eventPortId: 'p1',
            guard: null,
            toStateId: 'st1',
            effects: [
              {
                id: 'eff1',
                kind: 'emit',
                portId: 'call-out',
                value: { kind: 'literal', value: {} },
                correlation: { kind: 'current' },
              },
            ],
          },
        ],
        [{ id: 'rb1', callPortId: 'call-out', eventPortId: 'ev-in' }],
      );

      const scenario: Scenario = {
        id: 'scn-m1-ok',
        label: 'm1',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['m1'],
        entryPorts: [{ elementId: 'm1', portId: 'p1' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'm1', portId: 'p1' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'final', subject: { kind: 'final-state', elementId: 'm1' }, operator: 'equals', expected: 'st1' },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([M], [], scenario);
      const result = checkReadiness(doc, 'scn-m1-ok');
      expect(result.ready).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Check 2: Effect lists that could reply twice
  // --------------------------------------------------------------------------
  describe('reply-twice', () => {
    it('rejects a transition effect list with more than one reply effect', () => {
      const M = machineElement(
        'm1',
        [port('p1', 'in', 'call', S_ID, S_ID)],
        [
          {
            id: 't1',
            fromStateId: 'st1',
            eventPortId: 'p1',
            guard: null,
            toStateId: 'st1',
            effects: [
              { id: 'rep1', kind: 'reply', value: { kind: 'literal', value: {} }, outcome: 'succeeded' },
              { id: 'rep2', kind: 'reply', value: { kind: 'literal', value: {} }, outcome: 'succeeded' },
            ],
          },
        ],
      );

      const scenario: Scenario = {
        id: 'scn-rep-twice',
        label: 'rep-twice',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['m1'],
        entryPorts: [{ elementId: 'm1', portId: 'p1' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'm1', portId: 'p1' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'final', subject: { kind: 'final-state', elementId: 'm1' }, operator: 'equals', expected: 'st1' },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([M], [], scenario);
      const result = checkReadiness(doc, 'scn-rep-twice');
      expect(result.ready).toBe(false);
      if (!result.ready) {
        const found = result.issues.find((i) => i.code === 'reply-twice');
        expect(found).toBeDefined();
        expect(found?.path).toEqual(['elements', 0, 'behavior', 'transitions', 0, 'effects', 1]);
        expect(found?.entityId).toBe('rep2');
      }
    });

    it('passes when a transition contains at most one reply effect', () => {
      const M = machineElement(
        'm1',
        [port('p1', 'in', 'call', S_ID, S_ID)],
        [
          {
            id: 't1',
            fromStateId: 'st1',
            eventPortId: 'p1',
            guard: null,
            toStateId: 'st1',
            effects: [
              { id: 'rep1', kind: 'reply', value: { kind: 'literal', value: {} }, outcome: 'succeeded' },
            ],
          },
        ],
      );

      const scenario: Scenario = {
        id: 'scn-rep-once',
        label: 'rep-once',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['m1'],
        entryPorts: [{ elementId: 'm1', portId: 'p1' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'm1', portId: 'p1' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'final', subject: { kind: 'final-state', elementId: 'm1' }, operator: 'equals', expected: 'st1' },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([M], [], scenario);
      const result = checkReadiness(doc, 'scn-rep-once');
      expect(result.ready).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Check 3: Mismatched schemas
  // --------------------------------------------------------------------------
  describe('mismatched-schema', () => {
    it('rejects a decision whose inputPort schema does not match inputSchemaId', () => {
      const shapeStr: Shape = { type: 'string', nullable: false };
      const D = decisionElement('d1', 'dp-in', 'dp-out', 'dp-fb', 'schema-str');
      // dp-in port on element currently uses S_ID (record), but inputSchemaId is schema-str (string)
      (D.ports as any)[0] = port('dp-in', 'in', 'data', S_ID);

      const scenario: Scenario = {
        id: 'scn-dec-mismatch',
        label: 'dec',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['d1'],
        entryPorts: [{ elementId: 'd1', portId: 'dp-in' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'd1', portId: 'dp-in' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'count', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 0 },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([D], [], scenario, [{ id: 'schema-str', label: 'Str', shape: shapeStr }]);
      const result = checkReadiness(doc, 'scn-dec-mismatch');
      expect(result.ready).toBe(false);
      if (!result.ready) {
        const found = result.issues.find((i) => i.code === 'mismatched-schema');
        expect(found).toBeDefined();
        expect(found?.path).toEqual(['elements', 0, 'behavior', 'inputPortId']);
        expect(found?.entityId).toBe('dp-in');
      }
    });

    it('rejects a resource entryPortId that is a data port instead of call or message', () => {
      const R = resourceElement('r1', 'rp1', [port('rp1', 'in', 'data', S_ID)]);
      const scenario: Scenario = {
        id: 'scn-res-data-entry',
        label: 'res',
        revision: 0,
        mode: 'timed',
        scopeElementIds: ['r1'],
        entryPorts: [{ elementId: 'r1', portId: 'rp1' }],
        inputs: [
          {
            id: 'in1',
            entry: { elementId: 'r1', portId: 'rp1' },
            fixtureId: 'fx-input',
            journeyId: 'j1',
            atMs: 0,
            payloadBindings: [],
            resource: { requestClassId: 'rc1', operation: 'read', key: null, tags: [], deadlineMs: 5000 },
          },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'succeeded', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 1 },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([R], [], scenario);
      const result = checkReadiness(doc, 'scn-res-data-entry');
      expect(result.ready).toBe(false);
      if (!result.ready) {
        const found = result.issues.find((i) => i.code === 'mismatched-schema');
        expect(found).toBeDefined();
        expect(found?.path).toEqual(['elements', 0, 'behavior', 'entryPortId']);
        expect(found?.entityId).toBe('rp1');
      }
    });

    it('rejects a machine transition eventPortId that is an outbound port', () => {
      const M = machineElement(
        'm1',
        [port('p1', 'in', 'data', S_ID), port('p2', 'out', 'data', S_ID)],
        [{ id: 't1', fromStateId: 'st1', eventPortId: 'p2', guard: null, toStateId: 'st1', effects: [] }],
      );

      const scenario: Scenario = {
        id: 'scn-m-out-event',
        label: 'm',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['m1'],
        entryPorts: [{ elementId: 'm1', portId: 'p1' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'm1', portId: 'p1' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'final', subject: { kind: 'final-state', elementId: 'm1' }, operator: 'equals', expected: 'st1' },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([M], [], scenario);
      const result = checkReadiness(doc, 'scn-m-out-event');
      expect(result.ready).toBe(false);
      if (!result.ready) {
        const found = result.issues.find((i) => i.code === 'mismatched-schema');
        expect(found).toBeDefined();
        expect(found?.path).toEqual(['elements', 0, 'behavior', 'transitions', 0, 'eventPortId']);
        expect(found?.entityId).toBe('p2');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Check 4: Missing pipeline outputs
  // --------------------------------------------------------------------------
  describe('missing-pipeline-output', () => {
    it('allows a pipeline with an unconnected output (unconnected output is legal per S03)', () => {
      const P = pipelineElement('pipe1', 'p-in', 'p-out', 'p-err');
      const scenario: Scenario = {
        id: 'scn-pipe-unconnected',
        label: 'pipe',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['pipe1'],
        entryPorts: [{ elementId: 'pipe1', portId: 'p-in' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'pipe1', portId: 'p-in' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'count', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 0 },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([P], [], scenario);
      const result = checkReadiness(doc, 'scn-pipe-unconnected');
      expect(result.ready).toBe(true);
    });

    it('rejects a pipeline whose outputPortId points to a port of another element', () => {
      const M = machineElement('m1', [port('m-port', 'out', 'data', S_ID)]);
      const P = pipelineElement('pipe1', 'p-in', 'p-out', 'p-err');
      (P.behavior as { outputPortId: string }).outputPortId = 'm-port';

      const scenario: Scenario = {
        id: 'scn-pipe-foreign-output',
        label: 'pipe',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['pipe1'],
        entryPorts: [{ elementId: 'pipe1', portId: 'p-in' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'pipe1', portId: 'p-in' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'count', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 0 },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([P, M], [], scenario);
      const result = checkReadiness(doc, 'scn-pipe-foreign-output');
      expect(result.ready).toBe(false);
      if (!result.ready) {
        const found = result.issues.find((i) => i.code === 'missing-pipeline-output');
        expect(found).toBeDefined();
        expect(found?.path).toEqual(['elements', 0, 'behavior', 'outputPortId']);
        expect(found?.entityId).toBe('m-port');
      }
    });

    it('rejects a pipeline whose errorPortId points to a port of another element', () => {
      const M = machineElement('m1', [port('m-err', 'out', 'data', S_ID)]);
      const P = pipelineElement('pipe1', 'p-in', 'p-out', 'p-err');
      (P.behavior as { errorPortId: string }).errorPortId = 'm-err';

      const scenario: Scenario = {
        id: 'scn-pipe-foreign-error',
        label: 'pipe',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['pipe1'],
        entryPorts: [{ elementId: 'pipe1', portId: 'p-in' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'pipe1', portId: 'p-in' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'count', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 0 },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([P, M], [], scenario);
      const result = checkReadiness(doc, 'scn-pipe-foreign-error');
      expect(result.ready).toBe(false);
      if (!result.ready) {
        const found = result.issues.find((i) => i.code === 'missing-pipeline-output');
        expect(found).toBeDefined();
        expect(found?.path).toEqual(['elements', 0, 'behavior', 'errorPortId']);
        expect(found?.entityId).toBe('m-err');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Check 5: Unmodeled element in closure
  // --------------------------------------------------------------------------
  describe('unmodeled-element', () => {
    it('rejects an unmodeled element present in the scenario closure', () => {
      const U = unmodeledElement('u1', [port('up1', 'in', 'data', S_ID)]);
      const scenario: Scenario = {
        id: 'scn-unmodeled',
        label: 'unmodeled',
        revision: 0,
        mode: 'logical',
        scopeElementIds: ['u1'],
        entryPorts: [{ elementId: 'u1', portId: 'up1' }],
        inputs: [
          { id: 'in1', entry: { elementId: 'u1', portId: 'up1' }, fixtureId: 'fx-input', journeyId: 'j1', atMs: null, payloadBindings: [], resource: null },
        ],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [
          { id: 'a1', label: 'count', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' }, operator: 'equals', expected: 0 },
        ],
        seed: 1,
        budgets: defaultBudgets,
        assumptions: [],
      };

      const doc = baseDoc([U], [], scenario);
      const result = checkReadiness(doc, 'scn-unmodeled');
      expect(result.ready).toBe(false);
      if (!result.ready) {
        const found = result.issues.find((i) => i.code === 'unmodeled-element');
        expect(found).toBeDefined();
        expect(found?.path).toEqual(['elements', 0, 'behavior', 'kind']);
        expect(found?.entityId).toBe('u1');
      }
    });

    it('passes when an unmodeled element is reached only behind a boundary (s01)', () => {
      const doc = loadFixture('s01.json');
      const unmodeled = doc.elements.find((e) => e.behavior.kind === 'unmodeled');
      expect(unmodeled).toBeDefined();
      for (const scn of doc.scenarios) {
        const result = checkReadiness(doc, scn.id);
        expect(result.ready).toBe(true);
      }
    });
  });
});

describe('bridge call continuations', () => {
  function bridgeDoc(sourceType: 'router' | 'processor', targets: ('resource' | 'machine')[]): Document {
    const doc = timedHappyDoc();
    const r1 = doc.elements[0] as Element & { behavior: ResourceBehavior };
    const source: Element = {
      ...r1,
      ports: [...r1.ports, port('ro1', 'out', 'call', S_ID, S_ID)],
      behavior: {
        ...r1.behavior,
        config: sourceType === 'router'
          ? { ...r1.behavior.config, type: 'router', strategy: 'round-robin' }
          : r1.behavior.config,
      },
    } as Element;
    const elements: Element[] = [source];
    const connections: Connection[] = [];
    targets.forEach((kind, i) => {
      const id = `t${i}`;
      elements.push(
        kind === 'resource'
          ? resourceElement(id, `${id}-in`, [port(`${id}-in`, 'in', 'call', S_ID, S_ID)])
          : machineElement(id, [port(`${id}-in`, 'in', 'call', S_ID, S_ID)]),
      );
      connections.push({
        id: `c${i}`,
        label: `c${i}`,
        kind: 'call',
        source: { elementId: 'r1', portId: 'ro1' },
        target: { elementId: id, portId: `${id}-in` },
        config: callConfig,
      } as Connection);
    });
    return {
      ...doc,
      elements,
      connections,
      scenarios: [{ ...doc.scenarios[0], scopeElementIds: elements.map((e) => e.id) }],
    };
  }
  const codes = (doc: Document) => {
    const result = checkReadiness(doc, 'scn-timed');
    return result.ready ? [] : result.issues.map((i) => i.code);
  };

  it('accepts a non-router resource whose only call continuation is a bridge', () => {
    expect(codes(bridgeDoc('processor', ['machine']))).not.toContain('bridge-continuation-conflict');
  });

  it('rejects a non-router resource with a bridge and another call continuation', () => {
    expect(codes(bridgeDoc('processor', ['machine', 'resource']))).toContain('bridge-continuation-conflict');
  });

  it('rejects a router route to a non-resource element and says what to put between them', () => {
    expect(codes(bridgeDoc('router', ['machine']))).toContain('router-route-needs-resource');
    expect(codes(bridgeDoc('router', ['machine', 'resource']))).toContain('router-route-needs-resource');
    const result = checkReadiness(bridgeDoc('router', ['machine']), 'scn-timed');
    const found = result.ready ? undefined : result.issues.find((i) => i.code === 'router-route-needs-resource');
    expect(found?.message).toContain('(a state machine)');
    expect(found?.message).toContain('→ Service →');
  });

  it('accepts a router whose routes all reach resources', () => {
    const found = codes(bridgeDoc('router', ['resource', 'resource']));
    expect(found).not.toContain('router-route-needs-resource');
    expect(found).not.toContain('bridge-continuation-conflict');
  });
});

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
} from './model';
import { checkReadiness, normalizeShape, shapesCompatible } from './readiness';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');

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
  return { id, label: id, direction, channel, schemaId, responseSchemaId };
}

function machineElement(id: string, ports: Port[]): Element {
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
      transitions: [],
      responseBindings: [],
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
  resource: null,
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
    completion: { kind: 'quiescent' },
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
    completion: { kind: 'horizon', horizonMs: 5000 },
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
    const conn: Connection = { id: 'c1', label: '', kind: 'data', source: { elementId: 'a1', portId: 'ap1' }, target: { elementId: 'b1', portId: 'bp1' }, config: {} };
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
      completion: { kind: 'quiescent' },
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
    const conn1: Connection = { id: 'c1', label: '', kind: 'call', source: { elementId: 'r1', portId: 'rp1-out' }, target: { elementId: 'r2', portId: 'rp2' }, config: callConfig };
    const conn2: Connection = { id: 'c2', label: '', kind: 'call', source: { elementId: 'r2', portId: 'rp2-out' }, target: { elementId: 'r1', portId: 'rp1' }, config: callConfig };
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
      completion: { kind: 'horizon', horizonMs: 5000 },
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
      completion: { kind: 'quiescent' },
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

  it('rejects completion kind quiescent in timed mode', () => {
    const doc = clone(timedHappyDoc());
    (doc.scenarios[0] as { completion: { kind: string } }).completion = { kind: 'quiescent' };
    const result = checkReadiness(doc, 'scn-timed');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'completion-mode-mismatch')).toBe(true);
    }
  });

  it('rejects a horizon of 301 seconds', () => {
    const doc = clone(timedHappyDoc());
    (doc.scenarios[0].completion as { horizonMs: number }).horizonMs = 301000;
    const result = checkReadiness(doc, 'scn-timed');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'time-limit-out-of-range')).toBe(true);
    }
  });

  it('rejects a drain deadline <= arrival horizon', () => {
    const doc = clone(timedHappyDoc());
    (doc.scenarios[0] as any).completion = { kind: 'drain', arrivalHorizonMs: 6000, deadlineMs: 5000 };
    const result = checkReadiness(doc, 'scn-timed');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'time-limit-out-of-range')).toBe(true);
    }
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
        rate: 1,
        profile: { kind: 'steady' },
        timeoutMs: 1000,
        intervalMs: null,
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
    const conn: Connection = { id: 'c1', label: '', kind: 'call', source: { elementId: 'r1', portId: 'rp2' }, target: { elementId: 'x1', portId: 'xp1' }, config: callConfig };
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
      completion: { kind: 'horizon', horizonMs: 5000 },
      assumptions: [],
    };
    const doc = baseDoc([R, X], [conn], scenario);
    const result = checkReadiness(doc, 'scn-crossing');
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.issues.some((i) => i.code === 'unresolved-crossing')).toBe(true);
    }
  });
});

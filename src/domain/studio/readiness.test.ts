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

// ============================================================================
// RV-02f runnable-readiness rejects
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

describe('RV-02f runnable-readiness rejects', () => {
  // --------------------------------------------------------------------------
  // Check 1: Unbound call responses (§4 Wiring, §5)
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
        completion: { kind: 'quiescent' },
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
        completion: { kind: 'quiescent' },
        assumptions: [],
      };

      const doc = baseDoc([M], [], scenario);
      const result = checkReadiness(doc, 'scn-m1-ok');
      expect(result.ready).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Check 2: Effect lists that could reply twice (§5)
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
        completion: { kind: 'quiescent' },
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
        completion: { kind: 'quiescent' },
        assumptions: [],
      };

      const doc = baseDoc([M], [], scenario);
      const result = checkReadiness(doc, 'scn-rep-once');
      expect(result.ready).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Check 3: Mismatched schemas (§4 Wiring)
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
        completion: { kind: 'quiescent' },
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
        completion: { kind: 'horizon', horizonMs: 5000 },
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
        completion: { kind: 'quiescent' },
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
  // Check 4: Missing pipeline outputs (§5)
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
        completion: { kind: 'quiescent' },
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
        completion: { kind: 'quiescent' },
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
        completion: { kind: 'quiescent' },
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
  // Check 5: Unmodeled element in closure (§4)
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
        completion: { kind: 'quiescent' },
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


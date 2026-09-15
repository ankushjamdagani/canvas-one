import { describe, expect, it } from 'vitest';
import {
  compileExecution,
  VALID_KINDS,
  type ComponentKind,
  type ExecutionGraph,
  type ExecutionNode,
} from './execution';
import {
  defaultBehavior,
  defaultExecutionEdge,
  defaultWorkload,
} from './behaviorDefaults';

describe('compileExecution domain compiler', () => {
  it('compiles mixed graph with frontend client, two databases, broker and worker', () => {
    const clientNode: ExecutionNode = {
      id: 'n-client',
      kind: 'client',
      name: 'Frontend Client',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('client'),
    };
    const dbPrimary: ExecutionNode = {
      id: 'n-db-primary',
      kind: 'database',
      name: 'Relational DB',
      position: { x: 200, y: 0 },
      behavior: defaultBehavior('database'),
    };
    const dbAnalytics: ExecutionNode = {
      id: 'n-db-analytics',
      kind: 'warehouse',
      name: 'Analytics Warehouse',
      position: { x: 200, y: 150 },
      behavior: defaultBehavior('warehouse'),
    };
    const queueNode: ExecutionNode = {
      id: 'n-queue',
      kind: 'queue',
      name: 'Event Queue',
      position: { x: 100, y: 250 },
      behavior: defaultBehavior('queue'),
    };
    const workerNode: ExecutionNode = {
      id: 'n-worker',
      kind: 'worker',
      name: 'Background Worker',
      position: { x: 300, y: 250 },
      behavior: defaultBehavior('worker'),
    };

    const graph: ExecutionGraph = {
      executionVersion: 'open-system/1',
      settings: { seed: 42, duration: 60 },
      nodes: [clientNode, dbPrimary, dbAnalytics, queueNode, workerNode],
      edges: [
        {
          id: 'e-client-db',
          source: 'n-client',
          target: 'n-db-primary',
          transport: 'call',
          latencyMs: 5,
          returnLatencyMs: 5,
          ackDelayMs: 0,
          messageTtlMs: 2000,
          weight: 1,
        },
        {
          id: 'e-client-queue',
          source: 'n-client',
          target: 'n-queue',
          transport: 'message',
          latencyMs: 2,
          returnLatencyMs: 0,
          ackDelayMs: 8,
          messageTtlMs: 5000,
          weight: 1,
        },
        {
          id: 'e-queue-worker',
          source: 'n-queue',
          target: 'n-worker',
          transport: 'message',
          latencyMs: 1,
          returnLatencyMs: 0,
          ackDelayMs: 8,
          messageTtlMs: 5000,
          weight: 1,
        },
        {
          id: 'e-worker-analytics',
          source: 'n-worker',
          target: 'n-db-analytics',
          transport: 'call',
          latencyMs: 10,
          returnLatencyMs: 10,
          ackDelayMs: 0,
          messageTtlMs: 2000,
          weight: 1,
        },
      ],
      workloads: [defaultWorkload('n-client')],
    };

    const res = compileExecution(graph, true);
    expect(res.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(res.plan).toBeDefined();
    expect(res.plan?.nodes.size).toBe(5);
    expect(res.plan?.activeNodeIds.has('n-worker')).toBe(true);
    expect(res.plan?.activeNodeIds.has('n-db-analytics')).toBe(true);
  });

  it('distinguishes call cycles vs async message cycles', () => {
    const n1: ExecutionNode = {
      id: 'node-1',
      kind: 'service',
      name: 'Service 1',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('service'),
    };
    const n2: ExecutionNode = {
      id: 'node-2',
      kind: 'service',
      name: 'Service 2',
      position: { x: 100, y: 0 },
      behavior: defaultBehavior('service'),
    };

    const callCycleGraph: ExecutionGraph = {
      executionVersion: 'open-system/1',
      settings: { seed: 1, duration: 10 },
      nodes: [n1, n2],
      edges: [
        {
          id: 'e1',
          source: 'node-1',
          target: 'node-2',
          transport: 'call',
          latencyMs: 1,
          returnLatencyMs: 1,
          ackDelayMs: 0,
          messageTtlMs: 1000,
          weight: 1,
        },
        {
          id: 'e2',
          source: 'node-2',
          target: 'node-1',
          transport: 'call',
          latencyMs: 1,
          returnLatencyMs: 1,
          ackDelayMs: 0,
          messageTtlMs: 1000,
          weight: 1,
        },
      ],
      workloads: [defaultWorkload('node-1')],
    };

    const callRes = compileExecution(callCycleGraph, true);
    expect(callRes.issues.some(i => i.code === 'CALL_CYCLE_DETECTED')).toBe(true);
    expect(callRes.plan).toBeUndefined();

    // Change one edge to message transport: async cycle is permitted
    const asyncCycleGraph: ExecutionGraph = {
      ...callCycleGraph,
      edges: [
        callCycleGraph.edges[0],
        { ...callCycleGraph.edges[1], transport: 'message' },
      ],
    };
    const asyncRes = compileExecution(asyncCycleGraph, true);
    expect(asyncRes.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(asyncRes.plan).toBeDefined();
  });

  it('enforces runnable requirements only when requireRunnable=true', () => {
    const cacheNode: ExecutionNode = {
      id: 'c1',
      kind: 'cache',
      name: 'Cache Node',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('cache'),
    };
    const graphWithoutWorkload: ExecutionGraph = {
      executionVersion: 'open-system/1',
      settings: { seed: 1, duration: 10 },
      nodes: [cacheNode],
      edges: [],
      workloads: [],
    };

    // Edit mode (requireRunnable = false): structural validation succeeds
    const editRes = compileExecution(graphWithoutWorkload, false);
    expect(editRes.issues.filter(i => i.severity === 'error')).toHaveLength(0);
    expect(editRes.plan).toBeDefined();

    // Runnable mode (requireRunnable = true): missing workload and cache origin edge error
    const runRes = compileExecution(graphWithoutWorkload, true);
    expect(runRes.issues.some(i => i.code === 'NO_ENABLED_WORKLOAD')).toBe(true);
    expect(runRes.issues.some(i => i.code === 'INVALID_CACHE_ORIGIN')).toBe(true);
    expect(runRes.plan).toBeUndefined();
  });

  it('handles malformed graphs without throwing', () => {
    const malformedInputs = [
      null,
      undefined,
      123,
      'not an object',
      [],
      { executionVersion: 'wrong-ver' },
      { executionVersion: 'open-system/1', settings: { seed: -1, duration: 0 } },
      {
        executionVersion: 'open-system/1',
        settings: { seed: 1, duration: 10 },
        nodes: [{ id: '', kind: 'unknown', behavior: null }],
        edges: null,
        workloads: null,
      },
      {
        executionVersion: 'open-system/1',
        settings: { seed: 1, duration: 10 },
        nodes: [{ id: 'n1', kind: 'service', name: 'S', position: { x: 0, y: 0 }, behavior: { type: 'unknown' } }],
        edges: [],
        workloads: [{ id: 'w1', entryNodeId: 'n1', enabled: true, rate: -5, timeoutMs: 0, classes: [] }],
      },
    ];

    for (const bad of malformedInputs) {
      expect(() => compileExecution(bad, true)).not.toThrow();
      const res = compileExecution(bad, true);
      expect(res.issues.length).toBeGreaterThan(0);
      expect(res.plan).toBeUndefined();
    }
  });

  it('rejects invented kinds like lambda, mesh, monolith and accepts all 29 catalog kinds', () => {
    expect(VALID_KINDS.size).toBe(29);
    expect(VALID_KINDS.has('lambda' as ComponentKind)).toBe(false);
    expect(VALID_KINDS.has('mesh' as ComponentKind)).toBe(false);
    expect(VALID_KINDS.has('monolith' as ComponentKind)).toBe(false);

    for (const kind of VALID_KINDS) {
      const node: ExecutionNode = {
        id: `node-${kind}`,
        kind,
        name: `Node ${kind}`,
        position: { x: 0, y: 0 },
        behavior: defaultBehavior(kind),
      };
      const graph: ExecutionGraph = {
        executionVersion: 'open-system/1',
        settings: { seed: 100, duration: 10 },
        nodes: [node],
        edges: [],
        workloads: [],
      };
      const res = compileExecution(graph, false);
      const errors = res.issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    }
  });

  it('validates burst and ramp traffic profiles and rejects string/fake profiles', () => {
    const n: ExecutionNode = {
      id: 'n1',
      kind: 'service',
      name: 'Service',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('service'),
    };

    const makeGraphWithProfile = (profile: unknown, duration = 30): ExecutionGraph => ({
      executionVersion: 'open-system/1',
      settings: { seed: 1, duration },
      nodes: [n],
      edges: [],
      workloads: [
        {
          ...defaultWorkload('n1'),
          profile: profile as any,
        },
      ],
    });

    // Valid burst
    const validBurst = makeGraphWithProfile({ kind: 'burst', start: 5, end: 15, peakRate: 500 }, 30);
    expect(compileExecution(validBurst, false).issues.filter(i => i.severity === 'error')).toHaveLength(0);

    // Valid ramp
    const validRamp = makeGraphWithProfile({ kind: 'ramp', endRate: 300 }, 30);
    expect(compileExecution(validRamp, false).issues.filter(i => i.severity === 'error')).toHaveLength(0);

    // Burst window exceeding duration
    const burstExceed = makeGraphWithProfile({ kind: 'burst', start: 5, end: 35, peakRate: 500 }, 30);
    expect(compileExecution(burstExceed, false).issues.some(i => i.code === 'INVALID_BURST_WINDOW')).toBe(true);

    // Burst start >= end
    const burstInverted = makeGraphWithProfile({ kind: 'burst', start: 10, end: 5, peakRate: 500 }, 30);
    expect(compileExecution(burstInverted, false).issues.some(i => i.code === 'INVALID_BURST_WINDOW')).toBe(true);

    // Invented string profile
    const fakeStringProfile = makeGraphWithProfile('burst' as any);
    expect(compileExecution(fakeStringProfile, false).issues.some(i => i.code === 'INVALID_PROFILE')).toBe(true);
  });

  it('rejects cache with extra or non-call outgoing edge in runnable mode', () => {
    const cacheNode: ExecutionNode = {
      id: 'c1',
      kind: 'cache',
      name: 'Cache',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('cache'),
    };
    const originNode: ExecutionNode = {
      id: 's1',
      kind: 'service',
      name: 'Origin',
      position: { x: 100, y: 0 },
      behavior: defaultBehavior('service'),
    };

    const graph: ExecutionGraph = {
      executionVersion: 'open-system/1',
      settings: { seed: 1, duration: 10 },
      nodes: [cacheNode, originNode],
      edges: [
        {
          id: 'e1',
          source: 'c1',
          target: 's1',
          transport: 'message', // Cache origin edge must be 'call'
          latencyMs: 1,
          returnLatencyMs: 1,
          ackDelayMs: 0,
          messageTtlMs: 1000,
          weight: 1,
        },
      ],
      workloads: [defaultWorkload('c1')],
    };

    const res = compileExecution(graph, true);
    expect(res.issues.some(i => i.code === 'INVALID_CACHE_ORIGIN')).toBe(true);
  });

  it('factory creates fresh unshared objects and compile isolates cloned output', () => {
    const b1 = defaultBehavior('service');
    const b2 = defaultBehavior('service');
    expect(b1).not.toBe(b2);
    b1.capacity = 9999;
    expect(b2.capacity).toBe(2000);

    const w1 = defaultWorkload('n1');
    const w2 = defaultWorkload('n1');
    expect(w1.id).not.toBe(w2.id);
    expect(w1.classes[0].id).not.toBe(w2.classes[0].id);

    const edge = defaultExecutionEdge('n1', 'n2', defaultBehavior('queue'));
    expect(edge.transport).toBe('message');

    const graph: ExecutionGraph = {
      executionVersion: 'open-system/1',
      settings: { seed: 1, duration: 10 },
      nodes: [
        { id: 'n1', kind: 'client', name: 'Client', position: { x: 0, y: 0 }, behavior: defaultBehavior('client') },
        { id: 'n2', kind: 'service', name: 'Service', position: { x: 10, y: 10 }, behavior: defaultBehavior('service') },
        { id: 'n3', kind: 'service', name: 'Other service', position: { x: 20, y: 10 }, behavior: defaultBehavior('service') },
      ],
      edges: [
        { id: 'z-edge', source: 'n1', target: 'n2', transport: 'call', latencyMs: 1, returnLatencyMs: 1, ackDelayMs: 0, messageTtlMs: 1000, weight: 1 },
        { id: 'a-edge', source: 'n1', target: 'n3', transport: 'call', latencyMs: 1, returnLatencyMs: 1, ackDelayMs: 0, messageTtlMs: 1000, weight: 2 },
      ],
      workloads: [defaultWorkload('n1')],
    };

    // Pre-validation edge order is z-edge, a-edge
    expect(graph.edges[0].id).toBe('z-edge');

    const res = compileExecution(graph, false);
    expect(res.plan).toBeDefined();
    // Input graph must NOT be mutated
    expect(graph.edges[0].id).toBe('z-edge');

    // Compiled plan outgoing edges must be sorted lexically by ID
    const out = res.plan!.outgoing.get('n1')!;
    expect(out[0].id).toBe('a-edge');
    expect(out[1].id).toBe('z-edge');

    // Modifying plan graph does not affect input graph
    res.plan!.graph.nodes[0].name = 'Mutated';
    expect(graph.nodes[0].name).toBe('Client');
  });
});

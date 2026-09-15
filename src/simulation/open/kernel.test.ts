import { describe, it, expect } from 'vitest';
import type { ExecutionGraph, ExecutionNode, ExecutionEdge } from '../../domain/execution';
import { defaultBehavior, defaultWorkload, defaultExecutionEdge } from '../../domain/behaviorDefaults';
import { OpenSimulation } from './kernel';

class TestableOpenSimulation extends OpenSimulation {
  getLiveOpsCount(): number {
    return this.liveOpsCount;
  }
}

function createGraph(opts?: {
  nodes?: ExecutionNode[];
  edges?: ExecutionEdge[];
  duration?: number;
  seed?: number;
}): ExecutionGraph {
  const sourceNode: ExecutionNode = {
    id: 'src',
    kind: 'traffic',
    name: 'Traffic Source',
    position: { x: 0, y: 0 },
    behavior: defaultBehavior('traffic'),
  };
  const serviceNode: ExecutionNode = {
    id: 'svc',
    kind: 'service',
    name: 'Service Node',
    position: { x: 100, y: 0 },
    behavior: defaultBehavior('service'),
  };

  const edge = defaultExecutionEdge('src', 'svc');
  edge.id = 'e1';

  const wl = defaultWorkload('src');
  wl.rate = 10;
  wl.intervalMs = 100;

  return {
    executionVersion: 'open-system/1',
    nodes: opts?.nodes ?? [sourceNode, serviceNode],
    edges: opts?.edges ?? [edge],
    workloads: [wl],
    settings: {
      seed: opts?.seed ?? 42,
      duration: opts?.duration ?? 2,
    },
  };
}

describe('OpenSimulation Kernel', () => {
  it('expiry removes queued diamond invocations before pumping shared capacity', () => {
    const graph = createGraph({ duration: 2 });
    graph.nodes = ['src', 'left', 'right', 'shared'].map(id => ({
      id, kind: id === 'src' ? 'traffic' : 'service', name: id,
      position: { x: 0, y: 0 },
      behavior: { ...defaultBehavior(id === 'src' ? 'traffic' : 'service'), capacity: id === 'shared' ? 2 : 1000 },
    }));
    graph.edges = [['src', 'left'], ['src', 'right'], ['left', 'shared'], ['right', 'shared']]
      .map(([s, t]) => ({ ...defaultExecutionEdge(s, t), id: `${s}-${t}` }));
    graph.workloads[0].intervalMs = 1000;
    graph.workloads[0].timeoutMs = 100;
    const sim = new TestableOpenSimulation(graph);
    const expired = sim.advance(1.2);
    expect(expired.roots).toMatchObject({ generated: 1, expired: 1, inFlight: 0 });
    expect(expired.nodes.shared).toMatchObject({ arrived: 2, admitted: 2, attempts: 1, expired: 2, queued: 0, processing: 1 });
    expect(sim.getLiveOpsCount()).toBe(1);
    const cleaned = sim.advance(1.6);
    expect(cleaned.nodes.shared).toMatchObject({ attempts: 1, processing: 0, completed: 0 });
    expect(cleaned.nodes.shared.utilization * cleaned.time).toBeCloseTo(0.5, 10);
    expect(sim.getLiveOpsCount()).toBe(0);
    expect(cleaned.edges['right-shared'].responses).toBe(0);
  });

  it('seeded local failure draws cover the configured percentage across requests', () => {
    const graph = createGraph({ duration: 2 });
    graph.nodes[1].behavior.failureRate = 50;
    graph.workloads[0].intervalMs = 1;
    const snap = new OpenSimulation(graph).advance(2);
    expect(snap.roots.failed).toBeGreaterThan(850);
    expect(snap.roots.failed).toBeLessThan(1150);
    expect(snap.roots.generated).toBe(snap.roots.succeeded + snap.roots.failed + snap.roots.inFlight);
  });

  it('accepts an inactive configured router', () => {
    const graph = createGraph();
    const routerNode: ExecutionNode = {
      id: 'rtr',
      kind: 'gateway',
      name: 'Router',
      position: { x: 50, y: 0 },
      behavior: defaultBehavior('gateway'),
    };
    graph.nodes.push(routerNode);
    const edge = defaultExecutionEdge('rtr', 'svc');
    edge.id = 'e-rtr';
    graph.edges.push(edge);
    expect(() => new OpenSimulation(graph)).not.toThrow();
  });

  it('runs terminal storage with write capacity latency', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const dbNode: ExecutionNode = {
      id: 'db',
      kind: 'database',
      name: 'Database',
      position: { x: 100, y: 0 },
      behavior: {
        ...defaultBehavior('database'),
        type: 'storage',
        capacity: 100,
        writeCapacity: 50,
      },
    };
    const edge = defaultExecutionEdge('src', 'db');
    edge.id = 'e-db';
    const graph = createGraph({ nodes: [sourceNode, dbNode], edges: [edge] });
    graph.workloads[0].classes[0].operation = 'write';
    graph.workloads[0].intervalMs = 500;

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(2);
    expect(snap.roots.succeeded).toBeGreaterThanOrEqual(3);
    expect(snap.nodes['db'].completed).toBe(snap.roots.succeeded);
  });

  it('calculates call latency including local, forward, child, and return latency', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const svc1: ExecutionNode = {
      id: 'svc1',
      kind: 'service',
      name: 'Service 1',
      position: { x: 100, y: 0 },
      behavior: { ...defaultBehavior('service'), capacity: 100, concurrency: 1 },
    };
    const svc2: ExecutionNode = {
      id: 'svc2',
      kind: 'service',
      name: 'Service 2',
      position: { x: 200, y: 0 },
      behavior: { ...defaultBehavior('service'), capacity: 50, concurrency: 1 },
    };
    const e1 = defaultExecutionEdge('src', 'svc1');
    e1.id = 'e1';
    const e2 = defaultExecutionEdge('svc1', 'svc2');
    e2.id = 'e2';
    e2.latencyMs = 20;
    e2.returnLatencyMs = 30;

    const graph = createGraph({ nodes: [sourceNode, svc1, svc2], edges: [e1, e2] });
    graph.workloads[0].intervalMs = 500;

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(2);
    expect(snap.roots.succeeded).toBeGreaterThan(0);
    // svc1 capacity 100 = 10ms local processing
    // e2 forward = 20ms
    // svc2 capacity 50 = 20ms
    // e2 return = 30ms
    // total = 10 + 20 + 20 + 30 = 80ms
    expect(snap.roots.meanLatency).toBeCloseTo(80, 0);
  });

  it('measures parallel downstream calls taking max latency, not sum', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const parentNode: ExecutionNode = {
      id: 'parent',
      kind: 'service',
      name: 'Parent',
      position: { x: 100, y: 0 },
      behavior: { ...defaultBehavior('service'), capacity: 1000, concurrency: 2 },
    };
    const child1: ExecutionNode = {
      id: 'c1',
      kind: 'service',
      name: 'Child 1',
      position: { x: 200, y: -50 },
      behavior: { ...defaultBehavior('service'), capacity: 100, concurrency: 1 }, // 10ms
    };
    const child2: ExecutionNode = {
      id: 'c2',
      kind: 'service',
      name: 'Child 2',
      position: { x: 200, y: 50 },
      behavior: { ...defaultBehavior('service'), capacity: 20, concurrency: 1 }, // 50ms
    };

    const e0 = defaultExecutionEdge('src', 'parent');
    e0.id = 'e0';
    const e1 = defaultExecutionEdge('parent', 'c1');
    e1.id = 'e1';
    const e2 = defaultExecutionEdge('parent', 'c2');
    e2.id = 'e2';

    const graph = createGraph({
      nodes: [sourceNode, parentNode, child1, child2],
      edges: [e0, e1, e2],
    });
    graph.workloads[0].intervalMs = 500;

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(2);
    expect(snap.roots.succeeded).toBeGreaterThan(0);
    // parent 1ms + max(10ms, 50ms) = 51ms (not 1 + 10 + 50 = 61ms)
    expect(snap.roots.meanLatency).toBeCloseTo(51, 0);
  });

  it('supports shared target with multiple visits from parallel paths', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const b1: ExecutionNode = {
      id: 'b1',
      kind: 'service',
      name: 'Branch 1',
      position: { x: 100, y: -50 },
      behavior: { ...defaultBehavior('service'), capacity: 500 },
    };
    const b2: ExecutionNode = {
      id: 'b2',
      kind: 'service',
      name: 'Branch 2',
      position: { x: 100, y: 50 },
      behavior: { ...defaultBehavior('service'), capacity: 500 },
    };
    const shared: ExecutionNode = {
      id: 'shared',
      kind: 'service',
      name: 'Shared Target',
      position: { x: 200, y: 0 },
      behavior: { ...defaultBehavior('service'), capacity: 1000, concurrency: 4 },
    };

    const e0a = defaultExecutionEdge('src', 'b1');
    e0a.id = 'e0a';
    const e0b = defaultExecutionEdge('src', 'b2');
    e0b.id = 'e0b';
    const e1 = defaultExecutionEdge('b1', 'shared');
    e1.id = 'e1';
    const e2 = defaultExecutionEdge('b2', 'shared');
    e2.id = 'e2';

    const graph = createGraph({
      nodes: [sourceNode, b1, b2, shared],
      edges: [e0a, e0b, e1, e2],
    });
    graph.workloads[0].intervalMs = 500;

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(2);
    expect(snap.nodes['shared'].completed).toBe(snap.roots.succeeded * 2);
  });

  it('distinguishes entry admission rejection from downstream failure', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const fullService: ExecutionNode = {
      id: 'svc',
      kind: 'service',
      name: 'Service Full',
      position: { x: 100, y: 0 },
      behavior: {
        ...defaultBehavior('service'),
        capacity: 10,
        concurrency: 1,
        queueLimit: 0,
      },
    };
    const edge = defaultExecutionEdge('src', 'svc');
    edge.id = 'e1';

    const graph = createGraph({ nodes: [sourceNode, fullService], edges: [edge] });
    graph.workloads[0].intervalMs = 10; // Rapid arrivals

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(1);
    expect(snap.roots.failed).toBeGreaterThan(0);
    expect(snap.nodes['svc'].rejected).toBeGreaterThan(0);
  });

  it('expires exactly when deadline is reached at 0.5s arrival + 0.5s service with 500ms timeout', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const slowNode: ExecutionNode = {
      id: 'slow',
      kind: 'service',
      name: 'Slow Service',
      position: { x: 100, y: 0 },
      behavior: { ...defaultBehavior('service'), capacity: 2, concurrency: 1 }, // 500ms service
    };
    const edge = defaultExecutionEdge('src', 'slow');
    edge.id = 'e1';

    const graph = createGraph({ nodes: [sourceNode, slowNode], edges: [edge] });
    graph.workloads[0].intervalMs = 500; // arrives at 0.5s
    graph.workloads[0].timeoutMs = 500; // deadline at 1.0s (same time as service completion, priority 0 expires before priority 1 completion)

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(1.0);
    expect(snap.roots.expired).toBeGreaterThan(0);
  });

  it('handles 100% local failure with 1 retry and 100ms backoff with no downstream sends', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const failNode: ExecutionNode = {
      id: 'fail',
      kind: 'service',
      name: 'Fail Service',
      position: { x: 100, y: 0 },
      behavior: {
        ...defaultBehavior('service'),
        capacity: 1000,
        concurrency: 1,
        failureRate: 100,
        maxRetries: 1,
        retryDelayMs: 100,
      },
    };
    const downstream: ExecutionNode = {
      id: 'down',
      kind: 'service',
      name: 'Downstream',
      position: { x: 200, y: 0 },
      behavior: defaultBehavior('service'),
    };
    const e1 = defaultExecutionEdge('src', 'fail');
    e1.id = 'e1';
    const e2 = defaultExecutionEdge('fail', 'down');
    e2.id = 'e2';

    const graph = createGraph({ nodes: [sourceNode, failNode, downstream], edges: [e1, e2] });
    graph.workloads[0].intervalMs = 500;

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(1);
    expect(snap.nodes['fail'].retries).toBeGreaterThan(0);
    expect(snap.nodes['fail'].failed).toBeGreaterThan(0);
    expect(snap.edges['e2'].sent).toBe(0);
  });

  it('sibling failure cancellation retains physical busy time until completion', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const parentNode: ExecutionNode = {
      id: 'parent',
      kind: 'service',
      name: 'Parent',
      position: { x: 100, y: 0 },
      behavior: { ...defaultBehavior('service'), capacity: 1000 },
    };
    const failingChild: ExecutionNode = {
      id: 'cFail',
      kind: 'service',
      name: 'Failing Child',
      position: { x: 200, y: -50 },
      behavior: { ...defaultBehavior('service'), capacity: 1000, failureRate: 100 },
    };
    const longChild: ExecutionNode = {
      id: 'cLong',
      kind: 'service',
      name: 'Long Child',
      position: { x: 200, y: 50 },
      behavior: { ...defaultBehavior('service'), capacity: 2 }, // 500ms
    };

    const e0 = defaultExecutionEdge('src', 'parent');
    e0.id = 'e0';
    const e1 = defaultExecutionEdge('parent', 'cFail');
    e1.id = 'e1';
    const e2 = defaultExecutionEdge('parent', 'cLong');
    e2.id = 'e2';

    const graph = createGraph({
      nodes: [sourceNode, parentNode, failingChild, longChild],
      edges: [e0, e1, e2],
      duration: 3,
    });
    graph.workloads[0].intervalMs = 1000;

    const sim = new OpenSimulation(graph);
    sim.advance(1.1);
    const snap1 = sim.snapshot();
    expect(snap1.nodes['cLong'].processing).toBe(1);
    expect(snap1.nodes['cLong'].cancelled).toBe(1);

    sim.advance(1.6);
    const snap2 = sim.snapshot();
    expect(snap2.nodes['cLong'].processing).toBe(0);
    // Busy for exactly 500ms (1.0s to 1.5s)
    const dur1_6 = 1.6;
    expect(snap2.nodes['cLong'].utilization * dur1_6).toBeCloseTo(0.5, 3);
    expect(snap2.roots.generated).toBe(snap2.roots.succeeded + snap2.roots.failed + snap2.roots.rejected + snap2.roots.expired + snap2.roots.inFlight);
  });

  it('source dispatches at 100 RPS without artificial bottleneck to downstream', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const downstream: ExecutionNode = {
      id: 'down',
      kind: 'service',
      name: 'Downstream',
      position: { x: 100, y: 0 },
      behavior: {
        ...defaultBehavior('service'),
        concurrency: 16,
        capacity: 10, // 100ms service
        queueLimit: 500,
      },
    };
    const edge = defaultExecutionEdge('src', 'down');
    edge.id = 'e1';

    const graph = createGraph({ nodes: [sourceNode, downstream], edges: [edge] });
    graph.workloads[0].intervalMs = 10; // 100 RPS

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(1);
    expect(snap.nodes['src'].activeWorkers).toBe(0);
    expect(snap.nodes['down'].arrived).toBeGreaterThanOrEqual(90);
  });

  it('produces identical output between chunked advance and one-shot advance', () => {
    const graph1 = createGraph({ duration: 2 });
    const graph2 = createGraph({ duration: 2 });

    const simChunked = new OpenSimulation(graph1);
    simChunked.advance(0.5);
    simChunked.advance(1.0);
    simChunked.advance(1.5);
    const snapChunked = simChunked.advance(2.0);

    const simOneShot = new OpenSimulation(graph2);
    const snapOneShot = simOneShot.advance(2.0);

    expect(snapChunked.roots).toEqual(snapOneShot.roots);
    expect(snapChunked.nodes).toEqual(snapOneShot.nodes);
    expect(snapChunked.history.length).toEqual(snapOneShot.history.length);
  });

  it('accepts inactive node warning and ignores inactive node without error', () => {
    const graph = createGraph();
    const inactiveNode: ExecutionNode = {
      id: 'inactive',
      kind: 'service',
      name: 'Inactive Service',
      position: { x: 300, y: 300 },
      behavior: defaultBehavior('service'),
    };
    graph.nodes.push(inactiveNode);

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(1);
    expect(snap.nodes['inactive'].arrived).toBe(0);
  });

  it('source node counters: no attempts and completed matches succeeded roots without double counting', () => {
    const graph = createGraph({ duration: 2.1 });
    graph.workloads[0].intervalMs = 200; // 10 arrivals
    const sim = new OpenSimulation(graph);
    const snap = sim.advance(2.1);

    expect(snap.roots.succeeded).toBe(10);
    expect(snap.nodes['src'].attempts).toBe(0);
    expect(snap.nodes['src'].completed).toBe(10);
    expect(snap.nodes['src'].admitted).toBe(10);
    expect(snap.nodes['src'].activeWorkers).toBe(0);
    expect(snap.nodes['src'].waiting).toBe(0);
  });

  it('settled live-op tracking decrements to 0 after all operations complete', () => {
    const graph = createGraph({ duration: 1.05 });
    graph.workloads[0].intervalMs = 100;
    const sim = new TestableOpenSimulation(graph);
    const snap = sim.advance(1.05);

    expect(snap.roots.succeeded).toBe(10);
    expect(sim.getLiveOpsCount()).toBe(0);
  });

  it('handles source timeout expiration cleanly with 0 attempts and 1 expired', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const slowNode: ExecutionNode = {
      id: 'slow',
      kind: 'service',
      name: 'Slow Service',
      position: { x: 100, y: 0 },
      behavior: { ...defaultBehavior('service'), capacity: 1, concurrency: 1 }, // 1000ms service
    };
    const edge = defaultExecutionEdge('src', 'slow');
    edge.id = 'e1';

    const graph = createGraph({ nodes: [sourceNode, slowNode], edges: [edge], duration: 2 });
    graph.workloads[0].intervalMs = 500; // arrives at 0.5s
    graph.workloads[0].timeoutMs = 200; // expires at 0.7s

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(1.0);

    expect(snap.roots.expired).toBeGreaterThan(0);
    expect(snap.nodes['src'].expired).toBeGreaterThan(0);
    expect(snap.nodes['src'].attempts).toBe(0);
    expect(snap.nodes['src'].completed).toBe(0);
  });

  it('branch failure cancels sibling processing before its downstream dispatch', () => {
    const sourceNode: ExecutionNode = {
      id: 'src',
      kind: 'traffic',
      name: 'Traffic',
      position: { x: 0, y: 0 },
      behavior: defaultBehavior('traffic'),
    };
    const bFastFail: ExecutionNode = {
      id: 'bFastFail',
      kind: 'service',
      name: 'Fast Failing Branch',
      position: { x: 100, y: -50 },
      behavior: { ...defaultBehavior('service'), capacity: 1000, failureRate: 100 }, // 1ms, fails
    };
    const bSlow: ExecutionNode = {
      id: 'bSlow',
      kind: 'service',
      name: 'Slow Branch',
      position: { x: 100, y: 50 },
      behavior: { ...defaultBehavior('service'), capacity: 200 }, // 5ms, succeeds
    };
    const shared: ExecutionNode = {
      id: 'shared',
      kind: 'service',
      name: 'Shared Target',
      position: { x: 200, y: 0 },
      behavior: { ...defaultBehavior('service'), capacity: 10, concurrency: 1, queueLimit: 10 }, // 100ms service
    };

    const e0a = defaultExecutionEdge('src', 'bFastFail');
    e0a.id = 'e0a';
    const e0b = defaultExecutionEdge('src', 'bSlow');
    e0b.id = 'e0b';
    const e1 = defaultExecutionEdge('bFastFail', 'shared');
    e1.id = 'e1';
    const e2 = defaultExecutionEdge('bSlow', 'shared');
    e2.id = 'e2';

    const graph = createGraph({
      nodes: [sourceNode, bFastFail, bSlow, shared],
      edges: [e0a, e0b, e1, e2],
      duration: 1.1,
    });
    graph.workloads[0].intervalMs = 500; // arrive at 0.5s

    const sim = new TestableOpenSimulation(graph);
    const snap = sim.advance(1.1);

    expect(snap.roots.failed).toBe(2);
    // Shared target should never start any processing since bFastFail failed immediately before dispatching or admitting
    expect(snap.nodes['shared'].attempts).toBe(0);
    expect(sim.getLiveOpsCount()).toBe(0);
  });
});

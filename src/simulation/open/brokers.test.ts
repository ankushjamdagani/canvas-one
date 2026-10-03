import { describe, it, expect } from 'vitest';
import type { ExecutionGraph, ExecutionNode, ExecutionEdge, WorkloadDefinition } from '../../domain/execution';
import { OpenSimulation } from './kernel';

function makeTestGraph(nodes: ExecutionNode[], edges: ExecutionEdge[], workloads: WorkloadDefinition[], duration = 10, seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes,
    edges,
    workloads,
    settings: {
      seed,
      duration: Math.max(1, duration),
    },
  };
}

function makeBrokerNode(id: string, delivery: 'competing' | 'broadcast', queueLimit = 10): ExecutionNode {
  return {
    id,
    kind: 'queue',
    name: id,
    position: { x: 0, y: 0 },
    behavior: {
      type: 'broker',
      delivery,
      capacity: 2000,
      concurrency: 1,
      queueLimit,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 100,
    },
  };
}

function makeWorkerNode(id: string, concurrency = 1, capacity = 10, queueLimit = 0): ExecutionNode {
  return {
    id,
    kind: 'worker',
    name: id,
    position: { x: 100, y: 0 },
    behavior: {
      type: 'processor',
      capacity,
      concurrency,
      queueLimit,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 100,
    },
  };
}

function makeSourceNode(id: string): ExecutionNode {
  return {
    id,
    kind: 'traffic',
    name: id,
    position: { x: -100, y: 0 },
    behavior: {
      type: 'source',
      capacity: 2000,
      concurrency: 1,
      queueLimit: 0,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 100,
    },
  };
}

function makeEdge(id: string, source: string, target: string, transport: 'call' | 'message', latencyMs = 0, returnLatencyMs = 0, ackDelayMs = 8, messageTtlMs = 2000): ExecutionEdge {
  return {
    id,
    source,
    target,
    transport,
    latencyMs,
    returnLatencyMs,
    ackDelayMs,
    messageTtlMs,
    weight: 1,
  };
}

function makeWorkload(id: string, entryNodeId: string, intervalMs: number, timeoutMs = 2000): WorkloadDefinition {
  return {
    id,
    entryNodeId,
    enabled: true,
    rate: 1000 / intervalMs,
    intervalMs,
    timeoutMs,
    classes: [
      {
        id: 'c1',
        name: 'default',
        weight: 1,
        operation: 'read',
        tags: [],
        keyDistribution: {
          kind: 'uniform',
          catalogSize: 10,
          hotSubset: 1,
          hotShare: 100,
        },
      },
    ],
  };
}

function verifyConservation(nodes: Record<string, any>): void {
  for (const [id, m] of Object.entries(nodes)) {
    const accounted =
      m.completed +
      m.rejected +
      m.failed +
      m.expired +
      m.cancelled +
      m.queued +
      (m.processing - m.cleanupProcessing) +
      m.waiting +
      m.retrying +
      m.reserved;
    expect(accounted, `node ${id}`).toBe(m.arrived);
  }
}

describe('Broker and Reserved Consumer Delivery', () => {
  it('competing: two consumers never overbook, round-robin on available slots', () => {
    const broker = makeBrokerNode('broker1', 'competing', 10);
    const w1 = makeWorkerNode('w1', 1, 10, 0); // 100ms service time
    const w2 = makeWorkerNode('w2', 1, 10, 0); // 100ms service time
    const e1 = makeEdge('e1', 'broker1', 'w1', 'message', 10); // 10ms transit
    const e2 = makeEdge('e2', 'broker1', 'w2', 'message', 10); // 10ms transit
    const wl = makeWorkload('wl1', 'broker1', 40, 2000); // arrival every 40ms

    const graph = makeTestGraph([broker, w1, w2], [e1, e2], [wl], 2);
    const sim = new OpenSimulation(graph);

    // Advance across arrivals
    const snap1 = sim.advance(0.09);
    expect(snap1.nodes.w1.activeWorkers).toBeLessThanOrEqual(1);
    expect(snap1.nodes.w2.activeWorkers).toBeLessThanOrEqual(1);
    verifyConservation(snap1.nodes);

    const snap2 = sim.advance(0.5);
    expect(snap2.nodes.w1.activeWorkers).toBeLessThanOrEqual(1);
    expect(snap2.nodes.w2.activeWorkers).toBeLessThanOrEqual(1);
    expect(snap2.nodes.w1.arrived).toBeGreaterThan(0);
    expect(snap2.nodes.w2.arrived).toBeGreaterThan(0);
    // Both consumers should receive round-robin shares
    expect(Math.abs(snap2.nodes.w1.arrived - snap2.nodes.w2.arrived)).toBeLessThanOrEqual(2);
    verifyConservation(snap2.nodes);
  });

  it('queueLimit 0: accepts idle and rejects busy', () => {
    const broker = makeBrokerNode('b0', 'competing', 0);
    const w = makeWorkerNode('w0', 1, 5, 0); // 200ms service time
    const e = makeEdge('e0', 'b0', 'w0', 'message', 0);
    const wl = makeWorkload('wl0', 'b0', 50, 2000); // arrives at 50ms, 100ms, 150ms...

    const graph = makeTestGraph([broker, w], [e], [wl], 0.25);
    const sim = new OpenSimulation(graph);

    // At t=0.06: first arrival at 50ms admitted and started on w0 (until 250ms)
    const snap1 = sim.advance(0.06);
    expect(snap1.nodes.b0.admitted).toBe(1);
    expect(snap1.nodes.b0.rejected).toBe(0);
    verifyConservation(snap1.nodes);

    // At t=0.12: second arrival at 100ms arrives while w0 is busy -> queueLimit 0 rejects
    const snap2 = sim.advance(0.12);
    expect(snap2.nodes.b0.arrived).toBe(2);
    expect(snap2.nodes.b0.admitted).toBe(1);
    expect(snap2.nodes.b0.rejected).toBe(1);
    verifyConservation(snap2.nodes);
  });

  it('buffered work dispatches immediately on consumer completion', () => {
    const broker = makeBrokerNode('bBuf', 'competing', 5);
    const w = makeWorkerNode('wBuf', 1, 10, 0); // 100ms service
    const e = makeEdge('eBuf', 'bBuf', 'wBuf', 'message', 0);
    const wl = makeWorkload('wlBuf', 'bBuf', 50, 2000); // 50ms, 100ms, 150ms

    const graph = makeTestGraph([broker, w], [e], [wl], 0.3);
    const sim = new OpenSimulation(graph);

    // At 120ms: 1st arrived at 50ms (finishes at 150ms). 2nd arrived at 100ms is buffered in broker
    sim.advance(0.12);
    expect(sim.snapshot().nodes.bBuf.buffered).toBe(1);
    expect(sim.snapshot().nodes.wBuf.processing).toBe(1);

    // At 160ms: 1st finished at 150ms, 2nd dispatched immediately
    sim.advance(0.16);
    expect(sim.snapshot().nodes.bBuf.buffered).toBe(1); // 3rd arrived at 150ms now buffered!
    expect(sim.snapshot().nodes.wBuf.completed).toBe(1);
    expect(sim.snapshot().nodes.wBuf.processing).toBe(1);
    verifyConservation(sim.snapshot().nodes);
  });

  it('broker FIFO expiry before readiness never starts on consumer', () => {
    const broker = makeBrokerNode('bExp', 'competing', 5);
    const w = makeWorkerNode('wExp', 1, 2, 0); // 500ms service
    const e = makeEdge('eExp', 'bExp', 'wExp', 'message', 0);
    // arrival at 10ms, 20ms. Workload timeout is 80ms!
    const wl = makeWorkload('wlExp', 'bExp', 10, 80);

    const graph = makeTestGraph([broker, w], [e], [wl], 0.2);
    const sim = new OpenSimulation(graph);

    // First arrival at 10ms occupies worker until 510ms.
    // Second arrival at 20ms expires at 20+80=100ms while still in broker queue.
    const snap = sim.advance(0.15);
    expect(snap.nodes.bExp.expired).toBeGreaterThan(0);
    expect(snap.nodes.wExp.arrived).toBe(1); // only 1 was admitted to worker
    verifyConservation(snap.nodes);
  });

  it('reserved forward transit occupancy and expiry cleanup', () => {
    const broker = makeBrokerNode('bTransit', 'competing', 5);
    const w = makeWorkerNode('wTransit', 1, 10, 0);
    // Forward transit latency = 50ms
    const e = makeEdge('eTransit', 'bTransit', 'wTransit', 'message', 50, 0, 8, 30); // ttl 30ms < latency 50ms!
    const wl = makeWorkload('wlTransit', 'bTransit', 100, 30);

    const graph = makeTestGraph([broker, w], [e], [wl], 0.2);
    const sim = new OpenSimulation(graph);

    // At t=0.02: arrival at 10ms reserved consumer wTransit. Transit takes 50ms (arrives at 60ms).
    sim.advance(0.12);
    const snapMid = sim.snapshot();
    expect(snapMid.nodes.wTransit.reserved).toBe(1);
    expect(snapMid.nodes.wTransit.activeWorkers).toBe(1);
    verifyConservation(snapMid.nodes);

    // At t=0.05: ttl expires at 40ms before arrival at 60ms. Consumer reservation freed!
    sim.advance(0.14);
    const snapAfter = sim.snapshot();
    expect(snapAfter.nodes.wTransit.expired).toBe(1);
    expect(snapAfter.nodes.wTransit.reserved).toBe(0);
    expect(snapAfter.nodes.wTransit.activeWorkers).toBe(0);
    verifyConservation(snapAfter.nodes);
  });

  it('broadcast: partial rejection preserves accepted subscription', () => {
    const broker = makeBrokerNode('bBcast', 'broadcast', 0);
    const w1 = makeWorkerNode('wB1', 1, 10, 0); // 100ms
    const w2 = makeWorkerNode('wB2', 1, 100, 0); // 10ms
    const e1 = makeEdge('eB1', 'bBcast', 'wB1', 'message', 0);
    const e2 = makeEdge('eB2', 'bBcast', 'wB2', 'message', 0);
    // Arrival every 30ms
    const wl = makeWorkload('wlBcast', 'bBcast', 30, 2000);

    const graph = makeTestGraph([broker, w1, w2], [e1, e2], [wl], 0.15);
    const sim = new OpenSimulation(graph);

    // Advance through 3 arrivals:
    // arr 1 (30ms): wB1, wB2 idle -> both admitted immediately
    // arr 2 (60ms): wB1, wB2 busy -> both queued in bBcast (1 per subscription)
    // arr 3 (90ms): wB1, wB2 still busy -> queueLimit 1 reached -> rejected
    sim.advance(0.075);
    const snap = sim.snapshot();
    expect(snap.nodes.bBcast.arrived).toBe(4);
    expect(snap.nodes.bBcast.admitted).toBe(3);
    expect(snap.nodes.bBcast.rejected).toBe(1);
    expect(snap.roots).toMatchObject({ succeeded: 1, failed: 1 });
    expect(snap.messages).toMatchObject({ generated: 4, succeeded: 2, rejected: 1, inFlight: 1 });
    verifyConservation(snap.nodes);
  });

  it('broker deliveries do not double message.generated', () => {
    const src = makeSourceNode('src1');
    const broker = makeBrokerNode('bGen', 'competing', 5);
    const w = makeWorkerNode('wGen', 1, 20, 0);
    const eSrc = makeEdge('eSrc', 'src1', 'bGen', 'message', 5);
    const eOut = makeEdge('eOut', 'bGen', 'wGen', 'message', 5);
    const wl = makeWorkload('wlGen', 'src1', 50, 2000);

    const graph = makeTestGraph([src, broker, w], [eSrc, eOut], [wl], 0.2);
    const sim = new OpenSimulation(graph);

    sim.advance(0.16);
    const snap = sim.snapshot();
    // 3 arrivals at src1: each publishes 1 message across eSrc.
    // Consumer delivery from bGen to wGen MUST NOT call publishMessage, so messages.generated is exactly arrivals published.
    expect(snap.messages.generated).toBe(3);
    verifyConservation(snap.nodes);
  });

  it('producer ack vs eventual completion', () => {
    const src = makeSourceNode('srcAck');
    const broker = makeBrokerNode('bAck', 'competing', 5);
    const w = makeWorkerNode('wAck', 1, 5, 0); // 200ms processing
    const eSrc = makeEdge('eSrcAck', 'srcAck', 'bAck', 'message', 5, 5, 10); // 5ms latency, 10ms ack, 5ms return => ack at 20ms
    const eOut = makeEdge('eOutAck', 'bAck', 'wAck', 'message', 0);
    const wl = makeWorkload('wlAck', 'srcAck', 100, 2000);

    const graph = makeTestGraph([src, broker, w], [eSrc, eOut], [wl], 0.3);
    const sim = new OpenSimulation(graph);

    // Arrival at 100ms. Delivered to broker at 105ms. Ack scheduled for 105+10+5 = 120ms.
    sim.advance(0.13);
    const snap1 = sim.snapshot();
    // Producer (srcAck) received ack and completed!
    expect(snap1.nodes.srcAck.completed).toBe(1);
    // But worker wAck is still processing (takes until 105 + 200 = 305ms)
    expect(snap1.nodes.wAck.processing).toBe(1);
    expect(snap1.nodes.bAck.completed).toBe(0);
    verifyConservation(snap1.nodes);

    // After worker completes:
    sim.advance(0.35);
    const snap2 = sim.snapshot();
    expect(snap2.nodes.wAck.completed).toBe(1);
    expect(snap2.nodes.bAck.completed).toBe(1);
    verifyConservation(snap2.nodes);
  });

  it('direct workload entry on broker creates root publication + independent messages', () => {
    const broker = makeBrokerNode('bDirect', 'broadcast', 5);
    const w1 = makeWorkerNode('wD1', 1, 20, 0);
    const w2 = makeWorkerNode('wD2', 1, 20, 0);
    const e1 = makeEdge('eD1', 'bDirect', 'wD1', 'message', 0);
    const e2 = makeEdge('eD2', 'bDirect', 'wD2', 'message', 0);
    const wl = makeWorkload('wlDirect', 'bDirect', 50, 2000);

    const graph = makeTestGraph([broker, w1, w2], [e1, e2], [wl], 0.12);
    const sim = new OpenSimulation(graph);

    sim.advance(0.12);
    const snap = sim.snapshot();
    // 2 arrivals generated roots
    expect(snap.roots.generated).toBe(2);
    // Each arrival broadcasted to 2 subscriptions => 4 message deliveries
    expect(snap.messages.generated).toBe(4);
    // Synthetic edges must not appear in edge metrics
    expect(Object.keys(snap.edges)).not.toContain('__entry:wlDirect');
    verifyConservation(snap.nodes);
  });

  it('mixed graph with sync call, cache, message broker preserves conservation in chunked advance', () => {
    const src = makeSourceNode('srcMix');
    const cacheNode: ExecutionNode = {
      id: 'cacheMix',
      kind: 'cache',
      name: 'cacheMix',
      position: { x: 0, y: 0 },
      behavior: {
        type: 'cache',
        mode: 'fixed',
        hitRate: 50,
        entries: 100,
        ttlMs: 5000,
        capacity: 1000,
        concurrency: 2,
        queueLimit: 10,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 0,
      },
    };
    const broker = makeBrokerNode('bMix', 'competing', 5);
    const worker = makeWorkerNode('wMix', 2, 20, 5);

    const eSrc = makeEdge('eSrcMix', 'srcMix', 'cacheMix', 'call', 5, 5);
    const origin = makeWorkerNode('originMix', 2, 100, 5);
    const eCache = makeEdge('eCacheMix', 'cacheMix', 'originMix', 'call', 5, 5);
    const ePublish = makeEdge('ePublishMix', 'originMix', 'bMix', 'message', 5, 5);
    const eBroker = makeEdge('eBrokerMix', 'bMix', 'wMix', 'message', 5, 5);
    const wl = makeWorkload('wlMix', 'srcMix', 25, 1000);

    const graph = makeTestGraph([src, cacheNode, origin, broker, worker], [eSrc, eCache, ePublish, eBroker], [wl], 1);
    const sim = new OpenSimulation(graph);

    // Chunked advances
    for (const t of [0.05, 0.17, 0.29, 0.45]) {
      const snap = sim.advance(t);
      verifyConservation(snap.nodes);
      expect(snap.nodes.wMix.activeWorkers).toBeLessThanOrEqual(2);
      expect(snap.nodes.wMix.queued).toBeLessThanOrEqual(5);
    }
    expect(sim.advance(0.5)).toEqual(new OpenSimulation(graph).advance(0.5));
  });

  it('exact deadline reached does not start operation', () => {
    const broker = makeBrokerNode('bExact', 'competing', 5);
    const w = makeWorkerNode('wExact', 1, 10, 0);
    // Latency is exactly equal to TTL
    const e = makeEdge('eExact', 'bExact', 'wExact', 'message', 50, 0, 8, 50);
    const wl = makeWorkload('wlExact', 'bExact', 10, 50); // timeout 50ms

    const graph = makeTestGraph([broker, w], [e], [wl], 0.1);
    const sim = new OpenSimulation(graph);

    sim.advance(0.08);
    const snap = sim.snapshot();
    // At exact deadline, child must expire/cancel and NOT start processing
    expect(snap.nodes.wExact.processing).toBe(0);
    verifyConservation(snap.nodes);
  });

  it('competing cursor persists and advances only after actual reservation', () => {
    const broker = makeBrokerNode('bCursor', 'competing', 10);
    const w1 = makeWorkerNode('wA', 1, 100, 0); // very fast (10ms)
    const w2 = makeWorkerNode('wB', 1, 10, 0);  // slower (100ms)
    const e1 = makeEdge('eA', 'bCursor', 'wA', 'message', 0);
    const e2 = makeEdge('eB', 'bCursor', 'wB', 'message', 0);
    const wl = makeWorkload('wlCursor', 'bCursor', 20, 2000);

    const graph = makeTestGraph([broker, w1, w2], [e1, e2], [wl], 0.3);
    const sim = new OpenSimulation(graph);

    sim.advance(0.2);
    const snap = sim.snapshot();
    expect(snap.nodes.wA.arrived).toBeGreaterThan(0);
    expect(snap.nodes.wB.arrived).toBeGreaterThan(0);
    verifyConservation(snap.nodes);
  });
});

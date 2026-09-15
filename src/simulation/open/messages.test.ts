import { describe, it, expect } from 'vitest';
import type { ExecutionGraph } from '../../domain/execution';
import { OpenSimulation } from './kernel';
import { defaultBehavior, defaultExecutionEdge, defaultWorkload } from '../../domain/behaviorDefaults';

function makeBaseGraph(): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [],
    edges: [],
    workloads: [],
    settings: {
      seed: 42,
      duration: 10,
    },
  };
}

describe('Asynchronous message transport', () => {
  function deadlineGraph(): ExecutionGraph {
    return {
      ...makeBaseGraph(),
      nodes: ['src', 'svc'].map(id => ({ id, name: id, kind: 'service', position: { x: 0, y: 0 },
        behavior: defaultBehavior(id === 'src' ? 'traffic' : 'service') })),
      edges: [{ ...defaultExecutionEdge('src', 'svc'), id: 'message', transport: 'message' }],
      workloads: [{ ...defaultWorkload('src'), id: 'fixed', intervalMs: 1000 }],
    };
  }

  it('deadline wins an exact admission tie and sends only one failure response', () => {
    const graph = deadlineGraph();
    graph.edges[0].latencyMs = 100;
    graph.edges[0].messageTtlMs = 100;
    const sim = new OpenSimulation(graph);
    const m = sim.advance(1.5);
    expect(m.roots).toMatchObject({ generated: 1, failed: 1, inFlight: 0 });
    expect(m.messages).toMatchObject({ generated: 1, expired: 1, inFlight: 0 });
    expect(m.nodes.svc.arrived).toBe(0);
    expect(m.edges.message).toMatchObject({ sent: 1, admitted: 0, responses: 1 });
  });

  it('feedback descendants retain the first publication deadline', () => {
    const graph = deadlineGraph();
    graph.edges[0].messageTtlMs = 50;
    graph.edges[0].latencyMs = 5;
    graph.edges.push({ ...graph.edges[0], id: 'feedback', source: 'svc', target: 'src', messageTtlMs: 10000 });
    const m = new OpenSimulation(graph).advance(1.2);
    expect(m.messages.expired).toBeGreaterThan(0);
    expect(m.messages.generated).toBeLessThan(30);
    expect(m.messages.inFlight).toBe(0);
    expect(m.messages.generated).toBe(m.messages.succeeded + m.messages.failed + m.messages.rejected + m.messages.expired);
  });

  it('arbitrary observation chunks preserve all message and resource metrics', () => {
    const graph = deadlineGraph();
    graph.workloads[0].intervalMs = 13;
    graph.nodes[1].behavior.capacity = 23;
    graph.nodes[1].behavior.failureRate = 35;
    graph.nodes[1].behavior.maxRetries = 1;
    const one = new OpenSimulation(graph).advance(2);
    const sim = new OpenSimulation(graph);
    for (const time of [0.17, 0.93, 1.37]) {
      const m = sim.advance(time);
      for (const f of [m.roots, m.messages]) expect(f.generated).toBe(f.succeeded + f.rejected + f.failed + f.expired + f.inFlight);
    }
    expect(sim.advance(2)).toEqual(one);
  });

  it('1: source->async slowservice: root succeeds at admissionack before message completes', () => {
    const graph = makeBaseGraph();
    graph.settings.duration = 10;
    graph.nodes = [
      {
        id: 'src',
        kind: 'traffic',
        name: 'Source',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'source',
          capacity: 1000,
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'svc',
        kind: 'service',
        name: 'Slow Service',
        position: { x: 100, y: 0 },
        behavior: {
          type: 'processor',
          capacity: 1, // 1s processing time
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    ];
    graph.edges = [
      {
        id: 'e1',
        source: 'src',
        target: 'svc',
        transport: 'message',
        latencyMs: 100,
        returnLatencyMs: 100,
        ackDelayMs: 50,
        messageTtlMs: 5000,
        weight: 1,
      },
    ];
    graph.workloads = [
      {
        id: 'w1',
        entryNodeId: 'src',
        enabled: true,
        rate: 1,
        timeoutMs: 3000,
        intervalMs: 10000, // single arrival at t=10s or custom advance
        classes: [
          {
            id: 'c1',
            name: 'c1',
            weight: 1,
            operation: 'read',
            tags: [],
            keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 10 },
          },
        ],
      },
    ];

    // Arrival happens at t = 10s if intervalMs=10000. Let's use intervalMs=1000 so arrival at t=1s.
    graph.workloads[0].intervalMs = 1000;
    const sim = new OpenSimulation(graph);

    // Arrival at t=1.0s.
    // Edge forward latency = 0.1s -> arrival at svc at t=1.1s.
    // Admitted at t=1.1s.
    // Ack delay = 0.05s, return latency = 0.1s -> Ack arrives at src at t = 1.1 + 0.05 + 0.1 = 1.25s.
    // Service processing completes at t = 1.1 + 1.0 = 2.1s.

    // Check at t=1.5s: producer should have received ack and root succeeded, while message is still in-flight
    const snap1 = sim.advance(1.5);
    expect(snap1.roots.succeeded).toBe(1);
    expect(snap1.roots.inFlight).toBe(0);
    expect(snap1.messages.generated).toBe(1);
    expect(snap1.messages.inFlight).toBe(1);
    expect(snap1.messages.succeeded).toBe(0);

    // Check at t=2.5s: message finishes
    const snap2 = sim.advance(2.5);
    expect(snap2.messages.succeeded).toBe(1);
    expect(snap2.messages.inFlight).toBe(1); // second arrival is processing
    expect(snap2.messages.generated).toBe(2);
    expect(snap2.messages.meanLatency).toBeCloseTo(1100, 8);
  });

  it('2: admitted slow message survives producer timeout before delayed ack, then completes independently', () => {
    const graph = makeBaseGraph();
    graph.settings.duration = 10;
    graph.nodes = [
      {
        id: 'src',
        kind: 'traffic',
        name: 'Source',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'source',
          capacity: 1000,
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'svc',
        kind: 'service',
        name: 'Slow Service',
        position: { x: 100, y: 0 },
        behavior: {
          type: 'processor',
          capacity: 1, // 1s processing time
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    ];
    graph.edges = [
      {
        id: 'e1',
        source: 'src',
        target: 'svc',
        transport: 'message',
        latencyMs: 100,
        returnLatencyMs: 1000, // 1s return latency
        ackDelayMs: 500, // 0.5s ack delay
        messageTtlMs: 5000,
        weight: 1,
      },
    ];
    graph.workloads = [
      {
        id: 'w1',
        entryNodeId: 'src',
        enabled: true,
        rate: 1,
        timeoutMs: 1000, // producer expires 1s after arrival (t = 1 + 1 = 2.0s)
        intervalMs: 2000, // arrival at t=1s
        classes: [
          {
            id: 'c1',
            name: 'c1',
            weight: 1,
            operation: 'read',
            tags: [],
            keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 10 },
          },
        ],
      },
    ];

    const sim = new OpenSimulation(graph);
    // Arrival at t=1.0s. Admitted at t=1.1s.
    // Ack delivery scheduled for t = 1.1 + 0.5 + 1.0 = 2.6s.
    // Producer timeout at t = 2.0s (born 1.0 + timeout 1.0).
    sim.advance(3.05);
    const snap1 = sim.snapshot();
    expect(snap1.roots.expired).toBe(1);
    expect(snap1.messages.inFlight).toBe(1);

    // Message processing finishes at t = 1.1 + 1.0 = 2.1s.
    sim.advance(3.2);
    const snap2 = sim.snapshot();
    expect(snap2.messages.succeeded).toBe(1);
  });

  it('3: generic destination queue0 concurrency1: second message rejected, root fails, first independent message survives', () => {
    const graph = makeBaseGraph();
    graph.settings.duration = 10;
    graph.nodes = [
      {
        id: 'src',
        kind: 'traffic',
        name: 'Source',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'source',
          capacity: 1000,
          concurrency: 10,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'svc',
        kind: 'service',
        name: 'Tight Service',
        position: { x: 100, y: 0 },
        behavior: {
          type: 'processor',
          capacity: 1, // 1s processing
          concurrency: 1,
          queueLimit: 0, // queue limit 0
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    ];
    graph.edges = [
      {
        id: 'e1',
        source: 'src',
        target: 'svc',
        transport: 'message',
        latencyMs: 10,
        returnLatencyMs: 10,
        ackDelayMs: 0,
        messageTtlMs: 5000,
        weight: 1,
      },
    ];
    graph.workloads = [
      {
        id: 'w1',
        entryNodeId: 'src',
        enabled: true,
        rate: 1,
        timeoutMs: 5000,
        intervalMs: 100, // arrivals at t=0.1s and t=0.2s
        classes: [
          {
            id: 'c1',
            name: 'c1',
            weight: 1,
            operation: 'read',
            tags: [],
            keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 10 },
          },
        ],
      },
    ];

    const sim = new OpenSimulation(graph);
    // First arrival at t=0.1s, arrives at svc at 0.11s and is admitted.
    // Second arrival at t=0.2s, arrives at svc at 0.21s and is rejected.
    sim.advance(0.25);
    const snap1 = sim.snapshot();
    expect(snap1.roots.succeeded).toBe(1);
    expect(snap1.roots.failed).toBe(1);
    expect(snap1.messages.rejected).toBe(1);
    expect(snap1.messages.inFlight).toBe(1); // first message is still processing

    // Finish first message (0.11 + 2.0 = 2.11s)
    sim.advance(1.15);
    const snap2 = sim.snapshot();
    expect(snap2.messages.succeeded).toBe(1);
  });

  it('4: 100% consumer local failure produces message.failed and producer success; retry separate', () => {
    const graph = makeBaseGraph();
    graph.settings.duration = 10;
    graph.nodes = [
      {
        id: 'src',
        kind: 'traffic',
        name: 'Source',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'source',
          capacity: 1000,
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'svc',
        kind: 'service',
        name: 'Failing Service',
        position: { x: 100, y: 0 },
        behavior: {
          type: 'processor',
          capacity: 10,
          concurrency: 1,
          queueLimit: 10,
          failureRate: 100, // always fail
          maxRetries: 1,
          retryDelayMs: 50,
        },
      },
    ];
    graph.edges = [
      {
        id: 'e1',
        source: 'src',
        target: 'svc',
        transport: 'message',
        latencyMs: 10,
        returnLatencyMs: 10,
        ackDelayMs: 10,
        messageTtlMs: 5000,
        weight: 1,
      },
    ];
    graph.workloads = [
      {
        id: 'w1',
        entryNodeId: 'src',
        enabled: true,
        rate: 1,
        timeoutMs: 5000,
        intervalMs: 1000,
        classes: [
          {
            id: 'c1',
            name: 'c1',
            weight: 1,
            operation: 'read',
            tags: [],
            keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 10 },
          },
        ],
      },
    ];

    const sim = new OpenSimulation(graph);
    sim.advance(2.0);
    const snap = sim.snapshot();
    expect(snap.roots.succeeded).toBe(1); // producer admitted ack received
    expect(snap.messages.failed).toBe(1);
    expect(snap.messages.succeeded).toBe(0);
    expect(snap.nodes['svc'].retries).toBe(1);
  });

  it('5: message expiry retains physical processing until completion, zero late sends', () => {
    const graph = makeBaseGraph();
    graph.settings.duration = 10;
    graph.nodes = [
      {
        id: 'src',
        kind: 'traffic',
        name: 'Source',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'source',
          capacity: 1000,
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'svc',
        kind: 'service',
        name: 'Service',
        position: { x: 100, y: 0 },
        behavior: {
          type: 'processor',
          capacity: 1, // 1s processing
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    ];
    graph.edges = [
      {
        id: 'e1',
        source: 'src',
        target: 'svc',
        transport: 'message',
        latencyMs: 10,
        returnLatencyMs: 10,
        ackDelayMs: 10,
        messageTtlMs: 500, // expires in 0.5s while processing takes 1.0s
        weight: 1,
      },
    ];
    graph.workloads = [
      {
        id: 'w1',
        entryNodeId: 'src',
        enabled: true,
        rate: 1,
        timeoutMs: 5000,
        intervalMs: 2000,
        classes: [
          {
            id: 'c1',
            name: 'c1',
            weight: 1,
            operation: 'read',
            tags: [],
            keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 10 },
          },
        ],
      },
    ];

    const sim = new OpenSimulation(graph);
    sim.advance(2.6);
    const snap = sim.snapshot();
    expect(snap.messages.expired).toBe(1);
    expect(snap.messages.inFlight).toBe(0);
    // Once admitted, expiration must never retract admission ack
    expect(snap.roots.succeeded).toBe(1);
    expect(snap.nodes.svc.processing).toBe(1);
    expect(sim.advance(3.1).nodes.svc.processing).toBe(0);
  });

  it('6: mixed call+message root parallel join; failing call cannot cancel accepted message', () => {
    const graph = makeBaseGraph();
    graph.settings.duration = 10;
    graph.nodes = [
      {
        id: 'src',
        kind: 'traffic',
        name: 'Source',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'source',
          capacity: 1000,
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'failCall',
        kind: 'service',
        name: 'Call Service',
        position: { x: 100, y: -50 },
        behavior: {
          type: 'processor',
          capacity: 10,
          concurrency: 1,
          queueLimit: 10,
          failureRate: 100,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'msgSvc',
        kind: 'service',
        name: 'Msg Service',
        position: { x: 100, y: 50 },
        behavior: {
          type: 'processor',
          capacity: 1,
          concurrency: 1,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    ];
    graph.edges = [
      {
        id: 'e_call',
        source: 'src',
        target: 'failCall',
        transport: 'call',
        latencyMs: 10,
        returnLatencyMs: 10,
        ackDelayMs: 0,
        messageTtlMs: 2000,
        weight: 1,
      },
      {
        id: 'e_msg',
        source: 'src',
        target: 'msgSvc',
        transport: 'message',
        latencyMs: 10,
        returnLatencyMs: 10,
        ackDelayMs: 10,
        messageTtlMs: 5000,
        weight: 1,
      },
    ];
    graph.workloads = [
      {
        id: 'w1',
        entryNodeId: 'src',
        enabled: true,
        rate: 1,
        timeoutMs: 5000,
        intervalMs: 1000,
        classes: [
          {
            id: 'c1',
            name: 'c1',
            weight: 1,
            operation: 'read',
            tags: [],
            keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 10 },
          },
        ],
      },
    ];

    const sim = new OpenSimulation(graph);
    sim.advance(2.05);
    const snap = sim.snapshot();
    expect(snap.roots.failed).toBe(1);
    expect(snap.messages.succeeded).toBe(1);
  });

  it('7: async feedback loop TTL inherited never refreshed; 64hop fastloop explicit failed', () => {
    const graph = makeBaseGraph();
    graph.settings.duration = 10;
    graph.nodes = [
      {
        id: 'n1',
        kind: 'traffic',
        name: 'Loop Source',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'source',
          capacity: 1000,
          concurrency: 10,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'n2',
        kind: 'service',
        name: 'Loop Service',
        position: { x: 100, y: 0 },
        behavior: {
          type: 'processor',
          capacity: 1000, // very fast
          concurrency: 10,
          queueLimit: 100,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
    ];
    graph.edges = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        transport: 'message',
        latencyMs: 1,
        returnLatencyMs: 1,
        ackDelayMs: 1,
        messageTtlMs: 10000,
        weight: 1,
      },
      {
        id: 'e2',
        source: 'n2',
        target: 'n1',
        transport: 'message',
        latencyMs: 1,
        returnLatencyMs: 1,
        ackDelayMs: 1,
        messageTtlMs: 10000,
        weight: 1,
      },
    ];
    graph.workloads = [
      {
        id: 'w1',
        entryNodeId: 'n1',
        enabled: true,
        rate: 1,
        timeoutMs: 5000,
        intervalMs: 1000,
        classes: [
          {
            id: 'c1',
            name: 'c1',
            weight: 1,
            operation: 'read',
            tags: [],
            keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 10 },
          },
        ],
      },
    ];

    const sim = new OpenSimulation(graph);
    sim.advance(5.0);
    const snap = sim.snapshot();
    // When hops > 64, explicit message failed before admission
    expect(snap.messages.failed).toBeGreaterThanOrEqual(1);
    expect(snap.messages.generated).toBeGreaterThan(60);
  });

  it('8: root and message conservation at several observation times; chunked and one-shot full snapshots match', () => {
    const graph = makeBaseGraph();
    graph.settings.duration = 10;
    graph.nodes = [
      {
        id: 'src',
        kind: 'traffic',
        name: 'Source',
        position: { x: 0, y: 0 },
        behavior: {
          type: 'source',
          capacity: 100,
          concurrency: 2,
          queueLimit: 10,
          failureRate: 0,
          maxRetries: 0,
          retryDelayMs: 0,
        },
      },
      {
        id: 'dest',
        kind: 'service',
        name: 'Dest',
        position: { x: 100, y: 0 },
        behavior: {
          type: 'processor',
          capacity: 10,
          concurrency: 1,
          queueLimit: 2,
          failureRate: 10,
          maxRetries: 1,
          retryDelayMs: 20,
        },
      },
    ];
    graph.edges = [
      {
        id: 'e1',
        source: 'src',
        target: 'dest',
        transport: 'message',
        latencyMs: 20,
        returnLatencyMs: 20,
        ackDelayMs: 10,
        messageTtlMs: 200,
        weight: 1,
      },
    ];
    graph.workloads = [
      {
        id: 'w1',
        entryNodeId: 'src',
        enabled: true,
        rate: 5,
        timeoutMs: 1000,
        intervalMs: 100,
        classes: [
          {
            id: 'c1',
            name: 'c1',
            weight: 1,
            operation: 'read',
            tags: [],
            keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 10 },
          },
        ],
      },
    ];

    // One-shot simulation
    const sim1 = new OpenSimulation(graph);
    const snapOneShot = sim1.advance(5.0);

    // Chunked simulation
    const sim2 = new OpenSimulation(graph);
    sim2.advance(1.0);
    sim2.advance(2.5);
    const snapChunked = sim2.advance(5.0);

    expect(snapChunked.roots.generated).toBe(snapOneShot.roots.generated);
    expect(snapChunked.roots.succeeded).toBe(snapOneShot.roots.succeeded);
    expect(snapChunked.roots.failed).toBe(snapOneShot.roots.failed);
    expect(snapChunked.roots.expired).toBe(snapOneShot.roots.expired);
    expect(snapChunked.roots.inFlight).toBe(snapOneShot.roots.inFlight);

    expect(snapChunked.messages.generated).toBe(snapOneShot.messages.generated);
    expect(snapChunked.messages.succeeded).toBe(snapOneShot.messages.succeeded);
    expect(snapChunked.messages.failed).toBe(snapOneShot.messages.failed);
    expect(snapChunked.messages.expired).toBe(snapOneShot.messages.expired);
    expect(snapChunked.messages.inFlight).toBe(snapOneShot.messages.inFlight);

    // Conservation check
    expect(snapChunked.roots.generated).toBe(
      snapChunked.roots.succeeded +
      snapChunked.roots.rejected +
      snapChunked.roots.failed +
      snapChunked.roots.expired +
      snapChunked.roots.inFlight
    );

    expect(snapChunked.messages.generated).toBe(
      snapChunked.messages.succeeded +
      snapChunked.messages.rejected +
      snapChunked.messages.failed +
      snapChunked.messages.expired +
      snapChunked.messages.inFlight
    );
  });
});

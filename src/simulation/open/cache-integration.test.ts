import { describe, it, expect } from 'vitest';
import type { ExecutionGraph } from '../../domain/execution';
import { OpenSimulation } from './kernel';
describe('OpenSimulation Cache and Router Integration', () => {
  function makeCacheGraph(mode: 'fixed' | 'lru', hitRate = 80, entries = 10, ttlMs = 5000): ExecutionGraph {
    return {
      executionVersion: 'open-system/1',
      nodes: [
        {
          id: 'src',
          kind: 'traffic',
          name: 'Traffic',
          position: { x: 0, y: 0 },
          behavior: { type: 'source', capacity: 10000, concurrency: 1, queueLimit: 100, failureRate: 0, maxRetries: 0, retryDelayMs: 0 },
        },
        {
          id: 'cache1',
          kind: 'cache',
          name: 'Cache Node',
          position: { x: 50, y: 0 },
          behavior: { type: 'cache', mode, hitRate, entries, ttlMs, capacity: 10000, concurrency: 1, queueLimit: 100, failureRate: 0, maxRetries: 0, retryDelayMs: 0 },
        },
        {
          id: 'origin',
          kind: 'database',
          name: 'Origin DB',
          position: { x: 100, y: 0 },
          behavior: { type: 'storage', writeCapacity: 10000, capacity: 10000, concurrency: 1, queueLimit: 100, failureRate: 0, maxRetries: 0, retryDelayMs: 0 },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'src',
          target: 'cache1',
          transport: 'call',
          latencyMs: 0,
          returnLatencyMs: 0,
          ackDelayMs: 0,
          messageTtlMs: 5000,
          weight: 1,
        },
        {
          id: 'e2',
          source: 'cache1',
          target: 'origin',
          transport: 'call',
          latencyMs: 0,
          returnLatencyMs: 0,
          ackDelayMs: 0,
          messageTtlMs: 5000,
          weight: 1,
        },
      ],
      workloads: [
        {
          id: 'wl1',
          entryNodeId: 'src',
          enabled: true,
          rate: 10,
          intervalMs: 100,
          timeoutMs: 1000,
          classes: [
            {
              id: 'rc1',
              name: 'default',
              weight: 1,
              operation: 'read',
              tags: [],
              keyDistribution: {
                kind: 'uniform',
                catalogSize: 1,
                hotSubset: 1,
                hotShare: 100,
              },
            },
          ],
        },
      ],
      settings: {
        seed: 42,
        duration: 10,
      },
    };
  }

  it('fixed 100 hit avoids origin, fixed 0 miss reaches origin', () => {
    const g100 = makeCacheGraph('fixed', 100);
    const sim100 = new OpenSimulation(g100);
    const m100 = sim100.advance(1);
    expect(m100.nodes.cache1.cache?.hits).toBeGreaterThan(0);
    expect(m100.nodes.cache1.cache?.misses).toBe(0);
    expect(m100.edges.e2.sent).toBe(0);

    const g0 = makeCacheGraph('fixed', 0);
    const sim0 = new OpenSimulation(g0);
    const m0 = sim0.advance(1);
    expect(m0.nodes.cache1.cache?.misses).toBeGreaterThan(0);
    expect(m0.nodes.cache1.cache?.hits).toBe(0);
    expect(m0.edges.e2.sent).toBe(m0.nodes.cache1.cache?.misses);
  });

  it('finite warmup with catalogSize 1 has first arrival miss then subsequent hit', () => {
    const g = makeCacheGraph('lru', 0, 10, 10000);
    const sim = new OpenSimulation(g);
    // First arrival at 0.1s completes by ~0.101s
    sim.advance(0.15);
    expect(sim.snapshot().nodes.cache1.cache?.misses).toBe(1);
    expect(sim.snapshot().nodes.cache1.cache?.hits).toBe(0);
    expect(sim.snapshot().nodes.cache1.cache?.entries).toBe(1);

    // Second arrival at 0.2s should hit
    sim.advance(0.25);
    expect(sim.snapshot().nodes.cache1.cache?.misses).toBe(1);
    expect(sim.snapshot().nodes.cache1.cache?.hits).toBe(1);
  });

  it('expired origin response never fills cache', () => {
    const g = makeCacheGraph('lru', 0, 10, 10000);
    // Origin edge latency exceeds workload timeoutMs (50ms timeout, 100ms latency)
    g.workloads[0].timeoutMs = 50;
    g.edges[1].latencyMs = 100;

    const sim = new OpenSimulation(g);
    sim.advance(0.3);
    const m = sim.snapshot();
    expect(m.nodes.cache1.cache?.entries).toBe(0);
  });

  it('successful write invalidates cached key', () => {
    const g = makeCacheGraph('lru', 0, 10, 10000);
    // Workload with read class and write class
    g.workloads[0].classes = [
      {
        id: 'r',
        name: 'read',
        weight: 1,
        operation: 'read',
        tags: [],
        keyDistribution: { kind: 'uniform', catalogSize: 1, hotSubset: 1, hotShare: 100 },
      },
      {
        id: 'w',
        name: 'write',
        weight: 0.000001,
        operation: 'write',
        tags: [],
        keyDistribution: { kind: 'uniform', catalogSize: 1, hotSubset: 1, hotShare: 100 },
      },
    ];

    class DeterministicOpSimulation extends OpenSimulation {
      private stepCount = 0;
      protected drawRequestClassAndKey(wl: any, _ordinal: number) {
        const opType = this.stepCount === 1 ? 'write' : 'read';
        this.stepCount++;
        const reqClass = wl.classes.find((c: any) => c.operation === opType) || wl.classes[0];
        return { reqClass, key: 'k-0' };
      }
    }

    const sim = new DeterministicOpSimulation(g);
    // Op 0: read -> miss -> fill -> entries = 1
    sim.advance(0.15);
    expect(sim.snapshot().nodes.cache1.cache?.entries).toBe(1);

    // Op 1: write -> write bypasses lookup, dispatches origin -> completeLocalOp invalidates -> entries = 0
    sim.advance(0.25);
    expect(sim.snapshot().nodes.cache1.cache?.writes).toBe(1);
    expect(sim.snapshot().nodes.cache1.cache?.entries).toBe(0);
  });

  it('chunked and one-shot entire snapshots match including cache counters', () => {
    const g1 = makeCacheGraph('lru', 0, 10, 10000);
    const g2 = structuredClone(g1);

    const simOneShot = new OpenSimulation(g1);
    const mOneShot = simOneShot.advance(2.0);

    const simChunked = new OpenSimulation(g2);
    simChunked.advance(0.5);
    simChunked.advance(1.0);
    simChunked.advance(1.5);
    const mChunked = simChunked.advance(2.0);

    expect(mChunked).toEqual(mOneShot);
  });

  it('round-robin routes one branch per request and maintains independent caches', () => {
    const g = makeCacheGraph('fixed', 100);
    const cache2 = structuredClone(g.nodes[1]);
    cache2.id = 'cache2';
    if (cache2.behavior.type === 'cache') cache2.behavior.hitRate = 0;
    g.nodes.push(cache2, {
      id: 'router', kind: 'balancer', name: 'Router', position: { x: 0, y: 0 },
      behavior: { ...g.nodes[0].behavior, type: 'router', strategy: 'round-robin' },
    });
    g.edges[0].target = 'router';
    g.edges.push(
      { ...g.edges[0], id: 'route-a', source: 'router', target: 'cache1' },
      { ...g.edges[0], id: 'route-b', source: 'router', target: 'cache2' },
      { ...g.edges[1], id: 'cache2-origin', source: 'cache2' },
    );
    const m = new OpenSimulation(g).advance(1.05);
    expect(m.roots).toMatchObject({ generated: 10, succeeded: 10, inFlight: 0 });
    expect(m.edges['route-a'].sent).toBe(5);
    expect(m.edges['route-b'].sent).toBe(5);
    expect(m.nodes.cache1.cache).toMatchObject({ hits: 5, misses: 0 });
    expect(m.nodes.cache2.cache).toMatchObject({ hits: 0, misses: 5 });
    expect(m.nodes.origin.arrived).toBe(5);
  });
});

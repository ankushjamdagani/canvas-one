import { describe, it, expect } from 'vitest';
import { RouteSelector, RuntimeCache } from './behaviors';
import type { ExecutionEdge, ExecutionNode, RequestClass } from '../../domain/execution';
import { makeRng } from './kernel';

function makeClass(overrides: Partial<RequestClass> = {}): RequestClass {
  return {
    id: 'rc-1',
    name: 'default',
    weight: 1,
    operation: 'read',
    tags: ['web'],
    keyDistribution: {
      kind: 'uniform',
      catalogSize: 100,
      hotSubset: 10,
      hotShare: 80,
    },
    ...overrides,
  };
}

function makeRouterNode(strategy: 'round-robin' | 'weighted' | 'conditional'): ExecutionNode {
  return {
    id: 'r1',
    kind: 'balancer',
    name: 'Router',
    position: { x: 0, y: 0 },
    behavior: {
      type: 'router',
      strategy,
      capacity: 1000,
      concurrency: 1,
      queueLimit: 10,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    },
  };
}

function makeEdge(id: string, weight = 1, extra: Partial<ExecutionEdge> = {}): ExecutionEdge {
  return {
    id,
    source: 'r1',
    target: `target-${id}`,
    transport: 'call',
    latencyMs: 0,
    returnLatencyMs: 0,
    ackDelayMs: 0,
    messageTtlMs: 1000,
    weight,
    ...extra,
  };
}

describe('RouteSelector', () => {
  it('routes round-robin with exact counts', () => {
    const selector = new RouteSelector();
    const node = makeRouterNode('round-robin');
    const edges = [makeEdge('e1'), makeEdge('e2'), makeEdge('e3')];
    const req = makeClass();
    const draw = () => 0;

    const counts: Record<string, number> = { e1: 0, e2: 0, e3: 0 };
    for (let i = 0; i < 9; i++) {
      const selected = selector.select(node, edges, req, draw);
      counts[selected.id]++;
    }

    expect(counts).toEqual({ e1: 3, e2: 3, e3: 3 });
  });

  it('routes weighted with reproducibility and approximate ratios over >= 1000 draws', () => {
    const selector = new RouteSelector();
    const node = makeRouterNode('weighted');
    const edges = [makeEdge('e1', 10), makeEdge('e2', 30), makeEdge('e3', 60)];
    const req = makeClass();

    const rng1 = makeRng(12345);
    const rng2 = makeRng(12345);

    const runs1: string[] = [];
    for (let i = 0; i < 1000; i++) {
      runs1.push(selector.select(node, edges, req, rng1).id);
    }

    const runs2: string[] = [];
    for (let i = 0; i < 1000; i++) {
      runs2.push(selector.select(node, edges, req, rng2).id);
    }

    expect(runs1).toEqual(runs2);

    const c1 = runs1.filter(id => id === 'e1').length;
    const c2 = runs1.filter(id => id === 'e2').length;
    const c3 = runs1.filter(id => id === 'e3').length;

    expect(c1).toBeGreaterThan(60);
    expect(c1).toBeLessThan(150);
    expect(c2).toBeGreaterThan(240);
    expect(c2).toBeLessThan(360);
    expect(c3).toBeGreaterThan(530);
    expect(c3).toBeLessThan(670);
  });

  it('routes conditional by class name, operation, tag, and fallback', () => {
    const selector = new RouteSelector();
    const node = makeRouterNode('conditional');
    const edges: ExecutionEdge[] = [
      makeEdge('e-class', 1, { condition: { field: 'class', value: 'admin' } }),
      makeEdge('e-op', 1, { condition: { field: 'operation', value: 'write' } }),
      makeEdge('e-tag', 1, { condition: { field: 'tag', value: 'vip' } }),
      makeEdge('e-fallback', 1, { fallback: true }),
    ];
    const draw = () => 0;

    const resClass = selector.select(node, edges, makeClass({ name: 'admin', operation: 'read', tags: [] }), draw);
    expect(resClass.id).toBe('e-class');

    const resOp = selector.select(node, edges, makeClass({ name: 'regular', operation: 'write', tags: [] }), draw);
    expect(resOp.id).toBe('e-op');

    const resTag = selector.select(node, edges, makeClass({ name: 'regular', operation: 'read', tags: ['vip'] }), draw);
    expect(resTag.id).toBe('e-tag');

    const resFallback = selector.select(node, edges, makeClass({ name: 'other', operation: 'read', tags: ['normal'] }), draw);
    expect(resFallback.id).toBe('e-fallback');
  });
});

describe('RuntimeCache', () => {
  it('tracks hit recency vs TTL expiration', () => {
    const cache = new RuntimeCache(10, 5000); // 5 seconds TTL
    cache.put('k1', 0);

    // Access at t = 2s refreshes recency but not TTL
    expect(cache.get('k1', 2)).toBe(true);

    // At t = 4.9s still alive
    expect(cache.get('k1', 4.9)).toBe(true);

    // At t = 5.1s expired despite recent get
    expect(cache.get('k1', 5.1)).toBe(false);

    const snap = cache.snapshot(5.1);
    expect(snap.expirations).toBe(1);
    expect(snap.entries).toBe(0);
  });

  it('enforces bounded capacity with LRU eviction and handles invalidation', () => {
    const cache = new RuntimeCache(2, 60000);
    cache.put('a', 0);
    cache.put('b', 1);

    // Access 'a' to make 'b' the oldest
    expect(cache.get('a', 2)).toBe(true);

    // Adding 'c' should evict 'b'
    cache.put('c', 3);

    expect(cache.get('b', 3.5)).toBe(false);
    expect(cache.get('a', 3.5)).toBe(true);
    expect(cache.get('c', 3.5)).toBe(true);

    let snap = cache.snapshot(4);
    expect(snap.entries).toBe(2);
    expect(snap.evictions).toBe(1);

    // Invalidate 'a'
    cache.invalidate('a', 5);
    expect(cache.get('a', 5.5)).toBe(false);
    snap = cache.snapshot(6);
    expect(snap.entries).toBe(1);
  });

  it('purges expired entries on get, put, and snapshot', () => {
    const cache = new RuntimeCache(5, 2000);
    cache.put('x', 0);
    cache.put('y', 1);

    // Snapshot at t=2.5 should purge 'x' (ttl=2), keep 'y' (ttl=3)
    const snap1 = cache.snapshot(2.5);
    expect(snap1.entries).toBe(1);
    expect(snap1.expirations).toBe(1);

    // Put at t=3.5 should purge 'y'
    cache.put('z', 3.5);
    const snap2 = cache.snapshot(3.5);
    expect(snap2.expirations).toBe(2);
  });
});

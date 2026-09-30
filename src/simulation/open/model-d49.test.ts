import { describe, expect, it } from 'vitest';
import type {
  BehaviorConfig,
  CallRetryPolicy,
  ComponentKind,
  ExecutionEdge,
  ExecutionGraph,
  ExecutionNode,
  WorkloadDefinition,
} from '../../domain/execution';
import { compileExecution } from '../../domain/execution';
import { OpenSimulation, type SimLifecycleFact } from './kernel';

/**
 * D49 model changes (realism audit H1, H11, H13): exponential service time, routers that
 * don't hold a slot while waiting, and caller retries with backoff, jitter and attempt
 * timeouts. Statistical checks use six seeds and a 99% batch-means interval (t(5,.995) =
 * 4.032), as in oracles.test.ts.
 */

const SEEDS = [11, 29, 47, 71, 101, 149] as const;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const batch99 = (xs: readonly number[]) => {
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return 4.032 * Math.sqrt(variance / xs.length);
};

const base = { capacity: 10_000, concurrency: 16, queueLimit: 10_000, failureRate: 0, maxRetries: 0, retryDelayMs: 0 };
const processor = (o: Partial<typeof base> & { serviceTime?: 'fixed' | 'exponential' } = {}): BehaviorConfig => ({ ...base, ...o, type: 'processor' });
const router = (o: Partial<typeof base> = {}): BehaviorConfig => ({ ...base, ...o, type: 'router', strategy: 'round-robin' });
const node = (id: string, kind: ComponentKind, behavior: BehaviorConfig): ExecutionNode => ({ id, kind, name: id, position: { x: 0, y: 0 }, behavior });
const edge = (id: string, source: string, target: string, o: Partial<ExecutionEdge> = {}): ExecutionEdge => ({
  id, source, target, transport: 'call', latencyMs: 0, returnLatencyMs: 0, ackDelayMs: 0, messageTtlMs: 300_000, weight: 1, ...o,
});
const workload = (entryNodeId: string, rate: number, o: Partial<WorkloadDefinition> = {}): WorkloadDefinition => ({
  id: 'wl', entryNodeId, enabled: true, rate, profile: { kind: 'steady' }, timeoutMs: 300_000,
  classes: [{ id: 'c', name: 'c', weight: 1, operation: 'read', tags: [], keyDistribution: { kind: 'uniform', catalogSize: 100, hotSubset: 1, hotShare: 100 } }],
  ...o,
});
const graph = (nodes: ExecutionNode[], edges: ExecutionEdge[], wl: WorkloadDefinition, seed: number, duration: number): ExecutionGraph => ({
  executionVersion: 'open-system/1', nodes, edges, workloads: [wl], settings: { seed, duration },
});
const retry = (o: Partial<CallRetryPolicy> = {}): CallRetryPolicy => ({
  maxAttempts: 3, backoffMs: 0, backoffMultiplier: 2, maxBackoffMs: 10_000, jitter: false, attemptTimeoutMs: null, ...o,
});

describe('D49 exponential service time (H1)', () => {
  it('matches the M/M/1 mean queue wait rho*S/(1-rho) at rho=0.8 (twice the M/D/1 wait)', () => {
    const capacity = 20;
    const S = 1 / capacity;
    const rho = 0.8;
    const waits = SEEDS.map((seed) => {
      const sim = new OpenSimulation(graph([node('svc', 'service', processor({ capacity, concurrency: 1, serviceTime: 'exponential' }))], [], workload('svc', rho * capacity), seed, 300));
      return sim.advance(300).roots.meanLatency / 1000 - S;
    });
    const expected = (rho * S) / (1 - rho); // 0.2 s; M/D/1 gives 0.1 s
    expect(Math.abs(mean(waits) - expected)).toBeLessThanOrEqual(batch99(waits));
  });

  it('keeps the mean service time at 1/capacity', () => {
    const times = SEEDS.map((seed) => {
      const sim = new OpenSimulation(graph([node('svc', 'service', processor({ capacity: 20, concurrency: 16, serviceTime: 'exponential' }))], [], workload('svc', 10), seed, 300));
      return sim.advance(300).roots.meanLatency / 1000; // no queueing with 16 slots at 10/s
    });
    expect(Math.abs(mean(times) - 0.05)).toBeLessThanOrEqual(batch99(times) + 0.001);
  });

  it('is deterministic per seed and chunk-independent', () => {
    const g = graph([node('svc', 'service', processor({ capacity: 20, concurrency: 1, serviceTime: 'exponential' }))], [], workload('svc', 15), 7, 60);
    const oneShot = new OpenSimulation(g).advance(60);
    const chunked = new OpenSimulation(g);
    for (let t = 5; t <= 60; t += 5) chunked.advance(t);
    expect(chunked.snapshot().roots).toEqual(oneShot.roots);
  });
});

describe('D49 routers do not hold a slot while waiting (H11)', () => {
  it('a one-slot gateway passes load far above 1/round-trip', () => {
    const backends = [1, 2, 3, 4].map((i) => node(`b${i}`, 'service', processor({ capacity: 50, concurrency: 1 })));
    const edges = backends.map((b) => edge(`g-${b.id}`, 'gw', b.id, { latencyMs: 5, returnLatencyMs: 5 }));
    // The old slot hold capped this at 1 / (0.5 + 5 + 20 + 5 ms) ~ 33/s.
    const m = new OpenSimulation(graph([node('gw', 'gateway', router({ capacity: 2000, concurrency: 1 })), ...backends], edges, workload('gw', 150), 3, 60)).advance(60);
    expect(m.roots.rejected).toBe(0);
    expect(m.roots.throughput).toBeGreaterThan(140);
    expect(m.nodes.gw.occupancy).toBeLessThan(0.2);
  });
});

describe('D49 caller retries (H13)', () => {
  it('matches geometric amplification: attempts = 1 + p + p^2 and final failures = p^3', () => {
    const p = 0.3;
    const ratios: number[] = [];
    const failures: number[] = [];
    for (const seed of SEEDS) {
      const m = new OpenSimulation(graph(
        [node('api', 'service', processor()), node('dep', 'service', processor({ failureRate: 100 * p }))],
        [edge('api-dep', 'api', 'dep', { retry: retry({ maxAttempts: 3 }) })],
        workload('api', 50), seed, 120,
      )).advance(120);
      ratios.push(m.nodes.dep.attempts / m.roots.generated);
      failures.push(m.roots.failed / m.roots.generated);
    }
    expect(Math.abs(mean(ratios) - (1 + p + p * p))).toBeLessThanOrEqual(batch99(ratios) + 0.01);
    expect(Math.abs(mean(failures) - p ** 3)).toBeLessThanOrEqual(batch99(failures) + 0.005);
  });

  it('waits the exponential backoff between attempts', () => {
    const facts: SimLifecycleFact[] = [];
    const sim = new OpenSimulation(
      graph(
        [node('api', 'service', processor()), node('dep', 'service', processor({ capacity: 1000, failureRate: 100 }))],
        [edge('api-dep', 'api', 'dep', { retry: retry({ maxAttempts: 3, backoffMs: 100, backoffMultiplier: 2 }) })],
        workload('api', 1, { intervalMs: 1000 }), 5, 3,
      ),
      { traceHook: (f) => facts.push(f) },
    );
    sim.advance(3);
    const admitted = new Map(facts.filter((f) => f.kind === 'admitted').map((f) => [f.unitIdentity, f.time]));
    const settled = facts.filter((f) => f.kind === 'unit_settled');
    expect(settled.length).toBeGreaterThan(0);
    for (const f of settled) {
      expect(f.outcome).toBe('failed');
      // api 0.1 ms, then three 1 ms attempts with 100 ms and 200 ms backoffs between them.
      expect((f.time - admitted.get(f.unitIdentity)!) * 1000).toBeCloseTo(0.1 + 1 + 100 + 1 + 200 + 1, 6);
    }
    expect(sim.edgeRetries('api-dep')).toBe(2 * settled.length);
  });

  it('with jitter, each backoff is a seeded draw at or below the nominal delay', () => {
    const facts: SimLifecycleFact[] = [];
    const sim = new OpenSimulation(
      graph(
        [node('api', 'service', processor()), node('dep', 'service', processor({ capacity: 1000, failureRate: 100 }))],
        [edge('api-dep', 'api', 'dep', { retry: retry({ maxAttempts: 2, backoffMs: 100, jitter: true }) })],
        workload('api', 1, { intervalMs: 500 }), 5, 5,
      ),
      { traceHook: (f) => facts.push(f) },
    );
    sim.advance(5);
    const admitted = new Map(facts.filter((f) => f.kind === 'admitted').map((f) => [f.unitIdentity, f.time]));
    const waits = facts.filter((f) => f.kind === 'unit_settled').map((f) => (f.time - admitted.get(f.unitIdentity)!) * 1000 - 2.1);
    expect(waits.length).toBeGreaterThan(5);
    for (const w of waits) expect(w).toBeGreaterThanOrEqual(-1e-9);
    for (const w of waits) expect(w).toBeLessThanOrEqual(100 + 1e-9);
    expect(new Set(waits.map((w) => w.toFixed(6))).size).toBe(waits.length);
  });

  it('an attempt timeout abandons a slow attempt, cancels its work and retries', () => {
    const facts: SimLifecycleFact[] = [];
    const sim = new OpenSimulation(
      graph(
        [node('api', 'service', processor()), node('dep', 'service', processor({ capacity: 5, concurrency: 1 }))],
        [edge('api-dep', 'api', 'dep', { retry: retry({ maxAttempts: 2, attemptTimeoutMs: 50 }) })],
        workload('api', 1, { intervalMs: 1000 }), 5, 4,
      ),
      // Arrivals at 1, 2 and 3 s; the run continues to 4 s so every root settles.
      { traceHook: (f) => facts.push(f), arrivalHorizonSeconds: 3.5 },
    );
    const m = sim.advance(4);
    const admitted = new Map(facts.filter((f) => f.kind === 'admitted').map((f) => [f.unitIdentity, f.time]));
    const settled = facts.filter((f) => f.kind === 'unit_settled');
    expect(settled.length).toBe(m.roots.generated);
    for (const f of settled) {
      expect(f.outcome).toBe('failed');
      expect((f.time - admitted.get(f.unitIdentity)!) * 1000).toBeCloseTo(0.1 + 50 + 50, 6);
    }
    expect(m.nodes.dep.completed).toBe(0);
    expect(m.nodes.dep.cancelled).toBe(2 * m.roots.generated);
  });

  it('retries against an overloaded service add load without adding goodput (retry storm)', () => {
    const runWith = (policy: CallRetryPolicy | null) =>
      new OpenSimulation(graph(
        [node('api', 'service', processor()), node('dep', 'service', processor({ capacity: 10, concurrency: 1, queueLimit: 5 }))],
        [edge('api-dep', 'api', 'dep', { retry: policy })],
        workload('api', 20), 9, 120,
      )).advance(120);
    const plain = runWith(null);
    const storm = runWith(retry({ maxAttempts: 4, backoffMs: 20, jitter: true }));
    expect(storm.nodes.dep.arrived).toBeGreaterThan(1.5 * plain.nodes.dep.arrived);
    expect(storm.roots.succeeded).toBeLessThanOrEqual(plain.roots.succeeded * 1.1);
    expect(storm.roots.meanLatency).toBeGreaterThan(plain.roots.meanLatency);
  });
});

describe('D49 validation', () => {
  const g = (b: Partial<typeof base>, e: Partial<ExecutionEdge> = {}) =>
    graph([node('a', 'service', processor(b)), node('b', 'service', processor())], [edge('a-b', 'a', 'b', e)], workload('a', 1), 1, 10);
  const codes = (x: ExecutionGraph) => compileExecution(x, true).issues.filter((i) => i.severity === 'error').map((i) => i.code);

  it('allows concurrency up to 1024', () => {
    expect(codes(g({ concurrency: 1024 }))).toEqual([]);
    expect(codes(g({ concurrency: 1025 }))).toContain('INVALID_CONCURRENCY');
  });

  it('accepts a call retry policy and rejects it on a message edge or out of range', () => {
    expect(codes(g({}, { retry: retry() }))).toEqual([]);
    expect(codes(g({}, { retry: retry({ maxAttempts: 0 }) }))).toContain('INVALID_EDGE_RETRY');
    expect(codes(g({}, { transport: 'message', retry: retry() }))).toContain('INVALID_EDGE_RETRY');
  });
});

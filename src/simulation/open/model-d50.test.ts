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
import { OpenSimulation } from './kernel';

/**
 * D50 (the D49 limits): heavy-tailed lognormal service time, routers retrying on another
 * route, and broker redelivery. Bridge (boundary) retries run through the studio runner
 * and are tested in reference-architectures.test.ts (A12).
 */

const SEEDS = [11, 29, 47, 71, 101, 149] as const;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const batch99 = (xs: readonly number[]) => {
  const m = mean(xs);
  return 4.032 * Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) / xs.length);
};

const base = { capacity: 10_000, concurrency: 16, queueLimit: 10_000, failureRate: 0, maxRetries: 0, retryDelayMs: 0 };
type Extra = Partial<typeof base> & { serviceTime?: 'fixed' | 'exponential' | 'lognormal'; serviceTimeCv?: number };
const processor = (o: Extra = {}): BehaviorConfig => ({ ...base, ...o, type: 'processor' });
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

describe('D50 lognormal service time', () => {
  // cv 3: sigma^2 = ln 10; p95 = exp(-sigma^2/2 + 1.645 sigma) = 3.83 x mean (exponential: 3.0 x).
  const runLognormal = (seed: number) =>
    new OpenSimulation(graph([node('svc', 'service', processor({ capacity: 20, concurrency: 1024, serviceTime: 'lognormal', serviceTimeCv: 3 }))], [], workload('svc', 50), seed, 300)).advance(300);

  it('keeps the mean at 1/capacity and has the tail of its coefficient of variation (p95 = 3.83 x mean)', () => {
    const runs = SEEDS.map(runLognormal);
    const means = runs.map((m) => m.roots.meanLatency);
    const p95s = runs.map((m) => m.roots.p95Latency);
    expect(Math.abs(mean(means) - 50)).toBeLessThanOrEqual(batch99(means) + 1);
    expect(Math.abs(mean(p95s) - 3.83 * 50)).toBeLessThanOrEqual(0.05 * 3.83 * 50);
  }, 30_000);

  it('requires a coefficient of variation, and only for lognormal', () => {
    const codes = (b: Extra) =>
      compileExecution(graph([node('svc', 'service', processor(b))], [], workload('svc', 1), 1, 10), true).issues.filter((i) => i.severity === 'error').map((i) => i.code);
    expect(codes({ serviceTime: 'lognormal', serviceTimeCv: 2 })).toEqual([]);
    expect(codes({ serviceTime: 'lognormal' })).toContain('INVALID_SERVICE_TIME_CV');
    expect(codes({ serviceTime: 'exponential', serviceTimeCv: 2 })).toContain('INVALID_SERVICE_TIME_CV');
  });
});

describe('D50 a router retries on another route', () => {
  it('a request that fails on a broken backend succeeds on the healthy one', () => {
    const policy = retry({ maxAttempts: 2 });
    const m = new OpenSimulation(graph(
      [
        node('lb', 'balancer', { ...base, type: 'router', strategy: 'round-robin' }),
        node('bad', 'service', processor({ failureRate: 100 })),
        node('good', 'service', processor()),
      ],
      [edge('lb-bad', 'lb', 'bad', { retry: policy }), edge('lb-good', 'lb', 'good', { retry: policy })],
      workload('lb', 50), 3, 60,
    )).advance(60);
    expect(m.roots.failed).toBe(0);
    expect(m.nodes.good.completed).toBe(m.roots.succeeded);
    // Round robin sends about half to the broken backend first.
    expect(Math.abs(m.nodes.bad.arrived / m.roots.generated - 0.5)).toBeLessThan(0.05);
  });

  it('a conditional router retries on the route its conditions chose, under that route\'s policy', () => {
    const cls = (name: string) => ({ id: name, name, weight: 1, operation: 'read' as const, tags: [], keyDistribution: { kind: 'uniform' as const, catalogSize: 10, hotSubset: 1, hotShare: 100 } });
    const m = new OpenSimulation(graph(
      [
        node('lb', 'balancer', { ...base, type: 'router', strategy: 'conditional' }),
        node('a', 'service', processor({ failureRate: 30 })),
        node('b', 'service', processor()),
      ],
      [
        edge('lb-a', 'lb', 'a', { condition: { field: 'class', value: 'A' }, retry: retry({ maxAttempts: 3 }) }),
        edge('lb-b', 'lb', 'b', { fallback: true }), // must not take class-A retries
      ],
      workload('lb', 50, { classes: [cls('A')] }), 3, 60,
    )).advance(60);
    expect(m.nodes.b.arrived).toBe(0);
    expect(Math.abs(m.nodes.a.arrived / m.roots.generated - 1.39)).toBeLessThan(0.1);
    expect(m.roots.failed / m.roots.generated).toBeLessThan(0.06);
  });

  it('with a single route it retries on that route', () => {
    const m = new OpenSimulation(graph(
      [node('lb', 'balancer', { ...base, type: 'router', strategy: 'round-robin' }), node('bad', 'service', processor({ failureRate: 100 }))],
      [edge('lb-bad', 'lb', 'bad', { retry: retry({ maxAttempts: 3 }) })],
      workload('lb', 20), 3, 30,
    )).advance(30);
    expect(m.nodes.bad.arrived).toBe(3 * m.roots.generated);
    expect(m.roots.failed + m.roots.rejected).toBe(m.roots.generated);
  });
});

describe('D50 broker redelivery', () => {
  const queueGraph = (policy: CallRetryPolicy | null, seed: number) =>
    graph(
      [
        node('q', 'queue', { ...base, type: 'broker', delivery: 'competing' }),
        node('wk', 'worker', processor({ failureRate: 50, concurrency: 4 })),
      ],
      [edge('q-wk', 'q', 'wk', { transport: 'message', retry: policy })],
      workload('q', 20), seed, 120,
    );

  it('redelivers a failed message: deliveries = 1 + p + p^2, final failures = p^3', () => {
    const ratios: number[] = [];
    const failures: number[] = [];
    for (const seed of SEEDS) {
      const m = new OpenSimulation(queueGraph(retry({ maxAttempts: 3, backoffMs: 50 }), seed)).advance(120);
      const settled = m.messages.succeeded + m.messages.failed;
      ratios.push(m.nodes.wk.arrived / m.messages.generated);
      failures.push(m.messages.failed / settled);
    }
    expect(Math.abs(mean(ratios) - 1.75)).toBeLessThanOrEqual(batch99(ratios) + 0.02);
    expect(Math.abs(mean(failures) - 0.125)).toBeLessThanOrEqual(batch99(failures) + 0.01);
  });

  it('without a policy, a failed delivery fails the message', () => {
    const m = new OpenSimulation(queueGraph(null, 5)).advance(120);
    expect(m.nodes.wk.arrived).toBe(m.messages.generated - m.messages.inFlight);
    expect(Math.abs(m.messages.failed / (m.messages.succeeded + m.messages.failed) - 0.5)).toBeLessThan(0.05);
  });

  it('rejects an attempt timeout on a broker route', () => {
    const codes = compileExecution(queueGraph(retry({ attemptTimeoutMs: 100 }), 1), true).issues.map((i) => i.code);
    expect(codes).toContain('INVALID_EDGE_RETRY');
  });
});

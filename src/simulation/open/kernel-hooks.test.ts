import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExecutionGraph,
  ExecutionNode,
  ExecutionEdge,
  WorkloadDefinition,
  RequestClass,
  BehaviorConfig,
} from '../../domain/execution';
import { OpenSimulation, type SimLifecycleFact } from './kernel';
import { stableStringify } from './characterization.test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, '__golden__');

function makeNode(
  id: string,
  kind: ExecutionNode['kind'],
  behavior: BehaviorConfig,
): ExecutionNode {
  return {
    id,
    kind,
    name: id,
    position: { x: 0, y: 0 },
    behavior,
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  opts?: Partial<ExecutionEdge>,
): ExecutionEdge {
  return {
    id,
    source,
    target,
    transport: opts?.transport ?? 'call',
    latencyMs: opts?.latencyMs ?? 0,
    returnLatencyMs: opts?.returnLatencyMs ?? 0,
    ackDelayMs: opts?.ackDelayMs ?? 8,
    messageTtlMs: opts?.messageTtlMs ?? 2000,
    weight: opts?.weight ?? 1,
    condition: opts?.condition,
    fallback: opts?.fallback,
  };
}

function makeDefaultClass(overrides?: Partial<RequestClass>): RequestClass {
  return {
    id: overrides?.id ?? 'rc-default',
    name: overrides?.name ?? 'default',
    weight: overrides?.weight ?? 1,
    operation: overrides?.operation ?? 'read',
    tags: overrides?.tags ?? [],
    keyDistribution: overrides?.keyDistribution ?? {
      kind: 'uniform',
      catalogSize: 100,
      hotSubset: 10,
      hotShare: 80,
    },
  };
}

function makeWorkload(
  id: string,
  entryNodeId: string,
  intervalMs: number,
  timeoutMs = 2000,
  classes?: RequestClass[],
): WorkloadDefinition {
  return {
    id,
    entryNodeId,
    enabled: true,
    rate: 1000 / intervalMs,
    intervalMs,
    timeoutMs,
    classes: classes ?? [makeDefaultClass()],
  };
}

function buildProcessorChainGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('p1', 'service', { type: 'processor', capacity: 20, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('p2', 'service', { type: 'processor', capacity: 10, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-p1', 'src', 'p1', { latencyMs: 5, returnLatencyMs: 2 }),
      makeEdge('e-p1-p2', 'p1', 'p2', { latencyMs: 10, returnLatencyMs: 5 }),
    ],
    workloads: [
      makeWorkload('wl-chain', 'src', 200, 2000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildStorageWriteGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('proc', 'service', { type: 'processor', capacity: 50, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('store', 'database', { type: 'storage', capacity: 50, writeCapacity: 20, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-proc', 'src', 'proc', { latencyMs: 5, returnLatencyMs: 2 }),
      makeEdge('e-proc-store', 'proc', 'store', { latencyMs: 5, returnLatencyMs: 2 }),
    ],
    workloads: [
      makeWorkload('wl-write', 'src', 200, 2000, [
        makeDefaultClass({ id: 'rc-write', name: 'writer', operation: 'write' }),
      ]),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildRouterRoundRobinGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('rtr', 'balancer', { type: 'router', strategy: 'round-robin', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w1', 'worker', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w2', 'worker', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w3', 'worker', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-rtr', 'src', 'rtr'),
      makeEdge('e-rtr-w1', 'rtr', 'w1'),
      makeEdge('e-rtr-w2', 'rtr', 'w2'),
      makeEdge('e-rtr-w3', 'rtr', 'w3'),
    ],
    workloads: [
      makeWorkload('wl-rr', 'src', 100, 2000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildRouterWeightedGraph(seed: number): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('rtr', 'balancer', { type: 'router', strategy: 'weighted', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w1', 'worker', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w2', 'worker', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w3', 'worker', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-rtr', 'src', 'rtr'),
      makeEdge('e-rtr-w1', 'rtr', 'w1', { weight: 10 }),
      makeEdge('e-rtr-w2', 'rtr', 'w2', { weight: 30 }),
      makeEdge('e-rtr-w3', 'rtr', 'w3', { weight: 60 }),
    ],
    workloads: [
      makeWorkload('wl-weighted', 'src', 100, 2000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildRouterConditionalGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('rtr', 'balancer', { type: 'router', strategy: 'conditional', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w-admin', 'service', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w-write', 'service', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w-vip', 'service', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w-fallback', 'service', { type: 'processor', capacity: 100, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-rtr', 'src', 'rtr'),
      makeEdge('e-rtr-admin', 'rtr', 'w-admin', { condition: { field: 'class', value: 'admin' } }),
      makeEdge('e-rtr-write', 'rtr', 'w-write', { condition: { field: 'operation', value: 'write' } }),
      makeEdge('e-rtr-vip', 'rtr', 'w-vip', { condition: { field: 'tag', value: 'vip' } }),
      makeEdge('e-rtr-fallback', 'rtr', 'w-fallback', { fallback: true }),
    ],
    workloads: [
      makeWorkload('wl-conditional', 'src', 100, 2000, [
        makeDefaultClass({ id: 'rc-admin', name: 'admin', weight: 1, operation: 'read', tags: [] }),
        makeDefaultClass({ id: 'rc-write', name: 'writer', weight: 1, operation: 'write', tags: [] }),
        makeDefaultClass({ id: 'rc-vip', name: 'user', weight: 1, operation: 'read', tags: ['vip'] }),
        makeDefaultClass({ id: 'rc-other', name: 'guest', weight: 1, operation: 'read', tags: ['other'] }),
      ]),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildCacheFixedGraph(seed: number): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('cache', 'cache', { type: 'cache', mode: 'fixed', hitRate: 60, entries: 100, ttlMs: 10000, capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('origin', 'database', { type: 'storage', capacity: 500, writeCapacity: 500, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-cache', 'src', 'cache'),
      makeEdge('e-cache-origin', 'cache', 'origin'),
    ],
    workloads: [
      makeWorkload('wl-cache-fixed', 'src', 100, 2000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildCacheLruGraph(seed: number): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('cache', 'cache', { type: 'cache', mode: 'lru', hitRate: 0, entries: 2, ttlMs: 250, capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('origin', 'database', { type: 'storage', capacity: 500, writeCapacity: 500, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-cache', 'src', 'cache'),
      makeEdge('e-cache-origin', 'cache', 'origin'),
    ],
    workloads: [
      makeWorkload('wl-cache-lru', 'src', 100, 2000, [
        makeDefaultClass({
          id: 'rc-lru',
          name: 'default',
          keyDistribution: {
            kind: 'hot',
            catalogSize: 5,
            hotSubset: 2,
            hotShare: 70,
          },
        }),
      ]),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildBrokerCompetingGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('broker', 'queue', { type: 'broker', delivery: 'competing', capacity: 1000, concurrency: 1, queueLimit: 20, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w1', 'worker', { type: 'processor', capacity: 20, concurrency: 1, queueLimit: 0, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('w2', 'worker', { type: 'processor', capacity: 20, concurrency: 1, queueLimit: 0, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-broker', 'src', 'broker', { transport: 'message', ackDelayMs: 8, messageTtlMs: 2000 }),
      makeEdge('e-broker-w1', 'broker', 'w1', { transport: 'message', ackDelayMs: 8, messageTtlMs: 2000 }),
      makeEdge('e-broker-w2', 'broker', 'w2', { transport: 'message', ackDelayMs: 8, messageTtlMs: 2000 }),
    ],
    workloads: [
      makeWorkload('wl-broker-competing', 'src', 100, 2000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildBrokerBroadcastGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('broker', 'pubsub', { type: 'broker', delivery: 'broadcast', capacity: 1000, concurrency: 1, queueLimit: 20, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('sub1', 'worker', { type: 'processor', capacity: 20, concurrency: 1, queueLimit: 0, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('sub2', 'worker', { type: 'processor', capacity: 20, concurrency: 1, queueLimit: 0, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-broker', 'src', 'broker', { transport: 'message', ackDelayMs: 8, messageTtlMs: 2000 }),
      makeEdge('e-broker-sub1', 'broker', 'sub1', { transport: 'message', ackDelayMs: 8, messageTtlMs: 2000 }),
      makeEdge('e-broker-sub2', 'broker', 'sub2', { transport: 'message', ackDelayMs: 8, messageTtlMs: 2000 }),
    ],
    workloads: [
      makeWorkload('wl-broker-broadcast', 'src', 100, 2000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildFailureRetriesGraph(seed: number): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('svc', 'service', { type: 'processor', capacity: 50, concurrency: 2, queueLimit: 20, failureRate: 40, maxRetries: 2, retryDelayMs: 50 }),
    ],
    edges: [
      makeEdge('e-src-svc', 'src', 'svc'),
    ],
    workloads: [
      makeWorkload('wl-failure', 'src', 100, 2000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildDeadlineTimeoutQueuedGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('svc', 'service', { type: 'processor', capacity: 2, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-svc', 'src', 'svc'),
    ],
    workloads: [
      makeWorkload('wl-timeout', 'src', 50, 250),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildQueueLimitRejectionGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('svc', 'service', { type: 'processor', capacity: 2, concurrency: 1, queueLimit: 2, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-svc', 'src', 'svc'),
    ],
    workloads: [
      makeWorkload('wl-reject', 'src', 50, 5000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildConcurrencyFanoutGraph(seed = 42): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('fork', 'service', { type: 'processor', capacity: 100, concurrency: 4, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('b-fast', 'service', { type: 'processor', capacity: 100, concurrency: 4, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('b-slow', 'service', { type: 'processor', capacity: 20, concurrency: 4, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src-fork', 'src', 'fork'),
      makeEdge('e-fork-fast', 'fork', 'b-fast', { latencyMs: 5, returnLatencyMs: 5 }),
      makeEdge('e-fork-slow', 'fork', 'b-slow', { latencyMs: 10, returnLatencyMs: 10 }),
    ],
    workloads: [
      makeWorkload('wl-fanout', 'src', 100, 2000),
    ],
    settings: { seed, duration: 2 },
  };
}

function buildMultiWorkloadInactiveGraph(seed: number): ExecutionGraph {
  return {
    executionVersion: 'open-system/1',
    nodes: [
      makeNode('src1', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('src2', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('svc', 'service', { type: 'processor', capacity: 100, concurrency: 2, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      makeNode('dormant', 'service', { type: 'processor', capacity: 50, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
    ],
    edges: [
      makeEdge('e-src1-svc', 'src1', 'svc'),
      makeEdge('e-src2-svc', 'src2', 'svc'),
      makeEdge('e-dormant-svc', 'dormant', 'svc'),
    ],
    workloads: [
      makeWorkload('wl-web', 'src1', 150, 2000, [
        makeDefaultClass({ id: 'rc-web-std', name: 'std', weight: 70, operation: 'read', tags: ['web'] }),
        makeDefaultClass({ id: 'rc-web-prio', name: 'prio', weight: 30, operation: 'write', tags: ['prio'] }),
      ]),
      makeWorkload('wl-api', 'src2', 300, 2000, [
        makeDefaultClass({ id: 'rc-api', name: 'api', weight: 1, operation: 'read', tags: ['api'] }),
      ]),
    ],
    settings: { seed, duration: 2 },
  };
}

function verifyHookAndStepping(caseId: string, graph: ExecutionGraph, duration = 2): void {
  const goldenPath = path.join(GOLDEN_DIR, `${caseId}.json`);
  const goldenRaw = fs.readFileSync(goldenPath, 'utf-8');

  // 1. With trace hook attached: metrics must be bit-for-bit identical to golden (observational only)
  const facts: SimLifecycleFact[] = [];
  const hookSim = new OpenSimulation(graph, {
    traceHook: (fact) => {
      facts.push(fact);
    },
  });
  const hookMetrics = hookSim.advance(duration);
  expect(stableStringify(hookMetrics)).toBe(goldenRaw);
  expect(facts.length).toBeGreaterThan(0);

  // 2. Stepping one event at a time: must produce identical metrics to advance
  const stepSim = new OpenSimulation(graph);
  while (stepSim.peekNextEvent() && stepSim.peekNextEvent()!.time <= duration) {
    stepSim.stepEvent();
  }
  const stepMetrics = stepSim.advance(duration);
  expect(stableStringify(stepMetrics)).toBe(goldenRaw);
}

describe('Kernel Hooks and Stepping Invariant Suite', () => {
  it('01-processor-chain: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('01-processor-chain', buildProcessorChainGraph(42));
  });

  it('02-source-processor-storage-write: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('02-source-processor-storage-write', buildStorageWriteGraph(42));
  });

  it('03-router-round-robin: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('03-router-round-robin', buildRouterRoundRobinGraph(42));
  });

  it('04-router-weighted (seed 42): hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('04-router-weighted-seed42', buildRouterWeightedGraph(42));
  });

  it('04-router-weighted (seed 99): hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('04-router-weighted-seed99', buildRouterWeightedGraph(99));
  });

  it('05-router-conditional-fallback: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('05-router-conditional-fallback', buildRouterConditionalGraph(42));
  });

  it('06-cache-fixed (seed 42): hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('06-cache-fixed-seed42', buildCacheFixedGraph(42));
  });

  it('06-cache-fixed (seed 99): hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('06-cache-fixed-seed99', buildCacheFixedGraph(99));
  });

  it('07-cache-lru (seed 42): hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('07-cache-lru-seed42', buildCacheLruGraph(42));
  });

  it('07-cache-lru (seed 99): hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('07-cache-lru-seed99', buildCacheLruGraph(99));
  });

  it('08-broker-competing: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('08-broker-competing', buildBrokerCompetingGraph(42));
  });

  it('09-broker-broadcast: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('09-broker-broadcast', buildBrokerBroadcastGraph(42));
  });

  it('10-failure-retries (seed 42): hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('10-failure-retries-seed42', buildFailureRetriesGraph(42));
  });

  it('10-failure-retries (seed 99): hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('10-failure-retries-seed99', buildFailureRetriesGraph(99));
  });

  it('11-deadline-timeout-queued: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('11-deadline-timeout-queued', buildDeadlineTimeoutQueuedGraph(42));
  });

  it('12-queuelimit-rejection: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('12-queuelimit-rejection', buildQueueLimitRejectionGraph(42));
  });

  it('13-concurrency-fanout: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('13-concurrency-fanout', buildConcurrencyFanoutGraph(42));
  });

  it('14-multi-workload-inactive-seed42: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('14-multi-workload-inactive-seed42', buildMultiWorkloadInactiveGraph(42));
  });

  it('14-multi-workload-inactive-seed99: hook produces identical golden and stepping matches advance', () => {
    verifyHookAndStepping('14-multi-workload-inactive-seed99', buildMultiWorkloadInactiveGraph(99));
  });

  it('finite horizon with hook and stepping: preserves in-flight work and matches advance', () => {
    const graph: ExecutionGraph = {
      executionVersion: 'open-system/1',
      nodes: [
        makeNode('src', 'traffic', { type: 'source', capacity: 1000, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
        makeNode('slow-svc', 'service', { type: 'processor', capacity: 1, concurrency: 1, queueLimit: 10, failureRate: 0, maxRetries: 0, retryDelayMs: 0 }),
      ],
      edges: [
        makeEdge('e1', 'src', 'slow-svc'),
      ],
      workloads: [
        makeWorkload('wl1', 'src', 500, 5000),
      ],
      settings: { seed: 42, duration: 1 },
    };

    const oneShotSim = new OpenSimulation(graph);
    const oneShotMetrics = oneShotSim.advance(1);

    const facts: SimLifecycleFact[] = [];
    const hookSim = new OpenSimulation(graph, {
      traceHook: (f) => facts.push(f),
    });
    const hookMetrics = hookSim.advance(1);
    expect(hookMetrics).toEqual(oneShotMetrics);
    expect(facts.length).toBeGreaterThan(0);

    const stepSim = new OpenSimulation(graph);
    while (stepSim.peekNextEvent() && stepSim.peekNextEvent()!.time <= 1) {
      stepSim.stepEvent();
    }
    const stepMetrics = stepSim.advance(1);
    expect(stepMetrics).toEqual(oneShotMetrics);
  });
});

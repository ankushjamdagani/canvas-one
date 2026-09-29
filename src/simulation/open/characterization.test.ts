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
import { OpenSimulation, type OpenMetrics } from './kernel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, '__golden__');

function sortKeysRecursively(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(sortKeysRecursively);
  }
  if (val !== null && typeof val === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(val as Record<string, unknown>).sort();
    for (const key of keys) {
      const v = (val as Record<string, unknown>)[key];
      if (v !== undefined) {
        sorted[key] = sortKeysRecursively(v);
      }
    }
    return sorted;
  }
  return val;
}

export function stableStringify(val: unknown): string {
  return JSON.stringify(sortKeysRecursively(val), null, 2) + '\n';
}

function verifyAndCompare(caseId: string, graph: ExecutionGraph, duration: number, chunkDeltas: number[]): void {
  // 1. One-shot advance
  const oneShotSim = new OpenSimulation(graph);
  const oneShotMetrics = oneShotSim.advance(duration);

  // 2. Chunked advance (several unequal chunks summing to duration)
  const chunkedSim = new OpenSimulation(graph);
  let chunkTime = 0;
  let chunkedMetrics: OpenMetrics | undefined;
  for (const delta of chunkDeltas) {
    chunkTime += delta;
    chunkedMetrics = chunkedSim.advance(chunkTime);
  }

  // Assert chunked and one-shot results are identical
  expect(chunkedMetrics).toEqual(oneShotMetrics);

  const goldenPath = path.join(GOLDEN_DIR, `${caseId}.json`);

  if (process.env.UPDATE_GOLDEN === '1' || process.env.UPDATE_GOLDEN === 'true') {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(goldenPath, stableStringify(oneShotMetrics), 'utf-8');
    return;
  }

  if (!fs.existsSync(goldenPath)) {
    throw new Error(`Golden file not found at ${goldenPath}. Regenerate with UPDATE_GOLDEN=1 npx vitest run src/simulation/open/characterization.test.ts`);
  }

  const goldenRaw = fs.readFileSync(goldenPath, 'utf-8');
  const expectedMetrics = JSON.parse(goldenRaw) as OpenMetrics;

  expect(oneShotMetrics).toEqual(expectedMetrics);
  expect(stableStringify(oneShotMetrics)).toBe(goldenRaw);
}

// ---------------------------------------------------------------------------
// Helpers to build deterministic nodes, edges, workloads
// ---------------------------------------------------------------------------

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

// Standard unequal chunk deltas summing to 2.0s
const CHUNKS_2S = [0.35, 0.55, 0.40, 0.70]; // 0.35 -> 0.90 -> 1.30 -> 2.00

// ---------------------------------------------------------------------------
// Graph 1: Processor chain
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 2: Source -> Processor -> Storage (write capacity)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 3: Router round-robin
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 4: Router weighted (seeded)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 5: Router conditional with fallback
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 6: Cache fixed (seeded)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 7: Cache LRU (hits, misses, ttl, evictions) (seeded)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 8: Broker competing (message transport)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 9: Broker broadcast (message transport)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 10: Failure rate with retries and retryDelay (seeded)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 11: Deadlines/timeouts expiring queued work
// ---------------------------------------------------------------------------
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
      // 50ms interval, 250ms timeout. Since svc capacity is 2 (500ms per request),
      // queued work will exceed its deadline while queued and expire without running.
      makeWorkload('wl-timeout', 'src', 50, 250),
    ],
    settings: { seed, duration: 2 },
  };
}

// ---------------------------------------------------------------------------
// Graph 12: QueueLimit rejections
// ---------------------------------------------------------------------------
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
      // 50ms interval, capacity 2 (500ms service time), queueLimit only 2.
      // Rapid arrivals will exceed queue limit and suffer admission rejections.
      makeWorkload('wl-reject', 'src', 50, 5000),
    ],
    settings: { seed, duration: 2 },
  };
}

// ---------------------------------------------------------------------------
// Graph 13: Concurrency > 1 and Parallel fan-out (max not sum)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Graph 14: Multiple workloads/request classes & Inactive node (seeded)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('Retained-Kernel Characterization Suite', () => {
  it('01-processor-chain: multi-hop call chain with forward/return edge latencies', () => {
    verifyAndCompare('01-processor-chain', buildProcessorChainGraph(42), 2, CHUNKS_2S);
  });

  it('02-source-processor-storage-write: write capacity service times on storage node', () => {
    verifyAndCompare('02-source-processor-storage-write', buildStorageWriteGraph(42), 2, CHUNKS_2S);
  });

  it('03-router-round-robin: round-robin route selector across worker pool', () => {
    verifyAndCompare('03-router-round-robin', buildRouterRoundRobinGraph(42), 2, CHUNKS_2S);
  });

  it('04-router-weighted (seed 42): weighted routing with seeded RNG draws', () => {
    verifyAndCompare('04-router-weighted-seed42', buildRouterWeightedGraph(42), 2, CHUNKS_2S);
  });

  it('04-router-weighted (seed 99): weighted routing with seeded RNG draws', () => {
    verifyAndCompare('04-router-weighted-seed99', buildRouterWeightedGraph(99), 2, CHUNKS_2S);
  });

  it('05-router-conditional-fallback: conditional routing matching class, operation, tag, and fallback', () => {
    verifyAndCompare('05-router-conditional-fallback', buildRouterConditionalGraph(42), 2, CHUNKS_2S);
  });

  it('06-cache-fixed (seed 42): fixed cache hit rate with probabilistic draws and origin hits/misses', () => {
    verifyAndCompare('06-cache-fixed-seed42', buildCacheFixedGraph(42), 2, CHUNKS_2S);
  });

  it('06-cache-fixed (seed 99): fixed cache hit rate with probabilistic draws and origin hits/misses', () => {
    verifyAndCompare('06-cache-fixed-seed99', buildCacheFixedGraph(99), 2, CHUNKS_2S);
  });

  it('07-cache-lru (seed 42): LRU cache with finite capacity, TTL, evictions, expirations, hits, and misses', () => {
    verifyAndCompare('07-cache-lru-seed42', buildCacheLruGraph(42), 2, CHUNKS_2S);
  });

  it('07-cache-lru (seed 99): LRU cache with finite capacity, TTL, evictions, expirations, hits, and misses', () => {
    verifyAndCompare('07-cache-lru-seed99', buildCacheLruGraph(99), 2, CHUNKS_2S);
  });

  it('08-broker-competing: broker with competing consumers and message roots', () => {
    verifyAndCompare('08-broker-competing', buildBrokerCompetingGraph(42), 2, CHUNKS_2S);
  });

  it('09-broker-broadcast: broker with broadcast delivery and message root fan-out', () => {
    verifyAndCompare('09-broker-broadcast', buildBrokerBroadcastGraph(42), 2, CHUNKS_2S);
  });

  it('10-failure-retries (seed 42): failureRate with retries and retryDelay', () => {
    verifyAndCompare('10-failure-retries-seed42', buildFailureRetriesGraph(42), 2, CHUNKS_2S);
  });

  it('10-failure-retries (seed 99): failureRate with retries and retryDelay', () => {
    verifyAndCompare('10-failure-retries-seed99', buildFailureRetriesGraph(99), 2, CHUNKS_2S);
  });

  it('11-deadline-timeout-queued: deadlines/timeouts expiring queued work before processing', () => {
    verifyAndCompare('11-deadline-timeout-queued', buildDeadlineTimeoutQueuedGraph(42), 2, CHUNKS_2S);
  });

  it('12-queuelimit-rejection: queue limit overflow causing admission rejection', () => {
    verifyAndCompare('12-queuelimit-rejection', buildQueueLimitRejectionGraph(42), 2, CHUNKS_2S);
  });

  it('13-concurrency-fanout: concurrency > 1 and parallel fan-out latency (max not sum)', () => {
    verifyAndCompare('13-concurrency-fanout', buildConcurrencyFanoutGraph(42), 2, CHUNKS_2S);
  });

  it('14-multi-workload-inactive-node (seed 42): multiple workloads, classes, and an inactive node', () => {
    verifyAndCompare('14-multi-workload-inactive-seed42', buildMultiWorkloadInactiveGraph(42), 2, CHUNKS_2S);
  });

  it('14-multi-workload-inactive-node (seed 99): multiple workloads, classes, and an inactive node', () => {
    verifyAndCompare('14-multi-workload-inactive-seed99', buildMultiWorkloadInactiveGraph(99), 2, CHUNKS_2S);
  });

  // Finite horizon invariant test
  it('finite horizon: advance stops at configured duration and can leave in-flight work (finished !== all drained)', () => {
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
        makeWorkload('wl1', 'src', 500, 5000), // arrival at 500ms; service takes 1000ms (ends at 1500ms)
      ],
      settings: { seed: 42, duration: 1 },
    };

    const sim = new OpenSimulation(graph);
    const snap = sim.advance(1);

    expect(snap.time).toBe(1);
    expect(snap.finished).toBe(true);
    expect(snap.roots.inFlight).toBeGreaterThan(0);
    expect(snap.roots.succeeded).toBe(0);
    expect(snap.nodes['slow-svc'].processing).toBe(1);
  });
});

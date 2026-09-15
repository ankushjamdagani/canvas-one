import type { BehaviorConfig, ComponentKind, ExecutionEdge, WorkloadDefinition } from './execution';

export function defaultBehavior(kind: ComponentKind): BehaviorConfig {
  const base = {
    capacity: 2000,
    concurrency: 1,
    queueLimit: 500,
    failureRate: 0,
    maxRetries: 0,
    retryDelayMs: 100,
  };

  if (kind === 'traffic' || kind === 'scheduler') {
    return { ...base, type: 'source' };
  }
  if (kind === 'gateway' || kind === 'balancer' || kind === 'firewall') {
    return { ...base, type: 'router', strategy: 'round-robin' };
  }
  if (kind === 'database' || kind === 'nosql' || kind === 'objectstore' || kind === 'search' || kind === 'warehouse') {
    const cap = kind === 'database' ? 500 : 2000;
    return { ...base, capacity: cap, type: 'storage', writeCapacity: cap };
  }
  if (kind === 'cache' || kind === 'cdn' || kind === 'dns') {
    return { ...base, capacity: 5000, type: 'cache', mode: 'fixed', hitRate: 80, entries: 100, ttlMs: 10000 };
  }
  if (kind === 'queue' || kind === 'stream') {
    return { ...base, type: 'broker', delivery: 'competing' };
  }
  if (kind === 'pubsub') {
    return { ...base, type: 'broker', delivery: 'broadcast' };
  }
  if (kind === 'worker') {
    return { ...base, capacity: 100, concurrency: 2, queueLimit: 0, maxRetries: 2, type: 'processor' };
  }
  return { ...base, type: 'processor' };
}

export function defaultWorkload(entryNodeId: string): WorkloadDefinition {
  return {
    id: crypto.randomUUID(),
    entryNodeId,
    enabled: true,
    rate: 100,
    profile: { kind: 'steady' },
    timeoutMs: 2000,
    classes: [
      {
        id: crypto.randomUUID(),
        name: 'default',
        weight: 1,
        operation: 'read',
        tags: [],
        keyDistribution: {
          kind: 'uniform',
          catalogSize: 1000,
          hotSubset: 10,
          hotShare: 80,
        },
      },
    ],
  };
}

export function defaultExecutionEdge(
  source: string,
  target: string,
  targetBehavior?: BehaviorConfig,
): ExecutionEdge {
  const isBroker = targetBehavior?.type === 'broker';
  return {
    id: crypto.randomUUID(),
    source,
    target,
    transport: isBroker ? 'message' : 'call',
    latencyMs: 0,
    returnLatencyMs: 0,
    ackDelayMs: 8,
    messageTtlMs: 2000,
    weight: 1,
  };
}

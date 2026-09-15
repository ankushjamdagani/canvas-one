import type { ExecutionEdge, ExecutionNode, RequestClass } from '../../domain/execution';

export class RouteSelector {
  private roundRobinCounters = new Map<string, number>();

  select(
    node: ExecutionNode,
    outgoing: ExecutionEdge[],
    requestClass: RequestClass,
    draw: () => number
  ): ExecutionEdge {
    if (outgoing.length === 0) {
      throw new Error(`Router node ${node.id} has no outgoing edges`);
    }

    if (node.behavior.type !== 'router') {
      return outgoing[0];
    }

    const strategy = node.behavior.strategy;

    if (strategy === 'round-robin') {
      const current = this.roundRobinCounters.get(node.id) ?? 0;
      const selected = outgoing[current % outgoing.length];
      this.roundRobinCounters.set(node.id, current + 1);
      return selected;
    }

    if (strategy === 'weighted') {
      let maxWeight = 0;
      for (const edge of outgoing) {
        if (edge.weight > maxWeight) {
          maxWeight = edge.weight;
        }
      }
      const safeMax = maxWeight > 0 ? maxWeight : 1;
      let totalNormalizedWeight = 0;
      for (const edge of outgoing) {
        totalNormalizedWeight += edge.weight / safeMax;
      }

      let roll = draw() * totalNormalizedWeight;
      for (const edge of outgoing) {
        const w = edge.weight / safeMax;
        if (roll <= w) {
          return edge;
        }
        roll -= w;
      }
      return outgoing[outgoing.length - 1];
    }

    if (strategy === 'conditional') {
      let fallbackEdge: ExecutionEdge | undefined;

      for (const edge of outgoing) {
        if (edge.fallback) {
          fallbackEdge = edge;
          continue;
        }

        const condition = edge.condition;
        if (!condition) continue;

        let matched = false;
        if (condition.field === 'class') {
          matched = requestClass.name === condition.value;
        } else if (condition.field === 'operation') {
          matched = requestClass.operation === condition.value;
        } else if (condition.field === 'tag') {
          matched = requestClass.tags.includes(condition.value);
        }

        if (matched) {
          return edge;
        }
      }

      if (fallbackEdge) {
        return fallbackEdge;
      }

      throw new Error(`Conditional router ${node.id} found no matching route and no fallback`);
    }

    return outgoing[0];
  }
}

export interface CacheSnapshot {
  entries: number;
  evictions: number;
  expirations: number;
}

export class RuntimeCache {
  private capacity: number;
  private ttlSeconds: number;
  private map = new Map<string, number>();
  private expiry = new Map<string, number>();
  private evictionsCount = 0;
  private expirationsCount = 0;

  constructor(entries: number, ttlMs: number) {
    this.capacity = entries;
    this.ttlSeconds = ttlMs / 1000;
  }

  private purgeExpired(nowSeconds: number): void {
    for (const [key, expiry] of this.expiry) {
      if (expiry > nowSeconds) break;
      this.expiry.delete(key);
      this.map.delete(key);
      this.expirationsCount++;
    }
  }

  get(key: string, nowSeconds: number): boolean {
    this.purgeExpired(nowSeconds);
    if (!this.map.has(key)) {
      return false;
    }
    const expiry = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, expiry);
    return true;
  }

  put(key: string, nowSeconds: number): void {
    this.purgeExpired(nowSeconds);
    const newExpiry = nowSeconds + this.ttlSeconds;
    this.expiry.delete(key);
    this.expiry.set(key, newExpiry);

    if (this.map.has(key)) {
      this.map.delete(key);
      this.map.set(key, newExpiry);
      return;
    }

    if (this.map.size >= this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
        this.expiry.delete(oldestKey);
        this.evictionsCount++;
      }
    }

    this.map.set(key, newExpiry);
  }

  invalidate(key: string, nowSeconds: number): void {
    this.purgeExpired(nowSeconds);
    this.map.delete(key);
    this.expiry.delete(key);
  }

  snapshot(nowSeconds: number): CacheSnapshot {
    this.purgeExpired(nowSeconds);
    return {
      entries: this.map.size,
      evictions: this.evictionsCount,
      expirations: this.expirationsCount,
    };
  }
}

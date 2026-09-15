import type { OpenMetrics } from "../simulation/open/kernel";

export interface NodeMetrics {
  arrived: number;
  completed: number;
  rejected: number;
  queued: number;
  busy: boolean;
  /** Omitted by historical model v2; sampled number of occupied processors. */
  activeWorkers?: number;
  utilization: number;
}
export interface Sample {
  time: number;
  queue: number;
  completed: number;
  generated: number;
  arrivalRate: number;
  latency: number;
}
export interface JobMetrics {
  accepted: number;
  acknowledged: number;
  failed: number;
  attempts: number;
  retries: number;
  retrying: number;
  retryRejected: number;
}
export interface Metrics {
  /** Actual edge traversals; routing includes rejected destination arrivals. */
  edges?: Record<string, number>;
  /** Detailed open-system execution metrics when running under open runtime. */
  execution?: OpenMetrics;
  jobs?: JobMetrics;
  time: number;
  generated: number;
  arrivalRate: number;
  succeeded: number;
  dropped: number;
  timedOut: number;
  inFlight: number;
  throughput: number;
  meanLatency: number;
  p95Latency: number;
  cacheHits: number;
  cacheMisses: number;
  cacheEvictions: number;
  cacheExpirations: number;
  cacheEntries: number;
  databaseLookups: number;
  nodes: Record<string, NodeMetrics>;
  history: Sample[];
  finished: boolean;
}

export const failureCount = (m: Metrics) =>
  m.dropped + m.timedOut + (m.execution?.roots.failed ?? m.jobs?.failed ?? 0);

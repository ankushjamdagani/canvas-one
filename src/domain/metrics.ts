export interface NodeMetrics {
  arrived: number;
  completed: number;
  rejected: number;
  queued: number;
  busy: boolean;
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
export interface Metrics {
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
  databaseLookups: number;
  nodes: Record<string, NodeMetrics>;
  history: Sample[];
  finished: boolean;
}

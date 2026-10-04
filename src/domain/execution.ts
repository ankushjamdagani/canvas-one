import type { BulkArrival } from './bulk-arrivals';
import type { TrafficProfile } from './workload';

export type ComponentKind =
  "traffic" | "client" | "mobile" | "device" | "dns" | "cdn" | "firewall" | "gateway" |
  "balancer" | "service" | "function" | "container" | "worker" | "scheduler" | "database" |
  "nosql" | "cache" | "objectstore" | "search" | "warehouse" | "queue" | "stream" |
  "pubsub" | "email" | "monitoring" | "analytics" | "secrets" | "thirdparty" | "custom";

export interface ResourceConfig {
  capacity: number;
  concurrency: number;
  queueLimit: number;
  failureRate: number;
  maxRetries: number;
  retryDelayMs: number;
  /**
   * D49 (audit H1): how long one attempt takes. 'fixed' is exactly 1/capacity per slot
   * (M/D/c); 'exponential' draws a seeded exponential time with that mean (M/M/c).
   * Absent means 'fixed', the behaviour of graphs built before D49. 'lognormal' (D50)
   * has a heavy tail: mean 1/capacity and coefficient of variation `serviceTimeCv`.
   */
  serviceTime?: 'fixed' | 'exponential' | 'lognormal';
  /** D50: coefficient of variation (stdev / mean) for 'lognormal', 0.1..10; required for it. */
  serviceTimeCv?: number;
}

/**
 * D49 (audit H13): the caller retries a call that is rejected, fails or times out.
 * Attempt n waits min(maxBackoffMs, backoffMs * multiplier^(n-1)) before retrying, scaled
 * by a seeded uniform draw when `jitter` is on ("full jitter"). `attemptTimeoutMs` bounds
 * each attempt; null leaves only the request's own deadline.
 */
export interface CallRetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  jitter: boolean;
  attemptTimeoutMs: number | null;
}

export type BehaviorConfig = ResourceConfig & (
  | { type: 'source' | 'processor' }
  | { type: 'storage'; writeCapacity: number }
  | { type: 'router'; strategy: 'round-robin' | 'weighted' | 'conditional' }
  | { type: 'cache'; mode: 'fixed' | 'lru'; hitRate: number; entries: number; ttlMs: number }
  | { type: 'broker'; delivery: 'competing' | 'broadcast' }
);

export interface RequestClass {
  id: string;
  name: string;
  weight: number;
  operation: 'read' | 'write';
  tags: string[];
  keyDistribution: {
    kind: 'uniform' | 'hot';
    catalogSize: number;
    hotSubset: number;
    hotShare: number;
  };
}

/**
 * D53: what one endpoint (an in-port) of a node overrides for the calls that enter through it.
 * Absent fields fall back to the node's own behavior. `key` identifies the endpoint's rate limiter.
 */
export interface EndpointBehavior {
  key: string;
  /** Mean service time in ms; replaces 1 / capacity for this endpoint. */
  serviceTimeMs?: number;
  /** Percent of attempts that fail; replaces the node's failure rate. */
  failureRate?: number;
  /** Token bucket: calls beyond it are rejected at admission. */
  rateLimit?: { rps: number; burst: number };
  /** Calls beyond this many in service or queued through the endpoint are rejected at admission. */
  maxConcurrency?: number;
  /** Size of the reply in bytes (transfer time on a link with a bandwidth). */
  responseBytes?: number;
}

/** D54: the caller's out-port policies for one downstream endpoint; `key` identifies the out-port. */
export interface CallerPolicy {
  key: string;
  /** Consecutive failures that open the breaker, how long it stays open, and the probes allowed when half-open. */
  breaker?: { failureThreshold: number; openMs: number; halfOpenProbes: number };
  /** Calls beyond this many outstanding fail fast. */
  maxInFlight?: number;
  /** An attempt unanswered after this many ms is sent again; the first success wins. */
  hedgeAfterMs?: number;
  requestBytes?: number;
  /** Message edges: false = fire and forget (no wait for the acknowledgement). */
  confirm?: boolean;
  /** Message edges: publishes wait for `size` of them or `windowMs`, then travel together. */
  batch?: { size: number; windowMs: number };
}

/** D54: what can go wrong on the wire of an edge. */
export interface EdgeLink {
  jitterMs: number;
  lossRate: number;
  bandwidthKbps: number | null;
}

/**
 * D56: how a studio source emits. A bulk sends `requests` arrivals at deterministic times; a stream
 * keeps arriving (Poisson, shaped by `profile`) until arrivals are stopped. Absent = the engine-level
 * `rate`/`intervalMs` behaviour the kernel tests drive directly.
 */
export type WorkloadSchedule =
  | { kind: 'bulk'; requests: number; arrival: BulkArrival; startDelayMs: number }
  | { kind: 'stream'; startDelayMs: number; /** a ramp reaches its end rate after this long, then holds it */ rampSeconds?: number };

export interface WorkloadDefinition {
  id: string;
  entryNodeId: string;
  enabled: boolean;
  rate: number;
  profile?: TrafficProfile;
  timeoutMs: number;
  intervalMs?: number;
  schedule?: WorkloadSchedule;
  classes: RequestClass[];
  /** D53: the entry endpoint's overrides. */
  endpoint?: EndpointBehavior;
}

export interface ExecutionEdge {
  id: string;
  source: string;
  target: string;
  transport: 'call' | 'message';
  latencyMs: number;
  returnLatencyMs: number;
  ackDelayMs: number;
  /** D56: null = the message never expires. */
  messageTtlMs: number | null;
  weight: number;
  condition?: {
    field: 'class' | 'operation' | 'tag';
    value: string;
  };
  fallback?: boolean;
  needsReview?: boolean;
  /** Call edges only; absent or null means the caller never retries. */
  retry?: CallRetryPolicy | null;
  /** D53: the target endpoint's overrides. */
  endpoint?: EndpointBehavior;
  /** D54: the source out-port's policies. */
  caller?: CallerPolicy;
  /** D54: jitter, loss and bandwidth of the link. */
  link?: EdgeLink;
}

export interface ExecutionNode {
  id: string;
  kind: ComponentKind;
  name: string;
  position: { x: number; y: number };
  behavior: BehaviorConfig;
}

export interface ExecutionGraph {
  executionVersion: 'open-system/1';
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
  workloads: WorkloadDefinition[];
  settings: {
    seed: number;
    duration: number;
  };
}

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  severity: 'error' | 'warning';
}

export interface CompiledPlan {
  graph: ExecutionGraph;
  nodes: Map<string, ExecutionNode>;
  outgoing: Map<string, ExecutionEdge[]>;
  incoming: Map<string, ExecutionEdge[]>;
  activeNodeIds: Set<string>;
}

export const VALID_KINDS: ReadonlySet<ComponentKind> = new Set<ComponentKind>([
  'traffic', 'client', 'mobile', 'device', 'dns', 'cdn', 'firewall', 'gateway',
  'balancer', 'service', 'function', 'container', 'worker', 'scheduler',
  'database', 'nosql', 'cache', 'objectstore', 'search', 'warehouse', 'queue',
  'stream', 'pubsub', 'email', 'monitoring', 'analytics', 'secrets', 'thirdparty', 'custom',
]);

type RawObj = Record<string, unknown>;

function isObj(v: unknown): v is RawObj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown, max = 100, min = 1): v is string {
  return typeof v === 'string' && v.trim().length >= min && v.length <= max;
}

function isNum(v: unknown, min: number, max: number, int = false): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return false;
  return int ? Number.isInteger(v) : true;
}

function err(issues: ValidationIssue[], code: string, message: string, nodeId?: string, edgeId?: string): void {
  issues.push({ code, message, nodeId, edgeId, severity: 'error' });
}

function warn(issues: ValidationIssue[], code: string, message: string, nodeId?: string, edgeId?: string): void {
  issues.push({ code, message, nodeId, edgeId, severity: 'warning' });
}

function validateBehavior(b: unknown, id: string, issues: ValidationIssue[]): void {
  if (!isObj(b)) return err(issues, 'INVALID_BEHAVIOR', 'Behavior must be an object', id);
  if (!isNum(b.capacity, 1, 100000)) err(issues, 'INVALID_CAPACITY', 'capacity must be 1..100000', id);
  if (!isNum(b.concurrency, 1, 1024, true)) err(issues, 'INVALID_CONCURRENCY', 'concurrency must be int 1..1024', id);
  if (!isNum(b.queueLimit, 0, 10000, true)) err(issues, 'INVALID_QUEUE_LIMIT', 'queueLimit must be int 0..10000', id);
  if (!isNum(b.failureRate, 0, 100)) err(issues, 'INVALID_FAILURE_RATE', 'failureRate must be 0..100', id);
  if (!isNum(b.maxRetries, 0, 5, true)) err(issues, 'INVALID_MAX_RETRIES', 'maxRetries must be int 0..5', id);
  if (!isNum(b.retryDelayMs, 0, 10000)) err(issues, 'INVALID_RETRY_DELAY', 'retryDelayMs must be 0..10000', id);
  if (b.serviceTime !== undefined && b.serviceTime !== 'fixed' && b.serviceTime !== 'exponential' && b.serviceTime !== 'lognormal') {
    err(issues, 'INVALID_SERVICE_TIME', 'serviceTime must be fixed, exponential or lognormal', id);
  }
  if (b.serviceTime === 'lognormal' && !isNum(b.serviceTimeCv, 0.1, 10)) {
    err(issues, 'INVALID_SERVICE_TIME_CV', 'lognormal serviceTimeCv must be 0.1..10', id);
  }
  if (b.serviceTime !== 'lognormal' && b.serviceTimeCv !== undefined) {
    err(issues, 'INVALID_SERVICE_TIME_CV', 'serviceTimeCv applies to lognormal only', id);
  }

  const t = b.type;
  if (t === 'source' || t === 'processor') return;
  if (t === 'storage') {
    if (!isNum(b.writeCapacity, 1, 100000)) err(issues, 'INVALID_WRITE_CAPACITY', 'writeCapacity must be 1..100000', id);
  } else if (t === 'router') {
    if (b.strategy !== 'round-robin' && b.strategy !== 'weighted' && b.strategy !== 'conditional') {
      err(issues, 'INVALID_ROUTER_STRATEGY', 'Invalid router strategy', id);
    }
  } else if (t === 'cache') {
    if (b.mode !== 'fixed' && b.mode !== 'lru') err(issues, 'INVALID_CACHE_MODE', 'mode must be fixed or lru', id);
    if (!isNum(b.hitRate, 0, 100)) err(issues, 'INVALID_HIT_RATE', 'hitRate must be 0..100', id);
    if (!isNum(b.entries, 1, 100000, true)) err(issues, 'INVALID_CACHE_ENTRIES', 'entries must be int 1..100000', id);
    if (!isNum(b.ttlMs, 1, 3600000)) err(issues, 'INVALID_TTL', 'ttlMs must be 1..3600000', id);
  } else if (t === 'broker') {
    if (b.delivery !== 'competing' && b.delivery !== 'broadcast') err(issues, 'INVALID_BROKER_DELIVERY', 'delivery must be competing/broadcast', id);
  } else {
    err(issues, 'INVALID_BEHAVIOR_TYPE', 'Unknown behavior type', id);
  }
}

function validateProfile(p: unknown, dur: number, issues: ValidationIssue[]): void {
  if (!isObj(p)) return err(issues, 'INVALID_PROFILE', 'profile must be object', undefined);
  if (p.kind === 'steady') return;
  if (p.kind === 'ramp') {
    if (!isNum(p.endRate, 1, 10000)) err(issues, 'INVALID_RAMP_RATE', 'ramp endRate must be 1..10000', undefined);
  } else if (p.kind === 'burst') {
    if (!isNum(p.peakRate, 1, 10000)) err(issues, 'INVALID_BURST_PEAK', 'burst peakRate must be 1..10000', undefined);
    const s = p.start;
    const e = p.end;
    if (typeof s !== 'number' || typeof e !== 'number' || !Number.isFinite(s) || !Number.isFinite(e) || s < 0 || s >= e || e > dur) {
      err(issues, 'INVALID_BURST_WINDOW', `burst start/end must satisfy 0 <= start < end <= duration (${dur})`, undefined);
    }
  } else {
    err(issues, 'INVALID_PROFILE_KIND', 'profile kind must be steady, burst, or ramp', undefined);
  }
}

function validateClasses(classes: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(classes) || classes.length === 0 || classes.length > 20) {
    return err(issues, 'INVALID_CLASSES_COUNT', 'classes must be array of 1..20 items', undefined);
  }
  const cIds = new Set<string>();
  for (const c of classes) {
    if (!isObj(c)) { err(issues, 'INVALID_CLASS', 'class must be object', undefined); continue; }
    if (!isStr(c.id)) err(issues, 'INVALID_CLASS_ID', 'class id must be nonempty string <=100', undefined);
    else if (cIds.has(c.id)) err(issues, 'DUPLICATE_CLASS_ID', `Duplicate class id: ${c.id}`, undefined);
    else cIds.add(c.id);
    if (!isStr(c.name, 80)) err(issues, 'INVALID_CLASS_NAME', 'class name must be 1..80 chars', undefined);
    if (!isNum(c.weight, Number.MIN_VALUE, Infinity)) err(issues, 'INVALID_CLASS_WEIGHT', 'weight must be > 0 and finite', undefined);
    if (c.operation !== 'read' && c.operation !== 'write') err(issues, 'INVALID_CLASS_OP', 'operation must be read or write', undefined);
    if (!Array.isArray(c.tags) || c.tags.length > 20 || !c.tags.every(t => isStr(t, 80, 0))) {
      err(issues, 'INVALID_CLASS_TAGS', 'tags must be array of max 20 strings <= 80 chars', undefined);
    }
    const kd = c.keyDistribution;
    if (!isObj(kd) || (kd.kind !== 'uniform' && kd.kind !== 'hot')) {
      err(issues, 'INVALID_KEY_DIST', 'keyDistribution invalid', undefined);
    } else {
      if (!isNum(kd.catalogSize, 1, 100000, true)) err(issues, 'INVALID_CATALOG_SIZE', 'catalogSize must be int 1..100000', undefined);
      const cat = typeof kd.catalogSize === 'number' ? kd.catalogSize : 100000;
      if (!isNum(kd.hotSubset, 1, cat, true)) err(issues, 'INVALID_HOT_SUBSET', 'hotSubset must be int 1..catalogSize', undefined);
      if (!isNum(kd.hotShare, 0, 100)) err(issues, 'INVALID_HOT_SHARE', 'hotShare must be 0..100', undefined);
    }
  }
}

export function compileExecution(raw: unknown, requireRunnable = true): { plan?: CompiledPlan; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!isObj(raw)) return { issues: [{ code: 'INVALID_GRAPH', message: 'Graph must be an object', severity: 'error' }] };
  if (raw.executionVersion !== 'open-system/1') err(issues, 'INVALID_VERSION', 'executionVersion must be open-system/1');

  if (!isObj(raw.settings)) {
    err(issues, 'INVALID_SETTINGS', 'settings must be an object');
  } else {
    if (!isNum(raw.settings.seed, 0, 4294967295, true)) err(issues, 'INVALID_SEED', 'seed must be uint32');
    if (!isNum(raw.settings.duration, 1, 86400)) err(issues, 'INVALID_DURATION', 'duration must be 1..86400 seconds');
  }
  const dur = isObj(raw.settings) && typeof raw.settings.duration === 'number' ? raw.settings.duration : 300;

  if (!Array.isArray(raw.nodes) || raw.nodes.length > 100) err(issues, 'INVALID_NODES', 'nodes must be array <= 100');
  if (!Array.isArray(raw.edges) || raw.edges.length > 200) err(issues, 'INVALID_EDGES', 'edges must be array <= 200');
  if (!Array.isArray(raw.workloads) || raw.workloads.length > 20) err(issues, 'INVALID_WORKLOADS', 'workloads must be array <= 20');
  if (issues.length > 0) return { issues };

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const rawNodes = raw.nodes as unknown[];
  const rawEdges = raw.edges as unknown[];
  const rawWorkloads = raw.workloads as unknown[];

  for (const n of rawNodes) {
    if (!isObj(n)) { err(issues, 'INVALID_NODE', 'node must be an object'); continue; }
    if (!isStr(n.id)) err(issues, 'INVALID_NODE_ID', 'node id must be 1..100 chars');
    else if (nodeIds.has(n.id)) err(issues, 'DUPLICATE_NODE_ID', `Duplicate node id: ${n.id}`, n.id);
    else nodeIds.add(n.id);

    if (typeof n.kind !== 'string' || !VALID_KINDS.has(n.kind as ComponentKind)) {
      err(issues, 'INVALID_NODE_KIND', `Unknown kind: ${String(n.kind)}`, isStr(n.id) ? n.id : undefined);
    }
    if (!isStr(n.name, 80)) err(issues, 'INVALID_NODE_NAME', 'name must be 1..80 chars', isStr(n.id) ? n.id : undefined);
    if (!isObj(n.position) || !isNum(n.position.x, -1e6, 1e6) || !isNum(n.position.y, -1e6, 1e6)) {
      err(issues, 'INVALID_POSITION', 'position x/y must be finite abs <= 1e6', isStr(n.id) ? n.id : undefined);
    }
    validateBehavior(n.behavior, isStr(n.id) ? n.id : '', issues);
  }

  const edgePairs = new Set<string>();
  const brokerIds = new Set(rawNodes.filter((n) => isObj(n) && isObj(n.behavior) && n.behavior.type === 'broker').map((n) => (n as RawObj).id));
  for (const e of rawEdges) {
    if (!isObj(e)) { err(issues, 'INVALID_EDGE', 'edge must be an object'); continue; }
    if (!isStr(e.id)) err(issues, 'INVALID_EDGE_ID', 'edge id must be 1..100 chars');
    else if (edgeIds.has(e.id)) err(issues, 'DUPLICATE_EDGE_ID', `Duplicate edge id: ${e.id}`, undefined, e.id);
    else if (nodeIds.has(e.id)) err(issues, 'COLLIDING_ID', `edge id collides with node id: ${e.id}`, undefined, e.id);
    else edgeIds.add(e.id);

    const src = isStr(e.source) ? e.source : '';
    const tgt = isStr(e.target) ? e.target : '';
    if (!nodeIds.has(src)) err(issues, 'UNKNOWN_EDGE_SOURCE', `Edge source node does not exist: ${src}`, undefined, isStr(e.id) ? e.id : undefined);
    if (!nodeIds.has(tgt)) err(issues, 'UNKNOWN_EDGE_TARGET', `Edge target node does not exist: ${tgt}`, undefined, isStr(e.id) ? e.id : undefined);

    if (src && tgt) {
      const pair = JSON.stringify([src, tgt]);
      if (edgePairs.has(pair)) err(issues, 'DUPLICATE_EDGE_PAIR', `Duplicate edge between ${pair}`, undefined, isStr(e.id) ? e.id : undefined);
      edgePairs.add(pair);
    }
    if (e.transport !== 'call' && e.transport !== 'message') err(issues, 'INVALID_TRANSPORT', 'transport must be call or message', undefined, isStr(e.id) ? e.id : undefined);
    if (!isNum(e.latencyMs, 0, 60000)) err(issues, 'INVALID_LATENCY', 'latencyMs must be 0..60000', undefined, isStr(e.id) ? e.id : undefined);
    if (!isNum(e.returnLatencyMs, 0, 60000)) err(issues, 'INVALID_RETURN_LATENCY', 'returnLatencyMs must be 0..60000', undefined, isStr(e.id) ? e.id : undefined);
    if (!isNum(e.ackDelayMs, 0, 60000)) err(issues, 'INVALID_ACK_DELAY', 'ackDelayMs must be 0..60000', undefined, isStr(e.id) ? e.id : undefined);
    if (e.messageTtlMs !== null && !isNum(e.messageTtlMs, 1, 3600000)) err(issues, 'INVALID_MESSAGE_TTL', 'messageTtlMs must be 1..3600000', undefined, isStr(e.id) ? e.id : undefined);
    if (!isNum(e.weight, Number.MIN_VALUE, Infinity)) err(issues, 'INVALID_EDGE_WEIGHT', 'weight must be > 0 and finite', undefined, isStr(e.id) ? e.id : undefined);
    if (e.condition !== undefined) {
      if (!isObj(e.condition) || (e.condition.field !== 'class' && e.condition.field !== 'operation' && e.condition.field !== 'tag') || !isStr(e.condition.value, 80)) {
        err(issues, 'INVALID_EDGE_CONDITION', 'condition must specify field and value', undefined, isStr(e.id) ? e.id : undefined);
      }
    }
    if (e.fallback !== undefined && typeof e.fallback !== 'boolean') err(issues, 'INVALID_EDGE_FALLBACK', 'fallback must be boolean', undefined, isStr(e.id) ? e.id : undefined);
    if (e.needsReview !== undefined && typeof e.needsReview !== 'boolean') err(issues, 'INVALID_EDGE_NEEDS_REVIEW', 'needsReview must be boolean', undefined, isStr(e.id) ? e.id : undefined);
    if (e.retry !== undefined && e.retry !== null) {
      const r = e.retry;
      const edgeId = isStr(e.id) ? e.id : undefined;
      if (!isObj(r)) err(issues, 'INVALID_EDGE_RETRY', 'retry must be an object or null', undefined, edgeId);
      else {
        // D50: a broker route's retry is redelivery (no attempt timeout); other message
        // edges have no caller to retry.
        const fromBroker = brokerIds.has(src);
        if (e.transport !== 'call' && !fromBroker) err(issues, 'INVALID_EDGE_RETRY', 'retry applies to call edges and broker routes only', undefined, edgeId);
        if (fromBroker && r.attemptTimeoutMs !== null) err(issues, 'INVALID_EDGE_RETRY', 'a broker route has no attempt timeout', undefined, edgeId);
        if (!isNum(r.maxAttempts, 1, 10, true)) err(issues, 'INVALID_EDGE_RETRY', 'retry.maxAttempts must be int 1..10', undefined, edgeId);
        if (!isNum(r.backoffMs, 0, 60000)) err(issues, 'INVALID_EDGE_RETRY', 'retry.backoffMs must be 0..60000', undefined, edgeId);
        if (!isNum(r.backoffMultiplier, 1, 10)) err(issues, 'INVALID_EDGE_RETRY', 'retry.backoffMultiplier must be 1..10', undefined, edgeId);
        if (!isNum(r.maxBackoffMs, 0, 600000)) err(issues, 'INVALID_EDGE_RETRY', 'retry.maxBackoffMs must be 0..600000', undefined, edgeId);
        if (typeof r.jitter !== 'boolean') err(issues, 'INVALID_EDGE_RETRY', 'retry.jitter must be boolean', undefined, edgeId);
        if (r.attemptTimeoutMs !== null && !isNum(r.attemptTimeoutMs, 1, 600000)) err(issues, 'INVALID_EDGE_RETRY', 'retry.attemptTimeoutMs must be 1..600000 or null', undefined, edgeId);
      }
    }
  }

  const workloadIds = new Set<string>();
  for (const w of rawWorkloads) {
    if (!isObj(w)) { err(issues, 'INVALID_WORKLOAD', 'workload must be an object'); continue; }
    if (!isStr(w.id)) err(issues, 'INVALID_WORKLOAD_ID', 'workload id must be 1..100 chars');
    else if (workloadIds.has(w.id)) err(issues, 'DUPLICATE_WORKLOAD_ID', `Duplicate workload id: ${w.id}`);
    else workloadIds.add(w.id);

    if (!isStr(w.entryNodeId) || !nodeIds.has(w.entryNodeId)) err(issues, 'INVALID_ENTRY_NODE', `entryNodeId does not exist: ${String(w.entryNodeId)}`);
    if (typeof w.enabled !== 'boolean') err(issues, 'INVALID_WORKLOAD_ENABLED', 'enabled must be boolean');
    // D56: a bulk's arrivals come from its schedule, so its rate is unused.
    if ((w.schedule as { kind?: unknown } | undefined)?.kind !== 'bulk' && !isNum(w.rate, 1, 10000)) err(issues, 'INVALID_WORKLOAD_RATE', 'rate must be 1..10000');
    if (!isNum(w.timeoutMs, 1, 3600000)) err(issues, 'INVALID_WORKLOAD_TIMEOUT', 'timeoutMs must be 1..3600000');
    if (w.intervalMs !== undefined && !isNum(w.intervalMs, 1, 3600000)) err(issues, 'INVALID_WORKLOAD_INTERVAL', 'intervalMs must be 1..3600000');
    if (w.profile !== undefined) validateProfile(w.profile, dur, issues);
    validateClasses(w.classes, issues);
  }

  if (issues.length > 0) return { issues };

  let cloned: ExecutionGraph;
  try {
    cloned = structuredClone(raw as unknown as ExecutionGraph);
  } catch {
    return { issues: [{ code: 'CLONE_ERROR', message: 'Unable to clone graph structure', severity: 'error' }] };
  }

  const nodeMap = new Map<string, ExecutionNode>();
  const outgoing = new Map<string, ExecutionEdge[]>();
  const incoming = new Map<string, ExecutionEdge[]>();

  for (const n of cloned.nodes) {
    nodeMap.set(n.id, n);
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of cloned.edges) {
    outgoing.get(e.source)?.push(e);
    incoming.get(e.target)?.push(e);
  }
  const byId = (a: ExecutionEdge, b: ExecutionEdge) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  for (const list of outgoing.values()) list.sort(byId);
  for (const list of incoming.values()) list.sort(byId);

  const activeNodeIds = new Set<string>();
  const enabledWorkloads = cloned.workloads.filter(w => w.enabled);
  for (const w of enabledWorkloads) {
    const queue = [w.entryNodeId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (activeNodeIds.has(curr)) continue;
      activeNodeIds.add(curr);
      for (const e of outgoing.get(curr) || []) {
        if (!activeNodeIds.has(e.target)) queue.push(e.target);
      }
    }
  }
  for (const n of cloned.nodes) {
    if (!activeNodeIds.has(n.id)) warn(issues, 'INACTIVE_NODE', `Node ${n.id} (${n.name}) is inactive`, n.id);
  }

  if (requireRunnable) {
    if (enabledWorkloads.length === 0) err(issues, 'NO_ENABLED_WORKLOAD', 'At least one enabled workload required');
    for (const e of cloned.edges) {
      if (e.needsReview) err(issues, 'EDGE_NEEDS_REVIEW', `Edge ${e.id} needs review`, undefined, e.id);
    }
    for (const n of cloned.nodes) {
      const out = outgoing.get(n.id) || [];
      const inc = incoming.get(n.id) || [];
      if (n.behavior.type === 'cache') {
        if (out.length !== 1 || out[0].transport !== 'call') {
          err(issues, 'INVALID_CACHE_ORIGIN', `Cache ${n.id} must have exactly one outgoing call edge to origin`, n.id);
        }
      } else if (n.behavior.type === 'broker') {
        if (out.length < 1) err(issues, 'BROKER_NO_CONSUMERS', `Broker ${n.id} must have at least one consumer`, n.id);
        for (const e of out) {
          if (e.transport !== 'message') err(issues, 'BROKER_OUT_NOT_MESSAGE', `Broker edge ${e.id} must be message`, n.id, e.id);
          const tgt = nodeMap.get(e.target);
          if (tgt && (tgt.behavior.type === 'source' || tgt.behavior.type === 'broker')) {
            err(issues, 'INVALID_BROKER_CONSUMER', `Broker ${n.id} cannot push to ${tgt.behavior.type} ${tgt.id}`, n.id, e.id);
          }
        }
        for (const e of inc) {
          if (e.transport !== 'message') err(issues, 'BROKER_INC_NOT_MESSAGE', `Incoming edge to broker ${n.id} must be message`, n.id, e.id);
        }
      } else if (n.behavior.type === 'router') {
        if (out.length < 1) err(issues, 'ROUTER_NO_ROUTES', `Router ${n.id} must have at least one route`, n.id);
        if (n.behavior.strategy === 'conditional') {
          const fallbacks = out.filter(e => e.fallback === true);
          const conditionals = out.filter(e => e.condition !== undefined && !e.fallback);
          if (fallbacks.length !== 1 || fallbacks.length + conditionals.length !== out.length) {
            err(issues, 'INVALID_CONDITIONAL_ROUTER', `Conditional router ${n.id} requires exactly one fallback and all other edges with conditions`, n.id);
          }
        }
      }
    }

    // Detect call-only cycles
    const visited = new Set<string>();
    const recStack: string[] = [];
    const inRecStack = new Set<string>();
    const callEdgeId = new Map<string, string>();

    function checkCycles(curr: string): void {
      visited.add(curr);
      recStack.push(curr);
      inRecStack.add(curr);
      for (const e of outgoing.get(curr) || []) {
        if (e.transport !== 'call') continue;
        callEdgeId.set(`${curr}->${e.target}`, e.id);
        if (!visited.has(e.target)) {
          checkCycles(e.target);
        } else if (inRecStack.has(e.target)) {
          const cycleStart = recStack.indexOf(e.target);
          const cycleNodes = [...recStack.slice(cycleStart), e.target];
          err(issues, 'CALL_CYCLE_DETECTED', `Synchronous call cycle detected: ${cycleNodes.join(' -> ')}`, curr, e.id);
        }
      }
      recStack.pop();
      inRecStack.delete(curr);
    }

    for (const n of cloned.nodes) {
      if (!visited.has(n.id)) checkCycles(n.id);
    }
  }

  if (issues.some(i => i.severity === 'error')) return { issues };
  return {
    plan: { graph: cloned, nodes: nodeMap, outgoing, incoming, activeNodeIds },
    issues,
  };
}

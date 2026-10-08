import type {
  CallRetryPolicy,
  ExecutionGraph,
  CallerPolicy,
  EndpointBehavior,
  ExecutionEdge,
  WorkloadDefinition,
  RequestClass,
  CompiledPlan,
} from '../../domain/execution';
import { compileExecution } from '../../domain/execution';
import { bulkArrivalMs } from '../../domain/bulk-arrivals';
import { nextArrivalTime } from '../../domain/workload';
import { RouteSelector, RuntimeCache } from './behaviors';
import type { CacheSnapshot } from './behaviors';
import { randomGenerator } from '../primitives';

export type Outcome = 'succeeded' | 'rejected' | 'failed' | 'expired';

export type SimLifecycleFactKind =
  | 'admitted'
  | 'rejected'
  | 'queued'
  | 'started'
  | 'attempt_settled'
  | 'unit_settled'
  | 'message_created'
  | 'route_selected'
  | 'host_down'
  | 'host_up'
  | 'failure_detected'
  | 'recovery_detected'
  | 'bridge_dispatch'
  | 'call_retry'
  | 'traffic'
  /** A request or message leaves its sender along `edgeId`; `arriveAt` (seconds) is when it reaches the target, absent when the leg is lost. */
  | 'sent'
  /** A response leaves the target back along `edgeId`; `arriveAt` is when the caller receives it. */
  | 'response_sent'
  /** A queued/active operation no longer occupies its node; this does not settle its unit. */
  | 'occupancy_released';

export interface SimLifecycleFact {
  trafficPhase?: 'await' | 'await_resolved' | 'retry' | 'outcome' | 'blocked' | 'unblocked' | 'reserved' | 'slot_released';
  trafficOutcome?: 'success' | 'error' | 'rejected' | 'timeout' | 'expired' | 'cancelled' | 'retryExhausted' | 'redeliveryExhausted' | 'lost' | 'late';
  ownerPath?: string;
  targetNodeId?: string;
  /** Observation-only delayed departure (publication ACK); no new kernel event. */
  departAt?: number;
  kind: SimLifecycleFactKind;
  time: number;
  nodeId: string;
  unitIdentity: string;
  attempt: number;
  path: string;
  outcome?: Outcome;
  parentIdentity?: string;
  edgeId?: string;
  /** `sent` and `response_sent` only: simulated time the leg ends. */
  arriveAt?: number;
  /** `occupancy_released`: false for broker dequeue, true for final operation cleanup. */
  operationReleased?: boolean;
  /** Bridge call frames: the system frame ID a
   * 'bridge_dispatch' fact carries, correlating it to the eventual settleCall(). */
  frameId?: string;
  /** Set only when a 'unit_settled' fact resolves through a bridge child's adopted
   * outcome/payload (the parent adopts the child's outcome and returns the child's
   * payload). Absent for ordinary (non-bridge) settlement, where the original admitted
   * payload still applies. */
  payloadRef?: string;
  /** The emitting unit's actual category (no success is inferred, and neither is a
   * root/message distinction). Set on 'admitted',
   * 'rejected' and 'unit_settled' facts so a consumer never has to guess root-vs-message
   * from the shape of `unitIdentity`. */
  category?: 'root' | 'message';
}

export type SimTraceHook = (fact: SimLifecycleFact) => void;

export interface KernelFaultConfig {
  id: string;
  hostId: string;
  downAtMs: number;
  upAtMs: number;
  detectionDelayMs: number;
  recoveryDetectionDelayMs: number;
  activePolicy: 'fail';
  queuedPolicy: 'reject';
  routeReset: 'first-healthy';
}

/**
 * Bridge call frames: declares that `nodeId` (a
 * resource with no other selectable call continuation, per readiness) dispatches its
 * call continuation to an external, non-resource target. The kernel keeps the parent op
 * waiting (as in a retained call chain) instead of completing it locally, and applies
 * `returnLatencyMs` when the external caller eventually resolves the frame via
 * `settleCall`.
 */
export interface KernelBridgeConfig {
  nodeId: string;
  returnLatencyMs: number;
  /** The call's caller retry policy; each attempt opens a new bridge frame. */
  retry?: CallRetryPolicy | null;
  /** The connection ID, reported on 'call_retry' facts. */
  connectionId?: string;
}

export interface OpenSimulationOptions {
  traceHook?: SimTraceHook;
  disabledWorkloadIds?: Iterable<string>;
  requireRunnable?: boolean;
  hostPlacement?: Map<string, string> | Record<string, string>;
  faults?: readonly KernelFaultConfig[];
  bridges?: readonly KernelBridgeConfig[];
  /**
   * Seconds after which workloads schedule no more arrivals. Defaults to the run
   * duration. A drain run stops arrivals at its arrival horizon and keeps running to its
   * deadline.
   */
  arrivalHorizonSeconds?: number;
  /** At most this many root arrivals are scheduled in total (a 'count' run); absent = no cap. */
  maxRootArrivals?: number;
}

export interface KernelResourceInput {
  entryNodeId: string;
  identity: string;
  time: number;
  deadline: number;
  requestClass: RequestClass;
  key?: string | null;
  workloadId?: string;
  ordinal?: number;
}

export interface FlowCounts {
  generated: number;
  succeeded: number;
  rejected: number;
  failed: number;
  expired: number;
  inFlight: number;
  throughput: number;
  meanLatency: number;
  p95Latency: number;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  writes: number;
  entries: number;
  evictions: number;
  expirations: number;
}

export interface ResourceMetrics {
  arrived: number;
  admitted: number;
  completed: number;
  rejected: number;
  failed: number;
  expired: number;
  cancelled: number;
  queued: number;
  processing: number;
  waiting: number;
  activeWorkers: number;
  attempts: number;
  retries: number;
  retrying: number;
  utilization: number;
  occupancy: number;
  reserved: number;
  cleanupProcessing: number;
  buffered?: number;
  delivered?: number;
  inFlight?: number;
  cache?: CacheMetrics;
}

export interface EdgeMetrics {
  sent: number;
  admitted: number;
  rejected: number;
  responses: number;
}

export interface OpenMetrics {
  time: number;
  finished: boolean;
  incomplete?: string;
  roots: FlowCounts;
  messages: FlowCounts;
  nodes: Record<string, ResourceMetrics>;
  edges: Record<string, EdgeMetrics>;
  history: Array<{
    time: number;
    generated: number;
    completed: number;
    queue: number;
    latency: number;
  }>;
}

export interface SimEvent {
  time: number;
  priority: number;
  seq: number;
  run: () => void;
  /** Periodic bookkeeping that cannot change an outcome. */
  housekeeping?: boolean;
  /** This is the expiry timer of `unit`: once the unit has settled it is a no-op. */
  unit?: Unit;
}

class SimpleEventHeap {
  private heap: SimEvent[] = [];

  get size(): number {
    return this.heap.length;
  }

  peek(): SimEvent | undefined {
    return this.heap[0];
  }

  push(item: SimEvent): void {
    this.heap.push(item);
    this.siftUp(this.heap.length - 1);
  }

  pop(): SimEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.siftDown(0);
    }
    return top;
  }

  private compare(a: SimEvent, b: SimEvent): number {
    if (a.time !== b.time) return a.time - b.time;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.seq - b.seq;
  }

  private siftUp(index: number): void {
    let curr = index;
    while (curr > 0) {
      const parent = (curr - 1) >> 1;
      if (this.compare(this.heap[curr], this.heap[parent]) < 0) {
        const tmp = this.heap[curr];
        this.heap[curr] = this.heap[parent];
        this.heap[parent] = tmp;
        curr = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    const len = this.heap.length;
    let curr = index;
    while (true) {
      const left = (curr << 1) + 1;
      const right = left + 1;
      let smallest = curr;

      if (left < len && this.compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < len && this.compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest !== curr) {
        const tmp = this.heap[curr];
        this.heap[curr] = this.heap[smallest];
        this.heap[smallest] = tmp;
        curr = smallest;
      } else {
        break;
      }
    }
  }
}

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed: number): () => number {
  return randomGenerator(seed);
}

export interface Unit {
  category: 'root' | 'message';
  hops: number;
  lineageDeadline: number;
  identity: string;
  workloadId: string;
  ordinal: number;
  born: number;
  deadline: number;
  requestClass: RequestClass;
  key?: string | null;
  done: boolean;
  rootOp?: Op;
  ops: Set<Op>;
  /** Its expiry timer is scheduled and has not run (it stops counting as pending work once the unit settles). */
  expiryPending?: boolean;
}

export type OpPhase = 'transit' | 'queued' | 'reserved' | 'processing' | 'waiting' | 'retrying' | 'settled';

export interface Op {
  unit: Unit;
  nodeId: string;
  path: string;
  phase: OpPhase;
  done: boolean;
  notified?: boolean;
  released?: boolean;
  attempt: number;
  children: Set<Op>;
  onDone?: (outcome: Outcome, payloadRef?: string) => void;
  arrived: number;
  pendingChildren?: number;
  failedChild?: boolean;
  cacheAction?: 'fill' | 'invalidate';
  subscription?: string;
  publicationOnly?: boolean;
  cancelled?: boolean;
  /** Bridge call frames: set while this op waits on an external settleCall. */
  bridgeFrameId?: string;
  /** Deliveries of this broker op so far (redelivery counts). */
  deliveries?: number;
  /** The endpoint this op entered through; its overrides apply at this node. */
  endpoint?: EndpointBehavior;
  /** The endpoint whose concurrency slot this op holds until it is released. */
  slotKey?: string;
}

export interface NodeRuntime {
  active: Set<Op>;
  waitingSources: Set<Op>;
  queue: Op[];
  retrying: Set<Op>;
  counters: {
    arrived: number;
    admitted: number;
    completed: number;
    rejected: number;
    failed: number;
    expired: number;
    cancelled: number;
    attempts: number;
    retries: number;
    delivered?: number;
  };
  cacheState?: {
    runtime?: RuntimeCache;
    hits: number;
    misses: number;
    writes: number;
  };
  cumulativeProcessing: number;
  cumulativeOccupied: number;
  competingCursor?: number;
}

export class LatencyCollector {
  private values: number[] = [];
  private total = 0;

  push(ms: number): void {
    this.total += ms;
    let left = 0;
    let right = this.values.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (this.values[middle] <= ms) left = middle + 1;
      else right = middle;
    }
    this.values.splice(left, 0, ms);
  }

  get count(): number {
    return this.values.length;
  }

  snapshot(): { mean: number; p95: number } {
    if (this.values.length === 0) return { mean: 0, p95: 0 };
    const idx = Math.ceil(this.values.length * 0.95) - 1;
    return { mean: this.total / this.values.length, p95: this.values[idx] };
  }
}

export class OpenSimulation {
  private readonly observedBlocked = new WeakMap<Op, Set<string>>();
  private readonly observedBridgeFrames = new Map<string, Op>();
  protected plan: CompiledPlan;
  protected routeSelector = new RouteSelector();
  protected events = new SimpleEventHeap();
  /** Units created and not yet settled (reported as stuck when nothing more can happen). */
  protected liveUnits = new Set<Unit>();
  /** Scheduled events other than housekeeping (samples); see hasPendingWork(). */
  protected workEvents = 0;
  protected seq = 0;
  protected currentTime = 0;
  protected duration: number;
  protected arrivalHorizon: number;
  /** A 'count' run's cap on root arrivals, and how many have been scheduled so far. */
  protected maxRootArrivals: number | undefined;
  protected scheduledArrivals = 0;
  /** Arrivals scheduled and not yet fired. */
  protected pendingArrivals = 0;
  /** Set by stopArrivals(); no workload arrives after it. */
  protected arrivalsStopped = false;
  protected seed: number;
  protected finished = false;
  protected incompleteReason?: string;

  protected nodesRuntime = new Map<string, NodeRuntime>();
  protected edgeMetrics = new Map<string, EdgeMetrics>();

  protected pumpingBrokers = false;
  protected rootsGenerated = 0;
  protected rootsSucceeded = 0;
  protected rootsRejected = 0;
  protected rootsFailed = 0;
  protected rootsExpired = 0;
  protected rootsInFlight = 0;
  protected latencies = new LatencyCollector();
  /**
   * Per-node response time of successful operations: from arrival at the node to its
   * success, including queueing, retries and downstream waits. Kept out of `snapshot()`
   * so the characterization goldens are unchanged; read through `nodeLatency()`.
   */
  protected nodeLatencies = new Map<string, LatencyCollector>();
  /** Caller retries per call edge, outside `snapshot()` like `nodeLatencies`. */
  protected callRetries = new Map<string, number>();

  protected messagesGenerated = 0;
  protected messagesSucceeded = 0;
  protected messagesRejected = 0;
  protected messagesFailed = 0;
  protected messagesExpired = 0;
  protected messagesInFlight = 0;
  protected messageLatencies = new LatencyCollector();

  protected totalEventsProcessed = 0;
  protected liveOpsCount = 0;

  protected workloadRngs = new Map<string, () => number>();
  protected workloadNextOrdinal = new Map<string, number>();

  protected traceHook?: SimTraceHook;
  protected disabledWorkloads = new Set<string>();

  protected history: Array<{
    time: number;
    generated: number;
    completed: number;
    queue: number;
    latency: number;
  }> = [];
  protected nextSampleTime = 1;

  protected hostPlacement = new Map<string, string>();
  protected hostState = new Map<string, boolean>();
  protected routerDetectedHostState = new Map<string, boolean>();
  protected roundRobinCursors = new Map<string, number>();
  protected faults: KernelFaultConfig[] = [];
  protected pendingCompletionCancels = new Map<Op, () => void>();

  // Bridge call frames: nodes with an external (non-resource) call
  // continuation, and the ops currently waiting on an external settleCall.
  protected bridgeByNode = new Map<string, KernelBridgeConfig>();
  protected bridgePendingOps = new Map<string, Op>();
  /** Bridge retries: attempt number per frame, frames already resolved, frames abandoned by a timeout. */
  protected bridgeAttempts = new Map<string, number>();
  protected resolvedBridgeFrames = new Set<string>();
  protected abandonedBridgeFrames = new Set<string>();
  protected bridgeFrameCounter = 0;

  constructor(graph: ExecutionGraph, options?: OpenSimulationOptions) {
    if (options?.traceHook) {
      this.traceHook = options.traceHook;
    }
    if (options?.disabledWorkloadIds) {
      for (const id of options.disabledWorkloadIds) {
        this.disabledWorkloads.add(id);
      }
    }
    const requireRunnable = options?.requireRunnable ?? true;
    const compiled = compileExecution(graph, requireRunnable);
    if (!compiled.plan) {
      const errMsgs = compiled.issues
        .filter(i => i.severity === 'error')
        .map(i => `${i.code}: ${i.message}`)
        .join(', ');
      throw new Error(`Graph validation failed: ${errMsgs}`);
    }
    this.plan = compiled.plan;

    this.duration = this.plan.graph.settings.duration;
    this.arrivalHorizon = Math.min(options?.arrivalHorizonSeconds ?? this.duration, this.duration);
    this.maxRootArrivals = options?.maxRootArrivals;
    this.seed = this.plan.graph.settings.seed;

    for (const node of this.plan.graph.nodes) {
      let cacheState: NodeRuntime['cacheState'] | undefined;
      if (node.behavior.type === 'cache') {
        cacheState = {
          runtime: node.behavior.mode === 'lru'
            ? new RuntimeCache(node.behavior.entries, node.behavior.ttlMs)
            : undefined,
          hits: 0,
          misses: 0,
          writes: 0,
        };
      }
      this.nodesRuntime.set(node.id, {
        active: new Set(),
        waitingSources: new Set(),
        queue: [],
        retrying: new Set(),
        counters: {
          arrived: 0,
          admitted: 0,
          completed: 0,
          rejected: 0,
          failed: 0,
          expired: 0,
          cancelled: 0,
          attempts: 0,
          retries: 0,
        },
        cacheState,
        cumulativeProcessing: 0,
        cumulativeOccupied: 0,
      });
    }

    for (const edge of this.plan.graph.edges) {
      this.edgeMetrics.set(edge.id, {
        sent: 0,
        admitted: 0,
        rejected: 0,
        responses: 0,
      });
    }

    for (const wl of this.plan.graph.workloads) {
      if (!wl.enabled || this.disabledWorkloads.has(wl.id)) continue;
      const wlSeed = (this.seed ^ hashString(wl.id)) >>> 0;
      this.workloadRngs.set(wl.id, makeRng(wlSeed));
      this.workloadNextOrdinal.set(wl.id, 0);
      this.scheduleNextArrival(wl, 0);
    }

    this.scheduleSample(1);

    if (options?.hostPlacement) {
      if (options.hostPlacement instanceof Map) {
        this.hostPlacement = new Map(options.hostPlacement);
      } else {
        this.hostPlacement = new Map(Object.entries(options.hostPlacement));
      }
    }

    if (options?.faults && options.faults.length > 0) {
      this.faults = [...options.faults];
      for (const fault of this.faults) {
        this.hostState.set(fault.hostId, true);
        this.routerDetectedHostState.set(fault.hostId, true);

        const downSec = fault.downAtMs / 1000;
        const failDetectSec = (fault.downAtMs + fault.detectionDelayMs) / 1000;
        const upSec = fault.upAtMs / 1000;
        const recDetectSec = (fault.upAtMs + fault.recoveryDetectionDelayMs) / 1000;

        // Phase 0: host-down event (priority -2)
        this.scheduleEvent(downSec, -2, () => {
          this.interruptHost(fault.hostId, downSec);
        });

        // Phase 0: failure-detection event (priority -1)
        this.scheduleEvent(failDetectSec, -1, () => {
          this.failureDetected(fault.hostId, failDetectSec);
        });

        // Phase 0: host-up event (priority -2)
        this.scheduleEvent(upSec, -2, () => {
          this.hostUp(fault.hostId, upSec);
        });

        // Phase 0: recovery-detection event (priority -1)
        this.scheduleEvent(recDetectSec, -1, () => {
          this.recoveryDetected(fault.hostId, recDetectSec);
        });
      }
    }

    if (options?.bridges) {
      for (const bridge of options.bridges) {
        this.bridgeByNode.set(bridge.nodeId, bridge);
      }
    }
  }

  public getHostState(hostId: string): boolean | undefined {
    return this.hostState.get(hostId);
  }

  public getRouterDetectedHostState(hostId: string): boolean | undefined {
    return this.routerDetectedHostState.get(hostId);
  }

  public interruptHost(hostId: string, timeSeconds?: number): void {
    if (timeSeconds !== undefined && timeSeconds > this.currentTime) {
      this.updateIntegrals(timeSeconds);
      this.currentTime = timeSeconds;
    }
    this.hostState.set(hostId, false);
    this.emitFact({
      kind: 'host_down',
      time: this.currentTime,
      nodeId: hostId,
      unitIdentity: '',
      attempt: 0,
      path: '',
    });

    for (const [nodeId, placedHostId] of this.hostPlacement.entries()) {
      if (placedHostId !== hostId) continue;
      const nr = this.nodesRuntime.get(nodeId);
      if (!nr) continue;

      // 1. Active work on this host fails once. A router's forwarded requests wait without
      // a slot but still die with the proxy.
      const isRouterNode = this.plan.nodes.get(nodeId)?.behavior.type === 'router';
      const activeOps = [...nr.active, ...(isRouterNode ? nr.waitingSources : [])];
      nr.active.clear();
      if (isRouterNode) nr.waitingSources.clear();
      for (const op of activeOps) {
        if (op.done) continue;
        op.cancelled = true;
        const cancelCb = this.pendingCompletionCancels.get(op);
        if (cancelCb) {
          cancelCb();
          this.pendingCompletionCancels.delete(op);
        }

        nr.counters.failed++;
        op.phase = 'settled';
        op.done = true;
        this.emitFact({
          kind: 'attempt_settled',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          attempt: op.attempt,
          path: op.path,
          outcome: 'failed',
        });
        this.finishOp(op, 'failed');
        this.releaseOp(op);
      }

      // 2. Queued work on this host is rejected once
      const queuedOps = Array.from(nr.queue);
      nr.queue = [];
      for (const op of queuedOps) {
        if (op.done) continue;
        op.cancelled = true;
        nr.counters.rejected++;
        op.phase = 'settled';
        op.done = true;
        if (op === op.unit.rootOp) {
          this.emitFact({
            kind: 'rejected',
            time: this.currentTime,
            nodeId: op.nodeId,
            unitIdentity: op.unit.identity,
            category: op.unit.category,
            attempt: op.attempt,
            path: op.path,
          });
        }
        this.finishOp(op, 'rejected');
        this.releaseOp(op);
      }

      // Retrying work is left alone: activePolicy/queuedPolicy apply only to active and
      // queued work present when the outage fires. When a pending retry's timer
      // later re-admits it, normal admission applies: rejected as unavailable if the host is
      // still down, admitted normally if it has recovered.
    }
  }

  public hostUp(hostId: string, timeSeconds?: number): void {
    if (timeSeconds !== undefined && timeSeconds > this.currentTime) {
      this.updateIntegrals(timeSeconds);
      this.currentTime = timeSeconds;
    }
    this.hostState.set(hostId, true);
    this.emitFact({
      kind: 'host_up',
      time: this.currentTime,
      nodeId: hostId,
      unitIdentity: '',
      attempt: 0,
      path: '',
    });
  }

  public failureDetected(hostId: string, timeSeconds?: number): void {
    if (timeSeconds !== undefined && timeSeconds > this.currentTime) {
      this.updateIntegrals(timeSeconds);
      this.currentTime = timeSeconds;
    }
    this.routerDetectedHostState.set(hostId, false);
    for (const [nodeId, node] of this.plan.nodes.entries()) {
      if (node.behavior.type === 'router' && node.behavior.strategy === 'round-robin') {
        this.roundRobinCursors.set(nodeId, 0);
      }
    }
    this.emitFact({
      kind: 'failure_detected',
      time: this.currentTime,
      nodeId: hostId,
      unitIdentity: '',
      attempt: 0,
      path: '',
    });
  }

  public recoveryDetected(hostId: string, timeSeconds?: number): void {
    if (timeSeconds !== undefined && timeSeconds > this.currentTime) {
      this.updateIntegrals(timeSeconds);
      this.currentTime = timeSeconds;
    }
    this.routerDetectedHostState.set(hostId, true);
    for (const [nodeId, node] of this.plan.nodes.entries()) {
      if (node.behavior.type === 'router' && node.behavior.strategy === 'round-robin') {
        this.roundRobinCursors.set(nodeId, 0);
      }
    }
    this.emitFact({
      kind: 'recovery_detected',
      time: this.currentTime,
      nodeId: hostId,
      unitIdentity: '',
      attempt: 0,
      path: '',
    });
  }

  protected scheduleEvent(time: number, priority: number, run: () => void, tag: { housekeeping?: true; unit?: Unit } = {}): void {
    this.events.push({ time, priority, seq: this.seq++, run, ...tag });
    if (tag.unit) tag.unit.expiryPending = true;
    if (!tag.housekeeping) this.workEvents++;
  }

  /** An event leaves the queue: it stops counting as pending work unless the unit it belonged to already settled. */
  protected eventPopped(evt: SimEvent): void {
    if (evt.housekeeping) return;
    if (evt.unit) {
      if (!evt.unit.expiryPending) return; // already discounted when the unit settled
      evt.unit.expiryPending = false;
    }
    this.workEvents--;
  }

  /** True while an event that could still change an outcome is scheduled (periodic samples do not count). */
  hasPendingWork(): boolean {
    return this.workEvents > 0;
  }

  protected scheduleSample(t: number): void {
    if (t > this.duration) return;
    this.scheduleEvent(t, 3, () => {
      let qTotal = 0;
      for (const nr of this.nodesRuntime.values()) {
        qTotal += nr.queue.length;
      }
      const latSnap = this.latencies.snapshot();
      this.history.push({
        time: t,
        generated: this.rootsGenerated,
        completed: this.rootsSucceeded,
        queue: qTotal,
        latency: latSnap.mean,
      });
      this.scheduleSample(t + 1);
    }, { housekeeping: true });
  }

  protected updateIntegrals(newTime: number): void {
    const dt = newTime - this.currentTime;
    if (dt <= 0) return;

    for (const [nodeId, nr] of this.nodesRuntime.entries()) {
      const node = this.plan.nodes.get(nodeId)!;
      const conc = Math.max(1, node.behavior.concurrency);
      let processingCount = 0;
      for (const op of nr.active) {
        if (op.phase === 'processing') processingCount++;
      }
      nr.cumulativeProcessing += (processingCount / conc) * dt;
      nr.cumulativeOccupied += (nr.active.size / conc) * dt;
    }
  }

  protected drawRequestClassAndKey(wl: WorkloadDefinition, ordinal: number): { reqClass: RequestClass; key: string } {
    const rng = makeRng((this.seed ^ hashString(`${wl.id}:${ordinal}`)) >>> 0);
    let maxWeight = 0;
    for (const c of wl.classes) {
      if (c.weight > maxWeight) maxWeight = c.weight;
    }
    const safeMax = maxWeight > 0 ? maxWeight : 1;
    let sum = 0;
    for (const c of wl.classes) sum += c.weight / safeMax;
    let roll = rng() * sum;
    let chosen = wl.classes[0];
    for (const c of wl.classes) {
      const w = c.weight / safeMax;
      if (roll <= w) {
        chosen = c;
        break;
      }
      roll -= w;
    }

    const kd = chosen.keyDistribution;
    let keyIdx = 0;
    if (kd.kind === 'uniform') {
      keyIdx = Math.floor(rng() * kd.catalogSize);
    } else {
      const isHot = rng() * 100 < kd.hotShare;
      if (isHot) {
        keyIdx = Math.floor(rng() * Math.min(kd.hotSubset, kd.catalogSize));
      } else {
        const remaining = kd.catalogSize - kd.hotSubset;
        if (remaining > 0) {
          keyIdx = kd.hotSubset + Math.floor(rng() * remaining);
        } else {
          keyIdx = Math.floor(rng() * kd.catalogSize);
        }
      }
    }
    return { reqClass: chosen, key: `k-${keyIdx}` };
  }

  protected emitFact(fact: SimLifecycleFact): void {
    this.traceHook?.(fact);
  }

  /**
   * True when no operation is live and no workload arrival is pending, so nothing the run
   * produced can still change an outcome. Housekeeping events (samples, expiry timers of settled
   * units) do not count; that is why a stopped or counted run can end the moment its work is done.
   */
  isIdle(): boolean {
    return this.liveOpsCount === 0 && this.pendingArrivals === 0;
  }

  /** Units that have not settled, with where each one is held. */
  unsettled(): readonly { identity: string; category: 'root' | 'message'; holderNodeId: string; path?: string; phase: OpPhase }[] {
    return [...this.liveUnits].map((u) => ({
      identity: u.identity,
      category: u.category,
      holderNodeId: u.rootOp?.nodeId ?? '',
      path: u.rootOp?.path ?? '',
      phase: u.rootOp?.phase ?? 'transit',
    }));
  }

  /** Arrivals still to come: a bulk's remaining requests, or one for each live stream. */
  pendingArrivalCount(): number {
    return this.pendingArrivals;
  }

  /** Stop every workload from arriving again; what is in flight carries on. */
  stopArrivals(): void {
    this.arrivalsStopped = true;
  }

  protected scheduleNextArrival(wl: WorkloadDefinition, afterTime: number): void {
    if (this.disabledWorkloads.has(wl.id) || this.arrivalsStopped) return;
    if (this.maxRootArrivals !== undefined && this.scheduledArrivals >= this.maxRootArrivals) return;
    const ordinal = this.workloadNextOrdinal.get(wl.id)!;
    const schedule = wl.schedule;
    if (schedule?.kind === 'bulk' && ordinal >= schedule.requests) return;
    this.workloadNextOrdinal.set(wl.id, ordinal + 1);

    const intervalMs = wl.intervalMs;
    let arrTime: number;

    if (schedule?.kind === 'bulk') {
      arrTime = bulkArrivalMs(ordinal, schedule.requests, schedule.arrival, schedule.startDelayMs) / 1000;
    } else if (intervalMs !== undefined && intervalMs > 0) {
      arrTime = (ordinal + 1) * (intervalMs / 1000);
    } else {
      const rng = this.workloadRngs.get(wl.id)!;
      const u = Math.max(1e-12, Math.min(1 - 1e-12, rng()));
      const hazard = -Math.log(1 - u);
      const adapter = {
        traffic: wl.rate,
        seed: this.seed,
        // Profiles (ramp, burst) are shaped over the arrival window; a stream's ramp has its own length.
        duration: schedule?.kind === 'stream' && schedule.rampSeconds !== undefined ? schedule.rampSeconds : this.arrivalHorizon,
        timeoutMs: wl.timeoutMs,
        profile: wl.profile,
        holdFinalRate: schedule?.kind === 'stream',
      };
      arrTime = nextArrivalTime(adapter, Math.max(afterTime, (schedule?.startDelayMs ?? 0) / 1000), hazard);
    }

    if (!Number.isFinite(arrTime) || arrTime > this.arrivalHorizon) return;

    this.scheduledArrivals++;
    this.pendingArrivals++;
    this.scheduleEvent(arrTime, 2, () => {
      this.pendingArrivals--;
      if (this.disabledWorkloads.has(wl.id) || this.arrivalsStopped) return;
      this.handleArrival(wl, ordinal, arrTime);
      this.scheduleNextArrival(wl, arrTime);
    });
  }

  protected releaseOp(op: Op): void {
    if (op.released) return;
    op.released = true;
    this.observedBlocked.delete(op);
    this.emitFact({
      kind: 'occupancy_released', time: this.currentTime, nodeId: op.nodeId,
      unitIdentity: op.unit.identity, attempt: op.attempt, path: op.path, operationReleased: true,
    });
    if (op.slotKey !== undefined) {
      this.endpointSlots.set(op.slotKey, Math.max(0, (this.endpointSlots.get(op.slotKey) ?? 1) - 1));
      op.slotKey = undefined;
    }
    this.liveOpsCount--;
    op.unit.ops.delete(op);
  }

  /** Observation only: never schedules work or changes simulation counters. */
  protected traffic(op: Op, phase: NonNullable<SimLifecycleFact['trafficPhase']>, edgeId?: string, outcome?: SimLifecycleFact['trafficOutcome'], until?: number, targetNodeId?: string): void {
    this.emitFact({ kind: 'traffic', trafficPhase: phase, trafficOutcome: outcome, time: this.currentTime,
      nodeId: op.nodeId, unitIdentity: op.unit.identity, attempt: op.attempt, path: op.path,
      ownerPath: op.path, edgeId, arriveAt: until, targetNodeId });
  }

  private observeBrokerBlock(op: Op): void {
    const seen = this.observedBlocked.get(op) ?? new Set<string>();
    for (const edge of this.plan.outgoing.get(op.nodeId) ?? []) {
      if (op.subscription && edge.id !== op.subscription) continue;
      if (!seen.has(edge.id)) { seen.add(edge.id); this.traffic(op, 'blocked', edge.id); }
    }
    this.observedBlocked.set(op, seen);
  }

  protected handleArrival(wl: WorkloadDefinition, ordinal: number, arrTime: number): void {
    this.rootsGenerated++;
    this.rootsInFlight++;

    const { reqClass, key } = this.drawRequestClassAndKey(wl, ordinal);
    const deadline = arrTime + wl.timeoutMs / 1000;

    const entryNode = this.plan.nodes.get(wl.entryNodeId)!;
    if (entryNode.behavior.type === 'broker') {
      const unit: Unit = {
        category: 'root',
        hops: 0,
        lineageDeadline: Infinity,
        identity: `${wl.id}-${ordinal}`,
        workloadId: wl.id,
        ordinal,
        born: arrTime,
        deadline,
        requestClass: reqClass,
        key,
        done: false,
        ops: new Set(),
      };
      this.liveUnits.add(unit);

      this.scheduleEvent(deadline, 0, () => {
        if (!unit.done) {
          this.expireUnit(unit);
        }
      }, { unit });

      this.handleBrokerWorkloadEntry(unit, wl, arrTime);
      return;
    }

    const unit: Unit = {
      category: 'root',
      hops: 0,
      lineageDeadline: Infinity,
      identity: `${wl.id}-${ordinal}`,
      workloadId: wl.id,
      ordinal,
      born: arrTime,
      deadline,
      requestClass: reqClass,
      key,
      done: false,
      ops: new Set(),
    };
    this.liveUnits.add(unit);

    this.scheduleEvent(deadline, 0, () => {
      if (!unit.done) {
        this.expireUnit(unit);
      }
    }, { unit });

    const rootOp: Op = {
      unit,
      nodeId: wl.entryNodeId,
      path: wl.entryNodeId,
      phase: 'transit',
      endpoint: wl.endpoint,
      done: false,
      attempt: 0,
      children: new Set(),
      arrived: arrTime,
      onDone: (outcome, payloadRef) => {
        this.finishUnit(unit, outcome, payloadRef);
        const affectedNodes = new Set<string>();
        for (const op of unit.ops) {
          if (op !== rootOp && !op.done) {
            this.cancelOp(op, affectedNodes);
          }
        }
        for (const nid of affectedNodes) {
          this.pumpQueue(nid);
        }
      },
    };

    unit.rootOp = rootOp;
    unit.ops.add(rootOp);
    this.liveOpsCount++;

    this.admitOp(rootOp, false);
  }

  protected handleBrokerWorkloadEntry(unit: Unit, wl: WorkloadDefinition, arrTime: number): void {
    const rootOp: Op = {
      unit,
      nodeId: wl.entryNodeId,
      path: wl.entryNodeId,
      phase: 'waiting',
      publicationOnly: true,
      done: false,
      attempt: 0,
      children: new Set(),
      arrived: arrTime,
      pendingChildren: 1,
      onDone: (outcome, payloadRef) => {
        this.finishUnit(unit, outcome, payloadRef);
        const affectedNodes = new Set<string>();
        for (const op of unit.ops) {
          if (op !== rootOp && !op.done) {
            this.cancelOp(op, affectedNodes);
          }
        }
        for (const nid of affectedNodes) {
          this.pumpQueue(nid);
        }
      },
    };

    unit.rootOp = rootOp;
    unit.ops.add(rootOp);
    this.liveOpsCount++;

    const syntheticEdge: ExecutionEdge = {
      endpoint: wl.endpoint,
      id: `__entry:${wl.id}`,
      source: wl.entryNodeId,
      target: wl.entryNodeId,
      transport: 'message',
      latencyMs: 0,
      returnLatencyMs: 0,
      ackDelayMs: 8,
      messageTtlMs: wl.timeoutMs,
      weight: 1,
    };

    // The root is admitted at the broker as a publication; observers need its admission
    // before the message it publishes (every message links to a known parent root).
    this.emitFact({
      kind: 'admitted',
      time: this.currentTime,
      nodeId: rootOp.nodeId,
      unitIdentity: unit.identity,
      category: unit.category,
      attempt: rootOp.attempt,
      path: rootOp.path,
    });
    this.publishMessage(rootOp, syntheticEdge);
  }

  protected finishUnit(unit: Unit, outcome: Outcome, payloadRef?: string): void {
    if (unit.done) return;
    unit.done = true;
    this.liveUnits.delete(unit);
    if (unit.expiryPending) {
      // Its expiry timer is now a no-op, so it no longer counts as work that could still happen.
      unit.expiryPending = false;
      this.workEvents--;
    }
    this.emitFact({
      kind: 'unit_settled',
      time: this.currentTime,
      nodeId: unit.rootOp?.nodeId ?? '',
      unitIdentity: unit.identity,
      category: unit.category,
      attempt: unit.rootOp?.attempt ?? 0,
      path: unit.rootOp?.path ?? '',
      outcome,
      ...(payloadRef !== undefined ? { payloadRef } : {}),
    });
    if (outcome === 'expired' && unit.rootOp) this.traffic(unit.rootOp, 'outcome', undefined, unit.category === 'root' ? 'timeout' : 'expired');
    const elapsedMs = (this.currentTime - unit.born) * 1000;
    if (unit.category === 'root') {
      this.rootsInFlight--;
      if (outcome === 'succeeded') {
        this.rootsSucceeded++;
        this.latencies.push(elapsedMs);
      } else if (outcome === 'rejected') {
        this.rootsRejected++;
      } else if (outcome === 'failed') {
        this.rootsFailed++;
      } else if (outcome === 'expired') {
        this.rootsExpired++;
      }
    } else {
      this.messagesInFlight--;
      if (outcome === 'succeeded') {
        this.messagesSucceeded++;
        this.messageLatencies.push(elapsedMs);
      } else if (outcome === 'rejected') {
        this.messagesRejected++;
      } else if (outcome === 'failed') {
        this.messagesFailed++;
      } else if (outcome === 'expired') {
        this.messagesExpired++;
      }
    }
  }

  private readonly endpointBuckets = new Map<string, { tokens: number; at: number }>();
  /** Ops currently holding a slot of an endpoint with a concurrency cap. */
  private readonly endpointSlots = new Map<string, number>();
  /** The caller side's breaker and in-flight state, keyed by out-port. */
  private readonly callerStates = new Map<
    string,
    { failures: number; state: 'closed' | 'open' | 'half-open'; openUntil: number; probes: number; live: Set<Op> }
  >();
  /** Publishes waiting to travel together, keyed by out-port and edge. */
  private readonly batchBuffers = new Map<string, { entries: Array<(departure: number, leg: number | null) => void>; bytes: number; epoch: number }>();
  private batchSequence = 0;

  /**
   * Seconds one leg of `edge` takes (latency, jitter, transfer time at the link's bandwidth),
   * or null when the leg is lost. Seeded per leg, so chunked and one-shot runs draw alike.
   */
  protected legSeconds(edge: ExecutionEdge, baseMs: number, bytes: number, id: string, lossy = true): number | null {
    const link = edge.link;
    let ms = baseMs;
    if (link) {
      const draw = makeRng((this.seed ^ hashString(`${id}:${edge.id}:leg`)) >>> 0);
      if (lossy && link.lossRate > 0 && draw() * 100 < link.lossRate) return null;
      if (link.jitterMs > 0) ms += draw() * link.jitterMs;
      if (link.bandwidthKbps !== null && bytes > 0) ms += (bytes * 8) / link.bandwidthKbps;
    }
    return ms / 1000;
  }

  private callerState(key: string) {
    let state = this.callerStates.get(key);
    if (!state) {
      state = { failures: 0, state: 'closed', openUntil: 0, probes: 0, live: new Set() };
      this.callerStates.set(key, state);
    }
    return state;
  }

  /** Whether the caller may send now: its in-flight limit and circuit breaker (a half-open breaker lets probes through). */
  protected callerGate(caller: CallerPolicy): 'ok' | 'probe' | 'reject' {
    const st = this.callerState(caller.key);
    if (caller.maxInFlight !== undefined) {
      for (const live of st.live) if (live.done) st.live.delete(live);
      if (st.live.size >= caller.maxInFlight) return 'reject';
    }
    const breaker = caller.breaker;
    if (breaker) {
      if (st.state === 'open') {
        if (this.currentTime < st.openUntil) return 'reject';
        st.state = 'half-open';
        st.probes = 0;
      }
      if (st.state === 'half-open') {
        if (st.probes >= breaker.halfOpenProbes) return 'reject';
        st.probes++;
        return 'probe';
      }
    }
    return 'ok';
  }

  /** What an answered attempt tells the breaker. Fast-failed attempts never reach it. */
  protected callerOutcome(caller: CallerPolicy, outcome: Outcome, wasProbe: boolean): void {
    const breaker = caller.breaker;
    if (!breaker) return;
    const st = this.callerState(caller.key);
    if (wasProbe) st.probes = Math.max(0, st.probes - 1);
    if (outcome === 'succeeded') {
      st.failures = 0;
      if (st.state === 'half-open') st.state = 'closed';
      return;
    }
    st.failures++;
    if (st.state === 'half-open' || st.failures >= breaker.failureThreshold) {
      st.state = 'open';
      st.openUntil = this.currentTime + breaker.openMs / 1000;
      st.failures = 0;
    }
  }

  /** One token per admitted call; refills at `rps` up to `burst`, full at the start. */
  private takeEndpointToken(endpoint: EndpointBehavior): boolean {
    const limit = endpoint.rateLimit!;
    const bucket = this.endpointBuckets.get(endpoint.key) ?? { tokens: limit.burst, at: this.currentTime };
    bucket.tokens = Math.min(limit.burst, bucket.tokens + (this.currentTime - bucket.at) * limit.rps);
    bucket.at = this.currentTime;
    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    this.endpointBuckets.set(endpoint.key, bucket);
    return allowed;
  }

  protected admitOp(op: Op, isRetry: boolean): boolean {
    const nr = this.nodesRuntime.get(op.nodeId)!;
    const node = this.plan.nodes.get(op.nodeId)!;

    const hostId = this.hostPlacement.get(op.nodeId);
    const hostDown = hostId !== undefined && this.hostState.get(hostId) === false;
    // An endpoint's rate limit rejects calls beyond its token bucket; a retry already got in once.
    const overRateLimit = !hostDown && !isRetry && op.endpoint?.rateLimit !== undefined && !this.takeEndpointToken(op.endpoint);
    // An endpoint's concurrency cap rejects calls beyond the slots in use.
    const overCapacity =
      !hostDown && !overRateLimit && !isRetry && op.endpoint?.maxConcurrency !== undefined &&
      (this.endpointSlots.get(op.endpoint.key) ?? 0) >= op.endpoint.maxConcurrency;
    if (hostDown || overRateLimit || overCapacity) {
      // Admission to a host that is actually down is rejected immediately as unavailable,
      // whatever the router knows and regardless of whether this is a first attempt or a
      // retry landing during the outage.
      nr.counters.rejected++;
      op.phase = 'settled';
      op.done = true;
      if (op === op.unit.rootOp) {
        this.emitFact({
          kind: 'rejected',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          category: op.unit.category,
          attempt: op.attempt,
          path: op.path,
        });
      }
      if (op !== op.unit.rootOp) this.traffic(op, 'outcome', undefined, 'rejected');
      this.finishOp(op, 'rejected');
      this.releaseOp(op);
      return false;
    }

    if (!isRetry && op.endpoint?.maxConcurrency !== undefined && op.slotKey === undefined) {
      op.slotKey = op.endpoint.key;
      this.endpointSlots.set(op.slotKey, (this.endpointSlots.get(op.slotKey) ?? 0) + 1);
    }

    if (!isRetry) {
      nr.counters.arrived++;
    }

    if (node.behavior.type === 'source') {
      nr.counters.admitted++;
      if (!isRetry && op === op.unit.rootOp) {
        this.emitFact({
          kind: 'admitted',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          category: op.unit.category,
          attempt: op.attempt,
          path: op.path,
        });
      }
      this.startSourceProcessing(op);
      return true;
    }

    if (node.behavior.type === 'broker') {
      const qLimit = node.behavior.queueLimit;
      const sub = op.subscription;
      let matchingQueueCount = 0;
      for (const queuedOp of nr.queue) {
        if (node.behavior.delivery === 'broadcast') {
          if (queuedOp.subscription === sub) matchingQueueCount++;
        } else {
          matchingQueueCount++;
        }
      }

      const candidates = this.getReadyBrokerConsumers(op.nodeId, sub);
      if (matchingQueueCount === 0 && candidates.length > 0) {
        nr.counters.admitted++;
        if (!isRetry && op === op.unit.rootOp) {
          this.emitFact({
            kind: 'admitted',
            time: this.currentTime,
            nodeId: op.nodeId,
            unitIdentity: op.unit.identity,
            category: op.unit.category,
            attempt: op.attempt,
            path: op.path,
          });
        }
        const chosenEdge = candidates[0];
        this.reserveBrokerConsumer(op, chosenEdge);
        return true;
      }

      if (matchingQueueCount < qLimit) {
        nr.counters.admitted++;
        if (!isRetry && op === op.unit.rootOp) {
          this.emitFact({
            kind: 'admitted',
            time: this.currentTime,
            nodeId: op.nodeId,
            unitIdentity: op.unit.identity,
            category: op.unit.category,
            attempt: op.attempt,
            path: op.path,
          });
        }
        op.phase = 'queued';
        nr.queue.push(op);
        this.emitFact({
          kind: 'queued',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          attempt: op.attempt,
          path: op.path,
        });
        if (candidates.length === 0) this.observeBrokerBlock(op);
        return true;
      }

      nr.counters.rejected++;
      op.phase = 'settled';
      op.done = true;
      if (!isRetry && op === op.unit.rootOp) {
        this.emitFact({
          kind: 'rejected',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          category: op.unit.category,
          attempt: op.attempt,
          path: op.path,
        });
      }
      if (op !== op.unit.rootOp) this.traffic(op, 'outcome', undefined, 'rejected');
      this.finishOp(op, 'rejected');
      this.releaseOp(op);
      return false;
    }

    if (nr.active.size < node.behavior.concurrency) {
      if (!isRetry) nr.counters.admitted++;
      if (!isRetry && op === op.unit.rootOp) {
        this.emitFact({
          kind: 'admitted',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          category: op.unit.category,
          attempt: op.attempt,
          path: op.path,
        });
      }
      this.startProcessing(op);
      return true;
    }

    if (nr.queue.length < node.behavior.queueLimit) {
      if (!isRetry) nr.counters.admitted++;
      if (!isRetry && op === op.unit.rootOp) {
        this.emitFact({
          kind: 'admitted',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          category: op.unit.category,
          attempt: op.attempt,
          path: op.path,
        });
      }
      op.phase = 'queued';
      nr.queue.push(op);
      this.emitFact({
        kind: 'queued',
        time: this.currentTime,
        nodeId: op.nodeId,
        unitIdentity: op.unit.identity,
        attempt: op.attempt,
        path: op.path,
      });
      return true;
    }

    if (!isRetry) {
      nr.counters.rejected++;
      op.phase = 'settled';
      op.done = true;
      if (op === op.unit.rootOp) {
        this.emitFact({
          kind: 'rejected',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          category: op.unit.category,
          attempt: op.attempt,
          path: op.path,
        });
      }
      if (op !== op.unit.rootOp) this.traffic(op, 'outcome', undefined, 'rejected');
      this.finishOp(op, 'rejected');
      this.releaseOp(op);
    } else {
      nr.counters.failed++;
      op.phase = 'settled';
      op.done = true;
      this.finishOp(op, 'failed');
      this.releaseOp(op);
    }
    return false;
  }

  protected startSourceProcessing(op: Op): void {
    const nr = this.nodesRuntime.get(op.nodeId)!;
    nr.waitingSources.add(op);
    this.emitFact({
      kind: 'started',
      time: this.currentTime,
      nodeId: op.nodeId,
      unitIdentity: op.unit.identity,
      attempt: op.attempt,
      path: op.path,
    });
    this.traffic(op, 'slot_released');
    this.dispatchDownstream(op);
  }

  protected startProcessing(op: Op): void {
    const nr = this.nodesRuntime.get(op.nodeId)!;
    const node = this.plan.nodes.get(op.nodeId)!;

    nr.active.add(op);
    op.phase = 'processing';
    op.attempt++;
    nr.counters.attempts++;

    this.emitFact({
      kind: 'started',
      time: this.currentTime,
      nodeId: op.nodeId,
      unitIdentity: op.unit.identity,
      attempt: op.attempt,
      path: op.path,
    });

    let procTime: number;
    if (op.endpoint?.serviceTimeMs !== undefined) {
      procTime = op.endpoint.serviceTimeMs / 1000;
    } else if (node.behavior.type === 'storage') {
      const isWrite = op.unit.requestClass.operation === 'write';
      const cap = isWrite ? node.behavior.writeCapacity : node.behavior.capacity;
      procTime = 1 / cap;
    } else {
      procTime = 1 / node.behavior.capacity;
    }
    if (node.behavior.serviceTime === 'exponential' || node.behavior.serviceTime === 'lognormal') {
      // Seeded per unit, path and attempt, so chunked and one-shot runs draw alike.
      const draw = makeRng((this.seed ^ hashString(`${op.unit.identity}:${op.path}:${op.attempt}:service`)) >>> 0);
      const u = Math.min(1 - 1e-12, Math.max(1e-12, draw()));
      if (node.behavior.serviceTime === 'exponential') {
        procTime *= -Math.log(1 - u);
      } else {
        // Lognormal with mean 1 and coefficient of variation cv: sigma^2 = ln(1 + cv^2),
        // mu = -sigma^2 / 2; the normal comes from Box-Muller over two draws.
        const u2 = Math.min(1 - 1e-12, Math.max(1e-12, draw()));
        const cv = node.behavior.serviceTimeCv;
        if (cv === undefined) throw new Error(`lognormal service time on '${op.nodeId}' has no serviceTimeCv`);
        const sigma2 = Math.log(1 + cv ** 2);
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * u2);
        procTime *= Math.exp(-sigma2 / 2 + Math.sqrt(sigma2) * z);
      }
    }

    const completeTime = this.currentTime + procTime;
    let cancelled = false;
    this.pendingCompletionCancels.set(op, () => {
      cancelled = true;
    });
    this.scheduleEvent(completeTime, 1, () => {
      this.pendingCompletionCancels.delete(op);
      if (cancelled || op.cancelled) {
        return;
      }
      this.handleProcessingCompletion(op);
    });
  }

  protected handleProcessingCompletion(op: Op): void {
    const nr = this.nodesRuntime.get(op.nodeId)!;
    const node = this.plan.nodes.get(op.nodeId)!;

    if (op.done) {
      nr.active.delete(op);
      this.pumpQueue(op.nodeId);
      this.releaseOp(op);
      return;
    }

    const failRng = makeRng(
      (this.seed ^
        hashString(op.unit.workloadId) ^
        op.unit.ordinal ^
        hashString(op.path) ^
        op.attempt) >>>
        0
    );
    const failed = failRng() * 100 < (op.endpoint?.failureRate ?? node.behavior.failureRate);

    if (failed) {
      this.emitFact({
        kind: 'attempt_settled',
        time: this.currentTime,
        nodeId: op.nodeId,
        unitIdentity: op.unit.identity,
        attempt: op.attempt,
        path: op.path,
        outcome: 'failed',
      });
      nr.active.delete(op);
      this.pumpQueue(op.nodeId);

      if (op.attempt <= node.behavior.maxRetries) {
        nr.counters.retries++;
        op.phase = 'retrying';
        nr.retrying.add(op);
        const retryTime = this.currentTime + node.behavior.retryDelayMs / 1000;
        this.traffic(op, 'retry', undefined, undefined, retryTime);
        this.scheduleEvent(retryTime, 2, () => {
          if (op.done || op.unit.done) {
            nr.retrying.delete(op);
            this.releaseOp(op);
            return;
          }
          nr.retrying.delete(op);
          this.admitOp(op, true);
        });
      } else {
        if (node.behavior.maxRetries > 0) this.traffic(op, 'outcome', undefined, 'retryExhausted');
        nr.counters.failed++;
        op.phase = 'settled';
        op.done = true;
        this.finishOp(op, 'failed');
        this.releaseOp(op);
      }
      return;
    }

    if (node.behavior.type === 'cache') {
      const cs = nr.cacheState!;
      const isWrite = op.unit.requestClass.operation === 'write';
      if (isWrite) {
        cs.writes++;
        if (node.behavior.mode !== 'lru' || op.unit.key != null) {
          op.cacheAction = 'invalidate';
        }
      } else {
        let hit = false;
        if (node.behavior.mode === 'fixed') {
          const draw = makeRng(
            (this.seed ^ hashString(`${op.unit.identity}:${op.path}:cache`)) >>> 0
          );
          hit = draw() * 100 < node.behavior.hitRate;
        } else if (op.unit.key != null) {
          hit = cs.runtime!.get(op.unit.key, this.currentTime);
        } else {
          hit = false;
        }

        if (hit) {
          cs.hits++;
          this.emitFact({
            kind: 'attempt_settled',
            time: this.currentTime,
            nodeId: op.nodeId,
            unitIdentity: op.unit.identity,
            attempt: op.attempt,
            path: op.path,
            outcome: 'succeeded',
          });
          this.completeLocalOp(op);
          return;
        }

        cs.misses++;
        if (node.behavior.mode !== 'lru' || op.unit.key != null) {
          op.cacheAction = 'fill';
        }
      }
    }

    this.emitFact({
      kind: 'attempt_settled',
      time: this.currentTime,
      nodeId: op.nodeId,
      unitIdentity: op.unit.identity,
      attempt: op.attempt,
      path: op.path,
      outcome: 'succeeded',
    });

    this.dispatchDownstream(op);
  }

  protected selectOutgoing(op: Op, outgoing: ExecutionEdge[]): ExecutionEdge[] {
    const node = this.plan.nodes.get(op.nodeId)!;
    if (node.behavior.type === 'router') {
      if (this.faults.length === 0) {
        const draw = makeRng(
          (this.seed ^ hashString(`${op.unit.identity}:${op.path}:route`)) >>> 0
        );
        const selected = this.routeSelector.select(
          node,
          outgoing,
          op.unit.requestClass,
          draw
        );
        return [selected];
      }

      // Fault-enabled router logic: filter outgoing edges by routerDetectedHostState
      const eligible = outgoing.filter((edge) => {
        const targetHost = this.hostPlacement.get(edge.target);
        if (targetHost === undefined) return true;
        return this.routerDetectedHostState.get(targetHost) !== false;
      });

      if (eligible.length === 0) {
        // Advance round robin cursor even on rejected selection
        if (node.behavior.strategy === 'round-robin') {
          const cursor = this.roundRobinCursors.get(node.id) ?? 0;
          this.roundRobinCursors.set(node.id, cursor + 1);
        }
        return [];
      }

      const strategy = node.behavior.strategy;
      if (strategy === 'round-robin') {
        const cursor = this.roundRobinCursors.get(node.id) ?? 0;
        const selected = eligible[cursor % eligible.length];
        this.roundRobinCursors.set(node.id, cursor + 1);
        return [selected];
      }

      if (strategy === 'weighted') {
        const draw = makeRng(
          (this.seed ^ hashString(`${op.unit.identity}:${op.path}:route`)) >>> 0
        );
        let maxWeight = 0;
        for (const edge of eligible) {
          if (edge.weight > maxWeight) maxWeight = edge.weight;
        }
        const safeMax = maxWeight > 0 ? maxWeight : 1;
        let totalNormalizedWeight = 0;
        for (const edge of eligible) {
          totalNormalizedWeight += edge.weight / safeMax;
        }
        let roll = draw() * totalNormalizedWeight;
        for (const edge of eligible) {
          const w = edge.weight / safeMax;
          if (roll <= w) return [edge];
          roll -= w;
        }
        return [eligible[eligible.length - 1]];
      }

      if (strategy === 'conditional') {
        let fallbackEdge: ExecutionEdge | undefined;
        for (const edge of eligible) {
          if (edge.fallback) {
            fallbackEdge = edge;
            continue;
          }
          const condition = edge.condition;
          if (!condition) continue;
          let matched = false;
          if (condition.field === 'class') {
            matched = op.unit.requestClass.name === condition.value;
          } else if (condition.field === 'operation') {
            matched = op.unit.requestClass.operation === condition.value;
          } else if (condition.field === 'tag') {
            matched = op.unit.requestClass.tags.includes(condition.value);
          }
          if (matched) return [edge];
        }
        if (fallbackEdge) return [fallbackEdge];
        return [];
      }

      return [eligible[0]];
    }
    return outgoing;
  }

  protected dispatchDownstream(op: Op): void {
    const allOutgoing = this.plan.outgoing.get(op.nodeId) || [];
    if (allOutgoing.length === 0) {
      // Bridge call frames: a non-router resource with no in-kernel
      // outgoing edge but a declared bridge continuation waits, exactly like a retained
      // call chain, for an external settleCall() instead of completing locally. Routers
      // always select exactly one route themselves (never reach this branch with zero
      // real edges when a bridge is configured), so bridging is narrowed here to
      // non-router resources.
      const node = this.plan.nodes.get(op.nodeId)!;
      const bridge = node.behavior.type !== 'router' ? this.bridgeByNode.get(op.nodeId) : undefined;
      if (bridge) {
        op.phase = 'waiting';
        op.pendingChildren = 1;
        op.failedChild = false;
        this.traffic(op, 'await', bridge.connectionId);
        this.openBridgeFrame(op, bridge, 1);
        return;
      }
      this.completeLocalOp(op);
      return;
    }

    const selectedOutgoing = this.selectOutgoing(op, allOutgoing);
    if (selectedOutgoing.length === 0) {
      const node = this.plan.nodes.get(op.nodeId)!;
      if (node.behavior.type === 'router') {
        const nr = this.nodesRuntime.get(op.nodeId)!;
        nr.active.delete(op);
        this.pumpQueue(op.nodeId);
        nr.counters.rejected++;
        op.phase = 'settled';
        op.done = true;
        if (op === op.unit.rootOp) {
          this.emitFact({
            kind: 'rejected',
            time: this.currentTime,
            nodeId: op.nodeId,
            unitIdentity: op.unit.identity,
            category: op.unit.category,
            attempt: op.attempt,
            path: op.path,
          });
        }
        if (op !== op.unit.rootOp) this.traffic(op, 'outcome', undefined, 'rejected');
        this.finishOp(op, 'rejected');
        this.releaseOp(op);
        return;
      }
      this.completeLocalOp(op);
      return;
    }

    op.phase = 'waiting';
    op.pendingChildren = selectedOutgoing.length;
    op.failedChild = false;

    // a router is an event-driven proxy. Once it has forwarded a request
    // its slot is free for the next one; the forwarded request waits without a slot.
    const dispatchingNode = this.plan.nodes.get(op.nodeId)!;
    if (dispatchingNode.behavior.type === 'router') {
      const nr = this.nodesRuntime.get(op.nodeId)!;
      nr.active.delete(op);
      this.traffic(op, 'slot_released');
      nr.waitingSources.add(op);
      this.pumpQueue(op.nodeId);
    }

    for (const edge of selectedOutgoing) {
      this.emitFact({
        kind: 'route_selected',
        time: this.currentTime,
        nodeId: op.nodeId,
        unitIdentity: op.unit.identity,
        attempt: op.attempt,
        path: op.path,
        edgeId: edge.id,
      });

      if (edge.transport === 'message') {
        this.publishMessage(op, edge);
        continue;
      }

      this.dispatchCallAttempt(op, edge, 1);
    }
  }

  /**
   * One attempt of a call from `op` along `edge`. With a retry policy on the edge, a rejected, failed or timed-out attempt is retried by the caller after a
   * backoff; the caller keeps waiting (and a non-router caller keeps its slot) meanwhile.
   * Only the final outcome reaches handleChildResponse.
   */
  protected dispatchCallAttempt(op: Op, edge: ExecutionEdge, attemptNo: number, policy?: CallRetryPolicy | null, logicalEdgeId = edge.id): void {
    this.traffic(op, 'await', logicalEdgeId, undefined, undefined, edge.target);
    const em = this.edgeMetrics.get(edge.id)!;
    em.sent++;
    // The first attempt's route sets the policy for the whole retry chain, even when a
    // router retries on another route.
    const retry = policy !== undefined ? policy : (edge.retry ?? null);
    const caller = edge.caller;

    const childPath = attemptNo === 1 ? `${op.path}>${edge.id}` : `${op.path}>${edge.id}~${attemptNo}`;
    // The caller's in-flight limit and circuit breaker can turn the attempt away before it is sent.
    const gate = caller ? this.callerGate(caller) : 'ok';
    // Resolved when the caller learns the attempt's outcome: its response arrives, or the
    // attempt timeout fires first (a response still on its way back is then ignored).
    let resolved = false;
    const copies: Op[] = [];
    let outstanding = 0;
    let hedgePending = false;
    const resolveAttempt = (childOutcome: Outcome) => {
      if (resolved) return;
      if (childOutcome === 'expired') this.traffic(op, 'outcome', undefined, 'timeout');
      resolved = true;
      hedgePending = false;
      em.responses++;
      if (caller && gate !== 'reject') this.callerOutcome(caller, childOutcome, gate === 'probe');
      // A hedged copy that lost the race is abandoned like a timed-out attempt.
      const abandoned = new Set<string>();
      for (const copy of copies) {
        if (!copy.done) {
          this.cancelOp(copy, abandoned);
          op.children.delete(copy);
        }
      }
      for (const nid of abandoned) this.pumpQueue(nid);
      if (childOutcome !== 'succeeded' && retry && attemptNo < retry.maxAttempts && !op.done && !op.unit.done) {
        this.scheduleCallRetry(op, edge, attemptNo, retry, logicalEdgeId);
        return;
      }
      this.traffic(op, 'await_resolved', logicalEdgeId);
      if (childOutcome !== 'succeeded' && retry && attemptNo >= retry.maxAttempts) this.traffic(op, 'outcome', undefined, 'retryExhausted');
      this.handleChildResponse(op, childOutcome);
    };
    if (gate === 'reject') {
      this.traffic(op, 'outcome', edge.id, 'rejected');
      // Fails fast, as if the callee had turned the call away.
      em.rejected++;
      this.scheduleEvent(this.currentTime, 1, () => resolveAttempt('rejected'));
      return;
    }
    // One copy of the call has an outcome; the attempt succeeds with the first success and fails when no copy is left.
    const settleCopy = (copyOutcome: Outcome, atCaller: number) => {
      this.scheduleEvent(atCaller, 1, () => {
        if (resolved) { this.traffic(op, 'outcome', edge.id, 'late'); return; }
        if (copyOutcome === 'succeeded') {
          resolveAttempt('succeeded');
          return;
        }
        outstanding--;
        if (outstanding <= 0) resolveAttempt(copyOutcome);
      });
    };

    const sendCopy = (copyNo: number) => {
      const path = copyNo === 0 ? childPath : `${childPath}^h${copyNo}`;
      const identity = `${op.unit.identity}:${path}`;
      const requestLeg = this.legSeconds(edge, edge.latencyMs, caller?.requestBytes ?? 0, `${identity}:req`);
      const childOp: Op = {
        unit: op.unit,
        nodeId: edge.target,
        path,
        phase: 'transit',
        endpoint: edge.endpoint,
        done: false,
        attempt: 0,
        children: new Set(),
        arrived: this.currentTime + (requestLeg ?? edge.latencyMs / 1000),
        onDone: (childOutcome) => {
          const responseLeg = this.legSeconds(edge, edge.returnLatencyMs, edge.endpoint?.responseBytes ?? 0, `${identity}:res`);
          // A lost response never reaches the caller: it waits for its timeout or deadline.
          if (responseLeg !== null) {
            this.emitFact({
              kind: 'response_sent',
              time: this.currentTime,
              nodeId: edge.target,
              unitIdentity: op.unit.identity,
              attempt: attemptNo,
              path,
              edgeId: edge.id,
              outcome: childOutcome,
              arriveAt: this.currentTime + responseLeg,
            });
            settleCopy(childOutcome, this.currentTime + responseLeg);
          } else this.traffic(op, 'outcome', edge.id, 'lost');
        },
      };
      copies.push(childOp);
      outstanding++;
      if (caller) this.callerState(caller.key).live.add(childOp);
      if (copyNo > 0) em.sent++;

      op.children.add(childOp);
      op.unit.ops.add(childOp);
      this.liveOpsCount++;

      this.emitFact({
        kind: 'sent',
        time: this.currentTime,
        nodeId: edge.target,
        unitIdentity: op.unit.identity,
        attempt: attemptNo,
        path,
        edgeId: edge.id,
        ...(requestLeg === null ? {} : { arriveAt: this.currentTime + requestLeg }),
      });
      // A lost request never arrives: the copy stays in flight until it is given up on.
      if (requestLeg === null) return;
      this.scheduleEvent(this.currentTime + requestLeg, 2, () => {
        if (childOp.done || childOp.unit.done) {
          this.releaseOp(childOp);
          return;
        }
        const admitted = this.admitOp(childOp, false);
        if (admitted) {
          em.admitted++;
        } else {
          em.rejected++;
        }
      });
    };

    sendCopy(0);

    if (caller?.hedgeAfterMs !== undefined) {
      hedgePending = true;
      this.scheduleEvent(this.currentTime + caller.hedgeAfterMs / 1000, 1, () => {
        if (!hedgePending || resolved || op.done || op.unit.done) return;
        hedgePending = false;
        sendCopy(1);
      });
    }

    if (retry && retry.attemptTimeoutMs !== null) {
      // The caller stops waiting for this attempt; the abandoned work is cancelled.
      this.scheduleEvent(this.currentTime + retry.attemptTimeoutMs / 1000, 1, () => {
        if (resolved || op.done || op.unit.done) return;
        // The callee isn't told the caller gave up: work already in service keeps its slot
        // until it completes (wasted work), queued work is dropped. resolveAttempt cancels the copies.
        resolveAttempt('expired');
      });
    }
  }

  /** Waits the backoff for `attemptNo`, then sends the next attempt. */
  protected scheduleCallRetry(op: Op, edge: ExecutionEdge, attemptNo: number, retry: NonNullable<ExecutionEdge['retry']>, logicalEdgeId = edge.id): void {
    let delayMs = Math.min(retry.maxBackoffMs, retry.backoffMs * Math.pow(retry.backoffMultiplier, attemptNo - 1));
    if (retry.jitter) {
      const draw = makeRng((this.seed ^ hashString(`${op.unit.identity}:${op.path}>${edge.id}:${attemptNo}:jitter`)) >>> 0);
      delayMs *= draw();
    }
    let retries = this.callRetries.get(edge.id) ?? 0;
    this.callRetries.set(edge.id, ++retries);
    this.emitFact({
      kind: 'call_retry',
      time: this.currentTime,
      nodeId: op.nodeId,
      unitIdentity: op.unit.identity,
      attempt: attemptNo + 1,
      path: op.path,
      edgeId: edge.id,
    });
    this.traffic(op, 'retry', logicalEdgeId, undefined, this.currentTime + delayMs / 1000);
    this.scheduleEvent(this.currentTime + delayMs / 1000, 2, () => {
      if (op.done || op.unit.done) return;
      this.dispatchCallAttempt(op, this.retryRoute(op, edge), attemptNo + 1, retry, logicalEdgeId);
    });
  }

  /**
   * A router retries on another route when one qualifies: the next healthy route for
   * round robin, a fresh weighted draw among the others; a conditional router keeps the
   * route its conditions chose. Otherwise the retry stays on the same route.
   */
  protected retryRoute(op: Op, failed: ExecutionEdge): ExecutionEdge {
    const node = this.plan.nodes.get(op.nodeId)!;
    if (node.behavior.type !== 'router') return failed;
    const routes = (this.plan.outgoing.get(op.nodeId) ?? []).filter((e) => e.transport === 'call');
    const failedAt = routes.indexOf(failed);
    // Route order starting after the failed route, so a retry doesn't move the router's
    // round-robin cursor (nginx-style "next upstream").
    const others = [...routes.slice(failedAt + 1), ...routes.slice(0, Math.max(0, failedAt))];
    if (others.length === 0) return failed;
    // A conditional router's route was chosen by the request itself; keep it.
    if (node.behavior.strategy === 'conditional') return failed;
    let next: ExecutionEdge | undefined;
    if (node.behavior.strategy === 'round-robin') {
      next = others.find((e) => {
        const host = this.hostPlacement.get(e.target);
        return this.faults.length === 0 || host === undefined || this.routerDetectedHostState.get(host) !== false;
      });
    } else {
      [next] = this.selectOutgoing(op, others);
    }
    if (!next) return failed;
    this.emitFact({
      kind: 'route_selected',
      time: this.currentTime,
      nodeId: op.nodeId,
      unitIdentity: op.unit.identity,
      attempt: op.attempt,
      path: op.path,
      edgeId: next.id,
    });
    return next;
  }

  protected publishMessage(parentOp: Op, edge: ExecutionEdge): void {
    const targetNode = this.plan.nodes.get(edge.target)!;
    if (targetNode.behavior.type === 'broker' && targetNode.behavior.delivery === 'broadcast') {
      const subscriptions = (this.plan.outgoing.get(targetNode.id) || []).map(e => e.id);
      if (subscriptions.length > 0) {
        if (parentOp.pendingChildren !== undefined) {
          parentOp.pendingChildren += subscriptions.length - 1;
        }
        for (const sub of subscriptions) {
          this.publishDelivery(parentOp, edge, sub);
        }
        return;
      }
    }
    this.publishDelivery(parentOp, edge, undefined);
  }

  protected publishDelivery(parentOp: Op, edge: ExecutionEdge, subscription?: string): void {
    const isSynthetic = parentOp.publicationOnly === true;
    const em = isSynthetic
      ? { sent: 0, admitted: 0, rejected: 0, responses: 0 }
      : this.edgeMetrics.get(edge.id)!;
    em.sent++;
    this.messagesGenerated++;
    this.messagesInFlight++;

    const parentUnit = parentOp.unit;
    const hops = parentUnit.hops + 1;
    const born = this.currentTime;
    // No TTL means the message never expires; unconsumed, it is reported stuck at quiescence.
    const edgeDeadline = edge.messageTtlMs === null ? Infinity : born + edge.messageTtlMs / 1000;
    const deadline = Math.min(edgeDeadline, parentUnit.lineageDeadline);
    const lineageDeadline = deadline;
    const identity = `${parentUnit.identity}:${parentOp.path}:${edge.id}:${subscription ?? ''}`;

    this.emitFact({
      kind: 'message_created',
      time: this.currentTime,
      nodeId: edge.target,
      unitIdentity: identity,
      attempt: 0,
      path: `${parentOp.path}>${edge.id}`,
      parentIdentity: parentUnit.identity,
      edgeId: edge.id,
    });

    const messageUnit: Unit = {
      category: 'message',
      hops,
      lineageDeadline,
      identity,
      workloadId: parentUnit.workloadId,
      ordinal: parentUnit.ordinal,
      born,
      deadline,
      requestClass: parentUnit.requestClass,
      key: parentUnit.key,
      done: false,
      ops: new Set(),
    };
    this.liveUnits.add(messageUnit);

    let ackScheduled = false;
    const caller = isSynthetic ? undefined : edge.caller;
    // Fire and forget. The publisher moves on at once and never hears of the delivery's fate.
    if (caller?.confirm === false) {
      ackScheduled = true;
      this.scheduleEvent(this.currentTime, 1, () => {
        em.responses++;
        this.handleChildResponse(parentOp, 'succeeded');
      });
    }

    if (Number.isFinite(deadline)) this.scheduleEvent(deadline, 0, () => {
      if (!messageUnit.done) {
        this.expireUnit(messageUnit);
        if (!ackScheduled) {
          ackScheduled = true;
          const ackDeliveryTime = deadline + edge.returnLatencyMs / 1000;
          this.scheduleEvent(ackDeliveryTime, 1, () => {
            em.responses++;
            this.handleChildResponse(parentOp, 'failed');
          });
        }
      }
    }, { unit: messageUnit });

    const msgOpPath = `${parentOp.path}>${edge.id}`;
    const msgRootOp: Op = {
      unit: messageUnit,
      nodeId: edge.target,
      path: msgOpPath,
      phase: 'transit',
      endpoint: edge.endpoint,
      done: false,
      attempt: 0,
      children: new Set(),
      arrived: born + edge.latencyMs / 1000,
      subscription,
      onDone: (outcome) => {
        this.finishUnit(messageUnit, outcome);
      },
    };

    messageUnit.rootOp = msgRootOp;
    messageUnit.ops.add(msgRootOp);
    this.liveOpsCount++;

    // The message travels once its leg is known: at once, or with the batch it was held for.
    // A lost leg never arrives, so the message expires at its TTL.
    const travel = (departure: number, requestLeg: number | null) => {
      this.emitFact({
        kind: 'sent',
        time: departure,
        nodeId: edge.target,
        unitIdentity: identity,
        attempt: 0,
        path: msgOpPath,
        edgeId: edge.id,
        ...(requestLeg === null ? {} : { arriveAt: departure + requestLeg }),
      });
      if (requestLeg === null) return;
      const arrivalTime = departure + requestLeg;
      msgRootOp.arrived = arrivalTime;
      this.scheduleEvent(arrivalTime, 2, () => {
        if (msgRootOp.done || messageUnit.done) {
          this.releaseOp(msgRootOp);
          return;
        }

        if (hops > 64) {
          em.rejected++;
          this.finishUnit(messageUnit, 'failed');
          this.releaseOp(msgRootOp);
          if (!ackScheduled) {
            ackScheduled = true;
            em.responses++;
            this.handleChildResponse(parentOp, 'failed');
          }
          return;
        }

        const admitted = this.admitOp(msgRootOp, false);
        if (admitted) {
          em.admitted++;
        } else {
          em.rejected++;
        }

        if (!ackScheduled) {
          ackScheduled = true;
          const ackLeg = this.legSeconds(edge, edge.returnLatencyMs, 0, `${identity}:ack`);
          // A lost acknowledgement never reaches the publisher.
          if (ackLeg !== null) {
            this.emitFact({ kind: 'response_sent', time: this.currentTime, departAt: arrivalTime + edge.ackDelayMs / 1000, nodeId: edge.target,
              unitIdentity: identity, attempt: 0, path: msgOpPath, edgeId: edge.id,
              outcome: admitted ? 'succeeded' : 'failed', arriveAt: arrivalTime + edge.ackDelayMs / 1000 + ackLeg });
            this.scheduleEvent(arrivalTime + edge.ackDelayMs / 1000 + ackLeg, 1, () => {
              em.responses++;
              this.handleChildResponse(parentOp, admitted ? 'succeeded' : 'failed');
            });
          } else this.traffic(parentOp, 'outcome', edge.id, 'lost');
        }
      });
    };

    const bytes = caller?.requestBytes ?? 0;
    const batch = caller?.batch;
    if (!batch) {
      travel(born, this.legSeconds(edge, edge.latencyMs, bytes, `${identity}:req`));
      return;
    }

    // Hold the publish until `size` have gathered or `windowMs` has passed, then send them over one hop.
    const bufferKey = `${caller!.key}>${edge.id}`;
    let buffer = this.batchBuffers.get(bufferKey);
    if (!buffer) {
      buffer = { entries: [], bytes: 0, epoch: 0 };
      this.batchBuffers.set(bufferKey, buffer);
    }
    const flush = () => {
      const held = this.batchBuffers.get(bufferKey);
      if (!held || held.entries.length === 0) return;
      const entries = held.entries.splice(0);
      const total = held.bytes;
      held.bytes = 0;
      held.epoch++;
      const leg = this.legSeconds(edge, edge.latencyMs, total, `${bufferKey}:batch:${++this.batchSequence}`);
      for (const send of entries) send(this.currentTime, leg);
    };
    buffer.entries.push(travel);
    buffer.bytes += bytes;
    if (buffer.entries.length >= batch.size) {
      flush();
    } else if (buffer.entries.length === 1) {
      const epoch = buffer.epoch;
      this.scheduleEvent(this.currentTime + batch.windowMs / 1000, 1, () => {
        if (this.batchBuffers.get(bufferKey)?.epoch === epoch) flush();
      });
    }
  }

  protected handleChildResponse(parentOp: Op, outcome: Outcome): void {
    if (parentOp.done || parentOp.unit.done) return;

    if (outcome !== 'succeeded') {
      if (!parentOp.failedChild) {
        if (parentOp.publicationOnly) {
          parentOp.failedChild = true;
          parentOp.phase = 'settled';
          parentOp.done = true;
          this.finishOp(parentOp, 'failed');
          this.releaseOp(parentOp);
          return;
        }

        parentOp.failedChild = true;
        const affectedNodes = new Set<string>();
        for (const sibling of parentOp.children) {
          if (sibling !== parentOp && !sibling.done) {
            this.cancelOp(sibling, affectedNodes);
          }
        }
        for (const nid of affectedNodes) {
          this.pumpQueue(nid);
        }

        const nr = this.nodesRuntime.get(parentOp.nodeId)!;
        const node = this.plan.nodes.get(parentOp.nodeId)!;
        if (node.behavior.type === 'source') {
          nr.waitingSources.delete(parentOp);
        } else if (node.behavior.type === 'broker' || node.behavior.type === 'router') {
          nr.waitingSources.delete(parentOp);
        } else {
          nr.active.delete(parentOp);
          this.pumpQueue(parentOp.nodeId);
        }
        if (node.behavior.type === 'router' && outcome === 'rejected') {
          nr.counters.rejected++;
          parentOp.phase = 'settled';
          parentOp.done = true;
          this.finishOp(parentOp, 'rejected');
          this.releaseOp(parentOp);
        } else {
          nr.counters.failed++;
          parentOp.phase = 'settled';
          parentOp.done = true;
          this.finishOp(parentOp, 'failed');
          this.releaseOp(parentOp);
        }
      }
      return;
    }

    if (parentOp.failedChild) return;

    if (parentOp.pendingChildren !== undefined) {
      parentOp.pendingChildren--;
      if (parentOp.pendingChildren === 0) {
        this.completeLocalOp(parentOp);
      }
    }
  }

  protected completeLocalOp(op: Op): void {
    const nr = this.nodesRuntime.get(op.nodeId)!;
    const node = this.plan.nodes.get(op.nodeId)!;

    if (node.behavior.type === 'cache' && nr.cacheState && op.cacheAction) {
      if (nr.cacheState.runtime && op.unit.key != null) {
        if (op.cacheAction === 'fill') {
          nr.cacheState.runtime.put(op.unit.key, this.currentTime);
        } else if (op.cacheAction === 'invalidate') {
          nr.cacheState.runtime.invalidate(op.unit.key, this.currentTime);
        }
      }
    }

    if (op.publicationOnly) {
      op.phase = 'settled';
      op.done = true;
      this.finishOp(op, 'succeeded');
      this.releaseOp(op);
      return;
    }

    if (node.behavior.type === 'source') {
      nr.waitingSources.delete(op);
    } else if (node.behavior.type === 'broker' || node.behavior.type === 'router') {
      nr.waitingSources.delete(op);
    } else {
      nr.active.delete(op);
      this.pumpQueue(op.nodeId);
    }
    nr.counters.completed++;
    op.phase = 'settled';
    op.done = true;
    this.finishOp(op, 'succeeded');
    this.releaseOp(op);
  }

  /**
   * Bridge call frames: completes the resource op that was waiting on an
   * external settleCall(), adopting the bridge child's exact outcome (not collapsed to
   * 'failed' the way a retained in-kernel child's non-succeeded outcome is) and its
   * payload. This is deliberately a separate path from handleChildResponse: the parent adopts the child's
   * outcome and returns the child's payload for bridge frames specifically, whereas handleChildResponse's generic non-router rule collapses
   * every non-succeeded child outcome to 'failed'. Resource -> resource -> bridge chains
   * are unaffected: the outer resource's own childOp still resolves via the retained
   * handleChildResponse path (the outer resource keeps retained handling).
   */
  /**
   * Opens one bridge attempt (frames and retries). With a retry policy, a
   * rejected, failed or timed-out attempt opens a new frame after the backoff; a reply to
   * an abandoned frame is ignored.
   */
  protected openBridgeFrame(op: Op, bridge: KernelBridgeConfig, attemptNo: number): void {
    const frameId = `bridge:${op.unit.identity}:${++this.bridgeFrameCounter}`;
    this.observedBridgeFrames.set(frameId, op);
    op.bridgeFrameId = frameId;
    this.bridgePendingOps.set(frameId, op);
    this.bridgeAttempts.set(frameId, attemptNo);
    this.emitFact({
      kind: 'bridge_dispatch',
      time: this.currentTime,
      nodeId: op.nodeId,
      unitIdentity: op.unit.identity,
      attempt: op.attempt,
      path: op.path,
      frameId,
    });
    const timeoutMs = bridge.retry?.attemptTimeoutMs ?? null;
    if (timeoutMs !== null) {
      this.scheduleEvent(this.currentTime + timeoutMs / 1000, 1, () => {
        // The reply arrived first: this timer was the frame's last pending event.
        if (this.resolvedBridgeFrames.delete(frameId) || op.done || op.unit.done) return;
        if (this.bridgePendingOps.delete(frameId)) this.abandonedBridgeFrames.add(frameId);
        this.resolveBridgeAttempt(op, bridge, frameId, 'expired');
      });
    }
  }

  protected resolveBridgeAttempt(op: Op, bridge: KernelBridgeConfig, frameId: string, outcome: Outcome, payloadRef?: string): void {
    // A reply that arrives after the attempt timed out: the frame is done.
    if (this.resolvedBridgeFrames.delete(frameId)) return;
    const attemptNo = this.bridgeAttempts.get(frameId);
    if (attemptNo === undefined) throw new Error(`bridge frame '${frameId}' has no attempt number`);
    this.bridgeAttempts.delete(frameId);
    // Only a frame with an attempt timeout has a second event (timer or reply) still to
    // come; remember it until then.
    if ((bridge.retry?.attemptTimeoutMs ?? null) !== null) this.resolvedBridgeFrames.add(frameId);
    if (op.done || op.unit.done) return;
    const retry = bridge.retry ?? null;
    if (outcome !== 'succeeded' && retry && attemptNo < retry.maxAttempts) {
      let delayMs = Math.min(retry.maxBackoffMs, retry.backoffMs * Math.pow(retry.backoffMultiplier, attemptNo - 1));
      if (retry.jitter) {
        const draw = makeRng((this.seed ^ hashString(`${op.unit.identity}:${op.path}>bridge:${attemptNo}:jitter`)) >>> 0);
        delayMs *= draw();
      }
      if (bridge.connectionId) this.callRetries.set(bridge.connectionId, (this.callRetries.get(bridge.connectionId) ?? 0) + 1);
      this.emitFact({
        kind: 'call_retry',
        time: this.currentTime,
        nodeId: op.nodeId,
        unitIdentity: op.unit.identity,
        attempt: attemptNo + 1,
        path: op.path,
        edgeId: bridge.connectionId,
      });
      this.traffic(op, 'retry', bridge.connectionId, undefined, this.currentTime + delayMs / 1000);
      this.scheduleEvent(this.currentTime + delayMs / 1000, 2, () => {
        if (op.done || op.unit.done) return;
        this.openBridgeFrame(op, bridge, attemptNo + 1);
      });
      return;
    }
    this.traffic(op, 'await_resolved', bridge.connectionId);
    if (outcome === 'expired') this.traffic(op, 'outcome', undefined, 'timeout');
    if (outcome !== 'succeeded' && retry && attemptNo >= retry.maxAttempts) this.traffic(op, 'outcome', undefined, 'retryExhausted');
    this.completeBridgeChild(op, outcome, payloadRef);
  }

  protected completeBridgeChild(op: Op, outcome: Outcome, payloadRef?: string): void {
    if (op.done || op.unit.done) return;
    const nr = this.nodesRuntime.get(op.nodeId)!;
    nr.active.delete(op);
    this.pumpQueue(op.nodeId);
    if (outcome === 'succeeded') {
      nr.counters.completed++;
    } else {
      nr.counters.failed++;
    }
    op.phase = 'settled';
    op.done = true;
    this.finishOp(op, outcome, payloadRef);
    this.releaseOp(op);
  }

  /**
   * Bridge call frames: settles a still-open bridge frame from outside the
   * kernel. `returnLatencyMs` (declared for this node via `OpenSimulationOptions.bridges`)
   * is applied before the parent op resolves, matching a retained child's response delay.
   *
   * - A second settlement of a frame (already resolved by an earlier settleCall) fails
   *   the run — the caller receives a thrown error, matching "fails the run" for the
   *   deliberate double-settlement case (frameId no longer tracked in bridgePendingOps).
   * - If the parent op was already force-settled by an outage or deadline expiry while
   *   the frame was open, the frame is simply cleared here: "the later settleCall is
   *   ignored (not a second settlement) but still counts toward root settlement and
   *   drain" — the op was already released (and the unit already finished) by that
   *   earlier path, so there is nothing further to apply.
   */
  public settleCall(input: { frameId: string; outcome: Outcome; payloadRef?: string; atMs?: number }): void {
    const observed = this.observedBridgeFrames.get(input.frameId);
    this.observedBridgeFrames.delete(input.frameId);
    if (this.abandonedBridgeFrames.delete(input.frameId)) {
      if (observed) {
        const bridge = this.bridgeByNode.get(observed.nodeId);
        this.emitFact({ kind: 'traffic', trafficPhase: 'outcome', trafficOutcome: 'late', time: (input.atMs ?? this.currentTime * 1000) / 1000,
          nodeId: observed.nodeId, unitIdentity: observed.unit.identity, attempt: observed.attempt, path: observed.path, edgeId: bridge?.connectionId });
      }
      // The caller gave up on this attempt; its reply is the frame's last event.
      this.resolvedBridgeFrames.delete(input.frameId);
      return;
    }
    const op = this.bridgePendingOps.get(input.frameId);
    if (!op) {
      throw new Error(`settleCall: unknown or already-settled bridge frame '${input.frameId}'`);
    }
    this.bridgePendingOps.delete(input.frameId);

    if (input.atMs !== undefined) {
      const atSec = input.atMs / 1000;
      if (atSec > this.currentTime) {
        this.updateIntegrals(atSec);
        this.currentTime = atSec;
      }
    }

    if (op.done) {
      this.traffic(op, 'outcome', this.bridgeByNode.get(op.nodeId)?.connectionId, 'late');
      // Parent already settled elsewhere (outage/expiry) while the frame was open.
      return;
    }

    const bridge = this.bridgeByNode.get(op.nodeId);
    const returnLatencySec = (bridge?.returnLatencyMs ?? 0) / 1000;
    const respArrivalTime = this.currentTime + returnLatencySec;
    const { outcome, payloadRef } = input;
    this.scheduleEvent(respArrivalTime, 1, () => {
      if (op.done || op.unit.done) return;
      if (!bridge) {
        this.completeBridgeChild(op, outcome, payloadRef);
        return;
      }
      this.resolveBridgeAttempt(op, bridge, input.frameId, outcome, payloadRef);
    });
  }

  /** Read-only observation of a reply already abandoned by timeout or parent settlement. */
  bridgeReplyIsLate(frameId: string): boolean {
    return this.abandonedBridgeFrames.has(frameId) || this.bridgePendingOps.get(frameId)?.done === true;
  }

  /** Caller retries sent along one call edge. */
  edgeRetries(edgeId: string): number {
    return this.callRetries.get(edgeId) ?? 0;
  }

  /** Successful-operation count and response time (ms) at one node; see `nodeLatencies`. */
  nodeLatency(nodeId: string): { count: number; mean: number; p95: number } {
    const collector = this.nodeLatencies.get(nodeId);
    if (!collector) return { count: 0, mean: 0, p95: 0 };
    return { count: collector.count, ...collector.snapshot() };
  }

  protected finishOp(op: Op, outcome: Outcome, payloadRef?: string): void {
    op.done = true;
    if (op.notified) return;
    op.notified = true;
    // A publication-only op (a workload entering a broker) succeeds on the publish ack, not
    // on delivery; it isn't a broker operation and doesn't count as a broker completion.
    if (outcome === 'succeeded' && !op.publicationOnly) {
      let collector = this.nodeLatencies.get(op.nodeId);
      if (!collector) {
        collector = new LatencyCollector();
        this.nodeLatencies.set(op.nodeId, collector);
      }
      collector.push((this.currentTime - op.arrived) * 1000);
    }
    if (op.onDone) {
      op.onDone(outcome, payloadRef);
    }
  }

  protected cancelOp(op: Op, affectedNodes?: Set<string>): void {
    if (op.done) return;
    this.traffic(op, 'outcome', undefined, 'cancelled');
    this.traffic(op, 'await_resolved');
    if (op.publicationOnly) {
      op.done = true;
      op.phase = 'settled';
      this.releaseOp(op);
      return;
    }

    const nr = this.nodesRuntime.get(op.nodeId)!;
    const node = this.plan.nodes.get(op.nodeId)!;

    op.done = true;
    for (const child of op.children) {
      this.cancelOp(child, affectedNodes);
    }

    if (op.phase === 'queued') {
      const idx = nr.queue.indexOf(op);
      if (idx !== -1) nr.queue.splice(idx, 1);
      nr.counters.cancelled++;
      op.phase = 'settled';
      this.releaseOp(op);
    } else if (op.phase === 'reserved') {
      nr.active.delete(op);
      if (affectedNodes) affectedNodes.add(op.nodeId);
      else this.pumpQueue(op.nodeId);
      nr.counters.cancelled++;
      op.phase = 'settled';
      this.releaseOp(op);
    } else if (op.phase === 'retrying') {
      nr.retrying.delete(op);
      nr.counters.cancelled++;
      op.phase = 'settled';
      this.releaseOp(op);
    } else if (op.phase === 'waiting') {
      if (node.behavior.type === 'source') {
        nr.waitingSources.delete(op);
      } else if (node.behavior.type === 'broker' || node.behavior.type === 'router') {
        nr.waitingSources.delete(op);
      } else {
        nr.active.delete(op);
        if (affectedNodes) affectedNodes.add(op.nodeId);
        else this.pumpQueue(op.nodeId);
      }
      nr.counters.cancelled++;
      op.phase = 'settled';
      this.releaseOp(op);
    } else if (op.phase === 'processing') {
      nr.counters.cancelled++;
    } else {
      op.phase = 'settled';
      this.releaseOp(op);
    }
  }

  protected expireUnit(unit: Unit): void {
    if (unit.done) return;
    this.finishUnit(unit, 'expired');

    const affectedNodes = new Set<string>();
    const opsSnapshot = Array.from(unit.ops);

    for (const op of opsSnapshot) {
      if (!op.done) {
        op.done = true;
        if (op.publicationOnly) {
          op.phase = 'settled';
          this.releaseOp(op);
          continue;
        }

        const nr = this.nodesRuntime.get(op.nodeId)!;
        const node = this.plan.nodes.get(op.nodeId)!;

        if (op.phase === 'queued') {
          const idx = nr.queue.indexOf(op);
          if (idx !== -1) nr.queue.splice(idx, 1);
          nr.counters.expired++;
          op.phase = 'settled';
          this.releaseOp(op);
        } else if (op.phase === 'reserved') {
          nr.active.delete(op);
          affectedNodes.add(op.nodeId);
          nr.counters.expired++;
          op.phase = 'settled';
          this.releaseOp(op);
        } else if (op.phase === 'retrying') {
          nr.retrying.delete(op);
          nr.counters.expired++;
          op.phase = 'settled';
          this.releaseOp(op);
        } else if (op.phase === 'waiting') {
          if (node.behavior.type === 'source') {
            nr.waitingSources.delete(op);
          } else if (node.behavior.type === 'broker' || node.behavior.type === 'router') {
            nr.waitingSources.delete(op);
          } else {
            nr.active.delete(op);
            affectedNodes.add(op.nodeId);
          }
          nr.counters.expired++;
          op.phase = 'settled';
          this.releaseOp(op);
        } else if (op.phase === 'processing') {
          nr.counters.expired++;
        } else {
          op.phase = 'settled';
          this.releaseOp(op);
        }
      }
    }

    for (const nid of affectedNodes) {
      this.pumpQueue(nid);
    }
    this.pumpBrokers();
  }

  protected pumpQueue(nodeId: string): void {
    const nr = this.nodesRuntime.get(nodeId)!;
    const node = this.plan.nodes.get(nodeId)!;

    if (node.behavior.type === 'broker') { this.pumpBrokers(); return; }
    while (nr.queue.length > 0 && nr.active.size < node.behavior.concurrency) {
      // Another expiry at this timestamp may free a slot before this queue's
      // own expiry event runs. Never start work whose deadline has arrived.
      if (nr.queue[0].unit.deadline <= this.currentTime && !nr.queue[0].done) break;
      const nextOp = nr.queue.shift()!;
      if (nextOp.done || nextOp.unit.done) {
        this.releaseOp(nextOp);
        continue;
      }
      this.startProcessing(nextOp);
    }
    this.pumpBrokers();
  }

  protected getReadyBrokerConsumers(brokerId: string, subscription?: string): ExecutionEdge[] {
    const brokerNode = this.plan.nodes.get(brokerId)!;
    const outEdges = this.plan.outgoing.get(brokerId) || [];

    if (brokerNode.behavior.type !== 'broker') return [];

    if (brokerNode.behavior.delivery === 'broadcast') {
      if (!subscription) return [];
      const edge = outEdges.find(e => e.id === subscription);
      if (!edge) return [];
      const tgtNr = this.nodesRuntime.get(edge.target)!;
      const tgtNode = this.plan.nodes.get(edge.target)!;
      if (tgtNr.active.size < tgtNode.behavior.concurrency && tgtNr.queue.length === 0) {
        return [edge];
      }
      return [];
    }

    const cursor = this.nodesRuntime.get(brokerId)!.competingCursor ?? 0;
    return outEdges.map((_, offset) => outEdges[(cursor + offset) % outEdges.length])
      .filter(edge => {
        const resource = this.nodesRuntime.get(edge.target)!;
        return resource.active.size < this.plan.nodes.get(edge.target)!.behavior.concurrency && resource.queue.length === 0;
      });
  }

  protected reserveBrokerConsumer(brokerOp: Op, edge: ExecutionEdge): void {
    const brokerNr = this.nodesRuntime.get(brokerOp.nodeId)!;
    const consumerNr = this.nodesRuntime.get(edge.target)!;
    const em = this.edgeMetrics.get(edge.id)!;

    if (brokerOp.done || brokerOp.unit.done || brokerOp.unit.deadline <= this.currentTime) return;
    for (const id of this.observedBlocked.get(brokerOp) ?? []) this.traffic(brokerOp, 'unblocked', id);
    this.observedBlocked.delete(brokerOp);
    const routes = this.plan.outgoing.get(brokerOp.nodeId)!;
    brokerNr.competingCursor = (routes.indexOf(edge) + 1) % routes.length;
    brokerOp.phase = 'waiting';
    this.emitFact({
      kind: 'occupancy_released', time: this.currentTime, nodeId: brokerOp.nodeId,
      unitIdentity: brokerOp.unit.identity, attempt: brokerOp.attempt, path: brokerOp.path, operationReleased: false,
    });
    brokerNr.waitingSources.add(brokerOp);
    brokerNr.counters.delivered = (brokerNr.counters.delivered || 0) + 1;

    em.sent++;
    em.admitted++;
    consumerNr.counters.arrived++;
    consumerNr.counters.admitted++;

    // Each delivery (a redelivery) is its own path, so its seeded draws are independent.
    const delivery = brokerOp.deliveries ?? 1;
    const childPath = delivery === 1 ? `${brokerOp.path}>${edge.id}` : `${brokerOp.path}>${edge.id}#${delivery}`;
    // The hop to the consumer has jitter and transfer time like any link, but is never lost (the broker would wait forever).
    const hopSeconds = this.legSeconds(edge, edge.latencyMs, 0, `${brokerOp.unit.identity}:${childPath}:hop`, false) ?? edge.latencyMs / 1000;
    const childOp: Op = {
      unit: brokerOp.unit,
      nodeId: edge.target,
      path: childPath,
      phase: 'reserved',
      endpoint: edge.endpoint,
      done: false,
      attempt: 0,
      children: new Set(),
      arrived: this.currentTime + hopSeconds,
      onDone: (childOutcome) => {
        em.responses++;
        if (childOutcome === 'succeeded') {
          this.completeLocalOp(brokerOp);
        } else if (!this.redeliver(brokerOp, edge)) {
          if (edge.retry) this.traffic(brokerOp, 'outcome', edge.id, 'redeliveryExhausted');
          this.handleChildResponse(brokerOp, childOutcome);
        }
      },
    };

    consumerNr.active.add(childOp);
    this.traffic(childOp, 'reserved');
    brokerOp.children.add(childOp);
    brokerOp.unit.ops.add(childOp);
    this.liveOpsCount++;

    const deliveryTime = this.currentTime + hopSeconds;
    this.emitFact({
      kind: 'sent', time: this.currentTime, nodeId: edge.target,
      unitIdentity: brokerOp.unit.identity, attempt: childOp.attempt, path: childPath,
      edgeId: edge.id, arriveAt: deliveryTime,
    });
    this.scheduleEvent(deliveryTime, 2, () => {
      if (childOp.done || childOp.unit.done || deliveryTime >= childOp.unit.deadline) {
        if (!childOp.done) {
          consumerNr.active.delete(childOp);
          this.releaseOp(childOp);
          this.pumpQueue(edge.target);
        }
        return;
      }
      this.startProcessing(childOp);
    });
  }

  /**
   * A broker route with a retry policy redelivers a message whose consumer failed,
   * after the backoff (like a visibility timeout), by putting it back on the broker's
   * queue for any consumer. Returns false when no delivery is left.
   */
  protected redeliver(brokerOp: Op, edge: ExecutionEdge): boolean {
    const retry = edge.retry ?? null;
    const deliveries = brokerOp.deliveries ?? 1;
    if (!retry || deliveries >= retry.maxAttempts || brokerOp.done || brokerOp.unit.done) return false;
    brokerOp.deliveries = deliveries + 1;
    const brokerNr = this.nodesRuntime.get(brokerOp.nodeId)!;
    brokerNr.waitingSources.delete(brokerOp);
    brokerOp.phase = 'retrying';
    brokerNr.retrying.add(brokerOp);
    let delayMs = Math.min(retry.maxBackoffMs, retry.backoffMs * Math.pow(retry.backoffMultiplier, deliveries - 1));
    if (retry.jitter) {
      const draw = makeRng((this.seed ^ hashString(`${brokerOp.unit.identity}:${brokerOp.path}:${deliveries}:redeliver`)) >>> 0);
      delayMs *= draw();
    }
    this.callRetries.set(edge.id, (this.callRetries.get(edge.id) ?? 0) + 1);
    this.emitFact({
      kind: 'call_retry',
      time: this.currentTime,
      nodeId: brokerOp.nodeId,
      unitIdentity: brokerOp.unit.identity,
      attempt: deliveries + 1,
      path: brokerOp.path,
      edgeId: edge.id,
    });
    this.traffic(brokerOp, 'retry', edge.id, undefined, this.currentTime + delayMs / 1000);
    this.scheduleEvent(this.currentTime + delayMs / 1000, 2, () => {
      brokerNr.retrying.delete(brokerOp);
      if (brokerOp.done || brokerOp.unit.done) return;
      brokerOp.phase = 'queued';
      brokerNr.queue.push(brokerOp);
      this.emitFact({
        kind: 'queued', time: this.currentTime, nodeId: brokerOp.nodeId,
        unitIdentity: brokerOp.unit.identity, attempt: brokerOp.attempt, path: brokerOp.path,
      });
      this.pumpBrokers();
    });
    return true;
  }

  protected pumpBrokers(): void {
    if (this.pumpingBrokers) return;
    this.pumpingBrokers = true;
    try {
      for (const [nodeId, nr] of this.nodesRuntime) {
        const node = this.plan.nodes.get(nodeId)!;
        if (node.behavior.type !== 'broker') continue;
        const pending = nr.queue;
        nr.queue = [];
        const blocked = new Set<string>();
        for (const op of pending) {
          if (op.done || op.unit.done) { this.releaseOp(op); continue; }
          const fifo = node.behavior.delivery === 'broadcast' ? op.subscription! : '';
          const candidate = blocked.has(fifo) || op.unit.deadline <= this.currentTime
            ? undefined : this.getReadyBrokerConsumers(nodeId, op.subscription)[0];
          if (candidate) this.reserveBrokerConsumer(op, candidate);
          else {
            blocked.add(fifo); nr.queue.push(op);
            // Only recorded consumer-capacity blockage, never an inference from queue size.
            if (op.unit.deadline > this.currentTime && this.getReadyBrokerConsumers(nodeId, op.subscription).length === 0) {
              this.observeBrokerBlock(op);
            }
          }
        }
      }
    } finally {
      this.pumpingBrokers = false;
    }
  }

  advance(seconds: number): OpenMetrics {
    if (!Number.isFinite(seconds) || seconds < this.currentTime) {
      throw new Error(`Invalid target advance time: ${seconds}`);
    }

    const targetTime = Math.min(seconds, this.duration);

    while (this.events.size > 0) {
      if (this.totalEventsProcessed >= 1000000 || this.liveOpsCount >= 100000) {
        this.incompleteReason = 'resource limit';
        this.finished = false;
        return this.snapshot();
      }

      const nextEvt = this.events.peek()!;
      if (nextEvt.time > targetTime) break;

      this.events.pop();
      this.eventPopped(nextEvt);
      this.updateIntegrals(nextEvt.time);
      this.currentTime = nextEvt.time;
      this.totalEventsProcessed++;
      nextEvt.run();
    }

    this.updateIntegrals(targetTime);
    this.currentTime = targetTime;

    if (this.currentTime >= this.duration) {
      this.finished = true;
    }

    return this.snapshot();
  }

  snapshot(): OpenMetrics {
    return { ...this.metricsSnapshot(), history: structuredClone(this.history) };
  }

  /** Current measured values without cloning the presentation history. */
  metricsSnapshot(): Omit<OpenMetrics, 'history'> {
    const nodeMetrics: Record<string, ResourceMetrics> = Object.create(null);
    for (const [id, nr] of this.nodesRuntime.entries()) {
      let liveQueued = 0;
      for (const op of nr.queue) {
        if (!op.done && !op.unit.done) liveQueued++;
      }
      let liveRetrying = 0;
      for (const op of nr.retrying) {
        if (!op.done && !op.unit.done) liveRetrying++;
      }

      let reservedCount = 0;
      let procCount = 0;
      let cleanupProcCount = 0;
      for (const op of nr.active) {
        if (op.phase === 'reserved') {
          reservedCount++;
        } else if (op.phase === 'processing') {
          procCount++;
          if (op.done || op.unit.done) cleanupProcCount++;
        }
      }

      const waitingCount = (nr.active.size - procCount - reservedCount) + nr.waitingSources.size;

      const dur = this.currentTime > 0 ? this.currentTime : 1;
      let cacheMetric: CacheMetrics | undefined;
      if (nr.cacheState) {
        const snap: CacheSnapshot = nr.cacheState.runtime
          ? nr.cacheState.runtime.snapshot(this.currentTime)
          : { entries: 0, evictions: 0, expirations: 0 };
        cacheMetric = {
          hits: nr.cacheState.hits,
          misses: nr.cacheState.misses,
          writes: nr.cacheState.writes,
          entries: snap.entries,
          evictions: snap.evictions,
          expirations: snap.expirations,
        };
      }

      const node = this.plan.nodes.get(id)!;
      const isBroker = node.behavior.type === 'broker';

      nodeMetrics[id] = {
        arrived: nr.counters.arrived,
        admitted: nr.counters.admitted,
        completed: nr.counters.completed,
        rejected: nr.counters.rejected,
        failed: nr.counters.failed,
        expired: nr.counters.expired,
        cancelled: nr.counters.cancelled,
        queued: liveQueued,
        processing: procCount,
        reserved: reservedCount,
        cleanupProcessing: cleanupProcCount,
        ...(isBroker ? {
          buffered: liveQueued,
          delivered: nr.counters.delivered || 0,
          inFlight: nr.waitingSources.size,
        } : {}),
        waiting: waitingCount,
        activeWorkers: nr.active.size,
        attempts: nr.counters.attempts,
        retries: nr.counters.retries,
        retrying: liveRetrying,
        utilization: nr.cumulativeProcessing / dur,
        occupancy: nr.cumulativeOccupied / dur,
        cache: cacheMetric,
      };
    }

    const edgeMetricsCopy: Record<string, EdgeMetrics> = Object.create(null);
    for (const [id, em] of this.edgeMetrics.entries()) {
      edgeMetricsCopy[id] = { ...em };
    }

    const latSnap = this.latencies.snapshot();
    const msgLatSnap = this.messageLatencies.snapshot();
    const roots: FlowCounts = {
      generated: this.rootsGenerated,
      succeeded: this.rootsSucceeded,
      rejected: this.rootsRejected,
      failed: this.rootsFailed,
      expired: this.rootsExpired,
      inFlight: this.rootsInFlight,
      throughput: this.currentTime > 0 ? this.rootsSucceeded / this.currentTime : 0,
      meanLatency: latSnap.mean,
      p95Latency: latSnap.p95,
    };

    const messages: FlowCounts = {
      generated: this.messagesGenerated,
      succeeded: this.messagesSucceeded,
      rejected: this.messagesRejected,
      failed: this.messagesFailed,
      expired: this.messagesExpired,
      inFlight: this.messagesInFlight,
      throughput: this.currentTime > 0 ? this.messagesSucceeded / this.currentTime : 0,
      meanLatency: msgLatSnap.mean,
      p95Latency: msgLatSnap.p95,
    };

    return {
      time: this.currentTime,
      finished: this.finished,
      incomplete: this.incompleteReason,
      roots,
      messages,
      nodes: nodeMetrics,
      edges: edgeMetricsCopy,
    };
  }

  public peekNextEvent(): { time: number; priority: number; seq: number } | null {
    if (this.events.size === 0) return null;
    const evt = this.events.peek()!;
    return { time: evt.time, priority: evt.priority, seq: evt.seq };
  }

  public stepEvent(): boolean {
    if (this.events.size === 0) return false;
    if (this.totalEventsProcessed >= 1000000 || this.liveOpsCount >= 100000) {
      this.incompleteReason = 'resource limit';
      this.finished = false;
      return false;
    }
    const nextEvt = this.events.pop()!;
    this.eventPopped(nextEvt);
    this.updateIntegrals(nextEvt.time);
    this.currentTime = nextEvt.time;
    this.totalEventsProcessed++;
    nextEvt.run();

    if (this.currentTime >= this.duration) {
      this.finished = true;
    }
    return true;
  }

  public get currentTimeSeconds(): number {
    return this.currentTime;
  }

  public get pendingEventsCount(): number {
    return this.events.size;
  }

  public get planRef(): CompiledPlan {
    return this.plan;
  }

  public get liveRootsCount(): number {
    return this.rootsInFlight;
  }

  public setTraceHook(hook?: SimTraceHook): void {
    this.traceHook = hook;
  }

  public disableWorkload(workloadId: string): void {
    this.disabledWorkloads.add(workloadId);
  }

  public isWorkloadDisabled(workloadId: string): boolean {
    return this.disabledWorkloads.has(workloadId);
  }

  public injectInput(input: KernelResourceInput): boolean {
    if (input.time < this.currentTime - 1e-9) {
      throw new Error(
        `Cannot inject input at time ${input.time}s: earlier than current simulation time ${this.currentTime}s`
      );
    }

    const nextEvt = this.peekNextEvent();
    if (nextEvt && nextEvt.time <= input.time + 1e-9) {
      throw new Error(
        `Cannot inject input at time ${input.time}s: pending kernel event exists at time ${nextEvt.time}s (outer scheduler must step pending events first)`
      );
    }

    if (input.time > this.currentTime) {
      this.updateIntegrals(input.time);
      this.currentTime = input.time;
    }

    const entryNode = this.plan.nodes.get(input.entryNodeId);
    if (!entryNode) {
      throw new Error(`Entry node not found: ${input.entryNodeId}`);
    }

    this.rootsGenerated++;
    this.rootsInFlight++;

    const unit: Unit = {
      category: 'root',
      hops: 0,
      lineageDeadline: Infinity,
      identity: input.identity,
      workloadId: input.workloadId ?? input.entryNodeId,
      ordinal: input.ordinal ?? this.rootsGenerated,
      born: input.time,
      deadline: input.deadline,
      requestClass: input.requestClass,
      key: input.key ?? null,
      done: false,
      ops: new Set(),
    };
    this.liveUnits.add(unit);

    this.scheduleEvent(input.deadline, 0, () => {
      if (!unit.done) {
        this.expireUnit(unit);
      }
    }, { unit });

    if (entryNode.behavior.type === 'broker') {
      const rootOp: Op = {
        unit,
        nodeId: input.entryNodeId,
        path: input.entryNodeId,
        phase: 'waiting',
        publicationOnly: true,
        done: false,
        attempt: 0,
        children: new Set(),
        arrived: input.time,
        pendingChildren: 1,
        onDone: (outcome) => {
          this.finishUnit(unit, outcome);
          const affectedNodes = new Set<string>();
          for (const op of unit.ops) {
            if (op !== rootOp && !op.done) {
              this.cancelOp(op, affectedNodes);
            }
          }
          for (const nid of affectedNodes) {
            this.pumpQueue(nid);
          }
        },
      };

      unit.rootOp = rootOp;
      unit.ops.add(rootOp);
      this.liveOpsCount++;

      const syntheticEdge: ExecutionEdge = {
        id: `__entry:${input.entryNodeId}`,
        source: input.entryNodeId,
        target: input.entryNodeId,
        transport: 'message',
        latencyMs: 0,
        returnLatencyMs: 0,
        ackDelayMs: 8,
        messageTtlMs: Math.max(1, (input.deadline - input.time) * 1000),
        weight: 1,
      };

      this.publishMessage(rootOp, syntheticEdge);
      return true;
    }

    const rootOp: Op = {
      unit,
      nodeId: input.entryNodeId,
      path: input.entryNodeId,
      phase: 'transit',
      done: false,
      attempt: 0,
      children: new Set(),
      arrived: input.time,
      onDone: (outcome, payloadRef) => {
        this.finishUnit(unit, outcome, payloadRef);
        const affectedNodes = new Set<string>();
        for (const op of unit.ops) {
          if (op !== rootOp && !op.done) {
            this.cancelOp(op, affectedNodes);
          }
        }
        for (const nid of affectedNodes) {
          this.pumpQueue(nid);
        }
      },
    };

    unit.rootOp = rootOp;
    unit.ops.add(rootOp);
    this.liveOpsCount++;

    const accepted = this.admitOp(rootOp, false);
    return accepted;
  }
}

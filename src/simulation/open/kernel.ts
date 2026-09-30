import type {
  ExecutionGraph,
  ExecutionNode,
  ExecutionEdge,
  WorkloadDefinition,
  RequestClass,
  CompiledPlan,
} from '../../domain/execution';
import { compileExecution } from '../../domain/execution';
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
  | 'call_retry';

export interface SimLifecycleFact {
  kind: SimLifecycleFactKind;
  time: number;
  nodeId: string;
  unitIdentity: string;
  attempt: number;
  path: string;
  outcome?: Outcome;
  parentIdentity?: string;
  edgeId?: string;
  /** Bridge call frames (RV-14f, model-and-runner.md §8): the system frame ID a
   * 'bridge_dispatch' fact carries, correlating it to the eventual settleCall(). */
  frameId?: string;
  /** Set only when a 'unit_settled' fact resolves through a bridge child's adopted
   * outcome/payload (§8 "the parent adopts the child's outcome and returns the child's
   * payload"). Absent for ordinary (non-bridge) settlement, where the original admitted
   * payload still applies. */
  payloadRef?: string;
  /** The emitting unit's actual category (RV-14f review, §8: "No success is inferred" —
   * extended to "no root/message distinction is inferred either"). Set on 'admitted',
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
 * Bridge call frames (RV-14f, model-and-runner.md §8): declares that `nodeId` (a
 * resource with no other selectable call continuation, per readiness) dispatches its
 * call continuation to an external, non-resource target. The kernel keeps the parent op
 * waiting (as in a retained call chain) instead of completing it locally, and applies
 * `returnLatencyMs` when the external caller eventually resolves the frame via
 * `settleCall`.
 */
export interface KernelBridgeConfig {
  nodeId: string;
  returnLatencyMs: number;
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
   * deadline (model-and-runner.md §6 completion).
   */
  arrivalHorizonSeconds?: number;
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
}

export class SimpleEventHeap {
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

export function hashString(str: string): number {
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
  /** Bridge call frames (RV-14f): set while this op waits on an external settleCall. */
  bridgeFrameId?: string;
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

  push(ms: number): void {
    this.values.push(ms);
  }

  get count(): number {
    return this.values.length;
  }

  snapshot(): { mean: number; p95: number } {
    if (this.values.length === 0) return { mean: 0, p95: 0 };
    let sum = 0;
    for (const v of this.values) sum += v;
    const mean = sum / this.values.length;
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.95) - 1;
    return { mean, p95: sorted[idx] };
  }
}

export class OpenSimulation {
  protected plan: CompiledPlan;
  protected routeSelector = new RouteSelector();
  protected events = new SimpleEventHeap();
  protected seq = 0;
  protected currentTime = 0;
  protected duration: number;
  protected arrivalHorizon: number;
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
  /** Caller retries per call edge (D49), outside `snapshot()` like `nodeLatencies`. */
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

  // Bridge call frames (RV-14f, §8): nodes with an external (non-resource) call
  // continuation, and the ops currently waiting on an external settleCall.
  protected bridgeByNode = new Map<string, KernelBridgeConfig>();
  protected bridgePendingOps = new Map<string, Op>();
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
      // a slot (D49) but still die with the proxy.
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
      // queued work present when the outage fires (§6 Faults). When a pending retry's timer
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

  protected scheduleEvent(time: number, priority: number, run: () => void): void {
    this.events.push({ time, priority, seq: this.seq++, run });
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
    });
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

  protected scheduleNextArrival(wl: WorkloadDefinition, afterTime: number): void {
    if (this.disabledWorkloads.has(wl.id)) return;
    const ordinal = this.workloadNextOrdinal.get(wl.id)!;
    this.workloadNextOrdinal.set(wl.id, ordinal + 1);

    const intervalMs = wl.intervalMs;
    let arrTime: number;

    if (intervalMs !== undefined && intervalMs > 0) {
      arrTime = (ordinal + 1) * (intervalMs / 1000);
    } else {
      const rng = this.workloadRngs.get(wl.id)!;
      const u = Math.max(1e-12, Math.min(1 - 1e-12, rng()));
      const hazard = -Math.log(1 - u);
      const adapter = {
        traffic: wl.rate,
        seed: this.seed,
        // Profiles (ramp, burst) are shaped over the arrival window.
        duration: this.arrivalHorizon,
        timeoutMs: wl.timeoutMs,
        profile: wl.profile,
      };
      arrTime = nextArrivalTime(adapter, afterTime, hazard);
    }

    if (!Number.isFinite(arrTime) || arrTime > this.arrivalHorizon) return;

    this.scheduleEvent(arrTime, 2, () => {
      if (this.disabledWorkloads.has(wl.id)) return;
      this.handleArrival(wl, ordinal, arrTime);
      this.scheduleNextArrival(wl, arrTime);
    });
  }

  protected releaseOp(op: Op): void {
    if (op.released) return;
    op.released = true;
    this.liveOpsCount--;
    op.unit.ops.delete(op);
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

      this.scheduleEvent(deadline, 0, () => {
        if (!unit.done) {
          this.expireUnit(unit);
        }
      });

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

    this.scheduleEvent(deadline, 0, () => {
      if (!unit.done) {
        this.expireUnit(unit);
      }
    });

    const rootOp: Op = {
      unit,
      nodeId: wl.entryNodeId,
      path: wl.entryNodeId,
      phase: 'transit',
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

  protected admitOp(op: Op, isRetry: boolean): boolean {
    const nr = this.nodesRuntime.get(op.nodeId)!;
    const node = this.plan.nodes.get(op.nodeId)!;

    const hostId = this.hostPlacement.get(op.nodeId);
    if (hostId !== undefined && this.hostState.get(hostId) === false) {
      // Admission to a host that is actually down is rejected immediately as unavailable,
      // whatever the router knows and regardless of whether this is a first attempt or a
      // retry landing during the outage (§6 Faults).
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
      return false;
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
    if (node.behavior.type === 'storage') {
      const isWrite = op.unit.requestClass.operation === 'write';
      const cap = isWrite ? node.behavior.writeCapacity : node.behavior.capacity;
      procTime = 1 / cap;
    } else {
      procTime = 1 / node.behavior.capacity;
    }
    if (node.behavior.serviceTime === 'exponential') {
      // D49: seeded per unit, path and attempt, so chunked and one-shot runs draw alike.
      const draw = makeRng((this.seed ^ hashString(`${op.unit.identity}:${op.path}:${op.attempt}:service`)) >>> 0);
      const u = Math.min(1 - 1e-12, Math.max(1e-12, draw()));
      procTime *= -Math.log(1 - u);
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
    const failed = failRng() * 100 < node.behavior.failureRate;

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
        // Advance round robin cursor even on rejected selection per S04
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
      // Bridge call frames (RV-14f, §8): a non-router resource with no in-kernel
      // outgoing edge but a declared bridge continuation waits, exactly like a retained
      // call chain, for an external settleCall() instead of completing locally. Routers
      // always select exactly one route themselves (never reach this branch with zero
      // real edges when a bridge is configured), so bridging is narrowed here to
      // non-router resources per the readiness note in §8.
      const node = this.plan.nodes.get(op.nodeId)!;
      const bridge = node.behavior.type !== 'router' ? this.bridgeByNode.get(op.nodeId) : undefined;
      if (bridge) {
        op.phase = 'waiting';
        op.pendingChildren = 1;
        op.failedChild = false;
        const frameId = `bridge:${op.unit.identity}:${++this.bridgeFrameCounter}`;
        op.bridgeFrameId = frameId;
        this.bridgePendingOps.set(frameId, op);
        this.emitFact({
          kind: 'bridge_dispatch',
          time: this.currentTime,
          nodeId: op.nodeId,
          unitIdentity: op.unit.identity,
          attempt: op.attempt,
          path: op.path,
          frameId,
        });
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

    // D49 (audit H11): a router is an event-driven proxy. Once it has forwarded a request
    // its slot is free for the next one; the forwarded request waits without a slot.
    const dispatchingNode = this.plan.nodes.get(op.nodeId)!;
    if (dispatchingNode.behavior.type === 'router') {
      const nr = this.nodesRuntime.get(op.nodeId)!;
      nr.active.delete(op);
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
   * One attempt of a call from `op` along `edge`. With a retry policy on the edge (D49,
   * audit H13), a rejected, failed or timed-out attempt is retried by the caller after a
   * backoff; the caller keeps waiting (and a non-router caller keeps its slot) meanwhile.
   * Only the final outcome reaches handleChildResponse.
   */
  protected dispatchCallAttempt(op: Op, edge: ExecutionEdge, attemptNo: number): void {
    const em = this.edgeMetrics.get(edge.id)!;
    em.sent++;
    const retry = edge.retry ?? null;

    const childPath = attemptNo === 1 ? `${op.path}>${edge.id}` : `${op.path}>${edge.id}~${attemptNo}`;
    let settled = false;
    const settleAttempt = (childOutcome: Outcome, atCaller: number) => {
      if (settled) return;
      settled = true;
      this.scheduleEvent(atCaller, 1, () => {
        em.responses++;
        if (childOutcome !== 'succeeded' && retry && attemptNo < retry.maxAttempts && !op.done && !op.unit.done) {
          this.scheduleCallRetry(op, edge, attemptNo, retry);
          return;
        }
        this.handleChildResponse(op, childOutcome);
      });
    };

    const childOp: Op = {
      unit: op.unit,
      nodeId: edge.target,
      path: childPath,
      phase: 'transit',
      done: false,
      attempt: 0,
      children: new Set(),
      arrived: this.currentTime + edge.latencyMs / 1000,
      onDone: (childOutcome) => {
        settleAttempt(childOutcome, this.currentTime + edge.returnLatencyMs / 1000);
      },
    };

    op.children.add(childOp);
    op.unit.ops.add(childOp);
    this.liveOpsCount++;

    this.scheduleEvent(this.currentTime + edge.latencyMs / 1000, 2, () => {
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

    if (retry && retry.attemptTimeoutMs !== null) {
      // The caller stops waiting for this attempt; the abandoned work is cancelled.
      this.scheduleEvent(this.currentTime + retry.attemptTimeoutMs / 1000, 1, () => {
        if (settled || childOp.done || op.done || op.unit.done) return;
        const affectedNodes = new Set<string>();
        this.cancelOp(childOp, affectedNodes);
        op.children.delete(childOp);
        for (const nid of affectedNodes) this.pumpQueue(nid);
        settleAttempt('expired', this.currentTime);
      });
    }
  }

  /** Waits the backoff for `attemptNo`, then sends the next attempt (D49). */
  protected scheduleCallRetry(op: Op, edge: ExecutionEdge, attemptNo: number, retry: NonNullable<ExecutionEdge['retry']>): void {
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
    this.scheduleEvent(this.currentTime + delayMs / 1000, 2, () => {
      if (op.done || op.unit.done) return;
      this.dispatchCallAttempt(op, edge, attemptNo + 1);
    });
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
    const edgeDeadline = born + edge.messageTtlMs / 1000;
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

    let ackScheduled = false;

    this.scheduleEvent(deadline, 0, () => {
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
    });

    const msgOpPath = `${parentOp.path}>${edge.id}`;
    const msgRootOp: Op = {
      unit: messageUnit,
      nodeId: edge.target,
      path: msgOpPath,
      phase: 'transit',
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

    const arrivalTime = born + edge.latencyMs / 1000;
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
        const ackDeliveryTime = arrivalTime + edge.ackDelayMs / 1000 + edge.returnLatencyMs / 1000;
        this.scheduleEvent(ackDeliveryTime, 1, () => {
          em.responses++;
          this.handleChildResponse(parentOp, admitted ? 'succeeded' : 'failed');
        });
      }
    });
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
   * Bridge call frames (RV-14f, §8): completes the resource op that was waiting on an
   * external settleCall(), adopting the bridge child's exact outcome (not collapsed to
   * 'failed' the way a retained in-kernel child's non-succeeded outcome is) and its
   * payload. This is deliberately a separate path from handleChildResponse: §8 requires
   * "the parent adopts the child's outcome and returns the child's payload" for bridge
   * frames specifically, whereas handleChildResponse's generic non-router rule collapses
   * every non-succeeded child outcome to 'failed'. Resource -> resource -> bridge chains
   * are unaffected: the outer resource's own childOp still resolves via the retained
   * handleChildResponse path (per §8 "the outer resource keeps retained handling").
   */
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
   * Bridge call frames (RV-14f, §8): settles a still-open bridge frame from outside the
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
      // Parent already settled elsewhere (outage/expiry) while the frame was open.
      return;
    }

    const bridge = this.bridgeByNode.get(op.nodeId);
    const returnLatencySec = (bridge?.returnLatencyMs ?? 0) / 1000;
    const respArrivalTime = this.currentTime + returnLatencySec;
    const { outcome, payloadRef } = input;
    this.scheduleEvent(respArrivalTime, 1, () => {
      if (op.done || op.unit.done) return;
      this.completeBridgeChild(op, outcome, payloadRef);
    });
  }

  /** Caller retries sent along one call edge (D49). */
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
    const routes = this.plan.outgoing.get(brokerOp.nodeId)!;
    brokerNr.competingCursor = (routes.indexOf(edge) + 1) % routes.length;
    brokerOp.phase = 'waiting';
    brokerNr.waitingSources.add(brokerOp);
    brokerNr.counters.delivered = (brokerNr.counters.delivered || 0) + 1;

    em.sent++;
    em.admitted++;
    consumerNr.counters.arrived++;
    consumerNr.counters.admitted++;

    const childPath = `${brokerOp.path}>${edge.id}`;
    const childOp: Op = {
      unit: brokerOp.unit,
      nodeId: edge.target,
      path: childPath,
      phase: 'reserved',
      done: false,
      attempt: 0,
      children: new Set(),
      arrived: this.currentTime + edge.latencyMs / 1000,
      onDone: (childOutcome) => {
        em.responses++;
        if (childOutcome === 'succeeded') {
          this.completeLocalOp(brokerOp);
        } else {
          this.handleChildResponse(brokerOp, childOutcome);
        }
      },
    };

    consumerNr.active.add(childOp);
    brokerOp.children.add(childOp);
    brokerOp.unit.ops.add(childOp);
    this.liveOpsCount++;

    const deliveryTime = this.currentTime + edge.latencyMs / 1000;
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
          else { blocked.add(fifo); nr.queue.push(op); }
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
      history: structuredClone(this.history),
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

    this.scheduleEvent(input.deadline, 0, () => {
      if (!unit.done) {
        this.expireUnit(unit);
      }
    });

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

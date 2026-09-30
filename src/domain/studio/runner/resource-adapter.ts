/**
 * Retained resource adapter (RV-14d-2).
 *
 * Implements the retained adapter over the simulation kernel for studio `resource`
 * elements and their call/message connections, per:
 * - specs/revamp/contracts/model-and-runner.md §4 (ResourceConfig, call/message connection config)
 * - specs/revamp/contracts/model-and-runner.md §6 (Workloads, completion horizon/drain, service time)
 * - specs/revamp/contracts/model-and-runner.md §8 ("Retained adapter", TraceEvent, "Transport-only settlement", "One global scheduler")
 * - specs/revamp/contracts/model-and-runner.md §9 (Counts, ElementMetric, ResourceSummary)
 * - specs/revamp/contracts/model-and-runner.md §10 (Reuse vs new work)
 *
 * Note: interruptHost (faults) belongs to RV-14e and settleCall (bridge frames) to RV-14f:
 * they are intentionally not implemented here per RV-14d-2 specification.
 */

import type {
  Document,
  Id,
  Element,
  Connection,
  CallConnection,
  MessageConnection,
  Workload,
  RequestClass as StudioRequestClass,
  Relation,
  Fault,
} from '../model';
import type {
  ResourceInput,
  Admission,
  KernelDelta,
  PortEmission,
  ResourceSummary,
  Counts,
  ElementMetric,
  TraceEvent,
} from './types';
import { WORKLOAD_PAYLOAD_REF } from './types';
import {
  OpenSimulation,
  type SimLifecycleFact,
  type KernelResourceInput,
  type KernelFaultConfig,
  type KernelBridgeConfig,
  type Outcome as KernelOutcome,
} from '../../../simulation/open/kernel';
import type {
  ExecutionGraph,
  ExecutionNode,
  ExecutionEdge,
  WorkloadDefinition,
  RequestClass as KernelRequestClass,
  BehaviorConfig,
  ComponentKind,
} from '../../execution';
import { VALID_KINDS } from '../../execution';
import { traceEventId } from './trace';

/** Root and journey used only by host fault/detection trace events, which belong to no request. */
export const SYSTEM_FAULT_ROOT_ID = 'fault';
export const SYSTEM_FAULT_JOURNEY_ID = 'system';
import type { ResourceMetrics } from '../../../simulation/open/kernel';

type MutableCounts = {
  generated: number;
  succeeded: number;
  rejected: number;
  failed: number;
  expired: number;
  inFlight: number;
};

interface UnitContext {
  rootId: string;
  journeyId: Id;
  parentEventId: string | null;
  payloadRef: string;
  elementId: Id;
  entryPortId: Id | null;
}

export interface FaultPlacementValidationIssue {
  readonly code: 'invalid';
  readonly path: readonly (string | number)[];
  readonly entityId: Id | null;
  readonly severity: 'error';
  readonly message: string;
}

export function validateFaultsAndPlacements(
  faults: readonly Fault[] | undefined,
  relations: readonly Relation[] | undefined,
  scenarioId?: Id,
): FaultPlacementValidationIssue[] {
  const issues: FaultPlacementValidationIssue[] = [];

  // 1. Fault intervals per host don't overlap, and up > down
  if (faults && faults.length > 0) {
    const faultsByHost = new Map<Id, Fault[]>();
    for (let i = 0; i < faults.length; i++) {
      const fault = faults[i];
      if (fault.upAtMs <= fault.downAtMs) {
        issues.push({
          code: 'invalid',
          path: scenarioId ? ['scenarios', scenarioId, 'faults', i] : ['faults', i],
          entityId: fault.id,
          severity: 'error',
          message: `Fault '${fault.id}' has upAtMs (${fault.upAtMs}) <= downAtMs (${fault.downAtMs})`,
        });
      }
      const list = faultsByHost.get(fault.hostId) ?? [];
      list.push(fault);
      faultsByHost.set(fault.hostId, list);
    }

    for (const [hostId, hostFaults] of faultsByHost.entries()) {
      for (let i = 0; i < hostFaults.length; i++) {
        for (let j = i + 1; j < hostFaults.length; j++) {
          const f1 = hostFaults[i];
          const f2 = hostFaults[j];
          if (Math.max(f1.downAtMs, f2.downAtMs) < Math.min(f1.upAtMs, f2.upAtMs)) {
            issues.push({
              code: 'invalid',
              path: scenarioId ? ['scenarios', scenarioId, 'faults'] : ['faults'],
              entityId: f1.id,
              severity: 'error',
              message: `Overlapping fault intervals on host '${hostId}' between fault '${f1.id}' and '${f2.id}'`,
            });
          }
        }
      }
    }
  }

  // 2. Host placement non-conflicting and acyclic
  if (relations && relations.length > 0) {
    const placedOn = new Map<Id, Id>();
    for (const rel of relations) {
      if (rel.kind === 'deployed-on') {
        const existing = placedOn.get(rel.elementId);
        if (existing !== undefined && existing !== rel.hostId) {
          issues.push({
            code: 'invalid',
            path: ['relations', rel.id],
            entityId: rel.id,
            severity: 'error',
            message: `Conflicting host placement for element '${rel.elementId}': deployed on both '${existing}' and '${rel.hostId}'`,
          });
        } else {
          placedOn.set(rel.elementId, rel.hostId);
        }
      }
    }

    // Acyclic check
    for (const startId of placedOn.keys()) {
      const visited = new Set<Id>();
      let current: Id | undefined = startId;
      while (current !== undefined && placedOn.has(current)) {
        if (visited.has(current)) {
          issues.push({
            code: 'invalid',
            path: ['relations'],
            entityId: current,
            severity: 'error',
            message: `Cyclic host placement detected involving element '${current}'`,
          });
          break;
        }
        visited.add(current);
        current = placedOn.get(current);
      }
    }
  }

  return issues;
}

export interface ResourceAdapterOptions {
  runId?: string;
  elements: readonly Element[];
  connections: readonly Connection[];
  relations?: readonly Relation[];
  faults?: readonly Fault[];
  workloads?: readonly Workload[];
  seed?: number;
  durationMs?: number;
  /** Drain completion: workloads stop arriving here; the run continues to `durationMs`. */
  arrivalHorizonMs?: number;
  disabledWorkloadIds?: Iterable<string>;
}

export type ResourceAdapterInit =
  | ResourceAdapterOptions
  | {
      document: Document;
      scenarioId: Id;
      runId?: string;
      disabledWorkloadIds?: Iterable<string>;
    };

/**
 * Builds an ExecutionGraph from studio-model/1 records.
 * ResourceConfig fields and connection latencies are copied 1:1 per §4.
 * The ms<->s conversion lives only at this boundary.
 * Outgoing edge order is stable edge-ID order.
 */
function buildExecutionGraph(opts: {
  elements: readonly Element[];
  connections: readonly Connection[];
  workloads?: readonly Workload[];
  seed?: number;
  durationMs?: number;
}): {
  graph: ExecutionGraph;
  edgeMap: Map<string, Connection>;
  resourceElements: Map<Id, Element>;
  bridgeConnByNode: Map<Id, Connection>;
} {
  const resourceElements = new Map<Id, Element>();
  const nodes: ExecutionNode[] = [];
  const allElementsById = new Map<Id, Element>();
  for (const el of opts.elements) allElementsById.set(el.id, el);

  for (const el of opts.elements) {
    if (el.behavior.kind !== 'resource') continue;
    resourceElements.set(el.id, el);

    const kind = VALID_KINDS.has(el.visualKind as ComponentKind)
      ? (el.visualKind as ComponentKind)
      : 'service';

    const node: ExecutionNode = {
      id: el.id,
      kind,
      name: el.label || el.id,
      position: { x: 0, y: 0 },
      behavior: { ...(el.behavior.config as unknown as BehaviorConfig) },
    };
    nodes.push(node);
  }

  const edges: ExecutionEdge[] = [];
  const edgeMap = new Map<string, Connection>();
  const bridgeConnByNode = new Map<Id, Connection>();

  for (const conn of opts.connections) {
    // Bridge call frames (§8): a call from a resource's continuation to a non-resource
    // target. Deliberately excluded from the compiled ExecutionGraph (its target isn't a
    // kernel node), and tracked separately so the kernel can be told, via
    // KernelBridgeConfig, which resource nodes have one (dispatchDownstream then waits on
    // an external settleCall() instead of completing locally when it finds no other
    // outgoing edge). Readiness guarantees at most one bridge continuation per
    // non-router resource, so `set` here never silently drops a second one in practice.
    if (
      conn.kind === 'call' &&
      resourceElements.has(conn.source.elementId) &&
      !resourceElements.has(conn.target.elementId) &&
      allElementsById.has(conn.target.elementId)
    ) {
      bridgeConnByNode.set(conn.source.elementId, conn);
      continue;
    }

    // Only connect between known resource elements
    if (!resourceElements.has(conn.source.elementId) || !resourceElements.has(conn.target.elementId)) {
      continue;
    }

    if (conn.kind === 'call') {
      const callConn = conn as CallConnection;
      edgeMap.set(conn.id, conn);
      // A broker's call route to its consumer (S02/S05 shape) is how the broker delivers a
      // message; the kernel models every broker route as a message delivery. The message's
      // TTL is set on the publishing connection; this hop's 1 h TTL never binds, because a
      // delivery's deadline is the minimum along its lineage.
      const fromBroker = resourceElements.get(conn.source.elementId)?.behavior.kind === 'resource' &&
        (resourceElements.get(conn.source.elementId)!.behavior as { config: { type: string } }).config.type === 'broker';
      edges.push({
        id: conn.id,
        source: conn.source.elementId,
        target: conn.target.elementId,
        transport: fromBroker ? 'message' : 'call',
        latencyMs: callConn.config.latencyMs,
        returnLatencyMs: callConn.config.returnLatencyMs,
        ackDelayMs: 0,
        messageTtlMs: 3600000,
        weight: callConn.config.weight,
        condition: callConn.config.condition
          ? { field: callConn.config.condition.field, value: String(callConn.config.condition.value) }
          : undefined,
        fallback: callConn.config.fallback,
        // D49: caller retries apply to calls; a broker delivery has no caller to retry.
        ...(!fromBroker && callConn.config.retry ? { retry: callConn.config.retry } : {}),
      });
    } else if (conn.kind === 'message') {
      const msgConn = conn as MessageConnection;
      edgeMap.set(conn.id, conn);
      edges.push({
        id: conn.id,
        source: conn.source.elementId,
        target: conn.target.elementId,
        transport: 'message',
        latencyMs: msgConn.config.latencyMs,
        returnLatencyMs: 0,
        ackDelayMs: msgConn.config.ackDelayMs,
        messageTtlMs: msgConn.config.messageTtlMs,
        weight: msgConn.config.weight,
        condition: msgConn.config.condition
          ? { field: msgConn.config.condition.field, value: String(msgConn.config.condition.value) }
          : undefined,
        fallback: msgConn.config.fallback,
      });
    }
  }

  // Stable edge-ID order (§4 & §8)
  edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const workloads: WorkloadDefinition[] = (opts.workloads ?? []).map((w) => ({
    id: w.id,
    entryNodeId: w.entry.elementId,
    enabled: w.enabled,
    rate: w.rate,
    timeoutMs: w.timeoutMs,
    intervalMs: w.intervalMs ?? undefined,
    classes: w.classes.map((c: StudioRequestClass): KernelRequestClass => ({
      id: c.id,
      name: c.name,
      weight: c.weight,
      operation: c.operation,
      tags: [...c.tags],
      keyDistribution: {
        kind: c.keyDistribution.kind,
        catalogSize: c.keyDistribution.catalogSize,
        hotSubset: c.keyDistribution.hotSubset,
        hotShare: c.keyDistribution.hotShare,
      },
    })),
  }));

  const seed = opts.seed ?? 42;
  const duration = Math.max(1, Math.ceil((opts.durationMs ?? 300000) / 1000));

  const graph: ExecutionGraph = {
    executionVersion: 'open-system/1',
    nodes,
    edges,
    workloads,
    settings: {
      seed,
      duration,
    },
  };

  return { graph, edgeMap, resourceElements, bridgeConnByNode };
}

/**
 * Retained resource adapter over the simulation kernel.
 */
export class ResourceAdapter {
  readonly runId: string;
  private readonly sim: OpenSimulation;
  private readonly edgeMap: Map<string, Connection>;
  private readonly resourceElements: Map<Id, Element>;
  private readonly bridgeConnByNode: Map<Id, Connection>;
  private readonly unitContexts = new Map<string, UnitContext>();
  private traceSequence = 0;
  private stepFacts: SimLifecycleFact[] = [];

  // Delivered-copy ordinal, keyed by the delivering (kernel) parent unit identity, so
  // every message delivery (single or D36 broadcast fan-out) gets a stable, deterministic
  // runner-level root id (`${parentRootId}:${ordinal}`) instead of exposing the kernel's
  // own internal delivery-path identity (e.g. `msg_1:<path>:__entry:<id>:`) in TraceEvents.
  private readonly deliveryOrdinalByParent = new Map<string, number>();
  // Set when a kernel fact's journey/parent linkage can't be resolved (§5/§8: every
  // TraceEvent carries its journey; a message root links to its parent). Checked by the
  // caller after every admit()/stepNext()/interruptHost() call so the run fails with a
  // sanitized diagnostic instead of ever emitting an 'unknown' journeyId.
  private journeyFailure: string | null = null;

  private readonly rootCounts: MutableCounts = {
    generated: 0,
    succeeded: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
    inFlight: 0,
  };

  /**
   * Roots the kernel generated from workloads (never admitted through `admit()`). The
   * runner only sees finite inputs, so it adds these to its own root counts (§5 counts
   * conserve every root, whatever its source).
   */
  private readonly workloadRootCounts: MutableCounts = {
    generated: 0,
    succeeded: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
    inFlight: 0,
  };
  private readonly workloadUnits = new Set<string>();

  private readonly messageCounts: MutableCounts = {
    generated: 0,
    succeeded: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
    inFlight: 0,
  };

  constructor(init: ResourceAdapterInit) {
    this.runId = init.runId ?? 'run-local';

    let elements: readonly Element[];
    let connections: readonly Connection[];
    let workloads: readonly Workload[] | undefined;
    let seed: number | undefined;
    let durationMs: number | undefined;
    let arrivalHorizonMs: number | undefined;
    let faults: readonly Fault[] | undefined;
    let relations: readonly Relation[] | undefined;
    const disabledWorkloadIds = new Set<string>(init.disabledWorkloadIds ?? []);

    if ('document' in init) {
      const scenario = init.document.scenarios.find((s) => s.id === init.scenarioId);
      elements = init.document.elements;
      connections = init.document.connections;
      workloads = scenario?.workloads;
      seed = scenario?.seed;
      faults = scenario?.faults;
      relations = init.document.relations;
      if (scenario?.completion.kind === 'horizon') {
        durationMs = scenario.completion.horizonMs;
      } else if (scenario?.completion.kind === 'drain') {
        durationMs = scenario.completion.deadlineMs;
        arrivalHorizonMs = scenario.completion.arrivalHorizonMs;
      }

      if (scenario) {
        // Disabling is decided once, at adapter construction, from the scenario
        // (the workloads whose entry receives finite inputs, per "A finite bridge input disables internal generation for that workload")
        const finiteInputNodeIds = new Set(
          scenario.inputs.map((inp) => inp.entry.elementId)
        );
        for (const wl of scenario.workloads) {
          if (finiteInputNodeIds.has(wl.entry.elementId)) {
            disabledWorkloadIds.add(wl.id);
          }
        }
      }
    } else {
      elements = init.elements;
      connections = init.connections;
      workloads = init.workloads;
      seed = init.seed;
      durationMs = init.durationMs;
      arrivalHorizonMs = init.arrivalHorizonMs;
      faults = init.faults;
      relations = init.relations;
    }

    const validationIssues = validateFaultsAndPlacements(faults, relations);
    if (validationIssues.length > 0) {
      throw new Error(`Invalid fault or placement configuration: ${validationIssues[0].message}`);
    }

    const hostPlacement = new Map<string, string>();
    if (relations) {
      for (const rel of relations) {
        if (rel.kind === 'deployed-on') {
          hostPlacement.set(rel.elementId, rel.hostId);
        }
      }
    }

    const kernelFaults: KernelFaultConfig[] = (faults ?? []).map((f) => ({
      id: f.id,
      hostId: f.hostId,
      downAtMs: f.downAtMs,
      upAtMs: f.upAtMs,
      detectionDelayMs: f.detectionDelayMs,
      recoveryDetectionDelayMs: f.recoveryDetectionDelayMs,
      activePolicy: f.activePolicy,
      queuedPolicy: f.queuedPolicy,
      routeReset: f.routeReset,
    }));

    const { graph, edgeMap, resourceElements, bridgeConnByNode } = buildExecutionGraph({
      elements,
      connections,
      workloads,
      seed,
      durationMs,
    });

    this.edgeMap = edgeMap;
    this.resourceElements = resourceElements;
    this.bridgeConnByNode = bridgeConnByNode;

    const kernelBridges: KernelBridgeConfig[] = [];
    for (const [nodeId, conn] of bridgeConnByNode.entries()) {
      const returnLatencyMs = conn.kind === 'call' ? (conn as CallConnection).config.returnLatencyMs : 0;
      kernelBridges.push({ nodeId, returnLatencyMs });
    }

    const hasActiveWorkloads = graph.workloads.some((w) => w.enabled && !disabledWorkloadIds.has(w.id));
    this.sim = new OpenSimulation(graph, {
      traceHook: (fact) => {
        this.stepFacts.push(fact);
      },
      disabledWorkloadIds,
      requireRunnable: hasActiveWorkloads,
      hostPlacement,
      faults: kernelFaults,
      bridges: kernelBridges,
      ...(arrivalHorizonMs !== undefined ? { arrivalHorizonSeconds: arrivalHorizonMs / 1000 } : {}),
    });
  }

  private getEntryPortId(elementId: Id): Id | null {
    const el = this.resourceElements.get(elementId);
    if (el && el.behavior.kind === 'resource') {
      return el.behavior.entryPortId;
    }
    return null;
  }

  /**
   * Returns and clears a pending journey/parent resolution failure (§5/§8). Callers check
   * this after every admit()/stepNext()/interruptHost() call and turn a non-null result
   * into a controlled run failure — never a silent 'unknown' journeyId.
   */
  takeJourneyFailure(): string | null {
    const failure = this.journeyFailure;
    this.journeyFailure = null;
    return failure;
  }

  /** Counts for workload-generated roots only (see `workloadRootCounts`). */
  workloadRoots(): Counts {
    return { ...this.workloadRootCounts };
  }

  /**
   * Per-fact bookkeeping shared by admit(), stepNext() and interruptHost() (§5, §8): root
   * and message Counts, and unitContexts registration for every kernel-derived unit
   * (delivered message copies, D36 broadcast fan-out copies) so journeyId, parent
   * linkage, and payloadRef always propagate from the admitted parent — regardless of
   * which entry point produced the fact (a broker's synchronous delivery inside admit()
   * previously skipped this, which is exactly what left journeyId 'unknown' on delivered
   * units admitted via a message; see RV-14f review).
   *
   * Every delivered copy is exposed under a deterministic `${parentRootId}:${ordinal}`
   * root id, never the kernel's own internal delivery-path identity.
   */
  private consumeFact(fact: SimLifecycleFact): void {
    if (fact.kind === 'message_created') {
      this.registerMessageCreated(fact);
      return;
    }

    // §8 "No success is inferred": root-vs-message is likewise never inferred from the
    // shape of unitIdentity — the kernel now carries the unit's actual category on every
    // 'admitted'/'rejected'/'unit_settled' fact (RV-14f review). A fact of one of these
    // kinds with no category is an adapter/kernel bookkeeping failure, not a silent
    // "assume root" default.
    if (fact.kind === 'admitted' || fact.kind === 'rejected' || fact.kind === 'unit_settled') {
      if (!fact.category) {
        this.journeyFailure ??= `${fact.kind} fact for unit '${fact.unitIdentity}' carried no category`;
        return;
      }
    }

    if (fact.kind === 'admitted' && fact.category === 'root' && !this.unitContexts.has(fact.unitIdentity)) {
      this.rootCounts.generated++;
      this.rootCounts.inFlight++;
      this.workloadRootCounts.generated++;
      this.workloadRootCounts.inFlight++;
      this.workloadUnits.add(fact.unitIdentity);
      this.unitContexts.set(fact.unitIdentity, {
        rootId: fact.unitIdentity,
        journeyId: fact.unitIdentity,
        parentEventId: null,
        payloadRef: WORKLOAD_PAYLOAD_REF,
        elementId: fact.nodeId,
        entryPortId: this.getEntryPortId(fact.nodeId),
      });
    } else if (fact.kind === 'rejected' && fact.category === 'root' && !this.unitContexts.has(fact.unitIdentity)) {
      // The kernel follows a root's 'rejected' fact with its 'unit_settled' fact, which
      // records the outcome; counting 'rejected' here too would count it twice.
      this.rootCounts.generated++;
      this.rootCounts.inFlight++;
      this.workloadRootCounts.generated++;
      this.workloadRootCounts.inFlight++;
      this.workloadUnits.add(fact.unitIdentity);
      this.unitContexts.set(fact.unitIdentity, {
        rootId: fact.unitIdentity,
        journeyId: fact.unitIdentity,
        parentEventId: null,
        payloadRef: WORKLOAD_PAYLOAD_REF,
        elementId: fact.nodeId,
        entryPortId: this.getEntryPortId(fact.nodeId),
      });
    } else if (fact.kind === 'unit_settled') {
      if (!fact.outcome) {
        // §8 "No success is inferred": a unit_settled fact without an explicit outcome
        // must fail the run, never default to 'succeeded'.
        this.journeyFailure ??= `unit_settled fact for unit '${fact.unitIdentity}' carried no outcome`;
        return;
      }
      const outcome = fact.outcome;
      if (fact.category === 'message') {
        this.messageCounts.inFlight = Math.max(0, this.messageCounts.inFlight - 1);
        this.messageCounts[outcome]++;
      } else {
        this.rootCounts.inFlight = Math.max(0, this.rootCounts.inFlight - 1);
        this.rootCounts[outcome]++;
        if (this.workloadUnits.delete(fact.unitIdentity)) {
          this.workloadRootCounts.inFlight--;
          this.workloadRootCounts[outcome]++;
        }
      }
    }
  }

  /**
   * Registers a delivered message unit's context (§5, §8), inheriting journeyId,
   * payloadRef and a clean, deterministic root id from its parent. Split out from
   * consumeFact and called unconditionally (including from admit(), where a broker's
   * synchronous delivery can fire this fact before any per-fact root/message counting
   * applies) since admit()'s own accepted/rejected branches already do that counting for
   * the admitted unit itself — calling the rest of consumeFact there would double-count.
   */
  private registerMessageCreated(fact: SimLifecycleFact): void {
    this.messageCounts.generated++;
    this.messageCounts.inFlight++;

    const parentCtx = fact.parentIdentity ? this.unitContexts.get(fact.parentIdentity) : undefined;
    if (!parentCtx) {
      // §5/§8: every message root links to its parent, and every TraceEvent carries its
      // journey — a delivered unit whose parent can't be resolved must fail the run
      // rather than fabricate a placeholder journey.
      this.journeyFailure = `Cannot resolve journey for delivered message unit '${fact.unitIdentity}': parent unit '${fact.parentIdentity ?? '(none)'}' has no registered context`;
      return;
    }

    const ordinal = this.deliveryOrdinalByParent.get(fact.parentIdentity!) ?? 0;
    this.deliveryOrdinalByParent.set(fact.parentIdentity!, ordinal + 1);

    this.unitContexts.set(fact.unitIdentity, {
      rootId: `${parentCtx.rootId}:${ordinal}`,
      journeyId: parentCtx.journeyId,
      parentEventId: parentCtx.rootId,
      payloadRef: parentCtx.payloadRef,
      elementId: fact.nodeId,
      entryPortId: this.getEntryPortId(fact.nodeId),
    });
  }

  /**
   * Injects a finite resource request into an entry node.
   * Requires input.atMs >= current simulation time and that no pending kernel event has time <= input.atMs.
   * Returns Admission: response is non-null exactly when rejected; rejection settles once.
   */
  admit(input: ResourceInput): Admission {
    const currentMs = Math.round(this.sim.currentTimeSeconds * 1000);
    if (input.atMs < currentMs) {
      throw new Error(
        `Cannot admit input at time ${input.atMs}ms: earlier than current simulation time ${currentMs}ms`
      );
    }

    const nextEvt = this.peekNext();
    if (nextEvt && nextEvt.atMs <= input.atMs) {
      throw new Error(
        `Cannot admit input at time ${input.atMs}ms: pending kernel event exists at time ${nextEvt.atMs}ms (outer scheduler must step pending events first)`
      );
    }

    const entryPortId = this.getEntryPortId(input.entryElementId);
    this.unitContexts.set(input.rootId, {
      rootId: input.rootId,
      journeyId: input.journeyId,
      parentEventId: input.parentEventId,
      payloadRef: input.payloadRef,
      elementId: input.entryElementId,
      entryPortId,
    });

    const kernelInput: KernelResourceInput = {
      entryNodeId: input.entryElementId,
      identity: input.rootId,
      time: input.atMs / 1000,
      deadline: input.deadlineMs / 1000,
      key: input.key ?? null,
      requestClass: {
        id: input.requestClassId,
        name: input.requestClassId,
        weight: 1,
        operation: input.operation,
        tags: [...input.tags],
        keyDistribution: {
          kind: 'uniform',
          catalogSize: 100,
          hotSubset: 10,
          hotShare: 50,
        },
      },
    };

    this.stepFacts = [];
    const accepted = this.sim.injectInput(kernelInput);

    const events: TraceEvent[] = [];

    // Always emit the initial 'input' TraceEvent
    const inputSeq = this.traceSequence++;
    const inputEvent: TraceEvent = {
      id: traceEventId(this.runId, inputSeq),
      sequence: inputSeq,
      rootId: input.rootId,
      journeyId: input.journeyId,
      parentId: input.parentEventId,
      elementId: input.entryElementId,
      portId: entryPortId,
      kind: 'input',
      code: 'admit',
      payloadRef: input.payloadRef,
      atMs: input.atMs,
      outcome: null,
    };
    events.push(inputEvent);

    if (accepted) {
      this.rootCounts.generated++;
      this.rootCounts.inFlight++;

      for (const fact of this.stepFacts) {
        if (fact.kind === 'message_created') this.registerMessageCreated(fact);
        const te = this.mapFactToTraceEvent(fact);
        if (te) events.push(te);
      }

      return {
        accepted: true,
        events,
        response: null,
      };
    } else {
      this.rootCounts.generated++;
      this.rootCounts.rejected++;

      for (const fact of this.stepFacts) {
        if (fact.kind === 'message_created') this.registerMessageCreated(fact);
        const te = this.mapFactToTraceEvent(fact);
        if (te) events.push(te);
      }

      return {
        accepted: false,
        events,
        response: {
          outcome: 'rejected',
          payloadRef: input.payloadRef,
        },
      };
    }
  }

  /**
   * Peeks the next event in the kernel heap.
   * Phase is 0 for fault/detection events and 1 for retained kernel events per §8 global scheduler rules.
   */
  peekNext(): { atMs: number; phase: 0 | 1; sequence: number } | null {
    const nextEvt = this.sim.peekNextEvent();
    if (!nextEvt) return null;
    return {
      atMs: Math.round(nextEvt.time * 1000),
      phase: nextEvt.priority < 0 ? 0 : 1,
      sequence: nextEvt.seq,
    };
  }

  /**
   * Interrupts a host at the given simulation time (§8).
   * Host outage fails active work once and rejects queued work once on that host.
   */
  interruptHost(hostId: Id, atMs: number): KernelDelta {
    this.stepFacts = [];
    this.sim.interruptHost(hostId, atMs / 1000);
    const events: TraceEvent[] = [];
    for (const fact of this.stepFacts) {
      this.consumeFact(fact);
      const te = this.mapFactToTraceEvent(fact);
      if (te) events.push(te);
    }
    return { events, outputs: [] };
  }

  /**
   * Steps exactly one kernel event.
   * TraceEvents come via the observational hook; outcomes are never inferred from aggregates.
   * Outbound continuation routes produce PortEmissions with latency added.
   */
  stepNext(): KernelDelta {
    this.stepFacts = [];
    const hasMore = this.sim.stepEvent();
    if (!hasMore) {
      return { events: [], outputs: [] };
    }

    const events: TraceEvent[] = [];
    const outputs: PortEmission[] = [];

    for (const fact of this.stepFacts) {
      this.consumeFact(fact);

      if (fact.kind === 'route_selected' && fact.edgeId) {
        const conn = this.edgeMap.get(fact.edgeId);
        const unitCtx = this.unitContexts.get(fact.unitIdentity);
        if (!unitCtx) {
          // Never emit a continuation with an invented journey/payload: an unregistered unit
          // is an adapter bookkeeping failure and ends the run (see takeJourneyFailure).
          this.journeyFailure ??= `Cannot resolve context for route selection of unit '${fact.unitIdentity}' at node '${fact.nodeId}'`;
          continue;
        }
        // A route target that is itself a resource element stays inside this kernel's own
        // subgraph: the kernel continues processing it internally (admission/queue/completion),
        // so it must not also surface as a bridge PortEmission for external dispatch. Only a
        // route crossing out to a non-resource element is a bridge continuation (§8).
        if (conn && !this.resourceElements.has(conn.target.elementId)) {
          const latencyMs = conn.kind === 'call' || conn.kind === 'message' ? conn.config.latencyMs : 0;
          outputs.push({
            source: conn.source,
            rootId: unitCtx.rootId,
            journeyId: unitCtx.journeyId,
            parentEventId: unitCtx.parentEventId,
            payloadRef: unitCtx.payloadRef,
            outcome: 'succeeded',
            atMs: Math.round(fact.time * 1000) + latencyMs,
            frameId: null,
          });
        }
      } else if (fact.kind === 'bridge_dispatch' && fact.frameId) {
        // Bridge call frames (§8): the resource has no further in-kernel route and
        // dispatches its call continuation externally, carrying the system frameId the
        // caller must eventually resolve via settleCall(). §8 phase 2 "bridge dispatch".
        const conn = this.bridgeConnByNode.get(fact.nodeId);
        const unitCtx = this.unitContexts.get(fact.unitIdentity);
        if (!unitCtx) {
          // Never emit a continuation with an invented journey/payload: an unregistered unit
          // is an adapter bookkeeping failure and ends the run (see takeJourneyFailure).
          this.journeyFailure ??= `Cannot resolve context for bridge dispatch of unit '${fact.unitIdentity}' at node '${fact.nodeId}'`;
          continue;
        }
        if (conn) {
          const latencyMs = conn.kind === 'call' ? conn.config.latencyMs : 0;
          outputs.push({
            source: conn.source,
            rootId: unitCtx.rootId,
            journeyId: unitCtx.journeyId,
            parentEventId: unitCtx.parentEventId,
            payloadRef: unitCtx.payloadRef,
            outcome: 'succeeded',
            atMs: Math.round(fact.time * 1000) + latencyMs,
            frameId: fact.frameId,
          });
        }
      }

      const te = this.mapFactToTraceEvent(fact);
      if (te) {
        events.push(te);
      }
    }

    return { events, outputs };
  }

  /**
   * Bridge call frames (RV-14f, §8): settles a frame dispatched externally via a
   * 'bridge_dispatch' PortEmission. A second settlement of the same frame fails the run
   * (the kernel throws); if the parent was already settled by an outage or deadline
   * expiry while the frame was open, this is a no-op that still frees the frame (§8: "the
   * later settleCall is ignored ... but still counts toward root settlement and drain").
   * The resulting completion (with the adopted outcome/payload) surfaces later, at
   * `atMs + returnLatencyMs`, through the normal `peekNext()`/`stepNext()` scheduler loop
   * — matching how a retained child's response delay already surfaces (§8 "the kernel
   * applies returnLatencyMs and its existing child-response handling").
   */
  settleCall(input: { frameId: string; outcome: TraceEvent['outcome']; payloadRef: string; atMs: number }): KernelDelta {
    if (input.outcome === null) {
      // §8: no success is inferred. A bridge settlement must carry an explicit outcome.
      this.journeyFailure ??= `settleCall for frame '${input.frameId}' carried no outcome`;
      return { events: [], outputs: [] };
    }
    this.sim.settleCall({
      frameId: input.frameId,
      outcome: input.outcome as KernelOutcome,
      payloadRef: input.payloadRef,
      atMs: input.atMs,
    });
    return { events: [], outputs: [] };
  }

  private mapFactToTraceEvent(fact: SimLifecycleFact): TraceEvent | null {
    // Host fault/detection facts belong to no request: they use the fixed system root and
    // journey below. Every other fact must resolve to a registered unit context; an
    // unregistered unit is an adapter bookkeeping failure that ends the run
    // (takeJourneyFailure), never a trace event with an invented journey.
    const isSystemFact =
      fact.kind === 'host_down' ||
      fact.kind === 'host_up' ||
      fact.kind === 'failure_detected' ||
      fact.kind === 'recovery_detected';
    const registered = this.unitContexts.get(fact.unitIdentity);
    if (!registered && !isSystemFact) {
      this.journeyFailure ??= `Cannot resolve context for '${fact.kind}' fact of unit '${fact.unitIdentity}' at node '${fact.nodeId}'`;
      return null;
    }
    const unitCtx = registered ?? {
      rootId: SYSTEM_FAULT_ROOT_ID,
      journeyId: SYSTEM_FAULT_JOURNEY_ID,
      parentEventId: null,
      payloadRef: null,
      elementId: fact.nodeId,
      entryPortId: null,
    };

    const atMs = Math.round(fact.time * 1000);
    const seq = this.traceSequence++;
    const id = traceEventId(this.runId, seq);

    switch (fact.kind) {
      case 'admitted':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'dispatch',
          code: 'admitted',
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: null,
        };
      case 'rejected':
        // An admission-time rejection (queue full, unavailable host, no eligible route) is an
        // attempt that never got past admission. It must use the same attempt-level code as
        // 'attempt_settled' so that exactly one 'unit_settled' fact per root carries the
        // unit-level outcome code, keeping attempt-level and unit-level settlement distinguishable.
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'settled',
          code: `attempt-settled:${fact.attempt}`,
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: 'rejected',
        };
      case 'queued':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'queued',
          code: 'queued',
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: null,
        };
      case 'started':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'started',
          code: `attempt:${fact.attempt}`,
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: null,
        };
      case 'attempt_settled':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'settled',
          code: `attempt-settled:${fact.attempt}`,
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: fact.outcome ?? null,
        };
      case 'unit_settled': {
        if (!fact.outcome) {
          // §8 "No success is inferred": never default a bare settlement to 'succeeded'.
          this.journeyFailure ??= `unit_settled fact for unit '${fact.unitIdentity}' carried no outcome`;
          return null;
        }
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'settled',
          code: fact.outcome,
          // Bridge call frames (§8): a bridge-adopted settlement carries the child's own
          // payload ref (fact.payloadRef); every other settlement keeps the original
          // admitted payload (transport-only settlement, §8).
          payloadRef: fact.payloadRef ?? unitCtx.payloadRef,
          atMs,
          outcome: fact.outcome,
        };
      }
      case 'bridge_dispatch':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'dispatch',
          code: 'bridge-dispatch',
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: null,
        };
      case 'message_created':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: fact.parentIdentity ?? unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'dispatch',
          code: 'message',
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: null,
        };
      case 'call_retry': {
        // D49: the caller sends another attempt along this call connection after a backoff.
        if (!fact.edgeId) return null;
        const conn = this.edgeMap.get(fact.edgeId);
        if (!conn) return null;
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: conn.source.portId,
          kind: 'dispatch',
          code: 'call-retry',
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: null,
        };
      }
      case 'route_selected': {
        // Surfaces which element a router chose for this attempt. Distinct from admission:
        // a selected target may still be rejected at its own admission gate (e.g. an
        // unavailable host), so this is a routing decision, not an outcome.
        if (!fact.edgeId) return null;
        const conn = this.edgeMap.get(fact.edgeId);
        if (!conn) return null;
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: conn.target.elementId,
          portId: conn.target.portId,
          kind: 'dispatch',
          code: 'route-selected',
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: null,
        };
      }
      case 'host_down':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: null,
          elementId: fact.nodeId,
          portId: null,
          kind: 'fault',
          code: 'host-down',
          payloadRef: null,
          atMs,
          outcome: null,
        };
      case 'host_up':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: null,
          elementId: fact.nodeId,
          portId: null,
          kind: 'fault',
          code: 'host-up',
          payloadRef: null,
          atMs,
          outcome: null,
        };
      case 'failure_detected':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: null,
          elementId: fact.nodeId,
          portId: null,
          kind: 'fault',
          code: 'failure-detected',
          payloadRef: null,
          atMs,
          outcome: null,
        };
      case 'recovery_detected':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: null,
          elementId: fact.nodeId,
          portId: null,
          kind: 'fault',
          code: 'recovery-detected',
          payloadRef: null,
          atMs,
          outcome: null,
        };
      default:
        return null;
    }
  }

  /**
   * Returns a ResourceSummary containing conserved Counts and ElementMetrics.
   */
  snapshot(): ResourceSummary {
    const atMs = Math.round(this.sim.currentTimeSeconds * 1000);
    const kernelSnap = this.sim.snapshot();

    const metrics: ElementMetric[] = [];

    const countKeys: (keyof Counts)[] = ['generated', 'succeeded', 'rejected', 'failed', 'expired', 'inFlight'];
    for (const key of countKeys) {
      metrics.push({
        elementId: null,
        scope: 'root',
        key,
        value: this.rootCounts[key],
        unit: 'count',
        available: true,
        reason: null,
        windowStartMs: 0,
        windowEndMs: atMs,
      });
    }

    metrics.push({
      elementId: null,
      scope: 'root',
      key: 'throughput',
      value: atMs > 0 ? (this.rootCounts.succeeded / atMs) * 1000 : 0,
      unit: 'requests/s',
      available: true,
      reason: null,
      windowStartMs: 0,
      windowEndMs: atMs,
    });

    metrics.push({
      elementId: null,
      scope: 'root',
      key: 'meanLatencyMs',
      value: kernelSnap.roots.meanLatency,
      unit: 'ms',
      available: this.rootCounts.succeeded > 0,
      reason: this.rootCounts.succeeded > 0 ? null : 'No successful roots observed',
      windowStartMs: 0,
      windowEndMs: atMs,
    });

    metrics.push({
      elementId: null,
      scope: 'root',
      key: 'p95LatencyMs',
      value: kernelSnap.roots.p95Latency,
      unit: 'ms',
      available: this.rootCounts.succeeded > 0,
      reason: this.rootCounts.succeeded > 0 ? null : 'No successful roots observed',
      windowStartMs: 0,
      windowEndMs: atMs,
    });

    for (const key of countKeys) {
      metrics.push({
        elementId: null,
        scope: 'message',
        key,
        value: this.messageCounts[key],
        unit: 'count',
        available: true,
        reason: null,
        windowStartMs: 0,
        windowEndMs: atMs,
      });
    }

    for (const [nodeId, nm] of Object.entries(kernelSnap.nodes) as [string, ResourceMetrics][]) {
      metrics.push(
        {
          elementId: nodeId,
          scope: 'element',
          key: 'queued',
          value: nm.queued,
          unit: 'count',
          available: true,
          reason: null,
          windowStartMs: 0,
          windowEndMs: atMs,
        },
        {
          elementId: nodeId,
          scope: 'element',
          key: 'active',
          value: nm.activeWorkers,
          unit: 'count',
          available: true,
          reason: null,
          windowStartMs: 0,
          windowEndMs: atMs,
        },
        {
          elementId: nodeId,
          scope: 'element',
          key: 'utilization',
          // Share of slot-time occupied, including slots held while waiting on a downstream
          // call or acknowledgement (model-and-runner.md §9). The kernel's processing-only
          // `utilization` makes a blocked element look idle.
          value: nm.occupancy,
          unit: 'ratio',
          available: true,
          reason: null,
          windowStartMs: 0,
          windowEndMs: atMs,
        },
        {
          elementId: nodeId,
          scope: 'element',
          key: 'throughput',
          value: atMs > 0 ? (nm.completed / atMs) * 1000 : null,
          unit: 'requests/s',
          available: atMs > 0,
          reason: atMs > 0 ? null : 'No simulated time has elapsed',
          windowStartMs: 0,
          windowEndMs: atMs,
        },
      );

      // Response time at this element: arrival to success, including queueing, retries
      // and downstream waits (model-and-runner.md §9, D48).
      const latency = this.sim.nodeLatency(nodeId);
      for (const [key, value] of [['meanLatencyMs', latency.mean], ['p95LatencyMs', latency.p95]] as const) {
        metrics.push({
          elementId: nodeId,
          scope: 'element',
          key,
          value: latency.count > 0 ? value : null,
          unit: 'ms',
          available: latency.count > 0,
          reason: latency.count > 0 ? null : 'No successful operations at this element',
          windowStartMs: 0,
          windowEndMs: atMs,
        });
      }

      if (nm.cache) {
        metrics.push(
          {
            elementId: nodeId,
            scope: 'element',
            key: 'cacheHits',
            value: nm.cache.hits,
            unit: 'count',
            available: true,
            reason: null,
            windowStartMs: 0,
            windowEndMs: atMs,
          },
          {
            elementId: nodeId,
            scope: 'element',
            key: 'cacheMisses',
            value: nm.cache.misses,
            unit: 'count',
            available: true,
            reason: null,
            windowStartMs: 0,
            windowEndMs: atMs,
          },
          {
            elementId: nodeId,
            scope: 'element',
            key: 'cacheEntries',
            value: nm.cache.entries,
            unit: 'count',
            available: true,
            reason: null,
            windowStartMs: 0,
            windowEndMs: atMs,
          },
          {
            elementId: nodeId,
            scope: 'element',
            key: 'cacheEvictions',
            value: nm.cache.evictions,
            unit: 'count',
            available: true,
            reason: null,
            windowStartMs: 0,
            windowEndMs: atMs,
          },
          {
            elementId: nodeId,
            scope: 'element',
            key: 'cacheExpirations',
            value: nm.cache.expirations,
            unit: 'count',
            available: true,
            reason: null,
            windowStartMs: 0,
            windowEndMs: atMs,
          },
        );
      }
    }

    return {
      atMs,
      rootCounts: { ...this.rootCounts },
      messageCounts: { ...this.messageCounts },
      metrics,
      pendingEvents: this.sim.pendingEventsCount,
      liveRoots: this.rootCounts.inFlight,
    };
  }

  isDrained(): boolean {
    return this.rootCounts.inFlight === 0 && this.messageCounts.inFlight === 0;
  }

  stepToHorizon(horizonMs: number): {
    atMs: number;
    summary: ResourceSummary;
    events: TraceEvent[];
    outputs: PortEmission[];
  } {
    const events: TraceEvent[] = [];
    const outputs: PortEmission[] = [];

    while (true) {
      const next = this.peekNext();
      if (!next || next.atMs > horizonMs) break;
      const delta = this.stepNext();
      events.push(...delta.events);
      outputs.push(...delta.outputs);
    }

    return {
      atMs: Math.max(Math.round(this.sim.currentTimeSeconds * 1000), horizonMs),
      summary: this.snapshot(),
      events,
      outputs,
    };
  }

  stepToDrain(
    arrivalHorizonMs: number,
    deadlineMs: number,
  ): {
    status: 'completed' | 'incomplete';
    drained: boolean;
    atMs: number;
    summary: ResourceSummary;
    events: TraceEvent[];
    outputs: PortEmission[];
  } {
    const events: TraceEvent[] = [];
    const outputs: PortEmission[] = [];

    while (true) {
      const next = this.peekNext();
      if (!next || next.atMs > deadlineMs) break;

      if (next.atMs > arrivalHorizonMs) {
        for (const wl of this.sim.planRef.graph.workloads) {
          this.sim.disableWorkload(wl.id);
        }
      }

      const delta = this.stepNext();
      events.push(...delta.events);
      outputs.push(...delta.outputs);

      if (this.isDrained()) {
        break;
      }
    }

    const drained = this.isDrained();
    const currentMs = Math.round(this.sim.currentTimeSeconds * 1000);

    return {
      status: drained ? 'completed' : 'incomplete',
      drained,
      atMs: drained ? currentMs : Math.max(currentMs, deadlineMs),
      summary: this.snapshot(),
      events,
      outputs,
    };
  }
}

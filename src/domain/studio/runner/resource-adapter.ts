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
import {
  OpenSimulation,
  type SimLifecycleFact,
  type KernelResourceInput,
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

export interface ResourceAdapterOptions {
  runId?: string;
  elements: readonly Element[];
  connections: readonly Connection[];
  workloads?: readonly Workload[];
  seed?: number;
  durationMs?: number;
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
}): { graph: ExecutionGraph; edgeMap: Map<string, Connection>; resourceElements: Map<Id, Element> } {
  const resourceElements = new Map<Id, Element>();
  const nodes: ExecutionNode[] = [];

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

  for (const conn of opts.connections) {
    // Only connect between known resource elements
    if (!resourceElements.has(conn.source.elementId) || !resourceElements.has(conn.target.elementId)) {
      continue;
    }

    if (conn.kind === 'call') {
      const callConn = conn as CallConnection;
      edgeMap.set(conn.id, conn);
      edges.push({
        id: conn.id,
        source: conn.source.elementId,
        target: conn.target.elementId,
        transport: 'call',
        latencyMs: callConn.config.latencyMs,
        returnLatencyMs: callConn.config.returnLatencyMs,
        ackDelayMs: 0,
        messageTtlMs: 3600000,
        weight: callConn.config.weight,
        condition: callConn.config.condition
          ? { field: callConn.config.condition.field, value: String(callConn.config.condition.value) }
          : undefined,
        fallback: callConn.config.fallback,
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

  return { graph, edgeMap, resourceElements };
}

/**
 * Retained resource adapter over the simulation kernel.
 */
export class ResourceAdapter {
  readonly runId: string;
  private readonly sim: OpenSimulation;
  private readonly edgeMap: Map<string, Connection>;
  private readonly resourceElements: Map<Id, Element>;
  private readonly unitContexts = new Map<string, UnitContext>();
  private traceSequence = 0;
  private stepFacts: SimLifecycleFact[] = [];

  private readonly rootCounts: MutableCounts = {
    generated: 0,
    succeeded: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
    inFlight: 0,
  };

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
    const disabledWorkloadIds = new Set<string>(init.disabledWorkloadIds ?? []);

    if ('document' in init) {
      const scenario = init.document.scenarios.find((s) => s.id === init.scenarioId);
      elements = init.document.elements;
      connections = init.document.connections;
      workloads = scenario?.workloads;
      seed = scenario?.seed;
      if (scenario?.completion.kind === 'horizon') {
        durationMs = scenario.completion.horizonMs;
      } else if (scenario?.completion.kind === 'drain') {
        durationMs = scenario.completion.deadlineMs;
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
    }

    const { graph, edgeMap, resourceElements } = buildExecutionGraph({
      elements,
      connections,
      workloads,
      seed,
      durationMs,
    });

    this.edgeMap = edgeMap;
    this.resourceElements = resourceElements;

    const hasActiveWorkloads = graph.workloads.some((w) => w.enabled && !disabledWorkloadIds.has(w.id));
    this.sim = new OpenSimulation(graph, {
      traceHook: (fact) => {
        this.stepFacts.push(fact);
      },
      disabledWorkloadIds,
      requireRunnable: hasActiveWorkloads,
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
   * Phase is always 1 for retained kernel events per §8 global scheduler rules.
   */
  peekNext(): { atMs: number; phase: 1; sequence: number } | null {
    const nextEvt = this.sim.peekNextEvent();
    if (!nextEvt) return null;
    return {
      atMs: Math.round(nextEvt.time * 1000),
      phase: 1,
      sequence: nextEvt.seq,
    };
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
      if (fact.kind === 'admitted' && !fact.unitIdentity.includes(':') && !this.unitContexts.has(fact.unitIdentity)) {
        this.rootCounts.generated++;
        this.rootCounts.inFlight++;
        this.unitContexts.set(fact.unitIdentity, {
          rootId: fact.unitIdentity,
          journeyId: fact.unitIdentity,
          parentEventId: null,
          payloadRef: 'payload-workload',
          elementId: fact.nodeId,
          entryPortId: this.getEntryPortId(fact.nodeId),
        });
      } else if (fact.kind === 'rejected' && !fact.unitIdentity.includes(':') && !this.unitContexts.has(fact.unitIdentity)) {
        this.rootCounts.generated++;
        this.rootCounts.rejected++;
        this.unitContexts.set(fact.unitIdentity, {
          rootId: fact.unitIdentity,
          journeyId: fact.unitIdentity,
          parentEventId: null,
          payloadRef: 'payload-workload',
          elementId: fact.nodeId,
          entryPortId: this.getEntryPortId(fact.nodeId),
        });
      } else if (fact.kind === 'unit_settled') {
        const isMsg = fact.unitIdentity.includes(':');
        const outcome = fact.outcome ?? 'succeeded';
        if (isMsg) {
          this.messageCounts.inFlight = Math.max(0, this.messageCounts.inFlight - 1);
          if (outcome === 'succeeded' || outcome === 'rejected' || outcome === 'failed' || outcome === 'expired') {
            this.messageCounts[outcome]++;
          }
        } else {
          this.rootCounts.inFlight = Math.max(0, this.rootCounts.inFlight - 1);
          if (outcome === 'succeeded' || outcome === 'rejected' || outcome === 'failed' || outcome === 'expired') {
            this.rootCounts[outcome]++;
          }
        }
      } else if (fact.kind === 'message_created') {
        this.messageCounts.generated++;
        this.messageCounts.inFlight++;

        const parentCtx = this.unitContexts.get(fact.parentIdentity ?? '');
        if (parentCtx) {
          this.unitContexts.set(fact.unitIdentity, {
            rootId: fact.unitIdentity,
            journeyId: parentCtx.journeyId,
            parentEventId: parentCtx.rootId,
            payloadRef: parentCtx.payloadRef,
            elementId: fact.nodeId,
            entryPortId: this.getEntryPortId(fact.nodeId),
          });
        }
      } else if (fact.kind === 'route_selected' && fact.edgeId) {
        const conn = this.edgeMap.get(fact.edgeId);
        const unitCtx = this.unitContexts.get(fact.unitIdentity) ?? {
          rootId: fact.unitIdentity,
          journeyId: 'unknown',
          parentEventId: null,
          payloadRef: 'unknown',
          elementId: fact.nodeId,
          entryPortId: null,
        };
        if (conn) {
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
      }

      const te = this.mapFactToTraceEvent(fact);
      if (te) {
        events.push(te);
      }
    }

    return { events, outputs };
  }

  private mapFactToTraceEvent(fact: SimLifecycleFact): TraceEvent | null {
    const unitCtx = this.unitContexts.get(fact.unitIdentity) ?? {
      rootId: fact.unitIdentity,
      journeyId: 'unknown',
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
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'settled',
          code: 'rejected',
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
      case 'unit_settled':
        return {
          id,
          sequence: seq,
          rootId: unitCtx.rootId,
          journeyId: unitCtx.journeyId,
          parentId: unitCtx.parentEventId,
          elementId: fact.nodeId,
          portId: unitCtx.entryPortId,
          kind: 'settled',
          code: fact.outcome ?? 'succeeded',
          payloadRef: unitCtx.payloadRef,
          atMs,
          outcome: fact.outcome ?? 'succeeded',
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
      case 'route_selected':
        return null;
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
          value: nm.utilization,
          unit: 'ratio',
          available: true,
          reason: null,
          windowStartMs: 0,
          windowEndMs: atMs,
        },
      );

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

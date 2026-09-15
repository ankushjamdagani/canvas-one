import type { ComponentKind, Graph, ModelNode, ModelEdge, Project } from "./model";
import { makeNode, isOpenGraph, clone } from "./model";
import type { BehaviorConfig, ExecutionNode, ExecutionEdge, ExecutionGraph, WorkloadDefinition } from "./execution";
import { defaultBehavior, defaultWorkload } from "./behaviorDefaults";

export function makeOpenNode(kind: ComponentKind, x: number, y: number): ModelNode & ExecutionNode {
  const base = makeNode(kind, x, y);
  const behavior = defaultBehavior(kind);
  let name = base.name;
  if (kind === "service") {
    name = "Service";
  } else if (kind === "queue") {
    name = "Message queue";
  } else if (kind === "worker") {
    name = "Worker";
  }
  return {
    ...base,
    name,
    behavior,
  };
}

export function emptyOpenGraph(): Graph & ExecutionGraph {
  return {
    executionVersion: "open-system/1",
    nodes: [],
    edges: [],
    workloads: [],
    settings: {
      traffic: 100,
      seed: 42,
      duration: 30,
      timeoutMs: 2000,
    },
  };
}

export function newOpenProject(name = "Untitled system"): Project {
  return {
    id: crypto.randomUUID(),
    name,
    graph: emptyOpenGraph(),
    checkpoints: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  };
}

export function createRunnableCopy(original: Project): Project {
  const newId = crypto.randomUUID();
  const truncatedName = original.name.slice(0, 64) + " (runnable copy)";

  if (isOpenGraph(original.graph)) {
    const clonedGraph = clone(original.graph);
    delete clonedGraph.scenario;
    return {
      id: newId,
      name: truncatedName,
      graph: clonedGraph,
      checkpoints: [],
      viewport: clone(original.viewport),
      updatedAt: Date.now(),
      subsystems: original.subsystems ? clone(original.subsystems) : undefined,
      expandedNodeIds: original.expandedNodeIds ? clone(original.expandedNodeIds) : undefined,
    };
  }

  const oldGraph = original.graph;
  const scenario = oldGraph.scenario;

  const newNodes: (ModelNode & ExecutionNode)[] = oldGraph.nodes.map((n) => {
    const defB = defaultBehavior(n.kind);
    let behavior: BehaviorConfig;

    // Base resource overrides from old configured resource fields
    const baseRes = {
      capacity: n.capacity,
      concurrency: n.workers ?? defB.concurrency,
      queueLimit: n.queueLimit,
      failureRate: n.failureRate ?? defB.failureRate,
      maxRetries: n.maxRetries ?? defB.maxRetries,
      retryDelayMs: n.retryDelayMs ?? defB.retryDelayMs,
    };

    if (defB.type === "storage") {
      behavior = { ...baseRes, type: "storage", writeCapacity: n.capacity };
    } else if (defB.type === "cache") {
      behavior = {
        ...baseRes,
        type: "cache",
        mode: n.cacheMode ?? defB.mode,
        hitRate: n.hitRate ?? defB.hitRate,
        entries: n.cacheEntries ?? defB.entries,
        ttlMs: n.cacheTtlMs ?? defB.ttlMs,
      };
    } else if (defB.type === "router") {
      behavior = { ...baseRes, type: "router", strategy: defB.strategy };
    } else if (defB.type === "broker") {
      behavior = { ...baseRes, type: "broker", delivery: defB.delivery };
    } else if (defB.type === "source") {
      behavior = { ...baseRes, type: "source" };
    } else {
      behavior = { ...baseRes, type: "processor" };
    }

    return {
      ...clone(n),
      behavior,
    };
  });

  const nodeBehaviorMap = new Map<string, BehaviorConfig>();
  for (const n of newNodes) {
    if (n.behavior) nodeBehaviorMap.set(n.id, n.behavior);
  }

  const newEdges: (ModelEdge & ExecutionEdge)[] = oldGraph.edges.map((e) => {
    const srcB = nodeBehaviorMap.get(e.source);
    const tgtB = nodeBehaviorMap.get(e.target);
    const isBrokerInvolved = srcB?.type === "broker" || tgtB?.type === "broker";

    let transport: "call" | "message" = "call";
    if (isBrokerInvolved) {
      transport = "message";
    } else if (e.communication === "async") {
      transport = "message";
    } else {
      transport = "call";
    }

    const isDiagram = scenario === "diagram";
    const needsReview = isDiagram ? (e.communication === undefined || e.communication === "data") : false;

    let returnLatencyMs = 0;
    if (scenario === "lookup" || scenario === undefined) {
      if (srcB?.type === "processor" && (tgtB?.type === "cache" || tgtB?.type === "storage")) {
        returnLatencyMs = 8;
      }
    }
    const ackDelayMs = 8;

    return {
      ...clone(e),
      transport,
      latencyMs: 0,
      returnLatencyMs,
      ackDelayMs,
      messageTtlMs: 2000,
      weight: 1,
      needsReview: needsReview ? true : undefined,
    };
  });

  let workloads: WorkloadDefinition[] = [];
  if (scenario === "diagram") {
    workloads = [];
  } else {
    const trafficNode = newNodes.find((n) => n.kind === "traffic");
    if (trafficNode) {
      const wl = defaultWorkload(trafficNode.id);
      wl.rate = oldGraph.settings.traffic;
      wl.timeoutMs = oldGraph.settings.timeoutMs;
      if (oldGraph.settings.profile) {
        wl.profile = clone(oldGraph.settings.profile);
      }
      if (trafficNode.popularity) {
        wl.classes[0].keyDistribution = {
          kind: trafficNode.popularity,
          catalogSize: trafficNode.catalogSize ?? 1000,
          hotSubset: Math.min(trafficNode.hotSubset ?? 10, trafficNode.catalogSize ?? 1000),
          hotShare: trafficNode.hotShare ?? 80,
        };
      }
      workloads = [wl];
    }
  }

  const newGraph: Graph & ExecutionGraph = {
    executionVersion: "open-system/1",
    nodes: newNodes,
    edges: newEdges,
    workloads,
    settings: clone(oldGraph.settings),
    notes: oldGraph.notes ? clone(oldGraph.notes) : undefined,
    guideId: oldGraph.guideId,
  };

  return {
    id: newId,
    name: truncatedName,
    graph: newGraph,
    checkpoints: [],
    viewport: clone(original.viewport),
    updatedAt: Date.now(),
    subsystems: original.subsystems ? clone(original.subsystems) : undefined,
    expandedNodeIds: original.expandedNodeIds ? clone(original.expandedNodeIds) : undefined,
  };
}

export function executionSignature(graph: Graph): string {
  if (isOpenGraph(graph)) {
    return JSON.stringify({
      version: graph.executionVersion,
      settings: { seed: graph.settings.seed, duration: graph.settings.duration },
      workloads: graph.workloads,
      nodes: graph.nodes.map((n) => ({ id: n.id, behavior: n.behavior })),
      edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, transport: e.transport, latencyMs: e.latencyMs, returnLatencyMs: e.returnLatencyMs, ackDelayMs: e.ackDelayMs, messageTtlMs: e.messageTtlMs, weight: e.weight, condition: e.condition, fallback: e.fallback, needsReview: e.needsReview })),
    });
  }
  const { notes: _notes, guideId: _guideId, ...simulationGraph } = graph;
  return JSON.stringify({
    ...simulationGraph,
    nodes: graph.nodes.map(({ position: _position, name: _name, ...node }) => node),
  });
}

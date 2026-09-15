import {
  clone,
  validateGraph,
  workerCount,
  isJobGraph,
  type Graph,
  type ModelNode,
} from "./model";
import { failureCount, type Metrics } from "./metrics";
import { sameGraphWorkload, profileLabel, defaultWorkloadComparisonStatus } from "./workload";
import { validateOpenResult } from "./openResults";

export const MODEL_VERSION = "url-lookup/5";
export const modelVersion = (graph: Graph) =>
  graph.executionVersion === "open-system/1" ? "open-system/1" : isJobGraph(graph) ? "background-jobs/1" : MODEL_VERSION;
export const MAX_SAVED_RUNS = 20;
export interface RunResult {
  id: string;
  graph: Graph;
  metrics: Metrics;
}
export interface SavedRun extends RunResult {
  name: string;
  completedAt: number;
  modelVersion: string;
  origin: "simulation" | "imported";
}
export function defaultRunName(graph: Graph) {
  if (graph.executionVersion === "open-system/1") {
    const count = graph.workloads?.length ?? 0;
    return `${count} workload${count === 1 ? "" : "s"} · ${graph.settings.duration}s system run`.slice(0, 80);
  }
  if (isJobGraph(graph))
    return `${profileLabel(graph.settings)} · background jobs`.slice(0, 80);
  const instances = graph.nodes.filter((n) => n.kind === "service");
  if (graph.nodes.some((n) => n.kind === "balancer")) return `${profileLabel(graph.settings)} · ${instances.length} service instances`.slice(0, 80);
  const cache = graph.nodes.find((n) => n.kind === "cache");
  return `${profileLabel(graph.settings)} · ${cache ? cacheDescription(cache) : "no cache"}`.slice(
    0,
    80,
  );
}
function cacheDescription(cache: ModelNode) {
  return cache.cacheMode === "lru"
    ? `LRU ${cache.cacheEntries ?? 100} entries · ${cache.cacheTtlMs ?? 10000} ms TTL`
    : `${cache.hitRate}% fixed probability`;
}
export function createSavedRun(result: RunResult, name: string): SavedRun {
  const run: SavedRun = {
    ...clone(result),
    name: name.trim().slice(0, 80) || defaultRunName(result.graph),
    completedAt: Date.now(),
    modelVersion: modelVersion(result.graph),
    origin: "simulation",
  };
  const errors = validateSavedRun(run);
  if (errors.length) throw new Error(errors[0]);
  return run;
}

/** File validation checks structure and accounting, not provenance or authenticity. */
export function validateSavedRun(run: SavedRun): string[] {
  if (
    !run ||
    typeof run.id !== "string" ||
    !run.id ||
    typeof run.name !== "string" ||
    !run.name.trim() ||
    run.name.length > 80 ||
    !Number.isFinite(run.completedAt)
  )
    return ["Saved results need a valid name and completion time."];
  if (![MODEL_VERSION, "background-jobs/1", "open-system/1"].includes(run.modelVersion))
    return ["This saved result uses an unsupported simulation model version."];
  const graphErrors = validateGraph(run.graph, true);
  if (graphErrors.length) return graphErrors;
  if (run.modelVersion !== modelVersion(run.graph))
    return ["Saved result model does not match its experiment path."];
  if (run.modelVersion === "open-system/1") {
    return validateOpenResult(run.graph, run.metrics);
  }
  const m = run.metrics;
  const values = [
    "time",
    "generated",
    "arrivalRate",
    "succeeded",
    "dropped",
    "timedOut",
    "inFlight",
    "throughput",
    "meanLatency",
    "p95Latency",
    "cacheHits",
    "cacheMisses",
    "cacheEntries",
    "cacheEvictions",
    "cacheExpirations",
    "databaseLookups",
  ] as const;
  if (
    !m ||
    values.some((k) => !Number.isFinite(m[k]) || m[k] < 0) ||
    m.finished !== true ||
    Math.abs(m.time - run.graph.settings.duration) > 1e-8
  )
    return ["Only completed results with valid observed metrics can be saved."];
  const counts = [
    "generated",
    "succeeded",
    "dropped",
    "timedOut",
    "inFlight",
    "cacheHits",
    "cacheMisses",
    "cacheEntries",
    "cacheEvictions",
    "cacheExpirations",
    "databaseLookups",
  ] as const;
  if (
    counts.some((k) => !Number.isSafeInteger(m[k])) ||
    m.generated !== m.succeeded + failureCount(m) + m.inFlight ||
    Math.abs(m.throughput - m.succeeded / m.time) > 1e-6 ||
    m.cacheHits > m.generated ||
    m.databaseLookups > m.generated
  )
    return ["Saved result request counts do not reconcile."];
  if (isJobGraph(run.graph)) {
    const j = m.jobs;
    if (
      !j ||
      Object.values(j).some((v) => !Number.isSafeInteger(v) || v < 0) ||
      [
        "accepted",
        "acknowledged",
        "failed",
        "attempts",
        "retries",
        "retrying",
        "retryRejected",
      ].some((k) => !Number.isSafeInteger(j[k as keyof typeof j])) ||
      j.accepted !== m.generated - m.dropped ||
      j.acknowledged > j.accepted ||
      j.retrying > m.inFlight ||
      j.retryRejected > j.failed
    )
      return ["Saved job accounting is invalid."];
  } else if (m.jobs) return ["Job metrics require the background-job path."];
  if (
    !m.nodes ||
    typeof m.nodes !== "object" ||
    Object.keys(m.nodes).length > 20
  )
    return ["Saved component measurements are invalid."];
  for (const node of run.graph.nodes.filter((n) => n.kind !== "traffic")) {
    const n = m.nodes[node.id];
    if (
      !n ||
      ["arrived", "completed", "rejected", "queued"].some(
        (k) =>
          !Number.isSafeInteger(n[k as keyof typeof n]) ||
          Number(n[k as keyof typeof n]) < 0,
      ) ||
      typeof n.busy !== "boolean" ||
      !Number.isInteger(n.activeWorkers) ||
      n.activeWorkers! < 0 ||
      n.activeWorkers! > workerCount(node) ||
      n.busy !== n.activeWorkers! > 0 ||
      !Number.isFinite(n.utilization) ||
      n.utilization < 0 ||
      n.utilization > 1 ||
      n.queued > node.queueLimit
    )
      return ["Saved component measurements are invalid."];
  }
  const cache = run.graph.nodes.find((node) => node.kind === "cache");
  if (cache) {
    if (
      m.cacheHits + m.cacheMisses > m.generated ||
      m.cacheHits + m.cacheMisses > m.nodes[cache.id].completed ||
      m.cacheMisses !== m.databaseLookups
    )
      return ["Saved cache decisions do not reconcile with database arrivals."];
    if (cache.cacheMode === "lru") {
      const database = run.graph.nodes.find((node) => node.kind === "database")!;
      if (
        m.cacheEntries > (cache.cacheEntries ?? 100) ||
        m.cacheEntries + m.cacheEvictions + m.cacheExpirations > m.nodes[database.id].completed
      )
        return ["Saved finite-cache occupancy and removals do not reconcile with fills."];
    } else if (m.cacheEntries || m.cacheEvictions || m.cacheExpirations)
      return ["Finite-cache measurements require the finite LRU model."];
  } else if (m.cacheHits || m.cacheMisses || m.cacheEntries || m.cacheEvictions || m.cacheExpirations)
    return ["Cache measurements require a cache component."];
  if (!isJobGraph(run.graph)) {
    if (!m.edges || Object.keys(m.edges).length !== run.graph.edges.length || run.graph.edges.some((e) => !Number.isSafeInteger(m.edges?.[e.id]) || m.edges![e.id] < 0 || m.edges![e.id] > m.generated))
      return ["Saved connection measurements are invalid."];
    const balancer = run.graph.nodes.find((n) => n.kind === "balancer");
    if (balancer) {
      const services = run.graph.nodes.filter((n) => n.kind === "service");
      if (services.some((n, i) => m.nodes[n.id].arrived !== Math.floor(m.generated / services.length) + (i < m.generated % services.length ? 1 : 0)) ||
        run.graph.edges.filter((e) => e.source === balancer.id).some((e) => m.edges![e.id] !== m.nodes[e.target].arrived))
        return ["Saved routing counts do not reconcile with round robin."];
    }
  }
  if (!Array.isArray(m.history) || m.history.length !== Math.floor(m.time))
    return ["Saved time-series samples are invalid."];
  for (let i = 0; i < m.history.length; i++) {
    const sample = m.history[i];
    if (
      !sample ||
      sample.time !== i + 1 ||
      ["queue", "completed", "generated", "arrivalRate", "latency"].some(
        (k) =>
          !Number.isFinite(sample[k as keyof typeof sample]) ||
          sample[k as keyof typeof sample] < 0,
      ) ||
      sample.completed > sample.generated ||
      sample.generated > m.generated
    )
      return ["Saved time-series samples are invalid."];
  }
  return [];
}
export function comparisonStatus(a: SavedRun, b: SavedRun) {
  if (a.modelVersion !== b.modelVersion)
    return {
      matched: false,
      message: "Different simulation model versions. Results are not directly comparable.",
    };
  const workloadMatched = sameGraphWorkload(a.graph, b.graph);
  if (a.modelVersion === "open-system/1") {
    return defaultWorkloadComparisonStatus(a.graph, b.graph, workloadMatched, a.metrics.generated === b.metrics.generated);
  }
  if (!workloadMatched)
    return {
      matched: false,
      message:
        "Different workloads. Traffic profile, URL popularity or catalog, seed, duration or timeout changed; this is not a controlled architecture comparison.",
    };
  if (a.metrics.generated !== b.metrics.generated)
    return {
      matched: false,
      message:
        "Workload settings match, but arrival counts differ. Rerun both models to verify the comparison.",
    };
  return {
    matched: true,
    message:
      "Same traffic profile, URL distribution, seed, duration and timeout. Generated arrival counts match; cache settings are architecture assumptions.",
  };
}
export function modelChanges(a: Graph, b: Graph): string[] {
  const changes: string[] = [];
  if (a.executionVersion === "open-system/1" || b.executionVersion === "open-system/1") {
    const beforeNodes = a.nodes, afterNodes = b.nodes;
    const matched = new Set<string>();
    const pairs: { before?: ModelNode; after?: ModelNode }[] = beforeNodes.map((before) => {
      const after = afterNodes.find((n) => n.id === before.id);
      if (after) matched.add(after.id);
      return { before, after };
    });
    for (const after of afterNodes.filter((n) => !matched.has(n.id))) pairs.push({ before: undefined, after });

    for (const { before, after } of pairs) {
      if (!before && after) {
        changes.push(`${after.name} added.`);
        continue;
      }
      if (before && !after) {
        changes.push(`${before.name} removed.`);
        continue;
      }
      if (!before || !after) continue;

      const bb = before.behavior, ab = after.behavior;
      if (bb && ab) {
        if (bb.type !== ab.type) {
          changes.push(`${after.name} behavior type: ${bb.type} → ${ab.type}.`);
        }
        if (bb.capacity !== ab.capacity) {
          changes.push(`${after.name} capacity: ${bb.capacity} → ${ab.capacity} req/s.`);
        }
        if (bb.concurrency !== ab.concurrency) {
          changes.push(`${after.name} concurrency: ${bb.concurrency} → ${ab.concurrency}.`);
        }
        if (bb.queueLimit !== ab.queueLimit) {
          changes.push(`${after.name} queue limit: ${bb.queueLimit} → ${ab.queueLimit} slots.`);
        }
        if (bb.failureRate !== ab.failureRate) {
          changes.push(`${after.name} failure rate: ${bb.failureRate}% → ${ab.failureRate}%.`);
        }
        if (bb.maxRetries !== ab.maxRetries) {
          changes.push(`${after.name} max retries: ${bb.maxRetries} → ${ab.maxRetries}.`);
        }
        if (bb.retryDelayMs !== ab.retryDelayMs) {
          changes.push(`${after.name} retry delay: ${bb.retryDelayMs} → ${ab.retryDelayMs} ms.`);
        }
        if (bb.type === "storage" && ab.type === "storage" && bb.writeCapacity !== ab.writeCapacity) {
          changes.push(`${after.name} write capacity: ${bb.writeCapacity} → ${ab.writeCapacity} req/s.`);
        }
        if (bb.type === "cache" && ab.type === "cache") {
          if (bb.mode !== ab.mode) changes.push(`${after.name} cache mode: ${bb.mode} → ${ab.mode}.`);
          if (bb.hitRate !== ab.hitRate) changes.push(`${after.name} cache hit rate: ${bb.hitRate}% → ${ab.hitRate}%.`);
          if (bb.entries !== ab.entries) changes.push(`${after.name} cache entries: ${bb.entries} → ${ab.entries}.`);
          if (bb.ttlMs !== ab.ttlMs) changes.push(`${after.name} cache TTL: ${bb.ttlMs} → ${ab.ttlMs} ms.`);
        }
        if (bb.type === "router" && ab.type === "router" && bb.strategy !== ab.strategy) {
          changes.push(`${after.name} routing strategy: ${bb.strategy} → ${ab.strategy}.`);
        }
        if (bb.type === "broker" && ab.type === "broker" && bb.delivery !== ab.delivery) {
          changes.push(`${after.name} broker delivery: ${bb.delivery} → ${ab.delivery}.`);
        }
      }
    }

    const edgeSig = (e: import("./model").ModelEdge) =>
      JSON.stringify({ source: e.source, target: e.target, transport: e.transport, latencyMs: e.latencyMs,
        returnLatencyMs: e.returnLatencyMs, ackDelayMs: e.ackDelayMs, messageTtlMs: e.messageTtlMs,
        weight: e.weight, condition: e.condition, fallback: e.fallback, needsReview: e.needsReview });
    const beforeEdges = new Map(a.edges.map(e => [e.id, e]));
    const afterEdges = new Map(b.edges.map(e => [e.id, e]));
    let edgesChanged = false;
    if (a.edges.length !== b.edges.length) {
      edgesChanged = true;
    } else {
      for (const [id, be] of beforeEdges) {
        const ae = afterEdges.get(id);
        if (!ae || edgeSig(be) !== edgeSig(ae)) {
          edgesChanged = true;
          break;
        }
      }
    }
    if (edgesChanged) {
      changes.push("Connections changed; inspect each saved model for its routing path.");
    }
    return changes;
  }

  const beforeNodes = a.nodes.filter((n) => n.kind !== "traffic"), afterNodes = b.nodes.filter((n) => n.kind !== "traffic");
  const matched = new Set<string>();
  const pairs: { before?: ModelNode; after?: ModelNode }[] = beforeNodes.map((before) => {
    const after = afterNodes.find((n) => n.id === before.id) ??
      (beforeNodes.filter((n) => n.kind === before.kind).length === 1 && afterNodes.filter((n) => n.kind === before.kind).length === 1
        ? afterNodes.find((n) => n.kind === before.kind) : undefined);
    if (after) matched.add(after.id);
    return { before, after };
  });
  for (const after of afterNodes.filter((n) => !matched.has(n.id))) pairs.push({ before: undefined, after });
  for (const {before, after} of pairs) {
    const kind = (after ?? before)!.kind;
    if (!before && after) {
      changes.push(
        `${after.name} added${kind === "cache" ? ` (${cacheDescription(after)})` : ""}.`,
      );
      continue;
    }
    if (before && !after) {
      changes.push(`${before.name} removed.`);
      continue;
    }
    if (!before || !after) continue;
    if (workerCount(before) !== workerCount(after))
      changes.push(
        `${after.name} workers: ${workerCount(before)} → ${workerCount(after)}.`,
      );
    if (before.capacity !== after.capacity)
      changes.push(
        `${after.name} ${["service", "worker"].includes(kind) ? "capacity per worker" : "capacity"}: ${before.capacity} → ${after.capacity} req/s.`,
      );
    if (before.queueLimit !== after.queueLimit)
      changes.push(
        `${after.name} queue: ${before.queueLimit} → ${after.queueLimit} slots.`,
      );
    if (kind === "worker") {
      for (const [key, label, fallback] of [
        ["failureRate", "failure rate (%)", 0],
        ["maxRetries", "max retries", 2],
        ["retryDelayMs", "retry delay (ms)", 100],
      ] as const)
        if ((before[key] ?? fallback) !== (after[key] ?? fallback))
          changes.push(
            `${after.name} ${label}: ${before[key] ?? fallback} → ${after[key] ?? fallback}.`,
          );
    }
    if (kind === "cache" && before.hitRate !== after.hitRate)
      changes.push(`Cache hit rate: ${before.hitRate}% → ${after.hitRate}%.`);
    if (kind === "cache" && (before.cacheMode ?? "fixed") !== (after.cacheMode ?? "fixed"))
      changes.push(`Cache model: ${before.cacheMode ?? "fixed"} → ${after.cacheMode ?? "fixed"}.`);
    if (kind === "cache" && (before.cacheEntries ?? 100) !== (after.cacheEntries ?? 100))
      changes.push(`Cache entries: ${before.cacheEntries ?? 100} → ${after.cacheEntries ?? 100}.`);
    if (kind === "cache" && (before.cacheTtlMs ?? 10000) !== (after.cacheTtlMs ?? 10000))
      changes.push(`Cache TTL: ${before.cacheTtlMs ?? 10000} → ${after.cacheTtlMs ?? 10000} ms.`);
  }
  const routes = (g: Graph) => g.edges.map((e) => `${e.source}>${e.target}`).sort().join(",");
  if (a.nodes.length === b.nodes.length && a.nodes.every((n) => b.nodes.some((other) => other.id === n.id)) && routes(a) !== routes(b)) changes.push("Connections changed; inspect each saved model for its routing path.");
  return changes;
}

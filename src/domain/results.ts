import {
  clone,
  validateGraph,
  workerCount,
  isJobGraph,
  type Graph,
  type ModelNode,
} from "./model";
import { failureCount, type Metrics } from "./metrics";
import { sameWorkload, profileLabel } from "./workload";

export const MODEL_VERSION = "url-lookup/4";
export const modelVersion = (graph: Graph) =>
  isJobGraph(graph) ? "background-jobs/1" : MODEL_VERSION;
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
  if (isJobGraph(graph))
    return `${profileLabel(graph.settings)} · background jobs`.slice(0, 80);
  const instances = graph.nodes.filter((n) => n.kind === "service");
  if (graph.nodes.some((n) => n.kind === "balancer")) return `${profileLabel(graph.settings)} · ${instances.length} service instances`.slice(0, 80);
  const cache = graph.nodes.find((n) => n.kind === "cache");
  return `${profileLabel(graph.settings)} · ${cache ? `${cache.hitRate}% cache` : "no cache"}`.slice(
    0,
    80,
  );
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
  if (![MODEL_VERSION, "background-jobs/1"].includes(run.modelVersion))
    return ["This saved result uses an unsupported simulation model version."];
  const graphErrors = validateGraph(run.graph);
  if (graphErrors.length) return graphErrors;
  if (run.modelVersion !== modelVersion(run.graph))
    return ["Saved result model does not match its experiment path."];
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
      message:
        "Different simulation model versions. Results are not directly comparable.",
    };
  if (!sameWorkload(a.graph.settings, b.graph.settings))
    return {
      matched: false,
      message:
        "Different workloads. Traffic profile, seed, duration or timeout changed; this is not a controlled architecture comparison.",
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
      "Same traffic profile, seed, duration and timeout. Generated arrival counts match.",
  };
}
export function modelChanges(a: Graph, b: Graph): string[] {
  const changes: string[] = [];
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
        `${after.name} added${kind === "cache" ? ` (${after.hitRate}% hit rate)` : ""}.`,
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
  }
  const routes = (g: Graph) => g.edges.map((e) => `${e.source}>${e.target}`).sort().join(",");
  if (a.nodes.length === b.nodes.length && a.nodes.every((n) => b.nodes.some((other) => other.id === n.id)) && routes(a) !== routes(b)) changes.push("Connections changed; inspect each saved model for its routing path.");
  return changes;
}

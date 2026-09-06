import { clone, validateGraph, workerCount, type Graph } from "./model";
import type { Metrics } from "./metrics";
import { sameWorkload, profileLabel } from "./workload";

export const MODEL_VERSION = "url-lookup/3";
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
    modelVersion: MODEL_VERSION,
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
  if (!["url-lookup/2", MODEL_VERSION].includes(run.modelVersion))
    return ["This saved result uses an unsupported simulation model version."];
  const graphErrors = validateGraph(run.graph);
  if (graphErrors.length) return graphErrors;
  if (
    run.modelVersion === "url-lookup/2" &&
    run.graph.nodes.some((node) => workerCount(node) !== 1)
  )
    return ["Historical model results must use one worker per component."];
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
    m.generated !== m.succeeded + m.dropped + m.timedOut + m.inFlight ||
    Math.abs(m.throughput - m.succeeded / m.time) > 1e-6 ||
    m.cacheHits > m.generated ||
    m.databaseLookups > m.generated
  )
    return ["Saved result request counts do not reconcile."];
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
      ((run.modelVersion === MODEL_VERSION || n.activeWorkers !== undefined) &&
        (!Number.isInteger(n.activeWorkers) ||
          n.activeWorkers! < 0 ||
          n.activeWorkers! > workerCount(node) ||
          n.busy !== n.activeWorkers! > 0)) ||
      !Number.isFinite(n.utilization) ||
      n.utilization < 0 ||
      n.utilization > 1 ||
      n.queued > node.queueLimit
    )
      return ["Saved component measurements are invalid."];
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
  for (const kind of ["service", "cache", "database"] as const) {
    const before = a.nodes.find((n) => n.kind === kind),
      after = b.nodes.find((n) => n.kind === kind);
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
        `${after.name} ${kind === "service" ? "capacity per worker" : "capacity"}: ${before.capacity} → ${after.capacity} req/s.`,
      );
    if (before.queueLimit !== after.queueLimit)
      changes.push(
        `${after.name} queue: ${before.queueLimit} → ${after.queueLimit} slots.`,
      );
    if (kind === "cache" && before.hitRate !== after.hitRate)
      changes.push(`Cache hit rate: ${before.hitRate}% → ${after.hitRate}%.`);
  }
  return changes;
}

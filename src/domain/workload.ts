import type { Graph, Settings } from "./model";

export type TrafficProfile =
  | { kind: "steady" }
  | { kind: "burst"; peakRate: number; start: number; end: number }
  | { kind: "ramp"; endRate: number };

export function rateAt(settings: Settings, time: number): number {
  const p = settings.profile,
    t = Math.max(0, Math.min(time, settings.duration));
  if (p?.kind === "burst")
    return t >= p.start && t < p.end ? p.peakRate : settings.traffic;
  if (p?.kind === "ramp")
    return (
      settings.traffic +
      ((p.endRate - settings.traffic) * t) / settings.duration
    );
  return settings.traffic;
}

/** Invert integrated intensity, carrying unused exponential hazard across boundaries.
 * This generates non-homogeneous Poisson arrivals without time-step approximations.
 */
export function nextArrivalTime(
  settings: Settings,
  after: number,
  hazard: number,
): number {
  const p = settings.profile;
  if (!p || p.kind === "steady") return after + hazard / settings.traffic;
  if (p.kind === "ramp") {
    const rate = rateAt(settings, after),
      slope = (p.endRate - settings.traffic) / settings.duration;
    const remaining = settings.duration - after;
    if (hazard > rate * remaining + 0.5 * slope * remaining * remaining)
      return Infinity;
    if (slope === 0) return after + hazard / rate;
    return (
      after +
      (2 * hazard) /
        (rate + Math.sqrt(Math.max(0, rate * rate + 2 * slope * hazard)))
    );
  }
  let time = after,
    remainingHazard = hazard;
  for (const [boundary, rate] of [
    [p.start, settings.traffic],
    [p.end, p.peakRate],
    [settings.duration, settings.traffic],
  ]) {
    if (boundary <= time) continue;
    const mass = (boundary - time) * rate;
    if (remainingHazard <= mass) return time + remainingHazard / rate;
    remainingHazard -= mass;
    time = boundary;
  }
  return Infinity;
}

export function profileLabel(settings: Settings) {
  const p = settings.profile;
  if (p?.kind === "burst")
    return `${settings.traffic} → ${p.peakRate} → ${settings.traffic} req/s · burst ${p.start}–${p.end}s`;
  if (p?.kind === "ramp")
    return `${settings.traffic} → ${p.endRate} req/s · linear ramp`;
  return `${settings.traffic} req/s · steady`;
}

export function sameWorkload(a: Settings, b: Settings) {
  if (
    a.traffic !== b.traffic ||
    a.seed !== b.seed ||
    a.duration !== b.duration ||
    a.timeoutMs !== b.timeoutMs
  )
    return false;
  const p = a.profile ?? { kind: "steady" },
    q = b.profile ?? { kind: "steady" };
  if (p.kind !== q.kind) return false;
  if (p.kind === "burst" && q.kind === "burst")
    return p.start === q.start && p.end === q.end && p.peakRate === q.peakRate;
  if (p.kind === "ramp" && q.kind === "ramp") return p.endRate === q.endRate;
  return true;
}

function normalizeClasses(classes: import("./execution").RequestClass[]) {
  return classes.map(c => ({
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
  }));
}

function normalizeProfile(p?: TrafficProfile) {
  if (!p || p.kind === "steady") return { kind: "steady" as const };
  if (p.kind === "ramp") return { kind: "ramp" as const, endRate: p.endRate };
  return { kind: "burst" as const, peakRate: p.peakRate, start: p.start, end: p.end };
}

export function defaultWorkloadComparisonStatus(a: Graph, b: Graph, matched: boolean, arrivalsMatch: boolean) {
  if (!matched) {
    const mismatchReasons: string[] = [];
    const aWorkloads = (a.workloads ?? []).filter(w => w.enabled);
    const bWorkloads = (b.workloads ?? []).filter(w => w.enabled);
    if (aWorkloads.length !== bWorkloads.length) {
      mismatchReasons.push("workload count");
    }
    const aEntries = aWorkloads.map(w => w.entryNodeId).sort().join(",");
    const bEntries = bWorkloads.map(w => w.entryNodeId).sort().join(",");
    if (aEntries !== bEntries) mismatchReasons.push("entry points");
    const aClasses = aWorkloads.flatMap(w => w.classes.map(c => `${c.id}:${c.name}:${c.operation}`)).sort().join(",");
    const bClasses = bWorkloads.flatMap(w => w.classes.map(c => `${c.id}:${c.name}:${c.operation}`)).sort().join(",");
    if (aClasses !== bClasses) mismatchReasons.push("request classes");
    const aDeadlines = aWorkloads.map(w => w.timeoutMs).join(",");
    const bDeadlines = bWorkloads.map(w => w.timeoutMs).join(",");
    if (aDeadlines !== bDeadlines) mismatchReasons.push("deadlines");

    const reasonSuffix = mismatchReasons.length ? ` (${mismatchReasons.join(", ")})` : "";
    return {
      matched: false,
      message: `Different workloads. Workload definitions, entry points, request classes, seed, duration or deadlines changed${reasonSuffix}; this is not a controlled architecture comparison.`,
    };
  }
  if (!arrivalsMatch) {
    return {
      matched: false,
      message: "Workload settings match, but arrival counts differ. Rerun both models to verify the comparison.",
    };
  }
  return {
    matched: true,
    message: "Matching workload definitions, entry points, seed, and duration. Generated arrival counts match; node behaviors are architecture assumptions.",
  };
}

/** Effective request inputs only. Cache settings are architecture decisions. */
export function sameGraphWorkload(a: Graph, b: Graph): boolean {
  if (a.executionVersion === "open-system/1" || b.executionVersion === "open-system/1") {
    if (a.executionVersion !== b.executionVersion) return false;
    if (a.settings.seed !== b.settings.seed || a.settings.duration !== b.settings.duration) return false;
    const aWorkloads = (a.workloads ?? []).filter(w => w.enabled);
    const bWorkloads = (b.workloads ?? []).filter(w => w.enabled);
    if (aWorkloads.length !== bWorkloads.length) return false;
    const normA = aWorkloads.map(w => ({ id: w.id, entry: w.entryNodeId, rate: w.rate, profile: normalizeProfile(w.profile), timeout: w.timeoutMs, interval: w.intervalMs, classes: normalizeClasses(w.classes) }));
    const normB = bWorkloads.map(w => ({ id: w.id, entry: w.entryNodeId, rate: w.rate, profile: normalizeProfile(w.profile), timeout: w.timeoutMs, interval: w.intervalMs, classes: normalizeClasses(w.classes) }));
    return JSON.stringify(normA) === JSON.stringify(normB);
  }
  const jobs = a.scenario === "jobs";
  if (jobs !== (b.scenario === "jobs") || !sameWorkload(a.settings, b.settings))
    return false;
  if (jobs) return true;
  const distribution = (graph: Graph) => {
    const source = graph.nodes.find((node) => node.kind === "traffic");
    const hot = source?.popularity === "hot";
    return [
      hot ? "hot" : "uniform",
      source?.catalogSize ?? 1000,
      hot ? (source?.hotSubset ?? 10) : 0,
      hot ? (source?.hotShare ?? 80) : 0,
    ].join(":");
  };
  return distribution(a) === distribution(b);
}

export function validateProfile(settings: Settings): string[] {
  const p = settings.profile;
  if (p === undefined) return [];
  if (!p || !["steady", "burst", "ramp"].includes(p.kind))
    return ["Choose a steady, burst or ramp workload."];
  const validRate = (value: number) =>
    Number.isFinite(value) && value >= 1 && value <= 10000;
  if (p.kind === "ramp" && !validRate(p.endRate))
    return ["Ramp end traffic must be between 1 and 10,000 requests/s."];
  if (
    p.kind === "burst" &&
    (!validRate(p.peakRate) ||
      !Number.isFinite(p.start) ||
      !Number.isFinite(p.end) ||
      p.start < 0 ||
      p.end <= p.start ||
      p.end > settings.duration)
  )
    return ["Burst needs a valid rate and 0 ≤ start < end ≤ run duration."];
  return [];
}

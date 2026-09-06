import type { Settings } from "./model";

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

export type TrafficProfile =
  | { kind: "steady" }
  | { kind: "burst"; peakRate: number; start: number; end: number }
  | { kind: "ramp"; endRate: number };

/** Arrival inputs the open kernel supplies for one workload. */
export interface ArrivalSettings {
  traffic: number;
  duration: number;
  profile?: TrafficProfile;
}

function rateAt(settings: ArrivalSettings, time: number): number {
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
  settings: ArrivalSettings,
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

import type { LegAt } from "../runs/playback";

export const PACKET_THRESHOLD = 6;

export function trafficDensity(legs: readonly LegAt[]) {
  const out = legs.filter((leg) => leg.direction === "out").length;
  return {
    aggregate: legs.length > PACKET_THRESHOLD,
    count: legs.length,
    out,
    back: legs.length - out,
    durationSeconds: Math.max(
      0.15,
      1 / Math.sqrt(Math.max(1, legs.length) / PACKET_THRESHOLD),
    ),
    dash: `${Math.min(12, 2 + legs.length / 6)} 5`,
  };
}

export function placeLeg(
  path: {
    getTotalLength(): number;
    getPointAtLength(distance: number): { x: number; y: number };
  },
  leg: LegAt,
  reduced = false,
  staticProgress = 0.5,
) {
  const length = path.getTotalLength();
  const progress = reduced
    ? staticProgress
    : Math.max(0, Math.min(1, leg.progress));
  const distance =
    length * (!reduced && leg.direction === "back" ? 1 - progress : progress);
  const point = path.getPointAtLength(distance);
  const before = path.getPointAtLength(Math.max(0, distance - 1));
  const after = path.getPointAtLength(Math.min(length, distance + 1));
  return {
    ...point,
    heading:
      (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI +
      (leg.direction === "back" ? 180 : 0),
  };
}

import type { Cycle } from "../../domain/studio/runner/types";

export const CYCLE_BAND_THRESHOLD = 200;
export const timelineUsesDensity = (count: number): boolean =>
  count > CYCLE_BAND_THRESHOLD;

export function timelinePosition(
  time: number,
  start: number,
  end: number,
): number {
  return end <= start
    ? 0
    : Math.max(0, Math.min(100, (100 * (time - start)) / (end - start)));
}

export function cycleBand(cycle: Cycle, start: number, end: number) {
  const left = timelinePosition(cycle.startedAtMs, start, end);
  const right = timelinePosition(cycle.completedAtMs ?? end, start, end);
  return {
    left,
    width: Math.max(0, right - left),
    response:
      cycle.responseAtMs === null
        ? null
        : timelinePosition(cycle.responseAtMs, start, end),
  };
}

/** Count every interval overlapping each bin; no sampling of cycles. */
export function cycleDensity(
  cycles: readonly Cycle[],
  start: number,
  end: number,
  bins = 64,
): readonly number[] {
  const counts = Array<number>(bins).fill(0);
  if (end <= start) return counts;
  const changes = Array<number>(bins + 1).fill(0);
  for (const cycle of cycles) {
    const finish = cycle.completedAtMs ?? end;
    if (cycle.startedAtMs > end || finish < start) continue;
    const first = Math.min(
      bins - 1,
      Math.floor(
        (timelinePosition(cycle.startedAtMs, start, end) * bins) / 100,
      ),
    );
    const last = Math.min(
      bins - 1,
      Math.floor((timelinePosition(finish, start, end) * bins) / 100),
    );
    changes[first]++;
    changes[last + 1]--;
  }
  let active = 0;
  for (let i = 0; i < bins; i++) {
    active += changes[i];
    counts[i] = active;
  }
  return counts;
}

export function formatPlaybackTime(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Bound marker DOM for dense recordings while retaining every stuck cycle. */
export function stuckMarkers(
  cycles: readonly Cycle[],
  start: number,
  end: number,
) {
  const grouped = new Map<number, number>();
  const dense = timelineUsesDensity(cycles.length);
  for (const cycle of cycles) {
    if (cycle.outcome !== "stuck") continue;
    const position = timelinePosition(cycle.completedAtMs ?? end, start, end);
    const left = dense
      ? (Math.min(63, Math.floor((position * 64) / 100)) * 100) / 64
      : position;
    grouped.set(left, (grouped.get(left) ?? 0) + 1);
  }
  return [...grouped].map(([left, count]) => ({ left, count }));
}

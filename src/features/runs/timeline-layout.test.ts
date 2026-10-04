import { describe, expect, it } from "vitest";
import type { Cycle } from "../../domain/studio/runner/types";
import {
  CYCLE_BAND_THRESHOLD,
  cycleBand,
  cycleDensity,
  formatPlaybackTime,
  timelinePosition,
  timelineUsesDensity,
  stuckMarkers,
} from "./timeline-layout";

const cycle = (
  start: number,
  end: number | null,
  response: number | null = null,
): Cycle => ({
  id: `${start}`,
  workloadId: "source",
  startedAtMs: start,
  completedAtMs: end,
  responseAtMs: response,
  outcome: end === null ? null : "ok",
  counts: {
    ok: 0,
    failed: 0,
    rejected: 0,
    "timed-out": 0,
    expired: 0,
    lost: 0,
    stuck: 0,
  },
});

describe("timeline geometry", () => {
  it("clamps times against the retained window and handles an empty recording", () => {
    expect(timelinePosition(0, 100, 200)).toBe(0);
    expect(timelinePosition(150, 100, 200)).toBe(50);
    expect(timelinePosition(300, 100, 200)).toBe(100);
    expect(timelinePosition(0, 0, 0)).toBe(0);
  });
  it("places response independently from completion and extends open cycles to the edge", () => {
    expect(cycleBand(cycle(10, 80, 30), 0, 100)).toEqual({
      left: 10,
      width: 70,
      response: 30,
    });
    expect(cycleBand(cycle(10, null), 0, 100)).toEqual({
      left: 10,
      width: 90,
      response: null,
    });
  });
  it("counts all overlapping cycles rather than a sample at the density threshold", () => {
    expect(CYCLE_BAND_THRESHOLD).toBe(200);
    expect(timelineUsesDensity(200)).toBe(false);
    expect(timelineUsesDensity(201)).toBe(true);
    expect(
      cycleDensity([cycle(0, 24), cycle(25, 49), cycle(0, null)], 0, 100, 4),
    ).toEqual([2, 2, 1, 1]);
    expect(
      cycleDensity(
        Array.from({ length: 201 }, () => cycle(0, 100)),
        0,
        100,
        4,
      ),
    ).toEqual([201, 201, 201, 201]);
    expect(cycleDensity([cycle(0, 99), cycle(201, 300)], 100, 200, 2)).toEqual([
      0, 0,
    ]);
  });
  it("keeps the clock in a fixed format", () => {
    expect(formatPlaybackTime(1234)).toBe("1.23 s");
  });
  it("bounds stuck markers and conserves their count in a dense recording", () => {
    const cycles = Array.from({ length: 1000 }, (_, i) => ({
      ...cycle(0, i),
      outcome: "stuck" as const,
    }));
    const markers = stuckMarkers(cycles, 0, 1000);
    expect(markers.length).toBeLessThanOrEqual(64);
    expect(markers.reduce((sum, marker) => sum + marker.count, 0)).toBe(1000);
  });
});

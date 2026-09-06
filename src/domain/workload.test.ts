import { expect, it } from "vitest";
import { baseline } from "./model";
import {
  nextArrivalTime,
  rateAt,
  sameWorkload,
  validateProfile,
} from "./workload";
import { Simulation } from "../simulation/engine";

it("carries arrival hazard across both burst boundaries", () => {
  const s = {
    ...baseline().settings,
    traffic: 100,
    profile: { kind: "burst" as const, peakRate: 700, start: 10, end: 20 },
  };
  expect(nextArrivalTime(s, 9.99, 8)).toBeCloseTo(10.01, 10);
  expect(nextArrivalTime(s, 19.99, 8)).toBeCloseTo(20.01, 10);
  expect(rateAt(s, 10)).toBe(700);
  expect(rateAt(s, 20)).toBe(100);
});
it("inverts increasing and decreasing linear arrival rates", () => {
  for (const [start, end] of [
    [100, 700],
    [700, 100],
    [100, 100],
  ]) {
    const s = {
      ...baseline().settings,
      traffic: start,
      profile: { kind: "ramp" as const, endRate: end },
    };
    const next = nextArrivalTime(s, 10, 100),
      dt = next - 10,
      slope = (end - start) / s.duration;
    expect(rateAt(s, 10) * dt + 0.5 * slope * dt * dt).toBeCloseTo(100, 8);
    expect(nextArrivalTime(s, 29, 100000)).toBe(Infinity);
  }
});
it("burst overload builds a queue that drains after traffic returns to baseline", () => {
  const g = baseline();
  g.settings.profile = { kind: "burst", peakRate: 700, start: 10, end: 20 };
  const sim = new Simulation(g),
    peak = sim.advance(20),
    end = sim.advance(30);
  expect(peak.nodes[g.nodes[2].id].queued).toBeGreaterThan(400);
  expect(end.nodes[g.nodes[2].id].queued).toBeLessThan(5);
  expect(end.dropped).toBeGreaterThan(1000);
  expect(end.generated).toBe(
    end.succeeded + end.dropped + end.timedOut + end.inFlight,
  );
  expect(end).toEqual(new Simulation(g).advance(30));
});
it("ramp replay is independent of advance chunking", () => {
  const g = baseline();
  g.settings.profile = { kind: "ramp", endRate: 700 };
  const sim = new Simulation(g);
  for (let t = 0.5; t < 30; t += 0.5) sim.advance(t);
  expect(sim.advance(30)).toEqual(new Simulation(g).advance(30));
});
it("rejects invalid profiles and distinguishes changed workloads", () => {
  const s = baseline().settings;
  expect(sameWorkload(s, { ...s, profile: { kind: "steady" } })).toBe(true);
  expect(
    sameWorkload(s, { ...s, profile: { kind: "ramp", endRate: 700 } }),
  ).toBe(false);
  expect(
    validateProfile({
      ...s,
      profile: { kind: "burst", peakRate: 700, start: 20, end: 10 },
    }),
  ).not.toEqual([]);
});
it("compares profiles by meaning rather than JSON property order", () => {
  const s = baseline().settings;
  expect(
    sameWorkload(
      { ...s, profile: { kind: "burst", start: 10, end: 20, peakRate: 700 } },
      { ...s, profile: { peakRate: 700, end: 20, start: 10, kind: "burst" } },
    ),
  ).toBe(true);
});

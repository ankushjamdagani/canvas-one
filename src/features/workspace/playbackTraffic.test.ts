import { describe, expect, it } from "vitest";
import { placeLeg, trafficDensity, PACKET_THRESHOLD } from "./playbackTraffic";
import type { LegAt } from "../runs/playback";

const line = {
  getTotalLength: () => 100,
  getPointAtLength: (distance: number) => ({ x: distance, y: 10 }),
};
const leg = (
  progress: number,
  direction: LegAt["direction"] = "out",
): LegAt => ({ key: "unit", connectionId: "link", direction, progress });
describe("canvas playback placement", () => {
  it("places departure, halfway and arrival on the recorded path", () => {
    expect(placeLeg(line, leg(0))).toEqual({ x: 0, y: 10, heading: 0 });
    expect(placeLeg(line, leg(0.5))).toEqual({ x: 50, y: 10, heading: 0 });
    expect(placeLeg(line, leg(1))).toEqual({ x: 100, y: 10, heading: 0 });
  });
  it("reverses returning placement and heading", () => {
    expect(placeLeg(line, leg(0, "back"))).toEqual({
      x: 100,
      y: 10,
      heading: 180,
    });
    expect(placeLeg(line, leg(0.25, "back"))).toEqual({
      x: 75,
      y: 10,
      heading: 180,
    });
    expect(placeLeg(line, leg(1, "back"))).toEqual({
      x: 0,
      y: 10,
      heading: 180,
    });
  });
  it("holds reduced-motion markers at the midpoint while retaining direction", () => {
    expect(placeLeg(line, leg(0.2), true)).toEqual({
      x: 50,
      y: 10,
      heading: 0,
    });
    expect(placeLeg(line, leg(0.8, "back"), true)).toEqual({
      x: 50,
      y: 10,
      heading: 180,
    });
  });
  it("keeps reduced-motion units distinct even when their directions differ", () => {
    expect(placeLeg(line, leg(0.8, "out"), true, 0.25).x).toBe(25);
    expect(placeLeg(line, leg(0.2, "back"), true, 0.75).x).toBe(75);
  });
});
describe("canvas traffic density", () => {
  it("keeps all six packets individual and switches at seven", () => {
    expect(PACKET_THRESHOLD).toBe(6);
    expect(
      trafficDensity(Array.from({ length: 6 }, () => leg(0.5))).aggregate,
    ).toBe(false);
    expect(
      trafficDensity(Array.from({ length: 7 }, () => leg(0.5))).aggregate,
    ).toBe(true);
  });
  it("counts every direction and increases flow with load", () => {
    const mixed = trafficDensity([leg(0), leg(0), leg(0, "back")]);
    expect(mixed).toMatchObject({ count: 3, out: 2, back: 1 });
    const light = trafficDensity(Array.from({ length: 7 }, () => leg(0)));
    const heavy = trafficDensity(Array.from({ length: 70 }, () => leg(0)));
    expect(heavy.durationSeconds).toBeLessThan(light.durationSeconds);
    expect(heavy.dash).not.toBe(light.dash);
  });
});

import { describe, expect, it } from "vitest";
import {
  clampWindow,
  moveRangeEndpoint,
  panWindow,
  rangeFromDrag,
  timeAtPosition,
  zoomWindow,
} from "./timeline-gestures";

const bounds = { startMs: 0, endMs: 1000 };

describe("timeline gesture math", () => {
  it("never zooms beyond a recording shorter than the minimum viewport span", () => {
    const short = { startMs: 5, endMs: 8 };
    expect(clampWindow(short, short, 10)).toEqual(short);
    expect(zoomWindow(short, 6, 2, short, 10)).toEqual(short);
  });
  it("maps positions to time and clamps pointer positions at the edges", () => {
    const window = { startMs: 200, endMs: 600 };
    expect(timeAtPosition(50, 50, 200, window)).toBe(200);
    expect(timeAtPosition(150, 50, 200, window)).toBe(400);
    expect(timeAtPosition(300, 50, 200, window)).toBe(600);
    expect(timeAtPosition(-20, 50, 200, window)).toBe(200);
  });

  it("pans by the pointer delta and clamps at retained-history bounds", () => {
    expect(panWindow({ startMs: 200, endMs: 600 }, 50, 200, bounds)).toEqual({
      startMs: 100,
      endMs: 500,
    });
    expect(panWindow({ startMs: 0, endMs: 400 }, 80, 200, bounds)).toEqual({
      startMs: 0,
      endMs: 400,
    });
  });

  it("zooms around the anchor and clamps to the full recording", () => {
    expect(zoomWindow({ startMs: 200, endMs: 600 }, 300, 2, bounds)).toEqual({
      startMs: 250,
      endMs: 450,
    });
    expect(zoomWindow({ startMs: 200, endMs: 600 }, 200, 0.5, bounds)).toEqual({
      startMs: 200,
      endMs: 1000,
    });
    expect(clampWindow({ startMs: -20, endMs: 80 }, bounds)).toEqual({
      startMs: 0,
      endMs: 100,
    });
  });

  it("creates a nonempty range for either drag direction and clamps its endpoints", () => {
    expect(rangeFromDrag(700, 300, bounds)).toEqual({ startMs: 300, endMs: 700 });
    expect(rangeFromDrag(0, 0, bounds)).toEqual({ startMs: 0, endMs: 1 });
    expect(moveRangeEndpoint({ startMs: 300, endMs: 700 }, "start", 900, bounds)).toEqual({
      startMs: 699,
      endMs: 700,
    });
    expect(moveRangeEndpoint({ startMs: 300, endMs: 700 }, "end", -10, bounds)).toEqual({
      startMs: 300,
      endMs: 301,
    });
  });
});

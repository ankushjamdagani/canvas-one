import { describe, expect, it } from "vitest";
import type { Cycle, FlowRecord } from "../../domain/studio/runner/types";
import { scopeMetricRows } from "./SimulationInspection";
import {
  intervalPosition,
  processingAttemptLabel,
  recordedProcessingIntervals,
  requestStartBins,
} from "./simulation-inspection-layout";
const event = (
  phase: FlowRecord["phase"],
  atMs: number,
  attempt: number,
): FlowRecord => ({
  key: "same-path",
  phase,
  atMs,
  attempt,
  connectionId: null,
  arriveAtMs: null,
  outcome: null,
});

const cycle = (id: string, startedAtMs: number, completedAtMs: number | null, outcome: Cycle["outcome"]): Cycle => ({
  id, workloadId: "workload", startedAtMs, responseAtMs: completedAtMs, completedAtMs, outcome,
  counts: { ok: 0, failed: 0, rejected: 0, expired: 0, "timed-out": 0, lost: 0, stuck: 0 },
});
describe("source measurement cohorts", () => {
  it("bins starts once, rather than counting overlapping long lifetimes", () => {
    const bins = requestStartBins([cycle("a", 0, 400, "ok"), cycle("b", 100, 400, "failed"), cycle("c", 100, null, null), cycle("outside", 401, 500, "ok")], 0, 400, 4);
    expect(bins).toEqual([{ succeeded: 1, failed: 0, open: 0 }, { succeeded: 0, failed: 1, open: 1 }, { succeeded: 0, failed: 0, open: 0 }, { succeeded: 0, failed: 0, open: 0 }]);
  });
  it("uses successful completions inside the half-open scope for latency", () => {
    const rows = scopeMetricRows({ starts: 5, responses: 5, completions: 5, failures: 1, activeAtStart: 0, activeAtEnd: 0, peakConcurrency: 2, responseLatenciesMs: [], completionLatenciesMs: [] }, [cycle("first", 0, 20, "ok"), cycle("second", 0, 40, "ok"), cycle("failure", 0, 900, "failed"), cycle("endpoint", 0, 1000, "ok"), cycle("open", 0, null, null)], { startMs: 0, endMs: 1000 });
    expect(rows.find(row => row.id === "mean")?.value).toBe("30.0 ms");
    expect(rows.find(row => row.id === "p95")?.value).toBe("40.0 ms");
  });
  it("does not report a measured zero latency without successful observations", () => {
    const rows = scopeMetricRows({ starts: 1, responses: 0, completions: 1, failures: 1, activeAtStart: 0, activeAtEnd: 0, peakConcurrency: 1, responseLatenciesMs: [], completionLatenciesMs: [] }, [cycle("failed", 0, 100, "failed")], { startMs: 0, endMs: 200 });
    expect(rows.find(row => row.id === "mean")?.value).toBe("Unavailable");
    expect(rows.find(row => row.id === "p95")?.value).toBe("Unavailable");
  });
});
describe("recorded processing intervals", () => {
  it("labels the recorded retry without inventing a retry for first processing", () => {
    expect(processingAttemptLabel(1)).toBe("");
    expect(processingAttemptLabel(2)).toBe(" · try 2");
    expect(processingAttemptLabel(undefined)).toBe("");
  });
  it("does not close a new attempt with an earlier fact at the same timestamp", () => {
    const facts = [
      event("processing", 5, 0),
      event("settled", 10, 0),
      event("processing", 10, 1),
      event("slot_released", 10, 0),
      event("settled", 20, 1),
    ];
    const intervals = recordedProcessingIntervals(facts);
    expect(intervals[0].stop).toBe(facts[1]);
    expect(intervals[1].stop).toBe(facts[4]);
  });
  it("leaves a retained interval without a matching end unavailable", () => {
    expect(
      recordedProcessingIntervals([
        event("processing", 10, 1),
        event("settled", 20, 0),
      ])[0].stop,
    ).toBeUndefined();
    expect(intervalPosition(10, undefined, 0, 20)).toEqual({
      left: 50,
      width: 0,
    });
  });
  it("bounds partial and outlying observations to the visible lifetime", () => {
    expect(intervalPosition(-5, 200, 0, 100)).toEqual({ left: 0, width: 100 });
    expect(intervalPosition(200, 300, 0, 100)).toEqual({ left: 100, width: 0 });
  });
});

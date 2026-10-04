import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Document } from "../../domain/studio/model";
import { checkReadiness } from "../../domain/studio/readiness";
import { ScenarioRunner } from "../../domain/studio/runner/scenario-runner";
import type { Cycle, FlowRecord, ResultDelta } from "../../domain/studio/runner/types";
import { PlaybackStore } from "./playback";

// Opt-in measurement: real S06 flow at flash-sale load, repeated to fill a 120 s
// recording without conflating the kernel's event ceiling with playback cost.
describe.skipIf(process.env.PROFILE_PLAYBACK !== "1")(
  "playback frame profile",
  () => {
    it("measures 600 requests/s over 120 seconds of recorded history", async () => {
      const fixture = JSON.parse(
        readFileSync("specs/revamp/fixtures/s06.json", "utf8"),
      ) as Document;
      const source = fixture.scenarios[0];
      const document: Document = {
        ...fixture,
        scenarios: [
          {
            ...source,
            workloads: source.workloads.map((w) => ({
              ...w,
              emission: {
                mode: "stream",
                ratePerSecond: 600,
                profile: { kind: "steady" },
              },
            })),
          },
        ],
      };
      expect(checkReadiness(document, source.id).ready).toBe(true);
      const runner = new ScenarioRunner(document, source.id, "profile", {
        stopAtMs: 10_000,
        streamOutCycles: true,
      });
      const sample: FlowRecord[] = [];
      const cycles: Cycle[] = [];
      const initial = runner.checkpoint();
      const deltas: ResultDelta[] = [];
      let telemetryMs = 0;
      let observations = 0;
      let more = true;
      while (more) {
        more = await runner.step();
        sample.push(...runner.drainFlow());
        cycles.push(...runner.drainCycles());
        if (!more || runner.nextEventAtMs() !== runner.simulatedMs) {
          const start = performance.now();
          const delta = runner.captureResultDelta();
          telemetryMs += performance.now() - start; observations++;
          if (delta) deltas.push(delta);
        }
      }
      sample.push(...runner.drainFlow());
      cycles.push(...runner.drainCycles());
      const store = new PlaybackStore({
        connectionTargets: new Map(
          document.connections.map((c) => [c.id, c.target.elementId]),
        ),
        historyMs: 120_000,
      });
      store.ingestCheckpoint(initial);
      for (let repeat = 0; repeat < 12; repeat++) {
        store.ingestFlow(
          sample.map((r) => ({
            ...r,
            key: `${repeat}/${r.key}`,
            atMs: r.atMs + repeat * 10_000,
            arriveAtMs:
              r.arriveAtMs === null ? null : r.arriveAtMs + repeat * 10_000,
          })),
        );
        store.ingestCycles(
          cycles.map((c) => ({
            ...c,
            id: `${repeat}/${c.id}`,
            observedAtMs: c.observedAtMs === undefined ? undefined : c.observedAtMs + repeat * 10_000,
            startedAtMs: c.startedAtMs + repeat * 10_000,
            responseAtMs:
              c.responseAtMs === null ? null : c.responseAtMs + repeat * 10_000,
            completedAtMs:
              c.completedAtMs === null
                ? null
                : c.completedAtMs + repeat * 10_000,
          })),
        );
        store.ingestResults(deltas.map(delta => ({ ...delta,
          atMs: delta.atMs + repeat * 10_000,
          elementMetrics: delta.elementMetrics?.map(metric => ({ ...metric,
            windowEndMs: (metric.windowEndMs ?? 0) + repeat * 10_000 })),
        })));
      }
      const end = 120_000;
      store.setComputedEdge(end);
      const coldStart = performance.now();
      store.stateAt(end - 1100);
      const coldReadMs = performance.now() - coldStart;
      for (let i = 0; i < 5; i++) store.stateAt(end - 1080 + i * 16);
      const timings: number[] = [];
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        store.stateAt(end - 1000 + i * 16);
        timings.push(performance.now() - start);
      }
      timings.sort((a, b) => a - b);
      store.resultsAt(end - 1100);
      const resultTimings: number[] = [];
      for (let i = 0; i < 60; i++) {
        const start = performance.now();
        store.resultsAt(end - 1000 + i * 16);
        resultTimings.push(performance.now() - start);
      }
      resultTimings.sort((a,b) => a-b);
      const timelineStart = performance.now();
      const timelineCycles = store.cyclesAt(end);
      const timelineReadMs = performance.now() - timelineStart;
      // Include a live-style cycle batch and report its ingestion separately.
      const cycleIngestStart = performance.now();
      store.ingestCycles(
        cycles
          .slice(0, 100)
          .map((c) => ({
            ...c,
            id: `new/${c.id}`,
            observedAtMs: c.observedAtMs === undefined ? undefined : c.observedAtMs + end,
            startedAtMs: c.startedAtMs + end,
            responseAtMs: null,
            completedAtMs:
              c.completedAtMs === null ? null : c.completedAtMs + end,
          })),
      );
      const cycleBatchIngestMs = performance.now() - cycleIngestStart;
      const batchStart = performance.now();
      store.stateAt(end);
      const cycleBatchReadMs = performance.now() - batchStart;
      const timelineBatchStart = performance.now();
      store.cyclesAt(end + 1000);
      const timelineBatchReadMs = performance.now() - timelineBatchStart;
      store.seek(end); store.setComputedEdge(end + 1000); store.playing = true;
      const evictionStart = performance.now(); store.advance(1000);
      const rollingEvictionMs = performance.now() - evictionStart;
      const afterEvictionStart = performance.now();
      store.stateAt(end + 1000); store.resultsAt(end + 1000); store.cyclesAt(end + 1000);
      const postEvictionReadMs = performance.now() - afterEvictionStart;
      process.stdout.write(
        JSON.stringify({
          records: sample.length * 12,
          cycles: cycles.length * 12,
          coldReadMs,
          cycleBatchIngestMs,
          cycleBatchReadMs,
          medianMs: timings[30],
          p95Ms: timings[57],
          maxMs: timings[59],
          resultMedianMs: resultTimings[30], resultP95Ms: resultTimings[57],
          timelineReadMs, timelineCycles: timelineCycles.length,
          timelineBatchReadMs,
          rollingEvictionMs, postEvictionReadMs,
          telemetryMs, observations, telemetryMeanMs: telemetryMs / observations,
          resultDeltas: deltas.length * 12,
        }) + '\n',
      );
      expect(sample.length).toBeGreaterThan(6000);
    }, 120_000);
  },
);

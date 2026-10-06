import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "../../domain/studio/model";
import { checkReadiness } from "../../domain/studio/readiness";
import { ScenarioRunner } from "../../domain/studio/runner/scenario-runner";
import type { Cycle, FlowRecord, ResultDelta } from "../../domain/studio/runner/types";
import { PlaybackStore } from "./playback";
import { FlashIndex } from './playback-flashes';
import { cycleDensity, stuckMarkers } from './timeline-layout';

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
        workloadEntries: new Map(document.scenarios[0].workloads.map(w => [w.id, w.entry.elementId])),
        connectionChannels: new Map(document.connections.flatMap(c => {
          const port = document.elements.find(e => e.id === c.source.elementId)?.ports.find(p => p.id === c.source.portId);
          return port ? [[c.id, port.channel] as const] : [];
        })),
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
            cycleId: r.cycleId === undefined ? undefined : `${repeat}/${r.cycleId}`,
            unitId: r.unitId === undefined ? undefined : `${repeat}/${r.unitId}`,
            parentUnitId: r.parentUnitId === undefined || r.parentUnitId === null ? r.parentUnitId : `${repeat}/${r.parentUnitId}`,
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
      const inspectionRange = { startMs: end - 10_000, endMs: end };
      const inspectionColdStart = performance.now();
      const inspectionCold = store.cyclesOverlappingRange(inspectionRange, { limit: 100 });
      const inspectionColdMs = performance.now() - inspectionColdStart;
      const inspectionWarmStart = performance.now();
      store.cyclesOverlappingRange(inspectionRange, { limit: 100 });
      const inspectionWarmMs = performance.now() - inspectionWarmStart;
      const inspectionStatsStart = performance.now();
      const inspectionStats = store.statisticsForRange(inspectionRange);
      const inspectionStatsMs = performance.now() - inspectionStatsStart;
      const broadInspectionStart = performance.now();
      const broadInspection = store.cyclesOverlappingRange({ startMs: 0, endMs: end }, { limit: 200 });
      const broadInspectionMs = performance.now() - broadInspectionStart;
      const inspectCycleId = inspectionCold.rows[0]?.id;
      const cycleEventStart = performance.now();
      const cycleEventPage = inspectCycleId ? store.flowEventsForCycle(inspectCycleId, { limit: 100 }) : { rows: [], total: 0 };
      const cycleEventPageMs = performance.now() - cycleEventStart;
      const densityStart = performance.now();
      cycleDensity(timelineCycles, 0, end);
      stuckMarkers(timelineCycles, 0, end);
      const timelineLayoutMs = performance.now() - densityStart;
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
      // Return endpoints are projected into the future; interleave new live
      // batches with reads after 120 s to catch repeated full-history sorting.
      const liveSample = sample.filter(r => r.atMs < 100);
      const liveReadTimings: number[] = [];
      const liveIngestTimings: number[] = [];
      // Interactive worker computation stays ahead of the playhead. Reading
      // exactly at batch start instead exercises late same-instant flow reset.
      store.stateAt(end - 2000);
      for (let batch = 0; batch < 60; batch++) {
        const offset = end + batch * 100;
        const records = liveSample.map(r => ({ ...r, key: `live/${batch}/${r.key}`,
          atMs: r.atMs + offset, arriveAtMs: r.arriveAtMs === null ? null : r.arriveAtMs + offset }));
        const ingestStart = performance.now(); store.ingestFlow(records);
        liveIngestTimings.push(performance.now() - ingestStart);
        const readStart = performance.now(); store.stateAt(offset - 2000 + 100);
        liveReadTimings.push(performance.now() - readStart);
      }
      liveReadTimings.sort((a,b) => a-b); liveIngestTimings.sort((a,b) => a-b);
      // Isolate flash cost from the inherited flow index, which re-sorts a
      // nonmonotone live batch together with all retained flow records.
      type FlashFact = Parameters<FlashIndex['add']>[0];
      const captureFlashes = (records: readonly FlowRecord[], revisions: readonly Cycle[]): FlashFact[] => {
        const facts: FlashFact[] = [];
        const add = FlashIndex.prototype.add;
        const spy = vi.spyOn(FlashIndex.prototype, 'add').mockImplementation(function(this: FlashIndex, fact) {
          facts.push(fact); add.call(this, fact);
        });
        try {
          const probe = new PlaybackStore({ historyMs: null,
            connectionTargets: new Map(document.connections.map(c => [c.id, c.target.elementId])),
            connectionChannels: new Map(document.connections.flatMap(c => {
              const port = document.elements.find(e => e.id === c.source.elementId)?.ports.find(p => p.id === c.source.portId);
              return port ? [[c.id, port.channel] as const] : [];
            })),
            workloadEntries: new Map(document.scenarios[0].workloads.map(w => [w.id, w.entry.elementId])),
          });
          probe.ingestFlow(records); probe.ingestCycles(revisions);
        } finally { spy.mockRestore(); }
        return facts;
      };
      const recordedFlashes = captureFlashes(sample, cycles);
      const liveFlashes = captureFlashes(liveSample, []);
      const flashIndex = new FlashIndex();
      for (let repeat = 0; repeat < 12; repeat++) for (const fact of recordedFlashes) {
        flashIndex.add({ ...fact, atMs: fact.atMs + repeat * 10_000 });
      }
      flashIndex.read(end - 2000);
      const flashLiveTimings: number[] = [];
      for (let batch = 0; batch < 60; batch++) {
        const offset = end + batch * 100;
        const started = performance.now();
        for (const fact of liveFlashes) flashIndex.add({ ...fact, atMs: fact.atMs + offset });
        flashIndex.read(offset - 2000 + 100);
        flashLiveTimings.push(performance.now() - started);
      }
      flashLiveTimings.sort((a,b) => a-b);
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
          liveBatchRecords: liveSample.length,
          liveReadMedianMs: liveReadTimings[30], liveReadP95Ms: liveReadTimings[57], liveReadMaxMs: liveReadTimings[59],
          liveIngestMedianMs: liveIngestTimings[30], liveIngestP95Ms: liveIngestTimings[57],
          flashLiveCombinedMedianMs: flashLiveTimings[30], flashLiveCombinedP95Ms: flashLiveTimings[57],
          flashLiveCombinedMaxMs: flashLiveTimings[59],
          resultMedianMs: resultTimings[30], resultP95Ms: resultTimings[57],
          timelineReadMs, timelineLayoutMs, timelineCycles: timelineCycles.length,
          inspectionColdMs, inspectionWarmMs, inspectionStatsMs, inspectionStarts: inspectionStats.starts,
          inspectionRows: inspectionCold.total, broadInspectionMs, broadInspectionRows: broadInspection.total,
          cycleEventPageMs, cycleEventCount: cycleEventPage.total,
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

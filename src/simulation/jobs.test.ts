import { expect, it } from "vitest";
import { backgroundJobs, clone, newProject } from "../domain/model";
import { failureCount } from "../domain/metrics";
import { createSavedRun, comparisonStatus } from "../domain/results";
import { importProject, exportProject } from "../persistence/projects";
import { Simulation } from "./engine";
it("acknowledges admission separately from completed jobs and bounds a shared queue", () => {
  const g = backgroundJobs();
  g.nodes[2].capacity = 1;
  g.nodes[1].queueLimit = 3;
  g.settings.timeoutMs = 10000;
  const sim = new Simulation(g),
    early = sim.advance(0.5);
  expect(early.jobs!.accepted).toBe(5);
  expect(early.jobs!.acknowledged).toBe(5);
  expect(early.succeeded).toBe(0);
  expect(early.nodes[g.nodes[1].id].queued).toBe(3);
  expect(early.nodes[g.nodes[2].id].activeWorkers).toBe(2);
  expect(early.dropped).toBeGreaterThan(0);
  expect(early.generated).toBe(
    early.succeeded + failureCount(early) + early.inFlight,
  );
});
it("exhausts retries, frees workers during backoff and accounts for permanent failures", () => {
  const g = backgroundJobs();
  g.settings.traffic = 1;
  g.settings.duration = 10;
  g.settings.timeoutMs = 10000;
  Object.assign(g.nodes[2], {
    failureRate: 100,
    maxRetries: 2,
    retryDelayMs: 100,
  });
  const m = new Simulation(g).advance(10);
  expect(m.succeeded).toBe(0);
  expect(m.jobs!.failed).toBeGreaterThan(0);
  expect(m.jobs!.attempts).toBeLessThanOrEqual(m.generated * 3);
  expect(m.jobs!.retries).toBeLessThanOrEqual(m.generated * 2);
  expect(m.nodes[g.nodes[2].id].utilization).toBeLessThan(0.1);
  expect(m.generated).toBe(m.succeeded + failureCount(m) + m.inFlight);
});
it("expires backoff and active work without double-counting or early slot release", () => {
  const g = backgroundJobs();
  g.settings.duration = 2;
  g.settings.timeoutMs = 10;
  g.nodes[2].capacity = 1;
  const sim = new Simulation(g),
    early = sim.advance(0.5);
  expect(early.nodes[g.nodes[2].id].activeWorkers).toBe(2);
  expect(early.nodes[g.nodes[2].id].completed).toBe(0);
  expect(early.timedOut).toBeGreaterThan(0);
  const m = sim.advance(2);
  expect(m.succeeded).toBe(0);
  expect(m.generated).toBe(failureCount(m) + m.inFlight);
  g.nodes[2].capacity = 1000;
  g.nodes[2].failureRate = 100;
  g.nodes[2].retryDelayMs = 1000;
  const retry = new Simulation(g).advance(2);
  expect(retry.jobs!.retries).toBeGreaterThan(0);
  expect(retry.jobs!.attempts).toBe(retry.jobs!.accepted);
  expect(retry.jobs!.retrying).toBeLessThanOrEqual(retry.inFlight);
});
it("rejects retry re-entry into a full queue and preserves deterministic profiles", () => {
  const g = backgroundJobs();
  g.settings.traffic = 700;
  g.nodes[1].queueLimit = 0;
  Object.assign(g.nodes[2], {
    failureRate: 100,
    maxRetries: 2,
    retryDelayMs: 25,
  });
  const m = new Simulation(g).advance(30);
  expect(m.jobs!.retryRejected).toBeGreaterThan(0);
  expect(m.jobs!.retryRejected).toBeLessThanOrEqual(m.jobs!.failed);
  expect(m.generated).toBe(m.succeeded + failureCount(m) + m.inFlight);
  for (const profile of [
    { kind: "burst", peakRate: 1000, start: 5, end: 10 },
    { kind: "ramp", endRate: 1000 },
  ] as const) {
    g.settings.profile = profile;
    const sim = new Simulation(g);
    for (let t = 0.5; t < 30; t += 0.5) sim.advance(t);
    const a = sim.advance(30);
    expect(a).toEqual(new Simulation(g).advance(30));
    const b = clone(g);
    b.nodes[2].failureRate = 0;
    expect(a.generated).toBe(new Simulation(b).advance(30).generated);
  }
});
it("saves and imports job metrics without conflating lookup and job outcomes", () => {
  const p = newProject();
  p.graph = backgroundJobs();
  p.graph.nodes[2].failureRate = 50;
  const run = createSavedRun(
    { id: "job", graph: p.graph, metrics: new Simulation(p.graph).advance(30) },
    "Jobs",
  );
  p.savedRuns = [run];
  expect(importProject(exportProject(p)).savedRuns![0].metrics).toEqual(
    run.metrics,
  );
  const lookup = newProject().graph;
  const other = createSavedRun(
    { id: "url", graph: lookup, metrics: new Simulation(lookup).advance(30) },
    "Lookup",
  );
  expect(comparisonStatus(run, other).matched).toBe(false);
});

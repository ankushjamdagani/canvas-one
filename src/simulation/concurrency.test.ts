import { expect, it } from "vitest";
import { baseline, clone, validateGraph } from "../domain/model";
import { Simulation } from "./engine";

function workload(workers: number, capacity = 100) {
  const g = baseline();
  g.settings = { traffic: 700, seed: 42, duration: 10, timeoutMs: 2000 };
  g.nodes[1].workers = workers;
  g.nodes[1].capacity = capacity;
  g.nodes[2].capacity = 100000;
  return g;
}
it("preserves default single-worker behavior and seeded request counts", () => {
  const g = baseline(),
    explicit = clone(g);
  explicit.nodes[1].workers = 1;
  expect(new Simulation(g).advance(30)).toEqual(
    new Simulation(explicit).advance(30),
  );
  const overloaded = baseline();
  overloaded.settings.traffic = 700;
  const m = new Simulation(overloaded).advance(30);
  expect([m.generated, m.succeeded, m.dropped, m.timedOut, m.inFlight]).toEqual(
    [20845, 14995, 5346, 0, 504],
  );
});
it("parallel workers increase throughput while sharing one bounded queue", () => {
  const one = new Simulation(workload(1)).advance(10);
  const g = workload(4);
  g.nodes[1].queueLimit = 3;
  const sim = new Simulation(g);
  for (let time = 0.1; time <= 10; time += 0.1) {
    const m = sim.advance(time),
      service = m.nodes[g.nodes[1].id];
    expect(service.activeWorkers).toBeLessThanOrEqual(4);
    expect(service.queued).toBeLessThanOrEqual(3);
    expect(service.utilization).toBeLessThanOrEqual(1);
    expect(m.generated).toBe(m.succeeded + m.dropped + m.timedOut + m.inFlight);
  }
  const many = sim.advance(10);
  expect(many.generated).toBe(one.generated);
  expect(many.succeeded).toBeGreaterThan(one.succeeded * 3);
  expect(many.nodes[g.nodes[1].id].rejected).toBeGreaterThan(0);
  expect(many.nodes[g.nodes[1].id].utilization).toBeGreaterThan(0.9);
  expect(many).toEqual(new Simulation(g).advance(10));
});
it("worker count increases concurrency without shortening individual processing", () => {
  const g = workload(4, 10);
  g.settings.traffic = 1;
  g.settings.duration = 30;
  const concurrent = new Simulation(g).advance(30);
  g.nodes[1].workers = 1;
  g.nodes[1].capacity = 40;
  const fasterWorker = new Simulation(g).advance(30);
  expect(concurrent.meanLatency).toBeCloseTo(108.01, 6);
  // A single worker can briefly queue even at low Poisson arrival rates.
  expect(fasterWorker.meanLatency).toBeGreaterThanOrEqual(33.01);
  expect(fasterWorker.meanLatency).toBeLessThan(40);
  expect(concurrent.generated).toBe(fasterWorker.generated);
});
it("expired active work retains its worker and expired queued work is skipped", () => {
  const g = workload(3, 1);
  g.settings.duration = 2;
  g.settings.timeoutMs = 10;
  g.nodes[1].queueLimit = 4;
  const sim = new Simulation(g);
  const early = sim.advance(0.5),
    node = early.nodes[g.nodes[1].id];
  expect(node.activeWorkers).toBe(3);
  expect(node.completed).toBe(0);
  expect(node.utilization).toBeGreaterThan(0.95);
  const m = sim.advance(2);
  expect(m.nodes[g.nodes[1].id].completed).toBe(3);
  expect(m.nodes[g.nodes[1].id].activeWorkers).toBe(3);
  expect(m.databaseLookups).toBe(0);
  expect(m.succeeded).toBe(0);
  expect(m.timedOut).toBeGreaterThan(0);
  expect(m.generated).toBe(m.dropped + m.timedOut + m.inFlight);
  expect(m).toEqual(new Simulation(g).advance(2));
});
it("zero queue slots admit work to free workers and reject only when all are busy", () => {
  const g = workload(4, 10);
  g.nodes[1].queueLimit = 0;
  const m = new Simulation(g).advance(10);
  expect(m.nodes[g.nodes[1].id].queued).toBe(0);
  expect(m.nodes[g.nodes[1].id].completed).toBeGreaterThan(350);
  expect(m.nodes[g.nodes[1].id].completed).toBeLessThanOrEqual(400);
  expect(m.dropped).toBeGreaterThan(0);
});
it("rejects invalid worker counts and concurrency on other components", () => {
  for (const workers of [0, 1.5, 17, NaN])
    expect(validateGraph(workload(workers)).join()).toContain("workers");
  const g = baseline();
  g.nodes[2].workers = 2;
  expect(validateGraph(g).join()).toContain("workers");
});

it("replays concurrent burst and ramp profiles independently of snapshot cadence", () => {
  for (const profile of [
    { kind: "burst", peakRate: 1200, start: 2, end: 5 },
    { kind: "ramp", endRate: 1500 },
  ] as const) {
    const g = workload(4);
    g.settings.profile = profile;
    const sim = new Simulation(g);
    for (const t of [0.3, 2, 2.7, 5, 8.9]) sim.advance(t);
    const observed = sim.advance(10);
    expect(observed).toEqual(new Simulation(g).advance(10));
    const single = clone(g);
    single.nodes[1].workers = 1;
    expect(observed.generated).toBe(
      new Simulation(single).advance(10).generated,
    );
  }
});

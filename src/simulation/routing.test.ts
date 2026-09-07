import { expect, it } from "vitest";
import { baseline, clone, makeNode, validateGraph } from "../domain/model";
import { balancedLookup, serviceInstances, addServiceInstance, insertBalancer } from "../domain/routing";
import { Simulation } from "./engine";
it("one instantaneous balancer preserves the original lookup results and deadlines", () => {
  const g = baseline(); g.settings.traffic = 700;
  const before = new Simulation(g).advance(30);
  insertBalancer(g);
  const after = new Simulation(g).advance(30);
  for (const key of ["generated", "succeeded", "dropped", "timedOut", "inFlight", "p95Latency", "databaseLookups"] as const) expect(after[key]).toBe(before[key]);
  for (const n of g.nodes.filter((n) => n.kind === "service" || n.kind === "database")) expect(after.nodes[n.id]).toEqual(before.nodes[n.id]);
});
it("round robin gives equal turns to unequal instances without retrying rejection", () => {
  const g = balancedLookup(); g.settings.duration = 10;
  const [slow, fast] = serviceInstances(g); slow.capacity = 10; slow.queueLimit = 0; fast.capacity = 1000;
  g.nodes.find((n) => n.kind === "database")!.capacity = 10000;
  const m = new Simulation(g).advance(10);
  expect(m.nodes[slow.id].arrived).toBe(Math.ceil(m.generated / 2));
  expect(m.nodes[fast.id].arrived).toBe(Math.floor(m.generated / 2));
  expect(m.nodes[slow.id].rejected).toBeGreaterThan(3000);
  expect(m.nodes[fast.id].rejected).toBe(0);
  expect(m.dropped).toBe(m.nodes[slow.id].rejected);
  expect(m.succeeded).toBeGreaterThan(3000);
  expect(m.succeeded).toBeLessThan(4000);
  for (const e of g.edges.filter((e) => serviceInstances(g).some((n) => n.id === e.target))) expect(m.edges![e.id]).toBe(m.nodes[e.target].arrived);
});
it("horizontal scaling raises throughput until the shared downstream database saturates", () => {
  const g = balancedLookup(1);
  const one = new Simulation(g).advance(30);
  addServiceInstance(g); addServiceInstance(g);
  const three = new Simulation(g).advance(30), db = g.nodes.find((n) => n.kind === "database")!;
  expect(three.generated).toBe(one.generated);
  expect(one.throughput).toBeGreaterThan(10); expect(one.throughput).toBeLessThan(30);
  expect(three.throughput).toBeGreaterThan(one.throughput * 2);
  expect(three.nodes[db.id].utilization).toBeGreaterThan(0.7);
  expect(three.dropped + three.timedOut).toBeGreaterThan(0);
  db.capacity = 1000;
  const fasterDb = new Simulation(g).advance(30);
  expect(fasterDb.throughput).toBeGreaterThan(300);
  addServiceInstance(g);
  expect(new Simulation(g).advance(30).throughput).toBeGreaterThan(300);
});
it("each instance has independent worker occupancy, waiting bounds and absolute expiry", () => {
  const g = balancedLookup(); g.settings.duration = 2; g.settings.timeoutMs = 10;
  const [a,b] = serviceInstances(g); Object.assign(a, { workers: 3, capacity: 1, queueLimit: 4 }); Object.assign(b, { workers: 2, capacity: 100, queueLimit: 0 });
  const sim = new Simulation(g), early = sim.advance(0.5);
  expect(early.nodes[a.id].activeWorkers).toBe(3); expect(early.nodes[a.id].completed).toBe(0);
  for (const t of [0.7, 1.1, 1.9, 2]) {
    const m = sim.advance(t);
    expect(m.nodes[a.id].queued).toBeLessThanOrEqual(4); expect(m.nodes[b.id].queued).toBe(0);
    expect(m.generated).toBe(m.succeeded + m.dropped + m.timedOut + m.inFlight);
    expect(m.succeeded).toBe(0); // 10 ms processing already consumes the complete deadline.
  }
  expect(sim.snapshot()).toEqual(new Simulation(g).advance(2));
  expect(sim.snapshot().nodes[a.id].completed).toBe(3);
});
it("shared cache receives completions from all replicas; hits bypass only the shared database", () => {
  const g = balancedLookup(3); const cache = makeNode("cache", 900, 170), db = g.nodes.find((n) => n.kind === "database")!;
  g.nodes.push(cache);
  g.edges.forEach((e) => { if (e.target === db.id) e.target = cache.id; });
  g.edges.push({ id: "cache-db", source: cache.id, target: db.id });
  expect(validateGraph(g)).toEqual([]);
  const m = new Simulation(g).advance(30);
  expect(m.databaseLookups + m.cacheHits).toBeLessThanOrEqual(m.nodes[cache.id].completed);
  expect(m.edges!["cache-db"]).toBe(m.databaseLookups);
  expect(m.throughput).toBeGreaterThan(10);
});
it("seeded routing replay is independent of snapshot cadence and canvas positions", () => {
  const g = balancedLookup(3); g.settings.profile = { kind: "burst", peakRate: 2000, start: 5, end: 10 };
  const sim = new Simulation(g); for (const t of [1.2, 4.9, 5, 10.1, 18]) sim.advance(t);
  const moved = clone(g); moved.nodes.forEach((n) => { n.position.y += 50; n.name += " moved"; }); moved.edges.reverse();
  expect(sim.advance(30)).toEqual(new Simulation(moved).advance(30));
});
it("rejects bypasses, mixed paths, duplicate edges and more than eight instances", () => {
  const g = balancedLookup();
  for (const mutate of [
    (x: typeof g) => x.edges.pop(),
    (x: typeof g) => x.edges.push({ ...x.edges[0] }),
    (x: typeof g) => { x.scenario = "jobs"; },
    (x: typeof g) => { const e = x.edges.find((edge) => edge.source === x.nodes.find((n) => n.kind === "traffic")!.id)!; e.target = x.nodes.find((n) => n.kind === "database")!.id; },
    (x: typeof g) => { for (let i = 0; i < 7; i++) x.nodes.push(makeNode("service", 0, 0)); },
  ]) { const bad = clone(g); mutate(bad); const errors = validateGraph(bad); if (!errors.length) throw new Error(`mutation ${mutate.toString()} was accepted`); }
});

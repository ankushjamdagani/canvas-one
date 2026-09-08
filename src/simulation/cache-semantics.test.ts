import { expect, it } from "vitest";
import { baseline, clone, makeNode } from "../domain/model";
import { Simulation, randomGenerator } from "./engine";

function finiteGraph() {
  const graph = baseline();
  const cache = makeNode("cache", 500, 170);
  Object.assign(cache, { capacity: 100000, cacheMode: "lru", cacheEntries: 20, cacheTtlMs: 10000 });
  graph.nodes.splice(2, 0, cache);
  graph.nodes[1].capacity = 100000;
  graph.nodes[3].capacity = 100000;
  graph.edges = graph.nodes.slice(1).map((n, i) => ({
    id: `edge-${i}`, source: graph.nodes[i].id, target: n.id,
  }));
  graph.settings.traffic = 1000;
  graph.settings.duration = 3;
  graph.settings.timeoutMs = 1000;
  Object.assign(graph.nodes[0], { popularity: "hot", catalogSize: 100, hotSubset: 1, hotShare: 100 });
  return graph;
}

it("does not coalesce cold misses and fills only when the database finishes", () => {
  const graph = finiteGraph();
  graph.nodes[3].capacity = 100;
  const firstArrival = -Math.log(1 - randomGenerator(graph.settings.seed)()) / graph.settings.traffic;
  const simulation = new Simulation(graph);
  // Two 10-microsecond stages precede the 10-millisecond database operation.
  const pending = simulation.advance(firstArrival + 0.01);
  expect(pending.cacheMisses).toBeGreaterThan(1);
  expect(pending.databaseLookups).toBe(pending.cacheMisses);
  expect(pending.cacheHits).toBe(0);
  expect(pending.cacheEntries).toBe(0);
  expect(simulation.advance(firstArrival + 0.010021).cacheEntries).toBe(1);
  const warm = simulation.advance(0.1);
  expect(warm.cacheHits).toBeGreaterThan(50);
  expect(warm.cacheMisses).toBe(pending.cacheMisses);
});

it("a request that expires before database completion never populates the cache", () => {
  const graph = finiteGraph();
  graph.settings.traffic = 10;
  graph.settings.timeoutMs = 10;
  graph.nodes[3].capacity = 1;
  const result = new Simulation(graph).advance(3);
  expect(result.databaseLookups).toBeGreaterThan(5);
  expect(result.nodes[graph.nodes[3].id].completed).toBeGreaterThan(0);
  expect(result.timedOut).toBeGreaterThan(5);
  expect(result.cacheEntries).toBe(0);
  expect(result.cacheHits).toBe(0);
  expect(result.generated).toBe(result.succeeded + result.dropped + result.timedOut + result.inFlight);
});

it("expiration and eviction produce exactly the same result under chunked replay", () => {
  const graph = finiteGraph();
  graph.nodes[0].hotShare = 80;
  graph.nodes[2].cacheEntries = 5;
  graph.nodes[2].cacheTtlMs = 20;
  const whole = new Simulation(graph).advance(3);
  const chunked = new Simulation(clone(graph));
  for (let i = 1; i < 90; i++) chunked.advance(i / 30);
  expect(chunked.advance(3)).toEqual(whole);
  expect(whole.cacheExpirations).toBeGreaterThan(0);
  expect(whole.cacheEvictions).toBeGreaterThan(0);
});

it("changing cache and popularity preserves generated arrival times", () => {
  const finite = finiteGraph();
  const uniform = clone(finite);
  uniform.nodes[0].popularity = "uniform";
  const fixed = clone(uniform);
  fixed.nodes[2].cacheMode = "fixed";
  const runs = [finite, uniform, fixed].map((g) => new Simulation(g).advance(3));
  for (const run of runs.slice(1)) {
    expect(run.generated).toBe(runs[0].generated);
    expect(run.history.map((s) => s.generated)).toEqual(runs[0].history.map((s) => s.generated));
  }
  expect(runs[0].cacheHits).toBeGreaterThan(runs[1].cacheHits * 2);
});

it("short TTL causes more misses than a long TTL with the same requests", () => {
  const long = finiteGraph();
  long.nodes[0].popularity = "uniform";
  long.nodes[0].catalogSize = 10;
  const short = clone(long);
  short.nodes[2].cacheTtlMs = 1;
  const a = new Simulation(long).advance(3), b = new Simulation(short).advance(3);
  expect(a.generated).toBe(b.generated);
  expect(a.cacheMisses).toBeLessThan(20);
  expect(b.cacheMisses).toBeGreaterThan(2000);
  expect(b.cacheExpirations).toBeGreaterThan(1000);
});

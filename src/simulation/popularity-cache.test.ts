import { expect, it } from "vitest";
import { baseline, clone, makeNode } from "../domain/model";
import { Simulation } from "./engine";
import { urlKey } from "./url-popularity";

it("keeps URL keys bounded and hot-link share deterministic", () => {
  const traffic = makeNode("traffic", 0, 0);
  traffic.catalogSize = 100;
  traffic.popularity = "hot";
  traffic.hotSubset = 5;
  traffic.hotShare = 80;
  const keys = Array.from({ length: 10000 }, (_, i) => urlKey(42, i + 1, traffic));
  expect(Math.min(...keys)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...keys)).toBeLessThan(100);
  expect(keys.filter((key) => key < 5).length / keys.length).toBeGreaterThan(0.75);
  expect(keys).toEqual(Array.from({ length: 10000 }, (_, i) => urlKey(42, i + 1, traffic)));
});

it("finite cache starts cold and reports misses, fills, expiry and bounded entries", () => {
  const graph = baseline();
  const cache = makeNode("cache", 500, 170);
  graph.nodes[1].name = "Service";
  graph.nodes[2].position.x = 990;
  graph.nodes.splice(2, 0, cache);
  graph.edges = [{ id: "traffic-service", source: graph.nodes[0].id, target: graph.nodes[1].id }, { id: "service-cache", source: graph.nodes[1].id, target: cache.id }, { id: "cache-db", source: cache.id, target: graph.nodes[3].id }];
  graph.settings.traffic = 700;
  cache.cacheMode = "lru";
  cache.cacheEntries = 5;
  cache.cacheTtlMs = 100;
  const first = new Simulation(graph).advance(2);
  expect(first.cacheMisses).toBeGreaterThan(0);
  expect(first.cacheEntries).toBeLessThanOrEqual(5);
  expect(first.cacheEvictions + first.cacheExpirations).toBeGreaterThan(0);
  const replay = new Simulation(clone(graph)).advance(2);
  expect(replay).toEqual(first);
  const warm = clone(graph);
  warm.nodes.find((node) => node.kind === "cache")!.cacheTtlMs = 10000;
  const larger = clone(warm);
  larger.nodes.find((node) => node.kind === "cache")!.cacheEntries = 100;
  const smallWarm = new Simulation(warm).advance(2);
  const expanded = new Simulation(larger).advance(2);
  expect(expanded.generated).toBe(smallWarm.generated);
  expect(expanded.cacheMisses).toBeLessThan(smallWarm.cacheMisses);
});

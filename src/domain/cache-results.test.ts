import { expect, it } from "vitest";
import { experiments } from "./experiments";
import { backgroundJobs, clone, newProject, validateGraph, type Graph } from "./model";
import { comparisonStatus, createSavedRun, defaultRunName, modelChanges, validateSavedRun } from "./results";
import { sameGraphWorkload } from "./workload";
import { exportProject, importProject } from "../persistence/projects";
import { Simulation } from "../simulation/engine";

function graph() {
  const g = experiments.find((e) => e.id === "cold-cache-popularity")!.build();
  g.settings.duration = 2;
  return g;
}
function run(g: Graph) {
  return createSavedRun({ id: crypto.randomUUID(), graph: g, metrics: new Simulation(g).advance(g.settings.duration) }, "Cache experiment");
}

it("compares cache capacity, TTL and model changes under the same request workload", () => {
  const a = graph(), b = clone(a);
  const cache = b.nodes.find((n) => n.kind === "cache")!;
  Object.assign(cache, { cacheEntries: 200, cacheTtlMs: 20000 });
  expect(comparisonStatus(run(a), run(b)).matched).toBe(true);
  expect(modelChanges(a, b)).toContain("Cache entries: 20 → 200.");
  expect(modelChanges(a, b)).toContain("Cache TTL: 10000 → 20000 ms.");
  cache.cacheMode = "fixed";
  expect(comparisonStatus(run(a), run(b)).matched).toBe(true);
  expect(modelChanges(a, b).join(" ")).toContain("model");
});

it("distinguishes effective popularity changes from dormant controls", () => {
  const a = graph(), b = clone(a);
  b.nodes[0].popularity = "uniform";
  expect(comparisonStatus(run(a), run(b)).matched).toBe(false);
  a.nodes[0].popularity = "uniform";
  b.nodes[0].hotSubset = 25;
  b.nodes[0].hotShare = 50;
  expect(sameGraphWorkload(a, b)).toBe(true);
  b.nodes[0].catalogSize = 2000;
  expect(sameGraphWorkload(a, b)).toBe(false);
  const jobs = backgroundJobs(), changed = clone(jobs);
  changed.nodes[0].popularity = "hot";
  expect(sameGraphWorkload(jobs, changed)).toBe(true);
});

it("roundtrips finite models, measurements and checkpoints in the current export", () => {
  const project = newProject();
  project.graph = graph();
  project.savedRuns = [run(project.graph)];
  project.checkpoints = [{ id: "cold", name: "Cold cache", graph: clone(project.graph), createdAt: 1 }];
  const exported = exportProject(project);
  expect(JSON.parse(exported).version).toBe(7);
  const imported = importProject(exported);
  expect(imported.graph).toEqual(project.graph);
  expect(imported.checkpoints[0].graph).toEqual(project.graph);
  expect(imported.savedRuns![0].metrics).toEqual(project.savedRuns[0].metrics);
  expect(validateSavedRun(imported.savedRuns![0])).toEqual([]);
  expect(defaultRunName(project.graph)).toContain("LRU 20 entries");
  expect(defaultRunName(project.graph)).not.toContain("% cache");
});

it("rejects impossible, missing and fractional cache measurements", () => {
  const saved = run(graph());
  for (const key of ["cacheMisses", "cacheEntries", "cacheEvictions", "cacheExpirations"] as const) {
    for (const invalid of [undefined, -1, 0.5, Infinity]) {
      const changed = clone(saved);
      Object.assign(changed.metrics, { [key]: invalid });
      expect(validateSavedRun(changed).length, `${key}=${invalid}`).toBeGreaterThan(0);
    }
  }
  const tooManyEntries = clone(saved);
  tooManyEntries.metrics.cacheEntries = 21;
  expect(validateSavedRun(tooManyEntries).join()).toContain("occupancy");
  const falseMisses = clone(saved);
  falseMisses.metrics.cacheMisses++;
  expect(validateSavedRun(falseMisses).join()).toContain("cache decisions");
});

it("validates URL fields even when the optional popularity mode is omitted", () => {
  const g = graph();
  delete g.nodes[0].popularity;
  g.nodes[0].catalogSize = -1;
  expect(validateGraph(g).join()).toContain("catalog");
  g.nodes[0].catalogSize = 2;
  expect(validateGraph(g)).toEqual([]);
  g.nodes[0].popularity = "hot";
  expect(validateGraph(g).join()).toContain("Hot-link URL count");
});

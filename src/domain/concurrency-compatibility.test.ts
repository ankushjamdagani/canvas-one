import { expect, it } from "vitest";
import { newProject, clone } from "./model";
import {
  createSavedRun,
  comparisonStatus,
  modelChanges,
  validateSavedRun,
} from "./results";
import { Simulation } from "../simulation/engine";
import { exportProject, importProject } from "../persistence/projects";

it("imports legacy projects and results without changing historical semantics", () => {
  const p = newProject();
  const run = createSavedRun(
    {
      id: "legacy",
      graph: p.graph,
      metrics: new Simulation(p.graph).advance(30),
    },
    "Before concurrency",
  );
  run.modelVersion = "url-lookup/2";
  for (const n of Object.values(run.metrics.nodes)) delete n.activeWorkers;
  p.savedRuns = [run];
  for (const version of [1, 2, 3, 4]) {
    const imported = importProject(
      JSON.stringify({ format: "system-studio", version, project: p }),
    );
    expect(imported.savedRuns![0].metrics).toEqual(run.metrics);
    expect(imported.savedRuns![0].modelVersion).toBe("url-lookup/2");
    expect(imported.graph.nodes[1].workers).toBeUndefined();
  }
  const fresh = createSavedRun(
    {
      id: "fresh",
      graph: p.graph,
      metrics: new Simulation(p.graph).advance(30),
    },
    "Current",
  );
  expect(comparisonStatus(run, fresh).matched).toBe(false);
  expect(comparisonStatus(run, fresh).message).toContain("versions");
});
it("round-trips concurrent graphs, checkpoints and new results only in version 4", () => {
  const p = newProject();
  p.graph.nodes[1].workers = 4;
  p.checkpoints = [
    { id: "c", name: "Four workers", createdAt: 1, graph: clone(p.graph) },
  ];
  p.savedRuns = [
    createSavedRun(
      {
        id: "new",
        graph: p.graph,
        metrics: new Simulation(p.graph).advance(30),
      },
      "Four workers",
    ),
  ];
  const text = exportProject(p),
    data = JSON.parse(text);
  expect(data.version).toBe(4);
  expect(importProject(text).savedRuns![0].graph.nodes[1].workers).toBe(4);
  expect(importProject(text).checkpoints[0].graph.nodes[1].workers).toBe(4);
  data.version = 3;
  expect(() => importProject(JSON.stringify(data))).toThrow(/version-4/);
  const old = clone(p.savedRuns[0]);
  old.modelVersion = "url-lookup/2";
  expect(validateSavedRun(old).join()).toContain("one worker");
  const invalid = clone(p.savedRuns[0]);
  invalid.metrics.nodes[p.graph.nodes[1].id].activeWorkers = 5;
  expect(validateSavedRun(invalid).length).toBeGreaterThan(0);
  const single = clone(p.graph);
  delete single.nodes[1].workers;
  expect(modelChanges(single, p.graph)).toContain(
    "Redirect service workers: 1 → 4.",
  );
});

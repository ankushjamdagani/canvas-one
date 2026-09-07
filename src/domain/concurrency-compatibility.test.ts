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

it("round-trips concurrent graphs, checkpoints and new results in the current format", () => {
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
  expect(data.version).toBe(5);
  expect(importProject(text).savedRuns![0].graph.nodes[1].workers).toBe(4);
  expect(importProject(text).checkpoints[0].graph.nodes[1].workers).toBe(4);
  data.version = 3;
  expect(() => importProject(JSON.stringify(data))).toThrow(/version-5/);
  const old = clone(p.savedRuns[0]);
  old.modelVersion = "url-lookup/2";
  expect(validateSavedRun(old).join()).toContain("unsupported");
  const invalid = clone(p.savedRuns[0]);
  invalid.metrics.nodes[p.graph.nodes[1].id].activeWorkers = 5;
  expect(validateSavedRun(invalid).length).toBeGreaterThan(0);
  const single = clone(p.graph);
  delete single.nodes[1].workers;
  expect(modelChanges(single, p.graph)).toContain(
    "Redirect service workers: 1 → 4.",
  );
});

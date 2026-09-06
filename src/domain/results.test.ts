import { expect, it } from "vitest";
import { baseline } from "./model";
import { Simulation } from "../simulation/engine";
import {
  createSavedRun,
  validateSavedRun,
  comparisonStatus,
  modelChanges,
} from "./results";
import { exportProject, importProject } from "../persistence/projects";
import { newProject } from "./model";

function run(traffic = 100) {
  const graph = baseline();
  graph.settings.traffic = traffic;
  return createSavedRun(
    {
      id: crypto.randomUUID(),
      graph,
      metrics: new Simulation(graph).advance(30),
    },
    "Baseline",
  );
}
it("saves an immutable complete model and rejects partial runs", () => {
  const graph = baseline(),
    engine = new Simulation(graph);
  expect(() =>
    createSavedRun({ id: "a", graph, metrics: engine.advance(2) }, "Partial"),
  ).toThrow("completed");
  const saved = createSavedRun(
    { id: "b", graph, metrics: engine.advance(30) },
    "Complete",
  );
  graph.settings.traffic = 700;
  expect(saved.graph.settings.traffic).toBe(100);
  expect(validateSavedRun(saved)).toEqual([]);
});
it("checks complete-run accounting on imported results", () => {
  const saved = run();
  saved.metrics.succeeded++;
  expect(validateSavedRun(saved).join()).toContain("reconcile");
});
it("distinguishes matching workloads from confounded comparisons", () => {
  const a = run(),
    b = run();
  expect(comparisonStatus(a, b).matched).toBe(true);
  b.graph.settings.timeoutMs = 500;
  expect(comparisonStatus(a, b).matched).toBe(false);
  b.graph.settings.timeoutMs = 2000;
  b.metrics.generated++;
  expect(comparisonStatus(a, b).matched).toBe(false);
});
it("exports full results and marks imported copies without claiming provenance", () => {
  const p = newProject();
  p.savedRuns = [run()];
  const imported = importProject(exportProject(p));
  expect(imported.savedRuns![0].metrics).toEqual(p.savedRuns[0].metrics);
  expect(imported.savedRuns![0].graph).toEqual(p.savedRuns[0].graph);
  expect(imported.savedRuns![0].origin).toBe("imported");
  expect(imported.savedRuns![0].id).not.toBe(p.savedRuns[0].id);
});
it("reports actual processing changes, ignoring view layout and names", () => {
  const a = baseline(),
    b = structuredClone(a);
  b.nodes[2].position.x = 100;
  b.nodes[2].name = "Storage";
  expect(modelChanges(a, b)).toEqual([]);
  b.nodes[2].capacity = 700;
  expect(modelChanges(a, b)).toEqual(["Storage capacity: 500 → 700 req/s."]);
});

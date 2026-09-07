import { expect, it } from "vitest";
import { newProject } from "../domain/model";
import { exportProject, importProject } from "./projects";
it("roundtrips model, settings, checkpoints and viewport without overwriting original", () => {
  const p = newProject();
  p.checkpoints.push({
    id: "a",
    name: "Baseline",
    graph: structuredClone(p.graph),
    createdAt: 1,
  });
  const restored = importProject(exportProject(p));
  expect(restored.graph).toEqual(p.graph);
  expect(restored.viewport).toEqual(p.viewport);
  expect(restored.id).not.toBe(p.id);
  expect(restored.checkpoints[0].graph).toEqual(p.graph);
});
it("rejects unknown versions and malformed imports", () => {
  expect(() => importProject('{"version":99}')).toThrow("Unsupported");
  const p = newProject();
  p.graph.nodes[0].capacity = -1;
  expect(() => importProject(exportProject(p))).toThrow("Capacity");
});
it("preserves unfinished editable graph drafts in portable exports", () => {
  const project = newProject();
  project.graph.edges = [];
  expect(importProject(exportProject(project)).graph).toEqual(project.graph);
});
it("roundtrips expanded views and rejects retired portable formats", () => {
  const project = newProject();
  const legacy = JSON.parse(exportProject(project));
  legacy.version = 1;
  expect(() => importProject(JSON.stringify(legacy))).toThrow("version-5");
  project.expandedNodeIds = [project.graph.nodes[2].id];
  expect(importProject(exportProject(project)).expandedNodeIds).toEqual(
    project.expandedNodeIds,
  );
});
it("preserves workload profiles and rejects malformed imported timing", () => {
  const project = newProject();
  project.graph.settings.profile = {
    kind: "burst",
    peakRate: 700,
    start: 10,
    end: 20,
  };
  expect(importProject(exportProject(project)).graph.settings).toEqual(
    project.graph.settings,
  );
  project.graph.settings.profile.end = 100;
  expect(() => importProject(exportProject(project))).toThrow("Burst");
});

it("marks exports with the result-aware format version", () => {
  expect(JSON.parse(exportProject(newProject())).version).toBe(5);
});

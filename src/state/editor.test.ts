import { expect, it } from "vitest";
import { newProject } from "../domain/model";
import { Simulation } from "../simulation/engine";
import { useEditor } from "./editor";

it("expansion preserves the exact model, graph history and in-progress results", () => {
  const project = newProject();
  useEditor.getState().load(project);
  const graph = useEditor.getState().project.graph;
  const engine = new Simulation(graph);
  engine.advance(10);
  useEditor.getState().toggleExpanded(graph.nodes[2].id);
  expect(useEditor.getState().project.graph).toBe(graph);
  expect(useEditor.getState().past).toEqual([]);
  expect(useEditor.getState().project.expandedNodeIds).toEqual([
    graph.nodes[2].id,
  ]);
  useEditor.getState().toggleExpanded(graph.nodes[2].id);
  expect(useEditor.getState().project.expandedNodeIds).toEqual([]);
  expect(engine.advance(30)).toEqual(
    new Simulation(useEditor.getState().project.graph).advance(30),
  );
});

it("restores a saved model through undoable history without mutating its result", async () => {
  const { createSavedRun } = await import("../domain/results");
  const project = newProject();
  useEditor.getState().load(project);
  const graph = project.graph,
    result = createSavedRun(
      { id: "saved", graph, metrics: new Simulation(graph).advance(30) },
      "Saved model",
    );
  expect(useEditor.getState().saveRun(result)).toBe(true);
  useEditor.getState().settings({ traffic: 700 });
  useEditor.getState().restoreRun(result.id);
  expect(useEditor.getState().project.graph.settings.traffic).toBe(100);
  useEditor.getState().undo();
  expect(useEditor.getState().project.graph.settings.traffic).toBe(700);
  expect(
    useEditor.getState().project.savedRuns![0].graph.settings.traffic,
  ).toBe(100);
});

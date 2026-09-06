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

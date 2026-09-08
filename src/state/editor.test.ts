import { expect, it } from "vitest";
import { architectureDiagram, makeNode, newProject } from "../domain/model";
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

it("duplicates one diagram component as an independent undoable node", () => {
  const project = newProject();
  project.graph = architectureDiagram();
  const custom = makeNode("custom", 100, 100);
  custom.name = "A".repeat(80);
  custom.customType = "Vector database";
  custom.description = "Embeddings and semantic retrieval";
  custom.capacity = 321;
  project.graph.nodes.push(custom);
  project.graph.edges.push({ id: "incident", source: project.graph.nodes[0].id, target: custom.id });
  project.subsystems = [{ id: "group", name: "Search", nodeIds: [project.graph.nodes[0].id, custom.id], collapsed: false }];
  project.expandedNodeIds = [custom.id];
  useEditor.getState().load(project);

  expect(useEditor.getState().duplicateNode(custom.id)).toBe(true);
  const state = useEditor.getState();
  const copy = state.project.graph.nodes.at(-1)!;
  expect(copy).toMatchObject({
    kind: "custom",
    name: `${"A".repeat(75)} copy`,
    customType: custom.customType,
    description: custom.description,
    capacity: 321,
    position: { x: 140, y: 140 },
  });
  expect(copy.id).not.toBe(custom.id);
  expect(state.selected).toBe(copy.id);
  expect(state.project.graph.edges).toEqual(project.graph.edges);
  expect(state.project.subsystems![0].nodeIds).not.toContain(copy.id);
  expect(state.project.expandedNodeIds).not.toContain(copy.id);
  expect(state.past).toHaveLength(1);

  useEditor.getState().undo();
  expect(useEditor.getState().project.graph.nodes.some((node) => node.id === copy.id)).toBe(false);
  expect(useEditor.getState().selected).toBeNull();
  useEditor.getState().redo();
  expect(useEditor.getState().project.graph.nodes.at(-1)?.id).toBe(copy.id);
});

it("guards duplication and deterministically avoids occupied positions", () => {
  const project = newProject();
  expect(useEditor.getState().load(project)).toBeUndefined();
  expect(useEditor.getState().duplicateNode("missing")).toBe(false);
  expect(useEditor.getState().past).toHaveLength(0);

  project.graph = architectureDiagram();
  const source = project.graph.nodes[0];
  project.graph.nodes.push(makeNode("custom", source.position.x + 40, source.position.y + 40));
  useEditor.getState().load(project);
  expect(useEditor.getState().duplicateNode(source.id)).toBe(true);
  expect(useEditor.getState().project.graph.nodes.at(-1)?.position).toEqual({ x: source.position.x + 80, y: source.position.y + 80 });

  const full = newProject();
  full.graph = architectureDiagram();
  while (full.graph.nodes.length < 100) full.graph.nodes.push(makeNode("custom", full.graph.nodes.length, 0));
  useEditor.getState().load(full);
  expect(useEditor.getState().duplicateNode(full.graph.nodes[0].id)).toBe(false);
  expect(useEditor.getState().past).toHaveLength(0);
});

it("loads an architecture template as one reversible edit and preserves project data", async () => {
  const { createSavedRun } = await import("../domain/results");
  const project = newProject("Keep this project");
  project.graph = architectureDiagram();
  project.graph.guideId = "stale-guide";
  project.checkpoints = [{ id: "checkpoint", name: "Before", graph: structuredClone(project.graph), createdAt: 1 }];
  project.subsystems = [{ id: "subsystem", name: "Dormant", nodeIds: project.graph.nodes.slice(0, 2).map((node) => node.id), collapsed: false }];
  project.expandedNodeIds = [project.graph.nodes[0].id];
  const executable = newProject().graph;
  project.savedRuns = [createSavedRun({ id: "run", graph: executable, metrics: new Simulation(executable).advance(executable.settings.duration) }, "Saved")];
  const before = structuredClone(project.graph);
  useEditor.getState().load(project);
  useEditor.getState().select(project.graph.nodes[0].id);

  expect(useEditor.getState().loadArchitectureTemplate("realtime-chat")).toBe(true);
  const loaded = useEditor.getState();
  expect(loaded.project.graph.scenario).toBe("diagram");
  expect(loaded.project.graph.guideId).toBeUndefined();
  expect(loaded.selected).toBeNull();
  expect(loaded.past).toHaveLength(1);
  expect(loaded.project.id).toBe(project.id);
  expect(loaded.project.name).toBe("Keep this project");
  expect(loaded.project.checkpoints).toEqual(project.checkpoints);
  expect(loaded.project.savedRuns).toEqual(project.savedRuns);
  expect(loaded.project.subsystems).toEqual(project.subsystems);
  expect(loaded.project.expandedNodeIds).toEqual(project.expandedNodeIds);
  const generatedIds = loaded.project.graph.nodes.map((node) => node.id);

  useEditor.getState().undo();
  expect(useEditor.getState().project.graph).toEqual(before);
  useEditor.getState().redo();
  expect(useEditor.getState().project.graph.nodes.map((node) => node.id)).toEqual(generatedIds);

  const revision = useEditor.getState().revision;
  const history = useEditor.getState().past;
  expect(useEditor.getState().loadArchitectureTemplate("unknown")).toBe(false);
  expect(useEditor.getState().revision).toBe(revision);
  expect(useEditor.getState().past).toBe(history);

  expect(useEditor.getState().loadArchitectureTemplate("realtime-chat")).toBe(true);
  expect(useEditor.getState().project.graph.nodes.map((node) => node.id)).not.toEqual(generatedIds);
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

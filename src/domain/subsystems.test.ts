import { it, expect } from "vitest";
import { useEditor } from "../state/editor";
import { newProject } from "./model";
import { visibleSubsystems, validateSubsystems } from "./subsystems";
import { Simulation } from "../simulation/engine";
import { importProject, exportProject } from "../persistence/projects";
import { projectSubsystems } from "../components/subsystemProjection";
it("subsystem views preserve graph identity and exact simulation results", () => {
  const p = newProject();
  useEditor.getState().load(p);
  const graph = useEditor.getState().project.graph;
  const before = new Simulation(graph).advance(30);
  useEditor.getState().createSubsystem(
    "Backend",
    graph.nodes.slice(1).map((n) => n.id),
  );
  const group = useEditor.getState().project.subsystems![0];
  useEditor.getState().toggleSubsystem(group.id);
  expect(useEditor.getState().project.graph).toBe(graph);
  expect(new Simulation(graph).advance(30)).toEqual(before);
  const imported = importProject(exportProject(useEditor.getState().project));
  expect(imported.subsystems).toEqual(useEditor.getState().project.subsystems);
  useEditor.getState().dissolveSubsystem(group.id);
  expect(useEditor.getState().project.graph).toBe(graph);
  expect(visibleSubsystems(useEditor.getState().project)).toEqual([]);
});
it("projects only boundary endpoints while retaining real editable nodes", () => {
  const p = newProject(),
    ids = p.graph.nodes.slice(1).map((n) => n.id);
  const group = { id: "group", name: "Backend", nodeIds: ids, collapsed: true };
  const base = p.graph.nodes.map((n) => ({
    id: n.id,
    position: n.position,
    data: {},
    measured: { width: 215, height: 78 },
  }));
  const projected = projectSubsystems(base, [group], null);
  expect(projected.endpoints.get(ids[0])).toBe("group");
  expect(projected.endpoints.get(ids[1])).toBe("group");
  expect(projected.nodes.filter((n) => n.hidden)).toHaveLength(2);
  expect(
    projectSubsystems(
      base,
      [{ ...group, collapsed: false }],
      null,
    ).nodes.filter((n) => n.hidden),
  ).toHaveLength(0);
  expect(base.some((n) => "hidden" in n)).toBe(false);
});
it("rejects overlapping groups and keeps dormant view members through model undo", () => {
  const p = newProject();
  useEditor.getState().load(p);
  const ids = p.graph.nodes.slice(1).map((n) => n.id);
  useEditor.getState().createSubsystem("Backend", ids);
  const group = useEditor.getState().project.subsystems![0];
  expect(
    validateSubsystems([group, { ...group, id: "other" }]).length,
  ).toBeGreaterThan(0);
  useEditor.getState().useScenario("jobs");
  expect(visibleSubsystems(useEditor.getState().project)).toHaveLength(0);
  useEditor.getState().undo();
  expect(visibleSubsystems(useEditor.getState().project)).toHaveLength(1);
});

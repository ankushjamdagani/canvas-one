import { expect, it } from "vitest";
import { architectureDiagram, newProject } from "../domain/model";
import { noteAttachmentLabel } from "../domain/notes";
import { exportProject, importProject } from "../persistence/projects";
import { useEditor } from "./editor";

const setup = () => {
  const project = newProject("Notes project");
  project.graph = architectureDiagram();
  useEditor.getState().load(project);
  return project;
};

it("supports note add, edit, collapse, move, delete and undo/redo as graph history", () => {
  const project = setup();
  const [source] = project.graph.nodes;
  useEditor.getState().addNote({ x: 100, y: 120 }, "question");
  let state = useEditor.getState();
  const id = state.project.graph.notes![0].id;
  expect(state.project.graph.nodes).toHaveLength(3);
  expect(state.project.graph.notes![0]).toMatchObject({ kind: "question", position: { x: 100, y: 120 } });
  expect(state.updateNote(id, { title: "Why a gateway?", body: "Confirm ownership.", collapsed: true, attachment: { kind: "node", id: source.id } })).toBe(true);
  expect(state.updateNote(id, { title: "Why a gateway?" })).toBe(false);
  useEditor.getState().beginMove();
  useEditor.getState().move([{ id, position: { x: 240, y: 260 } }]);
  expect(useEditor.getState().project.graph.notes![0].position).toEqual({ x: 240, y: 260 });
  useEditor.getState().removeNote(id);
  expect(useEditor.getState().project.graph.notes).toEqual([]);
  useEditor.getState().undo();
  expect(useEditor.getState().project.graph.notes![0]).toMatchObject({ id, position: { x: 240, y: 260 }, collapsed: true });
  useEditor.getState().redo();
  expect(useEditor.getState().project.graph.notes).toEqual([]);
});

it("keeps note movement atomic with architecture movement and excludes notes from model edits", () => {
  const project = setup();
  const node = project.graph.nodes[0];
  useEditor.getState().addNote({ x: 30, y: 40 });
  const id = useEditor.getState().project.graph.notes![0].id;
  useEditor.getState().select(node.id);
  useEditor.getState().beginMove();
  useEditor.getState().move([
    { id: node.id, position: { x: 500, y: 500 } },
    { id, position: { x: 300, y: 300 } },
  ]);
  expect(useEditor.getState().project.graph.nodes[0].position).toEqual({ x: 500, y: 500 });
  expect(useEditor.getState().project.graph.notes![0].position).toEqual({ x: 300, y: 300 });
  expect(useEditor.getState().past).toHaveLength(2);
  useEditor.getState().undo();
  expect(useEditor.getState().project.graph.nodes[0].position).toEqual(node.position);
  expect(useEditor.getState().project.graph.notes![0].position).toEqual({ x: 30, y: 40 });
});

it("restores note metadata through checkpoints and undoable checkpoint restore", () => {
  setup();
  useEditor.getState().addNote({ x: 10, y: 20 }, "assumption");
  const id = useEditor.getState().project.graph.notes![0].id;
  useEditor.getState().checkpoint("With assumption");
  const checkpointId = useEditor.getState().project.checkpoints[0].id;
  useEditor.getState().updateNote(id, { title: "Changed after checkpoint", collapsed: true });
  useEditor.getState().restore(checkpointId);
  expect(useEditor.getState().project.graph.notes![0]).toMatchObject({ id, kind: "assumption", title: "Untitled note", collapsed: false });
  useEditor.getState().undo();
  expect(useEditor.getState().project.graph.notes![0].title).toBe("Changed after checkpoint");
});

it("round-trips current and checkpoint notes through portable export/import", () => {
  setup();
  useEditor.getState().addNote({ x: 12, y: 34 }, "future");
  const id = useEditor.getState().project.graph.notes![0].id;
  useEditor.getState().updateNote(id, { title: "Later", body: "Keep this rationale." });
  useEditor.getState().checkpoint("Notes checkpoint");
  const original = useEditor.getState().project;
  const imported = importProject(exportProject(original));
  expect(imported.graph.notes).toEqual(original.graph.notes);
  expect(imported.checkpoints[0].graph.notes).toEqual(original.checkpoints[0].graph.notes);
});

it("preserves an unresolved attachment until undo restores its target", () => {
  const project = setup();
  const edge = project.graph.edges[0];
  useEditor.getState().addNote({ x: 10, y: 10 });
  const id = useEditor.getState().project.graph.notes![0].id;
  useEditor.getState().updateNote(id, { attachment: { kind: "edge", id: edge.id } });
  useEditor.getState().remove(edge.source);
  const current = useEditor.getState().project;
  expect(noteAttachmentLabel(current.graph.notes![0], current)).toBeUndefined();
  useEditor.getState().undo();
  const restored = useEditor.getState().project;
  expect(noteAttachmentLabel(restored.graph.notes![0], restored)).toContain("→");
});

it("rejects malformed checkpoint notes and subsystem ID collisions on portable import", () => {
  setup();
  useEditor.getState().addNote({ x: 10, y: 20 });
  useEditor.getState().checkpoint("Context");
  const project = structuredClone(useEditor.getState().project);
  project.checkpoints[0].graph.notes![0].body = "x".repeat(1001);
  expect(() => importProject(exportProject(project))).toThrow(/Canvas notes/);
  project.checkpoints = [];
  project.subsystems = [{ id: project.graph.notes![0].id, name: "Boundary", nodeIds: project.graph.nodes.slice(0, 2).map(n => n.id), collapsed: false }];
  expect(() => importProject(exportProject(project))).toThrow(/note IDs must differ from subsystem IDs/);
});

it("restores notes with template undo without carrying them into a new scenario", () => {
  setup();
  useEditor.getState().addNote({ x: 10, y: 20 });
  const notes = structuredClone(useEditor.getState().project.graph.notes);
  expect(useEditor.getState().loadArchitectureTemplate("realtime-chat")).toBe(true);
  expect(useEditor.getState().project.graph.notes).toBeUndefined();
  useEditor.getState().undo();
  expect(useEditor.getState().project.graph.notes).toEqual(notes);
  useEditor.getState().useScenario("lookup");
  expect(useEditor.getState().project.graph.notes).toBeUndefined();
});

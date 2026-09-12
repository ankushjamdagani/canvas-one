import { expect, it } from "vitest";
import { architectureDiagram, newProject, validateGraph } from "./model";
import { noteAttachmentLabel, noteKinds, validateNotes, type CanvasNote } from "./notes";

const note = (overrides: Partial<CanvasNote> = {}): CanvasNote => ({
  id: "note-1",
  kind: "decision",
  title: "Use a queue",
  body: "Buffer bursts before processing.",
  position: { x: 120, y: 80 },
  collapsed: false,
  ...overrides,
});

it("accepts every typed note kind and validates the canvas note limits", () => {
  expect(Object.keys(noteKinds)).toEqual(["decision", "assumption", "future", "question", "general"]);
  expect(validateNotes(Object.keys(noteKinds).map((kind, index) => note({ id: `n-${index}`, kind: kind as CanvasNote["kind"] })))).toEqual([]);
  expect(validateNotes(Array.from({ length: 101 }, (_, index) => note({ id: `n-${index}` })))).toEqual(["Use up to 100 canvas notes."]);
});

it("rejects malformed kinds, duplicate IDs, oversized text and invalid positions", () => {
  expect(validateNotes([note({ kind: "bogus" as CanvasNote["kind"] })])).not.toEqual([]);
  expect(validateNotes([note(), note()])).not.toEqual([]);
  expect(validateNotes([note({ body: "x".repeat(1001) })])).not.toEqual([]);
  expect(validateNotes([note({ position: { x: Number.NaN, y: 0 } })])).not.toEqual([]);
  expect(validateNotes([note({ position: { x: Number.POSITIVE_INFINITY, y: 0 } })])).not.toEqual([]);
});

it("keeps notes outside executable model nodes while validating graph metadata", () => {
  const graph = architectureDiagram();
  graph.notes = [note({ id: "node-note", attachment: { kind: "node", id: graph.nodes[0].id } })];
  expect(validateGraph(graph)).toEqual([]);
  expect(graph.nodes).toHaveLength(3);
  expect(graph.nodes.some((candidate) => candidate.id === "node-note")).toBe(false);
  expect(validateGraph({ ...graph, notes: [note({ id: graph.nodes[0].id })] })).toContain("Canvas note IDs must differ from component IDs.");
});

it("resolves node, edge and subsystem attachment labels and preserves unresolved links", () => {
  const project = newProject();
  const [source, target] = project.graph.nodes;
  const edge = project.graph.edges[0];
  project.subsystems = [{ id: "group", name: "Request path", nodeIds: [source.id, target.id], collapsed: false }];
  expect(noteAttachmentLabel(note({ attachment: { kind: "node", id: source.id } }), project)).toBe(source.name);
  expect(noteAttachmentLabel(note({ attachment: { kind: "edge", id: edge.id } }), project)).toBe(`${source.name} → ${target.name}`);
  expect(noteAttachmentLabel(note({ attachment: { kind: "subsystem", id: "group" } }), project)).toBe("Request path");
  expect(noteAttachmentLabel(note({ attachment: { kind: "edge", id: "missing" } }), project)).toBeUndefined();
});

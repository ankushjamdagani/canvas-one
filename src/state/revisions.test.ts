import { beforeEach, expect, it } from "vitest";
import { architectureDiagram, clone, newProject } from "../domain/model";
import { architectureSnapshot, compareArchitectures, MAX_REVISIONS } from "../domain/revisions";
import { exportProject, importProject } from "../persistence/projects";
import { useEditor } from "./editor";
const details = { name: "Checkout design", author: "Alex", reason: "Separate payment processing", message: "Move payment work behind the queue.", issue: "https://example.com/issues/42" };
beforeEach(() => { const p = newProject(); p.graph = architectureDiagram(); useEditor.getState().load(p); });
it("captures immutable drafts and finalizes the saved architecture, not subsequent edits", () => {
  const e = useEditor.getState();
  expect(e.saveRevision(details)).toBe(true);
  const draft = useEditor.getState().project.revisions![0];
  e.updateNode(draft.graph.nodes[0].id, { name: "Later edit" });
  expect(e.finalizeRevision(draft.id)).toBe(true);
  const final = useEditor.getState().project.revisions![1];
  expect(final).toMatchObject({ sourceId: draft.id, status: "final", graph: draft.graph });
  expect(final.id).not.toBe(draft.id);
  expect(e.finalizeRevision(draft.id)).toBe(false);
  expect(draft.graph.nodes[0].name).not.toBe("Later edit");
});
it("restores graph, notes and subsystem views atomically with undo and redo", () => {
  const e = useEditor.getState();
  e.addNote({ x: 100, y: 100 }, "decision");
  e.createSubsystem("Boundary", e.project.graph.nodes.slice(0, 2).map(n => n.id));
  e.toggleExpanded(e.project.graph.nodes[0].id);
  e.saveRevision(details);
  const before = architectureSnapshot(useEditor.getState().project);
  const revision = useEditor.getState().project.revisions![0];
  e.removeNote(before.graph.notes![0].id);
  e.dissolveSubsystem(before.subsystems[0].id);
  e.toggleExpanded(e.project.graph.nodes[0].id);
  e.updateNode(e.project.graph.nodes[0].id, { name: "Working copy" });
  const changed = architectureSnapshot(useEditor.getState().project);
  const historyLength = useEditor.getState().past.length;
  e.restoreRevision(revision.id);
  expect(architectureSnapshot(useEditor.getState().project)).toEqual(before);
  expect(useEditor.getState().past).toHaveLength(historyLength + 1);
  e.undo();
  expect(architectureSnapshot(useEditor.getState().project)).toEqual(changed);
  e.redo();
  expect(architectureSnapshot(useEditor.getState().project)).toEqual(before);
  expect(useEditor.getState().project.revisions).toHaveLength(1);
});
it("round trips revision identities and source links in an independent imported project", () => {
  const e = useEditor.getState(); e.saveRevision(details);
  e.finalizeRevision(useEditor.getState().project.revisions![0].id);
  const original = useEditor.getState().project;
  const imported = importProject(exportProject(original));
  expect(imported.id).not.toBe(original.id);
  expect(imported.revisions).toEqual(original.revisions);
});
it("rejects malformed, unsafe and duplicate revision data on import", () => {
  useEditor.getState().saveRevision(details);
  const original = useEditor.getState().project;
  for (const patch of [{ author: "" }, { issue: "javascript:alert(1)" }, { createdAt: 1e20 }, { graph: null }, { subsystems: null }, { sourceId: "missing" }, { expandedNodeIds: [2] }]) {
    const project = clone(original);
    Object.assign(project.revisions![0], patch);
    expect(() => importProject(exportProject(project))).toThrow();
  }
  const project = clone(original); project.revisions!.push(clone(project.revisions![0]));
  expect(() => importProject(exportProject(project))).toThrow();
});
it("reports specific field changes and keeps unchanged copies equal", () => {
  const a = architectureSnapshot(useEditor.getState().project), b = clone(a);
  expect(compareArchitectures(a, b)).toEqual([]);
  b.graph.nodes[0].name = "New client";
  expect(compareArchitectures(a, b)).toContain('name: "Client" → "New client"');
});
it("rejects blank metadata and caps revision history without dropping prior snapshots", () => {
  const e = useEditor.getState();
  expect(e.saveRevision({ ...details, author: " " })).toBe(false);
  for (let i = 0; i < MAX_REVISIONS; i++) expect(e.saveRevision(details)).toBe(true);
  expect(e.saveRevision(details)).toBe(false);
  expect(useEditor.getState().project.revisions).toHaveLength(MAX_REVISIONS);
});

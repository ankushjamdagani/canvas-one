import type { Project } from "./model";
import { visibleSubsystems } from "./subsystems";

export const noteKinds = { decision: "Decision", assumption: "Assumption", future: "Future scope", question: "Question", general: "General note" } as const;
export type NoteKind = keyof typeof noteKinds;
export interface CanvasNote {
  id: string;
  kind: NoteKind;
  title: string;
  body: string;
  position: { x: number; y: number };
  collapsed: boolean;
  attachment?: { kind: "node" | "edge" | "subsystem"; id: string };
}
export const MAX_NOTES = 100;
export function validateNotes(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_NOTES) return ["Use up to 100 canvas notes."];
  const ids = new Set<string>();
  for (const n of value) {
    if (!n || typeof n.id !== "string" || !n.id || n.id.length > 100 || ids.has(n.id) ||
      typeof n.kind !== "string" || !Object.hasOwn(noteKinds, n.kind) || typeof n.title !== "string" || !n.title.trim() || n.title.length > 80 ||
      typeof n.body !== "string" || n.body.length > 1000 || typeof n.collapsed !== "boolean" ||
      !Number.isFinite(n.position?.x) || !Number.isFinite(n.position?.y) ||
      Math.abs(n.position.x) > 1_000_000 || Math.abs(n.position.y) > 1_000_000 ||
      (n.attachment !== undefined && (!n.attachment || !["node", "edge", "subsystem"].includes(n.attachment.kind) ||
        typeof n.attachment.id !== "string" || !n.attachment.id || n.attachment.id.length > 100)))
      return ["Canvas notes need unique IDs, a type, a title, valid position and text of at most 1000 characters."];
    ids.add(n.id);
  }
  return [];
}
/** Keep unresolved links so deleting a target never deletes its rationale; undo can restore it. */
export function noteAttachmentLabel(note: CanvasNote, project: Project): string | undefined {
  const a = note.attachment;
  if (!a) return undefined;
  if (a.kind === "node") return project.graph.nodes.find(n => n.id === a.id)?.name;
  if (a.kind === "subsystem") return visibleSubsystems(project).find(g => g.id === a.id)?.name;
  const edge = project.graph.edges.find(e => e.id === a.id);
  if (!edge) return undefined;
  return edge.label || `${project.graph.nodes.find(n => n.id === edge.source)?.name ?? "Component"} → ${project.graph.nodes.find(n => n.id === edge.target)?.name ?? "Component"}`;
}

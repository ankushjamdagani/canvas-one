import { useState } from "react";
import { ChevronDown, ChevronRight, StickyNote, Trash2 } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import { noteKinds, noteAttachmentLabel, type CanvasNote, type NoteKind } from "../domain/notes";
import { visibleSubsystems } from "../domain/subsystems";
import { useEditor } from "../state/editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type NoteFlowNode = Node<{ note: CanvasNote; attachmentLabel?: string }, "note">;
export function CanvasNoteNode({ data, selected }: NodeProps<NoteFlowNode>) {
  const update = useEditor(s => s.updateNote);
  const { note } = data;
  return <article className={`canvas-note ${selected ? "selected" : ""} ${note.collapsed ? "collapsed" : ""}`} aria-label={`${noteKinds[note.kind]}: ${note.title}`}>
    <div className="canvas-note-heading"><span><StickyNote size={14} />{noteKinds[note.kind]}</span>
      <button className="nodrag nopan" aria-label={`${note.collapsed ? "Expand" : "Collapse"} note ${note.title}`} aria-expanded={!note.collapsed} onClick={event => { event.stopPropagation(); update(note.id, { collapsed: !note.collapsed }); }}>{note.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</button>
    </div>
    <strong>{note.title}</strong>
    {!note.collapsed && <p>{note.body || "Select this note to add context."}</p>}
    {!note.collapsed && note.attachment && <span className="canvas-note-link">{data.attachmentLabel ? `Linked to ${data.attachmentLabel}` : "Linked item unavailable"}</span>}
  </article>;
}

export function NoteInspector({ note }: { note: CanvasNote }) {
  const editor = useEditor();
  const [draft, setDraft] = useState(note);
  const project = editor.project;
  const targets = [
    ...project.graph.nodes.map(n => ({ value: `node:${n.id}`, label: `Component · ${n.name}` })),
    ...project.graph.edges.map(e => ({ value: `edge:${e.id}`, label: `Connection · ${e.label || `${project.graph.nodes.find(n => n.id === e.source)?.name} → ${project.graph.nodes.find(n => n.id === e.target)?.name}`}` })),
    ...visibleSubsystems(project).map(g => ({ value: `subsystem:${g.id}`, label: `Subsystem · ${g.name}` })),
  ];
  const attachment = draft.attachment ? `${draft.attachment.kind}:${draft.attachment.id}` : "";
  const dirty = draft.title !== note.title || draft.body !== note.body || draft.kind !== note.kind || JSON.stringify(draft.attachment) !== JSON.stringify(note.attachment);
  return <aside className="inspector" aria-label="Canvas note editor">
    <div className="inspector-heading"><StickyNote size={20} /><strong>Canvas note</strong></div>
    <form className="inspector-body note-fields" onSubmit={event => {
      event.preventDefault();
      editor.updateNote(note.id, { title: draft.title.trim(), body: draft.body, kind: draft.kind, attachment: draft.attachment });
    }} onKeyDown={event => { if (event.key === "Escape") setDraft(note); }}>
      <p>Capture the reasoning behind this design. Drag the note to place it on the canvas.</p>
      <label>Note type<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as NoteKind })}>{Object.entries(noteKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Note title
        <Input
          autoFocus
          maxLength={80}
          required
          value={draft.title}
          onChange={event => setDraft({ ...draft, title: event.target.value })}
          className="h-8 mt-1"
        />
      </label>
      <label>Note text<textarea rows={7} maxLength={1000} value={draft.body} onChange={event => setDraft({ ...draft, body: event.target.value })} /></label>
      <span className="note-count">{draft.body.length} / 1000</span>
      <label>Link note to<select value={attachment} onChange={event => {
        const value = event.target.value;
        const separator = value.indexOf(":");
        setDraft({ ...draft, attachment: value ? { kind: value.slice(0, separator) as "node" | "edge" | "subsystem", id: value.slice(separator + 1) } : undefined });
      }}><option value="">No attachment</option>{attachment && !targets.some(t => t.value === attachment) && <option value={attachment}>Linked item unavailable</option>}{targets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
      <p>Links record context. Moving a component leaves the note in place.</p>
      <div className="note-actions flex items-center gap-2">
        <Button type="submit" disabled={!dirty || !draft.title.trim()} size="sm">
          Apply note
        </Button>
        <Button type="button" variant="outline" disabled={!dirty} onClick={() => setDraft(note)} size="sm">
          Cancel
        </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-center"
        aria-pressed={note.collapsed}
        onClick={() => editor.updateNote(note.id, { collapsed: !note.collapsed })}
      >
        {note.collapsed ? "Expand note" : "Collapse note"}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="delete-note w-full justify-center"
        onClick={() => editor.removeNote(note.id)}
      >
        <Trash2 size={15} />
        Delete note
      </Button>
      <p>Changes and deletion can be undone.</p>
    </form>
    <div className="inspector-bottom"><StickyNote size={14} /><span>Design context · no simulation behavior</span></div>
  </aside>;
}

export { noteAttachmentLabel };

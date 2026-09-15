import { useState } from "react";
import { architectureSnapshot, compareArchitectures, MAX_REVISIONS, validateRevisionDetails, type RevisionDetails } from "../domain/revisions";
import { useEditor } from "../state/editor";

const empty: RevisionDetails = { name: "", author: "", reason: "", message: "", issue: "" };
export function RevisionsPanel() {
  const editor = useEditor();
  const readOnly = editor.readOnly;
  const revisions = editor.project.revisions ?? [];
  const [details, setDetails] = useState(empty);
  const [selected, setSelected] = useState("");
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState("");
  const [composing, setComposing] = useState(revisions.length === 0);
  const revision = revisions.find(r => r.id === selected);
  const comparison = revisions.find(r => r.id === target);
  const changes = revision ? compareArchitectures(revision, comparison ?? architectureSnapshot(editor.project)) : [];
  const full = revisions.length >= MAX_REVISIONS;
  return <details className="revisions-panel">
    <summary>Architecture revisions · {revisions.length}</summary>
    <p className="small muted">Immutable snapshots saved in this browser. Author names are self-reported; final status records your decision.</p>
    {!composing && <button disabled={full || readOnly} onClick={() => setComposing(true)}>New revision</button>}
    {composing && <form onSubmit={event => {
      event.preventDefault();
      if (readOnly) {
        setNotice("Viewing archive. Revision creation is disabled.");
        return;
      }
      const clean = Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v.trim()])) as unknown as RevisionDetails;
      const errors = validateRevisionDetails(clean);
      if (errors.length) { setNotice(errors[0]); return; }
      if (!editor.saveRevision(clean)) { setNotice("Revision limit reached. Create a new project to continue."); return; }
      setSelected(useEditor.getState().project.revisions!.at(-1)!.id);
      setDetails({ ...empty, author: clean.author });
      setComposing(false);
      setNotice("Draft revision saved. Later canvas edits leave this snapshot unchanged.");
    }}>
      <h3>Save a revision</h3>
      {([['name', 'Revision name', 80], ['author', 'Author name', 80], ['reason', 'Reason for change', 500], ['message', 'Change explanation', 1000], ['issue', 'Linked issue URL (optional)', 240]] as const).map(([key, label, maxLength]) => <label className="field" key={key}>
        <span>{label}</span>
        {key === "reason" || key === "message" ? <textarea required maxLength={maxLength} value={details[key]} onChange={e => setDetails({ ...details, [key]: e.target.value })} /> : <input type={key === "issue" ? "url" : "text"} required={key !== "issue"} maxLength={maxLength} value={details[key]} onChange={e => setDetails({ ...details, [key]: e.target.value })} />}
      </label>)}
      <button disabled={full || readOnly} type="submit">Save draft revision</button>
      {revisions.length > 0 && <button type="button" onClick={() => setComposing(false)}>Cancel revision</button>}
    </form>}
    {full && <p className="field-help">All {MAX_REVISIONS} revision slots are used. Export a backup and start a new project to continue.</p>}
    <p role="status">{notice}</p>
    {revisions.length > 0 ? <>
      <label className="field"><span>Review revision</span><select aria-label="Review revision" value={selected} onChange={e => { setSelected(e.target.value); setTarget(""); setNotice(""); }}>
        <option value="">Choose a revision</option>
        {[...revisions].reverse().map(r => <option value={r.id} key={r.id}>{r.name} · {r.status}</option>)}
      </select></label>
      {revision && <article className="revision-review">
        <h3>{revision.name} · {revision.status}</h3>
        <p className="small">{revision.author} · <time dateTime={new Date(revision.createdAt).toISOString()}>{new Date(revision.createdAt).toLocaleString()}</time></p>
        <strong>Reason for change</strong><p>{revision.reason}</p>
        <strong>Change explanation</strong><p>{revision.message}</p>
        {revision.issue && <a href={revision.issue} target="_blank" rel="noreferrer">Open linked issue</a>}
        {revision.sourceId && <p className="small">Finalized from {revisions.find(r => r.id === revision.sourceId)?.name} (draft).</p>}
        <label className="field"><span>Compare selected revision to</span><select aria-label="Compare selected revision to" value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">Current canvas</option>
          {revisions.filter(r => r.id !== selected).map(r => <option value={r.id} key={r.id}>{r.name} · {r.status}</option>)}
        </select></label>
        {changes.length ? <ul className="revision-changes">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p>No architecture changes.</p>}
        <div className="panel-actions">
          {revision.status === "draft" && <button disabled={full || readOnly || revisions.some(r => r.sourceId === revision.id && r.status === "final")} onClick={() => {
            if (readOnly) return;
            if (editor.finalizeRevision(revision.id)) { setSelected(useEditor.getState().project.revisions!.at(-1)!.id); setNotice("Final copy saved from this draft. Current canvas edits are not included."); }
          }}>Finalize this draft</button>}
          <button disabled={readOnly} onClick={() => {
            if (readOnly) return;
            editor.restoreRevision(revision.id);
            setTarget("");
            setNotice("Revision restored to the canvas. Use Undo to recover the previous canvas.");
          }}>Restore to canvas</button>
        </div>
      </article>}
    </> : <p className="small muted">No revisions yet. Save the current architecture with its rationale.</p>}
  </details>;
}

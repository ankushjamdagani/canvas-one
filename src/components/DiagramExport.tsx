import { Download, FileImage, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { Project } from "../domain/model";
import { downloadDiagram, type DiagramExportFormat } from "../export/downloadDiagram";

export function DiagramExport({ project }: { project: Project }) {
  const [pending, setPending] = useState<DiagramExportFormat | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const disabled = project.graph.nodes.length === 0 || pending !== null;
  const run = async (format: DiagramExportFormat) => {
    setPending(format);
    setMessage(`Preparing ${format.toUpperCase()}…`);
    setFailed(false);
    try {
      await downloadDiagram(project, format);
      setMessage(`${format.toUpperCase()} download ready.`);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : `Could not export ${format.toUpperCase()}.`);
    } finally {
      setPending(null);
    }
  };
  return <section className="diagram-export" aria-label="Export diagram">
    <div className="diagram-export-copy"><strong>Entire diagram · current subsystem view</strong><span>PNG uses up to 2× scale within safe image limits.</span></div>
    <div className="diagram-export-actions">
      <button disabled={disabled} onClick={() => run("svg")}>{pending === "svg" ? <LoaderCircle className="export-spinner" size={15} /> : <Download size={15} />}{pending === "svg" ? "Preparing…" : "Download SVG"}</button>
      <button disabled={disabled} onClick={() => run("png")}>{pending === "png" ? <LoaderCircle className="export-spinner" size={15} /> : <FileImage size={15} />}{pending === "png" ? "Preparing…" : "Download PNG"}</button>
    </div>
    {message && <span className={`diagram-export-message ${failed ? "failed" : ""}`} role={failed ? "alert" : "status"}>{message}</span>}
  </section>;
}

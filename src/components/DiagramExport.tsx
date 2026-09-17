import { Download, FileImage, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { Project } from "../domain/model";
import { downloadDiagram, type DiagramExportFormat } from "../export/downloadDiagram";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Diagram visual image export panel. */
export function DiagramExport({ project }: { project: Project }) {
  const [pending, setPending] = useState<DiagramExportFormat | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const disabled = project.graph.nodes.length === 0 && !(project.graph.notes?.length) || pending !== null;
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
  return (
    <section
      data-testid="diagram-export"
      className="diagram-export grid grid-cols-1 sm:grid-cols-[minmax(150px,1fr)_auto] items-center gap-3 p-3 bg-card border border-border rounded-lg text-xs"
      aria-label="Export canvas"
    >
      <div className="diagram-export-copy flex flex-col gap-1">
        <strong className="text-xs font-semibold text-foreground">Entire canvas · current subsystem view</strong>
        <span className="text-[11px] text-muted-foreground leading-tight">PNG uses up to 2× scale within safe image limits.</span>
      </div>
      <div className="diagram-export-actions flex items-center gap-2">
        <Button
          data-testid="export-svg-btn"
          disabled={disabled}
          onClick={() => run("svg")}
          size="sm"
          className="h-8 px-3 text-xs gap-1.5"
        >
          {pending === "svg" ? <LoaderCircle className="export-spinner animate-spin" size={14} /> : <Download size={14} />}
          {pending === "svg" ? "Preparing…" : "Download SVG"}
        </Button>
        <Button
          data-testid="export-png-btn"
          disabled={disabled}
          onClick={() => run("png")}
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs gap-1.5"
        >
          {pending === "png" ? <LoaderCircle className="export-spinner animate-spin" size={14} /> : <FileImage size={14} />}
          {pending === "png" ? "Preparing…" : "Download PNG"}
        </Button>
      </div>
      <span
        className={cn(
          "diagram-export-message col-span-full min-h-[14px] text-[11px] text-muted-foreground",
          failed && "failed text-destructive font-medium"
        )}
        role={failed ? "alert" : "status"}
      >
        {message || "\u00a0"}
      </span>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { openExamples, type OpenExample } from "../domain/openExamples";
import type { Graph } from "../domain/model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ExamplesPanel({
  onSelect,
  onClose,
}: {
  onSelect: (graph: Graph) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"starter" | "tutorial">("starter");
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  const filtered = openExamples.filter((ex) => ex.kind === tab);
  const [selectedId, setSelectedId] = useState<string>(filtered[0]?.id ?? "");

  const current = filtered.find((ex) => ex.id === selectedId) ?? filtered[0];

  const handleTabChange = (nextTab: "starter" | "tutorial") => {
    setTab(nextTab);
    const nextFiltered = openExamples.filter((ex) => ex.kind === nextTab);
    if (nextFiltered.length) {
      setSelectedId(nextFiltered[0].id);
    }
  };

  const handleLoad = () => {
    if (!current) return;
    onSelect(current.create());
    onClose();
  };

  return (
    <div ref={dialog} className="examples-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="examples-title" onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div data-testid="examples-modal" className="examples-modal">
        <div className="examples-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={18} className="text-primary" />
            <h2 id="examples-title">System examples</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close examples"
            onClick={onClose}
            className="subtle h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </Button>
        </div>
        <div className="examples-tabs">
          <button
            className={cn("px-3 py-1.5 text-xs font-medium rounded transition-colors", tab === "starter" ? "active" : "")}
            onClick={() => handleTabChange("starter")}
          >
            Starter architectures
          </button>
          <button
            className={cn("px-3 py-1.5 text-xs font-medium rounded transition-colors", tab === "tutorial" ? "active" : "")}
            onClick={() => handleTabChange("tutorial")}
          >
            Guided tutorials
          </button>
        </div>
        <div className="examples-body">
          <div className="examples-list" role="listbox" aria-label="Available examples">
            {filtered.map((ex) => (
              <button
                key={ex.id}
                role="option"
                aria-selected={current?.id === ex.id}
                className={cn("example-list-item", current?.id === ex.id && "selected")}
                onClick={() => setSelectedId(ex.id)}
              >
                <div className="flex items-center justify-between w-full">
                  <strong>{ex.title}</strong>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal uppercase opacity-70">
                    {ex.kind}
                  </Badge>
                </div>
                <span>{ex.purpose}</span>
              </button>
            ))}
          </div>
          {current && (
            <div className="example-preview">
              <h3>{current.title}</h3>
              <p className="purpose">{current.purpose}</p>
              <div className="steps-title">Exploration steps</div>
              <ol>
                {current.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <div className="example-preview-actions flex items-center gap-2">
                <Button className="primary" onClick={handleLoad}>
                  Load example
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

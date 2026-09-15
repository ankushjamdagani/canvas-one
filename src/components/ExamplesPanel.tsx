import { useEffect, useRef, useState } from "react";
import { X, BookOpen, Sparkles } from "lucide-react";
import { openExamples, type OpenExample } from "../domain/openExamples";
import type { Graph } from "../domain/model";

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
      <div className="examples-modal">
        <div className="examples-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={18} color="#087f84" />
            <h2 id="examples-title">System examples</h2>
          </div>
          <button aria-label="Close examples" onClick={onClose} className="subtle">
            <X size={18} />
          </button>
        </div>
        <div className="examples-tabs">
          <button
            className={tab === "starter" ? "active" : ""}
            onClick={() => handleTabChange("starter")}
          >
            Starter architectures
          </button>
          <button
            className={tab === "tutorial" ? "active" : ""}
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
                className={`example-list-item ${current?.id === ex.id ? "selected" : ""}`}
                onClick={() => setSelectedId(ex.id)}
              >
                <strong>{ex.title}</strong>
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
              <div className="example-preview-actions">
                <button className="primary" onClick={handleLoad}>
                  Load example
                </button>
                <button onClick={onClose}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

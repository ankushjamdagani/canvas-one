import * as React from "react";
import {
  Plus,
  SlidersHorizontal,
  GitBranch,
  BarChart3,
  Download,
  Info,
} from "lucide-react";

export interface ActivityRailProps {
  leftDrawerMode: "components" | "revisions" | null;
  onToggleComponents: () => void;
  inspectorMode: "workloads" | "tutorial" | null;
  onToggleWorkloads: () => void;
  onToggleRevisions: () => void;
  resultsOpen: boolean;
  onToggleResults: () => void;
  onOpenExport: () => void;
  hasGuide: boolean;
  onToggleGuide: () => void;
}

export function ActivityRail({
  leftDrawerMode,
  onToggleComponents,
  inspectorMode,
  onToggleWorkloads,
  onToggleRevisions,
  resultsOpen,
  onToggleResults,
  onOpenExport,
  hasGuide,
  onToggleGuide,
}: ActivityRailProps) {
  return (
    <aside
      data-testid="activity-rail"
      className="canvas-first-left-rail"
      role="toolbar"
      aria-label="Workspace controls"
    >
      <div className="canvas-first-rail-group">
        <button
          data-testid="rail-add-component-btn"
          className={`canvas-first-rail-btn ${
            leftDrawerMode === "components" ? "active" : ""
          }`}
          onClick={onToggleComponents}
          aria-expanded={leftDrawerMode === "components"}
          aria-label="Add component"
          title="Add component (Components catalog)"
        >
          <Plus size={18} />
          <span className="canvas-first-rail-label">Add</span>
        </button>

        <button
          data-testid="rail-workloads-btn"
          className={`canvas-first-rail-btn ${
            inspectorMode === "workloads" ? "active" : ""
          }`}
          onClick={onToggleWorkloads}
          aria-expanded={inspectorMode === "workloads"}
          aria-label="Workloads"
          title="Workloads configuration"
        >
          <SlidersHorizontal size={18} />
          <span className="canvas-first-rail-label">Workloads</span>
        </button>

        <button
          data-testid="rail-revisions-btn"
          className={`canvas-first-rail-btn ${
            leftDrawerMode === "revisions" ? "active" : ""
          }`}
          onClick={onToggleRevisions}
          aria-expanded={leftDrawerMode === "revisions"}
          aria-label="Architecture Revisions"
          title="Revisions & Checkpoints"
        >
          <GitBranch size={18} />
          <span className="canvas-first-rail-label">Revisions</span>
        </button>

        <button
          data-testid="rail-runs-btn"
          className={`canvas-first-rail-btn ${resultsOpen ? "active" : ""}`}
          onClick={onToggleResults}
          aria-expanded={resultsOpen}
          aria-label="Saved runs"
          title="Saved runs & comparisons"
        >
          <BarChart3 size={18} />
          <span className="canvas-first-rail-label">Runs</span>
        </button>
      </div>

      <div className="canvas-first-rail-bottom">
        <button
          data-testid="rail-export-btn"
          className="canvas-first-rail-btn"
          onClick={onOpenExport}
          aria-label="Export options"
          title="Export canvas or JSON"
        >
          <Download size={18} />
          <span className="canvas-first-rail-label">Export</span>
        </button>

        {hasGuide && (
          <button
            data-testid="rail-guide-btn"
            className={`canvas-first-rail-btn ${
              inspectorMode === "tutorial" ? "active" : ""
            }`}
            aria-label="Show experiment guide"
            title="Experiment guide"
            onClick={onToggleGuide}
          >
            <Info size={16} />
            <span className="canvas-first-rail-label">Guide</span>
          </button>
        )}
      </div>
    </aside>
  );
}

import * as React from "react";
import {
  Undo2,
  Redo2,
  MousePointer,
  Hand,
  Boxes,
  StickyNote,
  Plus,
  Minus,
  Maximize2,
} from "lucide-react";

export interface CanvasFloatingDockProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dragMode: "select" | "pan";
  onSetDragMode: (mode: "select" | "pan") => void;
  canGroup: boolean;
  onGroupClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  canAddNote: boolean;
  onAddNote: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}

export function CanvasFloatingDock({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  dragMode,
  onSetDragMode,
  canGroup,
  onGroupClick,
  canAddNote,
  onAddNote,
  onZoomIn,
  onZoomOut,
  onFitView,
}: CanvasFloatingDockProps) {
  return (
    <div
      data-testid="canvas-floating-dock"
      className="canvas-floating-dock"
      role="toolbar"
      aria-label="Canvas controls"
    >
      {/* History: Undo & Redo */}
      <div className="canvas-dock-group">
        <button
          data-testid="dock-undo-btn"
          type="button"
          className="canvas-dock-btn"
          aria-label="Undo"
          title="Undo model edit (Cmd+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={15} />
          <span className="sr-only">Undo</span>
        </button>
        <button
          data-testid="dock-redo-btn"
          type="button"
          className="canvas-dock-btn"
          aria-label="Redo"
          title="Redo model edit (Cmd+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={15} />
          <span className="sr-only">Redo</span>
        </button>
      </div>

      <div className="canvas-dock-divider" />

      {/* Tool Modes: Select & Pan */}
      <div className="canvas-dock-group">
        <button
          data-testid="dock-select-btn"
          type="button"
          className={`canvas-dock-btn ${dragMode === "select" ? "active" : ""}`}
          aria-label="Select"
          aria-pressed={dragMode === "select"}
          title="Select tool (box select)"
          onClick={() => onSetDragMode("select")}
        >
          <MousePointer size={15} />
          <span className="canvas-dock-text">Select</span>
        </button>
        <button
          data-testid="dock-pan-btn"
          type="button"
          className={`canvas-dock-btn ${dragMode === "pan" ? "active" : ""}`}
          aria-label="Pan"
          aria-pressed={dragMode === "pan"}
          title="Pan tool (drag canvas)"
          onClick={() => onSetDragMode("pan")}
        >
          <Hand size={15} />
          <span className="canvas-dock-text">Pan</span>
        </button>
      </div>

      <div className="canvas-dock-divider" />

      {/* Group & Canvas Actions */}
      <div className="canvas-dock-group">
        <button
          data-testid="dock-group-btn"
          type="button"
          className="canvas-dock-btn"
          aria-label="Selection actions"
          title="Group / selection actions"
          disabled={!canGroup}
          onClick={onGroupClick}
        >
          <Boxes size={15} />
          <span className="canvas-dock-text">Group</span>
        </button>
        <button
          data-testid="dock-add-note-btn"
          type="button"
          className="canvas-dock-btn add-canvas-note"
          aria-label="Add canvas note"
          title="Add canvas note"
          disabled={!canAddNote}
          onClick={onAddNote}
        >
          <StickyNote size={15} />
          <span className="canvas-dock-text">Add canvas note</span>
        </button>
      </div>

      <div className="canvas-dock-divider" />

      {/* Zoom Controls */}
      <div className="canvas-dock-group">
        <button
          data-testid="dock-zoom-in-btn"
          type="button"
          className="canvas-dock-btn"
          aria-label="Zoom In"
          title="Zoom in"
          onClick={onZoomIn}
        >
          <Plus size={15} />
          <span className="sr-only">Zoom In</span>
        </button>
        <button
          data-testid="dock-zoom-out-btn"
          type="button"
          className="canvas-dock-btn"
          aria-label="Zoom Out"
          title="Zoom out"
          onClick={onZoomOut}
        >
          <Minus size={15} />
          <span className="sr-only">Zoom Out</span>
        </button>
        <button
          data-testid="dock-fit-view-btn"
          type="button"
          className="canvas-dock-btn"
          aria-label="Fit view"
          title="Fit view"
          onClick={onFitView}
        >
          <Maximize2 size={15} />
          <span className="sr-only">Fit view</span>
        </button>
      </div>
    </div>
  );
}

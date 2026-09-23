import * as React from "react";
import {
  Undo2,
  Redo2,
  MousePointer,
  Hand,
  Boxes,
  StickyNote,
  Minus,
  Plus,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  const [hasExportPanel, setHasExportPanel] = React.useState(false);

  React.useEffect(() => {
    const check = () => {
      const panel = document.querySelector(".canvas-first-export-panel");
      setHasExportPanel(Boolean(panel));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <TooltipProvider delayDuration={250}>
      <div
        data-testid="canvas-floating-dock"
        className={cn(
          "canvas-floating-dock",
          "absolute bottom-3 sm:bottom-6 z-dock",
          hasExportPanel
            ? "left-3 sm:left-4 translate-x-0"
            : "left-1/2 -translate-x-1/2",
          "flex max-w-[calc(100%-16px)] sm:max-w-none items-center gap-1",
          "rounded-dock border border-border bg-panel px-1.5 py-1",
          "shadow-[0_20px_44px_-18px_rgba(22,32,29,0.38),0_2px_6px_rgba(22,32,29,0.06)]",
          "overflow-x-auto select-none pointer-events-auto"
        )}
        role="toolbar"
        aria-label="Canvas controls"
      >
        {/* History: Undo & Redo */}
        <div className="canvas-dock-group shrink-0 flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-undo-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn shrink-0 size-8 text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text pointer-coarse:size-11"
                aria-label="Undo"
                disabled={!canUndo}
                onClick={onUndo}
              >
                <Undo2 className="size-3.5 sm:size-4" />
                <span className="sr-only">Undo</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Undo model edit (Cmd+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-redo-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn shrink-0 size-8 text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text pointer-coarse:size-11"
                aria-label="Redo"
                disabled={!canRedo}
                onClick={onRedo}
              >
                <Redo2 className="size-3.5 sm:size-4" />
                <span className="sr-only">Redo</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Redo model edit (Cmd+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="canvas-dock-divider shrink-0 h-[22px] bg-border" />

        {/* Tool Modes: Select & Pan */}
        <div className="canvas-dock-group shrink-0 flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-select-btn"
                type="button"
                variant={dragMode === "select" ? "tint" : "ghost"}
                size="icon"
                className={cn(
                  "canvas-dock-btn shrink-0 size-8 pointer-coarse:size-11",
                  dragMode === "select"
                    ? "active font-semibold text-primary"
                    : "text-body hover:text-foreground"
                )}
                aria-label="Select"
                aria-pressed={dragMode === "select"}
                onClick={() => onSetDragMode("select")}
              >
                <MousePointer className="size-3.5 sm:size-4" />
                <span className="sr-only">Select</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Select tool (box select)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-pan-btn"
                type="button"
                variant={dragMode === "pan" ? "tint" : "ghost"}
                size="icon"
                className={cn(
                  "canvas-dock-btn shrink-0 size-8 pointer-coarse:size-11",
                  dragMode === "pan"
                    ? "active font-semibold text-primary"
                    : "text-body hover:text-foreground"
                )}
                aria-label="Pan"
                aria-pressed={dragMode === "pan"}
                onClick={() => onSetDragMode("pan")}
              >
                <Hand className="size-3.5 sm:size-4" />
                <span className="sr-only">Pan</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Pan tool (drag canvas)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="canvas-dock-divider shrink-0 h-[22px] bg-border" />

        {/* Group & Canvas Actions */}
        <div className="canvas-dock-group shrink-0 flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-group-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn shrink-0 size-8 text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text pointer-coarse:size-11"
                aria-label="Selection actions"
                disabled={!canGroup}
                onClick={onGroupClick}
              >
                <Boxes className="size-3.5 sm:size-4" />
                <span className="sr-only">Group</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Selection actions</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-add-note-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn add-canvas-note shrink-0 size-8 min-w-8 pointer-coarse:min-w-11 pointer-coarse:size-11 text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text"
                aria-label="Add canvas note"
                disabled={!canAddNote}
                onClick={onAddNote}
              >
                <StickyNote className="size-3.5 sm:size-4" />
                <span className="sr-only">Add canvas note</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Add canvas note</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="canvas-dock-divider shrink-0 h-[22px] bg-border" />

        {/* Zoom Controls: Zoom Out, Zoom In, Fit view */}
        <div className="canvas-dock-group shrink-0 flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-zoom-out-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn shrink-0 size-8 text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text pointer-coarse:size-11"
                aria-label="Zoom Out"
                onClick={onZoomOut}
              >
                <Minus className="size-3.5 sm:size-4" />
                <span className="sr-only">Zoom Out</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zoom out</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-zoom-in-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn shrink-0 size-8 text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text pointer-coarse:size-11"
                aria-label="Zoom In"
                onClick={onZoomIn}
              >
                <Plus className="size-3.5 sm:size-4" />
                <span className="sr-only">Zoom In</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zoom in</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-fit-view-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn shrink-0 size-8 text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text pointer-coarse:size-11"
                aria-label="Fit view"
                onClick={onFitView}
              >
                <Maximize2 className="size-3.5 sm:size-4" />
                <span className="sr-only">Fit view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Fit view</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}

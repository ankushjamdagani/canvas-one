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
  return (
    <TooltipProvider delayDuration={250}>
      <div
        data-testid="canvas-floating-dock"
        className={cn(
          "canvas-floating-dock",
          "absolute bottom-2 left-2 sm:bottom-3.5 sm:left-3.5 z-10 flex max-w-[calc(100%-16px)] items-center gap-1 overflow-x-auto rounded-lg border border-border bg-background/95 backdrop-blur-md px-1.5 py-1 shadow-md select-none pointer-events-auto"
        )}
        role="toolbar"
        aria-label="Canvas controls"
      >
        {/* History: Undo & Redo */}
        <div className="canvas-dock-group flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-undo-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-40 bg-transparent border-transparent"
                aria-label="Undo"
                disabled={!canUndo}
                onClick={onUndo}
              >
                <Undo2 size={15} />
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
                className="canvas-dock-btn h-7 w-7 text-muted-foreground hover:text-foreground disabled:opacity-40 bg-transparent border-transparent"
                aria-label="Redo"
                disabled={!canRedo}
                onClick={onRedo}
              >
                <Redo2 size={15} />
                <span className="sr-only">Redo</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Redo model edit (Cmd+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="canvas-dock-divider h-4 mx-0.5 bg-border" />

        {/* Tool Modes: Select & Pan */}
        <div className="canvas-dock-group flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-select-btn"
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "canvas-dock-btn h-7 px-2 text-xs text-muted-foreground hover:text-foreground",
                  dragMode === "select"
                    ? "active bg-teal-500/15 text-teal-700 dark:text-teal-300 font-semibold border border-teal-500/30"
                    : "bg-transparent border-transparent"
                )}
                aria-label="Select"
                aria-pressed={dragMode === "select"}
                onClick={() => onSetDragMode("select")}
              >
                <MousePointer size={14} />
                <span className="canvas-dock-text ml-1">Select</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Select tool (box select)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-pan-btn"
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "canvas-dock-btn h-7 px-2 text-xs text-muted-foreground hover:text-foreground",
                  dragMode === "pan"
                    ? "active bg-teal-500/15 text-teal-700 dark:text-teal-300 font-semibold border border-teal-500/30"
                    : "bg-transparent border-transparent"
                )}
                aria-label="Pan"
                aria-pressed={dragMode === "pan"}
                onClick={() => onSetDragMode("pan")}
              >
                <Hand size={14} />
                <span className="canvas-dock-text ml-1">Pan</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Pan tool (drag canvas)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="canvas-dock-divider h-4 mx-0.5 bg-border" />

        {/* Group & Canvas Actions */}
        <div className="canvas-dock-group flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-group-btn"
                type="button"
                variant="ghost"
                size="sm"
                className="canvas-dock-btn h-7 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 bg-transparent border-transparent"
                aria-label="Selection actions"
                disabled={!canGroup}
                onClick={onGroupClick}
              >
                <Boxes size={14} />
                <span className="canvas-dock-text ml-1">Group</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Group / selection actions</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-add-note-btn"
                type="button"
                variant="ghost"
                size="sm"
                className="canvas-dock-btn add-canvas-note h-7 w-auto min-h-0 mt-0 px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 bg-transparent border-transparent"
                aria-label="Add canvas note"
                disabled={!canAddNote}
                onClick={onAddNote}
              >
                <StickyNote size={14} />
                <span className="canvas-dock-text ml-1">Add canvas note</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Add canvas note</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="canvas-dock-divider h-4 mx-0.5 bg-border" />

        {/* Zoom Controls */}
        <div className="canvas-dock-group flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-zoom-in-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn h-7 w-7 text-muted-foreground hover:text-foreground bg-transparent border-transparent"
                aria-label="Zoom In"
                onClick={onZoomIn}
              >
                <Plus size={15} />
                <span className="sr-only">Zoom In</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zoom in</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-zoom-out-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn h-7 w-7 text-muted-foreground hover:text-foreground bg-transparent border-transparent"
                aria-label="Zoom Out"
                onClick={onZoomOut}
              >
                <Minus size={15} />
                <span className="sr-only">Zoom Out</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zoom out</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-fit-view-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-dock-btn h-7 w-7 text-muted-foreground hover:text-foreground bg-transparent border-transparent"
                aria-label="Fit view"
                onClick={onFitView}
              >
                <Maximize2 size={15} />
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

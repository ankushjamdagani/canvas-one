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
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
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
  const dockRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  const [isCoarse, setIsCoarse] = React.useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(pointer: coarse)").matches
      : false
  );
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [hasExportPanel, setHasExportPanel] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(pointer: coarse)");
    setIsCoarse(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsCoarse(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  React.useEffect(() => {
    const dockEl = dockRef.current;
    if (!dockEl) return;
    const container = dockEl.parentElement || document.body;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

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

  const buttonSize = isCoarse ? 44 : 32;
  const fullDockWidth = 9 * buttonSize + 51;
  const dockWithZoomOverflowWidth = 7 * buttonSize + 47;
  const availableWidth = containerWidth - 16;

  const showAll = availableWidth >= fullDockWidth;
  const showGroupAndNote = availableWidth >= dockWithZoomOverflowWidth;

  return (
    <TooltipProvider delayDuration={250}>
      <div
        ref={dockRef}
        data-testid="canvas-floating-dock"
        className={cn(
          "canvas-floating-dock",
          "absolute bottom-3 sm:bottom-6 z-dock",
          hasExportPanel
            ? "left-3 sm:left-4 translate-x-0"
            : "left-1/2 -translate-x-1/2",
          "flex max-w-[calc(100%-16px)] sm:max-w-none items-center gap-1",
          "rounded-dock border border-border bg-panel px-1.5 py-1",
          "shadow-floating",
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

        {/* Group & Canvas Actions */}
        {(showAll || showGroupAndNote) && (
          <>
            <Separator orientation="vertical" className="canvas-dock-divider shrink-0 h-[22px] bg-border" />

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
          </>
        )}

        {/* Zoom Controls or More Popover */}
        {showAll ? (
          <>
            <Separator orientation="vertical" className="canvas-dock-divider shrink-0 h-[22px] bg-border" />

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
          </>
        ) : (
          <>
            <Separator orientation="vertical" className="canvas-dock-divider shrink-0 h-[22px] bg-border" />

            <div className="canvas-dock-group shrink-0 flex items-center">
              <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <PopoverTrigger asChild>
                  <Button
                    data-testid="dock-more-btn"
                    type="button"
                    variant={moreOpen ? "tint" : "ghost"}
                    size="icon"
                    className={cn(
                      "canvas-dock-btn shrink-0 size-8 pointer-coarse:size-11",
                      moreOpen
                        ? "active font-semibold text-primary"
                        : "text-body hover:text-foreground"
                    )}
                    aria-label="More canvas tools"
                    aria-expanded={moreOpen}
                  >
                    <MoreHorizontal className="size-3.5 sm:size-4" />
                    <span className="sr-only">More canvas tools</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  data-testid="dock-more-popover"
                  side="top"
                  align="center"
                  sideOffset={8}
                  className="z-popover w-auto min-w-[170px] p-1.5 flex flex-col gap-1 rounded-popover border border-border bg-panel shadow-popover"
                >
                  {!showGroupAndNote && (
                    <>
                      <div className="flex flex-col gap-0.5" role="group" aria-label="Selection actions">
                        <Button
                          data-testid="dock-group-btn"
                          type="button"
                          variant="ghost"
                          className="canvas-dock-btn justify-start h-8 pointer-coarse:h-11 px-2.5 gap-2 text-xs text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text rounded-control"
                          aria-label="Selection actions"
                          disabled={!canGroup}
                          onClick={(e) => {
                            onGroupClick(e);
                            setMoreOpen(false);
                          }}
                        >
                          <Boxes className="size-3.5 sm:size-4 shrink-0" />
                          <span>Selection actions</span>
                        </Button>

                        <Button
                          data-testid="dock-add-note-btn"
                          type="button"
                          variant="ghost"
                          className="canvas-dock-btn add-canvas-note justify-start h-8 pointer-coarse:h-11 px-2.5 gap-2 text-xs text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text rounded-control"
                          aria-label="Add canvas note"
                          disabled={!canAddNote}
                          onClick={() => {
                            onAddNote();
                            setMoreOpen(false);
                          }}
                        >
                          <StickyNote className="size-3.5 sm:size-4 shrink-0" />
                          <span>Add canvas note</span>
                        </Button>
                      </div>
                      <Separator orientation="horizontal" className="my-0.5 h-[1px] bg-border" />
                    </>
                  )}

                  <div className="flex flex-col gap-0.5" role="group" aria-label="Zoom controls">
                    <Button
                      data-testid="dock-zoom-out-btn"
                      type="button"
                      variant="ghost"
                      className="canvas-dock-btn justify-start h-8 pointer-coarse:h-11 px-2.5 gap-2 text-xs text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text rounded-control"
                      aria-label="Zoom Out"
                      onClick={() => {
                        onZoomOut();
                      }}
                    >
                      <Minus className="size-3.5 sm:size-4 shrink-0" />
                      <span>Zoom Out</span>
                    </Button>

                    <Button
                      data-testid="dock-zoom-in-btn"
                      type="button"
                      variant="ghost"
                      className="canvas-dock-btn justify-start h-8 pointer-coarse:h-11 px-2.5 gap-2 text-xs text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text rounded-control"
                      aria-label="Zoom In"
                      onClick={() => {
                        onZoomIn();
                      }}
                    >
                      <Plus className="size-3.5 sm:size-4 shrink-0" />
                      <span>Zoom In</span>
                    </Button>

                    <Button
                      data-testid="dock-fit-view-btn"
                      type="button"
                      variant="ghost"
                      className="canvas-dock-btn justify-start h-8 pointer-coarse:h-11 px-2.5 gap-2 text-xs text-body hover:text-foreground disabled:bg-transparent disabled:border-transparent disabled:text-secondary-text rounded-control"
                      aria-label="Fit view"
                      onClick={() => {
                        onFitView();
                        setMoreOpen(false);
                      }}
                    >
                      <Maximize2 className="size-3.5 sm:size-4 shrink-0" />
                      <span>Fit view</span>
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

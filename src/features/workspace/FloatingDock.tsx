import * as React from 'react';
import {
  MousePointer,
  Hand,
  Undo2,
  Redo2,
  Minus,
  Plus,
  Maximize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface FloatingDockProps {
  dragMode: 'select' | 'pan';
  onSetDragMode: (mode: 'select' | 'pan') => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  /** Live zoom factor (1 = 100%), from useViewport(). */
  zoom: number;
}

/**
 * 16A "Resting dock" (D38).
 *
 * D38 dock inventory is: undo, redo, Select, Pan, Component, Connect, Note,
 * More, zoom out, zoom %, zoom in, fit. Component/Connect/Note are left out
 * here — D39's standard catalog contract (per-entry visualKind/behavior/ports/
 * defaults, plus connection defaults) hasn't landed yet, so there is nothing
 * real for them to do. A "More" overflow popover (16B) is likewise omitted:
 * with only 8 live commands the dock fits at 390px without one, and there are
 * no extra real commands to put in it yet (absent, not fake). Run/History/the
 * "…" menu live only in the top bar (22A) per D38, not in this dock.
 */
export function FloatingDock({
  dragMode,
  onSetDragMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFitView,
  zoom,
}: FloatingDockProps) {
  const zoomPercent = Math.round(zoom * 100);

  return (
    <TooltipProvider delayDuration={250}>
      <div
        data-testid="canvas-floating-dock"
        className={cn(
          'absolute bottom-3 sm:bottom-6 z-dock',
          'left-1/2 -translate-x-1/2',
          'flex flex-wrap justify-center items-center gap-1 max-w-[calc(100vw-32px)] sm:max-w-none',
          'rounded-dock border border-border bg-panel px-1.5 py-1',
          'shadow-floating',
          'select-none pointer-events-auto',
        )}
        role="toolbar"
        aria-label="Canvas controls"
      >
        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-undo-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-8 text-body hover:text-foreground disabled:text-secondary-text"
                aria-label="Undo"
                disabled={!canUndo}
                onClick={onUndo}
              >
                <Undo2 className="size-4 stroke-current" />
                <span className="sr-only">Undo</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Undo (Mod+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-redo-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-8 text-body hover:text-foreground disabled:text-secondary-text"
                aria-label="Redo"
                disabled={!canRedo}
                onClick={onRedo}
              >
                <Redo2 className="size-4 stroke-current" />
                <span className="sr-only">Redo</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Redo (Mod+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="shrink-0 h-[22px] bg-border mx-0.5" />

        {/* Select / Pan tool modes, labelled per 16A */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-select-btn"
                type="button"
                variant={dragMode === 'select' ? 'tint' : 'ghost'}
                size="sm"
                className={cn(
                  'h-11 sm:h-8 px-2 gap-1.5 text-xs font-medium',
                  dragMode === 'select'
                    ? 'text-primary'
                    : 'text-body hover:text-foreground',
                )}
                aria-label="Select tool"
                aria-pressed={dragMode === 'select'}
                onClick={() => onSetDragMode('select')}
              >
                <MousePointer className="size-4 stroke-current" />
                <span className="hidden sm:inline">Select</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Select tool</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-pan-btn"
                type="button"
                variant={dragMode === 'pan' ? 'tint' : 'ghost'}
                size="sm"
                className={cn(
                  'h-11 sm:h-8 px-2 gap-1.5 text-xs font-medium',
                  dragMode === 'pan'
                    ? 'text-primary'
                    : 'text-body hover:text-foreground',
                )}
                aria-label="Pan tool"
                aria-pressed={dragMode === 'pan'}
                onClick={() => onSetDragMode('pan')}
              >
                <Hand className="size-4 stroke-current" />
                <span className="hidden sm:inline">Pan</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Pan tool</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="shrink-0 h-[22px] bg-border mx-0.5" />

        {/* Zoom controls: out, live %, in, fit */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-zoom-out-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-8 text-body hover:text-foreground"
                aria-label="Zoom out"
                onClick={onZoomOut}
              >
                <Minus className="size-4" />
                <span className="sr-only">Zoom out</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zoom out (1.2x)</TooltipContent>
          </Tooltip>

          <span
            data-testid="dock-zoom-value"
            className="text-xs font-mono text-secondary-text w-11 text-center select-none tabular-nums"
            aria-live="polite"
          >
            {zoomPercent}%
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-zoom-in-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-8 text-body hover:text-foreground"
                aria-label="Zoom in"
                onClick={onZoomIn}
              >
                <Plus className="size-4" />
                <span className="sr-only">Zoom in</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zoom in (1.2x)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-fit-view-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 sm:size-8 text-body hover:text-foreground"
                aria-label="Fit view"
                onClick={onFitView}
              >
                <Maximize2 className="size-4" />
                <span className="sr-only">Fit view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Fit view (padding 32px)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}

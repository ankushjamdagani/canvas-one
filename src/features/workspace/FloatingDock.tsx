import * as React from 'react';
import {
  MousePointer,
  Hand,
  Undo2,
  Redo2,
  Minus,
  Plus,
  Maximize2,
  Play,
  Pause,
  RotateCcw,
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
}

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
}: FloatingDockProps) {
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
        {/* Tool Modes: Select & Pan */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-select-btn"
                type="button"
                variant={dragMode === 'select' ? 'tint' : 'ghost'}
                size="icon"
                className={cn(
                  'size-8',
                  dragMode === 'select'
                    ? 'active font-semibold text-primary'
                    : 'text-body hover:text-foreground',
                )}
                aria-label="Select mode"
                aria-pressed={dragMode === 'select'}
                onClick={() => onSetDragMode('select')}
              >
                <MousePointer className="size-4 stroke-current" />
                <span className="sr-only">Select</span>
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
                size="icon"
                className={cn(
                  'size-8',
                  dragMode === 'pan'
                    ? 'active font-semibold text-primary'
                    : 'text-body hover:text-foreground',
                )}
                aria-label="Pan mode"
                aria-pressed={dragMode === 'pan'}
                onClick={() => onSetDragMode('pan')}
              >
                <Hand className="size-4 stroke-current" />
                <span className="sr-only">Pan</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Pan tool</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="shrink-0 h-[22px] bg-border mx-0.5" />

        {/* History: Undo & Redo */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-undo-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-body hover:text-foreground disabled:text-secondary-text"
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
                className="size-8 text-body hover:text-foreground disabled:text-secondary-text"
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

        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-zoom-out-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-body hover:text-foreground"
                aria-label="Zoom Out"
                onClick={onZoomOut}
              >
                <Minus className="size-4" />
                <span className="sr-only">Zoom Out</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Zoom out (1.2x)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-zoom-in-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-body hover:text-foreground"
                aria-label="Zoom In"
                onClick={onZoomIn}
              >
                <Plus className="size-4" />
                <span className="sr-only">Zoom In</span>
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
                className="size-8 text-body hover:text-foreground"
                aria-label="Fit View"
                onClick={onFitView}
              >
                <Maximize2 className="size-4" />
                <span className="sr-only">Fit view</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Fit view (padding 32px)</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="shrink-0 h-[22px] bg-border mx-0.5 hidden sm:block" />

        {/* Run Controls: Rendered disabled per requirement 6 */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-run-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-body opacity-40 cursor-not-allowed"
                aria-label="Run"
                disabled
              >
                <Play className="size-4" />
                <span className="sr-only">Run</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Runs arrive in the next step</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-pause-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-body opacity-40 cursor-not-allowed"
                aria-label="Pause"
                disabled
              >
                <Pause className="size-4" />
                <span className="sr-only">Pause</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Runs arrive in the next step</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-reset-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-body opacity-40 cursor-not-allowed"
                aria-label="Reset"
                disabled
              >
                <RotateCcw className="size-4" />
                <span className="sr-only">Reset</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Runs arrive in the next step</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}

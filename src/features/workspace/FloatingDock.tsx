import * as React from 'react';
import {
  MousePointer,
  Hand,
  Undo2,
  Redo2,
  Minus,
  Plus,
  Maximize2,
  Component as ComponentIcon,
  Cable,
  StickyNote,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface FloatingDockProps {
  dragMode: 'select' | 'pan' | 'connect';
  onSetDragMode: (mode: 'select' | 'pan' | 'connect') => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  /** Live zoom factor (1 = 100%), from useViewport(). */
  zoom: number;
  /** library.open (D38 "Component"): toggles the 16E picker anchored above the dock. */
  onToggleComponentPicker: () => void;
  componentPickerOpen: boolean;
  /** canvas.add-note through Workspace's command registry executor. */
  onAddNote: (text: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** True while the session is saving -- placing/connecting is disabled, not silently dropped. */
  disabled?: boolean;
}

/**
 * 16A "Resting dock" (D38).
 *
 * D38 dock inventory is: undo, redo, Select, Pan, Component, Connect, Note,
 * More, zoom out, zoom %, zoom in, fit. Component (library.open) and Connect
 * (canvas.connect-tool) are wired here per RV-12e now that D39/D42's standard
 * catalog contract has landed. Note routes through canvas.add-note. The
 * uncontracted "More" overflow stays absent. Run/History live only in the top
 * bar (22A) per D38, not in this dock.
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
  onToggleComponentPicker,
  componentPickerOpen,
  onAddNote,
  disabled,
}: FloatingDockProps) {
  const zoomPercent = Math.round(zoom * 100);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [noteText, setNoteText] = React.useState('');
  const [noteError, setNoteError] = React.useState<string | null>(null);

  async function submitNote() {
    const text = noteText.trim();
    if (!text || disabled) return;
    setNoteError(null);
    const outcome = await onAddNote(text);
    if (outcome.ok) {
      setNoteOpen(false);
      setNoteText('');
    } else {
      setNoteError(outcome.message);
    }
  }

  return (
    <TooltipProvider delayDuration={250}>
      <div
        data-testid="canvas-floating-dock"
        className={cn(
          'absolute bottom-3 sm:bottom-6 z-dock',
          'left-1/2 -translate-x-1/2',
          'flex flex-wrap sm:flex-nowrap sm:w-max justify-center items-center gap-1 max-w-[calc(100vw-32px)] sm:max-w-none',
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

        {/* Component (library.open) / Connect (canvas.connect-tool), D38 order */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-component-btn"
                type="button"
                variant={componentPickerOpen ? 'tint' : 'ghost'}
                size="sm"
                className={cn(
                  'h-11 sm:h-8 px-2 gap-1.5 text-xs font-medium',
                  componentPickerOpen ? 'text-primary' : 'text-body hover:text-foreground',
                )}
                aria-label="Component"
                aria-pressed={componentPickerOpen}
                disabled={disabled}
                onClick={onToggleComponentPicker}
              >
                <ComponentIcon className="size-4 stroke-current" />
                <span className="hidden sm:inline">Component</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Add a component</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="dock-connect-btn"
                type="button"
                variant={dragMode === 'connect' ? 'tint' : 'ghost'}
                size="sm"
                className={cn(
                  'h-11 sm:h-8 px-2 gap-1.5 text-xs font-medium',
                  dragMode === 'connect' ? 'text-primary' : 'text-body hover:text-foreground',
                )}
                aria-label="Connect tool"
                aria-pressed={dragMode === 'connect'}
                disabled={disabled}
                onClick={() => onSetDragMode(dragMode === 'connect' ? 'select' : 'connect')}
              >
                <Cable className="size-4 stroke-current" />
                <span className="hidden sm:inline">Connect</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Connect tool</TooltipContent>
          </Tooltip>

          <Popover
            open={noteOpen}
            onOpenChange={(open) => {
              setNoteOpen(open);
              if (!open) setNoteError(null);
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    data-testid="dock-note-btn"
                    type="button"
                    variant={noteOpen ? 'tint' : 'ghost'}
                    size="sm"
                    className={cn(
                      'h-11 sm:h-8 px-2 gap-1.5 text-xs font-medium',
                      noteOpen ? 'text-primary' : 'text-body hover:text-foreground',
                    )}
                    aria-label="Note"
                    aria-pressed={noteOpen}
                    disabled={disabled}
                  >
                    <StickyNote className="size-4 stroke-current" />
                    <span className="hidden sm:inline">Note</span>
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="top">Add a note</TooltipContent>
            </Tooltip>
            <PopoverContent side="top" align="center" className="w-72 p-3">
              <form
                data-testid="dock-note-popover"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitNote();
                }}
              >
                <label htmlFor="dock-note-text" className="block text-xs font-medium text-ink mb-1.5">
                  Note text
                </label>
                <Input
                  id="dock-note-text"
                  data-testid="dock-note-input"
                  autoFocus
                  value={noteText}
                  placeholder="Write a note…"
                  disabled={disabled}
                  onChange={(event) => {
                    setNoteText(event.target.value);
                    setNoteError(null);
                  }}
                />
                {noteError && <p role="alert" className="mt-1.5 text-xs text-risk-text">{noteError}</p>}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-secondary-text">↵ add · esc cancel</span>
                  <Button type="submit" size="sm" variant="tint" disabled={!noteText.trim() || disabled}>
                    Add note
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
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

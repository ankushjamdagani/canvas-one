import * as React from 'react';
import {
  MousePointer, Hand, Undo2, Redo2, Minus, Plus, Maximize2, Library,
  StickyNote, Group, History, ChartNoAxesCombined, Play, Pause, RotateCcw,
  MoreHorizontal, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { LibraryPicker } from '../library/LibraryPicker';
import { COMMAND_DEFINITIONS, getAvailability, type Availability, type CommandContext } from './commands/registry';
import { changeDockConfig, DEFAULT_DOCK_CONFIG, DOCK_COMMAND_IDS, insertDockCommand, type DockCommandId, type DockConfig } from './dockConfig';

const DOCK_DRAG_MIME = 'application/x-system-studio-dock-command';

const ICONS = {
  'canvas.select-tool': MousePointer, 'canvas.pan-tool': Hand, 'library.open': Library,
  'canvas.add-note': StickyNote, 'selection.group': Group, 'edit.undo': Undo2,
  'edit.redo': Redo2, 'canvas.zoom-out': Minus, 'canvas.zoom-in': Plus,
  'canvas.fit': Maximize2, 'history.open': History,
  'results.open': ChartNoAxesCombined, 'run.start': Play, 'run.pause': Pause,
  'run.resume': Play, 'run.reset': RotateCcw,
} satisfies Record<DockCommandId, React.ComponentType<{ className?: string }>>;

const TEST_IDS: Partial<Record<DockCommandId, string>> = {
  'canvas.select-tool': 'dock-select-btn', 'canvas.pan-tool': 'dock-pan-btn',
  'library.open': 'dock-component-btn', 'canvas.add-note': 'dock-note-btn',
  'edit.undo': 'dock-undo-btn', 'edit.redo': 'dock-redo-btn',
  'canvas.zoom-out': 'dock-zoom-out-btn', 'canvas.zoom-in': 'dock-zoom-in-btn',
  'canvas.fit': 'dock-fit-view-btn',
};

export interface FloatingDockProps {
  readonly dragMode: 'select' | 'pan';
  readonly zoom: number;
  readonly context: CommandContext;
  readonly config: DockConfig;
  readonly preferenceState: 'loading' | 'ready' | 'saving' | 'failed';
  readonly onInvoke: (id: DockCommandId) => void;
  readonly onConfigure: (config: DockConfig) => void;
  readonly onRestoreDefaults: () => void;
  readonly onAddNote: (text: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  readonly onGroup: (label: string) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** 16E: places a catalog entry at the visible canvas centre from the compact picker. */
  readonly onPlaceEntry: (entryId: string) => void;
}

function availability(id: DockCommandId, context: CommandContext): Availability {
  if (id === 'run.start') return getAvailability(id, context, { scenarioId: context.selectedScenario?.id ?? '' });
  if (id === 'canvas.add-note') return getAvailability(id, context, { text: '' });
  if (id === 'selection.group') return getAvailability(id, context, { label: '' });
  return getAvailability(id, context, {});
}

/** The same command view is used in the dock and its narrow-screen overflow. */
export function FloatingDock({ dragMode, zoom, context, config, preferenceState, onInvoke,
  onConfigure, onRestoreDefaults, onAddNote, onGroup, onPlaceEntry }: FloatingDockProps) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [customizing, setCustomizing] = React.useState(false);
  const [textAction, setTextAction] = React.useState<'canvas.add-note' | 'selection.group' | null>(null);
  const [textValue, setTextValue] = React.useState('');
  const [textError, setTextError] = React.useState<string | null>(null);
  // 16E compact picker (D30 as amended 2026-09-29): the dock's Component button opens it
  // only while the Library panel is closed; with the panel open it focuses the panel, so
  // the picker and the panel are never open together (R07).
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const libraryPanelOpen = context.panels.library.open;
  React.useEffect(() => {
    if (libraryPanelOpen) setPickerOpen(false);
  }, [libraryPanelOpen]);
  const [dropTarget, setDropTarget] = React.useState<DockCommandId | 'dock' | null>(null);
  const [narrow, setNarrow] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const sync = () => setNarrow(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const zoomPercent = Math.round(zoom * 100);

  function invoke(id: DockCommandId) {
    if (id === 'library.open' && !libraryPanelOpen) {
      setMoreOpen(false);
      setPickerOpen((open) => !open);
    } else if (id === 'canvas.add-note' || id === 'selection.group') {
      setMoreOpen(false);
      setTextAction(id);
      setTextValue('');
      setTextError(null);
    } else {
      setMoreOpen(false);
      onInvoke(id);
    }
  }

  async function submitText() {
    const text = textValue.trim();
    if (!text || !textAction) return;
    const outcome = textAction === 'canvas.add-note' ? await onAddNote(text) : await onGroup(text);
    if (outcome.ok) {
      setTextAction(null);
      setTextValue('');
      setTextError(null);
    } else setTextError(outcome.message);
  }

  function commandButton(id: DockCommandId, compact = false) {
    const def = COMMAND_DEFINITIONS[id];
    const state = availability(id, context);
    const Icon = ICONS[id];
    const active = (id === 'canvas.select-tool' && dragMode === 'select') ||
      (id === 'canvas.pan-tool' && dragMode === 'pan') ||
      (id === 'library.open' && (pickerOpen || libraryPanelOpen));
    return (
      <Button key={id} type="button" variant={active ? 'tint' : 'ghost'}
        size={compact ? 'sm' : 'icon'}
        data-testid={compact ? `dock-overflow-${id}` : (TEST_IDS[id] ?? `dock-${id}`)}
        className={cn('shrink-0 gap-2', compact ? 'w-full justify-start min-h-11 h-auto py-1 text-xs' : 'size-11 md:size-8')}
        aria-label={def.label} aria-pressed={active || undefined}
        aria-description={state.enabled ? undefined : state.reason}
        title={state.enabled ? def.label : state.reason}
        disabled={!state.enabled}
        onClick={() => invoke(id)}>
        <Icon className="size-4" aria-hidden="true" />
        {compact && <span className="flex flex-col items-start text-left">
          <span>{def.label}</span>
          {!state.enabled && <span className="text-[10px] text-secondary-text">{state.reason}</span>}
        </span>}
      </Button>
    );
  }

  const pinned = new Set<DockCommandId>(['canvas.select-tool', 'canvas.pan-tool', 'library.open']);
  const mobileVisible = config.orderedCommandIds.filter((id) => pinned.has(id));
  const mobileOverflow = config.orderedCommandIds.filter((id) => !pinned.has(id));
  const canEdit = preferenceState !== 'loading' && preferenceState !== 'saving';

  function draggedCommand(event: React.DragEvent): DockCommandId | null {
    const id = event.dataTransfer.getData(DOCK_DRAG_MIME);
    return DOCK_COMMAND_IDS.find((candidate) => candidate === id) ?? null;
  }

  function acceptDrop(event: React.DragEvent, beforeId?: DockCommandId) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const id = draggedCommand(event);
    if (!canEdit || !id) return;
    const next = insertDockCommand(config, id, beforeId);
    if (next !== config) onConfigure(next);
  }

  return (
    <div data-testid="canvas-floating-dock" role="toolbar" aria-label="Canvas controls"
      className={cn('absolute bottom-3 md:bottom-6 left-1/2 -translate-x-1/2 z-dock flex items-center gap-1 max-w-[calc(100vw-24px)] rounded-dock border border-border bg-panel p-1 shadow-floating pointer-events-auto',
        dropTarget === 'dock' && 'ring-2 ring-primary')}
      onDragOver={(event) => {
        if (!canEdit || !event.dataTransfer.types.includes(DOCK_DRAG_MIME)) return;
        event.preventDefault();
        setDropTarget('dock');
      }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(event) => acceptDrop(event)}>
      <div className="flex items-center gap-0.5 overflow-x-auto max-w-[calc(100vw-140px)]">
        {(narrow ? mobileVisible : config.orderedCommandIds).map((id) => commandButton(id))}
      </div>
      <span data-testid="dock-zoom-value" aria-live="polite"
        className="inline-block w-11 text-center font-mono text-xs tabular-nums text-secondary-text">
        {zoomPercent}%
      </span>
      <Popover open={moreOpen} onOpenChange={(open) => { setMoreOpen(open); if (!open) setCustomizing(false); }}>
        <PopoverTrigger asChild>
          <Button type="button" variant={moreOpen ? 'tint' : 'ghost'} size="icon"
            data-testid="dock-more-btn" aria-label="More dock actions" aria-expanded={moreOpen}
            className="size-11 md:size-8 shrink-0"><MoreHorizontal className="size-4" /></Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-[min(360px,calc(100vw-24px))] max-h-[min(70vh,560px)] overflow-y-auto p-2"
          onCloseAutoFocus={(event) => { if (textAction) event.preventDefault(); }}>
          {customizing ? (
            <div data-testid="dock-customize-tray">
              <div className="flex items-center justify-between px-1 pb-2 border-b border-border">
                <span className="text-xs font-semibold">Customize dock</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCustomizing(false)}>Done</Button>
              </div>
              <p className="px-1 pt-2 text-[11px] text-secondary-text">Use the controls to order or hide commands.</p>
              <ul className="space-y-1 mt-2" aria-label="Dock commands">
                {config.orderedCommandIds.map((id, index) => (
                  <li key={id} draggable={canEdit} data-testid={`dock-customize-${id}`}
                    className={cn('flex items-center gap-1 rounded-control bg-sunken px-2 py-1', dropTarget === id && 'ring-2 ring-primary')}
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(DOCK_DRAG_MIME, id); }}
                    onDragEnd={() => setDropTarget(null)}
                    onDragOver={(event) => {
                      if (!canEdit || !event.dataTransfer.types.includes(DOCK_DRAG_MIME)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      setDropTarget(id);
                    }}
                    onDrop={(event) => acceptDrop(event, id)}>
                    <span className="flex-1 min-w-0 truncate text-xs">{COMMAND_DEFINITIONS[id].label}</span>
                    <Button type="button" size="icon" variant="ghost" className="size-11 md:size-8" aria-label={`Move ${COMMAND_DEFINITIONS[id].label} left`}
                      disabled={!canEdit || index === 0} onClick={() => onConfigure(changeDockConfig(config, id, 'left'))}><ChevronLeft className="size-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="size-11 md:size-8" aria-label={`Move ${COMMAND_DEFINITIONS[id].label} right`}
                      disabled={!canEdit || index === config.orderedCommandIds.length - 1} onClick={() => onConfigure(changeDockConfig(config, id, 'right'))}><ChevronRight className="size-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="size-11 md:size-8" aria-label={`Hide ${COMMAND_DEFINITIONS[id].label}`}
                      disabled={!canEdit} onClick={() => onConfigure(changeDockConfig(config, id, 'hide'))}><X className="size-4" /></Button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-border pt-2">
                <div className="px-1 text-[11px] font-semibold text-secondary-text">Available commands</div>
                {config.hiddenCommandIds.map((id) => (
                  <div key={id} draggable={canEdit} className="flex items-center gap-2 px-1 py-1"
                    data-testid={`dock-available-${id}`}
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(DOCK_DRAG_MIME, id); }}
                    onDragEnd={() => setDropTarget(null)}>
                    <span className="flex-1 text-xs">{COMMAND_DEFINITIONS[id].label}</span>
                    <Button type="button" size="sm" variant="ghost" className="h-11 md:h-8" aria-label={`Show ${COMMAND_DEFINITIONS[id].label}`}
                      disabled={!canEdit || config.orderedCommandIds.length >= 16}
                      onClick={() => onConfigure(changeDockConfig(config, id, 'show'))}>Add</Button>
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" variant="ghost" className="mt-2 w-full"
                disabled={!canEdit || JSON.stringify(config) === JSON.stringify(DEFAULT_DOCK_CONFIG)}
                onClick={onRestoreDefaults}>Restore defaults</Button>
              {preferenceState === 'failed' && <p role="alert" className="text-xs text-risk-text">Dock changes could not be saved.</p>}
            </div>
          ) : (
            <div data-testid="dock-more-popover">
              <div className="hidden md:block px-2 pb-1 text-[11px] font-semibold text-secondary-text">Dock actions</div>
              {narrow && <div className="space-y-0.5">{mobileOverflow.map((id) => commandButton(id, true))}</div>}
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-xs"
                onClick={() => setCustomizing(true)}>Customize dock…</Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-xs"
                disabled={!canEdit}
                onClick={() => { setMoreOpen(false); onRestoreDefaults(); }}>Restore defaults</Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Popover open={textAction !== null} onOpenChange={(open) => { if (!open) setTextAction(null); }}>
        <PopoverAnchor asChild><span className="absolute left-1/2 top-0" /></PopoverAnchor>
        <PopoverContent side="top" align="center" className="w-72 p-3" data-testid={textAction === 'canvas.add-note' ? 'dock-note-popover' : 'dock-group-popover'}>
          <form onSubmit={(event) => { event.preventDefault(); void submitText(); }}>
            <label htmlFor="dock-text-input" className="block text-xs font-medium mb-1.5">
              {textAction === 'canvas.add-note' ? 'Note text' : 'Group name'}
            </label>
            <Input id="dock-text-input" data-testid={textAction === 'canvas.add-note' ? 'dock-note-input' : 'dock-group-input'}
              autoFocus value={textValue} onChange={(event) => { setTextValue(event.target.value); setTextError(null); }} />
            {textError && <p role="alert" className="mt-1 text-xs text-risk-text">{textError}</p>}
            <div className="mt-2 flex justify-end"><Button type="submit" size="sm" disabled={!textValue.trim()}>
              {textAction === 'canvas.add-note' ? 'Add note' : 'Group'}
            </Button></div>
          </form>
        </PopoverContent>
      </Popover>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverAnchor asChild><span className="absolute left-1/2 top-0" /></PopoverAnchor>
        <PopoverContent side="top" align="center" sideOffset={8}
          className="w-[min(640px,calc(100vw-24px))] p-0 border-0 bg-transparent shadow-none"
          data-testid="dock-library-picker-popover"
          onCloseAutoFocus={(e) => {
            // Anchored, not triggered: return focus to the dock's Component button
            // unless placing or opening the full library moved it somewhere on purpose.
            e.preventDefault();
            const active = document.activeElement;
            if (active && active !== document.body) return;
            document.querySelector<HTMLElement>('[data-testid="dock-component-btn"]')?.focus();
          }}
          onDragEnd={() => setPickerOpen(false)}>
          <LibraryPicker
            onPlace={(entryId) => { setPickerOpen(false); onPlaceEntry(entryId); }}
            onOpenFullLibrary={() => { setPickerOpen(false); onInvoke('library.open'); }}
            onClose={() => setPickerOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

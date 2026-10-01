import * as React from 'react';
import {
  MousePointer, Hand, Undo2, Redo2, Minus, Plus, Maximize2, Library,
  StickyNote, Group, History, ChartNoAxesCombined, Play, Pause, RotateCcw,
  MoreHorizontal, X, Settings2, GripVertical,
  Pin, Hash, Map, Type,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { LibraryPicker } from '../library/LibraryPicker';
import { COMMAND_DEFINITIONS, formatShortcut, getAvailability, type Availability, type CommandContext } from './commands/registry';
import { changeDockConfig, DEFAULT_DOCK_CONFIG, DOCK_COMMAND_IDS, insertDockCommand, type DockCommandId, type DockConfig } from './dockConfig';

const DOCK_DRAG_MIME = 'application/x-system-studio-dock-command';

const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

const FIXED_LEFT_COMMANDS = ['canvas.select-tool', 'canvas.pan-tool'] as const;
const FIXED_RIGHT_COMMANDS = ['canvas.zoom-out', 'canvas.zoom-in', 'canvas.fit'] as const;
const FIXED_LEFT_SET = new Set<DockCommandId>(FIXED_LEFT_COMMANDS);
const FIXED_RIGHT_SET = new Set<DockCommandId>(FIXED_RIGHT_COMMANDS);
const FIXED_SET = new Set<DockCommandId>([...FIXED_LEFT_COMMANDS, ...FIXED_RIGHT_COMMANDS]);

const MAX_CENTER_CONTROLS = 10;

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
  readonly snapToGrid?: boolean;
  readonly onToggleSnapToGrid?: (snap: boolean) => void;
  readonly showMinimap?: boolean;
  readonly onToggleMinimap?: (show: boolean) => void;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

function availability(id: DockCommandId, context: CommandContext): Availability {
  if (id === 'run.start') return getAvailability(id, context, { scenarioId: context.selectedScenario?.id ?? '' });
  if (id === 'canvas.add-note') return getAvailability(id, context, { text: '' });
  if (id === 'selection.group') return getAvailability(id, context, { label: '' });
  return getAvailability(id, context, {});
}

/** The same command view is used in the dock and its narrow-screen overflow. */
export function FloatingDock({ dragMode, zoom, context, config, preferenceState, onInvoke,
  onConfigure, onRestoreDefaults, onAddNote, onGroup, onPlaceEntry,
  snapToGrid, onToggleSnapToGrid, showMinimap, onToggleMinimap, className, style }: FloatingDockProps) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [customizing, setCustomizing] = React.useState(false);
  const [showLabels, setShowLabelsState] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('system_studio_dock_labels') === 'true';
    } catch {
      return false;
    }
  });

  const setShowLabels = React.useCallback((value: boolean) => {
    setShowLabelsState(value);
    try {
      localStorage.setItem('system_studio_dock_labels', String(value));
    } catch {
      // ignore
    }
  }, []);

  const [localSnapToGrid, setLocalSnapToGrid] = React.useState(true);
  const [localShowMinimap, setLocalShowMinimap] = React.useState(false);
  const activeSnapToGrid = snapToGrid ?? localSnapToGrid;
  const activeShowMinimap = showMinimap ?? localShowMinimap;
  const handleToggleSnap = onToggleSnapToGrid ?? setLocalSnapToGrid;
  const handleToggleMinimap = onToggleMinimap ?? setLocalShowMinimap;

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
  const [dropTarget, setDropTarget] = React.useState<DockCommandId | 'dock' | 'shelf' | 'cluster' | 'end' | null>(null);
  const [narrow, setNarrow] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const sync = () => setNarrow(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // Escape key closes customization mode
  React.useEffect(() => {
    if (!customizing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCustomizing(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [customizing]);

  const zoomPercent = Math.round(zoom * 100);

  // Center customizable controls (at most 10 center controls)
  const centerCommandIds = config.orderedCommandIds.filter((id) => !FIXED_SET.has(id)).slice(0, MAX_CENTER_CONTROLS);
  const shelfCommandIds = config.hiddenCommandIds.filter((id) => !FIXED_SET.has(id));
  const slotsLeft = Math.max(0, MAX_CENTER_CONTROLS - centerCommandIds.length);
  const canEdit = preferenceState !== 'loading' && preferenceState !== 'saving';
  const canAdd = canEdit && centerCommandIds.length < MAX_CENTER_CONTROLS;

  // On narrow screens (mobile): keep library.open in center if present
  const mobileCenterVisible = centerCommandIds.filter((id) => id === 'library.open');

  // All tools outside left-fixed (Select, Pan) for the 16B more popover
  const allNonStickyOrdered = config.orderedCommandIds.filter((id) => !FIXED_LEFT_SET.has(id));
  const allNonStickyHidden = config.hiddenCommandIds.filter((id) => !FIXED_LEFT_SET.has(id));
  const allNonSticky = [...allNonStickyOrdered, ...allNonStickyHidden];

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
        className={cn(
          'shrink-0 gap-1.5',
          compact
            ? 'w-full justify-start min-h-11 h-auto py-1 text-xs'
            : showLabels
              ? 'h-11 md:h-8 px-2.5 w-auto text-xs font-medium'
              : 'size-11 md:size-8'
        )}
        aria-label={def.label} aria-pressed={active || undefined}
        aria-description={state.enabled ? undefined : state.reason}
        title={state.enabled ? def.label : state.reason}
        disabled={!state.enabled}
        onClick={() => invoke(id)}>
        <Icon className="size-4" aria-hidden="true" />
        {(compact || showLabels) && (
          <span className={compact ? "flex flex-col items-start text-left" : "text-xs font-medium whitespace-nowrap"}>
            <span>{def.label.replace('…', '')}</span>
            {compact && !state.enabled && <span className="text-[10px] text-secondary-text">{state.reason}</span>}
          </span>
        )}
      </Button>
    );
  }

  function draggedCommand(event: React.DragEvent): DockCommandId | null {
    const id = event.dataTransfer.getData(DOCK_DRAG_MIME);
    return DOCK_COMMAND_IDS.find((candidate) => candidate === id) ?? null;
  }

  function addCenterCommand(id: DockCommandId, beforeId?: DockCommandId) {
    if (centerCommandIds.length >= MAX_CENTER_CONTROLS) return;
    const ordered = [...config.orderedCommandIds];
    const hidden = config.hiddenCommandIds.filter((c) => c !== id);
    if (beforeId) {
      const targetIdx = ordered.indexOf(beforeId);
      ordered.splice(targetIdx >= 0 ? targetIdx : ordered.length, 0, id);
    } else {
      const firstRightIdx = ordered.findIndex((c) => FIXED_RIGHT_SET.has(c));
      if (firstRightIdx >= 0) {
        ordered.splice(firstRightIdx, 0, id);
      } else {
        ordered.push(id);
      }
    }
    onConfigure({ orderedCommandIds: ordered, hiddenCommandIds: hidden });
  }

  function acceptDrop(event: React.DragEvent, beforeId?: DockCommandId) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const id = draggedCommand(event);
    if (!canEdit || !id) return;
    if (config.orderedCommandIds.includes(id)) {
      const next = insertDockCommand(config, id, beforeId);
      if (next !== config) onConfigure(next);
    } else {
      addCenterCommand(id, beforeId);
    }
  }

  return (
    <div data-testid="canvas-floating-dock" role="toolbar" aria-label="Canvas controls"
      className={cn(
        'absolute bottom-3 md:bottom-6 left-1/2 -translate-x-1/2 z-dock pointer-events-auto transition-all',
        customizing
          ? 'w-[min(calc(100vw-24px),840px)] rounded-[14px] border border-[#0B5C54] bg-background shadow-[0_0_0_4px_rgba(11,92,84,0.10),0_22px_46px_-18px_rgba(22,32,29,0.38)] overflow-hidden flex flex-col p-0'
          : 'max-w-[calc(100vw-24px)] flex items-center gap-1 rounded-dock border border-border bg-background p-1 shadow-floating',
        dropTarget === 'dock' && 'ring-2 ring-primary',
        className
      )}
      style={style}
      onDragOver={(event) => {
        if (!canEdit || !event.dataTransfer.types.includes(DOCK_DRAG_MIME)) return;
        event.preventDefault();
        setDropTarget('dock');
      }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(event) => acceptDrop(event)}>

      {customizing ? (
        /* 16C-4 Expanded dock: Grows a header and shelf in-place, shrinks back when done */
        <div data-testid="dock-customize-tray" className="flex flex-col w-full">
          {/* Header row */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-[#F4F8F6] border-b border-[#DDE8E4]">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-[#0B5C54]">
                <Settings2 className="size-3.5 text-[#0B5C54] shrink-0" aria-hidden="true" />
                <span>Customising toolbar</span>
              </div>
              <span className="font-mono text-[10px] text-[#6B8F87] tracking-wider uppercase select-none">
                {slotsLeft} {slotsLeft === 1 ? 'SLOT' : 'SLOTS'} LEFT · DRAG TO REORDER
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canEdit || JSON.stringify(config) === JSON.stringify(DEFAULT_DOCK_CONFIG)}
                onClick={onRestoreDefaults}
                aria-label="Restore defaults"
                className="h-6.5 px-2.5 text-xs font-medium text-[#0B5C54] hover:text-[#0B5C54] hover:bg-black/5"
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setCustomizing(false)}
                className="h-6.5 px-3 rounded-[7px] bg-[#0B5C54] text-[#F7F5F1] hover:bg-[#0B5C54]/90 text-xs font-semibold shadow-xs"
              >
                Done
              </Button>
            </div>
          </div>

          {/* Shelf row: Available tools */}
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[#EFEBE3] bg-background",
              dropTarget === 'shelf' && "bg-[#EAEFEC] ring-1 ring-inset ring-[#0B5C54]"
            )}
            onDragOver={(event) => {
              if (!canEdit || !event.dataTransfer.types.includes(DOCK_DRAG_MIME)) return;
              event.preventDefault();
              event.stopPropagation();
              setDropTarget('shelf');
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDropTarget(null);
              const id = draggedCommand(event);
              if (!canEdit || !id) return;
              if (config.orderedCommandIds.includes(id)) {
                onConfigure(changeDockConfig(config, id, 'hide'));
              } else {
                addCenterCommand(id);
              }
            }}
          >
            <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
              <span className="font-mono text-[9px] tracking-[0.12em] text-[#8A938F] font-semibold mr-1 select-none shrink-0 self-center">
                SHELF
              </span>
              {shelfCommandIds.length === 0 ? (
                <span className="text-xs text-secondary-text italic py-1">All commands in dock</span>
              ) : (
                shelfCommandIds.map((id) => {
                  const def = COMMAND_DEFINITIONS[id];
                  const Icon = ICONS[id];
                  return (
                    <div
                      key={id}
                      draggable={canEdit}
                      data-testid={`dock-available-${id}`}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData(DOCK_DRAG_MIME, id);
                      }}
                      onDragEnd={() => setDropTarget(null)}
                      className={cn(
                        "group flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-[#DCD7CD] bg-[#FBFAF7] hover:border-[#0B5C54]/60 cursor-grab active:cursor-grabbing select-none text-xs transition-colors shrink-0",
                        !canEdit && "opacity-60 cursor-not-allowed"
                      )}
                      title={`Drag into dock or click Add to show ${def.label}`}
                    >
                      <GripVertical className="size-3 text-[#8A938F] shrink-0" aria-hidden="true" />
                      <Icon className="size-3.5 text-[#16201D] shrink-0" aria-hidden="true" />
                      <span className="text-xs text-[#16201D] font-normal whitespace-nowrap">{def.label.replace('…', '')}</span>
                      <button
                        type="button"
                        className="size-5 rounded-[5px] flex items-center justify-center border border-[#A8CBC5] bg-[#EAEFEC] hover:bg-[#DFE8E4] active:bg-[#D3E0DB] text-[#0B5C54] hover:text-[#0A4E47] transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-1"
                        aria-label={`Add ${def.label}`}
                        title={`Add ${def.label}`}
                        disabled={!canAdd}
                        onClick={(event) => {
                          event.stopPropagation();
                          addCenterCommand(id);
                        }}
                      >
                        <Plus className="size-3 stroke-[2.5]" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex items-center gap-2 pl-3 border-l border-[#EFEBE3] shrink-0 self-center ml-auto">
              <label htmlFor="dock-customize-labels-toggle" className="text-xs text-[#4A544F] cursor-pointer select-none font-medium">
                Labels
              </label>
              <Switch
                id="dock-customize-labels-toggle"
                data-testid="dock-labels-toggle"
                checked={showLabels}
                onCheckedChange={setShowLabels}
                className="scale-75 origin-right cursor-pointer"
                aria-label="Toggle command labels"
              />
            </div>
          </div>

          {/* Bottom row: 3 sections (Left fixed, Center customizable, Right fixed) */}
          <div className="flex items-center justify-between gap-2 p-2 bg-background w-full">
            {/* Left fixed controls (disabled & always visible) */}
            <div className="flex items-center gap-1 opacity-50 shrink-0 select-none pointer-events-none">
              <div className={cn("flex items-center gap-1.5 h-8 px-2 rounded-lg border border-[#DCD7CD] bg-[#FBFAF7] text-xs text-[#16201D]", !showLabels && "w-8 justify-center px-0")}>
                <MousePointer className="size-3.5 text-[#16201D] shrink-0" />
                {showLabels && <span className="font-medium">Select</span>}
              </div>
              <div className={cn("flex items-center gap-1.5 h-8 px-2 rounded-lg border border-[#DCD7CD] bg-[#FBFAF7] text-xs text-[#16201D]", !showLabels && "w-8 justify-center px-0")}>
                <Hand className="size-3.5 text-[#16201D] shrink-0" />
                {showLabels && <span className="font-medium">Pan</span>}
              </div>
            </div>

            <div className="w-px h-5 bg-[#EFEBE3] shrink-0" />

            {/* Center customizable controls cluster: wraps internally without affecting left and right controls */}
            <div
              className={cn(
                "flex flex-wrap items-center gap-1.5 p-1 rounded-[10px] bg-[#F4F8F6] border border-[#A8CBC5] transition-colors flex-1 min-w-0",
                dropTarget === 'cluster' && "ring-2 ring-[#0B5C54]"
              )}
              onDragOver={(event) => {
                if (!canEdit || !event.dataTransfer.types.includes(DOCK_DRAG_MIME)) return;
                event.preventDefault();
                event.stopPropagation();
                setDropTarget('cluster');
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => acceptDrop(event)}
            >
              {centerCommandIds.map((id, index) => {
                const def = COMMAND_DEFINITIONS[id];
                const state = availability(id, context);
                const Icon = ICONS[id];
                const isDropTarget = dropTarget === id;
                return (
                  <React.Fragment key={id}>
                    {isDropTarget && (
                      <div className="flex items-center justify-center h-8 px-3 rounded-lg border border-dashed border-[#0B5C54] bg-[#EAEFEC] text-[#0B5C54] font-mono text-[9.5px] tracking-wider select-none shrink-0 animate-in fade-in duration-150">
                        DROP HERE
                      </div>
                    )}
                    <div
                      draggable={canEdit}
                      data-testid={`dock-customize-${id}`}
                      className={cn(
                        "flex items-center gap-1 h-8 px-2 rounded-lg border bg-background text-xs select-none transition-all shrink-0",
                        isDropTarget ? "border-[#0B5C54] ring-1 ring-[#0B5C54]" : "border-[#DCD7CD]",
                        !canEdit && "opacity-60 cursor-not-allowed"
                      )}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData(DOCK_DRAG_MIME, id);
                      }}
                      onDragEnd={() => setDropTarget(null)}
                      onDragOver={(event) => {
                        if (!canEdit || !event.dataTransfer.types.includes(DOCK_DRAG_MIME)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setDropTarget(id);
                      }}
                      onDrop={(event) => acceptDrop(event, id)}
                    >
                      <GripVertical className="size-3 text-secondary-text shrink-0 cursor-grab active:cursor-grabbing" aria-hidden="true" />
                      <button
                        type="button"
                        data-testid={TEST_IDS[id] ?? `dock-${id}`}
                        aria-label={def.label}
                        className="flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary transition-colors cursor-pointer"
                        disabled={!state.enabled}
                        title={state.enabled ? def.label : state.reason}
                        onClick={() => invoke(id)}
                      >
                        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                        {showLabels && <span className="whitespace-nowrap">{def.label.replace('…', '')}</span>}
                      </button>
                      <button
                        type="button"
                        className="size-5 rounded-[5px] flex items-center justify-center border border-[#E0C9B6] bg-[#FBF1EA] hover:bg-[#F5E5DC] active:bg-[#ECD0C0] text-[#B4674A] hover:text-[#8E5038] transition-colors shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-0.5"
                        aria-label={`Hide ${def.label}`}
                        title={`Hide ${def.label}`}
                        disabled={!canEdit}
                        onClick={(event) => {
                          event.stopPropagation();
                          onConfigure(changeDockConfig(config, id, 'hide'));
                        }}
                      >
                        <X className="size-3 stroke-[2.5]" aria-hidden="true" />
                      </button>
                    </div>
                  </React.Fragment>
                );
              })}

              {(dropTarget === 'dock' || dropTarget === 'cluster') && (
                <div className="flex items-center justify-center h-8 px-3 rounded-lg border border-dashed border-[#0B5C54] bg-[#EAEFEC] text-[#0B5C54] font-mono text-[9.5px] tracking-wider select-none shrink-0 animate-in fade-in duration-150">
                  DROP HERE
                </div>
              )}

              {slotsLeft > 0 && (
                <div
                  className="flex items-center justify-center size-8 rounded-lg border border-dashed border-[#A8CBC5] text-[#6B8F87] text-sm shrink-0 hover:border-[#0B5C54]/60 hover:text-foreground cursor-pointer transition-colors"
                  title="Empty slot — drag a command from the shelf"
                  onDragOver={(event) => {
                    if (!canEdit || !event.dataTransfer.types.includes(DOCK_DRAG_MIME)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setDropTarget('cluster');
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(event) => acceptDrop(event)}
                >
                  ＋
                </div>
              )}
            </div>

            <div className="w-px h-5 bg-[#EFEBE3] shrink-0" />

            {/* Right fixed controls (disabled & always visible) */}
            <div className="flex items-center gap-1.5 opacity-50 shrink-0 select-none pointer-events-none">
              <div className={cn("flex items-center gap-1.5 h-8 px-2 rounded-lg border border-[#DCD7CD] bg-[#FBFAF7] text-xs text-[#16201D]", !showLabels && "w-8 justify-center px-0")}>
                <MoreHorizontal className="size-3.5 text-[#16201D] shrink-0" />
                {showLabels && <span className="font-medium">More</span>}
              </div>
              <div className="w-px h-5 bg-[#EFEBE3] shrink-0" />
              <div className="size-8 flex items-center justify-center rounded-lg border border-[#DCD7CD] bg-[#FBFAF7] text-xs text-[#4A544F]">
                <Minus className="size-3.5" />
              </div>
              <span className="font-mono text-xs tabular-nums text-[#4A544F] min-w-11 text-center shrink-0">
                {zoomPercent}%
              </span>
              <div className="size-8 flex items-center justify-center rounded-lg border border-[#DCD7CD] bg-[#FBFAF7] text-xs text-[#4A544F]">
                <Plus className="size-3.5" />
              </div>
              <div className="size-8 flex items-center justify-center rounded-lg border border-[#DCD7CD] bg-[#FBFAF7] text-xs text-[#4A544F]">
                <Maximize2 className="size-3.5" />
              </div>
            </div>
          </div>

          {preferenceState === 'failed' && (
            <p role="alert" className="text-xs text-risk-text px-3 py-1.5 bg-risk-surface border-t border-risk-border">
              Dock changes could not be saved.
            </p>
          )}
        </div>
      ) : (
        /* Resting dock: 3 sections (Left fixed, Center customizable, Right fixed) */
        <div className="flex items-center gap-1 max-w-full">
          {/* Left fixed controls */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              type="button"
              variant={dragMode === 'select' ? 'tint' : 'ghost'}
              size={showLabels ? 'sm' : 'icon'}
              data-testid="dock-select-btn"
              onClick={() => onInvoke('canvas.select-tool')}
              className={cn("shrink-0", showLabels ? "h-11 md:h-8 px-2.5 w-auto gap-1.5 text-xs font-medium" : "size-11 md:size-8")}
              aria-label="Select tool"
              title="Select tool"
            >
              <MousePointer className="size-4" aria-hidden="true" />
              {showLabels && <span>Select</span>}
            </Button>
            <Button
              type="button"
              variant={dragMode === 'pan' ? 'tint' : 'ghost'}
              size={showLabels ? 'sm' : 'icon'}
              data-testid="dock-pan-btn"
              onClick={() => onInvoke('canvas.pan-tool')}
              className={cn("shrink-0", showLabels ? "h-11 md:h-8 px-2.5 w-auto gap-1.5 text-xs font-medium" : "size-11 md:size-8")}
              aria-label="Pan tool"
              title="Pan tool"
            >
              <Hand className="size-4" aria-hidden="true" />
              {showLabels && <span>Pan</span>}
            </Button>
          </div>

          <div className="w-px h-5 bg-[#EFEBE3] shrink-0 mx-0.5" />

          {/* Center customizable controls: wraps without affecting left and right controls */}
          <div className="flex flex-wrap items-center justify-center gap-0.5 flex-1 min-w-0 max-w-[calc(100vw-360px)]">
            {(narrow ? mobileCenterVisible : centerCommandIds).map((id) => commandButton(id))}
          </div>

          <div className="w-px h-5 bg-[#EFEBE3] shrink-0 mx-0.5" />

          {/* Right fixed controls */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant={moreOpen ? 'tint' : 'ghost'}
                  size={showLabels ? 'sm' : 'icon'}
                  data-testid="dock-more-btn"
                  aria-label="More dock actions"
                  aria-expanded={moreOpen}
                  className={cn("shrink-0", showLabels ? "h-11 md:h-8 px-2.5 w-auto gap-1.5 text-xs font-medium" : "size-11 md:size-8")}
                >
                  <MoreHorizontal className="size-4" />
                  {showLabels && <span>More</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                className="w-[min(296px,calc(100vw-24px))] p-1.5 rounded-[12px] border border-[#DCD7CD] bg-background shadow-[0_26px_48px_-18px_rgba(22,32,29,0.36)] overflow-hidden flex flex-col max-h-[min(580px,calc(100vh-100px))]"
                onCloseAutoFocus={(event) => { if (textAction) event.preventDefault(); }}
              >
                <div data-testid="dock-more-popover" className="flex flex-col">
                  {/* 16B Header */}
                  <div className="flex items-center justify-between px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8A938F] select-none shrink-0">
                    <span>MORE TOOLS</span>
                    <span>PIN TO DOCK</span>
                  </div>

                  {/* Non-sticky options with pin buttons */}
                  <div className="flex flex-col gap-0.5 overflow-y-auto px-0.5 py-0.5 max-h-[min(340px,calc(100vh-300px))]">
                    {allNonSticky.map((id) => {
                      const isPinned = config.orderedCommandIds.includes(id);
                      const def = COMMAND_DEFINITIONS[id];
                      const state = availability(id, context);
                      const Icon = ICONS[id];
                      const shortcutText = def.shortcut ? formatShortcut(def.shortcut, IS_MAC) : null;
                      return (
                        <div
                          key={id}
                          className={cn(
                            "group flex items-center justify-between gap-1.5 px-2 py-0.5 rounded-[7px] text-[13px] transition-colors",
                            isPinned ? "bg-[#EAEFEC] text-[#0B5C54]" : "text-foreground hover:bg-[#F4F8F6]"
                          )}
                        >
                          <button
                            type="button"
                            data-testid={`dock-overflow-${id}`}
                            aria-label={def.label}
                            disabled={!state.enabled}
                            title={state.enabled ? def.label : state.reason}
                            onClick={() => invoke(id)}
                            className={cn(
                              "flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                              narrow ? "min-h-11 py-1" : "min-h-7.5 py-1"
                            )}
                          >
                            <Icon
                              className={cn("size-3.5 shrink-0", isPinned ? "text-[#0B5C54]" : "text-[#6B7671]")}
                              aria-hidden="true"
                            />
                            <span className={cn("truncate text-[13px]", isPinned ? "font-semibold text-[#0B5C54]" : "font-normal text-foreground")}>
                              {def.label.replace('…', '')}
                            </span>
                            {shortcutText && (
                              <span className={cn("ml-auto font-mono text-[10px] shrink-0 mr-1", isPinned ? "text-[#6B8F87]" : "text-[#8A938F]")}>
                                {shortcutText}
                              </span>
                            )}
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            data-testid={`dock-pin-${id}`}
                            aria-label={isPinned ? `Unpin ${def.label} from dock` : `Pin ${def.label} to dock`}
                            title={isPinned ? "Unpin from dock" : centerCommandIds.length >= MAX_CENTER_CONTROLS ? "Center dock is full (max 10 controls)" : "Pin to dock"}
                            disabled={!canEdit || (!isPinned && centerCommandIds.length >= MAX_CENTER_CONTROLS)}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isPinned) {
                                onConfigure(changeDockConfig(config, id, 'hide'));
                              } else {
                                addCenterCommand(id);
                              }
                            }}
                            className={cn(
                              "size-7 p-0 shrink-0 rounded transition-colors",
                              isPinned
                                ? "text-[#0B5C54] hover:bg-[#0B5C54]/15 hover:text-[#0B5C54]"
                                : "text-[#A3ABA6] hover:text-[#0B5C54] hover:bg-black/5"
                            )}
                          >
                            <Pin className={cn("size-3.5", isPinned ? "fill-[#0B5C54] rotate-45" : "text-[#A3ABA6]")} />
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  {/* 16B Divider */}
                  <div className="h-px bg-[#EFEBE3] my-1 shrink-0" />

                  {/* 16B Toggleable actions */}
                  <div className="flex flex-col gap-0.5 px-0.5 shrink-0">
                    <div className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-[7px] text-[13px] hover:bg-[#F4F8F6] transition-colors">
                      <div className="flex items-center gap-2.5">
                        <Hash className="size-3.5 text-[#6B7671] shrink-0" aria-hidden="true" />
                        <label htmlFor="dock-more-snap-grid-toggle" className="font-medium text-[13px] text-[#16201D] cursor-pointer select-none">
                          Snap to grid
                        </label>
                      </div>
                      <Switch
                        id="dock-more-snap-grid-toggle"
                        data-testid="dock-snap-grid-toggle"
                        checked={activeSnapToGrid}
                        onCheckedChange={handleToggleSnap}
                        className="scale-75 origin-right"
                        aria-label="Toggle snap to grid"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-[7px] text-[13px] hover:bg-[#F4F8F6] transition-colors">
                      <div className="flex items-center gap-2.5">
                        <Map className="size-3.5 text-[#6B7671] shrink-0" aria-hidden="true" />
                        <label htmlFor="dock-more-minimap-toggle" className="font-medium text-[13px] text-[#16201D] cursor-pointer select-none">
                          Minimap
                        </label>
                      </div>
                      <Switch
                        id="dock-more-minimap-toggle"
                        data-testid="dock-minimap-toggle"
                        checked={activeShowMinimap}
                        onCheckedChange={handleToggleMinimap}
                        className="scale-75 origin-right"
                        aria-label="Toggle minimap"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-[7px] text-[13px] hover:bg-[#F4F8F6] transition-colors">
                      <div className="flex items-center gap-2.5">
                        <Type className="size-3.5 text-[#6B7671] shrink-0" aria-hidden="true" />
                        <label htmlFor="dock-more-labels-toggle" className="font-medium text-[13px] text-[#16201D] cursor-pointer select-none">
                          Command labels
                        </label>
                      </div>
                      <Switch
                        id="dock-more-labels-toggle"
                        data-testid="dock-more-labels-toggle"
                        checked={showLabels}
                        onCheckedChange={setShowLabels}
                        className="scale-75 origin-right"
                        aria-label="Toggle command labels"
                      />
                    </div>
                  </div>

                  {/* 16B Divider */}
                  <div className="h-px bg-[#EFEBE3] my-1 shrink-0" />

                  {/* 16B Footer actions */}
                  <div className="flex flex-col gap-0.5 px-0.5 shrink-0">
                    <button
                      type="button"
                      aria-label="Customize dock…"
                      onClick={() => {
                        setMoreOpen(false);
                        setCustomizing(true);
                      }}
                      className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-[7px] text-[13px] font-medium text-[#0B5C54] hover:bg-[#0B5C54]/10 transition-colors cursor-pointer text-left"
                    >
                      <Settings2 className="size-3.5 text-[#0B5C54] shrink-0" aria-hidden="true" />
                      <span>Customise toolbar…</span>
                    </button>

                    <button
                      type="button"
                      disabled={!canEdit || JSON.stringify(config) === JSON.stringify(DEFAULT_DOCK_CONFIG)}
                      aria-label="Restore defaults"
                      onClick={() => {
                        setMoreOpen(false);
                        onRestoreDefaults();
                      }}
                      className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-[7px] text-[13px] font-medium text-[#6B7671] hover:text-[#16201D] hover:bg-black/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer text-left"
                    >
                      <RotateCcw className="size-3.5 text-[#6B7671] shrink-0" aria-hidden="true" />
                      <span>Restore defaults</span>
                    </button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <div className="w-px h-5 bg-[#EFEBE3] shrink-0 mx-0.5" />

            {/* Zoom controls */}
            <div className="flex items-center gap-0.5 shrink-0">
              {!narrow && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  data-testid="dock-zoom-out-btn"
                  aria-label="Zoom out"
                  title="Zoom out"
                  className="size-8 shrink-0"
                  onClick={() => onInvoke('canvas.zoom-out')}
                >
                  <Minus className="size-4" />
                </Button>
              )}
              <span
                data-testid="dock-zoom-value"
                aria-live="polite"
                className="inline-block w-11 text-center font-mono text-xs tabular-nums text-secondary-text shrink-0"
              >
                {zoomPercent}%
              </span>
              {!narrow && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid="dock-zoom-in-btn"
                    aria-label="Zoom in"
                    title="Zoom in"
                    className="size-8 shrink-0"
                    onClick={() => onInvoke('canvas.zoom-in')}
                  >
                    <Plus className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid="dock-fit-view-btn"
                    aria-label="Fit view"
                    title="Fit view"
                    className="size-8 shrink-0"
                    onClick={() => onInvoke('canvas.fit')}
                  >
                    <Maximize2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <Popover open={textAction !== null} onOpenChange={(open) => { if (!open) setTextAction(null); }}>
        <PopoverAnchor asChild><span className="absolute left-1/2 top-0" /></PopoverAnchor>
        <PopoverContent side="top" align="center" className="w-72 p-0 overflow-hidden rounded-popover border border-border bg-background shadow-popover" data-testid={textAction === 'canvas.add-note' ? 'dock-note-popover' : 'dock-group-popover'}>
          <form onSubmit={(event) => { event.preventDefault(); void submitText(); }}>
            <div className="px-3 py-2 bg-panel border-b border-hairline font-mono text-meta font-medium text-secondary-text uppercase">
              {textAction === 'canvas.add-note' ? 'New canvas note' : 'New subsystem group'}
            </div>
            <div className="p-3 bg-background">
              <label htmlFor="dock-text-input" className="block text-xs font-medium text-ink mb-1.5">
                {textAction === 'canvas.add-note' ? 'Note text' : 'Group name'}
              </label>
              <Input id="dock-text-input" data-testid={textAction === 'canvas.add-note' ? 'dock-note-input' : 'dock-group-input'}
                autoFocus value={textValue} onChange={(event) => { setTextValue(event.target.value); setTextError(null); }} />
              {textError && <p role="alert" className="mt-1.5 text-xs text-risk-text">{textError}</p>}
            </div>
            <div className="px-3 py-2 bg-panel border-t border-hairline flex justify-end">
              <Button type="submit" size="sm" variant="tint" disabled={!textValue.trim()}>
                {textAction === 'canvas.add-note' ? 'Add note' : 'Group'}
              </Button>
            </div>
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

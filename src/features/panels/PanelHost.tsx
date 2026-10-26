import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { DockColumn, type DockedPanelItem } from './DockColumn';
import { FloatingPanel } from './FloatingPanel';
import { panelContentClass } from './panelContentClass';
import { PanelRail, type PanelRailItemConfig } from './PanelRail';
import { DropTargets } from './DropTargets';
import { PanelHeader } from './PanelHeader';
import { PanelCommandsContext, type PanelCommandRoutes } from './panelCommands';
import { computeDropTarget } from './geometry';
import { trackPanelGesture } from './pointerGesture';
import {
  clampFloatRect,
  effectiveLayout,
  computeEffectiveSideWidth,
  PANEL_IDS,
  type PanelId,
  type WorkspacePanelState,
  type WorkspacePanelAction,
  type Viewport,
} from '@/features/workspace/panels';

export interface PanelHostProps {
  state: WorkspacePanelState;
  dispatch: (action: WorkspacePanelAction) => void;
  /**
   * Header-menu / rail routes into the command registry (place, collapse,
   * expand, reset width, close). Gestures still use `dispatch` directly.
   */
  commands?: PanelCommandRoutes;
  renderPanel: (panelId: PanelId) => React.ReactNode;
  canvas: React.ReactNode;
  panelTitles?: Partial<Record<PanelId, string>>;
  panelIcons?: Partial<Record<PanelId, React.ComponentType<{ className?: string }>>>;
  panelBadges?: Partial<Record<PanelId, React.ReactNode>>;
  unseenChanges?: Partial<Record<PanelId, boolean>>;
  viewport?: Viewport;
  className?: string;
  // Dragging override for preview harness / tests
  isDraggingPreview?: boolean;
  draggingPanelIdPreview?: PanelId | null;
  activeDropTargetPreview?: 'left' | 'right' | null;
  activePeekPanelPreview?: PanelId | null;
}

/** Where focus goes when an overlay panel closes: the control that opens that panel. */
const OVERLAY_RETURN_FOCUS: Record<PanelId, string> = {
  history: 'topbar-history-btn',
  library: 'dock-component-btn',
  inspector: 'canvas-container',
  comments: 'topbar-agents-btn',
};

const DEFAULT_TITLES: Record<PanelId, string> = {
  history: 'History',
  library: 'Library',
  inspector: 'Configuration',
  comments: 'Comments',
};

export const PanelHost: React.FC<PanelHostProps> = ({
  state,
  dispatch,
  commands,
  renderPanel,
  canvas,
  panelTitles = {},
  panelIcons = {},
  panelBadges = {},
  unseenChanges = {},
  viewport,
  className,
  isDraggingPreview = false,
  draggingPanelIdPreview = null,
  activeDropTargetPreview = null,
  activePeekPanelPreview = null,
}) => {
  const currentViewport = viewport || state.viewport;
  const layout = effectiveLayout({ ...state, viewport: currentViewport });

  const getTitle = (id: PanelId) => panelTitles[id] || DEFAULT_TITLES[id] || id;

  // Active dragging state
  const [internalDragging, setInternalDragging] = React.useState(false);
  const [draggingPanelId, setDraggingPanelId] = React.useState<PanelId | null>(null);
  const [activeDropTarget, setActiveDropTarget] = React.useState<'left' | 'right' | null>(null);
  const [dragPointer, setDragPointer] = React.useState<{ x: number; y: number } | null>(null);

  const isDragging = isDraggingPreview || internalDragging;
  const currentDraggingPanel = draggingPanelIdPreview || draggingPanelId;
  const currentDropTarget = activeDropTargetPreview !== null ? activeDropTargetPreview : activeDropTarget;

  // Drag start handler
  const handlePanelDragStart = (panelId: PanelId, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setInternalDragging(true);
    setDraggingPanelId(panelId);
    setDragPointer({ x: e.clientX, y: e.clientY });

    const dropTargetAt = (clientX: number) =>
      computeDropTarget(clientX, currentViewport.width, state.sideWidths);
    setActiveDropTarget(dropTargetAt(e.clientX));

    trackPanelGesture(dispatch, `drag-panel-${panelId}`, {
      onMove: (moveEvt) => {
        setDragPointer({ x: moveEvt.clientX, y: moveEvt.clientY });
        setActiveDropTarget(dropTargetAt(moveEvt.clientX));
      },
      onSettle: () => {
        setInternalDragging(false);
        setDraggingPanelId(null);
        setActiveDropTarget(null);
        setDragPointer(null);
      },
      onUp: (upEvt) => {
        const dropTarget = dropTargetAt(upEvt.clientX);
        if (dropTarget === 'left' || dropTarget === 'right') {
          dispatch({ type: 'PLACE', panel: panelId, placement: dropTarget, index: 0 });
          return;
        }
        // Dropped into canvas space
        const currentPref = state.panels[panelId];
        if (currentPref.placement === 'floating') {
          dispatch({
            type: 'RESIZE_FLOAT',
            panel: panelId,
            rect: {
              ...currentPref.floatRect,
              x: Math.max(16, upEvt.clientX - 180),
              y: Math.max(54, upEvt.clientY - 20),
            },
          });
        } else {
          // Transitioned from docked to floating
          dispatch({ type: 'PLACE', panel: panelId, placement: 'floating', index: 0 });
        }
      },
    });
  };

  // Partition panels by effective mode
  const dockedLeftItems: DockedPanelItem[] = [];
  const dockedRightItems: DockedPanelItem[] = [];
  const floatingPanelIds: PanelId[] = [];
  const leftCollapsedItems: PanelRailItemConfig[] = [];
  const rightCollapsedItems: PanelRailItemConfig[] = [];
  const overlayPanelIds: PanelId[] = [];

  for (const id of PANEL_IDS) {
    const mode = layout.panels[id];
    const pref = state.panels[id];

    if (mode === 'docked-left') {
      dockedLeftItems.push({
        id,
        title: getTitle(id),
        badge: panelBadges[id],
        stackOrder: pref.stackOrder,
      });
    } else if (mode === 'docked-right') {
      dockedRightItems.push({
        id,
        title: getTitle(id),
        badge: panelBadges[id],
        stackOrder: pref.stackOrder,
      });
    } else if (mode === 'floating') {
      floatingPanelIds.push(id);
    } else if (mode === 'collapsed') {
      const railConfig: PanelRailItemConfig = {
        id,
        title: getTitle(id),
        icon: panelIcons[id],
        hasUnseenChanges: unseenChanges[id] ?? false,
      };
      if (pref.placement === 'right') {
        rightCollapsedItems.push(railConfig);
      } else {
        leftCollapsedItems.push(railConfig);
      }
    } else if (mode === 'overlay') {
      overlayPanelIds.push(id);
    }
  }

  return (
    <PanelCommandsContext.Provider value={commands ?? null}>
    <div
      data-slot="panel-host"
      className={cn(
        'relative flex w-full h-full overflow-hidden select-none bg-background text-foreground',
        className
      )}
    >
      {/* 1. Left Collapsed Rail */}
      {leftCollapsedItems.length > 0 && (
        <PanelRail
          side="left"
          collapsedPanels={leftCollapsedItems}
          dispatch={dispatch}
          renderPanel={renderPanel}
          activePeekPanel={activePeekPanelPreview}
        />
      )}

      {/* 2. Left Dock */}
      {dockedLeftItems.length > 0 && (
        <DockColumn
          side="left"
          width={computeEffectiveSideWidth(
            'left',
            { ...state, viewport: currentViewport },
            dockedLeftItems.map((p) => p.id)
          )}
          panels={dockedLeftItems}
          dispatch={dispatch}
          renderPanel={renderPanel}
          onPanelDragStart={handlePanelDragStart}
        />
      )}

      {/* 3. Center Canvas Slot (STABLE: never unmounts across layout changes) */}
      <div
        key="panel-canvas-slot-stable"
        data-slot="panel-canvas-slot"
        className="relative flex-1 h-[calc(100%+var(--topbar-inset,0px))] min-w-0 overflow-hidden -mt-[var(--topbar-inset,0px)]"
      >
        {canvas}

        {/* Drag Drop Targets Overlay */}
        {isDragging && (
          <DropTargets
            activeTarget={currentDropTarget}
            sideWidths={state.sideWidths}
          />
        )}
      </div>

      {/* 4. Right Dock */}
      {dockedRightItems.length > 0 && (
        <DockColumn
          side="right"
          width={computeEffectiveSideWidth(
            'right',
            { ...state, viewport: currentViewport },
            dockedRightItems.map((p) => p.id)
          )}
          panels={dockedRightItems}
          dispatch={dispatch}
          renderPanel={renderPanel}
          onPanelDragStart={handlePanelDragStart}
        />
      )}

      {/* 5. Right Collapsed Rail */}
      {rightCollapsedItems.length > 0 && (
        <PanelRail
          side="right"
          collapsedPanels={rightCollapsedItems}
          dispatch={dispatch}
          renderPanel={renderPanel}
          activePeekPanel={activePeekPanelPreview}
        />
      )}

      {/* 6. Floating Panels */}
      {floatingPanelIds.map((id) => {
        const pref = state.panels[id];
        return (
          <FloatingPanel
            key={id}
            panelId={id}
            title={getTitle(id)}
            badge={panelBadges[id]}
            floatRect={clampFloatRect(pref.floatRect, currentViewport)}
            viewport={currentViewport}
            isFocused={state.focusedPanel === id}
            dispatch={dispatch}
            renderPanel={renderPanel}
            onDragStart={handlePanelDragStart}
          />
        );
      })}

      {/* 7. Modal Overlay Panels for Mobile / Narrow screens (< 768px / 768-1199px) */}
      {/* A modal dialog: focus is trapped inside, Escape and a press on the backdrop close
          it, and focus returns to the control that opens the panel (standard modal behaviour). */}
      {overlayPanelIds.map((id) => (
        <DialogPrimitive.Root
          key={`overlay-${id}`}
          open
          onOpenChange={(open) => { if (!open) dispatch({ type: 'CLOSE', panel: id }); }}
        >
        <div
          data-slot="panel-modal-overlay"
          data-panel-id={id}
          className="fixed inset-0 z-modal flex flex-col justify-end bg-black/40 backdrop-blur-xs animate-in fade-in-0 sm:justify-center sm:items-center"
        >
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              // Land on the panel header (its landmark), not the first control inside.
              e.preventDefault();
              document.querySelector<HTMLElement>(`[data-slot="panel-modal-overlay"][data-panel-id="${id}"] [data-slot="panel-header"]`)?.focus();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const active = document.activeElement;
              if (active && active !== document.body) return;
              const opener = document.querySelector<HTMLElement>(`[data-testid="${OVERLAY_RETURN_FOCUS[id]}"]`);
              // History's top-bar button is hidden on the narrowest phones; Quick options opens it there.
              const target = opener?.getClientRects().length
                ? opener
                : document.querySelector<HTMLElement>('[data-testid="topbar-quick-options-btn"]');
              target?.focus();
            }}
            className="w-full sm:w-[480px] max-h-[85vh] bg-panel border border-border rounded-t-2xl sm:rounded-2xl shadow-floating flex flex-col overflow-hidden outline-none"
          >
            <DialogPrimitive.Title className="sr-only">{getTitle(id)}</DialogPrimitive.Title>
            <PanelHeader
              panelId={id}
              title={getTitle(id)}
              badge={panelBadges[id]}
              placement={state.panels[id].placement}
              mode="overlay"
              currentWidth={320}
              dispatch={dispatch}
            />
            <div className={panelContentClass(id, 'bg-transparent')}>
              {renderPanel(id)}
            </div>
          </DialogPrimitive.Content>
        </div>
        </DialogPrimitive.Root>
      ))}

      {/* 8. Dragging Ghost Preview */}
      {isDragging && currentDraggingPanel && dragPointer && (
        <div
          data-slot="dragging-ghost-panel"
          style={{
            position: 'fixed',
            left: `${dragPointer.x - 140}px`,
            top: `${dragPointer.y - 20}px`,
            width: '320px',
            pointerEvents: 'none',
            zIndex: 60,
            transform: 'rotate(-1.5deg)',
          }}
          className="bg-panel rounded-2xl border-2 border-primary shadow-2xl opacity-90 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border bg-sunken font-medium text-ui text-foreground flex items-center justify-between">
            <span>{getTitle(currentDraggingPanel)}</span>
            <span className="font-mono text-xs text-primary font-semibold">Dragging…</span>
          </div>
          <div className="p-3 text-xs text-secondary-text max-h-32 overflow-hidden opacity-60">
            {renderPanel(currentDraggingPanel)}
          </div>
        </div>
      )}
    </div>
    </PanelCommandsContext.Provider>
  );
};

import * as React from 'react';
import { cn } from '@/lib/utils';
import { DockColumn, type DockedPanelItem } from './DockColumn';
import { FloatingPanel } from './FloatingPanel';
import { PanelRail, type PanelRailItemConfig } from './PanelRail';
import { DropTargets } from './DropTargets';
import { PanelHeader } from './PanelHeader';
import { computeDropTarget } from './geometry';
import {
  clampFloatRect,
  effectiveLayout,
  type PanelId,
  type WorkspacePanelState,
  type WorkspacePanelAction,
  type Viewport,
} from '@/features/workspace/panels';

export interface PanelHostProps {
  state: WorkspacePanelState;
  dispatch: (action: WorkspacePanelAction) => void;
  renderPanel: (panelId: PanelId) => React.ReactNode;
  canvas: React.ReactNode;
  panelTitles?: Partial<Record<PanelId, string>>;
  panelIcons?: Partial<Record<PanelId, React.ComponentType<{ className?: string }>>>;
  panelBadges?: Partial<Record<PanelId, React.ReactNode>>;
  unseenChanges?: Partial<Record<PanelId, boolean>>;
  viewport?: Viewport;
  className?: string;
  // Dragging override for preview harness / tests (23D)
  isDraggingPreview?: boolean;
  draggingPanelIdPreview?: PanelId | null;
  activeDropTargetPreview?: 'left' | 'right' | null;
  activePeekPanelPreview?: PanelId | null;
}

const DEFAULT_TITLES: Record<PanelId, string> = {
  history: 'History',
  library: 'Library',
};

export const PanelHost: React.FC<PanelHostProps> = ({
  state,
  dispatch,
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

    dispatch({ type: 'BEGIN_GESTURE', kind: `drag-panel-${panelId}` });
    setInternalDragging(true);
    setDraggingPanelId(panelId);
    setDragPointer({ x: e.clientX, y: e.clientY });

    const initialTarget = computeDropTarget(e.clientX, currentViewport.width, state.sideWidths);
    setActiveDropTarget(initialTarget);

    const onPointerMove = (moveEvt: PointerEvent) => {
      setDragPointer({ x: moveEvt.clientX, y: moveEvt.clientY });
      const target = computeDropTarget(moveEvt.clientX, currentViewport.width, state.sideWidths);
      setActiveDropTarget(target);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      setInternalDragging(false);
      setDraggingPanelId(null);
      setActiveDropTarget(null);
      setDragPointer(null);
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      const dropTarget = computeDropTarget(upEvt.clientX, currentViewport.width, state.sideWidths);
      cleanup();

      if (dropTarget === 'left') {
        dispatch({ type: 'PLACE', panel: panelId, placement: 'left', index: 0 });
        dispatch({ type: 'COMMIT_GESTURE' });
      } else if (dropTarget === 'right') {
        dispatch({ type: 'PLACE', panel: panelId, placement: 'right', index: 0 });
        dispatch({ type: 'COMMIT_GESTURE' });
      } else {
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
          dispatch({ type: 'COMMIT_GESTURE' });
        } else {
          // Transitioned from docked to floating
          dispatch({ type: 'PLACE', panel: panelId, placement: 'floating', index: 0 });
          dispatch({ type: 'COMMIT_GESTURE' });
        }
      }
    };

    const onPointerCancel = () => {
      cleanup();
      dispatch({ type: 'CANCEL_GESTURE' });
    };

    const onKeyDown = (keyEvt: KeyboardEvent) => {
      if (keyEvt.key === 'Escape') {
        cleanup();
        dispatch({ type: 'CANCEL_GESTURE' });
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
  };

  // Partition panels by effective mode
  const dockedLeftItems: DockedPanelItem[] = [];
  const dockedRightItems: DockedPanelItem[] = [];
  const floatingPanelIds: PanelId[] = [];
  const leftCollapsedItems: PanelRailItemConfig[] = [];
  const rightCollapsedItems: PanelRailItemConfig[] = [];
  const overlayPanelIds: PanelId[] = [];

  for (const id of ['library', 'history'] as PanelId[]) {
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
    <div
      data-slot="panel-host"
      className={cn(
        'relative flex w-full h-full overflow-hidden select-none bg-background text-foreground',
        className
      )}
    >
      {/* 1. Left Collapsed Rail (23F, 23G) */}
      {leftCollapsedItems.length > 0 && (
        <PanelRail
          side="left"
          collapsedPanels={leftCollapsedItems}
          dispatch={dispatch}
          renderPanel={renderPanel}
          activePeekPanel={activePeekPanelPreview}
        />
      )}

      {/* 2. Left Dock Column (23B) */}
      {dockedLeftItems.length > 0 && (
        <DockColumn
          side="left"
          width={state.sideWidths.left}
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
        className="relative flex-1 h-full min-w-0 overflow-hidden"
      >
        {canvas}

        {/* Drag Drop Targets Overlay (23D) */}
        {isDragging && (
          <DropTargets
            activeTarget={currentDropTarget}
            sideWidths={state.sideWidths}
            viewport={currentViewport}
          />
        )}
      </div>

      {/* 4. Right Dock Column (23A, 23E) */}
      {dockedRightItems.length > 0 && (
        <DockColumn
          side="right"
          width={state.sideWidths.right}
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

      {/* 6. Floating Panels Layer (23C) */}
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
      {overlayPanelIds.map((id) => (
        <div
          key={`overlay-${id}`}
          data-slot="panel-modal-overlay"
          data-panel-id={id}
          className="fixed inset-0 z-modal flex flex-col justify-end bg-black/40 backdrop-blur-xs animate-in fade-in-0 sm:justify-center sm:items-center"
        >
          <div
            className="w-full sm:w-[480px] max-h-[85vh] bg-panel border border-border rounded-t-2xl sm:rounded-2xl shadow-floating flex flex-col overflow-hidden"
          >
            <PanelHeader
              panelId={id}
              title={getTitle(id)}
              badge={panelBadges[id]}
              placement={state.panels[id].placement}
              mode="overlay"
              currentWidth={320}
              dispatch={dispatch}
            />
            <div className="flex-1 overflow-y-auto p-4 text-ui">
              {renderPanel(id)}
            </div>
          </div>
        </div>
      ))}

      {/* 8. Dragging Ghost Preview (23D) */}
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
  );
};

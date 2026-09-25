import * as React from 'react';
import { cn } from '@/lib/utils';
import { PanelHeader } from './PanelHeader';
import {
  computeResizedSideWidth,
  computeStackSplit,
  MIN_SIDE_WIDTH,
  MAX_SIDE_WIDTH,
} from './geometry';
import type {
  PanelId,
  WorkspacePanelAction,
} from '@/features/workspace/panels';
import {
  KEYBOARD_RESIZE_STEP,
  KEYBOARD_RESIZE_STEP_FINE,
} from '@/features/workspace/panels';

export interface DockedPanelItem {
  id: PanelId;
  title: string;
  badge?: React.ReactNode;
  stackOrder: number;
}

export interface DockColumnProps {
  side: 'left' | 'right';
  width: number;
  panels: DockedPanelItem[];
  dispatch: (action: WorkspacePanelAction) => void;
  renderPanel: (panelId: PanelId) => React.ReactNode;
  onPanelDragStart?: (panelId: PanelId, e: React.PointerEvent) => void;
  className?: string;
}

export const DockColumn: React.FC<DockColumnProps> = ({
  side,
  width,
  panels,
  dispatch,
  renderPanel,
  onPanelDragStart,
  className,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = React.useState<number>(0.5);
  const [isResizingSide, setIsResizingSide] = React.useState(false);

  if (panels.length === 0) {
    return null;
  }

  // Sort by stackOrder
  const sortedPanels = [...panels].sort((a, b) => a.stackOrder - b.stackOrder);
  const isStacked = sortedPanels.length > 1;

  // Horizontal dock resize handle (between dock and canvas)
  const handleSideResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = width;

    dispatch({ type: 'BEGIN_GESTURE', kind: `resize-side-${side}` });
    setIsResizingSide(true);

    const onPointerMove = (moveEvt: PointerEvent) => {
      const deltaX = moveEvt.clientX - startX;
      const nextWidth = computeResizedSideWidth(side, startWidth, deltaX);

      dispatch({
        type: 'PREVIEW_GESTURE',
        action: { type: 'RESIZE_SIDE', side, width: nextWidth },
      });
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      setIsResizingSide(false);
    };

    const onPointerUp = () => {
      cleanup();
      dispatch({ type: 'COMMIT_GESTURE' });
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

  // Keyboard navigation on side resize handle
  const handleSideResizeKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? KEYBOARD_RESIZE_STEP_FINE : KEYBOARD_RESIZE_STEP;
    let delta = 0;

    if (side === 'left') {
      if (e.key === 'ArrowRight') delta = step;
      else if (e.key === 'ArrowLeft') delta = -step;
    } else {
      if (e.key === 'ArrowLeft') delta = step;
      else if (e.key === 'ArrowRight') delta = -step;
    }

    if (delta !== 0) {
      e.preventDefault();
      const nextWidth = computeResizedSideWidth(side, width, side === 'left' ? delta : -delta);
      dispatch({ type: 'RESIZE_SIDE', side, width: nextWidth });
    }
  };

  // Splitter between stacked panels
  const handleSplitterPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const totalHeight = rect.height;
    const startY = e.clientY;
    const startTopHeight = totalHeight * splitRatio;

    const onPointerMove = (moveEvt: PointerEvent) => {
      const deltaY = moveEvt.clientY - startY;
      const nextRatio = computeStackSplit(startTopHeight, deltaY, totalHeight);
      setSplitRatio(nextRatio);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', cleanup);
    };

    const onPointerUp = () => {
      cleanup();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cleanup);
  };

  const handleSplitterKeyDown = (e: React.KeyboardEvent) => {
    const step = 0.05;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSplitRatio((r) => Math.min(0.8, r + step));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSplitRatio((r) => Math.max(0.2, r - step));
    }
  };

  return (
    <aside
      ref={containerRef}
      role="complementary"
      aria-label={`${side} panel dock`}
      data-slot="dock-column"
      data-side={side}
      style={{ width: `${width}px` }}
      className={cn(
        'relative flex flex-col h-full bg-panel text-foreground select-none shrink-0 z-chrome',
        side === 'left' ? 'border-r border-border' : 'border-l border-border',
        className
      )}
    >
      {/* Side resize handle (dock to canvas) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${side} dock column`}
        aria-valuenow={width}
        aria-valuemin={MIN_SIDE_WIDTH}
        aria-valuemax={MAX_SIDE_WIDTH}
        tabIndex={0}
        data-slot="side-resize-handle"
        onPointerDown={handleSideResizePointerDown}
        onKeyDown={handleSideResizeKeyDown}
        className={cn(
          'absolute top-0 bottom-0 w-2.5 z-20 cursor-col-resize flex items-center justify-center group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none',
          side === 'left' ? '-right-1.5' : '-left-1.5',
          isResizingSide && 'bg-primary/20'
        )}
      >
        <div className="w-0.5 h-8 rounded-full bg-transparent group-hover:bg-primary/50 group-focus-visible:bg-ring transition-colors" />
      </div>

      {/* Render Single Panel */}
      {!isStacked && (
        <div className="flex flex-col h-full min-h-0">
          <PanelHeader
            panelId={sortedPanels[0].id}
            title={sortedPanels[0].title}
            badge={sortedPanels[0].badge}
            placement={side}
            mode={side === 'left' ? 'docked-left' : 'docked-right'}
            currentWidth={width}
            dispatch={dispatch}
            onDragStart={(e) => onPanelDragStart?.(sortedPanels[0].id, e)}
          />
          <div
            data-slot="panel-content"
            className="flex-1 overflow-y-auto p-4 text-ui bg-panel"
          >
            {renderPanel(sortedPanels[0].id)}
          </div>
        </div>
      )}

      {/* Render Stacked Panels with Divider (23E) */}
      {isStacked && (
        <div className="flex flex-col h-full min-h-0">
          {/* Top Panel in Stack */}
          <div
            style={{ height: `${splitRatio * 100}%` }}
            className="flex flex-col min-h-[200px] overflow-hidden"
          >
            <PanelHeader
              panelId={sortedPanels[0].id}
              title={sortedPanels[0].title}
              badge={sortedPanels[0].badge}
              placement={side}
              mode={side === 'left' ? 'docked-left' : 'docked-right'}
              currentWidth={width}
              dispatch={dispatch}
              onDragStart={(e) => onPanelDragStart?.(sortedPanels[0].id, e)}
            />
            <div
              data-slot="panel-content"
              className="flex-1 overflow-y-auto p-4 text-ui bg-panel"
            >
              {renderPanel(sortedPanels[0].id)}
            </div>
          </div>

          {/* Stack Splitter Divider */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Panel stack splitter"
            aria-valuenow={Math.round(splitRatio * 100)}
            tabIndex={0}
            data-slot="stack-splitter"
            onPointerDown={handleSplitterPointerDown}
            onKeyDown={handleSplitterKeyDown}
            className="group relative h-2.5 flex items-center justify-center bg-sunken/60 hover:bg-sunken border-y border-border cursor-row-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none shrink-0"
          >
            <div className="w-8 h-1 rounded-full bg-control-border-strong group-hover:bg-primary transition-colors" />
          </div>

          {/* Bottom Panel in Stack */}
          <div
            style={{ height: `${(1 - splitRatio) * 100}%` }}
            className="flex flex-col min-h-[200px] overflow-hidden"
          >
            <PanelHeader
              panelId={sortedPanels[1].id}
              title={sortedPanels[1].title}
              badge={sortedPanels[1].badge}
              placement={side}
              mode={side === 'left' ? 'docked-left' : 'docked-right'}
              currentWidth={width}
              dispatch={dispatch}
              onDragStart={(e) => onPanelDragStart?.(sortedPanels[1].id, e)}
            />
            <div
              data-slot="panel-content"
              className="flex-1 overflow-y-auto p-4 text-ui bg-panel"
            >
              {renderPanel(sortedPanels[1].id)}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

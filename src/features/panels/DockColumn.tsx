import * as React from 'react';
import { cn } from '@/lib/utils';
import { PanelHeader } from './PanelHeader';
import { panelContentClass } from './panelContentClass';
import { trackPanelGesture, trackPointerGesture } from './pointerGesture';
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
  const [storedRatios, setStoredRatios] = React.useState<number[]>([]);
  const [isResizingSide, setIsResizingSide] = React.useState(false);

  if (panels.length === 0) {
    return null;
  }

  // Sort by stackOrder
  const sortedPanels = [...panels].sort((a, b) => a.stackOrder - b.stackOrder);
  const isStacked = sortedPanels.length > 1;
  // Equal initial split; a splitter drag only ever moves space between its two neighbours.
  const ratios =
    storedRatios.length === sortedPanels.length
      ? storedRatios
      : sortedPanels.map(() => 1 / sortedPanels.length);

  // Horizontal dock resize handle (between dock and canvas)
  const handleSideResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = width;

    setIsResizingSide(true);

    trackPanelGesture(dispatch, `resize-side-${side}`, {
      onMove: (moveEvt) => {
        const deltaX = moveEvt.clientX - startX;
        dispatch({
          type: 'PREVIEW_GESTURE',
          action: { type: 'RESIZE_SIDE', side, width: computeResizedSideWidth(side, startWidth, deltaX) },
        });
      },
      onSettle: () => setIsResizingSide(false),
    });
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

  // Splitter `index` sits between panel `index` and `index + 1`.
  const moveSplitter = (index: number, startRatios: number[], deltaY: number, totalHeight: number) => {
    const pairShare = startRatios[index] + startRatios[index + 1];
    const pairHeight = pairShare * totalHeight;
    const nextInPair = computeStackSplit(startRatios[index] * totalHeight, deltaY, pairHeight);
    const next = [...startRatios];
    next[index] = nextInPair * pairShare;
    next[index + 1] = pairShare - next[index];
    setStoredRatios(next);
  };

  const handleSplitterPointerDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;

    const totalHeight = container.getBoundingClientRect().height;
    const startY = e.clientY;
    const startRatios = [...ratios];

    trackPointerGesture({
      onMove: (moveEvt) => moveSplitter(index, startRatios, moveEvt.clientY - startY, totalHeight),
      onUp: () => {},
      onCancel: () => {},
      cancelOnEscape: false,
    });
  };

  const handleSplitterKeyDown = (index: number) => (e: React.KeyboardEvent) => {
    const container = containerRef.current;
    const totalHeight = container?.getBoundingClientRect().height ?? 0;
    const step = totalHeight * 0.05;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSplitter(index, [...ratios], step, totalHeight);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSplitter(index, [...ratios], -step, totalHeight);
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
            className={panelContentClass(sortedPanels[0].id)}
          >
            {renderPanel(sortedPanels[0].id)}
          </div>
        </div>
      )}

      {/* Render Stacked Panels with Dividers (23E): two or more panels share the column */}
      {isStacked && (
        <div className="flex flex-col h-full min-h-0">
          {sortedPanels.map((panel, index) => (
            <React.Fragment key={panel.id}>
              {index > 0 && (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Panel stack splitter"
                  aria-valuenow={Math.round(ratios[index - 1] * 100)}
                  tabIndex={0}
                  data-slot="stack-splitter"
                  onPointerDown={handleSplitterPointerDown(index - 1)}
                  onKeyDown={handleSplitterKeyDown(index - 1)}
                  className="group relative h-2.5 flex items-center justify-center bg-sunken/60 hover:bg-sunken border-y border-border cursor-row-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none shrink-0"
                >
                  <div className="w-8 h-1 rounded-full bg-control-border-strong group-hover:bg-primary transition-colors" />
                </div>
              )}
              <div
                style={{ height: `${ratios[index] * 100}%` }}
                className="flex flex-col min-h-[200px] overflow-hidden"
              >
                <PanelHeader
                  panelId={panel.id}
                  title={panel.title}
                  badge={panel.badge}
                  placement={side}
                  mode={side === 'left' ? 'docked-left' : 'docked-right'}
                  currentWidth={width}
                  dispatch={dispatch}
                  onDragStart={(e) => onPanelDragStart?.(panel.id, e)}
                />
                <div data-slot="panel-content" className={panelContentClass(panel.id)}>
                  {renderPanel(panel.id)}
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </aside>
  );
};

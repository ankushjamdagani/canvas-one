import * as React from 'react';
import { cn } from '@/lib/utils';
import { PanelHeader } from './PanelHeader';
import { computeResizedFloatRect } from './geometry';
import type {
  PanelId,
  FloatRect,
  Viewport,
  WorkspacePanelAction,
} from '@/features/workspace/panels';
import {
  KEYBOARD_RESIZE_STEP,
  KEYBOARD_RESIZE_STEP_FINE,
} from '@/features/workspace/panels';

export interface FloatingPanelProps {
  panelId: PanelId;
  title: string;
  badge?: React.ReactNode;
  floatRect: FloatRect;
  viewport: Viewport;
  isFocused: boolean;
  dispatch: (action: WorkspacePanelAction) => void;
  renderPanel: (panelId: PanelId) => React.ReactNode;
  onDragStart?: (panelId: PanelId, e: React.PointerEvent) => void;
  className?: string;
}

export const FloatingPanel: React.FC<FloatingPanelProps> = ({
  panelId,
  title,
  badge,
  floatRect,
  viewport,
  isFocused,
  dispatch,
  renderPanel,
  onDragStart,
  className,
}) => {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = React.useState(false);

  // Resize corner drag handler
  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = { ...floatRect };

    dispatch({ type: 'BEGIN_GESTURE', kind: 'resize-float' });
    setResizing(true);

    const onPointerMove = (moveEvt: PointerEvent) => {
      const deltaX = moveEvt.clientX - startX;
      const deltaY = moveEvt.clientY - startY;
      const nextRect = computeResizedFloatRect(startRect, deltaX, deltaY, viewport);

      dispatch({
        type: 'PREVIEW_GESTURE',
        action: { type: 'RESIZE_FLOAT', panel: panelId, rect: nextRect },
      });
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      setResizing(false);
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

  // Keyboard resize on the resize corner
  const handleResizeKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? KEYBOARD_RESIZE_STEP_FINE : KEYBOARD_RESIZE_STEP;
    let deltaX = 0;
    let deltaY = 0;

    if (e.key === 'ArrowRight') deltaX = step;
    else if (e.key === 'ArrowLeft') deltaX = -step;
    else if (e.key === 'ArrowDown') deltaY = step;
    else if (e.key === 'ArrowUp') deltaY = -step;
    else return;

    e.preventDefault();
    const nextRect = computeResizedFloatRect(floatRect, deltaX, deltaY, viewport);
    dispatch({ type: 'RESIZE_FLOAT', panel: panelId, rect: nextRect });
  };

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={`${title} floating panel`}
      data-slot="floating-panel"
      data-panel-id={panelId}
      tabIndex={-1}
      style={{
        position: 'absolute',
        left: `${floatRect.x}px`,
        top: `${floatRect.y}px`,
        width: `${floatRect.width}px`,
        height: `${floatRect.height}px`,
        zIndex: isFocused ? 35 : 30,
      }}
      onPointerDown={() => {
        dispatch({ type: 'FOCUS', panel: panelId });
      }}
      className={cn(
        'flex flex-col bg-panel rounded-2xl border border-border shadow-floating overflow-hidden select-none outline-none transition-shadow',
        isFocused && 'ring-1 ring-ring/30 shadow-2xl',
        resizing && 'pointer-events-auto',
        className
      )}
    >
      {/* Header */}
      <PanelHeader
        panelId={panelId}
        title={title}
        badge={badge}
        placement="floating"
        mode="floating"
        currentWidth={floatRect.width}
        dispatch={dispatch}
        showGrip={true}
        isFloating={true}
        onDragStart={(e) => onDragStart?.(panelId, e)}
      />

      {/* Content Area */}
      <div
        data-slot="panel-content"
        className="flex-1 overflow-y-auto p-4 text-ui text-foreground bg-panel"
      >
        {renderPanel(panelId)}
      </div>

      {/* Bottom right resize handle corner */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${title} floating panel`}
        data-slot="float-resize-corner"
        tabIndex={0}
        onPointerDown={handleResizePointerDown}
        onKeyDown={handleResizeKeyDown}
        className="absolute bottom-1 right-1 size-4 flex items-end justify-end cursor-se-resize text-secondary-text/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none p-0.5"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M7 1L1 7M7 4L4 7M7 7H7.01"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
};

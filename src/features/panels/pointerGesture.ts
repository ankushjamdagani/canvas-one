import type { WorkspacePanelAction } from '@/features/workspace/panels';

type PointerGestureHandlers = {
  readonly onMove: (event: PointerEvent) => void;
  /** Pointer released. Runs after the window listeners are removed and `onSettle` has run. */
  readonly onUp: (event: PointerEvent) => void;
  /** Gesture abandoned (pointercancel, or Escape when `cancelOnEscape`). Runs after `onSettle`. */
  readonly onCancel: () => void;
  /** Runs once when the gesture ends either way, for resetting transient UI state. */
  readonly onSettle?: () => void;
  readonly cancelOnEscape?: boolean;
};

/** Tracks one pointer drag on `window` until it is released or cancelled. */
export function trackPointerGesture({
  onMove,
  onUp,
  onCancel,
  onSettle,
  cancelOnEscape = true,
}: PointerGestureHandlers): void {
  const settle = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleCancel);
    window.removeEventListener('keydown', handleKeyDown);
    onSettle?.();
  };
  const handleUp = (event: PointerEvent) => {
    settle();
    onUp(event);
  };
  const handleCancel = () => {
    settle();
    onCancel();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') handleCancel();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', handleUp);
  window.addEventListener('pointercancel', handleCancel);
  if (cancelOnEscape) window.addEventListener('keydown', handleKeyDown);
}

/**
 * A pointer drag wrapped in the panel-state gesture protocol: BEGIN_GESTURE up front, then
 * COMMIT_GESTURE on release (after `onUp` has dispatched any final change) or CANCEL_GESTURE
 * when abandoned. Move handlers dispatch PREVIEW_GESTURE.
 */
export function trackPanelGesture(
  dispatch: (action: WorkspacePanelAction) => void,
  kind: string,
  handlers: {
    readonly onMove: (event: PointerEvent) => void;
    readonly onUp?: (event: PointerEvent) => void;
    readonly onSettle?: () => void;
  },
): void {
  dispatch({ type: 'BEGIN_GESTURE', kind });
  trackPointerGesture({
    onMove: handlers.onMove,
    onSettle: handlers.onSettle,
    onUp: (event) => {
      handlers.onUp?.(event);
      dispatch({ type: 'COMMIT_GESTURE' });
    },
    onCancel: () => dispatch({ type: 'CANCEL_GESTURE' }),
  });
}

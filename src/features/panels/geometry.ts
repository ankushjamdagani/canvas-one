/**
 * Pure geometry and drop target calculations for workspace panels.
 * Governed by specs/revamp/contracts/commands.md §7 "Panels and geometry".
 */

import {
  clampSideWidth,
  clampFloatRect,
  MIN_SIDE_WIDTH,
  MAX_SIDE_WIDTH,
  MIN_FLOAT_WIDTH,
  MIN_FLOAT_HEIGHT,
  STACK_MIN_EXPANDED_HEIGHT,
  DEFAULT_SIDE_WIDTH,
  type FloatRect,
  type Viewport,
  type SideWidths,
} from '@/features/workspace/panels';

export {
  clampSideWidth,
  clampFloatRect,
  MIN_SIDE_WIDTH,
  MAX_SIDE_WIDTH,
  MIN_FLOAT_WIDTH,
  MIN_FLOAT_HEIGHT,
  STACK_MIN_EXPANDED_HEIGHT,
};

/**
 * Computes whether pointer is within the left or right dock drop target zone.
 */
export function computeDropTarget(
  pointerX: number,
  viewportWidth: number,
  sideWidths: SideWidths = { left: DEFAULT_SIDE_WIDTH, right: DEFAULT_SIDE_WIDTH },
  customThreshold?: number
): 'left' | 'right' | null {
  if (viewportWidth <= 0 || !Number.isFinite(pointerX)) {
    return null;
  }

  const leftThreshold = customThreshold ?? Math.min(viewportWidth * 0.35, Math.max(160, sideWidths.left));
  const rightThreshold = customThreshold ?? Math.min(viewportWidth * 0.35, Math.max(160, sideWidths.right));

  if (pointerX <= leftThreshold) {
    return 'left';
  }
  if (pointerX >= viewportWidth - rightThreshold) {
    return 'right';
  }
  return null;
}

/**
 * Computes updated side width from drag delta.
 * Left side: dragging right edge increases width (+deltaX).
 * Right side: dragging left edge increases width (-deltaX).
 */
export function computeResizedSideWidth(
  side: 'left' | 'right',
  startWidth: number,
  deltaX: number
): number {
  const raw = side === 'left' ? startWidth + deltaX : startWidth - deltaX;
  return clampSideWidth(raw);
}

/**
 * Computes resized float rectangle from corner drag delta.
 */
export function computeResizedFloatRect(
  startRect: FloatRect,
  deltaX: number,
  deltaY: number,
  viewport: Viewport
): FloatRect {
  const newWidth = Math.max(MIN_FLOAT_WIDTH, Math.round(startRect.width + deltaX));
  const newHeight = Math.max(MIN_FLOAT_HEIGHT, Math.round(startRect.height + deltaY));

  return clampFloatRect(
    {
      x: startRect.x,
      y: startRect.y,
      width: newWidth,
      height: newHeight,
    },
    viewport
  );
}

/**
 * Computes stacked panels split height ratio [0, 1] clamped by minimum heights.
 */
export function computeStackSplit(
  startTopHeight: number,
  deltaY: number,
  totalAvailableHeight: number
): number {
  if (totalAvailableHeight <= 0) {
    return 0.5;
  }

  const minH = STACK_MIN_EXPANDED_HEIGHT;
  const maxTopH = Math.max(minH, totalAvailableHeight - minH);

  const desiredTopH = startTopHeight + deltaY;
  const clampedTopH = Math.min(maxTopH, Math.max(minH, desiredTopH));

  return clampedTopH / totalAvailableHeight;
}

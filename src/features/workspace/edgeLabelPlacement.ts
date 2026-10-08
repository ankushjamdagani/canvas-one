/**
 * Pure geometry helpers for the edge label overlap fix.
 *
 * TrafficEdge's label chip sits at the smoothstep path's midpoint. On tightly
 * spaced layouts that midpoint can land on top of a node rectangle even
 * after lifting the chip above the line, covering the node's caption. These
 * helpers let TrafficEdge decide, in flow (not screen) coordinates, whether the
 * chip would intersect any node and should therefore be suppressed from the
 * canvas (shown instead on hover/selection).
 */

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Axis-aligned bounding box intersection test. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Estimates the label chip's bounding rect in flow coordinates.
 *
 * The chip is rendered in screen pixels (padding px-1.5 py-0.5, text-[10px]
 * font-medium) then placed via `EdgeLabelRenderer`, whose layer is scaled by
 * the current zoom -- so a screen-pixel size estimate has to be divided by
 * zoom to land back in flow-coordinate units comparable to node rects.
 *
 * This is a text-length estimate, not a DOM measurement: measuring the real
 * chip would need a render-measure-render cycle (flicker) for a chip whose
 * whole point is to stay out of the way. The estimate over-sizes slightly
 * (average char width for the mono/medium 10px label font) so a false
 * "intersects" is preferred over a false "doesn't" -- narrowest reading.
 */
export function estimateLabelChipRect(
  labelX: number,
  labelY: number,
  label: string,
  zoom: number,
  liftAboveLinePx = 6,
): Rect {
  const safeZoom = zoom > 0 ? zoom : 1;
  const horizontalPaddingPx = 12; // px-1.5 each side, plus border
  const charWidthPx = 6.2; // conservative average for 10px font-medium
  const widthPx = horizontalPaddingPx + label.length * charWidthPx;
  const heightPx = 18; // py-0.5 + line height for 10px text

  const width = widthPx / safeZoom;
  const height = heightPx / safeZoom;

  // The chip is centered horizontally on the point and lifted fully above it
  // (translate(-50%, calc(-100% - liftAboveLinePx))): its bottom edge sits
  // liftAboveLinePx above (labelX, labelY).
  return {
    x: labelX - width / 2,
    y: labelY - liftAboveLinePx / safeZoom - height,
    width,
    height,
  };
}

/** True when the chip rect intersects any of the given node rects. */
export function chipOverlapsAnyNode(chip: Rect, nodeRects: readonly Rect[]): boolean {
  return nodeRects.some((node) => rectsIntersect(chip, node));
}

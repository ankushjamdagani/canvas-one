import type { Id, Placement } from '../studio/model.js';

/**
 * Placements persist their width but not their height. Group bounds and the
 * selection geometry planners (bounding-box alignment) use the
 * canvas's measured card heights when available, and this rendered-card
 * estimate for cards that haven't been measured yet.
 */
const ESTIMATED_ELEMENT_NODE_HEIGHT = 76;

/** Measured rendered height per placement id (presentation only; never persisted). */
export type MeasuredHeights = ReadonlyMap<Id, number>;

export function placementHeight(placement: Placement, heights?: MeasuredHeights): number {
  return heights?.get(placement.id) ?? ESTIMATED_ELEMENT_NODE_HEIGHT;
}

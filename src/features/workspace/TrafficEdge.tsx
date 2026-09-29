import * as React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  useViewport,
  type EdgeProps,
} from '@xyflow/react';
import { chipOverlapsAnyNode, estimateLabelChipRect, type Rect } from './edgeLabelPlacement';

/**
 * Custom edge for the 2A workspace canvas (review round 1 fix).
 *
 * Two problems with xyflow's built-in edge + `label` prop:
 * 1. It draws a bezier curve, not the smoothstep/orthogonal-ish routing the
 *    brief calls for.
 * 2. Its label is plain SVG text baked into the edges layer, which has no
 *    z-index (xyflow leaves `.react-flow__edges` and `.react-flow__edgelabel-
 *    renderer` at z-index:auto) — so it always painted behind node cards
 *    (`.react-flow__node` has an explicit zIndex from projection.ts),
 *    producing labels like "ntry to validat" clipped behind a card.
 *
 * Fix: route with `getSmoothStepPath`, and render the label chip through
 * `EdgeLabelRenderer` (the HTML portal, not SVG) as a small panel-styled
 * chip. `.react-flow__edgelabel-renderer` also gets an explicit z-index in
 * styles.css so this chip layer sits above the node layer.
 *
 * RV-12d fix (round 1): `getSmoothStepPath`'s [labelX, labelY] sits dead-center
 * on the path's midpoint segment. Lifting the chip above the line (instead of
 * centering it) helps but doesn't fully solve tightly spaced layouts (S01):
 * the lifted chip can still land on a node rectangle above the edge.
 *
 * RV-12d fix (review round 1): when the (estimated) chip rectangle would
 * intersect any node's rectangle, don't render it on the canvas at all --
 * show it only while the edge is hovered or selected instead. Node rects come
 * from xyflow's internal store (`internals.positionAbsolute` + `measured`),
 * which is the same flow-coordinate space `getSmoothStepPath` returns.
 */
export function TrafficEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  label,
  markerEnd,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = React.useState(false);
  const { zoom } = useViewport();

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  // Node rects in flow coordinates (same space as sourceX/targetX above).
  const nodeRects = useStore((s): Rect[] => {
    const rects: Rect[] = [];
    for (const node of s.nodeLookup.values()) {
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured?.width ?? 0;
      const height = node.measured?.height ?? 0;
      if (width > 0 && height > 0) {
        rects.push({ x, y, width, height });
      }
    }
    return rects;
  });

  const labelText = typeof label === 'string' ? label : null;

  const overlapsNode = React.useMemo(() => {
    if (!labelText) return false;
    const chipRect = estimateLabelChipRect(labelX, labelY, labelText, zoom);
    return chipOverlapsAnyNode(chipRect, nodeRects);
  }, [labelText, labelX, labelY, zoom, nodeRects]);

  // Hover/selection is a fallback reveal for a chip that would otherwise
  // cover a node -- not a general-purpose focus affordance. A custom edge
  // component only receives `selected` from EdgeProps; xyflow's own keyboard
  // focus styling is applied to the ancestor <g> it wraps our output in,
  // which our inner element can't observe directly, so selection (mouse click
  // or keyboard select-then-Enter, both of which set `selected`) is the
  // practical stand-in for "focus" here.
  const isInteracting = hovered || Boolean(selected);
  const showChip = Boolean(labelText) && (!overlapsNode || isInteracting);

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`edge-${id}`}
    >
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {showChip && labelText ? (
        <EdgeLabelRenderer>
          <div
            className={
              'nodrag nopan absolute whitespace-nowrap rounded-tag border ' +
              'border-control-border bg-panel px-1.5 py-0.5 text-[10px] ' +
              'font-medium text-body shadow-xs'
            }
            style={{
              // Position at the path midpoint, then lift the chip fully above
              // it (-100% of its own height, plus a fixed 6px gap) instead of
              // centering on the line -- keeps it off node rectangles that sit
              // close to the edge on tightly spaced layouts.
              transform: `translate(${labelX}px, ${labelY}px) translate(-50%, calc(-100% - 6px))`,
              pointerEvents: 'none',
            }}
            data-testid={`edge-label-${id}`}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}

import * as React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

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
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className={
              'nodrag nopan absolute whitespace-nowrap rounded-tag border ' +
              'border-control-border bg-panel px-1.5 py-0.5 text-[10px] ' +
              'font-medium text-body shadow-xs'
            }
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
            data-testid={`edge-label-${id}`}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

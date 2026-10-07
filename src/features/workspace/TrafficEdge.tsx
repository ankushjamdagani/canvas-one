import * as React from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStore, useViewport, type EdgeProps } from '@xyflow/react';
import { CellsAndLanesConnection, CellsAndLanesConnectionInspection } from '@/components/traffic/cells-and-lanes';
import { PlaybackTrafficContext } from './usePlaybackTraffic';
import { SimulationHighlightContext } from './SimulationHighlight';
import { chipOverlapsAnyNode, estimateLabelChipRect, type Rect } from './edgeLabelPlacement';

/** Keep authoring routing, selection and labels; traffic is supplied by the shared playhead. */
export function TrafficEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, label, markerEnd, selected, data }: EdgeProps) {
  const [hovered, setHovered] = React.useState(false);
  const { zoom } = useViewport();
  const connectionId = (data as { connection?: { id?: string } } | undefined)?.connection?.id;
  const traffic = React.useContext(PlaybackTrafficContext);
  const highlight = React.useContext(SimulationHighlightContext);
  const activity = traffic.activities?.connections.get(connectionId ?? '');
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 8 });
  const nodeRects = useStore((s): Rect[] => {
    const rects: Rect[] = [];
    for (const node of s.nodeLookup.values()) {
      const { x, y } = node.internals.positionAbsolute;
      const width = node.measured?.width ?? 0, height = node.measured?.height ?? 0;
      if (width > 0 && height > 0) rects.push({ x, y, width, height });
    }
    return rects;
  });
  const labelText = typeof label === 'string' ? label : null;
  const overlapsNode = React.useMemo(() => labelText ? chipOverlapsAnyNode(estimateLabelChipRect(labelX, labelY, labelText, zoom), nodeRects) : false, [labelText, labelX, labelY, zoom, nodeRects]);
  const showChip = Boolean(labelText) && (!overlapsNode || hovered || selected);
  return <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} data-testid={`edge-${id}`}>
    {highlight?.connectionId === connectionId && <path data-testid="simulation-event-connection" d={edgePath} fill="none" className="stroke-primary pointer-events-none" strokeWidth={4} />}
    <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
    {activity && <>
      <CellsAndLanesConnection activity={activity} path={edgePath} progress={traffic.progress ?? 0} reducedMotion={traffic.reduced} />
      <EdgeLabelRenderer>
        <div className="nodrag nopan absolute" style={{ transform: `translate(${labelX}px, ${labelY}px) translate(-50%, 12px)`, pointerEvents: 'auto', zIndex: 2 }}>
          <CellsAndLanesConnectionInspection activity={activity} label={labelText ?? 'Connection traffic'} />
        </div>
      </EdgeLabelRenderer>
    </>}
    {showChip && labelText && <EdgeLabelRenderer>
      <div className="nodrag nopan absolute whitespace-nowrap rounded-tag border border-control-border bg-panel px-1.5 py-0.5 text-[10px] font-medium text-body shadow-xs"
        style={{ transform: `translate(${labelX}px, ${labelY}px) translate(-50%, calc(-100% - 6px))`, pointerEvents: 'none' }} data-testid={`edge-label-${id}`}>
        {labelText}
      </div>
    </EdgeLabelRenderer>}
  </g>;
}

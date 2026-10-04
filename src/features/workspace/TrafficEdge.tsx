import * as React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  useViewport,
  type EdgeProps,
} from "@xyflow/react";
import { PlaybackTrafficContext } from "./usePlaybackTraffic";
import { placeLeg, trafficDensity } from "./playbackTraffic";
import type { LegAt } from "../runs/playback";
import { TrafficFlash } from "../../components/ui/traffic-flash";
import {
  chipOverlapsAnyNode,
  estimateLabelChipRect,
  type Rect,
} from "./edgeLabelPlacement";

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
  data,
}: EdgeProps) {
  const [hovered, setHovered] = React.useState(false);
  const { zoom } = useViewport();
  const connectionId = (data as { connection?: { id?: string } } | undefined)
    ?.connection?.id;
  const traffic = React.useContext(PlaybackTrafficContext);
  const packets = traffic.legs.get(connectionId ?? "") ?? [];
  const density = trafficDensity(packets);
  const flashes = traffic.connectionFlashes.get(connectionId ?? "") ?? [];

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

  const labelText = typeof label === "string" ? label : null;

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
      {flashes.map((flash, index) => {
        const side = flash.progress === 0 ? sourcePosition : targetPosition;
        const countWidth =
          flash.count > 1 ? 13 + String(flash.count).length * 7 : 0;
        const gutterX =
          side === "left" ? -14 - countWidth : side === "right" ? 14 : 0;
        const gutterY = side === "top" ? -14 : side === "bottom" ? 14 : 0;
        const x =
          flash.progress === 0
            ? sourceX + gutterX
            : flash.progress === 1
              ? targetX + gutterX
              : labelX;
        const y =
          flash.progress === 0
            ? sourceY + gutterY
            : flash.progress === 1
              ? targetY + gutterY
              : labelY;
        const stack = flashes
          .slice(0, index)
          .filter((other) => other.progress === flash.progress).length;
        const lift =
          flash.progress !== 0.5 && side === "bottom"
            ? 12 + stack * 18
            : -12 - stack * 18;
        return (
          <g
            key={`${flash.kind}:${flash.outcome}:${flash.progress}`}
            transform={`translate(${x} ${y + lift})`}
          >
            <TrafficFlash {...flash} reduced={traffic.reduced} />
          </g>
        );
      })}
      {density.aggregate ? (
        <>
          {(["out", "back"] as const).map((direction) =>
            density[direction] > 0 ? (
              <path
                key={direction}
                d={edgePath}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth={3}
                strokeDasharray={density.dash}
                opacity={0.6}
                transform={`translate(0 ${direction === "out" ? -3 : 3})`}
                style={{
                  animation: traffic.reduced
                    ? "none"
                    : `traffic-flow ${density.durationSeconds}s linear infinite`,
                  animationDirection:
                    direction === "back" ? "reverse" : "normal",
                }}
                data-direction={direction}
                pointerEvents="none"
              />
            ) : null,
          )}
          <EdgeLabelRenderer>
            <div
              data-testid="traffic-aggregate"
              data-count={density.count}
              className="nodrag nopan absolute whitespace-nowrap rounded-tag border border-control-border bg-panel px-1.5 py-0.5 font-mono text-[10px] text-body shadow-xs"
              style={{
                transform: `translate(${labelX}px, ${labelY}px) translate(-50%, 8px)`,
                pointerEvents: "none",
              }}
            >
              {density.count} in flight · {density.out} out / {density.back}{" "}
              back
            </div>
          </EdgeLabelRenderer>
        </>
      ) : (
        packets.map((packet, index) => (
          <PacketMarker
            key={`${packet.key}:${packet.direction}`}
            packet={packet}
            path={edgePath}
            reduced={traffic.reduced}
            staticProgress={(index + 1) / (packets.length + 1)}
          />
        ))
      )}
      {selected && traffic.hasRun ? (
        <EdgeLabelRenderer>
          <div
            role="region"
            aria-label="Units in transit"
            data-testid="traffic-units"
            className="nodrag nopan absolute max-h-40 w-64 overflow-auto rounded-panel border border-control-border bg-panel px-2 py-1 font-mono text-[10px] text-body shadow-xs"
            style={{
              transform: `translate(${labelX}px, ${labelY}px) translate(-50%, 32px)`,
              pointerEvents: "auto",
            }}
          >
            <div className="border-b border-control-border py-1 font-semibold">
              {packets.length} units in transit
            </div>
            {packets.map((packet) => (
              <div
                key={`${packet.key}:${packet.direction}`}
                className="flex gap-2 py-0.5"
              >
                <span className="min-w-0 flex-1 break-all">{packet.key}</span>
                <span>{packet.direction}</span>
              </div>
            ))}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {showChip && labelText ? (
        <EdgeLabelRenderer>
          <div
            className={
              "nodrag nopan absolute whitespace-nowrap rounded-tag border " +
              "border-control-border bg-panel px-1.5 py-0.5 text-[10px] " +
              "font-medium text-body shadow-xs"
            }
            style={{
              // Position at the path midpoint, then lift the chip fully above
              // it (-100% of its own height, plus a fixed 6px gap) instead of
              // centering on the line -- keeps it off node rectangles that sit
              // close to the edge on tightly spaced layouts.
              transform: `translate(${labelX}px, ${labelY}px) translate(-50%, calc(-100% - 6px))`,
              pointerEvents: "none",
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

function PacketMarker({
  packet,
  path,
  reduced,
  staticProgress,
}: {
  packet: LegAt;
  path: string;
  reduced: boolean;
  staticProgress: number;
}) {
  const pathRef = React.useRef<SVGPathElement>(null);
  const markRef = React.useRef<SVGGElement>(null);
  React.useLayoutEffect(() => {
    if (!pathRef.current) return;
    const at = placeLeg(pathRef.current, packet, reduced, staticProgress);
    markRef.current?.setAttribute(
      "transform",
      `translate(${at.x} ${at.y}) rotate(${at.heading})`,
    );
  }, [packet, path, reduced, staticProgress]);
  return (
    <>
      <path
        ref={pathRef}
        d={path}
        fill="none"
        stroke="none"
        pointerEvents="none"
      />
      <g
        ref={markRef}
        data-testid="traffic-packet"
        data-unit={packet.key}
        data-direction={packet.direction}
        data-progress={packet.progress}
        pointerEvents="none"
      >
        <rect
          x={-7}
          y={-5}
          width={14}
          height={10}
          rx={2.5}
          fill="var(--color-primary)"
          stroke="var(--color-background)"
          strokeWidth={1.2}
        />
        <path
          d="M-2.5 -2.5 L2.5 0 L-2.5 2.5"
          fill="none"
          stroke="var(--color-background)"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </>
  );
}

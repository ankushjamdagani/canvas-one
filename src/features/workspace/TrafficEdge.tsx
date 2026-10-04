import * as React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  useViewport,
  type EdgeProps,
} from "@xyflow/react";
import {
  PacketContext,
  STAGE_LABEL,
  STAGE_MIN_MS,
  type Packet,
  type PacketStage,
} from "./livePackets";
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
  const packets = React.useContext(PacketContext).get(connectionId ?? "") ?? [];
  const returning = packets.some((p) => p.stage === "returning");

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
      <BaseEdge
        id={id}
        path={edgePath}
        style={
          packets.length > 0
            ? {
                ...style,
                stroke: "var(--color-primary, #0B5C54)",
                strokeDasharray: "6 5",
                animation: "traffic-flow 0.5s linear infinite",
                animationDirection: returning ? "reverse" : "normal",
              }
            : style
        }
        markerEnd={markerEnd}
      />
      {packets.map((packet, index) => (
        <PacketMarker
          key={packet.key}
          packet={packet}
          path={edgePath}
          lane={index}
        />
      ))}
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

const STAGE_COLOR: Record<PacketStage, string> = {
  sent: "#0B5C54",
  transit: "#0B5C54",
  received: "#0B5C54",
  queued: "#B7791F",
  processing: "#2B6CB0",
  done: "#2F855A",
  rejected: "#B3261E",
  failed: "#B3261E",
  lost: "#B3261E",
  returning: "#2F855A",
  delivered: "#2F855A",
};

/** How far along the connection (0 = sender, 1 = receiver) a packet is, given its stage and how long it has been in it. */
function progressOf(stage: PacketStage, elapsedMs: number): number {
  const through = Math.min(1, elapsedMs / STAGE_MIN_MS[stage]);
  switch (stage) {
    case "sent":
      return 0.05;
    case "transit":
      return 0.05 + 0.9 * through;
    case "lost":
      return 0.5;
    case "returning":
      return 0.95 - 0.9 * through;
    case "delivered":
      return 0.05;
    default:
      return 0.95;
  }
}

/**
 * One packet beside its connection: a small chip that sits on the line, moves with the stage and points the way it
 * travels, with the stage written next to it. Position is set from an animation frame, not React state.
 */
function PacketMarker({
  packet,
  path,
  lane,
}: {
  packet: Packet;
  path: string;
  lane: number;
}) {
  const pathRef = React.useRef<SVGPathElement>(null);
  const markRef = React.useRef<SVGGElement>(null);
  const labelRef = React.useRef<HTMLDivElement>(null);
  const reduced = React.useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  React.useEffect(() => {
    let frame = 0;
    const place = () => {
      const line = pathRef.current;
      if (line) {
        const length = line.getTotalLength();
        const elapsed = performance.now() - packet.stageStartedAt;
        const t = progressOf(
          packet.stage,
          reduced ? STAGE_MIN_MS[packet.stage] : elapsed,
        );
        const at = line.getPointAtLength(length * t);
        const ahead = line.getPointAtLength(Math.min(length, length * t + 1));
        const back = line.getPointAtLength(Math.max(0, length * t - 1));
        const heading =
          (Math.atan2(ahead.y - back.y, ahead.x - back.x) * 180) / Math.PI +
          (packet.stage === "returning" ? 180 : 0);
        markRef.current?.setAttribute(
          "transform",
          `translate(${at.x} ${at.y}) rotate(${heading})`,
        );
        if (labelRef.current) {
          labelRef.current.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, calc(-100% - 10px - ${lane * 18}px))`;
        }
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [packet.stage, packet.stageStartedAt, lane, reduced, path]);

  const color = STAGE_COLOR[packet.stage];
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
        data-stage={packet.stage}
        pointerEvents="none"
      >
        <rect
          x={-7}
          y={-5}
          width={14}
          height={10}
          rx={2.5}
          fill={color}
          stroke="#fff"
          strokeWidth={1.2}
        />
        <path
          d="M-2.5 -2.5 L2.5 0 L-2.5 2.5"
          fill="none"
          stroke="#fff"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      {lane === 0 ? (
        <EdgeLabelRenderer>
          <div
            ref={labelRef}
            className="nodrag nopan absolute whitespace-nowrap rounded-tag border border-control-border bg-panel px-1.5 py-0.5 text-[10px] font-medium text-body shadow-xs"
            style={{ pointerEvents: "none", borderColor: color, color }}
            data-testid="traffic-packet-label"
          >
            {STAGE_LABEL[packet.stage]}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

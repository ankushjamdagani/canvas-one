import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export type TrafficConnection = Edge<
  { running: boolean; rate: number; rateLabel?: string; showLabel?: boolean; label?: string; protocol?: string; communication?: "sync" | "async" | "data" },
  "traffic"
>;

/** A continuous visual cue, deliberately independent of worker sampling ticks. */
export const TrafficEdge = memo(function TrafficEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<TrafficConnection>) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const moving = !!data?.running && (data?.rate ?? 0) > 0;
  const isAsync = data?.communication === "async";
  const isData = data?.communication === "data";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          // Design System board "Canvas objects" connectors: idle = neutral hover-border,
          // selected path = primary (solid, thicker), async/queued = branch/async purple
          // (dashed). "data" classification keeps the existing dotted pattern; the board's
          // legend doesn't show a data-specific colour, so it stays neutral like idle.
          stroke: selected ? "var(--primary)" : isAsync ? "var(--branch)" : "var(--hover-border)",
          strokeWidth: selected ? 2 : 1.4,
          strokeDasharray: isAsync ? "7 5" : isData ? "2 4" : undefined,
        }}
      />
      <path
        d={path}
        className="traffic-stream"
        aria-hidden="true"
        style={{
          animationPlayState: moving ? "running" : "paused",
          opacity: moving ? 1 : 0,
        }}
      />
      {(data?.showLabel !== false || data?.label || data?.protocol) && <EdgeLabelRenderer>
        <span
          className="traffic-edge-label"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {data?.showLabel === false ? [data?.label, data?.protocol].filter(Boolean).join(" · ") : <>{Math.round(data?.rate ?? 0).toLocaleString()} /s {data?.rateLabel ?? "expected"}</>}
        </span>
      </EdgeLabelRenderer>}
    </>
  );
});

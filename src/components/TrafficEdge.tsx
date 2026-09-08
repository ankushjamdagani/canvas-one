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
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? "#c48212" : "#72b4b2",
          strokeWidth: selected ? 2 : 1.4,
          strokeDasharray: data?.communication === "async" ? "7 5" : data?.communication === "data" ? "2 4" : undefined,
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

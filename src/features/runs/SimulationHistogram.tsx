import { useMemo, useRef } from "react";
import type { Cycle } from "../../domain/studio/runner/types";
import type { PlaybackRange } from "./playback";
import { requestStartBins } from "./simulation-inspection-layout";

type Props = {
  cycles: readonly Cycle[];
  start: number;
  end: number;
  playhead: number;
  selection: PlaybackRange | null;
  height: 32 | 40 | 96;
  disabled?: boolean;
  expanded?: boolean;
  hasRun: boolean;
  emptyLabel?: string;
  onSeek(time: number): void;
  onRange(range: PlaybackRange): void;
};
export function SimulationHistogram({
  cycles,
  start,
  end,
  playhead,
  selection,
  height,
  disabled,
  expanded = false,
  hasRun,
  emptyLabel = "No run yet",
  onSeek,
  onRange,
}: Props) {
  const bins = useMemo(
    () => requestStartBins(cycles, start, end, 80),
    [cycles, start, end],
  );
  const maximum = Math.max(
    1,
    ...bins.map((bin) => bin.succeeded + bin.failed + bin.open),
  );
  const duration = Math.max(1, end - start);
  const drag = useRef<{ x: number; time: number; moved: boolean } | null>(null);
  const position = (value: number) =>
    Math.max(0, Math.min(100, ((value - start) / duration) * 100));
  const timeAt = (element: HTMLElement, x: number) => {
    const bounds = element.getBoundingClientRect();
    return (
      start +
      Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)) * duration
    );
  };
  return (
    <div
      className={
        expanded
          ? "shrink-0 border-b border-border px-4 pb-1.5 pt-3.5"
          : "min-w-0 flex-1"
      }
    >
      {expanded && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 font-mono text-[9px] text-secondary-text">
          <span>
            {hasRun
              ? `Requests started per ${(duration / 80).toFixed(0)} ms`
              : "Request timeline"}
          </span>
          {hasRun && (
            <>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-primary/50" />
                Succeeded
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-sm bg-risk" />
                Failed
              </span>
              <span className="ml-auto">
                Drag to select a range · click to move the playhead
              </span>
            </>
          )}
        </div>
      )}
      <div
        role="slider"
        aria-label={expanded ? "Simulation timeline" : "Simulation playhead"}
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={playhead}
        aria-valuetext={
          hasRun ? `${(playhead / 1000).toFixed(3)} seconds` : "Unavailable"
        }
        aria-disabled={disabled || !hasRun}
        tabIndex={disabled || !hasRun ? -1 : 0}
        data-testid={
          expanded ? "simulation-timeline-track" : "simulation-compact-timeline"
        }
        className={`relative flex min-w-0 touch-none cursor-crosshair items-end overflow-hidden focus-visible:outline-2 focus-visible:outline-ring ${expanded ? "gap-0.5 border-b border-control-border-strong" : "gap-px rounded-[6px] bg-sunken pt-[3px]"}`}
        style={{ height }}
        onPointerDown={(event) => {
          if (disabled || !hasRun) return;
          drag.current = {
            x: event.clientX,
            time: timeAt(event.currentTarget, event.clientX),
            moved: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || Math.abs(event.clientX - current.x) < 4) return;
          current.moved = true;
          const next = timeAt(event.currentTarget, event.clientX);
          onRange({
            startMs: Math.min(current.time, next),
            endMs: Math.max(current.time, next),
          });
        }}
        onPointerUp={() => {
          const current = drag.current;
          drag.current = null;
          if (current && !current.moved) onSeek(current.time);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (disabled || !hasRun) return;
          const target =
            event.key === "Home"
              ? start
              : event.key === "End"
                ? end
                : event.key === "ArrowLeft"
                  ? playhead - 10
                  : event.key === "ArrowRight"
                    ? playhead + 10
                    : null;
          if (target !== null) {
            event.preventDefault();
            onSeek(target);
          }
        }}
      >
        {hasRun && bins.map((bin, index) => {
          const played = start + (index / bins.length) * duration < playhead;
          return (
            <div
              key={index}
              aria-hidden="true"
              title={`${bin.succeeded} succeeded · ${bin.failed} failed · ${bin.open} open`}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <span
                className={played ? "bg-risk" : "bg-risk/35"}
                style={{ height: `${(bin.failed / maximum) * 92}%` }}
              />
              <span
                className="bg-muted-foreground/25"
                style={{ height: `${(bin.open / maximum) * 92}%` }}
              />
              <span
                className={played ? "bg-primary/60" : "bg-primary/25"}
                style={{ height: `${(bin.succeeded / maximum) * 92}%` }}
              />
            </div>
          );
        })}
        {selection && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 border-x-2 border-primary bg-primary/10"
            style={{
              left: `${position(selection.startMs)}%`,
              width: `${Math.max(0, position(selection.endMs) - position(selection.startMs))}%`,
            }}
          />
        )}
        {hasRun && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-foreground"
            style={{ left: `${position(playhead)}%` }}
          />
        )}
        {!hasRun && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-secondary-text">
            {emptyLabel}
          </span>
        )}
      </div>
      {expanded && (
        <div className="relative mt-1.5 flex h-4 justify-between font-mono text-[10px] text-secondary-text">
          {hasRun && Array.from({ length: 8 }, (_, index) => (
            <span key={index}>
              {((start + (duration * index) / 7) / 1000).toFixed(1)} s
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

import { useMemo } from "react";
import type { Cycle } from "../../domain/studio/runner/types";
import type { Fault } from "../../domain/studio/model";
import { Slider } from "../../components/ui/slider";
import {
  cycleBand,
  cycleDensity,
  formatPlaybackTime,
  timelinePosition,
  timelineUsesDensity,
  stuckMarkers,
} from "./timeline-layout";

const OUTCOME_CLASS = {
  ok: "bg-green",
  expired: "bg-clay",
  rejected: "bg-clay",
  "timed-out": "bg-clay",
  failed: "bg-risk-text",
  lost: "bg-risk-text",
  stuck: "bg-purple",
};
const outcomeClass = (outcome: Cycle["outcome"]) =>
  outcome === null ? "bg-secondary-text" : OUTCOME_CLASS[outcome];

export function PlaybackTimeline({
  cycles,
  faults,
  start,
  end,
  playhead,
  onSeek,
}: {
  cycles: readonly Cycle[];
  faults: readonly Fault[];
  start: number;
  end: number;
  playhead: number;
  onSeek(time: number): void;
}) {
  const density = timelineUsesDensity(cycles.length);
  const bins = useMemo(
    () => (density ? cycleDensity(cycles, start, end) : []),
    [cycles, start, end, density],
  );
  const stuck = useMemo(
    () => stuckMarkers(cycles, start, end),
    [cycles, start, end],
  );
  const peak = Math.max(1, ...bins);
  return (
    <div data-testid="playback-timeline" className="min-w-0 px-3 pb-2">
      <div className="flex justify-between font-mono text-[10px] text-secondary-text tabular-nums">
        <span>{formatPlaybackTime(start)}</span>
        <span data-testid="playback-computed-edge">
          Computed {formatPlaybackTime(end)}
        </span>
      </div>
      <div className="relative mt-1 border-y border-divider bg-sunken">
        <div className="max-h-24 overflow-y-auto" aria-label="Cycle recording">
          {density ? (
            <div
              data-testid="timeline-density"
              className="flex h-8 items-end"
              aria-label={`${cycles.length} cycles; peak ${peak} cycles per time bin`}
            >
              {bins.map((count, i) => (
                <div
                  key={i}
                  title={`${count} cycles intersect this time bin`}
                  className="flex-1 bg-primary"
                  style={{ height: `${(100 * count) / peak}%`, opacity: 0.65 }}
                />
              ))}
            </div>
          ) : cycles.length ? (
            cycles.map((cycle) => {
              const band = cycleBand(cycle, start, end);
              return (
                <div
                  key={cycle.id}
                  className="relative h-3 border-b border-divider/30"
                >
                  <button
                    type="button"
                    data-testid="timeline-cycle"
                    data-outcome={cycle.outcome ?? "open"}
                    aria-label={`Cycle ${cycle.id}, ${cycle.outcome ?? "in flight"}, ${formatPlaybackTime(cycle.startedAtMs)}`}
                    title={`${cycle.id}: ${cycle.outcome ?? "in flight"}`}
                    onClick={() => onSeek(cycle.startedAtMs)}
                    className={`absolute top-0.5 h-2 min-w-px cursor-pointer rounded-tag focus-visible:outline-2 focus-visible:outline-ring ${outcomeClass(cycle.outcome)}`}
                    style={{ left: `${band.left}%`, width: `${band.width}%` }}
                  />
                  {band.response !== null && (
                    <span
                      data-testid="timeline-response"
                      title="Response reached source"
                      className="pointer-events-none absolute top-0 h-3 w-px bg-foreground"
                      style={{ left: `${band.response}%` }}
                    />
                  )}
                </div>
              );
            })
          ) : (
            <div className="h-3" />
          )}
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
          style={{ left: `${timelinePosition(playhead, start, end)}%` }}
        />
      </div>
      <div className="relative h-3" aria-label="Fault and stuck markers">
        {faults
          .filter((fault) => fault.downAtMs <= end && fault.upAtMs >= start)
          .map((fault) => (
            <span
              key={fault.id}
              data-testid="timeline-fault"
              title={`Host unavailable ${formatPlaybackTime(fault.downAtMs)}–${formatPlaybackTime(fault.upAtMs)}`}
              className="absolute top-1 h-1 bg-risk-text/50"
              style={{
                left: `${timelinePosition(fault.downAtMs, start, end)}%`,
                width: `${Math.max(0.2, timelinePosition(fault.upAtMs, start, end) - timelinePosition(fault.downAtMs, start, end))}%`,
              }}
            />
          ))}
        {stuck.map((cycle) => (
          <span
            key={cycle.left}
            data-testid="timeline-stuck"
            title={`${cycle.count} stuck cycles`}
            className="absolute top-0.5 h-2 w-1 bg-risk-text"
            style={{
              left: `${cycle.left}%`,
            }}
          />
        ))}
      </div>
      <Slider
        min={start}
        max={Math.max(start + 1, end)}
        step={1}
        value={[playhead]}
        disabled={end <= start}
        onValueChange={([value]) => onSeek(value)}
        className="h-5 pointer-coarse:h-11"
        aria-label="Playback position"
        aria-valuetext={formatPlaybackTime(playhead)}
      />
    </div>
  );
}

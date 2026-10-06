import * as React from "react";
import {
  Hand,
  Maximize2,
  MousePointer2,
  Plus,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import type { Cycle } from "../../domain/studio/runner/types";
import type { Fault } from "../../domain/studio/model";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import type { PlaybackRange } from "./playback";
import {
  cycleDensity,
  formatPlaybackTime,
  timelinePosition,
} from "./timeline-layout";
import {
  clampWindow,
  moveRangeEndpoint,
  panWindow,
  rangeFromDrag,
  timeAtPosition,
  zoomWindow,
  type TimeWindow,
} from "./timeline-gestures";

type ToolMode = "seek" | "pan" | "zoom";
type DragMode = ToolMode | "playhead" | "range-start" | "range-end" | "pinch";
type Gesture = {
  mode: DragMode;
  pointerId: number;
  originX: number;
  latestX: number;
  anchorMs: number;
  originWindow: TimeWindow;
  originRange: PlaybackRange | null;
  pinchDistance?: number;
  pinchAnchorMs?: number;
};

const MIN_WINDOW_MS = 10;
const MIN_BIN_WIDTH = 12;

function formatRangeTime(ms: number) {
  return formatPlaybackTime(ms);
}

function formatSelectedTime(ms: number) {
  return `${(ms / 1000).toFixed(3)} s`;
}

function visuallyClampedPosition(time: number, window: TimeWindow) {
  return timelinePosition(time, window.startMs, window.endMs);
}

export function PlaybackTimeline({
  cycles,
  faults,
  start,
  end,
  playhead,
  onSeek,
  selection,
  onSelectRange,
  onWindowChange,
  actions,
  height = 96,
}: {
  cycles: readonly Cycle[];
  faults: readonly Fault[];
  /** Retained history start and end. */
  start: number;
  end: number;
  playhead: number;
  onSeek(time: number): void;
  selection: PlaybackRange | null;
  onSelectRange(range: PlaybackRange | null): void;
  onWindowChange?(window: TimeWindow): void;
  actions?: React.ReactNode;
  /** User-adjustable track height; controls and legends remain compact. */
  height?: number;
}) {
  const bounds = React.useMemo<TimeWindow>(
    () => ({ startMs: start, endMs: Math.max(start + 1, end) }),
    [start, end],
  );
  const [windowState, setWindowState] = React.useState<TimeWindow | null>(null);
  const [followsLatest, setFollowsLatest] = React.useState(true);
  const [tool, setTool] = React.useState<ToolMode>("seek");
  const [gesture, setGesture] = React.useState<Gesture | null>(null);
  const trackRef = React.useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = React.useState(768);
  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(([entry]) =>
      setTrackWidth(entry.contentRect.width),
    );
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
  const binCount = Math.max(
    1,
    Math.min(200, Math.floor(trackWidth / MIN_BIN_WIDTH)),
  );
  const pointers = React.useRef(new Map<number, number>());
  const onWindowChangeRef = React.useRef(onWindowChange);
  React.useEffect(() => {
    onWindowChangeRef.current = onWindowChange;
  }, [onWindowChange]);

  const visibleWindow = React.useMemo(
    () =>
      followsLatest
        ? bounds
        : clampWindow(windowState ?? bounds, bounds, MIN_WINDOW_MS),
    [bounds, followsLatest, windowState],
  );
  const bins = React.useMemo(
    () =>
      cycleDensity(
        cycles,
        visibleWindow.startMs,
        visibleWindow.endMs,
        binCount,
      ),
    [cycles, visibleWindow, binCount],
  );
  const failureBins = React.useMemo(() => {
    const counts = Array<number>(binCount).fill(0);
    const span = visibleWindow.endMs - visibleWindow.startMs;
    for (const cycle of cycles) {
      if (!cycle.outcome || cycle.outcome === "ok") continue;
      const time = cycle.completedAtMs ?? visibleWindow.endMs;
      if (time < visibleWindow.startMs || time > visibleWindow.endMs) continue;
      const index = Math.min(
        binCount - 1,
        Math.floor(((time - visibleWindow.startMs) / span) * binCount),
      );
      counts[index]++;
    }
    return counts;
  }, [cycles, visibleWindow]);
  const peak = Math.max(1, ...bins);
  const failurePeak = Math.max(1, ...failureBins);
  const visibleFaults = faults.filter(
    (fault) =>
      fault.downAtMs <= visibleWindow.endMs &&
      fault.upAtMs >= visibleWindow.startMs,
  );

  React.useEffect(() => {
    const clamped = followsLatest
      ? bounds
      : clampWindow(windowState ?? bounds, bounds, MIN_WINDOW_MS);
    if (
      windowState &&
      (windowState.startMs !== clamped.startMs ||
        windowState.endMs !== clamped.endMs)
    ) {
      setWindowState(clamped);
    }
    onWindowChangeRef.current?.(clamped);
  }, [bounds, followsLatest, windowState]);

  const updateWindow = React.useCallback(
    (next: TimeWindow, followLatest = false) => {
      const clamped = clampWindow(next, bounds, MIN_WINDOW_MS);
      setFollowsLatest(followLatest);
      setWindowState(followLatest ? null : clamped);
      onWindowChange?.(clamped);
    },
    [bounds, onWindowChange],
  );

  const updateRange = React.useCallback(
    (next: PlaybackRange | null) => {
      onSelectRange(next);
    },
    [onSelectRange],
  );

  const positionForEvent = React.useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return playhead;
      return timeAtPosition(clientX, rect.left, rect.width, visibleWindow);
    },
    [playhead, visibleWindow],
  );

  const beginGesture = React.useCallback(
    (event: React.PointerEvent<HTMLElement>, mode: DragMode) => {
      if (end <= start) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointers.current.set(event.pointerId, event.clientX);
      const currentTime = positionForEvent(event.clientX);
      setGesture((existing) => {
        if (existing && pointers.current.size >= 2) {
          const values = [...pointers.current.values()];
          return {
            ...existing,
            mode: "pinch",
            pointerId: event.pointerId,
            pinchDistance: Math.max(1, Math.abs(values[1] - values[0])),
            pinchAnchorMs: positionForEvent((values[0] + values[1]) / 2),
          };
        }
        return {
          mode,
          pointerId: event.pointerId,
          originX: event.clientX,
          latestX: event.clientX,
          anchorMs: currentTime,
          originWindow: visibleWindow,
          originRange: selection,
        };
      });
    },
    [end, positionForEvent, selection, start, visibleWindow],
  );

  const handleTrackPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if ((event.target as HTMLElement).closest("[data-timeline-control]"))
      return;
    beginGesture(event, tool);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!gesture || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, event.clientX);
    const active = gesture;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (active.mode === "pinch" && pointers.current.size >= 2) {
      const values = [...pointers.current.values()];
      const distance = Math.max(1, Math.abs(values[1] - values[0]));
      const anchorX = (values[0] + values[1]) / 2;
      const anchorMs = timeAtPosition(
        anchorX,
        rect.left,
        rect.width,
        active.originWindow,
      );
      updateWindow(
        zoomWindow(
          active.originWindow,
          active.pinchAnchorMs ?? anchorMs,
          distance / Math.max(1, active.pinchDistance ?? distance),
          bounds,
          MIN_WINDOW_MS,
        ),
      );
      return;
    }
    if (active.pointerId !== event.pointerId) return;
    const position = timeAtPosition(
      event.clientX,
      rect.left,
      rect.width,
      active.originWindow,
    );
    setGesture({ ...active, latestX: event.clientX });
    if (active.mode === "playhead") onSeek(position);
    if (active.mode === "pan") {
      updateWindow(
        panWindow(
          active.originWindow,
          event.clientX - active.originX,
          rect.width,
          bounds,
        ),
      );
    }
  };

  const finishPointer = (event: React.PointerEvent<HTMLElement>) => {
    const active = gesture;
    const rect = trackRef.current?.getBoundingClientRect();
    const finalTime = rect
      ? timeAtPosition(event.clientX, rect.left, rect.width, visibleWindow)
      : playhead;
    if (active && rect && active.mode !== "pinch") {
      const moved = Math.abs(active.latestX - active.originX) >= 5;
      if (active.mode === "seek") {
        if (moved)
          updateRange(
            rangeFromDrag(
              active.anchorMs,
              timeAtPosition(
                active.latestX,
                rect.left,
                rect.width,
                active.originWindow,
              ),
              bounds,
            ),
          );
        else onSeek(finalTime);
      } else if (active.mode === "zoom" && moved) {
        const to = timeAtPosition(
          active.latestX,
          rect.left,
          rect.width,
          active.originWindow,
        );
        const next = rangeFromDrag(
          active.anchorMs,
          to,
          active.originWindow,
          MIN_WINDOW_MS,
        );
        updateWindow(clampWindow(next, bounds, MIN_WINDOW_MS));
      } else if (active.mode === "playhead") onSeek(finalTime);
      else if (active.mode === "range-start" && active.originRange) {
        updateRange(
          moveRangeEndpoint(active.originRange, "start", finalTime, bounds),
        );
      } else if (active.mode === "range-end" && active.originRange) {
        updateRange(
          moveRangeEndpoint(active.originRange, "end", finalTime, bounds),
        );
      }
    }
    pointers.current.delete(event.pointerId);
    setGesture((current) =>
      current?.mode === "pinch" || current?.pointerId === event.pointerId
        ? null
        : current,
    );
  };

  const cancelPointer = (event: React.PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    setGesture((current) =>
      current?.mode === "pinch" || current?.pointerId === event.pointerId
        ? null
        : current,
    );
  };

  const zoomAt = (factor: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    const anchor = rect
      ? timeAtPosition(
          rect.left + rect.width / 2,
          rect.left,
          rect.width,
          visibleWindow,
        )
      : (visibleWindow.startMs + visibleWindow.endMs) / 2;
    updateWindow(
      zoomWindow(visibleWindow, anchor, factor, bounds, MIN_WINDOW_MS),
    );
  };

  React.useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = track.getBoundingClientRect();
      const anchor = timeAtPosition(
        event.clientX,
        rect.left,
        rect.width,
        visibleWindow,
      );
      updateWindow(
        zoomWindow(
          visibleWindow,
          anchor,
          Math.exp(-event.deltaY * 0.002),
          bounds,
          MIN_WINDOW_MS,
        ),
      );
    };
    track.addEventListener("wheel", handleWheel, { passive: false });
    return () => track.removeEventListener("wheel", handleWheel);
  }, [bounds, updateWindow, visibleWindow]);

  const keyboardEndpoint = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    endpoint: "start" | "end",
  ) => {
    if (!selection) return;
    const step = event.shiftKey
      ? 1000
      : Math.max(
          1,
          Math.round((visibleWindow.endMs - visibleWindow.startMs) / 100),
        );
    let nextTime = endpoint === "start" ? selection.startMs : selection.endMs;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown")
      nextTime -= step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp")
      nextTime += step;
    else if (event.key === "Home")
      nextTime = endpoint === "start" ? bounds.startMs : selection.startMs + 1;
    else if (event.key === "End")
      nextTime = endpoint === "end" ? bounds.endMs : selection.endMs - 1;
    else return;
    event.preventDefault();
    updateRange(moveRangeEndpoint(selection, endpoint, nextTime, bounds));
  };

  const playheadPosition = visuallyClampedPosition(playhead, visibleWindow);
  const rangeLeft = selection
    ? visuallyClampedPosition(selection.startMs, visibleWindow)
    : 0;
  const rangeRight = selection
    ? visuallyClampedPosition(selection.endMs, visibleWindow)
    : 0;
  const playheadVisible =
    playhead >= visibleWindow.startMs && playhead <= visibleWindow.endMs;
  const rangeStartVisible = Boolean(
    selection &&
    selection.startMs >= visibleWindow.startMs &&
    selection.startMs <= visibleWindow.endMs,
  );
  const rangeEndVisible = Boolean(
    selection &&
    selection.endMs >= visibleWindow.startMs &&
    selection.endMs <= visibleWindow.endMs,
  );
  const legendLabels = [
    {
      key: "window-start",
      testId: "timeline-window-start",
      text: formatSelectedTime(visibleWindow.startMs),
      desiredLeft: 0,
      edge: "left" as const,
    },
    ...(selection && rangeStartVisible
      ? [{
          key: "selection-start",
          testId: "timeline-selection-start-legend",
          text: formatSelectedTime(selection.startMs),
          desiredLeft: (rangeLeft * trackWidth) / 100,
          edge: "center" as const,
        }]
      : []),
    ...(selection && rangeEndVisible
      ? [{
          key: "selection-end",
          testId: "timeline-selection-end-legend",
          text: formatSelectedTime(selection.endMs),
          desiredLeft: (rangeRight * trackWidth) / 100,
          edge: "center" as const,
        }]
      : []),
    {
      key: "window-end",
      testId: "timeline-window-end",
      text: formatSelectedTime(visibleWindow.endMs),
      desiredLeft: trackWidth,
      edge: "right" as const,
    },
  ].map((label) => ({
    ...label,
    width: label.text.length * 6 + 4,
    desiredLeft:
      label.edge === "center"
        ? label.desiredLeft - (label.text.length * 6 + 4) / 2
        : label.edge === "right"
          ? label.desiredLeft - (label.text.length * 6 + 4)
          : label.desiredLeft,
  }));
  const legendPositions = (() => {
    const positions = legendLabels.map((label) =>
      Math.max(0, Math.min(trackWidth - label.width, label.desiredLeft)),
    );
    const gap = 4;
    for (let index = 1; index < positions.length; index++) {
      positions[index] = Math.max(
        positions[index],
        positions[index - 1] + legendLabels[index - 1].width + gap,
      );
    }
    for (let index = positions.length - 1; index >= 0; index--) {
      const maxLeft =
        index === positions.length - 1
          ? trackWidth - legendLabels[index].width
          : positions[index + 1] - gap - legendLabels[index].width;
      positions[index] = Math.min(positions[index], maxLeft);
    }
    return positions;
  })();
  const dragPreview =
    gesture?.mode === "seek" && Math.abs(gesture.latestX - gesture.originX) >= 5
      ? rangeFromDrag(
          gesture.anchorMs,
          positionForEvent(gesture.latestX),
          bounds,
        )
      : null;

  return (
    <div data-testid="playback-timeline" className="group relative min-w-0 px-3 pb-1">
      <div
        ref={trackRef}
        id="simulation-timeline-track"
        data-testid="timeline-track"
        data-tool={tool}
        className={`relative mt-1 touch-none select-none overflow-visible border-y border-divider bg-sunken ${tool === "pan" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}
        style={{ height: Math.max(64, height) }}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointer}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-11 touch-none [&_button]:pointer-events-auto"
          aria-label="Timeline handles"
        >
          {selection && (
            <>
              <RangeHandle
                endpoint="start"
                time={selection.startMs}
                position={rangeLeft}
                visible={rangeStartVisible}
                bounds={bounds}
                selection={selection}
                disabled={end <= start}
                onPointerDown={beginGesture}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointer}
                onPointerCancel={cancelPointer}
                onKeyDown={keyboardEndpoint}
              />
              <RangeHandle
                endpoint="end"
                time={selection.endMs}
                position={rangeRight}
                visible={rangeEndVisible}
                bounds={bounds}
                selection={selection}
                disabled={end <= start}
                onPointerDown={beginGesture}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointer}
                onPointerCancel={cancelPointer}
                onKeyDown={keyboardEndpoint}
              />
            </>
          )}
          <button
            type="button"
            data-timeline-control="playhead"
            data-testid="playback-playhead"
            role="slider"
            aria-label="Playback position"
            title={`Current time ${formatSelectedTime(playhead)}`}
            aria-valuemin={bounds.startMs}
            aria-valuemax={bounds.endMs}
            aria-valuenow={Math.round(playhead)}
            aria-valuetext={formatRangeTime(playhead)}
            className={`${playheadVisible ? "absolute top-5 h-6 w-11 pointer-coarse:top-11 pointer-coarse:h-11" : "sr-only"} z-20 cursor-ew-resize border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            style={
              playheadVisible
                ? {
                    left: `${playheadPosition}%`,
                    transform:
                      playheadPosition < 1
                        ? "translateX(0)"
                        : playheadPosition > 99
                          ? "translateX(-100%)"
                          : "translateX(-50%)",
                  }
                : undefined
            }
            onPointerDown={(event) => {
              if (!playheadVisible) return;
              event.stopPropagation();
              beginGesture(event, "playhead");
            }}
            onPointerMove={(event) => {
              event.stopPropagation();
              handlePointerMove(event);
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              finishPointer(event);
            }}
            onPointerCancel={(event) => {
              event.stopPropagation();
              cancelPointer(event);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey
                ? 1000
                : Math.max(
                    1,
                    Math.round(
                      (visibleWindow.endMs - visibleWindow.startMs) / 100,
                    ),
                  );
              if (event.key === "ArrowLeft" || event.key === "ArrowDown")
                onSeek(Math.max(start, playhead - step));
              else if (event.key === "ArrowRight" || event.key === "ArrowUp")
                onSeek(Math.min(end, playhead + step));
              else if (event.key === "Home") onSeek(start);
              else if (event.key === "End") onSeek(end);
              else return;
              event.preventDefault();
            }}
          >
            <span data-testid="playback-time" className="sr-only">
              {formatRangeTime(playhead)}
            </span>
            {playheadVisible && (
              <span
                aria-hidden="true"
                className="absolute top-4 h-2 w-px bg-foreground"
                style={{
                  left: `${playheadPosition < 1 ? 0 : playheadPosition > 99 ? 100 : 50}%`,
                }}
              />
            )}
          </button>
        </div>

        <div
          data-testid="timeline-density"
          aria-label={`${cycles.length} cycles; activity density across the visible recording window`}
          className="absolute inset-x-0 bottom-0 flex h-full items-end gap-px"
        >
          {bins.map((count, index) => (
            <div
              key={index}
              data-density-bin={index}
              title={`${count} cycles active during ${formatSelectedTime(visibleWindow.startMs + (index * (visibleWindow.endMs - visibleWindow.startMs)) / binCount)}–${formatSelectedTime(visibleWindow.startMs + ((index + 1) * (visibleWindow.endMs - visibleWindow.startMs)) / binCount)}`}
              className="min-w-0 flex-1 bg-primary"
              style={{
                height: `${Math.max(count ? 5 : 0, (100 * count) / peak)}%`,
                opacity: count ? 0.7 : 0,
              }}
            />
          ))}
        </div>
        <div
          data-testid="timeline-failure-density"
          aria-label="Recorded request failures, separate from authored host outage windows"
          className="pointer-events-none absolute inset-x-0 bottom-0 flex h-1 items-end gap-px"
        >
          {failureBins.map((count, index) => (
            <div
              key={index}
              title={
                count
                  ? `${count} failed request cycles in this time bin`
                  : undefined
              }
              className="min-w-0 flex-1 bg-risk-text"
              style={{
                height: count
                  ? `${Math.max(25, (100 * count) / failurePeak)}%`
                  : 0,
                opacity: count ? 0.9 : 0,
              }}
            />
          ))}
        </div>

        {selection && (
          <div
            data-testid="playback-range-highlight"
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 border-x border-primary bg-primary/10"
            style={{
              left: `${rangeLeft}%`,
              width: `${Math.max(0, rangeRight - rangeLeft)}%`,
            }}
          />
        )}
        {selection && rangeStartVisible && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary"
            style={{ left: `${rangeLeft}%` }}
          />
        )}
        {selection && rangeEndVisible && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary"
            style={{ left: `${rangeRight}%` }}
          />
        )}
        {playheadVisible && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground"
            style={{ left: `${playheadPosition}%` }}
          />
        )}
        {dragPreview && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 border-x border-primary bg-primary/10"
            style={{
              left: `${visuallyClampedPosition(dragPreview.startMs, visibleWindow)}%`,
              width: `${Math.max(0, visuallyClampedPosition(dragPreview.endMs, visibleWindow) - visuallyClampedPosition(dragPreview.startMs, visibleWindow))}%`,
            }}
          />
        )}

        {selection && (
          <div data-testid="playback-range" className="sr-only">
            {formatSelectedTime(selection.startMs)} to{" "}
            {formatSelectedTime(selection.endMs)}
          </div>
        )}
      </div>

      <div
        data-timeline-control="toolbar"
        className="absolute right-4 top-2 z-40 max-w-[calc(100%-2rem)] overflow-x-auto rounded border border-divider bg-shell/95 p-0.5 shadow-sm opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto pointer-coarse:static pointer-coarse:mt-1 pointer-coarse:w-full pointer-coarse:max-w-full pointer-coarse:overflow-x-auto pointer-coarse:rounded-none pointer-coarse:border-0 pointer-coarse:bg-transparent pointer-coarse:p-0 pointer-coarse:shadow-none pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onPointerCancel={(event) => event.stopPropagation()}
      >
        <div role="toolbar" aria-label="Timeline tools" className="flex w-max min-w-full flex-nowrap items-center justify-end gap-1 pointer-coarse:justify-start">
          <TooltipProvider delayDuration={250}>
            <TimelineTool
              label="Seek"
              pressed={tool === "seek"}
              onClick={() => setTool("seek")}
            >
              <MousePointer2 />
            </TimelineTool>
            <TimelineTool
              label="Pan"
              pressed={tool === "pan"}
              onClick={() => setTool("pan")}
            >
              <Hand />
            </TimelineTool>
            <TimelineTool
              label="Drag to zoom"
              pressed={tool === "zoom"}
              onClick={() => setTool("zoom")}
            >
              <ZoomIn />
            </TimelineTool>
            <TimelineTool label="Zoom in" onClick={() => zoomAt(2)}>
              <Plus />
            </TimelineTool>
            <TimelineTool label="Zoom out" onClick={() => zoomAt(0.5)}>
              <ZoomOut />
            </TimelineTool>
            <TimelineTool
              label="Fit recording"
              onClick={() => updateWindow(bounds, true)}
            >
              <Maximize2 />
            </TimelineTool>
            {selection && (
              <TimelineTool
                label="Clear selected range"
                onClick={() => onSelectRange(null)}
              >
                <X />
              </TimelineTool>
            )}
          </TooltipProvider>
          {actions}
        </div>
      </div>

      <div
        className="relative mt-1 h-4 font-mono text-[10px] tabular-nums"
        aria-label="Visible timeline window"
      >
        {legendLabels.map((label, index) => (
          <span
            key={label.key}
            data-testid={label.testId}
            title={label.text}
            className={`absolute top-0 z-20 whitespace-nowrap ${
              label.key.startsWith("selection-")
                ? "text-primary"
                : "text-secondary-text"
            }`}
            style={{ left: `clamp(0px, ${legendPositions[index]}px, calc(100% - ${label.width}px))`, width: label.width }}
          >
            {label.text}
          </span>
        ))}
      </div>
      <span data-testid="playback-time-total" className="sr-only">
        Recorded duration {formatRangeTime(end)}
      </span>
      {visibleFaults.length > 0 && <div
        className="relative mt-1 h-2"
        aria-label="Authored host fault windows"
      >
        <span className="sr-only">Authored host fault windows</span>
        {visibleFaults.map((fault) => {
          const left = visuallyClampedPosition(fault.downAtMs, visibleWindow);
          const right = visuallyClampedPosition(fault.upAtMs, visibleWindow);
          return (
            <span
              key={fault.id}
              data-testid="timeline-fault"
              title={`Authored host outage ${formatRangeTime(fault.downAtMs)}–${formatRangeTime(fault.upAtMs)}`}
              className="absolute top-0.5 h-1 border-x border-risk-text bg-risk-text/35"
              style={{
                left: `${left}%`,
                width: `${Math.max(0.2, right - left)}%`,
              }}
            />
          );
        })}
      </div>}
    </div>
  );
}

function TimelineTool({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={pressed ? "tint" : "ghost"}
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function RangeHandle({
  endpoint,
  time,
  position,
  visible,
  bounds,
  selection,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
}: {
  endpoint: "start" | "end";
  time: number;
  position: number;
  visible: boolean;
  bounds: TimeWindow;
  selection: PlaybackRange;
  disabled: boolean;
  onPointerDown(event: React.PointerEvent<HTMLElement>, mode: DragMode): void;
  onPointerMove(event: React.PointerEvent<HTMLElement>): void;
  onPointerUp(event: React.PointerEvent<HTMLElement>): void;
  onPointerCancel(event: React.PointerEvent<HTMLElement>): void;
  onKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    endpoint: "start" | "end",
  ): void;
}) {
  return (
    <button
      type="button"
      data-timeline-control="range-handle"
      data-testid={`playback-range-${endpoint}`}
      role="slider"
      aria-label={`Playback range ${endpoint}`}
      aria-valuemin={
        endpoint === "start" ? bounds.startMs : selection.startMs + 1
      }
      aria-valuemax={endpoint === "end" ? bounds.endMs : selection.endMs - 1}
      aria-valuenow={Math.round(time)}
      aria-valuetext={formatSelectedTime(time)}
      disabled={disabled}
      className={`${visible ? "absolute top-0 h-5 pointer-coarse:h-11 z-30 w-11" : "sr-only"} cursor-ew-resize border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      style={
        visible
          ? {
              left: `${position}%`,
              transform:
                position < 1
                  ? "translateX(0)"
                  : position > 99
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }
          : undefined
      }
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!visible) return;
        onPointerDown(
          event,
          endpoint === "start" ? "range-start" : "range-end",
        );
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        onPointerMove(event);
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        onPointerUp(event);
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        onPointerCancel(event);
      }}
      onKeyDown={(event) => onKeyDown(event, endpoint)}
    >
      <span className="sr-only">{formatSelectedTime(time)}</span>
      {visible && (
        <span
          aria-hidden="true"
          className="absolute top-4 h-7 w-1 -translate-x-1/2 rounded-full bg-primary"
          style={{ left: `${position < 1 ? 0 : position > 99 ? 100 : 50}%` }}
        />
      )}
    </button>
  );
}

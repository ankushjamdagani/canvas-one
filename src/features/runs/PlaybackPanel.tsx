import * as React from "react";
import {
  Pause,
  Play,
  Radio,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Scissors,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { NativeSelect } from "../../components/ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import type { RunController } from "./RunController";
import { ResultsRegion, type ResultsRegionProps } from "./ResultsRegion";
import { PlaybackTimeline } from "./PlaybackTimeline";
import { formatPlaybackTime } from "./timeline-layout";

function Tool({
  label,
  disabled,
  onClick,
  children,
  pressed,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 pointer-coarse:size-11 shrink-0"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function PlaybackPanel({
  controller,
  onRestart,
  ...results
}: ResultsRegionProps & {
  controller: RunController | null;
  onRestart(): void;
}) {
  const [, redraw] = React.useReducer((value) => value + 1, 0);
  React.useEffect(() => {
    let frame = 0;
    let last = "";
    const read = () => {
      const store = controller?.getPlayback();
      const value = store
        ? `${store.version}/${store.playheadMs}/${store.computedMs}/${store.windowStartMs}/${store.playing}/${store.ended}/${store.selection?.startMs}/${store.selection?.endMs}`
        : "";
      if (value !== last) {
        last = value;
        redraw();
      }
      frame = requestAnimationFrame(read);
    };
    read();
    return () => cancelAnimationFrame(frame);
  }, [controller]);
  const store = controller?.getPlayback();
  const at = store?.playheadMs ?? 0;
  const end = store?.computedMs ?? 0;
  const bounds = store?.windowStartMs ?? 0;
  const version = store?.version;
  const cycles = React.useMemo(
    () => store?.cyclesAt(end) ?? [],
    [store, end, version],
  );
  const checkpoint = store?.resultsAt(at) ?? null;
  const atEnd = store?.atEnd() ?? true;
  const measuredTime = store ? at : undefined;
  const change = (action: () => void) => {
    action();
    redraw();
  };
  const speed = controller?.getPlaybackSpeed() ?? 1;
  const active =
    results.runPhase === "running" ||
    results.runPhase === "paused" ||
    results.runPhase === "compiling";
  const status =
    results.runPhase === "compiling"
      ? "Preparing"
      : results.runPhase === "saving"
        ? "Saving"
        : results.staleRun
          ? "Earlier version"
          : store
            ? results.runPhase === "running" && controller?.getState().stopping
              ? "Draining"
              : atEnd
                ? results.terminal && results.terminal.status !== "completed"
                  ? results.terminal.status
                  : "Finished"
                : store.atSelectionEnd() && !store.playing
                  ? "Range ended"
                  : !store.playing
                    ? "Paused"
                    : store.atEdge()
                      ? "Computing"
                      : "Playing"
            : "Ready";
  return (
    <>
      {results.scenarioMode === "timed" && controller && (
        <section
          data-testid="playback-panel"
          aria-label="Timeline playback"
          className="w-full min-w-0 border-t border-divider bg-shell text-body"
        >
          <TooltipProvider delayDuration={300}>
            <div
              className="flex flex-wrap items-center gap-1 px-2 py-1"
              role="toolbar"
              aria-label="Playback controls"
            >
              <Tool
                label={
                  store?.playing
                    ? "Pause playback"
                    : store?.selection
                      ? "Play selected range"
                      : "Play recording"
                }
                disabled={!store}
                onClick={() =>
                  change(() =>
                    store?.playing ? controller.pause() : controller.resume(),
                  )
                }
              >
                {store?.playing ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </Tool>
              <Tool
                label="Previous cycle"
                disabled={!store || store.cycleStep(at, -1) === null}
                onClick={() => change(() => controller.stepCycle(-1))}
              >
                <SkipBack className="size-4" />
              </Tool>
              <Tool
                label="Next cycle"
                disabled={!store || store.cycleStep(at, 1) === null}
                onClick={() => change(() => controller.stepCycle(1))}
              >
                <SkipForward className="size-4" />
              </Tool>
              <NativeSelect
                data-testid="playback-speed"
                aria-label="Playback speed"
                value={speed}
                wrapperClassName="w-20 shrink-0"
                className="text-xs"
                onChange={(event) =>
                  change(() =>
                    controller.setPlaybackSpeed(Number(event.target.value)),
                  )
                }
              >
                {[0.25, 0.5, 1, 2, 4, 8, 16].map((value) => (
                  <option key={value} value={value}>
                    ×{value}
                  </option>
                ))}
              </NativeSelect>
              <Tool
                label={
                  store?.selection
                    ? "Clear playback range"
                    : "Select playback range"
                }
                pressed={Boolean(store?.selection)}
                disabled={
                  !store ||
                  end - bounds < 1 ||
                  results.runPhase === "saving" ||
                  controller.getState().stopping
                }
                onClick={() =>
                  change(() =>
                    controller.setPlaybackRange(
                      store?.selection ? null : { startMs: bounds, endMs: end },
                    ),
                  )
                }
              >
                <Scissors className="size-4" />
              </Tool>
              {store?.isStream && (
                <Tool
                  label="Go live"
                  disabled={store.ended}
                  onClick={() => change(() => controller.goLive())}
                >
                  <Radio className="size-4" />
                </Tool>
              )}
              {(!store?.isStream || store.selection) && (
                <label className="inline-flex h-8 pointer-coarse:h-11 items-center gap-1.5 px-1 text-xs">
                  <Checkbox
                    aria-label={
                      store?.selection
                        ? "Loop selected range"
                        : "Loop recording"
                    }
                    checked={controller.getLoop()}
                    disabled={!store?.ended && !store?.selection}
                    onCheckedChange={(checked) =>
                      change(() => controller.setLoop(checked === true))
                    }
                  />
                  Loop
                </label>
              )}
              <Tool
                label="Stop emission and drain"
                disabled={!active || controller.getState().stopping}
                onClick={() => change(() => controller.stop())}
              >
                <Square className="size-4" />
              </Tool>
              <Tool
                label="Restart scenario"
                disabled={active || results.runPhase === "saving"}
                onClick={onRestart}
              >
                <RotateCcw className="size-4" />
              </Tool>
              <span
                data-testid="playback-time"
                className="ml-auto shrink-0 font-mono text-[11px] tabular-nums"
              >
                {formatPlaybackTime(at)}
              </span>
              <span
                data-testid="playback-status"
                className="w-20 shrink-0 text-right text-[11px] text-secondary-text"
              >
                {status}
              </span>
            </div>
          </TooltipProvider>
          {store && (
            <PlaybackTimeline
              cycles={cycles}
              faults={controller.getPlaybackFaults()}
              start={bounds}
              end={end}
              playhead={at}
              onSeek={(time) => change(() => controller.seek(time))}
              selection={store.selection}
              onSelectRange={(range) =>
                change(() => controller.setPlaybackRange(range))
              }
            />
          )}
        </section>
      )}
      <ResultsRegion
        {...results}
        playbackSummary={checkpoint}
        playbackAtEnd={atEnd}
        currentTimeMs={measuredTime}
        runPhase={
          store && !atEnd && results.runPhase === "done"
            ? store.playing
              ? "running"
              : "paused"
            : results.runPhase
        }
      />
    </>
  );
}

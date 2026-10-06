import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  FastForward,
  Pause,
  Play,
  Radio,
  Repeat2,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import type { RunController } from "./RunController";
import type { FlowRecord } from "../../domain/studio/runner/types";
import type { PlaybackRange } from "./playback";
import { ResultsRegion, type ResultsRegionProps } from "./ResultsRegion";
import { PlaybackTimeline } from "./PlaybackTimeline";
import { lazyComponent } from "../../lib/lazyComponent";

const CycleInspection = lazyComponent(
  () => import("./CycleInspection").then((m) => m.CycleInspection),
  <p className="p-3 text-xs text-secondary-text">Loading recorded cycles…</p>,
);
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
const MIN_TIMELINE_HEIGHT = 0;
const MAX_TIMELINE_HEIGHT = 216;

function TimelineInspectionDivider({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange(value: number): void;
}) {
  const drag = React.useRef<{ y: number; value: number } | null>(null);
  const resize = (next: number) =>
    onChange(next < 32 ? 0 : Math.max(64, Math.min(max, next)));
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline and cycle inspection"
      aria-valuemin={MIN_TIMELINE_HEIGHT}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-controls="simulation-timeline-track cycle-inspection-content"
      data-testid="timeline-inspection-resize"
      tabIndex={0}
      className="relative z-10 flex h-2 shrink-0 cursor-row-resize touch-none items-center justify-center border-y border-divider bg-shell focus-visible:outline-2 focus-visible:outline-ring"
      onPointerDown={(event) => {
        drag.current = { y: event.clientY, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) resize(drag.current.value + event.clientY - drag.current.y);
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
          event.preventDefault(); resize(value - (event.shiftKey ? 32 : 12));
        } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
          event.preventDefault(); resize(value === 0 ? 64 : value + (event.shiftKey ? 32 : 12));
        } else if (event.key === "Home") {
          event.preventDefault(); resize(MIN_TIMELINE_HEIGHT);
        } else if (event.key === "End") {
          event.preventDefault(); resize(max);
        }
      }}
    >
      <span aria-hidden="true" className="h-0.5 w-8 rounded-full bg-muted-foreground/50" />
    </div>
  );
}

function Tool({
  label,
  disabled,
  onClick,
  children,
  pressed,
  primary = false,
  disabledReason,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
  pressed?: boolean;
  primary?: boolean;
  disabledReason?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0"
          tabIndex={disabled ? 0 : undefined}
          aria-label={disabled ? `${label}: ${disabledReason ?? "Unavailable"}` : undefined}
        >
          <Button
            variant={primary ? "default" : "ghost"}
            size="icon"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{disabled && disabledReason ? `${label}: ${disabledReason}` : label}</TooltipContent>
    </Tooltip>
  );
}
export function PlaybackPanel({
  controller,
  onRestart: _onRestart,
  setup,
  onReset,
  mobile = false,
  detailsBlocked = false,
  resultsVisible = true,
  resultsOpenRequest = 0,
  onEventSelect,
  connectionLabels,
  onDetailsOpenChange,
  onLocateEvent,
  canLocateEvent,
  onCompactHeightChange,
  ...results
}: ResultsRegionProps & {
  controller: RunController | null;
  onRestart(): void;
  setup?: React.ReactNode;
  onReset?: () => void;
  mobile?: boolean;
  detailsBlocked?: boolean;
  resultsVisible?: boolean;
  resultsOpenRequest?: number;
  onEventSelect?: (event: FlowRecord | null) => void;
  connectionLabels?: Record<string, string>;
  onDetailsOpenChange?: (open: boolean) => void;
  onLocateEvent?: (event: FlowRecord) => void;
  canLocateEvent?: (event: FlowRecord) => boolean;
  onCompactHeightChange?: (heightPx: number) => void;
}) {
  const [, redraw] = React.useReducer((value) => value + 1, 0);
  const [expanded, setExpanded] = React.useState(false);
  const [timelineHeight, setTimelineHeight] = React.useState(96);
  const timelineHeightRef = React.useRef(timelineHeight);
  timelineHeightRef.current = timelineHeight;
  const [maxTimelineHeight, setMaxTimelineHeight] = React.useState(MAX_TIMELINE_HEIGHT);
  const expandedBodyRef = React.useRef<HTMLDivElement>(null);
  const chromeRef = React.useRef<HTMLDivElement>(null);
  const [eventResetKey, resetEvent] = React.useReducer(value => value + 1, 0);
  const panelRef = React.useRef<HTMLElement>(null);
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const node = chromeRef.current;
    if (!node || !onCompactHeightChange || typeof ResizeObserver === "undefined") return;
    const report = () => onCompactHeightChange(Math.ceil(node.getBoundingClientRect().height));
    const observer = new ResizeObserver(report);
    observer.observe(node);
    report();
    return () => observer.disconnect();
  }, [onCompactHeightChange, mobile, expanded, timelineHeight, results.runId, results.terminal, detailsBlocked]);
  React.useEffect(() => {
    if (!panelRef.current) return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 720));
    observer.observe(panelRef.current);
    return () => observer.disconnect();
  }, []);
  const [view, setView] = React.useState<"cycles" | "results">("results");
  const [visibleWindow, setVisibleWindow] = React.useState<
    PlaybackRange | undefined
  >();
  React.useEffect(() => {
    if (!expanded || view !== "cycles") { onEventSelect?.(null); resetEvent(); }
  }, [expanded, view, onEventSelect]);
  React.useEffect(() => {
    let frame = 0,
      last = "";
    let pausedPoll = 0;
    const read = () => {
      frame = 0;
      pausedPoll = 0;
      const store = controller?.getPlayback();
      const value = store
        ? `${store.version}/${store.playheadMs}/${store.computedMs}/${store.windowStartMs}/${store.playing}/${store.ended}/${store.selection?.startMs}/${store.selection?.endMs}`
        : "";
      if (value !== last) {
        last = value;
        redraw();
      }
      if (store?.playing) frame = requestAnimationFrame(read);
      else if (store && !store.ended) pausedPoll = window.setTimeout(read, 250);
    };
    const unsubscribe = controller?.subscribe(() => {
      cancelAnimationFrame(frame);
      clearTimeout(pausedPoll);
      read();
    });
    read();
    return () => { unsubscribe?.(); cancelAnimationFrame(frame); clearTimeout(pausedPoll); };
  }, [controller]);
  React.useEffect(() => {
    setExpanded(false);
    setVisibleWindow(undefined);
  }, [results.runId]);
  React.useEffect(() => {
    if (resultsOpenRequest > 0) {
      setView("results");
      setExpanded(true);
    }
  }, [resultsOpenRequest]);
  React.useEffect(() => {
    const node = expandedBodyRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      // The body is the inspection viewport left after the chart chrome.
      // Let the chart use any space beyond a useful 120px inspection area.
      const available = Math.floor(timelineHeight + entry.contentRect.height - 120);
      const max = Math.max(64, Math.min(MAX_TIMELINE_HEIGHT, available));
      setMaxTimelineHeight(max);
      setTimelineHeight((height) => Math.min(height, max));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, mobile, detailsBlocked, timelineHeight]);
  React.useEffect(() => {
    const node = panelRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let previousHeight: number | null = null;
    const observer = new ResizeObserver(([entry]) => {
      const nextHeight = Math.floor(entry.contentRect.height);
      const wasResized = previousHeight !== null && Math.abs(nextHeight - previousHeight) > 1;
      previousHeight = nextHeight;
      // A closed recording can use manually assigned panel height for its chart.
      // A zero timeline is an explicit collapse and must remain collapsed.
      const currentTimelineHeight = timelineHeightRef.current;
      if (wasResized && !expanded && !mobile && controller?.getPlayback() && currentTimelineHeight > 0) {
        const chromeHeight = chromeRef.current?.getBoundingClientRect().height ?? 0;
        const nonTimelineChrome = chromeHeight - currentTimelineHeight;
        const available = Math.max(64, nextHeight - nonTimelineChrome);
        setMaxTimelineHeight(available);
        setTimelineHeight((height) => Math.abs(height - available) > 1 ? available : height);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, mobile, Boolean(controller), results.runId]);
  React.useEffect(() => {
    if (!resultsVisible || detailsBlocked) setExpanded(false);
  }, [resultsVisible, detailsBlocked]);
  React.useEffect(() => {
    onDetailsOpenChange?.(expanded && !detailsBlocked);
    return () => onDetailsOpenChange?.(false);
  }, [mobile, expanded, detailsBlocked, onDetailsOpenChange]);
  const store = controller?.getPlayback();
  const at = store?.playheadMs ?? 0,
    end = store?.computedMs ?? 0,
    bounds = store?.windowStartMs ?? 0;
  const version = store?.version;
  const cycles = React.useMemo(
    () => store?.cyclesAt(end) ?? [],
    [store, end, version],
  );
  const checkpoint = store?.resultsAt(at) ?? null;
  const atEnd = store?.atEnd() ?? true;
  const change = (action: () => void) => {
    action();
    redraw();
  };
  const speed = controller?.getPlaybackSpeed() ?? 1,
    speedIndex = SPEEDS.indexOf(speed);
  const busy =
    results.runPhase === "compiling" ||
    results.runPhase === "saving" ||
    Boolean(controller?.getState().stopping);
  const busyReason = results.runPhase === "compiling" ? "Preparing the simulation" : results.runPhase === "saving" ? "Saving the run" : "Draining in-flight work";
  const status =
    results.runPhase === "compiling"
      ? "Preparing"
      : results.runPhase === "saving"
        ? "Saving"
        : controller?.getState().stopping
          ? "Draining"
          : store?.atSelectionEnd() && !store.playing
            ? "Range ended"
            : (store?.ended && atEnd) || (!store && results.terminal && results.runPhase === "done")
              ? results.terminal?.status === "completed"
                ? "Completed"
                : (results.terminal?.status ?? "Finalizing")
              : store
                ? store.playing
                  ? "Running"
                  : "Paused"
                : results.runPhase === "running" ? "Running" : results.runPhase === "paused" ? "Paused" : "Ready";
  const renderResults = (showDetails: boolean) => (
    <ResultsRegion
      {...results}
      playbackSummary={checkpoint}
      playbackAtEnd={atEnd && (!store || store.ended)}
      currentTimeMs={store ? at : undefined}
      isExpanded={showDetails}
      hideDetailsToggle
      onToggleExpanded={() => {
        setView("results");
        setExpanded(!expanded || view !== "results");
      }}
      runPhase={
        store && !atEnd && results.runPhase === "done"
          ? store.playing
            ? "running"
            : "paused"
          : results.runPhase
      }
    />
  );
  const details = (
    <Tabs value={view} onValueChange={value => setView(value as "cycles" | "results")} className="flex h-full min-h-0 flex-col">
      <TabsContent value="cycles" forceMount className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
      {store && (
        <CycleInspection
          store={store}
          cycles={cycles}
          selection={store.selection}
          elementLabels={results.elementLabels}
          connectionLabels={connectionLabels}
          mobile={mobile || narrow}
          visibleWindow={visibleWindow}
          onEventSelect={onEventSelect}
          eventResetKey={eventResetKey}
          recordingChanged={results.staleRun}
          onLocateEvent={onLocateEvent}
          canLocateEvent={canLocateEvent}
          navigation={<TabsList className="flex shrink-0 px-2" aria-label="Simulation inspection">
            <TabsTrigger value="results" className="text-xs pointer-coarse:min-h-11">Run results</TabsTrigger>
            <TabsTrigger value="cycles" className="text-xs pointer-coarse:min-h-11" disabled={!store}>Request cycles</TabsTrigger>
          </TabsList>}
          onSeek={(time) => change(() => controller!.seek(time))}
        />
      )}
      </TabsContent>
      <TabsContent value="results" className="mt-0 min-h-0 flex-1 overflow-y-auto">
        <TabsList className="flex shrink-0 px-2" aria-label="Simulation inspection">
          <TabsTrigger value="results" className="text-xs pointer-coarse:min-h-11">Run results</TabsTrigger>
          <TabsTrigger value="cycles" className="text-xs pointer-coarse:min-h-11" disabled={!store}>Request cycles</TabsTrigger>
        </TabsList>
        {renderResults(true)}
      </TabsContent>
    </Tabs>
  );
  const timeline = store && controller ? (
    <PlaybackTimeline
      key={results.runId}
      cycles={cycles}
      faults={controller.getPlaybackFaults()}
      start={bounds}
      end={end}
      playhead={at}
      onSeek={(time) =>
        change(() => {
          onEventSelect?.(null);
          resetEvent();
          controller.seek(time);
        })
      }
      selection={store.selection}
      onSelectRange={(range) =>
        change(() => {
          onEventSelect?.(null);
          resetEvent();
          controller.setPlaybackRange(range);
          if (range) {
            setView("cycles");
            setExpanded(true);
          }
        })
      }
      onWindowChange={setVisibleWindow}
      height={timelineHeight}
    />
  ) : null;
  const inspectionToggle = (store || results.terminal) && (
    <Button
      variant="ghost"
      className="w-full shrink-0 rounded-none border-t border-divider py-1 text-xs min-h-8"
      aria-expanded={expanded}
      disabled={detailsBlocked}
      onClick={() => {
        if (!expanded) setView("results");
        setExpanded(!expanded);
      }}
    >
      <span>{store ? "Inspect Request Cycles" : "Inspect Run Results"}</span>
      {expanded ? <ChevronDown /> : <ChevronUp />}
    </Button>
  );
  return (
    <section
      ref={panelRef}
      data-testid="playback-panel"
      aria-label="Simulation and playback"
      className={mobile
        ? "w-full min-w-0 border-t border-divider bg-shell text-body"
        : "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-t border-divider bg-shell text-body"}
    >
      <TooltipProvider delayDuration={300}>
        <div ref={chromeRef} className="flex shrink-0 flex-col">
        <div
          className="flex shrink-0 flex-wrap items-center gap-1 px-2 py-1.5"
          aria-label="Simulation controls"
        >
          {setup}
          {onReset && (
            <Tool
              label="Reset simulation"
              disabled={results.runPhase === "saving"}
              onClick={onReset}
            >
              <RotateCcw />
            </Tool>
          )}
          <span
            data-testid="playback-status"
            role="status"
            className="w-24 shrink-0 text-xs text-secondary-text"
          >
            {status}
          </span>
          {results.scenarioMode === "timed" && controller && store && (
            <div
              role="toolbar"
              aria-label="Playback controls"
              className="ml-auto flex flex-wrap items-center gap-0.5 min-w-0"
            >
              <Tool
                label="Previous cycle"
                disabledReason={busy ? busyReason : "No earlier recorded cycle"}
                disabled={busy || store.cycleStep(at, -1) === null}
                onClick={() => change(() => controller.stepCycle(-1))}
              >
                <SkipBack />
              </Tool>
              <Tool
                label="Slower playback"
                disabledReason={busy ? busyReason : "Minimum speed is 0.25×"}
                disabled={busy || speedIndex <= 0}
                onClick={() =>
                  change(() =>
                    controller.setPlaybackSpeed(SPEEDS[speedIndex - 1]),
                  )
                }
              >
                <Rewind />
              </Tool>
              <Tool
                label={
                  store.playing
                    ? "Pause playback"
                    : store.selection
                      ? "Play selected range"
                      : "Play recording"
                }
                primary
                disabledReason={busyReason}
                disabled={busy}
                onClick={() =>
                  change(() =>
                    store.playing ? controller.pause() : controller.resume(),
                  )
                }
              >
                {store.playing ? <Pause /> : <Play />}
              </Tool>
              <Tool
                label="Stop playback"
                disabledReason={busyReason}
                disabled={busy}
                onClick={() =>
                  change(() =>
                    controller.seek(store.selection?.startMs ?? bounds),
                  )
                }
              >
                <Square />
              </Tool>
              <Tool
                label="Faster playback"
                disabledReason={busy ? busyReason : "Maximum speed is 16×"}
                disabled={busy || speedIndex >= SPEEDS.length - 1}
                onClick={() =>
                  change(() =>
                    controller.setPlaybackSpeed(SPEEDS[speedIndex + 1]),
                  )
                }
              >
                <FastForward />
              </Tool>
              <Tool
                label="Next cycle"
                disabledReason={busy ? busyReason : "No later recorded cycle"}
                disabled={busy || store.cycleStep(at, 1) === null}
                onClick={() => change(() => controller.stepCycle(1))}
              >
                <SkipForward />
              </Tool>
              <Tool
                label={
                  store.selection ? "Loop selected range" : "Loop recording"
                }
                pressed={controller.getLoop()}
                disabledReason={busy ? busyReason : "Select a recorded range or wait for completion"}
                disabled={busy || (!store.ended && !store.selection)}
                onClick={() =>
                  change(() => controller.setLoop(!controller.getLoop()))
                }
              >
                <Repeat2 />
              </Tool>
              <span
                data-testid="playback-speed"
                className="w-9 text-center text-[11px] tabular-nums"
              >
                {speed}×
              </span>
              {store.isStream && (
                <Tool
                  label="Go live"
                  disabledReason={busy ? busyReason : "This run has ended"}
                  disabled={busy || store.ended}
                  onClick={() => change(() => controller.goLive())}
                >
                  <Radio />
                </Tool>
              )}
            </div>
          )}
        </div>
        <div hidden={!mobile && timelineHeight === 0} className="min-w-0 shrink-0">{timeline}</div>
        {store && !mobile && <TimelineInspectionDivider value={timelineHeight} max={maxTimelineHeight} onChange={setTimelineHeight} />}
        {inspectionToggle}
        </div>
        {expanded && !mobile && !detailsBlocked && store && (
          <div ref={expandedBodyRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-divider">
            <div id="cycle-inspection-content" className="min-h-0 flex-1 overflow-y-auto">
              {details}
            </div>
          </div>
        )}
        {expanded && !mobile && !detailsBlocked && !store && (
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-divider">
            {details}
          </div>
        )}
        {mobile && (
          <Dialog open={expanded && !detailsBlocked} onOpenChange={setExpanded}>
            <DialogContent className="inset-x-0 bottom-0 top-auto left-0 translate-x-0 translate-y-0 max-w-none h-[65dvh] max-h-[65dvh] rounded-b-none p-0 gap-0 flex flex-col overflow-hidden">
              <DialogTitle className="px-3 pt-3 text-sm">
                Simulation inspection
              </DialogTitle>
              <DialogDescription className="sr-only">
                Request cycles and recorded simulation results
              </DialogDescription>
              <div className="min-h-0 flex-1 overflow-y-auto">{details}</div>
            </DialogContent>
          </Dialog>
        )}
      </TooltipProvider>
    </section>
  );
}

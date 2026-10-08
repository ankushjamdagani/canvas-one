import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Segmented } from "../../components/ui/segmented";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import type { FlowRecord } from "../../domain/studio/runner/types";
import type { RunController } from "./RunController";
import type { ResultsRegionProps } from "./ResultsRegion";
import type { ScenarioSwitcherEntry } from "../scenarios/ScenarioSwitcher";
import { lazyComponent } from "../../lib/lazyComponent";
import { SimulationHistogram } from "./SimulationHistogram";

const CycleInspection = lazyComponent(
  () => import("./CycleInspection").then((module) => module.CycleInspection),
  <p className="p-4 text-xs text-secondary-text">Loading recorded cycles…</p>,
);
const SPEEDS = [0.5, 1, 2, 4];

export type PlaybackPanelController = Pick<
  RunController,
  | "getPlayback"
  | "getState"
  | "subscribe"
  | "getPlaybackSpeed"
  | "setPlaybackSpeed"
  | "seek"
  | "setPlaybackRange"
  | "getLoop"
  | "setLoop"
  | "goLive"
  | "pause"
  | "resume"
  | "stop"
  | "finishAndSaveRecording"
>;
export type PlaybackPanelProps = ResultsRegionProps & {
  controller: PlaybackPanelController | null;
  scenarios?: readonly ScenarioSwitcherEntry[];
  selectedScenarioId?: string | null;
  onScenarioSelect?(id: string): void;
  onNewScenario?(): void;
  onDuplicateScenario?(id: string): void;
  onEditScenario?(id: string): void;
  onRenameScenario?(id: string): void;
  onDeleteScenario?(id: string): void;
  onRunScenario?(id: string): void;
  runDisabledReason?: string | null;
  onRestart(): void;
  onReset?(): void;
  mobile?: boolean;
  detailsBlocked?: boolean;
  resultsVisible?: boolean;
  resultsOpenRequest?: number;
  onDetailsOpenChange?(open: boolean): void;
  onCompactHeightChange?(height: number): void;
  availableHeight?: number;
  onLayoutModeChange?(mobile: boolean): void;
  onEventSelect?(event: FlowRecord | null): void;
  connectionLabels?: Record<string, string>;
  /** Existing host hooks remain optional; the source inspection has no locate tool. */
  onLocateEvent?(event: FlowRecord): void;
  canLocateEvent?(event: FlowRecord): boolean;
  setup?: React.ReactNode;
};

function TransportTool({
  label,
  disabled,
  onClick,
  children,
  mobile = false,
  primary = false,
  pressed,
  clear = false,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
  mobile?: boolean;
  primary?: boolean;
  pressed?: boolean;
  /** Desktop: the red-tinted clear button joined to the end of the Run button. */
  clear?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          title={label}
          variant={clear && !mobile ? "ghost" : primary ? "outline" : "ghost"}
          size="icon"
          disabled={disabled}
          onClick={onClick}
          className={
            mobile
              ? `${primary ? "w-[52px] rounded-[22px]" : "w-11 rounded-[10px]"} h-11 shrink-0`
              : clear
                ? "h-8 w-[34px] shrink-0 rounded-l-none rounded-r-[7px] border border-l-0 border-risk/30 bg-risk-tint text-risk-text hover:border-risk hover:bg-risk-tint [&_svg]:size-3.5"
                : `${primary ? "w-[34px] [&_svg]:size-3" : "w-[30px] [&_svg]:size-3.5"} h-8 shrink-0 rounded-[7px]`
          }
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
  scenarios = [],
  selectedScenarioId,
  onScenarioSelect,
  onNewScenario,
  onDuplicateScenario,
  onEditScenario,
  onRenameScenario,
  onDeleteScenario,
  onRunScenario,
  runDisabledReason,
  onRestart,
  onReset,
  mobile: mobileProp = false,
  detailsBlocked = false,
  resultsVisible = true,
  resultsOpenRequest = 0,
  onDetailsOpenChange,
  onCompactHeightChange,
  availableHeight = 900,
  onLayoutModeChange,
  onEventSelect,
  connectionLabels,
  ...results
}: PlaybackPanelProps) {
  const [, redraw] = React.useReducer((value) => value + 1, 0);
  const [expanded, setExpanded] = React.useState(false);
  const [stopped, setStopped] = React.useState(false);
  React.useEffect(() => {
    setStopped(false);
  }, [results.runId]);
  const [narrow, setNarrow] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [switchTarget, setSwitchTarget] =
    React.useState<ScenarioSwitcherEntry | null>(null);
  const [switchState, setSwitchState] = React.useState<
    "choice" | "saving" | "error"
  >("choice");
  const root = React.useRef<HTMLElement>(null);
  const chrome = React.useRef<HTMLDivElement>(null);
  const mobile = mobileProp || narrow;
  const canvasReserve = Math.min(120, Math.max(40, availableHeight * 0.2));
  const inspectorHeight = Math.min(
    440,
    Math.max(0, availableHeight - canvasReserve - 152),
  );
  React.useEffect(() => {
    onLayoutModeChange?.(mobile);
  }, [mobile, onLayoutModeChange]);
  React.useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 1200),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!chrome.current || !onCompactHeightChange) return;
    const measure = () =>
      onCompactHeightChange(
        Math.ceil(chrome.current!.getBoundingClientRect().height),
      );
    const observer = new ResizeObserver(measure);
    observer.observe(chrome.current);
    measure();
    return () => observer.disconnect();
  }, [onCompactHeightChange, mobile, expanded, results.runId]);
  React.useEffect(() => {
    let frame = 0,
      timer = 0,
      last = "";
    const read = () => {
      const store = controller?.getPlayback();
      const state = controller?.getState();
      const next = `${store?.version}/${store?.playheadMs}/${store?.computedMs}/${store?.playing}/${store?.ended}/${store?.following}/${store?.selection?.startMs}/${store?.selection?.endMs}/${state?.phase}/${state?.current?.saveStatus}`;
      if (last !== next) {
        last = next;
        redraw();
      }
      if (store?.playing) frame = requestAnimationFrame(read);
      else if (store && !store.ended) timer = window.setTimeout(read, 250);
    };
    const unsubscribe = controller?.subscribe(() => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      read();
    });
    read();
    return () => {
      unsubscribe?.();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [controller]);
  React.useEffect(() => {
    onEventSelect?.(null);
  }, [results.runId]);
  React.useEffect(() => {
    if (!resultsVisible || detailsBlocked) setExpanded(false);
  }, [resultsVisible, detailsBlocked]);
  React.useEffect(() => {
    onDetailsOpenChange?.(expanded && !detailsBlocked);
    return () => onDetailsOpenChange?.(false);
  }, [expanded, detailsBlocked, onDetailsOpenChange]);

  const store = controller?.getPlayback() ?? null;
  const controllerState = controller?.getState();
  const at = store?.playheadMs ?? 0;
  const end = store?.computedMs ?? 0;
  const start = store?.windowStartMs ?? 0;
  const cycles = React.useMemo(
    () => store?.cyclesAt(end) ?? [],
    [store, end, store?.version],
  );
  const active = Boolean(
    controllerState?.current &&
    !store?.ended &&
    (results.runPhase === "running" || results.runPhase === "paused"),
  );
  const hasRun = Boolean(
    controllerState?.current || results.runId || results.terminal,
  );
  const hasRecording = Boolean(store || results.terminal?.measured);
  React.useEffect(() => {
    if (resultsOpenRequest && hasRecording) setExpanded(true);
  }, [resultsOpenRequest, hasRecording]);
  React.useEffect(() => {
    if (!hasRecording) setExpanded(false);
  }, [hasRecording]);
  const busy =
    results.runPhase === "compiling" ||
    results.runPhase === "saving" ||
    Boolean(controllerState?.stopping);
  const status =
    results.runPhase === "compiling"
      ? "Preparing"
      : controllerState?.stopping
        ? "Draining"
        : results.runPhase === "saving"
          ? "Saving"
          : store?.ended
            ? store.playing
              ? "Replay"
              : stopped
                ? "Stopped"
                : "Complete"
            : active
              ? store?.playing === false || results.runPhase === "paused"
                ? "Paused"
                : store && !store.following
                  ? "Live · reviewing"
                  : "Live"
              : hasRun
                ? "Complete"
                : "Ready";
  const selectedScenario =
    scenarios.find((scenario) => scenario.id === selectedScenarioId) ??
    scenarios[0];
  const selectedNotReadyReason =
    selectedScenario?.status.kind === "not-ready"
      ? (selectedScenario.status.issues[0]?.message ?? "Scenario is not ready")
      : null;
  const disabledRunReason =
    runDisabledReason ??
    selectedNotReadyReason ??
    (!selectedScenario && !results.scenarioName
      ? "Add a scenario to run"
      : null);
  const speed = controller?.getPlaybackSpeed() ?? 1;
  const transportDisabled = busy || !store;
  const change = (action: () => void) => {
    action();
    redraw();
  };
  const clearEvent = () => onEventSelect?.(null);
  const seek = (time: number) =>
    change(() => {
      clearEvent();
      controller?.seek(time);
    });
  const selectRange = (range: { startMs: number; endMs: number }) =>
    change(() => {
      clearEvent();
      controller?.setPlaybackRange(range);
    });
  const clearRange = () => change(() => controller?.setPlaybackRange(null));
  const toEnd = () =>
    change(() => {
      clearEvent();
      if (store?.ended) controller?.seek(end);
      else controller?.goLive();
    });
  const togglePlay = () =>
    change(() => (store?.playing ? controller?.pause() : controller?.resume()));
  const selectScenario = (scenario: ScenarioSwitcherEntry) => {
    if (scenario.id === selectedScenario?.id) {
      setMenuOpen(false);
      return;
    }
    if (hasRun) {
      setSwitchTarget(scenario);
      setSwitchState("choice");
    } else {
      onScenarioSelect?.(scenario.id);
      setMenuOpen(false);
    }
  };
  const finishSwitch = (target: ScenarioSwitcherEntry) => {
    onReset?.();
    onScenarioSelect?.(target.id);
    setSwitchTarget(null);
    setMenuOpen(false);
    setSwitchState("choice");
  };
  const saveAndSwitch = async () => {
    if (!controller || !switchTarget) return;
    const target = switchTarget;
    setSwitchState("saving");
    const saved = await controller.finishAndSaveRecording();
    if (saved) finishSwitch(target);
    else setSwitchState("error");
  };
  const scenarioMenu = (
    <Popover
      open={menuOpen}
      onOpenChange={(open) => {
        if (switchState === "saving") return;
        setMenuOpen(open);
        if (!open) setSwitchTarget(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={mobile ? "ghost" : "outline"}
          className={
            mobile
              ? "h-9 min-w-0 max-w-[170px] justify-start px-1 text-sm font-semibold"
              : "h-8 max-w-60 shrink-0 justify-start rounded-[7px] px-2.5 text-xs"
          }
          aria-label="Select scenario"
          data-testid="scenario-switcher-trigger"
        >
          <span
            className={
              mobile
                ? "hidden"
                : "border-r border-border pr-2 text-xs font-normal text-inherit"
            }
          >
            Traffic
          </span>
          <span className="min-w-0 truncate font-semibold text-inherit">
            {selectedScenario?.label ?? results.scenarioName ?? "No scenario"}
          </span>
          <ChevronDown className="size-3 text-inherit" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-testid="scenario-switcher-popover"
        side="top"
        align="start"
        className="w-[280px] max-w-[calc(100vw-24px)] rounded-[11px] p-1"
      >
        {switchTarget ? (
          <div className="p-2.5">
            <h3 className="mb-2 text-xs font-semibold">
              Switch to {switchTarget.label}?
            </h3>
            <p className="mb-3 text-xs text-secondary-text">
              {switchState === "saving"
                ? "Finishing in-flight work and saving the current run…"
                : "Save the current recording, or discard it from this workspace. Saved runs are kept."}
            </p>
            {switchState === "error" && (
              <p role="alert" className="mb-3 text-xs text-risk-text">
                The run could not be saved. Retry before switching, or discard
                this recording.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={switchState === "saving"}
                onClick={() => void saveAndSwitch()}
              >
                {switchState === "error" ? "Retry save" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={switchState === "saving"}
                onClick={() => finishSwitch(switchTarget)}
              >
                Discard
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={switchState === "saving"}
                onClick={() => {
                  setSwitchTarget(null);
                  setMenuOpen(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {scenarios.map((scenario) => {
              const selected = selectedScenario?.id === scenario.id;
              const actions: readonly [
                string,
                React.ReactNode,
                ((id: string) => void) | undefined,
                string,
              ][] = [
                ["Edit", <Pencil key="edit" />, onEditScenario, ""],
                ["Duplicate", <Copy key="copy" />, onDuplicateScenario, ""],
                [
                  "Delete",
                  <Trash2 key="delete" />,
                  onDeleteScenario,
                  "text-risk-text hover:bg-risk-tint",
                ],
              ];
              return (
                <div
                  key={scenario.id}
                  data-testid={`scenario-item-${scenario.id}`}
                  data-selected={selected}
                  className={`flex items-center gap-2 rounded-[7px] pr-1.5 ${selected ? "bg-accent" : "hover:bg-sunken"}`}
                >
                  <button
                    type="button"
                    data-testid={`scenario-row-${scenario.id}`}
                    aria-pressed={selected}
                    onClick={() => selectScenario(scenario)}
                    className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-[7px] py-2 pl-2.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className={`truncate text-xs font-medium ${selected ? 'text-accent-foreground' : 'text-foreground'}`}>
                      {scenario.label}
                    </span>
                    <span className={`font-mono text-micro ${selected ? 'text-accent-foreground' : 'text-secondary-text'}`}>
                      {scenario.mode} simulation
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-px">
                    {actions.map(([label, icon, callback, tone]) => (
                      <Button
                        key={label}
                        type="button"
                        variant="ghost"
                        size="icon"
                        title={label}
                        aria-label={`${label} scenario ${scenario.label}`}
                        disabled={!callback}
                        className={`size-[26px] rounded-[6px] bg-background text-secondary-text [&_svg]:size-3 ${tone}`}
                        onClick={() => {
                          setMenuOpen(false);
                          callback?.(scenario.id);
                        }}
                      >
                        {icon}
                      </Button>
                    ))}
                  </div>
                </div>
              );
            })}
            {onNewScenario && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onNewScenario();
                }}
                className="mt-1 flex w-full items-center gap-2 rounded-b-[7px] border-t border-border px-2.5 py-2.5 text-left text-xs font-medium text-primary hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                New scenario
              </button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
  const primaryLabel = active
    ? "Stop run"
    : hasRun
      ? "Re-run scenario"
      : "Run scenario";
  // Desktop: a finished run's Run button is joined to a clear (trash) button.
  const joinClear = !mobile && hasRun && !active && Boolean(onReset);
  const primaryButton = (
    <Button
      data-testid="scenario-run-btn"
      aria-label={primaryLabel}
      title={
        active
          ? "Stop arrivals and finish in-flight work"
          : (disabledRunReason ?? primaryLabel)
      }
      disabled={busy || (!active && Boolean(disabledRunReason))}
      variant={active ? "tint" : mobile && hasRun ? "outline" : "default"}
      className={`${mobile ? (hasRun ? "size-11 rounded-[10px] px-0" : "h-11 w-20 rounded-[10px] px-0") : `h-8 shrink-0 px-3.5 text-ui [&_svg]:size-3 ${joinClear ? "rounded-l-[7px] rounded-r-none" : "rounded-[7px]"}`} ${active ? "border-risk/30 bg-risk-tint text-risk-text hover:border-risk hover:bg-risk-tint focus-visible:border-risk" : ""}`}
      onClick={() => {
        if (active) {
          setStopped(true);
          controller?.stop();
        } else if (selectedScenario && onRunScenario)
          onRunScenario(selectedScenario.id);
        else onRestart();
      }}
    >
      {active ? <Square /> : hasRun ? <RotateCcw /> : <Play />}
      {(!mobile || !hasRun) && (
        <span>{active ? "Stop run" : hasRun ? "Re-run" : "Run"}</span>
      )}
    </Button>
  );
  const reset = hasRun && !active && onReset && (
    <TransportTool
      label="Reset simulation"
      mobile={mobile}
      disabled={busy}
      onClick={onReset}
      clear
    >
      {mobile ? <Eraser /> : <Trash2 />}
    </TransportTool>
  );
  const inspect = (
    <Button
      variant={expanded ? "tint" : mobile ? "ghost" : "outline"}
      size={mobile ? "icon" : "default"}
      className={
        mobile
          ? "size-11 rounded-[10px]"
          : "h-8 shrink-0 rounded-[7px] px-2.5 text-xs [&_svg]:size-3.5"
      }
      aria-label="Inspect Request Cycles"
      aria-expanded={expanded}
      disabled={busy || detailsBlocked || !hasRecording}
      onClick={() => setExpanded(!expanded)}
    >
      {!mobile && "Inspect"}
      {expanded ? <ChevronDown /> : <ChevronUp />}
    </Button>
  );
  const loop = (
    <Button
      variant={controller?.getLoop() ? "tint" : mobile ? "ghost" : "outline"}
      size={mobile ? "icon" : "default"}
      className={
        mobile
          ? "size-11 rounded-[10px]"
          : "h-8 shrink-0 rounded-[7px] px-2.5 text-xs [&_svg]:size-3.5"
      }
      aria-label={store?.selection ? "Loop selected range" : "Loop recording"}
      aria-pressed={controller?.getLoop() ?? false}
      title="Loop the selected range, or the whole recording"
      disabled={transportDisabled}
      onClick={() => change(() => controller?.setLoop(!controller.getLoop()))}
    >
      <Repeat2 />
      {!mobile && "Loop"}
    </Button>
  );
  const playControls = (
    <div
      role="toolbar"
      aria-label="Playback controls"
      className={
        mobile
          ? "flex shrink-0 items-center gap-1"
          : "flex shrink-0 items-center gap-0.5"
      }
    >
      {!mobile && (
        <TransportTool
          label="Start of recording"
          disabled={transportDisabled}
          onClick={() => seek(start)}
        >
          <SkipBack />
        </TransportTool>
      )}
      <TransportTool
        label="Step back 10 ms"
        mobile={mobile}
        disabled={transportDisabled || at <= start}
        onClick={() => seek(at - 10)}
      >
        <ChevronLeft />
      </TransportTool>
      <TransportTool
        label={
          store?.playing
            ? "Pause playback"
            : store?.selection
              ? "Play selected range"
              : "Play recording"
        }
        mobile={mobile}
        primary
        disabled={transportDisabled}
        onClick={togglePlay}
      >
        {store?.playing ? <Pause /> : <Play />}
      </TransportTool>
      <TransportTool
        label="Step forward 10 ms"
        mobile={mobile}
        disabled={transportDisabled || at >= end}
        onClick={() => seek(at + 10)}
      >
        <ChevronRight />
      </TransportTool>
      {!mobile && (
        <TransportTool
          label={store && !store.ended ? "Back to live" : "End of recording"}
          disabled={transportDisabled}
          onClick={toEnd}
        >
          <SkipForward />
        </TransportTool>
      )}
    </div>
  );
  const histogram = (height: 32 | 40 | 96, chartExpanded = false) => (
    <SimulationHistogram
      cycles={cycles}
      start={start}
      end={end}
      playhead={at}
      selection={store?.selection ?? null}
      height={height}
      disabled={transportDisabled}
      expanded={chartExpanded}
      hasRun={Boolean(store)}
      emptyLabel={hasRecording ? "Timeline unavailable" : "No run yet"}
      onSeek={seek}
      onRange={selectRange}
    />
  );
  const statusLabel = (
    <span
      data-testid="playback-status"
      role="status"
      className={`flex shrink-0 items-center gap-[5px] whitespace-nowrap font-mono text-micro ${status.startsWith("Live") ? "text-primary" : "text-secondary-text"}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
  const details = (
    <CycleInspection
      store={store}
      cycles={cycles}
      recordedResult={Boolean(results.terminal?.measured)}
      recordedMetrics={results.terminal?.summary.elementMetrics ?? []}
      selection={store?.selection ?? null}
      elementLabels={results.elementLabels}
      connectionLabels={connectionLabels}
      mobile={mobile}
      inspectorHeight={inspectorHeight}
      recordingChanged={results.staleRun}
      onSeek={seek}
      onPlayFrom={(time) =>
        change(() => {
          controller?.seek(time);
          controller?.pause();
        })
      }
      onClearRange={clearRange}
      onClose={() => setExpanded(false)}
    />
  );
  const speedControl = mobile ? (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Playback speed"
      title="Playback speed"
      disabled={transportDisabled}
      className="size-11 rounded-[10px] font-mono text-xs"
      onClick={() =>
        change(() =>
          controller?.setPlaybackSpeed(
            SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length],
          ),
        )
      }
    >
      <span data-testid={store ? "playback-speed" : undefined}>{speed}×</span>
    </Button>
  ) : (
    <Segmented
      aria-label="Playback speed"
      disabled={transportDisabled}
      className="shrink-0 rounded-[7px] border-0"
      options={SPEEDS.map((value) => ({
        id: String(value),
        label: `${value}×`,
        className: "h-[26px] px-[7px] font-mono text-xs",
      }))}
      value={String(speed)}
      onChange={(value) =>
        change(() => controller?.setPlaybackSpeed(Number(value)))
      }
    />
  );
  const desktopTransport = (
    <div
      data-testid="simulation-transport"
      className="flex h-[52px] shrink-0 items-center gap-2.5 border-t border-border bg-shell px-3"
    >
      {scenarioMenu}
      <div className="flex shrink-0 items-center">
        {primaryButton}
        {reset}
      </div>
      <span className="h-[22px] w-px shrink-0 bg-border" />
      {playControls}
      {histogram(32)}
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-xs">
        {statusLabel}
        <time data-testid="playback-time">
          {store ? `${(at / 1000).toFixed(3)} s` : "—"}
        </time>
        <span className="text-secondary-text">
          / {store ? `${(end / 1000).toFixed(3)} s` : "—"}
        </span>
      </div>
      {speedControl}
      {store && (
        <span data-testid="playback-speed" className="sr-only">
          {speed}×
        </span>
      )}
      {loop}
      <span className="h-[22px] w-px shrink-0 bg-border" />
      {inspect}
    </div>
  );
  const mobileTransport = (
    <div
      data-testid="simulation-transport"
      className="relative z-[3] flex shrink-0 flex-col gap-2 border-t border-border bg-shell px-3 pt-2"
    >
      <div className="flex h-9 min-w-0 items-center gap-1 min-[390px]:gap-2">
        {scenarioMenu}
        <span className="flex-1" />
        {store && !store.ended && !store.following && (
          <Button
            variant="tint"
            disabled={busy}
            className="h-7 min-h-0 shrink-0 rounded-[6px] px-2 text-xs pointer-coarse:min-h-0"
            onClick={toEnd}
          >
            Back to live
          </Button>
        )}
        {statusLabel}
        <time
          data-testid="playback-time"
          className="shrink-0 whitespace-nowrap font-mono text-xs"
        >
          {hasRun ? `${(at / 1000).toFixed(3)} s` : "—"}
        </time>
      </div>
      {histogram(40)}
      <div className="flex h-[52px] items-center justify-between gap-1 overflow-x-auto">
        <div className="flex shrink-0 items-center">
          {primaryButton}
          {reset}
        </div>
        {playControls}
        {speedControl}
        {loop}
        {inspect}
      </div>
    </div>
  );
  return (
    <section
      ref={root}
      data-testid="playback-panel"
      aria-label="Simulation and playback"
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden text-foreground"
    >
      <TooltipProvider delayDuration={300}>
        {mobile ? (
          <div ref={chrome} className="flex shrink-0 flex-col">
            {expanded && !detailsBlocked && details}
            {mobileTransport}
          </div>
        ) : (
          <>
            <div ref={chrome} className="shrink-0">
              {desktopTransport}
            </div>
            {expanded && !detailsBlocked && (
              <div className="flex min-h-0 flex-1 flex-col border-t border-border bg-background">
                {histogram(96, true)}
                {details}
              </div>
            )}
          </>
        )}
      </TooltipProvider>
    </section>
  );
}

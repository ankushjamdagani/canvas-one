import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Play, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Segmented } from "../../components/ui/segmented";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import type {
  Cycle,
  FlowRecord,
  ElementMetric,
} from "../../domain/studio/runner/types";
import type { PlaybackRange, PlaybackStore } from "./playback";
import {
  ComponentMetrics,
  CycleWaterfall,
  RecordedEventRows,
  ScopeMetrics,
  ScopeMetricRows,
  scopeMetricRows,
  shortCycleLabel,
  formatSimulationTime,
  formatSimulationLatency,
} from "./SimulationInspection";

export type CycleInspectionProps = {
  store: PlaybackStore | null;
  cycles: readonly Cycle[];
  recordedResult?: boolean;
  recordedMetrics?: readonly ElementMetric[];
  selection: PlaybackRange | null;
  elementLabels: Record<string, string>;
  connectionLabels?: Record<string, string>;
  mobile?: boolean;
  inspectorHeight?: number;
  recordingChanged?: boolean;
  onSeek(time: number): void;
  onPlayFrom?(time: number): void;
  onClearRange?(): void;
  onClose?(): void;
  onEventSelect?(event: FlowRecord | null): void;
  eventResetKey?: number;
};

export function CycleInspection({
  store,
  cycles,
  recordedResult = false,
  recordedMetrics = [],
  selection,
  elementLabels,
  connectionLabels,
  mobile = false,
  inspectorHeight = 440,
  recordingChanged = false,
  onSeek,
  onPlayFrom,
  onClearRange,
  onClose,
}: CycleInspectionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState("components");
  const [mobileTab, setMobileTab] = useState("summary");
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [eventOffset, setEventOffset] = useState(0);
  const start = store?.inspectionHistoryStartMs ?? 0;
  const playhead = store?.playheadMs ?? 0;
  const range = selection ?? { startMs: start, endMs: playhead + 0.000001 };
  useEffect(() => {
    setSelectedId(null);
    setDetailTab("components");
    setOffset(0);
    setEventOffset(0);
  }, [selection?.startMs, selection?.endMs, store]);
  const selected = selectedId
    ? cycles.find((cycle) => cycle.id === selectedId)
    : undefined;
  const cycleLabels = useMemo(
    () =>
      Object.fromEntries(
        cycles.map((cycle, index) => [
          cycle.id,
          shortCycleLabel(cycle, index + 1),
        ]),
      ),
    [cycles],
  );
  const query = useMemo(
    () =>
      store?.cyclesOverlappingRange(range, {
        offset,
        limit: 120,
        failuresOnly,
      }) ?? { rows: [], total: 0 },
    [
      store,
      range.startMs,
      range.endMs,
      offset,
      failuresOnly,
      store?.inspectionVersion,
    ],
  );
  const all = useMemo(
    () =>
      store?.cyclesOverlappingRange(range, { limit: 1 }) ?? {
        rows: [],
        total: 0,
      },
    [store, range.startMs, range.endMs, store?.inspectionVersion],
  );
  const stats = useMemo(
    () => store?.statisticsForRange(range),
    [store, range.startMs, range.endMs, store?.inspectionVersion],
  );
  const metricRows = useMemo(
    () =>
      stats
        ? scopeMetricRows(stats, cycles, range)
        : [
            "Started",
            "Completed",
            "Failed",
            "Open at end",
            "Mean latency",
            "p95 latency",
          ].map((label, index) => ({
            id: ["started", "completed", "failed", "open", "mean", "p95"][
              index
            ],
            label,
            value: "Unavailable",
          })),
    [stats, cycles, range.startMs, range.endMs],
  );
  const wholeRange = {
    startMs: start,
    endMs: (store?.computedMs ?? 0) + 0.000001,
  };
  const wholeRows =
    mobile && store
      ? scopeMetricRows(
          store.statisticsForRange(wholeRange),
          cycles,
          wholeRange,
        )
      : metricRows;
  const eventsQuery = useMemo(
    () =>
      selected && store
        ? store.flowEventsForCycle(selected.id, {
            offset: eventOffset,
            limit: 120,
          })
        : { rows: [], total: 0 },
    [store, selected?.id, eventOffset, store?.flowInspectionVersion],
  );
  const scopeEvents = useMemo(() => {
    if (
      !store ||
      (mobile ? mobileTab !== "events" : selected || detailTab !== "events")
    )
      return { rows: [], total: 0 };
    const failedIds = new Set(
      cycles
        .filter((cycle) => cycle.outcome !== null && cycle.outcome !== "ok")
        .map((cycle) => cycle.id),
    );
    const events = store
      .flowBetween(range.startMs - 0.000001, range.endMs - 0.000001)
      .filter(
        (event) =>
          !failuresOnly || (event.cycleId && failedIds.has(event.cycleId)),
      );
    return {
      rows: events.slice(eventOffset, eventOffset + 120),
      total: events.length,
    };
  }, [
    store,
    mobile,
    mobileTab,
    selected?.id,
    detailTab,
    range.startMs,
    range.endMs,
    failuresOnly,
    cycles,
    eventOffset,
    store?.flowInspectionVersion,
  ]);
  const clearCycle = () => {
    setSelectedId(null);
    setDetailTab("components");
    setEventOffset(0);
  };
  const chooseCycle = (cycle: Cycle) => {
    setSelectedId(cycle.id);
    setDetailTab("timeline");
    setEventOffset(0);
  };
  const scopeLabel = store
    ? `${formatSimulationTime(range.startMs)}–${formatSimulationTime(selection?.endMs ?? playhead)}`
    : "—";
  const pageControls = query.total > 120 && (
    <div className="flex items-center justify-between border-t border-border px-3 py-1 text-[10px] text-secondary-text">
      <Button
        size="sm"
        variant="ghost"
        disabled={offset === 0}
        onClick={() => setOffset(Math.max(0, offset - 120))}
      >
        Previous
      </Button>
      <span>
        {offset + 1}–{Math.min(offset + query.rows.length, query.total)} /{" "}
        {query.total}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={offset + query.rows.length >= query.total}
        onClick={() => setOffset(offset + 120)}
      >
        Next
      </Button>
    </div>
  );
  const cycleList = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {query.rows.map((cycle, index) => {
          const latency =
            cycle.completedAtMs === null
              ? null
              : cycle.completedAtMs - cycle.startedAtMs;
          const shortId = cycleLabels[cycle.id];
          const outcome = cycle.outcome ?? "open";
          const failed = cycle.outcome !== null && cycle.outcome !== "ok";
          const tag = (
            <span
              className={`justify-self-end rounded-[4px] px-1.5 py-0.5 font-mono text-[10px] ${failed ? "bg-risk-tint text-risk-text" : cycle.outcome === null ? "bg-accent text-primary" : "bg-sunken text-secondary-text"}`}
            >
              {outcome}
            </span>
          );
          return (
            <button
              key={cycle.id}
              type="button"
              data-testid="cycle-inspection-row"
              data-cycle-id={cycle.id}
              title={cycle.id}
              aria-label={`Inspect request cycle ${cycle.id}`}
              aria-pressed={cycle.id === selectedId}
              onClick={() => chooseCycle(cycle)}
              className={
                mobile
                  ? "flex h-[52px] w-full items-center gap-2.5 border-b border-border px-4 text-left hover:bg-sunken focus-visible:outline-2 focus-visible:outline-ring"
                  : "grid h-[30px] w-full grid-cols-[62px_70px_minmax(0,1fr)_64px] items-center gap-2 border-b border-border px-4 text-left font-mono text-[11px] hover:bg-sunken aria-pressed:bg-accent aria-pressed:shadow-[inset_2px_0_0_var(--primary)] focus-visible:outline-2 focus-visible:outline-ring"
              }
            >
              {mobile ? (
                <>
                  <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className="font-mono text-[13px]">{shortId}</span>
                    <span className="font-mono text-[11px] text-secondary-text">
                      {formatSimulationTime(cycle.startedAtMs)} ·{" "}
                      {formatSimulationLatency(latency)}
                    </span>
                  </span>
                  {tag}
                  <ChevronRight className="size-4 text-secondary-text" />
                </>
              ) : (
                <>
                  <span>{shortId}</span>
                  <time className="text-secondary-text">
                    {formatSimulationTime(cycle.startedAtMs)}
                  </time>
                  <span
                    className="flex min-w-0 items-center gap-1.5"
                    title="All-work completion latency"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1 shrink-0 rounded-sm ${failed ? "bg-risk/40" : "bg-primary/35"}`}
                      style={{
                        width: `${Math.min(90, ((latency ?? 0) / 1000) * 90)}px`,
                      }}
                    />
                    <span className="whitespace-nowrap text-secondary-text">
                      {formatSimulationLatency(latency)}
                    </span>
                  </span>
                  {tag}
                </>
              )}
            </button>
          );
        })}
        {query.rows.length === 0 && (
          <p className="px-4 py-6 text-[13px] text-secondary-text">
            {store
              ? `No ${failuresOnly ? "failed " : ""}cycles in this scope.`
              : recordedResult
                ? "Cycle telemetry unavailable for this recorded result."
                : "Nothing recorded yet. Run the scenario to see results here."}
          </p>
        )}
      </div>
      {pageControls}
    </>
  );
  const eventList = (rows: readonly FlowRecord[], total: number) => (
    <>
      <RecordedEventRows
        events={rows}
        labels={elementLabels}
        connectionLabels={connectionLabels}
        mobile={mobile}
        includeCycleId={!selected}
        cycleLabels={cycleLabels}
      />
      {total > 120 && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-secondary-text">
          <Button
            size="sm"
            variant="ghost"
            disabled={eventOffset === 0}
            onClick={() => setEventOffset(Math.max(0, eventOffset - 120))}
          >
            Previous events
          </Button>
          <span>
            {eventOffset + 1}–{Math.min(eventOffset + rows.length, total)} /{" "}
            {total}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={eventOffset + rows.length >= total}
            onClick={() => setEventOffset(eventOffset + 120)}
          >
            More events
          </Button>
        </div>
      )}
    </>
  );
  const cycleDetails = selected && (
    <section
      aria-label="Selected cycle"
      className={
        mobile
          ? "flex flex-col gap-4 px-4 pb-5 pt-1.5"
          : "flex flex-col gap-3.5"
      }
    >
      {mobile && (
        <>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="h-11 px-0 text-sm text-primary"
              onClick={clearCycle}
            >
              <ArrowLeft className="size-4" />
              Cycles
            </Button>
            <span className="flex-1" />
            <Button
              variant="outline"
              className="h-9 rounded-[8px] px-3 text-[13px]"
              onClick={() => onPlayFrom?.(selected.startedAtMs)}
            >
              Play from {formatSimulationTime(selected.startedAtMs)}
            </Button>
          </div>
          <h3
            className="-mt-2 flex items-center gap-2.5 text-lg font-semibold"
            title={selected.id}
          >
            {cycleLabels[selected.id]}
            <span className="rounded-[4px] bg-sunken px-1.5 py-0.5 font-mono text-[10px] text-secondary-text">
              {selected.outcome ?? "open"}
            </span>
          </h3>
        </>
      )}
      {(mobile || detailTab === "timeline") && (
        <>
          <dl
            className={
              mobile ? "grid grid-cols-2 gap-3" : "grid grid-cols-4 gap-6"
            }
          >
            {[
              ["Started", formatSimulationTime(selected.startedAtMs)],
              ["Settled", formatSimulationTime(selected.completedAtMs)],
              [
                "Latency",
                formatSimulationLatency(
                  selected.completedAtMs === null
                    ? null
                    : selected.completedAtMs - selected.startedAtMs,
                ),
              ],
              [
                "Retries",
                eventsQuery.total > 120 ||
                (store?.isStream && selected.startedAtMs < start)
                  ? "Unavailable"
                  : String(
                      eventsQuery.rows.filter(
                        (event) => event.phase === "retry",
                      ).length,
                    ),
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-[3px]">
                <dt className="font-mono text-[9px] uppercase text-secondary-text">
                  {label}
                </dt>
                <dd
                  className={`font-mono ${mobile ? "text-sm" : "text-[13px]"}`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <CycleWaterfall
            cycle={selected}
            events={eventsQuery.rows}
            labels={elementLabels}
            mobile={mobile}
          />
          <p className="text-[10px] text-secondary-text">
            Full recorded all-work lifetime · source response{" "}
            {formatSimulationTime(selected.responseAtMs)}.{" "}
            {store?.isStream && selected.startedAtMs < start
              ? "Earlier lifecycle facts may be evicted."
              : ""}
          </p>
        </>
      )}
      {(mobile || detailTab === "events") &&
        eventList(eventsQuery.rows, eventsQuery.total)}
    </section>
  );
  if (mobile)
    return (
      <section
        aria-label="Simulation inspection"
        className="relative z-[2] flex shrink-0 flex-col overflow-hidden rounded-t-[16px] border-t border-border bg-background shadow-[0_-14px_28px_-20px_rgba(22,32,29,0.35)]"
        style={{ height: inspectorHeight }}
      >
        <div className="flex shrink-0 justify-center pb-0.5 pt-2">
          <span className="h-1 w-9 rounded-sm bg-control-border-strong" />
        </div>
        <div className="flex shrink-0 items-center gap-2 pb-2 pl-4 pr-2 pt-0.5">
          <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-[6px] bg-sunken px-2 font-mono text-[10px] text-secondary-text">
            <span className="truncate">
              {selection ? "RANGE" : "THROUGH PLAYHEAD"} {scopeLabel}
            </span>
            {selection && (
              <button
                type="button"
                onClick={onClearRange}
                aria-label="Clear range"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
          <span className="flex-1" />
          <label
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[13px] ${failuresOnly ? "border-risk/30 bg-risk-tint text-risk-text" : "border-control-border-strong"}`}
          >
            <input
              type="checkbox"
              className="size-3 accent-primary"
              checked={failuresOnly}
              onChange={(event) => {
                setFailuresOnly(event.target.checked);
                setOffset(0);
              }}
            />
            Failures
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 rounded-[8px]"
            aria-label="Close inspection"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
        <Segmented
          aria-label="Simulation inspection"
          className="mx-4 mb-2.5 flex shrink-0 rounded-[9px] border-0"
          options={[
            {
              id: "summary",
              label: "Summary",
              className: "h-10 flex-1 text-[13px]",
            },
            {
              id: "cycles",
              label: "Cycles",
              className: "h-10 flex-1 text-[13px]",
            },
            {
              id: "parts",
              label: "Parts",
              className: "h-10 flex-1 text-[13px]",
            },
            {
              id: "events",
              label: "Events",
              className: "h-10 flex-1 text-[13px]",
            },
          ]}
          value={mobileTab}
          onChange={(value) => {
            setMobileTab(value);
            clearCycle();
            setOffset(0);
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border">
          {!store && !recordedResult ? (
            <p className="p-4 text-sm text-secondary-text">
              Nothing recorded yet. Run the scenario to see results here.
            </p>
          ) : mobileTab === "summary" ? (
            <div className="flex flex-col gap-3.5 px-4 pb-5 pt-3.5">
              <ScopeMetricRows rows={metricRows} cards />
              <p className="text-[13px] leading-relaxed text-secondary-text">
                {store
                  ? "Starts and completions observed in this interval. Latency uses successful all-work completions."
                  : "Cycle and timeline telemetry are unavailable for this recorded result."}
              </p>
              <div className="border-t border-border pt-2.5">
                <h3 className="mb-1 font-mono text-[9px] text-secondary-text">
                  {store?.ended || recordedResult
                    ? "WHOLE RECORDING"
                    : "RECORDED SO FAR"}
                </h3>
                <ScopeMetricRows rows={wholeRows} prefix="whole" />
              </div>
            </div>
          ) : mobileTab === "cycles" ? (
            selected ? (
              cycleDetails
            ) : (
              cycleList
            )
          ) : mobileTab === "parts" ? (
            <div className="px-4">
              <ComponentMetrics
                store={store}
                labels={elementLabels}
                recordedMetrics={recordedMetrics}
                mobile
              />
            </div>
          ) : (
            <div className="px-4">
              {eventList(scopeEvents.rows, scopeEvents.total)}
            </div>
          )}
        </div>
      </section>
    );
  return (
    <section
      aria-label="Simulation inspection"
      className="grid min-h-0 flex-1 grid-cols-[280px_420px_minmax(0,1fr)] overflow-hidden bg-background"
    >
      <aside
        data-testid="simulation-scope-pane"
        className="min-h-0 overflow-y-auto border-r border-border bg-shell p-4"
      >
        {(stats || recordedResult) && (
          <ScopeMetrics
            range={{ ...range, endMs: selection?.endMs ?? playhead }}
            selection={selection}
            available={Boolean(store)}
            rows={metricRows}
            onClear={() => onClearRange?.()}
            historyStart={store?.isStream ? start : undefined}
          />
        )}
        {recordingChanged && (
          <p className="mt-3 text-[10px] text-secondary-text">
            Recorded on an earlier design version.
          </p>
        )}
      </aside>
      <section
        aria-label="Request cycles"
        id="cycle-list-pane"
        className="flex min-h-0 flex-col border-r border-border"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pl-4 pr-3">
          <h3 className="text-[13px] font-semibold">Request cycles</h3>
          <span className="font-mono text-[10px] text-secondary-text">
            {store ? all.total : "—"}
          </span>
          <span className="flex-1" />
          <Segmented
            aria-label="Cycle outcome filter"
            className="border-0"
            options={["All", "Failed"]}
            value={failuresOnly ? "Failed" : "All"}
            onChange={(value) => {
              setFailuresOnly(value === "Failed");
              setOffset(0);
            }}
          />
        </header>
        {cycleList}
      </section>
      <section
        id="cycle-inspection-detail"
        className="flex min-h-0 min-w-0 flex-col"
      >
        <Tabs
          className="flex min-h-0 flex-1 flex-col"
          value={detailTab}
          onValueChange={(value) => {
            setDetailTab(value);
            setEventOffset(0);
          }}
        >
          <TabsList
            aria-label={selected ? "Cycle details" : "Scope details"}
            className="flex h-10 w-full shrink-0 items-stretch gap-[18px] px-5"
          >
            {selected && (
              <span
                className="flex items-center gap-2 text-[13px] font-semibold"
                title={selected.id}
              >
                Cycle {cycleLabels[selected.id]}
                <button
                  type="button"
                  aria-label="Back to range"
                  onClick={clearCycle}
                >
                  <X className="size-3 text-secondary-text" />
                </button>
              </span>
            )}
            <TabsTrigger
              value={selected ? "timeline" : "components"}
              className="px-0 py-0 text-[13px]"
            >
              {selected ? "Timeline" : "Components"}
            </TabsTrigger>
            <TabsTrigger value="events" className="px-0 py-0 text-[13px]">
              Events
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value={selected ? "timeline" : "components"}
            forceMount
            hidden={detailTab !== (selected ? "timeline" : "components")}
            className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-3.5"
          >
            {detailTab !== "events" &&
              (selected
                ? cycleDetails
                : (store || recordedResult) && (
                    <ComponentMetrics
                      store={store}
                      labels={elementLabels}
                      recordedMetrics={recordedMetrics}
                    />
                  ))}
          </TabsContent>
          <TabsContent
            value="events"
            forceMount
            hidden={detailTab !== "events"}
            className="mt-0 min-h-0 flex-1 overflow-y-auto px-5 py-3.5"
          >
            {detailTab === "events" &&
              (selected
                ? cycleDetails
                : eventList(scopeEvents.rows, scopeEvents.total))}
          </TabsContent>
        </Tabs>
      </section>
    </section>
  );
}

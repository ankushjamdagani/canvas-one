import type {
  Cycle,
  FlowRecord,
  ElementMetric,
} from "../../domain/studio/runner/types";
import type { PlaybackRange, PlaybackStore } from "./playback";
import type { CycleIntervalStatistics } from "./cycle-inspection-query";
import {
  recordedProcessingIntervals,
  intervalPosition,
  processingAttemptLabel,
} from "./simulation-inspection-layout";

export const formatSimulationTime = (value: number | null) =>
  value === null ? "—" : `${(value / 1000).toFixed(3)} s`;
export const formatSimulationLatency = (value: number | null) =>
  value === null ? "—" : `${value.toFixed(1)} ms`;
export function shortCycleLabel(cycle: Cycle, ordinal: number) {
  const suffix = cycle.id.match(/(?:-|:)(\d+)$/)?.[1];
  return `c-${String(suffix ?? ordinal).padStart(4, "0")}`;
}
export function scopeMetricRows(
  stats: CycleIntervalStatistics,
  cycles: readonly Cycle[],
  range: PlaybackRange,
) {
  const successful = cycles.filter(
    (cycle) =>
      cycle.outcome === "ok" &&
      cycle.completedAtMs !== null &&
      cycle.completedAtMs >= range.startMs &&
      cycle.completedAtMs < range.endMs,
  );
  const latencies = successful
    .map((cycle) => cycle.completedAtMs! - cycle.startedAtMs)
    .sort((a, b) => a - b);
  const mean = latencies.length
    ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    : null;
  const p95 = latencies.length
    ? latencies[Math.ceil(latencies.length * 0.95) - 1]
    : null;
  return [
    { id: "started", label: "Started", value: stats.starts.toLocaleString() },
    {
      id: "completed",
      label: "Completed",
      value: stats.completions.toLocaleString(),
    },
    { id: "failed", label: "Failed", value: stats.failures.toLocaleString() },
    {
      id: "open",
      label: "Open at end",
      value: stats.activeAtEnd.toLocaleString(),
    },
    {
      id: "mean",
      label: "Mean latency",
      value: mean === null ? "Unavailable" : formatSimulationLatency(mean),
    },
    {
      id: "p95",
      label: "p95 latency",
      value: p95 === null ? "Unavailable" : formatSimulationLatency(p95),
    },
  ];
}
type MetricRows = ReturnType<typeof scopeMetricRows>;
export function ScopeMetricRows({
  rows,
  cards = false,
  prefix = "scope",
}: {
  rows: MetricRows;
  cards?: boolean;
  prefix?: string;
}) {
  return (
    <dl className={cards ? "grid grid-cols-2 gap-2" : "flex flex-col"}>
      {rows.map((row) => (
        <div
          key={row.id}
          className={
            cards
              ? "flex flex-col gap-[5px] rounded-[10px] border border-border p-3"
              : "flex h-[30px] items-baseline justify-between border-b border-border pt-1.5"
          }
        >
          <dt
            className={
              cards
                ? "font-mono text-[9px] uppercase text-secondary-text"
                : "text-[13px] text-secondary-text"
            }
          >
            {row.label}
          </dt>
          <dd
            data-testid={`${prefix}-${row.id}`}
            className={`font-mono ${cards ? "text-[19px]" : "text-[13px]"} ${row.id === "failed" && row.value !== "0" ? "text-risk-text" : ""}`}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ScopeMetrics({
  range,
  selection,
  rows,
  onClear,
  historyStart,
  available = true,
}: {
  range: PlaybackRange;
  selection: PlaybackRange | null;
  rows: MetricRows;
  onClear(): void;
  historyStart?: number;
  available?: boolean;
}) {
  return (
    <section
      aria-label="Measured inspection scope"
      className="flex flex-col gap-3.5"
    >
      <div className="flex items-center justify-between font-mono text-[9px] text-secondary-text">
        <span>{selection ? "RANGE" : "THROUGH PLAYHEAD"}</span>
        {selection && (
          <button
            type="button"
            onClick={onClear}
            className="font-sans text-xs text-primary focus-visible:outline-2 focus-visible:outline-ring"
          >
            Clear
          </button>
        )}
      </div>
      <span className="-mt-2 font-mono text-[15px]">
        {available
          ? `${formatSimulationTime(range.startMs)}–${formatSimulationTime(selection?.endMs ?? range.endMs)}`
          : "—"}
      </span>
      <ScopeMetricRows rows={rows} />
      <p className="text-xs leading-relaxed text-secondary-text">
        {available
          ? "Starts and all-work completions observed in this interval. Latency uses successful all-work completions."
          : "Cycle and timeline telemetry are unavailable for this recorded result."}
      </p>
      {historyStart !== undefined && historyStart > 0 && (
        <p className="text-xs text-secondary-text">
          Retained history begins at {formatSimulationTime(historyStart)}.
        </p>
      )}
    </section>
  );
}

/** Metrics are recorded cumulative observations, never inferred interval averages. */
export function ComponentMetrics({
  store,
  labels,
  mobile = false,
  recordedMetrics = [],
}: {
  store: PlaybackStore | null;
  recordedMetrics?: readonly ElementMetric[];
  labels: Record<string, string>;
  mobile?: boolean;
}) {
  const metrics = store
    ? (store.resultsAt(store.playheadMs)?.elementMetrics ?? [])
    : recordedMetrics;
  const metric = (id: string, key: string) =>
    metrics.find(
      (row) =>
        row.elementId === id && row.key === key && row.scope === "element",
    );
  const value = (id: string, key: string, suffix = "") => {
    const row = metric(id, key);
    return (
      <span
        title={row?.reason ?? "Not recorded at this playhead"}
        aria-label={
          !row?.available || row.value === null
            ? `Unavailable: ${row?.reason ?? "not recorded at this playhead"}`
            : undefined
        }
      >
        {row?.available && row.value !== null
          ? `${row.value.toFixed(key === "failed" ? 0 : 1)}${suffix}`
          : "—"}
      </span>
    );
  };
  return (
    <section aria-label="Measured component metrics">
      <p className="mb-2 text-[10px] text-secondary-text">
        {store ? "Through playhead" : "Whole recorded result"} ·
        successful-cohort mean / p95 · time-average utilization. — unavailable.
      </p>
      {Object.entries(labels).map(([id, label]) => {
        const observed = metric(id, "utilization");
        const utilization =
          observed?.available && observed.value !== null
            ? Math.max(0, Math.min(100, observed.value * 100))
            : null;
        const utilBar = (
          <span className="block h-1.5 flex-1 overflow-hidden rounded-[3px] bg-sunken">
            <span
              className="block h-full bg-primary/70"
              style={{ width: `${utilization ?? 0}%` }}
            />
          </span>
        );
        return mobile ? (
          <div
            key={id}
            className="flex flex-col gap-[7px] border-b border-border py-3"
          >
            <div className="flex items-center gap-2">
              <span className="h-3.5 w-[3px] rounded-sm bg-primary" />
              <span className="min-w-0 flex-1 text-sm font-medium">
                {label}
              </span>
              <span className="font-mono text-xs">
                {utilization === null ? "—" : `${utilization.toFixed(1)}%`}
              </span>
            </div>
            {utilBar}
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11px] text-secondary-text">
              <span title="Handled is not recorded">— handled</span>
              <span>{value(id, "failed")} failed</span>
              <span>mean {value(id, "meanLatencyMs", " ms")}</span>
              <span>p95 {value(id, "p95LatencyMs", " ms")}</span>
            </div>
          </div>
        ) : (
          <div
            key={id}
            className="grid min-h-[38px] grid-cols-[minmax(0,1fr)_56px_120px_100px] items-center gap-3 border-b border-border font-mono text-[11px]"
          >
            <span className="flex min-w-0 items-center gap-2 font-sans text-[13px] font-medium">
              <span className="h-4 w-[3px] shrink-0 rounded-sm bg-primary" />
              <span className="truncate" title={label}>
                {label}
              </span>
            </span>
            <span>{value(id, "failed")} fail</span>
            <span className="flex flex-col text-[10px]">
              <span>mean {value(id, "meanLatencyMs", " ms")}</span>
              <span>p95 {value(id, "p95LatencyMs", " ms")}</span>
            </span>
            <span
              className="flex items-center gap-2"
              title={observed?.reason ?? "Time-average utilization"}
            >
              {utilBar}
              <span>
                {utilization === null ? "—" : `${utilization.toFixed(0)}%`}
              </span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** Exact processing facts, including retained attempts; missing end stays unavailable. */
export function CycleWaterfall({
  cycle,
  events,
  labels,
  mobile = false,
}: {
  cycle: Cycle;
  events: readonly FlowRecord[];
  labels: Record<string, string>;
  mobile?: boolean;
}) {
  const end =
    cycle.completedAtMs ??
    Math.max(cycle.startedAtMs + 1, ...events.map((event) => event.atMs));
  const duration = Math.max(1, end - cycle.startedAtMs);
  const intervals = recordedProcessingIntervals(events).slice(0, 40);
  return (
    <section
      aria-label="Recorded cycle timeline"
      className={
        mobile
          ? "flex flex-col gap-2.5 border-t border-border pt-3"
          : "flex flex-col gap-1.5"
      }
    >
      {intervals.map(({ event, stop }, index) => {
        const position = intervalPosition(
          event.atMs,
          stop?.atMs,
          cycle.startedAtMs,
          duration,
        );
        const name = `${event.elementId ? (labels[event.elementId] ?? "Component unavailable") : "Processing"}${processingAttemptLabel(event.attempt)}`;
        const measured = stop
          ? formatSimulationLatency(stop.atMs - event.atMs)
          : "Unavailable";
        const bar = (
          <span
            className={`relative block rounded-[3px] bg-sunken ${mobile ? "h-2" : "h-2.5"}`}
          >
            <span
              className={`absolute inset-y-0 rounded-[3px] ${stop?.outcome && stop.outcome !== "succeeded" ? "bg-risk/70" : "bg-primary/70"}`}
              style={{ left: `${position.left}%`, width: `${position.width}%` }}
            />
          </span>
        );
        return mobile ? (
          <div key={index} className="flex flex-col gap-1">
            <div className="flex justify-between gap-2 text-[13px] text-secondary-text">
              <span>{name}</span>
              <span className="font-mono text-xs">{measured}</span>
            </div>
            {bar}
          </div>
        ) : (
          <div
            key={index}
            className="grid min-h-[22px] grid-cols-[120px_minmax(0,1fr)_64px] items-center gap-3"
          >
            <span className="truncate text-xs text-secondary-text" title={name}>
              {name}
            </span>
            {bar}
            <span className="text-right font-mono text-[11px] text-secondary-text">
              {measured}
            </span>
          </div>
        );
      })}
      {!intervals.length && (
        <p className="text-xs text-secondary-text">
          No retained processing intervals.
        </p>
      )}
    </section>
  );
}

export function RecordedEventRows({
  events,
  labels,
  connectionLabels = {},
  mobile = false,
  includeCycleId = false,
  cycleLabels = {},
}: {
  events: readonly FlowRecord[];
  labels: Record<string, string>;
  connectionLabels?: Record<string, string>;
  mobile?: boolean;
  includeCycleId?: boolean;
  cycleLabels?: Record<string, string>;
}) {
  return (
    <ol aria-label="Recorded lifecycle events">
      {events.map((event, index) => {
        const subject = event.elementId
          ? (labels[event.elementId] ?? "Component unavailable")
          : event.connectionId
            ? (connectionLabels[event.connectionId] ?? "Connection unavailable")
            : "Root request";
        const content = mobile ? (
          <>
            <time className="font-mono text-[11px] text-secondary-text">
              {formatSimulationTime(event.atMs)}
            </time>
            <span className="flex min-w-0 flex-col gap-0.5 font-mono text-[11px]">
              <span>
                {includeCycleId && (
                  <span title={event.cycleId} className="text-secondary-text">
                    {event.cycleId
                      ? (cycleLabels[event.cycleId] ?? "c-—")
                      : "c-—"}{" "}
                  </span>
                )}
                {event.outcome ?? event.phase}
              </span>
              <span className="text-[10px] text-secondary-text">
                {event.phase.toUpperCase()} · {subject}
              </span>
            </span>
          </>
        ) : (
          <>
            <time className="text-secondary-text">
              {formatSimulationTime(event.atMs)}
            </time>
            <span
              className="truncate text-[9px] uppercase text-secondary-text"
              title={event.phase}
            >
              {event.phase}
            </span>
            <span
              className="truncate text-secondary-text"
              title={event.cycleId}
            >
              {event.cycleId ? (cycleLabels[event.cycleId] ?? "c-—") : "c-—"}
            </span>
            <span className="truncate">{event.outcome ?? event.phase}</span>
            <span
              className="max-w-40 truncate text-secondary-text"
              title={subject}
            >
              {subject}
            </span>
          </>
        );
        return (
          <li
            key={`${event.key}:${event.phase}:${event.atMs}:${index}`}
            className="border-b border-border"
          >
            <div
              className={
                mobile
                  ? `grid ${includeCycleId ? "min-h-11" : "min-h-10"} grid-cols-[72px_minmax(0,1fr)] items-center gap-2.5`
                  : "grid min-h-6 grid-cols-[76px_62px_62px_minmax(0,1fr)_auto] items-center gap-2.5 font-mono text-[11px]"
              }
            >
              {content}
            </div>
          </li>
        );
      })}
      {!events.length && (
        <li className="py-4 text-xs text-secondary-text">
          No retained events in this scope.
        </li>
      )}
    </ol>
  );
}

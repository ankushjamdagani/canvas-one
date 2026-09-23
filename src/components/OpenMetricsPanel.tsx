import { useState } from "react";
import type { Metrics } from "../domain/metrics";
import type { Graph } from "../domain/model";
import type { RunResult } from "../simulation/useSimulation";
import { sameGraphWorkload } from "../domain/workload";
import { isOpenGraph } from "../domain/model";
import { cn } from "@/lib/utils";

function formatNumber(num: number | undefined, digits = 1): string {
  if (num === undefined || Number.isNaN(num)) return "—";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatInt(num: number | undefined): string {
  if (num === undefined || Number.isNaN(num)) return "—";
  return num.toLocaleString();
}

function renderDiff(current: number | undefined, prev: number | undefined, digits = 1) {
  if (current === undefined || prev === undefined) return null;
  const diff = current - prev;
  if (Math.abs(diff) < (digits === 0 ? 0.5 : 0.05)) return null;
  const isPositive = diff > 0;
  return (
    <span className={cn("metric-diff text-xs ml-0.5 font-mono font-medium tabular-nums", isPositive ? "text-primary" : "text-risk-text")}>
      {isPositive ? "+" : ""}{formatNumber(diff, digits)}
    </span>
  );
}

function MetricItem({
  label,
  value,
  unit,
  testId,
  tone,
  diff,
}: {
  label: string;
  value: string;
  unit?: string;
  testId?: string;
  tone?: "risk";
  diff?: React.ReactNode;
}) {
  const hasValue = value !== "—";
  return (
    <div className="metric-item flex flex-col gap-0.5">
      <span className="text-xs uppercase font-semibold text-secondary-text tracking-wider">{label}</span>
      <span className="inline-flex items-baseline gap-1">
        <strong
          data-testid={testId}
          className={cn("text-sm font-bold font-mono tabular-nums", tone === "risk" ? "text-risk-text" : "text-foreground")}
        >
          {value}
        </strong>
        {unit && hasValue && <span className="text-xs text-secondary-text">{unit}</span>}
        {diff}
      </span>
    </div>
  );
}

export function OpenMetricsPanel({
  metrics,
  graph,
  previous,
}: {
  metrics: Metrics | null;
  graph: Graph;
  previous: RunResult | null;
}) {
  const execution = metrics?.execution;
  const roots = execution?.roots;
  const messages = execution?.messages;
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // Comparison is valid only when same workload and both are open
  const canCompare =
    previous &&
    isOpenGraph(graph) &&
    isOpenGraph(previous.graph) &&
    sameGraphWorkload(graph, previous.graph) &&
    previous.metrics.execution;

  const prevRoots = canCompare ? previous.metrics.execution?.roots : undefined;
  const prevMessages = canCompare ? previous.metrics.execution?.messages : undefined;

  const timeSec = metrics?.time !== undefined ? metrics.time.toFixed(1) + "s" : "—";
  const snapshotExecTime = execution?.time !== undefined ? execution.time.toFixed(1) + "s" : timeSec;

  const nodeStats = execution?.nodes ?? {};

  return (
    <section
      className="open-metrics-panel flex flex-col gap-4 bg-background border-t border-border p-3 sm:p-4 text-xs overflow-y-auto"
      aria-label="System simulation metrics"
    >
      <section aria-labelledby="open-metrics-general-heading" className="flex flex-col gap-2">
        <h3 id="open-metrics-general-heading" className="text-xs font-semibold uppercase tracking-wider text-secondary-text">
          General
        </h3>
        <div className="metrics-row-cards grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="metrics-card bg-card border border-border rounded-lg p-3.5 shadow-xs">
            <div className="metrics-card-header flex items-center justify-between pb-2 mb-2.5 border-b border-border text-foreground font-semibold">
              <strong className="text-xs font-semibold text-foreground">Root requests</strong>
              <small className="text-xs font-mono text-secondary-text font-normal">Snapshot: {snapshotExecTime}</small>
            </div>
            <div className="metrics-grid grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <MetricItem
                label="Throughput"
                testId="throughput"
                value={formatNumber(roots?.throughput ?? metrics?.throughput)}
                unit="/s"
                diff={renderDiff(roots?.throughput ?? metrics?.throughput, prevRoots?.throughput)}
              />
              <MetricItem
                label="p95 Latency"
                testId="latency"
                value={
                  roots?.p95Latency !== undefined
                    ? roots.p95Latency.toFixed(1)
                    : metrics?.p95Latency !== undefined
                      ? metrics.p95Latency.toFixed(1)
                      : "—"
                }
                unit="ms"
                diff={renderDiff(roots?.p95Latency ?? metrics?.p95Latency, prevRoots?.p95Latency)}
              />
              <MetricItem label="Generated" value={formatInt(roots?.generated ?? metrics?.generated)} />
              <MetricItem label="Succeeded" value={formatInt(roots?.succeeded ?? metrics?.succeeded)} />
              <MetricItem label="Rejected" value={formatInt(roots?.rejected ?? metrics?.dropped)} />
              <MetricItem
                label="Failed"
                testId="failures"
                tone={(roots?.failed ?? metrics?.timedOut ?? 0) > 0 ? "risk" : undefined}
                value={formatInt(roots?.failed ?? metrics?.timedOut)}
              />
              <MetricItem label="Expired" value={formatInt(roots?.expired)} />
              <MetricItem label="In Flight" testId="queue" value={formatInt(roots?.inFlight ?? metrics?.inFlight)} />
            </div>
          </div>

          <div className="metrics-card bg-card border border-border rounded-lg p-3.5 shadow-xs">
            <div className="metrics-card-header flex items-center justify-between pb-2 mb-2.5 border-b border-border text-foreground font-semibold">
              <strong className="text-xs font-semibold text-foreground">Background messages</strong>
              <small className="text-xs text-secondary-text font-normal">
                {execution?.incomplete ? "Incomplete: limit reached" : "Asynchronous flow"}
              </small>
            </div>
            <div className="metrics-grid grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <MetricItem
                label="Throughput"
                value={formatNumber(messages?.throughput)}
                unit="/s"
                diff={renderDiff(messages?.throughput, prevMessages?.throughput)}
              />
              <MetricItem
                label="p95 Latency"
                value={messages?.p95Latency !== undefined ? messages.p95Latency.toFixed(1) : "—"}
                unit="ms"
                diff={renderDiff(messages?.p95Latency, prevMessages?.p95Latency)}
              />
              <MetricItem label="Generated" value={formatInt(messages?.generated)} />
              <MetricItem label="Succeeded" value={formatInt(messages?.succeeded)} />
              <MetricItem label="Rejected" value={formatInt(messages?.rejected)} />
              <MetricItem label="Expired" value={formatInt(messages?.expired)} />
              <MetricItem label="Failed" value={formatInt(messages?.failed)} />
              <MetricItem label="In Flight" value={formatInt(messages?.inFlight)} />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="open-metrics-components-heading" className="flex flex-col gap-2">
        <h3 id="open-metrics-components-heading" className="text-xs font-semibold uppercase tracking-wider text-secondary-text">
          Components ({graph.nodes.length})
        </h3>
        <details
          className="node-resource-details border border-border rounded-lg bg-card overflow-hidden"
          onToggle={(event) => setBreakdownOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary
            className="p-2.5 px-3.5 font-semibold text-xs text-foreground cursor-pointer hover:bg-accent/40 transition-colors"
            aria-expanded={breakdownOpen}
          >
            Node resource breakdown & counters ({graph.nodes.length} nodes)
          </summary>
          <div className="resource-table-wrap overflow-x-auto p-2">
            <table className="resource-table w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-sunken/50">
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Node</th>
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Kind</th>
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Queued</th>
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Processing</th>
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Waiting</th>
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Retries</th>
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Utilization</th>
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Occupancy</th>
                  <th className="px-2.5 py-1.5 font-semibold text-secondary-text text-xs">Cache / Broker</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {graph.nodes.map((node) => {
                  const s = nodeStats[node.id];
                  const cacheInfo = s?.cache
                    ? `Hits: ${s.cache.hits}, Miss: ${s.cache.misses}, Evict: ${s.cache.evictions}`
                    : s?.buffered !== undefined
                      ? `Buffered: ${s.buffered}, Delivered: ${s.delivered}, In flight: ${s.inFlight}`
                      : "—";

                  return (
                    <tr key={node.id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-2.5 py-1.5 font-medium text-foreground">{node.name}</td>
                      <td className="px-2.5 py-1.5 text-secondary-text">{node.kind}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums">{s ? formatInt(s.queued) : "—"}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums">{s ? formatInt(s.processing) : "—"}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums">{s ? formatInt(s.waiting) : "—"}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums">{s ? formatInt(s.retries) : "—"}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums">{s ? `${(s.utilization * 100).toFixed(1)}%` : "—"}</td>
                      <td className="px-2.5 py-1.5 font-mono tabular-nums">{s ? `${(s.occupancy * 100).toFixed(1)}%` : "—"}</td>
                      <td className="px-2.5 py-1.5 text-secondary-text text-xs">{cacheInfo}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </section>
  );
}

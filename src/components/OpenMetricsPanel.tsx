import type { Metrics } from "../domain/metrics";
import type { Graph } from "../domain/model";
import type { RunResult } from "../simulation/useSimulation";
import { sameGraphWorkload } from "../domain/workload";
import { isOpenGraph } from "../domain/model";

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
    <span className={`metric-diff ${isPositive ? "positive" : "negative"}`}>
      {isPositive ? "+" : ""}{formatNumber(diff, digits)}
    </span>
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
    <section className="open-metrics-panel" aria-label="System simulation metrics">
      <div className="metrics-row-cards">
        <div className="metrics-card">
          <div className="metrics-card-header">
            <strong>Root requests</strong>
            <small>Snapshot: {snapshotExecTime}</small>
          </div>
          <div className="metrics-grid">
            <div className="metric-item">
              <span>Throughput</span>
              <strong data-testid="throughput">
                {formatNumber(roots?.throughput ?? metrics?.throughput)}/s
              </strong>
              {renderDiff(roots?.throughput ?? metrics?.throughput, prevRoots?.throughput)}
            </div>
            <div className="metric-item">
              <span>p95 Latency</span>
              <strong data-testid="latency">
                {roots?.p95Latency !== undefined ? `${roots.p95Latency.toFixed(1)} ms` : metrics?.p95Latency !== undefined ? `${metrics.p95Latency.toFixed(1)} ms` : "—"}
              </strong>
              {renderDiff(roots?.p95Latency ?? metrics?.p95Latency, prevRoots?.p95Latency)}
            </div>
            <div className="metric-item">
              <span>Generated</span>
              <strong>{formatInt(roots?.generated ?? metrics?.generated)}</strong>
            </div>
            <div className="metric-item">
              <span>Succeeded</span>
              <strong>{formatInt(roots?.succeeded ?? metrics?.succeeded)}</strong>
            </div>
            <div className="metric-item">
              <span>Rejected</span>
              <strong>{formatInt(roots?.rejected ?? metrics?.dropped)}</strong>
            </div>
            <div className="metric-item">
              <span>Failed</span>
              <strong data-testid="failures">
                {formatInt(roots?.failed ?? metrics?.timedOut)}
              </strong>
            </div>
            <div className="metric-item"><span>Expired</span><strong>{formatInt(roots?.expired)}</strong></div>
            <div className="metric-item">
              <span>In Flight</span>
              <strong data-testid="queue">
                {formatInt(roots?.inFlight ?? metrics?.inFlight)}
              </strong>
            </div>
          </div>
        </div>

        <div className="metrics-card">
          <div className="metrics-card-header">
            <strong>Background messages</strong>
            <small>{execution?.incomplete ? "Incomplete: limit reached" : "Asynchronous flow"}</small>
          </div>
          <div className="metrics-grid">
            <div className="metric-item">
              <span>Throughput</span>
              <strong>{formatNumber(messages?.throughput)}/s</strong>
              {renderDiff(messages?.throughput, prevMessages?.throughput)}
            </div>
            <div className="metric-item">
              <span>p95 Latency</span>
              <strong>
                {messages?.p95Latency !== undefined ? `${messages.p95Latency.toFixed(1)} ms` : "—"}
              </strong>
              {renderDiff(messages?.p95Latency, prevMessages?.p95Latency)}
            </div>
            <div className="metric-item">
              <span>Generated</span>
              <strong>{formatInt(messages?.generated)}</strong>
            </div>
            <div className="metric-item">
              <span>Succeeded</span>
              <strong>{formatInt(messages?.succeeded)}</strong>
            </div>
            <div className="metric-item">
              <span>Rejected</span>
              <strong>{formatInt(messages?.rejected)}</strong>
            </div>
            <div className="metric-item">
              <span>Expired</span>
              <strong>{formatInt(messages?.expired)}</strong>
            </div>
            <div className="metric-item"><span>Failed</span><strong>{formatInt(messages?.failed)}</strong></div>
            <div className="metric-item">
              <span>In Flight</span>
              <strong>{formatInt(messages?.inFlight)}</strong>
            </div>
          </div>
        </div>
      </div>

      <details className="node-resource-details">
        <summary>Node resource breakdown & counters ({graph.nodes.length} nodes)</summary>
        <div className="resource-table-wrap">
          <table className="resource-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Kind</th>
                <th>Queued</th>
                <th>Processing</th>
                <th>Waiting</th>
                <th>Retries</th>
                <th>Utilization</th>
                <th>Occupancy</th>
                <th>Cache / Broker</th>
              </tr>
            </thead>
            <tbody>
              {graph.nodes.map((node) => {
                const s = nodeStats[node.id];
                const cacheInfo = s?.cache
                  ? `Hits: ${s.cache.hits}, Miss: ${s.cache.misses}, Evict: ${s.cache.evictions}`
                  : s?.buffered !== undefined
                    ? `Buffered: ${s.buffered}, Delivered: ${s.delivered}, In flight: ${s.inFlight}`
                    : "—";

                return (
                  <tr key={node.id}>
                    <td>{node.name}</td>
                    <td>{node.kind}</td>
                    <td>{s ? formatInt(s.queued) : "—"}</td>
                    <td>{s ? formatInt(s.processing) : "—"}</td>
                    <td>{s ? formatInt(s.waiting) : "—"}</td>
                    <td>{s ? formatInt(s.retries) : "—"}</td>
                    <td>{s ? `${(s.utilization * 100).toFixed(1)}%` : "—"}</td>
                    <td>{s ? `${(s.occupancy * 100).toFixed(1)}%` : "—"}</td>
                    <td>{cacheInfo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

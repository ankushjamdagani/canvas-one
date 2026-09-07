import { failureCount } from "../domain/metrics";
import { isJobGraph } from "../domain/model";
import { ArrowDownRight, ArrowUpRight, Activity, Info } from "lucide-react";
import { useState } from "react";
import { sameWorkload } from "../domain/workload";
import { WorkloadChart } from "./WorkloadChart";
import type { Graph } from "../domain/model";
import type { Metrics } from "../simulation/engine";
import type { RunResult } from "../simulation/useSimulation";
export function MetricsPanel({
  metrics: m,
  previous,
  graph,
}: {
  metrics: Metrics | null;
  previous: RunResult | null;
  graph: Graph;
}) {
  const [expanded, setExpanded] = useState(false),
    started = !!m?.time,
    queue = Object.values(m?.nodes ?? {}).reduce((a, n) => a + n.queued, 0);
  const comparable =
    previous &&
    isJobGraph(previous.graph) === isJobGraph(graph) &&
    sameWorkload(previous.graph.settings, graph.settings);
  return (
    <section
      className={`metrics-panel ${expanded ? "expanded" : ""}`}
      aria-label="Simulation metrics"
    >
      <div className="metrics-row">
        <button
          className="metrics-title"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <Activity size={17} />
          <strong>Live metrics</strong>
          <span>{expanded ? "−" : "+"}</span>
        </button>
        <div className="metric">
          <span>{isJobGraph(graph) ? "Jobs done" : "Completed"}</span>
          <strong data-testid="throughput">
            {started ? m!.throughput.toFixed(0) : "—"}
            <small>/s</small>
          </strong>
        </div>
        <div className="metric">
          <span>{isJobGraph(graph) ? "p95 job latency" : "p95 latency"}</span>
          <strong data-testid="latency">
            {started ? m!.p95Latency.toFixed(1) : "—"}
            <small>ms</small>
          </strong>
        </div>
        <div className={`metric ${queue > 50 ? "warning-text" : ""}`}>
          <span>In queue</span>
          <strong data-testid="queue">{started ? queue : "—"}</strong>
        </div>
        <div className="metric">
          <span>Failed</span>
          <strong data-testid="failures">
            {started ? failureCount(m!).toLocaleString() : "—"}
          </strong>
        </div>
        <div className="metric elapsed">
          <span>Simulated time</span>
          <strong>
            {m?.time.toFixed(1) ?? "0.0"}
            <small>/ {graph.settings.duration}s</small>
          </strong>
        </div>
      </div>
      {expanded && (
        <div className="metrics-details">
          <div>
            <h3>Incoming traffic · configured</h3>
            <WorkloadChart settings={graph.settings} time={m?.time} />
            <h3>Queue over time · observed</h3>
            {m?.history.length ? (
              <>
                <svg
                  className="queue-chart"
                  viewBox="0 0 500 100"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="Observed total queue length over simulation time"
                >
                  <line x1="0" y1="90" x2="500" y2="90" stroke="#dae2df" />
                  <polyline
                    fill="none"
                    stroke="#bc720c"
                    strokeWidth="2"
                    points={m.history
                      .map(
                        (s) =>
                          `${(s.time / graph.settings.duration) * 500},${90 - (s.queue / Math.max(10, ...m.history.map((p) => p.queue))) * 80}`,
                      )
                      .join(" ")}
                  />
                </svg>
                <div className="chart-caption">
                  <span>0 seconds</span>
                  <span>
                    Peak {Math.max(...m.history.map((p) => p.queue))} requests
                  </span>
                  <span>{graph.settings.duration} seconds</span>
                </div>
              </>
            ) : (
              <p>Run the experiment to observe queue length.</p>
            )}
            <p className="small muted">
              {isJobGraph(graph)
                ? "Throughput counts completed jobs. Successful-job latency includes waiting and retries. Producer acknowledgements only confirm admission, not completion."
                : "Throughput is completed requests ÷ elapsed time. Latency includes successful requests only."}
            </p>
          </div>
          <div>
            <h3>
              {isJobGraph(graph) ? "Job accounting" : "Request accounting"}
            </h3>
            <dl className="accounting">
              <div>
                <dt>Generated</dt>
                <dd>{m?.generated.toLocaleString() ?? "—"}</dd>
              </div>
              <div>
                <dt>Succeeded / in flight</dt>
                <dd>
                  {m
                    ? `${m.succeeded.toLocaleString()} / ${m.inFlight.toLocaleString()}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Queue full / timed out</dt>
                <dd>
                  {m
                    ? `${m.dropped.toLocaleString()} / ${m.timedOut.toLocaleString()}`
                    : "—"}
                </dd>
              </div>
              {isJobGraph(graph) ? (
                <>
                  <div>
                    <dt>Accepted / producer acknowledged</dt>
                    <dd>
                      {m?.jobs
                        ? `${m.jobs.accepted} / ${m.jobs.acknowledged}`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Permanent failures</dt>
                    <dd>{m?.jobs?.failed ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Attempts / retries scheduled</dt>
                    <dd>
                      {m?.jobs ? `${m.jobs.attempts} / ${m.jobs.retries}` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Retry backoff / re-entry rejected</dt>
                    <dd>
                      {m?.jobs
                        ? `${m.jobs.retrying} / ${m.jobs.retryRejected}`
                        : "—"}
                    </dd>
                  </div>
                </>
              ) : (
                <>
                  {" "}
                  <div>
                    <dt>Database arrivals /s</dt>
                    <dd>
                      {started
                        ? (m!.databaseLookups / m!.time).toFixed(1)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Cache hits</dt>
                    <dd>{m?.cacheHits.toLocaleString() ?? "—"}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>
          <div>
            {m &&
              graph.settings.profile?.kind === "burst" &&
              m.time >= graph.settings.profile.end && (
                <p className="workload-observation">
                  The burst has ended. {queue} requests are waiting now; the
                  sampled peak was{" "}
                  {Math.max(0, ...m.history.map((sample) => sample.queue))}.
                  Cumulative latency still includes earlier waits.
                </p>
              )}
            <h3>Compared with previous run</h3>
            {previous && comparable && m?.finished ? (
              <>
                <div className="comparison">
                  <ArrowDownRight size={19} />
                  <span>
                    {isJobGraph(graph) ? "p95 job latency" : "p95 latency"}
                  </span>
                  <strong>
                    {previous.metrics.p95Latency.toFixed(1)} →{" "}
                    {m.p95Latency.toFixed(1)} ms
                  </strong>
                </div>
                <div className="comparison">
                  <ArrowUpRight size={19} />
                  <span>Completed /s</span>
                  <strong>
                    {previous.metrics.throughput.toFixed(0)} →{" "}
                    {m.throughput.toFixed(0)}
                  </strong>
                </div>
                <p className="small">
                  Same seed, traffic profile, duration and timeout.{" "}
                  {previous.metrics.generated === m.generated
                    ? "Identical generated arrivals."
                    : "Arrival counts differ; check the workload."}{" "}
                  Architecture or component settings changed.
                </p>
              </>
            ) : (
              <p>
                {previous && !comparable
                  ? "This workload differs from the previous run. Restore the same traffic profile, seed, duration and timeout for a controlled comparison."
                  : "Finish a run, change the architecture, then replay to compare observed results."}
              </p>
            )}
            <p className="small muted">
              <Info size={13} /> Results describe this illustrative model only.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

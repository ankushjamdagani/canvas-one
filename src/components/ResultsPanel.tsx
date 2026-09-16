import { hasBalancer, serviceInstances } from "../domain/routing";
import { failureCount } from "../domain/metrics";
import { observedCacheHitRate } from "../domain/cache-metrics";
import { isJobGraph, isOpenGraph } from "../domain/model";
import { useEffect, useState } from "react";
import {
  X,
  RotateCcw,
  Trash2,
  Info,
  CheckCircle2,
  TriangleAlert,
} from "lucide-react";
import { useEditor } from "../state/editor";
import {
  comparisonStatus,
  modelChanges,
  type SavedRun,
} from "../domain/results";
import { profileLabel } from "../domain/workload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResultsPanel({
  selectedId,
  onClose,
  onRestore,
}: {
  selectedId: string | null;
  onClose: () => void;
  onRestore: (id: string) => void;
}) {
  const editor = useEditor(),
    readOnly = editor.readOnly,
    runs = editor.project.savedRuns ?? [];
  const [currentId, setCurrentId] = useState(
      selectedId ?? runs.at(-1)?.id ?? "",
    ),
    [baselineId, setBaselineId] = useState(runs.at(-2)?.id ?? ""),
    [deleted, setDeleted] = useState<SavedRun | null>(null),
    [draftName, setDraftName] = useState("");
  useEffect(() => {
    if (selectedId) setCurrentId(selectedId);
  }, [selectedId]);
  const current = runs.find((r) => r.id === currentId) ?? runs.at(-1),
    baseline = runs.find((r) => r.id === baselineId);
  useEffect(() => {
    setDraftName(current?.name ?? "");
  }, [current?.id, current?.name]);
  const status =
    baseline && current ? comparisonStatus(baseline, current) : null;
  const changes =
    baseline && current ? modelChanges(baseline.graph, current.graph) : [];
  const undo = () => {
    if (deleted && editor.saveRun(deleted)) {
      setCurrentId(deleted.id);
      setDeleted(null);
    }
  };
  return (
    <section className="results-panel" aria-label="Saved experiment results">
      <header className="results-heading">
        <div>
          <h2>Saved results</h2>
          <span>{runs.length} / 20 · stored in this browser</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close saved results"
          className="h-7 w-7 p-0"
          onClick={onClose}
        >
          <X size={17} />
        </Button>
      </header>
      {deleted && (
        <div className="result-deleted" role="status">
          “{deleted.name}” deleted.
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            disabled={readOnly}
            onClick={undo}
          >
            <RotateCcw size={13} />
            Undo delete
          </Button>
        </div>
      )}
      {!current ? (
        <div className="results-empty">
          <h3>Keep the result, not just the model.</h3>
          <p>
            Finish an experiment and choose Save result. Its metrics, workload
            and architecture will stay together here.
          </p>
        </div>
      ) : (
        <div className="results-content">
          <div className="result-pickers">
            <label>
              <span>Baseline result</span>
              <select
                aria-label="Baseline result"
                value={baseline?.id ?? ""}
                onChange={(e) => setBaselineId(e.target.value)}
              >
                <option value="">Choose a baseline</option>
                {runs.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {baseline && <RunContext run={baseline} />}
            </label>
            <label>
              <span>Compare result</span>
              <select
                aria-label="Compare result"
                value={current.id}
                onChange={(e) => setCurrentId(e.target.value)}
              >
                {runs.map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <RunContext run={current} />
            </label>
          </div>
          <div
            className={`result-comparability ${status && !status.matched ? "different" : ""}`}
            role="status"
          >
            {status?.matched ? (
              <CheckCircle2 size={16} />
            ) : status ? (
              <TriangleAlert size={16} />
            ) : (
              <Info size={16} />
            )}
            <p>
              {status?.message ??
                "Choose a baseline to compare two saved runs. Viewing a result leaves the current canvas unchanged."}
            </p>
          </div>
          <div className="result-analysis">
            <div className="result-table-wrap">
              <table className="result-table">
                <caption>Observed simulation results</caption>
                {isOpenGraph(current.graph) ? (
                  <>
                    <thead>
                      <tr>
                        <th scope="col">Root flow metric</th>
                        <th scope="col">Baseline</th>
                        <th scope="col">Result</th>
                        <th scope="col">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Throughput /s", get: (r: SavedRun) => r.metrics.execution?.roots.throughput ?? null, digits: 1 },
                        { label: "p95 latency · ms", get: (r: SavedRun) => r.metrics.execution?.roots.p95Latency ?? null, digits: 1 },
                        { label: "Mean latency · ms", get: (r: SavedRun) => r.metrics.execution?.roots.meanLatency ?? null, digits: 1 },
                        { label: "Generated", get: (r: SavedRun) => r.metrics.execution?.roots.generated ?? null, digits: 0 },
                        { label: "Succeeded", get: (r: SavedRun) => r.metrics.execution?.roots.succeeded ?? null, digits: 0 },
                        { label: "Rejected", get: (r: SavedRun) => r.metrics.execution?.roots.rejected ?? null, digits: 0 },
                        { label: "Failed", get: (r: SavedRun) => r.metrics.execution?.roots.failed ?? null, digits: 0 },
                        { label: "Expired", get: (r: SavedRun) => r.metrics.execution?.roots.expired ?? null, digits: 0 },
                        { label: "In flight at end", get: (r: SavedRun) => r.metrics.execution?.roots.inFlight ?? null, digits: 0 },
                      ].map((row) => renderTableRow(row, baseline, current, status))}
                      <tr className="result-table-divider">
                        <th colSpan={4} scope="colgroup" style={{ textAlign: "left", paddingTop: "0.75rem", fontWeight: 600 }}>
                          Asynchronous message flow
                        </th>
                      </tr>
                      {[
                        { label: "Message throughput /s", get: (r: SavedRun) => r.metrics.execution?.messages.throughput ?? null, digits: 1 },
                        { label: "Message p95 latency · ms", get: (r: SavedRun) => r.metrics.execution?.messages.p95Latency ?? null, digits: 1 },
                        { label: "Messages generated", get: (r: SavedRun) => r.metrics.execution?.messages.generated ?? null, digits: 0 },
                        { label: "Messages succeeded", get: (r: SavedRun) => r.metrics.execution?.messages.succeeded ?? null, digits: 0 },
                        { label: "Messages rejected", get: (r: SavedRun) => r.metrics.execution?.messages.rejected ?? null, digits: 0 },
                        { label: "Messages failed", get: (r: SavedRun) => r.metrics.execution?.messages.failed ?? null, digits: 0 },
                        { label: "Messages expired", get: (r: SavedRun) => r.metrics.execution?.messages.expired ?? null, digits: 0 },
                        { label: "Messages in flight", get: (r: SavedRun) => r.metrics.execution?.messages.inFlight ?? null, digits: 0 },
                      ].map((row) => renderTableRow(row, baseline, current, status))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        <th scope="col">Baseline</th>
                        <th scope="col">Result</th>
                        <th scope="col">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        {
                          label: "Completed /s",
                          get: (r: SavedRun) => r.metrics.throughput,
                          digits: 1,
                        },
                        {
                          label: "p95 latency · ms",
                          get: (r: SavedRun) => r.metrics.p95Latency,
                          digits: 1,
                        },
                        {
                          label: isJobGraph(current.graph)
                            ? "Failed jobs"
                            : "Failed requests",
                          get: (r: SavedRun) => failureCount(r.metrics),
                          digits: 0,
                        },
                        {
                          label: "Generated",
                          get: (r: SavedRun) => r.metrics.generated,
                          digits: 0,
                        },
                        {
                          label: "In flight at end",
                          get: (r: SavedRun) => r.metrics.inFlight,
                          digits: 0,
                        },
                        ...(isJobGraph(current.graph)
                          ? [
                              {
                                label: "Producer acknowledged",
                                get: (r: SavedRun) =>
                                  r.metrics.jobs?.acknowledged ?? 0,
                                digits: 0,
                              },
                              {
                                label: "Retries scheduled",
                                get: (r: SavedRun) => r.metrics.jobs?.retries ?? 0,
                                digits: 0,
                              },
                              {
                                label: "Permanent failures",
                                get: (r: SavedRun) => r.metrics.jobs?.failed ?? 0,
                                digits: 0,
                              },
                            ]
                          : [
                              {
                                label: "Database arrivals /s",
                                get: (r: SavedRun) =>
                                  r.metrics.databaseLookups / r.metrics.time,
                                digits: 1,
                              },
                            ]),
                        ...(!isJobGraph(current.graph)
                          ? [
                              {
                                label: "Observed cache hit rate · %",
                                get: (r: SavedRun) =>
                                  observedCacheHitRate(r.metrics),
                                digits: 1,
                              },
                              { label: "Cache misses", get: (r: SavedRun) => r.metrics.cacheMisses, digits: 0 },
                              { label: "Cache entries at end", get: (r: SavedRun) => r.metrics.cacheEntries, digits: 0 },
                              { label: "Cache evictions", get: (r: SavedRun) => r.metrics.cacheEvictions, digits: 0 },
                              { label: "Cache expirations", get: (r: SavedRun) => r.metrics.cacheExpirations, digits: 0 },
                            ]
                          : []),
                      ].map((row) => renderTableRow(row, baseline, current, status))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
            <div className="result-chart-and-changes">
              <QueueComparison baseline={baseline} current={current} />
              <h3>Model changes</h3>
              {baseline ? (
                <p>
                  {changes.length
                    ? changes.join(" ")
                    : "No processing-model changes. Names and positions do not affect execution."}
                </p>
              ) : (
                <p>
                  Choose a baseline to see which capacities, queues or cache
                  settings changed.
                </p>
              )}
              <p className="result-provenance">
                {current.origin === "imported" ||
                baseline?.origin === "imported"
                  ? "Includes imported data; these stored results have not been rerun here."
                  : "Recorded by this simulator."}{" "}
                Latency describes successful responses only. These are
                illustrative model results.
              </p>
            </div>
          </div>
          {isOpenGraph(current.graph) && current.metrics.execution && (
            <details className="saved-routing">
              <summary>Saved node observation · {current.name}</summary>
              <div className="result-table-wrap">
                <table className="result-table">
                  <caption>Observed node queue, waiting, and resource occupancy</caption>
                  <thead>
                    <tr>
                      <th scope="col">Node</th>
                      <th scope="col">Arrived</th>
                      <th scope="col">Queued</th>
                      <th scope="col">Waiting</th>
                      <th scope="col">Rejected</th>
                      <th scope="col">Workers</th>
                      <th scope="col">Occupancy</th>
                      <th scope="col">Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.graph.nodes.map((n) => {
                      const emNode = current.metrics.execution?.nodes[n.id];
                      if (!emNode) return null;
                      return (
                        <tr key={n.id}>
                          <th scope="row">{n.name}</th>
                          <td>{emNode.arrived.toLocaleString()}</td>
                          <td>{emNode.queued.toLocaleString()}</td>
                          <td>{emNode.waiting.toLocaleString()}</td>
                          <td>{emNode.rejected.toLocaleString()}</td>
                          <td>{emNode.activeWorkers}</td>
                          <td>{(emNode.occupancy * 100).toFixed(1)}%</td>
                          <td>{(emNode.utilization * 100).toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {!isOpenGraph(current.graph) && hasBalancer(current.graph) && (
            <details className="saved-routing">
              <summary>Saved per-instance load · {current.name}</summary>
              <div className="result-table-wrap">
                <table className="result-table">
                  <caption>Observed routing and processing in this saved result</caption>
                  <thead>
                    <tr>
                      <th scope="col">Instance</th>
                      <th scope="col">Routed</th>
                      <th scope="col">Waiting</th>
                      <th scope="col">Rejected here</th>
                      <th scope="col">Busy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceInstances(current.graph).map((n) => {
                      const m = current.metrics.nodes[n.id];
                      return (
                        <tr key={n.id}>
                          <th scope="row">{n.name}</th>
                          <td>{m.arrived.toLocaleString()}</td>
                          <td>{m.queued}</td>
                          <td>{m.rejected.toLocaleString()}</td>
                          <td>{(m.utilization * 100).toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <div className="result-actions">
            <label>
              <span>Result name</span>
              <Input
                aria-label="Saved result name"
                className="h-8 text-xs"
                maxLength={80}
                disabled={readOnly}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  if (!readOnly) {
                    editor.renameRun(current.id, draftName);
                    setDraftName(draftName.trim() || current.name);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={readOnly}
              onClick={() => onRestore(current.id)}
            >
              <RotateCcw size={14} />
              Restore this model
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="delete-result h-8 text-xs gap-1.5"
              disabled={readOnly}
              onClick={() => {
                if (!readOnly) {
                  setDeleted(current);
                  editor.deleteRun(current.id);
                }
              }}
            >
              <Trash2 size={14} />
              Delete result
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
function renderTableRow(
  row: { label: string; get: (r: SavedRun) => number | null; digits: number },
  baseline: SavedRun | undefined,
  current: SavedRun,
  status: { matched: boolean; message: string } | null,
) {
  const b = baseline ? row.get(baseline) : null,
    c = row.get(current),
    difference = b === null || c === null ? null : c - b;
  const format = (v: number) =>
    v.toLocaleString(undefined, {
      minimumFractionDigits: row.digits,
      maximumFractionDigits: row.digits,
    });
  return (
    <tr key={row.label}>
      <th scope="row">{row.label}</th>
      <td>{b === null ? "—" : format(b)}</td>
      <td>{c === null ? "—" : format(c)}</td>
      <td>
        {difference === null || !status?.matched
          ? "—"
          : `${difference > 0 ? "+" : ""}${format(difference)}`}
      </td>
    </tr>
  );
}
function RunContext({ run }: { run: SavedRun }) {
  if (isOpenGraph(run.graph)) {
    const enabledWorkloads = run.graph.workloads?.filter((w) => w.enabled) ?? [];
    const classCount = enabledWorkloads.reduce((sum, w) => sum + (w.classes?.length ?? 0), 0);
    return <small className="run-context">
      Open system · {run.graph.nodes.length} nodes<br />
      {enabledWorkloads.length} enabled workloads · {classCount} request classes<br />
      Seed {run.graph.settings.seed} · {run.graph.settings.duration}s<br />
      {run.origin === "imported" ? "Imported result" : new Date(run.completedAt).toLocaleString()}
    </small>;
  }
  return (
    <small className="run-context">
      {isJobGraph(run.graph) ? "Background jobs" : hasBalancer(run.graph) ? `Round robin · ${serviceInstances(run.graph).length} instances` : "URL lookup"}
      <br />
      {profileLabel(run.graph.settings)}
      <br />
      Seed {run.graph.settings.seed} · {run.graph.settings.duration}s · timeout{" "}
      {run.graph.settings.timeoutMs}ms
      <br />
      {run.origin === "imported"
        ? "Imported result"
        : new Date(run.completedAt).toLocaleString()}
    </small>
  );
}
function QueueComparison({
  baseline,
  current,
}: {
  baseline?: SavedRun;
  current: SavedRun;
}) {
  const maximum = Math.max(
    1,
    ...current.metrics.history.map((p) => p.queue),
    ...(baseline?.metrics.history.map((p) => p.queue) ?? []),
  );
  const duration = Math.max(current.metrics.time, baseline?.metrics.time ?? 0);
  const points = (run: SavedRun) =>
    [
      "0,94",
      ...run.metrics.history.map(
        (p) => `${(p.time / duration) * 400},${94 - (p.queue / maximum) * 85}`,
      ),
    ].join(" ");
  return (
    <div className="saved-queue-chart">
      <h3>Queue over time</h3>
      <svg
        viewBox="0 0 400 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Saved queue histories on the same time and queue scales"
      >
        <line x1="0" y1="94" x2="400" y2="94" stroke="#dce5dd" />
        {baseline && (
          <polyline
            points={points(baseline)}
            fill="none"
            stroke="#a66c16"
            strokeWidth="2"
          />
        )}
        <polyline
          points={points(current)}
          fill="none"
          stroke="#087f84"
          strokeWidth="2"
        />
      </svg>
      <div className="saved-chart-axis">
        <span>0s</span>
        <span>
          Sampled peak{" "}
          {maximum === 1 &&
          current.metrics.history.every((p) => p.queue === 0) &&
          (!baseline || baseline.metrics.history.every((p) => p.queue === 0))
            ? 0
            : maximum}
        </span>
        <span>{duration}s</span>
      </div>
      <div className="saved-chart-legend">
        {baseline && (
          <span>
            <i className="baseline-line" />
            Baseline
          </span>
        )}
        <span>
          <i />
          Result
        </span>
      </div>
    </div>
  );
}

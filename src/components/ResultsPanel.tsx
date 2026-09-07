import { hasBalancer, serviceInstances } from "../domain/routing";
import { failureCount } from "../domain/metrics";
import { isJobGraph } from "../domain/model";
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
        <button aria-label="Close saved results" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      {deleted && (
        <div className="result-deleted" role="status">
          “{deleted.name}” deleted.
          <button onClick={undo}>
            <RotateCcw size={13} />
            Undo delete
          </button>
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
                  ].map((row) => {
                    const b = baseline ? row.get(baseline) : null,
                      c = row.get(current),
                      difference = b === null ? null : c - b;
                    const format = (v: number) =>
                      v.toLocaleString(undefined, {
                        minimumFractionDigits: row.digits,
                        maximumFractionDigits: row.digits,
                      });
                    return (
                      <tr key={row.label}>
                        <th scope="row">{row.label}</th>
                        <td>{b === null ? "—" : format(b)}</td>
                        <td>{format(c)}</td>
                        <td>
                          {difference === null || !status?.matched
                            ? "—"
                            : `${difference > 0 ? "+" : ""}${format(difference)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
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
          {hasBalancer(current.graph) && <details className="saved-routing">
            <summary>Saved per-instance load · {current.name}</summary>
            <div className="result-table-wrap"><table className="result-table">
              <caption>Observed routing and processing in this saved result</caption>
              <thead><tr><th scope="col">Instance</th><th scope="col">Routed</th><th scope="col">Waiting</th><th scope="col">Rejected here</th><th scope="col">Busy</th></tr></thead>
              <tbody>{serviceInstances(current.graph).map((n) => { const m = current.metrics.nodes[n.id]; return <tr key={n.id}><th scope="row">{n.name}</th><td>{m.arrived.toLocaleString()}</td><td>{m.queued}</td><td>{m.rejected.toLocaleString()}</td><td>{(m.utilization * 100).toFixed(1)}%</td></tr>; })}</tbody>
            </table></div>
          </details>}
          <div className="result-actions">
            <label>
              <span>Result name</span>
              <input
                aria-label="Saved result name"
                maxLength={80}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => {
                  editor.renameRun(current.id, draftName);
                  setDraftName(draftName.trim() || current.name);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </label>
            <button onClick={() => onRestore(current.id)}>
              <RotateCcw size={14} />
              Restore this model
            </button>
            <button
              className="delete-result"
              onClick={() => {
                setDeleted(current);
                editor.deleteRun(current.id);
              }}
            >
              <Trash2 size={14} />
              Delete result
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
function RunContext({ run }: { run: SavedRun }) {
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

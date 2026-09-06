import { useState } from "react";
import {
  ArrowRight,
  Info,
  Trash2,
  TriangleAlert,
  SlidersHorizontal,
} from "lucide-react";
import { useEditor } from "../state/editor";
import { expectedDatabaseRate } from "../domain/model";
import type { Metrics } from "../simulation/engine";
import { icons } from "./ArchitectureCanvas";
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-unit">
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            if (e.target.value !== "")
              onChange(Math.min(max, Math.max(min, Number(e.target.value))));
          }}
        />
        {unit && <span>{unit}</span>}
      </div>
    </label>
  );
}
export function Inspector({ metrics }: { metrics: Metrics | null }) {
  const editor = useEditor(),
    g = editor.project.graph,
    n = g.nodes.find((n) => n.id === editor.selected),
    [tab, setTab] = useState("explanation");
  if (!n)
    return (
      <aside className="inspector">
        <div className="inspector-heading">
          <SlidersHorizontal size={20} />
          <strong>Experiment settings</strong>
        </div>
        <div className="inspector-body">
          <h2>A small system. A visible consequence.</h2>
          <p>
            Change the incoming traffic, run the model, then see where requests
            spend their time.
          </p>
          <div className="section-rule" />
          <NumberField
            label="Incoming traffic"
            value={g.settings.traffic}
            min={1}
            max={10000}
            unit="req/s"
            onChange={(v) => editor.settings({ traffic: v })}
          />
          <NumberField
            label="Workload seed"
            value={g.settings.seed}
            min={0}
            max={2147483647}
            onChange={(v) => editor.settings({ seed: Math.round(v) })}
          />
          <NumberField
            label="Run duration"
            value={g.settings.duration}
            min={1}
            max={120}
            unit="seconds"
            onChange={(v) => editor.settings({ duration: v })}
          />
          <NumberField
            label="Request timeout"
            value={g.settings.timeoutMs}
            min={10}
            max={10000}
            unit="ms"
            onChange={(v) => editor.settings({ timeoutMs: v })}
          />
          <div className="note">
            <Info size={16} />
            <p>
              Same seed and traffic create the same arrivals. Model changes
              reset the current run.
            </p>
          </div>
          <h3>Inspect a component</h3>
          <p>
            Select a node to explore its behavior, capacity and queue settings.
          </p>
        </div>
      </aside>
    );
  const Icon = icons[n.kind],
    m = metrics?.nodes[n.id],
    demand =
      n.kind === "database" ? expectedDatabaseRate(g) : g.settings.traffic,
    overloaded = n.kind !== "traffic" && demand > n.capacity;
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <Icon size={22} />
        <strong>{n.name}</strong>
        {overloaded && <span className="tag amber">At risk</span>}
      </div>
      <div className="tabs">
        <button
          className={tab === "explanation" ? "active" : ""}
          onClick={() => setTab("explanation")}
        >
          Explanation
        </button>
        <button
          className={tab === "configuration" ? "active" : ""}
          onClick={() => setTab("configuration")}
        >
          Configuration
        </button>
      </div>
      <div className="inspector-body">
        {tab === "configuration" ? (
          <>
            <label className="field">
              <span>Component name</span>
              <input
                value={n.name}
                maxLength={80}
                onChange={(e) =>
                  editor.updateNode(n.id, { name: e.target.value })
                }
              />
            </label>
            {n.kind === "traffic" ? (
              <NumberField
                label="Incoming traffic"
                min={1}
                max={10000}
                value={g.settings.traffic}
                unit="req/s"
                onChange={(v) => editor.settings({ traffic: v })}
              />
            ) : (
              <>
                <NumberField
                  label="Processing capacity"
                  min={1}
                  max={100000}
                  value={n.capacity}
                  unit="req/s"
                  onChange={(v) => editor.updateNode(n.id, { capacity: v })}
                />
                <NumberField
                  label="Queue limit"
                  min={0}
                  max={10000}
                  value={n.queueLimit}
                  unit="requests"
                  onChange={(v) =>
                    editor.updateNode(n.id, { queueLimit: Math.round(v) })
                  }
                />
              </>
            )}
            {n.kind === "cache" && (
              <NumberField
                label="Cache hit rate"
                min={0}
                max={100}
                value={n.hitRate}
                unit="%"
                onChange={(v) => editor.updateNode(n.id, { hitRate: v })}
              />
            )}
            <div className="note">
              <Info size={16} />
              <p>
                These are illustrative capacities, not hardware benchmarks.
                Changing a parameter starts a fresh experiment.
              </p>
            </div>
            <button
              className="danger subtle"
              onClick={() => editor.remove(n.id)}
            >
              <Trash2 size={15} />
              Delete component
            </button>
          </>
        ) : (
          <>
            <div className={`status-callout ${overloaded ? "warning" : ""}`}>
              {overloaded ? <TriangleAlert size={22} /> : <Icon size={22} />}
              <div>
                <strong>
                  {overloaded
                    ? "Demand exceeds capacity"
                    : n.kind === "traffic"
                      ? "Start the request journey"
                      : n.kind === "cache"
                        ? "Serve hits closer to the user"
                        : "Room to handle this workload"}
                </strong>
                <p>
                  {overloaded
                    ? `${Math.round(demand)} expected arrivals/s · ${n.capacity} capacity/s`
                    : n.kind === "traffic"
                      ? `${g.settings.traffic} requests/s on average`
                      : `${Math.round(demand)} expected arrivals/s`}
                </p>
              </div>
            </div>
            <h3>What this component does</h3>
            <p>
              {n.kind === "traffic"
                ? "Generates requests with seeded, irregular arrival times. The configured rate is an average; short bursts happen naturally."
                : n.kind === "service"
                  ? "Looks up a short URL and returns its destination. Each request passes through this service before checking the cache or database."
                  : n.kind === "database"
                    ? "Looks up the original URL. Requests wait in a FIFO queue when the database is busy; a full queue rejects new arrivals."
                    : "Returns a cached destination on a hit. A miss continues to the database. The hit rate is a fixed probability, with no warm-up or eviction model."}
            </p>
            <h3>{overloaded ? "Why a queue builds" : "What to watch"}</h3>
            <p>
              {overloaded
                ? "Requests arrive faster than this component can process them. Waiting time rises until the queue fills or requests time out."
                : "Even below average capacity, bursts can briefly create a queue. Watch utilization and latency together."}
            </p>
            {m && !!metrics?.time && (
              <dl className="node-measurements">
                <div>
                  <dt>Arrived</dt>
                  <dd>{m.arrived.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Waiting now</dt>
                  <dd>{m.queued}</dd>
                </div>
                <div>
                  <dt>Busy time</dt>
                  <dd>{(m.utilization * 100).toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Rejected here</dt>
                  <dd>{m.rejected.toLocaleString()}</dd>
                </div>
              </dl>
            )}
            <h3>Try a change</h3>
            {!g.nodes.some((n) => n.kind === "cache") &&
            n.kind === "database" ? (
              <button className="suggestion" onClick={editor.insertCache}>
                <LayersIcon />
                Add a cache
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                className="suggestion"
                onClick={() => setTab("configuration")}
              >
                <SlidersHorizontal size={16} />
                Adjust configuration
                <ArrowRight size={16} />
              </button>
            )}
            <p className="small muted">
              Prediction above uses configured rates. Live metrics below come
              only from this simulation.
            </p>
          </>
        )}
      </div>
      <div className="inspector-bottom">
        <Info size={14} />
        <span>Black box · one explicit processing model</span>
      </div>
    </aside>
  );
}
function LayersIcon() {
  const Icon = icons.cache;
  return <Icon size={16} />;
}

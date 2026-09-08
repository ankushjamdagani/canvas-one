import { RoutingPanel } from "./RoutingPanel";
import { hasBalancer, serviceInstances } from "../domain/routing";
import { ExperimentCoach } from "./ExperimentCoach";
import { JobControls } from "./JobControls";
import { isJobGraph } from "../domain/model";
import {
  MAX_SERVICE_WORKERS,
  workerCount,
  totalCapacity,
  isDiagramGraph,
} from "../domain/model";
import { componentDefinition } from "../domain/componentCatalog";
import { useState } from "react";
import {
  ArrowRight,
  Info,
  Trash2,
  TriangleAlert,
  SlidersHorizontal,
  ScanLine,
} from "lucide-react";
import { useEditor } from "../state/editor";
import { expectedDatabaseRate } from "../domain/model";
import type { Metrics } from "../simulation/engine";
import { NumberField } from "./NumberField";
import { WorkloadControls } from "./WorkloadControls";
import { rateAt, profileLabel } from "../domain/workload";
import { icons } from "./ArchitectureCanvas";
export function Inspector({ metrics }: { metrics: Metrics | null }) {
  const editor = useEditor(),
    g = editor.project.graph,
    n = g.nodes.find((n) => n.id === editor.selected),
    [tab, setTab] = useState("explanation");
  if (!n && isDiagramGraph(g))
    return <aside className="inspector">
      <div className="inspector-heading"><SlidersHorizontal size={20} /><strong>Architecture diagram</strong></div>
      <div className="inspector-body">
        <h2>Compose before you calculate.</h2>
        <p>Use the component library to map responsibilities, data stores, asynchronous paths, edge services, and operational dependencies.</p>
        <div className="section-rule" />
        <h3>Build the path</h3>
        <p>Search the library, add a component, and drag between handles to connect it. Select any component to name its responsibility or record a technology choice.</p>
        <div className="note"><Info size={16} /><p>This is a visual architecture layer. Switch to an experiment path when you want exact queueing and capacity simulation.</p></div>
      </div>
      <div className="inspector-bottom"><Info size={14} /><span>Diagram layer · freely connected</span></div>
    </aside>;
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
          <ExperimentCoach project={editor.project} metrics={metrics} />
          <div className="section-rule" />
          <WorkloadControls />
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
            label={isJobGraph(g) ? "Job deadline" : "Request timeout"}
            value={g.settings.timeoutMs}
            min={10}
            max={10000}
            unit="ms"
            onChange={(v) => editor.settings({ timeoutMs: v })}
          />
          <div className="note">
            <Info size={16} />
            <p>
              Same seed and workload profile create the same arrivals. Model
              changes reset the current run.
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
      n.kind === "database"
        ? expectedDatabaseRate(g, metrics?.time ?? 0)
        : rateAt(g.settings, metrics?.time ?? 0) / (n.kind === "service" && hasBalancer(g) ? serviceInstances(g).length : 1),
    capacity =
      n.kind === "queue"
        ? totalCapacity(g.nodes.find((n) => n.kind === "worker") ?? n)
        : totalCapacity(n),
    overloaded = !["traffic", "balancer"].includes(n.kind) && demand !== null && demand > capacity;
  if (isDiagramGraph(g)) {
    const definition = componentDefinition(n.kind);
    return <aside className="inspector">
      <div className="inspector-heading"><Icon size={22} /><strong>{n.name}</strong><span className="tag">{definition.category}</span></div>
      <div className="inspector-body diagram-inspector">
        <div className="status-callout"><Icon size={22} /><div><strong>{definition.label}</strong><p>{definition.description}</p></div></div>
        <label className="field"><span>Component name</span><input value={n.name} maxLength={80} onChange={(event) => editor.updateNode(n.id, { name: event.target.value })} /></label>
        <label className="field"><span>Responsibility or technology</span><textarea value={n.description ?? ""} maxLength={240} rows={5} placeholder="What does this component own? Add a technology, protocol, or design decision." onChange={(event) => editor.updateNode(n.id, { description: event.target.value })} /></label>
        <div className="note"><Info size={16} /><p>Connect either side of the component. Diagram components document architecture; they do not invent simulation behavior.</p></div>
        <button className="danger subtle" onClick={() => editor.remove(n.id)}><Trash2 size={15} />Delete component</button>
      </div>
      <div className="inspector-bottom"><Info size={14} /><span>Diagram layer · freely connected</span></div>
    </aside>;
  }
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
        <button
          className="inspect-internals"
          onClick={() => editor.toggleExpanded(n.id)}
        >
          <ScanLine size={16} />
          {editor.project.expandedNodeIds?.includes(n.id)
            ? "Hide internals on canvas"
            : "Show internals on canvas"}
        </button>
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
            {n.kind === "balancer" ? <RoutingPanel metrics={metrics} /> : ["queue", "worker"].includes(n.kind) ? (
              <JobControls node={n} />
            ) : n.kind === "traffic" ? (
              <WorkloadControls />
            ) : (
              <>
                <NumberField
                  label="Processing capacity"
                  min={1}
                  max={100000}
                  value={n.capacity}
                  unit={n.kind === "service" ? "req/s/worker" : "req/s"}
                  onChange={(v) => editor.updateNode(n.id, { capacity: v })}
                />
                {n.kind === "service" && (
                  <>
                    <NumberField
                      label="Service workers"
                      min={1}
                      max={MAX_SERVICE_WORKERS}
                      value={workerCount(n)}
                      onChange={(v) =>
                        editor.updateNode(n.id, { workers: Math.round(v) })
                      }
                    />
                    <p className="small muted">
                      {workerCount(n)} workers × {n.capacity.toLocaleString()}{" "}
                      req/s each = {totalCapacity(n).toLocaleString()} req/s
                      total. One shared FIFO queue; waiting slots exclude active
                      workers.
                    </p>
                  </>
                )}
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
              <>
                <label className="field"><span>Cache model</span><select aria-label="Cache model" value={n.cacheMode ?? "fixed"} onChange={(e) => editor.updateNode(n.id, { cacheMode: e.target.value as "fixed" | "lru" })}><option value="fixed">Fixed probability</option><option value="lru">Finite LRU + TTL</option></select></label>
                {(n.cacheMode ?? "fixed") === "fixed" ? <NumberField label="Cache hit rate" min={0} max={100} value={n.hitRate} unit="%" onChange={(v) => editor.updateNode(n.id, { hitRate: v })} /> : <><NumberField label="Cache entries" min={1} max={100000} value={n.cacheEntries ?? 100} onChange={(v) => editor.updateNode(n.id, { cacheEntries: Math.round(v) })} /><NumberField label="Entry TTL" min={1} max={3600000} value={n.cacheTtlMs ?? 10000} unit="ms" onChange={(v) => editor.updateNode(n.id, { cacheTtlMs: v })} /></>}
              </>
            )}
            {n.kind === "traffic" && !isJobGraph(g) && <><label className="field"><span>URL popularity</span><select aria-label="URL popularity" value={n.popularity ?? "uniform"} onChange={(e) => editor.updateNode(n.id, { popularity: e.target.value as "uniform" | "hot", hotSubset: Math.min(n.hotSubset ?? 10, (n.catalogSize ?? 1000) - 1) })}><option value="uniform">Uniform catalog</option><option value="hot">Hot links</option></select></label><NumberField label="URL catalog size" min={2} max={100000} value={n.catalogSize ?? 1000} onChange={(v) => editor.updateNode(n.id, { catalogSize: Math.round(v), hotSubset: Math.min(n.hotSubset ?? 10, Math.round(v) - 1) })} />{(n.popularity ?? "uniform") === "hot" && <><NumberField label="Hot-link URLs" min={1} max={(n.catalogSize ?? 1000) - 1} value={n.hotSubset ?? 10} onChange={(v) => editor.updateNode(n.id, { hotSubset: Math.round(v) })} /><NumberField label="Hot-link traffic share" min={0} max={100} value={n.hotShare ?? 80} unit="%" onChange={(v) => editor.updateNode(n.id, { hotShare: v })} /></>}</>}
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
        ) : n.kind === "balancer" ? <RoutingPanel metrics={metrics} /> : (
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
                        : demand === null ? "Run to measure database demand" : "Room to handle this workload"}
                </strong>
                <p>
                  {overloaded
                    ? `${Math.round(demand!)} expected arrivals/s · ${capacity} total capacity/s`
                    : n.kind === "traffic"
                      ? profileLabel(g.settings)
                      : demand === null ? "Observed after the run" : `${Math.round(demand)} expected arrivals/s`}
                </p>
              </div>
            </div>
            {n.kind === "service" && hasBalancer(g) && <p className="note">Service instance {serviceInstances(g).findIndex((instance) => instance.id === n.id) + 1} of {serviceInstances(g).length}. This instance owns its workers and queue. Round robin gives equal turns, regardless of capacity; the downstream database is shared.</p>}
            <h3>What this component does</h3>
            <p>
              {n.kind === "queue"
                ? "Admits jobs to a bounded shared FIFO queue. Producer acknowledgment follows admission after 8 ms; it does not mean processing succeeded. Retries rejoin the tail and can fail permanently if waiting space is full."
                : n.kind === "worker"
                  ? "Runs independent job attempts. A successful attempt completes the job; failed attempts retry up to the configured limit after a fixed backoff. The deadline starts at original submission and includes all waiting and retries. Expired active work still consumes its slot. Failure draws are seeded per job and attempt."
                  : n.kind === "traffic"
                    ? "Generates requests with seeded, irregular arrival times. The configured rate is an average; short bursts happen naturally."
                    : n.kind === "service"
                      ? "Looks up a short URL and returns its destination. Workers process requests concurrently from one shared FIFO queue. Each worker takes 1 ÷ per-worker capacity seconds per request; increasing workers increases total capacity, not individual request speed."
                      : n.kind === "database"
                        ? "Looks up the original URL. Requests wait in a FIFO queue when the database is busy; a full queue rejects new arrivals."
                        : `Returns a cached destination on a hit. A miss continues to the database. ${(n.cacheMode ?? "fixed") === "lru" ? "The finite cache starts empty; successful database completions populate it, hits refresh recency, and TTL expiration creates misses." : "The fixed probability is a simple configured assumption with no warm-up or eviction model."}`}
            </p>
            <h3>{overloaded ? "Why a queue builds" : "What to watch"}</h3>
            <p>
              {overloaded
                ? "Requests arrive faster than this component can process them. Waiting time rises until the queue fills or requests time out."
                : demand === null ? "Finite-cache demand depends on URL reuse, fills and expiry. Watch observed database arrivals, utilization and waiting after a run." : "Even below average capacity, bursts can briefly create a queue. Watch utilization and latency together."}
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
                  <dt>
                    {n.kind === "service" ? "Worker utilization" : "Busy time"}
                  </dt>
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
        <span>One model · expand to inspect</span>
      </div>
    </aside>
  );
}
function LayersIcon() {
  const Icon = icons.cache;
  return <Icon size={16} />;
}

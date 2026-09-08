import { hasBalancer } from "./domain/routing";
import { experiments } from "./domain/experiments";
import { SubsystemsPanel } from "./components/SubsystemsPanel";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import {
  Play,
  Pause,
  RotateCcw,
  Undo2,
  Redo2,
  Workflow,
  ArrowUpRight,
  Plus,
  Download,
  Upload,
  FolderOpen,
  Check,
  BookmarkPlus,
  BarChart3,
  X,
  Info,
  ChevronRight,
  TriangleAlert,
  Search,
} from "lucide-react";
import { useEditor } from "./state/editor";
import {
  newProject,
  isJobGraph,
  isDiagramGraph,
  labels,
  validateGraph,
  type ComponentKind,
  type Project,
} from "./domain/model";
import { componentCatalog, componentCategories } from "./domain/componentCatalog";
import { architectureTemplates, type ArchitectureTemplateId } from "./domain/architectureTemplates";
import {
  repository,
  exportProject,
  importProject,
} from "./persistence/projects";
import { profileLabel } from "./domain/workload";
import { useSimulation } from "./simulation/useSimulation";
import { ArchitectureCanvas, icons } from "./components/ArchitectureCanvas";
import { Inspector } from "./components/Inspector";
const ResultsPanel = lazy(() =>
  import("./components/ResultsPanel").then((module) => ({
    default: module.ResultsPanel,
  })),
);
import { createSavedRun, defaultRunName } from "./domain/results";
import { MetricsPanel } from "./components/MetricsPanel";
export default function App() {
  const editor = useEditor(),
    { project } = editor,
    graph = project.graph,
    simulation = useSimulation(graph, project.id);
  const [ready, setReady] = useState(false),
    [saved, setSaved] = useState("Loading…"),
    [error, setError] = useState(""),
    [projects, setProjects] = useState<Project[]>([]),
    [projectPanel, setProjectPanel] = useState(false),
    [assumptions, setAssumptions] = useState(false),
    [checkpointName, setCheckpointName] = useState(""),
    [notice, setNotice] = useState("");
  const [componentSearch, setComponentSearch] = useState("");
  const [architectureTemplateId, setArchitectureTemplateId] = useState<ArchitectureTemplateId | "">("");
  const [resultsOpen, setResultsOpen] = useState(false),
    [selectedResult, setSelectedResult] = useState<string | null>(null),
    [savingResult, setSavingResult] = useState(false),
    [resultName, setResultName] = useState("");
  const jobsMode = isJobGraph(graph);
  const diagramMode = isDiagramGraph(graph);
  const savedRuns = project.savedRuns ?? [];
  const resultSaved =
    !!simulation.result &&
    savedRuns.some((run) => run.id === simulation.result!.id);
  useEffect(() => {
    setResultsOpen(false);
    setSelectedResult(null);
    setSavingResult(false);
  }, [project.id]);
  useEffect(() => {
    setSavingResult(false);
  }, [simulation.result?.id]);
  const saveResult = () => {
    if (!simulation.result) return;
    try {
      const result = createSavedRun(simulation.result, resultName);
      if (!editor.saveRun(result)) {
        setError(
          "This project already has 20 saved results. Delete one before saving another.",
        );
        return;
      }
      setSavingResult(false);
      setSelectedResult(result.id);
      setResultsOpen(true);
      setNotice("Result saved with its model, workload and observed metrics.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save this result.",
      );
    }
  };
  const fileInput = useRef<HTMLInputElement>(null),
    saveQueue = useRef(Promise.resolve()),
    boot = useRef(false);
  const errors = validateGraph(graph),
    hasCache = graph.nodes.some((n) => n.kind === "cache");
  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    repository
      .list()
      .then((list) => {
        setProjects(list);
        if (list.length) editor.load(list[0]);
        setReady(true);
      })
      .catch(() => {
        setError(
          "Local storage is unavailable. You can still build and export your project.",
        );
        setReady(true);
      });
  }, []);
  useEffect(() => {
    if (!ready) return;
    setSaved("Saving…");
    const copy = structuredClone(project);
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          await repository.save(copy);
          if (useEditor.getState().project.updatedAt === copy.updatedAt)
            setSaved("Saved locally");
          setProjects(await repository.list());
        })
        .catch(() => {
          setSaved("Save failed");
          setError(
            "Could not save to this browser. Export your project to keep a copy.",
          );
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [project, ready]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const switchProject = async (p: Project) => {
    try {
      await saveQueue.current;
      await repository.save(project);
      editor.load(p);
      setProjectPanel(false);
    } catch {
      setError(
        "Could not save the current project. Export it before switching.",
      );
    }
  };
  const download = () => {
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob([exportProject(project)], { type: "application/json" }),
      );
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.system-studio.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const p = importProject(await file.text());
      await repository.save(project);
      await repository.save(p);
      editor.load(p);
      setProjectPanel(false);
      setNotice("Project imported as a new local copy.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import this file.");
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  return (
    <div className="studio">
      <aside className="library">
        <div className="brand">
          <Workflow size={25} />
          <span>
            System studio<span className="brand-dot">.</span>
          </span>
        </div>
        <button
          className={`project-switch ${projectPanel ? "active" : ""}`}
          onClick={() => setProjectPanel(!projectPanel)}
          aria-expanded={projectPanel}
        >
          <span>{project.name}</span>
          <FolderOpen size={15} />
        </button>
        <div className="scenario-picker">
          <label>
            <span>Experiment path</span>
            <select
              aria-label="Experiment path"
              value={diagramMode ? "diagram" : jobsMode ? "jobs" : hasBalancer(graph) ? "balanced" : "lookup"}
              onChange={(e) =>
                editor.useScenario(e.target.value as "jobs" | "lookup" | "balanced" | "diagram")
              }
            >
              <option value="lookup">URL lookup</option>
              <option value="jobs">Background jobs</option>
              <option value="balanced">Load-balanced lookup</option>
              <option value="diagram">Architecture diagram</option>
            </select>
          </label>
          <p>Loads a starter model. Undo restores your canvas.</p>
        </div>
        {!diagramMode && <div className="guided-picker">
          <label>
            <span>Guided experiment</span>
            <select
              aria-label="Guided experiment"
              value={project.graph.guideId ?? ""}
              onChange={(e) => editor.loadExperiment(e.target.value)}
            >
              <option value="">Explore freely</option>
              {experiments.map((experiment) => (
                <option key={experiment.id} value={experiment.id}>
                  {experiment.title}
                </option>
              ))}
            </select>
          </label>
        </div>}
        <div className="library-section">
          <h2>Components</h2>
          <p>{diagramMode ? "Search and add building blocks" : "Click to add to your canvas"}</p>
          {diagramMode ? (
            <>
              <details className="architecture-templates">
                <summary>Architecture templates</summary>
                <p>Loading replaces the current diagram. You can Undo to restore it.</p>
                <label>
                  <span>Template</span>
                  <select aria-label="Architecture template" value={architectureTemplateId} onChange={(event) => setArchitectureTemplateId(event.target.value as ArchitectureTemplateId | "")}>
                    <option value="">Choose a template</option>
                    {architectureTemplates.map((template) => <option value={template.id} key={template.id}>{template.title}</option>)}
                  </select>
                </label>
                {architectureTemplateId && <p className="template-purpose">{architectureTemplates.find((template) => template.id === architectureTemplateId)?.purpose}</p>}
                <button className="load-template" disabled={!architectureTemplateId} onClick={() => architectureTemplateId && editor.loadArchitectureTemplate(architectureTemplateId)}>Load template</button>
              </details>
              <label className="component-search">
                <Search size={14} />
                <input aria-label="Search components" placeholder="Search components" value={componentSearch} onChange={(event) => setComponentSearch(event.target.value)} />
              </label>
              <div className="component-catalog">
                {componentCategories.map((category) => {
                  const matches = componentCatalog.filter((item) => item.category === category && `${item.label} ${item.description}`.toLowerCase().includes(componentSearch.trim().toLowerCase()));
                  if (!matches.length) return null;
                  return <section key={category} className="component-category"><h3>{category}</h3>{matches.map((item) => { const Icon = icons[item.kind]; return <button className="library-item" key={item.kind} disabled={graph.nodes.length >= 100} onClick={() => editor.add(item.kind)} title={graph.nodes.length >= 100 ? "This diagram has reached 100 components." : item.description}><Icon size={20} /><span>{item.label}</span><Plus size={14} /></button>; })}</section>;
                })}
                {!componentCatalog.some((item) => `${item.label} ${item.description}`.toLowerCase().includes(componentSearch.trim().toLowerCase())) && <p className="component-empty">No components match. Try “storage”, “edge”, or “queue”.</p>}
              </div>
            </>
          ) : (jobsMode
            ? (["traffic", "queue", "worker"] as ComponentKind[])
            : (["traffic", "balancer", "service", "database", "cache"] as ComponentKind[])
          ).map((kind) => {
            const Icon = icons[kind];
            return (
              <button
                className="library-item"
                key={kind}
                disabled={kind === "balancer" && hasBalancer(graph)}
                onClick={() => editor.add(kind)}
              >
                <Icon size={20} />
                <span>{labels[kind]}</span>
                <Plus size={14} />
              </button>
            );
          })}
          <div className="library-caption">
            {diagramMode ? "Diagram components are visual. Simulation remains available in the executable experiment paths." : jobsMode ? "Queue admission and worker processing." : "Add a load balancer, then service instances to share traffic."}
          </div>
        </div>
        <details className="checkpoints" open={window.innerWidth > 560}>
          <summary className="section-heading">
            <h2>Checkpoints</h2>
            <BookmarkPlus size={16} />
          </summary>
          {project.checkpoints.length ? (
            <div className="checkpoint-list">
              {project.checkpoints.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    editor.restore(c.id);
                    setNotice(`Restored “${c.name}”.`);
                  }}
                >
                  <span className="checkpoint-dot" />
                  <span>{c.name}</span>
                  <ChevronRight size={13} />
                </button>
              ))}
            </div>
          ) : (
            <p>Keep a version before trying something new.</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              editor.checkpoint(
                checkpointName.trim() ||
                  `Checkpoint ${project.checkpoints.length + 1}`,
              );
              setCheckpointName("");
              setNotice(
                "Checkpoint saved with the current model and settings.",
              );
            }}
          >
            <input
              aria-label="Checkpoint name"
              placeholder="Name this checkpoint"
              value={checkpointName}
              maxLength={80}
              onChange={(e) => setCheckpointName(e.target.value)}
            />
            <button className="subtle" type="submit">
              <Plus size={14} />
              Save checkpoint
            </button>
          </form>
        </details>
        <SubsystemsPanel key={project.id} />
        <div className="saved-runs-library">
          <button
            className="saved-runs-heading"
            onClick={() => setResultsOpen(!resultsOpen)}
            aria-expanded={resultsOpen}
          >
            <BarChart3 size={16} />
            <span>Saved runs</span>
            <small>{savedRuns.length}</small>
          </button>
          {savedRuns.length ? (
            <div className="saved-runs-list">
              {savedRuns
                .slice()
                .reverse()
                .map((run) => (
                  <button
                    key={run.id}
                    onClick={() => {
                      setSelectedResult(run.id);
                      setResultsOpen(true);
                    }}
                    title={run.name}
                  >
                    <span>{run.name}</span>
                    <ChevronRight size={13} />
                  </button>
                ))}
            </div>
          ) : (
            <p>Finish a run, then save its result to compare later.</p>
          )}
        </div>
        <button
          className="assumptions-link"
          onClick={() => setAssumptions(!assumptions)}
        >
          <Info size={16} />
          <span>How the model works</span>
          <ArrowUpRight size={14} />
        </button>
        <div className="local-footnote">
          <span className="save-dot" />
          Local workspace · v0.1
        </div>
      </aside>
      <main className="workspace">
        <header className="toolbar">
          <div className="history-actions">
            <button
              aria-label="Undo"
              title="Undo model edit"
              disabled={!editor.past.length}
              onClick={editor.undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              aria-label="Redo"
              title="Redo model edit"
              disabled={!editor.future.length}
              onClick={editor.redo}
            >
              <Redo2 size={17} />
            </button>
            <span className="toolbar-divider" />
            <span className="workspace-label">Architecture playground</span>
            {graph.guideId && (
              <button
                aria-label="Show experiment guide"
                onClick={() => editor.select(null)}
              >
                Guide
              </button>
            )}
          </div>
          <div className="run-actions">
            <span className="save-status" role="status">
              <span
                className={`save-dot ${saved === "Save failed" ? "failed" : ""}`}
              />
              {saved}
            </span>
            <button
              className="primary"
              disabled={diagramMode || !!errors.length || !ready}
              onClick={simulation.toggle}
            >
              {simulation.running ? (
                <Pause size={15} />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
              {diagramMode ? "Diagram only" : simulation.running
                ? "Pause"
                : simulation.metrics?.finished
                  ? "Replay"
                  : simulation.metrics?.time
                    ? "Resume"
                    : "Run"}
            </button>
            <button
              onClick={simulation.reset}
              disabled={diagramMode || !!errors.length}
              className="reset-button"
            >
              <RotateCcw size={15} />
              Reset
            </button>
          </div>
        </header>
        <div className="canvas-shell">
          <div className="experiment-heading">
            <div>
              <h1>{diagramMode ? "Map the whole system." : jobsMode ? "Follow a job." : "Follow a request."}</h1>
              <p>{diagramMode ? "Choose components. Connect responsibilities. Name the boundaries." : "Find the bottleneck. Change one thing. Replay."}</p>
              <p className="mobile-pan-hint">
                {diagramMode ? "Drag to explore the architecture →" : "Drag the canvas to follow the request →"}
              </p>
            </div>
            <span className="tag">
              {diagramMode ? "Architecture diagram" : jobsMode
                ? "Background jobs experiment"
                : "URL shortener experiment"}
            </span>
          </div>
          <div className="canvas-area">
            <ReactFlowProvider key={project.id}>
              <ArchitectureCanvas
                metrics={simulation.metrics}
                running={simulation.running}
              />
            </ReactFlowProvider>
          </div>
          {!diagramMode && <div className="experiment-guide">
            <div className="guide-copy">
              <span
                className={`guide-status ${simulation.running ? "running" : ""}`}
              />
              <div>
                <strong>
                  {simulation.running
                    ? "Watching requests move through your system"
                    : simulation.metrics?.finished
                      ? "Run complete. What changed?"
                      : "One experiment, three moments"}
                </strong>
                <span>
                  {simulation.running
                    ? `4× playback · ${profileLabel(graph.settings)}`
                    : jobsMode
                      ? "Compare admission, completion and retries. Scale workers to drain the queue."
                      : hasBalancer(graph) ? "Compare instance queues, then inspect the shared database bottleneck." : "Run the baseline, raise the traffic, then give the database some help."}
                </span>
              </div>
            </div>
            <div className="scenario-actions">
              <button
                className={
                  graph.settings.traffic === 100 &&
                  (!graph.settings.profile ||
                    graph.settings.profile.kind === "steady")
                    ? "active"
                    : ""
                }
                onClick={() => {
                  editor.settings({
                    traffic: 100,
                    profile: { kind: "steady" },
                  });
                  editor.select(null);
                }}
              >
                100 req/s
              </button>
              <button
                className={
                  graph.settings.traffic === 700 &&
                  (!graph.settings.profile ||
                    graph.settings.profile.kind === "steady")
                    ? "active"
                    : ""
                }
                onClick={() => {
                  editor.settings({
                    traffic: 700,
                    profile: { kind: "steady" },
                  });
                  editor.select(
                    graph.nodes.find((n) => n.kind === "database")?.id ?? null,
                  );
                }}
              >
                700 req/s
              </button>
              {simulation.result && (
                <button
                  disabled={resultSaved}
                  onClick={() => {
                    setResultName(defaultRunName(simulation.result!.graph));
                    setSavingResult(true);
                  }}
                >
                  <BookmarkPlus size={14} />
                  {resultSaved ? "Result saved" : "Save result"}
                </button>
              )}
              <button
                disabled={hasCache || !!errors.length || jobsMode}
                onClick={() => {
                  editor.insertCache();
                  setNotice(
                    "Cache connected. Before and after checkpoints saved. Replay the same workload.",
                  );
                }}
              >
                <Plus size={14} />
                {jobsMode
                  ? "Queue → workers"
                  : hasCache
                    ? "Cache added"
                    : "Add cache"}
              </button>
            </div>
            {savingResult && simulation.result && (
              <form
                className="save-result-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveResult();
                }}
              >
                <label>
                  <span>Result name</span>
                  <input
                    aria-label="Result name"
                    maxLength={80}
                    value={resultName}
                    onChange={(event) => setResultName(event.target.value)}
                    autoFocus
                  />
                </label>
                <button type="submit" className="primary">
                  Save
                </button>
                <button type="button" onClick={() => setSavingResult(false)}>
                  Cancel
                </button>
              </form>
            )}
          </div>}
          {errors.length > 0 && (
            <div className="validation" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>Connect a supported request path to run</strong>
                {errors.map((e) => (
                  <p key={e}>{e}</p>
                ))}
              </div>
            </div>
          )}
        </div>
        {resultsOpen ? (
          <Suspense
            fallback={
              <section
                className="results-panel"
                role="status"
                aria-label="Saved experiment results"
              >
                Loading saved results…
              </section>
            }
          >
            <ResultsPanel
              key={project.id}
              selectedId={selectedResult}
              onClose={() => setResultsOpen(false)}
              onRestore={(id) => {
                editor.restoreRun(id);
                setResultsOpen(false);
                setNotice(
                  "Saved model and workload restored. Run to replay; Undo returns to your previous canvas.",
                );
              }}
            />
          </Suspense>
        ) : diagramMode ? (
          <section className="diagram-status" aria-label="Diagram guidance">
            <strong>{graph.nodes.length} components · {graph.edges.length} connections</strong>
            <span>{graph.nodes.length >= 100 ? "Component limit reached. " : ""}{graph.edges.length >= 200 ? "Connection limit reached." : "Drag from a handle to connect. Select a connection to describe its flow or delete it."}</span>
          </section>
        ) : (
          <MetricsPanel
            metrics={simulation.metrics}
            previous={simulation.previous}
            graph={graph}
          />
        )}
      </main>
      <Inspector metrics={simulation.metrics} />
      {projectPanel && (
        <section className="project-panel" aria-label="Local projects">
          <div className="panel-title">
            <h2>Your local projects</h2>
            <button
              aria-label="Close projects"
              onClick={() => setProjectPanel(false)}
            >
              <X size={17} />
            </button>
          </div>
          <label className="field">
            <span>Current project name</span>
            <input
              aria-label="Project name"
              maxLength={80}
              value={project.name}
              onChange={(e) => editor.rename(e.target.value)}
            />
          </label>
          <div className="project-list">
            {projects.map((p) => (
              <button key={p.id} onClick={() => switchProject(p)}>
                <FolderOpen size={17} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {new Date(p.updatedAt).toLocaleDateString()} ·{" "}
                    {p.graph.nodes.length} components
                  </small>
                </span>
                {p.id === project.id && <Check size={16} />}
              </button>
            ))}
          </div>
          <button
            className="subtle"
            onClick={() =>
              switchProject(
                newProject(`Untitled project ${projects.length + 1}`),
              )
            }
          >
            <Plus size={15} />
            New project
          </button>
          <div className="panel-actions">
            <button onClick={download}>
              <Download size={15} />
              Export JSON
            </button>
            <button onClick={() => fileInput.current?.click()}>
              <Upload size={15} />
              Import JSON
            </button>
          </div>
          <p className="small muted">
            Saved in this browser. Export a copy to move devices or keep a
            backup.
          </p>
        </section>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => importFile(e.target.files?.[0])}
      />
      {assumptions && (
        <section className="assumptions-panel" aria-label="Model assumptions">
          <div className="panel-title">
            <h2>What this simulation assumes</h2>
            <button
              aria-label="Close assumptions"
              onClick={() => setAssumptions(false)}
            >
              <X size={18} />
            </button>
          </div>
          <p>
            An educational model for understanding cause and effect. Moving dots
            show direction, not individual requests or measured speed.
            Capacities are illustrative, not real hardware measurements.
          </p>
          <dl>
            <dt>Arrival pattern</dt>
            <dd>
              Seeded Poisson arrivals follow the configured steady, burst or
              linear-ramp rate. Replay preserves every arrival when seed and the
              complete traffic profile stay the same.
            </dd>
            <dt>Processing & queues</dt>
            <dd>
              Services have 1–16 parallel workers, each processing at the
              configured per-worker capacity. Total capacity is workers ×
              per-worker capacity; processing time per request remains 1 ÷
              per-worker capacity. Database and cache each have one processor.
              One bounded FIFO queue per component excludes active work.
              Arrivals are rejected only when all workers are busy and the queue
              is full. Worker utilization is occupied processor time divided by
              workers × elapsed time.
            </dd>
            <dt>Load balancing & instances</dt>
            <dd>Optional round-robin routing sends arrivals to 1–8 service instances in their listed order. Each instance owns 1–16 workers and one queue. The balancer is instantaneous with no capacity limit or queue. Equal turns are independent of instance capacity; full queues reject without rerouting. All instances share the optional cache and database. Moving nodes does not change routing order.</dd>
            <dt>Cache</dt>
            <dd>
              Fixed probability is a simple independent hit assumption. Finite LRU
              starts empty and fills on live database completion; hits refresh
              recency, while TTL starts at fill and does not refresh on hits.
              Expired keys miss; capacity evicts the least recently used live key.
              Hits return after cache processing; misses reach the database.
              No miss coalescing, writes or invalidations are simulated.
            </dd>
            <dt>Timeouts & responses</dt>
            <dd>
              One deadline from arrival, including a fixed 8 ms response
              overhead. Timed-out work already processing finishes but cannot
              succeed. Expired waiting requests are removed.
            </dd>
            <dt>End of an experiment</dt>
            <dd>
              The run stops at its configured duration. Outstanding requests
              remain counted as in flight. Successful-request latency excludes
              failures. Utilization and throughput are averages since the start.
            </dd>
            <dt>Scope</dt>
            <dd>
              Two paths: URL lookup and queued background jobs. Job retries use
              a fixed backoff and an original-submission deadline. Producer
              acknowledgements confirm queue admission after 8 ms, not
              completion. Retrying jobs can fail permanently if the queue is
              full. No state replication, network contention, health checks or worker crashes. Moving
              a node changes only the view.
            </dd>
          </dl>
        </section>
      )}
      {(error || simulation.error) && (
        <div className="error-banner" role="alert">
          <TriangleAlert size={18} />
          <span>{error || simulation.error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}

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
import "./components/openWorkspace.css";
import { useEditor } from "./state/editor";
import {
  isOpenGraph,
  validateGraph,
  type Project,
} from "./domain/model";
import { newOpenProject, createRunnableCopy } from "./domain/openGraph";
import { componentCatalog, componentCategories } from "./domain/componentCatalog";
import { openExample } from "./domain/openExamples";
import {
  repository,
  exportProject,
  importProject,
} from "./persistence/projects";
import { useSimulation } from "./simulation/useSimulation";
import { ArchitectureCanvas, icons } from "./components/ArchitectureCanvas";
import { Inspector } from "./components/Inspector";
import { OpenMetricsPanel } from "./components/OpenMetricsPanel";
import { ExamplesPanel } from "./components/ExamplesPanel";
import { DiagramExport } from "./components/DiagramExport";

const ResultsPanel = lazy(() =>
  import("./components/ResultsPanel").then((module) => ({
    default: module.ResultsPanel,
  })),
);
const RevisionsPanel = lazy(() =>
  import("./components/RevisionsPanel").then((module) => ({
    default: module.RevisionsPanel,
  })),
);
const OpenInspector = lazy(() =>
  import("./components/OpenInspector").then((module) => ({
    default: module.OpenInspector,
  })),
);

import { createSavedRun, defaultRunName } from "./domain/results";
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
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false),
    [selectedResult, setSelectedResult] = useState<string | null>(null),
    [savingResult, setSavingResult] = useState(false),
    [resultName, setResultName] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);

  const isOpen = isOpenGraph(graph);
  const isReadOnly = editor.readOnly;
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
  const guide = graph.guideId
    ? openExample(graph.guideId)
    : null;

  const saveResult = () => {
    if (!simulation.result || isReadOnly) return;
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
  const errors = validateGraph(graph);
  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    repository
      .list()
      .then((list) => {
        setProjects(list);
        if (list.length) editor.load(list[0], !isOpenGraph(list[0].graph));
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
    if (editor.readOnly) {
      setSaved("Read-only archive");
      return;
    }
    setSaved("Saving…");
    const copy = structuredClone(project);
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          await repository.save(copy);
          if (useEditor.getState().project.id === copy.id && useEditor.getState().project.updatedAt === copy.updatedAt)
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
  }, [project, ready, editor.readOnly]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const switchProject = async (p: Project) => {
    try {
      await saveQueue.current;
      if (!editor.readOnly) await repository.save(project);
      const isReadOnlyTarget = !isOpenGraph(p.graph);
      editor.load(p, isReadOnlyTarget);
      if (isReadOnlyTarget) setSaved("Read-only archive");
      setProjectPanel(false);
    } catch {
      setError(
        "Could not save the current project. Export it before switching.",
      );
    }
  };
  const download = () => {
    try {
      const a = document.createElement("a"),
        url = URL.createObjectURL(
          new Blob([exportProject(project)], { type: "application/json" }),
        );
      a.href = url;
      a.download = `${project.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase()}.system-studio.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export project.");
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const p = importProject(await file.text());
      if (!editor.readOnly) {
        await repository.save(project);
      }
      const isReadOnlyImport = !isOpenGraph(p.graph);
      await repository.save(p);
      editor.load(p, isReadOnlyImport);
      if (isReadOnlyImport) {
        setSaved("Read-only archive");
      }
      setProjectPanel(false);
      setNotice(
        isReadOnlyImport
          ? "Archive imported for inspection. Original preserved."
          : "Project imported as a new local copy.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import this file.");
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleCreateRunnableCopy = async () => {
    try {
      const copy = createRunnableCopy(project);
      await repository.save(copy);
      editor.load(copy, false);
      setProjects(await repository.list());
      setNotice("Created runnable open copy. Original archive preserved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy archive.");
    }
  };

  return (
    <div className="studio">
      {isReadOnly && (
        <div className="archive-banner" role="status">
          <div className="archive-banner-copy">
            <TriangleAlert size={16} />
            <strong>Read-only archive</strong> — Legacy system preserved for inspection.
          </div>
          <div className="archive-banner-actions">
            <button onClick={download}>Export original</button>
            <button onClick={handleCreateRunnableCopy}>Create runnable copy</button>
          </div>
        </div>
      )}
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
          <button
            className="subtle"
            style={{ width: "100%", justifyContent: "center", display: "flex", gap: 6 }}
            onClick={() => setExamplesOpen(true)}
            disabled={isReadOnly}
          >
            <Workflow size={15} />
            <span>Examples & tutorials</span>
          </button>
          <p>Explore verified starters and guided exercises.</p>
        </div>

        <div className="library-section">
          <h2>Components</h2>
          <p>Search and add components to your system</p>
          <label className="component-search">
            <Search size={14} />
            <input
              aria-label="Search components"
              placeholder="Search components"
              value={componentSearch}
              onChange={(event) => setComponentSearch(event.target.value)}
              disabled={isReadOnly}
            />
          </label>
          <div className="component-catalog">
            {componentCategories.map((category) => {
              const matches = componentCatalog.filter(
                (item) =>
                  item.category === category &&
                  `${item.label} ${item.description}`
                    .toLowerCase()
                    .includes(componentSearch.trim().toLowerCase()),
              );
              if (!matches.length) return null;
              return (
                <section key={category} className="component-category">
                  <h3>{category}</h3>
                  {matches.map((item) => {
                    const Icon = icons[item.kind];
                    const atNodeLimit = graph.nodes.length >= 100;
                    const atWorkloadLimit =
                      item.kind === "traffic" && (graph.workloads?.length ?? 0) >= 20;
                    const disabled = isReadOnly || atNodeLimit || atWorkloadLimit;
                    return (
                      <button
                        className="library-item"
                        key={item.kind}
                        disabled={disabled}
                        onClick={() => editor.add(item.kind)}
                        title={
                          atNodeLimit
                            ? "System has reached the 100-node limit."
                            : atWorkloadLimit
                              ? "Maximum 20 workloads reached."
                              : item.description
                        }
                      >
                        <Icon size={20} />
                        <span>{item.label}</span>
                        <Plus size={14} />
                      </button>
                    );
                  })}
                </section>
              );
            })}
            {!componentCatalog.some((item) =>
              `${item.label} ${item.description}`
                .toLowerCase()
                .includes(componentSearch.trim().toLowerCase()),
            ) && (
              <p className="component-empty">
                No components match. Try “storage”, “edge”, or “queue”.
              </p>
            )}
          </div>
          <div className="library-caption">
            Max 100 components and 20 workloads. Connect components to configure message and call flow.
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
                  disabled={isReadOnly}
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
          <fieldset disabled={isReadOnly} style={{ border: "none", padding: 0, margin: 0 }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (isReadOnly) return;
                const ok = editor.checkpoint(
                  checkpointName.trim() ||
                    `Checkpoint ${project.checkpoints.length + 1}`,
                );
                if (ok) {
                  setCheckpointName("");
                  setNotice(
                    "Checkpoint saved with the current model and settings.",
                  );
                } else {
                  setError(
                    "Could not save checkpoint. Maximum limit reached.",
                  );
                }
              }}
            >
              <input
                aria-label="Checkpoint name"
                placeholder="Name this checkpoint"
                value={checkpointName}
                maxLength={80}
                onChange={(e) => setCheckpointName(e.target.value)}
                disabled={isReadOnly}
              />
              <button className="subtle" type="submit" disabled={isReadOnly}>
              <Plus size={14} />
              Save checkpoint
            </button>
            </form>
          </fieldset>
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
            <span className="workspace-label">Design and simulate your system</span>
            {guide && (
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
              data-testid="run-button"
              className="primary"
              disabled={!isOpen || !!errors.length || !ready || isReadOnly}
              onClick={simulation.toggle}
            >
              {simulation.running ? (
                <Pause size={15} />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
              {simulation.running
                  ? "Pause"
                  : simulation.metrics?.finished
                    ? "Replay"
                    : simulation.metrics?.time
                      ? "Resume"
                      : "Run"}
            </button>
            <button
              data-testid="reset-button"
              onClick={simulation.reset}
              disabled={isReadOnly || !!errors.length}
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
              <h1>{guide ? guide.title : "Design and simulate your system"}</h1>
              <p>
                {guide
                  ? guide.purpose
                  : "Configure component behaviors, wire calls and messages, and observe modeled system performance."}
              </p>
              <p className="mobile-pan-hint">
                Drag the canvas to pan across components →
              </p>
            </div>
            {guide ? (
              <span className="tag">{guide.title}</span>
            ) : (
              <span className="tag">Open system</span>
            )}
          </div>
          <div className="canvas-area">
            {graph.nodes.length === 0 && (
              <div className="canvas-empty-prompt">
                <h2>Empty canvas</h2>
                <p>Add components from the library or choose an example architecture to begin.</p>
                <div className="canvas-empty-actions">
                  <button className="primary" onClick={() => setExamplesOpen(true)}>Choose example</button>
                </div>
              </div>
            )}
            <ReactFlowProvider key={project.id}>
              <ArchitectureCanvas
                metrics={simulation.metrics}
                running={simulation.running}
              />
            </ReactFlowProvider>
          </div>
          {guide && !isReadOnly && <section className="optional-tutorial" aria-label="Tutorial instructions"><h2>{guide.title}</h2><ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol></section>}
          <div className="experiment-guide">
            <div className="guide-copy">
              <span
                className={`guide-status ${simulation.running ? "running" : ""}`}
              />
              <div>
                <strong>
                  {simulation.error
                    ? "Simulation stopped"
                    : simulation.metrics?.execution?.incomplete
                      ? "Simulation reached resource boundary"
                      : simulation.running
                        ? "Simulation running"
                        : simulation.metrics?.finished
                          ? "Simulation completed"
                          : "Interactive system model"}
                </strong>
                <span>
                  {simulation.error || simulation.metrics?.execution?.incomplete || (
                    simulation.running
                      ? `Observing traffic · duration ${graph.settings.duration}s`
                      : "Adjust component behaviors, workloads, and run simulation."
                  )}
                </span>
              </div>
            </div>
            <div className="scenario-actions">
              {guide && (
                <button
                  className="subtle"
                  onClick={() => {
                    editor.change((g) => {
                      delete g.guideId;
                    });
                  }}
                  title="Dismiss guide instructions"
                >
                  <X size={13} />
                  <span>Dismiss guide</span>
                </button>
              )}
              <button onClick={() => setShowExportModal(!showExportModal)}>Export canvas</button>
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
          </div>
          {showExportModal && (
            <div style={{ padding: "8px 16px", background: "#f8faf9", borderTop: "1px solid #dce5e1" }}>
              <DiagramExport project={project} />
            </div>
          )}
          {errors.length > 0 && (
            <div className="validation" role="alert">
              <TriangleAlert size={18} />
              <div>
                <strong>Graph has draft errors</strong>
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
        ) : (
          <OpenMetricsPanel
              metrics={simulation.metrics}
              previous={simulation.previous}
              graph={graph}
            />
        )}
      </main>
      {isOpen ? (
        <Suspense fallback={<aside className="inspector" />}>
          <OpenInspector metrics={simulation.metrics} />
        </Suspense>
      ) : (
        <fieldset disabled={true} style={{ display: "contents", border: "none", margin: 0, padding: 0 }}>
          <Inspector metrics={simulation.metrics} />
        </fieldset>
      )}
      {examplesOpen && (
        <ExamplesPanel
          onSelect={(graph) => editor.replaceSystem(graph)}
          onClose={() => setExamplesOpen(false)}
        />
      )}
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
              disabled={isReadOnly}
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
            <Suspense fallback={null}>
              <RevisionsPanel key={project.id} />
            </Suspense>
          <button
            className="subtle"
            onClick={async () => {
              try {
                await switchProject(newOpenProject(`Untitled system ${projects.length + 1}`));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not create project.");
              }
            }}
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
              onClick={() => setAssumptions(false)}>
              <X size={18} />
            </button>
          </div>
          <p>
            Arbitrary configured directed behavior graph with illustrative capacities, not actual code execution.
          </p>
          <dl>
            <dt>Sources & Workloads</dt>
            <dd>
              Sources consume zero CPU and hold unlimited logical wait queues. Seeded arrivals support steady, burst, or ramp distributions.
            </dd>
            <dt>Concurrency & Holding</dt>
            <dd>
              Components hold processing concurrency slots across synchronous downstream calls. FIFO queues retry locally before fan-out.
            </dd>
            <dt>Calls & Routers</dt>
            <dd>
              Synchronous calls wait for all their parallel branches. Routers choose one branch using round-robin, weights, or conditions. Cache hits return locally; misses call the configured origin.
            </dd>
            <dt>Brokers & Messages</dt>
            <dd>
              Messages acknowledge admission after the configured acknowledgement and return delays. Acknowledgement does not mean completion. Competing and broadcast broker reservations deliver messages to consumers.
            </dd>
            <dt>TTL & Limits</dt>
            <dd>
              Messages inherit hop limits and TTL deadlines. Processing cleans up expired items. In-flight operations beyond the simulation horizon are accounted for. When simulation limits are hit, results are flagged as incomplete.
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

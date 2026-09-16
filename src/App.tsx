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
  SlidersHorizontal,
  Menu,
  ChevronDown,
  Layers,
  FilePlus,
  Image,
  GitBranch,
} from "lucide-react";
import "./components/openWorkspace.css";
import "./components/canvasFirst.css";
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
import { ArchitectureCanvas, icons, type CanvasControlsHandle } from "./components/ArchitectureCanvas";
import { Inspector } from "./components/Inspector";
import { OpenMetricsPanel } from "./components/OpenMetricsPanel";
import { ExamplesPanel } from "./components/ExamplesPanel";
import { DiagramExport } from "./components/DiagramExport";
import { OpenConnectionEditor } from "./components/OpenConnectionEditor";

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
  const [catalogDrawerOpen, setCatalogDrawerOpen] = useState(false);
  const [inspectorMode, setInspectorMode] = useState<'workloads' | 'tutorial' | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const [projectNameInput, setProjectNameInput] = useState(project.name);
  useEffect(() => {
    setProjectNameInput(project.name);
  }, [project.name, project.id]);

  const handleSaveProjectName = () => {
    const clean = projectNameInput.trim();
    if (!clean || clean === project.name) return;
    editor.rename(clean);
    setNotice(`Project renamed to “${clean}”.`);
  };

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
    setCatalogDrawerOpen(false);
    setInspectorMode(null);
    setSelectedEdgeId(null);
    setShowDetails(false);
  }, [project.id]);
  useEffect(() => {
    setSavingResult(false);
  }, [simulation.result?.id]);
  const guide = graph.guideId
    ? openExample(graph.guideId)
    : null;
  useEffect(() => {
    if (graph.guideId) {
      setInspectorMode('tutorial');
    }
  }, [graph.guideId]);

  useEffect(() => {
    if (editor.selectedNodeIds.length > 0 || editor.selected) {
      setInspectorMode(null);
      setSelectedEdgeId(null);
    }
  }, [editor.selectedNodeIds, editor.selected]);

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
    boot = useRef(false),
    canvasControlsRef = useRef<CanvasControlsHandle>(null);
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
  useEffect(() => {
    if (!projectPanel) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProjectPanel(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [projectPanel]);
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
    setProjectPanel(false);
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
    setProjectPanel(false);
    if (!file) return;
    try {
      const p = importProject(await file.text());
      if (!editor.readOnly) {
        await repository.save(project);
      }
      const isReadOnlyImport = !isOpenGraph(p.graph);
      await repository.save(p);
      setProjects(await repository.list());
      editor.load(p, isReadOnlyImport);
      if (isReadOnlyImport) {
        setSaved("Read-only archive");
      }
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
    <div className="studio canvas-first">
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

      {/* Top bar */}
      <header className="canvas-first-topbar studio-header experiment-heading" role="banner">
        <div className="canvas-first-topbar-row canvas-first-topbar-row-main">
          <div className="canvas-first-brand brand">
            <Workflow size={20} />
            <span>
              System studio<span className="brand-dot">.</span>
            </span>
          </div>

          <div className="canvas-first-project-rename-group">
            <input
              aria-label="Project name"
              className="canvas-first-project-name-input"
              value={projectNameInput}
              onChange={(e) => setProjectNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                  handleSaveProjectName();
                }
              }}
              onBlur={handleSaveProjectName}
              disabled={isReadOnly}
              maxLength={80}
              placeholder="Project name"
              title="Click to edit project name"
            />
            <button
              type="button"
              className="canvas-first-btn canvas-first-project-save-btn"
              onClick={handleSaveProjectName}
              aria-label="Save project name"
              title="Save project name"
              disabled={isReadOnly || !projectNameInput.trim()}
            >
              <Check size={13} />
              <span>Save</span>
            </button>
          </div>

          <span className="save-status" role="status">
            <span
              className={`save-dot ${saved === "Save failed" ? "failed" : ""}`}
            />
            {saved}
          </span>
        </div>

        <div className="canvas-first-topbar-row canvas-first-topbar-row-tools">
          <button
            data-testid="run-button"
            className="canvas-first-btn primary"
            disabled={!isOpen || !!errors.length || !ready || isReadOnly}
            onClick={simulation.toggle}
          >
            {simulation.running ? (
              <Pause size={14} />
            ) : (
              <Play size={14} fill="currentColor" />
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
            className="canvas-first-btn reset-button"
          >
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="canvas-first-body">
        {/* Left Control Rail / Menu Bar */}
        <aside className="canvas-first-left-rail" role="toolbar" aria-label="Workspace controls">
          <div className="canvas-first-rail-group">
            <button
              className={`canvas-first-rail-btn project-switch ${projectPanel ? "active" : ""}`}
              onClick={() => {
                if (!projectPanel) setCatalogDrawerOpen(false);
                setProjectPanel(!projectPanel);
              }}
              aria-expanded={projectPanel}
              title={`Menu: ${project.name}`}
              aria-label={project.name}
            >
              <Menu size={18} />
              <span className="canvas-first-rail-label">Menu</span>
            </button>

            <button
              className={`canvas-first-rail-btn ${catalogDrawerOpen ? "active" : ""}`}
              onClick={() => {
                if (!catalogDrawerOpen) setProjectPanel(false);
                setCatalogDrawerOpen(!catalogDrawerOpen);
              }}
              aria-expanded={catalogDrawerOpen}
              aria-label="Add component"
              title="Add component (Components catalog)"
            >
              <Plus size={18} />
              <span className="canvas-first-rail-label">Add</span>
            </button>

            <button
              className={`canvas-first-rail-btn ${inspectorMode === 'workloads' ? "active" : ""}`}
              onClick={() => {
                setSelectedEdgeId(null);
                editor.select(null);
                setInspectorMode(inspectorMode === 'workloads' ? null : 'workloads');
              }}
              aria-expanded={inspectorMode === 'workloads'}
              aria-label="Workloads"
              title="Workloads configuration"
            >
              <SlidersHorizontal size={18} />
              <span className="canvas-first-rail-label">Workloads</span>
            </button>

            <button
              className="canvas-first-rail-btn"
              onClick={() => {
                setCatalogDrawerOpen(false);
                setProjectPanel(true);
              }}
              aria-label="Architecture Revisions"
              title="Revisions & Checkpoints"
            >
              <GitBranch size={18} />
              <span className="canvas-first-rail-label">Revisions</span>
            </button>

            <button
              className="canvas-first-rail-btn"
              onClick={() => {
                setProjectPanel(false);
                setCatalogDrawerOpen(false);
                setShowExportModal(true);
              }}
              aria-label="Export options"
              title="Export canvas or JSON"
            >
              <Download size={18} />
              <span className="canvas-first-rail-label">Export</span>
            </button>

            <button
              className="canvas-first-rail-btn"
              onClick={() => {
                setProjectPanel(false);
                setCatalogDrawerOpen(false);
                setResultsOpen(true);
              }}
              aria-label="Saved runs"
              title="Saved runs & comparisons"
            >
              <BarChart3 size={18} />
              <span className="canvas-first-rail-label">Runs</span>
            </button>
          </div>

          <div className="canvas-first-rail-bottom">
            <button
              className="canvas-first-rail-btn"
              aria-label="Undo"
              title="Undo model edit"
              disabled={!editor.past.length}
              onClick={editor.undo}
            >
              <Undo2 size={16} />
            </button>
            <button
              className="canvas-first-rail-btn"
              aria-label="Redo"
              title="Redo model edit"
              disabled={!editor.future.length}
              onClick={editor.redo}
            >
              <Redo2 size={16} />
            </button>
            {guide && (
              <button
                className={`canvas-first-rail-btn ${inspectorMode === 'tutorial' ? "active" : ""}`}
                aria-label="Show experiment guide"
                title="Experiment guide"
                onClick={() => {
                  setSelectedEdgeId(null);
                  editor.select(null);
                  setInspectorMode(inspectorMode === 'tutorial' ? null : 'tutorial');
                }}
              >
                <Info size={16} />
              </button>
            )}
          </div>
        </aside>

        {/* Component Catalog Drawer (Floating Panel) */}
        {catalogDrawerOpen && (
          <aside className="canvas-first-catalog-drawer library" aria-label="Component catalog">
            <div className="canvas-first-catalog-header">
              <h2>Components</h2>
              <button
                type="button"
                className="canvas-first-btn subtle"
                style={{ padding: '4px 8px', border: 0 }}
                aria-label="Close component drawer"
                onClick={() => setCatalogDrawerOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
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
                          draggable={!disabled}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/system-design-component", item.kind);
                            e.dataTransfer.effectAllowed = "copy";
                          }}
                          onClick={() => {
                            if (canvasControlsRef.current) {
                              canvasControlsRef.current.addAtVisibleCenter(item.kind);
                            } else {
                              editor.add(item.kind);
                            }
                          }}
                          title={
                            atNodeLimit
                              ? "System has reached the 100-node limit."
                              : atWorkloadLimit
                                ? "Maximum 20 workloads reached."
                                : item.description
                          }
                        >
                          <Icon size={18} />
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
            <SubsystemsPanel key={project.id} />
          </aside>
        )}

        {/* Central Workspace */}
        <main className="canvas-first-workspace workspace">
          <div className="canvas-first-canvas-container canvas-shell canvas-area">
            {graph.nodes.length === 0 && (
              <div className="canvas-first-empty-prompt" role="region" aria-label="Empty canvas">
                <h2>Empty canvas</h2>
                <p>Add components from the library or choose an example architecture to begin.</p>
                <div className="canvas-first-empty-actions">
                  <button className="canvas-first-btn primary" onClick={() => setCatalogDrawerOpen(true)}>
                    <Plus size={14} /> Add component
                  </button>
                  <button className="canvas-first-btn subtle" onClick={() => setExamplesOpen(true)}>
                    <Workflow size={14} /> <span>Examples & tutorials</span>
                  </button>
                </div>
              </div>
            )}
            <ReactFlowProvider key={project.id}>
              <ArchitectureCanvas
                ref={canvasControlsRef}
                metrics={simulation.metrics}
                running={simulation.running}
                selectedEdgeId={selectedEdgeId}
                onSelectedEdgeChange={(id) => {
                  setSelectedEdgeId(id);
                  if (id) {
                    editor.select(null);
                    setInspectorMode(null);
                  }
                }}
                onCanvasClear={() => {
                  editor.select(null);
                  setSelectedEdgeId(null);
                  setInspectorMode(null);
                }}
              />
            </ReactFlowProvider>

            {/* Floating Export Panel */}
            {showExportModal && (
              <div className="canvas-first-export-panel">
                <DiagramExport project={project} />
                <button
                  className="canvas-first-export-close"
                  aria-label="Close export panel"
                  onClick={() => setShowExportModal(false)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
          </div>

          {/* Compact Results & Readiness Strip */}
          <div className="canvas-first-strip" role="region" aria-label="Simulation status and results">
            <div className="canvas-first-strip-info">
              {(simulation.metrics?.time ?? 0) > 0 ? (
                <>
                  <span className="canvas-first-strip-stat">
                    <span className={`canvas-first-strip-dot ${simulation.running ? "running" : simulation.metrics?.finished ? "finished" : "stopped"}`} />
                    <strong>
                      {simulation.error
                        ? "Simulation stopped"
                        : simulation.metrics?.execution?.incomplete
                          ? "Resource boundary"
                          : simulation.running
                            ? "Running"
                            : simulation.metrics?.finished
                              ? "Completed"
                              : "Paused"}
                    </strong>
                  </span>
                  <span className="canvas-first-strip-stat">
                    <span>Time:</span>
                    <strong>{simulation.metrics?.time.toFixed(1)}s</strong>
                    <span className="muted">/ {graph.settings.duration}s</span>
                  </span>
                  {(() => {
                    const roots = simulation.metrics?.execution?.roots;
                    const throughputVal = roots?.throughput ?? simulation.metrics?.throughput;
                    const p95Val = roots?.p95Latency ?? simulation.metrics?.p95Latency;
                    const failures = (roots?.rejected ?? simulation.metrics?.dropped ?? 0) +
                      (roots?.failed ?? simulation.metrics?.timedOut ?? 0) +
                      (roots?.expired ?? 0);
                    return (
                      <>
                        <span className="canvas-first-strip-stat">
                          <span>Throughput:</span>
                          <strong data-testid="throughput">
                            {throughputVal !== undefined ? `${throughputVal.toFixed(1)} req/s` : "0 req/s"}
                          </strong>
                        </span>
                        <span className="canvas-first-strip-stat">
                          <span>p95:</span>
                          <strong data-testid="p95">
                            {p95Val !== undefined && p95Val !== null
                              ? `${p95Val.toFixed(1)}ms`
                              : "—"}
                          </strong>
                        </span>
                        <span className={`canvas-first-strip-stat ${failures > 0 ? "danger" : ""}`}>
                          <span>Failures:</span>
                          <strong data-testid="failures">{failures}</strong>
                        </span>
                      </>
                    );
                  })()}
                  {simulation.metrics?.execution?.incomplete && (
                    <span className="canvas-first-strip-stat incomplete">
                      <strong>Incomplete run</strong>
                    </span>
                  )}
                </>
              ) : (
                <div className="canvas-first-readiness">
                  {graph.nodes.length === 0 ? (
                    <span className="canvas-first-strip-stat muted">
                      <span className="canvas-first-strip-dot idle" />
                      <span>Empty canvas · Add components or load an example to begin</span>
                    </span>
                  ) : errors.length > 0 ? (
                    <span
                      className="canvas-first-strip-stat danger"
                      title={errors.join("\n")}
                      style={{ cursor: "help" }}
                    >
                      <TriangleAlert size={14} />
                      <strong>{errors.length} draft error{errors.length > 1 ? "s" : ""}</strong>
                      <span className="muted" style={{ fontSize: "11px", marginLeft: "4px" }}>
                        ({errors[0]})
                      </span>
                    </span>
                  ) : (
                    <span className="canvas-first-strip-stat muted">
                      <span className={`canvas-first-strip-dot ${ready ? "ready" : "idle"}`} />
                      <span>Ready to simulate · {graph.nodes.length} components, {graph.workloads?.length ?? 0} workloads</span>
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="canvas-first-strip-actions">
              {(simulation.metrics?.time ?? 0) > 0 && (
                <>
                  <button
                    className={`canvas-first-btn subtle ${showDetails ? "active" : ""}`}
                    onClick={() => setShowDetails(!showDetails)}
                  >
                    {showDetails ? "Hide details" : "Details"}
                  </button>
                  <button
                    className="canvas-first-btn subtle"
                    onClick={() => setResultsOpen(true)}
                  >
                    Compare ({savedRuns.length})
                  </button>
                  {simulation.result && !simulation.metrics?.execution?.incomplete && !simulation.error && (
                    <button
                      className="canvas-first-btn"
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
                </>
              )}
              <button className="canvas-first-btn subtle" onClick={() => setShowExportModal(!showExportModal)}>
                Export canvas
              </button>
            </div>
          </div>

          {/* Saving Result Form */}
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

          {/* Expandable Details Panel */}
          {showDetails && (
            <div className="canvas-first-details-panel">
              <OpenMetricsPanel
                metrics={simulation.metrics}
                previous={simulation.previous}
                graph={graph}
              />
            </div>
          )}

          {/* Saved Results Modal / View */}
          {resultsOpen && (
            <Suspense fallback={<section className="results-panel" role="status">Loading saved results…</section>}>
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
          )}
        </main>

        {/* Contextual Inspector Dock */}
        {(() => {
          const selectedId = editor.selected;
          const hasNodeSelected = editor.selectedNodeIds.length > 0;
          const hasNoteSelected = !!(selectedId && graph.notes?.some((n) => n.id === selectedId));
          const hasSubsystemSelected = !!(selectedId && editor.project.subsystems?.some((s) => s.id === selectedId));
          const isInspectorOpen =
            selectedEdgeId !== null ||
            inspectorMode === 'workloads' ||
            (inspectorMode === 'tutorial' && !!guide) ||
            hasNodeSelected ||
            hasNoteSelected ||
            hasSubsystemSelected;

          if (!isInspectorOpen) return null;

          return (
            <aside className="canvas-first-inspector-dock inspector" aria-label="Inspector dock">
              {selectedEdgeId ? (
                <OpenConnectionEditor
                  edgeId={selectedEdgeId}
                  docked={true}
                  onClose={() => setSelectedEdgeId(null)}
                />
              ) : hasNodeSelected || hasNoteSelected || hasSubsystemSelected ? (
                isOpen ? (
                  <Suspense fallback={<aside className="inspector" />}>
                    <OpenInspector
                      metrics={simulation.metrics}
                      mode="selection"
                      onOpenWorkloads={() => {
                        setSelectedEdgeId(null);
                        editor.select(null);
                        setInspectorMode('workloads');
                      }}
                      onClose={() => {
                        editor.select(null);
                        setInspectorMode(null);
                      }}
                    />
                  </Suspense>
                ) : (
                  <fieldset disabled={true} style={{ display: "contents", border: "none", margin: 0, padding: 0 }}>
                    <Inspector metrics={simulation.metrics} />
                  </fieldset>
                )
              ) : inspectorMode === 'workloads' ? (
                <Suspense fallback={<aside className="inspector" />}>
                  <OpenInspector
                    metrics={simulation.metrics}
                    mode="workloads"
                    onClose={() => setInspectorMode(null)}
                  />
                </Suspense>
              ) : inspectorMode === 'tutorial' && guide ? (
                <section className="inspector open-inspector-container canvas-first-tutorial-panel optional-tutorial" role="region" aria-label="Tutorial instructions">
                  <div className="inspector-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>{guide.title}</h2>
                    </div>
                    <button
                      type="button"
                      aria-label="Close tutorial"
                      className="subtle"
                      style={{ padding: '4px', border: 0 }}
                      onClick={() => setInspectorMode(null)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="inspector-body" style={{ padding: '16px' }}>
                    <p style={{ fontSize: '12px', color: '#55665f', marginBottom: '14px', lineHeight: 1.4 }}>
                      {guide.purpose}
                    </p>
                    <ol style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', lineHeight: 1.5, color: '#243b41' }}>
                      {guide.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <div style={{ marginTop: '20px' }}>
                      <button
                        type="button"
                        className="subtle"
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={() => {
                          editor.change((g) => {
                            delete g.guideId;
                          });
                          setInspectorMode(null);
                        }}
                      >
                        Dismiss guide
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
            </aside>
          );
        })()}
      </div>

      {/* Modals & Dialogs */}
      {examplesOpen && (
        <ExamplesPanel
          onSelect={(graph) => {
            editor.replaceSystem(graph);
            setExamplesOpen(false);
          }}
          onClose={() => setExamplesOpen(false)}
        />
      )}

      {/* Primary Nested Menu */}
      {projectPanel && (
        <div className="canvas-first-menu-backdrop" onClick={() => setProjectPanel(false)}>
          <section
            className="canvas-first-primary-menu project-panel"
            onClick={(e) => e.stopPropagation()}
            role="region"
            aria-label="Local projects"
          >
            <div className="canvas-first-primary-menu-header">
              <div className="canvas-first-primary-menu-title-row">
                <Workflow size={16} className="canvas-first-menu-brand-icon" />
                <h3>Project & Workspace Menu</h3>
              </div>
              <button
                aria-label="Close projects"
                className="canvas-first-icon-btn"
                onClick={() => setProjectPanel(false)}
              >
                <X size={15} />
              </button>
            </div>

            <div className="canvas-first-nested-menu-tree">
              {/* 1. Create project */}
              <div className="canvas-first-nested-item">
                <div className="canvas-first-nested-header-row">
                  <span className="canvas-first-nested-title">
                    <Plus size={14} /> Create project
                  </span>
                  <span className="canvas-first-nested-badge">Templates</span>
                </div>
                <div className="canvas-first-nested-content">
                  <button
                    type="button"
                    className="canvas-first-menu-action-btn"
                    onClick={async () => {
                      try {
                        await switchProject(newOpenProject(`Untitled system ${projects.length + 1}`));
                        setProjectPanel(false);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not create project.");
                      }
                    }}
                  >
                    <FilePlus size={14} />
                    <span>Blank system</span>
                  </button>

                  <div className="canvas-first-nested-subgroup">
                    <span className="canvas-first-nested-subtitle">
                      <Layers size={13} /> From template
                    </span>
                    <div className="canvas-first-template-buttons">
                      <button
                        type="button"
                        className="canvas-first-btn subtle"
                        onClick={() => {
                          editor.loadArchitectureTemplate("chat");
                          setProjectPanel(false);
                          setNotice("Loaded Real-time chat template.");
                        }}
                        disabled={isReadOnly}
                      >
                        Real-time chat
                      </button>
                      <button
                        type="button"
                        className="canvas-first-btn subtle"
                        onClick={() => {
                          editor.loadArchitectureTemplate("ecommerce");
                          setProjectPanel(false);
                          setNotice("Loaded Ecommerce checkout template.");
                        }}
                        disabled={isReadOnly}
                      >
                        Ecommerce checkout
                      </button>
                      <button
                        type="button"
                        className="canvas-first-btn subtle"
                        onClick={() => {
                          editor.loadArchitectureTemplate("events");
                          setProjectPanel(false);
                          setNotice("Loaded Event processing template.");
                        }}
                        disabled={isReadOnly}
                      >
                        Event processing
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="canvas-first-menu-action-btn"
                    onClick={() => {
                      setProjectPanel(false);
                      setExamplesOpen(true);
                    }}
                    disabled={isReadOnly}
                  >
                    <Workflow size={14} />
                    <span>Examples & tutorials</span>
                  </button>
                </div>
              </div>

              {/* 2. Checkpoints options */}
              <div className="canvas-first-nested-item checkpoints">
                <div className="canvas-first-nested-header-row section-heading">
                  <span className="canvas-first-nested-title">
                    <BookmarkPlus size={14} /> Checkpoints options
                  </span>
                  <span className="canvas-first-nested-badge">{project.checkpoints.length} saved</span>
                </div>
                <div className="canvas-first-nested-content">
                  {project.checkpoints.length ? (
                    <div className="checkpoint-list" style={{ maxHeight: '140px', overflowY: 'auto' }}>
                      {project.checkpoints.map((c) => (
                        <button
                          key={c.id}
                          disabled={isReadOnly}
                          onClick={() => {
                            editor.restore(c.id);
                            setProjectPanel(false);
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
                    <p className="small muted">Keep a version before trying something new.</p>
                  )}
                  <fieldset disabled={isReadOnly} style={{ border: "none", padding: 0, margin: "8px 0 0 0" }}>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (isReadOnly) return;
                        const ok = editor.checkpoint(
                          checkpointName.trim() || `Checkpoint ${project.checkpoints.length + 1}`
                        );
                        if (ok) {
                          setCheckpointName("");
                          setNotice("Checkpoint saved with the current model and settings.");
                        } else {
                          setError("Could not save checkpoint. Maximum limit reached.");
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
                </div>
              </div>

              {/* 3. Export options */}
              <div className="canvas-first-nested-item">
                <div className="canvas-first-nested-header-row">
                  <span className="canvas-first-nested-title">
                    <Download size={14} /> Export options
                  </span>
                  <span className="canvas-first-nested-badge">Canvas / JSON</span>
                </div>
                <div className="canvas-first-nested-content">
                  <div className="canvas-first-menu-row">
                    <button
                      type="button"
                      className="canvas-first-btn"
                      onClick={() => {
                        setProjectPanel(false);
                        setShowExportModal(true);
                      }}
                    >
                      <Image size={14} />
                      Export canvas
                    </button>
                    <button type="button" className="canvas-first-btn" onClick={download}>
                      <Download size={14} />
                      Export JSON
                    </button>
                    <button
                      type="button"
                      className="canvas-first-btn"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload size={14} />
                      Import JSON
                    </button>
                  </div>
                </div>
              </div>

              {/* 4. Switch project */}
              <div className="canvas-first-nested-item">
                <div className="canvas-first-nested-header-row">
                  <span className="canvas-first-nested-title">
                    <FolderOpen size={14} /> Switch project
                  </span>
                  <span className="canvas-first-nested-badge">{projects.length} projects</span>
                </div>
                <div className="canvas-first-nested-content">
                  <div className="project-list" style={{ maxHeight: '140px', overflowY: 'auto' }}>
                    {projects.map((p) => (
                      <button key={p.id} onClick={() => switchProject(p)} aria-label={p.name}>
                        <FolderOpen size={16} />
                        <span>
                          <strong>{p.name}</strong>
                          <small>{new Date(p.updatedAt).toLocaleDateString()} · {p.graph.nodes.length} components</small>
                        </span>
                        {p.id === project.id && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="canvas-first-btn"
                    onClick={async () => {
                      try {
                        await switchProject(newOpenProject(`Untitled system ${projects.length + 1}`));
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not create project.");
                      }
                    }}
                  >
                    <Plus size={14} /> New project
                  </button>
                </div>
              </div>

              {/* 5. Architecture Revisions */}
              <div className="canvas-first-nested-item revisions-group">
                <div className="canvas-first-nested-header-row">
                  <span className="canvas-first-nested-title">
                    <GitBranch size={14} /> Architecture Revisions
                  </span>
                  <span className="canvas-first-nested-badge">Snapshots</span>
                </div>
                <div className="canvas-first-nested-content">
                  <Suspense fallback={null}>
                    <RevisionsPanel key={project.id} />
                  </Suspense>
                </div>
              </div>

              {/* 6. Saved Runs & Results */}
              <div className="canvas-first-nested-item">
                <div className="canvas-first-nested-header-row">
                  <span className="canvas-first-nested-title">
                    <BarChart3 size={14} /> Saved runs & comparisons
                  </span>
                  <span className="canvas-first-nested-badge">{savedRuns.length} runs</span>
                </div>
                <div className="canvas-first-nested-content">
                  <div className="saved-runs-library">
                    <button
                      className="saved-runs-heading"
                      onClick={() => {
                        setProjectPanel(false);
                        setResultsOpen(true);
                      }}
                    >
                      <BarChart3 size={16} />
                      <span>Saved runs</span>
                      <small>{savedRuns.length}</small>
                    </button>
                    {savedRuns.length ? (
                      <div className="saved-runs-list" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                        {savedRuns.slice().reverse().map((run) => (
                          <button
                            key={run.id}
                            onClick={() => {
                              setSelectedResult(run.id);
                              setProjectPanel(false);
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
                      <p className="small muted">Finish a run, then save its result to compare later.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 7. Model Semantics */}
              <div className="canvas-first-nested-footer">
                <button
                  className="assumptions-link canvas-first-btn subtle"
                  onClick={() => {
                    setProjectPanel(false);
                    setAssumptions(true);
                  }}
                >
                  <Info size={15} />
                  <span>How the model works</span>
                  <ArrowUpRight size={13} />
                </button>
              </div>
            </div>
          </section>
        </div>
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

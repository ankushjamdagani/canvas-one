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
  LayoutGrid,
  FolderGit2,
} from "lucide-react";
import "./components/openWorkspace.css";
import "./components/canvasFirst.css";
import { TopBar } from "./components/layout/TopBar";
import { ActivityRail } from "./components/layout/ActivityRail";
import { ResultsStrip } from "./components/layout/ResultsStrip";
import { StudioMenu } from "./components/StudioMenu";
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
const OpenInspector = lazy(() =>
  import("./components/OpenInspector").then((module) => ({
    default: module.OpenInspector,
  })),
);
const RevisionsPanel = lazy(() =>
  import("./components/RevisionsPanel").then((module) => ({
    default: module.RevisionsPanel,
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
    [projectMenuOpen, setProjectMenuOpen] = useState(false),
    [leftDrawerMode, setLeftDrawerMode] = useState<'components' | 'revisions' | null>(null),
    [assumptions, setAssumptions] = useState(false),
    [notice, setNotice] = useState("");
  const catalogDrawerOpen = leftDrawerMode === 'components';
  const setCatalogDrawerOpen = (open: boolean) => setLeftDrawerMode(open ? 'components' : null);
  const [componentSearch, setComponentSearch] = useState("");
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false),
    [selectedResult, setSelectedResult] = useState<string | null>(null),
    [savingResult, setSavingResult] = useState(false),
    [resultName, setResultName] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
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
    setLeftDrawerMode(null);
    setInspectorMode(null);
    setSelectedEdgeId(null);
    setShowDetails(false);
    setProjectMenuOpen(false);
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
    if (!projectMenuOpen && !leftDrawerMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProjectMenuOpen(false);
        setLeftDrawerMode(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [projectMenuOpen, leftDrawerMode]);
  const switchProject = async (p: Project) => {
    try {
      await saveQueue.current;
      if (!editor.readOnly) await repository.save(project);
      const isReadOnlyTarget = !isOpenGraph(p.graph);
      editor.load(p, isReadOnlyTarget);
      if (isReadOnlyTarget) setSaved("Read-only archive");
      setProjectMenuOpen(false);
    } catch {
      setError(
        "Could not save the current project. Export it before switching.",
      );
    }
  };
  const download = () => {
    setProjectMenuOpen(false);
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
    setProjectMenuOpen(false);
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
      setProjectMenuOpen(true);
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
      <TopBar
        projectName={project.name}
        isReadOnly={isReadOnly}
        projectNameInput={projectNameInput}
        setProjectNameInput={setProjectNameInput}
        onSaveProjectName={handleSaveProjectName}
        projectMenuOpen={projectMenuOpen}
        onToggleProjectMenu={() => {
          setLeftDrawerMode(null);
          setProjectMenuOpen(!projectMenuOpen);
        }}
        saved={saved}
        simulationRunning={simulation.running}
        simulationFinished={simulation.metrics?.finished}
        simulationTime={simulation.metrics?.time}
        simulationError={simulation.error}
        onToggleSimulation={simulation.toggle}
        onResetSimulation={simulation.reset}
        canRun={isOpen && !errors.length && ready && !isReadOnly}
        canReset={!isReadOnly && !errors.length}
      />

      {/* Main Workspace Body */}
      <div className="canvas-first-body">
        {/* Left Control Rail / Activity Bar */}
        <ActivityRail
          leftDrawerMode={leftDrawerMode}
          onToggleComponents={() => {
            setProjectMenuOpen(false);
            setLeftDrawerMode(leftDrawerMode === "components" ? null : "components");
          }}
          inspectorMode={inspectorMode}
          onToggleWorkloads={() => {
            setSelectedEdgeId(null);
            editor.select(null);
            setLeftDrawerMode(null);
            setInspectorMode(inspectorMode === "workloads" ? null : "workloads");
          }}
          onToggleRevisions={() => {
            setProjectMenuOpen(false);
            setLeftDrawerMode(leftDrawerMode === "revisions" ? null : "revisions");
          }}
          resultsOpen={resultsOpen}
          onToggleResults={() => {
            setProjectMenuOpen(false);
            setLeftDrawerMode(null);
            setResultsOpen(!resultsOpen);
          }}
          onOpenExport={() => {
            setLeftDrawerMode(null);
            setShowExportModal(true);
          }}
          hasGuide={!!guide}
          onToggleGuide={() => {
            setSelectedEdgeId(null);
            editor.select(null);
            setInspectorMode(inspectorMode === "tutorial" ? null : "tutorial");
          }}
        />

        {/* Multi-Purpose Left Drawer Panel */}
        {leftDrawerMode && (
          <aside
            data-testid={leftDrawerMode === 'components' ? "catalog-drawer" : "revisions-drawer"}
            className="canvas-first-catalog-drawer library"
            aria-label={
              leftDrawerMode === 'components'
                ? "Component catalog"
                : "Architecture revisions"
            }
          >
            <div className="canvas-first-catalog-header">
              <h2>
                {leftDrawerMode === 'components' && "Components"}
                {leftDrawerMode === 'revisions' && "Revisions & Checkpoints"}
              </h2>
              <button
                type="button"
                className="canvas-first-btn subtle"
                style={{ padding: '4px 8px', border: 0 }}
                aria-label="Close component drawer"
                onClick={() => setLeftDrawerMode(null)}
              >
                <X size={16} />
              </button>
            </div>

            {leftDrawerMode === 'components' && (
              <>
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
                      <section key={category} className={`component-category category-${category.toLowerCase()}`}>
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
              </>
            )}

            {leftDrawerMode === 'revisions' && (
              <div className="drawer-revisions-content" style={{ padding: '4px 0', overflowY: 'auto' }}>
                <Suspense fallback={<div className="scope-loading">Loading revisions…</div>}>
                  <RevisionsPanel key={project.id} />
                </Suspense>
              </div>
            )}
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
          {(() => {
            const roots = simulation.metrics?.execution?.roots;
            const throughputVal = roots?.throughput ?? simulation.metrics?.throughput;
            const p95Val = roots?.p95Latency ?? simulation.metrics?.p95Latency;
            const failures =
              (roots?.rejected ?? simulation.metrics?.dropped ?? 0) +
              (roots?.failed ?? simulation.metrics?.timedOut ?? 0) +
              (roots?.expired ?? 0);
            return (
              <ResultsStrip
                simulationTime={simulation.metrics?.time ?? 0}
                simulationRunning={simulation.running}
                simulationFinished={simulation.metrics?.finished}
                simulationError={simulation.error}
                incomplete={simulation.metrics?.execution?.incomplete}
                duration={graph.settings.duration}
                throughput={throughputVal}
                p95Latency={p95Val}
                failures={failures}
                nodeCount={graph.nodes.length}
                workloadCount={graph.workloads?.length ?? 0}
                errors={errors}
                ready={ready}
                showDetails={showDetails}
                onToggleDetails={() => setShowDetails(!showDetails)}
                savedRunsCount={savedRuns.length}
                onOpenSavedRuns={() => setResultsOpen(true)}
                canSaveResult={!!(simulation.result && !simulation.metrics?.execution?.incomplete && !simulation.error)}
                resultSaved={resultSaved}
                onSaveResultClick={() => {
                  setResultName(defaultRunName(simulation.result!.graph));
                  setSavingResult(true);
                }}
                onOpenExport={() => setShowExportModal(!showExportModal)}
              />
            );
          })()}

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

      {/* Unified Studio Menu */}
      <StudioMenu
        isOpen={projectMenuOpen}
        onClose={() => setProjectMenuOpen(false)}
        projects={projects}
        currentProject={project}
        editor={editor}
        onSwitchProject={switchProject}
        onCreateProject={async () => {
          try {
            await switchProject(newOpenProject(`Untitled system ${projects.length + 1}`));
            setProjectMenuOpen(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not create project.");
          }
        }}
        onLoadTemplate={(templateId) => {
          editor.loadArchitectureTemplate(templateId);
          setProjectMenuOpen(false);
          const labels: Record<string, string> = {
            "realtime-chat": "Real-time chat",
            "ecommerce-checkout": "Ecommerce checkout",
            "event-processing": "Event processing",
          };
          setNotice(`Loaded ${labels[templateId] ?? templateId} template.`);
        }}
        onOpenExamples={() => {
          setProjectMenuOpen(false);
          setExamplesOpen(true);
        }}
        onOpenSavedRuns={() => {
          setProjectMenuOpen(false);
          setResultsOpen(true);
        }}
        onOpenAssumptions={() => {
          setProjectMenuOpen(false);
          setAssumptions(true);
        }}
        onOpenExportModal={() => {
          setProjectMenuOpen(false);
          setShowExportModal(true);
        }}
        onDownloadJson={download}
        onImportJson={() => fileInput.current?.click()}
        savedRuns={savedRuns}
        isReadOnly={isReadOnly}
        setNotice={setNotice}
        setError={setError}
      />

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

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
        <div className="archive-banner flex items-center justify-between gap-3 bg-amber-500/10 border-b border-amber-600/30 px-4 py-2 text-xs text-amber-800 dark:text-amber-300 shrink-0 z-20" role="status">
          <div className="archive-banner-copy flex items-center gap-2">
            <TriangleAlert size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span><strong>Read-only archive</strong> — Legacy system preserved for inspection.</span>
          </div>
          <div className="archive-banner-actions flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs bg-background/80 border-amber-600/30 hover:bg-amber-500/15" onClick={download}>Export original</Button>
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs bg-background/80 border-amber-600/30 hover:bg-amber-500/15 font-medium" onClick={handleCreateRunnableCopy}>Create runnable copy</Button>
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
            className="canvas-first-catalog-drawer library w-[270px] shrink-0 h-full overflow-y-auto bg-card border-r border-border flex flex-col z-20 p-4 box-border"
            aria-label={
              leftDrawerMode === 'components'
                ? "Component catalog"
                : "Architecture revisions"
            }
          >
            <div className="canvas-first-catalog-header flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-foreground m-0">
                {leftDrawerMode === 'components' && "Components"}
                {leftDrawerMode === 'revisions' && "Revisions & Checkpoints"}
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="canvas-first-btn subtle h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                aria-label="Close component drawer"
                onClick={() => setLeftDrawerMode(null)}
              >
                <X size={16} />
              </Button>
            </div>

            {leftDrawerMode === 'components' && (
              <>
                <label className="component-search flex items-center gap-2 border border-border rounded-md px-2.5 py-1 mb-3 bg-background focus-within:ring-2 focus-within:ring-teal-600/20 focus-within:border-teal-600 transition-all">
                  <Search size={14} />
                  <Input
                    aria-label="Search components"
                    placeholder="Search components"
                    value={componentSearch}
                    onChange={(event) => setComponentSearch(event.target.value)}
                    disabled={isReadOnly}
                    className="border-0 shadow-none focus-visible:ring-0 bg-transparent px-1 h-auto text-xs"
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
                        <div className="flex items-center justify-between mb-1">
                          <h3>{category}</h3>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-mono font-normal text-muted-foreground border-border/60">
                            {matches.length}
                          </Badge>
                        </div>
                        {matches.map((item) => {
                          const Icon = icons[item.kind];
                          const atNodeLimit = graph.nodes.length >= 100;
                          const atWorkloadLimit =
                            item.kind === "traffic" && (graph.workloads?.length ?? 0) >= 20;
                          const disabled = isReadOnly || atNodeLimit || atWorkloadLimit;
                          return (
                            <button
                              className="library-item flex items-center gap-2.5 px-2.5 py-2 border border-border/60 rounded-md bg-card text-foreground text-xs font-medium cursor-grab active:cursor-grabbing hover:bg-accent/60 hover:border-border transition-colors duration-150 w-full mb-1.5 disabled:opacity-50 disabled:cursor-not-allowed text-left select-none"
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
              <div className="canvas-first-empty-prompt absolute top-1/2 left-1/2 text-center bg-card/95 backdrop-blur-md border border-border rounded-xl p-6 sm:p-8 z-10 shadow-lg w-[calc(100%-32px)] max-w-sm" role="region" aria-label="Empty canvas">
                <h2 className="text-base font-semibold text-foreground mb-1.5">Empty canvas</h2>
                <p className="text-xs text-muted-foreground mb-5 leading-relaxed">Add components from the library or choose an example architecture to begin.</p>
                <div className="canvas-first-empty-actions flex flex-wrap items-center justify-center gap-2.5">
                  <Button className="canvas-first-btn primary bg-teal-600 hover:bg-teal-700 text-white text-xs h-8 gap-1.5 shrink-0" onClick={() => setCatalogDrawerOpen(true)}>
                    <Plus size={14} /> Add component
                  </Button>
                  <Button variant="outline" className="canvas-first-btn subtle text-xs h-8 gap-1.5 shrink-0" onClick={() => setExamplesOpen(true)}>
                    <Workflow size={14} /> <span>Examples & tutorials</span>
                  </Button>
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
              <div className="canvas-first-export-panel absolute bottom-4 right-4 z-20 bg-card/95 backdrop-blur-md border border-border rounded-xl p-3 shadow-xl flex items-center gap-3 max-w-[calc(100%-32px)]">
                <DiagramExport project={project} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="canvas-first-export-close h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Close export panel"
                  onClick={() => setShowExportModal(false)}
                >
                  <X size={15} />
                </Button>
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
                <Input
                  aria-label="Result name"
                  maxLength={80}
                  value={resultName}
                  onChange={(event) => setResultName(event.target.value)}
                  autoFocus
                  className="h-8 text-xs"
                />
              </label>
              <Button type="submit" size="sm" className="primary">
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSavingResult(false)}>
                Cancel
              </Button>
            </form>
          )}

          {/* Expandable Details Panel */}
          {showDetails && (
            <div className="canvas-first-details-panel max-h-[320px] overflow-y-auto bg-card border-t border-border shrink-0 z-10">
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
            <aside className="canvas-first-inspector-dock inspector w-[321px] shrink-0 h-full overflow-y-auto bg-card border-l border-border flex flex-col z-20" aria-label="Inspector dock">
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
                <section className="inspector open-inspector-container canvas-first-tutorial-panel optional-tutorial p-3 max-h-[180px] overflow-auto" role="region" aria-label="Tutorial instructions">
                  <div className="inspector-heading flex items-center justify-between pb-2 border-b border-border">
                    <div className="flex items-center gap-2">
                      <h2 className="m-0 text-sm font-semibold text-foreground">{guide.title}</h2>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Close tutorial"
                      className="subtle h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setInspectorMode(null)}
                    >
                      <X size={16} />
                    </Button>
                  </div>
                  <div className="inspector-body p-3">
                    <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                      {guide.purpose}
                    </p>
                    <ol className="pl-5 m-0 flex flex-col gap-2 text-xs leading-relaxed text-foreground list-decimal">
                      {guide.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <div className="mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="subtle w-full justify-center text-xs"
                        onClick={() => {
                          editor.change((g) => {
                            delete g.guideId;
                          });
                          setInspectorMode(null);
                        }}
                      >
                        Dismiss guide
                      </Button>
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 p-0"
              aria-label="Close assumptions"
              onClick={() => setAssumptions(false)}>
              <X size={18} />
            </Button>
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

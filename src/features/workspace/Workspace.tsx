import * as React from 'react';
import type { SessionController } from '../session/controller';
import { formatStudioError } from '../session/formatError';
import { TopBar } from './TopBar';
import { CanvasView } from './CanvasView';
import { buildMoveChange } from './projection';
import type {
  BranchRecord,
  ProjectRecord,
  StudioRepository,
} from '../../persistence/studio/types';
import type { Id } from '../../domain/studio/model';
import {
  loadScenarioStatuses,
  RunController,
  ResultsRegion,
  ScenarioRunControl,
  WorkerTransport,
  type ScenarioEntry,
  type ScenariosStatusResult,
} from '../runs';
import {
  computeSessionRunDisabledReason,
  readScenarioSelection,
  resolveSelectedScenarioId,
  writeScenarioSelection,
} from './runWiring';

export interface WorkspaceProps {
  session: SessionController;
  repository: StudioRepository;
  onBackToProjects: () => void;
  /** RV-12d: mints ids for the workspace's RunController runs (the app's mintId). */
  mintId: () => string;
  /** D38 run-control slot; owned by the runs lane, empty until wired in. */
  runControl?: React.ReactNode;
}

export function Workspace({
  session,
  repository,
  onBackToProjects,
  mintId,
  runControl,
}: WorkspaceProps) {
  // Read session state via useSyncExternalStore
  const sessionState = React.useSyncExternalStore(
    session.subscribe,
    session.getState,
  );

  // Project record + branch list for the 22A breadcrumb / 13A project menu /
  // 13B branch popover. Project.title and the branch list are navigation
  // metadata (transactions.md §4), separate from the per-branch Document, so
  // they're loaded from the repository rather than read off the session's
  // Document.
  const [projectRecord, setProjectRecord] = React.useState<ProjectRecord | null>(null);
  const [branches, setBranches] = React.useState<readonly BranchRecord[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    if (!sessionState.projectId) {
      setProjectRecord(null);
      setBranches([]);
      return;
    }
    void (async () => {
      try {
        const history = await repository.loadHistory(sessionState.projectId as string);
        if (cancelled) return;
        setProjectRecord(history.project);
        setBranches(history.branches);
      } catch (err) {
        console.error('Failed to load project/branch info for top bar:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, sessionState.projectId, sessionState.projectRevision, sessionState.branchId]);

  const document = sessionState.document;
  const [activeViewId, setActiveViewId] = React.useState<string | null>(() => {
    return document?.views?.[0]?.id ?? null;
  });

  // Keep activeViewId valid when views change
  React.useEffect(() => {
    if (!document || !document.views || document.views.length === 0) {
      setActiveViewId(null);
    } else if (!activeViewId || !document.views.some((v) => v.id === activeViewId)) {
      setActiveViewId(document.views[0].id);
    }
  }, [document, activeViewId]);

  // ==========================================================================
  // RV-12d: run lane wiring
  // ==========================================================================

  // One RunController per session, backed by a real Web Worker transport.
  // Disposed on unmount (Workspace unmounts on "back to projects" / project
  // switch, since App only renders it while a project is open).
  const [runController, setRunController] = React.useState<RunController | null>(null);

  React.useEffect(() => {
    const worker = new Worker(new URL('../runs/runner.worker.ts', import.meta.url), {
      type: 'module',
    });
    const transport = new WorkerTransport(worker);
    const controller = new RunController({
      repository,
      transport,
      mintId,
    });
    setRunController(controller);
    return () => {
      controller.destroy();
      transport.terminate?.();
    };
  }, [repository, mintId]);

  const runControllerState = React.useSyncExternalStore(
    React.useCallback(
      (onStoreChange: () => void) => (runController ? runController.subscribe(onStoreChange) : () => {}),
      [runController],
    ),
    React.useCallback(
      () => runController?.getState() ?? null,
      [runController],
    ),
  );

  // loadScenarioStatuses for the current document; recomputed after every
  // document change and after every saved run (commands.md "Scenarios (D41)").
  const [scenarioStatusResult, setScenarioStatusResult] = React.useState<ScenariosStatusResult | null>(null);
  const [statusRefreshToken, setStatusRefreshToken] = React.useState(0);
  const lastRefreshedRunIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (
      runControllerState?.current?.saveStatus === 'saved' &&
      runControllerState.current.runId !== lastRefreshedRunIdRef.current
    ) {
      lastRefreshedRunIdRef.current = runControllerState.current.runId;
      setStatusRefreshToken((t) => t + 1);
    }
  }, [runControllerState]);

  React.useEffect(() => {
    let cancelled = false;
    if (!sessionState.projectId || !document) {
      setScenarioStatusResult(null);
      return;
    }
    void (async () => {
      try {
        const result = await loadScenarioStatuses(repository, sessionState.projectId as string, document);
        if (!cancelled) setScenarioStatusResult(result);
      } catch (err) {
        console.error('Failed to load scenario statuses:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, sessionState.projectId, document, statusRefreshToken]);

  const scenariosWithStatus = scenarioStatusResult?.scenarios ?? [];

  // D41 scenario.select: per-browser preference keyed by project + branch;
  // missing/deleted selection falls back to the first scenario in document
  // order; none -> no selection. Never an authored change.
  const [selectedScenarioId, setSelectedScenarioId] = React.useState<Id | null>(null);

  React.useEffect(() => {
    if (!sessionState.projectId || !sessionState.branchId) {
      setSelectedScenarioId(null);
      return;
    }
    const stored = readScenarioSelection(sessionState.projectId, sessionState.branchId);
    const scenarioIdsInOrder = scenariosWithStatus.map((s) => s.scenario.id);
    setSelectedScenarioId(resolveSelectedScenarioId(stored, scenarioIdsInOrder));
  }, [sessionState.projectId, sessionState.branchId, scenariosWithStatus]);

  const handleSelectScenario = React.useCallback(
    (scenarioId: Id) => {
      setSelectedScenarioId(scenarioId);
      if (sessionState.projectId && sessionState.branchId) {
        writeScenarioSelection(sessionState.projectId, sessionState.branchId, scenarioId);
      }
    },
    [sessionState.projectId, sessionState.branchId],
  );

  // Tracks the working snapshot a run was started against, so the results
  // strip can tell the user "Ran on an earlier version" once the session's
  // working snapshot has moved on (a canvas layout edit is presentation-only
  // per run-identity.md and doesn't change the scenario fingerprint, but the
  // run result is still from an earlier snapshot).
  const [lastRunSnapshotId, setLastRunSnapshotId] = React.useState<string | null>(null);

  const handleRunScenario = React.useCallback(
    async (scenarioId: Id) => {
      if (
        !runController ||
        !document ||
        !sessionState.projectId ||
        !sessionState.branchId ||
        !sessionState.workingSnapshotId
      ) {
        return;
      }
      setLastRunSnapshotId(sessionState.workingSnapshotId);
      await runController.run({
        projectId: sessionState.projectId,
        branchId: sessionState.branchId,
        snapshotId: sessionState.workingSnapshotId,
        document,
        scenarioId,
      });
    },
    [runController, document, sessionState.projectId, sessionState.branchId, sessionState.workingSnapshotId],
  );

  const handleRunAll = React.useCallback(async () => {
    if (
      !runController ||
      !document ||
      !sessionState.projectId ||
      !sessionState.branchId ||
      !sessionState.workingSnapshotId
    ) {
      return;
    }
    setLastRunSnapshotId(sessionState.workingSnapshotId);
    await runController.runAll({
      projectId: sessionState.projectId,
      branchId: sessionState.branchId,
      snapshotId: sessionState.workingSnapshotId,
      document,
      scenarioIds: document.scenarios.map((s) => s.id),
    });
  }, [runController, document, sessionState.projectId, sessionState.branchId, sessionState.workingSnapshotId]);

  const handleResetRun = React.useCallback(() => {
    runController?.reset();
    setLastRunSnapshotId(null);
  }, [runController]);

  // Scenario editing (new/duplicate/edit/rename/delete) is a real D41 command
  // set, but the inspector editor isn't built yet (RV-12d NOTES) -- the
  // control renders these disabled with a reason, so these handlers never fire.
  const noopScenarioEdit = React.useCallback(() => {}, []);

  const scenarioEntries: ScenarioEntry[] = React.useMemo(
    () =>
      scenariosWithStatus.map((s) => ({
        id: s.scenario.id,
        label: s.scenario.label,
        mode: s.scenario.mode,
        status: s.status,
      })),
    [scenariosWithStatus],
  );

  const sessionRunDisabledReason = computeSessionRunDisabledReason(
    sessionState.status,
    sessionState.needsReload,
  );

  const runControlSlot = (
    <ScenarioRunControl
      scenarios={scenarioEntries}
      selectedId={selectedScenarioId}
      runPhase={runControllerState?.phase ?? 'idle'}
      disabledReason={sessionRunDisabledReason}
      onSelect={handleSelectScenario}
      onRun={handleRunScenario}
      onRunAll={handleRunAll}
      onPause={() => runController?.pause()}
      onResume={() => runController?.resume()}
      onReset={handleResetRun}
      onNew={noopScenarioEdit}
      onDuplicate={noopScenarioEdit}
      onEdit={noopScenarioEdit}
      onRename={noopScenarioEdit}
      onDelete={noopScenarioEdit}
    />
  );

  // elementLabels: every element referenced by a run metric or event must
  // resolve to a real label (never a raw id).
  const elementLabels = React.useMemo(() => {
    const labels: Record<Id, string> = {};
    for (const el of document?.elements ?? []) {
      labels[el.id] = el.label;
    }
    return labels;
  }, [document]);

  const runningOrSelectedScenario = React.useMemo(() => {
    const runningId = runControllerState?.current?.scenarioId ?? null;
    const targetId = runningId ?? selectedScenarioId;
    return scenariosWithStatus.find((s) => s.scenario.id === targetId)?.scenario ?? null;
  }, [runControllerState, selectedScenarioId, scenariosWithStatus]);

  // RV-12d review round 1: every check's assertion label, looked up from the
  // scenario that ran (never the raw assertionId) so ResultsRegion can show
  // "Cart total matches" instead of "Assertion <uuid>".
  const assertionLabels = React.useMemo(() => {
    const labels: Record<Id, string> = {};
    for (const assertion of runningOrSelectedScenario?.assertions ?? []) {
      labels[assertion.id] = assertion.label;
    }
    return labels;
  }, [runningOrSelectedScenario]);

  // RV-12d review round 1: with no scenario selected/running at all (blank
  // project) there is nothing to show, so ResultsRegion isn't rendered and no
  // placeholder mode is invented for its now-required scenarioMode prop.
  const showResultsRegion = runningOrSelectedScenario !== null;

  const staleRun = Boolean(
    runControllerState?.current?.terminal &&
      lastRunSnapshotId !== null &&
      sessionState.workingSnapshotId !== null &&
      lastRunSnapshotId !== sessionState.workingSnapshotId,
  );

  const isSaving = sessionState.status === 'saving';
  const hasError = Boolean(sessionState.lastError);

  // Compute save status text without raw exception text
  const saveStatusText = React.useMemo(() => {
    if (isSaving) return 'Saving…';
    if (sessionState.lastError) {
      return formatStudioError(sessionState.lastError, 'Save failed');
    }
    if (sessionState.status === 'ready') return 'Saved';
    return '';
  }, [isSaving, sessionState.lastError, sessionState.status]);

  // Rename project handler
  const handleRenameProject = React.useCallback(
    async (newTitle: string) => {
      return session.renameProject(newTitle);
    },
    [session],
  );

  // Undo / Redo handlers
  const handleUndo = React.useCallback(async () => {
    if (!sessionState.canUndo || isSaving) return;
    await session.undo();
  }, [session, sessionState.canUndo, isSaving]);

  const handleRedo = React.useCallback(async () => {
    if (!sessionState.canRedo || isSaving) return;
    await session.redo();
  }, [session, sessionState.canRedo, isSaving]);

  // Move nodes handler
  const handleMoveNodes = React.useCallback(
    async (
      movedNodes: Array<{ id: string; position: { x: number; y: number } }>,
    ): Promise<boolean> => {
      if (!document || !activeViewId || isSaving) return false;

      const currentView = document.views.find((v) => v.id === activeViewId);
      if (!currentView) return false;

      const change = buildMoveChange(currentView, movedNodes);
      if (!change) return true; // No actual coordinate changes

      const res = await session.apply([change], 'Move');
      return res.status === 'applied';
    },
    [document, activeViewId, isSaving, session],
  );

  // Keyboard shortcuts: Mod+Z / Mod+Shift+Z per commands.md §1
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore during IME composition
      if (e.isComposing) return;

      // Ignore in editable fields
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (!modKey) return;

      if (e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          // Mod+Shift+Z -> Redo
          if (sessionState.canRedo && sessionState.status === 'ready') {
            e.preventDefault();
            void session.redo();
          }
        } else {
          // Mod+Z -> Undo
          if (sessionState.canUndo && sessionState.status === 'ready') {
            e.preventDefault();
            void session.undo();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, sessionState.canUndo, sessionState.canRedo, sessionState.status]);

  const handleSwitchBranch = React.useCallback(
    (branchId: string) => {
      if (!sessionState.projectId || isSaving) return;
      void session.openProject(sessionState.projectId, branchId);
    },
    [session, sessionState.projectId, isSaving],
  );

  return (
    <div
      data-testid="workspace-root"
      className="flex flex-col w-full max-w-full h-screen overflow-hidden bg-shell select-none"
    >
      {/* Top Bar (22A nav live) */}
      {projectRecord ? (
        <TopBar
          project={projectRecord}
          branches={branches}
          branchId={sessionState.branchId ?? projectRecord.mainBranchId}
          onRenameProject={handleRenameProject}
          onSwitchBranch={handleSwitchBranch}
          onAllProjects={onBackToProjects}
          saveStatusText={saveStatusText}
          isSaving={isSaving}
          hasError={hasError}
          runControl={runControl ?? runControlSlot}
        />
      ) : (
        <header
          data-testid="workspace-topbar-loading"
          className="shrink-0 h-[52px] min-h-[52px] border-b border-border bg-shell"
        />
      )}

      {/* Canvas fills the workspace; the permanent left activity rail is
          removed per D-observed shell structure — a rail only exists for
          collapsed panels (23F/23G), not built here. */}
      <div className="flex flex-1 w-full max-w-full min-h-0 overflow-hidden relative">
        <main className="flex-1 h-full min-w-0 overflow-hidden relative flex flex-col">
          {/* Canvas shrinks to make room for the results strip below it. */}
          <div className="flex-1 min-h-0 relative">
            <CanvasView
              document={document}
              activeViewId={activeViewId}
              onSelectView={setActiveViewId}
              isSaving={isSaving}
              canUndo={sessionState.canUndo && sessionState.status === 'ready'}
              canRedo={sessionState.canRedo && sessionState.status === 'ready'}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onMoveNodes={handleMoveNodes}
            />
          </div>

          {/* Results region (RV-12d): below the canvas, not floating. Not
              rendered at all with no scenario selected and no run (blank
              project) -- the canvas above takes the full height instead. */}
          {showResultsRegion && runningOrSelectedScenario && (
            <ResultsRegion
              scenarioName={runningOrSelectedScenario.label}
              scenarioMode={runningOrSelectedScenario.mode}
              runId={runControllerState?.current?.runId ?? null}
              runPhase={runControllerState?.phase ?? 'idle'}
              terminal={runControllerState?.current?.terminal ?? null}
              events={runControllerState?.events ?? []}
              saveStatus={runControllerState?.current?.saveStatus ?? 'unsaved'}
              onRetrySave={() => void runController?.retrySave()}
              elementLabels={elementLabels}
              assertionLabels={assertionLabels}
              staleRun={staleRun}
            />
          )}
        </main>
      </div>
    </div>
  );
}

import * as React from 'react';
import type { SessionController } from '../session/controller';
import { formatStudioError } from '../session/formatError';
import { TopBar } from './TopBar';
import { CanvasView, type CanvasSelectionRequest, type CanvasViewHandle } from './CanvasView';
import { buildMoveChange } from './projection';
import {
  createInitialPanelState,
  panelReducer,
  type PanelId,
  type WorkspacePanelState,
  type WorkspacePanelAction,
} from './panels';
import { PanelHost } from '../panels';
import {
  HistoryController,
  HistoryLadder,
  CommitPanel,
  PublishController,
  PublishFlow,
  DraftBehindMainBanner,
  type CommitPreview,
} from '../history';
import { LibraryPanel, type LibraryView } from '../library';
import type {
  BranchRecord,
  ProjectRecord,
  StudioRepository,
} from '../../persistence/studio/types';
import { createCandidateController, type Actor } from '../../persistence/studio';
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
import {
  applyDraft,
  cancelDraft,
  changeField as changeDraftField,
  decideNavigation,
  InspectorPanel,
  NavigationGuardDialog,
  openDraft,
  RUN_DISABLED_DIRTY_DRAFT_REASON,
  selectMeasuredSection,
  type DraftHandle,
  type DraftSession,
  type DraftTarget,
} from '../inspector';

const MOBILE_BREAKPOINT_PX = 768;

/** localStorage key App.tsx mints the session's Actor from (getOrCreateActorId) --
 * read here too so HistoryController/PublishController act as the same
 * local-human actor as the session they observe, without a new identity. */
const ACTOR_STORAGE_KEY = 'system-studio.actor-id';

function useLocalActor(): Actor {
  return React.useMemo<Actor>(() => {
    let actorId: string;
    try {
      const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(ACTOR_STORAGE_KEY);
      if (stored) {
        actorId = stored;
      } else {
        actorId = crypto.randomUUID();
        if (typeof localStorage !== 'undefined') localStorage.setItem(ACTOR_STORAGE_KEY, actorId);
      }
    } catch {
      actorId = crypto.randomUUID();
    }
    return { actorId, kind: 'local-human', displayName: 'You' };
  }, []);
}

function useViewportWidth(): number {
  const [width, setWidth] = React.useState<number>(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

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
  // RV-05b: inspector (2A workspace) draft + navigation guard
  // ==========================================================================

  const viewportWidth = useViewportWidth();
  const isMobileInspector = viewportWidth < MOBILE_BREAKPOINT_PX;

  const [draft, setDraft] = React.useState<DraftHandle | null>(null);
  const [focusFieldId, setFocusFieldId] = React.useState<string | null>(null);
  const [guardOpen, setGuardOpen] = React.useState(false);
  const [guardApplying, setGuardApplying] = React.useState(false);
  const pendingActionRef = React.useRef<(() => void) | null>(null);

  const draftSession: DraftSession = React.useMemo(
    () => ({
      getState: () => {
        const s = session.getState();
        return { workingRevision: s.workingRevision, document: s.document };
      },
      apply: async (changes, label) => {
        const result = await session.apply(changes, label);
        if (result.status === 'busy' || result.status === 'unsupported') {
          return { status: 'failed', code: 'unavailable', issues: [] };
        }
        return result;
      },
    }),
    [session],
  );

  /**
   * commands.md §6 "Navigation guard": clean -> proceed; dirty -> Apply / Discard /
   * Stay. Every selection change, empty-canvas click, branch/project switch and
   * inspector close routes through this before touching anything.
   */
  const runGuarded = React.useCallback(
    (action: () => void) => {
      if (decideNavigation(draft) === 'proceed') {
        action();
        return;
      }
      pendingActionRef.current = action;
      setGuardOpen(true);
    },
    [draft],
  );

  const openInspectorFor = React.useCallback(
    (target: DraftTarget) => {
      // RV-12e: read the session's live state, not the `document`/`sessionState`
      // render closure. A caller can request selection of a just-applied
      // record synchronously after `await session.apply(...)` resolves --
      // `session.apply` updates its internal state before that promise
      // settles, but this component may not have re-rendered with it yet, so
      // the closed-over `document` can still be the pre-apply snapshot. Using
      // that stale snapshot here would look up the brand-new record in a
      // document that doesn't have it yet and mis-report it as "deleted
      // elsewhere" (buildFieldsAndLabel's not-found path), even though it was
      // never removed.
      const live = session.getState();
      if (!live.document || live.workingRevision === null) return;
      const handle = openDraft(mintId(), target, live.workingRevision, live.document);
      setDraft(handle);
      setFocusFieldId(null);
    },
    [session, mintId],
  );

  const closeInspector = React.useCallback(() => {
    setDraft(null);
    setFocusFieldId(null);
  }, []);

  const handleRequestSelection = React.useCallback(
    (request: CanvasSelectionRequest) => {
      const nextTarget: DraftTarget =
        request.additive && draft && draft.target.kind === request.kind
          ? {
              kind: request.kind,
              ids: draft.target.ids.includes(request.id)
                ? draft.target.ids.filter((id) => id !== request.id)
                : [...draft.target.ids, request.id],
            }
          : { kind: request.kind, ids: [request.id] };

      if (
        !request.additive &&
        draft &&
        draft.target.kind === nextTarget.kind &&
        draft.target.ids.length === 1 &&
        draft.target.ids[0] === nextTarget.ids[0]
      ) {
        return; // already the open target -- keep editing, don't reopen
      }

      if (nextTarget.ids.length === 0) {
        runGuarded(closeInspector);
        return;
      }

      runGuarded(() => openInspectorFor(nextTarget));
    },
    [draft, runGuarded, openInspectorFor, closeInspector],
  );

  const handleRequestClearSelection = React.useCallback(() => {
    if (!draft) return;
    runGuarded(closeInspector);
  }, [draft, runGuarded, closeInspector]);

  const handleChangeField = React.useCallback((fieldId: string, raw: string) => {
    setDraft((prev) => (prev ? changeDraftField(prev, fieldId, raw) : prev));
  }, []);

  const handleApplyDraft = React.useCallback(async () => {
    if (!draft) return;
    const result = await applyDraft(draft, draftSession);
    setDraft(result.handle);
    setFocusFieldId(result.firstInvalidFieldId);
  }, [draft, draftSession]);

  const handleCancelDraft = React.useCallback(() => {
    setDraft((prev) => (prev ? cancelDraft(prev) : prev));
    setFocusFieldId(null);
  }, []);

  const handleCloseInspector = React.useCallback(() => {
    runGuarded(closeInspector);
  }, [runGuarded, closeInspector]);

  const handleGuardStay = React.useCallback(() => {
    pendingActionRef.current = null;
    setGuardOpen(false);
  }, []);

  const handleGuardDiscard = React.useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    setGuardOpen(false);
    setDraft(null);
    setFocusFieldId(null);
    action?.();
  }, []);

  const handleGuardApply = React.useCallback(async () => {
    if (!draft) {
      setGuardOpen(false);
      return;
    }
    setGuardApplying(true);
    const result = await applyDraft(draft, draftSession);
    setGuardApplying(false);
    if (result.handle.status === 'clean') {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      setGuardOpen(false);
      setDraft(null);
      setFocusFieldId(null);
      action?.();
    } else {
      // Apply failed: stay on the inspector with the error surfaced, per
      // commands.md §6 ("Apply proceeds only on success").
      setGuardOpen(false);
      setDraft(result.handle);
      setFocusFieldId(result.firstInvalidFieldId);
    }
  }, [draft, draftSession]);

  const selectedElementIds = React.useMemo(
    () => new Set(draft && draft.target.kind === 'element' ? draft.target.ids : []),
    [draft],
  );
  const selectedConnectionIds = React.useMemo(
    () => new Set(draft && draft.target.kind === 'connection' ? draft.target.ids : []),
    [draft],
  );

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

  // D25 / commands.md §6: Run is disabled while a configuration draft is dirty,
  // with this exact reason -- checked ahead of the session's own busy reasons.
  const sessionRunDisabledReason =
    draft?.dirty
      ? RUN_DISABLED_DIRTY_DRAFT_REASON
      : computeSessionRunDisabledReason(sessionState.status, sessionState.needsReload);

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

  // RV-05b MEASURED · LAST RUN: only for an element target, from the latest saved
  // run of the currently selected scenario (already exposed by loadScenarioStatuses
  // as ScenarioWithStatus.latestRun -- no separate runs-lane lookup needed).
  const measuredSection = React.useMemo(() => {
    if (!draft || draft.multi || draft.missing || draft.target.kind !== 'element') return null;
    const elementId = draft.target.ids[0];
    const selected = scenariosWithStatus.find((s) => s.scenario.id === selectedScenarioId) ?? null;
    if (!selected) return selectMeasuredSection(elementId, null, 'this scenario', 'timed');
    return selectMeasuredSection(elementId, selected.latestRun, selected.scenario.label, selected.scenario.mode);
  }, [draft, scenariosWithStatus, selectedScenarioId]);

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

  // RV-12e: generic apply for place/connect/delete -- each caller builds its
  // own model.apply-records batch (placeEntry / planConnection / planDelete)
  // and this just runs it through the session (one gesture == one undo). A
  // busy/failed/unsupported result returns false so the caller leaves nothing
  // destructive on screen and the user can retry (commands.md "busy").
  const handleApplyChanges = React.useCallback(
    async (changes: Parameters<SessionController['apply']>[0], label: string): Promise<boolean> => {
      if (!document || isSaving) return false;
      const result = await session.apply(changes, label);
      return result.status === 'applied';
    },
    [document, isSaving, session],
  );

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

  // ==========================================================================
  // RV-12h: History and Library panels
  // ==========================================================================

  const actor = useLocalActor();

  // One HistoryController / CandidateController / PublishController per
  // mounted workspace (mirrors the RunController pattern above), created
  // once via a lazy state initializer rather than on every render.
  const [historyController] = React.useState(
    () => new HistoryController({ repository, session, mintId, actor }),
  );
  const [candidateController] = React.useState(() => createCandidateController({ mintId }));
  const [publishController] = React.useState(
    () =>
      new PublishController({
        repository,
        session,
        candidateController,
        mintId,
        actor,
        // Reuses CandidateController's own already-tested runner (RV-11b) --
        // never a bespoke one, matching the exact pattern in
        // publishController.test.ts.
        runScenario: (params) => candidateController.startCandidateRun(repository, params),
      }),
  );

  // HistoryController's getState/subscribe are ordinary methods (not
  // auto-bound arrow properties, unlike SessionController's and
  // PublishController's), so they're wrapped here rather than passed bare --
  // controller.ts isn't in this task's allowed files to add a `.bind` call to.
  const historySubscribe = React.useCallback(
    (onStoreChange: () => void) => historyController.subscribe(onStoreChange),
    [historyController],
  );
  const historyGetState = React.useCallback(
    () => historyController.getState(),
    [historyController],
  );
  const historyControllerState = React.useSyncExternalStore(
    historySubscribe,
    historyGetState,
    historyGetState,
  );
  const publishControllerState = React.useSyncExternalStore(
    publishController.subscribe,
    publishController.getState,
    publishController.getState,
  );

  // Panel placement/collapse/width preferences (commands.md §7): the panel
  // reducer's own contract defines `save` effects meant for
  // StudioRepository.savePreferences, but the public StudioRepository
  // surface (persistence/studio/types.ts) exposes `savePreferences` with no
  // matching `loadPreferences` to read a prior value back on the next
  // session -- and persistence/studio isn't in this task's allowed files.
  // Preferences are kept in memory only for this task; see the final report.
  const [panelState, setPanelState] = React.useState<WorkspacePanelState>(() =>
    createInitialPanelState(
      typeof window === 'undefined'
        ? undefined
        : { viewport: { width: window.innerWidth, height: window.innerHeight } },
    ),
  );

  const panelDispatch = React.useCallback((action: WorkspacePanelAction) => {
    setPanelState((prev) => {
      const { state: next } = panelReducer(prev, action);
      // 'save' effects have nowhere to persist to (see note above) and
      // 'announce' effects have no accessible live-region sink wired into
      // this shell yet -- both are dropped rather than invented.
      return next;
    });
  }, []);

  React.useEffect(() => {
    const syncViewport = () => {
      panelDispatch({ type: 'VIEWPORT_CHANGED', width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, [panelDispatch]);

  // History panel's own view: the ladder (22A), or the commit gate (scenario
  // "commit_gate" screen) swapped in when the ladder's Commit action fires.
  const [historyView, setHistoryView] = React.useState<'ladder' | 'commit'>('ladder');
  React.useEffect(() => {
    if (!panelState.panels.history.open) setHistoryView('ladder');
  }, [panelState.panels.history.open]);

  // Returns to the ladder once a commit really lands (the controller's own
  // commits list grows), rather than assuming success from a click.
  const prevCommitCountRef = React.useRef(historyControllerState.commits.length);
  React.useEffect(() => {
    const len = historyControllerState.commits.length;
    if (historyView === 'commit' && len > prevCommitCountRef.current) {
      setHistoryView('ladder');
    }
    prevCommitCountRef.current = len;
  }, [historyControllerState.commits.length, historyView]);

  // CommitPanel's `controller` prop path also hits the unbound-method issue
  // above (its own internal useSyncExternalStore(controller.subscribe, ...)),
  // so its commit preview is loaded here instead, through a direct, properly
  // bound `historyController.loadCommitPreview()` call.
  const [commitPreview, setCommitPreview] = React.useState<CommitPreview | null>(null);
  React.useEffect(() => {
    if (historyView !== 'commit') return;
    let cancelled = false;
    void historyController.loadCommitPreview().then((preview) => {
      if (!cancelled) setCommitPreview(preview);
    });
    return () => {
      cancelled = true;
    };
  }, [historyView, historyController]);

  const [libraryView, setLibraryView] = React.useState<LibraryView>('list');

  const [publishOpen, setPublishOpen] = React.useState(false);
  const [behindMainBannerDismissed, setBehindMainBannerDismissed] = React.useState(false);

  // 22E "draft behind main": proactively prepares a real publish candidate
  // against main whenever the open branch is a non-main draft, so the real
  // conflict count is known before the user opens Publish (matching
  // DraftBehindMainBanner's own doc comment: "the app shell mounts [it]
  // typically after calling PublishController.prepare()"). PublishFlow
  // reuses this same prepared candidate when opened (its own effect only
  // calls prepare() while status is 'idle').
  const mainBranchId = projectRecord?.mainBranchId ?? null;
  React.useEffect(() => {
    if (!sessionState.projectId || !sessionState.branchId || !mainBranchId) return;
    if (sessionState.branchId === mainBranchId) {
      publishController.reset();
      setPublishOpen(false);
      setBehindMainBannerDismissed(false);
      return;
    }
    setBehindMainBannerDismissed(false);
    void publishController.prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState.projectId, sessionState.branchId, mainBranchId, publishController]);

  // A real conflict count from a successful prepare() -- never invented; the
  // banner and the ladder's own behind-main callout both read this.
  const behindMainInfo =
    publishControllerState.status === 'review' && publishControllerState.conflicts.length > 0
      ? {
          conflictCount: publishControllerState.conflicts.length,
          versionsPublishedSinceFork: publishControllerState.versionsPublishedSinceFork,
          forkVersionKey: publishControllerState.forkVersionKey,
        }
      : null;

  const canvasViewRef = React.useRef<CanvasViewHandle>(null);

  const openLibraryPanel = React.useCallback(() => {
    panelDispatch({ type: 'OPEN', panel: 'library' });
  }, [panelDispatch]);

  const renderPanel = React.useCallback(
    (panelId: PanelId): React.ReactNode => {
      if (panelId === 'history') {
        if (historyView === 'commit') {
          return (
            <CommitPanel
              workingDocument={commitPreview?.workingDocument ?? null}
              baseDocument={commitPreview?.baseDocument ?? null}
              changes={commitPreview?.changes ?? []}
              scenariosWithStatus={commitPreview?.scenarios ?? []}
              isMain={historyControllerState.isMain}
              onCommit={async (message) => {
                const res = await historyController.commit(message);
                if (res.status !== 'applied') throw res;
              }}
              onCancel={() => setHistoryView('ladder')}
              onRunScenario={(scenarioId) => void handleRunScenario(scenarioId)}
              onRunAll={() => void handleRunAll()}
            />
          );
        }
        return (
          <HistoryLadder
            branchName={historyControllerState.branch?.label ?? ''}
            isMain={historyControllerState.isMain}
            aheadOfVersion={historyControllerState.aheadOfVersion}
            workingEdits={historyControllerState.workingEdits}
            checkpoints={historyControllerState.checkpoints}
            commits={historyControllerState.commits}
            publications={historyControllerState.publications}
            canUndo={sessionState.canUndo && sessionState.status === 'ready'}
            canRedo={sessionState.canRedo && sessionState.status === 'ready'}
            onUndo={() => void handleUndo()}
            onRedo={() => void handleRedo()}
            onSaveCheckpoint={async (label) => {
              const res = await historyController.saveCheckpoint(label);
              if (res.status !== 'applied') throw res;
            }}
            onRestore={async (targetId, label) => {
              const res = await historyController.restore(targetId, label);
              if (res.status !== 'applied') throw res;
            }}
            onOpenCommit={() => setHistoryView('commit')}
            onOpenPublish={() => setPublishOpen(true)}
            behindMain={
              behindMainInfo
                ? {
                    conflictCount: behindMainInfo.conflictCount,
                    versionsPublishedSinceFork: behindMainInfo.versionsPublishedSinceFork,
                  }
                : null
            }
            onReviewAndResolve={() => setPublishOpen(true)}
            onClose={() => panelDispatch({ type: 'CLOSE', panel: 'history' })}
          />
        );
      }
      return (
        <LibraryPanel
          view={libraryView}
          onViewChange={setLibraryView}
          onPlace={(entryId) => void canvasViewRef.current?.placeAtCentre(entryId)}
          onClose={() => panelDispatch({ type: 'CLOSE', panel: 'library' })}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      historyView,
      historyController,
      historyControllerState,
      commitPreview,
      behindMainInfo,
      libraryView,
      panelDispatch,
      sessionState.canUndo,
      sessionState.canRedo,
      sessionState.status,
    ],
  );

  // Scenario editing (new/duplicate/edit/rename/delete) is a real D41 command
  // set, but the inspector editor isn't built yet (RV-12d NOTES) -- the
  // control renders these disabled with a reason, so these handlers never fire.

  const handleSwitchBranch = React.useCallback(
    (branchId: string) => {
      if (!sessionState.projectId || isSaving) return;
      runGuarded(() => {
        void session.openProject(sessionState.projectId as string, branchId);
      });
    },
    [session, sessionState.projectId, isSaving, runGuarded],
  );

  const handleBackToProjects = React.useCallback(() => {
    runGuarded(onBackToProjects);
  }, [runGuarded, onBackToProjects]);

  // Escape closes an overlay first, never a dirty draft directly (commands.md §6).
  // The guard dialog is itself a shadcn Dialog and handles its own Escape (-> Stay).
  // With no overlay open, Escape on a clean inspector closes it; a dirty draft is
  // left untouched (Apply/Discard/Stay only).
  React.useEffect(() => {
    if (!draft) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || guardOpen) return;
      if (!draft.dirty) {
        e.preventDefault();
        closeInspector();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft, guardOpen, closeInspector]);

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
          onAllProjects={handleBackToProjects}
          saveStatusText={saveStatusText}
          isSaving={isSaving}
          hasError={hasError}
          runControl={runControl ?? runControlSlot}
          onOpenHistory={() => panelDispatch({ type: 'OPEN', panel: 'history' })}
          historyActive={panelState.panels.history.open}
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
          {/* Canvas shrinks to make room for the results strip below it. The
              History and Library panels dock/float/collapse around the
              canvas through PanelHost (RV-03a); the inspector stays its own
              contextual region below (commands.md §5) and is never a panel. */}
          <div className="flex-1 min-h-0 relative">
            <PanelHost
              state={panelState}
              dispatch={panelDispatch}
              renderPanel={renderPanel}
              panelBadges={{
                history:
                  historyControllerState.workingEdits.length > 0
                    ? `${historyControllerState.workingEdits.length} edit${historyControllerState.workingEdits.length === 1 ? '' : 's'}`
                    : undefined,
              }}
              canvas={
                <>
                  <CanvasView
                    ref={canvasViewRef}
                    document={document}
                    activeViewId={activeViewId}
                    onSelectView={setActiveViewId}
                    isSaving={isSaving}
                    canUndo={sessionState.canUndo && sessionState.status === 'ready'}
                    canRedo={sessionState.canRedo && sessionState.status === 'ready'}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    onMoveNodes={handleMoveNodes}
                    selectedElementIds={selectedElementIds}
                    selectedConnectionIds={selectedConnectionIds}
                    onRequestSelection={handleRequestSelection}
                    onRequestClearSelection={handleRequestClearSelection}
                    mintId={mintId}
                    onApplyChanges={handleApplyChanges}
                    onOpenFullLibrary={openLibraryPanel}
                  />

                  {/* 22E draft behind main: a real conflict count from
                      PublishController.prepare(), never invented. */}
                  {behindMainInfo && !behindMainBannerDismissed && (
                    <div className="absolute top-3 left-3 right-3 z-dock">
                      <DraftBehindMainBanner
                        conflictCount={behindMainInfo.conflictCount}
                        versionsPublishedSinceFork={behindMainInfo.versionsPublishedSinceFork}
                        forkVersionKey={behindMainInfo.forkVersionKey}
                        onLater={() => setBehindMainBannerDismissed(true)}
                        onReviewAndResolve={() => {
                          setBehindMainBannerDismissed(true);
                          setPublishOpen(true);
                        }}
                      />
                    </div>
                  )}
                </>
              }
            />
          </div>

          {/* 22C/22F publish review + compare-and-resolve, driven by the same
              proactively-prepared PublishController used for the 22E banner. */}
          {publishOpen && (
            <div
              data-testid="publish-flow-overlay"
              className="fixed inset-0 z-modal flex items-center justify-center bg-black/40 p-4"
            >
              <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden">
                <PublishFlow controller={publishController} onClose={() => setPublishOpen(false)} />
              </div>
            </div>
          )}

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

        {/* RV-05b inspector: 320px right dock >= 768px (commands.md §7); a full-width
            bottom sheet below 768px, same content and guard. */}
        {draft && !isMobileInspector ? (
          <InspectorPanel
            draft={draft}
            measured={measuredSection}
            onChangeField={handleChangeField}
            onApply={() => void handleApplyDraft()}
            onCancel={handleCancelDraft}
            onClose={handleCloseInspector}
            saving={draft.status === 'saving'}
            focusFieldId={focusFieldId}
            variant="dock"
          />
        ) : null}
      </div>

      {draft && isMobileInspector ? (
        <div
          data-testid="inspector-sheet-overlay"
          // RV-05b review round 1: an explicit h-[70vh] (not just max-h) gives the
          // flex column below a definite height to resolve its own h-full against,
          // and overflow-hidden makes sure the sheet itself never grows past that --
          // the canvas stays visible above it, and InspectorPanel's own scroll
          // region (not this wrapper) is what scrolls, leaving the Apply/Cancel
          // footer permanently in view outside that scroll area.
          className="fixed inset-x-0 bottom-0 z-modal h-[70vh] max-h-[70vh] overflow-hidden shadow-md rounded-t-lg border-t border-control-border"
        >
          <InspectorPanel
            draft={draft}
            measured={measuredSection}
            onChangeField={handleChangeField}
            onApply={() => void handleApplyDraft()}
            onCancel={handleCancelDraft}
            onClose={handleCloseInspector}
            saving={draft.status === 'saving'}
            focusFieldId={focusFieldId}
            variant="sheet"
          />
        </div>
      ) : null}

      <NavigationGuardDialog
        open={guardOpen}
        onApply={() => void handleGuardApply()}
        onDiscard={handleGuardDiscard}
        onStay={handleGuardStay}
        applying={guardApplying}
      />
    </div>
  );
}

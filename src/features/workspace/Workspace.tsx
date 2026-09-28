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
import {
  hydratePanelState,
  isLatestPanelPreferenceRequest,
  panelPreferencesFromState,
  WorkspacePanelPreferenceStore,
} from './panelPreferences';
import { PanelHost } from '../panels';
import {
  HistoryController,
  HistoryLadder,
  CommitPanel,
  PublishController,
  PublishFlow,
  DraftBehindMainBanner,
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
  WorkerTransport,
  type ScenariosStatusResult,
} from '../runs';
import {
  applyScenarioDraft,
  changeScenarioDraft,
  deleteScenario,
  DeleteScenarioDialog,
  NewScenarioDialog,
  openScenarioDraft,
  ScenarioEditor,
  ScenarioSwitcher,
  type NewScenarioDialogProps,
  type ScenarioDraftHandle,
  type ScenarioSwitcherEntry,
} from '../scenarios';
import { createBrowserDownloadSink, useTransferActions } from '../transfer';
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
import { buildTransferSessionState, createScenarioDraftSession } from './integrationState';

const MOBILE_BREAKPOINT_PX = 768;

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
  /**
   * RV-12h review round: the one session actor App.tsx already holds in its
   * bootState and threads to EntryScreen -- Workspace's HistoryController
   * and PublishController act as this same local-human actor rather than
   * minting or reading a second identity of their own.
   */
  actor: Actor;
  /** D38 run-control slot; owned by the runs lane, empty until wired in. */
  runControl?: React.ReactNode;
}

export function Workspace({
  session,
  repository,
  onBackToProjects,
  mintId,
  actor,
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
  const [scenarioDraft, setScenarioDraft] = React.useState<ScenarioDraftHandle | null>(null);
  const [scenarioEditorFocusName, setScenarioEditorFocusName] = React.useState(false);
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
  const scenarioDraftSession = React.useMemo(
    () => createScenarioDraftSession(session),
    [session],
  );

  /**
   * commands.md §6 "Navigation guard": clean -> proceed; dirty -> Apply / Discard /
   * Stay. Every selection change, empty-canvas click, branch/project switch and
   * inspector close routes through this before touching anything.
   */
  const runGuarded = React.useCallback(
    (action: () => void) => {
      if (scenarioDraft?.status === 'saving') return;
      const hasUnsavedScenarioDraft = Boolean(
        scenarioDraft && (scenarioDraft.dirty || scenarioDraft.isNew),
      );
      if (decideNavigation(draft) === 'proceed' && !hasUnsavedScenarioDraft) {
        action();
        return;
      }
      pendingActionRef.current = action;
      setGuardOpen(true);
    },
    [draft, scenarioDraft],
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
      setScenarioDraft(null);
      setDraft(handle);
      setFocusFieldId(null);
    },
    [session, mintId],
  );

  const closeInspector = React.useCallback(() => {
    setDraft(null);
    setScenarioDraft(null);
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
    if (!draft && !scenarioDraft) return;
    runGuarded(closeInspector);
  }, [draft, scenarioDraft, runGuarded, closeInspector]);

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
    setScenarioDraft(null);
    setFocusFieldId(null);
    action?.();
  }, []);

  const handleGuardApply = React.useCallback(async () => {
    if (scenarioDraft) {
      setGuardApplying(true);
      setScenarioDraft((current) =>
        current ? Object.freeze({ ...current, status: 'saving' }) : current,
      );
      const next = await applyScenarioDraft(scenarioDraft, scenarioDraftSession);
      setGuardApplying(false);
      if (next.status === 'clean') {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        setGuardOpen(false);
        setScenarioDraft(null);
        action?.();
      } else {
        setGuardOpen(false);
        setScenarioDraft(next);
      }
      return;
    }
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
  }, [draft, draftSession, scenarioDraft, scenarioDraftSession]);

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

  // Results displays the controller's current run. It becomes a selectable
  // immutable CSV source only after the repository save succeeds.
  const selectedSavedRunId: Id | null =
    runControllerState?.current?.saveStatus === 'saved'
      ? runControllerState.current.runId
      : null;
  React.useEffect(() => {
    let cancelled = false;
    if (!selectedSavedRunId || !sessionState.projectId) return;
    void repository.loadProject(sessionState.projectId).then((project) => {
      if (!cancelled && project) setProjectRecord(project);
    });
    return () => {
      cancelled = true;
    };
  }, [repository, selectedSavedRunId, sessionState.projectId]);

  const transferSessionSource = React.useMemo(
    () => ({
      projectId: sessionState.projectId,
      projectRevision: projectRecord?.revision ?? null,
      document: sessionState.document,
    }),
    [projectRecord?.revision, sessionState.document, sessionState.projectId],
  );
  const transferSession = React.useMemo(
    () => buildTransferSessionState(transferSessionSource, activeViewId, selectedSavedRunId),
    [transferSessionSource, activeViewId, selectedSavedRunId],
  );
  const downloadSink = React.useMemo(() => createBrowserDownloadSink(), []);
  const transferActions = useTransferActions({
    repository,
    session: transferSession,
    mintId,
    downloadSink,
  });

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

  const [newScenarioDialogOpen, setNewScenarioDialogOpen] = React.useState(false);
  const [initialCopySourceId, setInitialCopySourceId] = React.useState<Id | null>(null);
  const [deleteScenarioTarget, setDeleteScenarioTarget] = React.useState<{
    readonly id: Id;
    readonly label: string;
  } | null>(null);
  const [deletingScenario, setDeletingScenario] = React.useState(false);

  const copySources = React.useMemo(
    () =>
      (document?.scenarios ?? []).map((scenario) => ({
        scenarioId: scenario.id,
        label: scenario.label,
        mode: scenario.mode,
      })),
    [document],
  );

  const openScenarioEditor = React.useCallback(
    (scenarioId: Id, focusName: boolean) => {
      const live = session.getState();
      if (!live.document || live.workingRevision === null) return;
      setDraft(null);
      setFocusFieldId(null);
      setScenarioEditorFocusName(focusName);
      setScenarioDraft(
        openScenarioDraft({
          draftId: mintId(),
          target: { kind: 'edit', scenarioId },
          document: live.document,
          baseWorkingRevision: live.workingRevision,
          mintId,
          randomSource: Math.random,
        }),
      );
    },
    [mintId, session],
  );

  const handleNewScenario = React.useCallback(() => {
    runGuarded(() => {
      closeInspector();
      setInitialCopySourceId(null);
      setNewScenarioDialogOpen(true);
    });
  }, [closeInspector, runGuarded]);

  const handleDuplicateScenario = React.useCallback(
    (scenarioId: Id) => {
      if (!document?.scenarios.some((scenario) => scenario.id === scenarioId)) return;
      runGuarded(() => {
        closeInspector();
        setInitialCopySourceId(scenarioId);
        setNewScenarioDialogOpen(true);
      });
    },
    [closeInspector, document, runGuarded],
  );

  const handleCreateScenario = React.useCallback(
    (params: Parameters<NewScenarioDialogProps['onCreate']>[0]) => {
      const live = session.getState();
      if (!live.document || live.workingRevision === null) return;
      setNewScenarioDialogOpen(false);
      setDraft(null);
      setFocusFieldId(null);
      setScenarioEditorFocusName(false);
      setScenarioDraft(
        openScenarioDraft({
          draftId: mintId(),
          target: { kind: 'new', mode: params.mode, from: params.from, label: params.label },
          document: live.document,
          baseWorkingRevision: live.workingRevision,
          mintId,
          randomSource: Math.random,
        }),
      );
    },
    [mintId, session],
  );

  const handleEditScenario = React.useCallback(
    (scenarioId: Id) => runGuarded(() => openScenarioEditor(scenarioId, false)),
    [openScenarioEditor, runGuarded],
  );

  const handleRenameScenario = React.useCallback(
    (scenarioId: Id) => runGuarded(() => openScenarioEditor(scenarioId, true)),
    [openScenarioEditor, runGuarded],
  );

  const handleRequestDeleteScenario = React.useCallback(
    (scenarioId: Id) => {
      const scenario = document?.scenarios.find((candidate) => candidate.id === scenarioId);
      if (!scenario) return;
      runGuarded(() => {
        closeInspector();
        setDeleteScenarioTarget({ id: scenario.id, label: scenario.label });
      });
    },
    [closeInspector, document, runGuarded],
  );

  const handleConfirmDeleteScenario = React.useCallback(async () => {
    if (!deleteScenarioTarget) return;
    setDeletingScenario(true);
    const result = await deleteScenario(
      deleteScenarioTarget.id,
      deleteScenarioTarget.label,
      scenarioDraftSession,
    );
    setDeletingScenario(false);
    if (result.status === 'applied') setDeleteScenarioTarget(null);
  }, [deleteScenarioTarget, scenarioDraftSession]);

  const handleChangeScenarioDraft = React.useCallback(
    (patch: Parameters<typeof changeScenarioDraft>[2]) => {
      const liveDocument = session.getState().document;
      if (!liveDocument) return;
      setScenarioDraft((current) =>
        current ? changeScenarioDraft(current, liveDocument, patch) : current,
      );
    },
    [session],
  );

  const handleApplyScenarioDraft = React.useCallback(async () => {
    if (!scenarioDraft || scenarioDraft.status === 'saving') return;
    const wasNew = scenarioDraft.isNew;
    setScenarioDraft(Object.freeze({ ...scenarioDraft, status: 'saving' }));
    const next = await applyScenarioDraft(scenarioDraft, scenarioDraftSession);
    setScenarioDraft(next);
    if (next.status === 'clean' && wasNew && next.sourceScenarioId) {
      handleSelectScenario(next.sourceScenarioId);
    }
  }, [handleSelectScenario, scenarioDraft, scenarioDraftSession]);

  const handleCancelScenarioDraft = React.useCallback(() => {
    setScenarioDraft(null);
    setScenarioEditorFocusName(false);
  }, []);

  const scenarioEntries: ScenarioSwitcherEntry[] = React.useMemo(
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
    draft?.dirty || scenarioDraft?.dirty || scenarioDraft?.isNew
      ? RUN_DISABLED_DIRTY_DRAFT_REASON
      : computeSessionRunDisabledReason(sessionState.status, sessionState.needsReload);

  const scenarioRunPhase =
    runControllerState?.phase === 'done'
      ? 'idle'
      : (runControllerState?.phase ?? 'idle');

  const runControlSlot = (
    <ScenarioSwitcher
      scenarios={scenarioEntries}
      selectedId={selectedScenarioId}
      runPhase={scenarioRunPhase}
      disabledReason={sessionRunDisabledReason}
      onSelect={handleSelectScenario}
      onRun={handleRunScenario}
      onRunAll={handleRunAll}
      onPause={() => runController?.pause()}
      onResume={() => runController?.resume()}
      onReset={handleResetRun}
      onNew={handleNewScenario}
      onDuplicate={handleDuplicateScenario}
      onEdit={handleEditScenario}
      onRename={handleRenameScenario}
      onDelete={handleRequestDeleteScenario}
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

  const scenarioEditorChecks = React.useMemo(() => {
    const scenarioId = scenarioDraft?.sourceScenarioId ?? scenarioDraft?.scenario?.id ?? null;
    if (!scenarioId) return null;
    const latestRun = scenariosWithStatus.find((item) => item.scenario.id === scenarioId)?.latestRun;
    if (!latestRun) return null;
    return new Map(latestRun.checks.map((check) => [check.assertionId, check]));
  }, [scenarioDraft, scenariosWithStatus]);

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

  // HistoryController binds getState/subscribe in its own constructor
  // (matching SessionController/PublishController), so they're safe to pass
  // bare here.
  const historyControllerState = React.useSyncExternalStore(
    historyController.subscribe,
    historyController.getState,
    historyController.getState,
  );
  const publishControllerState = React.useSyncExternalStore(
    publishController.subscribe,
    publishController.getState,
    publishController.getState,
  );

  // Panel placement/collapse/width preferences (commands.md §7) use their own
  // repository revision, outside project content and workingRevision.
  const [panelState, setPanelState] = React.useState<WorkspacePanelState>(() =>
    createInitialPanelState(
      typeof window === 'undefined'
        ? undefined
        : { viewport: { width: window.innerWidth, height: window.innerHeight } },
    ),
  );
  const panelStateRef = React.useRef(panelState);
  const initialPanelPreferencesRef = React.useRef(panelPreferencesFromState(panelState));
  const durablePanelPreferencesRef = React.useRef(initialPanelPreferencesRef.current);
  const panelPreferencesLoadedRef = React.useRef(false);
  const queuedPanelActionsRef = React.useRef<WorkspacePanelAction[]>([]);
  const panelPreferenceMountedRef = React.useRef(true);
  const pendingPanelPreferenceSavesRef = React.useRef(0);
  const latestPanelPreferenceRequestRef = React.useRef(0);
  const panelPreferenceFailedRef = React.useRef(false);
  const [panelPreferenceState, setPanelPreferenceState] = React.useState<
    'loading' | 'ready' | 'saving' | 'failed'
  >('loading');
  const [panelPreferenceStore] = React.useState(
    () => new WorkspacePanelPreferenceStore(repository),
  );

  const persistPanelState = React.useCallback(
    (state: WorkspacePanelState) => {
      const requested = panelPreferencesFromState(state);
      const requestSequence = ++latestPanelPreferenceRequestRef.current;
      pendingPanelPreferenceSavesRef.current += 1;
      panelPreferenceFailedRef.current = false;
      setPanelPreferenceState('saving');
      void panelPreferenceStore
        .save(requested)
        .then((result) => {
          if (!panelPreferenceMountedRef.current) return;
          if (result.status === 'applied') {
            durablePanelPreferencesRef.current = requested;
            panelPreferenceFailedRef.current = false;
          } else if (result.status === 'stale') {
            const durable = result.preferences ?? initialPanelPreferencesRef.current;
            durablePanelPreferencesRef.current = durable;
            const hydrated = hydratePanelState(panelStateRef.current, durable);
            panelStateRef.current = hydrated;
            setPanelState(hydrated);
            panelPreferenceStore.acknowledgeCurrentDisplayed();
            panelPreferenceFailedRef.current = false;
          } else if (result.status === 'failed' || result.status === 'invalid-stored-value') {
            if (
              !isLatestPanelPreferenceRequest(
                requestSequence,
                latestPanelPreferenceRequestRef.current,
              )
            ) {
              return;
            }
            const durable =
              result.status === 'failed' && result.preferences
                ? result.preferences
                : durablePanelPreferencesRef.current;
            const hydrated = hydratePanelState(panelStateRef.current, durable);
            panelStateRef.current = hydrated;
            setPanelState(hydrated);
            panelPreferenceFailedRef.current = true;
          }
        })
        .catch((error: unknown) => {
          if (!panelPreferenceMountedRef.current) return;
          console.error('Failed to save panel preferences:', error);
          if (
            !isLatestPanelPreferenceRequest(
              requestSequence,
              latestPanelPreferenceRequestRef.current,
            )
          ) {
            return;
          }
          const hydrated = hydratePanelState(
            panelStateRef.current,
            durablePanelPreferencesRef.current,
          );
          panelStateRef.current = hydrated;
          setPanelState(hydrated);
          panelPreferenceFailedRef.current = true;
        })
        .finally(() => {
          pendingPanelPreferenceSavesRef.current = Math.max(
            0,
            pendingPanelPreferenceSavesRef.current - 1,
          );
          if (!panelPreferenceMountedRef.current || pendingPanelPreferenceSavesRef.current > 0) {
            return;
          }
          setPanelPreferenceState(panelPreferenceFailedRef.current ? 'failed' : 'ready');
        });
    },
    [panelPreferenceStore],
  );

  const applyPanelAction = React.useCallback(
    (action: WorkspacePanelAction) => {
      const { state: next, effects } = panelReducer(panelStateRef.current, action);
      panelStateRef.current = next;
      setPanelState(next);
      if (effects.some((effect) => effect.type === 'save')) {
        persistPanelState(next);
      }
    },
    [persistPanelState],
  );

  const panelDispatch = React.useCallback(
    (action: WorkspacePanelAction) => {
      if (!panelPreferencesLoadedRef.current) {
        queuedPanelActionsRef.current.push(action);
        return;
      }
      applyPanelAction(action);
    },
    [applyPanelAction],
  );

  React.useEffect(() => {
    panelPreferenceMountedRef.current = true;
    let cancelled = false;
    void panelPreferenceStore
      .load()
      .then((loaded) => {
        if (cancelled) return;
        if (loaded.preferences) {
          durablePanelPreferencesRef.current = loaded.preferences;
          const hydrated = hydratePanelState(panelStateRef.current, loaded.preferences);
          panelStateRef.current = hydrated;
          setPanelState(hydrated);
        }
        setPanelPreferenceState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        panelPreferenceFailedRef.current = true;
        setPanelPreferenceState('failed');
        console.error('Failed to load panel preferences:', error);
      })
      .finally(() => {
        if (cancelled) return;
        panelPreferencesLoadedRef.current = true;
        const queued = queuedPanelActionsRef.current;
        queuedPanelActionsRef.current = [];
        queued.forEach(applyPanelAction);
      });
    return () => {
      cancelled = true;
      panelPreferenceMountedRef.current = false;
    };
  }, [applyPanelAction, panelPreferenceStore]);

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

  const [libraryView, setLibraryView] = React.useState<LibraryView>('list');

  const [publishOpen, setPublishOpen] = React.useState(false);
  const [behindMainBannerDismissed, setBehindMainBannerDismissed] = React.useState(false);

  // 22E "draft behind main": proactively prepares a real publish candidate
  // against main so the real conflict count is known before the user opens
  // Publish (matching DraftBehindMainBanner's own doc comment: "the app
  // shell mounts [it] typically after calling PublishController.prepare()").
  // PublishFlow reuses this same prepared candidate when opened (its own
  // effect only calls prepare() while status is 'idle').
  //
  // PublishController exposes no cheaper "is main ahead of this draft"
  // check (PublishControllerLike is only getState/subscribe/prepare/
  // resolveConflict/resolveAllConflicts/reopenConflict/runScenario/publish/
  // reset) -- prepare() itself, which builds a real isolated merge
  // candidate, is the only way to learn the real conflict count. It is
  // therefore run only on real navigation events -- opening/switching to a
  // draft branch, and the user opening History or Publish -- never on a
  // timer and never per document edit/keystroke.
  const mainBranchId = projectRecord?.mainBranchId ?? null;
  const isOnDraftBranch = Boolean(sessionState.projectId && sessionState.branchId && mainBranchId && sessionState.branchId !== mainBranchId);

  const refreshBehindMainCheck = React.useCallback(() => {
    if (!isOnDraftBranch) return;
    setBehindMainBannerDismissed(false);
    void publishController.prepare();
  }, [isOnDraftBranch, publishController]);

  React.useEffect(() => {
    if (!sessionState.projectId || !sessionState.branchId || !mainBranchId) return;
    if (sessionState.branchId === mainBranchId) {
      // Main's head only ever moves (in this local, single-actor app)
      // through this session's own publish, which already reloads the
      // session onto main -- reaching this branch. Nothing to prepare while
      // sitting on main itself.
      publishController.reset();
      setPublishOpen(false);
      setBehindMainBannerDismissed(false);
      return;
    }
    // Opened/switched to a draft branch.
    refreshBehindMainCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState.projectId, sessionState.branchId, mainBranchId]);

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
              hosted
              controller={historyController}
              onCancel={() => setHistoryView('ladder')}
              onRunScenario={(scenarioId) => void handleRunScenario(scenarioId)}
              onRunAll={() => void handleRunAll()}
            />
          );
        }
        return (
          <HistoryLadder
            hosted
            controller={historyController}
            canUndo={sessionState.canUndo && sessionState.status === 'ready'}
            canRedo={sessionState.canRedo && sessionState.status === 'ready'}
            onUndo={() => void handleUndo()}
            onRedo={() => void handleRedo()}
            onOpenCommit={() => setHistoryView('commit')}
            onOpenPublish={() => {
              refreshBehindMainCheck();
              setPublishOpen(true);
            }}
            behindMain={
              behindMainInfo
                ? {
                    conflictCount: behindMainInfo.conflictCount,
                    versionsPublishedSinceFork: behindMainInfo.versionsPublishedSinceFork,
                  }
                : null
            }
            onReviewAndResolve={() => {
              refreshBehindMainCheck();
              setPublishOpen(true);
            }}
            onClose={() => panelDispatch({ type: 'CLOSE', panel: 'history' })}
          />
        );
      }
      return (
        <LibraryPanel
          hosted
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
      behindMainInfo,
      libraryView,
      panelDispatch,
      refreshBehindMainCheck,
      sessionState.canUndo,
      sessionState.canRedo,
      sessionState.status,
    ],
  );

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
    if (!draft && !scenarioDraft) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || guardOpen) return;
      if (!draft?.dirty && !scenarioDraft?.dirty && !scenarioDraft?.isNew) {
        e.preventDefault();
        closeInspector();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft, scenarioDraft, guardOpen, closeInspector]);

  return (
    <div
      data-testid="workspace-root"
      data-panel-preference-state={panelPreferenceState}
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
          transferActions={transferActions}
          onOpenHistory={() => {
            panelDispatch({ type: 'OPEN', panel: 'history' });
            refreshBehindMainCheck();
          }}
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
                          refreshBehindMainCheck();
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
        {scenarioDraft && document && !isMobileInspector ? (
          <aside
            data-testid="scenario-inspector-dock"
            className="w-[320px] min-w-[320px] h-full overflow-hidden border-l border-border bg-panel"
            aria-label="Scenario inspector"
          >
            <ScenarioEditor
              document={document}
              handle={scenarioDraft}
              onChange={handleChangeScenarioDraft}
              onApply={() => void handleApplyScenarioDraft()}
              onCancel={handleCancelScenarioDraft}
              onClose={handleCloseInspector}
              mintId={mintId}
              lastRunChecks={scenarioEditorChecks}
              focusName={scenarioEditorFocusName}
            />
          </aside>
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

      {scenarioDraft && document && isMobileInspector ? (
        <div
          data-testid="scenario-inspector-sheet-overlay"
          className="fixed inset-x-0 bottom-0 z-modal h-[70vh] max-h-[70vh] overflow-hidden shadow-md rounded-t-lg border-t border-control-border bg-panel"
        >
          <ScenarioEditor
            document={document}
            handle={scenarioDraft}
            onChange={handleChangeScenarioDraft}
            onApply={() => void handleApplyScenarioDraft()}
            onCancel={handleCancelScenarioDraft}
            onClose={handleCloseInspector}
            mintId={mintId}
            lastRunChecks={scenarioEditorChecks}
            focusName={scenarioEditorFocusName}
          />
        </div>
      ) : null}

      <NewScenarioDialog
        open={newScenarioDialogOpen}
        onOpenChange={setNewScenarioDialogOpen}
        copySources={copySources}
        initialCopySourceId={initialCopySourceId}
        onCreate={handleCreateScenario}
      />

      <DeleteScenarioDialog
        open={deleteScenarioTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deletingScenario) setDeleteScenarioTarget(null);
        }}
        scenarioLabel={deleteScenarioTarget?.label ?? ''}
        remainingCount={Math.max((document?.scenarios.length ?? 0) - 1, 0)}
        onConfirm={() => void handleConfirmDeleteScenario()}
        confirming={deletingScenario}
      />

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

import * as React from 'react';
import type { SessionController } from '../session/controller';
import { formatStudioError } from '../session/formatError';
import { TopBar } from './TopBar';
import type { BranchActionOutcome } from './BranchPopover';
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
import { PanelHost, type PanelCommandRoutes } from '../panels';
import { HistoryController } from '../history/controller';
import { PublishController } from '../history/publishController';
import { DraftBehindMainBanner } from '../history/DraftBehindMainBanner';
import { HistoryLadder, CommitPanel, PublishFlow, ScenarioEditor, preloadLazyViews } from './lazyViews';
import { whenIdle } from '@/lib/lazyComponent';
import { LibraryPanel, type LibraryView } from '../library';
import { downloadSavedPart, SavedParts } from '../library/SavedParts';
import type {
  BranchRecord,
  ProjectRecord,
  StudioRepository,
} from '../../persistence/studio/types';
import { createCandidateController, type Actor } from '../../persistence/studio';
import type { Id } from '../../domain/studio/model';
import { captureSelection } from '../../domain/parts/capture';
import { planPlacement } from '../../domain/parts/place';
import type { PartContent } from '../../domain/parts/types';
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
  openScenarioDraft,
} from '../scenarios/draft';
import { DeleteScenarioDialog } from '../scenarios/DeleteScenarioDialog';
import { NewScenarioDialog, type NewScenarioDialogProps } from '../scenarios/NewScenarioDialog';
import { ScenarioSwitcher, type ScenarioSwitcherEntry } from '../scenarios/ScenarioSwitcher';
import type { ScenarioDraftHandle } from '../scenarios/types';
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
import {
  buildQuickOptions,
  COMMAND_DEFINITIONS,
  executeCommand,
  formatShortcut,
  getAvailability,
  getPayloadFreeAvailability,
  runCanvasShortcut,
  runGlobalShortcut,
  type CommandContext,
  type CommandDraftState,
  type CommandHandlers,
  type CommandId,
  type CommandPayloads,
  type ExecuteResult,
  type QuickOption,
  type ShortcutEvent,
} from './commands/registry';
import { QuickOptionsDialog, type RenameOutcome } from './QuickOptions';
import type { TextStepKind } from './QuickOptionsTextStep';
import { routeHistoryController, routePublishController } from './historyRouting';
import { DEFAULT_DOCK_CONFIG, type DockConfig } from './dockConfig';
import { findRunAllDisabledReason } from '../runs';
import type { SessionRenameResult } from '../session/types';
import {
  planAddNote,
  planAlign,
  planDistribute,
  planGroup,
  planUngroup,
  type SelectionPlan,
} from './selectionPlans';
import { expansionStateOf, planExpansion } from './expandPlans';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MOBILE_BREAKPOINT_PX = 768;

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/** RV-03q: the nested Quick options rename reports the session's own reason. */
function renameOutcome(result: SessionRenameResult): RenameOutcome {
  switch (result.status) {
    case 'applied':
      return { ok: true };
    case 'busy':
    case 'unsupported':
      return { ok: false, message: result.message };
    case 'invalid':
      return { ok: false, message: result.issues[0]?.message ?? 'That name is not valid' };
    case 'stale':
      return { ok: false, message: 'This project changed elsewhere. Reopen it and try again.' };
    default:
      return { ok: false, message: 'Rename failed. Try again.' };
  }
}

type DuplicateDialogState =
  | {
      readonly kind: 'confirm';
      readonly content: PartContent;
      readonly anchor: { readonly x: number; readonly y: number };
      readonly items: readonly string[];
      readonly warnings: readonly string[];
    }
  | { readonly kind: 'error'; readonly messages: readonly string[] };

const UUID_IN_MESSAGE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/g;

function duplicateIssueMessages(
  issues: readonly { readonly message: string }[],
  fallback: string,
): readonly string[] {
  const messages = issues.map((issue) =>
    issue.message.replace(UUID_IN_MESSAGE, 'the referenced item'),
  );
  return messages.length > 0 ? messages : [fallback];
}

function duplicateConfirmationItems(preview: {
  readonly excludedConnectionIds: readonly Id[];
  readonly excludedRelationIds: readonly Id[];
  readonly omittedPartialGroupIds: readonly Id[];
  readonly excludedNoteIds: readonly Id[];
  readonly notices: readonly string[];
}): readonly string[] {
  const items = [...preview.notices];
  const addFallback = (count: number, keyword: string, message: string) => {
    if (count > 0 && !items.some((item) => item.toLowerCase().includes(keyword))) {
      items.push(message);
    }
  };
  addFallback(
    preview.excludedConnectionIds.length,
    'connection',
    `${preview.excludedConnectionIds.length} external connection(s) will not be duplicated.`,
  );
  addFallback(
    preview.excludedRelationIds.length,
    'relation',
    `${preview.excludedRelationIds.length} external relation(s) will not be duplicated.`,
  );
  addFallback(
    preview.omittedPartialGroupIds.length,
    'group',
    `${preview.omittedPartialGroupIds.length} partially selected group(s) will not be duplicated.`,
  );
  addFallback(
    preview.excludedNoteIds.length,
    'note',
    `${preview.excludedNoteIds.length} note(s) with mixed or external attachments will not be duplicated.`,
  );
  return Array.from(new Set(items));
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

  // History, Commit, Publish and the scenario editor load on demand; warm them once idle.
  React.useEffect(() => whenIdle(preloadLazyViews), []);

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
  const pendingActionRef = React.useRef<{
    readonly run: () => void;
    readonly cancel?: () => void;
  } | null>(null);

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

  // Stable handle on the registry executor (defined further down with the
  // handler table) so panel/inspector callbacks built earlier route through it.
  const commandRunnerRef = React.useRef<
    (<K extends CommandId>(id: K, payload: CommandPayloads[K]) => Promise<ExecuteResult>) | null
  >(null);
  const runCommand = React.useCallback(
    <K extends CommandId>(id: K, payload: CommandPayloads[K]): Promise<ExecuteResult> =>
      commandRunnerRef.current
        ? commandRunnerRef.current(id, payload)
        : Promise.resolve({ status: 'disabled', reason: 'The workspace is still loading', code: 'busy' }),
    [],
  );

  /**
   * commands.md §6 "Navigation guard": clean -> proceed; dirty -> Apply / Discard /
   * Stay. Every selection change, empty-canvas click, branch/project switch and
   * inspector close routes through this before touching anything.
   */
  const runGuarded = React.useCallback(
    (action: () => void, onCancel?: () => void) => {
      if (scenarioDraft?.status === 'saving') {
        onCancel?.();
        return;
      }
      const hasUnsavedScenarioDraft = Boolean(
        scenarioDraft && (scenarioDraft.dirty || scenarioDraft.isNew),
      );
      if (decideNavigation(draft) === 'proceed' && !hasUnsavedScenarioDraft) {
        action();
        return;
      }
      pendingActionRef.current = { run: action, cancel: onCancel };
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
    pendingActionRef.current?.cancel?.();
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
    action?.run();
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
        action?.run();
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
      action?.run();
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
  const activeView = React.useMemo(
    () => document?.views.find((view) => view.id === activeViewId) ?? null,
    [document, activeViewId],
  );
  const selectedGroupIds = React.useMemo(() => {
    if (!activeView || selectedElementIds.size === 0) return [];
    return activeView.groups
      .filter(
        (group) =>
          group.elementIds.length === selectedElementIds.size &&
          group.elementIds.every((elementId) => selectedElementIds.has(elementId)),
      )
      .map((group) => group.id);
  }, [activeView, selectedElementIds]);
  const selectionWhollyUngrouped = React.useMemo(() => {
    if (!activeView || selectedElementIds.size === 0) return false;
    const grouped = new Set(activeView.groups.flatMap((group) => group.elementIds));
    return Array.from(selectedElementIds).every((elementId) => !grouped.has(elementId));
  }, [activeView, selectedElementIds]);

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

  // Results are normally contextual to a scenario. The explicit results.open
  // command can also reveal an honest empty state in a blank project.
  const [resultsRequested, setResultsRequested] = React.useState(false);
  // results.close hides the region until results.open or the next run starts.
  const [resultsDismissed, setResultsDismissed] = React.useState(false);
  const resultsRegionRef = React.useRef<HTMLDivElement>(null);
  const showResultsRegion = !resultsDismissed && (runningOrSelectedScenario !== null || resultsRequested);
  const runPhaseForResults = runControllerState?.phase ?? 'idle';
  React.useEffect(() => {
    if (runPhaseForResults === 'compiling' || runPhaseForResults === 'running') setResultsDismissed(false);
  }, [runPhaseForResults]);

  const staleRun = Boolean(
    runControllerState?.current?.terminal &&
      lastRunSnapshotId !== null &&
      sessionState.workingSnapshotId !== null &&
      lastRunSnapshotId !== sessionState.workingSnapshotId,
  );

  const isSaving = sessionState.status === 'saving';
  const hasError = Boolean(sessionState.lastError);
  // Only repository write failures block history/part commands; a rejected
  // edit (invalid, stale, ineligible) also lands in lastError but isn't storage.
  const storageFailed = (() => {
    const error = sessionState.lastError as { status?: unknown; code?: unknown } | null;
    return error?.status === 'failed' && (error.code === 'quota' || error.code === 'unavailable');
  })();

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

  // The history/publish components act through these facades so each action
  // executes its registry command (see historyRouting.ts).
  const routedHistoryController = React.useMemo(
    () => routeHistoryController(historyController, runCommand),
    [historyController, runCommand],
  );
  const routedPublishController = React.useMemo(
    () => routePublishController(publishController, runCommand),
    [publishController, runCommand],
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
  const [dockConfig, setDockConfig] = React.useState<DockConfig>(DEFAULT_DOCK_CONFIG);
  const durableDockRef = React.useRef<DockConfig>(DEFAULT_DOCK_CONFIG);
  const [dockPreferenceState, setDockPreferenceState] = React.useState<'loading' | 'ready' | 'saving' | 'failed'>('loading');

  const persistDockConfig = React.useCallback((requested: DockConfig) => {
    if (!panelPreferencesLoadedRef.current) return;
    setDockConfig(requested);
    setDockPreferenceState('saving');
    void panelPreferenceStore.saveDock(requested).then((result) => {
      if (!panelPreferenceMountedRef.current) return;
      if (result.status === 'applied') {
        durableDockRef.current = requested;
        setDockPreferenceState('ready');
      } else if (result.status === 'stale') {
        durableDockRef.current = result.dock;
        setDockConfig(result.dock);
        if (result.preferences) {
          durablePanelPreferencesRef.current = result.preferences;
          const hydrated = hydratePanelState(panelStateRef.current, result.preferences);
          panelStateRef.current = hydrated;
          setPanelState(hydrated);
        }
        panelPreferenceStore.acknowledgeCurrentDisplayed();
        setDockPreferenceState('ready');
      } else if (result.status === 'superseded') {
        setDockConfig(durableDockRef.current);
        setDockPreferenceState('ready');
      } else {
        setDockConfig(durableDockRef.current);
        setDockPreferenceState('failed');
      }
    }).catch((error: unknown) => {
      if (!panelPreferenceMountedRef.current) return;
      console.error('Failed to save dock preferences:', error);
      setDockConfig(durableDockRef.current);
      setDockPreferenceState('failed');
    });
  }, [panelPreferenceStore]);

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
            durableDockRef.current = panelPreferenceStore.currentDock();
            setDockConfig(durableDockRef.current);
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
      // commands.md: opening a panel "expands and focuses" it. Only OPEN/EXPAND move focus,
      // and never away from something already inside that panel (clicks there emit FOCUS too).
      if (action.type === 'OPEN' || action.type === 'EXPAND') {
        for (const effect of effects) {
          if (effect.type !== 'focus') continue;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const header = window.document.querySelector<HTMLElement>(`[data-slot="panel-header"][data-panel-id="${effect.target}"]`);
            const region = header?.parentElement;
            if (!header || (region && region.contains(window.document.activeElement))) return;
            header.focus();
          }));
        }
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
        durableDockRef.current = loaded.dock;
        setDockConfig(loaded.dock);
        setDockPreferenceState('ready');
        setPanelPreferenceState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        panelPreferenceFailedRef.current = true;
        setPanelPreferenceState('failed');
        setDockPreferenceState('failed');
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
      //
      // 22D: this session's own publish reloads the session onto main while the
      // controller is still 'publishing' (it turns 'published' right after);
      // keep the controller and overlay so PublishedNotice shows until the user
      // dismisses it or navigates to another branch.
      const publishStatus = publishController.getState().status;
      if (publishStatus !== 'publishing' && publishStatus !== 'published') {
        publishController.reset();
        setPublishOpen(false);
      }
      setBehindMainBannerDismissed(false);
      return;
    }
    // Opened/switched to a draft branch: a previous publish's notice is over.
    if (publishController.getState().status === 'published') {
      publishController.reset();
      setPublishOpen(false);
    }
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
    runGuarded(() => panelDispatch({ type: 'OPEN', panel: 'library' }));
  }, [panelDispatch, runGuarded]);

  const placeSavedPart = React.useCallback(async (content: PartContent, label: string) => {
    const live = session.getState().document;
    if (!live || !activeViewId || !canvasViewRef.current) return false;
    const plan = planPlacement(live, activeViewId, content, canvasViewRef.current.getVisibleCentre(), mintId);
    if (!plan.ok) throw { status: 'invalid', issues: plan.issues };
    const applied = await handleApplyChanges(plan.changes, `Place ${label}`);
    if (applied) openInspectorFor({ kind: 'element', ids: [...plan.newElementIds] });
    return applied;
  }, [session, activeViewId, mintId, handleApplyChanges, openInspectorFor]);

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

  // ==========================================================================
  // RV-03q: command registry + 14A Quick options (commands.md §1)
  // ==========================================================================

  const [quickOptionsOpen, setQuickOptionsOpen] = React.useState(false);
  const [duplicateDialog, setDuplicateDialog] = React.useState<DuplicateDialogState | null>(null);
  const [duplicateApplying, setDuplicateApplying] = React.useState(false);

  const openHistoryPanel = React.useCallback(() => {
    panelDispatch({ type: 'OPEN', panel: 'history' });
    refreshBehindMainCheck();
  }, [panelDispatch, refreshBehindMainCheck]);

  // Open inspector / scenario draft as the registry sees it (commands.md §1).
  const draftContext = React.useMemo((): { readonly id: Id | null; readonly state: CommandDraftState } => {
    if (scenarioDraft) {
      const state: CommandDraftState =
        scenarioDraft.status === 'saving'
          ? 'saving'
          : scenarioDraft.status === 'stale' || scenarioDraft.status === 'missing'
            ? 'stale'
            : scenarioDraft.dirty || scenarioDraft.isNew
              ? 'dirty'
              : 'clean';
      return { id: scenarioDraft.draftId, state };
    }
    if (draft) {
      const state: CommandDraftState =
        draft.status === 'saving' || draft.status === 'invalid' || draft.status === 'stale' || draft.status === 'validating'
          ? draft.status
          : draft.dirty
            ? 'dirty'
            : 'clean';
      return { id: draft.draftId, state };
    }
    return { id: null, state: 'clean' };
  }, [draft, scenarioDraft]);

  // Read-only context for availability; built from workspace state, never the DOM.
  const commandContext: CommandContext = React.useMemo(() => {
    const mainId = projectRecord?.mainBranchId ?? null;
    const selectedEntry =
      scenarioEntries.find((entry) => entry.id === selectedScenarioId) ?? scenarioEntries[0] ?? null;
    return {
      projectId: sessionState.projectId,
      projectTitle: projectRecord?.title ?? null,
      branchId: sessionState.branchId,
      activeViewId,
      branches: branches.map((branch) => ({
        id: branch.id,
        label: branch.id === mainId ? 'main' : branch.label,
        isMain: branch.id === mainId,
        closed: branch.state === 'closed',
      })),
      storageState: isSaving ? 'saving' : storageFailed ? 'failed' : 'ready',
      draftState: draftContext.state,
      draftId: draftContext.id,
      panels: {
        library: {
          open: panelState.panels.library.open,
          collapsed: panelState.panels.library.collapsed,
        },
        history: {
          open: panelState.panels.history.open,
          collapsed: panelState.panels.history.collapsed,
        },
      },
      resultsVisible: showResultsRegion,
      commitCount: historyControllerState.commits.length,
      publish: {
        status: publishControllerState.status,
        eligible: publishControllerState.eligible,
        conflictCount: publishControllerState.conflicts.length,
      },
      canUndo: sessionState.canUndo && sessionState.status === 'ready',
      canRedo: sessionState.canRedo && sessionState.status === 'ready',
      selectedElementIds: Array.from(selectedElementIds),
      selectedConnectionIds: Array.from(selectedConnectionIds),
      selectedGroupIds,
      selectionWhollyUngrouped,
      activeViewGroupCount: activeView?.groups.length ?? 0,
      activeViewNoteCount: activeView?.notes.length ?? 0,
      expansionState: activeView ? expansionStateOf(activeView) : {},
      selectedPlacementIds: activeView
        ? activeView.placements.filter((p) => selectedElementIds.has(p.elementId)).map((p) => p.id)
        : [],
      runBlockedReason: sessionRunDisabledReason,
      runPhase: runControllerState?.phase ?? 'idle',
      hasRunDisplay: Boolean(runControllerState?.current),
      scenarioCount: scenarioEntries.length,
      selectedScenario: selectedEntry
        ? {
            id: selectedEntry.id,
            label: selectedEntry.label,
            notReadyReason:
              selectedEntry.status.kind === 'not-ready'
                ? (selectedEntry.status.issues[0]?.message ?? "Can't run this scenario")
                : null,
          }
        : null,
      runAllBlockedReason: findRunAllDisabledReason(scenarioEntries),
      exportDisabledReasons: {
        png: transferActions.getDisabledReason('png'),
        svg: transferActions.getDisabledReason('svg'),
        json: transferActions.getDisabledReason('json'),
        csv: transferActions.getDisabledReason('csv'),
        mermaid: transferActions.getDisabledReason('mermaid'),
      },
    };
  }, [
    branches,
    activeView,
    activeViewId,
    draftContext,
    panelState.panels,
    showResultsRegion,
    historyControllerState.commits.length,
    publishControllerState.status,
    publishControllerState.eligible,
    publishControllerState.conflicts.length,
    hasError,
    isSaving,
    projectRecord,
    runControllerState,
    scenarioEntries,
    selectedScenarioId,
    selectedConnectionIds,
    selectedElementIds,
    selectedGroupIds,
    selectionWhollyUngrouped,
    sessionRunDisabledReason,
    sessionState.branchId,
    sessionState.canRedo,
    sessionState.canUndo,
    sessionState.projectId,
    sessionState.status,
    transferActions,
  ]);

  const applySelectionPlan = React.useCallback(
    async (plan: SelectionPlan): Promise<RenameOutcome> => {
      if (!plan.ok) return { ok: false, message: plan.reason };
      const applied = await handleApplyChanges(plan.changes, plan.label);
      return applied ? { ok: true } : { ok: false, message: 'Could not save this canvas change' };
    },
    [handleApplyChanges],
  );

  const applyDuplicate = React.useCallback(
    async (
      content: PartContent,
      anchor: { readonly x: number; readonly y: number },
    ): Promise<RenameOutcome> => {
      const liveDocument = session.getState().document;
      if (!liveDocument || !activeViewId) {
        const message = 'No canvas view is open';
        setDuplicateDialog({ kind: 'error', messages: [message] });
        return { ok: false, message };
      }
      const placement = planPlacement(liveDocument, activeViewId, content, anchor, mintId);
      if (!placement.ok) {
        const messages = duplicateIssueMessages(
          placement.issues,
          'Could not duplicate this selection',
        );
        setDuplicateDialog({ kind: 'error', messages });
        return { ok: false, message: messages[0] ?? 'Could not duplicate this selection' };
      }
      const applied = await handleApplyChanges(placement.changes, 'Duplicate selection');
      if (!applied) {
        const message = 'Could not save the duplicated selection';
        setDuplicateDialog({ kind: 'error', messages: [message] });
        return { ok: false, message };
      }
      setDuplicateDialog(null);
      if (placement.newElementIds.length > 0) {
        openInspectorFor({ kind: 'element', ids: [...placement.newElementIds] });
      }
      return { ok: true };
    },
    [activeViewId, handleApplyChanges, mintId, openInspectorFor, session],
  );

  const handleDuplicateSelection = React.useCallback(async (): Promise<RenameOutcome> => {
    if (!document || !activeView || !activeViewId) {
      const message = 'No canvas view is open';
      setDuplicateDialog({ kind: 'error', messages: [message] });
      return { ok: false, message };
    }
    const selectedIds = commandContext.selectedElementIds;
    const selected = new Set(selectedIds);
    const sourcePlacements = activeView.placements.filter((placement) => selected.has(placement.elementId));
    if (sourcePlacements.length !== selectedIds.length) {
      const message = 'Every selected component must be placed in the active view';
      setDuplicateDialog({ kind: 'error', messages: [message] });
      return { ok: false, message };
    }
    const captured = captureSelection(document, activeViewId, {
      elementIds: selectedIds,
      noteIds: [],
    });
    if (!captured.ok) {
      const messages = duplicateIssueMessages(
        captured.issues,
        'Could not capture this selection',
      );
      setDuplicateDialog({ kind: 'error', messages });
      return { ok: false, message: messages[0] ?? 'Could not capture this selection' };
    }
    const anchor = {
      x: Math.min(...sourcePlacements.map((placement) => placement.x)) + 24,
      y: Math.min(...sourcePlacements.map((placement) => placement.y)) + 24,
    };
    const items = duplicateConfirmationItems(captured.preview);
    if (items.length > 0) {
      setDuplicateDialog({
        kind: 'confirm',
        content: captured.content,
        anchor,
        items,
        warnings: captured.preview.warnings,
      });
      return { ok: true };
    }
    return applyDuplicate(captured.content, anchor);
  }, [activeView, activeViewId, applyDuplicate, commandContext.selectedElementIds, document]);

  // Exhaustive over CommandId: keyboard and Quick options share these.
  const commandHandlers: CommandHandlers = React.useMemo(
    () => ({
      'commands.open': () => setQuickOptionsOpen(true),
      'project.rename': ({ title }) => handleRenameProject(title),
      'project.switch': () => handleBackToProjects(),
      'branch.switch': ({ branchId }) => handleSwitchBranch(branchId),
      'branch.create': ({ label, source }) => session.createBranch(label, source),
      'branch.reopen': ({ branchId }) => session.reopenBranch(branchId),
      'run.start': ({ scenarioId }) => handleRunScenario(scenarioId),
      'run.start-all': () => handleRunAll(),
      'run.pause': () => runController?.pause(),
      'run.resume': () => runController?.resume(),
      'run.cancel': () => runController?.cancel(),
      'run.reset': () => handleResetRun(),
      'history.open': () => openHistoryPanel(),
      'history.close': () => panelDispatch({ type: 'CLOSE', panel: 'history' }),
      'history.checkpoint': ({ label }) => historyController.saveCheckpoint(label),
      'history.commit': ({ message }) => historyController.commit(message),
      'history.restore': ({ targetId, label }) => historyController.restore(targetId, label),
      // Opens the review overlay first so its "preparing" state is visible.
      'history.prepare-publish': () => {
        setBehindMainBannerDismissed(false);
        setPublishOpen(true);
        return publishController.prepare();
      },
      'history.resolve-conflict': ({ conflictId, resolution }) =>
        publishController.resolveConflict(conflictId, resolution),
      'history.publish': ({ metadata, keepSourceOpen }) =>
        publishController.publish(metadata, keepSourceOpen),
      'library.open': () => openLibraryPanel(),
      'library.close': () => panelDispatch({ type: 'CLOSE', panel: 'library' }),
      'results.open': () => {
        setResultsDismissed(false);
        setResultsRequested(true);
        requestAnimationFrame(() => resultsRegionRef.current?.focus());
      },
      'results.close': () => setResultsDismissed(true),
      'panel.place': ({ panelId, placement, index }) =>
        panelDispatch({ type: 'PLACE', panel: panelId, placement, index }),
      'panel.collapse': ({ panelId }) => panelDispatch({ type: 'COLLAPSE', panel: panelId }),
      'panel.expand': ({ panelId }) => panelDispatch({ type: 'EXPAND', panel: panelId }),
      // A docked panel resets its own side's shared width; a floating one keeps
      // the header menu's existing behaviour (right side).
      'panel.reset-width': ({ panelId }) =>
        panelDispatch({
          type: 'RESET_SIDE',
          side: panelStateRef.current.panels[panelId].placement === 'left' ? 'left' : 'right',
        }),
      'inspector.apply': ({ draftId }) =>
        scenarioDraft?.draftId === draftId ? handleApplyScenarioDraft() : handleApplyDraft(),
      'inspector.cancel': ({ draftId }) =>
        scenarioDraft?.draftId === draftId ? handleCancelScenarioDraft() : handleCancelDraft(),
      'inspector.close': () => handleCloseInspector(),
      'canvas.select-tool': () => canvasViewRef.current?.setToolMode('select'),
      'canvas.pan-tool': () => canvasViewRef.current?.setToolMode('pan'),
      'canvas.zoom-out': () => canvasViewRef.current?.zoomOut(),
      'canvas.zoom-in': () => canvasViewRef.current?.zoomIn(),
      'canvas.fit': () => canvasViewRef.current?.fitView(),
      'dock.configure': (config) => persistDockConfig(config),
      'dock.restore-defaults': () => persistDockConfig(DEFAULT_DOCK_CONFIG),
      'export.png': () => transferActions.exportPng(),
      'export.svg': () => transferActions.exportSvg(),
      'project.export-json': () => transferActions.exportJson(),
      'export.csv': () => transferActions.exportCsv(),
      'export.mermaid': () => transferActions.exportMermaid(),
      'edit.undo': () => handleUndo(),
      'edit.redo': () => handleRedo(),
      'selection.duplicate': () => handleDuplicateSelection(),
      'selection.delete': () => canvasViewRef.current?.deleteSelection(),
      'selection.group': ({ label }) =>
        document && activeViewId
          ? applySelectionPlan(planGroup(document, activeViewId, commandContext.selectedElementIds, mintId(), label))
          : { ok: false, message: 'No canvas view is open' },
      'selection.ungroup': ({ groupIds }) =>
        document && activeViewId
          ? applySelectionPlan(planUngroup(document, activeViewId, groupIds))
          : { ok: false, message: 'No canvas view is open' },
      'selection.align': ({ edge }) =>
        document && activeViewId
          ? applySelectionPlan(planAlign(document, activeViewId, commandContext.selectedElementIds, edge, canvasViewRef.current?.getMeasuredHeights()))
          : { ok: false, message: 'No canvas view is open' },
      'selection.distribute': ({ axis }) =>
        document && activeViewId
          ? applySelectionPlan(planDistribute(document, activeViewId, commandContext.selectedElementIds, axis, canvasViewRef.current?.getMeasuredHeights()))
          : { ok: false, message: 'No canvas view is open' },
      'canvas.expand': ({ viewId, target }) =>
        document
          ? applySelectionPlan(planExpansion(document, viewId, target, 'expand'))
          : { ok: false, message: 'No canvas view is open' },
      'canvas.collapse': ({ viewId, target }) =>
        document
          ? applySelectionPlan(planExpansion(document, viewId, target, 'collapse'))
          : { ok: false, message: 'No canvas view is open' },
      'canvas.add-note': ({ text }) => {
        const point = canvasViewRef.current?.getVisibleCentre();
        return document && activeViewId && point
          ? applySelectionPlan(planAddNote(document, activeViewId, mintId(), text, point))
          : { ok: false, message: 'No canvas view is open' };
      },
      'part.capture': ({ command }) => session.savePart(command),
      'part.place': ({ content, label }) => placeSavedPart(content, label),
      'part.export': (part) => downloadSavedPart(repository, session.getState().projectId as Id, part),
      'part.import': ({ command }) => session.savePart(command),
    }),
    [
      handleBackToProjects,
      session,
      handleRedo,
      handleDuplicateSelection,
      handleRenameProject,
      handleResetRun,
      handleRunAll,
      handleRunScenario,
      handleSwitchBranch,
      handleUndo,
      activeViewId,
      applySelectionPlan,
      commandContext.selectedElementIds,
      document,
      mintId,
      openHistoryPanel,
      openLibraryPanel,
      historyController,
      publishController,
      placeSavedPart,
      repository,
      panelDispatch,
      handleApplyDraft,
      handleApplyScenarioDraft,
      handleCancelDraft,
      handleCancelScenarioDraft,
      handleCloseInspector,
      scenarioDraft?.draftId,
      persistDockConfig,
      runController,
      transferActions,
    ],
  );

  const runGuardedBranchCommand = React.useCallback(
    <K extends 'branch.create' | 'branch.reopen'>(
      id: K,
      payload: CommandHandlers[K] extends (arg: infer P) => unknown ? P : never,
    ): Promise<BranchActionOutcome> =>
      new Promise((resolve) => {
        const run = async () => {
          try {
            const result = await executeCommand(id, payload as never, commandContext, commandHandlers);
            if (result.status === 'disabled') {
              resolve({ status: 'failed', message: result.reason });
              return;
            }
            const value = result.value as { readonly status?: string } | null;
            if (value?.status === 'applied') {
              resolve({ status: 'done' });
            } else {
              resolve({
                status: 'failed',
                message: formatStudioError(value, id === 'branch.create' ? 'Could not create this branch' : 'Could not reopen this branch'),
              });
            }
          } catch {
            resolve({ status: 'failed', message: id === 'branch.create' ? 'Could not create this branch' : 'Could not reopen this branch' });
          }
        };
        runGuarded(
          () => void run(),
          () => resolve({ status: 'cancelled' }),
        );
      }),
    [commandContext, commandHandlers, runGuarded],
  );

  const createBranchDisabledReason = React.useMemo(() => {
    const availability = COMMAND_DEFINITIONS['branch.create'].availability(commandContext, {
      label: 'Branch',
      source: 'working',
    });
    return availability.enabled ? null : availability.reason;
  }, [commandContext]);

  const executeCanvasCommand = React.useCallback(
    <K extends CommandId>(id: K, payload: CommandPayloads[K]) => executeCommand(id, payload, commandContext, commandHandlers),
    [commandContext, commandHandlers],
  );

  // History panel buttons show the registry's reason instead of failing on click.
  const reasonOf = (availability: ReturnType<typeof getAvailability>) =>
    availability.enabled ? null : availability.reason;
  const commitBlockedReason = reasonOf(getAvailability('history.commit', commandContext, { message: '' }));
  const publishBlockedReason = reasonOf(getAvailability('history.prepare-publish', commandContext, {}));
  const partsBlockedReason = reasonOf(getPayloadFreeAvailability('part.import', commandContext));
  const captureBlockedReason = reasonOf(getPayloadFreeAvailability('part.capture', commandContext));

  const [historyNotice, setHistoryNotice] = React.useState<string | null>(null);
  // D40: main never holds edits. "Start a new draft" / "Edit main directly" on
  // published main both create a draft through branch.create (the same guarded
  // path as the branch popover) and switch to it. Main's working content is its
  // head, so 'head' and 'working' copy the same document; "Edit main directly"
  // uses 'working' to match the auto-draft-on-first-edit rule.
  const startDraftFromMain = React.useCallback(
    async (source: 'working' | 'head') => {
      setHistoryNotice(null);
      const taken = new Set(branches.map((branch) => branch.label));
      let label = 'Draft from main';
      for (let n = 2; taken.has(label); n += 1) label = `Draft from main ${n}`;
      const outcome = await runGuardedBranchCommand('branch.create', { label, source });
      if (outcome.status === 'failed') setHistoryNotice(outcome.message);
    },
    [branches, runGuardedBranchCommand],
  );
  const openPublishFlow = React.useCallback(async () => {
    setHistoryNotice(null);
    const result = await runCommand('history.prepare-publish', {});
    if (result.status === 'disabled') setHistoryNotice(result.reason);
  }, [runCommand]);

  const renderPanel = React.useCallback(
    (panelId: PanelId): React.ReactNode => {
      if (panelId === 'history') {
        if (historyView === 'commit') {
          return (
            <CommitPanel
              hosted
              controller={routedHistoryController}
              refreshToken={statusRefreshToken}
              onCancel={() => setHistoryView('ladder')}
              onRunScenario={(scenarioId) => void handleRunScenario(scenarioId)}
              onRunAll={() => void handleRunAll()}
            />
          );
        }
        return (
          <HistoryLadder
            hosted
            controller={routedHistoryController}
            canUndo={sessionState.canUndo && sessionState.status === 'ready'}
            canRedo={sessionState.canRedo && sessionState.status === 'ready'}
            onUndo={() => void handleUndo()}
            onRedo={() => void handleRedo()}
            onOpenCommit={() => setHistoryView('commit')}
            commitBlockedReason={commitBlockedReason}
            publishBlockedReason={publishBlockedReason}
            onOpenPublish={() => void openPublishFlow()}
            behindMain={
              behindMainInfo
                ? {
                    conflictCount: behindMainInfo.conflictCount,
                    versionsPublishedSinceFork: behindMainInfo.versionsPublishedSinceFork,
                  }
                : null
            }
            onReviewAndResolve={() => void openPublishFlow()}
            onStartDraft={() => void startDraftFromMain('head')}
            onEditMain={() => void startDraftFromMain('working')}
            onClose={() => void runCommand('history.close', {})}
          />
        );
      }
      return (
        <LibraryPanel
          hosted
          view={libraryView}
          onViewChange={setLibraryView}
          renderSavedParts={(searchQuery, view) => <SavedParts
            repository={repository} session={session} actor={actor} mintId={mintId}
            viewId={activeViewId} elementIds={[...selectedElementIds]} noteIds={[]}
            blockedReason={partsBlockedReason}
            captureBlockedReason={captureBlockedReason}
            execute={runCommand} searchQuery={searchQuery} view={view}
          />}
          onPlace={(entryId) => void canvasViewRef.current?.placeAtCentre(entryId)}
          onClose={() => void runCommand('library.close', {})}
        />
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      historyView,
      routedHistoryController,
      statusRefreshToken,
      commitBlockedReason,
      publishBlockedReason,
      openPublishFlow,
      startDraftFromMain,
      partsBlockedReason,
      captureBlockedReason,
      behindMainInfo,
      libraryView,
      panelDispatch,
      runCommand,
      refreshBehindMainCheck,
      sessionState.canUndo,
      sessionState.canRedo,
      sessionState.status,
      repository, session, actor, mintId, activeViewId, selectedElementIds,
    ],
  );

  React.useLayoutEffect(() => {
    commandRunnerRef.current = executeCanvasCommand;
  }, [executeCanvasCommand]);

  const panelCommandRoutes: PanelCommandRoutes = React.useMemo(
    () => ({
      place: (panelId, placement) => void runCommand('panel.place', { panelId, placement, index: 0 }),
      collapse: (panelId) => void runCommand('panel.collapse', { panelId }),
      expand: (panelId) => void runCommand('panel.expand', { panelId }),
      resetWidth: (panelId) => void runCommand('panel.reset-width', { panelId }),
      close: (panelId) => void runCommand(panelId === 'history' ? 'history.close' : 'library.close', {}),
    }),
    [runCommand],
  );

  const quickOptionGroups = React.useMemo(
    () => (quickOptionsOpen ? buildQuickOptions(commandContext) : []),
    [quickOptionsOpen, commandContext],
  );

  const handleQuickOption = React.useCallback(
    (option: QuickOption) => {
      void executeCommand(option.id, option.payload as never, commandContext, commandHandlers);
    },
    [commandContext, commandHandlers],
  );

  const handleQuickRename = React.useCallback(
    async (title: string): Promise<RenameOutcome> => {
      const result = await executeCommand('project.rename', { title }, commandContext, commandHandlers);
      if (result.status === 'disabled') return { ok: false, message: result.reason };
      const outcome = renameOutcome(result.value as SessionRenameResult);
      if (outcome.ok) setQuickOptionsOpen(false);
      return outcome;
    },
    [commandContext, commandHandlers],
  );

  const handleQuickTextCommand = React.useCallback(
    async (kind: TextStepKind, value: string): Promise<RenameOutcome> => {
      const result =
        kind === 'group'
          ? await executeCommand('selection.group', { label: value }, commandContext, commandHandlers)
          : kind === 'note'
            ? await executeCommand('canvas.add-note', { text: value }, commandContext, commandHandlers)
            : kind === 'checkpoint'
              ? await executeCommand('history.checkpoint', { label: value }, commandContext, commandHandlers)
              : await executeCommand('history.commit', { message: value }, commandContext, commandHandlers);
      if (result.status === 'disabled') return { ok: false, message: result.reason };
      let outcome: RenameOutcome;
      if (kind === 'checkpoint' || kind === 'commit') {
        // History commands return the controller's authored result.
        const authored = result.value as { readonly status?: string } | null;
        outcome =
          authored?.status === 'applied'
            ? { ok: true }
            : { ok: false, message: formatStudioError(authored, kind === 'commit' ? 'Could not commit' : 'Could not save the checkpoint') };
      } else {
        outcome = result.value as RenameOutcome;
      }
      if (outcome.ok) setQuickOptionsOpen(false);
      return outcome;
    },
    [commandContext, commandHandlers],
  );

  // Global shortcuts (Mod+Z, Mod+Shift+Z, F2) come from the registry; ignored
  // during IME composition, in editable fields and nested dialogs, and
  // preventDefault fires only after an enabled match (commands.md §1).
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const matched = runGlobalShortcut(
        {
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
          inEditableField: Boolean(
            target &&
              (target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT' ||
                target.isContentEditable),
          ),
          inDialog: Boolean(target?.closest('[role="dialog"], [role="alertdialog"]')),
        },
        IS_MAC,
        commandContext,
        commandHandlers,
      );
      if (matched) e.preventDefault();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandContext, commandHandlers]);

  // Canvas-scope shortcut (Delete/Backspace): CanvasView forwards key events
  // from canvas focus only; true means an enabled command matched.
  const handleCanvasShortcut = React.useCallback(
    (event: ShortcutEvent) =>
      runCanvasShortcut(event, IS_MAC, commandContext, commandHandlers) !== null,
    [commandContext, commandHandlers],
  );

  // Inspector / scenario editor buttons run the registry commands for the open draft.
  const inspectorApply = React.useCallback(() => {
    if (draftContext.id) void runCommand('inspector.apply', { draftId: draftContext.id });
  }, [draftContext.id, runCommand]);
  const inspectorCancel = React.useCallback(() => {
    if (draftContext.id) void runCommand('inspector.cancel', { draftId: draftContext.id });
  }, [draftContext.id, runCommand]);
  const inspectorClose = React.useCallback(() => {
    void runCommand('inspector.close', { draftId: draftContext.id });
  }, [draftContext.id, runCommand]);

  const quickOptionsShortcut = formatShortcut(COMMAND_DEFINITIONS['commands.open'].shortcut!, IS_MAC);
  const currentBranchLabel =
    commandContext.branches.find((branch) => branch.id === commandContext.branchId)?.label ?? '';

  // Escape closes an overlay first, never a dirty draft directly (commands.md §6).
  // The guard dialog is itself a shadcn Dialog and handles its own Escape (-> Stay).
  // With no overlay open, Escape on a clean inspector closes it; a dirty draft is
  // left untouched (Apply/Discard/Stay only).
  React.useEffect(() => {
    if (!draft && !scenarioDraft) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || guardOpen || quickOptionsOpen) return;
      if (!draft?.dirty && !scenarioDraft?.dirty && !scenarioDraft?.isNew) {
        e.preventDefault();
        void runCommand('inspector.close', { draftId: draftContext.id });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [draft, scenarioDraft, guardOpen, quickOptionsOpen, runCommand, draftContext.id]);

  return (
    <div
      data-testid="workspace-root"
      data-panel-preference-state={panelPreferenceState}
      data-dock-preference-state={dockPreferenceState}
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
          onCreateBranch={(label, source) =>
            runGuardedBranchCommand('branch.create', { label, source })
          }
          onReopenBranch={(branchId) =>
            runGuardedBranchCommand('branch.reopen', { branchId })
          }
          createBranchDisabledReason={createBranchDisabledReason}
          onAllProjects={handleBackToProjects}
          saveStatusText={saveStatusText}
          isSaving={isSaving}
          hasError={hasError}
          runControl={runControl ?? runControlSlot}
          transferActions={transferActions}
          onOpenHistory={openHistoryPanel}
          historyActive={panelState.panels.history.open}
          onOpenQuickOptions={() => void executeCommand('commands.open', {}, commandContext, commandHandlers)}
          quickOptionsShortcut={quickOptionsShortcut}
          quickOptionsActive={quickOptionsOpen}
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
              commands={panelCommandRoutes}
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
                    commandContext={commandContext}
                    onExecuteCommand={executeCanvasCommand}
                    onCanvasShortcut={handleCanvasShortcut}
                    dockConfig={dockConfig}
                    dockPreferenceState={dockPreferenceState}
                    onConfigureDock={(config) => void executeCommand('dock.configure', config, commandContext, commandHandlers)}
                    onRestoreDockDefaults={() => void executeCommand('dock.restore-defaults', {}, commandContext, commandHandlers)}
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
                        onReviewAndResolve={() => void openPublishFlow()}
                      />
                      {historyNotice && (
                        <p role="status" data-testid="history-command-notice" className="mt-1 rounded-control border border-control-border bg-panel px-3 py-1.5 text-xs text-secondary-text">
                          {historyNotice}
                        </p>
                      )}
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
              // 22D published is a non-modal notice (the canvas and History stay
              // usable); every other publish state is the modal review.
              className={
                publishControllerState.status === 'published'
                  ? 'pointer-events-none fixed inset-x-0 top-14 z-modal flex justify-center p-4'
                  : 'fixed inset-0 z-modal flex items-center justify-center bg-black/40 p-4'
              }
            >
              <div
                className={
                  publishControllerState.status === 'published'
                    ? 'pointer-events-auto w-full max-w-md rounded-panel border border-border bg-card p-3 shadow-lg'
                    : 'w-full max-w-2xl max-h-[85vh] overflow-hidden'
                }
              >
                <PublishFlow
                  controller={routedPublishController}
                  onClose={() => {
                    setPublishOpen(false);
                    if (publishController.getState().status === 'published') publishController.reset();
                  }}
                />
              </div>
            </div>
          )}

          {/* Results region sits below the canvas; explicit open can show its empty state. */}
          {showResultsRegion && (
            <div ref={resultsRegionRef} tabIndex={-1} aria-label="Results" className="outline-none">
            {runningOrSelectedScenario ? (
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
            ) : <section data-testid="results-empty" role="region" aria-label="Results" className="border-t border-border bg-panel p-4 text-sm text-secondary-text">No run selected yet.</section>}
            </div>
          )}
        </main>

        {/* RV-05b inspector: 320px right dock >= 768px (commands.md §7); a full-width
            bottom sheet below 768px, same content and guard. */}
        {draft && !isMobileInspector ? (
          <InspectorPanel
            draft={draft}
            measured={measuredSection}
            onChangeField={handleChangeField}
            onApply={inspectorApply}
            onCancel={inspectorCancel}
            onClose={inspectorClose}
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
              onApply={inspectorApply}
              onCancel={inspectorCancel}
              onClose={inspectorClose}
              mintId={mintId}
              lastRunChecks={scenarioEditorChecks}
              focusName={scenarioEditorFocusName}
            />
          </aside>
        ) : null}
      </div>

      {draft && isMobileInspector && panelState.activeOverlay !== 'library' && panelState.activeOverlay !== 'history' ? (
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
            onApply={inspectorApply}
            onCancel={inspectorCancel}
            onClose={inspectorClose}
            saving={draft.status === 'saving'}
            focusFieldId={focusFieldId}
            variant="sheet"
          />
        </div>
      ) : null}

      {scenarioDraft && document && isMobileInspector && panelState.activeOverlay !== 'library' && panelState.activeOverlay !== 'history' ? (
        <div
          data-testid="scenario-inspector-sheet-overlay"
          className="fixed inset-x-0 bottom-0 z-modal h-[70vh] max-h-[70vh] overflow-hidden shadow-md rounded-t-lg border-t border-control-border bg-panel"
        >
          <ScenarioEditor
            document={document}
            handle={scenarioDraft}
            onChange={handleChangeScenarioDraft}
            onApply={inspectorApply}
            onCancel={inspectorCancel}
            onClose={inspectorClose}
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

      <QuickOptionsDialog
        open={quickOptionsOpen}
        onOpenChange={setQuickOptionsOpen}
        groups={quickOptionGroups}
        projectTitle={projectRecord?.title ?? ''}
        branchLabel={currentBranchLabel}
        isMac={IS_MAC}
        onRun={handleQuickOption}
        onRename={handleQuickRename}
        onTextCommand={handleQuickTextCommand}
      />

      <Dialog
        open={duplicateDialog !== null}
        onOpenChange={(open) => {
          if (!open && !duplicateApplying) setDuplicateDialog(null);
        }}
      >
        <DialogContent
          data-testid={
            duplicateDialog?.kind === 'confirm'
              ? 'duplicate-confirm-dialog'
              : 'duplicate-error-dialog'
          }
          className="sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>
              {duplicateDialog?.kind === 'confirm'
                ? 'Duplicate this selection?'
                : 'Can’t duplicate selection'}
            </DialogTitle>
            <DialogDescription>
              {duplicateDialog?.kind === 'confirm'
                ? 'Some content crosses the selection boundary and will be left behind.'
                : 'The selection was not changed.'}
            </DialogDescription>
          </DialogHeader>
          {duplicateDialog?.kind === 'confirm' ? (
            <div className="space-y-3 text-sm text-ink">
              <ul className="list-disc space-y-1 pl-5">
                {duplicateDialog.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
              {duplicateDialog.warnings.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-secondary-text">Also note</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-secondary-text">
                    {duplicateDialog.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : duplicateDialog?.kind === 'error' ? (
            <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {duplicateDialog.messages.map((message) => <li key={message}>{message}</li>)}
            </ul>
          ) : null}
          <DialogFooter className="flex-row justify-end gap-2">
            {duplicateDialog?.kind === 'confirm' ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={duplicateApplying}
                  onClick={() => setDuplicateDialog(null)}
                >
                  Cancel
                </Button>
                <Button
                  data-testid="duplicate-confirm-btn"
                  type="button"
                  variant="tint"
                  disabled={duplicateApplying}
                  onClick={() => {
                    if (duplicateDialog.kind !== 'confirm') return;
                    const pending = duplicateDialog;
                    setDuplicateApplying(true);
                    void applyDuplicate(pending.content, pending.anchor).finally(() => {
                      setDuplicateApplying(false);
                    });
                  }}
                >
                  {duplicateApplying ? 'Duplicating…' : 'Duplicate'}
                </Button>
              </>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setDuplicateDialog(null)}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

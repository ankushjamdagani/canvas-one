/**
 * Workspace command registry, and the Quick options list built from it.
 *
 * - Every entry is `{id, label, keywords, group, iconKey, shortcut, availability}`
 *   and the definition table is exhaustive over `CommandId` (a mapped type), as
 *   is the handler table the caller supplies: keyboard, the Quick options dialog
 *   and every menu or button route through `executeCommand`, never menu-local
 *   handlers.
 * - Availability is `{enabled:true}` or `{enabled:false, reason, code}`; disabled
 *   commands show their reason.
 * - Shortcuts: edit.undo Mod+Z, edit.redo Mod+Shift+Z and commands.open F2 are
 *   global; selection.delete (Delete/Backspace) is canvas-scope, fed only by the
 *   canvas key handler. Both scopes ignore IME composition, editable fields and
 *   nested dialogs, and `preventDefault` follows an enabled match only.
 *
 * Registered here (each with a closed payload and shared availability):
 * - Selection and canvas: selection.delete/duplicate/group/ungroup/align/
 *   distribute, canvas.add-note, tools and zoom.
 * - Run: run.start/start-all/pause/resume/cancel/reset. run.cancel has no button
 *   of its own (the switcher offers Reset), so it is registry + Quick options.
 * - Panels and surfaces: library.open/close, history.open/close, results.open/
 *   close and panel.place/collapse/expand/reset-width (header menus, rail and
 *   close buttons execute these). panel.resize and panel.move-floating stay
 *   direct reducer gestures (RESIZE_SIDE/RESIZE_FLOAT, only COMMIT persists):
 *   routing every pointer or arrow-key step through the registry buys nothing,
 *   and no numeric-positioning menu exists yet to carry a menu variant.
 * - Inspector: inspector.apply/cancel/close for both the element inspector and
 *   the scenario editor; availability mirrors the open draft. inspector.open is
 *   not registered: it is a consequence of a guarded selection change (target
 *   and revision come from the canvas), not a user-invoked command.
 * - History: history.commit/restore/prepare-publish/resolve-conflict/
 *   publish. HistoryLadder, CommitPanel and PublishFlow receive controller
 *   facades (historyRouting.ts), so their existing buttons run these commands.
 *   Quick options lists commit (nested form), and publish review;
 *   restore and conflict resolution need a chosen target, so they live in the
 *   History panel. Payloads carry user input only; ids are minted by the
 *   controllers, as with branch.create.
 * - Saved parts: part.capture/place/export/import, executed by the Library's
 *   SavedParts. Their payloads wrap the bound branch/project command, so a retry
 *   reuses one operation id. They are not in Quick options (parts stay out of
 *   Quick options search).
 *
 * Not here: project.create and project.import (reachable only from the entry
 * screen, before any workspace exists), inspector.open, panel.resize,
 * panel.move-floating, canvas.expand/collapse (separate task), ⌘K/⌘R/⌘H/⌘B/⌘L,
 * single-letter shortcuts, Duplicate project and Project settings.
 */

import { CommandRegistry, type CommandMetadata, type PaletteCommandContribution } from '@canvas-one/commands';
import type { Id } from '../../../domain/studio/model';
import type { PanelId, Placement } from '../panels';
import type { ConflictResolution } from '../../../domain/versioning/resolve';
import type { PartContent } from '../../../domain/parts/types';
import type {
  PartCaptureCommand,
  PartImportCommand,
  PublicationMetadata,
} from '../../../persistence/studio';
import type { TransferExportKind } from '../../transfer';
import { readDockConfig, type DockConfig } from '../dockConfig';

// ============================================================================
// Ids, payloads, groups
// ============================================================================

export const COMMAND_IDS = [
  'commands.open',
  'agents.open',
  'project.rename',
  'project.switch',
  'branch.switch',
  'branch.create',
  'branch.reopen',
  'run.start',
  'run.start-all',
  'run.pause',
  'run.resume',
  'run.cancel',
  'run.reset',
  'history.open',
  'history.close',
  'history.commit',
  'history.restore',
  'history.prepare-publish',
  'history.resolve-conflict',
  'history.publish',
  'library.open',
  'library.close',
  'results.open',
  'results.close',
  'panel.place',
  'panel.collapse',
  'panel.expand',
  'panel.reset-width',
  'inspector.apply',
  'inspector.cancel',
  'inspector.close',
  'canvas.select-tool',
  'canvas.pan-tool',
  'canvas.zoom-out',
  'canvas.zoom-in',
  'canvas.fit',
  'dock.configure',
  'dock.restore-defaults',
  'export.png',
  'export.svg',
  'project.export-json',
  'export.csv',
  'export.mermaid',
  'edit.undo',
  'edit.redo',
  'selection.duplicate',
  'selection.delete',
  'selection.group',
  'selection.wrap-in-boundary',
  'selection.ungroup',
  'selection.align',
  'selection.distribute',
  'canvas.add-note',
  'part.capture',
  'part.place',
  'part.export',
  'part.import',
  'canvas.expand',
  'canvas.collapse',
  'selection.save-as-component',
  'selection.replace-part',
  'selection.add-probe',
  'history.show-changes',
  'selection.export',
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

type Empty = Record<string, never>;

/** Presentation only: flips Placement.expanded / Group.collapsed. */
export interface CanvasExpansionPayload {
  readonly viewId: Id;
  readonly target: { readonly kind: 'placement' | 'group'; readonly id: Id };
}

/** Closed payload per command (never JSON patches). */
export interface CommandPayloads {
  'commands.open': Empty;
  'agents.open': Empty;
  'project.rename': { readonly title: string };
  /** "All projects": leaves for the entry screen, where the project is chosen. */
  'project.switch': Empty;
  'branch.switch': { readonly branchId: Id };
  'branch.create': { readonly label: string; readonly source: 'working' | 'head' };
  'branch.reopen': { readonly branchId: Id };
  'run.start': { readonly scenarioId: Id };
  'run.start-all': Empty;
  'run.pause': Empty;
  'run.resume': Empty;
  'run.cancel': Empty;
  'run.reset': Empty;
  'history.open': Empty;
  'history.close': Empty;
  /** Ids are minted by the history controller; the payload carries only the user's input. */
  'history.commit': { readonly message: string };
  /** `targetId` is a checkpoint or snapshot id; `label` names the pre-restore checkpoint. */
  'history.restore': { readonly targetId: string; readonly label: string };
  'history.prepare-publish': Empty;
  'history.resolve-conflict': { readonly conflictId: Id; readonly resolution: ConflictResolution };
  'history.publish': { readonly metadata: PublicationMetadata; readonly keepSourceOpen: boolean };
  'library.open': Empty;
  'library.close': Empty;
  'results.open': Empty;
  'results.close': Empty;
  'panel.place': { readonly panelId: PanelId; readonly placement: Placement; readonly index: number };
  'panel.collapse': { readonly panelId: PanelId };
  'panel.expand': { readonly panelId: PanelId };
  'panel.reset-width': { readonly panelId: PanelId };
  'inspector.apply': { readonly draftId: Id };
  'inspector.cancel': { readonly draftId: Id };
  /** `null` = the inspector is already closed. */
  'inspector.close': { readonly draftId: Id | null };
  'canvas.select-tool': Empty;
  'canvas.pan-tool': Empty;
  'canvas.zoom-out': Empty;
  'canvas.zoom-in': Empty;
  'canvas.fit': Empty;
  'dock.configure': DockConfig;
  'dock.restore-defaults': Empty;
  'export.png': Empty;
  'export.svg': Empty;
  'project.export-json': Empty;
  'export.csv': Empty;
  'export.mermaid': Empty;
  'edit.undo': Empty;
  'edit.redo': Empty;
  'selection.duplicate': Empty;
  /** Current selection; the handler shows the dependency preview/confirmation (deletePlan.ts). */
  'selection.delete': Empty;
  'selection.group': { readonly label: string };
  'selection.wrap-in-boundary': {
    readonly viewId: Id;
    readonly elementIds: readonly Id[];
    readonly ownerElementId: Id;
    readonly refinementId: Id;
    readonly label: string;
  };
  'selection.ungroup': { readonly groupIds: readonly Id[] };
  'selection.align': {
    readonly edge: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
  };
  'selection.distribute': { readonly axis: 'x' | 'y' };
  'canvas.add-note': { readonly text: string };
  /** The bound branch envelope keeps the operation id, so a retry stays idempotent. */
  'part.capture': { readonly command: PartCaptureCommand };
  'part.place': { readonly content: PartContent; readonly label: string };
  'part.export': { readonly partId: Id; readonly revision: number; readonly label: string };
  'part.import': { readonly command: PartImportCommand };
  'canvas.expand': CanvasExpansionPayload;
  'canvas.collapse': CanvasExpansionPayload;
  // Selection-scoped overflow commands: invoked for the current canvas
  // selection like selection.duplicate/delete; handlers read the selection from context.
  /** Opens the replace dialog; the replacement applies as one model change on confirm. */
  /** Opens the Library's capture review for the selection, which then runs part.capture. */
  'selection.save-as-component': Empty;
  'selection.replace-part': Empty;
  'selection.add-probe': Empty;
  'history.show-changes': Empty;
  'selection.export': Empty;
}

export type CommandGroup = 'project' | 'branch' | 'run' | 'review' | 'export' | 'selection' | 'edit';

const COMMAND_GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
  project: 'Project',
  branch: 'Switch branch',
  run: 'Run',
  review: 'Review',
  export: 'Export',
  selection: 'Selection',
  edit: 'Edit',
};

export type CommandIconKey =
  | 'command'
  | 'rename'
  | 'projects'
  | 'branch'
  | 'main'
  | 'run'
  | 'run-all'
  | 'pause'
  | 'resume'
  | 'reset'
  | 'cancel'
  | 'apply'
  | 'close'
  | 'panel'
  | 'commit'
  | 'restore'
  | 'publish'
  | 'part'
  | 'history'
  | 'library'
  | 'image'
  | 'code'
  | 'json'
  | 'table'
  | 'diagram'
  | 'undo'
  | 'redo'
  | 'duplicate'
  | 'delete'
  | 'group'
  | 'boundary'
  | 'ungroup'
  | 'align'
  | 'distribute'
  | 'note'
  | 'results'
  | 'select'
  | 'pan'
  | 'zoom-out'
  | 'zoom-in'
  | 'fit'
  | 'dock';

export interface Shortcut {
  readonly key: string;
  /** Extra keys that trigger the same command (Delete also accepts Backspace). */
  readonly aliases?: readonly string[];
  readonly modifiers: readonly ('Mod' | 'Shift' | 'Alt')[];
  readonly scope: 'global' | 'canvas';
}

export type Availability =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: string; readonly code: AvailabilityCode };

export type AvailabilityCode =
  | 'busy'
  | 'no-project'
  | 'current'
  | 'invalid-branch'
  | 'run-active'
  | 'not-running'
  | 'not-paused'
  | 'nothing-to-reset'
  | 'not-ready'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'export-unavailable'
  | 'no-view'
  | 'invalid-selection'
  | 'not-open'
  | 'no-draft'
  | 'draft-open'
  | 'storage-failed'
  | 'main-branch'
  | 'no-commits'
  | 'no-conflicts'
  | 'limit';

// ============================================================================
// Context (read-only; built by the workspace from its state, never the DOM)
// ============================================================================

export type CommandRunPhase = 'idle' | 'compiling' | 'running' | 'paused' | 'saving' | 'done';

/** Open configuration draft state. */
export type CommandDraftState = 'clean' | 'dirty' | 'validating' | 'saving' | 'invalid' | 'stale';

export interface CommandPanelState {
  readonly open: boolean;
  readonly collapsed: boolean;
}

export type CommandPublishStatus =
  | 'idle'
  | 'preparing'
  | 'behind-main'
  | 'blocked'
  | 'review'
  | 'publishing'
  | 'published'
  | 'error';

export interface CommandPublishState {
  readonly status: CommandPublishStatus;
  readonly eligible: boolean;
  readonly conflictCount: number;
}

export interface CommandBranch {
  readonly id: Id;
  readonly label: string;
  readonly isMain: boolean;
  readonly closed: boolean;
}

export interface CommandContext {
  readonly projectId: Id | null;
  readonly projectTitle: string | null;
  readonly branchId: Id | null;
  readonly activeViewId: Id | null;
  readonly branches: readonly CommandBranch[];
  readonly storageState: 'ready' | 'saving' | 'failed';
  /** The open inspector/scenario draft, or `clean`/null when none is dirty or open. */
  readonly draftState: CommandDraftState;
  readonly draftId: Id | null;
  /** Library/History preference state. */
  /** The inspector entry is optional: it only exists on desktop, where it is a hosted panel. */
  readonly panels: Readonly<Record<'library' | 'history', CommandPanelState>> &
    Readonly<Partial<Record<'inspector' | 'comments', CommandPanelState>>>;
  /** True while the results region is on screen (a scenario is selected or results.open ran). */
  readonly resultsVisible: boolean;
  /** Commits on the current branch (prepare-publish needs a committed head). */
  readonly commitCount: number;
  /** The proactively prepared / open publish candidate. */
  readonly publish: CommandPublishState;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly selectedElementIds: readonly Id[];
  readonly selectedConnectionIds: readonly Id[];
  readonly selectedNoteIds?: readonly Id[];
  /** Exact presentation groups represented by the current element selection. */
  readonly selectedGroupIds: readonly Id[];
  readonly selectionWhollyUngrouped: boolean;
  /** True when any selected element already has a refinement owner. */
  readonly selectionHasRefinementMember: boolean;
  readonly activeViewGroupCount: number;
  readonly activeViewNoteCount: number;
  /** Active view's expanded flag per placement id / group id (groups: not collapsed). */
  readonly expansionState?: Readonly<Record<Id, boolean>>;
  /** Placement ids of the current element selection (for the single-placement toggle). */
  readonly selectedPlacementIds?: readonly Id[];
  /** Session-level reason Run is blocked (dirty draft, busy, reload needed). */
  readonly runBlockedReason: string | null;
  readonly runPhase: CommandRunPhase;
  /** True when a run result is on display (so Reset has something to clear). */
  readonly hasRunDisplay: boolean;
  readonly scenarioCount: number;
  readonly selectedScenario: {
    readonly id: Id;
    readonly label: string;
    readonly notReadyReason: string | null;
  } | null;
  /** First not-ready scenario's reason, or null when every scenario can run. */
  readonly runAllBlockedReason: string | null;
  readonly exportDisabledReasons: Readonly<Record<TransferExportKind, string | null>>;

  /** True if the single selected element owns or belongs to a refinement. */
  readonly selectionHasRefinement: boolean;
  /** True if the single selected element is in the active scenario's scope. */
  readonly selectedElementScenarioScope: boolean;
  /** True if the single selected element has at least one out port. */
  readonly selectedElementHasOutPort: boolean;
  /** Mode of the selected scenario. */
  readonly selectedScenarioMode: 'logical' | 'timed' | null;
}

// ============================================================================
// Definitions
// ============================================================================

export interface CommandDefinition<K extends CommandId = CommandId> {
  readonly id: K;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly group: CommandGroup;
  readonly iconKey: CommandIconKey;
  readonly shortcut: Shortcut | null;
  readonly availability: (ctx: CommandContext, payload: CommandPayloads[K]) => Availability;
}

const ENABLED: Availability = { enabled: true };

function disabled(code: AvailabilityCode, reason: string): Availability {
  return { enabled: false, code, reason };
}

function requireProject(ctx: CommandContext): Availability | null {
  return ctx.projectId ? null : disabled('no-project', 'No project is open');
}

function requireIdle(ctx: CommandContext): Availability | null {
  return ctx.storageState === 'saving' ? disabled('busy', 'Saving…') : null;
}

function requireActiveView(ctx: CommandContext): Availability | null {
  return ctx.activeViewId ? null : disabled('no-view', 'No canvas view is open');
}

function requirePanelOpen(ctx: CommandContext, panelId: PanelId): Availability | null {
  return ctx.panels[panelId]?.open ? null : disabled('not-open', 'Open the panel first');
}

function requireDraft(ctx: CommandContext, draftId: Id): Availability | null {
  return ctx.draftId !== null && ctx.draftId === draftId
    ? null
    : disabled('no-draft', 'No configuration is open');
}

function currentBranch(ctx: CommandContext): CommandBranch | undefined {
  return ctx.branches.find((branch) => branch.id === ctx.branchId);
}

function requireCleanDraft(ctx: CommandContext, action: string): Availability | null {
  return ctx.draftState === 'clean'
    ? null
    : disabled('draft-open', `Apply or Cancel configuration changes before ${action}.`);
}

function requirePartsDraft(ctx: CommandContext): Availability | null {
  return requireCleanDraft(ctx, 'using saved parts');
}

function requireStorageHealthy(ctx: CommandContext, action: string): Availability | null {
  return ctx.storageState === 'failed'
    ? disabled('storage-failed', `Changes could not be saved. Resolve the storage error before ${action}.`)
    : null;
}

function requireOpenBranch(ctx: CommandContext, action: string): Availability | null {
  return currentBranch(ctx)?.closed
    ? disabled('invalid-branch', `Reopen this branch before ${action}.`)
    : null;
}

const MAIN_COMMIT_REASON = 'Main never holds edits: edit main directly to create a draft';
const MAIN_RESTORE_REASON = 'Direct restore on main branch is rejected; main is changed only by publication';

function requireDraftBranch(ctx: CommandContext, reason: string): Availability | null {
  return currentBranch(ctx)?.isMain ? disabled('main-branch', reason) : null;
}

function isExecutionActive(phase: CommandRunPhase): boolean {
  return phase === 'compiling' || phase === 'running' || phase === 'paused' || phase === 'saving';
}

function exportAvailability(kind: TransferExportKind) {
  return (ctx: CommandContext): Availability => {
    const reason = ctx.exportDisabledReasons[kind];
    return reason ? disabled('export-unavailable', reason) : ENABLED;
  };
}

function expansionAvailability(mode: 'expand' | 'collapse') {
  return (ctx: CommandContext, payload: CanvasExpansionPayload): Availability => {
    const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
    if (blocked) return blocked;
    const expanded = payload.viewId === ctx.activeViewId ? ctx.expansionState?.[payload.target.id] : undefined;
    if (expanded === undefined) {
      return disabled('invalid-selection', 'Select one group or component to expand or collapse');
    }
    if (mode === 'expand' && expanded) return disabled('current', 'Already expanded');
    if (mode === 'collapse' && !expanded) return disabled('current', 'Already collapsed');
    return ENABLED;
  };
}

export const COMMAND_DEFINITIONS: { readonly [K in CommandId]: CommandDefinition<K> } = {
  'agents.open': {
    id: 'agents.open', label: 'Comments', keywords: ['AI', 'agent', 'collaboration', 'pair', 'proposals', 'conversation', 'comments'],
    group: 'review', iconKey: 'command', shortcut: null,
    availability: ctx => requireProject(ctx) ?? ENABLED,
  },
  'commands.open': {
    id: 'commands.open',
    label: 'Quick options',
    keywords: ['commands', 'search', 'actions'],
    group: 'project',
    iconKey: 'command',
    shortcut: { key: 'F2', modifiers: [], scope: 'global' },
    availability: (ctx) => requireProject(ctx) ?? ENABLED,
  },
  'project.rename': {
    id: 'project.rename',
    label: 'Rename project',
    keywords: ['title', 'name'],
    group: 'project',
    iconKey: 'rename',
    shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requireIdle(ctx) ?? ENABLED,
  },
  'project.switch': {
    id: 'project.switch',
    label: 'All projects',
    keywords: ['switch project', 'open project', 'projects'],
    group: 'project',
    iconKey: 'projects',
    shortcut: null,
    availability: (ctx) => requireIdle(ctx) ?? ENABLED,
  },
  'branch.switch': {
    id: 'branch.switch',
    label: 'Switch branch',
    keywords: ['branch', 'draft', 'main'],
    group: 'branch',
    iconKey: 'branch',
    shortcut: null,
    availability: (ctx, payload) => {
      const blocked = requireProject(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      if (payload.branchId === ctx.branchId) {
        return disabled('current', "You're on this branch");
      }
      const target = ctx.branches.find((branch) => branch.id === payload.branchId);
      if (target?.closed) {
        return disabled('invalid-branch', 'Reopen this branch before switching to it');
      }
      return ENABLED;
    },
  },
  'branch.create': {
    id: 'branch.create',
    label: 'Create branch',
    keywords: ['new branch', 'fork', 'draft', 'working copy'],
    group: 'branch',
    iconKey: 'branch',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      const current = ctx.branches.find((branch) => branch.id === ctx.branchId);
      if (!current || current.closed) {
        return disabled('invalid-branch', 'Reopen this branch before creating another branch');
      }
      return ctx.branches.length >= 100
        ? disabled('limit', 'This project already has 100 branches')
        : ENABLED;
    },
  },
  'branch.reopen': {
    id: 'branch.reopen',
    label: 'Reopen branch',
    keywords: ['closed', 'draft', 'continue'],
    group: 'branch',
    iconKey: 'branch',
    shortcut: null,
    availability: (ctx, payload) => {
      const blocked = requireProject(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      const branch = ctx.branches.find((candidate) => candidate.id === payload.branchId);
      if (!branch || branch.isMain || !branch.closed) {
        return disabled('invalid-branch', 'Only a closed draft branch can be reopened');
      }
      return ENABLED;
    },
  },
  'run.start': {
    id: 'run.start',
    label: 'Run scenario',
    keywords: ['run', 'simulate', 'simulation', 'scenario'],
    group: 'run',
    iconKey: 'run',
    shortcut: null,
    availability: (ctx, payload) => {
      const blocked = requireProject(ctx);
      if (blocked) return blocked;
      if (isExecutionActive(ctx.runPhase)) return disabled('run-active', 'A run is in progress');
      if (ctx.runBlockedReason) return disabled('busy', ctx.runBlockedReason);
      if (ctx.scenarioCount === 0) return disabled('not-ready', 'Add a scenario to run');
      if (!ctx.selectedScenario || ctx.selectedScenario.id !== payload.scenarioId) {
        return disabled('not-ready', 'Select a scenario to run');
      }
      if (ctx.selectedScenario.notReadyReason) {
        return disabled('not-ready', ctx.selectedScenario.notReadyReason);
      }
      return ENABLED;
    },
  },
  'run.start-all': {
    id: 'run.start-all',
    label: 'Run all scenarios',
    keywords: ['run', 'simulate', 'simulation', 'scenarios', 'all'],
    group: 'run',
    iconKey: 'run-all',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx);
      if (blocked) return blocked;
      if (isExecutionActive(ctx.runPhase)) return disabled('run-active', 'A run is in progress');
      if (ctx.runBlockedReason) return disabled('busy', ctx.runBlockedReason);
      if (ctx.scenarioCount === 0) return disabled('not-ready', 'Add a scenario to run');
      if (ctx.runAllBlockedReason) return disabled('not-ready', ctx.runAllBlockedReason);
      return ENABLED;
    },
  },
  'run.pause': {
    id: 'run.pause',
    label: 'Pause run',
    keywords: ['pause', 'stop'],
    group: 'run',
    iconKey: 'pause',
    shortcut: null,
    availability: (ctx) =>
      ctx.runPhase === 'running' ? ENABLED : disabled('not-running', 'No run is in progress'),
  },
  'run.resume': {
    id: 'run.resume',
    label: 'Resume run',
    keywords: ['resume', 'continue'],
    group: 'run',
    iconKey: 'resume',
    shortcut: null,
    availability: (ctx) =>
      ctx.runPhase === 'paused' ? ENABLED : disabled('not-paused', 'No run is paused'),
  },
  'run.cancel': {
    id: 'run.cancel',
    label: 'Cancel run',
    keywords: ['cancel', 'abort', 'stop'],
    group: 'run',
    iconKey: 'cancel',
    shortcut: null,
    availability: (ctx) =>
      ctx.runPhase === 'running' || ctx.runPhase === 'paused'
        ? ENABLED
        : disabled('not-running', 'No run is in progress'),
  },
  'run.reset': {
    id: 'run.reset',
    label: 'Reset run',
    keywords: ['reset', 'clear results'],
    group: 'run',
    iconKey: 'reset',
    shortcut: null,
    availability: (ctx) =>
      ctx.hasRunDisplay || isExecutionActive(ctx.runPhase)
        ? ENABLED
        : disabled('nothing-to-reset', 'No run to reset'),
  },
  'history.open': {
    id: 'history.open',
    label: 'Open history',
    keywords: ['history', 'commit', 'publish', 'versions'],
    group: 'review',
    iconKey: 'history',
    shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? ENABLED,
  },
  'history.commit': {
    id: 'history.commit',
    label: 'Commit changes…',
    keywords: ['commit', 'history', 'evidence'],
    group: 'review',
    iconKey: 'commit',
    shortcut: null,
    availability: (ctx) =>
      requireProject(ctx) ?? requireDraftBranch(ctx, MAIN_COMMIT_REASON) ?? requireIdle(ctx) ??
      requireStorageHealthy(ctx, 'committing') ??
      requireOpenBranch(ctx, 'committing') ??
      requireCleanDraft(ctx, 'committing') ?? ENABLED,
  },
  'history.restore': {
    id: 'history.restore',
    label: 'Restore version',
    keywords: ['restore', 'revert', 'history'],
    group: 'review',
    iconKey: 'restore',
    shortcut: null,
    availability: (ctx) =>
      requireProject(ctx) ?? requireDraftBranch(ctx, MAIN_RESTORE_REASON) ?? requireIdle(ctx) ??
      requireStorageHealthy(ctx, 'restoring') ??
      requireOpenBranch(ctx, 'restoring') ??
      requireCleanDraft(ctx, 'restoring') ?? ENABLED,
  },
  'history.prepare-publish': {
    id: 'history.prepare-publish',
    label: 'Publish to main…',
    keywords: ['publish', 'merge', 'main', 'review', 'history'],
    group: 'review',
    iconKey: 'publish',
    shortcut: null,
    availability: (ctx) => {
      const blocked =
        requireProject(ctx) ?? requireDraftBranch(ctx, MAIN_COMMIT_REASON) ?? requireIdle(ctx) ??
        requireStorageHealthy(ctx, 'publishing') ??
        requireOpenBranch(ctx, 'publishing') ??
        requireCleanDraft(ctx, 'publishing');
      if (blocked) return blocked;
      return ctx.commitCount > 0
        ? ENABLED
        : disabled('no-commits', 'Commit at least once before publishing');
    },
  },
  'history.resolve-conflict': {
    id: 'history.resolve-conflict',
    label: 'Resolve conflict',
    keywords: ['conflict', 'resolve', 'merge', 'publish'],
    group: 'review',
    iconKey: 'publish',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireIdle(ctx) ?? requireStorageHealthy(ctx, 'resolving conflicts');
      if (blocked) return blocked;
      if (ctx.publish.status !== 'review') {
        return disabled('not-ready', 'Prepare the publish review first');
      }
      return ctx.publish.conflictCount > 0
        ? ENABLED
        : disabled('no-conflicts', 'There are no conflicts to resolve');
    },
  },
  'history.publish': {
    id: 'history.publish',
    label: 'Publish',
    keywords: ['publish', 'main', 'release'],
    group: 'review',
    iconKey: 'publish',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireIdle(ctx) ?? requireStorageHealthy(ctx, 'publishing');
      if (blocked) return blocked;
      if (ctx.publish.status === 'publishing') return disabled('busy', 'Publishing…');
      if (ctx.publish.status !== 'review') return disabled('not-ready', 'Prepare the publish review first');
      if (ctx.publish.conflictCount > 0) {
        return disabled('not-ready', 'Resolve all conflicts before publishing');
      }
      return ctx.publish.eligible
        ? ENABLED
        : disabled('not-ready', 'Every scenario must pass on this version before publishing');
    },
  },
  'history.close': {
    id: 'history.close',
    label: 'Close history',
    keywords: ['history', 'close', 'hide'],
    group: 'review',
    iconKey: 'history',
    shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requirePanelOpen(ctx, 'history') ?? ENABLED,
  },
  'library.open': {
    id: 'library.open',
    label: 'Open library',
    keywords: ['library', 'components', 'add', 'catalog'],
    group: 'review',
    iconKey: 'library',
    shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? ENABLED,
  },
  'library.close': {
    id: 'library.close',
    label: 'Close library',
    keywords: ['library', 'close', 'hide'],
    group: 'review',
    iconKey: 'library',
    shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requirePanelOpen(ctx, 'library') ?? ENABLED,
  },
  'results.open': {
    id: 'results.open', label: 'Open results', keywords: ['results', 'run', 'output'],
    group: 'review', iconKey: 'results', shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? ENABLED,
  },
  'results.close': {
    id: 'results.close', label: 'Close results', keywords: ['results', 'close', 'hide'],
    group: 'review', iconKey: 'results', shortcut: null,
    availability: (ctx) =>
      requireProject(ctx) ?? (ctx.resultsVisible ? ENABLED : disabled('not-open', 'Results are not open')),
  },
  'panel.place': {
    id: 'panel.place', label: 'Move panel', keywords: ['panel', 'dock', 'float', 'left', 'right'],
    group: 'review', iconKey: 'panel', shortcut: null,
    availability: (ctx, payload) => requirePanelOpen(ctx, payload.panelId) ?? ENABLED,
  },
  'panel.collapse': {
    id: 'panel.collapse', label: 'Collapse panel', keywords: ['panel', 'collapse', 'rail'],
    group: 'review', iconKey: 'panel', shortcut: null,
    availability: (ctx, payload) =>
      requirePanelOpen(ctx, payload.panelId) ??
      (ctx.panels[payload.panelId]?.collapsed ? disabled('current', 'Panel is already collapsed') : ENABLED),
  },
  // Enabled for any open panel: layout-driven auto-collapse leaves the stored
  // `collapsed` flag false, and the rail still needs to expand it.
  'panel.expand': {
    id: 'panel.expand', label: 'Expand panel', keywords: ['panel', 'expand', 'rail'],
    group: 'review', iconKey: 'panel', shortcut: null,
    availability: (ctx, payload) => requirePanelOpen(ctx, payload.panelId) ?? ENABLED,
  },
  'panel.reset-width': {
    id: 'panel.reset-width', label: 'Reset panel width', keywords: ['panel', 'width', 'reset'],
    group: 'review', iconKey: 'panel', shortcut: null,
    availability: (ctx, payload) => requirePanelOpen(ctx, payload.panelId) ?? ENABLED,
  },
  'inspector.apply': {
    id: 'inspector.apply', label: 'Apply configuration', keywords: ['inspector', 'apply', 'save'],
    group: 'edit', iconKey: 'apply', shortcut: null,
    availability: (ctx, payload) => {
      const open = requireDraft(ctx, payload.draftId);
      if (open) return open;
      switch (ctx.draftState) {
        case 'clean': return disabled('no-draft', 'There are no changes to apply');
        case 'saving': return disabled('busy', 'Applying…');
        case 'invalid': return disabled('not-ready', 'Fix the highlighted fields before applying');
        case 'stale': return disabled('not-ready', 'This item changed elsewhere. Reload before applying');
        default: return ENABLED;
      }
    },
  },
  'inspector.cancel': {
    id: 'inspector.cancel', label: 'Cancel configuration changes', keywords: ['inspector', 'cancel', 'discard'],
    group: 'edit', iconKey: 'cancel', shortcut: null,
    availability: (ctx, payload) =>
      requireDraft(ctx, payload.draftId) ??
      (ctx.draftState === 'saving' ? disabled('busy', 'Applying…') : ENABLED),
  },
  'inspector.close': {
    id: 'inspector.close', label: 'Close inspector', keywords: ['inspector', 'close'],
    group: 'edit', iconKey: 'close', shortcut: null,
    // The navigation guard resolves a dirty draft (Apply / Discard / Stay) before closing.
    availability: (ctx, payload) =>
      payload.draftId === null ? ENABLED : (requireDraft(ctx, payload.draftId) ?? ENABLED),
  },
  'canvas.select-tool': {
    id: 'canvas.select-tool', label: 'Select tool', keywords: ['select', 'canvas'],
    group: 'edit', iconKey: 'select', shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requireActiveView(ctx) ?? ENABLED,
  },
  'canvas.pan-tool': {
    id: 'canvas.pan-tool', label: 'Pan tool', keywords: ['pan', 'canvas'],
    group: 'edit', iconKey: 'pan', shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requireActiveView(ctx) ?? ENABLED,
  },
  'canvas.zoom-out': {
    id: 'canvas.zoom-out', label: 'Zoom out', keywords: ['zoom', 'canvas'],
    group: 'edit', iconKey: 'zoom-out', shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requireActiveView(ctx) ?? ENABLED,
  },
  'canvas.zoom-in': {
    id: 'canvas.zoom-in', label: 'Zoom in', keywords: ['zoom', 'canvas'],
    group: 'edit', iconKey: 'zoom-in', shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requireActiveView(ctx) ?? ENABLED,
  },
  'canvas.fit': {
    id: 'canvas.fit', label: 'Fit view', keywords: ['fit', 'canvas', 'zoom'],
    group: 'edit', iconKey: 'fit', shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requireActiveView(ctx) ?? ENABLED,
  },
  'dock.configure': {
    id: 'dock.configure', label: 'Customize dock', keywords: ['dock', 'customize', 'reorder'],
    group: 'edit', iconKey: 'dock', shortcut: null,
    availability: (ctx, payload) => requireProject(ctx) ??
      (readDockConfig(payload) ? ENABLED : disabled('limit', 'Dock commands must contain the exact inventory')),
  },
  'dock.restore-defaults': {
    id: 'dock.restore-defaults', label: 'Restore dock defaults', keywords: ['dock', 'reset', 'defaults'],
    group: 'edit', iconKey: 'dock', shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? ENABLED,
  },
  'export.png': {
    id: 'export.png',
    label: 'Export diagram as PNG',
    keywords: ['export', 'download', 'image', 'png'],
    group: 'export',
    iconKey: 'image',
    shortcut: null,
    availability: exportAvailability('png'),
  },
  'export.svg': {
    id: 'export.svg',
    label: 'Export diagram as SVG',
    keywords: ['export', 'download', 'vector', 'svg'],
    group: 'export',
    iconKey: 'code',
    shortcut: null,
    availability: exportAvailability('svg'),
  },
  'project.export-json': {
    id: 'project.export-json',
    label: 'Export system as JSON',
    keywords: ['export', 'download', 'json', 'backup'],
    group: 'export',
    iconKey: 'json',
    shortcut: null,
    availability: exportAvailability('json'),
  },
  'export.csv': {
    id: 'export.csv',
    label: 'Export run results as CSV',
    keywords: ['export', 'download', 'csv', 'results'],
    group: 'export',
    iconKey: 'table',
    shortcut: null,
    availability: exportAvailability('csv'),
  },
  'export.mermaid': {
    id: 'export.mermaid',
    label: 'Export diagram as Mermaid',
    keywords: ['export', 'download', 'mermaid', 'mmd'],
    group: 'export',
    iconKey: 'diagram',
    shortcut: null,
    availability: exportAvailability('mermaid'),
  },
  'edit.undo': {
    id: 'edit.undo',
    label: 'Undo',
    keywords: ['undo', 'revert'],
    group: 'edit',
    iconKey: 'undo',
    shortcut: { key: 'z', modifiers: ['Mod'], scope: 'global' },
    availability: (ctx) =>
      requireIdle(ctx) ?? (ctx.canUndo ? ENABLED : disabled('nothing-to-undo', 'Nothing to undo')),
  },
  'edit.redo': {
    id: 'edit.redo',
    label: 'Redo',
    keywords: ['redo'],
    group: 'edit',
    iconKey: 'redo',
    shortcut: { key: 'z', modifiers: ['Mod', 'Shift'], scope: 'global' },
    availability: (ctx) =>
      requireIdle(ctx) ?? (ctx.canRedo ? ENABLED : disabled('nothing-to-redo', 'Nothing to redo')),
  },
  'selection.duplicate': {
    id: 'selection.duplicate',
    label: 'Duplicate selection',
    keywords: ['duplicate', 'copy', 'selection', 'parts'],
    group: 'selection',
    iconKey: 'duplicate',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      const count = ctx.selectedElementIds.length + (ctx.selectedNoteIds?.length ?? 0);
      return count > 0
        ? ENABLED
        : disabled('invalid-selection', 'Select at least 1 component to duplicate');
    },
  },
  'selection.delete': {
    id: 'selection.delete',
    label: 'Delete selection',
    keywords: ['delete', 'remove', 'selection', 'parts'],
    group: 'selection',
    iconKey: 'delete',
    // Canvas focus only: matched by the canvas key handler.
    shortcut: { key: 'Delete', aliases: ['Backspace'], modifiers: [], scope: 'canvas' },
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      const count =
        ctx.selectedElementIds.length +
        ctx.selectedConnectionIds.length +
        (ctx.selectedNoteIds?.length ?? 0);
      return count > 0
        ? ENABLED
        : disabled('invalid-selection', 'Select a component or connection to delete');
    },
  },
  'selection.group': {
    id: 'selection.group',
    label: 'Group…',
    keywords: ['group', 'selection', 'parts'],
    group: 'selection',
    iconKey: 'group',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      if (ctx.selectedElementIds.length === 0) {
        return disabled('invalid-selection', 'Select at least 1 component to group');
      }
      if (!ctx.selectionWhollyUngrouped) {
        return disabled('invalid-selection', 'Select only ungrouped components');
      }
      if (ctx.activeViewGroupCount >= 50) return disabled('limit', 'This view already has 50 groups');
      return ENABLED;
    },
  },
  'selection.wrap-in-boundary': {
    id: 'selection.wrap-in-boundary',
    label: 'Wrap in boundary…',
    keywords: ['wrap', 'boundary', 'refinement', 'selection', 'parts'],
    group: 'selection',
    iconKey: 'boundary',
    shortcut: null,
    availability: (ctx, payload) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      if (ctx.selectedElementIds.length === 0) {
        return disabled('invalid-selection', 'Select at least 1 component to wrap');
      }
      if (ctx.selectionHasRefinementMember) {
        return disabled('invalid-selection', 'A selected component already belongs to a refinement boundary');
      }
      if (payload.viewId !== ctx.activeViewId) {
        return disabled('invalid-selection', 'The selected view is no longer active');
      }
      const selected = [...ctx.selectedElementIds].sort();
      const requested = [...payload.elementIds].sort();
      if (selected.length !== requested.length || selected.some((id, index) => id !== requested[index])) {
        return disabled('invalid-selection', 'The selected components changed');
      }
      return ENABLED;
    },
  },
  'selection.ungroup': {
    id: 'selection.ungroup',
    label: 'Ungroup',
    keywords: ['ungroup', 'selection', 'parts'],
    group: 'selection',
    iconKey: 'ungroup',
    shortcut: null,
    availability: (ctx, payload) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      const groupIds = (payload as CommandPayloads['selection.ungroup'] | undefined)?.groupIds;
      if (groupIds && groupIds.length > 0) return ENABLED;
      return ctx.selectedGroupIds.length > 0
        ? ENABLED
        : disabled('invalid-selection', 'Select all parts in one group to ungroup');
    },
  },
  'selection.align': {
    id: 'selection.align',
    label: 'Align',
    keywords: ['align', 'selection', 'position'],
    group: 'selection',
    iconKey: 'align',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      const totalCount = ctx.selectedElementIds.length + (ctx.selectedNoteIds?.length ?? 0);
      return totalCount >= 2
        ? ENABLED
        : disabled('invalid-selection', 'Select at least 2 components to align');
    },
  },
  'selection.distribute': {
    id: 'selection.distribute',
    label: 'Distribute',
    keywords: ['distribute', 'space', 'selection', 'position'],
    group: 'selection',
    iconKey: 'distribute',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      const totalCount = ctx.selectedElementIds.length + (ctx.selectedNoteIds?.length ?? 0);
      return totalCount >= 3
        ? ENABLED
        : disabled('invalid-selection', 'Select at least 3 components to distribute');
    },
  },
  'canvas.add-note': {
    id: 'canvas.add-note',
    label: 'Add note…',
    keywords: ['note', 'canvas', 'annotation'],
    group: 'edit',
    iconKey: 'note',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      return ctx.activeViewNoteCount >= 50
        ? disabled('limit', 'This view already has 50 notes')
        : ENABLED;
    },
  },
  'part.capture': {
    id: 'part.capture',
    label: 'Save as component',
    keywords: ['part', 'component', 'library', 'capture', 'save'],
    group: 'selection',
    iconKey: 'part',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx) ?? requirePartsDraft(ctx);
      if (blocked) return blocked;
      return ctx.selectedElementIds.length > 0
        ? ENABLED
        : disabled('invalid-selection', 'Select one or more components first');
    },
  },
  'part.place': {
    id: 'part.place',
    label: 'Place saved component',
    keywords: ['part', 'component', 'library', 'place'],
    group: 'edit',
    iconKey: 'part',
    shortcut: null,
    availability: (ctx) =>
      requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx) ?? requirePartsDraft(ctx) ?? ENABLED,
  },
  'part.export': {
    id: 'part.export',
    label: 'Export saved component',
    keywords: ['part', 'component', 'library', 'export', 'download'],
    group: 'export',
    iconKey: 'part',
    shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? ENABLED,
  },
  'part.import': {
    id: 'part.import',
    label: 'Import saved component',
    keywords: ['part', 'component', 'library', 'import', 'upload'],
    group: 'edit',
    iconKey: 'part',
    shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? requireIdle(ctx) ?? requirePartsDraft(ctx) ?? ENABLED,
  },
  'canvas.expand': {
    id: 'canvas.expand',
    label: 'Expand',
    keywords: ['expand', 'canvas', 'group', 'component'],
    group: 'edit',
    iconKey: 'group',
    shortcut: null,
    availability: expansionAvailability('expand'),
  },
  'canvas.collapse': {
    id: 'canvas.collapse',
    label: 'Collapse',
    keywords: ['collapse', 'canvas', 'group', 'component'],
    group: 'edit',
    iconKey: 'group',
    shortcut: null,
    availability: expansionAvailability('collapse'),
  },
  'selection.save-as-component': {
    id: 'selection.save-as-component',
    label: 'Save as component',
    keywords: ['save', 'component', 'part', 'library', 'capture'],
    group: 'selection',
    iconKey: 'part',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx) ?? requirePartsDraft(ctx);
      if (blocked) return blocked;
      return ctx.selectedElementIds.length > 0
        ? ENABLED
        : disabled('invalid-selection', 'Select one or more components first');
    },
  },
  'selection.replace-part': {
    id: 'selection.replace-part',
    label: 'Replace part…',
    keywords: ['replace', 'swap', 'component', 'part'],
    group: 'selection',
    iconKey: 'part',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      if (ctx.selectedElementIds.length !== 1) {
        return disabled('invalid-selection', 'Select exactly one component to replace');
      }
      if (ctx.selectionHasRefinement) {
        return disabled('invalid-selection', 'Cannot replace a component that owns or belongs to a refinement');
      }
      return ENABLED;
    },
  },
  'selection.add-probe': {
    id: 'selection.add-probe',
    label: 'Add flow probe',
    keywords: ['probe', 'flow', 'check', 'assertion', 'scenario'],
    group: 'selection',
    iconKey: 'results',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
      if (ctx.selectedElementIds.length !== 1) {
        return disabled('invalid-selection', 'Select exactly one component to probe');
      }
      if (!ctx.selectedScenario || !ctx.selectedScenarioMode) {
        return disabled('not-ready', 'Select a scenario first');
      }
      if (!ctx.selectedElementScenarioScope) {
        return disabled('invalid-selection', 'This component is not in the scenario scope');
      }
      if (ctx.selectedScenarioMode === 'logical' && !ctx.selectedElementHasOutPort) {
        return disabled('invalid-selection', 'This component has no output port to probe');
      }
      return ENABLED;
    },
  },
  'history.show-changes': {
    id: 'history.show-changes',
    label: 'Changes on this part',
    keywords: ['history', 'changes', 'part', 'component'],
    group: 'review',
    iconKey: 'history',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx);
      if (blocked) return blocked;
      return ctx.selectedElementIds.length > 0
        ? ENABLED
        : disabled('invalid-selection', 'Select one or more components first');
    },
  },
  'selection.export': {
    id: 'selection.export',
    label: 'Export selection',
    keywords: ['export', 'download', 'part', 'component'],
    group: 'export',
    iconKey: 'part',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx) ?? requirePartsDraft(ctx);
      if (blocked) return blocked;
      return ctx.selectedElementIds.length > 0
        ? ENABLED
        : disabled('invalid-selection', 'Select one or more components first');
    },
  },
};

// ============================================================================
// Execution
// ============================================================================

/** Exhaustive over CommandId: the caller wires every command or the build fails. */
export type CommandHandlers = {
  readonly [K in CommandId]: (payload: CommandPayloads[K]) => unknown | Promise<unknown>;
};

export type ExecuteResult =
  | { readonly status: 'done'; readonly value: unknown }
  | { readonly status: 'disabled'; readonly reason: string; readonly code: AvailabilityCode };

export function getAvailability<K extends CommandId>(
  id: K,
  ctx: CommandContext,
  payload: CommandPayloads[K],
): Availability {
  return COMMAND_DEFINITIONS[id].availability(ctx, payload);
}

/**
 * Availability for commands whose payload only exists at submit time (the
 * saved-part buttons); these ignore their payload when deciding.
 */
export function getPayloadFreeAvailability(
  id:
    | 'part.capture'
    | 'part.place'
    | 'part.import'
    | 'selection.save-as-component'
    | 'selection.replace-part'
    | 'selection.add-probe'
    | 'history.show-changes'
    | 'selection.export',
  ctx: CommandContext,
): Availability {
  return (COMMAND_DEFINITIONS[id].availability as (ctx: CommandContext) => Availability)(ctx);
}

/**
 * Keyboard, Quick options and menus share this: availability is re-checked at
 * execution time, so a stale row can never run a disabled command.
 */
export async function executeCommand<K extends CommandId>(
  id: K,
  payload: CommandPayloads[K],
  ctx: CommandContext,
  handlers: CommandHandlers,
): Promise<ExecuteResult> {
  return workspaceRegistry(handlers).execute(id, payload, ctx) as Promise<ExecuteResult>;
}

// Each composed handler set owns its registry. The package supplies dispatch;
// this app supplies its feature actions, availability policies and presentation.
const workspaceRegistries = new WeakMap<CommandHandlers, CommandRegistry<CommandContext>>();
export function workspaceRegistry(handlers: CommandHandlers): CommandRegistry<CommandContext> {
  const existing = workspaceRegistries.get(handlers);
  if (existing) return existing;
  const registry = new CommandRegistry<CommandContext>();
  for (const id of COMMAND_IDS) {
    const definition = COMMAND_DEFINITIONS[id];
    const effect: CommandMetadata['effect'] = id.startsWith('run.') ? 'execution'
      : id.startsWith('export.') || id.includes('export') ? 'export'
      : id.startsWith('selection.') || id.startsWith('edit.') || id === 'canvas.add-note' ? 'document'
      : id.startsWith('project.') || id.startsWith('branch.') || id.startsWith('history.') ? 'session' : 'ui';
    registry.register<CommandPayloads[typeof id], unknown>({
      metadata: { id, label: definition.label, keywords: definition.keywords, effect },
      // Payloads here are internal typed feature invocations; external agent
      // input passes through schema-validated proposal tools before dispatch.
      validate: input => ({ valid: true, value: input as CommandPayloads[typeof id] }),
      availability: (context, input) => getAvailability(id, context, input),
      execute: input => (handlers[id] as (value: CommandPayloads[typeof id]) => unknown)(input),
    });
  }
  workspaceRegistries.set(handlers, registry);
  return registry;
}

// ============================================================================
// Shortcuts
// ============================================================================

export interface ShortcutEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
  /** Target is an input, textarea, select or contenteditable. */
  readonly inEditableField: boolean;
  /** A dialog (other than the page itself) currently holds focus. */
  readonly inDialog: boolean;
}

function matches(shortcut: Shortcut, event: ShortcutEvent, isMac: boolean): boolean {
  const wantsMod = shortcut.modifiers.includes('Mod');
  const wantsShift = shortcut.modifiers.includes('Shift');
  const wantsAlt = shortcut.modifiers.includes('Alt');
  const mod = isMac ? event.metaKey : event.ctrlKey;
  // The platform's other modifier (Ctrl on macOS, Meta elsewhere) is a mismatch.
  const otherMod = isMac ? event.ctrlKey : event.metaKey;
  if (mod !== wantsMod || otherMod) return false;
  if (event.shiftKey !== wantsShift || event.altKey !== wantsAlt) return false;
  const key = event.key.toLowerCase();
  return key === shortcut.key.toLowerCase() || (shortcut.aliases ?? []).some((alias) => alias.toLowerCase() === key);
}

function matchShortcut(scope: Shortcut['scope'], event: ShortcutEvent, isMac: boolean): CommandId | null {
  if (event.isComposing || event.inEditableField || event.inDialog) return null;
  for (const id of COMMAND_IDS) {
    const shortcut = COMMAND_DEFINITIONS[id].shortcut;
    if (shortcut && shortcut.scope === scope && matches(shortcut, event, isMac)) return id;
  }
  return null;
}

/**
 * Returns the global-scope command whose shortcut the event matches, or null.
 * Ignored during IME composition, in editable fields (native text undo stays
 * native) and inside nested dialogs.
 */
export function matchGlobalShortcut(event: ShortcutEvent, isMac: boolean): CommandId | null {
  if (!event.isComposing && !event.inEditableField && !event.inDialog &&
      matches({ key: 'k', modifiers: ['Mod'], scope: 'global' }, event, isMac)) return 'commands.open';
  return matchShortcut('global', event, isMac);
}

/** Canvas-scope match (Delete/Backspace); the caller only feeds canvas-focused key events. */
export function matchCanvasShortcut(event: ShortcutEvent, isMac: boolean): CommandId | null {
  return matchShortcut('canvas', event, isMac);
}

/** Commands that carry a shortcut; each takes the Empty payload. */
export type ShortcutCommandId = 'commands.open' | 'edit.undo' | 'edit.redo' | 'selection.delete';

function runShortcutCommand(
  id: CommandId | null,
  ctx: CommandContext,
  handlers: CommandHandlers,
): CommandId | null {
  if (!id) return null;
  const shortcutId = id as ShortcutCommandId;
  if (!getAvailability(shortcutId, ctx, {}).enabled) return null;
  void executeCommand(shortcutId, {}, ctx, handlers);
  return id;
}

/**
 * Keyboard entry point: matches the event, checks availability synchronously
 * and starts execution. Returns the command id when an *enabled* command
 * matched -- only then may the caller `preventDefault`.
 */
export function runGlobalShortcut(
  event: ShortcutEvent,
  isMac: boolean,
  ctx: CommandContext,
  handlers: CommandHandlers,
): CommandId | null {
  return runShortcutCommand(matchGlobalShortcut(event, isMac), ctx, handlers);
}

/** Same contract for canvas-scoped shortcuts, fed by the canvas key handler. */
export function runCanvasShortcut(
  event: ShortcutEvent,
  isMac: boolean,
  ctx: CommandContext,
  handlers: CommandHandlers,
): CommandId | null {
  return runShortcutCommand(matchCanvasShortcut(event, isMac), ctx, handlers);
}

/** Key hint from the registry, e.g. "⌘Z" / "Ctrl+Z", "⇧⌘Z" / "Ctrl+Shift+Z", "F2". */
export function formatShortcut(shortcut: Shortcut, isMac: boolean): string {
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  if (isMac) {
    const symbols = [
      shortcut.modifiers.includes('Alt') ? '⌥' : '',
      shortcut.modifiers.includes('Shift') ? '⇧' : '',
      shortcut.modifiers.includes('Mod') ? '⌘' : '',
    ].join('');
    return `${symbols}${key}`;
  }
  const names = [
    shortcut.modifiers.includes('Mod') ? 'Ctrl' : null,
    shortcut.modifiers.includes('Shift') ? 'Shift' : null,
    shortcut.modifiers.includes('Alt') ? 'Alt' : null,
  ].filter((name): name is string => name !== null);
  return [...names, key].join('+');
}

// ============================================================================
// Quick options
// ============================================================================

/** One selectable row: a command with its bound payload. */
export type BuiltinQuickOption = {
  [K in CommandId]: {
    /** Stable, unique row key (also the cmdk value). */
    readonly key: string;
    readonly id: K;
    readonly payload: CommandPayloads[K];
    readonly label: string;
    /** Secondary text beside the label (current title, scenario name). */
    readonly detail: string | null;
    readonly keywords: readonly string[];
    readonly iconKey: CommandIconKey;
    readonly badge: 'current' | 'main' | 'closed' | null;
    readonly shortcut: Shortcut | null;
    readonly availability: Availability;
  };
}[CommandId];
export type HostQuickOption = {
  readonly hostCommand: true;
  readonly key: string;
  readonly id: string;
  readonly payload: unknown;
  readonly label: string;
  readonly detail: string | null;
  readonly keywords: readonly string[];
  readonly iconKey: CommandIconKey;
  readonly badge: null;
  readonly shortcut: null;
  readonly availability: import('@canvas-one/commands').Availability;
};
export type QuickOption = BuiltinQuickOption | HostQuickOption;

/** Discovery comes from the active registry; contributed payloads are validated without execution. */
export function buildContributedQuickOptions(registry: CommandRegistry<CommandContext>, contributions: readonly PaletteCommandContribution<CommandContext>[], ctx: CommandContext): QuickOptionGroup | null {
  const definitions = new Map(contributions.map(item => [item.definition.metadata.id, item]));
  const options: HostQuickOption[] = registry.discover().flatMap(metadata => {
    const contribution = definitions.get(metadata.id);
    if (!contribution) return [];
    const input = contribution.palette?.input;
    const checked = contribution.palette ? contribution.definition.validate(input) : null;
    const availability = checked?.valid
      ? contribution.definition.availability(ctx, checked.value)
      : { enabled: false as const, code: 'unsupported-palette-input', reason: checked && !checked.valid ? checked.reason : 'This action requires a custom input form supplied by its host' };
    return [{hostCommand: true as const, key: `host:${metadata.id}`, id: metadata.id, payload: input, label: metadata.label,
      detail: metadata.description ?? null, keywords: metadata.keywords ?? [], iconKey: 'command' as const, badge: null,
      shortcut: null, availability}];
  });
  return options.length ? {group: 'edit', label: 'Extensions', options} : null;
}

export interface QuickOptionGroup {
  readonly group: CommandGroup;
  readonly label: string;
  readonly options: readonly QuickOption[];
}

function option<K extends CommandId>(
  id: K,
  payload: CommandPayloads[K],
  ctx: CommandContext,
  overrides: Partial<Pick<QuickOption, 'label' | 'detail' | 'iconKey' | 'badge'>> & {
    readonly key?: string;
    readonly keywords?: readonly string[];
  } = {},
): QuickOption {
  const def = COMMAND_DEFINITIONS[id];
  return {
    key: overrides.key ?? id,
    id,
    payload,
    label: overrides.label ?? def.label,
    detail: overrides.detail ?? null,
    keywords: [...def.keywords, ...(overrides.keywords ?? [])],
    iconKey: overrides.iconKey ?? def.iconKey,
    badge: overrides.badge ?? null,
    shortcut: def.shortcut,
    availability: def.availability(ctx, payload),
  } as QuickOption;
}

/**
 * The Quick options list plus canvas actions. The current
 * branch comes first in its group, then main, then the rest by label. Run pause/
 * resume/reset appear only while they apply, so the list isn't padded with
 * rows that are nearly always disabled.
 */
export function buildQuickOptions(ctx: CommandContext): readonly QuickOptionGroup[] {
  const project: QuickOption[] = [
    option('project.rename', { title: ctx.projectTitle ?? '' }, ctx, {
      detail: ctx.projectTitle,
    }),
    option('project.switch', {}, ctx),
  ];

  const branchOrder = [...ctx.branches].sort((a, b) => {
    const rank = (branch: CommandBranch) =>
      branch.id === ctx.branchId ? 0 : branch.isMain ? 1 : 2;
    return rank(a) - rank(b) || a.label.localeCompare(b.label);
  });
  const branch: QuickOption[] = branchOrder.map((b) =>
    option('branch.switch', { branchId: b.id }, ctx, {
      key: `branch.switch:${b.id}`,
      label: b.label,
      keywords: [b.label],
      iconKey: b.isMain ? 'main' : 'branch',
      badge: b.id === ctx.branchId ? 'current' : b.isMain ? 'main' : b.closed ? 'closed' : null,
    }),
  );

  const run: QuickOption[] = [];
  if (ctx.selectedScenario) {
    run.push(
      option('run.start', { scenarioId: ctx.selectedScenario.id }, ctx, {
        label: 'Run scenario',
        detail: ctx.selectedScenario.label,
        keywords: [ctx.selectedScenario.label],
      }),
    );
  }
  run.push(
    option('run.start-all', {}, ctx, {
      detail: ctx.scenarioCount > 0 ? `${ctx.scenarioCount}` : null,
    }),
  );
  if (ctx.runPhase === 'running') run.push(option('run.pause', {}, ctx));
  if (ctx.runPhase === 'paused') run.push(option('run.resume', {}, ctx));
  if (ctx.runPhase === 'running' || ctx.runPhase === 'paused') run.push(option('run.cancel', {}, ctx));
  if (ctx.hasRunDisplay || isExecutionActive(ctx.runPhase)) run.push(option('run.reset', {}, ctx));

  // Parameterized history actions open their nested form (commit
  // message) or the publish review; restore and conflict resolution need a chosen
  // target, so they stay in the History panel.
  const review: QuickOption[] = [
    option('agents.open', {}, ctx),
    option('history.open', {}, ctx),
    option('history.commit', { message: '' }, ctx),
    option('history.prepare-publish', {}, ctx),
    option('library.open', {}, ctx),
    option('results.open', {}, ctx),
  ];
  if (ctx.panels.history.open) review.push(option('history.close', {}, ctx));
  if (ctx.panels.library.open) review.push(option('library.close', {}, ctx));
  if (ctx.resultsVisible) review.push(option('results.close', {}, ctx));

  const exportGroup: QuickOption[] = [
    option('export.png', {}, ctx),
    option('export.svg', {}, ctx),
    option('project.export-json', {}, ctx),
    option('export.csv', {}, ctx),
    option('export.mermaid', {}, ctx),
  ];

  const hasSelection =
    ctx.selectedElementIds.length > 0 ||
    ctx.selectedConnectionIds.length > 0 ||
    ctx.selectedGroupIds.length > 0;
  const selection: QuickOption[] = hasSelection
    ? [
        option('selection.duplicate', {}, ctx),
        option('selection.delete', {}, ctx),
        option('selection.group', { label: '' }, ctx),
        option('selection.ungroup', { groupIds: ctx.selectedGroupIds }, ctx),
        option('selection.align', { edge: 'left' }, ctx, { key: 'selection.align:left', label: 'Align left' }),
        option('selection.align', { edge: 'center-x' }, ctx, { key: 'selection.align:center-x', label: 'Align center horizontally' }),
        option('selection.align', { edge: 'right' }, ctx, { key: 'selection.align:right', label: 'Align right' }),
        option('selection.align', { edge: 'top' }, ctx, { key: 'selection.align:top', label: 'Align top' }),
        option('selection.align', { edge: 'center-y' }, ctx, { key: 'selection.align:center-y', label: 'Align center vertically' }),
        option('selection.align', { edge: 'bottom' }, ctx, { key: 'selection.align:bottom', label: 'Align bottom' }),
        option('selection.distribute', { axis: 'x' }, ctx, { key: 'selection.distribute:x', label: 'Distribute horizontally' }),
        option('selection.distribute', { axis: 'y' }, ctx, { key: 'selection.distribute:y', label: 'Distribute vertically' }),
      ]
    : [];

  const edit: QuickOption[] = [
    option('canvas.select-tool', {}, ctx),
    option('canvas.pan-tool', {}, ctx),
    option('canvas.add-note', { text: '' }, ctx),
    option('edit.undo', {}, ctx),
    option('edit.redo', {}, ctx),
    option('canvas.zoom-out', {}, ctx),
    option('canvas.zoom-in', {}, ctx),
    option('canvas.fit', {}, ctx),
    option('dock.restore-defaults', {}, ctx),
  ];

  const groups: QuickOptionGroup[] = [
    { group: 'project', label: COMMAND_GROUP_LABELS.project, options: project },
    { group: 'branch', label: COMMAND_GROUP_LABELS.branch, options: branch },
    { group: 'run', label: COMMAND_GROUP_LABELS.run, options: run },
    { group: 'review', label: COMMAND_GROUP_LABELS.review, options: review },
    { group: 'export', label: COMMAND_GROUP_LABELS.export, options: exportGroup },
    { group: 'selection', label: COMMAND_GROUP_LABELS.selection, options: selection },
    { group: 'edit', label: COMMAND_GROUP_LABELS.edit, options: edit },
  ];
  return groups.filter((g) => g.options.length > 0);
}

// ============================================================================
// Rename (nested in Quick options)
// ============================================================================

const PROJECT_TITLE_MAX_LENGTH = 80;

export type ProjectTitleCheck =
  | { readonly ok: true; readonly title: string }
  | { readonly ok: false; readonly reason: string };

/** Same bounds as the top-bar rename (1–80 characters after trimming). */
export function checkProjectTitle(raw: string, currentTitle: string | null): ProjectTitleCheck {
  const title = raw.trim();
  if (title.length === 0) return { ok: false, reason: 'Enter a project name' };
  if (title.length > PROJECT_TITLE_MAX_LENGTH) {
    return { ok: false, reason: `Use ${PROJECT_TITLE_MAX_LENGTH} characters or fewer` };
  }
  if (title === currentTitle) return { ok: false, reason: 'That is the current name' };
  return { ok: true, title };
}

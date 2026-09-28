/**
 * Workspace command registry (RV-03q).
 *
 * Implements specs/revamp/contracts/commands.md §1 ("Registry", "Shortcuts") for
 * the commands the new app already wires, and the 14A Quick options list
 * (specs/revamp/screens/14A_Quick_options_open.png) built from it.
 *
 * - Every entry is `{id, label, keywords, group, iconKey, shortcut, availability}`
 *   and the definition table is exhaustive over `CommandId` (a mapped type), as
 *   is the handler table the caller supplies: keyboard, the Quick options dialog
 *   and any menu route through `executeCommand`, never menu-local handlers.
 * - Availability is `{enabled:true}` or `{enabled:false, reason, code}`; disabled
 *   commands show their reason.
 * - Shortcuts: only edit.undo Mod+Z, edit.redo Mod+Shift+Z and commands.open F2
 *   are global. selection.delete (Delete/Backspace, canvas scope) stays with the
 *   canvas until selection commands join the registry.
 *
 * Not here (design-revalidation.md §2 / commands.md §1): ⌘K/⌘R/⌘H/⌘B/⌘L,
 * single-letter shortcuts, Duplicate project, Project settings, New branch.
 * Commands the app doesn't wire yet (parts, remaining canvas tools, dock
 * configuration, branch create/reopen) are absent rather than fake entries.
 */

import type { Id } from '../../../domain/studio/model';
import type { TransferExportKind } from '../../transfer';

// ============================================================================
// Ids, payloads, groups
// ============================================================================

export const COMMAND_IDS = [
  'commands.open',
  'project.rename',
  'project.switch',
  'branch.switch',
  'run.start',
  'run.start-all',
  'run.pause',
  'run.resume',
  'run.reset',
  'history.open',
  'library.open',
  'export.png',
  'export.svg',
  'project.export-json',
  'export.csv',
  'export.mermaid',
  'edit.undo',
  'edit.redo',
  'selection.group',
  'selection.ungroup',
  'selection.align',
  'selection.distribute',
  'canvas.add-note',
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

type Empty = Record<string, never>;

/** Closed payload per command (commands.md §2: never JSON patches). */
export interface CommandPayloads {
  'commands.open': Empty;
  'project.rename': { readonly title: string };
  /** "All projects": leaves for the entry screen, where the project is chosen. */
  'project.switch': Empty;
  'branch.switch': { readonly branchId: Id };
  'run.start': { readonly scenarioId: Id };
  'run.start-all': Empty;
  'run.pause': Empty;
  'run.resume': Empty;
  'run.reset': Empty;
  'history.open': Empty;
  'library.open': Empty;
  'export.png': Empty;
  'export.svg': Empty;
  'project.export-json': Empty;
  'export.csv': Empty;
  'export.mermaid': Empty;
  'edit.undo': Empty;
  'edit.redo': Empty;
  'selection.group': { readonly label: string };
  'selection.ungroup': { readonly groupIds: readonly Id[] };
  'selection.align': {
    readonly edge: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
  };
  'selection.distribute': { readonly axis: 'x' | 'y' };
  'canvas.add-note': { readonly text: string };
}

export type CommandGroup = 'project' | 'branch' | 'run' | 'review' | 'export' | 'selection' | 'edit';

export const COMMAND_GROUP_LABELS: Readonly<Record<CommandGroup, string>> = {
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
  | 'history'
  | 'library'
  | 'image'
  | 'code'
  | 'json'
  | 'table'
  | 'diagram'
  | 'undo'
  | 'redo'
  | 'group'
  | 'ungroup'
  | 'align'
  | 'distribute'
  | 'note';

export interface Shortcut {
  readonly key: string;
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
  | 'limit';

// ============================================================================
// Context (read-only; built by the workspace from its state, never the DOM)
// ============================================================================

export type CommandRunPhase = 'idle' | 'compiling' | 'running' | 'paused' | 'saving' | 'done';

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
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly selectedElementIds: readonly Id[];
  readonly selectedConnectionIds: readonly Id[];
  /** Exact presentation groups represented by the current element selection. */
  readonly selectedGroupIds: readonly Id[];
  readonly selectionWhollyUngrouped: boolean;
  readonly activeViewGroupCount: number;
  readonly activeViewNoteCount: number;
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

function isExecutionActive(phase: CommandRunPhase): boolean {
  return phase === 'compiling' || phase === 'running' || phase === 'paused' || phase === 'saving';
}

function exportAvailability(kind: TransferExportKind) {
  return (ctx: CommandContext): Availability => {
    const reason = ctx.exportDisabledReasons[kind];
    return reason ? disabled('export-unavailable', reason) : ENABLED;
  };
}

export const COMMAND_DEFINITIONS: { readonly [K in CommandId]: CommandDefinition<K> } = {
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
    keywords: ['history', 'checkpoint', 'commit', 'publish', 'versions'],
    group: 'review',
    iconKey: 'history',
    shortcut: null,
    availability: (ctx) => requireProject(ctx) ?? ENABLED,
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
  'selection.ungroup': {
    id: 'selection.ungroup',
    label: 'Ungroup',
    keywords: ['ungroup', 'selection', 'parts'],
    group: 'selection',
    iconKey: 'ungroup',
    shortcut: null,
    availability: (ctx) => {
      const blocked = requireProject(ctx) ?? requireActiveView(ctx) ?? requireIdle(ctx);
      if (blocked) return blocked;
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
      return ctx.selectedElementIds.length >= 2
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
      return ctx.selectedElementIds.length >= 3
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
 * Keyboard, Quick options and menus share this: availability is re-checked at
 * execution time, so a stale row can never run a disabled command.
 */
export async function executeCommand<K extends CommandId>(
  id: K,
  payload: CommandPayloads[K],
  ctx: CommandContext,
  handlers: CommandHandlers,
): Promise<ExecuteResult> {
  const availability = getAvailability(id, ctx, payload);
  if (!availability.enabled) {
    return { status: 'disabled', reason: availability.reason, code: availability.code };
  }
  const handler = handlers[id] as (payload: CommandPayloads[K]) => unknown | Promise<unknown>;
  const value = await handler(payload);
  return { status: 'done', value };
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
  return event.key.toLowerCase() === shortcut.key.toLowerCase();
}

/**
 * Returns the global-scope command whose shortcut the event matches, or null.
 * Ignored during IME composition, in editable fields (native text undo stays
 * native) and inside nested dialogs.
 */
export function matchGlobalShortcut(event: ShortcutEvent, isMac: boolean): CommandId | null {
  if (event.isComposing || event.inEditableField || event.inDialog) return null;
  for (const id of COMMAND_IDS) {
    const shortcut = COMMAND_DEFINITIONS[id].shortcut;
    if (shortcut && shortcut.scope === 'global' && matches(shortcut, event, isMac)) return id;
  }
  return null;
}

/** Commands that carry a shortcut; each takes the Empty payload. */
export type ShortcutCommandId = 'commands.open' | 'edit.undo' | 'edit.redo';

/**
 * Keyboard entry point: matches the event, checks availability synchronously
 * and starts execution. Returns the command id when an *enabled* command
 * matched -- only then may the caller `preventDefault` (commands.md §1).
 */
export function runGlobalShortcut(
  event: ShortcutEvent,
  isMac: boolean,
  ctx: CommandContext,
  handlers: CommandHandlers,
): CommandId | null {
  const id = matchGlobalShortcut(event, isMac) as ShortcutCommandId | null;
  if (!id) return null;
  if (!getAvailability(id, ctx, {}).enabled) return null;
  void executeCommand(id, {}, ctx, handlers);
  return id;
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
// Quick options (14A)
// ============================================================================

/** One selectable row: a command with its bound payload. */
export type QuickOption = {
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
 * The 14A list plus contracted canvas actions. The current
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
  if (ctx.hasRunDisplay || isExecutionActive(ctx.runPhase)) run.push(option('run.reset', {}, ctx));

  const review: QuickOption[] = [option('history.open', {}, ctx), option('library.open', {}, ctx)];

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
    option('canvas.add-note', { text: '' }, ctx),
    option('edit.undo', {}, ctx),
    option('edit.redo', {}, ctx),
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

export const PROJECT_TITLE_MAX_LENGTH = 80;

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

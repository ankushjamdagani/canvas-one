/**
 * RV-03q command registry: exhaustiveness, availability, shortcut matching and
 * the 14A Quick options list (commands.md §1, design-revalidation.md §2).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildQuickOptions,
  checkProjectTitle,
  COMMAND_DEFINITIONS,
  COMMAND_IDS,
  executeCommand,
  formatShortcut,
  getAvailability,
  matchCanvasShortcut,
  matchGlobalShortcut,
  runCanvasShortcut,
  runGlobalShortcut,
  type CommandContext,
  type CommandHandlers,
  type ShortcutEvent,
} from './registry';
import { DEFAULT_DOCK_CONFIG } from '../dockConfig';

const MAIN = 'b0000000-0000-4000-8000-000000000001';
const DRAFT = 'b0000000-0000-4000-8000-000000000002';
const OTHER = 'b0000000-0000-4000-8000-000000000003';
const SCENARIO = 'c0000000-0000-4000-8000-000000000001';

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    projectId: 'a0000000-0000-4000-8000-000000000001',
    projectTitle: 'Checkout path',
    branchId: DRAFT,
    activeViewId: 'd0000000-0000-4000-8000-000000000001',
    branches: [
      { id: MAIN, label: 'main', isMain: true, closed: false },
      { id: OTHER, label: 'retry-envelope', isMain: false, closed: true },
      { id: DRAFT, label: 'async-fulfilment', isMain: false, closed: false },
    ],
    storageState: 'ready',
    draftState: 'clean',
    draftId: null,
    panels: { library: { open: false, collapsed: false }, history: { open: false, collapsed: false } },
    resultsVisible: false,
    canUndo: true,
    canRedo: false,
    selectedElementIds: [],
    selectedConnectionIds: [],
    selectedGroupIds: [],
    selectionWhollyUngrouped: false,
    activeViewGroupCount: 0,
    activeViewNoteCount: 0,
    runBlockedReason: null,
    runPhase: 'idle',
    hasRunDisplay: false,
    scenarioCount: 1,
    selectedScenario: { id: SCENARIO, label: 'Peak checkout', notReadyReason: null },
    runAllBlockedReason: null,
    exportDisabledReasons: { png: null, svg: null, json: null, csv: 'Run a scenario first', mermaid: null },
    ...overrides,
  };
}

function makeHandlers(): CommandHandlers {
  return Object.fromEntries(COMMAND_IDS.map((id) => [id, vi.fn()])) as unknown as CommandHandlers;
}

describe('dock command availability', () => {
  it('validates the closed configuration and selection-aware group action', () => {
    const context = makeContext();
    expect(getAvailability('dock.configure', context, DEFAULT_DOCK_CONFIG)).toEqual({ enabled: true });
    expect(getAvailability('dock.configure', context, { orderedCommandIds: ['canvas.fit'], hiddenCommandIds: [] })).toMatchObject({ enabled: false });
    expect(getAvailability('selection.group', context, { label: 'Group' })).toMatchObject({ enabled: false, code: 'invalid-selection' });
    expect(getAvailability('canvas.zoom-in', context, {})).toEqual({ enabled: true });
  });
});

function keyEvent(overrides: Partial<ShortcutEvent>): ShortcutEvent {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    inEditableField: false,
    inDialog: false,
    ...overrides,
  };
}

describe('registry shape', () => {
  it('defines every CommandId exactly once under its own id', () => {
    expect(Object.keys(COMMAND_DEFINITIONS).sort()).toEqual([...COMMAND_IDS].sort());
    for (const id of COMMAND_IDS) expect(COMMAND_DEFINITIONS[id].id).toBe(id);
  });

  it('has only the contracted shortcuts, unique per scope, no single letters', () => {
    const withShortcut = COMMAND_IDS.filter((id) => COMMAND_DEFINITIONS[id].shortcut);
    expect(withShortcut.sort()).toEqual(['commands.open', 'edit.redo', 'edit.undo', 'selection.delete']);
    const signatures = withShortcut.map((id) => {
      const s = COMMAND_DEFINITIONS[id].shortcut!;
      return [s.key, ...(s.aliases ?? [])].map(
        (key) => `${s.scope}:${[...s.modifiers].sort().join('+')}:${key.toLowerCase()}`,
      );
    }).flat();
    expect(new Set(signatures).size).toBe(signatures.length);
    for (const id of withShortcut) {
      const s = COMMAND_DEFINITIONS[id].shortcut!;
      if (s.key.length === 1) expect(s.modifiers).toContain('Mod');
    }
  });

  it('includes no excluded or uncontracted entries', () => {
    const labels = COMMAND_IDS.map((id) => COMMAND_DEFINITIONS[id].label.toLowerCase());
    for (const excluded of ['duplicate project', 'project settings', 'share']) {
      expect(labels.some((label) => label.includes(excluded))).toBe(false);
    }
  });
});

describe('availability', () => {
  it('disables undo/redo by stack state and while saving', () => {
    const ctx = makeContext();
    expect(getAvailability('edit.undo', ctx, {})).toEqual({ enabled: true });
    expect(getAvailability('edit.redo', ctx, {})).toMatchObject({ enabled: false, reason: 'Nothing to redo' });
    expect(getAvailability('edit.undo', makeContext({ storageState: 'saving' }), {})).toMatchObject({
      enabled: false,
      code: 'busy',
    });
  });

  it('marks the current branch as not switchable', () => {
    const ctx = makeContext();
    expect(getAvailability('branch.switch', ctx, { branchId: DRAFT })).toMatchObject({
      enabled: false,
      code: 'current',
    });
    expect(getAvailability('branch.switch', ctx, { branchId: MAIN })).toEqual({ enabled: true });
    expect(getAvailability('branch.switch', ctx, { branchId: OTHER })).toMatchObject({
      enabled: false,
      code: 'invalid-branch',
      reason: 'Reopen this branch before switching to it',
    });
  });

  it('gives run.start the session reason first, then scenario readiness', () => {
    expect(
      getAvailability('run.start', makeContext({ runBlockedReason: 'Apply or cancel your changes to run' }), {
        scenarioId: SCENARIO,
      }),
    ).toMatchObject({ enabled: false, reason: 'Apply or cancel your changes to run' });
    expect(
      getAvailability(
        'run.start',
        makeContext({ selectedScenario: { id: SCENARIO, label: 'Peak', notReadyReason: 'Add a source' } }),
        { scenarioId: SCENARIO },
      ),
    ).toMatchObject({ enabled: false, reason: 'Add a source' });
    expect(getAvailability('run.start', makeContext({ runPhase: 'running' }), { scenarioId: SCENARIO })).toMatchObject({
      enabled: false,
      code: 'run-active',
    });
    expect(getAvailability('run.start', makeContext(), { scenarioId: 'stale-id' })).toMatchObject({
      enabled: false,
    });
  });

  it('passes export reasons through verbatim', () => {
    expect(getAvailability('export.csv', makeContext(), {})).toMatchObject({
      enabled: false,
      reason: 'Run a scenario first',
    });
    expect(getAvailability('export.png', makeContext(), {})).toEqual({ enabled: true });
  });

  it('enforces selection counts, grouping facts, limits and saving state', () => {
    expect(getAvailability('selection.duplicate', makeContext(), {})).toMatchObject({
      enabled: false,
      reason: 'Select at least 1 component to duplicate',
    });
    expect(
      getAvailability('selection.duplicate', makeContext({ selectedElementIds: ['a'] }), {}),
    ).toEqual({ enabled: true });
    expect(getAvailability('selection.group', makeContext(), { label: '' })).toMatchObject({
      enabled: false,
      reason: 'Select at least 1 component to group',
    });
    expect(
      getAvailability(
        'selection.group',
        makeContext({ selectedElementIds: ['a'], selectionWhollyUngrouped: false }),
        { label: '' },
      ),
    ).toMatchObject({ enabled: false, reason: 'Select only ungrouped components' });
    expect(
      getAvailability(
        'selection.group',
        makeContext({ selectedElementIds: ['a'], selectionWhollyUngrouped: true }),
        { label: '' },
      ),
    ).toEqual({ enabled: true });
    expect(
      getAvailability('selection.ungroup', makeContext({ selectedGroupIds: ['g'] }), { groupIds: ['g'] }),
    ).toEqual({ enabled: true });
    expect(getAvailability('selection.align', makeContext({ selectedElementIds: ['a'] }), { edge: 'left' }))
      .toMatchObject({ enabled: false, reason: 'Select at least 2 components to align' });
    expect(
      getAvailability('selection.align', makeContext({ selectedElementIds: ['a', 'b'] }), { edge: 'left' }),
    ).toEqual({ enabled: true });
    expect(
      getAvailability('selection.distribute', makeContext({ selectedElementIds: ['a', 'b'] }), { axis: 'x' }),
    ).toMatchObject({ enabled: false, reason: 'Select at least 3 components to distribute' });
    expect(getAvailability('canvas.add-note', makeContext({ activeViewNoteCount: 50 }), { text: '' }))
      .toMatchObject({ enabled: false, code: 'limit' });
    expect(
      getAvailability(
        'selection.align',
        makeContext({ selectedElementIds: ['a', 'b'], storageState: 'saving' }),
        { edge: 'left' },
      ),
    ).toMatchObject({ enabled: false, code: 'busy' });
  });

  it('allows branch creation from an open current branch and reopening only closed drafts', () => {
    expect(getAvailability('branch.create', makeContext(), { label: 'retry', source: 'working' }))
      .toEqual({ enabled: true });
    expect(
      getAvailability(
        'branch.create',
        makeContext({ branches: makeContext().branches.map((branch) => ({ ...branch, closed: branch.id === DRAFT })) }),
        { label: 'retry', source: 'working' },
      ),
    ).toMatchObject({ enabled: false, code: 'invalid-branch' });
    const fullProjectBranches = Array.from({ length: 100 }, (_, i) => ({
      id: `branch-${i}`, label: `branch ${i}`, isMain: i === 0, closed: false,
    }));
    expect(getAvailability('branch.create', makeContext({
      branchId: 'branch-1',
      branches: fullProjectBranches,
    }), { label: 'retry', source: 'head' })).toMatchObject({ enabled: false, code: 'limit' });

    expect(getAvailability('branch.reopen', makeContext(), { branchId: OTHER })).toEqual({ enabled: true });
    expect(getAvailability('branch.reopen', makeContext(), { branchId: MAIN }))
      .toMatchObject({ enabled: false, code: 'invalid-branch' });
    expect(getAvailability('branch.reopen', makeContext(), { branchId: DRAFT }))
      .toMatchObject({ enabled: false, code: 'invalid-branch' });
  });
});

describe('run.cancel and selection.delete availability', () => {
  it('cancels only while a run is running or paused', () => {
    expect(getAvailability('run.cancel', makeContext(), {})).toMatchObject({ enabled: false, code: 'not-running' });
    expect(getAvailability('run.cancel', makeContext({ runPhase: 'compiling' }), {})).toMatchObject({ enabled: false });
    expect(getAvailability('run.cancel', makeContext({ runPhase: 'running' }), {})).toEqual({ enabled: true });
    expect(getAvailability('run.cancel', makeContext({ runPhase: 'paused' }), {})).toEqual({ enabled: true });
    expect(getAvailability('run.cancel', makeContext({ runPhase: 'done' }), {})).toMatchObject({ enabled: false });
  });

  it('deletes only a non-empty selection and never while saving', () => {
    expect(getAvailability('selection.delete', makeContext(), {})).toMatchObject({
      enabled: false,
      code: 'invalid-selection',
      reason: 'Select a component or connection to delete',
    });
    expect(getAvailability('selection.delete', makeContext({ selectedElementIds: ['a'] }), {})).toEqual({ enabled: true });
    expect(getAvailability('selection.delete', makeContext({ selectedConnectionIds: ['c'] }), {})).toEqual({ enabled: true });
    expect(
      getAvailability('selection.delete', makeContext({ selectedElementIds: ['a'], storageState: 'saving' }), {}),
    ).toMatchObject({ enabled: false, code: 'busy' });
    expect(
      getAvailability('selection.delete', makeContext({ selectedElementIds: ['a'], activeViewId: null }), {}),
    ).toMatchObject({ enabled: false, code: 'no-view' });
  });
});

describe('canvas shortcuts (selection.delete)', () => {
  const selected = () => makeContext({ selectedElementIds: ['a'] });

  it('matches Delete and Backspace in canvas scope only', () => {
    expect(matchCanvasShortcut(keyEvent({ key: 'Delete' }), true)).toBe('selection.delete');
    expect(matchCanvasShortcut(keyEvent({ key: 'Backspace' }), false)).toBe('selection.delete');
    expect(matchGlobalShortcut(keyEvent({ key: 'Delete' }), true)).toBeNull();
    expect(matchCanvasShortcut(keyEvent({ key: 'Delete', metaKey: true }), true)).toBeNull();
    expect(matchCanvasShortcut(keyEvent({ key: 'Backspace', shiftKey: true }), true)).toBeNull();
  });

  it('ignores IME composition, editable fields and nested dialogs', () => {
    expect(matchCanvasShortcut(keyEvent({ key: 'Backspace', isComposing: true }), true)).toBeNull();
    expect(matchCanvasShortcut(keyEvent({ key: 'Backspace', inEditableField: true }), true)).toBeNull();
    expect(matchCanvasShortcut(keyEvent({ key: 'Delete', inDialog: true }), true)).toBeNull();
  });

  it('runs and reports only an enabled match so preventDefault follows a real command', () => {
    const handlers = makeHandlers();
    expect(runCanvasShortcut(keyEvent({ key: 'Delete' }), true, selected(), handlers)).toBe('selection.delete');
    expect(handlers['selection.delete']).toHaveBeenCalledTimes(1);
    expect(runCanvasShortcut(keyEvent({ key: 'Backspace' }), true, makeContext(), handlers)).toBeNull();
    expect(runCanvasShortcut(keyEvent({ key: 'Delete' }), true, makeContext({ selectedElementIds: ['a'], storageState: 'saving' }), handlers)).toBeNull();
    expect(handlers['selection.delete']).toHaveBeenCalledTimes(1);
  });

  it('formats the key hint from the registry', () => {
    expect(formatShortcut(COMMAND_DEFINITIONS['selection.delete'].shortcut!, true)).toBe('Delete');
  });
});

const OPEN_PANELS = {
  library: { open: true, collapsed: false },
  history: { open: true, collapsed: true },
} as const;

describe('panel, results and inspector availability', () => {
  it('closes and places only open panels', () => {
    expect(getAvailability('library.close', makeContext(), {})).toMatchObject({ enabled: false, code: 'not-open' });
    expect(getAvailability('history.close', makeContext({ panels: OPEN_PANELS }), {})).toEqual({ enabled: true });
    expect(getAvailability('panel.place', makeContext(), { panelId: 'library', placement: 'floating', index: 0 }))
      .toMatchObject({ enabled: false, reason: 'Open the panel first' });
    expect(getAvailability('panel.place', makeContext({ panels: OPEN_PANELS }), { panelId: 'library', placement: 'left', index: 0 }))
      .toEqual({ enabled: true });
    expect(getAvailability('panel.reset-width', makeContext({ panels: OPEN_PANELS }), { panelId: 'history' }))
      .toEqual({ enabled: true });
  });

  it('collapses only expanded panels but expands any open panel (auto-collapse is layout-only)', () => {
    const ctx = makeContext({ panels: OPEN_PANELS });
    expect(getAvailability('panel.collapse', ctx, { panelId: 'library' })).toEqual({ enabled: true });
    expect(getAvailability('panel.collapse', ctx, { panelId: 'history' })).toMatchObject({ enabled: false, reason: 'Panel is already collapsed' });
    expect(getAvailability('panel.expand', ctx, { panelId: 'history' })).toEqual({ enabled: true });
    expect(getAvailability('panel.expand', makeContext(), { panelId: 'history' })).toMatchObject({ enabled: false, code: 'not-open' });
  });

  it('closes results only while they are visible', () => {
    expect(getAvailability('results.close', makeContext(), {})).toMatchObject({ enabled: false, reason: 'Results are not open' });
    expect(getAvailability('results.close', makeContext({ resultsVisible: true }), {})).toEqual({ enabled: true });
  });

  it('mirrors the inspector draft state for apply, cancel and close', () => {
    const draftId = 'e0000000-0000-4000-8000-000000000001';
    const at = (draftState: CommandContext['draftState'], id: string | null = draftId) =>
      makeContext({ draftState, draftId: id });
    expect(getAvailability('inspector.apply', at('dirty'), { draftId })).toEqual({ enabled: true });
    expect(getAvailability('inspector.apply', at('validating'), { draftId })).toEqual({ enabled: true });
    expect(getAvailability('inspector.apply', at('clean'), { draftId })).toMatchObject({ enabled: false, code: 'no-draft' });
    expect(getAvailability('inspector.apply', at('saving'), { draftId })).toMatchObject({ enabled: false, code: 'busy' });
    expect(getAvailability('inspector.apply', at('invalid'), { draftId })).toMatchObject({
      enabled: false,
      reason: 'Fix the highlighted fields before applying',
    });
    expect(getAvailability('inspector.apply', at('stale'), { draftId })).toMatchObject({ enabled: false, code: 'not-ready' });
    expect(getAvailability('inspector.apply', at('dirty', null), { draftId })).toMatchObject({ enabled: false, reason: 'No configuration is open' });
    expect(getAvailability('inspector.apply', at('dirty'), { draftId: 'other' })).toMatchObject({ enabled: false, code: 'no-draft' });
    expect(getAvailability('inspector.cancel', at('dirty'), { draftId })).toEqual({ enabled: true });
    expect(getAvailability('inspector.cancel', at('saving'), { draftId })).toMatchObject({ enabled: false, code: 'busy' });
    expect(getAvailability('inspector.close', at('dirty'), { draftId })).toEqual({ enabled: true });
    expect(getAvailability('inspector.close', at('clean', null), { draftId: null })).toEqual({ enabled: true });
    expect(getAvailability('inspector.close', at('clean', null), { draftId })).toMatchObject({ enabled: false, code: 'no-draft' });
  });

  it('lists close rows in Quick options only while their surface is open', () => {
    const idle = buildQuickOptions(makeContext()).find((g) => g.group === 'review')!;
    expect(idle.options.map((o) => o.id)).toEqual(['history.open', 'library.open', 'results.open']);
    const open = buildQuickOptions(makeContext({ panels: OPEN_PANELS, resultsVisible: true })).find((g) => g.group === 'review')!;
    expect(open.options.map((o) => o.id)).toEqual([
      'history.open', 'library.open', 'results.open', 'history.close', 'library.close', 'results.close',
    ]);
  });
});

describe('executeCommand', () => {
  it('runs the handler with its payload when enabled', async () => {
    const handlers = makeHandlers();
    const result = await executeCommand('branch.switch', { branchId: MAIN }, makeContext(), handlers);
    expect(result).toEqual({ status: 'done', value: undefined });
    expect(handlers['branch.switch']).toHaveBeenCalledWith({ branchId: MAIN });
  });

  it('routes create and reopen payloads through their typed handlers', async () => {
    const handlers = makeHandlers();
    const createPayload = { label: 'cache experiment', source: 'head' as const };
    const reopenPayload = { branchId: OTHER };
    expect(await executeCommand('branch.create', createPayload, makeContext(), handlers))
      .toEqual({ status: 'done', value: undefined });
    expect(await executeCommand('branch.reopen', reopenPayload, makeContext(), handlers))
      .toEqual({ status: 'done', value: undefined });
    expect(handlers['branch.create']).toHaveBeenCalledWith(createPayload);
    expect(handlers['branch.reopen']).toHaveBeenCalledWith(reopenPayload);
  });

  it('re-checks availability and never calls a disabled handler', async () => {
    const handlers = makeHandlers();
    const result = await executeCommand('edit.redo', {}, makeContext(), handlers);
    expect(result).toMatchObject({ status: 'disabled', reason: 'Nothing to redo' });
    expect(handlers['edit.redo']).not.toHaveBeenCalled();
  });
});

describe('matchGlobalShortcut', () => {
  it('matches Mod+Z, Mod+Shift+Z and F2 per platform', () => {
    expect(matchGlobalShortcut(keyEvent({ key: 'z', metaKey: true }), true)).toBe('edit.undo');
    expect(matchGlobalShortcut(keyEvent({ key: 'Z', metaKey: true, shiftKey: true }), true)).toBe('edit.redo');
    expect(matchGlobalShortcut(keyEvent({ key: 'z', ctrlKey: true }), false)).toBe('edit.undo');
    expect(matchGlobalShortcut(keyEvent({ key: 'F2' }), true)).toBe('commands.open');
  });

  it('rejects modifier mismatches', () => {
    expect(matchGlobalShortcut(keyEvent({ key: 'z', ctrlKey: true }), true)).toBeNull();
    expect(matchGlobalShortcut(keyEvent({ key: 'z', metaKey: true }), false)).toBeNull();
    expect(matchGlobalShortcut(keyEvent({ key: 'z', metaKey: true, altKey: true }), true)).toBeNull();
    expect(matchGlobalShortcut(keyEvent({ key: 'F2', shiftKey: true }), true)).toBeNull();
    expect(matchGlobalShortcut(keyEvent({ key: 'z' }), true)).toBeNull();
  });

  it('ignores IME composition, editable fields and nested dialogs', () => {
    expect(matchGlobalShortcut(keyEvent({ key: 'z', metaKey: true, isComposing: true }), true)).toBeNull();
    expect(matchGlobalShortcut(keyEvent({ key: 'z', metaKey: true, inEditableField: true }), true)).toBeNull();
    expect(matchGlobalShortcut(keyEvent({ key: 'F2', inDialog: true }), true)).toBeNull();
  });

  it('has no ⌘K / ⌘R / ⌘H / ⌘B / ⌘L bindings', () => {
    for (const key of ['k', 'r', 'h', 'b', 'l']) {
      expect(matchGlobalShortcut(keyEvent({ key, metaKey: true }), true)).toBeNull();
    }
  });
});

describe('runGlobalShortcut', () => {
  it('only reports (and runs) an enabled match', () => {
    const handlers = makeHandlers();
    expect(runGlobalShortcut(keyEvent({ key: 'z', metaKey: true }), true, makeContext(), handlers)).toBe('edit.undo');
    expect(handlers['edit.undo']).toHaveBeenCalledTimes(1);
    // Redo is unavailable (nothing to redo): no match reported, so no preventDefault.
    expect(
      runGlobalShortcut(keyEvent({ key: 'z', metaKey: true, shiftKey: true }), true, makeContext(), handlers),
    ).toBeNull();
    expect(handlers['edit.redo']).not.toHaveBeenCalled();
    expect(runGlobalShortcut(keyEvent({ key: 'F2' }), true, makeContext({ projectId: null }), handlers)).toBeNull();
  });
});

describe('formatShortcut', () => {
  it('uses the platform notation', () => {
    expect(formatShortcut(COMMAND_DEFINITIONS['edit.redo'].shortcut!, true)).toBe('⇧⌘Z');
    expect(formatShortcut(COMMAND_DEFINITIONS['edit.redo'].shortcut!, false)).toBe('Ctrl+Shift+Z');
    expect(formatShortcut(COMMAND_DEFINITIONS['commands.open'].shortcut!, false)).toBe('F2');
  });
});

describe('buildQuickOptions', () => {
  it('groups rows as Project, Switch branch, Run, Review, Export, Edit', () => {
    const groups = buildQuickOptions(makeContext());
    expect(groups.map((g) => g.label)).toEqual(['Project', 'Switch branch', 'Run', 'Review', 'Export', 'Edit']);
    expect(groups[0].options.map((o) => o.id)).toEqual(['project.rename', 'project.switch']);
    expect(groups[0].options[0].detail).toBe('Checkout path');
  });

  it('lists the current branch first, then main, then the rest; badges each', () => {
    const branchGroup = buildQuickOptions(makeContext()).find((g) => g.group === 'branch')!;
    expect(branchGroup.options.map((o) => [o.label, o.badge])).toEqual([
      ['async-fulfilment', 'current'],
      ['main', 'main'],
      ['retry-envelope', 'closed'],
    ]);
    expect(new Set(branchGroup.options.map((o) => o.key)).size).toBe(3);
    expect(branchGroup.options[0].availability.enabled).toBe(false);
  });

  it('shows pause/resume/reset only while they apply', () => {
    const idle = buildQuickOptions(makeContext()).find((g) => g.group === 'run')!;
    expect(idle.options.map((o) => o.id)).toEqual(['run.start', 'run.start-all']);
    const running = buildQuickOptions(makeContext({ runPhase: 'running' })).find((g) => g.group === 'run')!;
    expect(running.options.map((o) => o.id)).toEqual(['run.start', 'run.start-all', 'run.pause', 'run.cancel', 'run.reset']);
    const paused = buildQuickOptions(makeContext({ runPhase: 'paused' })).find((g) => g.group === 'run')!;
    expect(paused.options.map((o) => o.id)).toContain('run.resume');
  });

  it('omits the single-scenario row when no scenario is selected', () => {
    const run = buildQuickOptions(makeContext({ selectedScenario: null, scenarioCount: 0 })).find(
      (g) => g.group === 'run',
    )!;
    expect(run.options.map((o) => o.id)).toEqual(['run.start-all']);
    expect(run.options[0].availability).toMatchObject({ enabled: false, reason: 'Add a scenario to run' });
  });

  it('shows selection actions only for a selection and binds every variant', () => {
    expect(buildQuickOptions(makeContext()).some((group) => group.group === 'selection')).toBe(false);
    const selection = buildQuickOptions(
      makeContext({
        selectedElementIds: ['a', 'b', 'c'],
        selectedGroupIds: ['g'],
        selectionWhollyUngrouped: false,
      }),
    ).find((group) => group.group === 'selection')!;
    expect(selection.options.map((entry) => entry.key)).toEqual([
      'selection.duplicate',
      'selection.delete',
      'selection.group',
      'selection.ungroup',
      'selection.align:left',
      'selection.align:center-x',
      'selection.align:right',
      'selection.align:top',
      'selection.align:center-y',
      'selection.align:bottom',
      'selection.distribute:x',
      'selection.distribute:y',
    ]);
    expect(selection.options.find((entry) => entry.id === 'selection.ungroup')?.payload).toEqual({
      groupIds: ['g'],
    });
  });
});

describe('checkProjectTitle', () => {
  it('trims and bounds the name', () => {
    expect(checkProjectTitle('  Checkout path v2 ', 'Checkout path')).toEqual({ ok: true, title: 'Checkout path v2' });
    expect(checkProjectTitle('   ', 'x')).toMatchObject({ ok: false });
    expect(checkProjectTitle('a'.repeat(81), 'x')).toMatchObject({ ok: false });
    expect(checkProjectTitle('Checkout path', 'Checkout path')).toMatchObject({ ok: false });
  });
});

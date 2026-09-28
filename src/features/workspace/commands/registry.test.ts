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
  matchGlobalShortcut,
  runGlobalShortcut,
  type CommandContext,
  type CommandHandlers,
  type ShortcutEvent,
} from './registry';

const MAIN = 'b0000000-0000-4000-8000-000000000001';
const DRAFT = 'b0000000-0000-4000-8000-000000000002';
const OTHER = 'b0000000-0000-4000-8000-000000000003';
const SCENARIO = 'c0000000-0000-4000-8000-000000000001';

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    projectId: 'a0000000-0000-4000-8000-000000000001',
    projectTitle: 'Checkout path',
    branchId: DRAFT,
    branches: [
      { id: MAIN, label: 'main', isMain: true, closed: false },
      { id: OTHER, label: 'retry-envelope', isMain: false, closed: true },
      { id: DRAFT, label: 'async-fulfilment', isMain: false, closed: false },
    ],
    storageState: 'ready',
    canUndo: true,
    canRedo: false,
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
    expect(withShortcut.sort()).toEqual(['commands.open', 'edit.redo', 'edit.undo']);
    const signatures = withShortcut.map((id) => {
      const s = COMMAND_DEFINITIONS[id].shortcut!;
      return `${s.scope}:${[...s.modifiers].sort().join('+')}:${s.key.toLowerCase()}`;
    });
    expect(new Set(signatures).size).toBe(signatures.length);
    for (const id of withShortcut) {
      const s = COMMAND_DEFINITIONS[id].shortcut!;
      if (s.key.length === 1) expect(s.modifiers).toContain('Mod');
    }
  });

  it('includes no excluded or uncontracted entries', () => {
    const labels = COMMAND_IDS.map((id) => COMMAND_DEFINITIONS[id].label.toLowerCase());
    for (const excluded of ['duplicate project', 'project settings', 'new branch', 'share']) {
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
});

describe('executeCommand', () => {
  it('runs the handler with its payload when enabled', async () => {
    const handlers = makeHandlers();
    const result = await executeCommand('branch.switch', { branchId: MAIN }, makeContext(), handlers);
    expect(result).toEqual({ status: 'done', value: undefined });
    expect(handlers['branch.switch']).toHaveBeenCalledWith({ branchId: MAIN });
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
    expect(running.options.map((o) => o.id)).toEqual(['run.start', 'run.start-all', 'run.pause', 'run.reset']);
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
});

describe('checkProjectTitle', () => {
  it('trims and bounds the name', () => {
    expect(checkProjectTitle('  Checkout path v2 ', 'Checkout path')).toEqual({ ok: true, title: 'Checkout path v2' });
    expect(checkProjectTitle('   ', 'x')).toMatchObject({ ok: false });
    expect(checkProjectTitle('a'.repeat(81), 'x')).toMatchObject({ ok: false });
    expect(checkProjectTitle('Checkout path', 'Checkout path')).toMatchObject({ ok: false });
  });
});

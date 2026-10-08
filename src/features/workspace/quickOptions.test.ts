/**
 * Quick options rendering (renderToStaticMarkup, no portal), including the
 * elements deliberately left out.
 */
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuickOptionsContent, quickOptionFilter } from './QuickOptions';
import { buildQuickOptions, type CommandContext } from './commands/registry';

const MAIN = 'b0000000-0000-4000-8000-000000000001';
const DRAFT = 'b0000000-0000-4000-8000-000000000002';

const context: CommandContext = {
  selectionHasRefinement: false,
  selectedElementScenarioScope: false,
  selectedElementHasOutPort: false,
  selectedScenarioMode: null,
  projectId: 'a0000000-0000-4000-8000-000000000001',
  projectTitle: 'Checkout path',
  branchId: DRAFT,
  activeViewId: 'd0000000-0000-4000-8000-000000000001',
  branches: [
    { id: MAIN, label: 'main', isMain: true, closed: false },
    { id: DRAFT, label: 'async-fulfilment', isMain: false, closed: false },
  ],
  storageState: 'ready',
  draftState: 'clean',
  draftId: null,
  panels: { library: { open: false, collapsed: false }, history: { open: false, collapsed: false } },
  resultsVisible: false,
  commitCount: 2,
  publish: { status: 'idle', eligible: false, conflictCount: 0 },
  canUndo: false,
  canRedo: false,
  selectedElementIds: [],
  selectedConnectionIds: [],
  selectedGroupIds: [],
  selectionWhollyUngrouped: false,
  selectionHasRefinementMember: false,
  activeViewGroupCount: 0,
  activeViewNoteCount: 0,
  runBlockedReason: null,
  runPhase: 'idle',
  hasRunDisplay: false,
  scenarioCount: 2,
  selectedScenario: { id: 'c0000000-0000-4000-8000-000000000001', label: 'Peak checkout', notReadyReason: null },
  runAllBlockedReason: null,
  exportDisabledReasons: { png: null, svg: null, json: null, csv: 'Run a scenario to export results', mermaid: null },
};

function render(mode: 'list' | 'rename' | 'group' | 'note' | 'commit'): string {
  return renderToStaticMarkup(
    React.createElement(QuickOptionsContent, {
      groups: buildQuickOptions(context),
      projectTitle: 'Checkout path',
      branchLabel: 'async-fulfilment',
      isMac: true,
      mode,
      onRun: () => {},
      onRename: async () => ({ ok: true }) as const,
      onTextCommand: async () => ({ ok: true }) as const,
      onBack: () => {},
    }),
  );
}

describe('QuickOptionsContent', () => {
  it('shows the search field, project/branch chip, groups and footer', () => {
    const html = render('list');
    expect(html).toContain('Search actions and branches…');
    expect(html).toContain('data-testid="quick-options-context"');
    for (const heading of ['Project', 'Switch branch', 'Run', 'Review', 'Export', 'Edit']) {
      expect(html).toContain(`>${heading}<`);
    }
    expect(html).toContain('Rename project');
    expect(html).toContain('All projects');
    expect(html).toContain('Current');
    expect(html).toContain('Main');
    expect(html).toContain('Run all scenarios');
    expect(html).toContain('Open history');
    expect(html).toContain('↑↓ move');
    expect(html).toContain('esc close');
  });

  it('shows disabled reasons and registry key hints', () => {
    const html = render('list');
    expect(html).toContain('Run a scenario to export results');
    expect(html).toContain('Nothing to undo');
  });

  it('leaves out the excluded elements', () => {
    const html = render('list');
    for (const excluded of [
      '⌘K',
      '⌘R',
      '⌘H',
      '⌘B',
      'Duplicate project',
      'Project settings',
      'New branch from here',
      'stay open',
      'LIVE',
      'ahead',
      'behind',
      'parts',
    ]) {
      expect(html).not.toContain(excluded);
    }
  });

  it('renders the nested rename step without team copy', () => {
    const html = render('rename');
    expect(html).toContain('Rename project');
    expect(html).toContain('value="Checkout path"');
    expect(html).toContain('↵ rename · esc back');
    expect(html).toContain('Branches, checkpoints and saved runs stay the same');
    expect(html).not.toContain('Platform team');
    expect(html).not.toContain('URL');
  });

  it('renders reusable nested text steps for Group and Note', () => {
    const group = render('group');
    expect(group).toContain('Group selection');
    expect(group).toContain('data-testid="quick-options-group-input"');
    expect(group).toContain('Enter a group name');

    const note = render('note');
    expect(note).toContain('Add note');
    expect(note).toContain('data-testid="quick-options-note-input"');
    expect(note).toContain('Enter note text');

    const commit = render('commit');
    expect(commit).toContain('Commit changes');
    expect(commit).toContain('data-testid="quick-options-commit-input"');
    expect(commit).toContain('Enter a commit message');
  });
});

describe('quickOptionFilter', () => {
  it('matches whole words, not loose subsequences', () => {
    expect(quickOptionFilter('k', 'note', ['Add note…', 'canvas'])).toBeGreaterThan(0);
    expect(quickOptionFilter('k', 'note', ['Run all scenarios', 'run', 'simulate', 'scenarios'])).toBe(0);
    expect(quickOptionFilter('k', 'note', ['Open results', 'results', 'run', 'output'])).toBe(0);
  });

  it('ranks label hits above keyword hits and needs every word to match', () => {
    const label = quickOptionFilter('k', 'history', ['Open history', 'versions']);
    const keyword = quickOptionFilter('k', 'history', ['Publish', 'history']);
    expect(label).toBeGreaterThan(keyword);
    expect(quickOptionFilter('k', 'open nothing', ['Open history', 'history'])).toBe(0);
    expect(quickOptionFilter('k', '', ['Open history'])).toBe(1);
  });
});

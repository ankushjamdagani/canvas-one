/**
 * Pure renderToStaticMarkup fidelity tests for HistoryLadder and CommitPanel (RV-11a).
 *
 * Implements specs/revamp/design-revalidation.md §2 (excluded texts) and §3 item 10,
 * and specs/revamp/screens/22A_history_ladder.png, scenario_commit_gate.png.
 */
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistoryLadder } from './HistoryLadder';
import { CommitPanel } from './CommitPanel';
import { DraftBehindMainBanner } from './DraftBehindMainBanner';
import { PublishedNotice } from './PublishedNotice';
import { readFileSync } from 'node:fs';
import type { Document } from '../../domain/studio/model';
const fixture: Document = JSON.parse(readFileSync('specs/revamp/fixtures/s02.json', 'utf8'));
import type { CheckpointRecord, CommitRecord, PublicationRecord } from '../../persistence/studio';
import type { ScenarioWithStatus } from '../runs/scenarioStatus';
import type { RecordChangeItem } from './types';

// design-revalidation.md §2 / lead defaults: text that must never appear as visible
// content in these panels. Excludes "overflow", which only ever appears here as a
// Tailwind utility class (overflow-y-auto / overflow-hidden), not visible copy.
const EXCLUDED_TEXTS = ['no run', 'suggested from your edits', 'p95', 'p99', 'burst', 'bottleneck'];

const testActor = { actorId: 'u1', kind: 'local-human' as const, displayName: 'Test User' };

const checkpoints: readonly CheckpointRecord[] = [
  {
    projectId: 'proj-1',
    id: 'cp-1',
    snapshotId: 'snap-cp-1',
    sourceBranchId: 'branch-1',
    label: 'Before big change',
    actor: testActor,
    createdAt: Date.UTC(2026, 8, 11, 16, 20),
  },
];

const commits: readonly CommitRecord[] = [
  {
    projectId: 'proj-1',
    id: 'commit-1',
    parentIds: [],
    snapshotId: 'snap-commit-1',
    message: 'Handle checkout retries in the order queue',
    evidence: [{ scenarioId: 's1', fingerprint: 'fp1', runId: 'run-1' }],
    actor: testActor,
    createdAt: Date.UTC(2026, 8, 11, 16, 25),
  },
];

const publications: readonly PublicationRecord[] = [
  {
    projectId: 'proj-1',
    id: 'pub-1',
    commitId: 'commit-1',
    sourceBranchId: 'branch-1',
    previousMainHeadId: null,
    ordinal: 1,
    actor: testActor,
    createdAt: Date.UTC(2026, 8, 11, 17, 0),
    metadata: {
      version: { major: 2, minor: 2, patch: 1 },
      title: 'Split gateway from storefront',
      rationale: '',
      ticketUrl: null,
    },
    versionKey: '2.2.1',
  },
];

describe('HistoryLadder static markup (22A)', () => {
  it('shows the published main ladder with current release and draft actions (22D)', () => {
    const html = renderToStaticMarkup(React.createElement(HistoryLadder, { isMain: true, branchName: 'main', publications, onStartDraft: vi.fn(), onEditMain: vi.fn() }));
    expect(html).toContain('CURRENT');
    expect(html).toContain('Start a new draft from 2.2.1');
    expect(html).toContain('Edit main directly');
    expect(html).not.toContain('NOW · NOT COMMITTED');
    expect(html).not.toContain('open-publish-button');
  });

  it('renders the standalone behind-main banner with supplied counts and actions (22E)', () => {
    const html = renderToStaticMarkup(React.createElement(DraftBehindMainBanner, { conflictCount: 3, versionsPublishedSinceFork: 2, forkVersionKey: '2.2.1', onLater: vi.fn(), onReviewAndResolve: vi.fn() }));
    expect(html).toContain('Main has moved on · 3 conflicts with your edits');
    expect(html).toContain('forked at 2.2.1');
    expect(html).toContain('Later');
    expect(html).toContain('Review and resolve');
  });

  it('accurately distinguishes a closed source from one kept open, without Undo publish', () => {
    for (const sourceBranchClosed of [true, false]) {
      const html = renderToStaticMarkup(React.createElement(PublishedNotice, { publication: publications[0], sourceBranchLabel: 'Checkout draft', sourceBranchClosed }));
      expect(html).toContain(sourceBranchClosed ? 'Checkout draft closed' : 'Checkout draft stays open');
      expect(html).not.toContain('Undo publish');
    }
  });
  it('renders branch, working edits, checkpoints, commits, publications without excluded texts', () => {
    const html = renderToStaticMarkup(
      React.createElement(HistoryLadder, {
        branchName: 'feature/checkout',
        isMain: false,
        aheadOfVersion: { aheadCount: 3, versionKey: '2.2.1' },
        workingEdits: ['Renamed queue to Order queue', 'Added retry policy'],
        checkpoints,
        commits,
        publications,
        commitDiffSummaries: { 'commit-1': '2 fields changed' },
        canUndo: true,
        canRedo: false,
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        onOpenCommit: vi.fn(),
        onOpenPublish: vi.fn(),
      }),
    );

    expect(html).toContain('feature/checkout');
    expect(html).toContain('NOW');
    expect(html).toContain('NOT COMMITTED');
    expect(html).toContain('Renamed queue to Order queue');
    expect(html).toContain('CHECKPOINTS');
    expect(html).toContain('Before big change');
    expect(html).toContain('COMMITS');
    expect(html).toContain('2 fields changed');
    expect(html).toContain('scenario');
    expect(html).toContain('PUBLISHED ON MAIN');
    expect(html).toContain('2.2.1');
    expect(html).toContain('Commit');
    expect(html).toContain('Publish draft to main');
    const publishButtonMatch = html.match(/<button[^>]*data-testid="open-publish-button"[^>]*>/);
    expect(publishButtonMatch).not.toBeNull();
    expect(publishButtonMatch![0]).not.toContain('disabled=""');
    expect(publishButtonMatch![0]).toContain('aria-disabled="false"');

    for (const text of EXCLUDED_TEXTS) {
      expect(html.toLowerCase()).not.toContain(text.toLowerCase());
    }
  });

  it('disables Commit and restore with a stated reason on main (D40)', () => {
    const html = renderToStaticMarkup(
      React.createElement(HistoryLadder, {
        branchName: 'main',
        isMain: true,
        workingEdits: [],
        checkpoints,
        commits: [],
        publications: [],
        onOpenCommit: vi.fn(),
      }),
    );

    expect(html).toContain('Main never holds edits');
    expect(html).toContain('disabled');
  });

  it('disables Publish with a stated reason before the branch has any commits', () => {
    const html = renderToStaticMarkup(
      React.createElement(HistoryLadder, {
        branchName: 'feature/checkout',
        isMain: false,
        workingEdits: [],
        checkpoints: [],
        commits: [],
        publications: [],
        onOpenCommit: vi.fn(),
        onOpenPublish: vi.fn(),
      }),
    );

    expect(html).toContain('Commit at least once before publishing');
    const publishButtonMatch = html.match(/<button[^>]*data-testid="open-publish-button"[^>]*>/);
    expect(publishButtonMatch).not.toBeNull();
    expect(publishButtonMatch![0]).toContain('disabled=""');
  });

  it('shows the real behind-main callout and "Review and resolve N conflicts" primary action (22E)', () => {
    const html = renderToStaticMarkup(
      React.createElement(HistoryLadder, {
        branchName: 'async-fulfilment',
        isMain: false,
        workingEdits: [],
        checkpoints: [],
        commits,
        publications: [],
        onOpenCommit: vi.fn(),
        onOpenPublish: vi.fn(),
        behindMain: { conflictCount: 3, versionsPublishedSinceFork: 2 },
        onReviewAndResolve: vi.fn(),
      }),
    );

    expect(html).toContain('ladder-behind-main');
    expect(html).toContain('This draft is behind main');
    expect(html).toContain('2 versions published');
    expect(html).toContain('Review and resolve 3 conflicts');
    expect(html).toContain('blocked until updated');
    // The plain Publish link is replaced entirely while behind main.
    expect(html).not.toContain('open-publish-button');
  });

  it('omits "ahead of" when not computable, and omits fields-changed line when not computable', () => {
    const html = renderToStaticMarkup(
      React.createElement(HistoryLadder, {
        branchName: 'feature/x',
        isMain: false,
        aheadOfVersion: null,
        workingEdits: [],
        checkpoints: [],
        commits,
        publications: [],
        commitDiffSummaries: { 'commit-1': null },
        onOpenCommit: vi.fn(),
      }),
    );

    expect(html).not.toContain('ahead of');
    expect(html).not.toContain('fields-changed-text');
  });

  it('omits the branch row entirely rather than inventing a branch name when none is known', () => {
    const html = renderToStaticMarkup(
      React.createElement(HistoryLadder, {
        // No branchName prop and no controller: there is no real branch name to show.
        isMain: false,
        workingEdits: [],
        checkpoints: [],
        commits: [],
        publications: [],
        onOpenCommit: vi.fn(),
      }),
    );

    expect(html).not.toContain('branch-selector-row');
    expect(html).not.toContain('lucide-git-branch');
  });
});

function makeScenarios(overrides: readonly Partial<ScenarioWithStatus>[]): ScenarioWithStatus[] {
  return overrides.map((o, i) => ({
    scenario: { ...fixture.scenarios[0], id: `s${i}`, label: `Scenario ${i}` },
    status: { kind: 'not-run' },
    currentFingerprint: null,
    latestRun: null,
    ...o,
  }));
}

const changes: readonly RecordChangeItem[] = [
  { recordKind: 'element', id: 'elem-queue', change: 'modified', label: 'Order queue', detail: 'capacity 2 → 4' },
  { recordKind: 'connection', id: 'conn-1', change: 'added', label: 'Queue → payment provider', detail: 'new connection' },
];

describe('CommitPanel static markup (scenario_commit_gate.png)', () => {
  it('renders CHANGES, message field, and the every-scenario gate without excluded texts', () => {
    const scenarios = makeScenarios([
      { status: { kind: 'passed' } },
      { status: { kind: 'not-run' } },
    ]);

    const html = renderToStaticMarkup(
      React.createElement(CommitPanel, {
        isMain: false,
        changes,
        scenariosWithStatus: scenarios,
        onRunScenario: vi.fn(),
        onRunAll: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('CHANGES');
    expect(html).toContain('Order queue');
    expect(html).toContain('capacity 2');
    expect(html).toContain('Commit message');
    expect(html).toContain('EVERY SCENARIO MUST PASS');
    expect(html).toContain('Scenario 0');
    expect(html).toContain('Scenario 1');
    expect(html).toContain('Run');
    expect(html).toContain('1 of 2 passing');
    expect(html).toContain('Commit unlocks when all 2 scenarios pass');

    for (const text of EXCLUDED_TEXTS) {
      expect(html.toLowerCase()).not.toContain(text.toLowerCase());
    }
  });

  it('shows the passed check and no Run button once every scenario passes', () => {
    const scenarios = makeScenarios([{ status: { kind: 'passed' } }, { status: { kind: 'passed' } }]);

    const html = renderToStaticMarkup(
      React.createElement(CommitPanel, {
        isMain: false,
        changes: [],
        scenariosWithStatus: scenarios,
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain('2 of 2 passing');
    expect(html).not.toContain('Commit unlocks when all');
    for (const text of EXCLUDED_TEXTS) {
      expect(html.toLowerCase()).not.toContain(text.toLowerCase());
    }
  });

  it('never shows a default/suggested commit message', () => {
    const html = renderToStaticMarkup(
      React.createElement(CommitPanel, {
        isMain: false,
        changes: [],
        scenariosWithStatus: [],
        onCancel: vi.fn(),
      }),
    );

    // Input must not carry a value attribute pre-filled with suggested text.
    expect(html).not.toMatch(/value="[^"]+"/);
  });
});

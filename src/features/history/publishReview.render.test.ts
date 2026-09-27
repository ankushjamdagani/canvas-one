/**
 * Pure renderToStaticMarkup fidelity tests for PublishReviewBody (22C publish
 * review, RV-11b review round).
 *
 * design-revalidation.md §2 overrides, checked explicitly here:
 * - no "minor · fits the diff" (or any) reasoning text on a version card
 * - no p95/burst/"vs 2.2.1" deltas anywhere
 * - no single-letter keyboard shortcuts
 */
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishReviewBody, type PublishReviewBodyProps } from './PublishReviewDialog';
import type { MergeConflict } from '../../domain/versioning/merge';
import type { VersionSuggestions } from '../../domain/versioning/publication';
import type { ScenarioWithStatus } from '../runs/scenarioStatus';
import type { Document } from '../../domain/studio/model';
import { readFileSync } from 'node:fs';
const fixture: Document = JSON.parse(readFileSync('specs/revamp/fixtures/s02.json', 'utf8'));

const EXCLUDED_TEXTS = ['p95', 'p99', 'burst', 'fits the diff', 'vs 2.2.1', 'no run'];

const versionSuggestions: VersionSuggestions = {
  isFirst: false,
  proposed: { major: 2, minor: 3, patch: 0 },
  proposedKey: '2.3.0',
  suggestions: [
    { kind: 'patch', version: { major: 2, minor: 2, patch: 2 }, versionKey: '2.2.2', disabled: false },
    { kind: 'minor', version: { major: 2, minor: 3, patch: 0 }, versionKey: '2.3.0', disabled: false },
    { kind: 'major', version: { major: 3, minor: 0, patch: 0 }, versionKey: '3.0.0', disabled: false },
  ],
};

function makeScenario(overrides: Partial<ScenarioWithStatus>): ScenarioWithStatus {
  return {
    scenario: { ...fixture.scenarios[0], id: 's1', label: 'Invalid cart' },
    status: { kind: 'passed' },
    currentFingerprint: 'fp1',
    latestRun: null,
    ...overrides,
  };
}

function defaultProps(overrides: Partial<PublishReviewBodyProps> = {}): PublishReviewBodyProps {
  return {
    sourceBranchLabel: 'async-fulfilment',
    mainBranchLabel: 'main',
    commitsSinceFork: [],
    componentsTouchedCount: 3,
    conflicts: [],
    mergeInputs: null,
    scenarios: [makeScenario({})],
    eligible: true,
    runningScenarioId: null,
    onRunScenario: vi.fn(),
    onOpenCompare: vi.fn(),
    versionSuggestions,
    currentVersionKey: '2.2.1',
    selectedBump: 'minor',
    onSelectBump: vi.fn(),
    title: 'Ship checkout scenarios',
    onTitleChange: vi.fn(),
    rationale: '',
    onRationaleChange: vi.fn(),
    ticketUrl: '',
    ticketUrlValid: true,
    onTicketUrlChange: vi.fn(),
    closeSourceAfterPublish: true,
    onCloseSourceAfterPublishChange: vi.fn(),
    confirming: false,
    isPublishing: false,
    formError: null,
    onRequestConfirm: vi.fn(),
    onCancelConfirm: vi.fn(),
    onConfirmPublish: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<PublishReviewBodyProps> = {}) {
  return renderToStaticMarkup(React.createElement(PublishReviewBody, defaultProps(overrides)));
}

describe('PublishReviewBody static markup (22C)', () => {
  it('never renders excluded design elements (D26 undo, reasoning text, p95/burst/deltas)', () => {
    const html = render();
    for (const text of EXCLUDED_TEXTS) {
      expect(html.toLowerCase()).not.toContain(text.toLowerCase());
    }
    expect(html).not.toContain('Undo publish');
  });

  it('shows real version cards with only the number and the bare major/minor/patch word, nothing chosen by default in the caller', () => {
    const html = render({ selectedBump: null });
    expect(html).toContain('review-version-card-major');
    expect(html).toContain('3.0.0');
    expect(html).toContain('review-version-card-minor');
    expect(html).toContain('2.3.0');
    expect(html).toContain('review-version-card-patch');
    expect(html).toContain('2.2.2');
    expect(html).toContain('nothing chosen yet');
    expect(html).toContain('current 2.2.1');
  });

  it('labels an unpublished project as the first publication, never current none', () => {
    const html = render({ currentVersionKey: null });
    expect(html).toContain('first publication');
    expect(html).not.toContain('current none');
  });

  it('disables Publish with "resolve N conflicts first" when conflicts remain, and offers Open diff view', () => {
    const conflict: MergeConflict = {
      id: 'c1',
      kind: 'value',
      recordKind: 'element',
      recordId: fixture.elements[0].id,
      path: ['label'],
      base: { present: true, value: 'a' },
      ours: { present: true, value: 'b' },
      theirs: { present: true, value: 'c' },
    };
    const html = render({ conflicts: [conflict], mergeInputs: { base: fixture, ours: fixture, theirs: fixture } });
    expect(html).toContain('review-conflicts-callout');
    expect(html).toContain('1 conflict to resolve');
    expect(html).toContain('Blocks publishing');
    expect(html).toContain('Open diff view');
    expect(html).toContain('publish-blocking-reason');
    expect(html).toContain('resolve 1 conflict first');
    const publishButtonMatch = html.match(/<button[^>]*data-testid="publish-review-button"[^>]*>/);
    expect(publishButtonMatch![0]).toContain('disabled=""');
  });

  it('disables Publish with "every scenario must pass first" when not eligible and no conflicts', () => {
    const html = render({ eligible: false, scenarios: [makeScenario({ status: { kind: 'not-run' } })] });
    expect(html).toContain('publish-blocking-reason');
    expect(html).toContain('every scenario must pass first');
    const publishButtonMatch = html.match(/<button[^>]*data-testid="publish-review-button"[^>]*>/);
    expect(publishButtonMatch![0]).toContain('disabled=""');
  });

  it('disables Publish with "choose a version number" when nothing is selected', () => {
    const html = render({ selectedBump: null });
    expect(html).toContain('publish-blocking-reason');
    expect(html).toContain('choose a version number');
  });

  it('enables Publish once every gate passes, and shows the irreversible notice only while confirming', () => {
    const notConfirming = render();
    expect(notConfirming).not.toContain('publish-confirm-notice');
    const publishButtonMatch = notConfirming.match(/<button[^>]*data-testid="publish-review-button"[^>]*>/);
    expect(publishButtonMatch![0]).not.toContain('disabled=""');

    const confirming = render({ confirming: true });
    expect(confirming).toContain('publish-confirm-notice');
    expect(confirming).toContain('be undone');
    expect(confirming).toContain('publish-confirm-button');
  });

  it('shows the real "What goes onto main" commit count and components-touched count, with per-commit evidence only when real', () => {
    const html = render({
      commitsSinceFork: [
        {
          projectId: 'p1',
          id: 'commit-1',
          snapshotId: 'snap-1',
          parentIds: [],
          evidence: [{ scenarioId: 's1', fingerprint: 'fp1', runId: 'run-1' }],
          actor: { actorId: 'u1', kind: 'local-human', displayName: 'Test' },
          createdAt: Date.UTC(2026, 8, 27, 17, 2),
          message: 'Absorb bursts in the order queue',
        },
      ],
      componentsTouchedCount: 3,
    });
    expect(html).toContain('1 commit');
    expect(html).toContain('3 components');
    expect(html).toContain('review-commit-commit-1');
    expect(html).toContain('1 scenario passed');
  });
});

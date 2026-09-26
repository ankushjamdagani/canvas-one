/**
 * Pure renderToStaticMarkup fidelity tests for PublishFlow (RV-11b).
 *
 * renderToStaticMarkup never runs effects, so PublishFlow's mount effect
 * (controller.prepare()) never fires here — these tests exercise pure
 * state -> markup mapping with a lightweight PublishControllerLike stub,
 * never a real repository.
 */
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishFlow } from './PublishFlow';
import type { PublishControllerLike, PublishControllerState } from './publishController';
import type { MergeConflict } from '../../domain/versioning/merge';
import type { ScenarioWithStatus } from '../runs/scenarioStatus';

const EXCLUDED_TEXTS = ['p95', 'p99', 'burst', 'no run'];

const BASE_STATE: PublishControllerState = {
  status: 'idle',
  candidateId: null,
  conflicts: [],
  scenarios: [],
  eligible: false,
  versionSuggestions: null,
  staleInfo: null,
  blockedMessage: null,
  publication: null,
  lastError: null,
};

function makeStubController(state: PublishControllerState): PublishControllerLike {
  return {
    getState: () => state,
    subscribe: () => () => {},
    prepare: vi.fn(),
    resolveConflict: vi.fn(),
    runScenario: vi.fn(),
    publish: vi.fn(),
    reset: vi.fn(),
  } as unknown as PublishControllerLike;
}

function makeScenario(overrides: Partial<ScenarioWithStatus>): ScenarioWithStatus {
  return {
    scenario: { id: 's1', label: 'Invalid cart' } as ScenarioWithStatus['scenario'],
    status: { kind: 'not-run' },
    currentFingerprint: null,
    latestRun: null,
    ...overrides,
  };
}

describe('PublishFlow static markup', () => {
  it('shows a real behind-main notice with the actual expected/actual revisions (22E)', () => {
    const controller = makeStubController({
      ...BASE_STATE,
      status: 'behind-main',
      staleInfo: { scope: 'branch', expected: 3, actual: 5 },
    });

    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));

    expect(html).toContain('publish-behind-main');
    expect(html).toContain('behind main');
    expect(html).toContain('3');
    expect(html).toContain('5');
    expect(html).toContain('Compare and resolve');
    for (const text of EXCLUDED_TEXTS) {
      expect(html.toLowerCase()).not.toContain(text.toLowerCase());
    }
  });

  it('shows a real blocked message rather than a generic one', () => {
    const controller = makeStubController({
      ...BASE_STATE,
      status: 'blocked',
      blockedMessage: "Source branch has no committed head; cannot prepare candidate from unborn branch",
    });

    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));

    expect(html).toContain('publish-blocked');
    expect(html).toContain('unborn branch');
  });

  it('renders real conflicts with base/ours/theirs and ours/theirs/edit actions (22F)', () => {
    const conflict: MergeConflict = {
      id: 'conflict-1',
      kind: 'value',
      recordKind: 'element',
      recordId: 'elem-1',
      path: ['behavior', 'config', 'capacity'],
      base: { present: true, value: 20 },
      ours: { present: true, value: 30 },
      theirs: { present: true, value: 40 },
    };

    const controller = makeStubController({
      ...BASE_STATE,
      status: 'review',
      candidateId: 'cand-1',
      conflicts: [conflict],
      scenarios: [],
      eligible: false,
    });

    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));

    expect(html).toContain('conflict-row-conflict-1');
    expect(html).toContain('Keep ours');
    expect(html).toContain('Keep theirs');
    expect(html).toContain('Edit');
    expect(html).toContain('30'); // ours value, real not invented
    expect(html).toContain('40'); // theirs value
    // No metadata form / publish button while conflicts remain unresolved.
    expect(html).not.toContain('publish-review-button');
  });

  it('offers no "Edit" action for a document-kind (title) conflict, per resolve.ts / D25', () => {
    const conflict: MergeConflict = {
      id: 'conflict-title',
      kind: 'value',
      recordKind: 'document',
      recordId: 'doc',
      path: ['title'],
      base: { present: true, value: 'Base title' },
      ours: { present: true, value: 'Our title' },
      theirs: { present: true, value: 'Their title' },
    };

    const controller = makeStubController({
      ...BASE_STATE,
      status: 'review',
      candidateId: 'cand-1',
      conflicts: [conflict],
    });

    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));

    expect(html).toContain('conflict-row-conflict-title');
    expect(html).toContain('Keep ours');
    expect(html).toContain('Keep theirs');
    // resolve.ts rejects 'edited' for document-kind conflicts, so no Edit action
    // is offered anywhere on this single-conflict page.
    expect(html).not.toContain('>Edit<');
  });

  it('renders the scenario gate and version suggestions, gating the Publish action behind an explicit un-clicked step, never auto-publishing (D26)', () => {
    const controller = makeStubController({
      ...BASE_STATE,
      status: 'review',
      candidateId: 'cand-1',
      conflicts: [],
      scenarios: [makeScenario({ status: { kind: 'passed' } })],
      eligible: true,
      versionSuggestions: {
        isFirst: true,
        proposed: { major: 0, minor: 1, patch: 0 },
        proposedKey: '0.1.0',
        suggestions: [
          { kind: 'major', version: { major: 1, minor: 0, patch: 0 }, versionKey: '1.0.0', disabled: false },
          { kind: 'minor', version: { major: 0, minor: 1, patch: 0 }, versionKey: '0.1.0', disabled: false },
          { kind: 'patch', version: { major: 0, minor: 0, patch: 1 }, versionKey: '0.0.1', disabled: false },
        ],
      },
    });

    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));

    expect(html).toContain('EVERY SCENARIO MUST PASS');
    expect(html).toContain('Invalid cart');
    expect(html).toContain('0.1.0');
    expect(html).toContain('publish-review-button');
    // The irreversible confirmation copy only appears after clicking Publish
    // (component-internal `confirming` state) — never present on first render,
    // and mounting never itself calls controller.publish.
    expect(html).not.toContain('publish-confirm');
    expect(html).not.toContain('be undone');
    expect(controller.publish).not.toHaveBeenCalled();

    for (const text of EXCLUDED_TEXTS) {
      expect(html.toLowerCase()).not.toContain(text.toLowerCase());
    }
  });

  it('shows the published confirmation with the real version and title, and the no-undo notice (22D)', () => {
    const controller = makeStubController({
      ...BASE_STATE,
      status: 'published',
      publication: {
        projectId: 'proj-1',
        id: 'pub-1',
        commitId: 'commit-1',
        sourceBranchId: 'branch-1',
        previousMainHeadId: null,
        ordinal: 1,
        actor: { actorId: 'u1', kind: 'local-human', displayName: 'Test User' },
        createdAt: Date.UTC(2026, 8, 27, 12, 0),
        metadata: {
          version: { major: 0, minor: 1, patch: 0 },
          title: 'Initial release',
          rationale: '',
          ticketUrl: null,
        },
        versionKey: '0.1.0',
      },
    });

    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));

    expect(html).toContain('publish-published');
    expect(html).toContain('0.1.0');
    expect(html).toContain('Initial release');
    expect(html).toContain('be undone');
  });
});

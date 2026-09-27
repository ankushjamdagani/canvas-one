/**
 * Pure renderToStaticMarkup fidelity tests for PublishFlow's non-dialog states
 * (RV-11b review round). The 'review' status renders PublishReviewDialog,
 * which wraps content in the project's real Dialog primitive — Radix mounts
 * Portal content on the client only, so it renders nothing in static server
 * markup (verified empirically). That content is covered directly by
 * publishReview.render.test.ts (PublishReviewBody) and
 * compareAndResolve.render.test.ts (CompareAndResolvePanel) instead.
 */
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublishFlow } from './PublishFlow';
import type { PublishControllerLike, PublishControllerState } from './publishController';

const BASE_STATE: PublishControllerState = {
  status: 'idle',
  candidateId: null,
  conflicts: [],
  scenarios: [],
  mergedDocument: null,
  mergeInputs: null,
  eligible: false,
  versionSuggestions: null,
  currentVersionKey: null,
  sourceBranchLabel: null,
  mainBranchLabel: null,
  commitsSinceFork: [],
  componentsTouchedCount: 0,
  versionsPublishedSinceFork: 0,
  forkVersionKey: null,
  resolvedFields: [],
  staleInfo: null,
  blockedMessage: null,
  publication: null,
  publishedSourceClosed: null,
  lastError: null,
};

function makeStubController(state: PublishControllerState): PublishControllerLike {
  return {
    getState: () => state,
    subscribe: () => () => {},
    prepare: vi.fn(),
    resolveConflict: vi.fn(),
    resolveAllConflicts: vi.fn(),
    reopenConflict: vi.fn(),
    runScenario: vi.fn(),
    publish: vi.fn(),
    reset: vi.fn(),
  };
}

describe('PublishFlow static markup (non-dialog states)', () => {
  it('shows a preparing notice while idle/preparing', () => {
    const controller = makeStubController({ ...BASE_STATE, status: 'preparing' });
    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));
    expect(html).toContain('publish-preparing');
  });

  it('shows the real blocked message rather than a generic one', () => {
    const controller = makeStubController({
      ...BASE_STATE,
      status: 'blocked',
      blockedMessage: 'Source branch is closed; cannot prepare candidate from closed branch',
    });
    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));
    expect(html).toContain('publish-blocked');
    expect(html).toContain('closed branch');
  });

  it('throws rather than showing an invented message when status is "blocked" with no blockedMessage', () => {
    const controller = makeStubController({ ...BASE_STATE, status: 'blocked', blockedMessage: null });
    expect(() => renderToStaticMarkup(React.createElement(PublishFlow, { controller }))).toThrow(/blockedMessage/);
  });

  it('shows the real error message rather than a generic one', () => {
    const controller = makeStubController({
      ...BASE_STATE,
      status: 'error',
      lastError: { status: 'failed', code: 'unavailable', issues: [{ message: 'IndexedDB is unavailable in this context' }] },
    });
    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));
    expect(html).toContain('IndexedDB is unavailable in this context');
  });

  it('throws rather than showing an invented message when status is "error" with no extractable message', () => {
    const controller = makeStubController({ ...BASE_STATE, status: 'error', lastError: null });
    expect(() => renderToStaticMarkup(React.createElement(PublishFlow, { controller }))).toThrow(/real message/);
  });

  it('shows the real stale revision numbers for a genuine optimistic-concurrency mismatch', () => {
    const controller = makeStubController({
      ...BASE_STATE,
      status: 'behind-main',
      staleInfo: { scope: 'branch', expected: 3, actual: 5 },
    });
    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));
    expect(html).toContain('publish-stale');
    expect(html).toContain('3');
    expect(html).toContain('5');
    expect(html).toContain('Try again');
  });

  it('shows the published notice with the real version and title, never "Undo publish" (D26)', () => {
    const controller = makeStubController({
      ...BASE_STATE,
      status: 'published',
      publishedSourceClosed: true,
      sourceBranchLabel: 'async-fulfilment',
      publication: {
        projectId: 'proj-1',
        id: 'pub-1',
        commitId: 'commit-1',
        sourceBranchId: 'branch-1',
        previousMainHeadId: null,
        ordinal: 1,
        actor: { actorId: 'u1', kind: 'local-human', displayName: 'Test User' },
        createdAt: Date.UTC(2026, 8, 27, 17, 6),
        metadata: { version: { major: 2, minor: 3, patch: 0 }, title: 'Absorb bursts in the order queue', rationale: '', ticketUrl: null },
        versionKey: '2.3.0',
      },
    });
    const html = renderToStaticMarkup(React.createElement(PublishFlow, { controller }));
    expect(html).toContain('publish-published');
    expect(html).toContain('2.3.0');
    expect(html).not.toContain('Undo publish');
  });
});

/**
 * Tests for export menu precondition checks.
 *
 * Each export item is disabled with a stated reason when its precondition fails
 * (e.g. CSV needs a saved terminal run; image exports need an authored view).
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../../../domain/studio/model';
import { REFERENCE_EXAMPLES } from '../../entry/fixtures';
import {
  getExportDisabledReason,
  hasAuthoredView,
  hasPlacedElement,
  NO_AUTHORED_VIEW_REASON,
  NO_PLACED_ELEMENT_REASON,
  NO_PROJECT_REASON,
  NO_SAVED_RUN_REASON,
  resolveActiveView,
} from './preconditions';

const s05 = REFERENCE_EXAMPLES.find((e) => e.id === 's05')!.fixture;

it('allows shape-only image exports while keeping Mermaid tied to executable placements', () => {
  const document: Document = { ...s05, views: [{ ...s05.views[0], placements: [], notes: [], canvasElements: [{ id: 'shape', kind: 'text', x: 0, y: 0, width: 200, height: 80, text: 'Label', fill: 'transparent', stroke: '#525252', strokeWidth: 0, fontSize: 16 }] }] };
  const input = { hasProject: true, document, viewId: document.views[0].id, hasSelectedRun: false };
  expect(getExportDisabledReason('svg', input)).toBeNull();
  expect(getExportDisabledReason('png', input)).toBeNull();
  expect(getExportDisabledReason('mermaid', input)).toBe(NO_PLACED_ELEMENT_REASON);
});

const emptyDocument: Document = {
  schema: 'studio-model/1',
  id: 'doc-empty',
  title: 'Empty',
  elements: [],
  connections: [],
  relations: [],
  schemas: [],
  fixtures: [],
  refinements: [],
  scenarios: [],
  views: [
    {
      id: 'view-empty',
      label: 'Main view',
      placements: [],
      notes: [],
      groups: [],
      connectionIds: [],
      relationIds: [],
    },
  ],
};

const noViewsDocument: Document = { ...emptyDocument, id: 'doc-no-views', views: [] };

describe('resolveActiveView', () => {
  it('returns null for a null document or a document with no views', () => {
    expect(resolveActiveView(null, null)).toBeNull();
    expect(resolveActiveView(noViewsDocument, null)).toBeNull();
  });

  it('returns the first view when viewId is null', () => {
    const view = resolveActiveView(s05, null);
    expect(view?.id).toBe(s05.views[0].id);
  });

  it('returns the matching view by id, or null when not found', () => {
    const view = resolveActiveView(s05, s05.views[0].id);
    expect(view?.id).toBe(s05.views[0].id);
    expect(resolveActiveView(s05, 'not-a-real-view')).toBeNull();
  });
});

describe('hasAuthoredView / hasPlacedElement', () => {
  it('is false for an empty view (no placements, no notes)', () => {
    expect(hasAuthoredView(emptyDocument, null)).toBe(false);
    expect(hasPlacedElement(emptyDocument, null)).toBe(false);
  });

  it('is true for the S05 fixture, which has placed elements', () => {
    expect(hasAuthoredView(s05, null)).toBe(true);
    expect(hasPlacedElement(s05, null)).toBe(true);
  });
});

describe('getExportDisabledReason', () => {
  it('requires an open project for every export kind', () => {
    for (const kind of ['json', 'svg', 'png', 'mermaid', 'csv'] as const) {
      expect(
        getExportDisabledReason(kind, {
          hasProject: false,
          document: s05,
          viewId: null,
          hasSelectedRun: true,
        }),
      ).toBe(NO_PROJECT_REASON);
    }
  });

  it('json has no further precondition once a project is open', () => {
    expect(
      getExportDisabledReason('json', {
        hasProject: true,
        document: null,
        viewId: null,
        hasSelectedRun: false,
      }),
    ).toBeNull();
  });

  it('svg/png require an authored view, with the exporter\'s own empty-view message', () => {
    expect(
      getExportDisabledReason('svg', {
        hasProject: true,
        document: emptyDocument,
        viewId: null,
        hasSelectedRun: false,
      }),
    ).toBe(NO_AUTHORED_VIEW_REASON);
    expect(
      getExportDisabledReason('png', {
        hasProject: true,
        document: emptyDocument,
        viewId: null,
        hasSelectedRun: false,
      }),
    ).toBe(NO_AUTHORED_VIEW_REASON);
    expect(
      getExportDisabledReason('svg', {
        hasProject: true,
        document: s05,
        viewId: null,
        hasSelectedRun: false,
      }),
    ).toBeNull();
  });

  it('mermaid requires a placed element, with the exporter\'s own empty-view message', () => {
    expect(
      getExportDisabledReason('mermaid', {
        hasProject: true,
        document: emptyDocument,
        viewId: null,
        hasSelectedRun: false,
      }),
    ).toBe(NO_PLACED_ELEMENT_REASON);
    expect(
      getExportDisabledReason('mermaid', {
        hasProject: true,
        document: s05,
        viewId: null,
        hasSelectedRun: false,
      }),
    ).toBeNull();
  });

  it('csv requires a selected saved run', () => {
    expect(
      getExportDisabledReason('csv', {
        hasProject: true,
        document: s05,
        viewId: null,
        hasSelectedRun: false,
      }),
    ).toBe(NO_SAVED_RUN_REASON);
    expect(
      getExportDisabledReason('csv', {
        hasProject: true,
        document: s05,
        viewId: null,
        hasSelectedRun: true,
      }),
    ).toBeNull();
  });
});

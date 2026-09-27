/**
 * Pure renderToStaticMarkup fidelity tests for CompareAndResolvePanel (22F,
 * RV-11b review round). Field-level conflict rendering with real record
 * labels (never a raw ID), plus a genuinely one-sided auto-merged field
 * rendered on the same selected record.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompareAndResolvePanel } from './CompareAndResolvePanel';
import type { Document } from '../../domain/studio/model';
import type { MergeConflict } from '../../domain/versioning/merge';

const s02Doc: Document = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s02.json'), 'utf8'));
const WORKER_ID = 'b870e6ff-5835-5cdc-80b9-9f9e159c8a55'; // "Fulfillment worker"

function withWorkerConfig(doc: Document, config: { capacity: number; concurrency: number }): Document {
  return {
    ...doc,
    elements: doc.elements.map((e) => {
      if (e.id !== WORKER_ID || e.behavior.kind !== 'resource') return e;
      return { ...e, behavior: { ...e.behavior, config: { ...e.behavior.config, ...config } } };
    }),
  };
}

const base = withWorkerConfig(s02Doc, { capacity: 10, concurrency: 1 });
const ours = withWorkerConfig(s02Doc, { capacity: 30, concurrency: 1 }); // main: capacity changed, concurrency untouched
const theirs = withWorkerConfig(s02Doc, { capacity: 40, concurrency: 2 }); // source: both changed
const mergedDocument = withWorkerConfig(s02Doc, { capacity: 30, concurrency: 2 }); // capacity still open (pending), concurrency auto-applied from theirs

const capacityConflict: MergeConflict = {
  id: 'conflict-capacity',
  kind: 'value',
  recordKind: 'element',
  recordId: WORKER_ID,
  path: ['behavior', 'config', 'capacity'],
  base: { present: true, value: 10 },
  ours: { present: true, value: 30 },
  theirs: { present: true, value: 40 },
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof CompareAndResolvePanel>> = {}) {
  return renderToStaticMarkup(
    React.createElement(CompareAndResolvePanel, {
      sourceBranchLabel: 'async-fulfilment',
      mainBranchLabel: 'main',
      conflicts: [capacityConflict],
      resolvedFields: [],
      mergeInputs: { base, ours, theirs },
      mergedDocument,
      eligible: false,
      totalScenarios: 2,
      passingScenarios: 0,
      onResolve: vi.fn(),
      onResolveAll: vi.fn(),
      onReopen: vi.fn(),
      onApplyAndRun: vi.fn(),
      ...overrides,
    }),
  );
}

describe('CompareAndResolvePanel static markup (22F)', () => {
  it('counts fields, including resolved fields on the same record, rather than records', () => {
    const html = renderPanel({ resolvedFields: [{ recordKind: 'element', recordId: WORKER_ID, path: ['label'], resolution: 'ours' }] });
    expect(html).toContain('1 of 2 resolved');
    expect(html).toContain('1 conflicts open');
  });

  it('renders record-level conflicts even when the record was deleted, without scalar edit', () => {
    const worker = ours.elements.find((e) => e.id === WORKER_ID)!;
    const html = renderPanel({
      mergedDocument: { ...mergedDocument, elements: mergedDocument.elements.filter((e) => e.id !== WORKER_ID) },
      conflicts: [{ ...capacityConflict, kind: 'delete-edit', path: [], ours: { present: false, value: undefined }, theirs: { present: true, value: worker } }],
    });
    expect(html).toContain('field-conflict-(record)');
    expect(html).toContain('This field cannot be edited here');
    expect(html).toContain('(absent)');
    expect(html).not.toContain(`&quot;${WORKER_ID}&quot;`);
  });

  it('does not offer edit for document title conflicts because the domain rejects edited documents', () => {
    const html = renderPanel({ conflicts: [{ ...capacityConflict, recordKind: 'document', recordId: base.id, path: ['title'], ours: { present: true, value: 'Main title' }, theirs: { present: true, value: 'Draft title' } }] });
    expect(html).toContain('field-conflict-title');
    expect(html).toContain('This field cannot be edited here');
    expect(html).not.toMatch(/>edit<\/button>/);
  });

  it('shows sequence conflicts at their actual path and explains why edit is unavailable', () => {
    const html = renderPanel({ conflicts: [{ ...capacityConflict, path: ['ports'], ours: { present: true, value: [] }, theirs: { present: true, value: [] } }] });
    expect(html).toContain('field-conflict-ports');
    expect(html).toContain('This field cannot be edited here');
  });
  it('shows the real element label in the unresolved list, never the raw element ID', () => {
    const html = renderPanel();
    expect(html).toContain('Fulfillment worker');
    // The raw UUID should not appear as visible list/field text.
    expect(html).not.toContain(`>${WORKER_ID}<`);
  });

  it('renders the open conflict field with both real branch-labelled values', () => {
    const html = renderPanel();
    expect(html).toContain('field-conflict-behavior.config.capacity');
    expect(html).toContain('30'); // ours (main)
    expect(html).toContain('40'); // theirs (source branch)
    expect(html).toContain('use ours');
    expect(html).toContain('use theirs');
    expect(html).toContain('edit'); // scalar field: edit is offered
  });

  it('tags the genuinely one-sided field as auto · <real branch label>, not a conflict', () => {
    const html = renderPanel();
    expect(html).toContain('behavior.config.concurrency');
    expect(html).toContain('auto · theirs');
    // It must not be rendered as a conflict row.
    expect(html).not.toContain('field-conflict-behavior.config.concurrency');
  });

  it('shows the real progress and blocks Apply and run while conflicts remain', () => {
    const html = renderPanel();
    expect(html).toContain('resolve-progress');
    expect(html).toContain('0 of 1 resolved');
    const applyMatch = html.match(/<button[^>]*>Apply and run<\/button>/);
    expect(applyMatch).not.toBeNull();
    expect(applyMatch![0]).toContain('disabled=""');
  });

  it('offers bulk resolution labelled with real branch names, never bare "ours"/"theirs"', () => {
    const html = renderPanel();
    expect(html).toContain('main everywhere');
    expect(html).toContain('async-fulfilment everywhere');
  });

  it('enables Apply and run once no conflicts remain', () => {
    const html = renderPanel({ conflicts: [] });
    const applyMatch = html.match(/<button[^>]*>Apply and run<\/button>/);
    expect(applyMatch).not.toBeNull();
    expect(applyMatch![0]).not.toContain('disabled=""');
  });

  it('shows a resolved field with its real resolution side and an enabled reopen', () => {
    const html = renderPanel({
      conflicts: [],
      resolvedFields: [
        { recordKind: 'element', recordId: WORKER_ID, path: ['behavior', 'config', 'capacity'], resolution: 'theirs' },
      ],
    });
    expect(html).toContain('resolved · behavior.config.capacity · theirs');
    expect(html).toContain('reopen');
    expect(html).not.toContain("can&#x27;t be reopened");
  });
});

/**
 * Tests for the transfer UI action controller (RV-10b).
 *
 * Implements the RV-10b task brief: "each action calls the right transfer function
 * with the right inputs and the download sink with the right filename/mime."
 * Uses `createTransferActions` (the pure controller `useTransferActions` memoizes)
 * with a mocked `StudioRepository` and a recording `DownloadSink` stub, matching
 * this codebase's existing test convention of typed `Partial<...>` repository
 * mocks cast via `as unknown as StudioRepository` (see EntryScreen.test.ts).
 */

import { describe, expect, it, vi } from 'vitest';
import type { Document } from '../../../domain/studio/model';
import type { RunRecord, StudioRepository } from '../../../persistence/studio/types';
import type { RunSummary } from '../../../domain/studio/runner/types';
import type { CanvasFactory } from '../types';
import { REFERENCE_EXAMPLES } from '../../entry/fixtures';
import { createTransferActions, type TransferSessionState } from './useTransferActions';
import {
  NO_AUTHORED_VIEW_REASON,
  NO_PLACED_ELEMENT_REASON,
  NO_PROJECT_REASON,
  NO_SAVED_RUN_REASON,
} from './preconditions';

const s05 = REFERENCE_EXAMPLES.find((e) => e.id === 's05')!.fixture;

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
    { id: 'view-empty', label: 'Main view', placements: [], notes: [], groups: [], connectionIds: [], relationIds: [] },
  ],
};

function baseSession(overrides: Partial<TransferSessionState> = {}): TransferSessionState {
  return {
    projectId: 'proj-1',
    projectRevision: 3,
    document: s05,
    viewId: null,
    selectedRunId: null,
    ...overrides,
  };
}

function recordingDownloadSink() {
  const calls: { blob: Blob; fileName: string }[] = [];
  const sink = (blob: Blob, fileName: string) => {
    calls.push({ blob, fileName });
  };
  return { sink, calls };
}

describe('createTransferActions: exportJson', () => {
  it('calls repository.exportProject with the session projectId/revision and downloads the returned blob', async () => {
    const bytes = new TextEncoder().encode('{"format":"system-studio"}');
    const exportProject = vi.fn().mockResolvedValue({
      status: 'done',
      bytes,
      sha256: 'deadbeef',
    });
    const loadProject = vi.fn().mockResolvedValue({ id: 'proj-1', title: 'My System' });
    const repository = { exportProject, loadProject } as unknown as StudioRepository;
    const { sink, calls } = recordingDownloadSink();

    const actions = createTransferActions({
      repository,
      session: baseSession(),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportJson();

    expect(result.ok).toBe(true);
    expect(exportProject).toHaveBeenCalledWith({ projectId: 'proj-1', expectedProjectRevision: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0].fileName).toBe('my-system.system-studio.json');
    expect(calls[0].blob.type).toBe('application/json;charset=utf-8');
  });

  it('is disabled (and never calls the repository) without an open project', async () => {
    const exportProject = vi.fn();
    const repository = { exportProject } as unknown as StudioRepository;
    const { sink } = recordingDownloadSink();

    const actions = createTransferActions({
      repository,
      session: baseSession({ projectId: null, projectRevision: null }),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportJson();
    expect(result).toEqual({ ok: false, message: NO_PROJECT_REASON });
    expect(exportProject).not.toHaveBeenCalled();
  });

  it('surfaces the repository export failure message without downloading', async () => {
    const exportProject = vi.fn().mockResolvedValue({ status: 'missing' });
    const repository = { exportProject } as unknown as StudioRepository;
    const { sink, calls } = recordingDownloadSink();

    const actions = createTransferActions({
      repository,
      session: baseSession(),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportJson();
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('createTransferActions: exportSvg / exportPng', () => {
  it('exportSvg renders the active view to a vector Blob and downloads it', async () => {
    const { sink, calls } = recordingDownloadSink();
    const actions = createTransferActions({
      repository: {} as unknown as StudioRepository,
      session: baseSession(),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportSvg();

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].blob.type).toBe('image/svg+xml;charset=utf-8');
    expect(calls[0].fileName.endsWith('.svg')).toBe(true);
    const text = await calls[0].blob.text();
    expect(text.startsWith('<svg')).toBe(true);
  });

  it('exportSvg is disabled with the exporter\'s empty-view message for an unauthored view', async () => {
    const { sink, calls } = recordingDownloadSink();
    const actions = createTransferActions({
      repository: {} as unknown as StudioRepository,
      session: baseSession({ document: emptyDocument }),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportSvg();
    expect(result).toEqual({ ok: false, message: NO_AUTHORED_VIEW_REASON });
    expect(calls).toHaveLength(0);
  });

  it('exportPng renders through the SVG pipeline to a raster Blob and downloads it', async () => {
    const { sink, calls } = recordingDownloadSink();
    // renderDiagramPng needs a real browser canvas/Image pipeline or an injected
    // canvasFactory (see png-export.test.ts) -- vitest runs in Node, so inject a
    // fake one here the same way.
    const fakeCanvasFactory: CanvasFactory = (width, height) => ({
      width,
      height,
      getContext: (type) =>
        type === '2d'
          ? { fillStyle: '', fillRect: () => {}, drawImage: () => {} }
          : null,
      toBlob: (callback, type) => {
        callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: type || 'image/png' }));
      },
    });

    const actions = createTransferActions({
      repository: {} as unknown as StudioRepository,
      session: baseSession(),
      mintId: () => 'id-1',
      downloadSink: sink,
      renderPngOptions: { canvasFactory: fakeCanvasFactory },
    });

    const result = await actions.exportPng();

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].blob.type).toBe('image/png');
    expect(calls[0].fileName.endsWith('.png')).toBe(true);
  });
});

describe('createTransferActions: exportMermaid', () => {
  it('renders the flowchart text and downloads it as text/plain', async () => {
    const { sink, calls } = recordingDownloadSink();
    const actions = createTransferActions({
      repository: {} as unknown as StudioRepository,
      session: baseSession(),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportMermaid();

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].blob.type).toBe('text/plain;charset=utf-8');
    expect(calls[0].fileName.endsWith('.mmd')).toBe(true);
    const text = await calls[0].blob.text();
    expect(text.startsWith('flowchart LR')).toBe(true);
  });

  it('is disabled with the exporter\'s own message when no element is placed', async () => {
    const { sink, calls } = recordingDownloadSink();
    const actions = createTransferActions({
      repository: {} as unknown as StudioRepository,
      session: baseSession({ document: emptyDocument }),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportMermaid();
    expect(result).toEqual({ ok: false, message: NO_PLACED_ELEMENT_REASON });
    expect(calls).toHaveLength(0);
  });
});

describe('createTransferActions: exportCsv', () => {
  function makeRunRecord(): RunRecord {
    const summary: RunSummary = {
      mode: 'timed',
      consumedInputs: 10,
      rootCounts: { generated: 10, succeeded: 8, rejected: 1, failed: 1, expired: 0, inFlight: 0 },
      messageCounts: { generated: 20, succeeded: 18, rejected: 0, failed: 2, expired: 0, inFlight: 0 },
      elementMetrics: [
        {
          elementId: 'el-1',
          scope: 'element',
          key: 'throughput',
          value: 125.5,
          unit: 'requests/s',
          available: true,
          reason: null,
          windowStartMs: 0,
          windowEndMs: 1000,
        },
      ],
      finalStates: [],
      outputs: [],
      coverage: { includedElementIds: ['el-1'], excludedElementIds: [] },
      processedEvents: 50,
      elapsedMs: 1000,
      rowOutcomes: [],
    };

    return {
      projectId: 'proj-1',
      id: 'run-1',
      snapshotId: 'a'.repeat(64),
      manifest: { scenario: { id: 'scenario-test' } },
      fingerprint: 'ss-run-v1:' + 'b'.repeat(64),
      status: 'completed',
      provenance: 'local',
      checks: [],
      summary,
      traceState: 'complete',
      createdAt: 1000,
      completedAt: 2000,
    };
  }

  it('loads the run and its snapshot, then downloads the CSV as text/csv', async () => {
    const run = makeRunRecord();
    const loadRun = vi.fn().mockResolvedValue(run);
    const loadSnapshot = vi.fn().mockResolvedValue({
      projectId: 'proj-1',
      id: run.snapshotId,
      document: { ...emptyDocument, elements: [{ id: 'el-1', label: 'Checkout' }] as unknown as Document['elements'] },
    });
    const repository = { loadRun, loadSnapshot } as unknown as StudioRepository;
    const { sink, calls } = recordingDownloadSink();

    const actions = createTransferActions({
      repository,
      session: baseSession({ selectedRunId: 'run-1' }),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportCsv();

    expect(result.ok).toBe(true);
    expect(loadRun).toHaveBeenCalledWith('proj-1', 'run-1');
    expect(loadSnapshot).toHaveBeenCalledWith('proj-1', run.snapshotId);
    expect(calls).toHaveLength(1);
    expect(calls[0].blob.type).toBe('text/csv;charset=utf-8');
    expect(calls[0].fileName).toBe('scenario-test.csv');
  });

  it('is disabled without a selected run, and never calls the repository', async () => {
    const loadRun = vi.fn();
    const repository = { loadRun } as unknown as StudioRepository;
    const { sink, calls } = recordingDownloadSink();

    const actions = createTransferActions({
      repository,
      session: baseSession({ selectedRunId: null }),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportCsv();
    expect(result).toEqual({ ok: false, message: NO_SAVED_RUN_REASON });
    expect(loadRun).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('reports a not-found message when the run no longer exists', async () => {
    const loadRun = vi.fn().mockResolvedValue(null);
    const repository = { loadRun } as unknown as StudioRepository;
    const { sink, calls } = recordingDownloadSink();

    const actions = createTransferActions({
      repository,
      session: baseSession({ selectedRunId: 'run-missing' }),
      mintId: () => 'id-1',
      downloadSink: sink,
    });

    const result = await actions.exportCsv();
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('createTransferActions: getDisabledReason', () => {
  it('reflects preconditions per export kind for the given session', () => {
    const actions = createTransferActions({
      repository: {} as unknown as StudioRepository,
      session: baseSession(),
      mintId: () => 'id-1',
      downloadSink: () => {},
    });

    expect(actions.getDisabledReason('json')).toBeNull();
    expect(actions.getDisabledReason('svg')).toBeNull();
    expect(actions.getDisabledReason('csv')).toBe(NO_SAVED_RUN_REASON);
  });
});

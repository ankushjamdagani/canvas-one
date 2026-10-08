/**
 * Export action controller for the transfer UI.
 *
 * Wires the pure exporters (json-transfer, svg-export, png-export,
 * mermaid-export, csv-export) to a caller-supplied session snapshot, repository and
 * download sink. `createTransferActions` is a plain, synchronous-to-construct
 * factory with no React and no global side effects of its own (the only DOM/global
 * touch -- Blob + object URL + anchor click -- lives entirely in the injected
 * `DownloadSink`, see `download-sink.ts`); `useTransferActions` is a thin React hook
 * that memoizes it.
 */

import * as React from 'react';
import type { Document, Id } from '../../../domain/studio/model';
import type { LocalRepository } from '../../../persistence/studio/repository';
import type { StudioRepository } from '../../../persistence/studio/types';
import { exportProjectJson } from '../json-transfer';
import { renderDiagramSvg } from '../svg-export';
import { renderDiagramPng } from '../png-export';
import { exportDiagramMermaid } from '../mermaid-export';
import { exportRunCsv } from '../csv-export';
import { svgFileName, pngFileName } from '../filename';
import type { RenderPngOptions } from '../types';
import type { DownloadSink } from './download-sink';
import {
  getExportDisabledReason,
  NO_PROJECT_REASON,
  NO_SAVED_RUN_REASON,
  type TransferExportKind,
} from './preconditions';

// ============================================================================
// Types
// ============================================================================

/**
 * The slice of session state the transfer actions need. Deliberately narrower than
 * `SessionState` (features/session/types.ts) so this module has no dependency on the
 * session controller -- the caller (Workspace.tsx/TopBar.tsx)
 * projects its own session/results state into this shape when mounting `ExportMenu`.
 */
export type TransferSessionState = {
  readonly projectId: Id | null;
  readonly projectRevision: number | null;
  readonly document: Document | null;
  /** The pinned authored view to export; null selects the document's first view. */
  readonly viewId: Id | null;
  /** The saved terminal run selected for CSV export (owned by the results UI); null = none selected. */
  readonly selectedRunId: Id | null;
};

export type TransferActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type UseTransferActionsParams = {
  readonly repository: StudioRepository | LocalRepository;
  readonly session: TransferSessionState;
  readonly mintId: () => Id;
  readonly downloadSink: DownloadSink;
  /**
   * Forwarded verbatim to `renderDiagramPng` (png-export.ts). Omit in the browser
   * (the default OffscreenCanvas/HTMLCanvasElement path); inject a fake
   * `canvasFactory` the same way png-export.test.ts does to unit-test `exportPng`
   * outside a browser.
   */
  readonly renderPngOptions?: RenderPngOptions;
};

export type TransferActions = {
  readonly exportJson: () => Promise<TransferActionResult>;
  readonly exportSvg: () => Promise<TransferActionResult>;
  readonly exportPng: () => Promise<TransferActionResult>;
  readonly exportMermaid: () => Promise<TransferActionResult>;
  readonly exportCsv: () => Promise<TransferActionResult>;
  readonly getDisabledReason: (kind: TransferExportKind) => string | null;
};

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ============================================================================
// Pure controller
// ============================================================================

/**
 * Builds the export actions for one session snapshot. Pure aside from the injected
 * `downloadSink` call each action makes on success -- construct a fresh one whenever
 * `session` changes (the React hook below does this via `useMemo`).
 */
export function createTransferActions(params: UseTransferActionsParams): TransferActions {
  const { repository, session, mintId, downloadSink, renderPngOptions } = params;

  function getDisabledReason(kind: TransferExportKind): string | null {
    return getExportDisabledReason(kind, {
      hasProject: session.projectId != null,
      document: session.document,
      viewId: session.viewId,
      hasSelectedRun: session.selectedRunId != null,
    });
  }

  async function exportJson(): Promise<TransferActionResult> {
    const reason = getDisabledReason('json');
    if (reason) return { ok: false, message: reason };
    if (session.projectId == null || session.projectRevision == null) {
      return { ok: false, message: NO_PROJECT_REASON };
    }

    const result = await exportProjectJson({
      repository,
      projectId: session.projectId,
      expectedProjectRevision: session.projectRevision,
      mintId,
    });

    if (!result.ok) return { ok: false, message: result.message };
    downloadSink(result.blob, result.fileName);
    return { ok: true };
  }

  async function exportSvg(): Promise<TransferActionResult> {
    const reason = getDisabledReason('svg');
    if (reason) return { ok: false, message: reason };
    // getDisabledReason('svg') already guarantees session.document is non-null here.
    const document = session.document!;

    try {
      const svg = renderDiagramSvg(document, session.viewId);
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      downloadSink(blob, svgFileName(document.title));
      return { ok: true };
    } catch (err) {
      return { ok: false, message: errorMessage(err, 'Could not export the diagram as SVG.') };
    }
  }

  async function exportPng(): Promise<TransferActionResult> {
    const reason = getDisabledReason('png');
    if (reason) return { ok: false, message: reason };
    const document = session.document!;

    try {
      const svg = renderDiagramSvg(document, session.viewId);
      const png = await renderDiagramPng(svg, 2, renderPngOptions);
      downloadSink(png, pngFileName(document.title));
      return { ok: true };
    } catch (err) {
      return { ok: false, message: errorMessage(err, 'Could not export the diagram as PNG.') };
    }
  }

  async function exportMermaid(): Promise<TransferActionResult> {
    const reason = getDisabledReason('mermaid');
    if (reason) return { ok: false, message: reason };
    const document = session.document!;

    try {
      const result = exportDiagramMermaid(document, session.viewId);
      const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
      downloadSink(blob, result.fileName);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: errorMessage(err, 'Could not export the diagram as Mermaid.') };
    }
  }

  async function exportCsv(): Promise<TransferActionResult> {
    const reason = getDisabledReason('csv');
    if (reason) return { ok: false, message: reason };
    if (session.projectId == null || session.selectedRunId == null) {
      return { ok: false, message: NO_SAVED_RUN_REASON };
    }
    const projectId = session.projectId;
    const runId = session.selectedRunId;

    try {
      const run = await repository.loadRun(projectId, runId);
      if (!run) {
        return { ok: false, message: 'The selected run was not found.' };
      }
      const snapshot = await repository.loadSnapshot(projectId, run.snapshotId);
      const result = exportRunCsv({ run, snapshotDocument: snapshot?.document ?? null });
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      downloadSink(blob, result.fileName);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: errorMessage(err, 'Could not export the run as CSV.') };
    }
  }

  return { exportJson, exportSvg, exportPng, exportMermaid, exportCsv, getDisabledReason };
}

// ============================================================================
// React hook
// ============================================================================

/**
 * React wrapper: memoizes `createTransferActions` over its inputs so the returned
 * action functions stay referentially stable across renders that don't change the
 * session snapshot, repository, mintId or download sink.
 */
export function useTransferActions(params: UseTransferActionsParams): TransferActions {
  const { repository, session, mintId, downloadSink, renderPngOptions } = params;
  return React.useMemo(
    () => createTransferActions({ repository, session, mintId, downloadSink, renderPngOptions }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repository, session, mintId, downloadSink, renderPngOptions],
  );
}

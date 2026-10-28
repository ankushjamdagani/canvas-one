/**
 * Export precondition checks for the transfer UI.
 *
 * Each export item is disabled with a stated reason when its precondition fails
 * (e.g. CSV needs a saved terminal run; image exports need an authored view).
 *
 * The SVG/PNG and Mermaid reason strings below are exactly the messages
 * `renderDiagramSvg` / `exportDiagramMermaid` themselves throw for an empty view
 * (svg-export.ts, mermaid-export.ts) -- reused here, not re-authored, so the menu's
 * disabled tooltip never drifts from what the exporter would actually say.
 */

import type { Document, Id, View } from '../../../domain/studio/model';

export type TransferExportKind = 'json' | 'svg' | 'png' | 'mermaid' | 'csv';

export const NO_PROJECT_REASON = 'Open a project to export.';
export const NO_AUTHORED_VIEW_REASON = 'Add an element or note before exporting the diagram.';
export const NO_PLACED_ELEMENT_REASON = 'Add an element before exporting.';
export const NO_SAVED_RUN_REASON = 'Select a saved run to export its results as CSV.';

/** Resolves the export's target view: the given viewId, or the document's first view. */
export function resolveActiveView(document: Document | null, viewId: Id | null): View | null {
  if (!document || document.views.length === 0) return null;
  if (viewId) {
    return document.views.find((v) => v.id === viewId) ?? null;
  }
  return document.views[0];
}

/** SVG/PNG precondition: the active view has at least one placement or note. */
export function hasAuthoredView(document: Document | null, viewId: Id | null): boolean {
  const view = resolveActiveView(document, viewId);
  if (!view) return false;
  return view.placements.length > 0 || view.notes.length > 0 || (view.canvasElements?.length ?? 0) > 0;
}

/** Mermaid precondition: the active view has at least one placed element. */
export function hasPlacedElement(document: Document | null, viewId: Id | null): boolean {
  const view = resolveActiveView(document, viewId);
  if (!view) return false;
  return view.placements.length > 0;
}

export type ExportPreconditionInput = {
  readonly hasProject: boolean;
  readonly document: Document | null;
  readonly viewId: Id | null;
  readonly hasSelectedRun: boolean;
};

/**
 * Returns the disabled reason for an export menu item, or null when it is enabled.
 * JSON has no precondition beyond an open project (the repository call itself
 * reports not-found/stale/limit failures at click time).
 */
export function getExportDisabledReason(
  kind: TransferExportKind,
  input: ExportPreconditionInput,
): string | null {
  if (!input.hasProject) return NO_PROJECT_REASON;

  switch (kind) {
    case 'json':
      return null;
    case 'svg':
    case 'png':
      return hasAuthoredView(input.document, input.viewId) ? null : NO_AUTHORED_VIEW_REASON;
    case 'mermaid':
      return hasPlacedElement(input.document, input.viewId) ? null : NO_PLACED_ELEMENT_REASON;
    case 'csv':
      return input.hasSelectedRun ? null : NO_SAVED_RUN_REASON;
    default:
      return null;
  }
}

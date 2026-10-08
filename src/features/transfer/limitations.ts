/**
 * Export Limitations Text.
 *
 * What each export format omits, shown to the user next to the export action.
 */

import type { ExportFormat } from './types';

export const JSON_EXPORT_LIMITATIONS =
  'Lossless for authored content, history, checkpoints, and run summaries. Transient preferences, undo history, and bulk trace chunks are excluded. Exported evidence is marked imported-unverified upon reimport. Move saved Library parts using standalone part files; project import does not add them to the new Library.';

export const SVG_EXPORT_LIMITATIONS =
  'Vector rendition of the active view. Excludes execution traces, scenarios, and unpublished branch history. Measurements and configurations export only when intentionally visible in this view.';

export const PNG_EXPORT_LIMITATIONS =
  'Raster image of the active view, bounded to at most 8,192 px per side and 16 million total pixels. Excludes execution traces, scenarios, and unpublished branch history.';

export const MERMAID_EXPORT_LIMITATIONS =
  'Lossy diagram export: labels, directed relations, and view groups only. Excludes notes, coordinates, styles, ports, payload schemas, behavior, resources, scenarios, history, and metrics. No import or round-trip promise.';

export const CSV_EXPORT_LIMITATIONS =
  'Whole-run summary metrics only (not raw trace or time-series events). Spreadsheet-safe text encoding with formula-injection defense; use JSON export for exact text.';

export function getExportLimitations(format: ExportFormat): string {
  switch (format) {
    case 'json':
      return JSON_EXPORT_LIMITATIONS;
    case 'svg':
      return SVG_EXPORT_LIMITATIONS;
    case 'png':
      return PNG_EXPORT_LIMITATIONS;
    case 'mermaid':
      return MERMAID_EXPORT_LIMITATIONS;
    case 'csv':
      return CSV_EXPORT_LIMITATIONS;
    default:
      return '';
  }
}

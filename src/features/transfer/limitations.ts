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

export { MERMAID_EXPORT_LIMITATIONS } from '@canvas-one/system-design/export/mermaid-limitations';
import { MERMAID_EXPORT_LIMITATIONS } from '@canvas-one/system-design/export/mermaid-limitations';

export { CSV_EXPORT_LIMITATIONS } from '@canvas-one/simulation-system-design/export/csv-limitations';
import { CSV_EXPORT_LIMITATIONS } from '@canvas-one/simulation-system-design/export/csv-limitations';

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

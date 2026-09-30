import { captureSelection } from '../../domain/parts/capture';
import type { CapturePreview } from '../../domain/parts/types';
import type { SavedPart } from '../../domain/parts/validate';
import type { Document, Id } from '../../domain/studio/model';

export type SelectionExportResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly preview: CapturePreview; readonly part: SavedPart }
  | { readonly ok: false; readonly message: string };

export function createSelectionExport(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  noteIds: readonly Id[],
  partId: Id,
  label: string,
): SelectionExportResult {
  const result = captureSelection(document, viewId, { elementIds, noteIds });
  if (!result.ok) {
    const first = result.issues[0];
    return { ok: false, message: first ? first.message : 'The selection could not be captured' };
  }
  const partFile: SavedPart = {
    id: partId,
    revision: 1,
    label,
    description: 'Exported from a canvas selection.',
    content: result.content,
  };
  const bytes = new TextEncoder().encode(JSON.stringify({ format: 'system-studio-part', version: 1, part: partFile }));
  return { ok: true, bytes, preview: result.preview, part: partFile };
}

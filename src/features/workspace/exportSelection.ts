import { captureSelection } from '../../domain/parts/capture';
import type { SavedPart } from '../../domain/parts/validate';
import type { Document, Id } from '../../domain/studio/model';

export function createSelectionExport(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  mintId: () => Id,
  label: string = 'Exported Selection'
): { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly message: string } {
  const result = captureSelection(document, viewId, { elementIds, noteIds: [], labelIds: [], componentIds: [] });
  if (!result.ok) {
    return { ok: false, message: result.issues[0]?.message ?? 'Failed to capture' };
  }
  
  const partFile: SavedPart = {
    id: mintId(),
    revision: 1,
    label,
    description: 'Exported from selection',
    content: result.content,
  };
  
  const payload = {
    format: "system-studio-part",
    version: 1,
    part: partFile,
  };
  
  return { ok: true, bytes: new TextEncoder().encode(JSON.stringify(payload, null, 2)) };
}

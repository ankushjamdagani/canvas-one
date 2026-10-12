/** App presentation binding over the headless inspector lifecycle. */
import { openDraft as openSemanticDraft } from '@canvas-one/system-design/authoring/inspector/draft';
import type { Document, Id } from '../../domain/studio/model';
import type { DraftHandle, DraftTarget } from './types';
import type { InspectorDraftOptions } from '@canvas-one/system-design/authoring/inspector/types';
import { getCatalogLayer, CATALOG_LAYER_COLORS } from '../workspace/projection';
export { changeField, validateDraft, cancelDraft, applyDraft, createInspectorDraftApi } from '@canvas-one/system-design/authoring/inspector/draft';

export function openDraft(draftId: Id, target: DraftTarget, baseWorkingRevision: number, document: Document, options: InspectorDraftOptions = {}): DraftHandle {
  const handle = openSemanticDraft(draftId, target, baseWorkingRevision, document, options);
  if (handle.multi) return handle;
  const element = target.kind === 'element' && !handle.missing ? document.elements.find(record => record.id === target.ids[0]) : null;
  const layer = element ? getCatalogLayer(element.visualKind) : null;
  return Object.freeze({ ...handle, layer, stripeColor: layer ? CATALOG_LAYER_COLORS[layer] : null });
}

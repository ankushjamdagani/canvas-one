import type { ProjectedNodeData } from './projection';

/** The record identity shared by selection, conversation anchors and activity. */
export function canvasRecordId(data: ProjectedNodeData): string {
  if (data.kind === 'element' || data.kind === 'boundary') return data.element.id;
  if (data.kind === 'note') return data.note.id;
  if (data.kind === 'canvas-element') return data.canvasElement.id;
  return data.group.id;
}

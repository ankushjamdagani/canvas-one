import type { CustomComponent, Document, Element, Id } from '../studio/model.js';
import type { RecordChange } from '../studio/records.js';
import { applyRecordChanges } from './apply-records.js';
import { createIssue } from '../studio/issue.js';
import type { Issue } from '../studio/validate.js';

/** Place custom authored content through the same semantic transaction and history as ordinary nodes. */
export function planCustomComponent(document: Document, input: {
  readonly viewId: Id; readonly elementId: Id; readonly placementId: Id;
  readonly label: string; readonly component: CustomComponent;
  readonly position: {readonly x: number; readonly y: number}; readonly width?: number;
}): {readonly ok: true; readonly changes: readonly RecordChange[]} | {readonly ok: false; readonly issues: readonly Issue[]} {
  const view = document.views.find(view => view.id === input.viewId);
  if (!view) return {ok: false, issues: [createIssue('dangling-reference', 'Select an existing view', ['viewId'])]};
  const element: Element = {id: input.elementId, label: input.label, description: '', visualKind: 'host', ports: [],
    behavior: {kind: 'unmodeled', version: 1, reason: `Custom component ${input.component.type}; no execution behavior registered`}, component: input.component};
  const changes: readonly RecordChange[] = [
    {kind: 'insert', value: {recordKind: 'element', record: element}},
    {kind: 'replace', value: {recordKind: 'view', record: {...view, placements: [...view.placements,
      {id: input.placementId, elementId: input.elementId, ...input.position, width: input.width ?? 184, expanded: false}]}}},
  ];
  const checked = applyRecordChanges(document, changes);
  return checked.ok ? {ok: true, changes} : checked;
}

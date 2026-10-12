import { validateBoardDocument, type BoardConnector, type BoardDocument, type BoardEntity, type BoardPlacement, type ExtensionRecords, type Json } from '@canvas-one/whiteboard';
import type { Document, Element, Note, Placement } from './studio/model.js';
import { validateDocument, type Issue } from './studio/validate.js';
import { deepFreeze } from './studio/freeze.js';
import { createIssue } from './studio/issue.js';

declare const structuredClone: <T>(value: T) => T;
export const SYSTEM_DESIGN_SOURCE_EXTENSION = 'system-design/source';
export type SystemDesignProjectionOptions = {
  /** Measured/host-specific display geometry is not authored system semantics. */
  readonly placementHeight?: (placement: Placement, entity: Element) => number;
  readonly noteHeight?: (note: Note) => number;
  /** Unavailable extension data is copied losslessly into the read-only projection. */
  readonly extensions?: ExtensionRecords;
};

/**
 * Read-only adapter projection. The original semantic document is preserved whole,
 * including refinements, scenarios, parts references, groups and unplaced edges.
 * It must never become a second writable authority beside the system session.
 */
export function projectSystemDesignDocument(document: Document, options: SystemDesignProjectionOptions = {}): BoardDocument {
  const checked = validateDocument(document);
  if (!checked.ok) throw new TypeError(`Invalid system-design source: ${checked.issues.map((issue) => issue.message).join('; ')}`);
  const source = structuredClone(checked.document);
  const entities: BoardEntity[] = source.elements.map((element) => element.component ? { ...element.component, id: element.id } : ({ id: element.id, type: `system-design/${element.visualKind}`, data: element as unknown as Json, extensions: {} }));
  const placements: BoardPlacement[] = [];
  const connectors: BoardConnector[] = [];
  const elements = new Map(source.elements.map((element) => [element.id, element]));
  const connections = new Map(source.connections.map((connection) => [connection.id, connection]));
  const pages = source.views.map((view) => {
    const byElement = new Map<string, Placement>();
    for (const placement of view.placements) {
      const element = elements.get(placement.elementId)!; byElement.set(element.id, placement);
      placements.push({ id: placement.id, pageId: view.id, entityId: element.id,
        bounds: { x: placement.x, y: placement.y, width: placement.width, height: options.placementHeight?.(placement, element) ?? 80 },
        extensions: { 'system-design/placement': { version: '1.0.0', data: { expanded: placement.expanded } } } });
    }
    for (const note of view.notes) {
      const entityId = `note/${view.id}/${note.id}`;
      entities.push({ id: entityId, type: 'system-design/note', data: note as unknown as Json, extensions: {} });
      placements.push({ id: `note-placement/${view.id}/${note.id}`, pageId: view.id, entityId,
        bounds: { x: note.x, y: note.y, width: note.width, height: options.noteHeight?.(note) ?? 80 }, extensions: {} });
    }
    for (const id of view.connectionIds) {
      const connection = connections.get(id)!; const from = byElement.get(connection.source.elementId); const to = byElement.get(connection.target.elementId);
      if (!from || !to) continue; // The full semantic edge and view membership remain in the source extension.
      connectors.push({ id: `connection/${view.id}/${id}`, pageId: view.id,
        source: { placementId: from.id, anchorId: connection.source.portId }, target: { placementId: to.id, anchorId: connection.target.portId },
        extensions: { 'system-design/connection': { version: '1.0.0', data: connection as unknown as Json } } });
    }
    return { id: view.id, name: view.label, extensions: { 'system-design/view': { version: '1.0.0', data: { groups: view.groups, relationIds: view.relationIds, connectionIds: view.connectionIds } as unknown as Json } } };
  });
  const projected: BoardDocument = { format: 'canvas-one/board', version: 1, id: source.id, title: source.title,
    pages, entities, placements, connectors, assets: [],
    extensions: { ...structuredClone(source.extensions ?? {}), ...structuredClone(options.extensions ?? {}), [SYSTEM_DESIGN_SOURCE_EXTENSION]: { version: '1.0.0', data: source as unknown as Json } } };
  const result = validateBoardDocument(projected);
  if (!result.ok) throw new TypeError(`Invalid system-design projection: ${result.issues.map((issue) => issue.message).join('; ')}`);
  return deepFreeze(result.document);
}

/** Read preserved semantics only; generic placement edits are never silently applied back to system data. */
export function readSystemDesignSource(board: BoardDocument): { readonly ok: true; readonly document: Document } | { readonly ok: false; readonly issues: readonly Issue[] } {
  const record = board.extensions[SYSTEM_DESIGN_SOURCE_EXTENSION];
  if (!record || record.version !== '1.0.0') return { ok: false, issues: [createIssue('invalid-literal', 'Missing or unsupported system-design source extension', ['extensions', SYSTEM_DESIGN_SOURCE_EXTENSION])] };
  const result = validateDocument(record.data);
  return result.ok ? { ok: true, document: deepFreeze(structuredClone(result.document)) } : result;
}

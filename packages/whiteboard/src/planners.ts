import { createIssue, type RecordChange, type ValidationIssue } from './index.js';
import { applyBoardRecordChanges, type BoardDocument, type BoardRecordMap, type ConnectorEndpoint, type Point } from './document.js';

export type BoardEditPlan =
  | { readonly ok: true; readonly changes: readonly RecordChange<BoardRecordMap>[] }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
const reject = (message: string, path: readonly (string | number)[] = []): BoardEditPlan => ({ ok: false, issues: [createIssue('invalid-edit', message, path)] });

/** Neutral movement planning; the editor keeps transient drag positions until commit. */
export function planBoardMoves(document: BoardDocument, pageId: string, moved: readonly { readonly id: string; readonly position: Point }[]): BoardEditPlan {
  if (!document.pages.some((page) => page.id === pageId)) return reject('The active page does not exist', ['pageId']);
  const changes: RecordChange<BoardRecordMap>[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < moved.length; index++) {
    const move = moved[index]; const placement = document.placements.find((entry) => entry.id === move.id && entry.pageId === pageId);
    if (!placement || seen.has(move.id) || !Number.isFinite(move.position.x) || !Number.isFinite(move.position.y)) return reject('Moves require unique existing placements on this page and finite positions', ['moved', index]);
    seen.add(move.id);
    if (placement.bounds.x === move.position.x && placement.bounds.y === move.position.y) continue;
    changes.push({ kind: 'replace', value: { recordKind: 'placement', record: { ...placement, bounds: { ...placement.bounds, ...move.position } } } });
  }
  const applied = applyBoardRecordChanges(document, changes);
  return applied.ok ? { ok: true, changes } : applied;
}

/** Ordinary visual connections need no executable protocol or measured behavior. */
export function planBoardConnector(document: BoardDocument, pageId: string, id: string, source: ConnectorEndpoint, target: ConnectorEndpoint): BoardEditPlan {
  const changes: RecordChange<BoardRecordMap>[] = [{ kind: 'insert', value: { recordKind: 'connector', record: { id, pageId, source: { ...source }, target: { ...target }, extensions: {} } } }];
  const applied = applyBoardRecordChanges(document, changes);
  return applied.ok ? { ok: true, changes } : applied;
}

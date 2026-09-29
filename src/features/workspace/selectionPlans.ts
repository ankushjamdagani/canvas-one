/**
 * Pure presentation planners for commands.md §4 selection.group,
 * selection.ungroup, selection.align, selection.distribute and
 * canvas.add-note. Every successful plan replaces only the active View, so
 * one model.apply-records command creates one undo entry without touching the
 * executable model.
 */

import type { Document, Group, Id, Note, Placement, View } from '../../domain/studio/model';
import type { RecordChange } from '../../persistence/studio/types';
import { placementHeight, type MeasuredHeights } from './projection';

export type AlignEdge = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export type DistributeAxis = 'x' | 'y';

export type SelectionPlan =
  | { readonly ok: true; readonly changes: RecordChange[]; readonly label: string }
  | { readonly ok: false; readonly reason: string };

export const GROUP_LABEL_MAX_LENGTH = 80;
export const NOTE_TEXT_MAX_LENGTH = 4000;
export const VIEW_GROUP_LIMIT = 50;
export const VIEW_NOTE_LIMIT = 50;
/** No authored note-width default existed before RV-04e; 220px matches the existing note fixture/card size. */
export const DEFAULT_NOTE_WIDTH = 220;

const MIN_CANVAS_COORDINATE = -1_000_000;
const MAX_CANVAS_COORDINATE = 1_000_000;

function reject(reason: string): SelectionPlan {
  return { ok: false, reason };
}

function replaceView(view: View, label: string): SelectionPlan {
  return {
    ok: true,
    label,
    changes: [{ kind: 'replace', value: { recordKind: 'view', record: view } }],
  };
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function hasDuplicates(ids: readonly Id[]): boolean {
  return new Set(ids).size !== ids.length;
}

function containsRecordId(value: unknown, id: Id): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsRecordId(entry, id));
  const record = value as Record<string, unknown>;
  if (record.id === id) return true;
  return Object.values(record).some((entry) => containsRecordId(entry, id));
}

function findView(document: Document, viewId: Id): View | null {
  return document.views.find((view) => view.id === viewId) ?? null;
}

function selectedPlacements(view: View, elementIds: readonly Id[]): Placement[] | null {
  if (hasDuplicates(elementIds)) return null;
  const placementByElementId = new Map(view.placements.map((placement) => [placement.elementId, placement]));
  const placements: Placement[] = [];
  for (const elementId of elementIds) {
    const placement = placementByElementId.get(elementId);
    if (!placement) return null;
    placements.push(placement);
  }
  return placements;
}

function replacePlacements(view: View, replacements: ReadonlyMap<Id, Placement>): View {
  return {
    ...view,
    placements: view.placements.map((placement) => replacements.get(placement.id) ?? placement),
  };
}

/** Nonempty, wholly ungrouped selection; the caller supplies the user-entered label. */
export function planGroup(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  groupId: Id,
  rawLabel: string,
): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  if (elementIds.length === 0) return reject('Select at least 1 component to group');
  if (hasDuplicates(elementIds)) return reject('The selection contains duplicate components');
  if (view.groups.length >= VIEW_GROUP_LIMIT) return reject(`A view can have at most ${VIEW_GROUP_LIMIT} groups`);

  const label = rawLabel.trim();
  if (codePointLength(label) === 0) return reject('Enter a group name');
  if (codePointLength(label) > GROUP_LABEL_MAX_LENGTH) {
    return reject(`Use ${GROUP_LABEL_MAX_LENGTH} characters or fewer`);
  }
  if (containsRecordId(document, groupId)) return reject('The group id is already in use');

  const placements = selectedPlacements(view, elementIds);
  if (!placements) return reject('Every selected component must be placed in this view');
  const groupedElementIds = new Set(view.groups.flatMap((group) => group.elementIds));
  if (elementIds.some((elementId) => groupedElementIds.has(elementId))) {
    return reject('Select only ungrouped components');
  }

  const group: Group = { id: groupId, label, elementIds: [...elementIds], collapsed: false };
  return replaceView({ ...view, groups: [...view.groups, group] }, 'Group');
}

/** Removes only presentation groups; their elements and placements stay intact. */
export function planUngroup(document: Document, viewId: Id, groupIds: readonly Id[]): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  if (groupIds.length === 0) return reject('Select all parts in one group to ungroup');
  if (hasDuplicates(groupIds)) return reject('The selection contains duplicate groups');
  const known = new Set(view.groups.map((group) => group.id));
  if (groupIds.some((groupId) => !known.has(groupId))) {
    return reject('Every selected group must belong to this view');
  }
  const removed = new Set(groupIds);
  return replaceView({ ...view, groups: view.groups.filter((group) => !removed.has(group.id)) }, 'Ungroup');
}

/** Aligns selected placement bounding boxes; placement width is authored and card height is the projection constant. */
export function planAlign(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  edge: AlignEdge,
  heights?: MeasuredHeights,
): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  if (elementIds.length < 2) return reject('Select at least 2 components to align');
  const placements = selectedPlacements(view, elementIds);
  if (!placements) return reject('Every selected component must be placed in this view');

  const minX = Math.min(...placements.map((placement) => placement.x));
  const maxX = Math.max(...placements.map((placement) => placement.x + placement.width));
  const minY = Math.min(...placements.map((placement) => placement.y));
  const maxY = Math.max(...placements.map((placement) => placement.y + placementHeight(placement, heights)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const replacements = new Map<Id, Placement>();

  for (const placement of placements) {
    let x = placement.x;
    let y = placement.y;
    switch (edge) {
      case 'left': x = minX; break;
      case 'center-x': x = centerX - placement.width / 2; break;
      case 'right': x = maxX - placement.width; break;
      case 'top': y = minY; break;
      case 'center-y': y = centerY - placementHeight(placement, heights) / 2; break;
      case 'bottom': y = maxY - placementHeight(placement, heights); break;
    }
    replacements.set(placement.id, { ...placement, x, y });
  }

  const labels: Record<AlignEdge, string> = {
    left: 'Align left',
    'center-x': 'Align centers horizontally',
    right: 'Align right',
    top: 'Align top',
    'center-y': 'Align centers vertically',
    bottom: 'Align bottom',
  };
  return replaceView(replacePlacements(view, replacements), labels[edge]);
}

/** Keeps the sorted endpoints fixed and makes the gaps between bounding boxes equal. */
export function planDistribute(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  axis: DistributeAxis,
  heights?: MeasuredHeights,
): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  if (elementIds.length < 3) return reject('Select at least 3 components to distribute');
  const placements = selectedPlacements(view, elementIds);
  if (!placements) return reject('Every selected component must be placed in this view');

  const ordered = [...placements].sort((a, b) => {
    const delta = axis === 'x' ? a.x - b.x : a.y - b.y;
    return delta || a.elementId.localeCompare(b.elementId);
  });
  const size = (placement: Placement) => axis === 'x' ? placement.width : placementHeight(placement, heights);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const start = axis === 'x' ? first.x : first.y;
  const end = (axis === 'x' ? last.x : last.y) + size(last);
  const totalSize = ordered.reduce((sum, placement) => sum + size(placement), 0);
  const gap = (end - start - totalSize) / (ordered.length - 1);
  const replacements = new Map<Id, Placement>();
  let cursor = start;

  for (const placement of ordered) {
    replacements.set(
      placement.id,
      axis === 'x' ? { ...placement, x: cursor } : { ...placement, y: cursor },
    );
    cursor += size(placement) + gap;
  }

  return replaceView(
    replacePlacements(view, replacements),
    axis === 'x' ? 'Distribute horizontally' : 'Distribute vertically',
  );
}

/** Adds a detached paper note at an explicit canvas point; text always comes from the user. */
export function planAddNote(
  document: Document,
  viewId: Id,
  noteId: Id,
  rawText: string,
  point: { readonly x: number; readonly y: number },
): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  if (view.notes.length >= VIEW_NOTE_LIMIT) return reject(`A view can have at most ${VIEW_NOTE_LIMIT} notes`);
  const text = rawText.trim();
  if (codePointLength(text) === 0) return reject('Enter note text');
  if (codePointLength(text) > NOTE_TEXT_MAX_LENGTH) {
    return reject(`Use ${NOTE_TEXT_MAX_LENGTH} characters or fewer`);
  }
  if (containsRecordId(document, noteId)) return reject('The note id is already in use');
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < MIN_CANVAS_COORDINATE ||
    point.x > MAX_CANVAS_COORDINATE ||
    point.y < MIN_CANVAS_COORDINATE ||
    point.y > MAX_CANVAS_COORDINATE
  ) {
    return reject('The note position is outside the canvas bounds');
  }

  const note: Note = {
    id: noteId,
    text,
    x: point.x,
    y: point.y,
    width: DEFAULT_NOTE_WIDTH,
    tone: 'paper',
    attachedElementIds: [],
  };
  return replaceView({ ...view, notes: [...view.notes, note] }, 'Add note');
}

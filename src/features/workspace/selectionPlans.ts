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
import { codePointLength } from '../../domain/studio/text';

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

function selectedNotes(view: View, noteIds: readonly Id[]): Note[] | null {
  if (hasDuplicates(noteIds)) return null;
  const noteById = new Map(view.notes.map((note) => [note.id, note]));
  const notes: Note[] = [];
  for (const noteId of noteIds) {
    const note = noteById.get(noteId);
    if (!note) return null;
    notes.push(note);
  }
  return notes;
}

/** Nonempty, wholly ungrouped selection; the caller supplies the user-entered label. */
export function planGroup(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  groupId: Id,
  rawLabel: string,
  noteIds: readonly Id[] = [],
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
  // When notes are selected with grouped elements, attach them to the group (attaching to the first member element if unattached)
  const targetElementId = elementIds[0];
  const updatedNotes = view.notes.map((note) => {
    if (noteIds.includes(note.id)) {
      const alreadyAttachedToGroup = note.attachedElementIds.some((id) => elementIds.includes(id));
      if (!alreadyAttachedToGroup) {
        return { ...note, attachedElementIds: [targetElementId] };
      }
    }
    return note;
  });

  return replaceView({ ...view, groups: [...view.groups, group], notes: updatedNotes }, 'Group');
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

/** Aligns selected placement and note bounding boxes; placement width is authored and card height is the projection constant. */
export function planAlign(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  edge: AlignEdge,
  heights?: MeasuredHeights,
  noteIds: readonly Id[] = [],
): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  const totalCount = elementIds.length + noteIds.length;
  if (totalCount < 2) return reject('Select at least 2 components to align');

  const placements = elementIds.length > 0 ? selectedPlacements(view, elementIds) : [];
  if (elementIds.length > 0 && !placements) return reject('Every selected component must be placed in this view');

  const notes = noteIds.length > 0 ? selectedNotes(view, noteIds) : [];
  if (noteIds.length > 0 && !notes) return reject('Every selected note must exist in this view');

  type AlignItem =
    | { kind: 'placement'; record: Placement; width: number; height: number; x: number; y: number }
    | { kind: 'note'; record: Note; width: number; height: number; x: number; y: number };

  const items: AlignItem[] = [
    ...(placements ?? []).map((p) => ({
      kind: 'placement' as const,
      record: p,
      width: p.width,
      height: placementHeight(p, heights),
      x: p.x,
      y: p.y,
    })),
    ...(notes ?? []).map((n) => ({
      kind: 'note' as const,
      record: n,
      width: n.width ?? DEFAULT_NOTE_WIDTH,
      height: heights?.get(n.id) ?? 100,
      x: n.x,
      y: n.y,
    })),
  ];

  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.width));
  const minY = Math.min(...items.map((i) => i.y));
  const maxY = Math.max(...items.map((i) => i.y + i.height));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const placementReplacements = new Map<Id, Placement>();
  const noteReplacements = new Map<Id, Note>();

  for (const item of items) {
    let x = item.x;
    let y = item.y;
    switch (edge) {
      case 'left': x = minX; break;
      case 'center-x': x = centerX - item.width / 2; break;
      case 'right': x = maxX - item.width; break;
      case 'top': y = minY; break;
      case 'center-y': y = centerY - item.height / 2; break;
      case 'bottom': y = maxY - item.height; break;
    }
    if (item.kind === 'placement') {
      placementReplacements.set(item.record.id, { ...item.record, x, y });
    } else {
      noteReplacements.set(item.record.id, { ...item.record, x: Math.round(x), y: Math.round(y) });
    }
  }

  const updatedView = {
    ...view,
    placements: view.placements.map((p) => placementReplacements.get(p.id) ?? p),
    notes: view.notes.map((n) => noteReplacements.get(n.id) ?? n),
  };

  const labels: Record<AlignEdge, string> = {
    left: 'Align left',
    'center-x': 'Align centers horizontally',
    right: 'Align right',
    top: 'Align top',
    'center-y': 'Align centers vertically',
    bottom: 'Align bottom',
  };
  return replaceView(updatedView, labels[edge]);
}

/** Keeps the sorted endpoints fixed and makes the gaps between bounding boxes equal. */
export function planDistribute(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  axis: DistributeAxis,
  heights?: MeasuredHeights,
  noteIds: readonly Id[] = [],
): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  const totalCount = elementIds.length + noteIds.length;
  if (totalCount < 3) return reject('Select at least 3 components to distribute');

  const placements = elementIds.length > 0 ? selectedPlacements(view, elementIds) : [];
  if (elementIds.length > 0 && !placements) return reject('Every selected component must be placed in this view');

  const notes = noteIds.length > 0 ? selectedNotes(view, noteIds) : [];
  if (noteIds.length > 0 && !notes) return reject('Every selected note must exist in this view');

  type DistItem =
    | { kind: 'placement'; record: Placement; id: string; size: number; x: number; y: number }
    | { kind: 'note'; record: Note; id: string; size: number; x: number; y: number };

  const items: DistItem[] = [
    ...(placements ?? []).map((p) => ({
      kind: 'placement' as const,
      record: p,
      id: p.elementId,
      size: axis === 'x' ? p.width : placementHeight(p, heights),
      x: p.x,
      y: p.y,
    })),
    ...(notes ?? []).map((n) => ({
      kind: 'note' as const,
      record: n,
      id: n.id,
      size: axis === 'x' ? (n.width ?? DEFAULT_NOTE_WIDTH) : (heights?.get(n.id) ?? 100),
      x: n.x,
      y: n.y,
    })),
  ];

  const ordered = [...items].sort((a, b) => {
    const delta = axis === 'x' ? a.x - b.x : a.y - b.y;
    return delta || a.id.localeCompare(b.id);
  });

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const start = axis === 'x' ? first.x : first.y;
  const end = (axis === 'x' ? last.x : last.y) + last.size;
  const totalSize = ordered.reduce((sum, item) => sum + item.size, 0);
  const gap = (end - start - totalSize) / (ordered.length - 1);

  const placementReplacements = new Map<Id, Placement>();
  const noteReplacements = new Map<Id, Note>();
  let cursor = start;

  for (const item of ordered) {
    if (item.kind === 'placement') {
      placementReplacements.set(
        item.record.id,
        axis === 'x' ? { ...item.record, x: cursor } : { ...item.record, y: cursor },
      );
    } else {
      noteReplacements.set(
        item.record.id,
        axis === 'x'
          ? { ...item.record, x: Math.round(cursor) }
          : { ...item.record, y: Math.round(cursor) },
      );
    }
    cursor += item.size + gap;
  }

  const updatedView = {
    ...view,
    placements: view.placements.map((p) => placementReplacements.get(p.id) ?? p),
    notes: view.notes.map((n) => noteReplacements.get(n.id) ?? n),
  };

  return replaceView(
    updatedView,
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
  attachedElementIds: readonly Id[] = [],
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
    attachedElementIds: [...attachedElementIds],
  };
  return replaceView({ ...view, notes: [...view.notes, note] }, 'Add note');
}

/** Updates an existing note's text, tone, attached elements, or position. */
export function planUpdateNote(
  document: Document,
  viewId: Id,
  noteId: Id,
  updates: {
    readonly text?: string;
    readonly attachedElementIds?: readonly Id[];
    readonly tone?: Note['tone'];
    readonly position?: { readonly x: number; readonly y: number };
  },
): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  const index = view.notes.findIndex((n) => n.id === noteId);
  if (index < 0) return reject('The note no longer exists');
  const existing = view.notes[index];
  const nextText = updates.text !== undefined ? updates.text.trim() : existing.text;
  if (codePointLength(nextText) === 0) return reject('Enter note text');
  if (codePointLength(nextText) > NOTE_TEXT_MAX_LENGTH) {
    return reject(`Use ${NOTE_TEXT_MAX_LENGTH} characters or fewer`);
  }
  const nextNote: Note = {
    ...existing,
    text: nextText,
    tone: updates.tone ?? existing.tone,
    attachedElementIds: updates.attachedElementIds ? [...updates.attachedElementIds] : existing.attachedElementIds,
    x: updates.position ? Math.round(updates.position.x) : existing.x,
    y: updates.position ? Math.round(updates.position.y) : existing.y,
  };
  const updatedNotes = [...view.notes];
  updatedNotes[index] = nextNote;
  return replaceView({ ...view, notes: updatedNotes }, 'Update note');
}

/** Deletes a note from the active view. */
export function planDeleteNote(
  document: Document,
  viewId: Id,
  noteId: Id,
): SelectionPlan {
  const view = findView(document, viewId);
  if (!view) return reject('The active view no longer exists');
  const updatedNotes = view.notes.filter((n) => n.id !== noteId);
  if (updatedNotes.length === view.notes.length) return reject('The note no longer exists');
  return replaceView({ ...view, notes: updatedNotes }, 'Delete note');
}


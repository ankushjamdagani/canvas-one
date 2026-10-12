/** Pure, atomic placement planner for detached parts. */

import type {
  Connection,
  Document,
  Element,
  Fixture,
  Id,
  PayloadSchema,
  Refinement,
  Relation,
  View,
} from '../studio/model.js';
import { validateDocument, type Issue } from '../studio/validate.js';
import { remapContent, type MintId } from './remap.js';
import type { PartContent } from './types.js';

export type PlacementAnchor = { readonly x: number; readonly y: number };

type InsertablePartRecord =
  | { readonly recordKind: 'element'; readonly record: Element }
  | { readonly recordKind: 'connection'; readonly record: Connection }
  | { readonly recordKind: 'relation'; readonly record: Relation }
  | { readonly recordKind: 'schema'; readonly record: PayloadSchema }
  | { readonly recordKind: 'fixture'; readonly record: Fixture }
  | { readonly recordKind: 'refinement'; readonly record: Refinement };

/** Structurally compatible with the model.apply-records RecordChange boundary. */
export type PlacementRecordChange =
  | { readonly kind: 'insert'; readonly value: InsertablePartRecord }
  | { readonly kind: 'replace'; readonly value: { readonly recordKind: 'view'; readonly record: View } };

export type PlacementPlanResult =
  | {
      readonly ok: true;
      readonly changes: PlacementRecordChange[];
      readonly newElementIds: Id[];
    }
  | { readonly ok: false; readonly issues: readonly Issue[] };

function placementIssue(message: string, path: readonly (string | number)[] = []): Issue {
  return {
    code: 'structural-rule',
    path,
    entityId: null,
    severity: 'error',
    message,
  };
}

/**
 * Remaps, offsets, and pre-validates one RecordChange batch. The caller submits the
 * returned array through one model.apply-records command, producing one undo entry.
 */
export function planPlacement(
  document: Document,
  viewId: Id,
  content: PartContent,
  anchor: PlacementAnchor,
  mintId: MintId,
): PlacementPlanResult {
  const view = document.views.find((candidate) => candidate.id === viewId);
  if (!view) return { ok: false, issues: [placementIssue('The active view no longer exists.', ['viewId'])] };
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return { ok: false, issues: [placementIssue('The placement anchor must use finite coordinates.', ['anchor'])] };
  }

  let remapped: PartContent;
  try {
    remapped = remapContent(content, mintId);
  } catch (error) {
    return {
      ok: false,
      issues: [
        placementIssue(
          error instanceof Error ? error.message : 'The part could not be remapped into a closed destination copy.',
          ['content'],
        ),
      ],
    };
  }

  const offsetPlacements = remapped.view.placements.map((placement) => ({
    ...placement,
    x: placement.x + anchor.x,
    y: placement.y + anchor.y,
  }));
  const offsetNotes = remapped.view.notes.map((note) => ({
    ...note,
    x: note.x + anchor.x,
    y: note.y + anchor.y,
  }));
  const replacementView = {
    ...view,
    placements: [...view.placements, ...offsetPlacements],
    connectionIds: [...view.connectionIds, ...remapped.connections.map((connection) => connection.id)],
    relationIds: [...view.relationIds, ...remapped.relations.map((relation) => relation.id)],
    groups: [...view.groups, ...remapped.view.groups],
    notes: [...view.notes, ...offsetNotes],
  };

  const changes: PlacementRecordChange[] = [
    ...remapped.schemas.map((record) => ({ kind: 'insert' as const, value: { recordKind: 'schema' as const, record } })),
    ...remapped.fixtures.map((record) => ({ kind: 'insert' as const, value: { recordKind: 'fixture' as const, record } })),
    ...remapped.elements.map((record) => ({ kind: 'insert' as const, value: { recordKind: 'element' as const, record } })),
    ...remapped.connections.map((record) => ({ kind: 'insert' as const, value: { recordKind: 'connection' as const, record } })),
    ...remapped.relations.map((record) => ({ kind: 'insert' as const, value: { recordKind: 'relation' as const, record } })),
    ...remapped.refinements.map((record) => ({ kind: 'insert' as const, value: { recordKind: 'refinement' as const, record } })),
    { kind: 'replace', value: { recordKind: 'view', record: replacementView } },
  ];

  const candidate: Document = {
    ...document,
    schemas: [...document.schemas, ...remapped.schemas],
    fixtures: [...document.fixtures, ...remapped.fixtures],
    elements: [...document.elements, ...remapped.elements],
    connections: [...document.connections, ...remapped.connections],
    relations: [...document.relations, ...remapped.relations],
    refinements: [...document.refinements, ...remapped.refinements],
    views: document.views.map((candidateView) => candidateView.id === viewId ? replacementView : candidateView),
  };

  // Validate the exact would-be document, including aggregate limits, nested IDs,
  // and all cross-record references, before exposing a mutation batch.
  const validation = validateDocument(candidate);
  if (!validation.ok) return { ok: false, issues: validation.issues };

  return {
    ok: true,
    changes,
    newElementIds: remapped.elements.map((element) => element.id),
  };
}

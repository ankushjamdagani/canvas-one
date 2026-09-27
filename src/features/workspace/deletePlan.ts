/**
 * Delete dependency preview (RV-12e).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/commands.md §4 "Dependency preview" and `selection.delete`
 *   ("removing an element also removes its placements, its connections and their
 *   view connectionIds; if a scenario references the element or its ports, show
 *   the list and require confirmation")
 * - specs/revamp/screens/16D_Selection_scoped_actions.png (delete action only)
 *
 * This is a local, pure implementation of the "dependency preview" idea scoped to
 * what RV-12e needs (compute removals for a canvas selection before one
 * model.apply-records command). It does not implement the full
 * `previewDependencies` RPC shape (dependencyPreviewId / boundRevision / stale /
 * missing / invalid) from commands.md §4 -- that lives with the session/command
 * boundary, which is out of scope for this task's allowed files. See CONTRACT
 * GAPS in the task summary.
 *
 * No scenario repair is invented: when a scenario would become invalid after the
 * delete, this only reports *which* scenarios need attention -- it never edits or
 * drops scenario content itself.
 */

import type { Document, Id, View } from '../../domain/studio/model';
import type { RecordChange } from '../../persistence/studio/types';

export type DeleteSelection = {
  readonly elementIds: readonly Id[];
  readonly connectionIds: readonly Id[];
};

export type DeletePlan = {
  /** Elements that will be removed (the selection, filtered to ids that exist). */
  readonly removedElementIds: readonly Id[];
  /** Placements removed as a consequence of removing their element. */
  readonly removedPlacementIds: readonly Id[];
  /** Every connection removed: explicitly selected, plus any touching a removed element. */
  readonly removedConnectionIds: readonly Id[];
  /** Labels of scenarios that reference a removed element, port or connection. */
  readonly affectedScenarioLabels: readonly string[];
  /** True when at least one scenario needs attention -- the UI must confirm before applying. */
  readonly requiresConfirmation: boolean;
  /** The one model.apply-records batch to send on confirm; empty when nothing to remove. */
  readonly changes: readonly RecordChange[];
};

/**
 * Recursively scans a JSON-ish value for any string equal to one of `ids`.
 * Used to detect scenario references to removed elements/ports/connections
 * without hard-coding every nested Scenario field shape (Workload.entry,
 * Fault.hostId, Boundary.source, AssertionSubject.elementId, etc. all resolve
 * to plain string ids somewhere in the structure).
 */
function containsAnyId(value: unknown, ids: ReadonlySet<Id>): boolean {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some((v) => containsAnyId(v, ids));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => containsAnyId(v, ids));
  }
  return false;
}

/**
 * Computes what removing `selection` from `viewId` would take with it, as one
 * pure batch of RecordChanges (one model.apply-records command == one undo).
 */
export function planDelete(document: Document, viewId: Id, selection: DeleteSelection): DeletePlan {
  const view = document.views.find((v) => v.id === viewId);
  if (!view) {
    return {
      removedElementIds: [],
      removedPlacementIds: [],
      removedConnectionIds: [],
      affectedScenarioLabels: [],
      requiresConfirmation: false,
      changes: [],
    };
  }

  const elementIdSet = new Set(document.elements.map((e) => e.id));
  const removedElementIds = selection.elementIds.filter((id) => elementIdSet.has(id));
  const removedElementIdSet = new Set(removedElementIds);

  const removedPlacementIds = view.placements
    .filter((p) => removedElementIdSet.has(p.elementId))
    .map((p) => p.id);

  const connectionIdSet = new Set(document.connections.map((c) => c.id));
  const explicitConnectionIds = selection.connectionIds.filter((id) => connectionIdSet.has(id));

  const touchingConnectionIds = document.connections
    .filter(
      (c) => removedElementIdSet.has(c.source.elementId) || removedElementIdSet.has(c.target.elementId),
    )
    .map((c) => c.id);

  const removedConnectionIds = Array.from(new Set([...explicitConnectionIds, ...touchingConnectionIds]));
  const removedConnectionIdSet = new Set(removedConnectionIds);

  // Ports carried by removed elements, so a scenario referencing a port (not
  // the element id itself) is still caught.
  const removedPortIds = new Set<Id>();
  for (const element of document.elements) {
    if (!removedElementIdSet.has(element.id)) continue;
    for (const port of element.ports) removedPortIds.add(port.id);
  }

  const referencedIds = new Set<Id>([...removedElementIdSet, ...removedPortIds, ...removedConnectionIdSet]);

  const affectedScenarioLabels = document.scenarios
    .filter((scenario) => containsAnyId(scenario, referencedIds))
    .map((scenario) => scenario.label);

  const updatedView: View = {
    ...view,
    placements: view.placements.filter((p) => !removedPlacementIds.includes(p.id)),
    connectionIds: view.connectionIds.filter((id) => !removedConnectionIdSet.has(id)),
  };

  const changes: RecordChange[] = [];
  for (const connectionId of removedConnectionIds) {
    changes.push({ kind: 'remove', recordKind: 'connection', id: connectionId });
  }
  for (const elementId of removedElementIds) {
    changes.push({ kind: 'remove', recordKind: 'element', id: elementId });
  }
  if (removedPlacementIds.length > 0 || removedConnectionIds.length > 0) {
    changes.push({ kind: 'replace', value: { recordKind: 'view', record: updatedView } });
  }

  return {
    removedElementIds,
    removedPlacementIds,
    removedConnectionIds,
    affectedScenarioLabels,
    requiresConfirmation: affectedScenarioLabels.length > 0,
    changes,
  };
}

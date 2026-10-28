/**
 * Delete dependency preview.
 *
 * Removing an element also removes its placements, its connections and their
 * view connectionIds. If a scenario references the element or its ports, the
 * plan lists them and requires confirmation. This is a pure computation of the
 * removals for a canvas selection before one model.apply-records command; it
 * does not use the session's preview-dependencies call.
 *
 * Repairs: every record that would dangle after the delete is repaired in the
 * same batch, so the compound command validates. Scenario members (entry ports, inputs, workloads, faults,
 * boundaries, initial contexts, assertions) that reference a removed element,
 * port or connection are dropped, scope lists are pruned, deployment/containment
 * relations and refinements that involve a removed element are removed or
 * pruned, and every view drops placements, group members and note attachments.
 * The batch is dry-run through applyRecordChanges; if it still cannot validate
 * the plan is `blocked` with the reason so the UI never offers a confirm that
 * would fail silently.
 */

import type { Document, Id, Refinement, Scenario, View } from '../studio/model.js';
import { applyRecordChanges } from './apply-records.js';
import type { RecordChange } from '../studio/records.js';

export type DeleteSelection = {
  readonly elementIds: readonly Id[];
  readonly connectionIds: readonly Id[];
  readonly noteIds?: readonly Id[];
  readonly canvasElementIds?: readonly Id[];
};

export type DeletePlan = {
  readonly intent: 'delete' | 'replace';
  /** Elements that will be removed (the selection, filtered to ids that exist). */
  readonly removedElementIds: readonly Id[];
  /** Placements removed as a consequence of removing their element. */
  readonly removedPlacementIds: readonly Id[];
  /** Every connection removed: explicitly selected, plus any touching a removed element. */
  readonly removedConnectionIds: readonly Id[];
  /** Labels of scenarios that reference a removed element, port or connection. */
  readonly affectedScenarioLabels: readonly string[];
  /** One line per scenario repair, e.g. "Accepted and fulfilled: 2 inputs, 1 assertion removed". */
  readonly scenarioRepairSummaries: readonly string[];
  /** Set when the repaired batch still fails validation; the UI must not offer confirm. */
  readonly blockedReason: string | null;
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

export function planDelete(document: Document, viewId: Id, selection: DeleteSelection): DeletePlan {
  const view = document.views.find((v) => v.id === viewId);
  if (!view) {
    return {
      intent: 'delete',
      removedElementIds: [],
      removedPlacementIds: [],
      removedConnectionIds: [],
      affectedScenarioLabels: [],
      scenarioRepairSummaries: [],
      blockedReason: null,
      requiresConfirmation: false,
      changes: [],
    };
  }

  const elementIdSet = new Set(document.elements.map((e) => e.id));
  const removedElementIds = selection.elementIds.filter((id) => elementIdSet.has(id));
  const removedElementIdSet = new Set(removedElementIds);

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

  // Relations touching a removed element go with it.
  const removedRelationIds = new Set<Id>(
    document.relations.filter((r) => containsAnyId(r, removedElementIdSet)).map((r) => r.id),
  );

  // Refinements: owner removed -> the refinement goes; otherwise prune members/mappings.
  const removedRefinementIds = new Set<Id>();
  const refinementReplacements: Refinement[] = [];
  for (const refinement of document.refinements) {
    if (removedElementIdSet.has(refinement.ownerElementId)) {
      removedRefinementIds.add(refinement.id);
      continue;
    }
    if (!containsAnyId(refinement, referencedIds)) continue;
    refinementReplacements.push({
      ...refinement,
      memberElementIds: refinement.memberElementIds.filter((id) => !removedElementIdSet.has(id)),
      portMappings: refinement.portMappings.filter((m) => !containsAnyId(m, referencedIds)),
    });
  }

  // Scenarios: drop referencing members, report what was dropped.
  const scenarioReplacements: Scenario[] = [];
  const affectedScenarioLabels: string[] = [];
  const scenarioRepairSummaries: string[] = [];
  for (const scenario of document.scenarios) {
    const dropped: string[] = [];
    const prune = <T,>(items: readonly T[], singular: string, plural: string): T[] => {
      const kept = items.filter((item) => !containsAnyId(item, referencedIds));
      const n = items.length - kept.length;
      if (n > 0) dropped.push(`${n} ${n === 1 ? singular : plural}`);
      return kept;
    };
    const scopeElementIds = scenario.scopeElementIds.filter((id) => !removedElementIdSet.has(id));
    if (scopeElementIds.length !== scenario.scopeElementIds.length) {
      const n = scenario.scopeElementIds.length - scopeElementIds.length;
      dropped.push(`${n} scope ${n === 1 ? 'element' : 'elements'}`);
    }
    const next: Scenario = {
      ...scenario,
      scopeElementIds,
      entryPorts: prune(scenario.entryPorts, 'entry port', 'entry ports'),
      inputs: prune(scenario.inputs, 'input', 'inputs'),
      workloads: prune(scenario.workloads, 'workload', 'workloads'),
      faults: prune(scenario.faults, 'fault', 'faults'),
      boundaries: prune(scenario.boundaries, 'boundary', 'boundaries'),
      initialContexts: prune(scenario.initialContexts, 'initial context', 'initial contexts'),
      assertions: prune(scenario.assertions, 'assertion', 'assertions'),
      refinementSelections: scenario.refinementSelections.filter(
        (s) => !removedRefinementIds.has(s.refinementId),
      ),
    };
    if (next.refinementSelections.length !== scenario.refinementSelections.length) {
      const n = scenario.refinementSelections.length - next.refinementSelections.length;
      dropped.push(`${n} refinement ${n === 1 ? 'selection' : 'selections'}`);
    }
    if (dropped.length > 0) {
      scenarioReplacements.push(next);
      affectedScenarioLabels.push(scenario.label);
      scenarioRepairSummaries.push(`${scenario.label}: ${dropped.join(', ')} removed`);
    }
  }

  // Views: every view drops what points at the removed records, and active view removes selected notes.
  const removedPlacementIds: Id[] = [];
  const removedNoteIdSet = new Set(selection.noteIds ?? []);
  const removedCanvasElementIdSet = new Set(selection.canvasElementIds ?? []);
  const viewReplacements: View[] = [];
  for (const v of document.views) {
    const placements = v.placements.filter((p) => !removedElementIdSet.has(p.elementId));
    for (const p of v.placements) if (removedElementIdSet.has(p.elementId)) removedPlacementIds.push(p.id);
    const connectionIds = v.connectionIds.filter((id) => !removedConnectionIdSet.has(id));
    const relationIds = v.relationIds.filter((id) => !removedRelationIds.has(id));
    const groups = v.groups
      .map((g) => ({ ...g, elementIds: g.elementIds.filter((id) => !removedElementIdSet.has(id)) }))
      .filter((g, i) => g.elementIds.length === v.groups[i].elementIds.length || g.elementIds.length > 0);
    const notes = v.notes
      .filter((n) => !removedNoteIdSet.has(n.id))
      .map((n) =>
        n.attachedElementIds.some((id) => removedElementIdSet.has(id))
          ? { ...n, attachedElementIds: n.attachedElementIds.filter((id) => !removedElementIdSet.has(id)) }
          : n,
      );
    const canvasElements = v.canvasElements?.filter(shape => v.id !== viewId || !removedCanvasElementIdSet.has(shape.id));
    const changed =
      canvasElements?.length !== v.canvasElements?.length ||
      placements.length !== v.placements.length ||
      connectionIds.length !== v.connectionIds.length ||
      relationIds.length !== v.relationIds.length ||
      groups.length !== v.groups.length ||
      groups.some((g, i) => g.elementIds.length !== v.groups[i]?.elementIds.length) ||
      notes.length !== v.notes.length ||
      notes.some((n, i) => n !== v.notes[i]);
    if (changed) viewReplacements.push({ ...v, placements, connectionIds, relationIds, groups, notes, ...(canvasElements ? { canvasElements } : {}) });
  }

  const changes: RecordChange[] = [];
  for (const connectionId of removedConnectionIds) {
    changes.push({ kind: 'remove', recordKind: 'connection', id: connectionId });
  }
  for (const relationId of removedRelationIds) {
    changes.push({ kind: 'remove', recordKind: 'relation', id: relationId });
  }
  for (const refinementId of removedRefinementIds) {
    changes.push({ kind: 'remove', recordKind: 'refinement', id: refinementId });
  }
  for (const elementId of removedElementIds) {
    changes.push({ kind: 'remove', recordKind: 'element', id: elementId });
  }
  for (const record of refinementReplacements) {
    changes.push({ kind: 'replace', value: { recordKind: 'refinement', record } });
  }
  for (const record of scenarioReplacements) {
    changes.push({ kind: 'replace', value: { recordKind: 'scenario', record } });
  }
  for (const record of viewReplacements) {
    changes.push({ kind: 'replace', value: { recordKind: 'view', record } });
  }

  // Dry-run: never offer a confirm that the model would reject.
  let blockedReason: string | null = null;
  if (changes.length > 0) {
    const dry = applyRecordChanges(document, changes);
    if (!dry.ok) {
      blockedReason = dry.issues[0]?.message ?? 'The remaining project would be invalid.';
    }
  }

  return {
    intent: 'delete',
    removedElementIds,
    removedPlacementIds,
    removedConnectionIds,
    affectedScenarioLabels,
    scenarioRepairSummaries,
    blockedReason,
    requiresConfirmation: affectedScenarioLabels.length > 0 || blockedReason !== null,
    changes,
  };
}

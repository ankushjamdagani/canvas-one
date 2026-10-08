/** Pure capture planner for detached parts. */

import { canonicalJson } from '../studio/canonical';
import type {
  Document,
  Element,
  Id,
  PayloadSchema,
  Relation,
} from '../studio/model';
import type { Issue } from '../studio/validate';
import type { CapturePreview, CaptureResult, CaptureSelection, PartContent } from './types';
import { createIssue } from '../studio/issue';

const PART_LIMITS = {
  elements: 50,
  connections: 100,
  relations: 100,
  notes: 50,
  bytes: 512 * 1024,
} as const;

function smallerSelectionIssue(kind: string, actual: number, maximum: number): Issue {
  return createIssue(
    'too-many',
    `The captured part has ${actual} ${kind}, exceeding the limit of ${maximum}. Select a smaller set of elements.`,
    [kind],
  );
}

function relationEndpoints(relation: Relation): readonly Id[] {
  switch (relation.kind) {
    case 'contains':
      return [relation.parentId, relation.childId];
    case 'deployed-on':
      return [relation.elementId, relation.hostId];
    case 'descriptive':
      return [relation.sourceId, relation.targetId];
  }
}

function schemaReferences(element: Element): Id[] {
  const ids: Id[] = [];
  for (const port of element.ports) {
    ids.push(port.schemaId);
    if (port.responseSchemaId !== null) ids.push(port.responseSchemaId);
  }
  const behavior = element.behavior;
  if (behavior.kind === 'machine') {
    ids.push(behavior.contextSchemaId);
  } else if (behavior.kind === 'pipeline') {
    ids.push(behavior.inputSchemaId, behavior.outputSchemaId, behavior.errorSchemaId);
    for (const operation of behavior.operations) {
      if (operation.kind === 'validate') ids.push(operation.schemaId);
    }
  } else if (behavior.kind === 'decision') {
    ids.push(behavior.inputSchemaId);
  }
  return ids;
}

function uniqueInOrder<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/**
 * Captures a nonempty element selection from one view without mutating the document.
 * Required model dependencies close explicitly; ordinary external neighbors do not.
 */
export function captureSelection(
  document: Document,
  viewId: Id,
  selection: CaptureSelection,
): CaptureResult {
  const view = document.views.find((candidate) => candidate.id === viewId);
  if (!view) return { ok: false, issues: [createIssue('dangling-reference', 'The active view no longer exists.', ['viewId'])] };

  const selectedIds = uniqueInOrder(selection.elementIds);
  if (selectedIds.length === 0) {
    return { ok: false, issues: [createIssue('structural-rule', 'Select at least one element to capture.', ['selection', 'elementIds'])] };
  }

  const elementsById = new Map(document.elements.map((element) => [element.id, element]));
  const placementsByElementId = new Map(view.placements.map((placement) => [placement.elementId, placement]));
  const notesById = new Map(view.notes.map((note) => [note.id, note]));
  const schemasById = new Map(document.schemas.map((schema) => [schema.id, schema]));
  const fixturesById = new Map(document.fixtures.map((fixture) => [fixture.id, fixture]));
  const refinementsByOwner = new Map(document.refinements.map((refinement) => [refinement.ownerElementId, refinement]));
  const refinementByMember = new Map<Id, (typeof document.refinements)[number]>();
  for (const refinement of document.refinements) {
    for (const memberId of refinement.memberElementIds) refinementByMember.set(memberId, refinement);
  }

  const issues: Issue[] = [];
  for (let index = 0; index < selectedIds.length; index++) {
    const elementId = selectedIds[index];
    if (!elementsById.has(elementId)) {
      issues.push(createIssue('dangling-reference', 'A selected element no longer exists.', ['selection', 'elementIds', index]));
    } else if (!placementsByElementId.has(elementId)) {
      issues.push(createIssue('dangling-reference', 'A selected element is not placed in the active view.', ['selection', 'elementIds', index]));
    }
  }
  for (let index = 0; index < selection.noteIds.length; index++) {
    if (!notesById.has(selection.noteIds[index])) {
      issues.push(createIssue('dangling-reference', 'A selected note no longer exists in the active view.', ['selection', 'noteIds', index]));
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  // Owner selection recursively includes the complete refinement member closure.
  const includedElementIds = new Set<Id>(selectedIds);
  const queue = [...selectedIds];
  while (queue.length > 0) {
    const refinement = refinementsByOwner.get(queue.shift()!);
    if (!refinement) continue;
    for (const memberId of refinement.memberElementIds) {
      if (!includedElementIds.has(memberId)) {
        includedElementIds.add(memberId);
        queue.push(memberId);
      }
    }
  }

  // A member cannot be detached from an unselected owner: its port mappings and
  // aggregate/refined semantics are required dependencies, not ordinary neighbors.
  for (const elementId of includedElementIds) {
    const ownerRefinement = refinementByMember.get(elementId);
    if (ownerRefinement && !includedElementIds.has(ownerRefinement.ownerElementId)) {
      issues.push(
        createIssue(
          'dangling-reference',
          'The selection contains an internal refinement member without its owner. Expand the selection to include the full refinement or cancel.',
          ['selection', 'elementIds'],
        ),
      );
    }
  }

  for (const elementId of includedElementIds) {
    if (!elementsById.has(elementId)) {
      issues.push(createIssue('dangling-reference', 'A refinement member required by the selection is missing.', ['refinements']));
    }
  }

  const includedElements = document.elements.filter((element) => includedElementIds.has(element.id));
  if (includedElements.length > PART_LIMITS.elements) {
    issues.push(smallerSelectionIssue('elements', includedElements.length, PART_LIMITS.elements));
  }

  const requiredSchemaIds = new Set<Id>();
  const requiredFixtureIds = new Set<Id>();
  for (const element of includedElements) {
    schemaReferences(element).forEach((schemaId) => requiredSchemaIds.add(schemaId));
    if (element.behavior.kind === 'machine') {
      requiredFixtureIds.add(element.behavior.initialContextFixtureId);
      if (!fixturesById.has(element.behavior.initialContextFixtureId)) {
        issues.push(
          createIssue(
            'dangling-reference',
            'A selected machine is missing its required initial context fixture.',
            ['elements', document.elements.indexOf(element), 'behavior', 'initialContextFixtureId'],
          ),
        );
      }
    }
  }

  const requiredFixtures = document.fixtures.filter((fixture) => requiredFixtureIds.has(fixture.id));
  requiredFixtures.forEach((fixture) => requiredSchemaIds.add(fixture.schemaId));
  for (const schemaId of requiredSchemaIds) {
    if (!schemasById.has(schemaId)) {
      issues.push(createIssue('dangling-reference', 'A selected element or fixture is missing a required payload schema.', ['schemas']));
    }
  }

  const requiredRefinements = document.refinements.filter(
    (refinement) =>
      includedElementIds.has(refinement.ownerElementId) &&
      refinement.memberElementIds.every((memberId) => includedElementIds.has(memberId)),
  );

  const includedConnections = document.connections.filter(
    (connection) =>
      includedElementIds.has(connection.source.elementId) && includedElementIds.has(connection.target.elementId),
  );
  const excludedConnections = document.connections.filter((connection) => {
    const sourceIncluded = includedElementIds.has(connection.source.elementId);
    const targetIncluded = includedElementIds.has(connection.target.elementId);
    return sourceIncluded !== targetIncluded;
  });
  if (includedConnections.length > PART_LIMITS.connections) {
    issues.push(smallerSelectionIssue('connections', includedConnections.length, PART_LIMITS.connections));
  }

  const includedRelations = document.relations.filter((relation) =>
    relationEndpoints(relation).every((elementId) => includedElementIds.has(elementId)),
  );
  const excludedRelations = document.relations.filter((relation) => {
    const includedCount = relationEndpoints(relation).filter((elementId) => includedElementIds.has(elementId)).length;
    return includedCount > 0 && includedCount < relationEndpoints(relation).length;
  });
  if (includedRelations.length > PART_LIMITS.relations) {
    issues.push(smallerSelectionIssue('relations', includedRelations.length, PART_LIMITS.relations));
  }
  if (excludedRelations.some((relation) => relation.kind === 'deployed-on')) {
    issues.push(
      createIssue(
        'dangling-reference',
        'A deployed-on relationship crosses the selection boundary. Include both the deployed element and its host or cancel.',
        ['relations'],
      ),
    );
  }

  if (issues.length > 0) return { ok: false, issues };

  const includedGroups = view.groups.filter(
    (group) =>
      group.elementIds.length > 0 &&
      group.elementIds.every((elementId) => includedElementIds.has(elementId)),
  );
  const omittedPartialGroups = view.groups.filter((group) => {
    const includedCount = group.elementIds.filter((elementId) => includedElementIds.has(elementId)).length;
    return includedCount > 0 && includedCount < group.elementIds.length;
  });

  const explicitlySelectedNoteIds = new Set(selection.noteIds);
  const includedNotes = view.notes.filter((note) => {
    const whollyAttached =
      note.attachedElementIds.length > 0 &&
      note.attachedElementIds.every((elementId) => includedElementIds.has(elementId));
    const explicitAndClosed =
      explicitlySelectedNoteIds.has(note.id) &&
      note.attachedElementIds.every((elementId) => includedElementIds.has(elementId));
    return whollyAttached || explicitAndClosed;
  });
  const excludedNotes = view.notes.filter((note) => {
    if (includedNotes.includes(note)) return false;
    const hasIncludedAttachment = note.attachedElementIds.some((elementId) => includedElementIds.has(elementId));
    return explicitlySelectedNoteIds.has(note.id) || hasIncludedAttachment;
  });
  if (includedNotes.length > PART_LIMITS.notes) {
    return { ok: false, issues: [smallerSelectionIssue('notes', includedNotes.length, PART_LIMITS.notes)] };
  }

  const sourcePlacements = view.placements.filter((placement) => includedElementIds.has(placement.elementId));
  const selectedPlacements = selectedIds.map((elementId) => placementsByElementId.get(elementId)!).filter(Boolean);
  const minX =
    selectedPlacements.length > 0
      ? Math.min(...selectedPlacements.map((placement) => placement.x))
      : includedNotes.length > 0
      ? Math.min(...includedNotes.map((note) => note.x))
      : 0;
  const minY =
    selectedPlacements.length > 0
      ? Math.min(...selectedPlacements.map((placement) => placement.y))
      : includedNotes.length > 0
      ? Math.min(...includedNotes.map((note) => note.y))
      : 0;
  const placements = sourcePlacements.map((placement) => ({ ...placement, x: placement.x - minX, y: placement.y - minY }));
  const notes = includedNotes.map((note) => ({ ...note, x: note.x - minX, y: note.y - minY }));
  const schemas: PayloadSchema[] = document.schemas.filter((schema) => requiredSchemaIds.has(schema.id));

  const content: PartContent = {
    schema: 'studio-part-content/1',
    elements: includedElements,
    connections: includedConnections,
    relations: includedRelations,
    schemas,
    fixtures: requiredFixtures,
    refinements: requiredRefinements,
    view: { placements, groups: includedGroups, notes },
  };

  const encoded = canonicalJson(content, PART_LIMITS.bytes, ['content']);
  if (!encoded.ok) {
    return {
      ok: false,
      issues: encoded.issues.map((entry) => ({
        ...entry,
        message: 'The captured part exceeds the 512 KiB limit. Select a smaller set of elements.',
      })),
    };
  }

  const notices: string[] = [];
  if (excludedConnections.length > 0) notices.push(`${excludedConnections.length} external connection(s) will not be duplicated.`);
  if (excludedRelations.length > 0) notices.push(`${excludedRelations.length} external relation(s) will not be duplicated.`);
  if (omittedPartialGroups.length > 0) notices.push(`${omittedPartialGroups.length} partially selected group(s) will be omitted.`);
  if (excludedNotes.length > 0) notices.push(`${excludedNotes.length} mixed or external note(s) will be omitted.`);

  const connectedEndpointKeys = new Set<string>();
  for (const connection of includedConnections) {
    connectedEndpointKeys.add(`${connection.source.elementId}:${connection.source.portId}`);
    connectedEndpointKeys.add(`${connection.target.elementId}:${connection.target.portId}`);
  }
  const exposedPortCount = includedElements.reduce(
    (count, element) =>
      count + element.ports.filter((port) => !connectedEndpointKeys.has(`${element.id}:${port.id}`)).length,
    0,
  );
  const warnings = exposedPortCount > 0
    ? [`${exposedPortCount} copied port(s) will be left unconnected and require wiring.`]
    : [];
  const preview: CapturePreview = {
    selectedElementIds: selectedIds,
    includedElementIds: includedElements.map((element) => element.id),
    requiredSchemaIds: schemas.map((schema) => schema.id),
    requiredFixtureIds: requiredFixtures.map((fixture) => fixture.id),
    requiredRefinementIds: requiredRefinements.map((refinement) => refinement.id),
    includedConnectionIds: includedConnections.map((connection) => connection.id),
    includedRelationIds: includedRelations.map((relation) => relation.id),
    excludedConnectionIds: excludedConnections.map((connection) => connection.id),
    excludedRelationIds: excludedRelations.map((relation) => relation.id),
    includedGroupIds: includedGroups.map((group) => group.id),
    omittedPartialGroupIds: omittedPartialGroups.map((group) => group.id),
    includedNoteIds: includedNotes.map((note) => note.id),
    excludedNoteIds: excludedNotes.map((note) => note.id),
    notices,
    warnings,
  };

  return { ok: true, content, preview };
}

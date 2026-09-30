import { shapesCompatible } from '../../domain/studio/readiness';
import type {
  Assertion,
  Boundary,
  Connection,
  Document,
  Endpoint,
  Id,
  Input,
  PayloadSchema,
  Relation,
  Scenario,
  View,
  Workload,
} from '../../domain/studio/model';
import { applyRecordChanges } from '../../persistence/studio/apply-records';
import type { RecordChange, RecordKind } from '../../persistence/studio/types';
import { placeEntry } from '../catalog/place';

export type ReplacePlan = {
  readonly intent: 'replace';
  readonly newElementId: Id;
  readonly newPlacementId: Id;
  readonly movedConnectionIds: readonly Id[];
  readonly removedConnectionIds: readonly Id[];
  readonly affectedScenarioLabels: readonly string[];
  readonly scenarioRepairSummaries: readonly string[];
  readonly blockedReason: string | null;
  readonly requiresConfirmation: boolean;
  readonly changes: readonly RecordChange[];
};

export type ReplacePlanResult =
  | { readonly ok: true; readonly plan: ReplacePlan }
  | { readonly ok: false; readonly reason: string };

type CollectionKey = 'elements' | 'connections' | 'relations' | 'schemas' | 'fixtures' | 'refinements' | 'scenarios' | 'views';
const COLLECTIONS: readonly { readonly key: CollectionKey; readonly kind: RecordKind }[] = [
  { key: 'schemas', kind: 'schema' },
  { key: 'fixtures', kind: 'fixture' },
  { key: 'elements', kind: 'element' },
  { key: 'connections', kind: 'connection' },
  { key: 'relations', kind: 'relation' },
  { key: 'refinements', kind: 'refinement' },
  { key: 'scenarios', kind: 'scenario' },
  { key: 'views', kind: 'view' },
];

function endpointFor(endpoint: Endpoint, oldElementId: Id, newElementId: Id, ports: ReadonlyMap<Id, Id>): Endpoint | null {
  if (endpoint.elementId !== oldElementId) return endpoint;
  const portId = ports.get(endpoint.portId);
  return portId ? { elementId: newElementId, portId } : null;
}

function replaceElementId(id: Id, oldElementId: Id, newElementId: Id): Id {
  return id === oldElementId ? newElementId : id;
}

function replaceRelation(relation: Relation, oldElementId: Id, newElementId: Id): Relation {
  switch (relation.kind) {
    case 'contains':
      return { ...relation, parentId: replaceElementId(relation.parentId, oldElementId, newElementId), childId: replaceElementId(relation.childId, oldElementId, newElementId) };
    case 'deployed-on':
      return { ...relation, elementId: replaceElementId(relation.elementId, oldElementId, newElementId), hostId: replaceElementId(relation.hostId, oldElementId, newElementId) };
    case 'descriptive':
      return { ...relation, sourceId: replaceElementId(relation.sourceId, oldElementId, newElementId), targetId: replaceElementId(relation.targetId, oldElementId, newElementId) };
  }
}

function replaceAssertion(assertion: Assertion, oldElementId: Id, newElementId: Id, ports: ReadonlyMap<Id, Id>): Assertion | null {
  const subject = assertion.subject;
  if (subject.kind === 'output') {
    const port = endpointFor(subject.port, oldElementId, newElementId, ports);
    return port ? { ...assertion, subject: { ...subject, port } } : null;
  }
  if ('elementId' in subject && subject.elementId === oldElementId) {
    return { ...assertion, subject: { ...subject, elementId: newElementId } };
  }
  return assertion;
}

function replaceInput(input: Input, oldElementId: Id, newElementId: Id, ports: ReadonlyMap<Id, Id>): Input | null {
  const entry = endpointFor(input.entry, oldElementId, newElementId, ports);
  if (!entry) return null;
  const payloadBindings = [];
  for (const binding of input.payloadBindings) {
    const port = endpointFor(binding.source.port, oldElementId, newElementId, ports);
    if (!port) return null;
    payloadBindings.push({ ...binding, source: { ...binding.source, port } });
  }
  return { ...input, entry, payloadBindings };
}

function replaceWorkload(workload: Workload, oldElementId: Id, newElementId: Id, ports: ReadonlyMap<Id, Id>): Workload | null {
  const entry = endpointFor(workload.entry, oldElementId, newElementId, ports);
  return entry ? { ...workload, entry } : null;
}

function replaceBoundary(boundary: Boundary, oldElementId: Id, newElementId: Id, ports: ReadonlyMap<Id, Id>): Boundary | null {
  const source = endpointFor(boundary.source, oldElementId, newElementId, ports);
  return source ? { ...boundary, source } : null;
}

function replaceScenario(
  scenario: Scenario,
  oldElementId: Id,
  newElementId: Id,
  ports: ReadonlyMap<Id, Id>,
): { readonly scenario: Scenario; readonly removed: readonly string[] } {
  const removed: string[] = [];
  const prune = <T, R>(items: readonly T[], label: string, mapper: (item: T) => R | null): R[] => {
    const next: R[] = [];
    for (const item of items) {
      const mapped = mapper(item);
      if (mapped) next.push(mapped);
      else removed.push(label);
    }
    return next;
  };
  const entryPorts = prune(scenario.entryPorts, 'entry port', (endpoint) => endpointFor(endpoint, oldElementId, newElementId, ports));
  const inputs = prune(scenario.inputs, 'input', (input) => replaceInput(input, oldElementId, newElementId, ports));
  const workloads = prune(scenario.workloads, 'workload', (workload) => replaceWorkload(workload, oldElementId, newElementId, ports));
  const boundaries = prune(scenario.boundaries, 'boundary', (boundary) => replaceBoundary(boundary, oldElementId, newElementId, ports));
  const assertions = prune(scenario.assertions, 'check', (assertion) => replaceAssertion(assertion, oldElementId, newElementId, ports));
  return {
    scenario: {
      ...scenario,
      scopeElementIds: scenario.scopeElementIds.map((id) => replaceElementId(id, oldElementId, newElementId)),
      entryPorts,
      inputs,
      workloads,
      faults: scenario.faults.map((fault) => ({ ...fault, hostId: replaceElementId(fault.hostId, oldElementId, newElementId) })),
      boundaries,
      initialContexts: scenario.initialContexts.map((context) => ({ ...context, elementId: replaceElementId(context.elementId, oldElementId, newElementId) })),
      assertions,
    },
    removed,
  };
}

function recordChanges(from: Document, to: Document): RecordChange[] {
  const changes: RecordChange[] = [];
  for (const { key, kind } of COLLECTIONS) {
    const before = new Map(from[key].map((record) => [record.id, record]));
    const after = new Map(to[key].map((record) => [record.id, record]));
    for (const record of from[key]) if (!after.has(record.id)) changes.push({ kind: 'remove', recordKind: kind, id: record.id });
    for (const record of to[key]) {
      const prior = before.get(record.id);
      if (!prior) changes.push({ kind: 'insert', value: { recordKind: kind, record } } as RecordChange);
      else if (JSON.stringify(prior) !== JSON.stringify(record)) changes.push({ kind: 'replace', value: { recordKind: kind, record } } as RecordChange);
    }
  }
  return changes;
}

export function planReplacePart(
  document: Document,
  viewId: Id,
  oldElementId: Id,
  entryId: string,
  mintId: () => Id,
): ReplacePlanResult {
  const oldElement = document.elements.find((element) => element.id === oldElementId);
  if (!oldElement) return { ok: false, reason: 'The selected component no longer exists' };
  const view = document.views.find((candidate) => candidate.id === viewId);
  if (!view) return { ok: false, reason: 'The active view no longer exists' };
  const placement = view.placements.find((candidate) => candidate.elementId === oldElementId);
  if (!placement) return { ok: false, reason: 'The selected component is not placed in the active view' };
  if (document.refinements.some((refinement) => refinement.ownerElementId === oldElementId || refinement.memberElementIds.includes(oldElementId))) {
    return { ok: false, reason: 'A refinement owner or member cannot be replaced' };
  }

  const placed = placeEntry({ document, viewId, entryId, anchor: { x: placement.x, y: placement.y }, mintId });
  if (!placed.ok) {
    const first = placed.issues[0];
    return { ok: false, reason: first ? first.message : 'The replacement could not be created' };
  }
  const placedDocument = applyRecordChanges(document, placed.changes);
  if (!placedDocument.ok) {
    const first = placedDocument.issues[0];
    return { ok: false, reason: first ? first.message : 'The replacement could not be validated' };
  }
  const generated = placedDocument.document.elements.find((element) => element.id === placed.elementId);
  if (!generated) return { ok: false, reason: 'The replacement entry did not create a component' };
  const replacement = { ...generated, label: oldElement.label };
  const schemaById = new Map<Id, PayloadSchema>(placedDocument.document.schemas.map((schema) => [schema.id, schema]));
  // Each old port moves to the first compatible port of the replacement not already taken,
  // so two old ports never collapse onto one new port.
  const portMap = new Map<Id, Id>();
  const taken = new Set<Id>();
  for (const oldPort of oldElement.ports) {
    const oldSchema = schemaById.get(oldPort.schemaId);
    if (!oldSchema) continue;
    const compatible = replacement.ports.find((port) => {
      if (taken.has(port.id)) return false;
      if (port.direction !== oldPort.direction || port.channel !== oldPort.channel) return false;
      const newSchema = schemaById.get(port.schemaId);
      if (!newSchema || !shapesCompatible(oldSchema.shape, newSchema.shape)) return false;
      if (oldPort.responseSchemaId === null && port.responseSchemaId === null) return true;
      if (oldPort.responseSchemaId === null || port.responseSchemaId === null) return false;
      const oldResponse = schemaById.get(oldPort.responseSchemaId);
      const newResponse = schemaById.get(port.responseSchemaId);
      return Boolean(oldResponse && newResponse && shapesCompatible(oldResponse.shape, newResponse.shape));
    });
    if (compatible) {
      portMap.set(oldPort.id, compatible.id);
      taken.add(compatible.id);
    }
  }

  const movedConnectionIds: Id[] = [];
  const removedConnectionIds: Id[] = [];
  const connections: Connection[] = [];
  for (const connection of document.connections) {
    const source = endpointFor(connection.source, oldElementId, replacement.id, portMap);
    const target = endpointFor(connection.target, oldElementId, replacement.id, portMap);
    if (!source || !target) {
      removedConnectionIds.push(connection.id);
      continue;
    }
    if (source !== connection.source || target !== connection.target) movedConnectionIds.push(connection.id);
    connections.push({ ...connection, source, target });
  }

  const affectedScenarioLabels: string[] = [];
  const scenarioRepairSummaries: string[] = [];
  const scenarios = document.scenarios.map((scenario) => {
    const result = replaceScenario(scenario, oldElementId, replacement.id, portMap);
    const changed = JSON.stringify(result.scenario) !== JSON.stringify(scenario);
    if (changed) affectedScenarioLabels.push(scenario.label);
    if (result.removed.length > 0) scenarioRepairSummaries.push(`${scenario.label}: ${result.removed.join(', ')} removed`);
    return result.scenario;
  });

  const relations = document.relations.map((relation) => replaceRelation(relation, oldElementId, replacement.id));
  const removedConnectionSet = new Set(removedConnectionIds);
  const views: View[] = placedDocument.document.views.map((candidate) => ({
    ...candidate,
    placements: candidate.placements.filter((item) => item.elementId !== oldElementId),
    connectionIds: candidate.connectionIds.filter((id) => !removedConnectionSet.has(id)),
    groups: candidate.groups.map((group) => ({ ...group, elementIds: group.elementIds.map((id) => replaceElementId(id, oldElementId, replacement.id)) })),
    notes: candidate.notes.map((note) => ({ ...note, attachedElementIds: note.attachedElementIds.map((id) => replaceElementId(id, oldElementId, replacement.id)) })),
  }));
  const candidate: Document = {
    ...placedDocument.document,
    elements: placedDocument.document.elements.filter((element) => element.id !== oldElementId).map((element) => element.id === replacement.id ? replacement : element),
    connections,
    relations,
    scenarios,
    views,
  };
  const changes = recordChanges(document, candidate);
  const dryRun = applyRecordChanges(document, changes);
  const blockedReason = dryRun.ok ? null : (dryRun.issues[0]?.message ?? 'The replacement would leave the project invalid');
  return {
    ok: true,
    plan: {
      intent: 'replace',
      newElementId: replacement.id,
      newPlacementId: placed.placementId,
      movedConnectionIds,
      removedConnectionIds,
      affectedScenarioLabels,
      scenarioRepairSummaries,
      blockedReason,
      requiresConfirmation: removedConnectionIds.length > 0 || scenarioRepairSummaries.length > 0 || blockedReason !== null,
      changes,
    },
  };
}

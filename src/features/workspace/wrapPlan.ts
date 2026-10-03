/**
 * Pure planner for commands.md §4 selection.wrap-in-boundary.
 *
 * The resulting RecordChange[] is one model.apply-records batch: the new
 * aggregate owner, its refinement, every crossing connection, affected
 * scenarios, and the active view are changed atomically and therefore undo as
 * one authored gesture.
 */

import { computeClosure } from '../../domain/studio/closure';
import { defaultProtocol, portProtocol } from '../../domain/studio/protocols';
import type {
  Connection,
  Document,
  Element,
  Endpoint,
  Id,
  Placement,
  Port,
  Refinement,
  Scenario,
  View,
} from '../../domain/studio/model';
import type { RecordChange } from '../../persistence/studio/types';

export type WrapBoundaryPortIds = {
  readonly ownerPortId: Id;
  readonly mappingId: Id;
};

export type WrapBoundaryIds = {
  readonly ownerElementId: Id;
  readonly refinementId: Id;
  /** One pair, in crossing-endpoint order, for each owner port and mapping. */
  readonly portIds: readonly WrapBoundaryPortIds[];
  readonly placementId: Id;
};

export type WrapBoundaryRejectionCode =
  | 'empty-selection'
  | 'not-placed'
  | 'already-member'
  | 'invalid-label'
  | 'invalid-ids'
  | 'scenario-closure-failed';

export type WrapBoundaryPlan =
  | { readonly ok: true; readonly changes: RecordChange[]; readonly label: 'Wrap in boundary' }
  | { readonly ok: false; readonly code: WrapBoundaryRejectionCode; readonly reason: string };

const FRAME_PADDING = 24;
const LABEL_MAX_LENGTH = 80;

function reject(code: WrapBoundaryRejectionCode, reason: string): WrapBoundaryPlan {
  return { ok: false, code, reason };
}

function endpointKey(endpoint: Endpoint): string {
  return `${endpoint.elementId}\u0000${endpoint.portId}`;
}

function allDocumentIds(document: Document): Set<Id> {
  const ids = new Set<Id>();
  function collect(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string') ids.add(record.id);
    for (const entry of Object.values(record)) collect(entry);
  }
  collect(document);
  return ids;
}

/**
 * Distinct selected member ports used by connections that cross the selection.
 * Ordering is deterministic: document connection order, source before target.
 */
export function wrapBoundaryCrossingEndpoints(
  document: Document,
  elementIds: readonly Id[],
): readonly Endpoint[] {
  const selected = new Set(elementIds);
  const endpoints: Endpoint[] = [];
  const seen = new Set<string>();
  for (const connection of document.connections) {
    const sourceSelected = selected.has(connection.source.elementId);
    const targetSelected = selected.has(connection.target.elementId);
    if (sourceSelected === targetSelected) continue;
    const memberEndpoint = sourceSelected ? connection.source : connection.target;
    const key = endpointKey(memberEndpoint);
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push(memberEndpoint);
  }
  return endpoints;
}

function replaceCrossingEndpoint(
  connection: Connection,
  selected: ReadonlySet<Id>,
  ownerByMemberEndpoint: ReadonlyMap<string, Endpoint>,
): Connection {
  const sourceSelected = selected.has(connection.source.elementId);
  const targetSelected = selected.has(connection.target.elementId);
  if (sourceSelected === targetSelected) return connection;
  if (sourceSelected) {
    const source = ownerByMemberEndpoint.get(endpointKey(connection.source));
    if (!source) throw new Error(`Missing owner mapping for crossing endpoint '${endpointKey(connection.source)}'`);
    return { ...connection, source };
  }
  const target = ownerByMemberEndpoint.get(endpointKey(connection.target));
  if (!target) throw new Error(`Missing owner mapping for crossing endpoint '${endpointKey(connection.target)}'`);
  return { ...connection, target };
}

function updateScenario(
  scenario: Scenario,
  refinementId: Id,
  ownerElementId: Id,
  selected: ReadonlySet<Id>,
  reachesMember: boolean,
): Scenario {
  if (!reachesMember) return scenario;
  const memberInDeclaredScope = scenario.scopeElementIds.some((elementId) => selected.has(elementId));
  return {
    ...scenario,
    revision: scenario.revision + 1,
    scopeElementIds: memberInDeclaredScope
      ? [...scenario.scopeElementIds, ownerElementId]
      : scenario.scopeElementIds,
    refinementSelections: [...scenario.refinementSelections, { refinementId, mode: 'refined' }],
  };
}

/** Creates a behaviour-preserving refinement boundary around placed elements. */
export function planWrapInBoundary(
  document: Document,
  viewId: Id,
  elementIds: readonly Id[],
  ids: WrapBoundaryIds,
  rawLabel: string,
): WrapBoundaryPlan {
  if (elementIds.length === 0) return reject('empty-selection', 'Select at least 1 component to wrap');
  if (new Set(elementIds).size !== elementIds.length) {
    return reject('not-placed', 'Every selected component must be placed once in this view');
  }
  const view = document.views.find((candidate) => candidate.id === viewId);
  if (!view) return reject('not-placed', 'The active view no longer exists');
  const placementsByElement = new Map(view.placements.map((placement) => [placement.elementId, placement]));
  const placements: Placement[] = [];
  for (const elementId of elementIds) {
    const placement = placementsByElement.get(elementId);
    if (!placement) return reject('not-placed', 'Every selected component must be placed in this view');
    placements.push(placement);
  }

  const existingMemberIds = new Set(document.refinements.flatMap((refinement) => refinement.memberElementIds));
  if (elementIds.some((elementId) => existingMemberIds.has(elementId))) {
    return reject('already-member', 'A selected component already belongs to a refinement boundary');
  }

  const label = rawLabel.trim();
  if (label.length === 0) return reject('invalid-label', 'Enter a boundary name');
  if (Array.from(label).length > LABEL_MAX_LENGTH) {
    return reject('invalid-label', `Use ${LABEL_MAX_LENGTH} characters or fewer`);
  }

  const crossingEndpoints = wrapBoundaryCrossingEndpoints(document, elementIds);
  if (ids.portIds.length !== crossingEndpoints.length) {
    return reject('invalid-ids', `Expected ${crossingEndpoints.length} owner port id pair${crossingEndpoints.length === 1 ? '' : 's'}`);
  }
  const suppliedIds = [
    ids.ownerElementId,
    ids.refinementId,
    ids.placementId,
    ...ids.portIds.flatMap(({ ownerPortId, mappingId }) => [ownerPortId, mappingId]),
  ];
  const knownIds = allDocumentIds(document);
  if (new Set(suppliedIds).size !== suppliedIds.length || suppliedIds.some((id) => knownIds.has(id))) {
    return reject('invalid-ids', 'Every new boundary id must be unique and unused');
  }

  const elementsById = new Map(document.elements.map((element) => [element.id, element]));
  const portsByEndpoint = new Map<string, { readonly element: Element; readonly port: Port }>();
  for (const endpoint of crossingEndpoints) {
    const element = elementsById.get(endpoint.elementId);
    const port = element?.ports.find((candidate) => candidate.id === endpoint.portId);
    if (!element || !port) return reject('not-placed', 'A selected crossing port no longer exists');
    portsByEndpoint.set(endpointKey(endpoint), { element, port });
  }

  const ownerPorts: Port[] = [];
  const ownerByMemberEndpoint = new Map<string, Endpoint>();
  const portMappings: Refinement['portMappings'][number][] = [];
  crossingEndpoints.forEach((inner, index) => {
    const source = portsByEndpoint.get(endpointKey(inner));
    if (!source) throw new Error(`Missing crossing port '${endpointKey(inner)}'`);
    const portIds = ids.portIds[index];
    let ownerPort: Port = {
      id: portIds.ownerPortId,
      label: `${source.element.label} · ${source.port.label}`,
      direction: source.port.direction,
      channel: source.port.channel,
      schemaId: source.port.schemaId,
      responseSchemaId: source.port.responseSchemaId,
    };
    // D53: the owner is a custom node, so keep the inner port's protocol when it isn't the custom default.
    const innerProtocol = portProtocol(source.element, source.port);
    if (innerProtocol !== null && innerProtocol !== defaultProtocol('custom', source.port.channel)) {
      ownerPort = { ...ownerPort, protocol: innerProtocol };
    }
    ownerPorts.push(ownerPort);
    const outer = { elementId: ids.ownerElementId, portId: ownerPort.id };
    ownerByMemberEndpoint.set(endpointKey(inner), outer);
    portMappings.push({ id: portIds.mappingId, outer, inner });
  });

  const selected = new Set(elementIds);
  const owner: Element = {
    id: ids.ownerElementId,
    label,
    description: '',
    visualKind: 'custom',
    ports: ownerPorts,
    behavior: { kind: 'unmodeled', version: 1, reason: 'Aggregate behaviour not configured' },
  };
  const refinement: Refinement = {
    id: ids.refinementId,
    ownerElementId: owner.id,
    memberElementIds: [...elementIds],
    portMappings,
  };

  const scenarioReachability = new Map<Id, boolean>();
  for (const scenario of document.scenarios) {
    const closure = computeClosure(document, scenario.id);
    if (closure.status !== 'ok') {
      return reject('scenario-closure-failed', `Could not determine refinement reachability for '${scenario.label}'`);
    }
    scenarioReachability.set(
      scenario.id,
      [...closure.includedElementIds, ...closure.excludedElementIds]
        .some((elementId) => selected.has(elementId)),
    );
  }

  const minX = Math.min(...placements.map((placement) => placement.x));
  const minY = Math.min(...placements.map((placement) => placement.y));
  const maxX = Math.max(...placements.map((placement) => placement.x + placement.width));
  const ownerPlacement: Placement = {
    id: ids.placementId,
    elementId: owner.id,
    x: minX - FRAME_PADDING,
    y: minY - FRAME_PADDING,
    width: maxX - minX + FRAME_PADDING * 2,
    expanded: true,
  };
  const nextView: View = { ...view, placements: [...view.placements, ownerPlacement] };

  const changes: RecordChange[] = [
    { kind: 'insert', value: { recordKind: 'element', record: owner } },
    { kind: 'insert', value: { recordKind: 'refinement', record: refinement } },
  ];
  for (const connection of document.connections) {
    const next = replaceCrossingEndpoint(connection, selected, ownerByMemberEndpoint);
    if (next !== connection) changes.push({ kind: 'replace', value: { recordKind: 'connection', record: next } });
  }
  for (const scenario of document.scenarios) {
    const next = updateScenario(
      scenario,
      refinement.id,
      owner.id,
      selected,
      scenarioReachability.get(scenario.id) === true,
    );
    if (next !== scenario) changes.push({ kind: 'replace', value: { recordKind: 'scenario', record: next } });
  }
  changes.push({ kind: 'replace', value: { recordKind: 'view', record: nextView } });

  return { ok: true, changes, label: 'Wrap in boundary' };
}

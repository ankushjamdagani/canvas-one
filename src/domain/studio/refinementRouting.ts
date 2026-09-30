import type { Connection, Document, Endpoint, Id, Refinement, Scenario } from './model';

export type RefinementSelectionError = {
  readonly refinementId: Id;
  readonly message: string;
};

export type RefinementCrossingViolation = {
  readonly refinementId: Id;
  readonly connectionId: Id;
  readonly endpoint: Endpoint;
  readonly message: string;
};

export type RefinementRouting = {
  readonly excludedElementIds: readonly Id[];
  readonly inertRefinementIds: readonly Id[];
  readonly activeRefinementIds: readonly Id[];
  readonly selectionErrors: readonly RefinementSelectionError[];
  readonly crossingViolations: readonly RefinementCrossingViolation[];
  readonly resolveOuterToInner: (endpoint: Endpoint) => Endpoint;
  readonly outboundEndpoints: (elementId: Id, portId: Id) => readonly Endpoint[];
  readonly remapConnections: (connections: readonly Connection[]) => Connection[];
};

function endpointKey(endpoint: Endpoint): string {
  return `${endpoint.elementId}:${endpoint.portId}`;
}

function compareEndpoints(a: Endpoint, b: Endpoint): number {
  if (a.elementId !== b.elementId) return a.elementId < b.elementId ? -1 : 1;
  if (a.portId !== b.portId) return a.portId < b.portId ? -1 : 1;
  return 0;
}

function descendantsOf(refinement: Refinement, refinementsByOwner: ReadonlyMap<Id, readonly Refinement[]>): Set<Id> {
  const descendants = new Set<Id>();
  const queue = [...refinement.memberElementIds].sort();

  while (queue.length > 0) {
    const elementId = queue.shift()!;
    if (descendants.has(elementId)) continue;
    descendants.add(elementId);

    const nested = refinementsByOwner.get(elementId) ?? [];
    for (const child of nested) {
      queue.push(...child.memberElementIds);
    }
    queue.sort();
  }

  return descendants;
}

/**
 * Resolves the executable refinement topology for one scenario (§6 Refinement).
 *
 * The result is pure and deterministic. Active refined mappings are followed transitively
 * outer-to-inner and inner-to-outer. A nested selection below an active aggregate selection
 * is inert, and the aggregate excludes the complete ownership subtree.
 */
export function resolveRefinementRouting(document: Document, scenario: Scenario): RefinementRouting {
  const refinementsById = new Map<Id, Refinement>();
  const refinementsByOwner = new Map<Id, Refinement[]>();
  for (const refinement of document.refinements) {
    refinementsById.set(refinement.id, refinement);
    const owned = refinementsByOwner.get(refinement.ownerElementId) ?? [];
    owned.push(refinement);
    refinementsByOwner.set(refinement.ownerElementId, owned);
  }
  for (const refinements of refinementsByOwner.values()) {
    refinements.sort((a, b) => a.id.localeCompare(b.id));
  }

  const selectionErrors: RefinementSelectionError[] = [];
  const selectedById = new Map<Id, (typeof scenario.refinementSelections)[number]>();
  for (const selection of scenario.refinementSelections) {
    if (selectedById.has(selection.refinementId)) {
      selectionErrors.push({
        refinementId: selection.refinementId,
        message: `Refinement '${selection.refinementId}' has more than one selection in this scenario (running both paths is invalid)`,
      });
      continue;
    }
    selectedById.set(selection.refinementId, selection);
    if (!refinementsById.has(selection.refinementId)) {
      selectionErrors.push({
        refinementId: selection.refinementId,
        message: `Refinement selection references unknown refinement '${selection.refinementId}'`,
      });
    }
  }

  const aggregateDescendants = new Map<Id, Set<Id>>();
  for (const selection of selectedById.values()) {
    if (selection.mode !== 'aggregate') continue;
    const refinement = refinementsById.get(selection.refinementId);
    if (refinement) {
      aggregateDescendants.set(refinement.id, descendantsOf(refinement, refinementsByOwner));
    }
  }

  const inertRefinementIds = new Set<Id>();
  for (const selection of selectedById.values()) {
    const refinement = refinementsById.get(selection.refinementId);
    if (!refinement) continue;
    for (const [aggregateId, descendants] of aggregateDescendants) {
      if (aggregateId !== refinement.id && descendants.has(refinement.ownerElementId)) {
        inertRefinementIds.add(refinement.id);
        break;
      }
    }
  }

  const activeRefinements: Refinement[] = [];
  const excludedElementIds = new Set<Id>();
  const outerToInner = new Map<string, Endpoint>();
  const innerToOuter = new Map<string, Endpoint[]>();

  for (const selection of selectedById.values()) {
    const refinement = refinementsById.get(selection.refinementId);
    if (!refinement || inertRefinementIds.has(refinement.id)) continue;
    activeRefinements.push(refinement);

    if (selection.mode === 'aggregate') {
      for (const descendant of descendantsOf(refinement, refinementsByOwner)) {
        excludedElementIds.add(descendant);
      }
      continue;
    }

    excludedElementIds.add(refinement.ownerElementId);
    for (const mapping of refinement.portMappings) {
      outerToInner.set(endpointKey(mapping.outer), mapping.inner);
      const outers = innerToOuter.get(endpointKey(mapping.inner)) ?? [];
      outers.push(mapping.outer);
      innerToOuter.set(endpointKey(mapping.inner), outers);
    }
  }

  for (const outers of innerToOuter.values()) outers.sort(compareEndpoints);

  function resolveOuterToInner(endpoint: Endpoint): Endpoint {
    let current = endpoint;
    const seen = new Set<string>();
    while (!seen.has(endpointKey(current))) {
      seen.add(endpointKey(current));
      const inner = outerToInner.get(endpointKey(current));
      if (!inner) break;
      current = inner;
    }
    return current;
  }

  function outboundEndpoints(elementId: Id, portId: Id): readonly Endpoint[] {
    const origin = { elementId, portId };
    const results: Endpoint[] = [origin];
    const queue: Endpoint[] = [origin];
    const seen = new Set<string>([endpointKey(origin)]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const outer of innerToOuter.get(endpointKey(current)) ?? []) {
        const key = endpointKey(outer);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(outer);
        queue.push(outer);
      }
    }

    return results;
  }

  function remapConnections(connections: readonly Connection[]): Connection[] {
    const remapped: Connection[] = [];
    for (const connection of connections) {
      const source = resolveOuterToInner(connection.source);
      const target = resolveOuterToInner(connection.target);
      if (excludedElementIds.has(source.elementId) || excludedElementIds.has(target.elementId)) continue;
      if (source === connection.source && target === connection.target) {
        remapped.push(connection);
      } else {
        remapped.push({ ...connection, source, target });
      }
    }
    return remapped;
  }

  const crossingViolations: RefinementCrossingViolation[] = [];
  const crossingViolationKeys = new Set<string>();
  const activeRefined = activeRefinements
    .filter((refinement) => selectedById.get(refinement.id)?.mode === 'refined')
    .map((refinement) => ({
      refinement,
      descendants: descendantsOf(refinement, refinementsByOwner),
    }));

  function addCrossingViolation(refinement: Refinement, connection: Connection, endpoint: Endpoint): void {
    const key = `${refinement.id}:${connection.id}:${endpointKey(endpoint)}`;
    if (crossingViolationKeys.has(key)) return;
    crossingViolationKeys.add(key);
    crossingViolations.push({
      refinementId: refinement.id,
      connectionId: connection.id,
      endpoint,
      message: `Refinement '${refinement.id}': port '${endpoint.portId}' has a crossing connection with no compatible port mapping`,
    });
  }

  for (const connection of [...document.connections].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const originalEndpoint of [connection.source, connection.target]) {
      let current = originalEndpoint;
      const seen = new Set<string>();
      while (!seen.has(endpointKey(current))) {
        seen.add(endpointKey(current));
        const active = activeRefined.find(({ refinement }) => refinement.ownerElementId === current.elementId);
        if (!active) break;
        const inner = outerToInner.get(endpointKey(current));
        if (!inner) {
          addCrossingViolation(active.refinement, connection, current);
          break;
        }
        current = inner;
      }
    }

    for (const { refinement, descendants } of activeRefined) {
      const sourceInside = descendants.has(connection.source.elementId);
      const targetInside = descendants.has(connection.target.elementId);
      if (sourceInside === targetInside) continue;
      const insideEndpoint = sourceInside ? connection.source : connection.target;
      const mappedOuters = outboundEndpoints(insideEndpoint.elementId, insideEndpoint.portId);
      if (!mappedOuters.some((endpoint) => endpoint.elementId === refinement.ownerElementId)) {
        addCrossingViolation(refinement, connection, insideEndpoint);
      }
    }
  }

  crossingViolations.sort((a, b) => {
    if (a.refinementId !== b.refinementId) return a.refinementId.localeCompare(b.refinementId);
    if (a.connectionId !== b.connectionId) return a.connectionId.localeCompare(b.connectionId);
    return compareEndpoints(a.endpoint, b.endpoint);
  });
  selectionErrors.sort((a, b) => a.refinementId.localeCompare(b.refinementId) || a.message.localeCompare(b.message));

  return {
    excludedElementIds: [...excludedElementIds].sort(),
    inertRefinementIds: [...inertRefinementIds].sort(),
    activeRefinementIds: activeRefinements.map((refinement) => refinement.id).sort(),
    selectionErrors,
    crossingViolations,
    resolveOuterToInner,
    outboundEndpoints,
    remapConnections,
  };
}

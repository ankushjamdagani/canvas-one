import { describe, expect, it } from 'vitest';
import type { Connection, Document, Element, Refinement, Scenario, Selection } from './model';
import { resolveRefinementRouting } from './refinementRouting';

const schemaId = 'schema';

function element(id: string): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'service',
    ports: [
      { id: `${id}-in`, label: 'in', direction: 'in', channel: 'data', schemaId, responseSchemaId: null },
      { id: `${id}-out`, label: 'out', direction: 'out', channel: 'data', schemaId, responseSchemaId: null },
    ],
    behavior: { kind: 'unmodeled', version: 1, reason: 'routing-only fixture' },
  };
}

function connection(id: string, sourceId: string, targetId: string): Connection {
  return {
    id,
    label: id,
    kind: 'data',
    source: { elementId: sourceId, portId: `${sourceId}-out` },
    target: { elementId: targetId, portId: `${targetId}-in` },
    config: {},
  };
}

function refinement(id: string, ownerId: string, memberId: string): Refinement {
  return {
    id,
    ownerElementId: ownerId,
    memberElementIds: [memberId],
    portMappings: [
      {
        id: `${id}-in-map`,
        outer: { elementId: ownerId, portId: `${ownerId}-in` },
        inner: { elementId: memberId, portId: `${memberId}-in` },
      },
      {
        id: `${id}-out-map`,
        outer: { elementId: ownerId, portId: `${ownerId}-out` },
        inner: { elementId: memberId, portId: `${memberId}-out` },
      },
    ],
  };
}

function scenario(selections: readonly Selection[]): Scenario {
  return {
    id: 'scenario',
    label: 'scenario',
    revision: 1,
    mode: 'logical',
    scopeElementIds: ['source', 'a', 'b', 'c', 'sink'],
    entryPorts: [{ elementId: 'source', portId: 'source-in' }],
    inputs: [],
    workloads: [],
    faults: [],
    boundaries: [],
    refinementSelections: selections,
    initialContexts: [],
    assertions: [],
    seed: 1,
    budgets: {
      maxEvents: 100,
      maxTraceRows: 100,
      maxTraceBytes: 100_000,
      maxScheduledEvents: 100,
      maxLiveRoots: 100,
    },
    completion: { kind: 'quiescent' },
    assumptions: [],
  };
}

function document(selections: readonly Selection[], innerMappings = true): Document {
  const outer = refinement('outer', 'a', 'b');
  const inner = refinement('inner', 'b', 'c');
  return {
    schema: 'studio-model/1',
    id: 'document',
    title: 'Nested refinement routing',
    elements: ['source', 'a', 'b', 'c', 'sink'].map(element),
    connections: [connection('source-to-owner', 'source', 'a'), connection('owner-to-sink', 'a', 'sink')],
    relations: [],
    schemas: [{ id: schemaId, label: 'value', shape: { type: 'integer', nullable: false } }],
    fixtures: [],
    refinements: [outer, innerMappings ? inner : { ...inner, portMappings: [] }],
    scenarios: [scenario(selections)],
    views: [],
  };
}

describe('resolveRefinementRouting', () => {
  it('resolves two levels outer-to-inner and fans out inner-to-outer', () => {
    const doc = document([
      { refinementId: 'outer', mode: 'refined' },
      { refinementId: 'inner', mode: 'refined' },
    ]);
    const routing = resolveRefinementRouting(doc, doc.scenarios[0]);

    expect(routing.resolveOuterToInner({ elementId: 'a', portId: 'a-in' })).toEqual({
      elementId: 'c',
      portId: 'c-in',
    });
    expect(routing.outboundEndpoints('c', 'c-out')).toEqual([
      { elementId: 'c', portId: 'c-out' },
      { elementId: 'b', portId: 'b-out' },
      { elementId: 'a', portId: 'a-out' },
    ]);
    expect(routing.remapConnections(doc.connections)).toEqual([
      expect.objectContaining({ id: 'source-to-owner', target: { elementId: 'c', portId: 'c-in' } }),
      expect.objectContaining({ id: 'owner-to-sink', source: { elementId: 'c', portId: 'c-out' } }),
    ]);
  });

  it.each([
    ['aggregate', 'aggregate', ['b', 'c'], ['inner']],
    ['aggregate', 'refined', ['b', 'c'], ['inner']],
    ['refined', 'aggregate', ['a', 'c'], []],
    ['refined', 'refined', ['a', 'b'], []],
  ] as const)(
    'applies outer %s and inner %s precedence',
    (outerMode, innerMode, excluded, inert) => {
      const doc = document([
        { refinementId: 'outer', mode: outerMode },
        { refinementId: 'inner', mode: innerMode },
      ]);
      const routing = resolveRefinementRouting(doc, doc.scenarios[0]);

      expect(routing.excludedElementIds).toEqual(excluded);
      expect(routing.inertRefinementIds).toEqual(inert);
      expect(routing.crossingViolations).toEqual([]);
    },
  );

  it('resolves three refinement levels transitively', () => {
    const doc = document([
      { refinementId: 'outer', mode: 'refined' },
      { refinementId: 'inner', mode: 'refined' },
      { refinementId: 'deep', mode: 'refined' },
    ]);
    const deep = refinement('deep', 'c', 'd');
    const expanded: Document = {
      ...doc,
      elements: [...doc.elements, element('d')],
      refinements: [...doc.refinements, deep],
      scenarios: [{ ...doc.scenarios[0], scopeElementIds: [...doc.scenarios[0].scopeElementIds, 'd'] }],
    };
    const routing = resolveRefinementRouting(expanded, expanded.scenarios[0]);

    expect(routing.resolveOuterToInner({ elementId: 'a', portId: 'a-in' })).toEqual({
      elementId: 'd',
      portId: 'd-in',
    });
    expect(routing.outboundEndpoints('d', 'd-out').map((endpoint) => endpoint.elementId)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ]);
  });

  it('reports an unmapped crossing reached at depth two', () => {
    const doc = document(
      [
        { refinementId: 'outer', mode: 'refined' },
        { refinementId: 'inner', mode: 'refined' },
      ],
      false,
    );
    const routing = resolveRefinementRouting(doc, doc.scenarios[0]);

    expect(routing.crossingViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ refinementId: 'inner', connectionId: 'source-to-owner' }),
        expect.objectContaining({ refinementId: 'inner', connectionId: 'owner-to-sink' }),
      ]),
    );
  });

  it('preserves duplicate and unknown selection errors', () => {
    const doc = document([
      { refinementId: 'outer', mode: 'aggregate' },
      { refinementId: 'outer', mode: 'refined' },
      { refinementId: 'missing', mode: 'refined' },
    ]);
    const routing = resolveRefinementRouting(doc, doc.scenarios[0]);

    expect(routing.selectionErrors.map((error) => error.message)).toEqual([
      "Refinement selection references unknown refinement 'missing'",
      "Refinement 'outer' has more than one selection in this scenario (running both paths is invalid)",
    ]);
  });
});

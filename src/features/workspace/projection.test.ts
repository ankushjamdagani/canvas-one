import { describe, expect, it } from 'vitest';
import type { Document, Element, View, Connection } from '../../domain/studio/model';
import {
  buildMoveChange,
  CATALOG_LAYER_COLORS,
  getCatalogLayer,
  projectDocumentToCanvas,
} from './projection';

function makeTestDocument(): Document {
  const elements: Element[] = [
    {
      id: 'e1',
      label: 'Client Web App',
      description: 'Web client',
      visualKind: 'client',
      ports: [
        { id: 'p1_out', label: 'out', direction: 'out', channel: 'call', schemaId: 's1', responseSchemaId: 's1' },
      ],
      behavior: { kind: 'unmodeled', version: 1, reason: 'sketch' },
    },
    {
      id: 'e2',
      label: 'Order Service',
      description: 'Core service',
      visualKind: 'service',
      ports: [
        { id: 'p2_in', label: 'in', direction: 'in', channel: 'call', schemaId: 's1', responseSchemaId: 's1' },
        { id: 'p2_msg_out', label: 'msg_out', direction: 'out', channel: 'message', schemaId: 's1', responseSchemaId: null },
      ],
      behavior: { kind: 'unmodeled', version: 1, reason: 'sketch' },
    },
    {
      id: 'e3',
      label: 'Order Queue',
      description: 'Message queue',
      visualKind: 'queue',
      ports: [
        { id: 'p3_msg_in', label: 'msg_in', direction: 'in', channel: 'message', schemaId: 's1', responseSchemaId: null },
      ],
      behavior: { kind: 'unmodeled', version: 1, reason: 'sketch' },
    },
    {
      id: 'e4_unplaced',
      label: 'Unplaced Cache',
      description: 'Cache component',
      visualKind: 'cache',
      ports: [],
      behavior: { kind: 'unmodeled', version: 1, reason: 'sketch' },
    },
  ];

  const connections: Connection[] = [
    {
      id: 'c1',
      label: 'Submit order',
      kind: 'call',
      source: { elementId: 'e1', portId: 'p1_out' },
      target: { elementId: 'e2', portId: 'p2_in' },
      config: { latencyMs: 10, returnLatencyMs: 10, weight: 1, condition: null, fallback: false, resource: null },
    },
    {
      id: 'c2',
      label: 'Enqueue order',
      kind: 'message',
      source: { elementId: 'e2', portId: 'p2_msg_out' },
      target: { elementId: 'e3', portId: 'p3_msg_in' },
      config: { latencyMs: 5, ackDelayMs: 2, messageTtlMs: 5000, weight: 1, condition: null, fallback: false, resource: null },
    },
    {
      id: 'c3_to_unplaced',
      label: 'Cache check',
      kind: 'call',
      source: { elementId: 'e2', portId: 'p2_in' },
      target: { elementId: 'e4_unplaced', portId: 'p4_in' },
      config: { latencyMs: 1, returnLatencyMs: 1, weight: 1, condition: null, fallback: false, resource: null },
    },
    {
      id: 'c4_not_in_view',
      label: 'Other conn',
      kind: 'call',
      source: { elementId: 'e1', portId: 'p1_out' },
      target: { elementId: 'e2', portId: 'p2_in' },
      config: { latencyMs: 10, returnLatencyMs: 10, weight: 1, condition: null, fallback: false, resource: null },
    },
  ];

  const view: View = {
    id: 'v1',
    label: 'Overview View',
    placements: [
      { id: 'pl1', elementId: 'e1', x: 100, y: 150, width: 176, expanded: true },
      { id: 'pl2', elementId: 'e2', x: 400, y: 150, width: 200, expanded: true },
      { id: 'pl3', elementId: 'e3', x: 700, y: 150, width: 176, expanded: true },
    ],
    connectionIds: ['c1', 'c2', 'c3_to_unplaced'], // Note: c4_not_in_view is omitted; c3_to_unplaced targets unplaced e4
    relationIds: [],
    groups: [
      { id: 'g1', label: 'Backend Layer', elementIds: ['e2', 'e3'], collapsed: false },
    ],
    notes: [
      { id: 'n1', text: 'Important architecture note', x: 100, y: 350, width: 220, tone: 'paper', attachedElementIds: ['e1'] },
    ],
  };

  return {
    schema: 'studio-model/1',
    id: 'doc1',
    title: 'Test System',
    elements,
    connections,
    relations: [],
    schemas: [],
    fixtures: [],
    refinements: [],
    scenarios: [],
    views: [view],
  };
}

describe('projectDocumentToCanvas', () => {
  it('returns empty: true and empty issues when document has zero views', () => {
    const doc: Document = {
      schema: 'studio-model/1',
      id: 'doc-empty',
      title: 'Blank System',
      elements: [],
      connections: [],
      relations: [],
      schemas: [],
      fixtures: [],
      refinements: [],
      scenarios: [],
      views: [],
    };

    const res = projectDocumentToCanvas(doc, null);
    expect(res.empty).toBe(true);
    expect(res.nodes).toEqual([]);
    expect(res.edges).toEqual([]);
    expect(res.issues).toEqual([]);
    expect(res.activeView).toBeNull();
  });

  it('projects placements to element nodes using placement.id as node id and hides unplaced elements', () => {
    const doc = makeTestDocument();
    const res = projectDocumentToCanvas(doc, 'v1');

    expect(res.empty).toBe(false);
    expect(res.activeView?.id).toBe('v1');
    expect(res.issues).toEqual([]);

    // Placed elements: pl1, pl2, pl3 (placement IDs). Unplaced e4 must NOT be in nodes!
    const elementNodes = res.nodes.filter((n) => n.type === 'elementNode');
    expect(elementNodes.length).toBe(3);
    // Node id is placement.id per requirement 4
    expect(elementNodes.map((n) => n.id)).toEqual(['pl1', 'pl2', 'pl3']);
    expect(elementNodes.some((n) => n.id === 'e4_unplaced' || n.data.kind === 'element' && n.data.element.id === 'e4_unplaced')).toBe(false);

    // Verify placement properties and stripes
    const pl1Node = elementNodes.find((n) => n.id === 'pl1')!;
    expect(pl1Node.position).toEqual({ x: 100, y: 150 });
    expect(pl1Node.data.kind).toBe('element');
    if (pl1Node.data.kind === 'element') {
      expect(pl1Node.data.element.label).toBe('Client Web App');
      expect(pl1Node.data.placement.id).toBe('pl1');
      expect(pl1Node.data.layer).toBe('clients');
      expect(pl1Node.data.stripeColor).toBe('#4F6D8F');
      expect(pl1Node.style?.width).toBe(176);
    }

    const pl2Node = elementNodes.find((n) => n.id === 'pl2')!;
    expect(pl2Node.position).toEqual({ x: 400, y: 150 });
    if (pl2Node.data.kind === 'element') {
      expect(pl2Node.data.element.label).toBe('Order Service');
      expect(pl2Node.data.layer).toBe('compute');
      expect(pl2Node.data.stripeColor).toBe('#56773A');
      expect(pl2Node.style?.width).toBe(200);
    }
  });

  it('filters connections by view.connectionIds AND both endpoints placed, using placement.id for source and target', () => {
    const doc = makeTestDocument();
    const res = projectDocumentToCanvas(doc, 'v1');

    // c1: both placed, in connectionIds -> included (solid)
    // c2: both placed, in connectionIds -> included (dashed)
    // c3_to_unplaced: target e4 is not placed -> EXCLUDED
    // c4_not_in_view: not in view.connectionIds -> EXCLUDED
    expect(res.edges.length).toBe(2);
    expect(res.edges.map((e) => e.id)).toEqual(['c1', 'c2']);

    const c1Edge = res.edges.find((e) => e.id === 'c1')!;
    // source and target point to placement IDs
    expect(c1Edge.source).toBe('pl1');
    expect(c1Edge.target).toBe('pl2');
    expect(c1Edge.label).toBe('Submit order');
    expect(c1Edge.style.strokeDasharray).toBeUndefined(); // solid

    const c2Edge = res.edges.find((e) => e.id === 'c2')!;
    expect(c2Edge.source).toBe('pl2');
    expect(c2Edge.target).toBe('pl3');
    expect(c2Edge.label).toBe('Enqueue order');
    expect(c2Edge.style.strokeDasharray).toBe('6,4'); // dashed
  });

  it('projects groups with group.id as node id (no prefix)', () => {
    const doc = makeTestDocument();
    const res = projectDocumentToCanvas(doc, 'v1');

    const groupNodes = res.nodes.filter((n) => n.type === 'groupNode');
    expect(groupNodes.length).toBe(1);

    const g1 = groupNodes[0];
    // node id is group.id per requirement 4 (no 'group-' prefix)
    expect(g1.id).toBe('g1');
    expect(g1.type).toBe('groupNode');
    expect(g1.selectable).toBe(false);
    expect(g1.draggable).toBe(false);
    expect(g1.data.kind).toBe('group');
    if (g1.data.kind === 'group') {
      expect(g1.data.label).toBe('Backend Layer');
      expect(g1.data.width).toBeGreaterThan(0);
      expect(g1.data.height).toBeGreaterThan(0);
    }
  });

  it('projects notes with note.id as node id (no prefix) and exact width', () => {
    const doc = makeTestDocument();
    const res = projectDocumentToCanvas(doc, 'v1');

    const noteNodes = res.nodes.filter((n) => n.type === 'noteNode');
    expect(noteNodes.length).toBe(1);

    const n1 = noteNodes[0];
    // node id is note.id per requirement 4 (no 'note-' prefix)
    expect(n1.id).toBe('n1');
    expect(n1.type).toBe('noteNode');
    expect(n1.position).toEqual({ x: 100, y: 350 });
    expect(n1.data.kind).toBe('note');
    if (n1.data.kind === 'note') {
      expect(n1.data.text).toBe('Important architecture note');
      expect(n1.data.tone).toBe('paper');
      expect(n1.data.width).toBe(220);
      expect(n1.style?.width).toBe(220);
    }
  });

  it('skips missing placement elements AND reports them in issues array', () => {
    const doc = makeTestDocument();
    // Add a placement whose element does not exist
    const viewWithMissing = {
      ...doc.views[0],
      placements: [
        ...doc.views[0].placements,
        { id: 'pl_orphan', elementId: 'e_does_not_exist', x: 50, y: 50, width: 176, expanded: true },
      ],
    };
    const brokenDoc: Document = {
      ...doc,
      views: [viewWithMissing],
    };

    const res = projectDocumentToCanvas(brokenDoc, 'v1');
    // Orphan placement must NOT produce a node
    expect(res.nodes.some((n) => n.id === 'pl_orphan')).toBe(false);
    // Orphan placement must be reported in issues
    expect(res.issues.length).toBe(1);
    expect(res.issues[0].code).toBe('missing-element');
    expect(res.issues[0].message).toContain('e_does_not_exist');
    expect(res.issues[0].entityId).toBe('pl_orphan');
  });

  it('reports missing connections in issues array', () => {
    const doc = makeTestDocument();
    const viewWithMissingConn = {
      ...doc.views[0],
      connectionIds: [...doc.views[0].connectionIds, 'c_missing_404'],
    };
    const brokenDoc: Document = {
      ...doc,
      views: [viewWithMissingConn],
    };

    const res = projectDocumentToCanvas(brokenDoc, 'v1');
    expect(res.issues.some((i) => i.code === 'missing-connection' && i.entityId === 'c_missing_404')).toBe(true);
  });

  it('maps visualKind to correct catalog layers per D35, and per D42: state-machine/data-pipeline/host get their own stripe groups, thirdparty -> edge, custom -> no stripe', () => {
    // 29 catalog kinds have layers
    expect(getCatalogLayer('traffic')).toBe('clients');
    expect(getCatalogLayer('client')).toBe('clients');
    expect(getCatalogLayer('gateway')).toBe('edge');
    expect(getCatalogLayer('service')).toBe('compute');
    expect(getCatalogLayer('database')).toBe('data');
    expect(getCatalogLayer('queue')).toBe('messaging');
    expect(getCatalogLayer('monitoring')).toBe('operations');

    // D42 item 1: three new dedicated stripe groups
    expect(getCatalogLayer('state-machine')).toBe('state-machine');
    expect(getCatalogLayer('data-pipeline')).toBe('data-pipeline');
    expect(getCatalogLayer('host')).toBe('host');

    // D42 item 2: thirdparty -> Edge; custom -> no stripe at all
    expect(getCatalogLayer('thirdparty')).toBe('edge');
    expect(getCatalogLayer('custom')).toBeNull();
  });

  it('D42: new stripe colors for state-machine (indigo), data-pipeline (umber), host (charcoal)', () => {
    expect(CATALOG_LAYER_COLORS['state-machine']).toBe('#5A5B8C');
    expect(CATALOG_LAYER_COLORS['data-pipeline']).toBe('#7A5C3E');
    expect(CATALOG_LAYER_COLORS.host).toBe('#3A3F3C');
  });
});

describe('buildMoveChange', () => {
  it('returns null when movedNodes is empty or no positions changed', () => {
    const doc = makeTestDocument();
    const view = doc.views[0];

    expect(buildMoveChange(view, [])).toBeNull();

    // No coordinates changed (matching by placement.id)
    expect(
      buildMoveChange(view, [
        { id: 'pl1', position: { x: 100, y: 150 } },
      ]),
    ).toBeNull();
  });

  it('builds ONE replace change on view with updated placement coordinates matching by placement.id', () => {
    const doc = makeTestDocument();
    const view = doc.views[0];

    // Coordinates identified by placement.id per requirement 4
    const change = buildMoveChange(view, [
      { id: 'pl1', position: { x: 125.4, y: 180.2 } },
      { id: 'pl2', position: { x: 420, y: 190 } },
    ]);

    expect(change).not.toBeNull();
    expect(change?.kind).toBe('replace');
    if (change?.kind === 'replace') {
      expect(change.value.recordKind).toBe('view');
      const updatedView = change.value.record as View;
      expect(updatedView.id).toBe('v1');
      expect(updatedView.placements.length).toBe(3);

      const pl1 = updatedView.placements.find((p) => p.id === 'pl1')!;
      expect(pl1.x).toBe(125);
      expect(pl1.y).toBe(180);

      const pl2 = updatedView.placements.find((p) => p.id === 'pl2')!;
      expect(pl2.x).toBe(420);
      expect(pl2.y).toBe(190);

      // pl3 was not moved -> preserved untouched
      const pl3 = updatedView.placements.find((p) => p.id === 'pl3')!;
      expect(pl3.x).toBe(700);
      expect(pl3.y).toBe(150);
    }
  });
});

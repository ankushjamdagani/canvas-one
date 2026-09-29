/**
 * Pure projection and change builder for System Studio canvas (RV-12c2).
 *
 * Implements specs/revamp/contracts/model-and-runner.md §2 (Document, View, Placement, Group, Note)
 * and specs/revamp/contracts/commands.md §4 (model.apply-records).
 */

import type {
  Connection,
  Document,
  Element,
  Group,
  Id,
  Note,
  Placement,
  View,
} from '../../domain/studio/model';
import type { RecordChange } from '../../persistence/studio/types';

export type CatalogLayer =
  | 'clients'
  | 'edge'
  | 'compute'
  | 'messaging'
  | 'data'
  | 'operations'
  | 'state-machine'
  | 'data-pipeline'
  | 'host';

/**
 * Maps a visualKind to its system catalog layer.
 *
 * D35 covers the original six layers; D42 (catalog.md "Approved resolutions"
 * 1-2) extends it: state-machine, data-pipeline and host each get their own
 * dedicated stripe group; thirdparty moves to Edge; custom gets no stripe at
 * all (falls through to null, catalog.md "custom has no stripe, library group
 * 'Other'").
 */
export function getCatalogLayer(visualKind: string): CatalogLayer | null {
  switch (visualKind) {
    case 'traffic':
    case 'client':
    case 'mobile':
    case 'device':
      return 'clients';
    case 'dns':
    case 'cdn':
    case 'firewall':
    case 'gateway':
    case 'balancer':
    case 'thirdparty': // D42 item 2: thirdparty -> Edge
      return 'edge';
    case 'service':
    case 'function':
    case 'container':
    case 'worker':
    case 'scheduler':
      return 'compute';
    case 'database':
    case 'nosql':
    case 'cache':
    case 'objectstore':
    case 'search':
    case 'warehouse':
      return 'data';
    case 'queue':
    case 'stream':
    case 'pubsub':
    case 'email':
      return 'messaging';
    case 'monitoring':
    case 'analytics':
    case 'secrets':
      return 'operations';
    case 'state-machine': // D42 item 1: own indigo stripe group
      return 'state-machine';
    case 'data-pipeline': // D42 item 1: own umber stripe group
      return 'data-pipeline';
    case 'host': // D42 item 1: own charcoal stripe group
      return 'host';
    case 'custom': // D42 item 2: no stripe
    default:
      return null;
  }
}

export const CATALOG_LAYER_COLORS: Record<CatalogLayer, string> = {
  clients: '#4F6D8F',
  edge: '#2B7A83',
  compute: '#56773A',
  messaging: '#8A6A1F',
  data: '#8A4F6E',
  operations: '#5F646B',
  'state-machine': '#5A5B8C',
  'data-pipeline': '#7A5C3E',
  host: '#3A3F3C',
};

export type ProjectedNodeData =
  | {
      readonly kind: 'element';
      readonly element: Element;
      readonly placement: Placement;
      readonly layer: CatalogLayer | null;
      readonly stripeColor: string | null;
      /**
       * RV-12e: ports render as connectable handles only while the Connect
       * tool/gesture is active (commands.md §4, "Handles become interactive
       * only in Connect mode/drag"). Not part of the pure projection itself --
       * CanvasView sets this per current dragMode, so projectDocumentToCanvas
       * stays a pure function of Document + activeViewId.
       */
      readonly connectable?: boolean;
    }
  | {
      readonly kind: 'group';
      readonly group: Group;
      readonly label: string;
      readonly width: number;
      readonly height: number;
      /** RV-04g: collapsed groups render as one compact node (Group.collapsed). */
      readonly collapsed: boolean;
      readonly memberCount: number;
      /**
       * Set by CanvasView (like `connectable`): routes the header toggle
       * through canvas.expand / canvas.collapse. Not part of the projection.
       */
      readonly onToggleCollapsed?: () => void;
    }
  | {
      readonly kind: 'note';
      readonly note: Note;
      readonly text: string;
      readonly tone: 'paper' | 'neutral';
      readonly width: number;
    };

export type ProjectedNode = {
  readonly id: string;
  readonly type: 'elementNode' | 'groupNode' | 'noteNode';
  readonly position: { readonly x: number; readonly y: number };
  readonly data: ProjectedNodeData;
  readonly selectable?: boolean;
  readonly draggable?: boolean;
  readonly zIndex?: number;
  readonly style?: React.CSSProperties;
};

export type ProjectedEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly type?: string;
  readonly labelStyle?: React.CSSProperties;
  readonly labelShowBg?: boolean;
  readonly labelBgStyle?: React.CSSProperties;
  readonly labelBgPadding?: [number, number];
  readonly labelBgBorderRadius?: number;
  readonly style: {
    readonly strokeWidth: number;
    readonly stroke: string;
    readonly strokeDasharray?: string;
  };
  readonly data: {
    readonly connection: Connection;
    readonly kind: 'call' | 'message' | 'data';
    /**
     * RV-04g: a visual-only edge standing in for connections whose endpoint is
     * a collapsed group's hidden member. `connection` is the first one; the
     * edge is not a selectable/editable connection.
     */
    readonly rerouted?: boolean;
  };
};

export type ProjectionIssue = {
  readonly code: 'missing-element' | 'missing-connection';
  readonly message: string;
  readonly entityId?: string;
};

export type ProjectionResult = {
  readonly activeView: View | null;
  readonly hasMultipleViews: boolean;
  readonly views: readonly View[];
  readonly nodes: readonly ProjectedNode[];
  readonly edges: readonly ProjectedEdge[];
  readonly issues: readonly ProjectionIssue[];
  readonly empty: boolean;
};

/**
 * Placements persist their width but not their height. Group bounds and the
 * selection geometry planners therefore share this fixed rendered-card
 * estimate (commands.md §4 bounding-box alignment).
 */
export const ESTIMATED_ELEMENT_NODE_HEIGHT = 76;
const GROUP_PADDING_X = 24;
const GROUP_PADDING_Y_TOP = 36;
const GROUP_PADDING_Y_BOTTOM = 24;
/** Compact boundary node a collapsed group renders as (RV-04g). */
export const COLLAPSED_GROUP_WIDTH = 184;
export const COLLAPSED_GROUP_HEIGHT = 44;

/**
 * Pure projection from Document + activeViewId into ReactFlow nodes and edges.
 * Rules:
 * - Zero views -> empty: true (no view invented)
 * - View placements only: elements not placed are not shown
 * - Node identity: placement.id is the ReactFlow node id (not element.id)
 * - Node types: 'elementNode', 'groupNode', 'noteNode' (no ID prefixes)
 * - Connections: only if connection id is in view.connectionIds AND both endpoints are placed
 * - Edge strokes: call solid, message dashed, data dotted
 * - Groups: boundary around placed members with label
 * - Notes: note cards with text and tone
 * - Missing records: skip and report in issues array
 */
export function projectDocumentToCanvas(
  document: Document | null,
  activeViewId: string | null,
): ProjectionResult {
  if (!document || !document.views || document.views.length === 0) {
    return {
      activeView: null,
      hasMultipleViews: false,
      views: [],
      nodes: [],
      edges: [],
      issues: [],
      empty: true,
    };
  }

  const views = document.views;
  const activeView =
    views.find((v) => v.id === activeViewId) ?? views[0];
  const hasMultipleViews = views.length > 1;

  const elementById = new Map<Id, Element>(
    document.elements.map((el) => [el.id, el]),
  );

  const placedElementIds = new Set<Id>();
  const placementByElementId = new Map<Id, Placement>();
  const nodes: ProjectedNode[] = [];
  const issues: ProjectionIssue[] = [];

  // Members of collapsed groups are hidden and their edges reroute to the
  // group node (RV-04g, presentation only).
  const collapsedGroupByElementId = new Map<Id, Group>();
  for (const group of activeView.groups) {
    if (!group.collapsed) continue;
    for (const elementId of group.elementIds) collapsedGroupByElementId.set(elementId, group);
  }

  // 1. Element nodes from placements
  for (const placement of activeView.placements) {
    const element = elementById.get(placement.elementId);
    if (!element) {
      issues.push({
        code: 'missing-element',
        message: `Placement '${placement.id}' references missing element '${placement.elementId}'`,
        entityId: placement.id,
      });
      continue;
    }

    placedElementIds.add(element.id);
    placementByElementId.set(element.id, placement);
    if (collapsedGroupByElementId.has(element.id)) continue;

    const layer = getCatalogLayer(element.visualKind);
    const stripeColor = layer ? CATALOG_LAYER_COLORS[layer] : null;

    nodes.push({
      id: placement.id, // placement.id as ReactFlow node id
      type: 'elementNode',
      position: { x: placement.x, y: placement.y },
      data: {
        kind: 'element',
        element,
        placement,
        layer,
        stripeColor,
      },
      style: { width: placement.width },
      zIndex: 1,
    });
  }

  // 2. Groups (presentation: boundary around placed members)
  for (const group of activeView.groups) {
    const memberPlacements = activeView.placements.filter(
      (p) => group.elementIds.includes(p.elementId) && placedElementIds.has(p.elementId),
    );
    if (memberPlacements.length === 0) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const p of memberPlacements) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.width);
      maxY = Math.max(maxY, p.y + ESTIMATED_ELEMENT_NODE_HEIGHT);
    }

    const boxX = minX - GROUP_PADDING_X;
    const boxY = minY - GROUP_PADDING_Y_TOP;
    const boxWidth = maxX - minX + GROUP_PADDING_X * 2;
    const boxHeight = maxY - minY + GROUP_PADDING_Y_TOP + GROUP_PADDING_Y_BOTTOM;

    // Collapsed: one compact node at the bounding-box origin; it is draggable
    // (CanvasView moves every member by the same delta in one undo).
    const collapsed = group.collapsed;
    const width = collapsed ? COLLAPSED_GROUP_WIDTH : boxWidth;
    const height = collapsed ? COLLAPSED_GROUP_HEIGHT : boxHeight;
    nodes.push({
      id: group.id, // group.id as ReactFlow node id (no prefix)
      type: 'groupNode',
      position: { x: boxX, y: boxY },
      data: {
        kind: 'group',
        group,
        label: group.label,
        width,
        height,
        collapsed,
        memberCount: memberPlacements.length,
      },
      selectable: false,
      draggable: collapsed,
      zIndex: collapsed ? 1 : 0,
      style: { width, height },
    });
  }

  // 3. Notes (presentation: note card with text)
  for (const note of activeView.notes) {
    nodes.push({
      id: note.id, // note.id as ReactFlow node id (no prefix)
      type: 'noteNode',
      position: { x: note.x, y: note.y },
      data: {
        kind: 'note',
        note,
        text: note.text,
        tone: note.tone,
        width: note.width,
      },
      selectable: true,
      draggable: false,
      zIndex: 2,
      style: { width: note.width },
    });
  }

  // 4. Edges from connections in view.connectionIds whose endpoints are both placed
  const connectionById = new Map<Id, Connection>(
    document.connections.map((c) => [c.id, c]),
  );

  const edges: ProjectedEdge[] = [];
  const reroutedEdges = new Map<string, ProjectedEdge>();
  const activeConnectionIds = new Set(activeView.connectionIds);

  for (const connId of activeConnectionIds) {
    const conn = connectionById.get(connId);
    if (!conn) {
      issues.push({
        code: 'missing-connection',
        message: `View '${activeView.id}' references missing connection '${connId}'`,
        entityId: connId,
      });
      continue;
    }

    const sourcePlacement = placementByElementId.get(conn.source.elementId);
    const targetPlacement = placementByElementId.get(conn.target.elementId);
    if (!sourcePlacement || !targetPlacement) continue;

    const sourceGroup = collapsedGroupByElementId.get(conn.source.elementId);
    const targetGroup = collapsedGroupByElementId.get(conn.target.elementId);
    // Both ends inside one collapsed group: internal, hidden with the members.
    if (sourceGroup && sourceGroup === targetGroup) continue;

    // Stroke dash styling:
    // call: solid, message: dashed, data: dotted
    let strokeDasharray: string | undefined;
    if (conn.kind === 'message') {
      strokeDasharray = '6,4';
    } else if (conn.kind === 'data') {
      strokeDasharray = '2,3';
    }

    const source = sourceGroup ? sourceGroup.id : sourcePlacement.id;
    const target = targetGroup ? targetGroup.id : targetPlacement.id;
    const rerouted = Boolean(sourceGroup || targetGroup);
    // One visual edge per (source, target, kind) once rerouted.
    const reroutedKey = `${source}\u0000${target}\u0000${conn.kind}`;
    if (rerouted && reroutedEdges.has(reroutedKey)) continue;

    const edge: ProjectedEdge = {
      id: rerouted ? `rerouted:${conn.id}` : conn.id,
      source,
      target,
      // Custom edge (TrafficEdge): smoothstep routing + an HTML label chip
      // rendered above the node layer, instead of the default bezier/SVG label.
      type: 'traffic',
      label: conn.label || undefined,
      labelShowBg: true,
      labelBgStyle: {
        fill: '#F7F5F1',
        stroke: '#DCD7CD',
        strokeWidth: 1,
      },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 4,
      labelStyle: {
        fill: '#4A544F',
        fontSize: 10,
        fontFamily: 'IBM Plex Sans, sans-serif',
        fontWeight: 500,
      },
      style: {
        strokeWidth: 1.5,
        stroke: '#4A544F',
        strokeDasharray,
      },
      data: {
        connection: conn,
        kind: conn.kind,
        ...(rerouted ? { rerouted: true } : {}),
      },
    };
    if (rerouted) reroutedEdges.set(reroutedKey, edge);
    edges.push(edge);
  }

  return {
    activeView,
    hasMultipleViews,
    views,
    nodes,
    edges,
    issues,
    empty: false,
  };
}

/**
 * Builds a single 'replace' RecordChange for the active View with moved placement coordinates.
 * Coordinates are matched by placement.id (ReactFlow node id).
 * Returns null if no placements moved or movedNodes is empty.
 */
export function buildMoveChange(
  view: View,
  movedNodes: readonly { readonly id: string; readonly position: { readonly x: number; readonly y: number } }[],
): RecordChange | null {
  if (!view || !movedNodes || movedNodes.length === 0) return null;

  const movedMap = new Map(movedNodes.map((n) => [n.id, n.position]));
  let hasChanges = false;

  const updatedPlacements = view.placements.map((placement) => {
    const moved = movedMap.get(placement.id);
    if (!moved) return placement;

    const newX = Math.round(moved.x);
    const newY = Math.round(moved.y);

    if (placement.x !== newX || placement.y !== newY) {
      hasChanges = true;
      return {
        ...placement,
        x: newX,
        y: newY,
      };
    }
    return placement;
  });

  if (!hasChanges) return null;

  const updatedView: View = {
    ...view,
    placements: updatedPlacements,
  };

  return {
    kind: 'replace',
    value: {
      recordKind: 'view',
      record: updatedView,
    },
  };
}

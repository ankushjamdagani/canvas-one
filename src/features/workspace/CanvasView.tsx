import * as React from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useViewport,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnNodeDrag,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Document, Id } from '../../domain/studio/model';
import { NodeCard } from './NodeCard';
import { GroupNode } from './GroupNode';
import { NoteNode } from './NoteNode';
import { TrafficEdge } from './TrafficEdge';
import { FloatingDock } from './FloatingDock';
import {
  projectDocumentToCanvas,
  type ProjectedNodeData,
} from './projection';
import { NativeSelect } from '@/components/ui/native-select';
import type { InspectorTargetKind } from '../inspector';

export type CanvasSelectionRequest = {
  readonly kind: InspectorTargetKind;
  readonly id: Id;
  readonly additive: boolean;
};

const nodeTypes = {
  elementNode: NodeCard,
  groupNode: GroupNode,
  noteNode: NoteNode,
};

const edgeTypes = {
  traffic: TrafficEdge,
};

export interface CanvasViewProps {
  document: Document | null;
  activeViewId: Id | null;
  onSelectView: (viewId: Id) => void;
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onMoveNodes: (
    movedNodes: Array<{ id: string; position: { x: number; y: number } }>,
  ) => Promise<boolean>;
  /** Currently selected element ids (inspector target), for visual highlight only. */
  selectedElementIds?: ReadonlySet<Id>;
  /** Currently selected connection ids (inspector target), for visual highlight only. */
  selectedConnectionIds?: ReadonlySet<Id>;
  /** A node/edge was clicked -- the caller (Workspace) runs the navigation guard. */
  onRequestSelection?: (request: CanvasSelectionRequest) => void;
  /** Empty canvas was clicked -- clears selection through the guard. */
  onRequestClearSelection?: () => void;
}

function CanvasFlowInner({
  document,
  activeViewId,
  onSelectView,
  isSaving,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onMoveNodes,
  selectedElementIds,
  selectedConnectionIds,
  onRequestSelection,
  onRequestClearSelection,
}: CanvasViewProps) {
  const [dragMode, setDragMode] = React.useState<'select' | 'pan'>('select');
  const reactFlow = useReactFlow();
  const { zoom } = useViewport();

  const projection = React.useMemo(() => {
    return projectDocumentToCanvas(document, activeViewId);
  }, [document, activeViewId]);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node>(
    projection.nodes as unknown as Node[],
  );
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>(
    projection.edges as unknown as Edge[],
  );

  // Selection is owned by the inspector's navigation guard (Workspace), not by
  // ReactFlow's own click-selection: 'select' changes are dropped here and the
  // `selected` flag is instead derived below from selectedElementIds /
  // selectedConnectionIds, which only change once the guard has approved the
  // navigation (commands.md §6: "the guard runs before any change").
  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeRaw(changes.filter((c) => c.type !== 'select'));
    },
    [onNodesChangeRaw],
  );
  const onEdgesChange = React.useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChangeRaw(changes.filter((c) => c.type !== 'select'));
    },
    [onEdgesChangeRaw],
  );

  // Sync projected nodes and edges when document or activeViewId changes
  React.useEffect(() => {
    setNodes(projection.nodes as unknown as Node[]);
    setEdges(projection.edges as unknown as Edge[]);
  }, [projection, setNodes, setEdges]);

  const displayNodes = React.useMemo(
    () =>
      nodes.map((n) => {
        const data = n.data as unknown as ProjectedNodeData;
        const selected = data.kind === 'element' ? Boolean(selectedElementIds?.has(data.element.id)) : false;
        return selected === n.selected ? n : { ...n, selected };
      }),
    [nodes, selectedElementIds],
  );

  const displayEdges = React.useMemo(
    () =>
      edges.map((e) => {
        const data = e.data as { connection?: { id: string } } | undefined;
        const connId = data?.connection?.id;
        const selected = connId ? Boolean(selectedConnectionIds?.has(connId)) : false;
        return selected === e.selected ? e : { ...e, selected };
      }),
    [edges, selectedConnectionIds],
  );

  const handleNodeClick: NodeMouseHandler = React.useCallback(
    (event, node) => {
      const data = node.data as unknown as ProjectedNodeData;
      if (data.kind !== 'element') return;
      onRequestSelection?.({ kind: 'element', id: data.element.id, additive: event.shiftKey });
    },
    [onRequestSelection],
  );

  const handleEdgeClick: EdgeMouseHandler = React.useCallback(
    (event, edge) => {
      const data = edge.data as { connection?: { id: string } } | undefined;
      if (!data?.connection?.id) return;
      onRequestSelection?.({ kind: 'connection', id: data.connection.id, additive: event.shiftKey });
    },
    [onRequestSelection],
  );

  const handlePaneClick = React.useCallback(() => {
    onRequestClearSelection?.();
  }, [onRequestClearSelection]);

  // Node drag end handler:
  // Identify nodes by node.type (not string prefixes on IDs)
  // Moved list built by placement.id (ReactFlow node id)
  const handleNodeDragStop: OnNodeDrag = React.useCallback(
    async (_event, node, draggedNodes) => {
      if (!projection.activeView || isSaving) return;

      const nodesToProcess =
        draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];

      // Filter only element nodes by node.type (groups/notes are presentation)
      const elementNodes = nodesToProcess.filter(
        (n) => n.type === 'elementNode',
      );
      if (elementNodes.length === 0) return;

      const movedList = elementNodes.map((n) => ({
        id: n.id, // placement.id
        position: { x: n.position.x, y: n.position.y },
      }));

      const success = await onMoveNodes(movedList);
      if (!success) {
        // Snap back to document positions on failure
        setNodes(projection.nodes as unknown as Node[]);
      }
    },
    [projection, isSaving, onMoveNodes, setNodes],
  );

  // Zoom controls per specs/revamp/contracts/commands.md §4:
  // factor 1.2, clamped 0.1–2, fit padding exactly 32 px
  const handleZoomIn = React.useCallback(() => {
    const current = reactFlow.getZoom();
    const next = Math.min(2.0, current * 1.2);
    reactFlow.zoomTo(next, { duration: 150 });
  }, [reactFlow]);

  const handleZoomOut = React.useCallback(() => {
    const current = reactFlow.getZoom();
    const next = Math.max(0.1, current / 1.2);
    reactFlow.zoomTo(next, { duration: 150 });
  }, [reactFlow]);

  const handleFitView = React.useCallback(() => {
    reactFlow.fitView({
      padding: '32px',
      minZoom: 0.1,
      maxZoom: 2.0,
      duration: 150,
    });
  }, [reactFlow]);

  // Camera fitting per requirement 3:
  // Fit the view (32 px padding, zoom clamp 0.1–2) when a document/view is first shown
  // and when switching views; never re-fit after a drag or undo/redo.
  //
  // Review round 1: the automatic open/view-switch fit must never zoom IN past
  // 100% for a small diagram (screens show 100%, not 161%) — so this one caps
  // at maxZoom 1, a narrower clamp than the contract's general 0.1–2 (lead
  // reading: the contract clamp bounds what a user-driven zoom gesture may
  // reach, not what the camera should assume on a passive open). The Fit
  // *button* (handleFitView above) is a deliberate user gesture and keeps the
  // full 0.1–2 contract clamp.
  const lastFittedKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const docId = document?.id;
    const viewId = projection.activeView?.id;
    if (!docId || !viewId) return;

    const key = `${docId}:${viewId}`;
    if (lastFittedKeyRef.current !== key) {
      lastFittedKeyRef.current = key;
      const timer = setTimeout(() => {
        reactFlow.fitView({
          padding: '32px',
          minZoom: 0.1,
          maxZoom: 1,
          duration: 0,
        });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [document?.id, projection.activeView?.id, reactFlow]);

  if (projection.empty) {
    return (
      <div
        data-testid="empty-views-state"
        className="flex-1 h-full w-full flex flex-col items-center justify-center p-8 text-center bg-canvas select-none"
      >
        <div className="max-w-md p-6 rounded-card border border-control-border bg-panel shadow-raised">
          <p className="text-sm font-semibold text-ink">
            This project has no views yet
          </p>
          <p className="text-xs text-secondary-text mt-1">
            This project has no views configured in its document.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="canvas-container"
      className="relative flex-1 w-full h-full overflow-hidden bg-canvas"
    >
      {/* View selector when the document has more than one view */}
      {projection.hasMultipleViews && (
        <div
          data-testid="view-selector-container"
          className="absolute top-3 left-3 z-10 flex items-center gap-2 px-2.5 py-1.5 rounded-control bg-panel border border-control-border shadow-raised"
        >
          <span className="text-xs font-medium text-secondary-text">View:</span>
          <NativeSelect
            data-testid="view-selector"
            value={projection.activeView?.id ?? ''}
            onChange={(e) => onSelectView(e.target.value)}
            className="h-6 text-xs bg-canvas px-2 rounded-tag border-control-border"
          >
            {projection.views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      {/* Non-blocking projection issues notice */}
      {projection.issues.length > 0 && (
        <div
          data-testid="canvas-issues-notice"
          className="absolute bottom-3 left-3 z-10 max-w-sm pointer-events-auto p-2.5 rounded-card border border-riskEdge bg-riskTint text-destructive text-xs shadow-raised"
          role="status"
        >
          <div className="font-semibold mb-1">
            Notice ({projection.issues.length}):
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {projection.issues.map((issue, idx) => (
              <li key={idx} className="truncate" title={issue.message}>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodesDraggable={!isSaving}
        nodesConnectable={false}
        panOnDrag={dragMode === 'pan'}
        selectionOnDrag={dragMode === 'select'}
        panOnScroll
        minZoom={0.1}
        maxZoom={2.0}
        fitView
        fitViewOptions={{
          padding: '32px',
          minZoom: 0.1,
          // Mount-time auto-fit is passive, not a user zoom gesture: cap at
          // 100% so a small diagram never opens zoomed in past 1x (matches
          // the maxZoom:1 effect below; the viewport's own maxZoom={2.0}
          // above still bounds user-driven zoom/pan gestures per the 0.1–2
          // contract clamp).
          maxZoom: 1,
        }}
        proOptions={{ hideAttribution: true }}
        className="system-canvas bg-canvas"
      >
        {/* Dotted canvas background from design token CSS variable */}
        <Background color="var(--control-border)" gap={16} size={1} />
      </ReactFlow>

      {/* 16A Canvas Dock */}
      <FloatingDock
        dragMode={dragMode}
        onSetDragMode={setDragMode}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitView={handleFitView}
        zoom={zoom}
      />
    </div>
  );
}

export function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner {...props} />
    </ReactFlowProvider>
  );
}

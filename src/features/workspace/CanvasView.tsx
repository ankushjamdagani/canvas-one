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
import type { RecordChange } from '../../persistence/studio/types';
import { NodeCard } from './NodeCard';
import { GroupNode } from './GroupNode';
import { NoteNode } from './NoteNode';
import { TrafficEdge } from './TrafficEdge';
import { FloatingDock } from './FloatingDock';
import {
  projectDocumentToCanvas,
  type ProjectedNodeData,
} from './projection';
import { planDelete, type DeletePlan } from './deletePlan';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2 } from 'lucide-react';
import type { InspectorTargetKind } from '../inspector';
import { LibraryPicker } from '../library';
import { CATALOG_ENTRY_MIME_TYPE } from '../library/types';
import { getEntry } from '../catalog/catalog';
import { placeEntry } from '../catalog/place';
import { planConnection, completeConnection, type ConnectionDraft } from '../catalog/connect';

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

type DragMode = 'select' | 'pan' | 'connect';

type RejectMessage = { readonly text: string; readonly x: number; readonly y: number };
type ResourceFormState = {
  readonly draft: ConnectionDraft;
  readonly x: number;
  readonly y: number;
  readonly requestClass: string;
  // No contracted default (catalog.md resolution 8: "No default deadline" --
  // the same applies to operation, which the form must not preselect).
  readonly operation: 'read' | 'write' | null;
  readonly deadlineMs: string;
  readonly error: string | null;
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
  /** RV-12e: mints ids for placeEntry / planConnection RecordChange batches. */
  mintId: () => Id;
  /**
   * RV-12e: applies one model.apply-records batch (one gesture == one undo).
   * Returns false on busy/failed/rejected so callers can leave nothing
   * destructive on screen and let the user retry (commands.md "busy").
   */
  onApplyChanges: (changes: readonly RecordChange[], label: string) => Promise<boolean>;
}

/** Rebuilds canvas nodes from the projection, keeping each existing node's
 * ReactFlow measurement (see the sync effect in CanvasView). */
function keepMeasurements(
  previous: readonly Node<ProjectedNodeData>[],
  next: readonly Node<ProjectedNodeData>[],
): Node<ProjectedNodeData>[] {
  const measuredById = new Map(previous.map((node) => [node.id, node.measured]));
  return next.map((node) => {
    const measured = measuredById.get(node.id);
    return measured ? { ...node, measured } : node;
  });
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
  mintId,
  onApplyChanges,
}: CanvasViewProps) {
  const [dragMode, setDragMode] = React.useState<DragMode>('select');
  const reactFlow = useReactFlow();
  const { zoom } = useViewport();
  const containerRef = React.useRef<HTMLDivElement>(null);

  const projection = React.useMemo(() => {
    return projectDocumentToCanvas(document, activeViewId);
  }, [document, activeViewId]);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node<ProjectedNodeData>>(
    projection.nodes as Node<ProjectedNodeData>[],
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
    (changes: NodeChange<Node<ProjectedNodeData>>[]) => {
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

  // Sync projected nodes and edges when document or activeViewId changes.
  // Projection builds fresh node objects without ReactFlow's `measured`
  // size; ReactFlow hides an unmeasured node (and skips its edges) until a
  // ResizeObserver callback, which never comes when the DOM size is
  // unchanged. Carrying the last measurement over keeps existing nodes
  // visible; a real size change still re-measures through the observer.
  React.useEffect(() => {
    setNodes((previous) => keepMeasurements(previous, projection.nodes));
    setEdges(projection.edges as unknown as Edge[]);
  }, [projection, setNodes, setEdges]);

  // RV-12e: handles are connectable in Connect mode, and also mid-drag from a
  // handle while in Select mode (commands.md §4). ReactFlow only starts a
  // connection gesture from a pointerdown on the handle itself, so marking
  // handles connectable in both modes is what makes "drag from a handle while
  // in Select mode" possible without hijacking ordinary node dragging/panning.
  const displayNodes = React.useMemo(
    () =>
      nodes.map((n) => {
        const data = n.data;
        if (data.kind !== 'element') return n;
        const selected = Boolean(selectedElementIds?.has(data.element.id));
        const connectable = dragMode !== 'pan';
        if (selected === n.selected && connectable === data.connectable) return n;
        return { ...n, selected, data: { ...data, connectable } };
      }),
    [nodes, selectedElementIds, dragMode],
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

  const handleNodeClick: NodeMouseHandler<Node<ProjectedNodeData>> = React.useCallback(
    (event, node) => {
      const data = node.data;
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
  const handleNodeDragStop: OnNodeDrag<Node<ProjectedNodeData>> = React.useCallback(
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
        setNodes((previous) => keepMeasurements(previous, projection.nodes));
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

  // ==========================================================================
  // RV-12e: Component (library.open) -- 16E picker anchored above the dock
  // ==========================================================================

  const [componentPickerOpen, setComponentPickerOpen] = React.useState(false);
  const pickerContainerRef = React.useRef<HTMLDivElement>(null);

  const closeComponentPicker = React.useCallback(() => setComponentPickerOpen(false), []);

  // Outside click closes the picker (D30: single instance, no stacked overlays).
  React.useEffect(() => {
    if (!componentPickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (pickerContainerRef.current && !pickerContainerRef.current.contains(e.target as globalThis.Node)) {
        setComponentPickerOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [componentPickerOpen]);

  const applyPlacement = React.useCallback(
    async (entryId: string, anchor: { x: number; y: number }) => {
      if (!document || !projection.activeView || isSaving) return;
      const result = placeEntry({
        document,
        viewId: projection.activeView.id,
        entryId,
        anchor,
        mintId,
      });
      if (!result.ok) return;
      const applied = await onApplyChanges(result.changes, 'Add component');
      if (!applied) return;
      onRequestSelection?.({ kind: 'element', id: result.elementId, additive: false });
    },
    [document, projection.activeView, isSaving, mintId, onApplyChanges, onRequestSelection],
  );

  // Enter / "Place": places the focused entry at the viewport centre.
  const handlePlaceAtCentre = React.useCallback(
    async (entryId: string) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const centreScreen = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const centreFlow = reactFlow.screenToFlowPosition(centreScreen);
      setComponentPickerOpen(false);
      await applyPlacement(entryId, centreFlow);
    },
    [reactFlow, applyPlacement],
  );

  // Dragging a picker card onto the canvas places it at the drop point.
  const handleCanvasDragOver = React.useCallback((e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes(CATALOG_ENTRY_MIME_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleCanvasDrop = React.useCallback(
    async (e: React.DragEvent) => {
      const entryId = e.dataTransfer.getData(CATALOG_ENTRY_MIME_TYPE);
      if (!entryId || !getEntry(entryId)) return;
      e.preventDefault();
      const flowPoint = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // D30 single instance: a drag-drop placement closes the picker too (not
      // just Enter/"Place" via handlePlaceAtCentre) -- otherwise it stays
      // open, covering the canvas.
      setComponentPickerOpen(false);
      await applyPlacement(entryId, flowPoint);
    },
    [reactFlow, applyPlacement],
  );

  // ==========================================================================
  // RV-12e: Connect tool -- planConnection / completeConnection
  // ==========================================================================

  const [rejectMessage, setRejectMessage] = React.useState<RejectMessage | null>(null);
  const [resourceForm, setResourceForm] = React.useState<ResourceFormState | null>(null);

  React.useEffect(() => {
    if (!rejectMessage) return;
    const timer = setTimeout(() => setRejectMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [rejectMessage]);

  const handleConnectEnd = React.useCallback(
    async (event: MouseEvent | TouchEvent, connectionState: unknown) => {
      if (!document || !projection.activeView || isSaving) return;
      const state = connectionState as {
        isValid: boolean | null;
        fromNode: { id: string } | null;
        fromHandle: { type: 'source' | 'target' } | null;
        toNode: { id: string } | null;
      };
      const fromNodeId = state.fromNode?.id ?? null;
      const toNodeId = state.toNode?.id ?? null;
      if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;

      // A connection can be dragged starting from either handle; normalize to
      // sourceNodeId (the 'out' side) -> targetNodeId (the 'in' side).
      const startedFromSource = state.fromHandle?.type !== 'target';
      const sourceNodeId = startedFromSource ? fromNodeId : toNodeId;
      const targetNodeId = startedFromSource ? toNodeId : fromNodeId;

      const clientPoint = (() => {
        if ('clientX' in event) return { x: event.clientX, y: event.clientY };
        const touch = event.changedTouches[0];
        return touch ? { x: touch.clientX, y: touch.clientY } : { x: 0, y: 0 };
      })();

      const sourceNode = nodes.find((n) => n.id === sourceNodeId);
      const targetNode = nodes.find((n) => n.id === targetNodeId);
      const sourceData = sourceNode?.data;
      const targetData = targetNode?.data;
      if (!sourceData || sourceData.kind !== 'element' || !targetData || targetData.kind !== 'element') {
        return;
      }

      const sourceElement = sourceData.element;
      const targetElement = targetData.element;
      const sourcePort = sourceElement.ports.find((p) => p.direction === 'out' && p.channel !== 'event');
      if (!sourcePort) {
        setRejectMessage({ text: `'${sourceElement.label}' has no outbound port to connect from.`, ...clientPoint });
        return;
      }

      const result = planConnection({
        document,
        viewId: projection.activeView.id,
        source: { elementId: sourceElement.id, portId: sourcePort.id },
        target: { elementId: targetElement.id },
        mintId,
      });

      if (result.kind === 'rejected') {
        if (result.issues.length === 0) {
          throw new Error('planConnection: rejected result with no issues (contract violation)');
        }
        setRejectMessage({ text: result.issues[0].message, ...clientPoint });
        return;
      }
      if (result.kind === 'needs-resource-metadata') {
        setResourceForm({
          draft: result.draft,
          ...clientPoint,
          requestClass: '',
          operation: null,
          deadlineMs: '',
          error: null,
        });
        return;
      }
      await onApplyChanges(result.changes, 'Connect');
    },
    [document, projection.activeView, isSaving, nodes, mintId, onApplyChanges],
  );

  const cancelResourceForm = React.useCallback(() => setResourceForm(null), []);

  const requestClasses = React.useMemo(() => {
    const classes = new Map<Id, { requestClassId: Id; requestClassLabel: string }>();
    if (!document) return [];
    for (const connection of document.connections) {
      if ((connection.kind === 'call' || connection.kind === 'message') && connection.config.resource) {
        const { requestClassId, requestClassLabel } = connection.config.resource;
        classes.set(requestClassId, { requestClassId, requestClassLabel });
      }
    }
    return [...classes.values()];
  }, [document]);
  const requestClassListId = React.useId();

  // catalog.md resolution 8: request class (text), read/write and deadline
  // have no contracted default -- neither operation nor deadline is
  // preselected, and Connect stays disabled until every field is filled in.
  const resourceFormValid = React.useMemo(() => {
    if (!resourceForm) return false;
    const deadline = Number(resourceForm.deadlineMs);
    return (
      Array.from(resourceForm.requestClass).length > 0 &&
      Array.from(resourceForm.requestClass).length <= 60 &&
      resourceForm.operation !== null &&
      resourceForm.deadlineMs.trim().length > 0 &&
      Number.isFinite(deadline) &&
      deadline > 0
    );
  }, [resourceForm]);

  const confirmResourceForm = React.useCallback(async () => {
    if (!resourceForm) return;
    if (Array.from(resourceForm.requestClass).length === 0 || Array.from(resourceForm.requestClass).length > 60) {
      setResourceForm({ ...resourceForm, error: 'Request class must contain 1–60 characters.' });
      return;
    }
    if (resourceForm.operation === null) {
      setResourceForm({ ...resourceForm, error: 'Choose read or write.' });
      return;
    }
    const deadline = Number(resourceForm.deadlineMs);
    if (resourceForm.deadlineMs.trim().length === 0 || !Number.isFinite(deadline) || deadline <= 0) {
      setResourceForm({ ...resourceForm, error: 'Deadline must be a positive number of ms.' });
      return;
    }
    const existingClass = requestClasses.find((entry) => entry.requestClassLabel === resourceForm.requestClass);
    const result = completeConnection(resourceForm.draft, {
      requestClassId: existingClass ? existingClass.requestClassId : mintId(),
      requestClassLabel: resourceForm.requestClass,
      operation: resourceForm.operation,
      deadlineDurationMs: deadline,
    });
    if (!result.ok) {
      if (result.issues.length === 0) {
        throw new Error('completeConnection: rejected result with no issues (contract violation)');
      }
      setResourceForm({ ...resourceForm, error: result.issues[0].message });
      return;
    }
    setResourceForm(null);
    await onApplyChanges(result.changes, 'Connect');
  }, [resourceForm, requestClasses, onApplyChanges, mintId]);

  // ==========================================================================
  // RV-12e: Delete -- Delete/Backspace on canvas focus, or the 16D toolbar
  // ==========================================================================

  const [deleteConfirm, setDeleteConfirm] = React.useState<DeletePlan | null>(null);

  const currentSelection = React.useMemo(
    () => ({
      elementIds: Array.from(selectedElementIds ?? []),
      connectionIds: Array.from(selectedConnectionIds ?? []),
    }),
    [selectedElementIds, selectedConnectionIds],
  );
  const hasSelection = currentSelection.elementIds.length > 0 || currentSelection.connectionIds.length > 0;

  const runDeletePlan = React.useCallback(
    (plan: DeletePlan) => {
      if (plan.changes.length === 0) return;
      if (plan.requiresConfirmation) {
        setDeleteConfirm(plan);
        return;
      }
      void onApplyChanges(plan.changes, 'Delete').then((applied) => {
        if (applied) onRequestClearSelection?.();
      });
    },
    [onApplyChanges, onRequestClearSelection],
  );

  const handleDeleteSelection = React.useCallback(() => {
    if (!document || !projection.activeView || isSaving || !hasSelection) return;
    const plan = planDelete(document, projection.activeView.id, currentSelection);
    runDeletePlan(plan);
  }, [document, projection.activeView, isSaving, hasSelection, currentSelection, runDeletePlan]);

  const confirmDelete = React.useCallback(async () => {
    if (!deleteConfirm) return;
    const applied = await onApplyChanges(deleteConfirm.changes, 'Delete');
    setDeleteConfirm(null);
    if (applied) onRequestClearSelection?.();
  }, [deleteConfirm, onApplyChanges, onRequestClearSelection]);

  const handleCanvasKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (!hasSelection) return;
      e.preventDefault();
      handleDeleteSelection();
    },
    [hasSelection, handleDeleteSelection],
  );

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
      ref={containerRef}
      data-testid="canvas-container"
      tabIndex={0}
      onKeyDown={handleCanvasKeyDown}
      onDragOver={handleCanvasDragOver}
      onDrop={(e) => void handleCanvasDrop(e)}
      className="relative flex-1 w-full h-full overflow-hidden bg-canvas outline-none"
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

      {/* 16D "Selection-scoped actions" -- delete only, per this task's scope */}
      {hasSelection && (
        <div
          data-testid="selection-toolbar"
          className="absolute top-3 right-3 z-10 flex items-center gap-1 px-1.5 py-1 rounded-control bg-panel border border-control-border shadow-raised"
        >
          <Button
            data-testid="selection-delete-btn"
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-destructive hover:text-destructive"
            aria-label="Delete selection"
            disabled={isSaving}
            onClick={handleDeleteSelection}
          >
            <Trash2 className="size-4" />
          </Button>
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
        onConnectEnd={(event, state) => void handleConnectEnd(event, state)}
        nodesDraggable={!isSaving}
        nodesConnectable={!isSaving}
        panOnDrag={dragMode === 'pan'}
        selectionOnDrag={dragMode === 'select'}
        panOnScroll
        minZoom={0.1}
        maxZoom={2.0}
        // Delete/Backspace are handled above as one undoable command (with
        // the dependency preview); ReactFlow's own key would drop the node
        // locally even when that preview is cancelled.
        deleteKeyCode={null}
        // No `fitView` prop: it also fires when an empty view gets its first
        // node, moving the camera after a placement. The open/view-switch
        // effect above is the only automatic fit.
        proOptions={{ hideAttribution: true }}
        className="system-canvas bg-canvas"
      >
        {/* Dotted canvas background from design token CSS variable */}
        <Background color="var(--control-border)" gap={16} size={1} />
      </ReactFlow>

      {/* Connect: rejected -- small inline message near the pointer/edge */}
      {rejectMessage && (
        <div
          data-testid="connect-rejected-message"
          role="status"
          className="fixed z-tooltip max-w-xs px-2.5 py-1.5 rounded-control bg-destructive text-white text-xs shadow-raised pointer-events-none"
          style={{ left: rejectMessage.x + 12, top: rejectMessage.y + 12 }}
        >
          {rejectMessage.text}
        </div>
      )}

      {/* Connect into a resource: compact popover form at the drop point */}
      {resourceForm && (
        <div
          data-testid="connect-resource-form"
          role="dialog"
          aria-label="Connection details"
          className="fixed z-modal w-64 p-3 rounded-card border border-control-border bg-panel shadow-floating text-xs"
          style={{ left: Math.min(resourceForm.x, window.innerWidth - 272), top: Math.min(resourceForm.y, window.innerHeight - 220) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelResourceForm();
            } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
              e.preventDefault();
              void confirmResourceForm();
            }
          }}
        >
          <div className="font-semibold text-ink mb-2">Connection details</div>

          <label className="block mb-2">
            <span className="block text-secondary-text mb-0.5">Request class</span>
            <input
              data-testid="connect-form-request-class"
              list={requestClassListId}
              placeholder="Choose or name a class"
              autoFocus
              type="text"
              value={resourceForm.requestClass}
              onChange={(e) => setResourceForm({ ...resourceForm, requestClass: e.target.value, error: null })}
              className="w-full h-7 px-2 rounded-tag border border-control-border bg-canvas text-ink"
            />
            <datalist id={requestClassListId}>
              {requestClasses.map((entry) => (
                <option key={entry.requestClassId} value={entry.requestClassLabel} />
              ))}
            </datalist>
          </label>

          <fieldset className="mb-2">
            <legend className="text-secondary-text mb-0.5">Operation</legend>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1">
                <input
                  data-testid="connect-form-op-read"
                  type="radio"
                  name="operation"
                  checked={resourceForm.operation === 'read'}
                  onChange={() => setResourceForm({ ...resourceForm, operation: 'read', error: null })}
                />
                read
              </label>
              <label className="flex items-center gap-1">
                <input
                  data-testid="connect-form-op-write"
                  type="radio"
                  name="operation"
                  checked={resourceForm.operation === 'write'}
                  onChange={() => setResourceForm({ ...resourceForm, operation: 'write', error: null })}
                />
                write
              </label>
            </div>
          </fieldset>

          <label className="block mb-2">
            <span className="block text-secondary-text mb-0.5">Deadline (ms)</span>
            <input
              data-testid="connect-form-deadline"
              type="number"
              min={1}
              value={resourceForm.deadlineMs}
              onChange={(e) => setResourceForm({ ...resourceForm, deadlineMs: e.target.value, error: null })}
              className="w-full h-7 px-2 rounded-tag border border-control-border bg-canvas text-ink"
            />
          </label>

          {resourceForm.error && (
            <p data-testid="connect-form-error" className="text-destructive mb-2">
              {resourceForm.error}
            </p>
          )}

          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={cancelResourceForm}>
              Cancel
            </Button>
            <Button
              data-testid="connect-form-confirm"
              type="button"
              variant="tint"
              size="sm"
              disabled={!resourceFormValid}
              onClick={() => void confirmResourceForm()}
            >
              Connect
            </Button>
          </div>
        </div>
      )}

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
        onToggleComponentPicker={() => setComponentPickerOpen((v) => !v)}
        componentPickerOpen={componentPickerOpen}
        disabled={isSaving}
      />

      {/* 16E LibraryPicker, anchored above the dock -- D30 single instance */}
      {componentPickerOpen && (
        <div
          ref={pickerContainerRef}
          data-testid="component-picker-anchor"
          className="absolute bottom-16 sm:bottom-20 left-1/2 -translate-x-1/2 z-dock px-4 w-full max-w-[640px]"
        >
          <LibraryPicker
            onPlace={(entryId) => void handlePlaceAtCentre(entryId)}
            onOpenFullLibrary={() => {}}
            onClose={closeComponentPicker}
          />
        </div>
      )}

      {/* Delete confirmation when a scenario references what would be removed */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(next) => { if (!next) setDeleteConfirm(null); }}>
        <DialogContent data-testid="delete-confirm-dialog" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete will affect scenarios</DialogTitle>
            <DialogDescription>
              {deleteConfirm && (
                <>
                  These scenarios reference what you're deleting and will need attention:{' '}
                  <strong>{deleteConfirm.affectedScenarioLabels.join(', ')}</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              data-testid="delete-confirm-btn"
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

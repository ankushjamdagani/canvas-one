import * as React from 'react';
import { Input } from '@/components/ui/input';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useViewport,
  useNodesInitialized,
  ViewportPortal,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnNodeDrag,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Document, Id, NoteTone } from '../../domain/studio/model';
import type { RecordChange } from '../../persistence/studio/types';
import { NodeCard } from './NodeCard';
import { GroupNode } from './GroupNode';
import { NoteNode } from './NoteNode';
import { BoundaryFrameNode } from './BoundaryFrameNode';
import { TrafficEdge } from './TrafficEdge';
import { TrafficPulseContext, useTrafficPulses } from './trafficPulses';
import type { TraceEvent } from '../../domain/studio/runner/types';
import { FloatingDock } from './FloatingDock';
import { SelectionBox } from './SelectionBox';
import {
  projectDocumentToCanvas,
  type ProjectedNodeData,
  type MeasuredHeights,
} from './projection';
import { planDelete, type DeletePlan } from './deletePlan';
import { planAddNote, planUpdateNote, planDeleteNote } from './selectionPlans';
const NOTE_MIME_TYPE = 'application/x-system-studio-note';
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
import type { InspectorTargetKind } from '../inspector';
import { CATALOG_ENTRY_MIME_TYPE, LINKED_PROJECT_MIME_TYPE } from '../library/types';
import type { ProjectExposure } from '../../domain/studio/exposure';
import { PORT_PATH_MAX_LENGTH, PROTOCOL_LABELS, type Protocol } from '../../domain/studio/protocols';
import { getEntry } from '../catalog/catalog';
import { placeEntry } from '../catalog/place';
import { planConnection, completeConnection, type ConnectionDraft } from '../catalog/connect';
import { SelectionToolbar } from './SelectionToolbar';
import type { CommandContext, CommandId, CommandPayloads, ExecuteResult, ShortcutEvent } from './commands/registry';
import type { DockCommandId, DockConfig } from './dockConfig';

export type CanvasSelectionRequest =
  | {
      readonly kind: InspectorTargetKind | 'note';
      readonly id: Id;
      readonly additive: boolean;
    }
  | {
      readonly kind: InspectorTargetKind | 'note';
      readonly ids: readonly Id[];
      readonly additive?: boolean;
    }
  | {
      readonly kind: 'mixed';
      readonly elementIds: readonly Id[];
      readonly noteIds: readonly Id[];
      readonly additive?: boolean;
    };

const nodeTypes = {
  elementNode: NodeCard,
  boundaryFrameNode: BoundaryFrameNode,
  groupNode: GroupNode,
  noteNode: NoteNode,
};

const edgeTypes = {
  traffic: TrafficEdge,
};

type DragMode = 'select' | 'pan';

type RejectMessage = { readonly text: string; readonly x: number; readonly y: number };
type ResourceFormState = {
  readonly draft: ConnectionDraft;
  readonly x: number;
  readonly y: number;
  readonly error: string | null;
  /** D53: the endpoint path or name being typed; the draft is re-planned with it on confirm. */
  readonly path: string;
  /** D53: what the planner needs to re-plan when the connection type changes. */
  readonly plan: {
    readonly sourceElementId: Id;
    readonly sourcePortId: Id;
    readonly targetElementId: Id;
    readonly linkedExposures: readonly ProjectExposure[] | undefined;
  };
};

/** On-screen dot diameter of the canvas grid, held constant at every zoom. */
const GRID_DOT_PX = 2.4;
const GRID_PITCH = 26;

/**
 * Grid pitch in flow units. Zoomed in, the pitch is the 26px snap grid; zoomed out it doubles each time the
 * on-screen spacing would fall under ~16px, so the dots never crowd into a haze (the spacing resets to 26-52px
 * on screen at each step).
 */
function gridGapFor(zoom: number): number {
  const steps = Math.max(0, Math.ceil(Math.log2(16 / (GRID_PITCH * Math.max(zoom, 0.01)))));
  return GRID_PITCH * 2 ** steps;
}

export interface CanvasViewProps {
  document: Document | null;
  activeViewId: Id | null;
  onSelectView: (viewId: Id) => void;
  isSaving: boolean;
  /** Elements a workload of the scenario being edited enters at (board scenario_traffic_editor). */
  trafficEntryElementIds?: ReadonlySet<Id>;
  /** Trace events of the run in progress; each admitted request draws a dot along its connection. */
  runEvents?: readonly TraceEvent[];
  /** D52: details of the projects linked-project nodes point at (absent id = unavailable). */
  /** D53: reads what a project exposes right now (for linking and for connecting to a linked node). */
  loadLinkedExposures?: (projectId: string) => Promise<readonly ProjectExposure[]>;
  linkedProjects?: ReadonlyMap<string, { readonly title: string; readonly team: string; readonly description: string }> | null;
  /** D52: opens a linked project (guarded navigation owned by the workspace). */
  onOpenLinkedProject?: (projectId: string) => void;
  /** A dirty scenario draft blocks Run; the canvas says so (board scenario_traffic_editor). */
  runWaitsForScenarioDraft?: boolean;
  onMoveNodes: (
    movedNodes: Array<{ id: string; position: { x: number; y: number } }>,
  ) => Promise<boolean>;
  /** Currently selected element ids (inspector target), for visual highlight only. */
  selectedElementIds?: ReadonlySet<Id>;
  /** Currently selected connection ids (inspector target), for visual highlight only. */
  selectedConnectionIds?: ReadonlySet<Id>;
  /** Currently selected note ids, for visual highlight and operations. */
  selectedNoteIds?: ReadonlySet<Id>;
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
  /** Registry context and executor supplied by Workspace; toolbar/dock never mutate locally. */
  commandContext: CommandContext;
  onExecuteCommand: <K extends CommandId>(id: K, payload: CommandPayloads[K]) => Promise<ExecuteResult>;
  /**
   * Canvas-scoped shortcuts (Delete/Backspace) live in the registry: Workspace
   * matches the event and returns true only when an enabled command ran, so
   * `preventDefault` fires after a real match (commands.md §1).
   */
  onCanvasShortcut: (event: ShortcutEvent) => boolean;
  dockConfig: DockConfig;
  dockPreferenceState: 'loading' | 'ready' | 'saving' | 'failed';
  onConfigureDock: (config: DockConfig) => void;
  onRestoreDockDefaults: () => void;
}

/**
 * Imperative handle so the docked Library panel (rendered by PanelHost outside
 * this ReactFlowProvider) can place a catalog entry through applyPlacement.
 */
export interface CanvasViewHandle {
  placeAtCentre: (entryId: string, link?: { projectId: string; title: string }) => Promise<void>;
  getVisibleCentre: () => { readonly x: number; readonly y: number };
  /** Measured card heights by placement id, for bounding-box planners (align/distribute). */
  getMeasuredHeights: () => MeasuredHeights;
  /** selection.delete handler: dependency preview, scenario confirmation, one undoable apply. */
  deleteSelection: () => void;
  setToolMode: (mode: 'select' | 'pan') => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
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

const CanvasFlowInner = React.forwardRef<CanvasViewHandle, CanvasViewProps>(function CanvasFlowInner({
  document,
  activeViewId,
  onSelectView,
  isSaving,
  onMoveNodes,
  selectedElementIds,
  selectedConnectionIds,
  selectedNoteIds,
  onRequestSelection,
  onRequestClearSelection,
  mintId,
  onApplyChanges,
  commandContext,
  onExecuteCommand,
  onCanvasShortcut,
  dockConfig,
  dockPreferenceState,
  onConfigureDock,
  onRestoreDockDefaults,
  trafficEntryElementIds,
  runEvents,
  linkedProjects,
  loadLinkedExposures,
  onOpenLinkedProject,
  runWaitsForScenarioDraft,
}: CanvasViewProps, ref) {
  const [dragMode, setDragMode] = React.useState<DragMode>('select');
  const reactFlow = useReactFlow();
  const { zoom } = useViewport();
  const gridGap = gridGapFor(zoom);
  const trafficPulses = useTrafficPulses(runEvents, document?.connections);
  const nodesInitialized = useNodesInitialized();
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Measured card heights (placement id -> px) let group frames and align/distribute
  // use real sizes instead of the fixed estimate (e.g. for expanded cards). Held in state
  // and updated only when a measured element height actually changes, so the projection
  // below doesn't loop through its own group-node measurements.
  const [measuredHeights, setMeasuredHeights] = React.useState<MeasuredHeights>(() => new Map());
  const projection = React.useMemo(() => {
    return projectDocumentToCanvas(document, activeViewId, measuredHeights);
  }, [document, activeViewId, measuredHeights]);

  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node<ProjectedNodeData>>(
    projection.nodes as Node<ProjectedNodeData>[],
  );

  React.useEffect(() => {
    const next = new Map<string, number>();
    for (const node of nodes) {
      if (node.type === 'elementNode' && node.measured?.height) next.set(node.id, Math.round(node.measured.height));
    }
    setMeasuredHeights((previous) => {
      if (previous.size === next.size && [...next].every(([id, height]) => previous.get(id) === height)) return previous;
      return next;
    });
  }, [nodes]);
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>(
    projection.edges as unknown as Edge[],
  );

  const isBoxSelectingRef = React.useRef(false);
  const boxSelectedIdsRef = React.useRef<Set<string>>(new Set());

  // Selection is owned by the inspector's navigation guard (Workspace), not by
  // ReactFlow's own click-selection: 'select' changes are dropped here and the
  // `selected` flag is instead derived below from selectedElementIds /
  // selectedConnectionIds, which only change once the guard has approved the
  // navigation (commands.md §6: "the guard runs before any change").
  // When dragging a marquee selection box across the pane, we capture the selected
  // node IDs and dispatch batch selection onSelectionEnd.
  const onNodesChange = React.useCallback(
    (changes: NodeChange<Node<ProjectedNodeData>>[]) => {
      if (isBoxSelectingRef.current) {
        for (const c of changes) {
          if (c.type === 'select') {
            if (c.selected) boxSelectedIdsRef.current.add(c.id);
            else boxSelectedIdsRef.current.delete(c.id);
          }
        }
      }
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

  // Handles are connectable while in Select mode (commands.md §4). ReactFlow only starts a
  // connection gesture from a pointerdown on the handle itself, so marking
  // handles connectable in both modes is what makes "drag from a handle while
  // in Select mode" possible without hijacking ordinary node dragging/panning.
  const displayNodes = React.useMemo(
    () =>
      nodes.map((n) => {
        const data = n.data;
        if (data.kind === 'group') {
          const viewId = projection.activeView?.id;
          if (!viewId) return n;
          const payload = { viewId, target: { kind: 'group', id: data.group.id } } as const;
          return {
            ...n,
            data: {
              ...data,
              onToggleCollapsed: () =>
                void onExecuteCommand(data.collapsed ? 'canvas.expand' : 'canvas.collapse', payload),
              onUngroup: () =>
                void onExecuteCommand('selection.ungroup', { groupIds: [data.group.id] }),
              onSelectGroup: () => {
                const memberNotes = (projection.activeView?.notes ?? [])
                  .filter((n) => n.attachedElementIds?.some((id) => data.group.elementIds.includes(id)))
                  .map((n) => n.id);
                if (memberNotes.length > 0) {
                  onRequestSelection?.({
                    kind: 'mixed',
                    elementIds: data.group.elementIds,
                    noteIds: memberNotes,
                  });
                } else {
                  onRequestSelection?.({
                    kind: 'element',
                    ids: data.group.elementIds,
                  });
                }
              },
            },
          };
        }
        if (data.kind === 'boundary') {
          const viewId = projection.activeView?.id;
          if (!viewId) return n;
          const payload = { viewId, target: { kind: 'placement', id: data.placement.id } } as const;
          const selected = Boolean(selectedElementIds?.has(data.element.id));
          return {
            ...n,
            selected,
            data: {
              ...data,
              onToggleCollapsed: () => void onExecuteCommand('canvas.collapse', payload),
            },
          };
        }
        if (data.kind === 'note') {
          const selected = Boolean(selectedNoteIds?.has(data.note.id));
          const viewId = projection.activeView?.id;
          if (!viewId) return { ...n, selected };
          return {
            ...n,
            selected,
            data: {
              ...data,
              onUpdateText: (newText: string) => {
                if (!document) return;
                const plan = planUpdateNote(document, viewId, data.note.id, { text: newText });
                if (plan.ok) {
                  void onApplyChanges(plan.changes, plan.label);
                }
              },
              onUpdateTone: (tone: NoteTone) => {
                if (!document) return;
                const plan = planUpdateNote(document, viewId, data.note.id, { tone });
                if (plan.ok) {
                  void onApplyChanges(plan.changes, plan.label);
                }
              },
              onDelete: () => {
                if (!document) return;
                const plan = planDeleteNote(document, viewId, data.note.id);
                if (plan.ok) {
                  void onApplyChanges(plan.changes, plan.label);
                }
              },
              onAttach: (elementId: string | null) => {
                if (!document) return;
                const plan = planUpdateNote(document, viewId, data.note.id, {
                  attachedElementIds: elementId ? [elementId as Id] : [],
                });
                if (plan.ok) {
                  void onApplyChanges(plan.changes, plan.label);
                }
              },
            },
          };
        }
        if (data.kind !== 'element') return n;
        const selected = Boolean(selectedElementIds?.has(data.element.id));
        const connectable = dragMode !== 'pan';
        const trafficEntry = Boolean(trafficEntryElementIds?.has(data.element.id));
        const viewId = projection.activeView?.id;
        const togglePayload = viewId ? ({ viewId, target: { kind: 'placement', id: data.placement.id } } as const) : null;
        const linkedId = data.element.linkedProjectId;
        const linkedDetails = linkedId ? linkedProjects?.get(linkedId) : undefined;
        return {
          ...n,
          selected,
          data: {
            ...data,
            connectable,
            trafficEntry,
            ...(linkedId
              ? {
                  linked: linkedDetails
                    ? { state: 'available' as const, ...linkedDetails }
                    : linkedProjects
                      ? { state: 'unavailable' as const }
                      : { state: 'loading' as const },
                  onOpenLinked: linkedDetails && onOpenLinkedProject ? () => onOpenLinkedProject(linkedId) : undefined,
                }
              : {}),
            onToggleExpanded: togglePayload
              ? () => void onExecuteCommand(data.placement.expanded ? 'canvas.collapse' : 'canvas.expand', togglePayload)
              : undefined,
          },
        };
      }),
    [nodes, selectedElementIds, selectedNoteIds, dragMode, projection.activeView, onExecuteCommand, trafficEntryElementIds, linkedProjects, onOpenLinkedProject, document, onApplyChanges, onRequestSelection],
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
      if (data.kind === 'group') {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button')) return;
        const memberNotes = (projection.activeView?.notes ?? [])
          .filter((n) => n.attachedElementIds?.some((id) => data.group.elementIds.includes(id)))
          .map((n) => n.id);
        onRequestSelection?.({
          kind: 'mixed',
          elementIds: data.group.elementIds,
          noteIds: memberNotes,
          additive: event.shiftKey,
        });
        return;
      }
      if (data.kind === 'note') {
        const target = event.target as HTMLElement | null;
        if (target?.closest('button') || target?.closest('textarea') || target?.closest('input')) return;
        onRequestSelection?.({ kind: 'note', id: data.note.id, additive: event.shiftKey });
        return;
      }
      if (data.kind !== 'element' && data.kind !== 'boundary') return;
      onRequestSelection?.({ kind: 'element', id: data.element.id, additive: event.shiftKey });
    },
    [onRequestSelection, projection.activeView?.notes],
  );

  const handleEdgeClick: EdgeMouseHandler = React.useCallback(
    (event, edge) => {
      const data = edge.data as { connection?: { id: string } } | undefined;
      if (!data?.connection?.id) return;
      // A rerouted edge is a visual stand-in for hidden members' connections.
      if ((edge.data as { rerouted?: boolean }).rerouted) return;
      onRequestSelection?.({ kind: 'connection', id: data.connection.id, additive: event.shiftKey });
    },
    [onRequestSelection],
  );

  const handlePaneClick = React.useCallback(() => {
    onRequestClearSelection?.();
    window.dispatchEvent(new CustomEvent('studio:dismiss-transients'));
  }, [onRequestClearSelection]);

  const handleSelectionStart = React.useCallback(() => {
    isBoxSelectingRef.current = true;
    boxSelectedIdsRef.current.clear();
  }, []);

  const handleSelectionEnd = React.useCallback(() => {
    isBoxSelectingRef.current = false;
    const selectedPlacementIds = Array.from(boxSelectedIdsRef.current);
    boxSelectedIdsRef.current.clear();
    if (selectedPlacementIds.length === 0) return;

    // Map placement IDs to element IDs and note IDs
    const elementIds: Id[] = [];
    const noteIds: Id[] = [];
    for (const plId of selectedPlacementIds) {
      const node = nodes.find((n) => n.id === plId);
      if (node) {
        if (node.data.kind === 'element' || node.data.kind === 'boundary') {
          elementIds.push(node.data.element.id);
        } else if (node.data.kind === 'note') {
          noteIds.push(node.data.note.id);
        }
      }
    }
    if (elementIds.length > 0 || noteIds.length > 0) {
      onRequestSelection?.({
        kind: 'mixed',
        elementIds,
        noteIds,
      });
    }
  }, [nodes, onRequestSelection]);

  // Node drag end handler:
  // Identify nodes by node.type (not string prefixes on IDs)
  const dragStartPositionsRef = React.useRef<Map<string, { x: number; y: number }>>(new Map());

  const handleNodeDragStart: OnNodeDrag<Node<ProjectedNodeData>> = React.useCallback(
    () => {
      const map = new Map<string, { x: number; y: number }>();
      for (const n of nodes) {
        map.set(n.id, { x: n.position.x, y: n.position.y });
      }
      dragStartPositionsRef.current = map;
    },
    [nodes],
  );

  const handleNodeDrag: OnNodeDrag<Node<ProjectedNodeData>> = React.useCallback(
    (_event, node, draggedNodes) => {
      const startPositions = dragStartPositionsRef.current;
      if (startPositions.size === 0) return;

      const nodesToProcess = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];
      const updates = new Map<string, { x: number; y: number }>();

      for (const n of nodesToProcess) {
        const startPos = startPositions.get(n.id);
        if (!startPos) continue;
        const dx = n.position.x - startPos.x;
        const dy = n.position.y - startPos.y;
        if (dx === 0 && dy === 0) continue;

        // 1. If element node dragged, move its attached notes in real time
        if (n.type === 'elementNode' && n.data.kind === 'element') {
          const elementId = n.data.element.id;
          for (const candidate of nodes) {
            if (candidate.type === 'noteNode' && candidate.data.kind === 'note') {
              if (nodesToProcess.some((p) => p.id === candidate.id)) continue;
              if (candidate.data.note.attachedElementIds?.includes(elementId)) {
                const noteStart = startPositions.get(candidate.id);
                if (noteStart) {
                  updates.set(candidate.id, { x: noteStart.x + dx, y: noteStart.y + dy });
                }
              }
            }
          }
        }

        // 2. If group node dragged, move its member elements AND their attached notes in real time
        if (n.type === 'groupNode' && n.data.kind === 'group') {
          const groupElementIds = n.data.group.elementIds;
          for (const candidate of nodes) {
            if (candidate.type === 'elementNode' && candidate.data.kind === 'element') {
              if (groupElementIds.includes(candidate.data.element.id)) {
                const memberStart = startPositions.get(candidate.id);
                if (memberStart) {
                  updates.set(candidate.id, { x: memberStart.x + dx, y: memberStart.y + dy });
                }
              }
            } else if (candidate.type === 'noteNode' && candidate.data.kind === 'note') {
              if (candidate.data.note.attachedElementIds?.some((id) => groupElementIds.includes(id))) {
                const noteStart = startPositions.get(candidate.id);
                if (noteStart) {
                  updates.set(candidate.id, { x: noteStart.x + dx, y: noteStart.y + dy });
                }
              }
            }
          }
        }
      }

      if (updates.size > 0) {
        setNodes((prevNodes) =>
          prevNodes.map((item) => {
            const updatedPos = updates.get(item.id);
            return updatedPos ? { ...item, position: updatedPos } : item;
          }),
        );
      }
    },
    [nodes, setNodes],
  );

  // Moved list built by placement.id (ReactFlow node id) and note.id
  const handleNodeDragStop: OnNodeDrag<Node<ProjectedNodeData>> = React.useCallback(
    async (_event, node, draggedNodes) => {
      if (!projection.activeView || isSaving) return;

      const nodesToProcess =
        draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];

      // Filter element and note nodes
      const elementNodes = nodesToProcess.filter(
        (n) => n.type === 'elementNode',
      );
      const noteNodes = nodesToProcess.filter(
        (n) => n.type === 'noteNode',
      );

      const movedList: Array<{ id: string; position: { x: number; y: number } }> = [
        ...elementNodes.map((n) => ({
          id: n.id, // placement.id
          position: { x: n.position.x, y: n.position.y },
        })),
        ...noteNodes.map((n) => ({
          id: n.id, // note.id
          position: { x: n.position.x, y: n.position.y },
        })),
      ];

      // Sticky notes move with their parent element
      for (const n of elementNodes) {
        const origin = dragStartPositionsRef.current.get(n.id) ?? projection.nodes.find((p) => p.id === n.id)?.position;
        if (!origin) continue;
        const dx = n.position.x - origin.x;
        const dy = n.position.y - origin.y;
        if (dx === 0 && dy === 0) continue;
        const nodeData = n.data as ProjectedNodeData;
        const elementId = nodeData.kind === 'element' ? nodeData.element.id : null;
        if (!elementId) continue;
        for (const note of projection.activeView.notes ?? []) {
          if (noteNodes.some((nn) => nn.id === note.id)) continue;
          if (note.attachedElementIds?.includes(elementId)) {
            if (movedList.some((m) => m.id === note.id)) continue;
            movedList.push({ id: note.id, position: { x: note.x + dx, y: note.y + dy } });
          }
        }
      }

      // A dragged group (collapsed or expanded) moves every member and attached sticky note
      // by the same delta, in the same single move batch (one undo entry).
      for (const n of nodesToProcess) {
        if (n.type !== 'groupNode' || n.data.kind !== 'group') continue;
        const origin = dragStartPositionsRef.current.get(n.id) ?? projection.nodes.find((p) => p.id === n.id)?.position;
        if (!origin) continue;
        const dx = n.position.x - origin.x;
        const dy = n.position.y - origin.y;
        if (dx === 0 && dy === 0) continue;
        const group = n.data.group;
        for (const placement of projection.activeView.placements) {
          if (!group.elementIds.includes(placement.elementId)) continue;
          if (movedList.some((m) => m.id === placement.id)) continue;
          movedList.push({ id: placement.id, position: { x: placement.x + dx, y: placement.y + dy } });
        }
        for (const note of projection.activeView.notes ?? []) {
          if (note.attachedElementIds?.some((id) => group.elementIds.includes(id))) {
            if (movedList.some((m) => m.id === note.id)) continue;
            movedList.push({ id: note.id, position: { x: note.x + dx, y: note.y + dy } });
          }
        }
      }
      // Moving an expanded refinement frame moves its owner placement and every
      // descendant member placement by the same delta, as one undoable change.
      for (const n of nodesToProcess) {
        if (n.type !== 'boundaryFrameNode' || n.data.kind !== 'boundary') continue;
        const origin = projection.nodes.find((projected) => projected.id === n.id)?.position;
        if (!origin) continue;
        const dx = n.position.x - origin.x;
        const dy = n.position.y - origin.y;
        const movedElementIds = new Set([n.data.element.id, ...n.data.memberElementIds]);
        for (const placement of projection.activeView.placements) {
          if (!movedElementIds.has(placement.elementId)) continue;
          const current = movedList.find((moved) => moved.id === placement.id);
          if (current) {
            current.position = { x: placement.x + dx, y: placement.y + dy };
          } else {
            movedList.push({ id: placement.id, position: { x: placement.x + dx, y: placement.y + dy } });
          }
        }
      }
      // If a single unattached note is dragged near an element, auto-link it
      if (noteNodes.length === 1 && elementNodes.length === 0 && projection.activeView && document) {
        const draggedNote = noteNodes[0];
        const existingNote = projection.activeView.notes?.find((n) => n.id === draggedNote.id);
        const isCurrentlyUnattached = Boolean(existingNote && (!existingNote.attachedElementIds || existingNote.attachedElementIds.length === 0));
        if (isCurrentlyUnattached && existingNote) {
          for (const placement of projection.activeView.placements) {
            const width = placement.width ?? 240;
            const height = measuredHeights.get(placement.id) ?? 140;
            if (
              draggedNote.position.x >= placement.x - 40 &&
              draggedNote.position.x <= placement.x + width + 40 &&
              draggedNote.position.y >= placement.y - 40 &&
              draggedNote.position.y <= placement.y + height + 60
            ) {
              const attachPlan = planUpdateNote(document, projection.activeView.id, existingNote.id, {
                position: { x: Math.round(draggedNote.position.x), y: Math.round(draggedNote.position.y) },
                attachedElementIds: [placement.elementId],
              });
              if (attachPlan.ok) {
                await onApplyChanges(attachPlan.changes, 'Link sticky note');
                return;
              }
            }
          }
        }
      }

      if (movedList.length === 0) return;

      const success = await onMoveNodes(movedList);
      if (!success) {
        // Snap back to document positions on failure
        setNodes((previous) => keepMeasurements(previous, projection.nodes));
      }
    },
    [projection, isSaving, onMoveNodes, setNodes, document, measuredHeights, onApplyChanges],
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

  // RV-13a: the fit must wait until the view's nodes are measured. A fixed 50 ms
  // timer could fire before ReactFlow had the nodes (after a reload), leaving the
  // default viewport so content -- notably a group header above its members --
  // sat outside the canvas.
  React.useEffect(() => {
    const docId = document?.id;
    const viewId = projection.activeView?.id;
    if (!docId || !viewId) return;

    const key = `${docId}:${viewId}`;
    if (lastFittedKeyRef.current === key) return;
    if (projection.nodes.length === 0) {
      // Empty view: nothing to fit, and the first placement must not move the camera.
      lastFittedKeyRef.current = key;
      return;
    }
    if (!nodesInitialized || nodes.length === 0) return;
    lastFittedKeyRef.current = key;
    void reactFlow.fitView({
      padding: '32px',
      minZoom: 0.1,
      maxZoom: 1,
      duration: 0,
    });
  }, [document?.id, projection.activeView?.id, projection.nodes.length, nodesInitialized, nodes.length, reactFlow]);

  // RV-13a: creating a group draws its boundary GROUP_PADDING_Y_TOP above the
  // members, which can leave the header (and its collapse chevron) outside the
  // visible canvas -- under the top bar -- because the open-time fit only knew
  // about the members. When a group appears in the active view, pan (never
  // zoom) just enough to bring its box inside the canvas with a 32 px margin.
  const seenGroupsRef = React.useRef<{ key: string; ids: ReadonlySet<string> } | null>(null);
  React.useEffect(() => {
    const docId = document?.id;
    const viewId = projection.activeView?.id;
    if (!docId || !viewId) return;
    const key = `${docId}:${viewId}`;
    const groupNodes = projection.nodes.filter((n) => n.type === 'groupNode');
    const ids = new Set(groupNodes.map((n) => n.id));
    const previous = seenGroupsRef.current;
    seenGroupsRef.current = { key, ids };
    if (!previous || previous.key !== key) return;
    const created = groupNodes.filter((n) => !previous.ids.has(n.id));
    if (created.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = reactFlow.getViewport();
      const margin = 32;
      let dx = 0;
      let dy = 0;
      for (const node of created) {
        const data = node.data as { width: number; height: number };
        const left = node.position.x * viewport.zoom + viewport.x;
        const top = node.position.y * viewport.zoom + viewport.y;
        const right = left + data.width * viewport.zoom;
        const bottom = top + data.height * viewport.zoom;
        if (top + dy < margin) dy = margin - top;
        else if (bottom + dy > rect.height - margin) dy = Math.min(dy, rect.height - margin - bottom);
        if (left + dx < margin) dx = margin - left;
        else if (right + dx > rect.width - margin) dx = Math.min(dx, rect.width - margin - right);
      }
      if (dx === 0 && dy === 0) return;
      void reactFlow.setViewport(
        { x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom },
        { duration: 150 },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [document?.id, projection, reactFlow]);

  const applyPlacement = React.useCallback(
    async (entryId: string, anchor: { x: number; y: number }, link?: { projectId: string; title: string }) => {
      if (!document || !projection.activeView || isSaving) return;
      // D53: a linked node gets its ports from what the project exposes right now.
      const exposures = link ? ((await loadLinkedExposures?.(link.projectId)) ?? []) : [];
      const result = placeEntry({
        document,
        viewId: projection.activeView.id,
        entryId,
        anchor,
        mintId,
        link: link ? { ...link, exposures } : undefined,
      });
      if (!result.ok) {
        if (link) {
          const rect = containerRef.current?.getBoundingClientRect();
          setRejectMessage({
            text: result.issues[0]?.message ?? 'Could not link that project.',
            x: (rect?.left ?? 0) + (rect?.width ?? 400) / 2,
            y: (rect?.top ?? 0) + 80,
          });
        }
        return;
      }
      const applied = await onApplyChanges(result.changes, link ? 'Link project' : 'Add component');
      if (!applied) return;
      onRequestSelection?.({ kind: 'element', id: result.elementId, additive: false });
    },
    [document, projection.activeView, isSaving, mintId, onApplyChanges, onRequestSelection, loadLinkedExposures],
  );

  const getVisibleCentre = React.useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const centreScreen = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return reactFlow.screenToFlowPosition(centreScreen);
  }, [reactFlow]);

  // The docked Library panel places at the viewport centre via this handle.
  // Dragging a picker card or a note onto the canvas places it at the drop point.
  const handleCanvasDragOver = React.useCallback((e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(CATALOG_ENTRY_MIME_TYPE) || types.includes(LINKED_PROJECT_MIME_TYPE) || types.includes(NOTE_MIME_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleCanvasDrop = React.useCallback(
    async (e: React.DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      if (types.includes(CATALOG_ENTRY_MIME_TYPE)) {
        const entryId = e.dataTransfer.getData(CATALOG_ENTRY_MIME_TYPE);
        if (!entryId || !getEntry(entryId)) return;
        e.preventDefault();
        const flowPoint = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        await applyPlacement(entryId, flowPoint);
        return;
      }

      if (types.includes(LINKED_PROJECT_MIME_TYPE)) {
        e.preventDefault();
        let link: { projectId: string; title: string } | null = null;
        try {
          const parsed = JSON.parse(e.dataTransfer.getData(LINKED_PROJECT_MIME_TYPE)) as { projectId?: unknown; title?: unknown };
          if (typeof parsed.projectId === 'string' && typeof parsed.title === 'string') {
            link = { projectId: parsed.projectId, title: parsed.title };
          }
        } catch {
          link = null;
        }
        if (!link) return;
        const flowPoint = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        await applyPlacement('linked-project', flowPoint, link);
        return;
      }

      if (types.includes(NOTE_MIME_TYPE)) {
        e.preventDefault();
        if (!document || !projection.activeView || isSaving) return;
        const flowPoint = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY });

        // Auto-attach as sticky note if dropped onto/near an existing component placement
        let attachedElementIds: readonly Id[] = [];
        for (const placement of projection.activeView.placements) {
          const width = placement.width ?? 240;
          const height = measuredHeights.get(placement.id) ?? 140;
          if (
            flowPoint.x >= placement.x - 40 &&
            flowPoint.x <= placement.x + width + 40 &&
            flowPoint.y >= placement.y - 40 &&
            flowPoint.y <= placement.y + height + 60
          ) {
            attachedElementIds = [placement.elementId];
            break;
          }
        }

        const plan = planAddNote(
          document,
          projection.activeView.id,
          mintId(),
          'New note',
          flowPoint,
          attachedElementIds,
        );
        if (plan.ok) {
          await onApplyChanges(plan.changes, plan.label);
        }
      }
    },
    [reactFlow, applyPlacement, document, projection.activeView, isSaving, measuredHeights, mintId, onApplyChanges],
  );

  // ==========================================================================
  // Handle-to-handle connection -- planConnection / completeConnection
  // ==========================================================================

  const [rejectMessage, setRejectMessage] = React.useState<RejectMessage | null>(null);
  const [resourceForm, setResourceForm] = React.useState<ResourceFormState | null>(null);
  const [snapToGrid, setSnapToGrid] = React.useState(true);
  const [showMinimap, setShowMinimap] = React.useState(false);

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

      // D53: a linked project is connected with the types it exposes right now.
      const linkedExposures = targetElement.linkedProjectId
        ? await loadLinkedExposures?.(targetElement.linkedProjectId)
        : undefined;
      const result = planConnection({
        document,
        viewId: projection.activeView.id,
        source: { elementId: sourceElement.id, portId: sourcePort.id },
        target: { elementId: targetElement.id },
        mintId,
        linkedExposures,
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
          error: null,
          path: result.draft.path,
          plan: { sourceElementId: sourceElement.id, sourcePortId: sourcePort.id, targetElementId: targetElement.id, linkedExposures },
        });
        return;
      }
      await onApplyChanges(result.changes, 'Connect');
    },
    [document, projection.activeView, isSaving, nodes, mintId, onApplyChanges, loadLinkedExposures],
  );

  // D53: changing the connection type re-plans, because it decides which ports the connection uses.
  const changeConnectionType = React.useCallback(
    (protocol: Protocol) => {
      if (!resourceForm || !document || !projection.activeView) return;
      const { plan } = resourceForm;
      const result = planConnection({
        document,
        viewId: projection.activeView.id,
        source: { elementId: plan.sourceElementId, portId: plan.sourcePortId },
        target: { elementId: plan.targetElementId },
        mintId,
        protocol,
        linkedExposures: plan.linkedExposures,
      });
      if (result.kind === 'needs-resource-metadata') {
        setResourceForm({ ...resourceForm, draft: result.draft, path: result.draft.path, error: null });
      } else if (result.kind === 'rejected') {
        setResourceForm({ ...resourceForm, error: result.issues[0]?.message ?? 'That connection type is not available.' });
      }
    },
    [resourceForm, document, projection.activeView, mintId],
  );

  const cancelResourceForm = React.useCallback(() => setResourceForm(null), []);

  const endpointPathListId = React.useId();

  const confirmResourceForm = React.useCallback(async () => {
    if (!resourceForm) return;
    // D53: the path decides which ports the connection uses, so plan again with it before completing.
    let draft = resourceForm.draft;
    if (document && projection.activeView && draft.protocol) {
      const { plan } = resourceForm;
      const replanned = planConnection({
        document,
        viewId: projection.activeView.id,
        source: { elementId: plan.sourceElementId, portId: plan.sourcePortId },
        target: { elementId: plan.targetElementId },
        mintId,
        protocol: draft.protocol,
        path: resourceForm.path,
        linkedExposures: plan.linkedExposures,
      });
      if (replanned.kind === 'rejected') {
        setResourceForm({ ...resourceForm, error: replanned.issues[0]?.message ?? 'That endpoint is not available.' });
        return;
      }
      if (replanned.kind === 'needs-resource-metadata') draft = replanned.draft;
    }
    const result = completeConnection(draft);
    if (!result.ok) {
      if (result.issues.length === 0) {
        throw new Error('completeConnection: rejected result with no issues (contract violation)');
      }
      setResourceForm({ ...resourceForm, error: result.issues[0].message });
      return;
    }
    setResourceForm(null);
    await onApplyChanges(result.changes, 'Connect');
  }, [resourceForm, onApplyChanges, mintId, document, projection.activeView]);

  // ==========================================================================
  // RV-12e: Delete -- Delete/Backspace on canvas focus, or the 16D toolbar
  // ==========================================================================

  const [deleteConfirm, setDeleteConfirm] = React.useState<DeletePlan | null>(null);
  // Failures must never be silent: a rejected delete keeps the dialog open with the reason.
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const DELETE_FAILED_MESSAGE = 'Could not delete the selection. Nothing was changed.';

  const currentSelection = React.useMemo(
    () => ({
      elementIds: Array.from(selectedElementIds ?? []),
      connectionIds: Array.from(selectedConnectionIds ?? []),
      noteIds: Array.from(selectedNoteIds ?? []),
    }),
    [selectedElementIds, selectedConnectionIds, selectedNoteIds],
  );
  const hasSelection =
    currentSelection.elementIds.length > 0 ||
    currentSelection.connectionIds.length > 0 ||
    currentSelection.noteIds.length > 0;

  // The parts toolbar is for nodes and notes; a selected connection has no parts to act on.
  const hasPartSelection = currentSelection.elementIds.length > 0 || currentSelection.noteIds.length > 0;

  const runDeletePlan = React.useCallback(
    (plan: DeletePlan) => {
      if (plan.changes.length === 0) return;
      if (plan.requiresConfirmation) {
        setDeleteError(null);
        setDeleteConfirm(plan);
        return;
      }
      void onApplyChanges(plan.changes, 'Delete').then((applied) => {
        if (applied) {
          onRequestClearSelection?.();
          return;
        }
        setDeleteError(DELETE_FAILED_MESSAGE);
        setDeleteConfirm(plan);
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
    if (!deleteConfirm || deleteConfirm.blockedReason) return;
    const applied = await onApplyChanges(deleteConfirm.changes, 'Delete');
    if (applied) {
      setDeleteConfirm(null);
      setDeleteError(null);
      onRequestClearSelection?.();
    } else {
      setDeleteError(DELETE_FAILED_MESSAGE);
    }
  }, [deleteConfirm, onApplyChanges, onRequestClearSelection]);

  const handleCanvasKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const matched = onCanvasShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        isComposing: e.nativeEvent.isComposing,
        inEditableField: Boolean(
          target &&
            (target.tagName === 'INPUT' ||
              target.tagName === 'TEXTAREA' ||
              target.tagName === 'SELECT' ||
              target.isContentEditable),
        ),
        inDialog: Boolean(target?.closest('[role="dialog"], [role="alertdialog"]')),
      });
      if (matched) e.preventDefault();
    },
    [onCanvasShortcut],
  );

  React.useImperativeHandle(
    ref,
    () => ({
      placeAtCentre: async (entryId: string, link?: { projectId: string; title: string }) => {
        await applyPlacement(entryId, getVisibleCentre(), link);
      },
      getVisibleCentre,
      getMeasuredHeights: () => measuredHeights,
      deleteSelection: handleDeleteSelection,
      setToolMode: setDragMode,
      zoomIn: handleZoomIn,
      zoomOut: handleZoomOut,
      fitView: handleFitView,
    }),
    [getVisibleCentre, applyPlacement, handleZoomIn, handleZoomOut, handleFitView, handleDeleteSelection, measuredHeights],
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
      {runWaitsForScenarioDraft ? (
        <div
          data-testid="canvas-run-waits-notice"
          role="status"
          className="absolute top-3 right-3 z-10 max-w-[280px] rounded-control border border-warning-edge bg-warning-tint px-3 py-2 text-xs text-warning-text"
        >
          Run waits until you Apply or Cancel the scenario changes.
        </div>
      ) : null}
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
            className="h-6 text-xs px-2 rounded-tag"
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
          className="absolute bottom-3 left-3 z-10 max-w-sm pointer-events-auto p-2.5 rounded-card border border-risk-edge bg-risk-tint text-destructive text-xs shadow-raised"
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

      {/* 16D selection-scoped actions. */}
      {hasPartSelection && (
        <SelectionToolbar
          context={commandContext}
          executeCommand={onExecuteCommand}
          mintId={mintId}
        />
      )}

      {/* Selected node IDs for the unified selection box */}
      {(() => null)()}

      <TrafficPulseContext.Provider value={trafficPulses}>
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onSelectionStart={handleSelectionStart}
        onSelectionEnd={handleSelectionEnd}
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
        snapToGrid={snapToGrid}
        snapGrid={[26, 26]}
        // No `fitView` prop: it also fires when an empty view gets its first
        // node, moving the camera after a placement. The open/view-switch
        // effect above is the only automatic fit.
        proOptions={{ hideAttribution: true }}
        className="system-canvas bg-canvas"
      >
        <ViewportPortal>
          <SelectionBox
            selectedIds={[
              ...(commandContext.selectedPlacementIds ?? []),
              ...commandContext.selectedGroupIds,
              ...(commandContext.selectedNoteIds ?? []),
            ]}
          />
        </ViewportPortal>
        {/* Dotted grid on the same 26px pitch as snap-to-grid; dots use the control border tone so they read on the white canvas. */}
        <Background variant={BackgroundVariant.Dots} color="var(--control-border)" gap={gridGap} size={GRID_DOT_PX / zoom} />
        {showMinimap && (
          <MiniMap
            nodeColor="#0B5C54"
            maskColor="rgba(247, 245, 241, 0.7)"
            className="!bottom-20 !right-4 rounded-lg border border-border bg-background shadow-floating"
          />
        )}
      </ReactFlow>
      </TrafficPulseContext.Provider>

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

          {resourceForm.draft.protocol ? (
            <label className="block mb-2">
              <span className="block text-secondary-text mb-0.5">Connection type</span>
              <NativeSelect
                data-testid="connect-form-protocol"
                value={resourceForm.draft.protocol}
                onChange={(e) => changeConnectionType(e.target.value as Protocol)}
                className="h-8 text-xs"
              >
                {resourceForm.draft.protocolOptions.map((protocol) => (
                  <option key={protocol} value={protocol}>
                    {PROTOCOL_LABELS[protocol]}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ) : null}

          {resourceForm.draft.protocol ? (
            <label className="block mb-2">
              <span className="block text-secondary-text mb-0.5">Path / name</span>
              <Input
                data-testid="connect-form-path"
                autoFocus
                list={endpointPathListId}
                placeholder="/orders, a topic, a procedure"
                type="text"
                maxLength={PORT_PATH_MAX_LENGTH}
                value={resourceForm.path}
                onChange={(e) => setResourceForm({ ...resourceForm, path: e.target.value, error: null })}
                className="h-8 text-xs"
              />
              <datalist id={endpointPathListId}>
                {resourceForm.draft.pathOptions.filter((p) => p !== '').map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
          ) : null}

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
              autoFocus={!resourceForm.draft.protocol}
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
        zoom={zoom}
        context={commandContext}
        config={dockConfig}
        preferenceState={dockPreferenceState}
        onConfigure={onConfigureDock}
        onRestoreDefaults={onRestoreDockDefaults}
        onPlaceEntry={(entryId) => void applyPlacement(entryId, getVisibleCentre())}
        onInvoke={(id: DockCommandId) => {
          if (id === 'run.start') {
            if (commandContext.selectedScenario) void onExecuteCommand(id, { scenarioId: commandContext.selectedScenario.id });
          } else if (id !== 'canvas.add-note' && id !== 'selection.group') {
            void onExecuteCommand(id, {} as never);
          }
        }}
        onAddNote={async (text) => {
          const result = await onExecuteCommand('canvas.add-note', { text });
          if (result.status === 'disabled') return { ok: false, message: result.reason };
          if (result.value && typeof result.value === 'object' && 'ok' in result.value) {
            return result.value as { readonly ok: true } | { readonly ok: false; readonly message: string };
          }
          return { ok: true };
        }}
        onGroup={async (label) => {
          const result = await onExecuteCommand('selection.group', { label });
          if (result.status === 'disabled') return { ok: false, message: result.reason };
          if (result.value && typeof result.value === 'object' && 'ok' in result.value) {
            return result.value as { readonly ok: true } | { readonly ok: false; readonly message: string };
          }
          return { ok: true };
        }}
        snapToGrid={snapToGrid}
        onToggleSnapToGrid={setSnapToGrid}
        showMinimap={showMinimap}
        onToggleMinimap={setShowMinimap}
      />

      {/* Delete dependency preview: removals, scenario repairs, or why it cannot be applied */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(next) => { if (!next) { setDeleteConfirm(null); setDeleteError(null); } }}>
        <DialogContent data-testid="delete-confirm-dialog" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deleteConfirm?.blockedReason || (deleteError && deleteConfirm?.affectedScenarioLabels.length === 0)
                ? "Can't delete this selection"
                : 'Delete will affect scenarios'}
            </DialogTitle>
            <DialogDescription>
              {deleteConfirm && !deleteConfirm.blockedReason && deleteConfirm.affectedScenarioLabels.length > 0 && (
                <>
                  Deleting removes {deleteConfirm.removedElementIds.length} element
                  {deleteConfirm.removedElementIds.length === 1 ? '' : 's'} and{' '}
                  {deleteConfirm.removedConnectionIds.length} connection
                  {deleteConfirm.removedConnectionIds.length === 1 ? '' : 's'}. These scenarios reference
                  them and will be repaired:
                </>
              )}
              {deleteConfirm?.blockedReason && <>The project would be invalid afterwards: {deleteConfirm.blockedReason}</>}
            </DialogDescription>
          </DialogHeader>
          {deleteConfirm && !deleteConfirm.blockedReason && deleteConfirm.scenarioRepairSummaries.length > 0 && (
            <ul data-testid="delete-confirm-repairs" className="list-disc space-y-1 pl-5 text-sm text-secondary-text">
              {deleteConfirm.scenarioRepairSummaries.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {deleteError && (
            <p role="alert" data-testid="delete-error" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <DialogFooter className="flex-row justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setDeleteConfirm(null); setDeleteError(null); }}>
              {deleteConfirm?.blockedReason ? 'Close' : 'Cancel'}
            </Button>
            {deleteConfirm && !deleteConfirm.blockedReason && deleteConfirm.affectedScenarioLabels.length > 0 && (
              <Button
                data-testid="delete-confirm-btn"
                type="button"
                variant="destructive"
                onClick={() => void confirmDelete()}
              >
                Delete
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

export const CanvasView = React.forwardRef<CanvasViewHandle, CanvasViewProps>(function CanvasView(props, ref) {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});

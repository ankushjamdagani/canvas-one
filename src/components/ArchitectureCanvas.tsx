import { RoutingPanel } from "./RoutingPanel";
import { hasBalancer, serviceInstances } from "../domain/routing";
import { visibleSubsystems } from "../domain/subsystems";
import { SubsystemNode } from "./SubsystemNode";
import { projectSubsystems } from "./subsystemProjection";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  MarkerType,
  SelectionMode,
  type NodeProps,
  type Node,
  type OnNodesChange,
  applyNodeChanges,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
} from "@xyflow/react";
import {
  Network,
  ArrowRight,
  Database,
  Hexagon,
  Layers,
  AlertTriangle,
  Trash2,
  ChevronDown,
  ListOrdered,
  Cpu,
  ChevronRight,
  MonitorSmartphone, Smartphone, RadioTower, Globe2, ShieldCheck, Waypoints, Braces,
  Boxes, CalendarClock, FileStack, Search, Warehouse, Radio, BellRing, Activity,
  ChartNoAxesCombined, KeyRound, PlugZap, MousePointer, Hand,
  StickyNote, Plus, Minus, Maximize2, CheckSquare2, Undo2, Redo2,
} from "lucide-react";
import { useEditor } from "../state/editor";
import { isDiagramGraph, isOpenGraph, supportsFreeCanvas, totalCapacity, type ComponentKind, type ModelNode, type Settings } from "../domain/model";
import { rateAt } from "../domain/workload";
import { ComponentInternals } from "./ComponentInternals";
import type { Metrics } from "../simulation/engine";
import { TrafficEdge, type TrafficConnection } from "./TrafficEdge";
import { DiagramOrganization } from "./DiagramOrganization";
import { CanvasNoteNode, noteAttachmentLabel, type NoteFlowNode } from "./CanvasNotes";
import { CanvasContextMenu, type ContextMenuTarget } from "./CanvasContextMenu";
import { defaultExecutionEdge } from "../domain/behaviorDefaults";
import { OpenConnectionEditor } from "./OpenConnectionEditor";
import { componentDefinition } from "../domain/componentCatalog";
export const icons = {
  balancer: Network,
  traffic: ArrowRight,
  service: Hexagon,
  database: Database,
  cache: Layers,
  queue: ListOrdered,
  worker: Cpu,
  client: MonitorSmartphone, mobile: Smartphone, device: RadioTower, dns: Globe2,
  cdn: Globe2, firewall: ShieldCheck, gateway: Waypoints, function: Braces,
  container: Boxes, scheduler: CalendarClock, nosql: FileStack, objectstore: FileStack,
  search: Search, warehouse: Warehouse, stream: Radio, pubsub: Radio,
  email: BellRing, monitoring: Activity, analytics: ChartNoAxesCombined,
  secrets: KeyRound, thirdparty: PlugZap,
  custom: Boxes,
};
type ArchitectureNode = Node<
  {
    fullMetrics: Metrics | null;
    model: ModelNode;
    rate: number;
    metrics?: Metrics["nodes"][string];
    hasRun: boolean;
    expanded: boolean;
    settings: Settings;
      totals: Pick<
      Metrics,
      "generated" | "cacheHits" | "cacheMisses" | "arrivalRate" | "jobs"
      > | null;
      diagram: boolean;
  },
  "component"
>;
function ComponentNode({ data, selected }: NodeProps<ArchitectureNode>) {
  const { model: n, rate, metrics: m, hasRun, expanded, diagram } = data,
    Icon = icons[n.kind];
  const toggleExpanded = useEditor((s) => s.toggleExpanded);
  const overloaded = hasRun && (m?.utilization ?? 0) > 0.95;
  const isOpen = n.behavior !== undefined;
  const execMetrics = data.fullMetrics?.execution;
  const nodeCounters = execMetrics?.nodes?.[n.id];
  const category = componentDefinition(n.kind)?.category ?? "Compute";
  const categorySlug = category.toLowerCase();

  return (
    <div
      className={`component-node category-${categorySlug} ${diagram ? "diagram-node" : ""} ${expanded ? "expanded-node" : ""} ${selected ? "selected" : ""} ${overloaded ? "overloaded" : ""}`}
    >
      <div className={`node-category-strip category-${categorySlug}`} aria-hidden="true" />
      {(diagram || isOpen || n.kind !== "traffic") && (
        <Handle type="target" position={Position.Left} />
      )}
      <div className="node-header">
        <div className={`component-icon ${n.kind}`}>
          <Icon size={22} strokeWidth={1.7} />
        </div>
        <div className="node-copy">
          <strong>{n.name}</strong>
          <span>
            {diagram
              ? (n.kind === "custom" ? n.customType : n.description) || "Architecture component"
              : isOpen
              ? `${n.behavior?.type ?? "processor"}${n.behavior && !["source", "broker"].includes(n.behavior.type) ? ` · ${n.behavior.capacity} /s per slot` : ""}`
              : n.kind === "traffic"
              ? `${rate.toLocaleString()} req/s`
              : n.kind === "balancer" ? "Round-robin routing"
              : n.kind === "cache"
                ? n.cacheMode === "lru" ? `LRU · ${n.cacheEntries ?? 100} entries` : `${n.hitRate}% hit rate`
                : n.kind === "queue"
                  ? `${n.queueLimit.toLocaleString()} waiting slots`
                  : `${totalCapacity(n).toLocaleString()} req/s ${["service", "worker"].includes(n.kind) ? "total" : "capacity"}`}
          </span>
        </div>
        {!diagram && (
          <button
            className="node-expand nodrag nopan"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${n.name}`}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpanded(n.id);
            }}
            title={expanded ? "Hide internals" : "Reveal queue and processing"}
          >
            <ChevronDown size={15} className={`node-expand-chevron ${expanded ? "expanded" : ""}`} />
          </button>
        )}
      </div>
      {expanded && !diagram && (
        isOpen ? (
          <div className="component-internals">
            <div className="component-internals-grid">
              <div><span>Type:</span> <strong>{n.behavior?.type}</strong></div>
              {n.behavior && !["source", "broker"].includes(n.behavior.type) && <>
                <div><span>Capacity per slot:</span> <strong>{n.behavior.capacity} /s</strong></div>
                <div><span>Concurrency:</span> <strong>{n.behavior.concurrency}</strong></div>
              </>}
              {n.behavior?.type !== "source" && <div><span>Queue limit:</span> <strong>{n.behavior?.queueLimit ?? "—"}</strong></div>}
              {nodeCounters && (
                <>
                  <div><span>Processing:</span> <strong>{nodeCounters.processing ?? 0}</strong></div>
                  <div><span>Waiting:</span> <strong>{nodeCounters.waiting ?? 0}</strong></div>
                  <div><span>Retrying:</span> <strong>{nodeCounters.retrying ?? 0}</strong></div>
                  <div><span>Reserved:</span> <strong>{nodeCounters.reserved ?? 0}</strong></div>
                  <div><span>Queue:</span> <strong>{nodeCounters.queued ?? 0}</strong></div>
                </>
              )}
            </div>
          </div>
        ) : n.kind === "balancer" ? (
          <div className="component-internals"><RoutingPanel metrics={data.fullMetrics} /></div>
        ) : (
          <ComponentInternals
            node={n}
            settings={data.settings}
            metrics={m}
            totals={data.totals}
            hasRun={hasRun}
          />
        )
      )}
      {overloaded && (
        <span className="node-alert">
          <AlertTriangle size={13} />
        </span>
      )}
      {(diagram || isOpen || !["database", "worker"].includes(n.kind)) && (
        <Handle type="source" position={Position.Right} />
      )}
      <div className={`node-footnote ${overloaded ? "warning-text" : ""}`}>
        {diagram ? (
          <div className="node-footnote-diagram">
            <span className={`node-cat-pill category-${categorySlug}`}>{category}</span>
            <span className="node-footnote-text">Architecture node</span>
          </div>
        ) : isOpen ? (
          nodeCounters ? (
            <span className="node-counters">
              <strong>{nodeCounters.completed ?? 0}</strong> done · <strong>{nodeCounters.failed ?? 0}</strong> failed
            </span>
          ) : (
            "Configured behavior"
          )
        ) : n.kind === "traffic" ? (
          "Seeded arrival stream"
        ) : n.kind === "balancer" ? (
          hasRun ? `${m?.arrived.toLocaleString() ?? 0} routed · no rerouting` : "Equal turns · independent queues"
        ) : hasRun ? (
          `${m?.queued ?? 0} queued · ${((m?.utilization ?? 0) * 100).toFixed(0)}% busy`
        ) : n.kind === "cache" ? (
          "Hits return · misses continue"
        ) : (
          "FIFO · bounded queue"
        )}
      </div>
    </div>
  );
}
const nodeTypes = { component: ComponentNode, subsystem: SubsystemNode, note: CanvasNoteNode };
const edgeTypes = { traffic: TrafficEdge };
export interface CanvasControlsHandle {
  addAtVisibleCenter: (kind: ComponentKind) => void;
}

export const ArchitectureCanvas = forwardRef<CanvasControlsHandle, {
  metrics: Metrics | null;
  running: boolean;
  selectedEdgeId?: string | null;
  onSelectedEdgeChange?: (id: string | null) => void;
  onCanvasClear?: () => void;
}>(function ArchitectureCanvas({
  metrics,
  running,
  selectedEdgeId,
  onSelectedEdgeChange,
  onCanvasClear,
}, ref) {
  const editor = useEditor(),
    g = editor.project.graph;
  const groups = visibleSubsystems(editor.project);
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTarget | null>(null);
  const [dragMode, setDragMode] = useState<"select" | "pan">("select");
  const isFree = supportsFreeCanvas(g);

  useImperativeHandle(ref, () => ({
    addAtVisibleCenter: (kind: ComponentKind) => {
      const box = canvasRef.current?.getBoundingClientRect();
      if (!box) {
        editor.add(kind);
        return;
      }
      const screenCenter = {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      };
      const flowPos = flow.screenToFlowPosition(screenCenter);
      const count = editor.project.graph.nodes.length;
      const offset = (count % 6) * 20;
      const snapped = {
        x: Math.round((flowPos.x - 107 + offset) / 20) * 20,
        y: Math.round((flowPos.y - 39 + offset) / 20) * 20,
      };
      editor.add(kind, snapped);
    },
  }));

  const onDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/system-design-component") as ComponentKind;
    if (!kind) return;
    const clientX = event.clientX;
    const clientY = event.clientY;
    const position = flow.screenToFlowPosition({ x: clientX, y: clientY });
    const snapped = {
      x: Math.round((position.x - 107) / 20) * 20,
      y: Math.round((position.y - 39) / 20) * 20,
    };
    editor.add(kind, snapped);
  };

  useEffect(() => {
    setContextMenuTarget(null);
  }, [editor.project.id]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      // Check if canvas container has focus or contains activeElement
      if (!canvasRef.current?.contains(document.activeElement)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        const selected = editor.selectedNodeIds;
        if (selected.length >= 2) {
          const rect = canvasRef.current?.getBoundingClientRect();
          setContextMenuTarget({
            x: rect ? rect.left + rect.width / 2 : 200,
            y: rect ? rect.top + rect.height / 2 : 200,
            kind: "components",
            componentIds: selected,
          });
        }
      } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        const selected = editor.selectedNodeIds;
        const rect = canvasRef.current?.getBoundingClientRect();
        const x = rect ? rect.left + rect.width / 2 : 200;
        const y = rect ? rect.top + rect.height / 2 : 200;
        if (selected.length > 0) {
          setContextMenuTarget({
            x,
            y,
            kind: "components",
            componentIds: selected,
          });
        } else if (editor.selected && groups.some((grp) => grp.id === editor.selected)) {
          setContextMenuTarget({
            x,
            y,
            kind: "subsystem",
            subsystemId: editor.selected,
          });
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [editor.selectedNodeIds, editor.selected, groups]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    let previous: { width: number; height: number } | undefined;
    let frame = 0;
    let initialTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const size = entry.contentRect;
      if (
        (previous &&
          (Math.abs(size.height - previous.height) > 50 ||
            (initialFit.current && Math.abs(size.width - previous.width) > 1))) ||
        (!previous &&
          editor.project.viewport.canvasHeight !== undefined &&
          Math.abs(editor.project.viewport.canvasHeight - size.height) > 1)
      ) {
        cancelAnimationFrame(frame);
        const fit = () => {
          const nodes = flow.getNodes().filter((node) => !node.hidden);
          if (!nodes.length) return;
          if (window.innerWidth <= 560) {
            const selected =
              nodes.find((n) => n.id === useEditor.getState().selected) ??
              nodes[0];
            flow.setCenter(
              selected.position.x + 107,
              selected.position.y + 39,
              { zoom: 0.9 },
            );
          } else {
            const reserved = 110;
            const view = getViewportForBounds(
              getNodesBounds(nodes),
              size.width,
              Math.max(120, size.height - reserved),
              0.3,
              1,
              0.2,
            );
            flow.setViewport({ ...view, y: view.y + reserved });
          }
        };
        if (!previous) initialTimer = setTimeout(fit, 80);
        else frame = requestAnimationFrame(fit);
      }
      previous = { width: size.width, height: size.height };
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(initialTimer);
    };
  }, [flow]);
  const initialFit = useRef(
    editor.project.viewport.x === 0 &&
      editor.project.viewport.y === 0 &&
      editor.project.viewport.zoom === 1,
  );
  useEffect(() => {
    initialFit.current =
      editor.project.viewport.x === 0 &&
      editor.project.viewport.y === 0 &&
      editor.project.viewport.zoom === 1;
  }, [editor.project.id]);
  const mobile = window.innerWidth <= 560;
  const [currentZoom, setCurrentZoom] = useState(editor.project.viewport.zoom ?? 1);
  const gridConfig = useMemo(() => {
    if (currentZoom >= 0.85) {
      return { gap: 20, size: 1.8, color: "#8fa49c" };
    }
    if (currentZoom >= 0.45) {
      return { gap: 40, size: 2.1, color: "#829890" };
    }
    return { gap: 80, size: 2.5, color: "#748a82" };
  }, [currentZoom]);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const expandedKey =
    (editor.project.expandedNodeIds ?? []).join(",") +
    groups.map((group) => `${group.id}:${group.collapsed}`).join(",");
  const lastExpanded = useRef(expandedKey);
  useEffect(() => {
    if (lastExpanded.current === expandedKey) return;
    lastExpanded.current = expandedKey;
    const timer = setTimeout(() => {
      if (mobile) {
        const selected = flow.getNode(editor.selected ?? "");
        if (selected)
          flow.setCenter(
            selected.position.x + 107,
            selected.position.y + 39,
            { zoom: 0.9 },
          );
      } else flow.fitView({ padding: 0.15, maxZoom: 1 });
    }, 80);
    return () => clearTimeout(timer);
  }, [expandedKey, flow]);
  const nodeIdentity = [...g.nodes, ...(supportsFreeCanvas(g) ? g.notes ?? [] : [])].map((node) => node.id).join(",");
  const nodeSet = useRef(nodeIdentity);
  const [localSelectedEdges, setLocalSelectedEdges] = useState<string[]>([]);
  const selectedEdges = onSelectedEdgeChange
    ? (selectedEdgeId ? [selectedEdgeId] : [])
    : localSelectedEdges;
  const setSelectedEdges = (updater: string[] | ((prev: string[]) => string[])) => {
    if (onSelectedEdgeChange) {
      const next = typeof updater === "function" ? updater(selectedEdges) : updater;
      onSelectedEdgeChange(next[0] ?? null);
    } else {
      setLocalSelectedEdges(updater);
    }
  };
  // Keep renderer measurements between metric updates. Dropping them makes
  // React Flow discard handle bounds and remount every edge on each sample.
  const [dimensions, setDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});
  useEffect(() => {
    if (nodeSet.current === nodeIdentity) return;
    const prevIds = new Set(nodeSet.current.split(",").filter(Boolean));
    const currIds = new Set(nodeIdentity.split(",").filter(Boolean));
    nodeSet.current = nodeIdentity;

    const isAddition =
      (prevIds.size === 0 && currIds.size === 1) ||
      (prevIds.size > 0 && currIds.size >= prevIds.size && [...prevIds].every((id) => currIds.has(id)));
    const isDeletion =
      prevIds.size > currIds.size && [...currIds].every((id) => prevIds.has(id));

    if (isAddition || isDeletion) {
      return;
    }

    const timer = setTimeout(() => {
      if (mobile) {
        const node =
          [...g.nodes, ...(g.notes ?? [])].find((n) => n.id === editor.selected) ?? g.nodes[0];
        if (node)
          flow.setCenter(node.position.x + 107, node.position.y + 40, {
            zoom: 0.9,
          });
      } else flow.fitView({ padding: 0.23, maxZoom: 1, duration: 0 });
    }, 80);
    return () => clearTimeout(timer);
  }, [nodeIdentity, flow, mobile, editor.selected, g.nodes, g.notes]);
  const baseNodes: ArchitectureNode[] = useMemo(
    () =>
      g.nodes.map((n) => ({
        id: n.id,
        type: "component",
        position: n.position,
        measured: dimensions[n.id],
        selected: supportsFreeCanvas(g) ? editor.selectedNodeIds.includes(n.id) : editor.selected === n.id,
        deletable: !supportsFreeCanvas(g),
        data: {
          fullMetrics: metrics,
          model: n,
          rate: rateAt(g.settings, metrics?.time ?? 0),
          metrics: metrics?.nodes[n.id],
          hasRun: !!metrics?.time,
          expanded: editor.project.expandedNodeIds?.includes(n.id) ?? false,
          settings: g.settings,
          totals: metrics
            ? {
                generated: metrics.generated,
                jobs: metrics.jobs,
                cacheHits: metrics.cacheHits,
                cacheMisses: metrics.cacheMisses,
                arrivalRate: metrics.arrivalRate,
              }
            : null,
          diagram: isDiagramGraph(g),
        },
      })),
    [g, editor.selected, editor.selectedNodeIds, editor.project.expandedNodeIds, metrics, dimensions],
  );
  const { nodes: architectureNodes, endpoints } = projectSubsystems(baseNodes, groups, metrics);
  const noteNodes: NoteFlowNode[] = supportsFreeCanvas(g) ? (g.notes ?? []).map(note => ({
    id: note.id, type: "note", position: note.position, measured: dimensions[note.id],
    selected: editor.selected === note.id, deletable: false, connectable: false,
    data: { note, attachmentLabel: noteAttachmentLabel(note, editor.project) },
  })) : [];
  const nodes: Node[] = [...architectureNodes.map(node => node.type === "subsystem" ? { ...node, selected: editor.selected === node.id } : node), ...noteNodes];
  const expectedRate = rateAt(g.settings, metrics?.time ?? 0);
  const edges: TrafficConnection[] = useMemo(
    () =>
      g.edges
        .filter(
          (e) =>
            (endpoints.get(e.source) ?? e.source) !==
            (endpoints.get(e.target) ?? e.target),
        )
        .map((e) => {
          const target = g.nodes.find((n) => n.id === e.target);
          const source = g.nodes.find((n) => n.id === e.source);
          const balanced = hasBalancer(g), count = serviceInstances(g).length;
          const observed = !!metrics?.time && metrics.edges?.[e.id] !== undefined;
          const isOpen = isOpenGraph(g);
          const isMessage = (e as unknown as { transport?: string }).transport === "message";
          return {
            ...e,
            source: endpoints.get(e.source) ?? e.source,
            target: endpoints.get(e.target) ?? e.target,
            selected: selectedEdges.includes(e.id),
            type: "traffic",
            animated: false,
            data: {
              running: running && pageVisible,
              showLabel: !isDiagramGraph(g) && (!isOpen || !!metrics?.time),
              label: e.label,
              protocol: e.protocol,
              communication: isOpen ? (isMessage ? "async" : "sync") : (e.communication ?? "sync"),
              rateLabel: observed ? "observed" : isOpen ? "" : g.nodes.find((n) => n.kind === "cache")?.cacheMode === "lru" && target?.kind === "database" ? "capacity" :
                target?.kind === "worker"
                  ? metrics?.time
                    ? "attempts observed"
                    : "capacity"
                  : target?.kind === "queue"
                    ? "offered"
                    : "expected",
              rate: observed ? metrics!.edges![e.id] / metrics!.time : isOpen ? 0 : balanced && (target?.kind === "service" || source?.kind === "service") ? expectedRate / count :
                target?.kind === "worker"
                  ? metrics?.time
                    ? (metrics.nodes[target.id]?.arrived ?? 0) / metrics.time
                    : totalCapacity(target)
                  : target?.kind === "database"
                    ? g.nodes.find((n) => n.kind === "cache")?.cacheMode === "lru"
                      ? (metrics?.time ? metrics.databaseLookups / metrics.time : totalCapacity(target))
                      : expectedRate * (1 - (g.nodes.find((n) => n.kind === "cache")?.hitRate ?? 0) / 100)
                    : expectedRate,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isMessage ? "#a76108" : "#087f84",
              width: 15,
              height: 15,
            },
          };
        }),
    [
      g,
      selectedEdges,
      running,
      pageVisible,
      expectedRate,
      metrics,
      editor.project.subsystems,
    ],
  );
  const onNodesChange: OnNodesChange = (changes) => {
    const selections = changes.filter(change => change.type === "select" && g.nodes.some(node => node.id === change.id));
    if (isFree && selections.length) {
      const ids = new Set(useEditor.getState().selectedNodeIds);
      for (const change of selections) if (change.type === "select") {
        if (change.selected) ids.add(change.id); else ids.delete(change.id);
      }
      editor.selectNodes([...ids]);
    }
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions) {
        const size = change.dimensions;
        setDimensions((previous) =>
          previous[change.id]?.width === size.width &&
          previous[change.id]?.height === size.height
            ? previous
            : { ...previous, [change.id]: size },
        );
      }
    }
    const positions = changes.filter(
      (c) => c.type === "position" && c.position,
    );
    if (positions.length) {
      const directlyMoved = new Set(positions.flatMap((change) => change.type === "position" ? [change.id] : []));
      const next = applyNodeChanges(positions, nodes);
      const moved = new Map(
        [...g.nodes, ...(supportsFreeCanvas(g) ? g.notes ?? [] : [])].map((node) => [
          node.id,
          next.find((n) => n.id === node.id)?.position ?? node.position,
        ]),
      );
      for (const change of positions) {
        if (change.type !== "position") continue;
        const group = groups.find((group) => group.id === change.id);
        const before = nodes.find((node) => node.id === change.id);
        if (group && before && change.type === "position" && change.position) {
          const dx = change.position.x - before.position.x,
            dy = change.position.y - before.position.y;
          for (const id of group.nodeIds) {
            if (directlyMoved.has(id)) continue;
            const position = moved.get(id)!;
            moved.set(id, { x: position.x + dx, y: position.y + dy });
          }
        }
      }
      editor.move([...moved].map(([id, position]) => ({ id, position })));
    }
  };
  return (
    <div
      ref={canvasRef}
      className="system-canvas"
      style={{ width: "100%", height: "100%", position: "relative", minHeight: 380 }}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          const target = e.target as HTMLElement | null;
          if (
            target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.tagName === "SELECT" ||
              target.isContentEditable)
          ) {
            return;
          }
          if (editor.readOnly) return;
          if (isFree) {
            const selectedNodes = editor.selectedNodeIds;
            const selectedNoteId = editor.selected && g.notes?.some(n => n.id === editor.selected) ? editor.selected : null;
            if (selectedNodes.length > 0) {
              e.preventDefault();
              editor.change((draft) => {
                const nodeSet = new Set(selectedNodes);
                draft.nodes = draft.nodes.filter((n) => !nodeSet.has(n.id));
                draft.edges = draft.edges.filter(
                  (edge) => !nodeSet.has(edge.source) && !nodeSet.has(edge.target),
                );
                if (draft.workloads) {
                  draft.workloads = draft.workloads.filter((w) => !nodeSet.has(w.entryNodeId));
                }
              });
              editor.selectNodes([]);
            } else if (selectedNoteId) {
              e.preventDefault();
              editor.removeNote(selectedNoteId);
            }
          }
        }
      }}
    >
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={!editor.readOnly}
      nodesConnectable={!editor.readOnly}
      elementsSelectable={true}
      selectionOnDrag={!editor.readOnly && dragMode === "select"}
      selectionMode={SelectionMode.Partial}
      selectionKeyCode={null}
      panActivationKeyCode="Space"
      panOnDrag={dragMode === "pan" ? [0, 1] : [1]}
      onNodesChange={onNodesChange}
      onNodeDragStart={(_, node) => {
        if (isFree && !editor.selectedNodeIds.includes(node.id)) {
          editor.select(node.id);
        }
        editor.beginMove();
      }}
      onSelectionDragStart={() => {
        editor.beginMove();
      }}
      onEdgesChange={(changes) => {
        for (const c of changes) if (c.type === "select" && !c.selected) {
          setSelectedEdges((ids) => ids.filter((id) => id !== c.id));
        }
      }}
      onEdgeClick={(_, edge) => {
        editor.select(null);
        setSelectedEdges([edge.id]);
      }}
      onNodeClick={(event, n) => {
        setSelectedEdges([]);
        setContextMenuTarget(null);
        if (n.type === "subsystem") {
          editor.select(n.id);
          return;
        }
        if (isFree && editor.selectedNodeIds.includes(n.id) && editor.selectedNodeIds.length > 1 && !event.shiftKey && !editor.selectionMode) {
          // Do not collapse multi-selection on simple click so context menu / drag can act on the group
          return;
        }
        editor.select(n.id, isFree && (event.shiftKey || editor.selectionMode));
      }}
      onNodeContextMenu={(event, node) => {
        event.preventDefault();
        event.stopPropagation();
        if (node.type === "subsystem") {
          editor.select(node.id);
          setContextMenuTarget({
            x: event.clientX,
            y: event.clientY,
            kind: "subsystem",
            subsystemId: node.id,
          });
          return;
        }
        if (node.type === "component") {
          let ids = editor.selectedNodeIds;
          if (!ids.includes(node.id)) {
            ids = [node.id];
            editor.selectNodes(ids);
          }
          setContextMenuTarget({
            x: event.clientX,
            y: event.clientY,
            kind: "components",
            componentIds: ids,
          });
        }
      }}
      onSelectionContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (editor.selectedNodeIds.length > 0) {
          setContextMenuTarget({
            x: event.clientX,
            y: event.clientY,
            kind: "components",
            componentIds: editor.selectedNodeIds,
          });
        }
      }}
      onPaneClick={() => {
        editor.select(null);
        setSelectedEdges([]);
        setContextMenuTarget(null);
        onCanvasClear?.();
      }}
      onPaneContextMenu={(event) => {
        event.preventDefault();
        setContextMenuTarget({
          x: event.clientX,
          y: event.clientY,
          kind: "none",
        });
      }}
      onConnect={(c) => {
        if (editor.readOnly) return;
        if (!c.source || !c.target) return;
        if (groups.some((group) => group.id === c.source || group.id === c.target)) return;
        if (c.source === c.target) return;

        editor.change((draft) => {
          if (draft.edges.length >= 200) return;
          if (draft.edges.some((e) => e.source === c.source && e.target === c.target)) return;

          if (isOpenGraph(draft)) {
            const sourceNode = draft.nodes.find((n) => n.id === c.source);
            const targetNode = draft.nodes.find((n) => n.id === c.target);
            const newEdge = defaultExecutionEdge(c.source, c.target, targetNode?.behavior);
            if (sourceNode?.behavior?.type === "broker") {
              newEdge.transport = "message";
            }
            (draft.edges as unknown as typeof newEdge[]).push(newEdge);
          } else {
            draft.edges.push({ ...c, id: crypto.randomUUID() });
          }
        });
      }}
      onEdgesDelete={(deleted) => {
        if (editor.readOnly) return;
        editor.change((draft) => {
          draft.edges = draft.edges.filter((e) => !deleted.some((d) => d.id === e.id));
        });
      }}
      onNodesDelete={(deleted) => {
        if (editor.readOnly || isFree) return;
        deleted.forEach((n) => editor.remove(n.id));
      }}
      onMove={(_, viewport) => {
        setCurrentZoom(viewport.zoom);
      }}
      onMoveEnd={(_, viewport) => {
        initialFit.current = false;
        setCurrentZoom(viewport.zoom);
        editor.viewport({
          ...viewport,
          canvasHeight: canvasRef.current?.clientHeight,
        });
      }}
      defaultViewport={editor.project.viewport}
      onInit={(instance) => {
        if (initialFit.current && mobile && g.nodes[0])
          instance.setCenter(
            g.nodes[0].position.x + 107,
            g.nodes[0].position.y + 40,
            { zoom: 0.9 },
          );
      }}
      minZoom={mobile ? 0.6 : 0.3}
      maxZoom={1.8}
      fitView={initialFit.current && !mobile}
      fitViewOptions={{ padding: 0.23, maxZoom: 1 }}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
      snapToGrid={true}
      snapGrid={[20, 20]}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={gridConfig.gap}
        size={gridConfig.size}
        color={gridConfig.color}
      />
    </ReactFlow>

    {/* Consolidated Floating Canvas Controls Dock */}
    <div className="canvas-floating-dock" role="toolbar" aria-label="Canvas controls">
      {/* History: Undo & Redo */}
      <div className="canvas-dock-group">
        <button
          type="button"
          className="canvas-dock-btn"
          aria-label="Undo"
          title="Undo model edit (Cmd+Z)"
          disabled={!editor.past.length}
          onClick={editor.undo}
        >
          <Undo2 size={15} />
          <span className="sr-only">Undo</span>
        </button>
        <button
          type="button"
          className="canvas-dock-btn"
          aria-label="Redo"
          title="Redo model edit (Cmd+Shift+Z)"
          disabled={!editor.future.length}
          onClick={editor.redo}
        >
          <Redo2 size={15} />
          <span className="sr-only">Redo</span>
        </button>
      </div>

      <div className="canvas-dock-divider" />

      {/* Tool Modes: Select & Pan */}
      <div className="canvas-dock-group">
        <button
          type="button"
          className={`canvas-dock-btn ${dragMode === "select" ? "active" : ""}`}
          aria-label="Select"
          aria-pressed={dragMode === "select"}
          title="Select tool (box select)"
          onClick={() => setDragMode("select")}
        >
          <MousePointer size={15} />
          <span className="canvas-dock-text">Select</span>
        </button>
        <button
          type="button"
          className={`canvas-dock-btn ${dragMode === "pan" ? "active" : ""}`}
          aria-label="Pan"
          aria-pressed={dragMode === "pan"}
          title="Pan tool (drag canvas)"
          onClick={() => setDragMode("pan")}
        >
          <Hand size={15} />
          <span className="canvas-dock-text">Pan</span>
        </button>
      </div>

      <div className="canvas-dock-divider" />

      {/* Group & Canvas Actions */}
      <div className="canvas-dock-group">
        <button
          type="button"
          className="canvas-dock-btn"
          aria-label="Selection actions"
          title="Group / selection actions"
          disabled={editor.selectedNodeIds.length === 0 && (!editor.selected || !groups.some((g) => g.id === editor.selected))}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            if (editor.selectedNodeIds.length > 0) {
              setContextMenuTarget({
                x: rect.left,
                y: Math.max(10, rect.top - 180),
                kind: "components",
                componentIds: editor.selectedNodeIds,
              });
            } else if (editor.selected && groups.some((g) => g.id === editor.selected)) {
              setContextMenuTarget({
                x: rect.left,
                y: Math.max(10, rect.top - 180),
                kind: "subsystem",
                subsystemId: editor.selected,
              });
            }
          }}
        >
          <Boxes size={15} />
          <span className="canvas-dock-text">Group</span>
        </button>
        <button
          type="button"
          className="canvas-dock-btn add-canvas-note"
          aria-label="Add canvas note"
          title="Add canvas note"
          disabled={editor.readOnly || (editor.project.graph.notes?.length ?? 0) >= 100}
          onClick={() => {
            const box = canvasRef.current?.getBoundingClientRect();
            if (box) {
              setSelectedEdges([]);
              editor.addNote(
                flow.screenToFlowPosition({
                  x: box.left + box.width / 2 - 100,
                  y: box.top + box.height * 0.65,
                })
              );
            }
          }}
        >
          <StickyNote size={15} />
          <span className="canvas-dock-text">Add canvas note</span>
        </button>
      </div>

      <div className="canvas-dock-divider" />

      {/* Zoom Controls */}
      <div className="canvas-dock-group">
        <button
          type="button"
          className="canvas-dock-btn"
          aria-label="Zoom In"
          title="Zoom in"
          onClick={() => flow.zoomIn()}
        >
          <Plus size={15} />
          <span className="sr-only">Zoom In</span>
        </button>
        <button
          type="button"
          className="canvas-dock-btn"
          aria-label="Zoom Out"
          title="Zoom out"
          onClick={() => flow.zoomOut()}
        >
          <Minus size={15} />
          <span className="sr-only">Zoom Out</span>
        </button>
        <button
          type="button"
          className="canvas-dock-btn"
          aria-label="Fit view"
          title="Fit view"
          onClick={() => flow.fitView({ padding: 0.23 })}
        >
          <Maximize2 size={15} />
          <span className="sr-only">Fit view</span>
        </button>
      </div>
    </div>

    <CanvasContextMenu
      target={contextMenuTarget}
      onClose={() => setContextMenuTarget(null)}
      screenToFlowPosition={flow.screenToFlowPosition}
    />

    <DiagramOrganization
      onAddNote={() => {
        const box = canvasRef.current?.getBoundingClientRect();
        if (box) {
          setSelectedEdges([]);
          editor.addNote(
            flow.screenToFlowPosition({
              x: box.left + box.width / 2 - 100,
              y: box.top + box.height * 0.65,
            })
          );
        }
      }}
      dimensions={dimensions}
      onSelectComponent={(id) => {
        setSelectedEdges([]);
        editor.select(id, true);
      }}
      onSelectionModeChange={(active) => {
        if (active) setSelectedEdges([]);
        editor.setSelectionMode(active);
      }}
    />
    {!onSelectedEdgeChange && !!selectedEdges.length && isOpenGraph(g) && <OpenConnectionEditor edgeId={selectedEdges[0]} onClose={() => setSelectedEdges([])} />}
    {!!selectedEdges.length && isDiagramGraph(g) && (() => { const edge = g.edges.find((item) => item.id === selectedEdges[0]); if (!edge) return null; return <section className="connection-editor" aria-label="Selected connection">
      <div className="connection-editor-heading"><strong>Connection</strong><button aria-label="Delete connection" onClick={() => { editor.change((graph) => { graph.edges = graph.edges.filter((item) => !selectedEdges.includes(item.id)); }); setSelectedEdges([]); }}><Trash2 size={14} /></button></div>
      <label><span>Label</span><input aria-label="Connection label" maxLength={60} placeholder="Reads, publishes, uploads…" value={edge.label ?? ""} onChange={(event) => editor.change((graph) => { const item = graph.edges.find((candidate) => candidate.id === edge.id); if (item) item.label = event.target.value; })} /></label>
      <div className="connection-editor-row"><label><span>Protocol</span><input aria-label="Connection protocol" maxLength={30} placeholder="HTTPS, gRPC…" value={edge.protocol ?? ""} onChange={(event) => editor.change((graph) => { const item = graph.edges.find((candidate) => candidate.id === edge.id); if (item) item.protocol = event.target.value; })} /></label><label><span>Flow</span><select aria-label="Connection flow" value={edge.communication ?? "sync"} onChange={(event) => editor.change((graph) => { const item = graph.edges.find((candidate) => candidate.id === edge.id); if (item) item.communication = event.target.value as "sync" | "async" | "data"; })}><option value="sync">Synchronous</option><option value="async">Asynchronous</option><option value="data">Data flow</option></select></label></div>
    </section>; })()}
    </div>
  );
});

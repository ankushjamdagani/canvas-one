import { RoutingPanel } from "./RoutingPanel";
import { hasBalancer, serviceInstances } from "../domain/routing";
import { visibleSubsystems } from "../domain/subsystems";
import { SubsystemNode } from "./SubsystemNode";
import { projectSubsystems } from "./subsystemProjection";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
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
  ChevronDown,
  ListOrdered,
  Cpu,
  ChevronRight,
} from "lucide-react";
import { useEditor } from "../state/editor";
import { totalCapacity, type ModelNode, type Settings } from "../domain/model";
import { rateAt } from "../domain/workload";
import { ComponentInternals } from "./ComponentInternals";
import type { Metrics } from "../simulation/engine";
import { TrafficEdge, type TrafficConnection } from "./TrafficEdge";
export const icons = {
  balancer: Network,
  traffic: ArrowRight,
  service: Hexagon,
  database: Database,
  cache: Layers,
  queue: ListOrdered,
  worker: Cpu,
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
  },
  "component"
>;
function ComponentNode({ data, selected }: NodeProps<ArchitectureNode>) {
  const { model: n, rate, metrics: m, hasRun, expanded } = data,
    Icon = icons[n.kind];
  const toggleExpanded = useEditor((s) => s.toggleExpanded);
  const overloaded = hasRun && (m?.utilization ?? 0) > 0.95;
  return (
    <div
      className={`component-node ${expanded ? "expanded-node" : ""} ${selected ? "selected" : ""} ${overloaded ? "overloaded" : ""}`}
    >
      {n.kind !== "traffic" && (
        <Handle type="target" position={Position.Left} />
      )}
      <div className="node-header">
        <div className={`component-icon ${n.kind}`}>
          <Icon size={24} strokeWidth={1.7} />
        </div>
        <div className="node-copy">
          <strong>{n.name}</strong>
          <span>
            {n.kind === "traffic"
              ? `${rate.toLocaleString()} req/s`
              : n.kind === "balancer" ? "Round-robin routing"
              : n.kind === "cache"
                ? n.cacheMode === "lru" ? `LRU · ${n.cacheEntries ?? 100} entries` : `${n.hitRate}% hit rate`
                : n.kind === "queue"
                  ? `${n.queueLimit.toLocaleString()} waiting slots`
                  : `${totalCapacity(n).toLocaleString()} req/s ${["service", "worker"].includes(n.kind) ? "total" : "capacity"}`}
          </span>
        </div>
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
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
      </div>
      {expanded && (n.kind === "balancer" ? <div className="component-internals"><RoutingPanel metrics={data.fullMetrics} /></div> :
        <ComponentInternals
          node={n}
          settings={data.settings}
          metrics={m}
          totals={data.totals}
          hasRun={hasRun}
        />
      )}
      {overloaded && (
        <span className="node-alert">
          <AlertTriangle size={13} />
        </span>
      )}
      {!["database", "worker"].includes(n.kind) && (
        <Handle type="source" position={Position.Right} />
      )}
      <div className={`node-footnote ${overloaded ? "warning-text" : ""}`}>
        {n.kind === "traffic"
          ? "Seeded arrival stream"
          : n.kind === "balancer" ? (hasRun ? `${m?.arrived.toLocaleString() ?? 0} routed · no rerouting` : "Equal turns · independent queues")
          : hasRun
            ? `${m?.queued ?? 0} queued · ${((m?.utilization ?? 0) * 100).toFixed(0)}% busy`
            : n.kind === "cache"
              ? "Hits return · misses continue"
              : "FIFO · bounded queue"}
      </div>
    </div>
  );
}
const nodeTypes = { component: ComponentNode, subsystem: SubsystemNode };
const edgeTypes = { traffic: TrafficEdge };
export function ArchitectureCanvas({
  metrics,
  running,
}: {
  metrics: Metrics | null;
  running: boolean;
}) {
  const editor = useEditor(),
    g = editor.project.graph;
  const groups = visibleSubsystems(editor.project);
  const flow = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
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
          (Math.abs(size.width - previous.width) > 1 ||
            Math.abs(size.height - previous.height) > 1)) ||
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
              selected.position.y + (selected.measured?.height ?? 78) / 2,
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
  const mobile = window.innerWidth <= 560;
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
            selected.position.y + (selected.measured?.height ?? 78) / 2,
            { zoom: 0.9 },
          );
      } else flow.fitView({ padding: 0.15, maxZoom: 1 });
    }, 80);
    return () => clearTimeout(timer);
  }, [expandedKey, flow]);
  const nodeIdentity = g.nodes.map((node) => node.id).join(",");
  const nodeSet = useRef(nodeIdentity);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  // Keep renderer measurements between metric updates. Dropping them makes
  // React Flow discard handle bounds and remount every edge on each sample.
  const [dimensions, setDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});
  useEffect(() => {
    if (nodeSet.current === nodeIdentity) return;
    nodeSet.current = nodeIdentity;
    const timer = setTimeout(() => {
      if (mobile) {
        const node =
          g.nodes.find((n) => n.id === editor.selected) ?? g.nodes[0];
        if (node)
          flow.setCenter(node.position.x + 107, node.position.y + 40, {
            zoom: 0.9,
          });
      } else flow.fitView({ padding: 0.23, maxZoom: 1, duration: 0 });
    }, 80);
    return () => clearTimeout(timer);
  }, [nodeIdentity, flow]);
  const baseNodes: ArchitectureNode[] = useMemo(
    () =>
      g.nodes.map((n) => ({
        id: n.id,
        type: "component",
        position: n.position,
        measured: dimensions[n.id],
        selected: editor.selected === n.id,
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
        },
      })),
    [g, editor.selected, editor.project.expandedNodeIds, metrics, dimensions],
  );
  const { nodes, endpoints } = projectSubsystems(baseNodes, groups, metrics);
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
          return {
            ...e,
            source: endpoints.get(e.source) ?? e.source,
            target: endpoints.get(e.target) ?? e.target,
            selected: selectedEdges.includes(e.id),
            type: "traffic",
            data: {
              running: running && pageVisible,
              rateLabel: observed ? "observed" : g.nodes.find((n) => n.kind === "cache")?.cacheMode === "lru" && target?.kind === "database" ? "capacity" :
                target?.kind === "worker"
                  ? metrics?.time
                    ? "attempts observed"
                    : "capacity"
                  : target?.kind === "queue"
                    ? "offered"
                    : "expected",
              rate: observed ? metrics!.edges![e.id] / metrics!.time : balanced && (target?.kind === "service" || source?.kind === "service") ? expectedRate / count :
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
              color: "#07858b",
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
    for (const c of changes)
      if (c.type === "select" && c.selected) editor.select(c.id);
    const positions = changes.filter(
      (c) => c.type === "position" && c.position,
    );
    if (positions.length) {
      const next = applyNodeChanges(positions, nodes);
      const moved = new Map(
        g.nodes.map((node) => [
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
            const position = moved.get(id)!;
            moved.set(id, { x: position.x + dx, y: position.y + dy });
          }
        }
      }
      editor.move([...moved].map(([id, position]) => ({ id, position })));
    }
  };
  return (
    <ReactFlow
      ref={canvasRef}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStart={editor.beginMove}
      onEdgesChange={(changes) => {
        for (const c of changes)
          if (c.type === "select")
            setSelectedEdges((ids) =>
              c.selected
                ? [...new Set([...ids, c.id])]
                : ids.filter((id) => id !== c.id),
            );
      }}
      onNodeClick={(_, n) => editor.select(n.id)}
      onPaneClick={() => editor.select(null)}
      onConnect={(c) =>
        !groups.some(
          (group) => group.id === c.source || group.id === c.target,
        ) &&
        editor.change((g) => {
          if (
            !g.edges.some((e) => e.source === c.source && e.target === c.target)
          )
            g.edges.push({ ...c, id: crypto.randomUUID() });
        })
      }
      onEdgesDelete={(deleted) =>
        editor.change((g) => {
          g.edges = g.edges.filter((e) => !deleted.some((d) => d.id === e.id));
        })
      }
      onNodesDelete={(deleted) => deleted.forEach((n) => editor.remove(n.id))}
      onMoveEnd={(_, viewport) =>
        editor.viewport({
          ...viewport,
          canvasHeight: canvasRef.current?.clientHeight,
        })
      }
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
      deleteKeyCode={["Backspace", "Delete"]}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#d6e0dc" gap={20} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}

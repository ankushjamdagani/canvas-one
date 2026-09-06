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
} from "@xyflow/react";
import {
  ArrowRight,
  Database,
  Hexagon,
  Layers,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useEditor } from "../state/editor";
import {
  expectedDatabaseRate,
  type ModelNode,
  type Settings,
} from "../domain/model";
import { ComponentInternals } from "./ComponentInternals";
import type { Metrics } from "../simulation/engine";
import { TrafficEdge, type TrafficConnection } from "./TrafficEdge";
export const icons = {
  traffic: ArrowRight,
  service: Hexagon,
  database: Database,
  cache: Layers,
};
type ArchitectureNode = Node<
  {
    model: ModelNode;
    rate: number;
    metrics?: Metrics["nodes"][string];
    hasRun: boolean;
    expanded: boolean;
    settings: Settings;
    totals: Pick<Metrics, "generated" | "cacheHits"> | null;
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
              : n.kind === "cache"
                ? `${n.hitRate}% hit rate`
                : `${n.capacity.toLocaleString()} req/s capacity`}
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
      {expanded && (
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
      {n.kind !== "database" && (
        <Handle type="source" position={Position.Right} />
      )}
      <div className={`node-footnote ${overloaded ? "warning-text" : ""}`}>
        {n.kind === "traffic"
          ? "Seeded arrival stream"
          : hasRun
            ? `${m?.queued ?? 0} queued · ${((m?.utilization ?? 0) * 100).toFixed(0)}% busy`
            : n.kind === "cache"
              ? "Hits return · misses continue"
              : "FIFO · bounded queue"}
      </div>
    </div>
  );
}
const nodeTypes = { component: ComponentNode };
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
  const flow = useReactFlow();
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
  const expandedKey = (editor.project.expandedNodeIds ?? []).join(",");
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
  const nodeCount = useRef(g.nodes.length);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  // Keep renderer measurements between metric updates. Dropping them makes
  // React Flow discard handle bounds and remount every edge on each sample.
  const [dimensions, setDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});
  useEffect(() => {
    if (nodeCount.current === g.nodes.length) return;
    nodeCount.current = g.nodes.length;
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
  }, [g.nodes.length, flow]);
  const nodes: ArchitectureNode[] = useMemo(
    () =>
      g.nodes.map((n) => ({
        id: n.id,
        type: "component",
        position: n.position,
        measured: dimensions[n.id],
        selected: editor.selected === n.id,
        data: {
          model: n,
          rate: g.settings.traffic,
          metrics: metrics?.nodes[n.id],
          hasRun: !!metrics?.time,
          expanded: editor.project.expandedNodeIds?.includes(n.id) ?? false,
          settings: g.settings,
          totals: metrics
            ? { generated: metrics.generated, cacheHits: metrics.cacheHits }
            : null,
        },
      })),
    [g, editor.selected, editor.project.expandedNodeIds, metrics, dimensions],
  );
  const edges: TrafficConnection[] = useMemo(
    () =>
      g.edges.map((e) => {
        const target = g.nodes.find((n) => n.id === e.target);
        return {
          ...e,
          selected: selectedEdges.includes(e.id),
          type: "traffic",
          data: {
            running: running && pageVisible,
            rate:
              target?.kind === "database"
                ? expectedDatabaseRate(g)
                : g.settings.traffic,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#07858b",
            width: 15,
            height: 15,
          },
        };
      }),
    [g, selectedEdges, running, pageVisible],
  );
  const onNodesChange: OnNodesChange<ArchitectureNode> = (changes) => {
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
      editor.move(next.map((n) => ({ id: n.id, position: n.position })));
    }
  };
  return (
    <ReactFlow
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
      onMoveEnd={(_, viewport) => editor.viewport(viewport)}
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

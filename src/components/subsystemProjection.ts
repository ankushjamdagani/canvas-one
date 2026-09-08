import type { Node } from "@xyflow/react";
import type { Subsystem } from "../domain/subsystems";
import type { Metrics } from "../domain/metrics";
import type { SubsystemCanvasNode } from "./SubsystemNode";
export function projectSubsystems(
  base: Node[],
  groups: Subsystem[],
  metrics: Metrics | null,
): { nodes: Node[]; endpoints: Map<string, string> } {
  const endpoints = new Map<string, string>();
  const boxes: SubsystemCanvasNode[] = groups.map((group) => {
    const children = base.filter((node) => group.nodeIds.includes(node.id));
    const left = Math.min(...children.map((node) => node.position.x)) - 24;
    const top = Math.min(...children.map((node) => node.position.y)) - 56;
    const right =
      Math.max(
        ...children.map(
          (node) => node.position.x + (node.measured?.width ?? 215),
        ),
      ) + 24;
    const bottom =
      Math.max(
        ...children.map(
          (node) => node.position.y + (node.measured?.height ?? 78),
        ),
      ) + 46;
    if (group.collapsed)
      group.nodeIds.forEach((id) => endpoints.set(id, group.id));
    return {
      id: group.id,
      type: "subsystem",
      position: {
        x: group.collapsed ? left + 48 : left,
        y: group.collapsed ? top + 71 : top,
      },
      style: {
        width: group.collapsed ? 240 : right - left,
        height: group.collapsed ? 152 : bottom - top,
      },
      measured: {
        width: group.collapsed ? 240 : right - left,
        height: group.collapsed ? 152 : bottom - top,
      },
      zIndex: group.collapsed ? 1 : -1,
      deletable: false,
      data: {
        group,
        diagram: base.some((node) => (node.data as { diagram?: boolean }).diagram === true),
        queued: children.reduce(
          (sum, node) => sum + (metrics?.nodes[node.id]?.queued ?? 0),
          0,
        ),
        active: children.reduce(
          (sum, node) => sum + (metrics?.nodes[node.id]?.activeWorkers ?? 0),
          0,
        ),
        hasRun: !!metrics?.time,
      },
    };
  });
  return {
    nodes: [
      ...boxes,
      ...base.map((node) => ({ ...node, hidden: endpoints.has(node.id) })),
    ],
    endpoints,
  };
}

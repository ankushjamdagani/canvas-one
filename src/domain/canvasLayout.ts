export type LayoutAxis = "horizontal" | "vertical";
export type Alignment = "left" | "right" | "top" | "bottom";
export interface LayoutNode {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}
export interface PositionUpdate {
  id: string;
  position: { x: number; y: number };
}
export interface LayoutResult {
  updates: PositionUpdate[];
  reason?: string;
}

function selected(nodes: LayoutNode[], ids: string[], minimum: number): LayoutNode[] | string {
  const unique = [...new Set(ids)];
  if (unique.length < minimum) return `Select at least ${minimum} components.`;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result = unique.map((id) => byId.get(id));
  if (result.some((node) => !node)) return "The selection contains a hidden or missing component.";
  if (result.some((node) => !Number.isFinite(node!.position.x) || !Number.isFinite(node!.position.y) || !Number.isFinite(node!.size.width) || !Number.isFinite(node!.size.height) || node!.size.width <= 0 || node!.size.height <= 0))
    return "Component bounds are unavailable.";
  return result as LayoutNode[];
}

function changed(nodes: LayoutNode[], updates: PositionUpdate[]): LayoutResult {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const filtered = updates.filter((update) => {
    const node = byId.get(update.id)!;
    return node.position.x !== update.position.x || node.position.y !== update.position.y;
  });
  return filtered.length ? { updates: filtered } : { updates: [], reason: "Components are already arranged this way." };
}

export function alignNodes(nodes: LayoutNode[], ids: string[], alignment: Alignment): LayoutResult {
  const items = selected(nodes, ids, 2);
  if (typeof items === "string") return { updates: [], reason: items };
  const target = alignment === "left"
    ? Math.min(...items.map((node) => node.position.x))
    : alignment === "right"
      ? Math.max(...items.map((node) => node.position.x + node.size.width))
      : alignment === "top"
        ? Math.min(...items.map((node) => node.position.y))
        : Math.max(...items.map((node) => node.position.y + node.size.height));
  return changed(items, items.map((node) => ({
    id: node.id,
    position: {
      x: alignment === "left" ? target : alignment === "right" ? target - node.size.width : node.position.x,
      y: alignment === "top" ? target : alignment === "bottom" ? target - node.size.height : node.position.y,
    },
  })));
}

export function distributeNodes(nodes: LayoutNode[], ids: string[], axis: LayoutAxis): LayoutResult {
  const items = selected(nodes, ids, 3);
  if (typeof items === "string") return { updates: [], reason: items };
  const startKey = axis === "horizontal" ? "x" : "y";
  const sizeKey = axis === "horizontal" ? "width" : "height";
  const ordered = [...items].sort((a, b) => a.position[startKey] - b.position[startKey] || a.id.localeCompare(b.id));
  const first = ordered[0], last = ordered.at(-1)!;
  const span = last.position[startKey] + last.size[sizeKey] - first.position[startKey];
  const gap = (span - ordered.reduce((sum, node) => sum + node.size[sizeKey], 0)) / (ordered.length - 1);
  if (gap < 0) return { updates: [], reason: `Not enough ${axis} space to distribute without overlap.` };
  let cursor = first.position[startKey];
  const updates = ordered.map((node, index) => {
    const coordinate = index === ordered.length - 1 ? last.position[startKey] : cursor;
    cursor = coordinate + node.size[sizeKey] + gap;
    return {
      id: node.id,
      position: axis === "horizontal"
        ? { x: coordinate, y: node.position.y }
        : { x: node.position.x, y: coordinate },
    };
  });
  return changed(items, updates);
}

import type { BranchRecord, ProjectRecord } from "../../persistence/studio/types";
import type { Document, Id } from "../../domain/studio/model";

export type OpenTarget = {
  readonly branchId: Id;
  /** True when the card opens a draft branch rather than main. */
  readonly isDraft: boolean;
};

/**
 * The branch a project card opens: the newest open draft (that is where unpublished
 * work lives), else main. Closed branches are never opened from the entry screen.
 */
export function resolveOpenTarget(
  project: Pick<ProjectRecord, "mainBranchId">,
  branches: readonly BranchRecord[],
): OpenTarget {
  const drafts = branches
    .filter((b) => b.state === "open" && b.id !== project.mainBranchId)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const newest = drafts[0];
  return newest
    ? { branchId: newest.id, isDraft: true }
    : { branchId: project.mainBranchId, isDraft: false };
}

export type ThumbNode = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visualKind: string;
};

export type ThumbEdge = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

export type ProjectThumbnail = {
  readonly nodes: readonly ThumbNode[];
  readonly edges: readonly ThumbEdge[];
  /** Bounding box of the nodes, padded. */
  readonly viewBox: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
};

/** Placements carry no height; the canvas draws a collapsed node about this tall. */
const NODE_HEIGHT = 64;
const PADDING = 40;

/**
 * Card preview built from the project's first view: its placed nodes and the
 * connections drawn between them. Null when nothing is placed.
 */
export function buildThumbnail(document: Document): ProjectThumbnail | null {
  const view = document.views[0];
  if (!view || view.placements.length === 0) return null;

  const kindByElement = new Map(document.elements.map((e) => [e.id, e.visualKind]));
  const nodes: ThumbNode[] = view.placements.map((p) => ({
    x: p.x,
    y: p.y,
    width: p.width,
    height: NODE_HEIGHT,
    visualKind: kindByElement.get(p.elementId) ?? "",
  }));
  const centerByElement = new Map(
    view.placements.map((p) => [p.elementId, { x: p.x + p.width / 2, y: p.y + NODE_HEIGHT / 2 }]),
  );
  const connectionById = new Map(document.connections.map((c) => [c.id, c]));
  const edges: ThumbEdge[] = [];
  for (const id of view.connectionIds) {
    const connection = connectionById.get(id);
    const from = connection && centerByElement.get(connection.source.elementId);
    const to = connection && centerByElement.get(connection.target.elementId);
    if (from && to) edges.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  }

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.width));
  const maxY = Math.max(...nodes.map((n) => n.y + n.height));
  return {
    nodes,
    edges,
    viewBox: {
      x: minX - PADDING,
      y: minY - PADDING,
      width: maxX - minX + 2 * PADDING,
      height: maxY - minY + 2 * PADDING,
    },
  };
}

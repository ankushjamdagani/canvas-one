export type ComponentKind = "traffic" | "service" | "database" | "cache";
export interface ModelNode {
  id: string;
  kind: ComponentKind;
  name: string;
  position: { x: number; y: number };
  capacity: number;
  queueLimit: number;
  hitRate: number;
}
export interface ModelEdge {
  id: string;
  source: string;
  target: string;
}
export interface Settings {
  traffic: number;
  seed: number;
  duration: number;
  timeoutMs: number;
}
export interface Graph {
  nodes: ModelNode[];
  edges: ModelEdge[];
  settings: Settings;
}
export interface Checkpoint {
  id: string;
  name: string;
  graph: Graph;
  createdAt: number;
}
export interface Project {
  id: string;
  name: string;
  graph: Graph;
  checkpoints: Checkpoint[];
  viewport: { x: number; y: number; zoom: number };
  updatedAt: number;
}
export const labels: Record<ComponentKind, string> = {
  traffic: "Traffic source",
  service: "Redirect service",
  database: "Database",
  cache: "Cache",
};
export function makeNode(kind: ComponentKind, x: number, y: number): ModelNode {
  return {
    id: crypto.randomUUID(),
    kind,
    name: labels[kind],
    position: { x, y },
    capacity: kind === "database" ? 500 : kind === "cache" ? 5000 : 2000,
    queueLimit: 500,
    hitRate: 80,
  };
}
export function baseline(): Graph {
  const nodes = [
    makeNode("traffic", 70, 170),
    makeNode("service", 375, 170),
    makeNode("database", 680, 170),
  ];
  return {
    nodes,
    edges: nodes.slice(1).map((n, i) => ({
      id: crypto.randomUUID(),
      source: nodes[i].id,
      target: n.id,
    })),
    settings: { traffic: 100, seed: 42, duration: 30, timeoutMs: 2000 },
  };
}
export const clone = <T>(value: T): T => structuredClone(value);
export function newProject(name = "URL shortener"): Project {
  return {
    id: crypto.randomUUID(),
    name,
    graph: baseline(),
    checkpoints: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: Date.now(),
  };
}
export function validateGraph(graph: Graph, requireRunnable = true): string[] {
  const errors: string[] = [];
  if (
    !graph ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    !graph.settings
  )
    return [
      "This file is missing a graph, connections, or experiment settings.",
    ];
  const { nodes, edges, settings: s } = graph;
  if (nodes.length > 20 || edges.length > 30)
    return ["This prototype supports up to 20 components and 30 connections."];
  if (
    nodes.some((n) => !n || typeof n.id !== "string") ||
    edges.some(
      (e) =>
        !e ||
        typeof e.id !== "string" ||
        typeof e.source !== "string" ||
        typeof e.target !== "string",
    )
  )
    return ["Components and connections need valid IDs."];
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) errors.push("Component IDs must be unique.");
  for (const n of nodes) {
    if (!["traffic", "service", "database", "cache"].includes(n.kind))
      errors.push(
        "Only traffic, service, cache and database components are supported.",
      );
    if (
      typeof n.name !== "string" ||
      !n.name.trim() ||
      n.name.length > 80 ||
      !Number.isFinite(n.position?.x) ||
      !Number.isFinite(n.position?.y)
    )
      errors.push("Components need a name and valid canvas position.");
    if (!Number.isFinite(n.capacity) || n.capacity < 1 || n.capacity > 100000)
      errors.push("Capacity must be between 1 and 100,000 requests/s.");
    if (
      !Number.isInteger(n.queueLimit) ||
      n.queueLimit < 0 ||
      n.queueLimit > 10000
    )
      errors.push("Queue limits must be whole numbers from 0 to 10,000.");
    if (!Number.isFinite(n.hitRate) || n.hitRate < 0 || n.hitRate > 100)
      errors.push("Cache hit rate must be between 0 and 100%.");
  }
  if (!Number.isFinite(s.traffic) || s.traffic < 1 || s.traffic > 10000)
    errors.push("Traffic must be between 1 and 10,000 requests/s.");
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 2147483647)
    errors.push("Seed must be a whole number from 0 to 2,147,483,647.");
  if (!Number.isFinite(s.duration) || s.duration < 1 || s.duration > 120)
    errors.push("Experiment length must be between 1 and 120 seconds.");
  if (!Number.isFinite(s.timeoutMs) || s.timeoutMs < 10 || s.timeoutMs > 10000)
    errors.push("Timeout must be between 10 and 10,000 ms.");
  if (edges.some((e) => !ids.has(e.source) || !ids.has(e.target)))
    errors.push("A connection references a missing component.");
  // Drafts are portable even before their topology can execute.
  if (!requireRunnable) return [...new Set(errors)];
  if (
    nodes.filter((n) => n.kind === "traffic").length !== 1 ||
    nodes.filter((n) => n.kind === "service").length !== 1 ||
    nodes.filter((n) => n.kind === "database").length !== 1 ||
    nodes.filter((n) => n.kind === "cache").length > 1
  )
    errors.push(
      "Use one traffic source, one service, one database, and optionally one cache.",
    );
  const order = [
    "traffic",
    "service",
    ...(nodes.some((n) => n.kind === "cache") ? ["cache"] : []),
    "database",
  ];
  if (
    edges.length !== nodes.length - 1 ||
    edges.some((e) => !ids.has(e.source) || !ids.has(e.target))
  )
    errors.push("Connect every component into a single request path.");
  for (let i = 0; i < order.length - 1; i++) {
    const from = nodes.find((n) => n.kind === order[i]),
      to = nodes.find((n) => n.kind === order[i + 1]);
    if (
      from &&
      to &&
      !edges.some((e) => e.source === from.id && e.target === to.id)
    )
      errors.push(
        "Supported path: traffic → service → optional cache → database. Reconnect the handles to match.",
      );
  }
  return [...new Set(errors)];
}
export function expectedDatabaseRate(graph: Graph) {
  const cache = graph.nodes.find((n) => n.kind === "cache");
  return graph.settings.traffic * (1 - (cache?.hitRate ?? 0) / 100);
}

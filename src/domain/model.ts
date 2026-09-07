import type { Subsystem } from "./subsystems";
import type { SavedRun } from "./results";
import { rateAt, validateProfile, type TrafficProfile } from "./workload";
export type ComponentKind =
  "traffic" | "service" | "database" | "cache" | "queue" | "worker";
export interface ModelNode {
  id: string;
  kind: ComponentKind;
  name: string;
  position: { x: number; y: number };
  /** Service rate per worker; database/cache each have one processor. */
  capacity: number;
  /** Absent in legacy graphs means one worker. Only services support concurrency. */
  workers?: number;
  failureRate?: number;
  maxRetries?: number;
  retryDelayMs?: number;
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
  profile?: TrafficProfile;
}
export interface Graph {
  scenario?: "lookup" | "jobs";
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
  activeExperiment?: string;
  subsystems?: Subsystem[];
  id: string;
  name: string;
  graph: Graph;
  checkpoints: Checkpoint[];
  viewport: { x: number; y: number; zoom: number; canvasHeight?: number };
  updatedAt: number;
  /** Presentation only; never passed to the simulation engine. */
  expandedNodeIds?: string[];
  savedRuns?: SavedRun[];
}
export const labels: Record<ComponentKind, string> = {
  traffic: "Traffic source",
  service: "Redirect service",
  database: "Database",
  cache: "Cache",
  queue: "Job queue",
  worker: "Job worker",
};
export const MAX_SERVICE_WORKERS = 16;
export function workerCount(node: ModelNode): number {
  return node.kind === "service" || node.kind === "worker"
    ? (node.workers ?? 1)
    : 1;
}
export function totalCapacity(node: ModelNode): number {
  return node.capacity * workerCount(node);
}
export function makeNode(kind: ComponentKind, x: number, y: number): ModelNode {
  return {
    id: crypto.randomUUID(),
    kind,
    name: labels[kind],
    position: { x, y },
    capacity: kind === "database" ? 500 : kind === "cache" ? 5000 : 2000,
    queueLimit: kind === "worker" ? 0 : 500,
    ...(kind === "worker"
      ? {
          capacity: 100,
          workers: 2,
          failureRate: 0,
          maxRetries: 2,
          retryDelayMs: 100,
        }
      : {}),
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
export const isJobGraph = (graph: Graph) => graph.scenario === "jobs";
export function backgroundJobs(): Graph {
  const nodes = [
    makeNode("traffic", 70, 170),
    makeNode("queue", 375, 170),
    makeNode("worker", 680, 170),
  ];
  nodes[0].name = "Job producer";
  return {
    scenario: "jobs",
    nodes,
    edges: nodes.slice(1).map((node, i) => ({
      id: crypto.randomUUID(),
      source: nodes[i].id,
      target: node.id,
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
  if (
    graph.scenario !== undefined &&
    !["lookup", "jobs"].includes(graph.scenario)
  )
    errors.push("Choose a supported experiment path.");
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
    if (
      !["traffic", "service", "database", "cache", "queue", "worker"].includes(
        n.kind,
      )
    )
      errors.push("Choose a supported component type.");
    if (
      typeof n.name !== "string" ||
      !n.name.trim() ||
      n.name.length > 80 ||
      !Number.isFinite(n.position?.x) ||
      !Number.isFinite(n.position?.y)
    )
      errors.push("Components need a name and valid canvas position.");
    if (
      n.workers !== undefined &&
      (!Number.isInteger(n.workers) ||
        n.workers < 1 ||
        n.workers > MAX_SERVICE_WORKERS ||
        (!["service", "worker"].includes(n.kind) && n.workers !== 1))
    )
      errors.push(
        "Service workers must be whole numbers from 1 to 16; other components have one processor.",
      );
    if (!Number.isFinite(n.capacity) || n.capacity < 1 || n.capacity > 100000)
      errors.push("Capacity must be between 1 and 100,000 requests/s.");
    if (
      !Number.isInteger(n.queueLimit) ||
      n.queueLimit < 0 ||
      n.queueLimit > 10000
    )
      errors.push("Queue limits must be whole numbers from 0 to 10,000.");
    if (
      n.kind === "worker" &&
      (!Number.isFinite(n.failureRate ?? 0) ||
        (n.failureRate ?? 0) < 0 ||
        (n.failureRate ?? 0) > 100 ||
        !Number.isInteger(n.maxRetries ?? 2) ||
        (n.maxRetries ?? 2) < 0 ||
        (n.maxRetries ?? 2) > 5 ||
        !Number.isFinite(n.retryDelayMs ?? 100) ||
        (n.retryDelayMs ?? 100) < 0 ||
        (n.retryDelayMs ?? 100) > 10000)
    )
      errors.push(
        "Job failure rate must be 0–100%, retries 0–5, and retry delay 0–10,000 ms.",
      );
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
  errors.push(...validateProfile(s));
  if (edges.some((e) => !ids.has(e.source) || !ids.has(e.target)))
    errors.push("A connection references a missing component.");
  // Drafts are portable even before their topology can execute.
  if (!requireRunnable) return [...new Set(errors)];
  const order = isJobGraph(graph)
    ? ["traffic", "queue", "worker"]
    : [
        "traffic",
        "service",
        ...(nodes.some((n) => n.kind === "cache") ? ["cache"] : []),
        "database",
      ];
  if (
    nodes.length !== order.length ||
    order.some((kind) => nodes.filter((n) => n.kind === kind).length !== 1)
  )
    errors.push(
      isJobGraph(graph)
        ? "Use one producer, one queue and one job worker."
        : "Use one traffic source, one service, one database, and optionally one cache.",
    );
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
        isJobGraph(graph)
          ? "Supported path: producer → queue → worker. Reconnect the handles to match."
          : "Supported path: traffic → service → optional cache → database. Reconnect the handles to match.",
      );
  }
  return [...new Set(errors)];
}
export function expectedDatabaseRate(graph: Graph, time = 0) {
  const cache = graph.nodes.find((n) => n.kind === "cache");
  return rateAt(graph.settings, time) * (1 - (cache?.hitRate ?? 0) / 100);
}

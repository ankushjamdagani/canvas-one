import {
  MAX_SAVED_RUNS,
  validateSavedRun,
  type SavedRun,
} from "../domain/results";
import Dexie, { type EntityTable } from "dexie";
import { clone, validateGraph, type Project } from "../domain/model";
const db = new Dexie("system-studio");
db.version(1).stores({ projects: "id,name,updatedAt" });
const projects = db.table("projects") as EntityTable<Project, "id">;
export const repository = {
  list: () => projects.orderBy("updatedAt").reverse().toArray(),
  save: (project: Project) => projects.put(clone(project)),
  get: (id: string) => projects.get(id),
};
export function exportProject(project: Project) {
  return JSON.stringify(
    { format: "system-studio", version: 4, project },
    null,
    2,
  );
}
export function importProject(text: string): Project {
  if (text.length > 2_000_000)
    throw new Error("Project files must be smaller than 2 MB.");
  const data = JSON.parse(text);
  if (data?.format !== "system-studio" || ![1, 2, 3, 4].includes(data.version))
    throw new Error(
      "Unsupported file. Choose a System studio version 1, 2, 3 or 4 JSON export.",
    );
  const p = data.project;
  if (
    !p ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 80 ||
    !Array.isArray(p.checkpoints) ||
    p.checkpoints.length > 50
  )
    throw new Error("Project name or checkpoints are invalid.");
  const errors = validateGraph(p.graph, false);
  for (const checkpoint of p.checkpoints) {
    if (
      !checkpoint ||
      typeof checkpoint.name !== "string" ||
      checkpoint.name.length > 80 ||
      !Number.isFinite(checkpoint.createdAt)
    )
      throw new Error("A checkpoint is invalid.");
    errors.push(...validateGraph(checkpoint.graph, false));
  }
  if (
    data.version < 4 &&
    [
      p.graph,
      ...p.checkpoints.map((c: Project["checkpoints"][number]) => c.graph),
    ].some((g) =>
      g.nodes?.some(
        (n: { workers?: number }) =>
          n?.workers !== undefined && n.workers !== 1,
      ),
    )
  )
    errors.push("Concurrent service workers require a version-4 project file.");
  if (errors.length) throw new Error(errors[0]);
  const expanded = p.expandedNodeIds ?? [];
  if (
    !Array.isArray(expanded) ||
    expanded.length > 100 ||
    expanded.some((id: unknown) => typeof id !== "string")
  )
    throw new Error("Expanded component settings are invalid.");
  const savedRuns = p.savedRuns ?? [];
  if (!Array.isArray(savedRuns) || savedRuns.length > MAX_SAVED_RUNS)
    throw new Error(
      `A project can contain up to ${MAX_SAVED_RUNS} saved results.`,
    );
  for (const run of savedRuns) {
    if (data.version < 4 && run?.modelVersion !== "url-lookup/2")
      throw new Error(
        "New simulation results require a version-4 project file.",
      );
    const problems = validateSavedRun(run);
    if (problems.length) throw new Error(problems[0]);
  }
  const v = p.viewport;
  if (
    !v ||
    !Number.isFinite(v.x) ||
    !Number.isFinite(v.y) ||
    !Number.isFinite(v.zoom) ||
    v.zoom < 0.1 ||
    v.zoom > 4
  )
    throw new Error("Canvas viewport is invalid.");
  return {
    id: crypto.randomUUID(),
    name: p.name.slice(0, 69) + " (imported)",
    graph: clone(p.graph),
    checkpoints: p.checkpoints.map((c: Project["checkpoints"][number]) => ({
      ...c,
      id: crypto.randomUUID(),
    })),
    viewport: v,
    savedRuns: savedRuns.map((run: SavedRun) => ({
      ...clone(run),
      id: crypto.randomUUID(),
      origin: "imported" as const,
    })),
    expandedNodeIds: [...new Set<string>(expanded)].filter((id) =>
      p.graph.nodes.some((n: { id: string }) => n.id === id),
    ),
    updatedAt: Date.now(),
  };
}

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
    { format: "system-studio", version: 1, project },
    null,
    2,
  );
}
export function importProject(text: string): Project {
  if (text.length > 2_000_000)
    throw new Error("Project files must be smaller than 2 MB.");
  const data = JSON.parse(text);
  if (data?.format !== "system-studio" || data.version !== 1)
    throw new Error(
      "Unsupported file. Choose a System studio version 1 JSON export.",
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
  if (errors.length) throw new Error(errors[0]);
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
    updatedAt: Date.now(),
  };
}

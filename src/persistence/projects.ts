import { validateSubsystems } from "../domain/subsystems";
import { validateRevisions } from "../domain/revisions";
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
  const isOpen = project.graph.executionVersion === "open-system/1";
  const text = JSON.stringify(
    { format: "system-studio", version: isOpen ? 8 : 7, project },
    null,
    2,
  );
  if (isOpen && text.length > 2_000_000) throw new Error("Project files must be smaller than 2 MB. Export fewer saved snapshots or results.");
  return text;
}
export function importProject(text: string): Project {
  if (text.length > 2_000_000)
    throw new Error("Project files must be smaller than 2 MB.");
  const data = JSON.parse(text);
  if (data?.format !== "system-studio" || (data.version !== 7 && data.version !== 8))
    throw new Error(
      "Unsupported file. Import a System studio version-8 export or version-7 archive. Older portable formats are no longer imported; existing local projects are not deleted.",
    );
  const isVersion8 = data.version === 8;
  const p = data.project;
  if (!p || typeof p !== "object") {
    throw new Error("Project structure is invalid.");
  }
  if (
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 80 ||
    !Array.isArray(p.checkpoints) ||
    p.checkpoints.length > 50
  )
    throw new Error("Project name or checkpoints are invalid.");

  if (isVersion8) {
    if (p.graph?.executionVersion !== "open-system/1") {
      throw new Error("Format version 8 requires an open-system execution graph.");
    }
  } else {
    if (p.graph?.executionVersion === "open-system/1") {
      throw new Error("Format version 7 cannot contain open-system execution graphs.");
    }
  }

  const errors = [
    ...validateGraph(p.graph, false),
    ...validateSubsystems(p.subsystems),
    ...validateRevisions(p.revisions),
  ];
  if (errors.length) throw new Error(errors[0]);
  for (const revision of p.revisions ?? []) {
    if ((revision.graph.executionVersion === "open-system/1") !== isVersion8)
      throw new Error("Revision model does not match the portable format version.");
  }
  const noteGroupCollision = (graph: Project["graph"]) => Array.isArray(graph?.notes) &&
    graph.notes.some(note => note && (p.subsystems ?? []).some((group: { id: string }) => group?.id === note.id));
  if (Array.isArray(p.subsystems) && noteGroupCollision(p.graph))
    errors.push("Canvas note IDs must differ from subsystem IDs.");
  if (
    (p.subsystems ?? []).some((group: { id: string }) =>
      p.graph?.nodes?.some((node: { id: string }) => node.id === group.id),
    )
  )
    errors.push("Subsystem IDs must differ from component IDs.");
  for (const checkpoint of p.checkpoints) {
    if (
      !checkpoint ||
      typeof checkpoint.name !== "string" ||
      checkpoint.name.length > 80 ||
      !Number.isFinite(checkpoint.createdAt)
    )
      throw new Error("A checkpoint is invalid.");
    if (isVersion8 && checkpoint.graph?.executionVersion !== "open-system/1") {
      throw new Error("Format version 8 checkpoints must be open-system graphs.");
    } else if (!isVersion8 && checkpoint.graph?.executionVersion === "open-system/1") {
      throw new Error("Format version 7 checkpoints cannot be open-system graphs.");
    }
    errors.push(...validateGraph(checkpoint.graph, false));
    if (Array.isArray(p.subsystems) && noteGroupCollision(checkpoint.graph))
      errors.push("Canvas note IDs must differ from subsystem IDs.");
  }
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
    if (!run || typeof run !== "object") throw new Error("A saved result is invalid.");
    const runIsOpen = run.modelVersion === "open-system/1" || run.graph?.executionVersion === "open-system/1";
    if (isVersion8 && !runIsOpen) throw new Error("Format version 8 saved results must be open-system results.");
    if (!isVersion8 && runIsOpen) throw new Error("Format version 7 saved results cannot be open-system results.");
  }
  for (const run of savedRuns) {
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
    revisions: clone(p.revisions ?? []),
    subsystems: clone(p.subsystems ?? []),
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

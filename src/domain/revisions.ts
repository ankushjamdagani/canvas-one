import { clone, validateGraph, type Graph, type Project } from "./model";
import { validateSubsystems, type Subsystem } from "./subsystems";

export const MAX_REVISIONS = 20;
export interface ArchitectureSnapshot {
  graph: Graph;
  subsystems: Subsystem[];
  expandedNodeIds: string[];
}
export interface RevisionDetails {
  name: string;
  author: string;
  reason: string;
  message: string;
  issue: string;
}
export interface ArchitectureRevision extends ArchitectureSnapshot, RevisionDetails {
  id: string;
  createdAt: number;
  status: "draft" | "final";
  sourceId?: string;
}
export function architectureSnapshot(project: Project): ArchitectureSnapshot {
  return clone({ graph: project.graph, subsystems: project.subsystems ?? [], expandedNodeIds: project.expandedNodeIds ?? [] });
}
export function validateRevisionDetails(value: RevisionDetails): string[] {
  for (const [key, limit] of Object.entries({ name: 80, author: 80, reason: 500, message: 1000, issue: 240 })) {
    const text = value[key as keyof RevisionDetails];
    if (typeof text !== "string" || text.length > limit || (key !== "issue" && !text.trim()))
      return [`Revision ${key} must ${key === "issue" ? "" : "be filled in and "}use at most ${limit} characters.`];
  }
  if (value.issue && !/^https?:\/\/\S+$/i.test(value.issue)) return ["Use an http or https URL for the linked issue, or leave it empty."];
  return [];
}
export function validateRevisions(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REVISIONS) return [`Use up to ${MAX_REVISIONS} architecture revisions.`];
  const ids = new Set<string>();
  for (const r of value) {
    if (!r || typeof r.id !== "string" || !r.id || ids.has(r.id) || !Number.isFinite(r.createdAt) || r.createdAt < 0 || r.createdAt > 8.64e15 || !["draft", "final"].includes(r.status) || (r.sourceId !== undefined && (typeof r.sourceId !== "string" || !ids.has(r.sourceId))) || !Array.isArray(r.subsystems)) return ["A revision has invalid identity, date or status."];
    ids.add(r.id);
    const errors = [...validateRevisionDetails(r), ...validateGraph(r.graph, false), ...validateSubsystems(r.subsystems)];
    if (errors.length) return errors;
    if (!Array.isArray(r.expandedNodeIds) || r.expandedNodeIds.length > 100 || r.expandedNodeIds.some((id: unknown) => typeof id !== "string")) return ["Revision expanded views are invalid."];
    if ((r.subsystems ?? []).some((g: Subsystem) => r.graph.nodes.some((n: { id: string }) => n.id === g.id) || r.graph.notes?.some((n: { id: string }) => n.id === g.id))) return ["Revision subsystem IDs must differ from component and note IDs."];
  }
  for (const r of value) if (r.sourceId !== undefined && (r.sourceId === r.id || !ids.has(r.sourceId))) return ["A revision source must refer to another saved revision."];
  return [];
}
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "";
};
export function compareArchitectures(before: ArchitectureSnapshot, after: ArchitectureSnapshot): string[] {
  const changes: string[] = [];
  function compare(label: string, a: { id: string; name?: string; title?: string }[], b: { id: string; name?: string; title?: string }[]) {
    for (const item of a) {
      const next = b.find(n => n.id === item.id);
      if (!next) changes.push(`${label} removed: ${item.name || item.title || item.id}`);
      else if (stable(item) !== stable(next)) {
        changes.push(`${label} changed: ${next.name || next.title || next.id}`);
        const old = item as unknown as Record<string, unknown>, current = next as unknown as Record<string, unknown>;
        for (const key of new Set([...Object.keys(old), ...Object.keys(current)])) if (stable(old[key]) !== stable(current[key]))
          changes.push(`${key}: ${JSON.stringify(old[key]) ?? "unset"} → ${JSON.stringify(current[key]) ?? "unset"}`);
      }
    }
    for (const item of b) if (!a.some(n => n.id === item.id)) changes.push(`${label} added: ${item.name || item.title || item.id}`);
  }
  compare("Component", before.graph.nodes, after.graph.nodes);
  compare("Connection", before.graph.edges, after.graph.edges);
  compare("Note", before.graph.notes ?? [], after.graph.notes ?? []);
  compare("Subsystem", before.subsystems, after.subsystems);
  if (stable(before.graph.settings) !== stable(after.graph.settings)) changes.push(`Workload settings changed: ${JSON.stringify(before.graph.settings)} → ${JSON.stringify(after.graph.settings)}`);
  if (before.graph.scenario !== after.graph.scenario) changes.push("Scenario changed");
  if (before.graph.executionVersion !== after.graph.executionVersion) changes.push(`Execution version changed: ${before.graph.executionVersion ?? "legacy"} → ${after.graph.executionVersion ?? "legacy"}`);
  if (stable(before.graph.workloads) !== stable(after.graph.workloads)) changes.push(`Workload definitions changed`);
  if (before.graph.guideId !== after.graph.guideId) changes.push("Guided experiment changed");
  if (stable([...before.expandedNodeIds].sort()) !== stable([...after.expandedNodeIds].sort())) changes.push("Expanded component views changed");
  return changes;
}

import type { Project } from "./model";
export interface Subsystem {
  id: string;
  name: string;
  nodeIds: string[];
  collapsed: boolean;
}
/** Subsystems are presentation metadata. Stale members stay dormant through model undo. */
export function visibleSubsystems(project: Project): Subsystem[] {
  const ids = new Set(project.graph.nodes.map((node) => node.id));
  return (project.subsystems ?? [])
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id) => ids.has(id)),
    }))
    .filter((group) => group.nodeIds.length >= 2);
}
export function validateSubsystems(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10)
    return ["Use up to ten subsystems."];
  const ids = new Set<string>(),
    members = new Set<string>();
  for (const group of value) {
    if (
      !group ||
      typeof group.id !== "string" ||
      !group.id ||
      ids.has(group.id) ||
      typeof group.name !== "string" ||
      !group.name.trim() ||
      group.name.length > 80 ||
      typeof group.collapsed !== "boolean" ||
      !Array.isArray(group.nodeIds) ||
      group.nodeIds.length < 2 ||
      group.nodeIds.length > 20 ||
      group.nodeIds.some(
        (id: unknown) => typeof id !== "string" || members.has(id as string),
      )
    )
      return [
        "Subsystems need unique IDs, a name and non-overlapping component members.",
      ];
    ids.add(group.id);
    for (const id of group.nodeIds) {
      if (members.has(id))
        return ["A component can belong to only one subsystem."];
      members.add(id);
    }
  }
  return [];
}

import type { Project } from "./model";

export function groupingReason(project: Project, ids: string[]): string | null {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length) return "Select each component only once.";
  if (uniqueIds.length < 2 || uniqueIds.length > 20) {
    return "Select between 2 and 20 components to form a subsystem.";
  }

  const stored = project.subsystems ?? [];
  if (stored.length >= 10) {
    return "A project can have at most 10 subsystems.";
  }

  const nodeMap = new Map(project.graph.nodes.map((n) => [n.id, n]));
  const collapsedMemberIds = new Set(
    stored.filter((g) => g.collapsed).flatMap((g) => g.nodeIds),
  );

  for (const id of uniqueIds) {
    if (!nodeMap.has(id) || collapsedMemberIds.has(id)) {
      return "Every selected item must be an existing visible component.";
    }
  }

  const usedInAnySubsystem = new Set(stored.flatMap((g) => g.nodeIds));
  for (const id of uniqueIds) {
    if (usedInAnySubsystem.has(id)) {
      return "Components already assigned to a subsystem cannot be grouped.";
    }
  }

  return null;
}

/**
 * Pure presentation planner for canvas.expand / canvas.collapse.
 * Flips Placement.expanded or Group.collapsed on the owning View record only,
 * so one model.apply-records command is one undo entry and no runner input
 * (elements, connections, scenarios) changes.
 */

import type { Document, Id, View } from '../studio/model.js';
import type { SelectionPlan } from './selectionPlans.js';

export type ExpansionTarget = {
  readonly kind: 'placement' | 'group';
  readonly id: Id;
};

export type ExpansionMode = 'expand' | 'collapse';

/** Expanded state per placement id / group id of one view (groups: not collapsed). */
export function expansionStateOf(view: View): Record<Id, boolean> {
  const state: Record<Id, boolean> = {};
  for (const placement of view.placements) state[placement.id] = placement.expanded;
  for (const group of view.groups) state[group.id] = !group.collapsed;
  return state;
}

export function planExpansion(
  document: Document,
  viewId: Id,
  target: ExpansionTarget,
  mode: ExpansionMode,
): SelectionPlan {
  const view = document.views.find((candidate) => candidate.id === viewId);
  if (!view) return { ok: false, reason: 'The active view no longer exists' };
  const expanded = mode === 'expand';
  const noun = target.kind === 'group' ? 'group' : 'component';

  let next: View;
  if (target.kind === 'group') {
    const group = view.groups.find((candidate) => candidate.id === target.id);
    if (!group) return { ok: false, reason: 'That group is not in this view' };
    if (group.collapsed === !expanded) return { ok: false, reason: `This ${noun} is already ${expanded ? 'expanded' : 'collapsed'}` };
    next = { ...view, groups: view.groups.map((g) => (g.id === group.id ? { ...g, collapsed: !expanded } : g)) };
  } else {
    const placement = view.placements.find((candidate) => candidate.id === target.id);
    if (!placement) return { ok: false, reason: 'That component is not in this view' };
    if (placement.expanded === expanded) return { ok: false, reason: `This ${noun} is already ${expanded ? 'expanded' : 'collapsed'}` };
    next = { ...view, placements: view.placements.map((p) => (p.id === placement.id ? { ...p, expanded } : p)) };
  }

  return {
    ok: true,
    label: expanded ? 'Expand' : 'Collapse',
    changes: [{ kind: 'replace', value: { recordKind: 'view', record: next } }],
  };
}

/**
 * Navigation guard (RV-05b).
 *
 * Implements specs/revamp/contracts/commands.md §6 "Navigation guard":
 * "Selection, branch, project and inspector-close all pass through one guard.
 * Clean -> proceed. Dirty -> Apply / Discard / Stay: Apply proceeds only on success,
 * Discard cancels then proceeds, and Stay keeps focus and selection." and D25 /
 * transactions.md §3: "Run requires a clean draft... Apply or Cancel first."
 */

import type { DraftHandle } from './types';

export const RUN_DISABLED_DIRTY_DRAFT_REASON = 'Apply or Cancel configuration changes before running.';

export type GuardDecision = 'proceed' | 'ask';

/**
 * Whether a pending navigation (select another node/edge, click empty canvas, switch
 * branch/project, close the inspector, Run) may proceed immediately or must first ask
 * Apply / Discard / Stay.
 */
export function decideNavigation(draft: DraftHandle | null): GuardDecision {
  if (!draft) return 'proceed';
  return draft.dirty ? 'ask' : 'proceed';
}

/**
 * Escape closes an overlay (e.g. the scenario switcher popover, a dropdown menu)
 * first, never discards a dirty draft directly — commands.md §6 gives Stay/Discard/
 * Apply as the only ways to leave a dirty draft. Callers pass whether an overlay is
 * currently open; when one is, Escape's job is to close *that*, not to touch the draft.
 */
export function decideEscape(draft: DraftHandle | null, overlayOpen: boolean): 'close-overlay' | 'none' {
  if (overlayOpen) return 'close-overlay';
  return 'none';
}

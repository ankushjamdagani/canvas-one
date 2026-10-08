/**
 * Navigation guard.
 *
 * Selection, branch, project and inspector-close all pass through one guard. A clean draft
 * proceeds. A dirty draft offers Apply / Discard / Stay: Apply proceeds only on success,
 * Discard cancels then proceeds, and Stay keeps focus and selection. Run requires a clean
 * draft: Apply or Cancel first.
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

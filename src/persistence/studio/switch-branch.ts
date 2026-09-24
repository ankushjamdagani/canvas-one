/**
 * branch.switch Controller function (RV-08b).
 *
 * Implements specs/revamp/contracts/transactions.md §3 & §4, and commands.md §2 & §3:
 * A controller function `switchBranch(ctx, {projectId, targetBranchId}, {flushPendingSave, resolveDraft})`
 * that awaits flushPendingSave (the source branch's pending autosave),
 * then resolveDraft (the injected navigation guard: 'clean' | 'applied' | 'discarded' | 'stay'),
 * then loads the target branch.
 *
 * Any failure or 'stay' keeps the source active and returns a typed result naming the failed step;
 * nothing is written.
 */

import type { Id } from '../../domain/studio/model';
import type {
  DraftResolution,
  SwitchBranchContext,
  SwitchBranchOptions,
  SwitchBranchResult,
} from './types';

/**
 * Controller function for switching active branch.
 * Not an authored command: no operation receipt, not persisted.
 */
export async function switchBranch(
  ctx: SwitchBranchContext,
  params: { readonly projectId: Id; readonly targetBranchId: Id },
  options?: SwitchBranchOptions,
): Promise<SwitchBranchResult> {
  const repo = 'repo' in ctx ? ctx.repo : ctx;
  const currentBranchId = ('currentBranchId' in ctx ? ctx.currentBranchId : null) ?? null;

  // Step 1: Await flushPendingSave (the source branch's pending autosave)
  if (options?.flushPendingSave) {
    try {
      const flushResult = await options.flushPendingSave();
      if (flushResult && typeof flushResult === 'object') {
        const res = flushResult as Record<string, unknown>;
        if (res.ok === false) {
          return {
            status: 'failed',
            step: 'flush-pending-save',
            activeBranchId: currentBranchId,
            reason: 'flushPendingSave failed with ok: false',
            error: flushResult,
          };
        }
        if (
          typeof res.status === 'string' &&
          ['failed', 'stale', 'invalid', 'missing'].includes(res.status)
        ) {
          return {
            status: 'failed',
            step: 'flush-pending-save',
            activeBranchId: currentBranchId,
            reason: `flushPendingSave failed with status ${res.status}`,
            error: flushResult,
          };
        }
      }
    } catch (err) {
      return {
        status: 'failed',
        step: 'flush-pending-save',
        activeBranchId: currentBranchId,
        reason: err instanceof Error ? err.message : String(err),
        error: err,
      };
    }
  }

  // Step 2: Await resolveDraft (the injected navigation guard)
  if (options?.resolveDraft) {
    let draftResolution: DraftResolution;
    try {
      draftResolution = await options.resolveDraft();
    } catch (err) {
      return {
        status: 'failed',
        step: 'resolve-draft',
        activeBranchId: currentBranchId,
        reason: err instanceof Error ? err.message : String(err),
        error: err,
      };
    }

    if (draftResolution === 'stay') {
      return {
        status: 'failed',
        step: 'resolve-draft',
        activeBranchId: currentBranchId,
        reason: 'User chose to stay on current branch',
      };
    }

    if (
      draftResolution !== 'clean' &&
      draftResolution !== 'applied' &&
      draftResolution !== 'discarded'
    ) {
      return {
        status: 'failed',
        step: 'resolve-draft',
        activeBranchId: currentBranchId,
        reason: `Unexpected draft resolution outcome: ${String(draftResolution)}`,
      };
    }
  }

  // Step 3: Load the target branch
  try {
    const targetBranch = await repo.loadBranch(params.projectId, params.targetBranchId);
    if (!targetBranch) {
      return {
        status: 'failed',
        step: 'load-target-branch',
        activeBranchId: currentBranchId,
        reason: `Target branch ${params.targetBranchId} not found in project ${params.projectId}`,
      };
    }

    return {
      status: 'done',
      activeBranchId: params.targetBranchId,
      branch: targetBranch,
      value: {
        kind: 'branch',
        branchId: params.targetBranchId,
      },
    };
  } catch (err) {
    return {
      status: 'failed',
      step: 'load-target-branch',
      activeBranchId: currentBranchId,
      reason: err instanceof Error ? err.message : String(err),
      error: err,
    };
  }
}

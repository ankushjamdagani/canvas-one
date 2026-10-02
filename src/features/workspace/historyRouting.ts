/**
 * History and Publish controller facades (RV-03s).
 *
 * HistoryLadder, CommitPanel and PublishFlow keep calling their controller's
 * action methods; the workspace hands them these facades so every one of those
 * calls runs the matching registry command (`history.commit|restore|
 * prepare-publish|resolve-conflict|publish`) and therefore its shared
 * availability. A disabled command surfaces its reason as an `invalid` result,
 * which the components already render as their inline error.
 *
 * Not routed: read-only state and previews, `reopenConflict` and the candidate
 * scenario runs (not §3 history commands), and the background behind-main
 * probe, which is not a user command.
 */

import { createIssue } from '../../persistence/studio/errors';
import type { InvalidResult } from '../../persistence/studio';
import type { HistoryController, HistoryControllerLike } from '../history/controller';
import type { PublishController, PublishControllerLike } from '../history/publishController';
import type { CommandId, CommandPayloads, ExecuteResult } from './commands/registry';

export type CommandRunner = <K extends CommandId>(
  id: K,
  payload: CommandPayloads[K],
) => Promise<ExecuteResult>;

function disabledResult(reason: string): InvalidResult {
  return { status: 'invalid', issues: [createIssue('structural-rule', reason, [])] };
}

/** The controller's own result on success; a disabled command's reason otherwise. */
function unwrap<R>(result: ExecuteResult): R | InvalidResult {
  return result.status === 'done' ? (result.value as R) : disabledResult(result.reason);
}

export function routeHistoryController(
  controller: HistoryController,
  run: CommandRunner,
): HistoryControllerLike {
  return {
    getState: controller.getState,
    subscribe: controller.subscribe,
    loadCommitPreview: () => controller.loadCommitPreview(),
    getCommitDiffSummary: (commitId) => controller.getCommitDiffSummary(commitId),
    getCommitsTouching: (elementIds) => controller.getCommitsTouching(elementIds),
    restore: async (targetId, label) =>
      unwrap<Awaited<ReturnType<HistoryController['restore']>>>(await run('history.restore', { targetId, label })),
    // The commit form supplies the message; expected head/revision options stay
    // with the controller, which reads them from the live session.
    commit: async (message) =>
      unwrap<Awaited<ReturnType<HistoryController['commit']>>>(await run('history.commit', { message })),
  };
}

export function routePublishController(
  controller: PublishController,
  run: CommandRunner,
): PublishControllerLike {
  const resolveConflict: PublishControllerLike['resolveConflict'] = async (conflictId, resolution) =>
    unwrap<Awaited<ReturnType<PublishController['resolveConflict']>>>(
      await run('history.resolve-conflict', { conflictId, resolution }),
    );
  return {
    getState: controller.getState,
    subscribe: controller.subscribe,
    reopenConflict: (field) => controller.reopenConflict(field),
    runScenario: (scenarioId) => controller.runScenario(scenarioId),
    reset: () => controller.reset(),
    prepare: async () =>
      unwrap<Awaited<ReturnType<PublishController['prepare']>>>(await run('history.prepare-publish', {})),
    resolveConflict,
    // Bulk resolution is the same one-conflict-at-a-time contract, repeated.
    resolveAllConflicts: async (side) => {
      let last: Awaited<ReturnType<PublishController['resolveConflict']>> | null = null;
      while (controller.getState().conflicts.length > 0) {
        last = await resolveConflict(controller.getState().conflicts[0].id, { kind: side });
        if (last.status !== 'done') return last;
      }
      return last;
    },
    publish: async (metadata, keepSourceOpen) =>
      unwrap<Awaited<ReturnType<PublishController['publish']>>>(
        await run('history.publish', { metadata, keepSourceOpen }),
      ),
  };
}

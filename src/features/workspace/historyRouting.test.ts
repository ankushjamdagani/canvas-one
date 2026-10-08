/**
 * The history/publish facades execute registry commands and surface a
 * disabled command's reason as an `invalid` result the components already render.
 */
import { describe, expect, it, vi } from 'vitest';
import { routeHistoryController, routePublishController, type CommandRunner } from './historyRouting';
import type { HistoryController } from '../history/controller';
import type { PublishController } from '../history/publishController';
import type { ExecuteResult } from './commands/registry';

const disabled: ExecuteResult = { status: 'disabled', reason: 'Apply or Cancel configuration changes before committing.', code: 'draft-open' };

function fakeHistory() {
  return {
    getState: vi.fn(),
    subscribe: vi.fn(),
    loadCommitPreview: vi.fn(),
    getCommitDiffSummary: vi.fn(),
    restore: vi.fn(),
    commit: vi.fn(),
  } as unknown as HistoryController;
}

describe('routeHistoryController', () => {
  it('runs restore and commit as their registry commands', async () => {
    const run = vi.fn(async () => ({ status: 'done', value: { status: 'applied' } }) as ExecuteResult);
    const controller = fakeHistory();
    const routed = routeHistoryController(controller, run as unknown as CommandRunner);
    await routed.restore('cp-1', 'Pre-restore');
    await routed.commit('Ship it');
    expect(run.mock.calls).toEqual([
      ['history.restore', { targetId: 'cp-1', label: 'Pre-restore' }],
      ['history.commit', { message: 'Ship it' }],
    ]);
    // Direct controller actions are never called by the facade.
    expect(controller.commit).not.toHaveBeenCalled();
  });

  it('turns a disabled command into an invalid result carrying its reason', async () => {
    const routed = routeHistoryController(fakeHistory(), (async () => disabled) as CommandRunner);
    const result = await routed.commit('Ship it');
    expect(result).toMatchObject({ status: 'invalid' });
    expect((result as unknown as { issues: readonly { message: string }[] }).issues[0].message).toBe(
      'Apply or Cancel configuration changes before committing.',
    );
  });
});

describe('routePublishController', () => {
  function fakePublish(conflictIds: string[]) {
    let conflicts = conflictIds.map((id) => ({ id }));
    return {
      controller: {
        getState: () => ({ conflicts }),
        subscribe: vi.fn(),
        reopenConflict: vi.fn(),
        runScenario: vi.fn(),
        reset: vi.fn(),
        prepare: vi.fn(),
        resolveConflict: vi.fn(),
        publish: vi.fn(),
      } as unknown as PublishController,
      resolveOne: () => { conflicts = conflicts.slice(1); },
    };
  }

  it('routes prepare, resolve and publish through the registry', async () => {
    const run = vi.fn(async () => ({ status: 'done', value: { status: 'done' } }) as ExecuteResult);
    const { controller } = fakePublish([]);
    const routed = routePublishController(controller, run as unknown as CommandRunner);
    await routed.prepare();
    await routed.resolveConflict('c1', { kind: 'theirs' });
    const metadata = { version: '1.0.0', title: 'T', rationale: '', ticketUrl: null } as never;
    await routed.publish(metadata, true);
    expect(run.mock.calls).toEqual([
      ['history.prepare-publish', {}],
      ['history.resolve-conflict', { conflictId: 'c1', resolution: { kind: 'theirs' } }],
      ['history.publish', { metadata, keepSourceOpen: true }],
    ]);
  });

  it('resolves every conflict one command at a time and stops on a failure', async () => {
    const { controller, resolveOne } = fakePublish(['a', 'b', 'c']);
    const run = vi.fn(async (_id: string, _payload: unknown) => {
      resolveOne();
      return { status: 'done', value: { status: 'done' } } as ExecuteResult;
    });
    const routed = routePublishController(controller, run as unknown as CommandRunner);
    await routed.resolveAllConflicts('ours');
    expect(run.mock.calls.map(([, payload]) => (payload as { conflictId: string }).conflictId)).toEqual(['a', 'b', 'c']);

    const failing = fakePublish(['x', 'y']);
    const stop = vi.fn(async (_id: string, _payload: unknown) => disabled);
    const stopped = routePublishController(failing.controller, stop as unknown as CommandRunner);
    await expect(stopped.resolveAllConflicts('theirs')).resolves.toMatchObject({ status: 'invalid' });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

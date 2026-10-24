import { describe, expect, it, vi } from 'vitest';
import { ProposalController } from '@canvas-one/agents';
const actor = { actorId: 'agent', displayName: 'Claude', kind: 'agent' } as const;
const human = { actorId: 'human', displayName: 'User', kind: 'human' } as const;
const request = { operationId: 'op', actor, scope: { projectId: 'project', branchId: 'draft' }, expectedRevision: 2, label: 'Change label', changes: ['change'] };
function setup(revision = 2) {
  const apply = vi.fn(async () => ({ status: 'applied' as const, receipt: { operationId: 'op' } }));
  const controller = new ProposalController({ getSnapshot: () => ({ scope: request.scope, revision, document: {} }), validate: () => [], canReview: () => true, apply });
  return { controller, apply };
}
describe('durable proposal recovery', () => {
  it('releases only archived terminal reviews and retains pending review authority', () => {
    const { controller } = setup();
    for (const operationId of ['old', 'recent', 'pending']) controller.submit({ ...request, operationId });
    controller.reject('old', human); controller.reject('recent', human);
    expect(controller.pruneTerminal(1)).toBe(1);
    expect(controller.inspect('old')).toBeNull();
    expect(controller.inspect('recent')?.status).toBe('rejected');
    expect(controller.inspect('pending')?.status).toBe('pending');
    expect(() => controller.pruneTerminal(-1)).toThrow();
  });
  it('retains accepted receipts and never reapplies an accepted operation', async () => {
    const { controller, apply } = setup(3);
    expect(controller.restore([{ ...request, status: 'accepted', issues: [], acceptedBy: human, receipt: { operationId: 'op' } }]).ok).toBe(true);
    expect((await controller.accept('op', human)).ok).toBe(true);
    expect(apply).not.toHaveBeenCalled();
  });
  it('revalidates pending proposals against the current revision', async () => {
    const { controller, apply } = setup(3);
    expect(controller.restore([{ ...request, status: 'pending', issues: [] }]).ok).toBe(true);
    expect(controller.inspect('op')?.status).toBe('conflict');
    expect((await controller.accept('op', human)).ok).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
  it('does not make interrupted acceptance actionable after reload', async () => {
    const { controller, apply } = setup();
    expect(controller.restore([{ ...request, status: 'accepting', issues: [] }]).ok).toBe(true);
    expect(controller.inspect('op')?.status).toBe('failed');
    expect((await controller.accept('op', human)).ok).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
  it('rejects corrupt recovery atomically', () => {
    const { controller } = setup();
    expect(controller.restore([{ ...request, status: 'pending', issues: [] }, { ...request, operationId: 'bad', status: 'accepted', issues: [] }]).ok).toBe(false);
    expect(controller.list()).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ProposalController, boundAgentContext, type ProposalRequest, type ProposalHost } from '@canvas-one/agents';
import { createLocalCollaborationProvider } from '@canvas-one/collaboration';

vi.mock('react', () => { throw new Error('Agent mechanics imported React'); });
vi.mock('dexie', () => { throw new Error('Agent mechanics imported Dexie'); });

type Change = { value: string };
const scope = { projectId: 'project', branchId: 'draft' };
const agent = { kind: 'agent' as const, actorId: 'agent-a', displayName: 'Assistant' };
const human = { kind: 'human' as const, actorId: 'human-a', displayName: 'Reviewer' };
function harness() {
  let revision = 1;
  let document = { value: 'Before' };
  const apply = vi.fn<ProposalHost<typeof document, Change>['apply']>(async (request) => {
    if (request.expectedRevision !== revision) return { status: 'stale', issues: [] };
    document = { ...request.changes[0] }; revision++;
    return { status: 'applied', receipt: { revision, actor: request.acceptedBy, proposedBy: request.actor } };
  });
  const host: ProposalHost<typeof document, Change> = {
    getSnapshot: () => ({ scope, revision, document }),
    validate: (_document, changes) => changes.some(({ value }) => value === 'invalid')
      ? [{ code: 'invalid', message: 'Value rejected', path: ['changes'] }] : [],
    apply, canReview: (reviewer) => reviewer.actorId === human.actorId,
  };
  const request = (operationId = 'operation'): ProposalRequest<Change> => ({ operationId, scope,
    expectedRevision: revision, actor: agent, label: 'Explain system', changes: [{ value: 'After' }] });
  return { controller: new ProposalController(host), request, apply,
    edit: () => { revision++; document = { value: 'Intervening edit' }; },
    document: () => document };
}

describe('agent proposal review', () => {
  it('keeps previews separate; accepts one attributed transaction and duplicate receipt', async () => {
    const h = harness();
    const listener = vi.fn(); h.controller.subscribe(listener);
    expect(h.controller.submit(h.request())).toMatchObject({ ok: true, proposal: { status: 'pending' } });
    expect(h.document().value).toBe('Before');
    const first = await h.controller.accept('operation', human);
    expect(first).toMatchObject({ ok: true, proposal: { status: 'accepted', acceptedBy: human,
      receipt: { actor: human, proposedBy: agent } } });
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(h.document().value).toBe('After');
    expect(await h.controller.accept('operation', human)).toEqual(first);
    expect(h.apply).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('detects duplicate identities, isolates returned data and rejects without applying', async () => {
    const h = harness();
    const request = h.request();
    const submitted = h.controller.submit(request);
    expect(h.controller.submit(request)).toEqual(submitted);
    expect(h.controller.submit({ ...request, changes: [{ value: 'Different' }] })).toMatchObject({ ok: false, code: 'operation-id-reused' });
    request.changes[0].value = 'Mutated request';
    const preview = h.controller.inspect('operation')!;
    preview.changes[0].value = 'Mutated preview';
    expect(h.controller.inspect('operation')?.changes[0].value).toBe('After');
    expect(h.controller.reject('operation', human)).toMatchObject({ ok: true, proposal: { status: 'rejected' } });
    expect(await h.controller.accept('operation', human)).toMatchObject({ ok: false, code: 'invalid' });
    expect(h.apply).not.toHaveBeenCalled();
  });

  it('conflicts on intervening edits, unavailable scopes and stale transaction receipts', async () => {
    const h = harness(); h.controller.submit(h.request()); h.edit();
    expect(await h.controller.accept('operation', human)).toMatchObject({ ok: true, proposal: { status: 'conflict' } });
    expect(h.document().value).toBe('Intervening edit'); expect(h.apply).not.toHaveBeenCalled();
    expect(h.controller.submit({ ...h.request('other'), scope: { ...scope, branchId: 'another' } })).toMatchObject({ ok: true, proposal: { status: 'conflict' } });
    const late = harness(); late.controller.submit(late.request());
    late.apply.mockResolvedValueOnce({ status: 'stale', issues: [] });
    expect(await late.controller.accept('operation', human)).toMatchObject({ ok: true, proposal: { status: 'conflict' } });
  });

  it('enforces human review, validation, disposal and bounded queues', async () => {
    const h = harness(); h.controller.submit(h.request());
    expect(await h.controller.accept('operation', agent)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(h.controller.submit({ ...h.request('bad'), changes: [{ value: 'invalid' }] })).toMatchObject({ ok: true, proposal: { status: 'invalid' } });
    expect(h.controller.submit({ ...h.request('empty'), changes: [] })).toMatchObject({ ok: false, code: 'invalid' });
    for (let i = 0; i < 98; i++) h.controller.submit(h.request(`bounded-${i}`));
    expect(h.controller.submit(h.request('overflow'))).toMatchObject({ ok: false, code: 'limit' });
    h.controller.dispose();
    expect(h.controller.list()).toEqual([]);
    expect(h.controller.submit(h.request('closed'))).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('serializes accepts and never invokes a second concurrent host transaction', async () => {
    const h = harness(); h.controller.submit(h.request('first')); h.controller.submit(h.request('second'));
    let finish!: (result: { status: 'applied'; receipt: unknown }) => void;
    h.apply.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const accepting = h.controller.accept('first', human);
    expect(h.controller.inspect('first')?.status).toBe('accepting');
    expect(await h.controller.accept('second', human)).toMatchObject({ ok: false, code: 'busy' });
    expect(h.controller.reject('first', human)).toMatchObject({ ok: false, code: 'invalid' });
    finish({ status: 'applied', receipt: { revision: 2 } });
    expect(await accepting).toMatchObject({ ok: true, proposal: { status: 'accepted' } });
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it('bounds structured context and reports omitted objects and asset references', () => {
    const input = { scope, revision: 1, records: Array.from({ length: 3 }, (_, i) => ({ id: `note-${i}`, type: 'note', data: { text: 'Example' } })), assetReferences: ['asset-a'] };
    const result = boundAgentContext(input, { maxRecords: 1 });
    expect(result).toMatchObject({ truncated: true, omittedRecords: 2, omittedAssetReferences: 0, assetReferences: ['asset-a'] });
    expect(result.records).toHaveLength(1);
    const limited = boundAgentContext({ ...input, assetReferences: ['x'.repeat(1000)] }, { maxCharacters: 300 });
    expect(limited.omittedAssetReferences).toBe(1);
    expect(JSON.stringify(limited).length).toBeLessThanOrEqual(300);
    expect(() => boundAgentContext(input, { maxCharacters: 5 })).toThrow(RangeError);
  });

  it('reports local collaboration capabilities without promising hosted synchronization', async () => {
    const provider = createLocalCollaborationProvider<Change>();
    expect(provider.capabilities).toMatchObject({ documentUpdates: false, presence: false, concurrency: 'none' });
    await provider.connect(scope);
    expect(await provider.publishUpdate({ operationId: 'op', scope, expectedRevision: 1,
      participant: { id: human.actorId, role: 'owner', displayName: human.displayName, authenticated: true }, changes: [] })).toMatchObject({ status: 'unsupported' });
    provider.disconnect(); provider.dispose();
    expect(() => provider.subscribe(() => {})).toThrow();
  });
});

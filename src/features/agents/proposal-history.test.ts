import { expect, it } from 'vitest';
import { isDisplayableRecordChange, mergeProposalHistory } from './proposal-history';
import type { ConversationProposal } from './conversation-controller';

const entry = (id: number, status: string) => ({ taskId: 'old-failed-task', proposal: { operationId: `proposal-${id}`, status } }) as ConversationProposal;
it('does not project incomplete or unsupported untrusted proposal changes', () => {
  for (const change of [null, [], {}, { kind: 'replace' }, { kind: 'insert', value: null }, { kind: 'insert', value: { recordKind: 'element', record: [] } }, { kind: 'replace', value: { recordKind: 'unknown', record: { id: 'id' } } }, { kind: 'remove', recordKind: '__proto__', id: 'id' }]) expect(isDisplayableRecordChange(change)).toBe(false);
  for (const kind of ['insert', 'replace']) expect(isDisplayableRecordChange({ kind, value: { recordKind: 'element', record: { id: 'id', label: 'Router' } } })).toBe(true);
  expect(isDisplayableRecordChange({ kind: 'remove', recordKind: 'element', id: 'id' })).toBe(true);
});
it('keeps all 200 pending reviews reachable after the latest 100 outcomes are dismissed', () => {
  const live = Array.from({ length: 200 }, (_, id) => entry(id, id < 100 ? 'conflict' : 'rejected'));
  const saved = live.slice(100);
  const merged = mergeProposalHistory(saved, live);
  expect(merged).toHaveLength(200);
  expect(merged.filter(value => value.proposal.status === 'conflict')).toHaveLength(100);
  expect(merged.find(value => value.proposal.operationId === 'proposal-0')).toBe(live[0]);
  const staleSaved = [entry(0, 'conflict')];
  expect(mergeProposalHistory(staleSaved, [entry(0, 'rejected')])).toEqual([entry(0, 'rejected')]);
  expect(mergeProposalHistory([], [entry(0, 'accepted')])).toEqual([]);
});

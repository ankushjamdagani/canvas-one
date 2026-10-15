import { expect, it } from 'vitest';
import { mergeProposalHistory } from './proposal-history';
import type { ConversationProposal } from './conversation-controller';

const entry = (id: number, status: string) => ({ taskId: 'old-failed-task', proposal: { operationId: `proposal-${id}`, status } }) as ConversationProposal;
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

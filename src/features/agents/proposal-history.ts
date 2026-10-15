import type { ConversationProposal } from './conversation-controller';

/** Bounded saved outcomes must not hide unresolved reviews older than that window. */
export function mergeProposalHistory(saved: readonly ConversationProposal[], live: readonly ConversationProposal[]): readonly ConversationProposal[] {
  const entries = new Map(saved.map(entry => [entry.proposal.operationId, entry]));
  for (const entry of live) if (['pending', 'accepting', 'conflict', 'invalid', 'failed'].includes(entry.proposal.status) || entries.has(entry.proposal.operationId)) entries.set(entry.proposal.operationId, entry);
  return [...entries.values()];
}

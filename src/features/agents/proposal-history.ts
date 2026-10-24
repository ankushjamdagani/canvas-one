import type { ConversationProposal } from './conversation-controller';
import { RECORD_KINDS, type RecordChange } from '../../domain/studio/records';

/** Bounded saved outcomes must not hide unresolved reviews older than that window. */
export function mergeProposalHistory(saved: readonly ConversationProposal[], live: readonly ConversationProposal[]): readonly ConversationProposal[] {
  const entries = new Map(saved.map(entry => [entry.proposal.operationId, entry]));
  for (const entry of live) if (['pending', 'accepting', 'conflict', 'invalid', 'failed'].includes(entry.proposal.status) || entries.has(entry.proposal.operationId)) entries.set(entry.proposal.operationId, entry);
  return [...entries.values()];
}

/** Invalid/stale proposals retain untrusted changes so their validation errors can be reviewed. */
export function isDisplayableRecordChange(value: unknown): value is RecordChange {
  const object = (input: unknown): input is Record<string, unknown> => input !== null && typeof input === 'object' && !Array.isArray(input);
  if (!object(value)) return false;
  if (value.kind === 'remove') return RECORD_KINDS.some(kind => kind === value.recordKind) && typeof value.id === 'string';
  if (value.kind !== 'insert' && value.kind !== 'replace') return false;
  if (!object(value.value)) return false;
  const payload = value.value;
  return RECORD_KINDS.some(kind => kind === payload.recordKind) && object(payload.record) && typeof payload.record.id === 'string';
}

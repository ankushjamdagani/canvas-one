/**
 * Publish ticket for System Studio (RV-08e).
 *
 * Implements specs/revamp/contracts/storage.md §5 & specs/revamp/contracts/commands.md:
 * "Candidates are controller-owned and can't come from portable input, so publish
 *  goes through CandidateController.publish(ctx, command)... hands the repository
 *  a publish ticket minted in a module-private WeakMap registry (same pattern as token.ts)
 *  bound to the candidate's IDs, tokens, snapshotId and merged document.
 *  The repository rejects any ticket not found in the registry."
 */

import type { Document, Id } from '../../domain/studio/model';
import type { ExpectedHead } from './types';

export type MintPublishTicketParams = {
  readonly candidateId: Id;
  readonly projectId: Id;
  readonly sourceBranchId: Id;
  readonly mainBranchId: Id;
  readonly expectedSourceRevision: number;
  readonly expectedSourceHeadId: ExpectedHead;
  readonly expectedMainRevision: number;
  readonly expectedMainHeadId: ExpectedHead;
  readonly snapshotId: string;
  readonly document: Document;
  readonly operationId: Id;
};

export type PublishTicket = {
  readonly candidateId: Id;
  readonly projectId: Id;
  readonly sourceBranchId: Id;
  readonly mainBranchId: Id;
  readonly expectedSourceRevision: number;
  readonly expectedSourceHeadId: ExpectedHead;
  readonly expectedMainRevision: number;
  readonly expectedMainHeadId: ExpectedHead;
  readonly snapshotId: string;
  readonly document: Document;
  readonly operationId: Id;
};

export type PublishTicketBinding = {
  readonly candidateId: Id;
  readonly projectId: Id;
  readonly sourceBranchId: Id;
  readonly mainBranchId: Id;
  readonly expectedSourceRevision: number;
  readonly expectedSourceHeadId: ExpectedHead;
  readonly expectedMainRevision: number;
  readonly expectedMainHeadId: ExpectedHead;
  readonly snapshotId: string;
  readonly document: Document;
  readonly operationId: Id;
  readonly createdAt: number;
};

function deepFreeze<T>(obj: T, seen = new WeakSet<object>()): T {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }
  if (seen.has(obj as object)) {
    return obj;
  }
  seen.add(obj as object);
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as any)[key];
    if (val !== null && typeof val === 'object') {
      deepFreeze(val, seen);
    }
  }
  return obj;
}

/**
 * Module-private WeakMap registry.
 * An object constructed outside this module (e.g. from plain JSON or object literal)
 * will never have an entry in this registry.
 */
const ticketRegistry = new WeakMap<object, PublishTicketBinding>();

/**
 * Mints an unforgeable, deep-frozen PublishTicket bound to the candidate's
 * IDs, tokens, snapshotId, merged document, and operationId.
 */
export function mintPublishTicket(params: MintPublishTicketParams): PublishTicket {
  if (!params.candidateId) {
    throw new Error('candidateId is required to mint a publish ticket');
  }
  if (!params.projectId) {
    throw new Error('projectId is required to mint a publish ticket');
  }
  if (!params.operationId) {
    throw new Error('operationId is required to mint a publish ticket');
  }

  const binding: PublishTicketBinding = Object.freeze({
    candidateId: params.candidateId,
    projectId: params.projectId,
    sourceBranchId: params.sourceBranchId,
    mainBranchId: params.mainBranchId,
    expectedSourceRevision: params.expectedSourceRevision,
    expectedSourceHeadId: params.expectedSourceHeadId,
    expectedMainRevision: params.expectedMainRevision,
    expectedMainHeadId: params.expectedMainHeadId,
    snapshotId: params.snapshotId,
    document: params.document,
    operationId: params.operationId,
    createdAt: Date.now(),
  });

  const ticket: PublishTicket = {
    candidateId: params.candidateId,
    projectId: params.projectId,
    sourceBranchId: params.sourceBranchId,
    mainBranchId: params.mainBranchId,
    expectedSourceRevision: params.expectedSourceRevision,
    expectedSourceHeadId: params.expectedSourceHeadId,
    expectedMainRevision: params.expectedMainRevision,
    expectedMainHeadId: params.expectedMainHeadId,
    snapshotId: params.snapshotId,
    document: params.document,
    operationId: params.operationId,
  };

  deepFreeze(ticket);
  ticketRegistry.set(ticket, binding);
  return ticket;
}

/**
 * Validates a publish ticket against the module-private WeakMap registry.
 * Returns the bound PublishTicketBinding if valid and issued by mintPublishTicket,
 * or null if forged or invalid.
 */
export function validatePublishTicket(ticket: unknown): PublishTicketBinding | null {
  if (!ticket || typeof ticket !== 'object') {
    return null;
  }
  const binding = ticketRegistry.get(ticket as object);
  return binding ?? null;
}

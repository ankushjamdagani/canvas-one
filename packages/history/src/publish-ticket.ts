/**
 * Publish ticket for System Studio.
 *
 * Candidates are controller-owned and cannot come from portable input, so publish goes
 * through CandidateController.publish(ctx, command), which hands the repository a publish
 * ticket minted in a module-private WeakMap registry (same pattern as token.ts) bound to
 * the candidate's IDs, tokens, snapshotId and merged document. The repository rejects any
 * ticket not found in the registry.
 */

type Id = string;
type ExpectedHead = string | null;
function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value) && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return value;
}

export type MintPublishTicketParams<Document = unknown> = {
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

export type PublishTicket<Document = unknown> = {
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

export type PublishTicketBinding<Document = unknown> = {
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
export function mintPublishTicket<Document>(params: MintPublishTicketParams<Document>): PublishTicket<Document> {
  if (!params.candidateId) {
    throw new Error('candidateId is required to mint a publish ticket');
  }
  if (!params.projectId) {
    throw new Error('projectId is required to mint a publish ticket');
  }
  if (!params.operationId) {
    throw new Error('operationId is required to mint a publish ticket');
  }

  const binding: PublishTicketBinding<Document> = Object.freeze({
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

  const ticket: PublishTicket<Document> = {
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
export function validatePublishTicket<Document = unknown>(ticket: unknown): PublishTicketBinding<Document> | null {
  if (!ticket || typeof ticket !== 'object') {
    return null;
  }
  const binding = ticketRegistry.get(ticket as object);
  return (binding as PublishTicketBinding<Document> | undefined) ?? null;
}

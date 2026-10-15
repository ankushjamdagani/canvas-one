export type AgentActor = { readonly actorId: string; readonly displayName: string; readonly kind: 'agent' | 'human' };
export type ProposalAttribution = { readonly operationId: string; readonly actor: AgentActor & { readonly kind: 'agent' } };
export type BoardScope = { readonly projectId: string; readonly branchId: string };
export type AgentIssue = { readonly code: string; readonly message: string; readonly path: readonly (string | number)[] };
export type ProposalRequest<Change> = {
  readonly operationId: string;
  readonly actor: AgentActor;
  readonly scope: BoardScope;
  readonly expectedRevision: number;
  readonly label: string;
  readonly changes: readonly Change[];
};
export type ProposalStatus = 'pending' | 'accepting' | 'accepted' | 'rejected' | 'conflict' | 'invalid' | 'failed';
export type Proposal<Change> = ProposalRequest<Change> & {
  readonly status: ProposalStatus;
  readonly issues: readonly AgentIssue[];
  readonly acceptedBy?: AgentActor;
  readonly receipt?: unknown;
};
export type ProposalResult<Change> =
  | { readonly ok: true; readonly proposal: Proposal<Change> }
  | { readonly ok: false; readonly code: 'invalid' | 'limit' | 'not-found' | 'operation-id-reused' | 'forbidden' | 'busy'; readonly issues: readonly AgentIssue[] };
export type HostSnapshot<Document> = { readonly scope: BoardScope; readonly revision: number; readonly document: Document };
export type ProposalApplyResult =
  | { readonly status: 'applied'; readonly receipt: unknown }
  | { readonly status: 'stale' | 'invalid' | 'failed'; readonly issues: readonly AgentIssue[] };
export type ProposalHost<Document, Change> = {
  readonly getSnapshot: () => HostSnapshot<Document> | null;
  readonly validate: (document: Document, changes: readonly Change[]) => readonly AgentIssue[];
  /** One atomic transaction and one undo entry; scope/revision must be checked inside the host transaction. */
  readonly apply: (request: ProposalRequest<Change> & { readonly acceptedBy: AgentActor }) => Promise<ProposalApplyResult>;
  readonly canReview: (actor: AgentActor, scope: BoardScope) => boolean;
  /** Derive a detached candidate for host-selected presentation; never persist or dispatch here. */
  readonly preparePreview?: (document: Document, changes: readonly Change[]) =>
    {readonly ok: true; readonly document: Document} | {readonly ok: false; readonly issues: readonly AgentIssue[]};
};
export type ProposalPreview<Document> = {readonly status: 'ready'; readonly document: Document; readonly scope: BoardScope; readonly revision: number}
  | {readonly status: 'unsupported' | 'unavailable' | 'stale'; readonly message: string}
  | {readonly status: 'invalid'; readonly issues: readonly AgentIssue[]};
declare const structuredClone: <T>(value: T) => T;

function sameScope(a: BoardScope, b: BoardScope): boolean {
  return a.projectId === b.projectId && a.branchId === b.branchId;
}
function issue(code: string, message: string, path: readonly (string | number)[] = []): AgentIssue {
  return { code, message, path };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('Expected authored JSON data');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Expected plain authored JSON data');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/** Review queue; previews never mutate authored content. No model client or credentials are stored here. */
export class ProposalController<Document, Change> {
  private readonly proposals = new Map<string, { fingerprint: string; proposal: Proposal<Change> }>();
  private readonly plans = new Map<string, { fingerprint: string; changes: readonly Change[]; metadata: unknown }>();
  private readonly listeners = new Set<() => void>();
  private busy = false;
  private disposed = false;
  constructor(private readonly host: ProposalHost<Document, Change>, private readonly limits: {
    readonly maxProposals?: number; readonly maxChanges?: number; readonly maxRequestCharacters?: number;
  } = {}) {
    for (const value of Object.values(limits)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Proposal limits must be positive safe integers');
    }
  }

  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  list(): readonly Proposal<Change>[] { return [...this.proposals.values()].map(({ proposal }) => structuredClone(proposal)); }
  inspect(operationId: string): Proposal<Change> | null { const found = this.proposals.get(operationId); return found ? structuredClone(found.proposal) : null; }
  /** Host must durably archive terminal results before releasing their in-memory replay identities. */
  pruneTerminal(retain: number): number {
    if (!Number.isSafeInteger(retain) || retain < 0) throw new RangeError('Retention must be a nonnegative safe integer');
    if (this.busy || this.disposed) return 0;
    const terminal = [...this.proposals].filter(([, entry]) => entry.proposal.status === 'accepted' || entry.proposal.status === 'rejected');
    const remove = terminal.slice(0, Math.max(0, terminal.length - retain));
    for (const [id] of remove) { this.proposals.delete(id); this.plans.delete(id); }
    if (remove.length) this.emit();
    return remove.length;
  }
  /** Trusted durable review recovery. In-flight acceptance is never turned back into an actionable proposal. */
  restore(saved: readonly Proposal<Change>[]): { readonly ok: true } | { readonly ok: false; readonly issues: readonly AgentIssue[] } {
    if (this.disposed || this.busy || this.proposals.size || !Array.isArray(saved)) return { ok: false, issues: [issue('invalid', 'Review recovery requires an empty idle controller')] };
    const candidate = new ProposalController(this.host, this.limits);
    try {
      for (const value of saved) {
        if (!value || !['pending', 'accepting', 'accepted', 'rejected', 'conflict', 'invalid', 'failed'].includes(value.status) || !Array.isArray(value.issues)) throw new Error('Invalid recovered review');
        if (canonical(value).length > (this.limits.maxRequestCharacters ?? 262144)) throw new Error('Recovered review exceeds limits');
        const { status, issues: _issues, acceptedBy, receipt, ...request } = value;
        if (candidate.proposals.has(request.operationId)) throw new Error('Duplicate recovered review');
        const result = candidate.submit(request);
        if (!result.ok) return { ok: false, issues: result.issues };
        const entry = candidate.proposals.get(request.operationId)!;
        if (status === 'accepted') {
          if (!acceptedBy || acceptedBy.kind !== 'human' || !acceptedBy.actorId || !acceptedBy.displayName || receipt === undefined) throw new Error('Accepted review requires durable attribution and receipt');
          entry.proposal = structuredClone({ ...request, status, issues: [], acceptedBy, receipt });
        } else if (status === 'rejected') entry.proposal = { ...entry.proposal, status: 'rejected', issues: [] };
        else if (status !== 'pending') entry.proposal = { ...entry.proposal, status: 'failed', issues: [issue('recovery-required', 'Review was interrupted or invalid; inspect the board and regenerate before applying')] };
        // Pending proposals are revalidated against today's scope, revision and domain rules by submit.
      }
      for (const [id, entry] of candidate.proposals) this.proposals.set(id, entry);
      this.emit(); return { ok: true };
    } catch { return { ok: false, issues: [issue('invalid', 'Saved review data is invalid; it was preserved without applying changes')] }; }
  }
  preview(operationId: string): ProposalPreview<Document> {
    const proposal = this.proposals.get(operationId)?.proposal;
    if (this.disposed || !proposal || proposal.status !== 'pending') return {status: 'unavailable', message: 'Preview requires an open pending proposal'};
    if (!this.host.preparePreview) return {status: 'unsupported', message: 'This host has no proposal preview projector'};
    const snapshot = this.host.getSnapshot();
    if (!snapshot || !sameScope(snapshot.scope, proposal.scope) || snapshot.revision !== proposal.expectedRevision) return {status: 'stale', message: 'Board scope or revision changed; regenerate the proposal'};
    try {
      const candidate = this.host.preparePreview(structuredClone(snapshot.document), structuredClone(proposal.changes));
      return candidate.ok ? {status: 'ready', document: structuredClone(candidate.document), scope: {...snapshot.scope}, revision: snapshot.revision}
        : {status: 'invalid', issues: structuredClone(candidate.issues)};
    } catch { return {status: 'invalid', issues: [issue('preview-failed', 'Host could not project this proposal')]}; }
  }

  /** Retry a semantic request without regenerating identifiers or changing its proposal identity. */
  submitPlanned<Metadata>(request: Omit<ProposalRequest<Change>, 'changes'> & { readonly input: unknown },
    plan: () => { readonly ok: true; readonly changes: readonly Change[]; readonly metadata: Metadata }
      | { readonly ok: false; readonly issues: readonly AgentIssue[] }): ProposalResult<Change> & { readonly metadata?: Metadata } {
    if (this.disposed) return this.failure('forbidden', 'Agent session is closed');
    let fingerprint: string;
    try { fingerprint = canonical(request); } catch { return this.failure('invalid', 'Proposal must contain plain JSON data'); }
    if (typeof request.operationId !== 'string' || !request.operationId) return this.failure('invalid', 'Proposal requires an operation identity');
    const existing = this.plans.get(request.operationId);
    if (existing && existing.fingerprint !== fingerprint) return this.failure('operation-id-reused', 'Operation identity was already used for another request');
    if (!existing && (this.plans.size >= (this.limits.maxProposals ?? 100) || fingerprint.length > (this.limits.maxRequestCharacters ?? 262144))) return this.failure('limit', 'Proposal exceeds the configured session limits');
    let prepared = existing;
    if (!prepared) {
      let result: ReturnType<typeof plan>;
      try { result = plan(); } catch { return this.failure('invalid', 'Diagram planning failed'); }
      if (!result.ok) return { ok: false, code: 'invalid', issues: result.issues };
      prepared = structuredClone({ fingerprint, changes: result.changes, metadata: result.metadata });
    }
    const { input: _input, ...proposalRequest } = request;
    const submitted = this.submit({ ...proposalRequest, changes: prepared.changes });
    if (submitted.ok) this.plans.set(request.operationId, prepared);
    return { ...submitted, metadata: structuredClone(prepared.metadata) as Metadata };
  }

  submit(request: ProposalRequest<Change>): ProposalResult<Change> {
    if (this.disposed) return this.failure('forbidden', 'Agent session is closed');
    let fingerprint: string;
    try { fingerprint = canonical(request); } catch { return this.failure('invalid', 'Proposal must contain plain JSON data'); }
    if (!request || typeof request.operationId !== 'string' || !request.operationId || typeof request.label !== 'string' || !request.label ||
        typeof request.scope?.projectId !== 'string' || !request.scope.projectId || typeof request.scope?.branchId !== 'string' || !request.scope.branchId ||
        request.actor?.kind !== 'agent' || typeof request.actor.actorId !== 'string' || !request.actor.actorId ||
        typeof request.actor.displayName !== 'string' || !request.actor.displayName || !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0 || !Array.isArray(request.changes) || request.changes.length === 0) {
      return this.failure('invalid', 'Proposal requires operation identity, agent, scope, revision, label and changes');
    }
    const existing = this.proposals.get(request.operationId);
    if (existing) return existing.fingerprint === fingerprint
      ? { ok: true, proposal: structuredClone(existing.proposal) }
      : this.failure('operation-id-reused', 'Operation identity was already used for another request');
    if (request.changes.length > (this.limits.maxChanges ?? 1000) || fingerprint.length > (this.limits.maxRequestCharacters ?? 262144) ||
        this.proposals.size >= (this.limits.maxProposals ?? 100)) return this.failure('limit', 'Proposal exceeds the configured session limits');
    const snapshot = this.host.getSnapshot();
    const conflict = !snapshot || !sameScope(snapshot.scope, request.scope) || snapshot.revision !== request.expectedRevision;
    let issues: readonly AgentIssue[];
    try { issues = conflict ? [issue('stale', 'Board scope or revision changed; regenerate this proposal')] : this.host.validate(snapshot!.document, request.changes); }
    catch { return this.failure('invalid', 'Host validation failed'); }
    const proposal: Proposal<Change> = structuredClone({ ...request, status: conflict ? 'conflict' : issues.length ? 'invalid' : 'pending', issues });
    this.proposals.set(request.operationId, { fingerprint, proposal });
    this.emit();
    return { ok: true, proposal: structuredClone(proposal) };
  }

  async accept(operationId: string, reviewer: AgentActor): Promise<ProposalResult<Change>> {
    if (this.disposed) return this.failure('forbidden', 'Agent session is closed');
    const found = this.proposals.get(operationId);
    if (!found) return this.failure('not-found', 'Proposal was not found');
    if (reviewer.kind !== 'human' || !this.host.canReview(reviewer, found.proposal.scope)) return this.failure('forbidden', 'This participant cannot review this proposal');
    if (found.proposal.status === 'accepted') return { ok: true, proposal: structuredClone(found.proposal) };
    if (this.busy || found.proposal.status === 'accepting') return this.failure('busy', 'Another proposal transaction is in flight');
    if (found.proposal.status !== 'pending') return this.failure('invalid', 'Only a pending proposal can be accepted; regenerate after conflict');
    const snapshot = this.host.getSnapshot();
    if (!snapshot || !sameScope(snapshot.scope, found.proposal.scope) || snapshot.revision !== found.proposal.expectedRevision) {
      return this.update(found, 'conflict', [issue('stale', 'Board scope or revision changed; regenerate this proposal')]);
    }
    let issues: readonly AgentIssue[];
    try { issues = this.host.validate(snapshot.document, found.proposal.changes); } catch { return this.update(found, 'invalid', [issue('invalid', 'Host validation failed')]); }
    if (issues.length) return this.update(found, 'invalid', issues);
    this.busy = true;
    this.update(found, 'accepting', []);
    try {
      const result = await this.host.apply(structuredClone({ ...found.proposal, acceptedBy: reviewer }));
      if (result.status === 'applied') {
        found.proposal = { ...found.proposal, status: 'accepted', issues: [], acceptedBy: structuredClone(reviewer), receipt: structuredClone(result.receipt) };
        this.emit();
        return { ok: true, proposal: structuredClone(found.proposal) };
      }
      return this.update(found, result.status === 'stale' ? 'conflict' : result.status, result.issues);
    } catch {
      return this.update(found, 'failed', [issue('failed', 'Proposal transaction failed; inspect the host before retrying')]);
    } finally { this.busy = false; }
  }

  reject(operationId: string, reviewer: AgentActor): ProposalResult<Change> {
    const found = this.proposals.get(operationId);
    if (!found) return this.failure('not-found', 'Proposal was not found');
    if (this.disposed || reviewer.kind !== 'human' || !this.host.canReview(reviewer, found.proposal.scope)) return this.failure('forbidden', 'This participant cannot review this proposal');
    if (found.proposal.status === 'accepting' || found.proposal.status === 'accepted') return this.failure('invalid', 'An applied or in-flight proposal cannot be rejected');
    return this.update(found, 'rejected', []);
  }

  dispose(): void { this.disposed = true; this.listeners.clear(); this.proposals.clear(); this.plans.clear(); }
  private failure(code: 'invalid' | 'limit' | 'not-found' | 'operation-id-reused' | 'forbidden' | 'busy', message: string): ProposalResult<Change> {
    return { ok: false, code, issues: [issue(code, message)] };
  }
  private update(found: { proposal: Proposal<Change> }, status: ProposalStatus, issues: readonly AgentIssue[]): ProposalResult<Change> {
    found.proposal = { ...found.proposal, status, issues: structuredClone(issues) }; this.emit();
    return { ok: true, proposal: structuredClone(found.proposal) };
  }
  private emit(): void { for (const listener of this.listeners) { try { listener(); } catch { /* observers cannot break a transaction */ } } }
}

export type ComponentSchema = { readonly type: string; readonly version: string; readonly schema: unknown };
export type AgentContextRecord = { readonly id: string; readonly type: string; readonly data: unknown };
export type BoundedAgentContext = {
  readonly scope: BoardScope; readonly revision: number;
  readonly records: readonly AgentContextRecord[]; readonly assetReferences: readonly string[];
  readonly truncated: boolean; readonly omittedRecords: number; readonly omittedAssetReferences: number;
};
/** Hosts project only authored records and asset references; binary bytes and credentials stay outside context. */
export function boundAgentContext(input: Omit<BoundedAgentContext, 'truncated' | 'omittedRecords' | 'omittedAssetReferences'>,
  limits: { readonly maxRecords?: number; readonly maxCharacters?: number } = {}): BoundedAgentContext {
  const maxRecords = limits.maxRecords ?? 200;
  const maxCharacters = limits.maxCharacters ?? 65536;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 0 || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new RangeError('Context limits must be safe nonnegative record and positive character counts');
  const records: AgentContextRecord[] = [];
  const assetReferences: string[] = [];
  let characters = canonical({ scope: input.scope, revision: input.revision, assetReferences: [], records: [],
    truncated: false, omittedRecords: input.records.length, omittedAssetReferences: input.assetReferences.length }).length;
  if (characters > maxCharacters) throw new RangeError('Context limit cannot contain its scope and truncation metadata');
  for (const reference of input.assetReferences) {
    const size = canonical(reference).length + 1;
    if (characters + size > maxCharacters) break;
    assetReferences.push(reference); characters += size;
  }
  for (const record of input.records) {
    const size = canonical(record).length + 1;
    if (records.length >= maxRecords || characters + size > maxCharacters) break;
    records.push(structuredClone(record)); characters += size;
  }
  const omittedRecords = input.records.length - records.length;
  const omittedAssetReferences = input.assetReferences.length - assetReferences.length;
  return { scope: structuredClone(input.scope), revision: input.revision, records,
    assetReferences, truncated: omittedRecords > 0 || omittedAssetReferences > 0, omittedRecords, omittedAssetReferences };
}
export type ModelProvider = {
  readonly id: string;
  readonly generateProposal: (input: { readonly instruction: string; readonly context: BoundedAgentContext; readonly schemas: readonly ComponentSchema[] },
    options?: { readonly signal?: { readonly aborted: boolean } }) => Promise<unknown>;
};

export const AGENT_TOOLS = [
  { name: 'clarification_request', description: 'Ask one explicit question needed to continue this task. The host saves the question and pauses this attempt; a human answer starts a new authorized attempt.', inputSchema: { type: 'object', properties: { questionId: { type: 'string', minLength: 1, maxLength: 200 }, question: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['questionId', 'question'], additionalProperties: false } },
  { name: 'board_inspect', description: 'Inspect bounded authored board context and its current scope/revision.', inputSchema: {type: 'object', properties: {selectionOnly: {type: 'boolean'}}, additionalProperties: false} },
  { name: 'component_schemas', description: 'Discover available component schemas and authored document format.', inputSchema: {type: 'object', properties: {}, additionalProperties: false} },
  { name: 'document_validate', description: 'Validate a complete authored system-design document without editing.', inputSchema: {type: 'object', properties: {document: {type: 'object'}}, required: ['document'], additionalProperties: false} },
  { name: 'proposal_submit', description: 'Submit a diagram or annotation transaction for human review; never edits directly.', inputSchema: {type: 'object', properties: {operationId: {type: 'string'}, scope: {type: 'object', properties: {projectId: {type: 'string'}, branchId: {type: 'string'}}, required: ['projectId', 'branchId'], additionalProperties: false}, expectedRevision: {type: 'integer', minimum: 0}, label: {type: 'string'}, changes: {type: 'array', minItems: 1, maxItems: 1000, items: {type: 'object'}}}, required: ['operationId', 'scope', 'expectedRevision', 'label', 'changes'], additionalProperties: false} },
  { name: 'action_submit', description: 'Apply one coherent action only when this task has explicit Live permission. Supply a UUID operation identity and the exact before-records read from this board. Human overlap pauses the action. Suggest tasks must use proposal_submit instead.', inputSchema: {type: 'object', properties: {operationId: {type: 'string', format: 'uuid'}, label: {type: 'string', minLength: 1, maxLength: 200}, changes: {type: 'array', minItems: 1, maxItems: 1000, items: {type: 'object'}}, expectedRecords: {type: 'array', minItems: 1, maxItems: 1000, items: {type: 'object', properties: {recordKind: {type: 'string'}, id: {type: 'string'}, before: {type: ['object', 'null']}}, required: ['recordKind', 'id', 'before'], additionalProperties: false}}}, required: ['operationId', 'label', 'changes', 'expectedRecords'], additionalProperties: false} },
  { name: 'proposal_status', description: 'Inspect proposal review status and validation errors.', inputSchema: {type: 'object', properties: {operationId: {type: 'string'}}, required: ['operationId'], additionalProperties: false} },
  { name: 'diagram_create', description: 'Plan readable components and connections as one proposal for human review.', inputSchema: {type: 'object', required: ['operationId', 'scope', 'expectedRevision', 'label', 'diagram'], properties: {operationId: {type: 'string'}, scope: {type: 'object'}, expectedRevision: {type: 'integer', minimum: 0}, label: {type: 'string'}, diagram: {type: 'object', description: 'Use the diagram schema returned by component_schemas'}}, additionalProperties: false} },
] as const;
export type AgentToolDefinition = typeof AGENT_TOOLS[number];
export type AgentTool = AgentToolDefinition['name'];
export * from './tasks.js';
export * from './task-repository.js';
export * from './leases.js';

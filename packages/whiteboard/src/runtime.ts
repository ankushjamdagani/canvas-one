import { createIssue, invertRecordChanges, type Actor, type RecordChange, type RecordMapConstraint, type PriorRecordLookup, type ValidationIssue } from './index.js';
import type { DocumentValidationResult } from './document.js';
import { immutableSnapshot } from './immutable.js';
import { createExtensionHost, type ExtensionDefinition } from './extensions.js';
import { validateBoardDocument } from './document.js';

export type BoardScope = { readonly projectId: string; readonly branchId: string };
export type TransactionIntent = 'normal' | 'undo' | 'redo';
export type BoardTransaction<M extends RecordMapConstraint<M>> = {
  readonly operationId: string; readonly actor: Actor; readonly scope: BoardScope;
  readonly expectedRevision: number; readonly changes: readonly RecordChange<M>[];
  readonly intent?: TransactionIntent; readonly historyEntryId?: string; readonly label?: string;
};
export type PreparedBoardTransaction<D, M extends RecordMapConstraint<M>> = {
  readonly request: BoardTransaction<M>; readonly before: D; readonly document: D;
  readonly inverseChanges: readonly RecordChange<M>[];
};
export type AtomicCommitResult<D> =
  | { readonly status: 'applied'; readonly document: D; readonly revision: number }
  | { readonly status: 'stale'; readonly actualRevision: number }
  | { readonly status: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly status: 'failed'; readonly error: unknown };
/** Commit must persist authored content and all required receipt/history metadata atomically. */
export type AtomicCommitPort<D, M extends RecordMapConstraint<M>> = (
  transaction: PreparedBoardTransaction<D, M>,
) => Promise<AtomicCommitResult<D>>;
export type BoardRuntimeSnapshot<D> = {
  readonly document: D; readonly revision: number; readonly scope: BoardScope;
  readonly busy: boolean; readonly disposed: boolean; readonly needsReload: boolean;
};
export type BoardDispatchResult =
  | { readonly status: 'applied'; readonly operationId: string; readonly revision: number }
  | { readonly status: 'stale'; readonly actualRevision: number }
  | { readonly status: 'invalid'; readonly issues: readonly ValidationIssue[] }
  | { readonly status: 'busy' | 'disposed' }
  | { readonly status: 'failed'; readonly error: unknown; readonly needsReload: boolean };
export type BoardRuntime<D, M extends RecordMapConstraint<M>> = {
  readonly extensions: ReturnType<typeof createExtensionHost>;
  readonly getSnapshot: () => BoardRuntimeSnapshot<D>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispatch: (transaction: BoardTransaction<M>) => Promise<BoardDispatchResult>;
  readonly dispose: () => void;
};
export type BoardRuntimeOptions<D, M extends RecordMapConstraint<M>> = {
  readonly extensions?: readonly ExtensionDefinition[];
  readonly validateExtensions?: (document: D, extensions: ReturnType<typeof createExtensionHost>) => readonly ValidationIssue[];
  readonly document: D; readonly scope: BoardScope; readonly revision?: number;
  readonly validate: (document: unknown) => DocumentValidationResult<D>;
  readonly apply: (document: D, changes: readonly RecordChange<M>[]) => DocumentValidationResult<D>;
  readonly lookup: (document: D, ...args: Parameters<PriorRecordLookup<M>>) => ReturnType<PriorRecordLookup<M>>;
  /** Existing domains can retain their own issue vocabulary and inverse preconditions. */
  readonly invert?: (document: D, changes: readonly RecordChange<M>[]) =>
    | { readonly ok: true; readonly changes: readonly RecordChange<M>[] }
    | { readonly ok: false; readonly issues: readonly ValidationIssue[] };
  readonly commit?: AtomicCommitPort<D, M>;
  /** Post-commit observation only: required durable metadata belongs inside commit. */
  readonly onCommitted?: (transaction: PreparedBoardTransaction<D, M>, revision: number) => void;
  readonly onObserverError?: (error: unknown) => void;
  /** Local retries only; durable idempotency is the commit port's responsibility. */
  readonly maxLocalReceipts?: number;
};

function requestKey(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      return Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
    }
    return current;
  });
}

/** One document authority per instance. Host planners/codecs allow system-specific documents. */
export function createBoardRuntime<D, M extends RecordMapConstraint<M>>(options: BoardRuntimeOptions<D, M>): BoardRuntime<D, M> {
  const revision = options.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || !options.scope?.projectId || !options.scope.branchId) throw new TypeError('Board requires a valid scope and nonnegative safe revision');
  const limit = options.maxLocalReceipts ?? 256;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('maxLocalReceipts must be a positive safe integer');
  const lifecycle = {busy: false, disposed: false};
  const extensions = createExtensionHost({canModify: () => !lifecycle.busy && !lifecycle.disposed});
  for (const definition of options.extensions ?? []) {
    const result = extensions.register(definition);
    if (!result.ok) { extensions.dispose(); throw new TypeError(result.message); }
  }
  const validate = (input: unknown): DocumentValidationResult<D> => {
    const base = options.validate(input);
    if (!base.ok) return base;
    let issues: readonly ValidationIssue[] = [];
    if (options.validateExtensions) issues = options.validateExtensions(base.document, extensions);
    else if (base.document && typeof base.document === 'object' && 'format' in base.document && base.document.format === 'canvas-one/board') {
      const neutral = validateBoardDocument(base.document);
      issues = neutral.ok ? extensions.validateBoard(neutral.document) : neutral.issues;
    }
    return issues.length ? {ok: false, issues} : base;
  };
  let initial: DocumentValidationResult<D>;
  try { initial = validate(options.document); } catch (error) { extensions.dispose(); throw error; }
  if (!initial.ok) { extensions.dispose(); throw new TypeError(`Invalid initial board: ${initial.issues.map((issue) => issue.message).join('; ')}`); }
  let state = immutableSnapshot<BoardRuntimeSnapshot<D>>({ document: initial.document, revision, scope: options.scope, busy: false, disposed: false, needsReload: false });
  const listeners = new Set<() => void>();
  const receipts = new Map<string, { key: string; result: BoardDispatchResult }>();
  const report = (error: unknown) => { try { options.onObserverError?.(error); } catch { /* Error reporting cannot invalidate a committed document. */ } };
  const notify = () => { for (const listener of [...listeners]) { try { listener(); } catch (error) { report(error); } } };
  const update = (next: BoardRuntimeSnapshot<D>) => { lifecycle.busy = next.busy; state = Object.freeze(next); notify(); };
  const invalid = (code: string, message: string): BoardDispatchResult => ({ status: 'invalid', issues: [createIssue(code, message)] });
  const dispatch = async (input: BoardTransaction<M>): Promise<BoardDispatchResult> => {
    if (state.disposed) return { status: 'disposed' };
    let request: BoardTransaction<M>; let key: string;
    try { request = immutableSnapshot(input); key = requestKey(request); }
    catch (error) { return { status: 'failed', error, needsReload: false }; }
    if (!request.operationId || !request.actor?.actorId || !request.actor.kind || typeof request.actor.displayName !== 'string') return invalid('invalid-attribution', 'Transaction requires operation identity and an attributed actor');
    if (!request.scope || request.scope.projectId !== state.scope.projectId || request.scope.branchId !== state.scope.branchId) return invalid('scope-mismatch', 'Transaction scope does not match this board session');
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) return invalid('invalid-revision', 'Expected revision must be a nonnegative safe integer');
    if (!Array.isArray(request.changes) || request.intent !== undefined && !['normal', 'undo', 'redo'].includes(request.intent)) return invalid('invalid-transaction', 'Transaction requires a record-change array and a supported intent');
    const receipt = receipts.get(request.operationId);
    if (receipt) return receipt.key === key ? receipt.result : invalid('operation-conflict', 'Operation id was already used with another request');
    if (state.busy) return { status: 'busy' };
    if (state.needsReload) return { status: 'failed', error: new Error('Board must reload after a stale or invalid commit response'), needsReload: true };
    if (request.expectedRevision !== state.revision) return { status: 'stale', actualRevision: state.revision };
    if (state.revision === Number.MAX_SAFE_INTEGER) return invalid('revision-overflow', 'Revision limit reached');
    const before = state.document;
    update({ ...state, busy: true });
    let requiresReload = false;
    try {
      const inverted = options.invert ? options.invert(before, request.changes) : invertRecordChanges<M>(request.changes, (kind, id) => options.lookup(before, kind, id));
      if (!inverted.ok) return { status: 'invalid', issues: 'issues' in inverted ? inverted.issues : inverted.missing.map(({ index, recordKind, id }) => createIssue('missing-prior', `Cannot invert ${recordKind} ${id}`, ['changes', index], id)) };
      const applied = options.apply(before, request.changes);
      if (!applied.ok) return { status: 'invalid', issues: applied.issues };
      const validated = validate(applied.document);
      if (!validated.ok) return { status: 'invalid', issues: validated.issues };
      const transaction = immutableSnapshot<PreparedBoardTransaction<D, M>>({ request, before, document: validated.document, inverseChanges: inverted.changes });
      requiresReload = Boolean(options.commit);
      const committed = options.commit ? await options.commit(transaction) : { status: 'applied' as const, document: transaction.document, revision: state.revision + 1 };
      requiresReload = false;
      if (committed.status !== 'applied') {
        requiresReload = committed.status === 'stale';
        return committed.status === 'failed' ? { ...committed, needsReload: false } : committed;
      }
      const confirmed = validate(committed.document);
      if (!confirmed.ok || !Number.isSafeInteger(committed.revision) || committed.revision !== request.expectedRevision + 1 || requestKey(confirmed.document) !== requestKey(transaction.document)) {
        requiresReload = true;
        return { status: 'failed', error: new Error('Commit returned an invalid document/revision; reload authoritative storage'), needsReload: true };
      }
      const result: BoardDispatchResult = Object.freeze({ status: 'applied', operationId: request.operationId, revision: committed.revision });
      receipts.set(request.operationId, { key, result });
      if (receipts.size > limit) receipts.delete(receipts.keys().next().value!);
      if (!state.disposed) {
        state = Object.freeze({ ...state, document: immutableSnapshot(confirmed.document), revision: committed.revision });
        try { options.onCommitted?.(transaction, committed.revision); } catch (error) { report(error); }
        if (!state.disposed) update({ ...state, busy: false });
      }
      return result;
    } catch (error) {
      return { status: 'failed', error, needsReload: requiresReload };
    } finally {
      if (!state.disposed && (state.busy || requiresReload)) update({ ...state, busy: false, needsReload: state.needsReload || requiresReload });
    }
  };
  return {
    extensions,
    getSnapshot: () => state,
    subscribe: (listener) => { if (state.disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispatch,
    dispose: () => { if (state.disposed) return; lifecycle.disposed = true; state = Object.freeze({ ...state, disposed: true, busy: false }); listeners.clear(); receipts.clear(); for (const error of extensions.dispose()) report(error); },
  };
}

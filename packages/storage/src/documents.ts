import { checkReceipt, insertImmutable, type AtomicBackend, type OperationReceipt, type TransactionStores } from './index.js';

export type AtomicDocumentRows = {
  projects: { readonly id: string; readonly revision: number; readonly updatedAt: number };
  branches: { readonly projectId: string; readonly id: string; readonly workingRevision: number; readonly workingSnapshotId: string };
  snapshots: { readonly projectId: string; readonly id: string };
  operations: OperationReceipt<unknown>;
};
export type PreparedDocumentWrite<Snapshot> = {
  readonly operationId: string; readonly projectId: string; readonly branchId: string;
  readonly expectedRevision: number; readonly requestHash: string; readonly snapshot: Snapshot;
};
export type AtomicDocumentOptions<Rows extends AtomicDocumentRows, Result> = {
  readonly backend: AtomicBackend<Rows>;
  readonly decodeReceipt: (result: unknown) => Result;
  readonly missing: (id: string) => Result;
  readonly stale: (expected: number, actual: number) => Result;
  readonly reused: (operationId: string) => Result;
  readonly applied: (value: { readonly operationId: string; readonly projectRevision: number; readonly branchRevision: number }) => Result;
  readonly failed: (error: unknown) => Result;
  readonly equalSnapshot: (left: Rows['snapshots'], right: Rows['snapshots']) => boolean;
  readonly snapshotCollision: () => Error;
  readonly now?: () => number;
  /** Read-only checks must finish before the first write. Await only scoped store operations. */
  readonly check?: (stores: TransactionStores<Rows>, prepared: PreparedDocumentWrite<Rows['snapshots']>, branch: Rows['branches'], project: Rows['projects']) => Promise<Result | null>;
  /** Required immutable metadata writes share document/receipt atomicity. Throw to roll everything back. */
  readonly participants?: readonly ((stores: TransactionStores<Rows>, prepared: PreparedDocumentWrite<Rows['snapshots']>) => Promise<void>)[];
};
declare const structuredClone: <T>(value: T) => T;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
/** Generic authored snapshot transaction. Domain validation and asynchronous hashing precede dispatch. */
export class AtomicDocumentCoordinator<Rows extends AtomicDocumentRows, Result> {
  constructor(private readonly options: AtomicDocumentOptions<Rows, Result>) {}
  async commit(input: PreparedDocumentWrite<Rows['snapshots']>): Promise<Result> {
    try {
      const prepared = freeze(structuredClone(input));
      if (!prepared.operationId || !prepared.projectId || !prepared.branchId || !prepared.requestHash || !Number.isSafeInteger(prepared.expectedRevision) || prepared.expectedRevision < 0 || prepared.snapshot.projectId !== prepared.projectId || !prepared.snapshot.id) throw new TypeError('Invalid prepared document transaction');
      return await this.options.backend.transaction(async stores => {
        const replay = await checkReceipt({ get: () => stores.operations.get([prepared.projectId, prepared.operationId]) }, prepared.projectId, prepared.operationId, prepared.requestHash);
        if (replay.kind === 'replay') return this.options.decodeReceipt(replay.result);
        if (replay.kind === 'reused') return this.options.reused(prepared.operationId);
        const branch = await stores.branches.get([prepared.projectId, prepared.branchId]);
        if (!branch) return this.options.missing(prepared.branchId);
        if (branch.workingRevision !== prepared.expectedRevision) return this.options.stale(prepared.expectedRevision, branch.workingRevision);
        const project = await stores.projects.get(prepared.projectId);
        if (!project) return this.options.missing(prepared.projectId);
        const rejected = await this.options.check?.(stores, prepared, branch, project);
        if (rejected != null) return rejected;
        await insertImmutable({ get: key => stores.snapshots.get(key), add: row => stores.snapshots.add([prepared.projectId, prepared.snapshot.id], row) }, prepared.snapshot, [prepared.projectId, prepared.snapshot.id], this.options.equalSnapshot, this.options.snapshotCollision);
        for (const participant of this.options.participants ?? []) await participant(stores, prepared);
        const branchRevision = branch.workingRevision + 1;
        const projectRevision = project.revision + 1;
        if (!Number.isSafeInteger(branchRevision) || !Number.isSafeInteger(projectRevision)) throw new RangeError('Authored revision limit reached');
        const now = (this.options.now ?? Date.now)();
        await stores.branches.put([prepared.projectId, prepared.branchId], { ...branch, workingRevision: branchRevision, workingSnapshotId: prepared.snapshot.id });
        await stores.projects.put(prepared.projectId, { ...project, revision: projectRevision, updatedAt: now });
        const result = this.options.applied({ operationId: prepared.operationId, projectRevision, branchRevision });
        await stores.operations.add([prepared.projectId, prepared.operationId], { projectId: prepared.projectId, id: prepared.operationId, requestHash: prepared.requestHash, result, createdAt: (this.options.now ?? Date.now)() });
        return result;
      });
    } catch (error) { return this.options.failed(error); }
  }
}

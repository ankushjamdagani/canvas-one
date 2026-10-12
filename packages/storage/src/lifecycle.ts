import { checkReceipt, type AtomicBackend, type OperationReceipt, type TransactionStores } from './index.js';
declare const structuredClone: <T>(value: T) => T;

export type LifecycleRows = {
  projects: { readonly id: string; readonly revision: number; readonly updatedAt: number };
  operations: OperationReceipt<unknown>;
};
export type LifecycleIdentity = { readonly projectId: string; readonly operationId: string; readonly requestHash: string };
export type LifecycleOptions<Rows extends LifecycleRows, Result> = {
  readonly backend: AtomicBackend<Rows>;
  readonly missing: (id: string) => Result;
  readonly stale: (expected: number, actual: number) => Result;
  readonly reused: (operationId: string) => Result;
  readonly decodeReceipt: (value: unknown) => Result;
  readonly failed: (error: unknown) => Result;
  readonly now?: () => number;
};
/** Project authority, CAS and immutable receipts, with injected domain policies. */
export class ProjectLifecycleCoordinator<Rows extends LifecycleRows, Result> {
  constructor(private readonly options: LifecycleOptions<Rows, Result>) {}
  private async write(identity: LifecycleIdentity, body: (stores: TransactionStores<Rows>) => Promise<Result>): Promise<Result> {
    const scope = { ...identity };
    try {
      return await this.options.backend.transaction(async stores => {
        const receipt = await checkReceipt({ get: () => stores.operations.get([scope.projectId, scope.operationId]) }, scope.projectId, scope.operationId, scope.requestHash);
        if (receipt.kind === 'replay') return this.options.decodeReceipt(receipt.result);
        if (receipt.kind === 'reused') return this.options.reused(scope.operationId);
        return body(stores);
      });
    } catch (error) { return this.options.failed(error); }
  }
  private async receipt(stores: TransactionStores<Rows>, identity: LifecycleIdentity, result: Result): Promise<void> {
    await stores.operations.add([identity.projectId, identity.operationId], { projectId: identity.projectId, id: identity.operationId, requestHash: identity.requestHash, result, createdAt: (this.options.now ?? Date.now)() });
  }
  create(identity: LifecycleIdentity, project: Rows['projects'], policy: {
    readonly exists: () => Result;
    readonly check: (stores: TransactionStores<Rows>) => Promise<Result | null>;
    readonly initialize: (stores: TransactionStores<Rows>) => Promise<void>;
    readonly result: Result;
  }): Promise<Result> {
    identity = { ...identity };
    project = structuredClone(project);
    return this.write(identity, async stores => {
      if (await stores.projects.get(identity.projectId)) return policy.exists();
      const rejected = await policy.check(stores);
      if (rejected != null) return rejected;
      await policy.initialize(stores);
      await stores.projects.add(identity.projectId, project);
      await this.receipt(stores, identity, policy.result);
      return policy.result;
    });
  }
  update(identity: LifecycleIdentity, expectedRevision: number, prepare: (stores: TransactionStores<Rows>, project: Rows['projects'], nextRevision: number, now: number) => Promise<
    { readonly rejected: Result } | { readonly project: Rows['projects']; readonly result: Result; readonly apply?: () => Promise<void> }
  >): Promise<Result> {
    identity = { ...identity };
    return this.write(identity, async stores => {
      const project = await stores.projects.get(identity.projectId);
      if (!project) return this.options.missing(identity.projectId);
      if (project.revision !== expectedRevision) return this.options.stale(expectedRevision, project.revision);
      const next = project.revision + 1;
      if (!Number.isSafeInteger(next)) throw new RangeError('Project revision limit reached');
      const prepared = await prepare(stores, project, next, (this.options.now ?? Date.now)());
      if ('rejected' in prepared) return prepared.rejected;
      if (prepared.project.id !== project.id || prepared.project.revision !== next) throw new TypeError('Invalid prepared project update');
      await prepared.apply?.();
      await stores.projects.put(identity.projectId, prepared.project);
      await this.receipt(stores, identity, prepared.result);
      return prepared.result;
    });
  }
  async delete(projectId: string, policy: {
    readonly protect: (stores: TransactionStores<Rows>, project: Rows['projects']) => Promise<Result | null>;
    readonly cleanup: (stores: TransactionStores<Rows>, project: Rows['projects']) => Promise<void>;
    readonly applied: () => Result;
  }): Promise<Result> {
    try {
      return await this.options.backend.transaction(async stores => {
        const project = await stores.projects.get(projectId);
        if (!project) return this.options.missing(projectId);
        const rejected = await policy.protect(stores, project);
        if (rejected != null) return rejected;
        await stores.projects.delete(projectId);
        await policy.cleanup(stores, project);
        return policy.applied();
      });
    } catch (error) { return this.options.failed(error); }
  }
}

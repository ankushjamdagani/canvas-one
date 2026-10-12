import { checkReceipt, type AtomicBackend, type TransactionStores } from './index.js';
import { insertImmutableRecords, type ImmutableRecordPolicy } from './artifacts.js';
import type { LifecycleIdentity, LifecycleRows } from './lifecycle.js';
declare const structuredClone: <T>(value: T) => T;

export type OperationWrite<Rows> = { [Name in keyof Rows]: {
  readonly store: Name; readonly key: import('./index.js').StorageKey;
  readonly row: Rows[Name]; readonly kind: 'immutable' | 'add' | 'put' | 'update';
} }[keyof Rows];
export type PreparedOperation<Rows, Result> = { readonly writes: readonly OperationWrite<Rows>[]; readonly result: Result };
/** Plans read current rows through scoped ports; storage alone applies writes and immutable receipts. */
export class AtomicOperationCoordinator<Rows extends LifecycleRows, Result> {
  constructor(private readonly options: {
    readonly backend: AtomicBackend<Rows>; readonly policy: ImmutableRecordPolicy<Rows>;
    readonly decodeReceipt: (value: unknown) => Result; readonly reused: (id: string) => Result;
    readonly failed: (error: unknown) => Result; readonly now?: () => number;
  }) {}
  async execute(identity: LifecycleIdentity, prepare: (stores: TransactionStores<Rows>) => Promise<PreparedOperation<Rows, Result> | Result>): Promise<Result> {
    const scope = { ...identity };
    try {
      return await this.options.backend.transaction(async stores => {
        const receipt = await checkReceipt({ get: () => stores.operations.get([scope.projectId, scope.operationId]) }, scope.projectId, scope.operationId, scope.requestHash);
        if (receipt.kind === 'replay') return this.options.decodeReceipt(receipt.result);
        if (receipt.kind === 'reused') return this.options.reused(scope.operationId);
        const prepared = await prepare(stores);
        if (!prepared || typeof prepared !== 'object' || !('writes' in prepared)) return prepared as Result;
        const writes = structuredClone(prepared.writes);
        for (const write of writes) {
          if (write.kind === 'immutable') await insertImmutableRecords(stores, [write], this.options.policy);
          else await stores[write.store][write.kind](write.key, write.row);
        }
        await stores.operations.add([scope.projectId, scope.operationId], {
          projectId: scope.projectId, id: scope.operationId, requestHash: scope.requestHash,
          result: prepared.result, createdAt: (this.options.now ?? Date.now)(),
        });
        return prepared.result;
      });
    } catch (error) { return this.options.failed(error); }
  }
}

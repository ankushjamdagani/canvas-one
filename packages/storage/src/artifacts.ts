import { insertImmutable, type AtomicBackend, type StorageKey, type TransactionStores } from './index.js';
declare const structuredClone: <T>(value: T) => T;

export type ImmutableRecord<Rows> = { [Name in keyof Rows]: {
  readonly store: Name; readonly key: StorageKey; readonly row: Rows[Name];
} }[keyof Rows];
export type ImmutableRecordPolicy<Rows> = {
  readonly equal: (store: keyof Rows, left: Rows[keyof Rows], right: Rows[keyof Rows]) => boolean;
  readonly collision: (store: keyof Rows, key: StorageKey) => Error;
};
/** Insert heterogeneous immutable rows within the caller's existing transaction. */
export async function insertImmutableRecords<Rows>(stores: TransactionStores<Rows>, records: readonly ImmutableRecord<Rows>[], policy: ImmutableRecordPolicy<Rows>): Promise<void> {
  for (const record of records) {
    const store = stores[record.store];
    await insertImmutable({ get: () => store.get(record.key), add: row => store.add(record.key, row) }, record.row, record.key,
      (left, right) => policy.equal(record.store, left, right), () => policy.collision(record.store, record.key));
  }
}
/** Storage-only artifact transaction; provenance and executable semantics belong to the host. */
export class ImmutableArtifactCoordinator<Rows, Result> {
  constructor(private readonly options: {
    readonly backend: AtomicBackend<Rows>; readonly policy: ImmutableRecordPolicy<Rows>;
    readonly failed: (error: unknown) => Result;
  }) {}
  async save(records: readonly ImmutableRecord<Rows>[], applied: () => Result): Promise<Result> {
    try {
      const prepared = structuredClone(records);
      return await this.options.backend.transaction(async stores => {
        await insertImmutableRecords(stores, prepared, this.options.policy);
        return applied();
      });
    } catch (error) { return this.options.failed(error); }
  }
}

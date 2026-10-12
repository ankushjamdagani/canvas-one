import { Dexie, type Table, type IndexableType } from 'dexie';
import { validateScanLimit, type AtomicBackend, type TransactionStores, type StorageIndexes, type StorageKey, type StoragePage } from '@canvas-one/storage';

export type RowBindings = Record<string, { row: unknown; key: unknown }>;
export type BoundTables<Bindings extends RowBindings> = {
  [Name in keyof Bindings]: Table<Bindings[Name]['row'], Bindings[Name]['key']>;
};
/** Existing repositories retain native Dexie transactions while supplying their row contracts. */
export class IndexedDbDatabase<Bindings extends RowBindings> extends Dexie {
  constructor(name: string, version: number, stores: Record<keyof Bindings & string, string>) {
    super(name);
    this.version(version).stores(stores);
  }
}

/** Out-of-line-key stores implementing the same atomic port as MemoryBackend. */
export class IndexedDbBackend<Rows> implements AtomicBackend<Rows> {
  readonly database: Dexie;
  constructor(name: string | Dexie, private readonly names: readonly (keyof Rows & string)[], private readonly indexes: StorageIndexes<Rows> = {}) {
    this.database = typeof name === 'string' ? new Dexie(name) : name;
    if (typeof name === 'string') this.database.version(1).stores(Object.fromEntries(names.map(name => [name, ['', ...(indexes[name] ?? []).map(index => typeof index.keyPath === 'string' ? index.keyPath : `[${index.keyPath.join('+')}]`)].join(',')])));
  }
  transaction<Result>(body: (stores: TransactionStores<Rows>) => Promise<Result>): Promise<Result> {
    const tables = this.names.map(name => this.boundTable(name));
    return this.database.transaction('rw', tables, async () => {
      const stores = {} as TransactionStores<Rows>;
      let active = true;
      const ensureActive = () => { if (!active) throw new Error('Transaction is closed'); };
      for (const name of this.names) {
        const table = this.boundTable(name);
        const write = async (key: import('@canvas-one/storage').StorageKey, row: Rows[typeof name], mode: 'put' | 'add') => {
          ensureActive();
          const path = table.schema.primKey.keyPath;
          if (path) {
            const valueAt = (keyPath: string) => keyPath.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, row);
            const actual = typeof path === 'string' ? valueAt(path) : path.map(valueAt);
            if (JSON.stringify(actual) !== JSON.stringify(key)) throw new TypeError('Inline row key does not match supplied storage key');
            await table[mode](row);
          } else await table[mode](row, key as IndexableType);
        };
        stores[name] = {
          get: key => { ensureActive(); return table.get(key as IndexableType); },
          put: (key, row) => write(key, row, 'put'),
          update: async (key, changes) => { ensureActive(); await table.update(key as IndexableType, changes as never); },
          add: (key, row) => write(key, row, 'add'),
          delete: async key => { ensureActive(); await table.delete(key as IndexableType); },
          scan: async options => {
            ensureActive(); validateScanLimit(options.limit);
            const collection = options.after === undefined ? table.toCollection() : table.where(':id').above(options.after as IndexableType);
            const bounded = collection.limit(options.limit + 1);
            // Both bulk reads share this transaction and ordering, including out-of-line keys.
            const [rows, keys] = await Promise.all([bounded.toArray(), bounded.primaryKeys()]);
            const entries = rows.map((row, index) => ({key: keys[index] as StorageKey, row}));
            return { entries: entries.slice(0, options.limit), truncated: entries.length > options.limit };
          },
          query: async (index, equals, limit) => {
            ensureActive(); validateScanLimit(limit);
            const definition = this.indexes[name]?.find(value => value.name === index);
            if (!definition) throw new Error(`Unknown storage index ${index}`);
            const nativeIndex = typeof definition.keyPath === 'string' ? definition.keyPath : `[${definition.keyPath.join('+')}]`;
            const entries: StoragePage<Rows[typeof name]>['entries'][number][] = [];
            await table.where(nativeIndex).equals(equals as IndexableType).limit(limit + 1).each((row, cursor) => { entries.push({ key: cursor.primaryKey as StorageKey, row }); });
            return { entries: entries.slice(0, limit), truncated: entries.length > limit };
          },
          queryRange: async (index, lower, upper, limit) => {
            ensureActive(); validateScanLimit(limit);
            const definition = this.indexes[name]?.find(value => value.name === index);
            if (!definition) throw new Error(`Unknown storage index ${index}`);
            const nativeIndex = typeof definition.keyPath === 'string' ? definition.keyPath : `[${definition.keyPath.join('+')}]`;
            const entries: StoragePage<Rows[typeof name]>['entries'][number][] = [];
            await table.where(nativeIndex).between(lower as IndexableType, upper as IndexableType, true, true).limit(limit + 1).each((row, cursor) => { entries.push({ key: cursor.primaryKey as StorageKey, row }); });
            return { entries: entries.slice(0, limit), truncated: entries.length > limit };
          },
        };
      }
      try { return await body(stores); } finally { active = false; }
    });
  }
  private boundTable<Name extends keyof Rows & string>(name: Name): Table<Rows[Name]> {
    const bound = (this.database as unknown as Record<string, unknown>)[name];
    // Reuse consumer-bound tables, including their middleware/test instrumentation.
    if (bound && typeof bound === 'object' && (bound as { name?: unknown }).name === name && typeof (bound as { get?: unknown }).get === 'function') return bound as Table<Rows[Name]>;
    return this.database.table<Rows[Name]>(name);
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return error instanceof Dexie.QuotaExceededError || (error as { name?: string }).name === 'QuotaExceededError';
}
export function isUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return error instanceof Dexie.DatabaseClosedError || error instanceof Dexie.OpenFailedError
    || ['DatabaseClosedError', 'BlockedError', 'OpenFailedError', 'InvalidStateError', 'VersionError'].includes((error as { name?: string }).name ?? '');
}

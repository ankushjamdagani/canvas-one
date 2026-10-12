/** Minimal row port usable within an existing atomic backend transaction. */
export interface ImmutableTable<Row, Key> {
  get(key: Key): Promise<Row | undefined>;
  add(row: Row): Promise<unknown>;
}

/** Equality and collision reporting belong to the consumer's codec/error policy. */
export async function insertImmutable<Row, Key>(
  table: ImmutableTable<Row, Key>, row: Row, key: Key,
  equal: (left: Row, right: Row) => boolean,
  collision: () => Error,
): Promise<void> {
  const existing = await table.get(key);
  if (existing !== undefined) {
    if (equal(existing, row)) return;
    throw collision();
  }
  try { await table.add(row); }
  catch (error) {
    if (error && typeof error === 'object' && (error as { name?: string }).name === 'ConstraintError') {
      const concurrent = await table.get(key);
      if (concurrent !== undefined && equal(concurrent, row)) return;
      throw collision();
    }
    throw error;
  }
}

export type OperationReceipt<Result> = {
  readonly projectId: string;
  readonly id: string;
  readonly requestHash: string;
  readonly result: Result;
  readonly createdAt: number;
};
export type ReceiptReplay<Result> =
  | { readonly kind: 'new' }
  | { readonly kind: 'replay'; readonly result: Result }
  | { readonly kind: 'reused' };
export async function checkReceipt<Result>(
  table: Pick<ImmutableTable<OperationReceipt<Result>, readonly [string, string]>, 'get'>,
  projectId: string, operationId: string, requestHash: string,
): Promise<ReceiptReplay<Result>> {
  const existing = await table.get([projectId, operationId]);
  return existing === undefined ? { kind: 'new' }
    : existing.requestHash === requestHash ? { kind: 'replay', result: existing.result }
    : { kind: 'reused' };
}

export type StorageKey = string | number | readonly (string | number)[];
export type StorageEntry<Row> = { readonly key: StorageKey; readonly row: Row };
export type StoragePage<Row> = { readonly entries: readonly StorageEntry<Row>[]; readonly truncated: boolean };
export type StorageScan = { readonly limit: number; readonly after?: StorageKey };
export type StorageIndex = { readonly name: string; readonly keyPath: string | readonly string[] };
export type StorageIndexes<Rows> = Partial<Record<keyof Rows, readonly StorageIndex[]>>;
export function compareStorageKeys(a: StorageKey, b: StorageKey): number {
  const rank = (value: StorageKey) => typeof value === 'number' ? 0 : typeof value === 'string' ? 1 : 2;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const result = compareStorageKeys(a[i]!, b[i]!); if (result) return result; }
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
export function validateScanLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new RangeError('Scan limit must be between 1 and 10000');
}
export interface TransactionStore<Row> {
  update(key: StorageKey, changes: Partial<Row>): Promise<void>;
  queryRange(index: string, lower: StorageKey, upper: StorageKey, limit: number): Promise<StoragePage<Row>>;
  get(key: StorageKey): Promise<Row | undefined>;
  put(key: StorageKey, row: Row): Promise<void>;
  add(key: StorageKey, row: Row): Promise<void>;
  delete(key: StorageKey): Promise<void>;
  scan(options: StorageScan): Promise<StoragePage<Row>>;
  query(index: string, equals: StorageKey, limit: number): Promise<StoragePage<Row>>;
}
export type TransactionStores<Rows> = { [K in keyof Rows]: TransactionStore<Rows[K]> };
export interface AtomicBackend<Rows> {
  /** Await only scoped store operations; prepare hashes/network/worker results before entry. */
  transaction<Result>(body: (stores: TransactionStores<Rows>) => Promise<Result>): Promise<Result>;
}
export {collectProjectRows} from './project-rows.js';
declare const structuredClone: <T>(value: T) => T;
/** Serialized transactions with copy-on-write rollback and isolated reads. */
export class MemoryBackend<Rows> implements AtomicBackend<Rows> {
  private data = new Map<keyof Rows, Map<string, unknown>>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly names: readonly (keyof Rows)[], private readonly indexes: StorageIndexes<Rows> = {}) {}
  transaction<Result>(body: (stores: TransactionStores<Rows>) => Promise<Result>): Promise<Result> {
    const run = this.queue.then(async () => {
      const next = structuredClone(this.data);
      let active = true;
      const stores = {} as TransactionStores<Rows>;
      for (const name of this.names) {
        const rows = next.get(name) ?? new Map<string, unknown>();
        next.set(name, rows);
        const ensureActive = () => { if (!active) throw new Error('Transaction is closed'); };
        const page = (options: StorageScan, match: (row: unknown) => boolean = () => true): StoragePage<Rows[typeof name]> => {
          ensureActive(); validateScanLimit(options.limit);
          const entries = [...rows].map(([key, row]) => ({ key: JSON.parse(key) as StorageKey, row }))
            .filter(entry => (options.after === undefined || compareStorageKeys(entry.key, options.after) > 0) && match(entry.row))
            .sort((a, b) => compareStorageKeys(a.key, b.key));
          return structuredClone({ entries: entries.slice(0, options.limit), truncated: entries.length > options.limit }) as StoragePage<Rows[typeof name]>;
        };
        stores[name] = {
          get: async key => { ensureActive(); return structuredClone(rows.get(JSON.stringify(key))) as Rows[typeof name] | undefined; },
          put: async (key, row) => { ensureActive(); rows.set(JSON.stringify(key), structuredClone(row)); },
          update: async (key, changes) => {
            ensureActive(); const encoded = JSON.stringify(key); const row = rows.get(encoded);
            if (row !== undefined) rows.set(encoded, structuredClone({ ...(row as object), ...changes }));
          },
          add: async (key, row) => {
            ensureActive();
            const encoded = JSON.stringify(key);
            if (rows.has(encoded)) { const error = new Error('Duplicate key'); error.name = 'ConstraintError'; throw error; }
            rows.set(encoded, structuredClone(row));
          },
          delete: async key => { ensureActive(); rows.delete(JSON.stringify(key)); },
          scan: async options => page(options),
          query: async (index, equals, limit) => {
            const definition = this.indexes[name]?.find(value => value.name === index);
            if (!definition) throw new Error(`Unknown storage index ${index}`);
            const valueAt = (row: unknown, path: string) => path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, row);
            return page({ limit }, row => JSON.stringify(typeof definition.keyPath === 'string' ? valueAt(row, definition.keyPath) : definition.keyPath.map(path => valueAt(row, path))) === JSON.stringify(equals));
          },
          queryRange: async (index, lower, upper, limit) => {
            const definition = this.indexes[name]?.find(value => value.name === index);
            if (!definition) throw new Error(`Unknown storage index ${index}`);
            const valueAt = (row: unknown, path: string) => path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, row);
            return page({ limit }, row => {
              const key = (typeof definition.keyPath === 'string' ? valueAt(row, definition.keyPath) : definition.keyPath.map(path => valueAt(row, path))) as StorageKey;
              if (typeof key !== 'string' && typeof key !== 'number' && !Array.isArray(key)) return false;
              if (Array.isArray(key) && key.some(value => typeof value !== 'string' && typeof value !== 'number')) return false;
              return compareStorageKeys(key, lower) >= 0 && compareStorageKeys(key, upper) <= 0;
            });
          },
        };
      }
      try { const result = await body(stores); this.data = next; return result; }
      finally { active = false; }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
export * from './catalog.js';
export * from './documents.js';
export * from './preferences.js';
export * from './errors.js';
export * from './recovery.js';
export * from './lifecycle.js';
export * from './artifacts.js';
export * from './pruning.js';
export * from './operations.js';
export * from './accounting.js';
export * from './archives.js';

/** Drain an equality index in bounded pages without accumulating all matching rows. */
export async function deleteIndexMatches(store: {
  query(index: string, equals: StorageKey, limit: number): Promise<{ readonly entries: readonly { readonly key: StorageKey }[]; readonly truncated: boolean }>;
  delete(key: StorageKey): Promise<void>;
}, index: string, equals: StorageKey, pageSize = 1000): Promise<void> {
  for (;;) {
    const page = await store.query(index, equals, pageSize);
    for (const entry of page.entries) await store.delete(entry.key);
    if (!page.truncated) return;
  }
}

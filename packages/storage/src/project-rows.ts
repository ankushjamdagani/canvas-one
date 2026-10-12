import type {StorageKey, TransactionStore} from './index.js';

/** Read composite-key project rows in bounded primary-key pages within the caller's transaction. */
export async function collectProjectRows<Row extends {readonly projectId: string}>(
  store: Pick<TransactionStore<Row>, 'scan'>, projectId: string, pageSize = 1000,
): Promise<readonly Row[]> {
  const rows: Row[] = [];
  let after: StorageKey = [projectId, ''];
  for (;;) {
    const page = await store.scan({limit: pageSize, after});
    for (const entry of page.entries) {
      if (!Array.isArray(entry.key) || entry.key[0] !== projectId) return rows;
      if (entry.row.projectId !== projectId) throw new Error('Project row namespace does not match its primary key');
      rows.push(entry.row);
    }
    if (!page.truncated || !page.entries.length) return rows;
    after = page.entries[page.entries.length - 1]!.key;
  }
}

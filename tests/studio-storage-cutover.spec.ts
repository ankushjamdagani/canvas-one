import { test, expect, type Page } from '@playwright/test';

/**
 * RV-13 storage cutover (D19, verification.md "Storage cutover: old DB untouched").
 * The retired app stored projects in the Dexie database `system-studio`
 * (`db.version(1)`, native IndexedDB version 10, one `projects` store). The new app
 * boots on `system-studio-local-v1` and must neither read, list, migrate, upgrade nor
 * delete the old database.
 */

const LEGACY_DB = 'system-studio';
const LEGACY_RECORD = {
  id: 'legacy-project-1',
  name: 'Legacy checkout project',
  updatedAt: 1757000000000,
  graph: { nodes: [{ id: 'n1', kind: 'service' }], edges: [] },
};

async function seedLegacyDatabase(page: Page) {
  await page.evaluate(
    ({ name, record }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 10);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('projects', { keyPath: 'id' });
          store.createIndex('name', 'name');
          store.createIndex('updatedAt', 'updatedAt');
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('projects', 'readwrite');
          tx.objectStore('projects').put(record);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { name: LEGACY_DB, record: LEGACY_RECORD },
  );
}

async function readLegacyDatabase(page: Page) {
  return page.evaluate(
    (name) =>
      new Promise<{ version: number; stores: string[]; records: unknown[] }>((resolve, reject) => {
        // No version argument: opening must not trigger an upgrade from this test either.
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const stores = [...db.objectStoreNames];
          const getAll = db.transaction('projects', 'readonly').objectStore('projects').getAll();
          getAll.onsuccess = () => {
            const result = { version: db.version, stores, records: getAll.result };
            db.close();
            resolve(result);
          };
          getAll.onerror = () => reject(getAll.error);
        };
      }),
    LEGACY_DB,
  );
}

test('the retired app database stays untouched while the new app creates and saves a project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await seedLegacyDatabase(page);

  await page.reload();
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  // Old projects are never listed or migrated (D19).
  await expect(page.getByTestId('no-projects-notice')).toBeVisible();
  await expect(page.getByText(LEGACY_RECORD.name)).toHaveCount(0);

  await page.getByTestId('create-example-s01').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');

  const names = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
  expect(names).toEqual(['system-studio', 'system-studio-local-v1']);

  expect(await readLegacyDatabase(page)).toEqual({ version: 10, stores: ['projects'], records: [LEGACY_RECORD] });
});

import { test, expect, type Page } from './fixtures';

async function activeRecording(page: Page) {
  await page.goto('/projects');
  await page.getByTestId('create-example-s06').click();
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
}

async function requestSwitch(page: Page) {
  await page.getByRole('button', { name: 'Select scenario', exact: true }).click();
  await page.getByRole('button', { name: /^Flash sale/ }).click();
  await expect(page.getByRole('heading', { name: 'Switch to Flash sale?' })).toBeVisible();
}

async function savedRuns(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('system-studio-local-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('runs', 'readonly').objectStore('runs').count();
      count.onerror = () => { db.close(); reject(count.error); };
      count.onsuccess = () => { db.close(); resolve(count.result); };
    };
  }));
}

test('source switch Cancel preserves current recording; Discard switches without saving', async ({ page }) => {
  await activeRecording(page);
  await requestSwitch(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select scenario', exact: true })).toContainText('Steady traffic');
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
  await requestSwitch(page);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select scenario', exact: true })).toContainText('Flash sale');
  await expect(page.getByTestId('playback-status')).toHaveText(/ready/i);
  expect(await savedRuns(page)).toBe(0);
});

test('source switch Save drains active recording and persists before switching', async ({ page }) => {
  await activeRecording(page);
  await requestSwitch(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select scenario', exact: true })).toContainText('Flash sale', { timeout: 20000 });
  expect(await savedRuns(page)).toBe(1);
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select scenario', exact: true }).click();
  await page.getByRole('button', { name: /^Steady traffic/ }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  expect(await savedRuns(page)).toBe(1);
});

test('source switch save failure leaves scenario and recording intact until retry succeeds', async ({ page }) => {
  await activeRecording(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    const taskWindow = window as unknown as { restoreSimulationRunSave: () => void };
    taskWindow.restoreSimulationRunSave = () => { IDBObjectStore.prototype.add = original; };
    IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
      if (this.name === 'runs') throw new DOMException('Acceptance save failure', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  await requestSwitch(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be saved', { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Select scenario', exact: true })).toContainText('Steady traffic');
  expect(await savedRuns(page)).toBe(0);
  await page.evaluate(() => (window as unknown as { restoreSimulationRunSave: () => void }).restoreSimulationRunSave());
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select scenario', exact: true })).toContainText('Flash sale', { timeout: 20000 });
  expect(await savedRuns(page)).toBe(1);
});

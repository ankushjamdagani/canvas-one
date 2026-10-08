import { test, expect } from './fixtures';

test('create a branch from saved work and reopen a closed draft', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('blank-project-name-input').fill('Branch controls');
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('Saved');

  await page.getByTestId('breadcrumb-branch-btn').click();
  await page.getByTestId('branch-create-open').click();
  await page.getByTestId('branch-create-label').fill('Cache experiment');
  await page.getByTestId('branch-create-submit').click();
  await expect(page.getByTestId('breadcrumb-branch-btn')).toContainText('Cache experiment');
  await expect(page.getByTestId('branch-popover')).toHaveCount(0);

  const closedBranchId = await page.evaluate(async () => {
    const request = indexedDB.open('system-studio-local-v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const branchId = await new Promise<string>((resolve, reject) => {
      const transaction = database.transaction('branches', 'readwrite');
      const store = transaction.objectStore('branches');
      const cursorRequest = store.openCursor();
      let createdBranchId: string | null = null;
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          if (createdBranchId === null) reject(new Error('Created branch was not found'));
          return;
        }
        const branch = cursor.value as { label: string; id: string; state: string };
        if (branch.label === 'Cache experiment') {
          cursor.update({ ...branch, state: 'closed' });
          createdBranchId = branch.id;
          return;
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        if (createdBranchId !== null) resolve(createdBranchId);
      };
    });
    return branchId;
  });

  // Switching away and back causes the workspace to reread branch metadata,
  // just as it does after a real publish updates the branch row.
  await page.getByTestId('breadcrumb-branch-btn').click();
  await page.locator('button[data-testid^="branch-switch-"]').filter({ hasText: 'main' }).click();
  await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('Main');
  await page.getByTestId('breadcrumb-branch-btn').click();
  const closedRow = page.getByTestId(`branch-switch-${closedBranchId}`).locator('..');
  await expect(closedRow.getByRole('button', { name: 'Reopen and switch to Cache experiment' })).toBeVisible();
  await closedRow.getByRole('button', { name: 'Reopen and switch to Cache experiment' }).click();

  await expect(page.getByTestId('breadcrumb-branch-btn')).toContainText('Cache experiment');
  await expect(page.getByTestId('branch-popover')).toHaveCount(0);
  await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('Draft');
});

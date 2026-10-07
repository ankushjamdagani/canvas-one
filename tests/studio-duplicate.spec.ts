import { expect, test, type Page } from './fixtures';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

test.describe('Studio selection duplicate (RV-09a)', () => {
  test('duplicates two connected S05 nodes with one undo step', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const nodes = page.locator('.component-node');
    const initialCount = await nodes.count();
    const originalIds = new Set(
      (await nodes.evaluateAll((entries) => entries.map((entry) => entry.getAttribute('data-element-id'))))
        .filter((id): id is string => id !== null),
    );

    const orderEntry = nodes.filter({ hasText: 'Order entry' });
    const validateOrder = nodes.filter({ hasText: 'Validate order' });
    await orderEntry.click();
    await validateOrder.click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-count')).toHaveText('2 PARTS');

    await page.getByTestId('selection-duplicate-btn').click();
    const confirmation = page.getByTestId('duplicate-confirm-dialog');
    const confirmationShown = await confirmation
      .waitFor({ state: 'visible', timeout: 1_000 })
      .then(() => true)
      .catch(() => false);
    if (confirmationShown) {
      await page.getByTestId('duplicate-confirm-btn').click();
    }
    await waitForIdle(page);
    await expect(nodes).toHaveCount(initialCount + 2);

    const copiedLabels = await nodes.evaluateAll((entries, knownIds) =>
      entries
        .filter((entry) => {
          const id = entry.getAttribute('data-element-id');
          return id !== null && !(knownIds as string[]).includes(id);
        })
        .map((entry) => entry.querySelector('strong')?.textContent?.trim() ?? '')
        .sort(),
      Array.from(originalIds),
    );
    expect(copiedLabels).toEqual(['Order entry', 'Validate order']);

    await page.keyboard.press('ControlOrMeta+z');
    await waitForIdle(page);
    await expect(nodes).toHaveCount(initialCount);
  });
});

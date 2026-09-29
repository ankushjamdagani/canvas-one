import { expect, test, type Page } from '@playwright/test';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

test.describe('Studio canvas collapse and expand (RV-04g)', () => {
  test('collapses a group, undoes, redoes and persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const nodes = page.locator('.component-node');
    const total = await nodes.count();
    await nodes.nth(0).click();
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await page.getByTestId('selection-group-btn').click();
    const groupInput = page.getByTestId('selection-group-input');
    await groupInput.fill('Entry pair');
    await groupInput.press('Enter');
    await waitForIdle(page);
    const boundary = page.locator('.group-boundary', { hasText: 'Entry pair' });
    await expect(boundary).toBeVisible();

    // Boundary header toggle collapses the group (fit first: the header sits above the members).
    await page.getByTestId('dock-fit-view-btn').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Collapse group Entry pair' }).click();
    await waitForIdle(page);
    await expect(nodes).toHaveCount(total - 2);
    await expect(boundary).toHaveAttribute('data-collapsed', 'true');
    await expect(boundary).toContainText('2 parts');

    // Undo restores the expanded boundary and member nodes; redo collapses again.
    await page.keyboard.press('ControlOrMeta+z');
    await waitForIdle(page);
    await expect(nodes).toHaveCount(total);
    await expect(boundary).not.toHaveAttribute('data-collapsed', 'true');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await waitForIdle(page);
    await expect(nodes).toHaveCount(total - 2);

    // Persisted state survives a reload.
    await page.reload();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await page
      .getByTestId('existing-projects-list')
      .locator('[data-testid^="project-item-"]')
      .first()
      .getByRole('button', { name: 'Open draft' })
      .click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.locator('.component-node')).toHaveCount(total - 2);
    const reloaded = page.locator('.group-boundary', { hasText: 'Entry pair' });
    await expect(reloaded).toHaveAttribute('data-collapsed', 'true');

    // Expand again from the boundary toggle.
    await page.getByTestId('dock-fit-view-btn').click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Expand group Entry pair' }).click();
    await waitForIdle(page);
    await expect(page.locator('.component-node')).toHaveCount(total);
  });

  test('toggles a single component from the selection toolbar', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const node = page.locator('.component-node').first();
    const ports = node.locator('[data-testid^="node-ports-"]');
    await node.click();
    await expect(ports).toHaveCount(0);
    await page.getByTestId('selection-expansion-btn').click();
    await waitForIdle(page);
    await expect(ports).toHaveCount(1);
    await expect(page.getByTestId('selection-expansion-btn')).toHaveText(/Collapse/);
    await page.getByTestId('selection-expansion-btn').click();
    await waitForIdle(page);
    await expect(ports).toHaveCount(0);
  });
});

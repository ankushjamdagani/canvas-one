import { expect, test, type Page } from '@playwright/test';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

test('a project can be linked into another as a read-only node that shows live details and opens it', async ({ page }) => {
  // Target project with a team and description.
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Blank project name' }).fill('Orders system');
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await page.getByTestId('breadcrumb-project-btn').click();
  await page.getByTestId('project-menu-settings').click();
  await page.getByTestId('project-team-input').fill('Orders team');
  await page.getByTestId('project-description-input').fill('Takes and fulfils customer orders');
  await page.getByTestId('project-details-save').click();
  await expect(page.getByTestId('project-details-dialog')).toBeHidden();
  await waitForIdle(page);
  await page.getByTestId('breadcrumb-project-btn').click();
  await expect(page.getByTestId('project-menu-popover')).toContainText('Orders team');
  await page.keyboard.press('Escape');

  // Link it from another project through the Library's Projects tab.
  await page.goto('/');
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
  await page.getByTestId('dock-component-btn').click();
  await page.getByTestId('library-picker-full-library-btn').click();
  await page.getByTestId('library-tab-projects').click();
  const row = page.getByTestId('library-linked-projects').locator('li', { hasText: 'Orders system' });
  await expect(row).toContainText('Orders team');
  await row.getByRole('button', { name: 'Link Orders system' }).click();
  await waitForIdle(page);

  const node = page.locator('.component-node', { hasText: 'Orders system' });
  await expect(node).toBeVisible();
  await expect(node.getByTestId(/node-linked-badge-/)).toHaveText('Linked');
  await expect(node.getByTestId(/node-linked-details-/)).toContainText('Orders team');
  await expect(node.getByTestId(/node-linked-details-/)).toContainText('Takes and fulfils customer orders');

  // Inspector is read-only for the linked node.
  await node.click();
  await expect(page.getByTestId('inspector-kind-tag')).toHaveText('LINKED PROJECT');
  await expect(page.getByTestId('inspector-panel').locator('input, textarea')).toHaveCount(0);

  // Open navigates to the linked project.
  await node.getByTestId(/node-linked-open-/).click();
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByTestId('breadcrumb-project-btn')).toContainText('Orders system');
});

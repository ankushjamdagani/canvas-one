import { test, expect } from './fixtures';
import { runAll, savedRunCount, noOverflow } from './simulation-support';

test('S01 source popover selects scenarios; Run and existing Run all save real results', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s01').click();
  const trigger = page.getByTestId('scenario-switcher-trigger');
  await trigger.click();
  const menu = page.getByTestId('scenario-switcher-popover');
  await expect(menu.locator('[data-testid^="scenario-row-"]')).toHaveCount(3);
  await expect(menu.getByRole('button', { name: 'New scenario', exact: true })).toBeVisible();
  await expect(menu.locator('[data-selected="true"]').getByRole('button', { name: /^Edit scenario/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('scenario-run-btn').click();
  await expect.poll(() => savedRunCount(page)).toBe(1);
  await runAll(page);
  await expect.poll(() => savedRunCount(page), { timeout: 30000 }).toBe(4);
  const node = page.locator('.component-node').first();
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 70, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  expect(await savedRunCount(page)).toBe(4);
});

test('S04 existing Run all saves every scenario without restoring legacy results UI', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await runAll(page);
  await expect.poll(() => savedRunCount(page), { timeout: 30000 }).toBe(3);
  await expect(page.getByTestId('playback-status')).not.toContainText(/invalid/i);
});

test('blank project keeps scenario creation available and Run disabled on desktop and phone', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('blank-project-name-input').fill('Source blank');
  await page.getByTestId('create-blank-project-btn').click();
  const trigger = page.getByTestId('scenario-switcher-trigger');
  await expect(trigger).toContainText('No scenario');
  await expect(page.getByTestId('scenario-run-btn')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await trigger.click();
  await page.getByRole('button', { name: 'New scenario', exact: true }).click();
  await page.getByLabel('Name').fill('First traffic test');
  await page.getByTestId('new-scenario-create').click();
  await expect(page.getByTestId('scenario-inspector-sheet-overlay')).toBeVisible();
  await expect(page.getByLabel('Scenario name')).toHaveValue('First traffic test');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('scenario-inspector-sheet-overlay')).toHaveCount(0);
  await expect(trigger).toContainText('No scenario');
});

test('S06 Run all persists both reference scenario results', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/projects');
  await page.getByTestId('create-example-s06').click();
  await expect(page.locator('.component-node')).toHaveCount(8);
  await runAll(page);
  await expect.poll(() => savedRunCount(page), { timeout: 150000, intervals: [1000] }).toBe(2);
  await page.screenshot({ path: test.info().outputPath('source-s06-run-all.png') });
});

import { expect, test, type Page } from '@playwright/test';

async function openS06(page: Page) {
  await page.goto('/');
  await page.getByTestId('create-example-s06').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
}

/** Sets the selected scenario's completion in the editor and applies it. */
async function setCompletion(page: Page, kind: 'horizon' | 'count' | 'open', fill: Record<string, string> = {}) {
  await page.getByTestId('scenario-switcher-trigger').click();
  await page.getByTestId('scenario-switcher-popover').getByRole('button', { name: /^Edit / }).click();
  const editor = page.getByTestId('scenario-editor');
  await expect(editor).toBeVisible();
  await editor.getByLabel('Completion kind').selectOption(kind);
  for (const [label, value] of Object.entries(fill)) await editor.getByLabel(label).fill(value);
  const apply = editor.getByTestId('scenario-editor-apply');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await editor.getByRole('button', { name: /Cancel|Close/ }).first().click().catch(() => undefined);
}

async function setSpeed(page: Page, value: string) {
  await page.getByTestId('scenario-switcher-trigger').click();
  await page.getByTestId('run-speed-select').selectOption(value);
  await page.keyboard.press('Escape');
}

test.describe('Run duration and pace (D55)', () => {
  test('an open run goes on until Stop, then drains and keeps its results', async ({ page }) => {
    await openS06(page);
    await setCompletion(page, 'open');
    await setSpeed(page, '10');

    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('scenario-stop-btn')).toBeVisible();
    // Nothing ends it by itself.
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('scenario-stop-btn')).toBeVisible();
    await expect(page.getByTestId('results-status-badge')).not.toContainText('completed');

    await page.getByTestId('scenario-stop-btn').click();
    await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 20000 });
    await expect(page.getByTestId('scenario-stop-btn')).toHaveCount(0);
    await expect(page.getByTestId('results-region')).toContainText('Saved');
  });

  test('an open run cannot be Instant: that option is not offered for it', async ({ page }) => {
    await openS06(page);
    await setCompletion(page, 'open');
    await page.getByTestId('scenario-switcher-trigger').click();
    await expect(page.getByTestId('run-speed-select').locator('option[value="0"]')).toHaveAttribute('disabled', '');
  });

  test('a run for a number of requests sends that many and ends when they have settled', async ({ page }) => {
    await openS06(page);
    await setCompletion(page, 'count', { Requests: '120', 'Count deadline': '60000' });
    await setSpeed(page, '0');
    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 20000 });
  });

  test('real time takes real time; Instant does not', async ({ page }) => {
    await openS06(page);
    await setCompletion(page, 'horizon', { 'Run for (ms)': '3000' });

    await setSpeed(page, '1');
    const start = Date.now();
    await page.getByTestId('scenario-run-btn').click();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('results-status-badge')).not.toContainText('completed');
    await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 15000 });
    expect(Date.now() - start).toBeGreaterThan(2500);

    await setSpeed(page, '0');
    const instantStart = Date.now();
    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 15000 });
    expect(Date.now() - instantStart).toBeLessThan(2500);
  });
});

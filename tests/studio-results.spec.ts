import { test, expect, type Page } from './fixtures';

/**
 * RV-13b: Results region (7A completed-run strip, 21B general metrics,
 * 21D component-first metrics). studio-runs.spec.ts already asserts the
 * General metrics tab text and the strip/stale notice; this spec adds the
 * component-first tab, tab switching, and the mobile strip.
 */

async function openS04AndRun(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
  await page.getByTestId('scenario-run-btn').click();
  await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 20000 });
}

async function openRunResults(page: Page) {
  await page.getByRole('button', { name: /Inspect (Request Cycles|Run Results)/ }).first().click();
  const tab = page.getByRole('tab', { name: 'Run results', exact: true });
  await expect(tab).toBeVisible();
  return page.getByTestId('results-region');
}

test.describe('RV-13b: Results region', () => {
  test('Run results is first and default; summary shows measured run metrics', async ({ page }) => {
    await openS04AndRun(page);
    const disclosure = page.getByRole('button', { name: 'Inspect Request Cycles', exact: true });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await disclosure.click();
    const tabs = page.getByRole('tab');
    await expect(tabs.nth(0)).toHaveText('Run results');
    await expect(tabs.nth(1)).toHaveText('Request cycles');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    const region = page.getByTestId('results-region');
    await expect(region).toBeVisible();
    await expect(region.getByTestId('results-status-badge')).toContainText(/completed/i);
    const summary = region.getByTestId('results-cycles');
    await expect(summary).toContainText(/Whole run/);
    await expect(summary).toContainText(/\d+ all-work cycles/);
    await expect(summary).toContainText(/\d+ successful/);
    await expect(summary).toContainText(/\d+ non-success/);
    await expect(summary).toContainText(/Mean response .* ms/);
    await expect(summary).toContainText(/Mean all-work completion .* ms/);
    await expect(summary).toContainText(/Whole-run checks/);
    await expect(region).not.toContainText(/undefined|NaN|\[object/);
    await page.screenshot({ path: test.info().outputPath('run-results-desktop-default.png') });
  });

  test('Details switches between General metrics and component-first Components tab', async ({ page }) => {
    await openS04AndRun(page);
    const disclosure = page.getByRole('button', { name: /Inspect (Request Cycles|Run Results)/ }).first();
    await disclosure.click();
    await page.getByRole('tab', { name: 'Run results', exact: true }).click();
    const region = page.getByTestId('results-region');

    // General metrics are the initial view.
    await expect(region.getByRole('button', { name: 'General metrics' })).toBeVisible();
    await expect(region).toContainText(/Consumed inputs:\s*\d/);

    // Component-first (21D): a table of measured metrics per named element.
    await region.getByRole('button', { name: 'Components' }).click();
    const table = region.getByRole('table');
    await expect(table).toBeVisible();
    for (const header of ['Element', 'Metric', 'Value', 'Status']) {
      await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
    }
    const rows = table.getByRole('row');
    await expect.poll(() => rows.count()).toBeGreaterThan(1);
    await expect(table).toContainText('Measured');
    await expect(table).not.toContainText(/undefined|NaN|\[object/);
    // Elements are shown by their authored names, never raw ids.
    expect(await table.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);

    // Back to General restores the general view; the inspection disclosure collapses.
    await region.getByRole('button', { name: 'General metrics' }).click();
    await expect(table).toBeHidden();
    await expect(region).toContainText(/Consumed inputs:\s*\d/);
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  });

  test('390x844: run results and summary stay within the viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openS04AndRun(page);
    const region = await openRunResults(page);
    await expect(region.getByRole('button', { name: 'Components' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('run-results-mobile-default.png') });
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

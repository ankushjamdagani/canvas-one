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
  await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 20000 });
}

test.describe('RV-13b: Results region', () => {
  test('completed-run strip shows status, checks, time and roots', async ({ page }) => {
    await openS04AndRun(page);
    const region = page.getByTestId('results-region');
    await expect(region).toContainText('CHECKS');
    await expect(region).toContainText('TIME');
    await expect(region).toContainText('ROOTS');
    await expect(region.getByTestId('results-status-badge')).toContainText(/completed/i);
    await expect(region).toContainText(/\d+ of \d+ passed/);
    await expect(region).toContainText('Saved');
    // No raw ids or placeholders leak into the strip.
    await expect(region).not.toContainText(/undefined|NaN|\[object/);
  });

  test('Details switches between General metrics and component-first Components tab', async ({ page }) => {
    await openS04AndRun(page);
    const region = page.getByTestId('results-region');
    const toggle = page.getByTestId('results-details-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // General first (21B).
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

    // Back to General restores the general view; Details collapses.
    await region.getByRole('button', { name: 'General metrics' }).click();
    await expect(table).toBeHidden();
    await expect(region).toContainText(/Consumed inputs:\s*\d/);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('390x844: the completed strip and expanded details stay within the viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openS04AndRun(page);
    await page.getByTestId('results-details-toggle').click();
    await expect(page.getByTestId('results-region').getByRole('button', { name: 'Components' })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

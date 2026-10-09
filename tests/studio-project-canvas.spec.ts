import { expect, test } from './fixtures';

test.describe('Project Canvas design (2026-10-07)', () => {
  test('desktop editor shows the sheet frame, static top-bar extras and a mouse crosshair', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/projects');
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('workspace-frame')).toBeVisible();
    await expect(page.getByTestId('topbar-version')).toHaveCount(0);
    await expect(page.getByTestId('brand')).toBeVisible();
    await expect(page.getByTestId('topbar-back')).toBeVisible();
    await expect(page.getByTestId('topbar-collaborators')).toBeVisible();
    await expect(page.getByTestId('topbar-share-btn')).toBeDisabled();
    // Canvas and header begin at the shared frame interior; the canvas continues beneath it.
    const bar = await page.getByTestId('workspace-topbar').boundingBox();
    const canvasBox = await page.getByTestId('canvas-container').boundingBox();
    expect(canvasBox!.y).toBeLessThanOrEqual(bar!.y);

    const crosshair = page.locator('canvas[data-decoration=canvas-crosshair]');
    const blank = await crosshair.evaluate((el: HTMLCanvasElement) => el.toDataURL());
    await page.getByTestId('canvas-container').hover({ position: { x: 300, y: 300 } });
    await page.mouse.move(340, 330, { steps: 4 });
    await expect
      .poll(() => crosshair.evaluate((el: HTMLCanvasElement) => el.toDataURL()))
      .not.toBe(blank);
    await page.mouse.move(2, 2);
    await expect
      .poll(() => crosshair.evaluate((el: HTMLCanvasElement) => el.toDataURL()))
      .toBe(blank);
  });

  test('narrow editor drops the frame and the top-bar extras', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/projects');
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('workspace-frame')).toBeHidden();
    await expect(page.getByTestId('topbar-share-btn')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test('picker Recent chip lists parts placed from the picker', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/projects');
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');

    await page.getByTestId('dock-component-btn').click();
    const picker = page.getByTestId('library-picker');
    await picker.getByRole('tab', { name: 'Filter by Recent' }).click();
    await expect(picker.getByText('Nothing placed yet')).toBeVisible();
    await picker.getByRole('tab', { name: 'Filter by All' }).click();
    await picker.locator('[data-entry-id="service"]').dblclick();
    await expect(picker).toBeHidden();

    await page.getByTestId('dock-component-btn').click();
    await expect(picker.getByRole('tab', { name: 'Filter by Recent' })).toHaveAttribute('aria-selected', 'true');
    await expect(picker.locator('[data-entry-id="service"]')).toBeVisible();
  });
});

import { test, expect } from './fixtures';

for (const width of [1512, 390]) {
  test(`UI labels retain the same size across pages and portals at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 982 });
    await page.goto('/projects');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Brand', exact: true })).toHaveCSS('font-size', '13px');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();

    for (const id of ['breadcrumb-project-btn', 'breadcrumb-branch-btn', 'scenario-switcher-trigger']) {
      await expect(page.getByTestId(id)).toHaveCSS('font-size', '13px');
    }
    await expect(page.locator('.component-node .text-xs').first()).toHaveCSS('font-size', '13px');
    await expect(page.getByTestId('dock-zoom-value')).toHaveCSS('font-size', '13px');
    await expect(page.locator('[data-testid^="node-caption-"]').first()).toHaveCSS('font-size', '10px');

    await page.getByTestId('breadcrumb-project-btn').click();
    await expect(page.getByTestId('project-menu-rename')).toHaveCSS('font-size', '13px');
    await page.keyboard.press('Escape');
    await page.getByTestId('scenario-switcher-trigger').click();
    await expect(page.getByTestId('scenario-switcher-popover')).toBeVisible();
    await expect(page.locator('[data-testid^="scenario-row-"] .text-xs').first()).toHaveCSS('font-size', '13px');
    await page.keyboard.press('Escape');

    const overflow = page.getByTestId('dock-more-btn');
    await overflow.click();
    await expect(page.getByTestId('dock-more-labels-toggle').locator('..').locator('label')).toHaveCSS('font-size', '13px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

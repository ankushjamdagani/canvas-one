import { expect, test, type Page } from '@playwright/test';

// These tests run at real animation speed: clear the suite-wide motion-off flag.
test.use({ storageState: { cookies: [], origins: [] } });

const trackOverlay = (page: Page) =>
  page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="route-card-overlay"]')) (window as unknown as { __overlaySeen: boolean }).__overlaySeen = true;
    }).observe(document, { subtree: true, childList: true });
  });
const overlaySeen = (page: Page) => page.evaluate(() => !!(window as unknown as { __overlaySeen?: boolean }).__overlaySeen);

test('the board persists across home and projects and swaps page content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page.getByTestId('route-board')).toHaveAttribute('data-intro', 'true');
  await page.getByTestId('route-board').evaluate((el) => ((el as unknown as { __id: string }).__id = 'same'));
  await page.getByRole('link', { name: 'Try Beta' }).last().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await expect(page.locator('[data-page-kind="home"]')).toHaveCount(0);
  expect(await page.getByTestId('route-board').evaluate((el) => (el as unknown as { __id: string }).__id)).toBe('same');
  await page.goBack();
  await expect(page.getByTestId('landing-page')).toBeVisible();
});

test('rapid forward/back navigation settles on the last route', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await page.getByRole('link', { name: 'Try Beta' }).last().click();
  await page.goBack();
  await page.goForward();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page.locator('[data-page-kind]')).toHaveCount(1);
});

test('opening a project grows a card overlay, then the canvas enters and back returns', async ({ page }) => {
  await trackOverlay(page);
  await page.goto('/projects');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('route-card-overlay')).toHaveCount(0, { timeout: 10000 });
  expect(await overlaySeen(page)).toBe(true);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  // Enter animations finish on their own and leave no inline opacity/transform/filter behind.
  await expect
    .poll(() => page.locator('.react-flow__node > :first-child').first().evaluate((el) => (el as HTMLElement).style.cssText), { timeout: 8000 })
    .not.toMatch(/opacity|transform|filter/);
  await page.getByTestId('topbar-back').click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await expect(page.locator('[data-page-kind="project"]')).toHaveCount(0);
});

test('a deep link skips the board intro and plays only the canvas enter', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('route-board')).toHaveAttribute('data-intro', 'false');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test.describe('reduced motion', () => {
  test.use({ colorScheme: 'light' });
  test('no overlay, no intro, content visible immediately', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await trackOverlay(page);
    await page.goto('/projects');
    await expect(page.getByTestId('route-board')).toHaveAttribute('data-intro', 'false');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
    expect(await overlaySeen(page)).toBe(false);
  });
});

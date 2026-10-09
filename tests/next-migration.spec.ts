import { test, expect } from './fixtures';
import { runAll, savedRunCount } from './simulation-support';

test.skip(process.env.TEST_PRODUCTION !== '1', 'Requires the production Next.js shell and generated worker.');

test('public pages have visible HTML without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  for (const path of ['/', '/brand']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try Beta' }).first()).toHaveAttribute('href', '/projects');
    await expect(page.getByTestId('boot-loading-screen')).toHaveCount(0);
  }
  await context.close();
});

test('public content does not open IndexedDB and metadata follows navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB);
    (window as unknown as { dbOpens: number }).dbOpens = 0;
    indexedDB.open = (...args: Parameters<IDBFactory['open']>) => {
      (window as unknown as { dbOpens: number }).dbOpens++;
      return original(...args);
    };
  });
  await page.goto('/');
  await expect(page.getByTestId('landing-page')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { dbOpens: number }).dbOpens)).toBe(0);
  await page.getByRole('link', { name: 'Try Beta' }).first().click();
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await page.getByRole('link', { name: 'Canvas One', exact: true }).click();
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
  await expect(page).toHaveTitle('Canvas One — The shared canvas for engineers and AI');
});

test('saved projects reopen and simulate offline after a direct URL reload', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/projects');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) throw new Error('Offline worker did not activate');
  });
  await page.getByTestId('create-example-s01').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
  const projectUrl = page.url();
  await page.reload();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto(projectUrl);
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.locator('.component-node')).not.toHaveCount(0);
  await runAll(page);
  await expect.poll(() => savedRunCount(page), { timeout: 30000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await context.setOffline(false);
});

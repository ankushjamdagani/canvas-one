import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(process.env.TEST_PRODUCTION !== '1', 'Requires production first-paint markup.');

test('header material waits for the page frame, then fades in', async ({ page }) => {
  await page.addInitScript(() => {
    const samples: { ring: number; surface: number; page: string | null }[] = [];
    (window as unknown as { headerFrames: typeof samples }).headerFrames = samples;
    const sample = () => {
      const ring = document.querySelector('.drafting-frame-ring');
      const surface = document.querySelector('[data-header-surface]');
      const loader = document.querySelector<HTMLElement>('[data-initial-loader]');
      if (ring && surface && (!loader || loader.hidden) && samples.length < 600) {
        samples.push({ ring: Number(getComputedStyle(ring).opacity), surface: Number(getComputedStyle(surface).opacity), page: surface.closest('[data-page-kind]')?.getAttribute('data-page-kind') ?? null });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/');
  await expect(page.locator('[data-header-surface]')).toHaveCSS('opacity', '1');
  const samples = await page.evaluate(() => (window as unknown as { headerFrames: { ring: number; surface: number; page: string | null }[] }).headerFrames);
  const drawing = samples.filter(frame => frame.ring > 0.05 && frame.ring < 0.95);
  expect(drawing.length).toBeGreaterThan(0);
  expect(drawing.every(frame => frame.surface === 0)).toBe(true);
  const fading = samples.filter(frame => frame.surface > 0.05 && frame.surface < 0.95);
  expect(fading.length).toBeGreaterThan(0);
  expect(fading.every(frame => frame.ring === 1)).toBe(true);
  await page.screenshot({ path: '/private/tmp/header-polish-desktop.png' });
  await page.getByRole('link', { name: 'Brand', exact: true }).click();
  await expect(page.locator('[data-page-kind="brand"] [data-header-surface]')).toHaveCSS('opacity', '1');
  const brand = await page.evaluate(() => (window as unknown as { headerFrames: { ring: number; surface: number; page: string | null }[] }).headerFrames.filter(frame => frame.page === 'brand'));
  expect(brand.some(frame => frame.ring < 0.95 && frame.surface === 0)).toBe(true);
  expect(brand.every(frame => frame.ring >= 0.999 || frame.surface === 0)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/private/tmp/header-polish-mobile.png' });
});

test('database boot uses the large face without visible loading text', async ({ page }) => {
  await page.addInitScript(() => {
    const observed: { text: string; width: string | null }[] = [];
    (window as unknown as { bootFaces: typeof observed }).bootFaces = observed;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const boot = node.matches('[data-testid="boot-loading-screen"]') ? node : node.querySelector('[data-testid="boot-loading-screen"]');
        if (boot) observed.push({ text: boot.textContent ?? '', width: boot.querySelector('svg')?.getAttribute('width') ?? null });
      }
    }).observe(document, { subtree: true, childList: true });
  });
  await page.goto('/projects');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  const faces = await page.evaluate(() => (window as unknown as { bootFaces: { text: string; width: string | null }[] }).bootFaces);
  expect(faces.length).toBeGreaterThan(0);
  expect(faces.every(face => face.text === '' && face.width === '128')).toBe(true);
});

test('reduced motion shows header material immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-header-surface]')).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('route-board')).toHaveAttribute('data-intro', 'false');
});

test('opening a project during the frame intro does not strand the returning header', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await page.waitForTimeout(3200);
  await page.getByTestId('topbar-back').click();
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await expect(page.locator('[data-page-kind="project"]')).toHaveCount(0);
  await expect(page.locator('[data-header-surface]')).toHaveCSS('opacity', '1');
  await expect.poll(() => page.locator('.drafting-frame-side').evaluateAll(sides => sides.every(side => {
    const transform = getComputedStyle(side).transform;
    return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
  }))).toBe(true);
});

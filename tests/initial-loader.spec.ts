import { expect, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });
test.skip(process.env.TEST_PRODUCTION !== '1', 'Requires server-rendered HTML.');

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
test(`${reducedMotion}: logo cover appears before hydration, times out, and late hydration never re-hides content`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => {
    const samples: number[] = [];
    (window as unknown as { loaderExitSamples: number[] }).loaderExitSamples = samples;
    const sample = () => {
      const loader = document.querySelector<HTMLElement>('[data-initial-loader]');
      const face = loader?.querySelector('.loading-face');
      if (loader && !loader.hidden && face && samples.length < 600) samples.push(Number(getComputedStyle(face).opacity));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*.js*', async route => { await gate; await route.continue(); });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const loader = page.locator('[data-initial-loader]');
    await expect(loader).toBeVisible();
    await expect(loader.locator('svg')).toHaveAttribute('data-expression', 'wink');
    await expect(loader.locator('svg')).toHaveAttribute('width', '128');
    if (reducedMotion === 'reduce') await expect(loader.locator('svg circle').first()).toHaveCSS('animation-name', 'none');
    else await page.screenshot({ path: '/private/tmp/loader-first-paint.png' });
    expect(await loader.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.width / 2, rect.height / 2));
    })).toBe(true);
    await expect(page.locator('[data-reveal-kind="content"]').first()).toHaveCSS('opacity', '1');
    await expect(loader).toBeHidden({ timeout: 4500 });
    if (reducedMotion === 'no-preference') expect(await page.evaluate(() => (window as unknown as { loaderExitSamples: number[] }).loaderExitSamples.some(v => v > 0.05 && v < 0.95))).toBe(true);
    await page.evaluate(() => {
      const samples: number[] = [];
      (window as unknown as { initialOpacity: number[] }).initialOpacity = samples;
      const sample = () => {
        const reveal = document.querySelector('[data-reveal-kind="content"]');
        if (reveal && samples.length < 600) samples.push(Number(getComputedStyle(reveal).opacity));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    release();
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => (window as unknown as { initialOpacity: number[] }).initialOpacity.every(v => v === 1))).toBe(true);
    await expect(loader).toBeHidden();
    await expect(page.locator('[data-header-surface]')).toHaveCSS('opacity', '1');
    expect(errors).toEqual([]);
    await page.getByRole('link', { name: 'Brand', exact: true }).click();
    await expect(page.locator('[data-page-kind="brand"] h1')).toBeFocused();
    await expect(loader).toBeHidden();
  } finally {
    release();
  }
});
}

test('hydration removes the loader without a minimum delay and retains normal entrance', async ({ page }) => {
  await page.addInitScript(() => {
    const samples: { opacity: number; covered: boolean; faceOpacity: number }[] = [];
    (window as unknown as { initialFrames: typeof samples }).initialFrames = samples;
    const sample = () => {
      const reveal = document.querySelector('[data-reveal-kind="content"]');
      const loader = document.querySelector<HTMLElement>('[data-initial-loader]');
      const face = loader?.querySelector('.loading-face');
      if (reveal && loader && face && samples.length < 600) samples.push({ opacity: Number(getComputedStyle(reveal).opacity), covered: !loader.hidden && getComputedStyle(loader).visibility !== 'hidden', faceOpacity: Number(getComputedStyle(face).opacity) });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/');
  await expect(page.locator('[data-initial-loader]')).toBeHidden();
  expect(await page.evaluate(() => window.__canvasInitialLoad?.expired)).toBe(false);
  await expect(page.locator('[data-reveal-kind="content"]').first()).toHaveCSS('opacity', '1');
  const frames = await page.evaluate(() => (window as unknown as { initialFrames: { opacity: number; covered: boolean; faceOpacity: number }[] }).initialFrames);
  expect(frames.some(frame => frame.covered && frame.faceOpacity > 0.05 && frame.faceOpacity < 0.95)).toBe(true);
  expect(frames.some(frame => !frame.covered && frame.opacity > 0.05 && frame.opacity < 0.95)).toBe(true);
  const uncovered = frames.filter(frame => !frame.covered);
  expect(uncovered.every((frame, index) => index === 0 || frame.opacity >= uncovered[index - 1].opacity - 0.01)).toBe(true);
});

test('CSS releases the overlay if the bootstrap and application scripts are blocked', async ({ page }) => {
  await page.route('**/*', async route => {
    if (route.request().resourceType() === 'document') {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "script-src 'none'" } });
    } else await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('[data-initial-loader]')).toBeHidden({ timeout: 4500 });
  await expect(page.locator('[data-reveal-kind="content"]').first()).toHaveCSS('opacity', '1');
});

test('hydration during the fallback fade does not restart the visible cover', async ({ page }) => {
  await page.addInitScript(() => {
    const samples: number[] = [];
    (window as unknown as { coverFade: number[] }).coverFade = samples;
    const sample = () => {
      const loader = document.querySelector<HTMLElement>('[data-initial-loader]');
      if (loader && samples.length < 600) samples.push(loader.hidden ? 0 : Number(getComputedStyle(loader).opacity));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*.js*', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const loader = page.locator('[data-initial-loader]');
    await expect.poll(() => loader.evaluate(el => Number(getComputedStyle(el).opacity)), { intervals: [10], timeout: 4500 }).toBeLessThan(0.8);
    release();
    await page.waitForLoadState('networkidle');
    await expect(loader).toBeHidden();
    const samples = await page.evaluate(() => (window as unknown as { coverFade: number[] }).coverFade);
    expect(samples.some(v => v > 0.05 && v < 0.95)).toBe(true);
    expect(samples.every((v, i) => i === 0 || v <= samples[i - 1] + 0.01)).toBe(true);
    await expect(page.locator('[data-reveal-kind="content"]').first()).toHaveCSS('opacity', '1');
  } finally { release(); }
});

test('no-JavaScript content is immediately available and reduced-motion logo is static', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('[data-initial-loader]')).toBeHidden();
    await expect(page.locator('[data-reveal-kind="content"]').first()).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-initial-loader] svg circle').first()).toHaveCSS('animation-name', 'none');
  } finally { await context.close(); }
});

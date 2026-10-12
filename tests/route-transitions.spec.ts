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

test('public content animates through intermediate entry and exit poses after hydration', async ({ page }) => {
  await page.addInitScript(() => {
    const samples: Record<string, number[]> = {};
    (window as unknown as { revealSamples: typeof samples }).revealSamples = samples;
    const sample = () => {
      document.querySelectorAll('[data-page-kind]').forEach(frame => {
        const reveal = frame.querySelector('[data-reveal-kind="content"]');
        if (!reveal) return;
        const key = frame.getAttribute('data-page-kind')!;
        const values = samples[key] ??= [];
        if (values.length < 1500) values.push(Number(getComputedStyle(reveal).opacity));
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/');
  const opacitySamples = (kind: string) => page.evaluate(kind =>
    (window as unknown as { revealSamples: Record<string, number[]> }).revealSamples[kind] ?? [], kind);
  await expect.poll(async () => (await opacitySamples('home')).some(v => v > 0.05 && v < 0.95)).toBe(true);
  await expect.poll(async () => (await opacitySamples('home')).at(-1)).toBe(1);
  await page.getByRole('link', { name: 'Brand', exact: true }).click();
  await expect(page.locator('[data-page-kind="home"]')).toHaveCount(0);
  const home = await opacitySamples('home');
  expect(home.slice(home.indexOf(1) + 1).some(v => v > 0.05 && v < 0.95)).toBe(true);
  await expect.poll(async () => (await opacitySamples('brand')).some(v => v > 0.05 && v < 0.95)).toBe(true);
  await expect.poll(async () => (await opacitySamples('brand')).at(-1)).toBe(1);
});

test('route headings receive keyboard focus only after their reveal finishes', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('focusin', event => {
      const heading = event.target;
      if (!(heading instanceof HTMLElement) || heading.tagName !== 'H1') return;
      const reveal = heading.closest('[data-reveal-kind]');
      if (reveal) (window as unknown as { headingFocusOpacity: number }).headingFocusOpacity = Number(getComputedStyle(reveal).opacity);
    });
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Brand', exact: true }).click();
  const heading = page.locator('[data-page-kind="brand"] h1');
  await expect(heading).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { headingFocusOpacity: number }).headingFocusOpacity)).toBe(1);
});

test('landing and brand fade content, preserve the board and reset deep scroll', async ({page}) => {
  await page.goto('/');
  await page.getByTestId('route-board').evaluate(el=>el.setAttribute('data-preserved','yes'));
  await page.getByRole('link',{name:'Brand',exact:true}).click();
  await expect(page.locator('.brand-page')).toBeVisible();
  await expect.poll(()=>page.locator('.brand-page').evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
  await page.locator('#states').scrollIntoViewIfNeeded();
  expect(await page.locator('[data-page="brand"]').evaluate(el=>el.scrollTop)).toBeGreaterThan(1000);
  await page.locator('[data-page="brand"]').evaluate(el=>el.scrollTo(0,0));
  await page.getByRole('link',{name:'Canvas One',exact:true}).click();
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page.locator('[data-page-kind]')).toHaveCount(1);
  await expect(page.getByTestId('route-board')).toHaveAttribute('data-preserved','yes');
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
});

test('the board persists across home and projects and swaps page content', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-page')).toBeVisible();
  await expect(page.getByTestId('route-board')).toHaveAttribute('data-intro', 'true');
  await expect(page.locator('.drafting-frame-side')).toHaveCount(4);
  await expect(page.locator('.drafting-frame-ring')).toHaveCount(1);
  await page.getByTestId('route-board').evaluate((el) => ((el as unknown as { __id: string }).__id = 'same'));
  await page.getByRole('link', { name: 'Try Beta' }).last().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await expect(page.locator('[data-reveal-kind="content"][data-reveal-index="1"]')).toHaveCount(1);
  await expect(page.locator('[data-reveal-kind="content"][data-reveal-index="2"]')).toHaveCount(1);
  await expect(page.locator('[data-reveal-kind="content"][data-reveal-index="3"]')).toHaveCount(1);
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
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/projects$/);
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
  await expect.poll(async () => {
    const box = await page.locator('.react-flow__node > :first-child').first().boundingBox();
    return !!box && box.width > 80 && box.height > 20;
  }).toBe(true);
  await expect(page.locator('.drafting-frame')).toHaveCount(1);
  await expect(page.getByTestId('workspace-frame')).toBeVisible();
  await expect.poll(() => page.getByTestId('canvas-floating-dock').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  // Enter animations finish on their own and leave no inline opacity/transform/filter behind.
  await expect
    .poll(() => page.locator('.react-flow__node > :first-child').first().evaluate((el) => (el as HTMLElement).style.cssText), { timeout: 8000 })
    .not.toMatch(/opacity|transform|filter/);
  await page.getByTestId('topbar-back').click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await expect(page.locator('[data-page-kind="project"]')).toHaveCount(0);
});

test('canvas connections draw into the sheet and restore their authored strokes', async ({ page }) => {
  await page.addInitScript(() => {
    const observed = { draw: false, dockHidden: false };
    (window as unknown as { __motionObserved: typeof observed }).__motionObserved = observed;
    const sample = () => {
      const dock = document.querySelector('[data-testid="canvas-floating-dock"]');
      if (dock && Number(getComputedStyle(dock).opacity) < 0.05) observed.dockHidden = true;
      document.querySelectorAll<SVGPathElement>('.react-flow__edge-path, [data-cells-lanes-connection] > path').forEach((path) => {
        if (Number(path.style.strokeDashoffset) > 1) observed.draw = true;
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __motionObserved: { draw: boolean } }).__motionObserved.draw)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __motionObserved: { dockHidden: boolean } }).__motionObserved.dockHidden)).toBe(true);
  await expect.poll(() => page.locator('.react-flow__edge-path').evaluateAll((paths) => paths.length > 0 && paths.every((path) => !(path as SVGPathElement).style.strokeDashoffset))).toBe(true);
});

test('going back keeps the project page mounted while it animates out, and a quick Forward restores it cleanly', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.waitForTimeout(3500);
  await page.getByTestId('topbar-back').click();
  await expect(page).toHaveURL(/\/projects$/);
  // The canvas is still on screen (exiting) right after the URL changes.
  await expect(page.locator('[data-page-kind="project"]')).toHaveCount(1);
  await page.goForward();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.locator('[data-page-kind="project"]')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-page-kind]')).toHaveCount(1);
  // Nothing from the cancelled exit is left behind on the canvas.
  const leftovers = await page.evaluate(() => {
    const els = [
      ...Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node > :first-child')),
      document.querySelector<HTMLElement>('[data-testid="workspace-topbar"]'),
      document.querySelector<HTMLElement>('[data-testid="playback-panel"]'),
      document.querySelector<HTMLElement>('.react-flow__edges'),
    ].filter((el): el is HTMLElement => !!el);
    return els.filter((el) => /opacity|transform|filter/.test(el.style.cssText)).length;
  });
  expect(leftovers).toBe(0);
  expect(await page.evaluate(() => (document.querySelector('[data-page-kind]') as HTMLElement).inert)).toBe(false);
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

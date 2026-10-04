import { expect, test, type Page } from '@playwright/test';

async function openS06(page: Page) {
  await page.goto('/');
  await page.getByTestId('create-example-s06').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
}

type Traffic = { mode: 'bulk'; requests: number; overMs?: number } | { mode: 'stream'; rate: number };

/** Sets the selected scenario's first traffic source in the editor and applies it. */
async function setTraffic(page: Page, traffic: Traffic) {
  await page.getByTestId('scenario-switcher-trigger').click();
  await page
    .getByTestId('scenario-switcher-popover')
    .locator('[data-testid^="scenario-row-"]', { has: page.locator('button[aria-pressed="true"]') })
    .getByRole('button', { name: /^Edit scenario/ })
    .click();
  const editor = page.getByTestId('scenario-editor');
  await expect(editor).toBeVisible();
  const row = editor.locator('[data-testid^="workload-row-"]').first();
  await row.getByLabel('Sends').selectOption(traffic.mode);
  if (traffic.mode === 'stream') {
    await row.getByTestId('stream-rate').fill(String(traffic.rate));
  } else {
    await row.getByTestId('bulk-requests').fill(String(traffic.requests));
    await row.getByTestId('bulk-arrival').selectOption(traffic.overMs === undefined ? 'instant' : 'spread');
    if (traffic.overMs !== undefined) await row.getByTestId('bulk-spread').fill(String(traffic.overMs));
  }
  const apply = editor.getByTestId('scenario-editor-apply');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await editor.getByRole('button', { name: /Cancel|Close/ }).first().click().catch(() => undefined);
}

/** The browser suite runs as fast as it can; a hidden localStorage override (no UI) puts a test on a paced clock. */
async function setSpeed(page: Page, value: string) {
  await page.evaluate((v) => window.localStorage.setItem('studio.runSpeed', v), value);
  await page.reload();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
}

test.describe('Bulk and stream runs, Stop and pace (D55, D56)', () => {
  test('a stream goes on until Stop, then drains and keeps its results', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'stream', rate: 100 });
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

  test('a stream is not cut off by the event budget, and Stop still completes it', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'stream', rate: 100 });
    // 20x: after 8 real seconds the playhead is far past where the default 100k-event budget would have ended it.
    await setSpeed(page, '20');
    await page.getByTestId('scenario-run-btn').click();
    await page.waitForTimeout(8000);
    await expect(page.getByTestId('scenario-stop-btn')).toBeVisible();
    await expect(page.getByTestId('results-status-badge')).not.toContainText('completed');
    await page.getByTestId('scenario-stop-btn').click();
    await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 40000 });
  });

  test('a bulk sends that many requests and ends by itself when they have settled', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 120 });
    await setSpeed(page, '0');
    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 20000 });
  });

  test('real time takes real time; Instant does not', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 300, overMs: 3000 });

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

  test('each request shows as a packet that moves through its stages on the connection', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'stream', rate: 100 });
    await setSpeed(page, '1');
    await page.getByTestId('scenario-run-btn').click();
    const stages = new Set<string>();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !['sent', 'transit', 'received', 'returning', 'delivered'].every((s) => stages.has(s))) {
      for (const stage of await page.locator('[data-testid="traffic-packet"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stage') ?? ''))) {
        stages.add(stage);
      }
      await page.waitForTimeout(50);
    }
    expect([...stages]).toEqual(expect.arrayContaining(['sent', 'transit', 'received', 'returning', 'delivered']));
    await expect(page.getByTestId('traffic-packet-label').first()).toBeVisible();
    await page.getByTestId('scenario-stop-btn').click();
    await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 30000 });
    await expect(page.locator('[data-testid="traffic-packet"]')).toHaveCount(0, { timeout: 8000 });
  });

  test('scenario rows carry rename, edit and delete; no menu, tick, footer actions or run speed', async ({ page }) => {
    await openS06(page);
    await page.getByTestId('scenario-switcher-trigger').click();
    const popover = page.getByTestId('scenario-switcher-popover');
    const row = popover.locator('[data-testid^="scenario-row-"]').first();
    const actions = row.getByRole('button', { name: /scenario/i });
    await expect(actions).toHaveCount(3);
    for (const name of ['Rename', 'Edit', 'Delete']) await expect(row.getByRole('button', { name: new RegExp(`^${name} scenario`) })).toBeVisible();
    await expect(row.getByRole('button', { name: new RegExp('^Edit scenario') })).toHaveText('');
    await expect(popover.getByRole('button', { name: /Actions for scenario/ })).toHaveCount(0);
    await expect(popover.getByTestId('run-speed-select')).toHaveCount(0);
    await expect(popover.getByRole('button', { name: 'New scenario' })).toBeVisible();
    await expect(popover.getByText(/^Duplicate$/)).toHaveCount(0);
  });

  test('canvas grid dots keep their on-screen size when zooming out and the pitch resets', async ({ page }) => {
    await openS06(page);
    const dot = () =>
      page.evaluate(() => {
        const circle = document.querySelector('.react-flow__background pattern circle');
        const pattern = document.querySelector('.react-flow__background pattern');
        const zoom = Number(/scale\(([\d.]+)/.exec(document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '')?.[1] ?? 1);
        const r = Number(circle?.getAttribute('r') ?? 0);
        const width = Number(pattern?.getAttribute('width') ?? 0);
        return { r, width, zoom };
      });
    const canvas = page.locator('.react-flow__pane');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await dot();
    await page.keyboard.down('Control');
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 300);
    await page.keyboard.up('Control');
    await page.waitForTimeout(400);
    const after = await dot();
    expect(after.zoom).toBeLessThan(before.zoom);
    expect(after.r).toBeCloseTo(before.r, 1);
    expect(before.width / before.zoom).toBeCloseTo(24, 0);
    expect(after.width).toBeGreaterThanOrEqual(15);
  });
});

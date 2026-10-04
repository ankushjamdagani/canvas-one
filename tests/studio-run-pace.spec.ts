import { expect, test, type Page } from '@playwright/test';

async function openS06(page: Page) {
  await page.goto('/');
  await page.getByTestId('create-example-s06').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
}

/** Sets the selected scenario's completion in the editor and applies it. */
async function setCompletion(page: Page, kind: 'horizon' | 'count' | 'open', fill: Record<string, string> = {}) {
  await page.getByTestId('scenario-switcher-trigger').click();
  await page
    .getByTestId('scenario-switcher-popover')
    .locator('[data-testid^="scenario-row-"]', { has: page.locator('button[aria-pressed="true"]') })
    .getByRole('button', { name: /^Edit scenario/ })
    .click();
  const editor = page.getByTestId('scenario-editor');
  await expect(editor).toBeVisible();
  await editor.getByLabel('Completion kind').selectOption(kind);
  for (const [label, value] of Object.entries(fill)) await editor.getByLabel(label).fill(value);
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

test.describe('Run duration and pace (D55)', () => {
  test('an open run goes on until Stop, then drains and keeps its results', async ({ page }) => {
    await openS06(page);
    await setCompletion(page, 'open');
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

  test('a run for a number of requests sends that many and ends when they have settled', async ({ page }) => {
    await openS06(page);
    await setCompletion(page, 'count', { Requests: '120', 'Count deadline': '60000' });
    await setSpeed(page, '0');
    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 20000 });
  });

  test('real time takes real time; Instant does not', async ({ page }) => {
    await openS06(page);
    await setCompletion(page, 'horizon', { 'Run for (ms)': '3000' });

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
    await setCompletion(page, 'open');
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

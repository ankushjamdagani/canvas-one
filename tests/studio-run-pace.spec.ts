import { expect, test, type Page } from './fixtures';

async function openS06(page: Page) {
  await page.goto('/');
  await page.getByTestId('create-example-s06').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
}

type Traffic = { mode: 'bulk'; requests: number; overMs?: number } | { mode: 'stream'; rate: number };

/** Sets the selected scenario's first traffic source in the editor and applies it. */
async function setTraffic(page: Page, traffic: Traffic, entryLabel?: string) {
  await page.getByTestId('scenario-switcher-trigger').click();
  await page
    .getByTestId('scenario-switcher-popover')
    .locator('[data-testid^="scenario-row-"]', { has: page.locator('button[aria-pressed="true"]') })
    .getByRole('button', { name: /^Edit scenario/ })
    .click();
  const editor = page.getByTestId('scenario-editor');
  await expect(editor).toBeVisible();
  const row = editor.locator('[data-testid^="workload-row-"]').first();
  if (entryLabel) {
    const entry = row.getByLabel('Entry point');
    const value = await entry.locator('option').filter({ hasText: entryLabel }).first().getAttribute('value');
    expect(value).not.toBeNull();
    await entry.selectOption(value!);
  }
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

/** Use the same speed control available to the user; the current recording stays in memory. */
async function setSpeed(page: Page, value: string) {
  const speed = page.getByTestId('playback-speed');
  await page.removeLocatorHandler(speed);
  const apply = async () => {
    const target = Number(value);
    let current = Number((await speed.textContent())?.replace('×', ''));
    while (current !== target) {
      await page.getByRole('button', { name: current < target ? 'Faster playback' : 'Slower playback', exact: true }).click();
      current = Number((await speed.textContent())?.replace('×', ''));
    }
    await expect(speed).toHaveText(`${target}×`);
  };
  if (await speed.isVisible()) await apply();
  else await page.addLocatorHandler(speed, apply, { times: 1, noWaitAfter: true });
}

/** Give the existing SQL call enough real transit time to inspect its exact concurrent units. */
async function configurePlaybackLink(page: Page) {
  const source = await page.locator('.component-node').filter({ has: page.getByText('Checkout API A', { exact: true }) }).getAttribute('data-placement-id');
  const target = await page.locator('.component-node').filter({ has: page.getByText('Orders DB', { exact: true }) }).getAttribute('data-placement-id');
  const edge = page.locator(`.react-flow__edge[aria-label="Edge from ${source} to ${target}"]`);
  await edge.locator('.react-flow__edge-interaction').dispatchEvent('click');
  await page.getByTestId('inspector-field-config.latencyMs').fill('5000');
  await page.getByTestId('inspector-field-config.returnLatencyMs').fill('5000');
  await page.getByTestId('inspector-apply').click();
  await expect(page.getByTestId('inspector-apply')).toBeDisabled();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
  await expect(page.getByTestId('inspector-field-config.latencyMs')).toHaveValue('5000');
  await expect(page.getByTestId('inspector-field-config.returnLatencyMs')).toHaveValue('5000');
  return edge.getAttribute('data-id');
}

test.describe('Bulk and stream runs, Stop and pace (D55, D56)', () => {
  test('a stream goes on until Stop, then drains and keeps its results', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'stream', rate: 100 });
    await setSpeed(page, '16');

    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('scenario-stop-btn')).toBeVisible();
    // Nothing ends it by itself.
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('scenario-stop-btn')).toBeVisible();
    await expect(page.getByTestId('playback-status')).not.toContainText(/completed/i);

    await page.getByTestId('scenario-stop-btn').click();
    await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 20000 });
    await expect(page.getByTestId('scenario-stop-btn')).toHaveCount(0);
  });

  test('a stream is not cut off by the event budget, and Stop still completes it', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'stream', rate: 100 });
    // 20x: after 8 real seconds the playhead is far past where the default 100k-event budget would have ended it.
    await setSpeed(page, '16');
    await page.getByTestId('scenario-run-btn').click();
    await page.waitForTimeout(8000);
    await expect(page.getByTestId('scenario-stop-btn')).toBeVisible();
    await expect(page.getByTestId('playback-status')).not.toContainText(/completed/i);
    await page.getByTestId('scenario-stop-btn').click();
    await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 40000 });
  });

  test('a bulk sends that many requests and ends by itself when they have settled', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 120 });
    await setSpeed(page, '16');
    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 20000 });
  });

  test('real time takes real time; faster playback advances the recording', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 300, overMs: 3000 });

    await setSpeed(page, '1');
    const start = Date.now();
    await page.getByTestId('scenario-run-btn').click();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('playback-status')).not.toContainText(/completed/i);
    await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 15000 });
    expect(Date.now() - start).toBeGreaterThan(2500);

    await setSpeed(page, '16');
    const instantStart = Date.now();
    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 15000 });
    expect(Date.now() - instantStart).toBeLessThan(2500);
  });

  test('canvas shows exact transit packets, then node occupancy, and clears on completion', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 6 }, 'Checkout API A');
    // Real processing lasts longer than a frame; avoid polling for a millisecond-wide occupancy interval.
    await page.locator('.component-node').filter({ has: page.getByText('Orders DB', { exact: true }) }).click();
    await page.getByTestId('inspector-field-config.capacity').fill('1');
    await page.getByTestId('inspector-field-config.writeCapacity').fill('1');
    await page.getByTestId('inspector-field-config.serviceTime').selectOption('fixed');
    await page.getByTestId('inspector-field-config.concurrency').fill('1');
    await page.getByTestId('inspector-apply').click();
    await expect(page.getByTestId('inspector-apply')).toBeDisabled();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
    const linkId = await configurePlaybackLink(page);
    await setSpeed(page, '1');
    await page.locator(`.react-flow__edge[data-id="${linkId}"]`).locator('.react-flow__edge-interaction').dispatchEvent('click');
    await expect(page.getByTestId('inspector-field-config.latencyMs')).toHaveValue('5000');
    await page.getByTestId('scenario-run-btn').click();
    const edge = page.getByTestId(`edge-${linkId}`);
    await expect(edge.getByTestId('traffic-packet')).toHaveCount(6);
    await expect(page.getByTestId('traffic-aggregate')).toHaveCount(0);
    const packets = edge.getByTestId('traffic-packet');
    const first = await packets.first().getAttribute('transform');
    await expect.poll(() => packets.first().getAttribute('transform')).not.toBe(first);
    expect(await packets.evaluateAll((els) => els.every((e) => e.getAttribute('data-direction') === 'out' && !e.hasAttribute('data-stage')))).toBe(true);
    await expect(page.getByTestId('traffic-packet-label')).toHaveCount(0);
    await expect(page.getByTestId('node-occupancy').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('node-occupancy').filter({ hasText: '5 queued' })).toHaveAttribute('data-active', '1');
    await page.screenshot({ path: test.info().outputPath('canvas-playback-occupancy.png') });
    await setSpeed(page, '16');
    await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 20000 });
    await expect(page.getByTestId('traffic-packet')).toHaveCount(0);
    await expect(page.getByTestId('node-occupancy')).toHaveCount(0);
  });

  test('seven units aggregate and a selected connection lists every unit with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 7 }, 'Checkout API A');
    const linkId = await configurePlaybackLink(page);
    await setSpeed(page, '1');
    await page.locator(`.react-flow__edge[data-id="${linkId}"]`).locator('.react-flow__edge-interaction').dispatchEvent('click');
    await expect(page.getByTestId('inspector-field-config.latencyMs')).toHaveValue('5000');
    await page.getByTestId('scenario-run-btn').click();
    const aggregate = page.getByTestId('traffic-aggregate').filter({ hasText: '7 in flight' });
    await expect(aggregate).toContainText('7 in flight · 7 out / 0 back');
    const flow = page.getByTestId(`edge-${linkId}`);
    await expect(flow.getByTestId('traffic-packet')).toHaveCount(0);
    await expect(flow.locator('path[data-direction="out"]')).toHaveCSS('animation-name', 'none');
    // Select the connection through the canvas click path used by the inspector.
    const wrapper = page.locator('.react-flow__edge').filter({ has: flow });
    await wrapper.locator('.react-flow__edge-interaction').dispatchEvent('click');
    await expect(page.getByTestId('traffic-units')).toContainText('7 units in transit');
    await expect(page.getByTestId('traffic-units').locator('div.flex')).toHaveCount(7);
    await page.screenshot({ path: test.info().outputPath('canvas-playback-aggregate.png') });
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
for (const reduced of [false, true]) test(`recorded flashes survive pause and seeking (${reduced ? 'reduced' : 'normal'} motion)`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await openS06(page);
  await setTraffic(page, { mode: 'bulk', requests: 1 }, 'Checkout API A');
  const edgeId = await configurePlaybackLink(page);
  await setSpeed(page, '16');
  await page.getByTestId('scenario-run-btn').click();
  await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 20000 });
  const nodeOutcome = page.locator('.component-node [data-testid="traffic-flash"][data-kind="outcome"]');
  await expect(nodeOutcome.first()).toBeVisible();
  await expect(nodeOutcome.first()).toHaveAttribute('data-outcome', 'ok');
  await page.screenshot({ path: test.info().outputPath(`outcomes-${reduced ? 'reduced' : 'normal'}.png`) });
  const seeker = page.getByRole('slider', { name: 'Playback position' });
  const root = page.getByTestId('timeline-track');
  const edge = page.getByTestId(`edge-${edgeId}`);
  // Pixel seek to a little after the recorded send/arrival: allow rounding while staying within 240 ms.
  const seek = async (ms: number) => {
    const end = Number((await seeker.getAttribute('aria-valuemax')));
    const box = (await root.boundingBox())!;
    await root.click({ position: { x: box.width * ms / end, y: box.height / 2 } });
  };
  await seeker.focus();
  await seeker.press('Home');
  await seek(100);
  const send = edge.locator('[data-testid="traffic-flash"][data-kind="sent"]').first();
  await expect(send).toBeVisible();
  await expect(send).toHaveAttribute('data-reduced', String(reduced));
  await expect.poll(async () => Number(await send.getAttribute('data-age'))).toBeGreaterThan(0);
  const age = await send.getAttribute('data-age');
  await page.waitForTimeout(200);
  await expect(send).toHaveAttribute('data-age', age!);
  if (reduced) await expect(send).toHaveAttribute('opacity', '1');
  await seek(5100);
  await expect(edge.locator('[data-testid="traffic-flash"][data-kind="arrived"]')).toBeVisible();
  await expect(edge.locator('[data-testid="traffic-flash"][data-kind="outcome"]')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath(`arrival-${reduced ? 'reduced' : 'normal'}.png`) });
  // The response may depart as the request arrives; both truthful endpoint cues coexist.
  await seek(5500);
  await expect(edge.getByTestId('traffic-flash')).toHaveCount(0);
  await seeker.focus();
  await seeker.press('Home');
  await seek(100);
  await expect(send).toBeVisible();
  await expect.poll(async () => Number(await send.getAttribute('data-age'))).toBeGreaterThan(0);
  await page.screenshot({ path: test.info().outputPath(`flashes-${reduced ? 'reduced' : 'normal'}.png`) });
  await page.keyboard.press('F2');
  await page.getByTestId('quick-options-input').fill('Reset run');
  await page.getByTestId('quick-option-run.reset').click();
  await expect(page.getByTestId('traffic-flash')).toHaveCount(0);
});

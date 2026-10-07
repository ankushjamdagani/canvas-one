import { expect, test, speedTrigger, type Page } from './fixtures';
import { speed as sourceSpeed } from './simulation-support';

async function openS06(page: Page) {
  await page.goto('/projects');
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
    .locator('[data-selected="true"]').getByRole('button', { name: /^Edit scenario/ })
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
const requestedSpeed = new WeakMap<Page, number>();
async function setSpeed(page: Page, value: string) {
  await page.removeLocatorHandler(speedTrigger(page));
  requestedSpeed.set(page, Number(value));
  if (await speedTrigger(page).isVisible()) await sourceSpeed(page, Number(value));
}

async function runScenario(page: Page) {
  await page.getByTestId('scenario-run-btn').click();
  await expect(speedTrigger(page)).toBeVisible();
  await sourceSpeed(page, requestedSpeed.get(page) ?? 4);
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
    await setSpeed(page, '4');

    await runScenario(page);
    await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
    // Nothing ends it by itself.
    await page.waitForTimeout(1500);
    await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
    await expect(page.getByTestId('playback-status')).not.toContainText(/complete/i);

    await page.getByRole('button', { name: 'Stop run', exact: true }).click();
    await expect(page.getByTestId('playback-status')).toContainText(/stopped/i, { timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toHaveCount(0);
  });

  test('a stream is not cut off by the event budget, and Stop still completes it', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'stream', rate: 100 });
    // The approved 4× playback rate keeps this stream advancing beyond the initial recording window.
    await setSpeed(page, '4');
    await runScenario(page);
    await page.waitForTimeout(8000);
    await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeVisible();
    await expect(page.getByTestId('playback-status')).not.toContainText(/complete/i);
    await page.getByRole('button', { name: 'Stop run', exact: true }).click();
    await expect(page.getByTestId('playback-status')).toContainText(/stopped/i, { timeout: 40000 });
  });

  test('a bulk sends that many requests and ends by itself when they have settled', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 120 });
    await setSpeed(page, '4');
    await runScenario(page);
    await expect(page.getByTestId('playback-status')).toContainText(/complete/i, { timeout: 20000 });
  });

  test('real time takes real time; faster playback advances the recording', async ({ page }) => {
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 300, overMs: 3000 });

    await setSpeed(page, '1');
    const start = Date.now();
    await runScenario(page);
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('playback-status')).not.toContainText(/complete/i);
    await expect(page.getByTestId('playback-status')).toContainText(/complete/i, { timeout: 15000 });
    expect(Date.now() - start).toBeGreaterThan(2500);

    await setSpeed(page, '4');
    const instantStart = Date.now();
    await runScenario(page);
    await expect(page.getByTestId('playback-status')).toContainText(/complete/i, { timeout: 15000 });
    expect(Date.now() - instantStart).toBeLessThan(2500);
  });

  test('canvas shows exact low traffic and simultaneous node populations without changing geometry', async ({ page }) => {
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
    const database = page.locator('.component-node').filter({ has: page.getByText('Orders DB', { exact: true }) });
    const before = await database.boundingBox();
    await runScenario(page);
    const edge = page.getByTestId(`edge-${linkId}`);
    await expect(edge.locator('[data-cells-lanes-connection]')).toHaveAttribute('data-forward', '6');
    await expect(edge.locator('[data-traffic-band]')).toHaveCount(0);
    const packets = edge.locator('path[data-traffic-marker][data-direction="out"]');
    await expect(packets).toHaveCount(3);
    const first = await packets.first().getAttribute('transform');
    await expect.poll(() => packets.first().getAttribute('transform')).not.toBe(first);
    const activity = database.locator('[data-cells-lanes-node]');
    await expect(activity).toHaveAttribute('data-queued', '5', { timeout: 15000 });
    await expect(activity).toHaveAttribute('data-processing', '1');
    await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
    await activity.hover();
    await expect(activity.locator('[data-traffic-inspection]')).toContainText('5 items');
    await expect(activity.locator('[data-traffic-inspection]')).toContainText('1 of 1 slots');
    const after = await database.boundingBox();
    expect(after?.width).toBeCloseTo(before!.width, 1);
    expect(after?.height).toBeCloseTo(before!.height, 1);
    await page.screenshot({ path: test.info().outputPath('canvas-playback-occupancy.png') });
    await setSpeed(page, '4');
    await page.getByRole('button', { name: 'Play recording', exact: true }).click();
    await expect(page.getByTestId('playback-status')).toContainText(/complete/i, { timeout: 20000 });
    await expect(page.locator('[data-traffic-marker]')).toHaveCount(0);
    await expect(page.locator('[data-cells-lanes-node][data-processing="1"]')).toHaveCount(0);
  });

  test('high traffic keeps exact counts with bounded reduced-motion lane markers', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 120 }, 'Checkout API A');
    const linkId = await configurePlaybackLink(page);
    await setSpeed(page, '1');
    await page.locator(`.react-flow__edge[data-id="${linkId}"]`).locator('.react-flow__edge-interaction').dispatchEvent('click');
    await expect(page.getByTestId('inspector-field-config.latencyMs')).toHaveValue('5000');
    await runScenario(page);
    const flow = page.getByTestId(`edge-${linkId}`);
    await expect(flow.locator('[data-cells-lanes-connection]')).toHaveAttribute('data-forward', '64');
    await expect(page.locator('.component-node').filter({ has: page.getByText('Checkout API A', { exact: true }) }).locator('[data-cells-lanes-node]')).toHaveAttribute('data-queued', '56');
    const markers = flow.locator('path[data-traffic-marker][data-direction="out"]');
    await expect(markers).toHaveCount(12);
    await expect(flow.locator('[data-traffic-band]')).toHaveCount(1);
    const transforms = await markers.evaluateAll(els => els.map(el => el.getAttribute('transform')));
    await page.waitForTimeout(200);
    expect(await markers.evaluateAll(els => els.map(el => el.getAttribute('transform')))).toEqual(transforms);
    const summary = page.locator('[data-traffic-connection-inspection][aria-label*="64 forward"]').first();
    await summary.hover();
    await expect(summary.locator('[data-traffic-inspection]')).toContainText('64 requests in flight');
    await summary.click();
    await page.mouse.move(0, 0);
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await summary.press('Escape');
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: test.info().outputPath('canvas-playback-aggregate.png') });
  });

  test('scenario popover offers authoring actions for the selected scenario', async ({ page }) => {
    await openS06(page);
    await page.getByTestId('scenario-switcher-trigger').click();
    const popover = page.getByTestId('scenario-switcher-popover');
    await expect(popover.locator('[data-testid^="scenario-row-"][aria-pressed="true"]')).toHaveCount(1);
    const selectedRow = popover.locator('[data-selected="true"]');
    for (const name of ['Duplicate', 'Edit', 'Delete']) await expect(selectedRow.getByRole('button', { name: new RegExp(`^${name} scenario`) })).toBeVisible();
    await expect(popover.getByRole('button', { name: /Actions for scenario/ })).toHaveCount(0);
    await expect(popover.getByTestId('run-speed-select')).toHaveCount(0);
    await expect(popover.getByRole('button', { name: 'New scenario' })).toBeVisible();
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

test('real spread traffic coexists in forward and returning lanes', async ({ page }) => {
  await openS06(page);
  await setTraffic(page, { mode: 'bulk', requests: 6, overMs: 10000 }, 'Checkout API A');
  const edgeId = await configurePlaybackLink(page);
  await setSpeed(page, '4');
  await runScenario(page);
  await expect(page.getByTestId('playback-status')).toContainText(/complete/i, { timeout: 20000 });
  const seeker = page.getByRole('slider', { name: 'Simulation playhead' });
  const track = seeker;
  const end = Number(await seeker.getAttribute('aria-valuemax'));
  const box = (await track.boundingBox())!;
  await track.click({ position: { x: box.width * 6000 / end, y: box.height / 2 } });
  const edge = page.getByTestId(`edge-${edgeId}`);
  const lane = edge.locator('[data-cells-lanes-connection]');
  await expect.poll(async () => Number(await lane.getAttribute('data-forward'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await lane.getAttribute('data-returning'))).toBeGreaterThan(0);
  const forward = Number(await lane.getAttribute('data-forward'));
  const returning = Number(await lane.getAttribute('data-returning'));
  expect(forward + returning).toBeLessThanOrEqual(6);
  for (const direction of ['out', 'back']) {
    const count = await edge.locator(`[data-traffic-marker][data-direction="${direction}"]`).count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(12);
  }
  const caller = page.locator('.component-node').filter({ has: page.getByText('Checkout API A', { exact: true }) });
  const activity = caller.locator('[data-cells-lanes-node]');
  const awaiting = Number(await activity.getAttribute('data-awaiting'));
  expect(awaiting).toBeGreaterThanOrEqual(forward + returning);
  expect(awaiting).toBeLessThanOrEqual(6);
  await activity.hover();
  await expect(activity.locator('[data-traffic-inspection]')).toContainText(`${awaiting} calls`);
  await expect(activity.locator('[data-traffic-inspection]')).toContainText('Orders DB');
  await page.screenshot({ path: test.info().outputPath('cells-and-lanes-dual-direction.png') });
});

test.describe('Cells and Lanes touch inspection', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a real tap pins paused activity without changing authoring selection', async ({ page }) => {
    // Configure using the full editor, then exercise the recorded canvas at phone size.
    await page.setViewportSize({ width: 1512, height: 982 });
    await openS06(page);
    await setTraffic(page, { mode: 'bulk', requests: 1 }, 'Checkout API A');
    const edgeId = await configurePlaybackLink(page);
    await setSpeed(page, '4');
    await runScenario(page);
    await expect(page.getByTestId('playback-status')).toContainText(/complete/i, { timeout: 20000 });
    const seeker = page.getByRole('slider', { name: 'Simulation playhead' });
    await seeker.focus();
    await seeker.press('Home');
    const track = seeker;
    const end = Number(await seeker.getAttribute('aria-valuemax'));
    const box = (await track.boundingBox())!;
    await track.click({ position: { x: box.width * 100 / end, y: box.height / 2 } });
    await expect(page.getByTestId(`edge-${edgeId}`).locator('[data-cells-lanes-connection]')).toHaveAttribute('data-forward', '1');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await page.keyboard.press('F2');
    await page.getByTestId('quick-options-input').fill('Fit view');
    await page.getByTestId('quick-option-canvas.fit').click();
    const selectedIds = () => page.locator('.react-flow__node.selected, .react-flow__edge.selected').evaluateAll(els => els.map(el => el.getAttribute('data-id')).sort());
    const selection = await selectedIds();
    const caller = page.locator('.component-node').filter({ has: page.getByText('Checkout API A', { exact: true }) });
    const activity = caller.locator('[data-cells-lanes-node]');
    await expect(activity).toHaveAttribute('data-awaiting', '2');
    await activity.tap();
    await expect(activity).toHaveAttribute('aria-expanded', 'true');
    const inspection = activity.locator('[data-traffic-inspection]');
    await expect(inspection).toContainText('2 calls');
    const inspectionBox = (await inspection.boundingBox())!;
    expect(inspectionBox.x).toBeGreaterThanOrEqual(0);
    expect(inspectionBox.x + inspectionBox.width).toBeLessThanOrEqual(390);
    expect(inspectionBox.y + inspectionBox.height).toBeLessThanOrEqual(844);
    expect(await selectedIds()).toEqual(selection);
    await page.waitForTimeout(200);
    await expect(activity).toHaveAttribute('data-awaiting', '2');
    await expect(activity).toHaveAttribute('aria-expanded', 'true');
    await activity.tap();
    await expect(activity).toHaveAttribute('aria-expanded', 'false');
    // Assistive activation remains available after touch without a keyboard event.
    await activity.dispatchEvent('click', { detail: 0 });
    await expect(activity).toHaveAttribute('aria-expanded', 'true');
    await activity.press('Escape');
    await expect(activity).toHaveAttribute('aria-expanded', 'false');
    const laneInspection = page.locator('[data-traffic-connection-inspection][aria-label="call · SQL: 1 forward, 0 returning, 0 blocked"]');
    await laneInspection.tap();
    await expect(laneInspection).toHaveAttribute('aria-expanded', 'true');
    await laneInspection.tap();
    await expect(laneInspection).toHaveAttribute('aria-expanded', 'false');
    await laneInspection.dispatchEvent('click', { detail: 0 });
    await expect(laneInspection).toHaveAttribute('aria-expanded', 'true');
    await laneInspection.press('Escape');
    expect(await selectedIds()).toEqual(selection);
    await page.screenshot({ path: test.info().outputPath('cells-and-lanes-touch.png') });
  });
});
for (const reduced of [false, true]) test(`Cells and Lanes supports paused seeking and inspection (${reduced ? 'reduced' : 'normal'} motion)`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await openS06(page);
  await setTraffic(page, { mode: 'bulk', requests: 1 }, 'Checkout API A');
  const edgeId = await configurePlaybackLink(page);
  await setSpeed(page, '4');
  await runScenario(page);
  await expect(page.getByTestId('playback-status')).toContainText(/complete/i, { timeout: 20000 });
  const seeker = page.getByRole('slider', { name: 'Simulation playhead' });
  const root = seeker;
  const edge = page.getByTestId(`edge-${edgeId}`);
  const lane = edge.locator('[data-cells-lanes-connection]');
  const seek = async (ms: number) => {
    const end = Number(await seeker.getAttribute('aria-valuemax'));
    const box = (await root.boundingBox())!;
    await root.click({ position: { x: box.width * ms / end, y: box.height / 2 } });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  await seeker.focus();
  await seeker.press('Home');
  await seek(100);
  await expect(lane).toHaveAttribute('data-forward', '1');
  await expect(lane).toHaveAttribute('data-returning', '0');
  const marker = edge.locator('[data-traffic-marker]').first();
  await expect(marker).toBeVisible();
  const transform = await marker.getAttribute('transform');
  await page.waitForTimeout(200);
  await expect(marker).toHaveAttribute('transform', transform!);
  const caller = page.locator('.component-node').filter({ has: page.getByText('Checkout API A', { exact: true }) });
  const activity = caller.locator('[data-cells-lanes-node]');
  await expect(activity).toHaveAttribute('data-awaiting', '2');
  await activity.hover();
  await expect(activity.locator('[data-traffic-inspection]')).toContainText('2 calls');
  await expect(activity.locator('[data-traffic-inspection]')).toContainText('Orders DB');
  await expect(activity.locator('[data-traffic-inspection]')).toContainText('Payment service');
  await activity.click();
  await page.mouse.move(0, 0);
  await expect(activity).toHaveAttribute('aria-expanded', 'true');
  await activity.press('Escape');
  await expect(activity).toHaveAttribute('aria-expanded', 'false');
  // Keyboard focus opens the same inspection without selecting the authoring card.
  await page.keyboard.press('Tab');
  await activity.focus();
  await expect(activity).toHaveAttribute('aria-expanded', 'true');
  await activity.press('Escape');
  await seek(5500);
  await expect(lane).toHaveAttribute('data-forward', '0');
  await expect(lane).toHaveAttribute('data-returning', '1');
  await expect(edge.locator('[data-traffic-marker][data-direction="back"]')).toHaveCount(1);
  await expect(activity).toHaveAttribute('data-awaiting', '1');
  const outcome = page.locator('.component-node').filter({ has: page.getByText('Orders DB', { exact: true }) }).locator('[data-traffic-outcome-tray]');
  await expect(outcome).toContainText('0.1/s');
  await expect(outcome.locator('[title^="Success:"]')).toHaveAttribute('title', /last 10s/);
  await seek(100);
  await expect(lane).toHaveAttribute('data-forward', '1');
  await expect(outcome).toContainText('No events');
  await page.screenshot({ path: test.info().outputPath(`cells-and-lanes-${reduced ? 'reduced' : 'normal'}.png`) });
  await page.keyboard.press('F2');
  await page.getByTestId('quick-options-input').fill('Reset run');
  await page.getByTestId('quick-option-run.reset').click();
  await expect(page.locator('[data-traffic-marker]')).toHaveCount(0);
  await expect(page.locator('[data-cells-lanes-node]')).toHaveCount(0);
});

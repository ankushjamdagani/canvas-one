import { test, expect } from "./fixtures";
import { recording, tab, savedRunCount, runAll } from "./simulation-support";

test('logical terminal result exposes measured components without fabricating a recording', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s01').click();
  await page.getByTestId('scenario-run-btn').click();
  await expect.poll(() => savedRunCount(page)).toBe(1);
  const pane = await tab(page, 'Components');
  const components = pane.getByRole('region', { name: 'Measured component metrics' });
  await expect(components).toContainText('Whole recorded result');
  const metrics = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('system-studio-local-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<any[]>((resolve, reject) => {
      const request = database.transaction('runs').objectStore('runs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records[0].summary.elementMetrics as Array<{ key: string; value: number | null; available: boolean; scope: string }>;
  });
  expect(metrics).toEqual([]);
  await expect(components.locator('[aria-label^="Unavailable:"]')).not.toHaveCount(0);
  await expect(pane.getByTestId('scope-started')).toHaveText('Unavailable');
  await expect(pane.getByTestId('cycle-inspection-row')).toHaveCount(0);
  await expect(pane).toContainText('Cycle telemetry unavailable');
  await expect(page.getByRole('slider', { name: 'Simulation playhead', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('playback-panel')).not.toContainText(/requests started per 0 ms|0\.0 s/i);
  await page.screenshot({ path: test.info().outputPath('source-logical-inspection.png') });
});

test('noninteractive timed Run all maps genuine terminal component metrics without a playback store', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await runAll(page);
  await expect.poll(() => savedRunCount(page), { timeout: 60000 }).toBe(3);
  const metrics = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('system-studio-local-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<any[]>((resolve, reject) => {
      const request = database.transaction('runs').objectStore('runs').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    records.sort((a, b) => b.completedAt - a.completedAt);
    return records[0].summary.elementMetrics as Array<{ key: string; value: number | null; available: boolean; scope: string }>;
  });
  const pane = await tab(page, 'Components');
  const components = pane.getByRole('region', { name: 'Measured component metrics' });
  await expect(components).toContainText('Whole recorded result');
  const observed = metrics.filter(metric => metric.available && metric.value !== null && metric.scope === 'element' && ['meanLatencyMs', 'p95LatencyMs'].includes(metric.key));
  expect(observed.length).toBeGreaterThan(0);
  for (const metric of observed) await expect(components).toContainText(`${metric.key === 'meanLatencyMs' ? 'mean' : 'p95'} ${metric.value!.toFixed(1)} ms`);
  await expect(pane.getByTestId('scope-started')).toHaveText('Unavailable');
  await expect(page.getByRole('slider', { name: 'Simulation playhead', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('playback-time')).toHaveText('—');
  await expect(page.getByTestId('playback-panel')).not.toContainText(/requests started per 0 ms|0\.0 s/i);
  await page.screenshot({ path: test.info().outputPath('source-timed-terminal-inspection.png') });
});

test("source Summary shows observed counts and truthful scope", async ({
  page,
}) => {
  await recording(page);
  const pane = await tab(page, "Summary");
  await expect(pane.getByTestId("scope-started")).toContainText("6");
  await expect(pane.getByTestId("scope-completed")).toContainText("6");
  await expect(pane.getByTestId("scope-failed")).toContainText("0");
  await expect(pane.getByTestId("scope-open")).toContainText("0");
  await expect(pane.getByTestId("scope-mean")).toContainText(/\d/);
  await expect(pane.getByTestId("scope-p95")).toContainText(/\d/);
  await expect(pane).not.toContainText(/undefined|NaN|\[object/);
});

test("source Components exposes authored names and measured observations", async ({
  page,
}) => {
  await recording(page);
  const pane = await tab(page, "Components");
  await expect(pane).toContainText("Orders DB");
  await expect(pane).toContainText(/mean/i);
  await expect(pane).toContainText(/p95/i);
  await expect(pane).toContainText(/fail/i);
  await expect(pane).not.toContainText(/undefined|NaN|\[object/);
});

import { test, expect, speedTrigger } from "./fixtures";
import {
  recording,
  traffic,
  speed,
  inspect,
  range,
  tab,
  savedRunCount,
} from "./simulation-support";

test.beforeEach(async ({ page }) => {
  await page.removeLocatorHandler(speedTrigger(page));
});

test("source ±10ms steps, speed, pause and completed replay preserve the playhead", async ({
  page,
}) => {
  await recording(page);
  const seeker = page.getByRole("slider", {
    name: "Simulation playhead",
    exact: true,
  });
  await seeker.focus();
  await seeker.press("Home");
  await page
    .getByRole("button", { name: "Step forward 10 ms", exact: true })
    .click();
  await expect(seeker).toHaveAttribute("aria-valuenow", "10");
  await page
    .getByRole("button", { name: "Step back 10 ms", exact: true })
    .click();
  await expect(seeker).toHaveAttribute("aria-valuenow", "0");
  await speed(page, 0.5);
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect
    .poll(async () => Number(await seeker.getAttribute("aria-valuenow")))
    .toBeGreaterThan(50);
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  const at = await seeker.getAttribute("aria-valuenow");
  await page.waitForTimeout(200);
  await expect(seeker).toHaveAttribute("aria-valuenow", at!);
  for (const value of [1, 2, 4]) await speed(page, value);
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect(page.getByTestId("playback-status")).toContainText(
    /complete/i,
    { timeout: 10000 },
  );
  await expect(seeker).toHaveAttribute(
    "aria-valuenow",
    (await seeker.getAttribute("aria-valuemax"))!,
  );
});

test("source selected range can play, loop and clear without changing recording", async ({
  page,
}) => {
  await recording(page);
  await range(page);
  const pane = await tab(page, "Summary");
  await expect(pane).toContainText('Range');
  await page
    .getByRole("button", { name: "Loop selected range", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Loop selected range", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Play selected range", exact: true })
    .click();
  await page.waitForTimeout(250);
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  await pane.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(pane).toContainText('Through playhead');
});

test("Back to live resumes a paused stream and Stop drains it", async ({
  page,
}) => {
  await traffic(page, "stream", 6);
  await page.getByTestId("scenario-run-btn").click();
  await expect(
    page.getByRole("button", { name: "Pause playback", exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.waitForTimeout(150);
  const pausedFrontier = await page.getByRole('slider', { name: 'Simulation playhead', exact: true }).getAttribute('aria-valuemax');
  await page.waitForTimeout(250);
  await expect(page.getByRole('slider', { name: 'Simulation playhead', exact: true })).toHaveAttribute('aria-valuemax', pausedFrontier!);
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  const seeker = page.getByRole("slider", {
    name: "Simulation playhead",
    exact: true,
  });
  await seeker.focus();
  await seeker.press("Home");
  const frontier = Number(await seeker.getAttribute('aria-valuemax'));
  const reviewedAt = await seeker.getAttribute('aria-valuenow');
  await expect.poll(async () => Number(await seeker.getAttribute('aria-valuemax'))).toBeGreaterThan(frontier + 100);
  await expect(seeker).toHaveAttribute('aria-valuenow', reviewedAt!);
  await page.getByRole("button", { name: "Back to live", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause playback", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("source-desktop-live.png"),
  });
  await page.getByRole("button", { name: "Stop run", exact: true }).click();
  await expect(page.getByTestId("playback-status")).toContainText(
    /stopped/i,
    { timeout: 20000 },
  );
});

test('finite bulk recording advances while reviewing a selected range', async ({ page }) => {
  await traffic(page, 'bulk', 60, 60000);
  await page.getByTestId('scenario-run-btn').click();
  const seeker = page.getByRole('slider', { name: 'Simulation playhead', exact: true });
  await expect.poll(async () => Number(await seeker.getAttribute('aria-valuemax'))).toBeGreaterThan(500);
  await range(page, .2, .6);
  const frontier = Number(await seeker.getAttribute('aria-valuemax'));
  const reviewedAt = await seeker.getAttribute('aria-valuenow');
  await expect.poll(async () => Number(await seeker.getAttribute('aria-valuemax'))).toBeGreaterThan(frontier + 200);
  await expect(seeker).toHaveAttribute('aria-valuenow', reviewedAt!);
  await page.getByRole('button', { name: 'Back to live', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Live');
  await page.getByRole('button', { name: 'Stop run', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toContainText(/stopped/i, { timeout: 20000 });
  const pane = await tab(page, 'Summary');
  await expect(pane).toContainText('Range');
  await pane.getByRole('button', { name: 'Clear', exact: true }).click();
  const starts = Number(await pane.getByTestId('scope-started').innerText());
  const completions = Number(await pane.getByTestId('scope-completed').innerText());
  expect(starts).toBeGreaterThan(0);
  expect(completions).toBeLessThanOrEqual(starts);
});

test('Stop drains while preserving reviewed time and selected range; End saves the retained recording', async ({ page }) => {
  await traffic(page, 'stream', 6);
  await page.getByTestId('scenario-run-btn').click();
  const seeker = page.getByRole('slider', { name: 'Simulation playhead', exact: true });
  await expect.poll(async () => Number(await seeker.getAttribute('aria-valuemax'))).toBeGreaterThan(1000);
  await range(page, .2, .6);
  const pane = await inspect(page);
  const reviewedAt = await seeker.getAttribute('aria-valuenow');
  await expect(pane).toContainText('Range');
  await expect(page.getByRole('button', { name: 'Loop selected range', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Loop selected range', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loop selected range', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Stop run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Re-run scenario', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(seeker).toHaveAttribute('aria-valuenow', reviewedAt!);
  await expect(pane).toContainText('Range');
  expect(await savedRunCount(page)).toBe(0);
  await page.getByRole('button', { name: 'End of recording', exact: true }).click();
  await expect.poll(() => savedRunCount(page)).toBe(1);
});

test.describe("source mobile transport", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test("speed cycles through approved values and live inspection remains inline", async ({
    page,
  }) => {
    await traffic(page, "stream", 6);
    await page.getByTestId("scenario-run-btn").tap();
    await page.removeLocatorHandler(speedTrigger(page));
    for (const value of [0.5, 1, 2, 4]) await speed(page, value);
    const pane = await inspect(page);
    await expect(pane).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Simulation inspection" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("source-mobile-live.png"),
    });
    await page.getByRole("button", { name: "Stop run", exact: true }).tap();
    await expect(page.getByTestId("playback-status")).toContainText(
      /stopped/i,
      { timeout: 20000 },
    );
  });
});

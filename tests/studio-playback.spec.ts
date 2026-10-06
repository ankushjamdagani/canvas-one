import { test, expect, type Page } from "./fixtures";

async function traffic(page: Page, mode: "bulk" | "stream", amount: number) {
  await page.goto("/");
  await page.getByTestId("create-example-s06").click();
  await page.getByTestId("scenario-switcher-trigger").click();
  await page
    .getByTestId("scenario-switcher-popover")
    .locator('[data-testid^="scenario-row-"]', {
      has: page.locator('button[aria-pressed="true"]'),
    })
    .getByRole("button", { name: /^Edit scenario/ })
    .click();
  const editor = page.getByTestId("scenario-editor");
  const row = editor.locator('[data-testid^="workload-row-"]').first();
  await row.getByLabel("Sends").selectOption(mode);
  if (mode === "bulk") {
    await row.getByTestId("bulk-requests").fill(String(amount));
    await row.getByTestId("bulk-arrival").selectOption("spread");
    await row.getByTestId("bulk-spread").fill("3000");
  } else {
    await row.getByTestId("stream-rate").fill(String(amount));
  }
  await editor.getByTestId("scenario-editor-apply").click();
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "idle",
  );
  await editor
    .getByRole("button", { name: /Cancel|Close/ })
    .first()
    .click();
}

test.beforeEach(async ({ page }) => {
  // This suite controls speed explicitly; do not race the shared accelerator.
  await page.removeLocatorHandler(page.getByTestId("playback-speed"));
});

async function setSpeed(page: Page, speed: number) {
  await expect(page.getByTestId("playback-speed")).toBeVisible({ timeout: 20000 });
  const current = Number((await page.getByTestId("playback-speed").textContent())?.replace("×", ""));
  const steps = Math.round(Math.log2(speed / current));
  const label = steps >= 0 ? "Faster playback" : "Slower playback";
  for (let index = 0; index < Math.abs(steps); index++) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeEnabled({ timeout: 20000 });
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByTestId("playback-speed")).toHaveText(`${current * 2 ** ((index + 1) * Math.sign(steps))}×`);
  }
  await expect(page.getByTestId("playback-speed")).toHaveText(`${speed}×`);
}

async function dragTrack(page: Page, from: number, to: number) {
  const track = page.getByTestId("timeline-track");
  const box = (await track.boundingBox())!;
  await page.mouse.move(box.x + box.width * from, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, box.y + box.height * 0.75, { steps: 8 });
  await page.mouse.up();
}

async function openRunResults(page: Page) {
  await page.getByRole('button', { name: /Inspect (Request Cycles|Run Results)/ }).first().click();
  await expect(page.getByRole('tab', { name: 'Run results', exact: true })).toBeVisible();
}

test("pause, seek, speed and completed replay keep results at the playhead", async ({
  page,
}) => {
  await traffic(page, "bulk", 6);
  await page.removeLocatorHandler(page.getByTestId("playback-speed"));
  await page.getByTestId("scenario-run-btn").click();
  await expect(page.getByTestId("timeline-density")).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        (await page.getByTestId("playback-time").textContent())?.replace(
          " s",
          "",
        ),
      ),
    )
    .toBeGreaterThan(0.6);
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  const time = await page.getByTestId("playback-time").textContent();
  await page.waitForTimeout(200);
  await expect(page.getByTestId("playback-time")).toHaveText(time!);
  const seeker = page.getByRole("slider", { name: "Playback position" });
  await seeker.focus();
  await seeker.press("Home");
  await expect(page.getByTestId("playback-time")).toHaveText("0.00 s");
  await openRunResults(page);
  await expect(page.getByTestId("results-cycles")).toContainText("1 all-work cycles");
  await page.getByRole("button", { name: "Next cycle", exact: true }).click();
  await expect(page.getByTestId("playback-time")).not.toHaveText("0.00 s");
  await setSpeed(page, 16);
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect(page.getByTestId("playback-status")).toContainText(
    /completed/i,
    { timeout: 20000 },
  );
  await expect(page.getByTestId("results-cycles")).toContainText("6 all-work cycles");
  const finalTime = await page.getByTestId("playback-time").textContent();
  await seeker.focus();
  await seeker.press("Home");
  await expect(page.getByTestId("results-cycles")).toContainText("1 all-work cycles");
  await expect(page.getByTestId("playback-status")).toContainText(
    /paused/i,
  );
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("playback-status")).toContainText(
    /completed/i,
    { timeout: 10000 },
  );
  await expect(page.getByTestId("playback-time")).toHaveText(finalTime!);
  await page.screenshot({ path: test.info().outputPath("simulation-completed.png") });
  await page.screenshot({
    path: test.info().outputPath("timeline-desktop.png"),
  });
});

test.describe("touch phone playback", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test("a dense bulk uses a density strip and playback controls fit a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await traffic(page, "bulk", 250);
    await page.getByTestId("scenario-run-btn").click();
    await setSpeed(page, 16);
    await expect(page.getByTestId("playback-status")).toContainText(
      /completed/i,
      { timeout: 20000 },
    );
    await expect(page.getByTestId("timeline-density")).toBeVisible();
    await expect(page.getByTestId("timeline-cycle")).toHaveCount(0);
    await expect(page.getByTestId("timeline-density")).toHaveAttribute(
      "aria-label",
      /250 cycles/,
    );
    await page.getByRole("button", { name: "Loop recording", exact: true }).click();
    await expect(page.getByRole("button", { name: "Loop recording", exact: true })).toHaveAttribute("aria-pressed", "true");
    const width = await page
      .getByTestId("playback-panel")
      .evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
    for (const button of await page
      .getByTestId("playback-panel")
      .getByRole("button")
      .all()) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("slider", { name: "Playback position" }).focus();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("playback-time")).toHaveText("0.00 s");
    await dragTrack(page, 0.2, 0.8);
    const inspectionSheet = page.getByRole("dialog", { name: "Simulation inspection" });
    await expect(inspectionSheet).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("simulation-mobile-sheet.png") });
    await inspectionSheet.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole('slider', { name: 'Playback range start' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Playback range end' })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 640 });
    await expect.poll(() => page.getByTestId('playback-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect.poll(async () => (await page.locator('.react-flow__pane').boundingBox())?.height ?? 0).toBeGreaterThan(80);
    await page.screenshot({
      path: test.info().outputPath("timeline-phone.png"),
    });
  });
});

test("Go live resumes a paused stream and Stop drains it", async ({ page }) => {
  await traffic(page, "stream", 6);
  await page.getByTestId("scenario-run-btn").click();
  await setSpeed(page, 16);
  await expect(
    page.getByRole("button", { name: "Go live", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("timeline-density")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("simulation-running-live.png") });
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  const seeker = page.getByRole("slider", { name: "Playback position" });
  await seeker.focus();
  await seeker.press("Home");
  await expect(page.getByTestId("playback-time")).toHaveText("0.00 s");
  await dragTrack(page, 0.2, 0.8);
  await page.getByRole('slider', { name: 'Playback range end' }).press('Home');
  await page.getByRole('button', { name: 'Play selected range', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Range ended');
  await page.getByRole('tab', { name: 'Run results', exact: true }).click();
  const liveSummary = page.getByTestId('results-cycles');
  await expect(liveSummary).toContainText(/Through \d/);
  await expect(liveSummary).toContainText('Whole-run checks not evaluated');
  await page.getByRole("button", { name: "Go live", exact: true }).click();
  await expect(page.getByTestId('playback-range')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pause playback", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("playback-time")).not.toHaveText("0.00 s");
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Stop the run and keep its results", exact: true })
    .click();
  await expect(page.getByTestId("playback-status")).toContainText(
    /completed/i,
    { timeout: 20000 },
  );
  await page.screenshot({ path: test.info().outputPath("simulation-stream-completed.png") });
});

test('selects, plays, loops and clears a recorded time range', async ({ page }) => {
  await traffic(page, 'bulk', 6);
  await page.getByTestId('scenario-run-btn').click();
  await setSpeed(page, 16);
  await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 20000 });
  await dragTrack(page, .25, .75);
  await expect(page.getByRole('region', { name: 'Cycle inspection' })).toContainText('Cycles in range');
  const start = page.getByRole('slider', { name: 'Playback range start' });
  const end = page.getByRole('slider', { name: 'Playback range end' });
  const originalStart = Number(await start.getAttribute('aria-valuenow'));
  const originalEnd = Number(await end.getAttribute('aria-valuenow'));
  await dragTrack(page, .35, .55); // dragging inside the current highlight replaces it
  await expect(start).not.toHaveAttribute('aria-valuenow', String(originalStart));
  await expect(end).not.toHaveAttribute('aria-valuenow', String(originalEnd));
  const before = Number(await start.getAttribute('aria-valuenow'));
  await start.press('ArrowRight');
  await expect.poll(async () => Number(await start.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
  const startMs = Number(await start.getAttribute('aria-valuenow'));
  const endMs = Number(await end.getAttribute('aria-valuenow'));
  expect(startMs).toBeGreaterThan(0);
  expect(endMs).toBeGreaterThan(startMs);
  expect(endMs).toBeLessThan(Number(await end.getAttribute('aria-valuemax')));
  await expect(page.getByTestId('playback-range-highlight')).toBeVisible();
  await page.getByRole('button', { name: 'Play selected range', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Range ended');
  await expect(page.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuenow', String(endMs));
  await page.getByRole('button', { name: 'Loop selected range', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Loop selected range', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Play selected range', exact: true }).click();
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  const at = Number(await page.getByRole('slider', { name: 'Playback position' }).getAttribute('aria-valuenow'));
  expect(at).toBeGreaterThanOrEqual(startMs); expect(at).toBeLessThanOrEqual(endMs);
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('playback-range.png') });
  await page.getByTestId('timeline-track').hover();
  await page.getByRole('button', { name: 'Clear selected range', exact: true }).click();
  await expect(page.getByTestId('playback-range-highlight')).toHaveCount(0);
  await expect(start).toHaveCount(0);
  await page.getByRole('button', { name: 'Loop recording', exact: true }).click();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toContainText(/completed/i);
});

test.describe("native touch timeline gestures", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test("two-finger pinch zooms the visible timeline without seeking", async ({ page }) => {
    await traffic(page, "bulk", 6);
    await page.getByTestId("scenario-run-btn").click();
    await expect(page.getByTestId("playback-status")).toContainText(/completed/i, { timeout: 20000 });
    const timeline = page.getByTestId("playback-timeline");
    const track = page.getByTestId("timeline-track");
    await expect(timeline.getByRole('toolbar', { name: 'Timeline tools' })).toBeVisible();
    await expect(timeline.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('timeline-mobile-toolbar.png') });
    const box = (await track.boundingBox())!;
    const playhead = page.getByRole("slider", { name: "Playback position" });
    const timeBefore = await playhead.getAttribute("aria-valuenow");
    const axis = timeline.getByTestId("timeline-window-end");
    const axisBefore = await axis.innerText();
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 24, y, id: 1, radiusX: 4, radiusY: 4, force: 1 },
        { x: x + 24, y, id: 2, radiusX: 4, radiusY: 4, force: 1 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 62, y, id: 1, radiusX: 4, radiusY: 4, force: 1 },
        { x: x + 62, y, id: 2, radiusX: 4, radiusY: 4, force: 1 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await expect.poll(() => axis.innerText()).not.toBe(axisBefore);
    await expect(playhead).toHaveAttribute("aria-valuenow", timeBefore!);
  });
});

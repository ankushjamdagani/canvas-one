import { test, expect, type Page } from "./fixtures";

async function traffic(page: Page, mode: "bulk" | "stream", amount: number) {
  await page.goto("/");
  await page.getByTestId("create-example-s06").click();
  await expect(page.getByTestId("playback-speed")).toBeVisible();
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

test("pause, seek, speed and completed replay keep results at the playhead", async ({
  page,
}) => {
  await traffic(page, "bulk", 6);
  await page.getByTestId("playback-speed").selectOption("1");
  await page.getByTestId("scenario-run-btn").click();
  await expect(page.getByTestId("timeline-cycle").first()).toBeVisible();
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
  await expect(page.getByTestId("results-cycles")).toContainText("1 cycles");
  await page.getByRole("button", { name: "Next cycle", exact: true }).click();
  await expect(page.getByTestId("playback-time")).not.toHaveText("0.00 s");
  await page.getByTestId("playback-speed").selectOption("16");
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect(page.getByTestId("results-status-badge")).toContainText(
    "completed",
    { timeout: 20000 },
  );
  await expect(page.getByTestId("results-cycles")).toContainText("6 cycles");
  const finalTime = await page.getByTestId("playback-time").textContent();
  await seeker.focus();
  await seeker.press("Home");
  await expect(page.getByTestId("results-cycles")).toContainText("1 cycles");
  await expect(page.getByTestId("results-status-badge")).toContainText(
    "paused",
  );
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("results-status-badge")).toContainText(
    "completed",
    { timeout: 10000 },
  );
  await expect(page.getByTestId("playback-time")).toHaveText(finalTime!);
  await expect(page.getByTestId("results-region")).toContainText("Saved");
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
    await page.getByTestId("playback-speed").selectOption("16");
    await page.getByTestId("scenario-run-btn").click();
    await expect(page.getByTestId("results-status-badge")).toContainText(
      "completed",
      { timeout: 20000 },
    );
    await expect(page.getByTestId("timeline-density")).toBeVisible();
    await expect(page.getByTestId("timeline-cycle")).toHaveCount(0);
    await expect(page.getByTestId("timeline-density")).toHaveAttribute(
      "aria-label",
      /250 cycles/,
    );
    await page.getByRole("checkbox", { name: "Loop recording" }).check();
    await expect(
      page.getByRole("checkbox", { name: "Loop recording" }),
    ).toBeChecked();
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
    await page.getByRole('button', { name: 'Select playback range', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Playback range start' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Playback range end' })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.getByTestId('playback-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect((await page.locator('.react-flow__pane').boundingBox())!.height).toBeGreaterThan(80);
    await page.screenshot({
      path: test.info().outputPath("timeline-phone.png"),
    });
  });
});

test("Go live resumes a paused stream and Stop drains it", async ({ page }) => {
  await traffic(page, "stream", 6);
  await page.getByTestId("playback-speed").selectOption("16");
  await page.getByTestId("scenario-run-btn").click();
  await expect(
    page.getByRole("button", { name: "Go live", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("timeline-cycle").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  const seeker = page.getByRole("slider", { name: "Playback position" });
  await seeker.focus();
  await seeker.press("Home");
  await expect(page.getByTestId("playback-time")).toHaveText("0.00 s");
  await page.getByRole('button', { name: 'Select playback range', exact: true }).click();
  await page.getByRole('slider', { name: 'Playback range end' }).press('Home');
  await page.getByRole('button', { name: 'Play selected range', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Range ended');
  await expect(page.getByTestId('results-status-badge')).toContainText('paused');
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
    .getByRole("button", { name: "Stop emission and drain", exact: true })
    .click();
  await expect(page.getByTestId("results-status-badge")).toContainText(
    "completed",
    { timeout: 20000 },
  );
  await expect(page.getByTestId("results-region")).toContainText("Saved");
});

test('selects, plays, loops and clears a recorded time range', async ({ page }) => {
  await traffic(page, 'bulk', 6);
  await page.getByTestId('playback-speed').selectOption('16');
  await page.getByTestId('scenario-run-btn').click();
  await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 20000 });
  await page.getByRole('button', { name: 'Select playback range', exact: true }).click();
  const start = page.getByRole('slider', { name: 'Playback range start' });
  const end = page.getByRole('slider', { name: 'Playback range end' });
  const range = page.getByTestId('playback-range').locator('[data-slot="slider"]');
  const box = (await range.boundingBox())!;
  await range.click({ position: { x: box.width * .75, y: box.height / 2 } });
  await range.click({ position: { x: box.width * .25, y: box.height / 2 } });
  const before = Number(await start.getAttribute('aria-valuenow'));
  await start.press('ArrowRight');
  await expect(start).toHaveAttribute('aria-valuenow', String(before + 1));
  const startMs = Number(await start.getAttribute('aria-valuenow'));
  const endMs = Number(await end.getAttribute('aria-valuenow'));
  expect(startMs).toBeGreaterThan(0);
  expect(endMs).toBeGreaterThan(startMs);
  expect(endMs).toBeLessThan(Number(await end.getAttribute('aria-valuemax')));
  await expect(page.getByTestId('playback-range-highlight')).toBeVisible();
  await page.getByRole('button', { name: 'Play selected range', exact: true }).click();
  await expect(page.getByTestId('playback-status')).toHaveText('Range ended');
  await expect(page.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuenow', String(endMs));
  await expect(page.getByTestId('results-status-badge')).toContainText('paused');
  await page.getByRole('checkbox', { name: 'Loop selected range' }).check();
  await page.getByRole('button', { name: 'Play selected range', exact: true }).click();
  await page.waitForTimeout(300);
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  const at = Number(await page.getByRole('slider', { name: 'Playback position' }).getAttribute('aria-valuenow'));
  expect(at).toBeGreaterThanOrEqual(startMs); expect(at).toBeLessThanOrEqual(endMs);
  await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('playback-range.png') });
  await page.getByRole('button', { name: 'Clear playback range', exact: true }).click();
  await expect(page.getByTestId('playback-range-highlight')).toHaveCount(0);
  await expect(start).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Loop recording' }).uncheck();
  await page.getByRole('button', { name: 'Play recording', exact: true }).click();
  await expect(page.getByTestId('results-status-badge')).toContainText('completed');
});

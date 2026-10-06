import { test, expect, type Page } from "./fixtures";

async function createRecording(page: Page) {
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
  await row.getByLabel("Sends").selectOption("bulk");
  await row.getByTestId("bulk-requests").fill("6");
  await row.getByTestId("bulk-arrival").selectOption("spread");
  await row.getByTestId("bulk-spread").fill("3000");
  await editor.getByTestId("scenario-editor-apply").click();
  await editor.getByRole("button", { name: /Cancel|Close/ }).first().click();
  await page.getByTestId("scenario-run-btn").click();
  await expect(page.getByTestId("playback-status")).toContainText(/completed/i, { timeout: 20000 });
}

async function dragTrack(page: Page, from: number, to: number) {
  const track = page.getByTestId("timeline-track");
  const box = (await track.boundingBox())!;
  await page.mouse.move(box.x + box.width * from, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, box.y + box.height * 0.75, { steps: 8 });
  await page.mouse.up();
}

test("range summary, cycle inspection, and zoom preserve independent state", async ({ page }) => {
  await createRecording(page);
  const playhead = page.getByRole("slider", { name: "Playback position" });
  await playhead.focus();
  await playhead.press("Home");
  await dragTrack(page, 0.05, 0.95);

  const inspection = page.getByRole("region", { name: "Cycle inspection" });
  await expect(inspection).toBeVisible();
  await expect(inspection).toContainText("Cycles in range");
  await expect(inspection).toContainText("Range activity");
  const track = page.getByTestId('timeline-track');
  const trackBox = (await track.boundingBox())!;
  const densityBox = (await page.getByTestId('timeline-density').boundingBox())!;
  expect(Math.abs(densityBox.y - trackBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(densityBox.height - trackBox.height)).toBeLessThanOrEqual(2);
  const windowStartBox = (await page.getByTestId('timeline-window-start').boundingBox())!;
  const windowEndBox = (await page.getByTestId('timeline-window-end').boundingBox())!;
  const legendBox = (await page.getByTestId('timeline-selection-start-legend').boundingBox())!;
  const endLegendBox = (await page.getByTestId('timeline-selection-end-legend').boundingBox())!;
  expect(new Set([windowStartBox.y, windowEndBox.y, legendBox.y, endLegendBox.y]).size).toBe(1);
  for (const box of [windowStartBox, windowEndBox, legendBox, endLegendBox]) {
    expect(box.x).toBeGreaterThanOrEqual(trackBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(trackBox.x + trackBox.width);
  }
  const legendIntervals = [windowStartBox, legendBox, endLegendBox, windowEndBox].sort((a, b) => a.x - b.x);
  for (let index = 1; index < legendIntervals.length; index++) {
    expect(legendIntervals[index].x).toBeGreaterThanOrEqual(legendIntervals[index - 1].x + legendIntervals[index - 1].width - 1);
  }
  expect(legendBox.y).toBeGreaterThanOrEqual(trackBox.y + trackBox.height);
  const toolbar = page.getByRole('toolbar', { name: 'Timeline tools' });
  const toolbarOverlay = page.locator('[data-timeline-control="toolbar"]');
  await page.mouse.move(trackBox.x - 20, trackBox.y - 20);
  await expect.poll(() => toolbarOverlay.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
  await track.hover();
  await expect(toolbar).toBeVisible();
  await expect.poll(() => toolbarOverlay.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  const toolsBox = (await toolbar.boundingBox())!;
  expect(toolsBox.y).toBeGreaterThanOrEqual(trackBox.y);
  expect(toolsBox.y).toBeLessThan(trackBox.y + trackBox.height / 2);
  expect(toolsBox.x + toolsBox.width).toBeLessThanOrEqual(trackBox.x + trackBox.width + 1);
  await toolbar.getByRole('button', { name: 'Seek', exact: true }).focus();
  await page.mouse.move(trackBox.x - 20, trackBox.y - 20);
  await expect.poll(() => toolbarOverlay.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  const start = page.getByRole("slider", { name: "Playback range start" });
  const end = page.getByRole("slider", { name: "Playback range end" });
  const startAtSelection = await start.getAttribute("aria-valuenow");
  const endAtSelection = await end.getAttribute("aria-valuenow");
  const playheadAtSelection = await playhead.getAttribute("aria-valuenow");
  const firstBar = page.locator('[data-density-bin="0"]');
  const originalChunk = await firstBar.getAttribute('title');
  const visibleStart = await page.getByTestId('timeline-window-start').textContent();

  await track.hover();
  await page.getByTestId("playback-timeline").getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(firstBar).not.toHaveAttribute('title', originalChunk!);
  await expect(page.getByTestId('timeline-window-start')).not.toHaveText(visibleStart!);
  await expect(page.getByTestId('playback-range-start')).toContainText('s');
  await expect(start).toHaveAttribute("aria-valuenow", startAtSelection!);
  await expect(end).toHaveAttribute("aria-valuenow", endAtSelection!);
  await expect(playhead).toHaveAttribute("aria-valuenow", playheadAtSelection!);

  const firstCycle = inspection.getByTestId("cycle-inspection-row").first();
  await expect(firstCycle).toBeVisible();
  await firstCycle.click();
  await expect(inspection).toContainText("Response latency");
  await page.screenshot({ path: test.info().outputPath("simulation-desktop-cycle.png") });
  const rangeSummary = inspection.getByRole("button", { name: "Range summary" }).first();
  await expect(rangeSummary).toBeVisible();
  await rangeSummary.click();
  await expect(inspection).toContainText("Range activity");
  await page.screenshot({ path: test.info().outputPath("simulation-desktop-range.png") });
});

test("simulation event inspection preserves a dirty configuration draft", async ({ page }) => {
  await createRecording(page);
  await page.locator('[data-element-id="00000000-0006-4000-8000-000000000004"]').click();
  const inspector = page.getByTestId("inspector-panel");
  await expect(inspector).toBeVisible();
  const capacity = page.getByTestId("inspector-field-config.capacity");
  await capacity.fill("2100");
  await expect(capacity).toHaveValue("2100");

  await page.getByRole("slider", { name: "Playback position" }).focus();
  await page.getByRole("slider", { name: "Playback position" }).press("Home");
  await dragTrack(page, 0.05, 0.95);
  const cycles = page.getByRole("region", { name: "Cycle inspection" });
  const firstCycle = cycles.getByTestId("cycle-inspection-row").first();
  await expect(firstCycle).toBeVisible();
  await firstCycle.click();
  await cycles.getByRole("tab", { name: "Event log" }).click();
  const firstEvent = cycles.getByRole("list", { name: "Recorded lifecycle events" }).getByRole("button").first();
  await expect(firstEvent).toBeVisible();
  await firstEvent.click();

  await expect(page.getByTestId("inspector-guard-dialog")).toHaveCount(0);
  await expect(inspector).toBeVisible();
  await expect(page.getByTestId("inspector-field-config.capacity")).toHaveValue("2100");
});

test("inspection uses the available panel width on desktop", async ({ page }) => {
  await createRecording(page);
  const bars = page.locator('[data-density-bin]');
  const initialBarCount = await bars.count();
  await page.getByTestId("playback-panel").evaluate((panel) => {
    (panel as HTMLElement).style.width = "600px";
  });
  await expect.poll(() => bars.count()).toBeLessThan(initialBarCount);
  await dragTrack(page, 0.05, 0.95);
  const inspection = page.getByRole("region", { name: "Cycle inspection" });
  await expect(inspection).toBeVisible();
  const summary = inspection.getByRole("button", { name: "Range summary" }).first();
  await summary.click();
  await expect(inspection).toContainText("Range activity");
  await expect.poll(async () => inspection.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  await page.screenshot({ path: test.info().outputPath("simulation-narrow-desktop.png") });
});

test("canvas, timeline and inspection panes resize without changing playback", async ({ page }) => {
  await createRecording(page);
  await dragTrack(page, 0.2, 0.8);
  const inspection = page.getByRole('region', { name: 'Cycle inspection' });
  await expect(inspection).toBeVisible();
  const playhead = page.getByRole('slider', { name: 'Playback position' });
  const position = await playhead.getAttribute('aria-valuenow');
  const track = page.getByTestId('timeline-track');
  const timeline = page.getByTestId('playback-timeline');
  const timelineDivider = page.getByTestId('timeline-inspection-resize');
  await timelineDivider.focus();
  await timelineDivider.press('Home');
  await expect(timeline).toBeHidden();
  await expect(timelineDivider).toBeVisible();
  const inspectionToggle = page.getByRole('button', { name: /Inspect Request Cycles/ });
  await expect(inspectionToggle).toBeVisible();
  expect((await timelineDivider.boundingBox())!.y).toBeLessThan((await inspectionToggle.boundingBox())!.y);
  await page.screenshot({ path: test.info().outputPath('simulation-timeline-collapsed.png') });
  await timelineDivider.press('ArrowDown');
  await expect(timeline).toBeVisible();
  await expect.poll(async () => (await track.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await expect(timelineDivider).toHaveAttribute('aria-valuenow', '64');
  const restoredHeight = (await track.boundingBox())!.height;
  await timelineDivider.press('ArrowDown');
  await expect.poll(async () => (await track.boundingBox())!.height).toBeGreaterThan(restoredHeight);
  const horizontal = page.getByTestId('cycle-inspection-resize');
  const originalX = (await horizontal.boundingBox())!.x;
  await horizontal.focus();
  await horizontal.press('ArrowRight');
  await expect.poll(async () => (await horizontal.boundingBox())!.x).toBeGreaterThan(originalX);
  await expect(page.getByRole('separator', { name: 'Resize canvas and simulation' })).toHaveCount(0);
  await expect(playhead).toHaveAttribute('aria-valuenow', position!);
  await page.screenshot({ path: test.info().outputPath('simulation-resized-panes.png') });
});

test("compact simulation fits its controls and returns closed inspection space to the canvas", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("create-example-s06").click();

  const panel = page.getByTestId("playback-panel");
  const controls = panel.locator('[aria-label="Simulation controls"]');
  await expect(panel.getByTestId("playback-status")).toHaveText("Ready");
  const panelBox = (await panel.boundingBox())!;
  const controlsBox = (await controls.boundingBox())!;
  expect(controlsBox.y).toBeGreaterThanOrEqual(panelBox.y);
  expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
  expect(Math.abs(panelBox.height - controlsBox.height)).toBeLessThanOrEqual(2);

  await createRecording(page);
  await page.setViewportSize({ width: 1106, height: 853 });
  await expect.poll(async () => (await page.getByTestId("timeline-track").boundingBox())?.width ?? 0).toBeGreaterThan(700);
  const playhead = page.getByRole("slider", { name: "Playback position" });
  await playhead.focus();
  await playhead.press("Home");
  await dragTrack(page, 0.05, 0.95);
  const canvas = page.getByTestId("canvas-container");
  const inspectionToggle = page.getByRole("button", { name: /Inspect Request Cycles/ });
  await expect(page.getByRole("region", { name: "Cycle inspection" })).toBeVisible();
  const openHeight = (await canvas.boundingBox())!.height;
  await page.screenshot({ path: test.info().outputPath("simulation-compact-desktop-1106x853.png") });
  await inspectionToggle.click();
  await expect(page.getByRole("region", { name: "Cycle inspection" })).toHaveCount(0);
  await expect.poll(async () => (await canvas.boundingBox())!.height).toBeGreaterThan(openHeight);
  const closedPanelBox = (await panel.boundingBox())!;
  const disclosureBox = (await inspectionToggle.boundingBox())!;
  expect(Math.abs(closedPanelBox.y + closedPanelBox.height - disclosureBox.y - disclosureBox.height)).toBeLessThanOrEqual(2);
});

test("inspection navigation stays in the cycle list while details fill the right pane", async ({ page }) => {
  await createRecording(page);
  await dragTrack(page, 0.05, 0.95);
  const inspection = page.getByRole("region", { name: "Cycle inspection" });
  const list = inspection.locator("#cycle-list-pane");
  const detail = inspection.locator("#cycle-inspection-detail");
  const navigation = list.getByRole("tablist", { name: "Simulation inspection" });
  await expect(navigation).toBeVisible();

  const firstCycle = list.getByTestId("cycle-inspection-row").first();
  await firstCycle.click();
  const cycleTabs = detail.getByRole("tablist", { name: "Cycle details" });
  await expect(cycleTabs).toBeVisible();

  const inspectionBox = (await inspection.boundingBox())!;
  const listBox = (await list.boundingBox())!;
  const detailBox = (await detail.boundingBox())!;
  const navBox = (await navigation.boundingBox())!;
  const cycleTabsBox = (await cycleTabs.boundingBox())!;
  expect(navBox.x + navBox.width).toBeLessThanOrEqual(listBox.x + listBox.width);
  expect(cycleTabsBox.x).toBeGreaterThanOrEqual(detailBox.x);
  expect(detailBox.x + detailBox.width).toBeGreaterThan(listBox.x + listBox.width);
  expect(detailBox.y).toBeGreaterThanOrEqual(inspectionBox.y);
  expect(detailBox.y + detailBox.height).toBeGreaterThanOrEqual(inspectionBox.y + inspectionBox.height - 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tablist", { name: "Simulation inspection" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("simulation-inspection-mobile.png") });
});

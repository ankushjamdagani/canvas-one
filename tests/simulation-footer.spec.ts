import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures";
import {
  recording,
  traffic,
  inspect,
  tab,
  noOverflow,
} from "./simulation-support";

test('ready source footer enables scenario authoring and Run, and disables recording controls', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s06').click();
  await expect(page.getByRole('button', { name: 'Select scenario', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Run scenario', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Inspect Request Cycles', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Loop recording', exact: true })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Simulation playhead', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Step forward 10 ms', exact: true })).toBeDisabled();
  await page.keyboard.press('F2');
  await page.getByTestId('quick-options-input').fill('Open results');
  await page.getByTestId('quick-option-results.open').click();
  await expect(page.getByRole('region', { name: 'Simulation inspection', exact: true })).toHaveCount(0);
});

test("desktop source footer uses approved controls and measured inspection views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await recording(page);
  await noOverflow(page);
  const footer = page.getByTestId("playback-panel");
  const rerun = footer.getByRole("button", {
    name: "Re-run scenario",
    exact: true,
  });
  const reset = footer.getByRole("button", {
    name: "Reset simulation",
    exact: true,
  });
  const rerunBox = (await rerun.boundingBox())!;
  const resetBox = (await reset.boundingBox())!;
  expect(resetBox.x).toBeGreaterThanOrEqual(rerunBox.x + rerunBox.width);
  expect(resetBox.x - rerunBox.x - rerunBox.width).toBeLessThan(16);
  const seeker = page.getByRole("slider", {
    name: "Simulation playhead",
    exact: true,
  });
  const end = await seeker.getAttribute("aria-valuemax");
  await seeker.focus();
  await seeker.press("Home");
  await expect(seeker).toHaveAttribute("aria-valuenow", "0");
  await seeker.press("End");
  await expect(seeker).toHaveAttribute("aria-valuenow", end!);
  await page.screenshot({
    path: test.info().outputPath("source-desktop-compact.png"),
  });
  const pane = await tab(page, "Summary");
  await expect(pane.getByTestId("scope-started")).toContainText("6");
  await expect(pane.getByTestId("scope-completed")).toContainText("6");
  await expect(pane).not.toContainText(/undefined|NaN|\[object/);
  await page.screenshot({
    path: test.info().outputPath("source-desktop-summary.png"),
  });
  await tab(page, "Cycles");
  await pane.getByTestId("cycle-inspection-row").first().click();
  await expect(
    pane.getByRole("region", { name: "Selected cycle", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("source-desktop-cycle.png"),
  });
  await tab(page, 'Events');
  await page.screenshot({ path: test.info().outputPath('source-desktop-cycle-events.png') });
  await tab(page, "Components");
  await expect(pane).toContainText("Orders DB");
  await page.screenshot({
    path: test.info().outputPath("source-desktop-components.png"),
  });
  await tab(page, "Events");
  await expect(
    pane.getByRole("list", { name: "Recorded lifecycle events" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("source-desktop-events.png"),
  });
  await noOverflow(page);
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-testid="playback-panel"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await reset.click();
  await expect(page.getByTestId("playback-status")).toHaveText(/ready/i);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  { width: 1106, height: 540 },
]) {
  test(`source inspection views fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await traffic(page);
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath("source-ready.png") });
    await page.getByTestId("scenario-run-btn").click();
    await expect(page.getByTestId("playback-status")).toContainText(
      /complete/i,
      { timeout: 20000 },
    );
    await page.screenshot({
      path: test.info().outputPath("source-completed-compact.png"),
    });
    const pane = await inspect(page);
    await expect(pane).toBeVisible();
    await expect.poll(async () => (await page.getByTestId('canvas-container').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
    await expect(
      page.getByRole("dialog", { name: "Simulation inspection" }),
    ).toHaveCount(0);
    if (viewport.width < 720) {
      const paneBox = (await pane.boundingBox())!;
      const controlsBox = (await page
        .getByTestId("simulation-transport")
        .boundingBox())!;
      expect(paneBox.y + paneBox.height).toBeLessThanOrEqual(controlsBox.y + 1);
    }
    for (const view of [
      "Summary",
      "Cycles",
      viewport.width < 1200 ? "Parts" : "Components",
      "Events",
    ]) {
      await tab(page, view);
      await noOverflow(page);
      await page.screenshot({
        path: test.info().outputPath(`source-${view.toLowerCase()}.png`),
      });
      if (view === "Cycles") {
        await pane.getByTestId("cycle-inspection-row").first().click();
        await expect(
          pane.getByRole("region", { name: "Selected cycle", exact: true }),
        ).toBeVisible();
        if (viewport.width < 720) {
          await pane.getByRole('button', { name: /^Play from/ }).click();
          await expect(page.getByRole('slider', { name: 'Simulation playhead', exact: true })).toHaveAttribute('aria-valuenow', '0');
          await expect(page.getByRole('button', { name: 'Play recording', exact: true })).toBeVisible();
        }
        await page.screenshot({
          path: test.info().outputPath("source-cycle-detail.png"),
        });
      }
    }
  });
}

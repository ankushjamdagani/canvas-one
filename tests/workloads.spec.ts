import { expect, test } from "@playwright/test";

test("burst workload builds then drains its queue and persists for cache replay", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Burst", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Burst", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(Number(await page.getByTestId("queue").textContent())).toBeLessThan(5);
  expect(
    Number(
      (await page.getByTestId("failures").textContent())!.replaceAll(",", ""),
    ),
  ).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Live metrics" }).click();
  const peak = page.getByText(/^Peak \d+ requests$/);
  await expect(peak).toBeVisible();
  expect(Number((await peak.textContent())!.match(/\d+/)![0])).toBeGreaterThan(
    400,
  );
  await page.screenshot({
    path: "artifacts/burst-workload.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add cache", exact: true }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("failures")).toHaveText("0");
  await expect(
    page.getByText("Identical generated arrivals.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Burst", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("spinbutton", { name: "Burst traffic", exact: true }),
  ).toHaveValue("700");
});

test("ramp controls and mobile waveform stay usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ramp", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Ending traffic", exact: true })
    .fill("900");
  await expect(
    page.getByText("100 → 900 req/s · linear ramp", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/ramp-mobile.png", fullPage: true });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "Ending traffic", exact: true }),
  ).toHaveValue("900");
});

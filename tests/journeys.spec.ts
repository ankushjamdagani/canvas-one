import { test, expect } from "@playwright/test";
test("baseline, overload, cache replay, checkpoints and local reopen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(Number(await page.getByTestId("failures").innerText())).toBe(0);
  await page.getByRole("button", { name: "700 req/s", exact: true }).click();
  await expect(
    page.getByText("Demand exceeds capacity", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(
    Number(
      (await page.getByTestId("failures").innerText()).replaceAll(",", ""),
    ),
  ).toBeGreaterThan(4000);
  await page.getByRole("button", { name: "Live metrics" }).click();
  await page.screenshot({
    path: "artifacts/desktop-overload.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add cache", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Before cache", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "After cache", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(Number(await page.getByTestId("failures").innerText())).toBe(0);
  await expect(
    page.getByText("Identical generated arrivals.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/desktop-cache.png",
    fullPage: true,
  });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Cache added", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Before cache", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add cache", exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
test("pause, editable properties, validation, undo and import/export", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const value = await page.getByTestId("throughput").innerText();
  await page.waitForTimeout(350);
  expect(await page.getByTestId("throughput").innerText()).toBe(value);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Database", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Use one traffic source");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "URL shortener", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Learning redirects");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.locator("input[type=file]").setInputFiles(path!);
  await expect(
    page.getByRole("button", {
      name: "Learning redirects (imported)",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Learning redirects (imported)",
      exact: true,
    }),
  ).toBeVisible();
});
test("small screen stays usable without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/mobile-baseline.png",
    fullPage: true,
  });
  const node = await page.locator(".react-flow__node").first().boundingBox();
  expect(node!.width).toBeGreaterThan(150);
  await page.locator(".checkpoints > summary").click();
  await page
    .getByRole("textbox", { name: "Checkpoint name" })
    .fill("Mobile baseline");
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Mobile baseline", exact: true }),
  ).toBeVisible();
});

test("connections can be deleted and restored; canvas zoom persists", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.locator(".react-flow__edge").first().click({ force: true });
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alert")).toContainText(
    "Connect every component",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Zoom In", exact: true }).click();
  await page.waitForTimeout(450);
  const transform = await page
    .locator(".react-flow__viewport")
    .getAttribute("style");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(page.locator(".react-flow__viewport")).toHaveAttribute(
    "style",
    transform!,
  );
});

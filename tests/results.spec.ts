import { expect, test } from "@playwright/test";

async function finishRun(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
}
async function saveResult(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Save result", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Result name", exact: true })
    .fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Saved experiment results", exact: true }),
  ).toBeVisible();
}

test("saved cache comparison survives reopen and restores the exact model", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "700 req/s", exact: true }).click();
  await finishRun(page);
  await saveResult(page, "Without cache");
  await page
    .getByRole("button", { name: "Close saved results", exact: true })
    .click();
  await page.getByRole("button", { name: "Add cache", exact: true }).click();
  await finishRun(page);
  await saveResult(page, "With cache");
  await expect(
    page.getByText(
      "Same traffic profile, URL distribution, seed, duration and timeout. Generated arrival counts match; cache settings are architecture assumptions.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Cache added (80% fixed probability).", { exact: true }),
  ).toBeVisible();
  const failures = page.getByRole("row", { name: /Failed requests/ });
  await expect(failures).toContainText("5,346");
  await expect(
    page.getByText(
      "Result saved with its model, workload and observed metrics.",
      { exact: true },
    ),
  ).toBeHidden({ timeout: 6000 });
  const canvas = await page.locator(".canvas-area").boundingBox();
  for (const node of await page.locator(".react-flow__node").all()) {
    const box = await node.boundingBox();
    expect(box!.y + box!.height).toBeLessThan(canvas!.y + canvas!.height);
  }
  await page.screenshot({
    path: "artifacts/saved-comparison.png",
    fullPage: true,
  });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "With cache", exact: true }).click();
  await expect(
    page.getByRole("row", { name: /Failed requests/ }),
  ).toContainText("5,346");
  await page
    .getByRole("textbox", { name: "Saved result name", exact: true })
    .fill("Cached redirects");
  await page
    .getByRole("textbox", { name: "Saved result name", exact: true })
    .press("Tab");
  await expect(
    page.getByRole("button", { name: "Cached redirects", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Compare result", exact: true })
    .selectOption({ label: "Without cache" });
  await page
    .getByRole("button", { name: "Restore this model", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add cache", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Cache added", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("exports stored metrics with provenance and supports delete undo on mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Run duration", exact: true })
    .fill("2");
  await finishRun(page);
  await saveResult(page, "Short baseline");
  await page
    .getByRole("button", { name: "URL shortener", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  await page
    .locator("input[type=file]")
    .setInputFiles((await download.path())!);
  await page
    .getByRole("button", { name: "Short baseline", exact: true })
    .click();
  await expect(
    page.getByText(
      /Includes imported data; these stored results have not been rerun here/,
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("combobox", { name: "Compare result", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Delete result", exact: true })
    .click();
  await expect(
    page.getByText("Keep the result, not just the model.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo delete", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Compare result", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Project imported as a new local copy.", { exact: true }),
  ).toBeHidden({ timeout: 6000 });
  await page.screenshot({
    path: "artifacts/saved-results-mobile.png",
    fullPage: true,
  });
});


test("saved results code loads only when the panel is opened", async ({ page }) => {
  const modules: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/ResultsPanel")) modules.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  expect(modules).toHaveLength(0);
  await page.getByRole("button", { name: /Saved runs/ }).click();
  await expect(page.getByRole("region", { name: "Saved experiment results" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close saved results" })).toBeVisible();
  expect(modules.length).toBeGreaterThan(0);
});

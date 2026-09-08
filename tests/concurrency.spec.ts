import { expect, test, type Page } from "@playwright/test";
async function save(page: Page, name: string) {
  await page.getByRole("button", { name: "Save result", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Result name", exact: true })
    .fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}
async function run(page: Page) {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
}
test("worker scaling applies atomically and compares identical arrivals with saved models", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Run duration", exact: true })
    .fill("2");
  await page.getByRole("button", { name: "700 req/s", exact: true }).click();
  await page
    .getByRole("button", { name: "Expand Redirect service", exact: true })
    .click();
  const count = page.getByRole("spinbutton", {
    name: "Service worker count",
    exact: true,
  });
  const capacity = page.getByRole("spinbutton", {
    name: "Service processing capacity",
    exact: true,
  });
  await capacity.fill("200");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await run(page);
  await save(page, "One worker");
  await page
    .getByRole("button", { name: "Close saved results", exact: true })
    .click();
  await count.fill("4");
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    page.getByText("4 × 200 = 800 req/s total · applied model", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(count).toHaveValue("1");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(count).toHaveValue("4");
  await run(page);
  await expect(
    page.getByRole("meter", { name: "Redirect service worker occupancy" }),
  ).toHaveAttribute("aria-valuemax", "4");
  await expect(page.locator(".toast")).toBeHidden({ timeout: 6000 });
  await page.screenshot({
    path: "artifacts/concurrent-service.png",
    fullPage: true,
  });
  await save(page, "Four workers");
  await expect(
    page.getByText("Redirect service workers: 1 → 4.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Same traffic profile, URL distribution, seed, duration and timeout. Generated arrival counts match; cache settings are architecture assumptions.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Compare result", exact: true })
    .selectOption({ label: "One worker" });
  await page
    .getByRole("button", { name: "Restore this model", exact: true })
    .click();
  await expect(count).toHaveValue("1");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(count).toHaveValue("4");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(count).toHaveValue("4");
  await count.focus();
  await page
    .getByRole("button", { name: "Configuration", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Service workers", exact: true }),
  ).toHaveValue("4");
  await page
    .getByRole("spinbutton", { name: "Service workers", exact: true })
    .fill("3");
  await expect(count).toHaveValue("3");
});
test("worker drafts validate on mobile and reveal a readable 16-slot pool", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Expand Redirect service", exact: true })
    .click();
  const count = page.getByRole("spinbutton", {
    name: "Service worker count",
    exact: true,
  });
  await count.fill("17");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  expect(
    await count.evaluate((el: HTMLInputElement) => el.validity.valid),
  ).toBe(false);
  await count.press("Escape");
  await expect(count).toHaveValue("1");
  await count.fill("16");
  await count.press("Enter");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("meter", { name: "Redirect service worker occupancy" }),
  ).toHaveAttribute("aria-valuemax", "16");
  await page.waitForTimeout(200);
  const canvas = await page.locator(".canvas-area").boundingBox();
  const node = await page
    .locator(".react-flow__node")
    .filter({ hasText: "Redirect service" })
    .boundingBox();
  expect(node!.y).toBeGreaterThanOrEqual(canvas!.y);
  expect(node!.y + node!.height).toBeLessThanOrEqual(
    canvas!.y + canvas!.height,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/concurrent-service-mobile.png",
    fullPage: true,
  });
});

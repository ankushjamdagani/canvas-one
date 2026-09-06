import { expect, test } from "@playwright/test";

test("service drafts apply atomically, synchronize, replay and preserve saved models", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Run duration", exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Expand Redirect service", exact: true })
    .click();
  const capacity = page.getByRole("spinbutton", {
    name: "Service processing capacity",
    exact: true,
  });
  const queue = page.getByRole("spinbutton", {
    name: "Service queue limit",
    exact: true,
  });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await capacity.fill("250");
  await queue.fill("0");
  await page
    .getByRole("button", { name: "Configuration", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Processing capacity", exact: true }),
  ).toHaveValue("2000");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Processing capacity", exact: true }),
  ).toHaveValue("250");
  await expect(
    page.getByRole("spinbutton", { name: "Queue limit", exact: true }),
  ).toHaveValue("0");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(capacity).toHaveValue("2000");
  await expect(queue).toHaveValue("500");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(capacity).toHaveValue("250");
  await expect(queue).toHaveValue("0");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save result", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Result name", exact: true })
    .fill("Inline service model");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Close saved results", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Processing capacity", exact: true })
    .fill("300");
  await expect(capacity).toHaveValue("300");
  await page
    .getByRole("button", { name: "Inline service model", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore this model", exact: true })
    .click();
  await expect(capacity).toHaveValue("250");
  await expect(queue).toHaveValue("0");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(capacity).toHaveValue("250");
  await expect(queue).toHaveValue("0");
  await page.screenshot({
    path: "artifacts/editable-service.png",
    fullPage: true,
  });
});

test("service controls reject invalid drafts, protect canvas keys and fit mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Expand Redirect service", exact: true })
    .click();
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Redirect service" })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  const capacity = page.getByRole("spinbutton", {
    name: "Service processing capacity",
    exact: true,
  });
  const queue = page.getByRole("spinbutton", {
    name: "Service queue limit",
    exact: true,
  });
  await capacity.fill("");
  await capacity.press("Backspace");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  expect(
    await capacity.evaluate((input: HTMLInputElement) => input.validity.valid),
  ).toBe(false);
  await capacity.press("Escape");
  await expect(capacity).toHaveValue("2000");
  await queue.fill("1.5");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  expect(
    await queue.evaluate((input: HTMLInputElement) => input.validity.valid),
  ).toBe(false);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(queue).toHaveValue("500");
  await capacity.fill("350");
  await capacity.press("Enter");
  await page
    .getByRole("button", { name: "Configuration", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Processing capacity", exact: true }),
  ).toHaveValue("350");
  await page.waitForTimeout(200);
  const node = await page
    .locator(".react-flow__node")
    .filter({ hasText: "Redirect service" })
    .boundingBox();
  const canvas = await page.locator(".canvas-area").boundingBox();
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
    path: "artifacts/editable-service-mobile.png",
    fullPage: true,
  });
});

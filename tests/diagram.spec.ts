import { test, expect } from "@playwright/test";

test("architecture diagram offers searchable components and editable responsibilities", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await expect(page.getByRole("heading", { name: "Map the whole system." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Diagram only", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "Search components" }).fill("storage");
  await expect(page.getByRole("button", { name: /Object storage/ })).toBeVisible();
  await page.getByRole("button", { name: /Object storage/ }).click();
  await page.getByRole("textbox", { name: "Component name" }).fill("Media bucket");
  await page.getByRole("textbox", { name: "Responsibility or technology" }).fill("Stores uploaded media and generated thumbnails.");
  await expect(page.locator(".node-copy").filter({ hasText: "Media bucket" })).toBeVisible();
  await expect(page.locator(".node-copy").getByText("Stores uploaded media and generated thumbnails.", { exact: true })).toBeVisible();
  await expect(page.getByText(/4 components · 2 connections/)).toBeVisible();
  await page.locator(".react-flow__edge").first().click({ force: true });
  await page.getByRole("textbox", { name: "Connection label" }).fill("Calls API");
  await page.getByRole("textbox", { name: "Connection protocol" }).fill("HTTPS");
  await expect(page.getByRole("region", { name: "Selected connection" })).toBeVisible();
  await page.screenshot({ path: "artifacts/architecture-components.png", fullPage: true });
});

test("architecture component palette remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.getByRole("textbox", { name: "Search components" }).fill("queue");
  await expect(page.getByRole("button", { name: /Message queue/ })).toBeVisible();
  await page.locator(".react-flow__edge").first().click({ force: true });
  await expect(page.getByRole("button", { name: "Delete connection" })).toBeVisible();
  await page.getByRole("textbox", { name: "Connection label" }).fill("Calls API");
  await page.getByRole("textbox", { name: "Connection protocol" }).fill("HTTPS");
  await page.getByRole("combobox", { name: "Connection flow" }).selectOption("async");
  await expect(page.getByText("Calls API · HTTPS", { exact: true })).toBeVisible();
  expect(await page.locator(".workspace").evaluate((element) => element.getBoundingClientRect().width <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/architecture-components-mobile.png", fullPage: true });
});

test("architecture diagram enforces its component boundary before becoming invalid", async ({ page }) => {
  test.setTimeout(45000);
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.getByRole("textbox", { name: "Search components" }).fill("storage");
  const add = page.getByRole("button", { name: /Object storage/ });
  for (let count = 3; count < 100; count++) await add.click();
  await expect(page.getByText("100 components · 2 connections", { exact: true })).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(page.getByText(/Component limit reached/)).toBeVisible();
  await page.screenshot({ path: "artifacts/architecture-components-limit.png", fullPage: true });
});

test("custom components keep their type and duplicate without connections", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.getByRole("textbox", { name: "Search components" }).fill("custom");
  await page.getByRole("button", { name: /Custom component/ }).click();
  await page.getByRole("textbox", { name: "Type label" }).fill("Feature flag service");
  await page.getByRole("textbox", { name: "Component name" }).fill("Release flags");
  await page.getByRole("textbox", { name: "Responsibility or technology" }).fill("Controls staged releases and emergency kill switches.");
  await page.getByRole("button", { name: "Duplicate component" }).click();
  await expect(page.getByRole("textbox", { name: "Component name" })).toHaveValue("Release flags copy");
  await expect(page.getByRole("textbox", { name: "Type label" })).toHaveValue("Feature flag service");
  await expect(page.getByText("5 components · 2 connections", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("4 components · 2 connections", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("5 components · 2 connections", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/custom-component.png", fullPage: true });
});

test("custom component controls and long content stay contained on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.getByRole("textbox", { name: "Search components" }).fill("custom");
  await page.getByRole("button", { name: /Custom component/ }).click();
  await page.getByRole("textbox", { name: "Type label" }).fill("ExtremelyLongComponentTypeWithoutSpacesThatMustWrapInsideTheCard");
  await page.getByRole("textbox", { name: "Component name" }).fill("ExtremelyLongInstanceNameWithoutSpacesThatMustStayInsideTheCard");
  await expect(page.getByRole("button", { name: "Duplicate component" })).toBeVisible();
  await page.getByRole("button", { name: "Duplicate component" }).click();
  expect(await page.locator(".workspace").evaluate((element) => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
  const labelsContained = await page.locator(".node-copy").evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth));
  expect(labelsContained).toBe(true);
  await page.screenshot({ path: "artifacts/custom-component-mobile.png", fullPage: true });
});

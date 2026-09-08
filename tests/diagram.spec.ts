import { test, expect, type Page } from "@playwright/test";

async function clickFirstEdge(page: Page) {
  await page.locator(".react-flow").scrollIntoViewIfNeeded();
  const point = await page.locator(".react-flow__edge-interaction").first().evaluate((element) => {
    const path = element as SVGPathElement;
    const local = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Edge has no screen transform.");
    const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("region", { name: "Selected connection" })).toBeVisible();
}

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
  await clickFirstEdge(page);
  await page.getByRole("textbox", { name: "Connection label" }).fill("Calls API");
  await page.getByRole("textbox", { name: "Connection protocol" }).fill("HTTPS");
  await expect(page.getByRole("region", { name: "Selected connection" })).toBeVisible();
  await page.screenshot({ path: "artifacts/architecture-components.png", fullPage: true });
});

test("architecture component palette remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await clickFirstEdge(page);
  await expect(page.getByRole("button", { name: "Delete connection" })).toBeVisible();
  await page.getByRole("textbox", { name: "Connection label" }).fill("Calls API");
  await page.getByRole("textbox", { name: "Connection protocol" }).fill("HTTPS");
  await page.getByRole("combobox", { name: "Connection flow" }).selectOption("async");
  await expect(page.getByText("Calls API · HTTPS", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search components" }).fill("queue");
  await expect(page.getByRole("button", { name: /Message queue/ })).toBeVisible();
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

test("architecture templates load editable graphs and preserve them locally and portably", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.locator(".react-flow__node").filter({ hasText: "Client" }).click();
  await page.getByRole("textbox", { name: "Component name" }).fill("My original client");
  await page.locator(".architecture-templates > summary").click();
  await expect(page.getByText("Loading replaces the current diagram. You can Undo to restore it.")).toBeVisible();

  await page.getByRole("combobox", { name: "Architecture template" }).selectOption("realtime-chat");
  await expect(page.getByText("Trace message submission, persistence, fan-out, and notification delivery.")).toBeVisible();
  await page.getByRole("button", { name: "Load template" }).click();
  await expect(page.getByText("7 components · 6 connections", { exact: true })).toBeVisible();
  await expect(page.locator(".node-copy").filter({ hasText: "Chat service" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".node-copy").filter({ hasText: "My original client" })).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".node-copy").filter({ hasText: "Chat service" })).toBeVisible();

  await page.getByRole("combobox", { name: "Architecture template" }).selectOption("ecommerce-checkout");
  await page.getByRole("button", { name: "Load template" }).click();
  await expect(page.getByText("8 components · 7 connections", { exact: true })).toBeVisible();
  await expect(page.locator(".node-copy").filter({ hasText: "Payment provider" })).toBeVisible();

  await page.getByRole("combobox", { name: "Architecture template" }).selectOption("event-processing");
  await page.getByRole("button", { name: "Load template" }).click();
  await expect(page.getByText("6 components · 5 connections", { exact: true })).toBeVisible();
  await expect.poll(() => page.locator(".react-flow").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return [...canvas.querySelectorAll(".react-flow__node")].every((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    });
  })).toBe(true);
  await page.screenshot({ path: "artifacts/architecture-template.png", fullPage: true });
  await clickFirstEdge(page);
  await page.getByRole("textbox", { name: "Connection label" }).fill("Collect");
  await page.locator(".react-flow__node").filter({ hasText: "Event producer" }).click();
  await page.getByRole("textbox", { name: "Component name" }).fill("Sensor fleet");
  await page.getByRole("button", { name: "Duplicate component" }).click();
  await expect(page.getByRole("textbox", { name: "Component name" })).toHaveValue("Sensor fleet copy");
  await page.getByRole("textbox", { name: "Checkpoint name" }).fill("Event template edited");
  await page.getByRole("button", { name: "Save checkpoint" }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".node-copy").filter({ hasText: "Sensor fleet copy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Event template edited", exact: true })).toBeVisible();
  await page.locator(".react-flow__node").filter({ hasText: "Sensor fleet copy" }).click();
  await page.getByRole("textbox", { name: "Component name" }).fill("Changed after checkpoint");
  await page.getByRole("button", { name: "Event template edited", exact: true }).click();
  await expect(page.locator(".node-copy").filter({ hasText: "Sensor fleet copy" })).toBeVisible();
  await expect(page.locator(".node-copy").filter({ hasText: "Changed after checkpoint" })).toHaveCount(0);

  await page.getByRole("button", { name: "URL shortener", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  await page.locator("input[type=file]").setInputFiles((await download.path())!);
  await expect(page.getByRole("button", { name: "URL shortener (imported)", exact: true })).toBeVisible();
  await expect(page.locator(".node-copy").filter({ hasText: "Sensor fleet copy" })).toBeVisible();
});

test("architecture template controls remain accessible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.locator(".architecture-templates > summary").click();
  await page.getByRole("combobox", { name: "Architecture template" }).selectOption("realtime-chat");
  const load = page.getByRole("button", { name: "Load template" });
  expect((await load.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await load.click();
  await expect(page.getByText("7 components · 6 connections", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/architecture-template-mobile.png", fullPage: true });
});

import { test, expect, type Page } from "@playwright/test";
import { componentNode, openExample } from "./openHelpers";

async function clickFirstEdge(page: Page) {
  await page.locator(".react-flow").scrollIntoViewIfNeeded();
  const pathLocator = page.locator(".react-flow__edge-interaction").first();
  await expect(pathLocator).toBeAttached(); // Horizontal SVG paths have zero bounding-box height.
  const point = await pathLocator.evaluate((element) => {
    const path = element as SVGPathElement;
    const local = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Edge has no screen transform.");
    const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(
    page.getByRole("complementary", { name: "Connection configuration" }),
  ).toBeVisible();
}

test("open system offers searchable components and editable responsibilities", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });

  await page.getByRole("textbox", { name: "Search components" }).fill("storage");
  const storageItem = page.locator(".library-item").filter({ hasText: "Object storage" });
  await expect(storageItem).toBeVisible();
  await storageItem.click();

  const node = componentNode(page, "Object storage");
  await expect(node).toBeVisible();
  await node.click();

  const inspector = page.getByRole("complementary", { name: "Component inspector" });
  await expect(inspector).toBeVisible();
  await inspector.getByRole("textbox", { name: "Name", exact: true }).first().fill("Media bucket");
  await inspector
    .getByRole("textbox", { name: "Description / Notes" })
    .fill("Stores uploaded media and generated thumbnails.");

  await expect(componentNode(page, "Media bucket")).toBeVisible();
  await expect(inspector.getByRole("textbox", { name: "Description / Notes" })).toHaveValue("Stores uploaded media and generated thumbnails.");

  // Load starter example to test connection selection and editing
  await openExample(page, "Real-time chat");
  await clickFirstEdge(page);
  const connEditor = page.getByRole("complementary", { name: "Connection configuration" });
  await connEditor.getByRole("textbox", { name: "Label" }).fill("Calls API");
  await connEditor.getByRole("textbox", { name: "Protocol" }).fill("HTTPS");
  await expect(connEditor).toBeVisible();
  await page.screenshot({ path: "artifacts/architecture-components.png", fullPage: true });
});

test("architecture component palette remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });

  await openExample(page, "Real-time chat");
  await clickFirstEdge(page);
  const connEditor = page.getByRole("complementary", { name: "Connection configuration" });
  await expect(
    connEditor.getByRole("button", { name: "Delete Connection" }),
  ).toBeVisible();
  await connEditor.getByRole("textbox", { name: "Label" }).fill("Calls API");
  await connEditor.getByRole("textbox", { name: "Protocol" }).fill("HTTPS");
  await connEditor.getByRole("combobox", { name: "Transport" }).selectOption("message");
  await connEditor.getByRole("button", { name: "Done" }).click();

  await page.getByRole("textbox", { name: "Search components" }).fill("queue");
  await expect(
    page.locator(".library-item").filter({ hasText: "Message queue" }),
  ).toBeVisible();
  expect(
    await page.locator(".workspace").evaluate((element) => element.getBoundingClientRect().width <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/architecture-components-mobile.png", fullPage: true });
});

test("open system enforces its component boundary before becoming invalid", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });

  await page.getByRole("textbox", { name: "Search components" }).fill("storage");
  const add = page.locator(".library-item").filter({ hasText: "Object storage" });
  await expect(add).toBeVisible();

  for (let count = 0; count < 100; count++) {
    await add.click();
  }

  await expect(page.locator(".react-flow__node-component")).toHaveCount(100);
  await expect(add).toBeDisabled();
  await expect(add).toHaveAttribute("title", "System has reached the 100-node limit.");
  await page.screenshot({ path: "artifacts/architecture-components-limit.png", fullPage: true });
});

test("custom components keep their type and duplicate without connections", async ({ page }) => {
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });

  await page.getByRole("textbox", { name: "Search components" }).fill("custom");
  const addCustom = page.locator(".library-item").filter({ hasText: "Custom component" });
  await expect(addCustom).toBeVisible();
  await addCustom.click();

  const node = componentNode(page, "Custom component");
  await expect(node).toBeVisible();
  await node.click();

  const inspector = page.getByRole("complementary", { name: "Component inspector" });
  await expect(inspector).toBeVisible();
  await inspector.getByRole("textbox", { name: "Custom Type Label" }).fill("Feature flag service");
  await inspector.getByRole("textbox", { name: "Name", exact: true }).first().fill("Release flags");
  await inspector
    .getByRole("textbox", { name: "Description / Notes" })
    .fill("Controls staged releases and emergency kill switches.");

  await inspector.getByRole("button", { name: "Duplicate Node" }).click();
  await expect(inspector.getByRole("textbox", { name: "Name", exact: true }).first()).toHaveValue("Release flags copy");
  await expect(inspector.getByRole("textbox", { name: "Custom Type Label" })).toHaveValue("Feature flag service");
  await expect(page.locator(".react-flow__node-component")).toHaveCount(2);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".react-flow__node-component")).toHaveCount(1);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".react-flow__node-component")).toHaveCount(2);
  await page.screenshot({ path: "artifacts/custom-component.png", fullPage: true });
});

test("custom component controls and long content stay contained on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });

  await page.getByRole("textbox", { name: "Search components" }).fill("custom");
  const addCustom = page.locator(".library-item").filter({ hasText: "Custom component" });
  await expect(addCustom).toBeVisible();
  await addCustom.click();

  const node = componentNode(page, "Custom component");
  await expect(node).toBeVisible();
  await node.click();

  const inspector = page.getByRole("complementary", { name: "Component inspector" });
  await expect(inspector).toBeVisible();
  await inspector
    .getByRole("textbox", { name: "Custom Type Label" })
    .fill("ExtremelyLongComponentTypeWithoutSpacesThatMustWrapInsideTheCard");
  await inspector
    .getByRole("textbox", { name: "Name", exact: true }).first()
    .fill("ExtremelyLongInstanceNameWithoutSpacesThatMustStayInsideTheCard");

  await expect(inspector.getByRole("button", { name: "Duplicate Node" })).toBeVisible();
  await inspector.getByRole("button", { name: "Duplicate Node" }).click();

  expect(
    await page.locator(".workspace").evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
  ).toBe(true);
  const labelsContained = await page
    .locator(".node-copy")
    .evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth));
  expect(labelsContained).toBe(true);
  await page.screenshot({ path: "artifacts/custom-component-mobile.png", fullPage: true });
});

test("architecture templates load editable graphs and preserve them locally and portably", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });

  await openExample(page, "Real-time chat");
  await expect(componentNode(page, "Chat service")).toBeVisible();
  const chatNodeCount = await page.locator(".react-flow__node-component").count();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".react-flow__node-component")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".react-flow__node-component")).toHaveCount(chatNodeCount);
  await expect(componentNode(page, "Chat service")).toBeVisible();

  await openExample(page, "Ecommerce checkout");
  await expect(componentNode(page, "Payment provider")).toBeVisible();

  await openExample(page, "Event processing");
  await expect(componentNode(page, "Event producer")).toBeVisible();
  await expect.poll(() =>
    page.locator(".react-flow").evaluate((canvas) => {
      const bounds = canvas.getBoundingClientRect();
      return [...canvas.querySelectorAll(".react-flow__node")].every((node) => {
        const rect = node.getBoundingClientRect();
        return (
          rect.left >= bounds.left &&
          rect.right <= bounds.right &&
          rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom
        );
      });
    }),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/architecture-template.png", fullPage: true });

  await clickFirstEdge(page);
  const connEditor = page.getByRole("complementary", { name: "Connection configuration" });
  await connEditor.getByRole("textbox", { name: "Label" }).fill("Collect");
  await connEditor.getByRole("button", { name: "Done" }).click();

  const producerNode = componentNode(page, "Event producer");
  await producerNode.click();
  const inspector = page.getByRole("complementary", { name: "Component inspector" });
  await inspector.getByRole("textbox", { name: "Name", exact: true }).first().fill("Sensor fleet");
  await inspector.getByRole("button", { name: "Duplicate Node" }).click();
  await expect(inspector.getByRole("textbox", { name: "Name", exact: true }).first()).toHaveValue("Sensor fleet copy");

  await page.getByRole("textbox", { name: "Checkpoint name" }).fill("Event template edited");
  await page.getByRole("button", { name: "Save checkpoint" }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await page.reload();
  await expect(componentNode(page, "Sensor fleet copy")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Event template edited", exact: true }),
  ).toBeVisible();

  const copyNode = componentNode(page, "Sensor fleet copy");
  await copyNode.click();
  await inspector.getByRole("textbox", { name: "Name", exact: true }).first().fill("Changed after checkpoint");
  await page.getByRole("button", { name: "Event template edited", exact: true }).click();
  await expect(componentNode(page, "Sensor fleet copy")).toBeVisible();
  await expect(componentNode(page, "Changed after checkpoint")).toHaveCount(0);

  await page.locator(".project-switch").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  await page.locator("input[type=file]").setInputFiles((await download.path())!);
  await expect(page.getByRole("button", { name: /\(imported\)$/ }).first()).toBeVisible();
  await expect(componentNode(page, "Sensor fleet copy")).toBeVisible();
});

test("architecture template controls remain accessible on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Examples & tutorials" }).click();
  const modal = page.locator(".examples-modal");
  await expect(modal).toBeVisible();
  const chatItem = modal.locator(".example-list-item").filter({ hasText: "Real-time chat" });
  await chatItem.click();

  const load = page.getByRole("button", { name: "Load example" });
  expect((await load.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await load.click();
  await expect(componentNode(page, "Chat service")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/architecture-template-mobile.png", fullPage: true });
});

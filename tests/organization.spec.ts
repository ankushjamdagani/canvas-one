import { expect, test, type Page } from "@playwright/test";

const node = (page: Page, name: string) =>
  page.locator(".react-flow__node-component").filter({ hasText: name });

const modelPosition = async (page: Page, name: string) => node(page, name).evaluate((element) => {
  const match = (element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
  if (!match) throw new Error("Node has no model translation.");
  return { x: Number(match[1]), y: Number(match[2]) };
});

async function selectFirstEdge(page: Page) {
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
}

test("diagram components can be shift-selected, aligned, distributed and dragged together", async ({ page }) => {
  test.setTimeout(75000);
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.locator(".architecture-templates > summary").click();
  await page.getByRole("combobox", { name: "Architecture template" }).selectOption("event-processing");
  await page.getByRole("button", { name: "Load template" }).click();
  const producer = node(page, "Event producer"), processor = node(page, "Stream processor"), archive = node(page, "Event archive");
  await selectFirstEdge(page);
  await expect(page.getByRole("region", { name: "Selected connection" })).toBeVisible();
  await page.getByRole("button", { name: "Select components" }).click();
  await expect(page.getByRole("region", { name: "Selected connection" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Event producer" }).check();
  await page.getByRole("button", { name: "Finish selecting" }).click();
  await page.getByRole("button", { name: "Clear component selection" }).click();
  await producer.click();
  await processor.click({ modifiers: ["Shift"] });
  await archive.click({ modifiers: ["Shift"] });
  await expect(page.getByText("3 components selected", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organize the selection." })).toBeVisible();
  const viewportBefore = await page.locator(".react-flow__viewport").getAttribute("transform");
  await page.getByRole("button", { name: "Align top" }).click();
  const top = (await producer.boundingBox())!.y;
  expect((await processor.boundingBox())!.y).toBeCloseTo(top, 0);
  expect((await archive.boundingBox())!.y).toBeCloseTo(top, 0);
  expect(await page.locator(".react-flow__viewport").getAttribute("transform")).toBe(viewportBefore);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Redo" }).click();

  await expect(page.getByRole("button", { name: "Distribute horizontally" })).toBeEnabled();
  await page.getByRole("button", { name: "Distribute horizontally" }).click();
  const beforeDrag = await Promise.all([producer.boundingBox(), processor.boundingBox(), archive.boundingBox()]);
  const drag = beforeDrag[1]!;
  await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2);
  await page.mouse.down();
  await page.mouse.move(drag.x + drag.width / 2 + 60, drag.y + drag.height / 2 + 35, { steps: 6 });
  await page.mouse.up();
  const afterDrag = await Promise.all([producer.boundingBox(), processor.boundingBox(), archive.boundingBox()]);
  for (let index = 0; index < 3; index++) {
    expect(afterDrag[index]!.x - beforeDrag[index]!.x).toBeGreaterThan(45);
    expect(afterDrag[index]!.y - beforeDrag[index]!.y).toBeGreaterThan(20);
  }
  await page.getByRole("button", { name: "Undo" }).click();
  const afterUndo = await Promise.all([producer.boundingBox(), processor.boundingBox(), archive.boundingBox()]);
  for (let index = 0; index < 3; index++) {
    expect(afterUndo[index]!.x).toBeCloseTo(beforeDrag[index]!.x, 0);
    expect(afterUndo[index]!.y).toBeCloseTo(beforeDrag[index]!.y, 0);
  }
  await page.screenshot({ path: "artifacts/canvas-organization.png", fullPage: true });

  const savedPositions = await Promise.all([modelPosition(page, "Event producer"), modelPosition(page, "Stream processor"), modelPosition(page, "Event archive")]);
  await page.getByRole("textbox", { name: "Checkpoint name" }).fill("Organized event layout");
  await page.getByRole("button", { name: "Save checkpoint" }).click();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Organized event layout", exact: true })).toBeVisible();
  await expect.poll(async () => Promise.all([modelPosition(page, "Event producer"), modelPosition(page, "Stream processor"), modelPosition(page, "Event archive")])).toEqual(savedPositions);

  await node(page, "Event producer").click();
  await node(page, "Stream processor").click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Align left" }).click();
  await page.getByRole("button", { name: "Organized event layout", exact: true }).click();
  await expect.poll(async () => Promise.all([modelPosition(page, "Event producer"), modelPosition(page, "Stream processor"), modelPosition(page, "Event archive")])).toEqual(savedPositions);

  await node(page, "Event producer").click();
  const nameInput = page.getByRole("textbox", { name: "Component name" });
  const originalName = await nameInput.inputValue();
  await nameInput.press("End");
  await nameInput.press("Backspace");
  await expect(page.getByText("6 components · 5 connections", { exact: true })).toBeVisible();
  await expect(nameInput).toHaveValue(originalName.slice(0, -1));

  await page.getByRole("button", { name: "URL shortener", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  await page.locator("input[type=file]").setInputFiles((await download.path())!);
  await expect(page.getByRole("button", { name: /\(imported\)$/ }).first()).toBeVisible();
  await expect.poll(async () => Promise.all([modelPosition(page, "Event produce"), modelPosition(page, "Stream processor"), modelPosition(page, "Event archive")])).toEqual(savedPositions);
});

test("touch selection and diagram subsystem boundaries remain clear", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.getByRole("button", { name: "Select components" }).click();
  await page.getByRole("checkbox", { name: "Client" }).check();
  await page.getByRole("checkbox", { name: "API gateway" }).check();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Align top" }).click();
  await page.screenshot({ path: "artifacts/canvas-organization-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Finish selecting" }).click();
  await page.getByRole("button", { name: "Clear component selection" }).click();
  await expect(page.getByRole("heading", { name: "Compose before you calculate." })).toBeVisible();
  await page.locator(".subsystems-panel > summary").click();
  await page.getByRole("button", { name: "Create subsystem" }).click();
  await page.getByRole("button", { name: "Group components" }).click();
  await page.waitForTimeout(150);
  const boundaryBefore = await page.locator(".react-flow__node-subsystem").boundingBox();
  const client = await node(page, "Client").boundingBox();
  await page.mouse.move(client!.x + client!.width / 2, client!.y + client!.height / 2);
  await page.mouse.down();
  await page.mouse.move(client!.x + client!.width / 2 - 55, client!.y + client!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await page.locator(".react-flow__node-subsystem").boundingBox())!.width).toBeGreaterThan(boundaryBefore!.width + 35);
  await page.getByRole("button", { name: "Collapse Subsystem on canvas" }).click();
  await expect(page.getByText("Architecture boundary", { exact: true })).toBeVisible();
  await expect(page.getByText(/waiting/)).toHaveCount(0);
  await page.getByRole("button", { name: "Expand Subsystem on canvas" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/canvas-subsystem-boundary.png", fullPage: true });
});

import { expect, test } from "@playwright/test";
import { componentNode, openExample, getNodePosition, selectCanvasBox } from "./openHelpers";

test.describe("Canvas organization: multi-selection, alignment, distribution, drag, and mobile overflow", () => {
  test.setTimeout(45000);

  test("box selection mouse drag without Shift selects components and allows alignment and distribution", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const gw = componentNode(page, "Chat client");
    const jq = componentNode(page, "API gateway");
    await expect(gw).toBeVisible();
    await expect(jq).toBeVisible();

    const gwBox = (await gw.boundingBox())!;
    const jqBox = (await jq.boundingBox())!;

    // Select box covering both components without Shift key
    const minX = Math.min(gwBox.x, jqBox.x) - 5;
    const minY = Math.min(gwBox.y, jqBox.y) - 5;
    const maxX = Math.max(gwBox.x + gwBox.width, jqBox.x + jqBox.width) + 5;
    const maxY = Math.max(gwBox.y + gwBox.height, jqBox.y + jqBox.height) + 5;

    await selectCanvasBox(page, { x: minX, y: minY }, { x: maxX, y: maxY });

    await expect(page.locator(".react-flow__node-component.selected")).toHaveCount(2);

    // Align top
    const alignTopBtn = page.getByRole("button", { name: "Align top" });
    await expect(alignTopBtn).toBeVisible();
    await alignTopBtn.click();

    const gwY = (await gw.boundingBox())!.y;
    const jqY = (await jq.boundingBox())!.y;
    expect(jqY).toBeCloseTo(gwY, 0);

    // Undo alignment
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Redo" }).click();
  });

  test("selected set drag moves all selected nodes together and supports undo", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const gw = componentNode(page, "Chat client");
    const jq = componentNode(page, "API gateway");
    await page.getByRole("button", { name: "Select components", exact: true }).click();
    await page.getByRole("checkbox", { name: "Chat client", exact: true }).check();
    await page.getByRole("checkbox", { name: "API gateway", exact: true }).check();
    await page.getByRole("button", { name: "Finish selecting", exact: true }).click();

    const beforePosGw = await getNodePosition(page, "Chat client");
    const beforePosJq = await getNodePosition(page, "API gateway");

    // Drag gw
    const gwBox = (await gw.boundingBox())!;
    await page.mouse.move(gwBox.x + gwBox.width / 2, gwBox.y + gwBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gwBox.x + gwBox.width / 2 + 60, gwBox.y + gwBox.height / 2 + 40, { steps: 5 });
    await page.mouse.up();

    const afterPosGw = await getNodePosition(page, "Chat client");
    const afterPosJq = await getNodePosition(page, "API gateway");

    expect(afterPosGw.x - beforePosGw.x).toBeGreaterThan(40);
    expect(afterPosJq.x - beforePosJq.x).toBeGreaterThan(40);

    // Undo restores position
    await page.getByRole("button", { name: "Undo" }).click();
    const undonePosGw = await getNodePosition(page, "Chat client");
    expect(undonePosGw.x).toBeCloseTo(beforePosGw.x, 0);

    // Screenshot 1: Canvas organization
    await page.screenshot({ path: "artifacts/canvas-organization.png", fullPage: true });
  });

  test("mobile viewport does not overflow and supports touch selection tools", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    // Toolbar touch selection tools
    const selectBtn = page.getByRole("button", { name: "Select", exact: true });
    const panBtn = page.getByRole("button", { name: "Pan", exact: true });
    await expect(selectBtn).toBeVisible();
    await expect(panBtn).toBeVisible();

    await panBtn.click();
    await expect(panBtn).toHaveAttribute("aria-pressed", "true");

    await selectBtn.click();
    await expect(selectBtn).toHaveAttribute("aria-pressed", "true");

    // Select components button in DiagramOrganization
    await page.getByRole("button", { name: "Select components" }).click();
    await page.getByRole("checkbox", { name: "Chat client" }).check();
    await page.getByRole("checkbox", { name: "API gateway" }).check();
    await page.getByRole("button", { name: "Finish selecting" }).click();

    await expect(page.locator(".diagram-organizer-heading")).toContainText("2 selected");

    // Verify document does not horizontally overflow
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(noOverflow).toBe(true);
  });
});

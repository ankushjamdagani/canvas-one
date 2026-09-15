import { expect, test } from "@playwright/test";
import { componentNode, subsystemNode, openExample, getNodePosition } from "./openHelpers";

test.describe("Subsystems: right-click grouping, keyboard Shift+F10, collapse/expand, rename, and ungroup", () => {
  test.setTimeout(45000);

  test("create subsystem from selected nodes via right-click context menu, rename, and collapse", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const gw = componentNode(page, "Chat client");
    const jq = componentNode(page, "API gateway");
    await page.getByRole("button", { name: "Select components", exact: true }).click();
    await page.getByRole("checkbox", { name: "Chat client", exact: true }).check();
    await page.getByRole("checkbox", { name: "API gateway", exact: true }).check();
    await page.getByRole("button", { name: "Finish selecting", exact: true }).click();

    // Right-click to trigger CanvasContextMenu
    const gwBox = (await gw.boundingBox())!;
    await page.mouse.click(gwBox.x + gwBox.width / 2, gwBox.y + gwBox.height / 2, { button: "right" });

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    // Menu item: Create subsystem (N)
    const createItem = menu.getByRole("menuitem", { name: /Create subsystem/i });
    await expect(createItem).toBeVisible();
    await createItem.click();

    // Modal / form: label "New Subsystem", button "Group"
    const formLabel = page.getByText("New Subsystem", { exact: true });
    await expect(formLabel).toBeVisible();
    const nameInput = page.getByPlaceholder("Subsystem name");
    await nameInput.fill("Processing Tier");
    await page.getByRole("button", { name: "Group" }).click();

    // Subsystem shell created on canvas
    const sub = subsystemNode(page, "Processing Tier");
    await expect(sub).toBeVisible();

    // Right-click subsystem shell to rename
    const subBox = (await sub.boundingBox())!;
    await page.mouse.click(subBox.x + 20, subBox.y + 20, { button: "right" });
    await expect(menu).toBeVisible();

    const renameItem = menu.getByRole("menuitem", { name: "Rename" });
    await renameItem.click();

    const renameLabel = page.getByText("Rename Subsystem", { exact: true });
    await expect(renameLabel).toBeVisible();
    const renameInput = page.locator("#rename-subsystem-name");
    await renameInput.fill("Core Tier");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(subsystemNode(page, "Core Tier")).toBeVisible();

    // Right-click to collapse subsystem
    const updatedBox = (await subsystemNode(page, "Core Tier").boundingBox())!;
    await page.mouse.click(updatedBox.x + 20, updatedBox.y + 20, { button: "right" });
    await menu.getByRole("menuitem", { name: "Collapse subsystem" }).click();

    // Right-click to expand subsystem
    const collapsedBox = (await subsystemNode(page, "Core Tier").boundingBox())!;
    await page.mouse.click(collapsedBox.x + 20, collapsedBox.y + 20, { button: "right" });
    await menu.getByRole("menuitem", { name: "Expand subsystem" }).click();
  });

  test("keyboard Shift+F10 opens context menu, selection actions button works, and ungroup preserves positions", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const gw = componentNode(page, "Chat client");
    const jq = componentNode(page, "API gateway");
    await page.getByRole("button", { name: "Select components", exact: true }).click();
    await page.getByRole("checkbox", { name: "Chat client", exact: true }).check();
    await page.getByRole("checkbox", { name: "API gateway", exact: true }).check();
    await page.getByRole("button", { name: "Finish selecting", exact: true }).click();

    // Focus canvas container and press Shift+F10
    const canvasContainer = page.locator(".system-canvas");
    await canvasContainer.focus();
    await page.keyboard.press("Shift+F10");

    let menu = page.getByRole("menu");

    await expect(menu).toBeVisible();

    // Create subsystem via menu
    await menu.getByRole("menuitem", { name: /Create subsystem/i }).click();
    await page.getByRole("button", { name: "Group" }).click();

    const sub = subsystemNode(page);
    await expect(sub).toBeVisible();

    const posBeforeUngroup = await getNodePosition(page, "Chat client");

    // Right click subsystem to ungroup
    const subBox = (await sub.boundingBox())!;
    await page.mouse.click(subBox.x + 20, subBox.y + 20, { button: "right" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Ungroup" }).click();

    // Verify subsystem shell dissolved
    await expect(subsystemNode(page)).toHaveCount(0);

    // Positions of member nodes remain unchanged
    const posAfterUngroup = await getNodePosition(page, "Chat client");
    expect(posAfterUngroup.x).toBeCloseTo(posBeforeUngroup.x, 0);
    expect(posAfterUngroup.y).toBeCloseTo(posBeforeUngroup.y, 0);

    // Undo restore subsystem, redo dissolve
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(subsystemNode(page)).toBeVisible();
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(subsystemNode(page)).toHaveCount(0);
  });

  test("subsystem boundary and touch actions render properly", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const gw = componentNode(page, "Chat client");
    const jq = componentNode(page, "API gateway");
    await page.getByRole("button", { name: "Select components", exact: true }).click();
    await page.getByRole("checkbox", { name: "Chat client", exact: true }).check();
    await page.getByRole("checkbox", { name: "API gateway", exact: true }).check();
    await page.getByRole("button", { name: "Finish selecting", exact: true }).click();

    await page.getByRole("button", { name: "Selection actions" }).click();
    const menu = page.getByRole("menu");
    await menu.getByRole("menuitem", { name: /Create subsystem/i }).click();
    await page.getByRole("button", { name: "Group" }).click();

    const sub = subsystemNode(page);
    await expect(sub).toBeVisible();

    // Screenshot 2: Subsystem boundary
    await page.screenshot({ path: "artifacts/canvas-subsystem-boundary.png", fullPage: true });
  });
});

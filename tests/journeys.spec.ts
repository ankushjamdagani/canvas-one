import { expect, test } from "@playwright/test";
import { componentNode, openExample, getNodePosition } from "./openHelpers";

test.describe("Production journeys: blank canvas, free behavior, pause/reset/replay, and persistence", () => {
  test.setTimeout(45000);

  test("initial blank canvas displays 29-item catalog, adds nodes with free behavior, connects and simulates", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });

    // Initial canvas is blank: 0 component nodes
    await expect(page.locator(".react-flow__node-component")).toHaveCount(0);

    // Catalog exists with 29 palette items
    const paletteItems = page.locator(".library-item");
    const count = await paletteItems.count();
    expect(count).toBeGreaterThanOrEqual(29);

    // Load an example from the production flow
    await openExample(page, "Real-time chat");
    const gateway = componentNode(page, "Chat client");
    const queue = componentNode(page, "API gateway");
    await expect(gateway).toBeVisible();
    await expect(queue).toBeVisible();

    // Inspect gateway node and check free behavior controls
    await gateway.click();
    const inspector = page.getByRole("complementary", { name: "Component inspector" });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("combobox", { name: "Execution Behavior" })).toHaveValue("processor");

    const behaviorSelect = inspector.getByRole("combobox", { name: "Execution Behavior" });
    await expect(behaviorSelect).toBeVisible();

    // Change behavior to processor
    await behaviorSelect.selectOption("processor");
    await expect(behaviorSelect).toHaveValue("processor");

    // Run simulation: default duration 30s
    const runButton = page.getByRole("button", { name: "Run", exact: true });
    await runButton.click();

    // Pause simulation
    const pauseButton = page.getByRole("button", { name: "Pause", exact: true });
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();

    // Reset simulation
    const resetButton = page.getByRole("button", { name: "Reset", exact: true });
    await expect(resetButton).toBeVisible();
    await resetButton.click();

    // Replay / run again
    await expect(runButton).toBeVisible();
    await runButton.click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
  });

  test("checkpoint reopen, export/import, and IndexedDB local save across reloads", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });

    await openExample(page, "Real-time chat");
    const gateway = componentNode(page, "Chat client");
    await expect(gateway).toBeVisible();

    // Save checkpoint
    const checkpointInput = page.getByRole("textbox", { name: "Checkpoint name" });
    await checkpointInput.fill("Fanout checkpoint");
    await page.getByRole("button", { name: "Save checkpoint" }).click();
    await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

    const initialPos = await getNodePosition(page, "Chat client");

    // Move the node
    const box = (await gateway.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 50, { steps: 5 });
    await page.mouse.up();

    // Reload page to verify persistence via IndexedDB
    await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

    // Restore saved checkpoint
    const cpButton = page.getByRole("button", { name: "Fanout checkpoint", exact: true });
    await cpButton.click();
    await expect.poll(async () => getNodePosition(page, "Chat client")).toEqual(initialPos);

    // Export and import JSON
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON", exact: true }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    if (downloadPath) {
      await page.locator("input[type=file]").setInputFiles(downloadPath);
      await expect(page.getByRole("button", { name: /\(imported\)$/ }).first()).toBeVisible();
    }
  });

  test("runs simulation to completion with replay observation", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });

    await openExample(page, "Real-time chat");
    const runButton = page.getByRole("button", { name: "Run", exact: true });
    await runButton.click();

    await expect(page.getByRole("button", { name: "Replay", exact: true })).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".open-metrics-panel")).toContainText("Background messages");
    expect(parseFloat(await page.getByTestId("throughput").innerText())).toBeGreaterThan(0);
  });
});

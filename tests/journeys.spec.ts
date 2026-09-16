import { expect, test, type Locator } from "@playwright/test";
import { componentNode, openExample, getNodePosition, openCatalog, openMetricsDetails, openWorkloads } from "./openHelpers";

test.describe("Production journeys: blank canvas, free behavior, pause/reset/replay, and persistence", () => {
  test.setTimeout(45000);

  test("initial blank canvas displays 29-item catalog, adds nodes with free behavior, connects and simulates", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });

    // Initial canvas is blank: 0 component nodes
    await expect(page.locator(".react-flow__node-component")).toHaveCount(0);

    // Open catalog and check 29 palette items
    await openCatalog(page);
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
    await page.locator(".project-switch").click();
    const checkpointInput = page.getByRole("textbox", { name: "Checkpoint name" });
    await checkpointInput.fill("Fanout checkpoint");
    await page.getByRole("button", { name: "Save checkpoint" }).click();
    await page.locator(".project-switch").click();
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
    await page.locator(".project-switch").click();
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
    await openMetricsDetails(page);
    await expect(page.locator(".open-metrics-panel")).toContainText("Background messages");
    expect(parseFloat(await page.getByTestId("throughput").first().innerText())).toBeGreaterThan(0);
  });

  test("builds source to processor to storage manually through handles, configures traffic, runs, inspects separate root and message metrics, saves and compares", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });

    // Initial canvas is blank
    await expect(page.locator(".react-flow__node-component")).toHaveCount(0);

    // Open catalog and add source (Client), processor (Service), storage (Database)
    await openCatalog(page);
    await page.locator(".library-item").filter({ hasText: "Client" }).click();
    const clientNode = componentNode(page, "Client");
    await expect(clientNode).toBeVisible();

    await page.locator(".library-item").filter({ hasText: "Service" }).first().click();
    const serviceNode = componentNode(page, "Service");
    await expect(serviceNode).toBeVisible();

    await page.locator(".library-item").filter({ hasText: "Database" }).first().click();
    const dbNode = componentNode(page, "Database");
    await expect(dbNode).toBeVisible();

    // Close catalog drawer to free up canvas space
    await page.getByRole("button", { name: "Close component drawer" }).click();
    await expect(page.getByRole("complementary", { name: "Component catalog" })).toBeHidden();

    // Wait for fitView to settle
    await page.waitForTimeout(200);

    // Move nodes apart horizontally (move DB first as it's on top of the DOM stack)
    const moveNode = async (node: Locator, dx: number, dy: number) => {
      const box = (await node.boundingBox())!;
      await page.mouse.move(box.x + 35, box.y + 25);
      await page.mouse.down();
      await page.mouse.move(box.x + 35 + dx, box.y + 25 + dy, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(100);
    };
    await moveNode(dbNode, 260, 0);
    await moveNode(clientNode, -260, 0);

    // Connect Client (source) -> Service (processor)
    const clientHandle = clientNode.locator(".react-flow__handle-right");
    const serviceTargetHandle = serviceNode.locator(".react-flow__handle-left");
    const clientBox = (await clientHandle.boundingBox())!;
    const serviceTargetBox = (await serviceTargetHandle.boundingBox())!;
    await page.mouse.move(clientBox.x + clientBox.width / 2, clientBox.y + clientBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(serviceTargetBox.x + serviceTargetBox.width / 2, serviceTargetBox.y + serviceTargetBox.height / 2, { steps: 8 });
    await page.waitForTimeout(100);
    await page.mouse.up();

    // Connect Service (processor) -> Database (storage)
    const serviceSourceHandle = serviceNode.locator(".react-flow__handle-right");
    const dbTargetHandle = dbNode.locator(".react-flow__handle-left");
    const serviceSourceBox = (await serviceSourceHandle.boundingBox())!;
    const dbTargetBox = (await dbTargetHandle.boundingBox())!;
    await page.mouse.move(serviceSourceBox.x + serviceSourceBox.width / 2, serviceSourceBox.y + serviceSourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dbTargetBox.x + dbTargetBox.width / 2, dbTargetBox.y + dbTargetBox.height / 2, { steps: 8 });
    await page.waitForTimeout(100);
    await page.mouse.up();

    await expect(page.locator(".react-flow__edge")).toHaveCount(2);

    // Configure traffic via Workloads panel
    const workloadsInspector = await openWorkloads(page);
    await expect(workloadsInspector).toBeVisible();
    await workloadsInspector.getByRole("button", { name: "+ Add Workload" }).click();

    // Set duration to 2s
    const durationInput = workloadsInspector.getByRole("spinbutton", { name: "Simulation Duration" });
    await durationInput.fill("2");

    // Run simulation
    const runBtn = page.getByRole("button", { name: "Run", exact: true });
    await runBtn.click();
    await expect(page.getByRole("button", { name: "Replay", exact: true })).toBeVisible({ timeout: 20000 });

    // Inspect separate root and message metrics
    await openMetricsDetails(page);
    const metricsPanel = page.locator(".open-metrics-panel");
    await expect(metricsPanel).toBeVisible();
    await expect(metricsPanel.locator(".metrics-card").filter({ hasText: "Root requests" })).toBeVisible();
    await expect(metricsPanel.locator(".metrics-card").filter({ hasText: "Background messages" })).toBeVisible();

    // Save result
    await page.getByRole("button", { name: "Save result", exact: true }).click();
    const saveForm = page.locator(".save-result-form");
    await saveForm.getByRole("textbox", { name: "Result name", exact: true }).fill("Manual pipeline baseline");
    await saveForm.getByRole("button", { name: "Save", exact: true }).click();

    // Verify saved result in results panel
    const resultsPanel = page.getByRole("region", { name: "Saved experiment results", exact: true });
    await expect(resultsPanel).toBeVisible();
    await expect(resultsPanel.locator("summary").filter({ hasText: "Manual pipeline baseline" })).toBeVisible();
    await page.getByRole("button", { name: "Close saved results", exact: true }).click();
    await expect(resultsPanel).toBeHidden();
  });
});

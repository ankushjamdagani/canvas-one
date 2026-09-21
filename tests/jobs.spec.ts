import { test, expect } from "@playwright/test";
import * as fs from "fs";
import { componentNode, openWorkloads, openMetricsDetails } from "./openHelpers";

async function openTutorial(page: any, title: string) {
  const directBtn = page.getByRole("button", { name: "Examples & tutorials" });
  if (await directBtn.first().isVisible()) {
    await directBtn.first().click();
  } else {
    await page.locator(".project-switch").click();
    await page.getByRole("button", { name: "Examples & tutorials" }).click();
  }
  const modal = page.locator(".examples-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("tab", { name: "Guided tutorials" }).click();
  const item = modal.locator(".example-list-item").filter({ hasText: title });
  await item.click();
  await page.getByRole("button", { name: "Load example" }).click();
  await expect(modal).toBeHidden();
  await page.waitForTimeout(200);
}

test.describe("Job burst and retry behavior", () => {
  test("burst job execution tracks root admission and asynchronous background message completion", async ({ page }) => {
    await page.goto("/");
    await openTutorial(page, "Absorb a job burst");

    // Shorten duration to 2s
    await openWorkloads(page);
    const durationInput = page.getByRole("spinbutton", { name: "Simulation Duration" });
    await durationInput.fill("2");

    // Inspect Job worker behavior before run
    await componentNode(page, "Job worker").click();
    const inspector = page.getByRole("complementary", { name: "Component inspector" });
    await expect(inspector).toBeVisible();

    const concurrencyInput = inspector.getByRole("spinbutton", { name: "Concurrency (Workers)" });
    await concurrencyInput.fill("4");

    // Run simulation
    const runButton = page.getByRole("button", { name: "Run", exact: true });
    await runButton.click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay" })).toBeVisible({ timeout: 20000 });

    // Root requests and background messages are tracked in the metrics cards
    await openMetricsDetails(page);
    const metricsPanel = page.locator(".open-metrics-panel");
    await expect(metricsPanel).toBeVisible();

    const rootCard = metricsPanel.locator(".metrics-card").filter({ hasText: "Root requests" });
    const bgCard = metricsPanel.locator(".metrics-card").filter({ hasText: "Background messages" });

    await expect(rootCard).toBeVisible();
    await expect(bgCard).toBeVisible();

    // Verify root requests were generated and admitted
    const rootGenerated = rootCard.locator(".metric-item:has-text('Generated') strong");
    await expect(rootGenerated).not.toHaveText("—");

    // Verify background messages were processed
    const bgGenerated = bgCard.locator(".metric-item:has-text('Generated') strong");
    await expect(bgGenerated).not.toHaveText("—");
  });

  test("increasing max retries on worker updates retry budget and persists in model", async ({ page }) => {
    await page.goto("/");
    await openTutorial(page, "Understand retry cost");

    // Shorten duration to 2s
    await openWorkloads(page);
    const durationInput = page.getByRole("spinbutton", { name: "Simulation Duration" });
    await durationInput.fill("2");

    // Select Job worker
    await componentNode(page, "Job worker").click();
    const inspector = page.getByRole("complementary", { name: "Component inspector" });
    await expect(inspector).toBeVisible();

    // Configure Max Retries and Retry Delay
    const retriesInput = inspector.getByRole("spinbutton", { name: "Max Retries" });
    await retriesInput.fill("2");

    const retryDelayInput = inspector.getByRole("spinbutton", { name: "Retry Delay" });
    await retryDelayInput.fill("150");

    // Run simulation to observe retries under failure
    const runButton = page.getByRole("button", { name: "Run", exact: true });
    await runButton.click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay" })).toBeVisible({ timeout: 20000 });

    // Check node breakdown for retries counter
    await openMetricsDetails(page);
    const details = page.locator(".node-resource-details");
    await details.locator("summary").click();
    const workerRow = details.locator("tr").filter({ hasText: "Job worker" });
    await expect(workerRow).toBeVisible();

    // Export model and verify retry config roundtrip
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fileContent = JSON.parse(fs.readFileSync(downloadPath!, "utf-8"));
    const exportedWorker = fileContent.project.graph.nodes.find((n: any) => n.name === "Job worker");
    expect(exportedWorker.behavior.maxRetries).toBe(2);
    expect(exportedWorker.behavior.retryDelayMs).toBe(150);
    expect(exportedWorker.behavior.failureRate).toBe(50);
  });
});

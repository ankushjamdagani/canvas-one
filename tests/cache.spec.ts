import { test, expect } from "@playwright/test";
import * as fs from "fs";
import { componentNode, openWorkloads, openMetricsDetails } from "./openHelpers";

async function openTutorial(page: import("@playwright/test").Page, title: string) {
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

test.describe("Cache behavior and pressure", () => {
  test("adjusting cache hit rate from 0% to 80% reduces database arrivals and increases cache hits", async ({ page }) => {
    await page.goto("/");
    await openTutorial(page, "Relieve database pressure");

    // Shorten duration to 2s for fast test execution
    await openWorkloads(page);
    const durationInput = page.getByRole("spinbutton", { name: "Simulation Duration" });
    await durationInput.fill("2");

    // Run baseline with 0% hit rate
    const runButton = page.getByRole("button", { name: "Run", exact: true });
    await runButton.click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay" })).toBeVisible({ timeout: 20000 });

    // Open node resource breakdown details
    await openMetricsDetails(page);
    const details = page.locator(".node-resource-details");
    await details.locator("summary").click();

    // In baseline (0% hit rate), Query cache should have 0 hits and all misses
    const cacheRow = details.locator("tr").filter({ hasText: "Query cache" });
    await expect(cacheRow).toContainText("Hits: 0");

    // Select Query cache component to update behavior
    await componentNode(page, "Query cache").click();
    const inspector = page.getByRole("complementary", { name: "Component inspector" });
    await expect(inspector).toBeVisible();

    const hitRateInput = inspector.getByRole("spinbutton", { name: "Hit Rate" });
    await hitRateInput.fill("80");

    // Replay simulation with 80% hit rate
    const replayButton = page.getByRole("button", { name: "Run", exact: true });
    await replayButton.click();
    await expect(page.getByRole("button", { name: "Replay" })).toBeVisible({ timeout: 20000 });

    // Verify cache hits are now observed
    await expect(cacheRow).not.toContainText("Hits: 0");

    // Export JSON to verify configured hit rate persists in project export
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fileContent = JSON.parse(fs.readFileSync(downloadPath!, "utf-8"));
    const exportedCache = fileContent.project.graph.nodes.find((n: any) => n.name === "Query cache");
    expect(exportedCache.behavior.hitRate).toBe(80);
    expect(exportedCache.behavior.type).toBe("cache");
  });

  test("finite LRU cache entries and TTL parameters persist and reflect in exported model", async ({ page }) => {
    await page.goto("/");
    await openTutorial(page, "Warm a finite cache");

    // Select Finite LRU cache node
    await componentNode(page, "Finite LRU cache").click();
    const inspector = page.getByRole("complementary", { name: "Component inspector" });
    await expect(inspector).toBeVisible();

    // Check mode is LRU and inspect default entries limit
    const modeSelect = inspector.locator("label:has-text('Cache Eviction Mode') select");
    await expect(modeSelect).toHaveValue("lru");

    // Update Cache Entries Limit to 150 and TTL to 15000
    const entriesInput = inspector.getByRole("spinbutton", { name: "Cache Entries Limit" });
    await entriesInput.fill("150");

    const ttlInput = inspector.getByRole("spinbutton", { name: "Time To Live (TTL)" });
    await ttlInput.fill("15000");

    // Verify changes through JSON export
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fileContent = JSON.parse(fs.readFileSync(downloadPath!, "utf-8"));
    const exportedCache = fileContent.project.graph.nodes.find((n: any) => n.name === "Finite LRU cache");
    expect(exportedCache.behavior.entries).toBe(150);
    expect(exportedCache.behavior.ttlMs).toBe(15000);
    expect(exportedCache.behavior.mode).toBe("lru");
  });
});

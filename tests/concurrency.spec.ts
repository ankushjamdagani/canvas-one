import { test, expect } from "@playwright/test";
import * as fs from "fs";
import { componentNode, openWorkloads } from "./openHelpers";

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

test.describe("Concurrency and worker scaling", () => {
  test("scaling worker concurrency updates resource config and observed active slot metrics", async ({ page }) => {
    await page.goto("/");
    await openTutorial(page, "Scale a worker pool");

    // Shorten duration to 2s
    await openWorkloads(page);
    const durationInput = page.getByRole("spinbutton", { name: "Simulation Duration" });
    await durationInput.fill("2");

    // Select Redirect service to configure concurrency
    await componentNode(page, "Redirect service").click();
    const inspector = page.getByRole("complementary", { name: "Component inspector" });
    await expect(inspector).toBeVisible();

    // Verify initial concurrency
    const concurrencyInput = inspector.getByRole("spinbutton", { name: "Concurrency (Workers)" });
    await expect(concurrencyInput).toHaveValue("1");

    // Increase concurrency to 4 workers
    await concurrencyInput.fill("4");

    // Run simulation
    const runButton = page.getByRole("button", { name: "Run", exact: true });
    await runButton.click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay" })).toBeVisible({ timeout: 20000 });

    // Verify active slots in inspector metrics reflect the new limit of 4
    await expect(inspector.locator(".open-metric-label:has-text('Active Slots') + .open-metric-val")).toContainText("/ 4");

    // Export JSON and assert configuration
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fileContent = JSON.parse(fs.readFileSync(downloadPath!, "utf-8"));
    const exportedService = fileContent.project.graph.nodes.find((n: any) => n.name === "Redirect service");
    expect(exportedService.behavior.concurrency).toBe(4);
  });

  test("scaling horizontal service instances configures duplicate service parameters and edges", async ({ page }) => {
    await page.goto("/");
    await openTutorial(page, "Scale service instances");

    // Verify Redirect service 2 exists
    const svc2Node = componentNode(page, "Redirect service 2");
    await expect(svc2Node).toBeVisible();

    await svc2Node.click();
    const inspector = page.getByRole("complementary", { name: "Component inspector" });
    await expect(inspector).toBeVisible();

    // Modify capacity of service instance 2
    const capacityInput = inspector.getByRole("spinbutton", { name: "Processing Capacity" });
    await capacityInput.fill("350");

    // Export JSON to verify configured capacity and instance graph topology
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fileContent = JSON.parse(fs.readFileSync(downloadPath!, "utf-8"));

    const svc2 = fileContent.project.graph.nodes.find((n: any) => n.name === "Redirect service 2");
    expect(svc2).toBeDefined();
    expect(svc2.behavior.capacity).toBe(350);

    const edges = fileContent.project.graph.edges.filter((e: any) => e.source === svc2.id || e.target === svc2.id);
    expect(edges.length).toBeGreaterThanOrEqual(2);
  });
});

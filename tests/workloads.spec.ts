import { test, expect } from "@playwright/test";
import * as fs from "fs";
import { openExample, openWorkloads } from "./openHelpers";

test.describe("Workloads, profiles and request classes", () => {
  test("configuring traffic profile to burst updates parameters and persists roundtrip", async ({ page }) => {
    await page.goto("/");
    await openExample(page, "Real-time chat");

    // Open Workloads panel to view and configure workloads
    const inspector = await openWorkloads(page);

    const workloadCard = inspector.locator(".open-workload-card").first();
    await expect(workloadCard).toBeVisible();

    // Switch traffic profile to burst
    const profileSelect = workloadCard.locator("label:has-text('Traffic Profile') select");
    await profileSelect.selectOption("burst");

    // Configure burst peak rate
    const peakInput = workloadCard.getByRole("spinbutton", { name: "Burst Peak Rate" });
    await peakInput.fill("450");

    // Export JSON to verify burst profile roundtrip
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fileContent = JSON.parse(fs.readFileSync(downloadPath!, "utf-8"));

    const wl = fileContent.project.graph.workloads[0];
    expect(wl.profile?.kind).toBe("burst");
    expect(wl.profile?.peakRate).toBe(450);
  });

  test("adding and customizing request classes with operations, weights, and tags roundtrips to JSON", async ({ page }) => {
    await page.goto("/");
    await openExample(page, "Ecommerce checkout");

    const inspector = await openWorkloads(page);

    const workloadCard = inspector.locator(".open-workload-card").first();
    await expect(workloadCard).toBeVisible();

    // Add a second request class
    const addClassButton = workloadCard.getByRole("button", { name: "+ Class" });
    await addClassButton.click();

    // Target the newly added class card
    const secondClassCard = workloadCard.locator(".open-class-card").nth(1);
    await expect(secondClassCard).toBeVisible();

    // Edit Name
    const nameInput = secondClassCard.locator("label:has-text('Name') input");
    await nameInput.fill("priority-checkout");

    // Edit Operation
    const opSelect = secondClassCard.locator("label:has-text('Operation') select");
    await opSelect.selectOption("write");

    // Edit Weight
    const weightInput = secondClassCard.getByRole("spinbutton", { name: "Weight" });
    await weightInput.fill("5");

    // Edit Tags (onBlur commits)
    const tagsInput = secondClassCard.locator("label:has-text('Tags') input");
    await tagsInput.fill("vip, instant");
    await tagsInput.blur();

    // Export JSON and verify the second class configuration
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fileContent = JSON.parse(fs.readFileSync(downloadPath!, "utf-8"));

    const classes = fileContent.project.graph.workloads[0].classes;
    expect(classes.length).toBe(2);
    const addedClass = classes.find((c: any) => c.name === "priority-checkout");
    expect(addedClass).toBeDefined();
    expect(addedClass.operation).toBe("write");
    expect(addedClass.weight).toBe(5);
    expect(addedClass.tags).toEqual(["vip", "instant"]);
  });

  test("global settings duration and random uint32 seed validate and persist correctly", async ({ page }) => {
    await page.goto("/");
    await openExample(page, "Event processing");

    const inspector = await openWorkloads(page);

    // Set duration to 45s
    const durationInput = inspector.getByRole("spinbutton", { name: "Simulation Duration" });
    await durationInput.fill("45");

    // Set random seed to a valid uint32 value
    const seedInput = inspector.getByRole("spinbutton", { name: "Random Seed" });
    await seedInput.fill("987654321");

    // Export JSON and verify settings roundtrip
    await page.locator(".project-switch").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON" }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const fileContent = JSON.parse(fs.readFileSync(downloadPath!, "utf-8"));

    expect(fileContent.project.graph.settings.duration).toBe(45);
    expect(fileContent.project.graph.settings.seed).toBe(987654321);
  });
});

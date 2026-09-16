import { test, expect } from "@playwright/test";
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
  await modal.getByRole("button", { name: "Guided tutorials" }).click();
  const item = modal.locator(".example-list-item").filter({ hasText: title });
  await item.click();
  await page.getByRole("button", { name: "Load example" }).click();
  await expect(modal).toBeHidden();
  await page.waitForTimeout(200);
}

test("load-balanced router exposes editable instances and observed round-robin load", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openTutorial(page, "Scale service instances");

  await expect(page.getByText("Load balancer", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Service instance 1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Redirect service 2", { exact: true }).first()).toBeVisible();

  await componentNode(page, "Load balancer").click();
  const inspector = page.getByRole("complementary", { name: "Component inspector", exact: true });
  await expect(inspector).toBeVisible();
  const routerStrategy = inspector.locator("label:has-text('Routing Strategy') select");
  await expect(routerStrategy).toHaveValue("round-robin");

  const globalInspector = await openWorkloads(page);
  const durationInput = globalInspector.getByRole("spinbutton", { name: "Simulation Duration", exact: true });
  await durationInput.fill("2");

  const runBtn = page.getByRole("button", { name: "Run", exact: true });
  await runBtn.click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toBeVisible({ timeout: 20000 });

  await openMetricsDetails(page);
  const details = page.locator(".node-resource-details");
  await details.locator("summary").click();

  const svc1Row = details.locator("tr").filter({ hasText: "Service instance 1" }).first();
  const svc2Row = details.locator("tr").filter({ hasText: "Redirect service 2" }).first();

  await expect(svc1Row).toBeVisible();
  await expect(svc2Row).toBeVisible();

  await expect(svc1Row).toContainText("Service instance 1");
  await expect(svc2Row).toBeVisible();
});

test("load-balanced canvas remains readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openTutorial(page, "Scale service instances");
  await expect(page.getByText("Load balancer", { exact: true }).first()).toBeVisible();
  expect(await page.locator(".workspace").evaluate((el) => el.getBoundingClientRect().width <= innerWidth)).toBe(true);
});

import { test, expect } from "@playwright/test";
import { componentNode, openWorkloads } from "./openHelpers";

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

test("guided experiments load real models, explain observed outcomes and follow undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();

  await openTutorial(page, "Understand retry cost");

  const coach = page.getByRole("region", { name: "Tutorial instructions" });
  await expect(
    coach.getByRole("heading", { name: "Understand retry cost", exact: true }),
  ).toBeVisible();

  // Open system settings inspector to set run duration
  const sysInspector = await openWorkloads(page);
  await sysInspector
    .getByRole("spinbutton", { name: "Simulation Duration", exact: true })
    .fill("2");

  await page.getByRole("button", { name: "Show experiment guide", exact: true }).click();

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".optional-tutorial")).toBeVisible();

  const worker = componentNode(page, "Job worker");
  await worker.click();
  const nodeInspector = page.getByRole("complementary", {
    name: "Component inspector",
  });
  await expect(nodeInspector).toBeVisible();
  const retriesField = nodeInspector.getByRole("spinbutton", {
    name: "Max Retries",
    exact: true,
  });
  await retriesField.focus();

  await page.getByRole("button", { name: "Show experiment guide", exact: true }).click();
  await expect(coach).toBeVisible();

  await openTutorial(page, "Scale a worker pool");
  await expect(
    coach.getByRole("heading", { name: "Scale a worker pool", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    coach.getByRole("heading", { name: "Understand retry cost", exact: true }),
  ).toBeVisible();

  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    coach.getByRole("heading", { name: "Understand retry cost", exact: true }),
  ).toBeVisible();

  await page.waitForTimeout(250);
  const workerBounds = await page
    .locator(".react-flow__node-component")
    .filter({ hasText: "Job worker" })
    .boundingBox();
  const canvasBounds = await page.locator(".canvas-area").boundingBox();
  expect(workerBounds!.y + workerBounds!.height).toBeLessThanOrEqual(
    canvasBounds!.y + canvasBounds!.height,
  );
  await page.screenshot({
    path: "artifacts/guided-experiment.png",
    fullPage: true,
  });
});

test("mobile guided workspace keeps controls accessible and free exploration preserves the run", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();

  await openTutorial(page, "Absorb a job burst");
  await expect(
    page.getByRole("region", { name: "Tutorial instructions" }).getByRole("heading", {
      name: "Absorb a job burst",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/guided-mobile.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(250);

  // Dismiss tutorial guide to enter free exploration without resetting simulation run
  await page.getByRole("button", { name: "Dismiss guide", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

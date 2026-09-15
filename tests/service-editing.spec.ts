import { expect, test } from "@playwright/test";
import { componentNode } from "./openHelpers";

async function openGuidedTutorial(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: "Examples & tutorials", exact: true }).click();
  const modal = page.locator(".examples-modal");
  await expect(modal).toBeVisible();
  await page.getByRole("button", { name: "Guided tutorials", exact: true }).click();
  const item = modal.locator(".example-list-item").filter({ hasText: title });
  await item.click();
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await expect(modal).toBeHidden();
  await page.waitForTimeout(200);
}

test("service parameters edit immediately, undo redo, persist in project export and restore saved models", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openGuidedTutorial(page, "Scale service instances");

  await page.locator(".react-flow__pane").click({ position: { x: 10, y: 65 } });
  const globalInspector = page.getByRole("complementary", { name: "System configuration inspector", exact: true });
  await expect(globalInspector).toBeVisible();
  const durationInput = globalInspector.getByRole("spinbutton", { name: "Simulation Duration", exact: true });
  await durationInput.fill("2");

  await componentNode(page, "Service instance 1").first().click();
  const inspector = page.getByRole("complementary", { name: "Component inspector", exact: true });
  await expect(inspector).toBeVisible();

  const capacity = inspector.getByRole("spinbutton", {
    name: "Processing Capacity",
    exact: true,
  });
  const queue = inspector.getByRole("spinbutton", {
    name: "Queue Limit",
    exact: true,
  });

  await capacity.fill("250");
  await queue.fill("0");
  await expect(capacity).toHaveValue("250");
  await expect(queue).toHaveValue("0");

  const runBtn = page.getByRole("button", { name: "Run", exact: true });
  await runBtn.click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(queue).toHaveValue("500");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(queue).toHaveValue("0");

  await runBtn.click();
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save result", exact: true }).click();
  const saveForm = page.locator(".save-result-form");
  await saveForm.getByRole("textbox", { name: "Result name", exact: true }).fill("Inline service model");
  await saveForm.getByRole("button", { name: "Save", exact: true }).click();

  const resultsPanel = page.getByRole("region", { name: "Saved experiment results", exact: true });
  await expect(resultsPanel).toBeVisible();
  await page.getByRole("button", { name: "Close saved results", exact: true }).click();
  await expect(resultsPanel).toBeHidden();

  await componentNode(page, "Service instance 1").first().click();
  await capacity.fill("300");
  await expect(capacity).toHaveValue("300");

  await page.getByRole("button", { name: /Saved runs/, exact: false }).click();
  await expect(resultsPanel).toBeVisible();
  await resultsPanel.getByRole("combobox", { name: "Compare result", exact: true }).selectOption({ label: "Inline service model" });
  await resultsPanel.getByRole("button", { name: "Restore this model", exact: true }).click();
  await expect(resultsPanel).toBeHidden();

  await componentNode(page, "Service instance 1").first().click();
  await expect(capacity).toHaveValue("250");
  await expect(queue).toHaveValue("0");

  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await componentNode(page, "Service instance 1").first().click();
  await expect(capacity).toHaveValue("250");
  await expect(queue).toHaveValue("0");
});

test("service controls reject invalid bounds, protect form inputs and fit mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openGuidedTutorial(page, "Scale service instances");

  await componentNode(page, "Service instance 1").first().click();
  const inspector = page.getByRole("complementary", { name: "Component inspector", exact: true });
  await expect(inspector).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });

  const capacity = inspector.getByRole("spinbutton", {
    name: "Processing Capacity",
    exact: true,
  });
  const queue = inspector.getByRole("spinbutton", {
    name: "Queue Limit",
    exact: true,
  });

  await capacity.fill("-10");
  await capacity.evaluate((input: HTMLInputElement) => input.blur());
  await expect(capacity).toHaveValue("1");

  await queue.fill("-5");
  await queue.evaluate((input: HTMLInputElement) => input.blur());
  await expect(queue).toHaveValue("0");

  const nameInput = inspector.locator("label:has-text('Name') input");
  await nameInput.click();
  await nameInput.fill("Service instance 1");
  await nameInput.press("End");
  await nameInput.type(" Custom Service");
  await expect(nameInput).toHaveValue("Service instance 1 Custom Service");

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

import { test, expect } from "@playwright/test";
test("guided experiments load real models, explain observed outcomes and follow undo", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  const picker = page.getByRole("combobox", {
    name: "Guided experiment",
    exact: true,
  });
  await picker.selectOption("retry-budget");
  const coach = page.getByRole("region", {
    name: "Experiment guide",
    exact: true,
  });
  await expect(
    coach.getByRole("heading", { name: "Understand retry cost", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Run duration", exact: true })
    .fill("2");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(
    coach.getByText(/producer acknowledgements confirm admission/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand Job worker", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Job worker internals", exact: true })
    .getByRole("spinbutton", { name: "Job worker Max retries", exact: true })
    .focus();
  await page
    .getByRole("button", { name: "Show experiment guide", exact: true })
    .click();
  await expect(coach).toBeVisible();
  await picker.selectOption("worker-scaling");
  await expect(
    page.getByRole("combobox", { name: "Experiment path", exact: true }),
  ).toHaveValue("lookup");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(picker).toHaveValue("retry-budget");
  await expect(
    page.getByRole("combobox", { name: "Experiment path", exact: true }),
  ).toHaveValue("jobs");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(picker).toHaveValue("retry-budget");
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
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  const picker = page.getByRole("combobox", {
    name: "Guided experiment",
    exact: true,
  });
  await picker.selectOption("burst-jobs");
  await expect(
    page.getByRole("heading", { name: "Absorb a job burst", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/guided-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(250);
  await picker.selectOption("");
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

import { test, expect } from "@playwright/test";
test("jobs distinguish admission and completion, replay retries, and retain portable results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Experiment path", exact: true })
    .selectOption("jobs");
  await page
    .getByRole("spinbutton", { name: "Run duration", exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Expand Job worker", exact: true })
    .click();
  const worker = page.getByRole("region", {
    name: "Job worker internals",
    exact: true,
  });
  await worker
    .getByRole("spinbutton", {
      name: "Job worker Failure · %/attempt",
      exact: true,
    })
    .fill("100");
  await worker
    .getByRole("spinbutton", { name: "Job worker Max retries", exact: true })
    .fill("1");
  await worker
    .getByRole("button", { name: "Apply job settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Live metrics/ }).click();
  await expect(
    page.getByRole("heading", { name: "Job accounting", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Accepted / producer acknowledged", { exact: true }),
  ).toBeVisible();
  const failures = await page.getByTestId("failures").innerText();
  expect(Number(failures.replaceAll(",", ""))).toBeGreaterThan(0);
  await expect(page.getByTestId("throughput")).toHaveText("0/s");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("failures")).toHaveText(failures);
  await page.getByRole("button", { name: "Save result", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Result name", exact: true })
    .fill("Retry exhaustion");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("row", { name: /Permanent failures/ }),
  ).toBeVisible();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Experiment path", exact: true }),
  ).toHaveValue("jobs");
  await expect(
    page.getByRole("button", { name: "Retry exhaustion", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(200);
  const workerBox = await page
    .locator(".react-flow__node")
    .filter({ hasText: "Job worker" })
    .boundingBox();
  expect(workerBox!.width).toBeGreaterThan(150);
  await page.screenshot({
    path: "artifacts/background-jobs.png",
    fullPage: true,
  });
});
test("job queue controls fit mobile and path switching is undoable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Experiment path", exact: true })
    .selectOption("jobs");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Experiment path", exact: true }),
  ).toHaveValue("lookup");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByRole("button", { name: "Expand Job queue", exact: true })
    .click();
  const internals = page.getByRole("region", {
    name: "Job queue internals",
    exact: true,
  });
  await internals
    .getByRole("spinbutton", { name: "Job queue Waiting slots", exact: true })
    .fill("0");
  await internals
    .getByRole("button", { name: "Apply job settings", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    internals.getByText("Acknowledgement means admitted, not completed."),
  ).toBeVisible();
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/background-jobs-mobile.png",
    fullPage: true,
  });
});

import { test, expect } from "./fixtures";
import { recording, range, tab, noOverflow } from "./simulation-support";

test("source range scope and selected cycle lifetime remain distinct", async ({
  page,
}) => {
  await recording(page);
  await range(page, 0.2, 0.8);
  const pane = await tab(page, "Summary");
  await expect(pane).toContainText('RANGE');
  const intervalCompleted = await pane
    .getByTestId("scope-completed")
    .innerText();
  expect(Number(intervalCompleted.match(/\d+/)?.[0])).toBeLessThan(6);
  await tab(page, "Cycles");
  await pane.getByTestId("cycle-inspection-row").first().click();
  await expect(
    pane.getByRole("region", { name: "Selected cycle", exact: true }),
  ).toBeVisible();
  await expect(pane).toContainText(/Response|Latency/i);
  await expect(pane.getByRole('region', { name: 'Selected cycle', exact: true })).toContainText('Full recorded all-work lifetime');
  await expect(pane.getByRole('region', { name: 'Selected cycle', exact: true })).toContainText('source response');
  await noOverflow(page);
});

test("source failure filter applies to cycle list", async ({ page }) => {
  await recording(page);
  const pane = await tab(page, "Cycles");
  await expect(pane.getByTestId("cycle-inspection-row")).toHaveCount(6);
  await pane.getByRole("button", { name: "Failed", exact: true }).click();
  await expect(pane.getByTestId("cycle-inspection-row")).toHaveCount(0);
  await pane.getByRole("button", { name: "All", exact: true }).click();
  await expect(pane.getByTestId("cycle-inspection-row")).toHaveCount(6);
});

test("source inspection does not disturb a dirty authoring draft", async ({
  page,
}) => {
  await recording(page);
  await page
    .locator('[data-element-id="00000000-0006-4000-8000-000000000004"]')
    .click();
  const capacity = page.getByTestId("inspector-field-config.capacity");
  await capacity.fill("2100");
  const pane = await tab(page, "Cycles");
  await pane.getByTestId("cycle-inspection-row").first().click();
  await tab(page, "Events");
  await expect(page.getByTestId("inspector-guard-dialog")).toHaveCount(0);
  await expect(capacity).toHaveValue("2100");
});

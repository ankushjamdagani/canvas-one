import { expect, test } from "@playwright/test";
test("collapsed subsystems preserve live runs, reopen and expose editable children", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("spinbutton", { name: "Run duration", exact: true })
    .fill("4");
  await page
    .getByRole("button", { name: "Create subsystem", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Subsystem name", exact: true })
    .fill("Redirect backend");
  await page
    .getByRole("button", { name: "Group components", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Collapse Redirect backend on canvas",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const before = await page.getByTestId("throughput").textContent();
  await page
    .getByRole("button", {
      name: "Collapse Redirect backend on canvas",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("throughput")).toHaveText(before!);
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Expand Redirect service", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Expand Redirect backend on canvas",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".traffic-edge-label")).toHaveCount(1);
  await page.waitForTimeout(150);
  await page.screenshot({
    path: "artifacts/subsystem-collapsed.png",
    fullPage: true,
  });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Expand Redirect backend on canvas",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Expand Redirect backend on canvas",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Expand Redirect service", exact: true })
    .click();
  await page
    .getByRole("spinbutton", {
      name: "Service processing capacity",
      exact: true,
    })
    .fill("250");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await page.screenshot({
    path: "artifacts/subsystem-expanded.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Ungroup Redirect backend", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", {
      name: "Service processing capacity",
      exact: true,
    }),
  ).toHaveValue("250");
});
test("mobile subsystem summary remains readable and can reveal members", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Create subsystem", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Group components", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Collapse Subsystem on canvas", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByText("2 components · same model", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand Subsystem on canvas", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Expand Redirect service", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/subsystem-mobile.png",
    fullPage: true,
  });
});

import { test, expect } from "@playwright/test";

test("load-balanced lookup exposes editable instances and observed round-robin load", async ({ page }) => {
  await page.goto("/");
  const path = page.getByRole("combobox", { name: "Experiment path", exact: true });
  await path.selectOption("balanced");
  await expect(page.getByText("Load balancer", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Expand Load balancer/ }).click();
  await expect(page.getByRole("region", { name: "Service instance routing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add service instance", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add service instance", exact: true }).click();
  await expect(page.getByText("Service instance 2", { exact: true }).first()).toBeVisible();
  await page.getByRole("spinbutton", { name: "Run duration", exact: true }).fill("2");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/routed ·/).first()).toBeVisible();
  await expect(page.getByText(/Round robin routed/)).toBeVisible();
  await page.screenshot({ path: "artifacts/load-balanced.png", fullPage: true });
});

test("load-balanced canvas remains readable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("balanced");
  await expect(page.getByText("Load balancer", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/load-balanced-mobile.png", fullPage: true });
});

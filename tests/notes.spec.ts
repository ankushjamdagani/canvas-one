import { expect, test } from "@playwright/test";
import { openExample } from "./openHelpers";

test("authors, edits, deletes and restores a canvas note", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await openExample(page, "Ecommerce checkout");
  await page.getByRole("button", { name: "Add canvas note", exact: true }).click();

  const editor = page.locator('aside[aria-label="Canvas note editor"]');
  await expect(editor).toBeVisible();
  await editor.getByLabel("Note type").selectOption("decision");
  await editor.getByRole("textbox", { name: "Note title" }).fill("Use an edge cache");
  await editor.getByRole("textbox", { name: "Note text" }).fill("Reduce repeated reads for hot content.");
  await editor.getByLabel("Link note to").selectOption({ label: "Component · Storefront" });
  await editor.getByRole("button", { name: "Apply note", exact: true }).click();
  await expect(page.getByLabel("Decision: Use an edge cache")).toBeVisible();
  await expect(page.getByText("Linked to Storefront", { exact: true })).toBeVisible();

  await editor.getByRole("button", { name: "Collapse note", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand note Use an edge cache", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand note Use an edge cache", exact: true }).click();
  await expect(page.locator(".canvas-note").getByText("Reduce repeated reads for hot content.", { exact: true })).toBeVisible();

  await editor.getByRole("button", { name: "Delete note", exact: true }).click();
  await expect(page.getByLabel("Decision: Use an edge cache")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Decision: Use an edge cache")).toBeVisible();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Decision: Use an edge cache")).toBeVisible();
  await expect(page.getByText("Linked to Storefront", { exact: true })).toBeVisible();
  const noteCard = page.getByLabel("Decision: Use an edge cache");
  await noteCard.click();
  const beforeDrag = await noteCard.boundingBox();
  await page.mouse.move(beforeDrag!.x + beforeDrag!.width / 2, beforeDrag!.y + beforeDrag!.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeDrag!.x + beforeDrag!.width / 2 + 55, beforeDrag!.y + beforeDrag!.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
  const afterDrag = await noteCard.boundingBox();
  expect(afterDrag!.x - beforeDrag!.x).toBeGreaterThan(35);
  expect(afterDrag!.y - beforeDrag!.y).toBeGreaterThan(20);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const afterUndo = await noteCard.boundingBox();
  expect(afterUndo!.x).toBeCloseTo(beforeDrag!.x, 0);
  expect(afterUndo!.y).toBeCloseTo(beforeDrag!.y, 0);
  await noteCard.click();
  await expect(page.locator('aside[aria-label="Canvas note editor"]')).toBeVisible();
  await page.screenshot({ path: "artifacts/canvas-notes.png", fullPage: true });
});

test("canvas note editing fits a mobile viewport and persists text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Add canvas note", exact: true }).click();

  const editor = page.locator('aside[aria-label="Canvas note editor"]');
  await expect(editor).toBeVisible();
  await editor.getByLabel("Note type").selectOption("question");
  await editor.getByRole("textbox", { name: "Note title" }).fill("Mobile review");
  await editor.getByRole("textbox", { name: "Note text" }).fill("Check the narrow canvas layout.");
  await editor.getByRole("button", { name: "Apply note", exact: true }).click();
  await expect(page.getByLabel("Question: Mobile review")).toBeVisible();
  await expect(page.locator(".canvas-note").getByText("Check the narrow canvas layout.", { exact: true })).toBeVisible();
  const canvasBox = await page.locator(".react-flow").boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox!.height).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/canvas-notes-mobile.png", fullPage: true });
});

import { expect, type Page, type Locator } from "@playwright/test";

export const componentNode = (page: Page, name: string): Locator =>
  page.locator(".react-flow__node-component").filter({ has: page.locator(`strong:has-text("${name}")`) });

export const subsystemNode = (page: Page, name?: string): Locator => {
  const base = page.locator(".react-flow__node-subsystem");
  return name ? base.filter({ hasText: name }) : base;
};

export async function openExample(page: Page, title: string) {
  const directBtn = page.getByRole("button", { name: "Examples & tutorials" });
  if (await directBtn.first().isVisible()) {
    await directBtn.first().click();
  } else {
    await page.locator(".project-switch").click();
    await page.getByRole("button", { name: "Examples & tutorials" }).click();
  }
  const modal = page.locator(".examples-modal");
  await expect(modal).toBeVisible();
  const item = modal.locator(".example-list-item").filter({ hasText: title });
  await item.click();
  await page.getByRole("button", { name: "Load example" }).click();
  await expect(modal).toBeHidden();
  await page.waitForTimeout(200); // Wait for the scheduled fit-to-new-model camera update.
}

export async function getNodePosition(page: Page, name: string): Promise<{ x: number; y: number }> {
  return componentNode(page, name).evaluate((element) => {
    const match = (element as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    if (!match) throw new Error(`Node ${name} has no translate transform`);
    return { x: Number(match[1]), y: Number(match[2]) };
  });
}

export async function selectCanvasBox(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

export async function openWorkloads(page: Page): Promise<Locator> {
  const inspector = page.getByRole("complementary", { name: "System configuration inspector" });
  if (!(await inspector.isVisible())) {
    await page.getByRole("button", { name: "Workloads" }).click();
    await expect(inspector).toBeVisible();
  }
  return inspector;
}

export async function openCatalog(page: Page): Promise<Locator> {
  const drawer = page.getByRole("complementary", { name: "Component catalog" });
  if (!(await drawer.isVisible())) {
    await page.getByRole("button", { name: "Add component" }).first().click();
    await expect(drawer).toBeVisible();
  }
  return drawer;
}

export async function openMetricsDetails(page: Page): Promise<Locator> {
  const panel = page.locator(".open-metrics-panel");
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "Details" }).click();
    await expect(panel).toBeVisible();
  }
  return panel;
}

export async function openSavedRuns(page: Page): Promise<Locator> {
  const heading = page.getByRole("button", { name: /Saved runs/ });
  if (!(await heading.first().isVisible())) {
    await page.locator(".project-switch").click();
  }
  await page.getByRole("button", { name: /Saved runs/ }).first().click();
  const panel = page.getByRole("region", { name: "Saved experiment results" });
  await expect(panel).toBeVisible();
  return panel;
}

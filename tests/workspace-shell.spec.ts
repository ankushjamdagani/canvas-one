import { test, expect } from "@playwright/test";

test.describe("Workspace Shell (TopBar & ActivityRail)", () => {
  test("desktop 1512x982: topbar height is between 50 and 54px, rail width is 44px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");

    const topbar = page.getByTestId("topbar");
    await expect(topbar).toBeVisible();
    const topbarBox = await topbar.boundingBox();
    expect(topbarBox).not.toBeNull();
    expect(topbarBox!.height).toBeGreaterThanOrEqual(50);
    expect(topbarBox!.height).toBeLessThanOrEqual(54);

    const rail = page.getByTestId("activity-rail");
    await expect(rail).toBeVisible();
    const railBox = await rail.boundingBox();
    expect(railBox).not.toBeNull();
    expect(Math.round(railBox!.width)).toBe(44);
  });

  test("every rail item has an accessible name and visible focus indicator", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");

    const rail = page.getByTestId("activity-rail");
    await expect(rail).toBeVisible();
    const railButtons = rail.locator("button");
    const count = await railButtons.count();
    expect(count).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < count; i++) {
      const btn = railButtons.nth(i);
      const accessibleName = await btn.evaluate((el) => {
        return (
          el.getAttribute("aria-label") ||
          (el as HTMLButtonElement).labels?.[0]?.innerText ||
          el.textContent?.trim()
        );
      });
      expect(accessibleName).toBeTruthy();
      expect(accessibleName!.trim().length).toBeGreaterThan(0);

      await btn.focus();
      const focusStyle = await btn.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: parseFloat(style.outlineWidth) || 0,
          boxShadow: style.boxShadow,
        };
      });
      const hasVisibleFocus =
        (focusStyle.outlineStyle !== "none" && focusStyle.outlineWidth >= 2) ||
        (focusStyle.boxShadow && focusStyle.boxShadow !== "none");
      expect(hasVisibleFocus).toBe(true);
    }
  });

  test("active rail item exposes aria-pressed or aria-current consistently", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");

    const addBtn = page.getByTestId("rail-add-component-btn");
    const workloadsBtn = page.getByTestId("rail-workloads-btn");
    const revisionsBtn = page.getByTestId("rail-revisions-btn");
    const runsBtn = page.getByTestId("rail-runs-btn");

    // Initially none of these are active
    await expect(addBtn).toHaveAttribute("aria-pressed", "false");
    await expect(workloadsBtn).toHaveAttribute("aria-pressed", "false");
    await expect(revisionsBtn).toHaveAttribute("aria-pressed", "false");
    await expect(runsBtn).toHaveAttribute("aria-pressed", "false");

    // Toggle Add component panel
    await addBtn.click();
    await expect(addBtn).toHaveAttribute("aria-pressed", "true");
    await expect(workloadsBtn).toHaveAttribute("aria-pressed", "false");

    // Toggle Workloads panel
    await workloadsBtn.click();
    await expect(workloadsBtn).toHaveAttribute("aria-pressed", "true");
    await expect(addBtn).toHaveAttribute("aria-pressed", "false");

    // Close workloads
    await workloadsBtn.click();
    await expect(workloadsBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("project name rename still works via aria-label 'Project name'", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");

    const nameInput = page.getByRole("textbox", { name: "Project name" });
    await expect(nameInput).toBeVisible();

    await nameInput.fill("Billing System v2");
    await nameInput.press("Enter");

    const switchBtn = page.getByTestId("project-switch-btn");
    await expect(switchBtn).toContainText("Billing System v2");
    await expect(nameInput).toHaveValue("Billing System v2");
  });

  test("at 390x844 with touch all topbar and rail controls are >=44px tall and none overlap canvas region", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto("/");

    const topbar = page.getByTestId("topbar");
    const rail = page.getByTestId("activity-rail");
    const canvasContainer = page.locator(".canvas-first-canvas-container");

    await expect(topbar).toBeVisible();
    await expect(rail).toBeVisible();
    await expect(canvasContainer).toBeVisible();

    const topbarBox = await topbar.boundingBox();
    const railBox = await rail.boundingBox();
    const canvasBox = await canvasContainer.boundingBox();

    expect(topbarBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();

    // Verify non-overlapping layout: topbar above rail, rail above canvas container
    expect(topbarBox!.y + topbarBox!.height).toBeLessThanOrEqual(railBox!.y + 1);
    expect(railBox!.y + railBox!.height).toBeLessThanOrEqual(canvasBox!.y + 1);

    // Verify all topbar controls are >= 44px tall and do not overlap canvas
    const topbarControls = topbar.locator("button:visible, input:visible");
    const topbarCount = await topbarControls.count();
    expect(topbarCount).toBeGreaterThan(0);

    for (let i = 0; i < topbarCount; i++) {
      const ctrl = topbarControls.nth(i);
      const box = await ctrl.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.y + box!.height).toBeLessThanOrEqual(canvasBox!.y);
    }

    // Verify all rail controls are >= 44px tall and do not overlap canvas
    const railControls = rail.locator("button:visible");
    const railCount = await railControls.count();
    expect(railCount).toBeGreaterThan(0);

    for (let i = 0; i < railCount; i++) {
      const ctrl = railControls.nth(i);
      const box = await ctrl.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.y + box!.height).toBeLessThanOrEqual(canvasBox!.y);
    }

    await context.close();
  });
});

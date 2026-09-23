import { expect, test } from "@playwright/test";

test.describe("Canvas Floating Dock (RV-04a)", () => {
  test("dock is visible at 1512x982 and 390x844", async ({ page }) => {
    // Desktop viewport
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");
    const desktopDock = page.getByTestId("canvas-floating-dock");
    await expect(desktopDock).toBeVisible();

    // Mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileDock = page.getByTestId("canvas-floating-dock");
    await expect(mobileDock).toBeVisible();
  });

  test("every dock button has an accessible name", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");
    const dock = page.getByTestId("canvas-floating-dock");
    await expect(dock).toBeVisible();

    const buttons = dock.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(9);

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const accessibleName = await btn.evaluate((el) => {
        return el.getAttribute("aria-label") || (el as HTMLElement).innerText.trim();
      });
      expect(accessibleName.trim().length).toBeGreaterThan(0);
    }
  });

  test("tab order reaches all buttons", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");
    const dock = page.getByTestId("canvas-floating-dock");
    await expect(dock).toBeVisible();

    // Verify sequential keyboard Tab reaches all currently enabled dock buttons
    const enabledButtons = dock.locator("button:not(:disabled)");
    const initialCount = await enabledButtons.count();
    expect(initialCount).toBeGreaterThanOrEqual(5);

    await enabledButtons.first().focus();
    await expect(enabledButtons.first()).toBeFocused();

    for (let i = 1; i < initialCount; i++) {
      await page.keyboard.press("Tab");
      await expect(enabledButtons.nth(i)).toBeFocused();
    }

    // Add a canvas note to create past history, enabling undo and selection
    await page.getByTestId("dock-add-note-btn").click();
    await expect(page.getByTestId("dock-undo-btn")).toBeEnabled();

    // Verify all active dock buttons are sequentially reachable in tab order
    const allActive = dock.locator("button:not(:disabled)");
    const activeCount = await allActive.count();
    expect(activeCount).toBeGreaterThan(initialCount);

    await allActive.first().focus();
    await expect(allActive.first()).toBeFocused();

    for (let i = 1; i < activeCount; i++) {
      await page.keyboard.press("Tab");
      await expect(allActive.nth(i)).toBeFocused();
    }
  });

  test("active tool exposes aria-pressed", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");

    const selectBtn = page.getByTestId("dock-select-btn");
    const panBtn = page.getByTestId("dock-pan-btn");

    await expect(selectBtn).toBeVisible();
    await expect(panBtn).toBeVisible();

    // Default mode is select
    await expect(selectBtn).toHaveAttribute("aria-pressed", "true");
    await expect(panBtn).toHaveAttribute("aria-pressed", "false");

    // Switch to pan mode
    await panBtn.click();
    await expect(panBtn).toHaveAttribute("aria-pressed", "true");
    await expect(selectBtn).toHaveAttribute("aria-pressed", "false");

    // Switch back to select mode
    await selectBtn.click();
    await expect(selectBtn).toHaveAttribute("aria-pressed", "true");
    await expect(panBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("coarse-pointer (hasTouch/isMobile context) buttons >= 44px", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/");
    const dock = page.getByTestId("canvas-floating-dock");
    await expect(dock).toBeVisible();

    const buttons = dock.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(9);

    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }




    await context.close();
  });

  test("dock computed border-radius 14px", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");
    const dock = page.getByTestId("canvas-floating-dock");
    await expect(dock).toBeVisible();

    const borderRadius = await dock.evaluate((el) => {
      return window.getComputedStyle(el).borderRadius;
    });
    expect(borderRadius).toBe("14px");
  });
});





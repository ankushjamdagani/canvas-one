import { expect, test } from "@playwright/test";
import { openExample, openWorkloads } from "./openHelpers";

test.describe("UI review regressions (2026-09-20)", () => {
  test("dock control computed styles differ between selected and unselected, and .add-canvas-note does not leak 44px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const selectBtn = page.getByTestId("dock-select-btn");
    const panBtn = page.getByTestId("dock-pan-btn");
    const addNoteBtn = page.getByTestId("dock-add-note-btn");

    await expect(selectBtn).toBeVisible();
    await expect(panBtn).toBeVisible();
    await expect(addNoteBtn).toBeVisible();

    // Default mode is select
    await expect(selectBtn).toHaveAttribute("aria-pressed", "true");
    await expect(panBtn).toHaveAttribute("aria-pressed", "false");

    const selectStyle = await selectBtn.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor };
    });
    const panStyle = await panBtn.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor };
    });

    // Selected Select must NOT compute white background (rgb(255, 255, 255)) or same color as unselected Pan
    expect(selectStyle.bg).not.toBe("rgb(255, 255, 255)");
    expect(selectStyle.bg).not.toBe(panStyle.bg);
    expect(selectStyle.color).not.toBe(panStyle.color);

    // Switch to pan mode
    await panBtn.click();
    await expect(panBtn).toHaveAttribute("aria-pressed", "true");
    await expect(selectBtn).toHaveAttribute("aria-pressed", "false");

    const panActiveStyle = await panBtn.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    });
    const selectInactiveStyle = await selectBtn.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    });

    expect(panActiveStyle.bg).not.toBe("rgb(255, 255, 255)");
    expect(panActiveStyle.bg).not.toBe(selectInactiveStyle.bg);

    // Verify .add-canvas-note does not leak 44px min-height or 100% width into dock
    const noteBox = await addNoteBtn.boundingBox();
    expect(noteBox).not.toBeNull();
    expect(noteBox!.height).toBeLessThan(35);
  });

  test("checked Switch visual state differs from unchecked and is not overridden by generic white button styles", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    // Load Ecommerce checkout fixture which contains configured workloads
    await openExample(page, "Ecommerce checkout");

    // Open workloads inspector to access the workload switch
    const inspector = await openWorkloads(page);
    await expect(inspector).toBeVisible();

    const switchBtn = inspector.getByRole("switch").first();
    // Unconditionally assert switch exists and is visible
    await expect(switchBtn).toBeVisible();

    // Verify initial checked state
    await expect(switchBtn).toHaveAttribute("data-state", "checked");
    const checkedBg = await switchBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor);

    // Checked state must not be overridden by generic unlayered white button background
    expect(checkedBg).not.toBe("rgb(255, 255, 255)");
    expect(checkedBg).not.toBe("rgba(0, 0, 0, 0)");

    // Toggle switch to unchecked
    await switchBtn.click();
    await expect(switchBtn).toHaveAttribute("data-state", "unchecked");

    // Await settled unchecked color before comparing (await CSS transitions to finish)
    await switchBtn.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const uncheckedBg = await switchBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor);

    // Colors must differ between checked and unchecked without hardcoding exact color space representation
    expect(checkedBg).not.toBe(uncheckedBg);

    // Toggle back to checked
    await switchBtn.click();
    await expect(switchBtn).toHaveAttribute("data-state", "checked");

    // Use expect.poll for computed color to return checkedBg after toggling back
    await expect.poll(async () => {
      return await switchBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    }).toBe(checkedBg);
  });

  for (const width of [390, 560]) {
    test(`mobile ${width}px: empty prompt card, CTA, and dock fit within visible container; save-status inside viewport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");

      const emptyPrompt = page.getByRole("region", { name: "Empty canvas" });
      await expect(emptyPrompt).toBeVisible();

      const promptBox = await emptyPrompt.boundingBox();
      expect(promptBox).not.toBeNull();
      // Must be completely inside the viewport horizontally
      expect(promptBox!.x).toBeGreaterThanOrEqual(8);
      expect(promptBox!.x + promptBox!.width).toBeLessThanOrEqual(width - 8);

      // "Add component" CTA must be visible and within horizontal bounds
      const addComponentBtn = emptyPrompt.getByRole("button", { name: "Add component" });
      await expect(addComponentBtn).toBeVisible();
      const addBox = await addComponentBtn.boundingBox();
      expect(addBox).not.toBeNull();
      expect(addBox!.x).toBeGreaterThanOrEqual(10);
      expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(width - 10);

      // Topbar save-status must be inside viewport
      const saveStatus = page.getByTestId("save-status");
      await expect(saveStatus).toBeVisible();
      const saveBox = await saveStatus.boundingBox();
      expect(saveBox).not.toBeNull();
      expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(width);

      // Floating dock must be visible and within container boundaries (not clipped behind results strip)
      const dock = page.getByTestId("canvas-floating-dock");
      await expect(dock).toBeVisible();
      const dockBox = await dock.boundingBox();
      const container = page.locator(".canvas-first-canvas-container");
      const containerBox = await container.boundingBox();
      expect(dockBox).not.toBeNull();
      expect(containerBox).not.toBeNull();

      // Dock bottom must not exceed container bottom
      expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(containerBox!.y + containerBox!.height + 2);

      // Dock buttons must be clickable
      const panBtn = page.getByTestId("dock-pan-btn");
      await panBtn.click();
      await expect(panBtn).toHaveAttribute("aria-pressed", "true");
    });

    test(`example picker has accessible tab semantics, listbox keyboard interaction, responsive layout, and reachable Load button on ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");

      const emptyPrompt = page.getByRole("region", { name: "Empty canvas" });
      await emptyPrompt.getByRole("button", { name: "Examples & tutorials" }).click();

      const modal = page.getByTestId("examples-modal");
      await expect(modal).toBeVisible();

      // Tabs must have role="tab", not role="button"
      const starterTab = modal.getByRole("tab", { name: "Starter architectures" });
      const tutorialTab = modal.getByRole("tab", { name: "Guided tutorials" });
      await expect(starterTab).toBeVisible();
      await expect(starterTab).toHaveAttribute("aria-selected", "true");
      await expect(tutorialTab).toBeVisible();

      // Listbox options keyboard interaction
      const listbox = modal.getByRole("listbox", { name: "Available examples" });
      await expect(listbox).toBeVisible();

      const firstOption = listbox.getByRole("option").first();
      await expect(firstOption).toHaveAttribute("aria-selected", "true");

      // Focus listbox and navigate via ArrowDown
      await firstOption.focus();
      await page.keyboard.press("ArrowDown");

      const secondOption = listbox.getByRole("option").nth(1);
      await expect(secondOption).toHaveAttribute("aria-selected", "true");

      // Load example and Cancel buttons are visible and reachable
      const loadBtn = modal.getByRole("button", { name: "Load example" });
      const cancelBtn = modal.getByRole("button", { name: "Cancel" });
      await expect(loadBtn).toBeVisible();
      await expect(cancelBtn).toBeVisible();

      const loadBox = await loadBtn.boundingBox();
      expect(loadBox).not.toBeNull();
      expect(loadBox!.y + loadBox!.height).toBeLessThanOrEqual(844);

      // Click Load example to load into canvas
      await loadBtn.click();
      await expect(modal).toBeHidden();

      // Nodes should now be rendered on canvas
      await expect(page.locator(".react-flow__node-component").first()).toBeVisible({ timeout: 5000 });
    });
  }
});

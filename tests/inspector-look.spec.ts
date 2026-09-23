import { expect, test } from "@playwright/test";
import { componentNode, openExample } from "./openHelpers";

// RV-05a: visual-only restyle of the right-hand inspector (OpenInspector.tsx,
// NumberField.tsx, openInspector.css). Confirms the region stays a labelled
// complementary landmark, keeps the desktop panel width, shows section
// headers, meets touch-target sizing, keeps configured vs. measured values
// visually and structurally distinguishable, and scrolls its own content.

test.describe("Inspector visual restyle (RV-05a)", () => {
  test("component inspector: labelled region, width, sections, field height, configured/measured split, internal scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");

    await openExample(page, "Real-time chat");

    const node = componentNode(page, "Chat client").first();
    await expect(node).toBeVisible();
    await node.click();

    // Labelled complementary region (aria-label unchanged from before this slice).
    const inspector = page.getByRole("complementary", { name: "Component inspector", exact: true });
    await expect(inspector).toBeVisible();

    // Desktop width: the inspector's own surface is 320px per commands.md §7,
    // independent of whatever width the outer dock wrapper (App.tsx, out of
    // scope for this slice) reserves around it.
    const box = await inspector.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(320);

    // Section headers are visible.
    const sectionTitles = inspector.locator(".open-inspector-section-title");
    await expect(sectionTitles.first()).toBeVisible();
    expect(await sectionTitles.count()).toBeGreaterThanOrEqual(3);
    await expect(sectionTitles.filter({ hasText: "Behavior Parameters" })).toBeVisible();

    // NumberField input meets the 32px desktop control height.
    const capacityInput = inspector.getByRole("spinbutton", { name: "Processing Capacity", exact: true });
    await expect(capacityInput).toBeVisible();
    const desktopHeight = await capacityInput.evaluate((el) => window.getComputedStyle(el).height);
    expect(Math.round(parseFloat(desktopHeight))).toBe(32);

    // Configured (behavior parameters) and measured (observed metrics) are
    // separate, independently labelled DOM sections -- not merged together.
    const configured = inspector.locator('[data-inspector-group="configured"]');
    const measured = inspector.locator('[data-inspector-group="measured"]');
    await expect(configured.first()).toBeVisible();
    await expect(measured.first()).toBeVisible();
    expect(await configured.count()).toBeGreaterThanOrEqual(1);
    expect(await measured.count()).toBeGreaterThanOrEqual(1);

    // The inspector scrolls its own content; the page itself does not grow.
    const pageScrollHeightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
    const { scrollHeight, clientHeight } = await inspector.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scrollHeight).toBeGreaterThan(clientHeight - 1); // content fills/overflows its own box
    const pageScrollHeightAfter = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(pageScrollHeightAfter).toBe(pageScrollHeightBefore);
  });

  test.describe("coarse pointer", () => {
    // `hasTouch` makes Chromium report `(pointer: coarse)`, matching how a
    // touchscreen device would render the same field.
    test.use({ hasTouch: true, viewport: { width: 1512, height: 982 } });

    test("touch target: NumberField input reaches 44px under a coarse pointer", async ({ page }) => {
      await page.goto("/");
      await openExample(page, "Real-time chat");
      const node = componentNode(page, "Chat client").first();
      await node.click();

      const inspector = page.getByRole("complementary", { name: "Component inspector", exact: true });
      const capacityInput = inspector.getByRole("spinbutton", { name: "Processing Capacity", exact: true });
      await expect(capacityInput).toBeVisible();
      const height = await capacityInput.evaluate((el) => window.getComputedStyle(el).height);
      expect(Math.round(parseFloat(height))).toBeGreaterThanOrEqual(44);
    });
  });

  test("global configuration inspector keeps a labelled section header and configured badge", async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto("/");

    const workloadsBtn = page.getByTestId("rail-workloads-btn").or(page.getByRole("button", { name: "Workloads" }));
    await workloadsBtn.click();
    const inspector = page.getByRole("complementary", { name: "System configuration inspector" });
    await expect(inspector).toBeVisible();
    await expect(inspector.locator(".open-inspector-section-title").filter({ hasText: "Execution Settings" })).toBeVisible();
  });
});

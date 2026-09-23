import { expect, test } from "@playwright/test";

test.describe("Specimen review page", () => {
  test.skip(process.env.TEST_PRODUCTION === "1", "Specimen is dev-only");

  test("specimen page: section headings, no console errors, tab to first button, and dialog focus return", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto("/specimen.html");

    // Assert each section heading is visible
    const sectionHeadings = [
      "Colour Tokens",
      "Radii",
      "Typography",
      "Buttons",
      "Inputs & Textareas",
      "Selection Controls",
      "Tabs",
      "Badges",
      "Alerts",
      "Overlays",
    ];

    for (const heading of sectionHeadings) {
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
    }

    // Assert no console errors
    expect(consoleErrors).toEqual([]);

    // Tab to the first Button and assert it is focused (toBeFocused)
    const firstButton = page.getByRole("button").first();
    await page.keyboard.press("Tab");
    await expect(firstButton).toBeFocused();

    // Open the Dialog via its trigger, assert dialog has an accessible name, press Escape, assert focus returned to the trigger
    const dialogTrigger = page.getByRole("button", {
      name: "Open Dialog",
      exact: true,
    });
    await expect(dialogTrigger).toBeVisible();
    await dialogTrigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName("Confirm Checkpoint");

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(dialogTrigger).toBeFocused();
  });

  test("specimen computed-style checks for primitives and tokens", async ({
    page,
  }) => {
    await page.goto("/specimen.html");

    // 1. default Button background rgb(11, 92, 84); after keyboard focus: outline-style solid, outline-width >= 2px, outline-color rgb(11, 92, 84)
    const defaultButton = page.getByRole("button", {
      name: "default (default)",
      exact: true,
    });
    const defaultBg = await defaultButton.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(defaultBg).toBe("rgb(11, 92, 84)");

    const defaultButtonHeight = await defaultButton.evaluate(
      (el) => el.getBoundingClientRect().height
    );
    expect(defaultButtonHeight).toBeGreaterThanOrEqual(32);
    expect(defaultButtonHeight).toBeLessThanOrEqual(34);

    // Board fidelity: default button text 13px / weight 600, radius 7px
    const defaultButtonType = await defaultButton.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        borderRadius: s.borderTopLeftRadius,
      };
    });
    expect(defaultButtonType.fontSize).toBe("13px");
    expect(["600", "bold"]).toContain(defaultButtonType.fontWeight);
    expect(defaultButtonType.borderRadius).toBe("7px");

    // Secondary button: sunken fill + hover-border colour rgb(198, 192, 180)
    const secondaryButton = page.getByRole("button", {
      name: "secondary (default)",
      exact: true,
    });
    const secondaryBorder = await secondaryButton.evaluate(
      (el) => window.getComputedStyle(el).borderTopColor
    );
    expect(secondaryBorder).toBe("rgb(198, 192, 180)");

    // Tint button: selected-tint fill rgb(234, 239, 236)
    const tintButton = page.getByRole("button", {
      name: "tint (default)",
      exact: true,
    });
    const tintBg = await tintButton.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(tintBg).toBe("rgb(234, 239, 236)");

    // Keyboard focus: Tab to the first button (which is default (default))
    await page.keyboard.press("Tab");
    await expect(defaultButton).toBeFocused();

    const focusStyles = await defaultButton.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        outlineStyle: s.outlineStyle,
        outlineWidth: parseFloat(s.outlineWidth),
      };
    });
    expect(focusStyles.outlineStyle).toBe("solid");
    expect(focusStyles.outlineWidth).toBeGreaterThanOrEqual(2);
    await expect.poll(() => defaultButton.evaluate(el => getComputedStyle(el).outlineColor)).toBe("rgb(11, 92, 84)");

    // 2. ghost Button and link Button: border-top-width 0px or border colour transparent, and background transparent (rgba(0, 0, 0, 0))
    const ghostButton = page.getByRole("button", {
      name: "ghost (default)",
      exact: true,
    });
    const ghostStyles = await ghostButton.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        borderTopWidth: s.borderTopWidth,
        borderTopColor: s.borderTopColor,
        backgroundColor: s.backgroundColor,
      };
    });
    const isGhostBorderTransparent =
      ghostStyles.borderTopWidth === "0px" ||
      ghostStyles.borderTopColor === "transparent" ||
      ghostStyles.borderTopColor === "rgba(0, 0, 0, 0)";
    expect(isGhostBorderTransparent).toBe(true);
    expect(ghostStyles.backgroundColor).toBe("rgba(0, 0, 0, 0)");

    const linkButton = page.getByRole("button", {
      name: "link (default)",
      exact: true,
    });
    const linkStyles = await linkButton.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        borderTopWidth: s.borderTopWidth,
        borderTopColor: s.borderTopColor,
        backgroundColor: s.backgroundColor,
      };
    });
    const isLinkBorderTransparent =
      linkStyles.borderTopWidth === "0px" ||
      linkStyles.borderTopColor === "transparent" ||
      linkStyles.borderTopColor === "rgba(0, 0, 0, 0)";
    expect(isLinkBorderTransparent).toBe(true);
    expect(linkStyles.backgroundColor).toBe("rgba(0, 0, 0, 0)");

    // 3. disabled Button: opacity '1'
    const disabledButton = page.getByRole("button", {
      name: "default disabled",
      exact: true,
    });
    const disabledOpacity = await disabledButton.evaluate(
      (el) => window.getComputedStyle(el).opacity
    );
    expect(disabledOpacity).toBe("1");

    // 4. long-label Button: el.scrollWidth <= el.clientWidth + 1 (no clipping)
    const longLabelButton = page.getByRole("button", {
      name: /Deploy scenario to production cluster/,
    });
    const noClipping = await longLabelButton.evaluate(
      (el) => el.scrollWidth <= el.clientWidth + 1
    );
    expect(noClipping).toBe(true);

    // 5. rest Input border colour rgb(148, 141, 128); invalid Input border colour rgb(161, 91, 64)
    const restInput = page.getByLabel("Input (Rest)");
    const restInputBorder = await restInput.evaluate(
      (el) => window.getComputedStyle(el).borderTopColor
    );
    expect(restInputBorder).toBe("rgb(148, 141, 128)");

    // Field rest fill is shell rgb(251, 250, 247)
    const restInputBg = await restInput.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(restInputBg).toBe("rgb(251, 250, 247)");

    const invalidInput = page.getByLabel("Input (Invalid)");
    const invalidInputBorder = await invalidInput.evaluate(
      (el) => window.getComputedStyle(el).borderTopColor
    );
    expect(invalidInputBorder).toBe("rgb(161, 91, 64)");

    // 6. a Checkbox and a Switch root: padding 0px (no legacy padding leak)
    const checkbox = page.getByLabel("Automated failover (Off)");
    const checkboxPadding = await checkbox.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return s.paddingTop === "0px" &&
        s.paddingRight === "0px" &&
        s.paddingBottom === "0px" &&
        s.paddingLeft === "0px";
    });
    expect(checkboxPadding).toBe(true);

    const switchRoot = page.getByRole("switch", {
      name: "Debug logging (Off)",
    });
    const switchPadding = await switchRoot.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return s.paddingTop === "0px" &&
        s.paddingRight === "0px" &&
        s.paddingBottom === "0px" &&
        s.paddingLeft === "0px";
    });
    expect(switchPadding).toBe(true);

    // 7. a swatch card or any element with the bare 'border' class: border colour rgb(231, 227, 219)
    const borderElement = page.locator(".border").first();
    const borderColour = await borderElement.evaluate(
      (el) => window.getComputedStyle(el).borderTopColor
    );
    expect(borderColour).toBe("rgb(231, 227, 219)");

    // 8. element with class text-xs (and Badge) has font-size '11.5px'
    const textXsElement = page.locator(".text-xs").first();
    const textXsFontSize = await textXsElement.evaluate(
      (el) => window.getComputedStyle(el).fontSize
    );
    expect(textXsFontSize).toBe("11.5px");

    const badgeElement = page.locator("[data-slot='badge']").first();
    const badgeFontSize = await badgeElement.evaluate(
      (el) => window.getComputedStyle(el).fontSize
    );
    expect(badgeFontSize).toBe("11.5px");

    // 9. a 'p-4' element measures 16px padding and a 'gap-2' element measures 8px gap
    const p4Element = page.locator(".p-4").first();
    const p4Padding = await p4Element.evaluate(
      (el) => window.getComputedStyle(el).paddingTop
    );
    expect(p4Padding).toBe("16px");

    const gap2Element = page.locator(".gap-2").first();
    const gap2Gap = await gap2Element.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return s.gap || s.rowGap || s.columnGap;
    });
    expect(gap2Gap).toBe("8px");
  });

  test("at viewport 390x844 with hasTouch/isMobile, default Button height >= 44", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/specimen.html");

    const defaultButton = page.getByRole("button", {
      name: "default (default)",
      exact: true,
    });
    const height = await defaultButton.evaluate(
      (el) => el.getBoundingClientRect().height
    );
    expect(height).toBeGreaterThanOrEqual(44);

    await context.close();
  });

  test("R02: computed-style/interaction checks for tabs, dropdown, overlays, progress, and long labels", async ({
    page,
  }) => {
    await page.goto("/specimen.html");

    // --- Tabs ---
    const tabOverview = page.getByRole("tab", { name: "Overview", exact: true });
    const tabPerformance = page.getByRole("tab", {
      name: "Performance",
      exact: true,
    });

    await expect(tabOverview).toHaveAttribute("aria-selected", "true");
    await expect(tabPerformance).toHaveAttribute("aria-selected", "false");

    const [selectedStyles, unselectedStyles] = await Promise.all([
      tabOverview.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color };
      }),
      tabPerformance.evaluate((el) => {
        const s = window.getComputedStyle(el);
        return { bg: s.backgroundColor, color: s.color };
      }),
    ]);
    const tabsVisuallyDiffer =
      selectedStyles.bg !== unselectedStyles.bg ||
      selectedStyles.color !== unselectedStyles.color;
    expect(tabsVisuallyDiffer).toBe(true);

    await tabOverview.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabPerformance).toHaveAttribute("aria-selected", "true");
    await expect(tabPerformance).toBeFocused();

    // Active tab shows a primary-coloured underline rgb(11, 92, 84) (allow the
    // border-color transition to settle before reading the computed style)
    await expect
      .poll(() =>
        tabPerformance.evaluate(
          (el) => window.getComputedStyle(el).borderBottomColor
        )
      )
      .toBe("rgb(11, 92, 84)");

    // --- DropdownMenu (keyboard open, nested submenu, escape closes all) ---
    const dropdownTrigger = page.getByRole("button", {
      name: "Open Menu",
      exact: true,
    });
    await dropdownTrigger.focus();
    await page.keyboard.press("Enter");

    const dropdownMenu = page.getByRole("menu").first();
    await expect(dropdownMenu).toBeVisible();

    const submenuTrigger = page.getByRole("menuitem", { name: "Export Model" });
    await expect
      .poll(
        async () => {
          const isFocused = await submenuTrigger
            .evaluate((el) => el === document.activeElement)
            .catch(() => false);
          if (!isFocused) {
            await page.keyboard.press("ArrowDown");
          }
          return isFocused;
        },
        { timeout: 5000, intervals: [150] }
      )
      .toBe(true);
    await expect(submenuTrigger).toBeFocused();

    await page.keyboard.press("ArrowRight");
    const submenuItems = page.getByRole("menuitem", { name: /^Export as/ });
    await expect(submenuItems.first()).toBeVisible();
    expect(await submenuItems.count()).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 3; i += 1) {
      const stillOpen = await dropdownMenu.isVisible().catch(() => false);
      if (!stillOpen) break;
      await page.keyboard.press("Escape");
    }
    await expect(dropdownMenu).not.toBeVisible();
    await expect(dropdownTrigger).toBeFocused();

    // --- Overlays: layering tokens computed on live elements ---
    const dialogTrigger = page.getByRole("button", {
      name: "Open Dialog",
      exact: true,
    });
    await dialogTrigger.click();
    const dialogContent = page.locator('[data-slot="dialog-content"]');
    const dialogOverlay = page.locator('[data-slot="dialog-overlay"]');
    await expect(dialogContent).toBeVisible();
    const [dialogContentZ, dialogOverlayZ] = await Promise.all([
      dialogContent.evaluate((el) => window.getComputedStyle(el).zIndex),
      dialogOverlay.evaluate((el) => window.getComputedStyle(el).zIndex),
    ]);
    expect(dialogContentZ).toBe("60");
    expect(dialogOverlayZ).toBe("50");
    await page.keyboard.press("Escape");
    await expect(dialogContent).not.toBeVisible();

    const popoverTrigger = page.getByRole("button", {
      name: "Open Popover",
      exact: true,
    });
    await popoverTrigger.click();
    const popoverContent = page.locator('[data-slot="popover-content"]');
    await expect(popoverContent).toBeVisible();
    const popoverZ = await popoverContent.evaluate(
      (el) => window.getComputedStyle(el).zIndex
    );
    expect(popoverZ).toBe("70");
    await page.keyboard.press("Escape");
    await expect(popoverContent).not.toBeVisible();

    const tooltipTrigger = page.getByRole("button", {
      name: "Hover for Tooltip",
      exact: true,
    });
    await tooltipTrigger.hover();
    const tooltipContent = page.locator('[data-slot="tooltip-content"]');
    await expect(tooltipContent).toBeVisible();
    const tooltipZ = await tooltipContent.evaluate(
      (el) => window.getComputedStyle(el).zIndex
    );
    expect(tooltipZ).toBe("80");

    // Tooltip surface is ink rgb(22, 32, 29), not the primary green
    const tooltipBg = await tooltipContent.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(tooltipBg).toBe("rgb(22, 32, 29)");

    await page.keyboard.press("Escape");

    // --- Progress: indeterminate indicator narrower than its track ---
    const indeterminateIndicator = page.locator(
      "#specimen-progress-indeterminate [data-slot='progress-indicator']"
    );
    const widthRatio = await indeterminateIndicator.evaluate((el) => {
      const track = el.closest('[data-slot="progress"]') as HTMLElement;
      const trackRect = track.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return rect.width / trackRect.width;
    });
    expect(widthRatio).toBeLessThan(0.5);

    // --- Long labels: every button-slot element fits without clipping ---
    const buttonSlotElements = page.locator('[data-slot="button"]');
    const buttonSlotCount = await buttonSlotElements.count();
    for (let i = 0; i < buttonSlotCount; i += 1) {
      const el = buttonSlotElements.nth(i);
      const noClipping = await el.evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1
      );
      expect(noClipping).toBe(true);
    }
  });
});

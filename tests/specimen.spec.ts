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
});

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
});

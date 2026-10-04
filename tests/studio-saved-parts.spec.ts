import { expect, test, type Page } from "./fixtures";

async function openLibrary(page: Page) {
  if (await page.getByTestId("library-panel").isVisible()) return;
  await page.getByTestId("topbar-quick-options-btn").click();
  await page.getByTestId("quick-options-input").fill("Open library");
  await page.getByTestId("quick-option-library.open").click();
  await expect(page.getByTestId("library-panel")).toBeVisible();
}

/** Saved parts live under the Library's "Ours" tab. */
async function openOurs(page: Page) {
  await openLibrary(page);
  await page.getByTestId("library-tab-ours").click();
}

test("saved part survives reload, shares Library search, exports/imports, and places with one undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("create-example-s03").click();
  await expect(page.getByTestId("workspace-root")).toBeVisible();
  const nodes = page.locator(".component-node");
  const before = await nodes.count();
  await nodes.first().click();
  await openOurs(page);
  await page
    .getByRole("button", { name: "Save as component", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "Save component preview" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Component name", exact: true })
    .fill("Reusable checkout 🧩");
  await page
    .getByRole("textbox", { name: "Component description" })
    .fill("Saved local pipeline");
  await page
    .getByRole("button", { name: "Save component", exact: true })
    .click();
  const saved = page.getByRole("region", { name: "Saved parts", exact: true });
  await expect(
    saved.getByText("Component saved to this project’s Library."),
  ).toBeVisible();
  await expect(nodes).toHaveCount(before);
  await page
    .getByRole("searchbox", { name: "Search components" })
    .fill("Reusable checkout");
  await expect(
    saved.getByRole("button", {
      name: "Place Reusable checkout 🧩",
      exact: true,
    }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await saved
    .getByRole("button", { name: "Export Reusable checkout 🧩", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.system-studio-part\.json$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  await saved.getByLabel("Import part file").setInputFiles(downloadPath!);
  await expect(
    saved.getByRole("button", {
      name: "Place Reusable checkout 🧩",
      exact: true,
    }),
  ).toHaveCount(2);
  await page.goto("/");
  await page.locator('[data-testid^="open-project-"]').first().click();
  await expect(page.getByTestId("workspace-root")).toBeVisible();
  await openOurs(page);
  const placed = saved.getByRole("button", {
    name: "Place Reusable checkout 🧩",
    exact: true,
  });
  await expect(placed).toHaveCount(2);
  await placed.first().click();
  await expect(nodes).toHaveCount(before + 1);
  await page.getByTestId("save-status").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nodes).toHaveCount(before);
  await expect(placed).toHaveCount(2);
});

test("mobile Library supports saved-part preview and cancel without overflowing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("create-example-s03").click();
  await expect(page.getByTestId("workspace-root")).toBeVisible();
  await page.locator(".component-node").first().click();
  await openOurs(page);
  await page
    .getByRole("button", { name: "Save as component", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Save component preview" });
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

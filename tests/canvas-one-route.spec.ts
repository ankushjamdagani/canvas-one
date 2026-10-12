import { test, expect } from "./fixtures";

test("canvas-one serves the existing public app and keeps navigation within its mount", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/canvas-one");
  await expect(page.getByTestId("landing-page")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Try Beta" }).first(),
  ).toHaveAttribute("href", "/canvas-one/projects");
  await page.getByRole("link", { name: "Brand", exact: true }).click();
  await expect(page).toHaveURL(/\/canvas-one\/brand$/);
  await expect(page).toHaveTitle("Brand | Canvas One");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Try Beta" }).first().click();
  await expect(page.getByTestId("entry-screen-root")).toBeVisible();
  await expect(page).toHaveURL(/\/canvas-one\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/canvas-one\/brand$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("canvas-one opens a real project, reloads deep links and shares existing local projects", async ({
  page,
}) => {
  await page.goto("/canvas-one/projects");
  await expect(page.getByTestId("entry-screen-root")).toBeVisible();
  await page.getByTestId("create-example-s01").click();
  await expect(page.getByTestId("workspace-root")).toBeVisible();
  await expect(page).toHaveURL(
    /\/canvas-one\/project\/[^/]+(\/branch\/[^/]+)?$/,
  );
  await expect(page.getByTestId("save-status")).toHaveAttribute(
    "data-state",
    "idle",
  );
  await page.getByTestId("breadcrumb-branch-btn").click();
  await page.getByTestId("branch-create-open").click();
  await page.getByTestId("branch-create-label").fill("Mounted branch");
  await page.getByTestId("branch-create-submit").click();
  await expect(page.getByTestId("breadcrumb-branch-btn")).toContainText(
    "Mounted branch",
  );
  await expect(page).toHaveURL(/\/canvas-one\/project\/[^/]+\/branch\/[^/]+$/);
  const mountedUrl = new URL(page.url());
  await page.reload();
  await expect(page.getByTestId("workspace-root")).toBeVisible();
  await expect(page.locator(".component-node")).not.toHaveCount(0);
  await page.goto(mountedUrl.pathname.replace("/canvas-one", ""));
  await expect(page.getByTestId("workspace-root")).toBeVisible();
  await expect(page.locator(".component-node")).not.toHaveCount(0);
  await expect(page.getByTestId("breadcrumb-branch-btn")).toContainText(
    "Mounted branch",
  );
});

test("canvas-one retains the original desktop and mobile landing appearance", async ({
  page,
}, testInfo) => {
  for (const viewport of [
    { width: 1512, height: 982 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const appearances = [];
    for (const path of ["/", "/canvas-one"]) {
      await page.goto(path);
      await expect(page.getByTestId("landing-page")).toBeVisible();
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      appearances.push(
        await heading.evaluate((element) => {
          const style = getComputedStyle(element);
          const { width, height } = element.getBoundingClientRect();
          return {
            width,
            height,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            color: style.color,
          };
        }),
      );
      if (path === "/canvas-one") {
        await page.screenshot({
          path: testInfo.outputPath(`canvas-one-${viewport.width}.png`),
          fullPage: true,
        });
      }
    }
    expect(appearances[1]).toEqual(appearances[0]);
  }
});

test("canvas-one public pages render without JavaScript and unknown subroutes return 404", async ({
  browser,
  baseURL,
  request,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  try {
    const page = await context.newPage();
    for (const path of ["/canvas-one", "/canvas-one/brand"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Try Beta" }).first(),
      ).toHaveAttribute("href", "/canvas-one/projects");
    }
  } finally {
    await context.close();
  }
  for (const path of [
    "/canvas-one/nope",
    "/canvas-one/project",
    "/canvas-one/project/p1/branch",
  ]) {
    expect((await request.get(path)).status()).toBe(404);
  }
});

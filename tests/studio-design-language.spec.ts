import { test, expect } from "./fixtures";

for (const width of [1440, 390, 320]) {
  test(`${width}px: shared language loads across landing, projects and editor`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page
        .locator(".lp-header")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("IBM Plex Mono");
    expect(
      await page
        .locator(".lp-local")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Caveat");
    expect(
      await page
        .locator(".lp-command")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Martian Mono");
    await expect(page.locator(".drafting-frame")).toBeVisible();
    const canvas = page.locator("canvas[data-decoration]");
    const pixels = await canvas.evaluate((el: HTMLCanvasElement) =>
      Array.from(
        el
          .getContext("2d")!
          .getImageData(36 * devicePixelRatio, 36 * devicePixelRatio, 1, 1)
          .data,
      ),
    );
    expect(pixels[3]).toBeGreaterThan(0);
    const still = await canvas.evaluate((el: HTMLCanvasElement) =>
      el.toDataURL(),
    );
    await page.waitForTimeout(160);
    expect(
      await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL()),
    ).toBe(still);
    await page.goto("/projects");
    await expect(
      page.getByRole("button", { name: /background animation/ }),
    ).toHaveCount(0);
    await page.getByTestId("create-example-s04").click();
    await expect(page.getByTestId("workspace-root")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("canvas[data-decoration]")).toHaveCount(0);
    expect(
      await page
        .getByTestId("canvas-container")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgb(251, 250, 247)");
    expect(
      await page
        .getByTestId("workspace-topbar")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("IBM Plex Mono");
    expect(
      await page
        .getByTestId("workspace-topbar")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`editor-${width}.png`),
      fullPage: true,
    });
    await page.getByTestId("breadcrumb-project-btn").click();
    await expect(page.getByTestId("project-menu-popover")).toBeVisible();
    const bounds = await page.getByTestId("project-menu-popover").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  });
}

test("public drafting animation moves", async ({ page }) => {
  await page.goto("/projects");
  await page.setViewportSize({ width: 1440, height: 900 });
  const canvas = page.locator("canvas[data-decoration]");
  await expect(canvas).toBeVisible();
  const before = await canvas.evaluate((el: HTMLCanvasElement) =>
    el.toDataURL(),
  );
  await expect
    .poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL()), {
      timeout: 5000,
    })
    .not.toBe(before);
  await page.setViewportSize({ width: 320, height: 900 });
  const resized = await canvas.evaluate((el: HTMLCanvasElement) =>
    el.toDataURL(),
  );
  await expect
    .poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL()), {
      timeout: 5000,
    })
    .not.toBe(resized);
});

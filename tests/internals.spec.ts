import { expect, test } from "@playwright/test";

test("expansion shows the same live model and survives local reopen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "700 req/s", exact: true }).click();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const before = await page.getByTestId("throughput").textContent();
  await page
    .getByRole("button", { name: "Expand Database", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Database internals", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  expect(await page.getByTestId("throughput").textContent()).toBe(before);
  await page
    .getByRole("button", { name: "Collapse Database", exact: true })
    .click();
  expect(await page.getByTestId("throughput").textContent()).toBe(before);
  await page
    .getByRole("button", { name: "Expand Database", exact: true })
    .click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(
    Number(
      (await page.getByTestId("failures").innerText()).replaceAll(",", ""),
    ),
  ).toBe(5346);
  await expect(
    page.getByRole("meter", { name: "Database queue occupancy" }),
  ).toHaveAttribute("aria-valuenow", "499");
  await page.screenshot({
    path: "artifacts/expanded-database.png",
    fullPage: true,
  });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Database internals", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add cache", exact: true }).click();
  await page.getByRole("button", { name: "Expand Cache", exact: true }).click();
  await expect(
    page.getByText("80% hit → response", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("20% miss → database", { exact: true }),
  ).toBeVisible();
});

test("traffic animation keeps its clock across metric samples and pause/resume", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const stream = page.locator(".traffic-stream").first();
  await expect(stream).toHaveCSS("animation-play-state", "running");
  const clock = () =>
    stream.evaluate((el) =>
      Number(
        el
          .getAnimations()
          .find(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.animationName === "traffic-flow",
          )?.currentTime ?? -1,
      ),
    );
  const start = await clock();
  await page.waitForTimeout(650);
  const later = await clock();
  expect(later - start).toBeGreaterThan(450);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(stream).toHaveCSS("animation-play-state", "paused");
  await page.waitForTimeout(60);
  const paused = await clock();
  await page.waitForTimeout(200);
  expect(await clock()).toBeCloseTo(paused, 0);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForTimeout(150);
  expect(await clock()).toBeGreaterThan(paused + 75);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(stream).toHaveCSS("display", "none");
});

test("mobile reveals readable internals", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Expand Traffic source", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Traffic source internals", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const header = await page.locator(".experiment-heading").boundingBox();
  const component = await page
    .locator(".react-flow__node")
    .first()
    .boundingBox();
  expect(component!.y).toBeGreaterThan(header!.y + header!.height);
  await page.screenshot({
    path: "artifacts/expanded-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "700 req/s", exact: true }).click();
  await page
    .getByRole("button", { name: "Show internals on canvas", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Database internals", exact: true }),
  ).toBeVisible();
});

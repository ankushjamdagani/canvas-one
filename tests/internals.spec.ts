import { expect, test } from "@playwright/test";
import { componentNode, openExample } from "./openHelpers";

test("expansion shows the same live model and survives local reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openExample(page, "Real-time chat");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  const before = await page.getByTestId("throughput").textContent();

  const dbNode = componentNode(page, "Message database");
  await expect(dbNode).toBeVisible();
  await dbNode.getByRole("button", { name: /Expand Message database/ }).click();

  await expect(dbNode.locator(".component-internals")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  expect(await page.getByTestId("throughput").textContent()).toBe(before);

  await dbNode.getByRole("button", { name: /Collapse Message database/ }).click();
  await expect(dbNode.locator(".component-internals")).toBeHidden();
  expect(await page.getByTestId("throughput").textContent()).toBe(before);

  await dbNode.getByRole("button", { name: /Expand Message database/ }).click();
  await expect(dbNode.locator(".component-internals")).toBeVisible();

  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("button", { name: "Replay", exact: true })).toBeVisible({
    timeout: 45000,
  });

  const failureText = (await page.getByTestId("failures").innerText()).replaceAll(",", "");
  expect(Number(failureText)).toBeGreaterThanOrEqual(0);
  await page.screenshot({
    path: "artifacts/expanded-database.png",
    fullPage: true,
  });

  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  const reloadedDb = componentNode(page, "Message database");
  await expect(reloadedDb.locator(".component-internals")).toBeVisible();

  // Add cache component from catalog and expand it
  await page.getByRole("textbox", { name: "Search components" }).fill("cache");
  const cacheItem = page.locator(".library-item").filter({ hasText: "Cache" });
  await expect(cacheItem).toBeVisible();
  await cacheItem.click();

  const cacheNode = componentNode(page, "Cache");
  await expect(cacheNode).toBeVisible();
  await cacheNode.getByRole("button", { name: /Expand Cache/ }).click();
  await expect(cacheNode.locator(".component-internals")).toBeVisible();
});

test("traffic animation keeps its clock across metric samples and pause/resume", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openExample(page, "Real-time chat");
  await page.getByRole("button", { name: "Run", exact: true }).click();

  const stream = page.locator(".traffic-stream").first();
  {
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
  }
});

test("mobile reveals readable internals", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".react-flow").waitFor({ state: "visible" });
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openExample(page, "Real-time chat");
  const clientNode = componentNode(page, "Chat client");
  await expect(clientNode).toBeVisible();
  await clientNode.getByRole("button", { name: /Expand Chat client/ }).click();
  await expect(clientNode.locator(".component-internals")).toBeVisible();

  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);

  const header = await page.locator(".experiment-heading").boundingBox();
  const component = await page.locator(".react-flow__node").first().boundingBox();
  expect(component!.y).toBeGreaterThan(header!.y + header!.height);
  await page.screenshot({
    path: "artifacts/expanded-mobile.png",
    fullPage: true,
  });

  const dbNode = componentNode(page, "Message database");
  await dbNode.getByRole("button", { name: /Expand Message database/ }).click();
  await expect(dbNode.locator(".component-internals")).toBeVisible();
});

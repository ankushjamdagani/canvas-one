import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("landing preserves supplied copy and opens projects with working history", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Think in architecture.",
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Let agents draw the system.",
  );
  await expect(page.getByText("You & Claude", { exact: true })).toBeVisible();
  await expect(page.getByText("npx canvas-one@preview")).toBeVisible();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await page.getByRole("link", { name: "Try Beta" }).last().click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId("entry-screen-root")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("entry-screen-root")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("landing-page")).toBeVisible();
});

test("illustrative demo pauses, accepts, dismisses and resets", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  const figure = page.getByRole("figure");
  await expect(page.getByLabel("Move Edge Gateway demo node")).toBeVisible();
  await page.clock.runFor(5000);
  await expect(figure).toContainText("Suggested");
  await page.getByRole("button", { name: "Pause demo" }).click();
  await expect(figure).toHaveAttribute("data-paused", "true");
  const frozen = await figure.innerText();
  await page.clock.runFor(1800);
  expect(await figure.innerText()).toBe(frozen);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(figure).toContainText("Accepted");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("button", { name: "Run demo" }).click();
  await page.clock.runFor(4000);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(figure).not.toContainText("Async Buffer");
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.clock.runFor(4000);
  await expect(figure).toContainText("Suggested");
});

for (const width of [1440, 800, 390, 320]) {
  test(`${width}px: public pages reflow and expose keyboard controls`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/", "/projects"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Canvas One", exact: true }),
      ).toBeFocused();
      const audit = await new AxeBuilder({ page }).analyze();
      expect(audit.violations).toEqual([]);
      await page.screenshot({
        path: info.outputPath(
          `${path === "/" ? "landing" : "projects"}-${width}.png`,
        ),
        fullPage: true,
      });
    }
  });
}

test("projects use saved data and retain search, sorting, draft opening and deletion", async ({
  page,
}, info) => {
  for (const title of ["Zulu", "Alpha"]) {
    await page.goto("/projects");
    await page.getByRole("textbox", { name: "Blank project name" }).fill(title);
    await page.getByTestId("create-blank-project-btn").click();
    await expect(page.getByTestId("workspace-root")).toBeVisible();
  }
  await page.goto("/projects");
  await page.getByRole("button", { name: "A–Z", exact: true }).click();
  const cards = page.locator('[data-testid^="project-item-"]');
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Alpha");
  await expect(cards.first()).toContainText("0 components");
  await page.screenshot({
    path: info.outputPath("saved-projects.png"),
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "Search projects" }).fill("zulu");
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole("button", { name: "Delete Zulu" }).click();
  await cards
    .first()
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(
    page.getByText("No projects match", { exact: false }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search projects" }).fill("");
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole("button", { name: "Open Alpha" }).click();
  await expect(page.getByTestId("workspace-root")).toBeVisible();
});

test("demo connections follow pointer and keyboard movement and accepted queue stays drained", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto("/");
  const gateway = page.getByLabel("Move Edge Gateway demo node");
  const path = page.locator('[data-edge="direct"]');
  const initial = await path.getAttribute("d");
  await gateway.focus();
  await page.keyboard.press("ArrowRight");
  await expect(path).not.toHaveAttribute("d", initial!);
  const header = gateway.locator("header");
  const box = await header.boundingBox();
  await page.mouse.move(box!.x + 15, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(box!.x + 30, box!.y + 22);
  await page.mouse.up();
  await expect(gateway).toHaveAttribute("style", /left: 983px; top: 287px/);
  await page.clock.runFor(4000);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(path).toHaveCount(0);
  await page.clock.runFor(16000);
  await expect(gateway.locator("p")).toHaveText("Queue0 dropped");
  await page.clock.runFor(16000);
  await expect(gateway.locator("p")).toHaveText("Queue0 dropped");
  await expect(page.getByRole("figure")).toContainText("42 ms");
});

test("landing follows authored board geometry and timed collaboration sequence", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const bounds = await page.locator(".lp-hero").boundingBox();
  expect(bounds!.x).toBeCloseTo(104, 0);
  expect(bounds!.y).toBeCloseTo(168, 0);
  expect(bounds!.width).toBe(800);
  expect(bounds!.height).toBe(176);
  await expect(page.getByLabel("Move Async Buffer demo node")).toHaveCount(0);
  await page.clock.runFor(4000);
  await expect(page.getByLabel("Move Async Buffer demo node")).toContainText(
    "Suggested",
  );
  await expect(page.locator(".lp-note")).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect(page.locator(".lp-note")).toBeVisible();
  await expect(page.locator(".lp-note")).toHaveAttribute(
    "style",
    /left: 1196px; top: 410px/,
  );
  await page.screenshot({
    path: info.outputPath("landing-suggested-1440.png"),
  });
  await page.clock.runFor(4000);
  await expect(page.getByLabel("Move Async Buffer demo node")).toContainText(
    "Accepted",
  );
  await expect(page.getByLabel("Move Edge Gateway demo node")).toContainText(
    "0 dropped",
  );
  await expect(page.getByLabel("Move Worker Pool demo node")).toContainText(
    "42 ms",
  );
  await expect(page.locator(".lp-prompt")).toContainText(
    "Buffer accepted. Queue drained, p99 180 → 42 ms.",
  );
  await page.screenshot({ path: info.outputPath("landing-accepted-1440.png") });
  const handle = page.getByRole("button", { name: "Resize heading BR" });
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".lp-dimension")).toHaveText(
    "Text · H1 · 808 × 176",
  );
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + 4, box!.y + 4);
  await page.mouse.down();
  await page.mouse.move(box!.x + 24, box!.y + 14);
  await page.mouse.up();
  await expect(page.locator(".lp-dimension")).toHaveText(
    "Text · H1 · 828 × 186",
  );
  await page.clock.runFor(5000);
  await expect(page.getByLabel("Move Async Buffer demo node")).toHaveCount(0);
});

test("landing board fills a wide viewport and the lede follows the heading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const board = await page.locator(".drafting-board").boundingBox();
  expect(board!.width).toBe(1800);
  expect(board!.height).toBeGreaterThanOrEqual(900);
  const hero = await page.locator(".lp-hero").boundingBox();
  const copy = await page.locator(".lp-copy").boundingBox();
  expect(copy!.y).toBeCloseTo(hero!.y + hero!.height + 46, 0);
  expect(copy!.x).toBeCloseTo(hero!.x + 19, 0);
});

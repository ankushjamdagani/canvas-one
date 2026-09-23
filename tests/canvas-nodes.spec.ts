import { expect, test } from "@playwright/test";
import { componentNode, openExample, subsystemNode } from "./openHelpers";

// RV-04c: canvas node, subsystem boundary and edge restyle.
// specs/revamp/design.md "Canvas objects": a 176px card with a 3px type stripe;
// the stripe colour is the node kind, the border carries state.

test.describe("Canvas nodes: kind stripe, selection state, and text containment", () => {
  test.setTimeout(45000);

  test("node has a 9px border radius and a kind-coloured stripe", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const node = componentNode(page, "Chat service");
    await expect(node).toBeVisible();
    // componentNode() finds React Flow's outer `.react-flow__node-component` wrapper;
    // the actual styled card is the `.component-node` div ComponentNode renders inside it.
    const card = node.locator(".component-node");

    const radius = await card.evaluate((el) => window.getComputedStyle(el).borderRadius);
    expect(radius).toBe("9px");

    // "Chat service" is kind "service" -> category "Compute" -> node-kind colour
    // is #56773A = rgb(86, 119, 58), per decision D35's dedicated stripe palette
    // (tokens.ts nodeKindColor.compute).
    const stripe = card.locator(".node-category-strip");
    await expect(stripe).toBeAttached();
    const stripeColor = await stripe.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(stripeColor).toBe("rgb(86, 119, 58)");
  });

  test("node is at least 176px wide (nominal width)", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const node = componentNode(page, "Chat service");
    await expect(node).toBeVisible();
    const card = node.locator(".component-node");

    // CSS width, not the on-screen scaled bounding box (React Flow applies a
    // camera zoom transform to the viewport, which getBoundingClientRect()
    // would reflect but getComputedStyle().width does not).
    const width = await card.evaluate((el) => parseFloat(window.getComputedStyle(el).width));
    expect(width).toBeGreaterThanOrEqual(176);
  });

  test("selected node gets a visible border/ring distinct from the default state", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const node = componentNode(page, "Chat service");
    await expect(node).toBeVisible();
    const card = node.locator(".component-node");

    const defaultStyle = await card.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { borderWidth: cs.borderWidth, borderColor: cs.borderColor, boxShadow: cs.boxShadow };
    });

    await node.click();
    await expect(node).toHaveClass(/selected/);
    // `.component-node` has `transition-colors`; poll until the border-color transition
    // settles instead of reading a possibly mid-transition value.
    await expect
      .poll(() => card.evaluate((el) => window.getComputedStyle(el).borderColor))
      .not.toBe(defaultStyle.borderColor);

    const selectedStyle = await card.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { borderWidth: cs.borderWidth, borderColor: cs.borderColor, boxShadow: cs.boxShadow };
    });

    // Selection must not rely on colour alone: border weight and/or a ring
    // (box-shadow) changes, not just borderColor.
    const borderWeightChanged = selectedStyle.borderWidth !== defaultStyle.borderWidth;
    const ringAppeared = selectedStyle.boxShadow !== "none" && selectedStyle.boxShadow !== defaultStyle.boxShadow;
    expect(borderWeightChanged || ringAppeared).toBe(true);
    expect(selectedStyle.borderColor).not.toBe(defaultStyle.borderColor);
  });

  test("node title and subtitle text are never clipped (wrap instead of truncating)", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    // "API gateway" carries a longer subtitle ("router · 2000 /s per slot") than
    // most nodes in this example, so it best exercises the wrap-not-clip contract.
    const node = componentNode(page, "API gateway");
    await expect(node).toBeVisible();

    const titleContained = await node.locator(".node-copy strong").evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(titleContained.scrollWidth).toBeLessThanOrEqual(titleContained.clientWidth + 1);

    const subtitleContained = await node.locator(".node-copy span").evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      text: el.textContent,
    }));
    expect(subtitleContained.scrollWidth).toBeLessThanOrEqual(subtitleContained.clientWidth + 1);
    // Sanity: the full subtitle text is actually present in the DOM, not truncated
    // server-side either.
    expect(subtitleContained.text).toContain("router");
    expect(subtitleContained.text).toContain("2000 /s per slot");
  });

  test("subsystem boundary is visible after grouping nodes", async ({ page }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const gw = componentNode(page, "Chat client");
    await page.getByRole("button", { name: "Select components", exact: true }).click();
    await page.getByRole("checkbox", { name: "Chat client", exact: true }).check();
    await page.getByRole("checkbox", { name: "API gateway", exact: true }).check();
    await page.getByRole("button", { name: "Finish selecting", exact: true }).click();

    const gwBox = (await gw.boundingBox())!;
    await page.mouse.click(gwBox.x + gwBox.width / 2, gwBox.y + gwBox.height / 2, { button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: /Create subsystem/i }).click();

    const nameInput = page.getByPlaceholder("Subsystem name");
    await nameInput.fill("Chat Tier");
    await page.getByRole("button", { name: "Group" }).click();

    const sub = subsystemNode(page, "Chat Tier");
    await expect(sub).toBeVisible();

    const shell = sub.locator(".subsystem-shell");
    const style = await shell.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { borderStyle: cs.borderStyle, borderColor: cs.borderColor, borderWidth: cs.borderWidth };
    });
    expect(style.borderStyle).toBe("dashed");
    expect(style.borderWidth).not.toBe("0px");
  });
});

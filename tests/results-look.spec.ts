import { expect, test } from "@playwright/test";
import { openExample, openMetricsDetails } from "./openHelpers";

async function finishRun(page: import("@playwright/test").Page) {
  const runBtn = page.getByRole("button", { name: "Run", exact: true });
  await runBtn.click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 20000 });
}

test.describe("results strip visual restyle (RV-07a)", () => {
  test("no metric values before a run, then a labelled strip with tabular numbers and provenance", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");

    const strip = page.getByRole("region", {
      name: "Simulation status and results",
    });
    await expect(strip).toBeVisible();

    // R09: nothing shows before measurement.
    await expect(page.getByTestId("throughput")).toHaveCount(0);
    await expect(page.getByTestId("p95")).toHaveCount(0);
    await expect(strip).toContainText("Ready to simulate");

    await finishRun(page);

    // Run-state / provenance text label (color always has a text equivalent).
    await expect(strip).toContainText("Completed");

    // Numbers use the mono/tabular style, with the unit adjacent and muted.
    const throughputValue = page.getByTestId("throughput").first();
    await expect(throughputValue).toBeVisible();
    await expect(throughputValue).toHaveClass(/tabular-nums/);
    await expect(strip).toContainText("req/s");
  });

  test("expanded detail exposes labelled General and Components sections, with a keyboard-operable breakdown toggle", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");
    await finishRun(page);

    const panel = await openMetricsDetails(page);
    await expect(panel.getByRole("heading", { name: "General" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: /Components/ })).toBeVisible();

    const summary = panel.locator(".node-resource-details summary");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expect(panel.locator(".resource-table-wrap")).toBeVisible();

    // Numbers in the General section are tabular.
    const latency = page.getByTestId("latency").first();
    await expect(latency).toHaveClass(/tabular-nums/);
  });

  test("results detail panel scrolls internally without growing the page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");
    await finishRun(page);

    const before = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    await openMetricsDetails(page);
    const after = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    expect(after).toBe(before);
  });

  test("does not cause page-level horizontal scroll at mobile width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator(".react-flow").waitFor({ state: "visible" });
    await openExample(page, "Real-time chat");
    await finishRun(page);

    const strip = page.getByRole("region", {
      name: "Simulation status and results",
    });
    await expect(strip).toBeVisible();

    const widths = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.doc).toBeLessThanOrEqual(widths.client + 1);

    // R09: run state/provenance must stay visible, not squeezed out by the actions row.
    await expect(strip).toContainText("Completed");
    const throughputValue = page.getByTestId("throughput").first();
    await expect(throughputValue).toBeVisible();
    const throughputBox = await throughputValue.boundingBox();
    expect(throughputBox).not.toBeNull();
    expect(throughputBox!.width).toBeGreaterThan(0);
    expect(throughputBox!.height).toBeGreaterThan(0);

    // Every strip button stays fully inside the viewport width (no clipping).
    const buttons = await strip.getByRole("button").all();
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
    }
  });
});

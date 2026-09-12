import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function textOf(download: Download) {
  return readFile((await download.path())!, "utf8");
}

async function downloadFrom(page: Page, name: "Download SVG" | "Download PNG") {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  return pending;
}

async function openSubsystems(page: Page) {
  const panel = page.locator(".subsystems-panel");
  if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open))) await panel.locator("summary").click();
}

test("diagram SVG and PNG downloads contain the entire current subsystem view without changing the editor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  await page.locator(".architecture-templates > summary").click();
  await page.getByRole("combobox", { name: "Architecture template" }).selectOption("event-processing");
  await page.getByRole("button", { name: "Load template" }).click();
  const hasOffscreenNode = () => page.locator(".react-flow__node-component").evaluateAll((nodes) => nodes.some((node) => {
    const rect = node.getBoundingClientRect(), canvas = node.closest(".react-flow")!.getBoundingClientRect();
    return rect.right > canvas.right || rect.left < canvas.left || rect.bottom > canvas.bottom;
  }));
  await expect.poll(hasOffscreenNode).toBe(false);
  let offscreen = false;
  for (let attempt = 0; attempt < 5 && !offscreen; attempt++) {
    const previous = await page.locator(".react-flow__viewport").evaluate((element) => (element as HTMLElement).style.transform);
    await page.getByRole("button", { name: "Zoom In" }).click();
    await expect.poll(async () => {
      const current = await page.locator(".react-flow__viewport").evaluate((element) => (element as HTMLElement).style.transform);
      return current !== previous || await hasOffscreenNode();
    }).toBe(true);
    offscreen = await hasOffscreenNode();
  }
  expect(offscreen).toBe(true);
  await page.locator(".react-flow__node-component").filter({ hasText: "Event producer" }).click();
  const viewport = await page.locator(".react-flow__viewport").evaluate((element) => (element as HTMLElement).style.transform);
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

  const svgDownload = await downloadFrom(page, "Download SVG");
  expect(svgDownload.suggestedFilename()).toBe("url-shortener.svg");
  const svg = await textOf(svgDownload);
  expect(svg).toContain("Event producer");
  expect(svg).toContain("Analytics");
  expect(svg).toContain("Archive · Object");
  expect(await page.evaluate((source) => !new DOMParser().parseFromString(source, "image/svg+xml").querySelector("parsererror"), svg)).toBe(true);
  await svgDownload.saveAs("artifacts/diagram-export.svg");
  expect(await page.locator(".react-flow__viewport").evaluate((element) => (element as HTMLElement).style.transform)).toBe(viewport);
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();

  const pngDownload = await downloadFrom(page, "Download PNG");
  expect(pngDownload.suggestedFilename()).toBe("url-shortener.png");
  const png = await readFile((await pngDownload.path())!);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const pngWidth = png.readUInt32BE(16), pngHeight = png.readUInt32BE(20);
  const decoded = await page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }, png.toString("base64"));
  expect(decoded).toEqual({ width: pngWidth, height: pngHeight });
  await pngDownload.saveAs("artifacts/diagram-export.png");

  await openSubsystems(page);
  await page.getByRole("button", { name: "Create subsystem", exact: true }).click();
  await page.getByRole("textbox", { name: "Subsystem name", exact: true }).fill("Event platform");
  await page.getByRole("button", { name: "Group components", exact: true }).click();
  await page.getByRole("button", { name: "Collapse Event platform on canvas", exact: true }).click();
  const collapsedViewport = await page.locator(".react-flow__viewport").evaluate((element) => (element as HTMLElement).style.transform);
  const collapsedSvg = await textOf(await downloadFrom(page, "Download SVG"));
  expect(collapsedSvg).toContain("Event platform");
  expect(collapsedSvg).toContain("Architecture boundary");
  expect(collapsedSvg).toContain("collapsed");

  expect(await page.locator(".react-flow__viewport").evaluate((element) => (element as HTMLElement).style.transform)).toBe(collapsedViewport);
  await expect(page.getByText("SVG download ready.", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/diagram-export-ui.png", fullPage: true });
});

test("mobile export controls report PNG failure and permit a successful retry", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Experiment path", exact: true }).selectOption("diagram");
  expect(await page.getByRole("region", { name: "Diagram guidance" }).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const svgButton = page.getByRole("button", { name: "Download SVG", exact: true });
  const pngButton = page.getByRole("button", { name: "Download PNG", exact: true });
  expect((await svgButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await pngButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const svg = await textOf(await downloadFrom(page, "Download SVG"));
  expect(svg).toContain("Application service");

  await page.evaluate(() => {
    const target = window as typeof window & { restoreDiagramToBlob?: typeof HTMLCanvasElement.prototype.toBlob };
    target.restoreDiagramToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback) { callback(null); };
  });
  await pngButton.click();
  await expect(page.getByRole("alert")).toHaveText("Could not encode the PNG image.");
  await expect(pngButton).toBeEnabled();
  await page.evaluate(() => {
    const target = window as typeof window & { restoreDiagramToBlob?: typeof HTMLCanvasElement.prototype.toBlob };
    HTMLCanvasElement.prototype.toBlob = target.restoreDiagramToBlob!;
  });
  const png = await downloadFrom(page, "Download PNG");
  expect([...((await readFile((await png.path())!)).subarray(0, 8))]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await expect(page.getByText("PNG download ready.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/diagram-export-mobile.png", fullPage: true });
});

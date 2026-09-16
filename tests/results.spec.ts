import { expect, test } from "@playwright/test";
import { openExample, componentNode, openWorkloads, openSavedRuns } from "./openHelpers";

async function finishRun(page: import("@playwright/test").Page) {
  const runBtn = page.getByRole("button", { name: "Run", exact: true });
  await runBtn.click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible({ timeout: 20000 });
}

async function saveResult(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Save result", exact: true }).click();
  const nameInput = page.getByRole("textbox", { name: "Result name", exact: true });
  await nameInput.fill(name);
  await page.locator(".save-result-form").getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Saved experiment results", exact: true }),
  ).toBeVisible();
}

async function openTutorial(page: import("@playwright/test").Page, title: string) {
  const directBtn = page.getByRole("button", { name: "Examples & tutorials" });
  if (await directBtn.first().isVisible()) {
    await directBtn.first().click();
  } else {
    await page.locator(".project-switch").click();
    await page.getByRole("button", { name: "Examples & tutorials" }).click();
  }
  const modal = page.locator(".examples-modal");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Guided tutorials" }).click();
  const item = modal.locator(".example-list-item").filter({ hasText: title });
  await item.click();
  await page.getByRole("button", { name: "Load example" }).click();
  await expect(modal).toBeHidden();
  await page.waitForTimeout(200);
}

test("saved cache comparison survives reopen and restores the exact model", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openTutorial(page, "Relieve database pressure");
  await openWorkloads(page);
  const durationInput = page.getByRole("spinbutton", { name: "Simulation Duration", exact: true });
  await durationInput.fill("2");

  await finishRun(page);
  await saveResult(page, "Without cache");
  await page
    .getByRole("button", { name: "Close saved results", exact: true })
    .click();

  await componentNode(page, "Query cache").click();
  const inspector = page.getByRole("complementary", { name: "Component inspector", exact: true });
  await expect(inspector).toBeVisible();
  const hitRateInput = inspector.getByRole("spinbutton", { name: "Hit Rate", exact: true });
  await hitRateInput.fill("80");

  await finishRun(page);
  await saveResult(page, "With cache");

  await expect(
    page.getByRole("region", { name: "Saved experiment results", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Model changes", { exact: true })).toBeVisible();

  await expect(
    page.getByText(
      "Result saved with its model, workload and observed metrics.",
      { exact: true },
    ),
  ).toBeHidden({ timeout: 6000 });

  const canvas = await page.locator(".canvas-area").boundingBox();
  for (const node of await page.locator(".react-flow__node").all()) {
    const box = await node.boundingBox();
    if (box && canvas) {
      expect(box.y + box.height).toBeLessThan(canvas.y + canvas.height + 50);
    }
  }

  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openSavedRuns(page);

  await page.getByRole("combobox", { name: "Compare result", exact: true }).selectOption({ label: "With cache" });

  await page
    .getByRole("textbox", { name: "Saved result name", exact: true })
    .fill("Cached redirects");
  await page
    .getByRole("textbox", { name: "Saved result name", exact: true })
    .press("Tab");

  await page
    .getByRole("combobox", { name: "Baseline result", exact: true })
    .selectOption({ label: "Without cache" });
  await page.getByRole("combobox", { name: "Compare result", exact: true }).selectOption({ label: "Without cache" });

  await page
    .getByRole("button", { name: "Restore this model", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Saved experiment results", exact: true }),
  ).toBeHidden();

  await componentNode(page, "Query cache").click();
  await expect(hitRateInput).toHaveValue("0");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await componentNode(page, "Query cache").click();
  await expect(hitRateInput).toHaveValue("80");

  expect(errors).toEqual([]);
});

test("exports stored metrics with provenance and supports delete undo on mobile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  await openExample(page, "Real-time chat");
  await openWorkloads(page);
  const durationInput = page.getByRole("spinbutton", { name: "Simulation Duration", exact: true });
  await durationInput.fill("2");

  await finishRun(page);
  await saveResult(page, "Short baseline");

  await page.locator(".project-switch").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const download = await downloadPromise;
  const exportedPath = (await download.path())!;

  await page.locator("input[type=file]").setInputFiles(exportedPath);

  await expect(
    page.getByText(/Project imported as a new local copy|Archive imported for inspection/),
  ).toBeVisible();

  await openSavedRuns(page);
  await expect(
    page.getByRole("region", { name: "Saved experiment results", exact: true }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Compare result", exact: true }).selectOption({ label: "Short baseline" });

  await expect(
    page.getByText(
      /Includes imported data; these stored results have not been rerun here/,
    ),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("combobox", { name: "Compare result", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);

  await page
    .getByRole("button", { name: "Delete result", exact: true })
    .click();
  await expect(
    page.getByText("“Short baseline” deleted.", { exact: false }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo delete", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Compare result", exact: true }),
  ).toBeVisible();
});

test("saved results code loads only when the panel is opened", async ({ page }) => {
  const modules: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/ResultsPanel")) modules.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  expect(modules).toHaveLength(0);

  await openSavedRuns(page);
  await expect(page.getByRole("region", { name: "Saved experiment results" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close saved results" })).toBeVisible();
  expect(modules.length).toBeGreaterThan(0);
});

test("read-only archive import displays archive banner and preserves original when creating runnable copy", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();

  const v7Archive = {
    format: "system-studio",
    version: 7,
    project: {
      name: "Legacy v7 Archive",
      graph: {
        scenario: "lookup",
        nodes: [
          {
            id: "traffic-node-1",
            kind: "traffic",
            name: "Traffic entry",
            position: { x: 100, y: 100 },
            capacity: 100,
            queueLimit: 100,
            hitRate: 0,
          },
        ],
        edges: [],
        settings: {
          traffic: 50,
          seed: 1234,
          duration: 5,
          timeoutMs: 1000,
        },
      },
      checkpoints: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      savedRuns: [],
    },
  };

  const buffer = Buffer.from(JSON.stringify(v7Archive, null, 2), "utf-8");
  await page.locator("input[type=file]").setInputFiles({
    name: "legacy-v7.system-studio.json",
    mimeType: "application/json",
    buffer,
  });

  const archiveBanner = page.locator(".archive-banner");
  await expect(archiveBanner).toBeVisible();
  await expect(page.getByRole("button", { name: "Create runnable copy", exact: true })).toBeVisible();

  const records = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("system-studio");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<any[]>((resolve, reject) => {
        const request = db.transaction("projects").objectStore("projects").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
  const original = (await records()).find(p => p.name.startsWith("Legacy v7 Archive"));
  expect(original).toBeTruthy();
  await page.reload();
  await expect(archiveBanner).toBeVisible();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await openSavedRuns(page);
  await page.getByRole("button", { name: "Close saved results" }).click();
  expect((await records()).find(p => p.id === original.id)).toEqual(original);

  await page.getByRole("button", { name: "Create runnable copy", exact: true }).click();
  await expect(archiveBanner).toBeHidden();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  const copiedRecords = await records();
  expect(copiedRecords.find(p => p.id === original.id)).toEqual(original);
  const copy = copiedRecords.find(p => p.name.includes("runnable copy"));
  expect(copy.id).not.toBe(original.id);
  expect(copy.graph.executionVersion).toBe("open-system/1");

  await page.locator(".project-switch").click();
  const projectPanel = page.getByRole("region", { name: "Local projects", exact: true });
  await expect(projectPanel).toBeVisible();
  await expect(projectPanel.getByRole("button", { name: /Legacy v7 Archive.*imported/ }).first()).toBeVisible();
  await expect(projectPanel.getByRole("button", { name: /runnable copy/ })).toBeVisible();
});

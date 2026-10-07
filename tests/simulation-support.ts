import { expect, speedTrigger, type Page } from "./fixtures";

export async function speed(page: Page, value: number) {
  const display = page.getByTestId("playback-speed");
  await page.removeLocatorHandler(speedTrigger(page));
  const group = page.getByRole("group", {
    name: "Playback speed",
    exact: true,
  });
  if (await group.isVisible())
    await group.getByRole("button", { name: `${value}×`, exact: true }).click();
  else {
    const button = page.getByRole("button", {
      name: "Playback speed",
      exact: true,
    });
    for (
      let attempt = 0;
      attempt < 4 && (await display.innerText()) !== `${value}×`;
      attempt++
    ) {
      const before = await display.innerText();
      await button.click();
      await expect(display).not.toHaveText(before);
    }
  }
  await expect(display).toHaveText(`${value}×`);
}

export async function traffic(
  page: Page,
  mode: "bulk" | "stream" = "bulk",
  amount = 6,
  spreadMs = 3000,
) {
  await page.goto("/projects");
  await page.getByTestId("create-example-s06").click();
  await page.getByTestId("scenario-switcher-trigger").click();
  await page
    .getByTestId("scenario-switcher-popover")
    .locator('[data-selected="true"]').getByRole('button', { name: /^Edit scenario/ })
    .click();
  const editor = page.getByTestId("scenario-editor");
  const workload = editor.locator('[data-testid^="workload-row-"]').first();
  await workload.getByLabel("Sends").selectOption(mode);
  if (mode === "bulk") {
    await workload.getByTestId("bulk-requests").fill(String(amount));
    await workload.getByTestId("bulk-arrival").selectOption("spread");
    await workload.getByTestId("bulk-spread").fill(String(spreadMs));
  } else await workload.getByTestId("stream-rate").fill(String(amount));
  await editor.getByTestId("scenario-editor-apply").click();
  await editor
    .getByRole("button", { name: /Cancel|Close/ })
    .first()
    .click();
}

export async function recording(page: Page) {
  await traffic(page);
  await page.getByTestId("scenario-run-btn").click();
  await expect(page.getByTestId("playback-status")).toContainText(
    /complete/i,
    { timeout: 20000 },
  );
}

export async function inspect(page: Page) {
  const button = page.getByRole("button", {
    name: "Inspect Request Cycles",
    exact: true,
  });
  if ((await button.getAttribute("aria-expanded")) === "false")
    await button.click();
  const pane = page.getByRole("region", {
    name: "Simulation inspection",
    exact: true,
  });
  await expect(pane).toBeVisible();
  return pane;
}

export async function tab(page: Page, name: string) {
  const pane = await inspect(page);
  if (await pane.getByTestId('simulation-scope-pane').isVisible()) {
    if (name === 'Summary' || name === 'Cycles') return pane;
    if (name === 'Components' && await pane.getByRole('button', { name: 'Back to range', exact: true }).isVisible()) {
      await pane.getByRole('button', { name: 'Back to range', exact: true }).click();
    }
    await pane.getByRole('tab', { name, exact: true }).click();
  } else await pane.getByRole("button", { name, exact: true }).click();
  return pane;
}

export async function range(page: Page, from = 0.2, to = 0.8) {
  const slider = page.getByRole("slider", {
    name: "Simulation playhead",
    exact: true,
  });
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * from, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, box.y + box.height * 0.75, {
    steps: 8,
  });
  await page.mouse.up();
}

export async function noOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page
        .getByTestId("playback-panel")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    )
    .toBe(true);
}

export async function savedRunCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('system-studio-local-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('runs', 'readonly').objectStore('runs').count();
      count.onerror = () => { db.close(); reject(count.error); };
      count.onsuccess = () => { db.close(); resolve(count.result); };
    };
  }));
}

export async function runAll(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByTestId('topbar-quick-options-btn').click();
  await page.getByTestId('quick-options-input').fill('Run all scenarios');
  await page.getByTestId('quick-option-run.start-all').click();
}

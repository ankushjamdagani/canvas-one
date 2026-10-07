import { test as base, expect, type Page } from "@playwright/test";

export const speedTrigger = (page: Page) => page.locator('[data-testid="playback-panel"]:has([role="slider"][aria-disabled="false"]) [data-testid="playback-speed"]');

/** Move playback to the source design's fastest public setting. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addLocatorHandler(
      speedTrigger(page),
      async (speed) => {
        const group = page.getByRole('group', { name: 'Playback speed', exact: true });
        if (await group.isVisible()) await group.getByRole('button', { name: '4×', exact: true }).click();
        else {
          for (let attempt = 0; attempt < 4 && await speed.innerText() !== '4×'; attempt++) {
            const before = await speed.innerText();
            await page.getByRole('button', { name: 'Playback speed', exact: true }).click();
            await expect(speed).not.toHaveText(before);
          }
        }
        await expect(speed).toHaveText("4×");
      },
      { times: 1, noWaitAfter: true },
    );
    await use(page);
  },
});
export { expect };
export * from "@playwright/test";

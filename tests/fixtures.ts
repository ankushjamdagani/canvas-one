import { test as base, expect } from "@playwright/test";

/** Move playback to its fastest public setting once a recording exposes transport. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addLocatorHandler(
      page.getByTestId("playback-speed"),
      async (speed) => {
        const current = Number((await speed.textContent())?.replace("×", ""));
        for (let value = current; value < 16; value *= 2) {
          const faster = page.getByRole("button", { name: "Faster playback", exact: true });
          await expect(faster).toBeEnabled({ timeout: 20000 });
          await faster.click();
          await expect(speed).toHaveText(`${value * 2}×`);
        }
        await expect(speed).toHaveText("16×");
      },
      { times: 1, noWaitAfter: true },
    );
    await use(page);
  },
});
export { expect };
export * from "@playwright/test";

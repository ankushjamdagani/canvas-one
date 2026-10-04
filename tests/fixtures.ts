import { test as base, expect } from "@playwright/test";

/** Choose a visible playback speed once per page; no product-only test override. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addLocatorHandler(
      page.getByTestId("playback-speed"),
      async (speed) => {
        await speed.selectOption("16");
      },
      { times: 1, noWaitAfter: true },
    );
    await use(page);
  },
});
export { expect };
export * from "@playwright/test";

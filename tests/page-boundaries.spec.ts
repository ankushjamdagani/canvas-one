import { test, expect } from '@playwright/test';

for (const width of [1440, 390, 320]) {
  test(`${width}px: public pages scroll inside the frame beneath shared sticky chrome`, async ({ page }) => {
    await page.setViewportSize({ width, height: 360 });
    for (const path of ['/', '/projects', '/brand']) {
      await page.goto(path);
      const scroller = page.locator('.public-page-scroll');
      const header = page.locator('.public-header');
      await expect(header).toBeVisible();
      await scroller.evaluate(el => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
      const scroll = await scroller.evaluate(el => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
      expect(scroll.top).toBe(scroll.max);
      const bounds = await header.boundingBox();
      expect(bounds!.x).toBe(23);
      expect(bounds!.y).toBe(23);
      expect(bounds!.width).toBe(width - 46);
      const styles = await header.evaluate(el => {
        const css = getComputedStyle(el);
        return { blur: css.backdropFilter, border: css.borderBottomWidth };
      });
      expect(styles.blur).toContain('blur(16px)');
      expect(styles.border).toBe('1px');
      expect(await scroller.evaluate(el => getComputedStyle(el).clipPath)).toBe('inset(23px)');
      await expect(header.getByTestId('theme-trigger')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`${path.replaceAll('/', '') || 'landing'}.png`) });
    }
  });
}

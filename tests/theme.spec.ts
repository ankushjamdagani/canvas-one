import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PALETTES } from '../src/lib/theme/palettes';

test('all supplied schemes and modes apply, restore defaults, and survive reload', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByTestId('theme-trigger')).toBeVisible();
  const baseline = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(['--shell', '--canvas', '--secondary-text', '--control-border-strong', '--primary-hover', '--branch-tint', '--note-edge'].map(key => [key, style.getPropertyValue(key)]));
  });
  await page.getByTestId('theme-trigger').click();
  for (const mode of ['dark', 'light'] as const) {
    await page.getByRole('button', { name: mode === 'dark' ? 'Dark' : 'Light', exact: true }).click();
    for (const palette of PALETTES) {
      await page.getByTestId(`theme-swatch-${palette.id}`).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', palette.id);
      await expect(page.locator('html')).toHaveAttribute('data-theme-mode', mode);
      if (palette.id === 'evergreen' && mode === 'light') continue;
      const actual = await page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        return ['--shell', '--canvas', '--primary', '--branch', '--risk'].map(key => s.getPropertyValue(key).trim());
      });
      const tokens = palette[mode];
      expect(actual).toEqual([tokens.shell, tokens.canvas, tokens.action, tokens.branch, tokens.risk]);
    }
  }
  await page.getByTestId('theme-swatch-evergreen').click();
  const restored = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(['--shell', '--canvas', '--secondary-text', '--control-border-strong', '--primary-hover', '--branch-tint', '--note-edge'].map(key => [key, style.getPropertyValue(key)]));
  });
  expect(restored).toEqual(baseline);
  await page.getByTestId('theme-swatch-nocturne').click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('theme-trigger')).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nocturne');
  await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
});

test('keyboard radios, dark canvas, navigation and tab synchronization', async ({ page, context }) => {
  await page.goto('/projects');
  await page.getByTestId('theme-trigger').click();
  await page.getByTestId('theme-swatch-evergreen').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('theme-swatch-slate')).toBeFocused();
  await expect(page.getByTestId('theme-swatch-slate')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'slate');
  await page.getByTestId('theme-trigger').click();
  await page.getByTestId('theme-swatch-cyanotype').click();
  await page.keyboard.press('Escape');
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'cyanotype');
  await other.getByTestId('theme-trigger').click();
  await other.getByTestId('theme-swatch-achromatic').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'achromatic');
  await other.close();
});

test('320px menu reflows, scrolls, and returns focus', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/projects');
  await page.getByTestId('theme-trigger').click();
  const menu = page.getByTestId('theme-popover');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await page.getByTestId('theme-swatch-saffron').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'saffron');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: info.outputPath('theme-phone.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('theme-trigger')).toBeFocused();
});

test('dark and fluorescent menus retain accessible text and controls', async ({ page }, info) => {
  await page.goto('/projects');
  await page.getByTestId('theme-trigger').click();
  for (const palette of ['evergreen', 'cyanotype', 'achromatic']) {
    await page.getByTestId(`theme-swatch-${palette}`).click();
    for (const mode of ['Dark', 'Light']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect.poll(() => page.getByTestId('theme-popover').evaluate(element =>
        element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
      )).toBe(0);
      const audit = await new AxeBuilder({ page }).include('[data-testid="theme-popover"]').analyze();
      expect(audit.violations).toEqual([]);
    }
  }
  await page.screenshot({ path: info.outputPath('theme-desktop.png') });
});

test('invalid preferences and unavailable storage keep switching usable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('studio:theme', 'nocturne:dark:extra');
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'evergreen');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Denied', 'SecurityError'); };
  });
  await page.getByTestId('theme-trigger').click();
  await page.getByTestId('theme-swatch-lichen').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lichen');
});

import { test, expect, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PALETTES } from '../src/lib/theme/palettes';
import { contrastRatio } from '../src/components/studio/tokens';

test.describe.configure({ mode: 'parallel' });
for (const palette of PALETTES) for (const mode of ['light', 'dark'] as const) {
  test(`${palette.id} ${mode}: collaboration proposal colours`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('studio:theme', value), `${palette.id}:${mode}`);
    await page.goto('/');
    await expect(page.locator('.lp-note')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Pause demo', exact: true }).click();
    const accept = page.getByRole('button', { name: 'Accept', exact: true });
    await expect(accept).toBeVisible();
    const failures: unknown[] = [];
    async function scan(state: string) {
      const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      failures.push(...result.violations.map(v => ({ state, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })));
    }
    async function contrast(target: string | Locator, minimum: number) {
      const colours = await (typeof target === 'string' ? page.locator(target).first() : target).evaluate(el => {
        const s = getComputedStyle(el);
        function hex(value: string) {
          const rgb = value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
          return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
        }
        return { foreground: hex(s.color), background: hex(s.backgroundColor) };
      });
      expect(contrastRatio(colours.foreground, colours.background), String(target)).toBeGreaterThanOrEqual(minimum);
    }
    await scan('proposal:rest');
    for (const selector of ['.lp-cursor span', '.lp-claude span', '.lp-avatars i', '.lp-avatars i + i']) await contrast(selector, 4.5);
    for (const selector of ['.lp-claude > span', '.lp-avatars i + i']) {
      expect(await page.locator(selector).first().evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    }
    await expect(page.locator('.lp-prompt button .canvas-one-face')).toBeVisible();
    for (const button of [accept, page.getByRole('button', { name: 'Dismiss', exact: true }), page.getByRole('button', { name: 'Replay collaboration demo' })]) {
      await button.hover();
      await page.waitForTimeout(200); // Let authored colour transitions settle.
      await contrast(button, button === accept || await button.innerText() === 'Dismiss' ? 4.5 : 3);
      await scan('proposal:hover');
      await page.keyboard.press('Tab');
      await button.focus();
      await page.waitForTimeout(200);
      expect(await button.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
      const focus = await button.evaluate(el => {
        const s = getComputedStyle(el);
        const values = s.outlineColor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        return { colour: '#' + values.map(v => v.toString(16).padStart(2, '0')).join(''), background: getComputedStyle(document.querySelector('.canvas-one-root')!).getPropertyValue('--background').trim() };
      });
      expect(contrastRatio(focus.colour, focus.background)).toBeGreaterThanOrEqual(3);
      await scan('proposal:focus');
      await page.mouse.down();
      await page.waitForTimeout(200);
      await contrast(button, button === accept || await button.innerText() === 'Dismiss' ? 4.5 : 3);
      await scan('proposal:pressed');
      await page.mouse.move(10, 10);
      await page.mouse.up();
    }
    await contrast('.lp-prompt button', 3);
    expect(failures).toEqual([]);
  });
}

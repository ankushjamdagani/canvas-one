import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PALETTES } from '../src/lib/theme/palettes';
import { contrastRatio } from '../src/components/studio/tokens';
test.describe.configure({ mode: 'parallel' });

for (const palette of PALETTES) for (const mode of ['light', 'dark'] as const) {
  test(`${palette.id} ${mode}: page and theme states`, async ({ page }, info) => {
    await page.addInitScript(value => localStorage.setItem('studio:theme', value), `${palette.id}:${mode}`);
    const failures: unknown[] = [];
    async function audit(state: string) {
      await expect.poll(() => page.locator('[data-reveal-kind]').evaluateAll(elements => elements.every(element => getComputedStyle(element).opacity === '1'))).toBe(true);
      await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))));
      const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      for (const violation of result.violations) failures.push({ state, id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, html: node.html, summary: node.failureSummary })) });
    }
    for (const route of ['/', '/projects', 'workspace']) {
      if (route === 'workspace') {
        await page.getByTestId('create-example-s05').click();
        await expect(page.getByTestId('workspace-root')).toBeVisible();
      } else await page.goto(route);
      await audit(`${route}:rest`);
      const selection = await page.locator('body').evaluate(element => {
        const style = getComputedStyle(element, '::selection');
        return { color: style.color, background: style.backgroundColor };
      });
      expect(selection.color).not.toBe(selection.background);
      if (route === '/projects') {
        await page.getByTestId('blank-project-name-input').fill('Accessible project');
        await page.getByTestId('blank-project-name-input').hover();
        await audit('projects:primary-card-hover');
        await page.getByTestId('blank-project-name-input').focus();
        await audit('projects:input-focus');
      }
      await page.getByTestId('theme-trigger').hover();
      await audit(`${route}:tool-hover`);
      await page.getByTestId('theme-trigger').click();
      const radios = page.getByRole('radiogroup', { name: 'Color palette' }).getByRole('radio');
      await expect(radios).toHaveCount(14);
      await expect(page.getByText('COLOUR · NEW', { exact: true })).toHaveCount(0);
      await audit(`${route}:selected-menu`);
      const alternate = page.getByTestId(`theme-swatch-${palette.id === 'evergreen' ? 'slate' : 'evergreen'}`);
      await alternate.hover();
      await audit(`${route}:palette-hover`);
      await page.keyboard.press('Tab');
      await page.getByTestId(`theme-swatch-${palette.id}`).focus();
      expect(await page.getByTestId(`theme-swatch-${palette.id}`).evaluate(element => {
        const style = getComputedStyle(element);
        return element.matches(':focus-visible') && parseFloat(style.outlineWidth) >= 2;
      })).toBe(true);
      await audit(`${route}:keyboard-focus`);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('theme-trigger')).toBeFocused();
      if (route === 'workspace') {
        await page.getByTestId('breadcrumb-branch-btn').click();
        await expect(page.getByTestId('branch-popover')).toBeVisible();
        await audit('workspace:branch-current');
        await page.getByTestId('branch-create-open').click();
        await audit('workspace:branch-form');
        await page.keyboard.press('Escape');
        await page.getByTestId('dock-component-btn').click();
        await audit('workspace:library-picker');
        await page.getByTestId('library-picker-full-library-btn').click();
        await expect(page.locator('[data-panel-id="library"]').first()).toBeVisible();
        await audit('workspace:library');
        await page.getByRole('button', { name: 'List view', exact: true }).click();
        await audit('workspace:library-list-selected');
        await page.locator('[data-entry-id="client"]').first().hover();
        await audit('workspace:library-detail-hover');
        await page.getByTestId('topbar-history-btn').click();
        await audit('workspace:history');
        await page.locator('.component-node').first().click();
        await audit('workspace:selection-inspector');
        for (const title of ['Inspector', 'History', 'Library']) {
          const close = page.getByRole('button', { name: `Close ${title}`, exact: true });
          if (await close.isVisible()) await close.click();
        }
        await page.getByTestId('dock-note-btn').click();
        await page.getByTestId('dock-note-input').fill('**Readable note**\n[Link](https://example.com)');
        await page.getByTestId('dock-note-input').press('Enter');
        await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
        await page.mouse.move(5, 300);
        await page.locator('[data-testid^="note-bubble-"]').first().locator('..').click();
        for (const tone of ['paper', 'sky', 'mint', 'rose', 'lilac', 'neutral']) {
          await page.locator('.note-card').first().getByTestId(/note-color-btn-/).click();
          await page.getByTestId(new RegExp(`note-color-${tone}-`)).click();
          await audit(`workspace:note-${tone}`);
        }
        await page.getByTestId('scenario-switcher-trigger').click();
        await audit('workspace:scenario-menu');
        await page.getByRole('button', { name: 'New scenario', exact: true }).click();
        await expect(page.getByTestId('new-scenario-dialog')).toBeVisible();
        await audit('workspace:new-scenario-selected-mode');
        await page.getByTestId('new-scenario-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByTestId('scenario-run-btn').click();
        await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
        await audit('workspace:recording-paused');
        const traffic = page.locator('[data-cells-lanes-node]').first();
        await page.keyboard.press('Tab');
        await traffic.focus();
        await expect.poll(() => traffic.locator(':scope > div').first().evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
        const focusColors = await traffic.locator(':scope > div').first().evaluate(element => {
          const style = getComputedStyle(element);
          const toHex = (color: string) => '#' + color.match(/[\d.]+/g)!.slice(0, 3).map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
          return [toHex(style.boxShadow.match(/rgba?\([^)]+\)/)![0]), toHex(style.backgroundColor)];
        });
        expect(contrastRatio(focusColors[0], focusColors[1])).toBeGreaterThanOrEqual(3);
        await audit('workspace:traffic-keyboard-focus');
        await page.getByRole('button', { name: 'Inspect Request Cycles', exact: true }).click();
        await expect(page.getByTestId('cycle-inspection-row').first()).toBeVisible();
        await page.getByTestId('cycle-inspection-row').first().click();
        await audit('workspace:selected-request-cycle');
        await page.screenshot({ path: info.outputPath(`${palette.id}-${mode}-workspace.png`) });
        await page.setViewportSize({ width: 320, height: 640 });
        await page.getByTestId('theme-trigger').click();
        const menu = page.getByTestId('theme-popover');
        const bounds = await menu.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
        await audit('workspace:phone-menu');
        await page.screenshot({ path: info.outputPath(`${palette.id}-${mode}-phone.png`) });
      }
    }
    await info.attach('contrast-audit', { body: JSON.stringify(failures, null, 2), contentType: 'application/json' });
    expect(failures).toEqual([]);
  });
}

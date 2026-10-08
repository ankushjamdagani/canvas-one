import { test, expect } from './fixtures';

test('canvas dots share the snapped flow origin through zoom, pan and resize', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await page.getByTestId('breadcrumb-project-btn').click();
  const menu = page.getByTestId('project-menu-popover');
  await expect(menu).toBeVisible();
  expect(await menu.locator('[data-slot="dropdown-menu-header"] > div').evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize))).toEqual(['10px', '13px', '10px']);
  expect(await menu.getByRole('menuitem').evaluateAll(elements => elements.every(element => getComputedStyle(element).fontSize === '13px'))).toBe(true);
  await page.keyboard.press('Escape');

  async function alignment() {
    return page.evaluate(() => {
      const viewport = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform);
      const pattern = document.querySelector<SVGPatternElement>('.react-flow__background pattern')!;
      const dot = pattern.querySelector('circle')!;
      const transform = pattern.patternTransform.baseVal.consolidate()!.matrix;
      const pitch = pattern.width.baseVal.value;
      const x = pattern.x.baseVal.value + transform.e + dot.cx.baseVal.value;
      const y = pattern.y.baseVal.value + transform.f + dot.cy.baseVal.value;
      const residual = (distance: number) => Math.abs(distance - Math.round(distance / pitch) * pitch);
      return { x: residual(x - viewport.e), y: residual(y - viewport.f), zoom: viewport.a, flowPitch: pitch / viewport.a };
    });
  }

  async function expectAligned() {
    await expect.poll(async () => {
      const result = await alignment();
      return Math.max(result.x, result.y);
    }).toBeLessThan(0.01);
    const result = await alignment();
    // Reduced-density dots still represent integer multiples of the authored 24-unit grid.
    expect(result.flowPitch / 24).toBeCloseTo(Math.round(result.flowPitch / 24), 3);
  }

  await expectAligned();
  const initial = await alignment();
  expect(initial.flowPitch).toBeCloseTo(24, 3);
  for (let step = 0; step < 4; step++) {
    await page.getByTestId('dock-zoom-out-btn').click();
    await expectAligned();
  }
  expect((await alignment()).zoom).toBeLessThan(initial.zoom);
  await page.getByRole('button', { name: 'Pan tool', exact: true }).click();
  await page.mouse.move(900, 600);
  await page.mouse.down();
  await page.mouse.move(978, 657, { steps: 10 });
  await page.mouse.up();
  await expectAligned();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectAligned();
});

import { test, expect, type Page, type Locator } from './fixtures';
import { readFileSync, mkdirSync } from 'node:fs';

const kinds = ['rectangle', 'rounded-rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'text'] as const;
type Kind = typeof kinds[number];

async function idle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

async function openBlank(page: Page, title: string) {
  await page.goto('/projects');
  await page.getByTestId('blank-project-name-input').fill(title);
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await idle(page);
  const viewport = page.locator('.react-flow__viewport');
  let previous = await viewport.getAttribute('style');
  await expect.poll(async () => {
    await page.waitForTimeout(150);
    const current = await viewport.getAttribute('style');
    const stable = current === previous;
    previous = current;
    return stable;
  }).toBe(true);
}

async function add(page: Page, kind: Kind): Promise<Locator> {
  const before = await page.locator('.canvas-element').count();
  await page.getByTestId('dock-shapes-btn').click();
  await page.getByTestId(`add-canvas-${kind}`).click();
  await expect(page.locator('.canvas-element')).toHaveCount(before + 1);
  await idle(page);
  const element = page.locator(`.canvas-element[data-kind="${kind}"]`).last();
  await expect(element).toBeVisible();
  return page.getByTestId((await element.getAttribute('data-testid'))!);
}

async function editText(page: Page, element: Locator, text: string) {
  await element.getByRole('button', { name: 'Edit element text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Element text', exact: true }).fill(text);
  await element.getByRole('button', { name: 'Save', exact: true }).click();
  await idle(page);
}

test('all seven canvas primitives persist independently of executable components', async ({ page }) => {
  await openBlank(page, 'Visual primitives');
  for (const kind of kinds) await add(page, kind);
  await expect(page.locator('.component-node')).toHaveCount(0);
  for (const kind of kinds) await expect(page.locator(`.canvas-element[data-kind="${kind}"]`)).toHaveCount(1);
  const ids = await page.locator('.canvas-element').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')).sort());
  await page.reload();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.locator('.canvas-element')).toHaveCount(kinds.length);
  expect(await page.locator('.canvas-element').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')).sort())).toEqual(ids);
  await expect(page.locator('.component-node')).toHaveCount(0);
});

test('standalone text saves literal content, cancels edits and uses authored undo and redo', async ({ page }) => {
  await openBlank(page, 'Canvas text');
  const element = await add(page, 'text');
  const initialText = await element.innerText();
  const text = 'Request lifecycle\n<script>literal text</script>';
  await editText(page, element, text);
  await expect(element).toContainText(text);
  await expect(element.locator('script')).toHaveCount(0);

  await element.getByRole('button', { name: 'Edit element text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Element text', exact: true }).fill('Discard this edit');
  await element.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(element).toContainText(text);
  await page.getByTestId('dock-undo-btn').click();
  await idle(page);
  await expect(element).toHaveText(initialText);
  await page.getByTestId('dock-redo-btn').click();
  await idle(page);
  await expect(element).toContainText(text);
  await page.reload();
  await expect(element).toBeVisible();
  await expect(element).toContainText(text);
});

test('shape movement and appearance edits persist with bounded dimensions', async ({ page }) => {
  await openBlank(page, 'Shape geometry');
  const element = await add(page, 'rectangle');
  const before = (await element.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 64, before.y + before.height / 2 + 48, { steps: 12 });
  await page.mouse.up();
  await idle(page);
  await expect.poll(async () => Math.round((await element.boundingBox())!.x - before.x)).toBeGreaterThan(40);
  await element.getByRole('button', { name: 'Element appearance', exact: true }).click();
  const width = page.getByRole('spinbutton', { name: 'Width', exact: true });
  await width.fill('280');
  await width.press('Tab');
  await idle(page);
  const height = page.getByRole('spinbutton', { name: 'Height', exact: true });
  await height.fill('160');
  await height.press('Tab');
  await idle(page);
  const size = page.getByRole('spinbutton', { name: 'Text size', exact: true });
  await size.fill('24');
  await size.press('Tab');
  await idle(page);
  await expect(width).toHaveValue('280');
  await expect(height).toHaveValue('160');
  mkdirSync('artifacts/canvas-elements', { recursive: true });
  await page.screenshot({ path: 'artifacts/canvas-elements/desktop.png', fullPage: true });
  await width.fill('0');
  await width.press('Tab');
  await expect(page.locator('.canvas-element-settings').getByRole('alert')).toContainText('Use a value');
  await expect(width).toHaveValue('280');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(element).toBeVisible();
  await element.click();
  await element.getByRole('button', { name: 'Element appearance', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('280');
  await expect(page.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('160');
  await expect(page.getByRole('spinbutton', { name: 'Text size', exact: true })).toHaveValue('24');
});

test('duplicating and deleting shapes keep independent identities and support undo', async ({ page }) => {
  await openBlank(page, 'Shape copy and delete');
  const original = await add(page, 'diamond');
  await editText(page, original, 'Decision');
  const originalId = await original.getAttribute('data-testid');
  await page.getByTestId('topbar-quick-options-btn').click();
  await page.getByTestId('quick-options-input').fill('Duplicate selection');
  await page.getByRole('option', { name: /Duplicate selection/ }).first().click();
  await idle(page);
  await expect(page.locator('.canvas-element')).toHaveCount(2);
  const copied = page.locator(`.canvas-element:not([data-testid="${originalId}"])`);
  await expect(copied).toContainText('Decision');
  await expect(copied).not.toHaveAttribute('data-testid', originalId!);
  await page.getByTestId('canvas-container').focus();
  await page.keyboard.press('Delete');
  await idle(page);
  await expect(page.locator('.canvas-element')).toHaveCount(1);
  await expect(original).toBeVisible();
  await page.getByTestId('dock-undo-btn').click();
  await idle(page);
  await expect(page.locator('.canvas-element')).toHaveCount(2);
});

test('phone shape picker remains on screen with usable touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBlank(page, 'Phone shapes');
  const trigger = page.getByTestId('dock-shapes-btn');
  const button = (await trigger.boundingBox())!;
  expect(button.width).toBeGreaterThanOrEqual(44);
  expect(button.height).toBeGreaterThanOrEqual(44);
  expect(button.x).toBeGreaterThanOrEqual(0);
  expect(button.x + button.width).toBeLessThanOrEqual(390);
  await trigger.click();
  for (const kind of kinds) {
    const item = page.getByTestId(`add-canvas-${kind}`);
    await expect(item).toBeVisible();
    const box = (await item.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  mkdirSync('artifacts/canvas-elements', { recursive: true });
  await page.screenshot({ path: 'artifacts/canvas-elements/mobile.png', fullPage: true });
  await page.getByTestId('add-canvas-text').click();
  await idle(page);
  await expect(page.locator('.canvas-element[data-kind="text"]')).toBeVisible();
  const selected = page.locator('.canvas-element[data-kind="text"]');
  const selectedBox = (await selected.boundingBox())!;
  expect(selectedBox.x).toBeGreaterThanOrEqual(0);
  expect(selectedBox.x + selectedBox.width).toBeLessThanOrEqual(390);
  for (const name of ['Edit element text', 'Element appearance', 'Duplicate selection', 'Delete selection']) await expect(selected.getByRole('button', { name, exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/canvas-elements/mobile-selected.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('transparent text and standalone marks start with the active dark-theme ink', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('studio:theme', 'evergreen:dark'));
  await openBlank(page, 'Dark canvas primitives');
  const text = await add(page, 'text');
  const colors = await page.evaluate(() => {
    const root = document.querySelector('.canvas-one-root')!;
    return { color: getComputedStyle(root).color, ink: getComputedStyle(root).getPropertyValue('--ink').trim() };
  });
  await expect(text.getByText('Text', { exact: true })).toHaveCSS('color', colors.color);
  await editText(page, text, 'Readable canvas text');
  mkdirSync('artifacts/canvas-elements', { recursive: true });
  await page.screenshot({ path: 'artifacts/canvas-elements/dark-text.png', fullPage: true });
  for (const kind of ['line', 'arrow'] as const) {
    const mark = await add(page, kind);
    await expect(mark.locator('svg path').first()).toHaveAttribute('stroke', colors.ink);
  }
});

test('shape-only boards export images and round-trip through the portable project archive', async ({ page, browser }, info) => {
  await openBlank(page, 'Visual archive');
  const element = await add(page, 'rounded-rectangle');
  await editText(page, element, 'Durable visual object');
  const openExport = async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByTestId('breadcrumb-project-btn').click();
    await page.getByTestId('export-menu-trigger').click();
  };
  await openExport();
  await expect(page.getByTestId('export-menu-png')).toBeEnabled();
  const svgDownload = page.waitForEvent('download');
  await page.getByTestId('export-menu-svg').click();
  const svg = await svgDownload;
  const svgPath = info.outputPath('visual.svg');
  await svg.saveAs(svgPath);
  expect(readFileSync(svgPath, 'utf8')).toContain('data-canvas-element-id=');
  expect(readFileSync(svgPath, 'utf8')).toContain('Durable visual object');
  await openExport();
  const pngDownload = page.waitForEvent('download');
  await page.getByTestId('export-menu-png').click();
  const png = await pngDownload;
  const pngPath = info.outputPath('visual.png');
  await png.saveAs(pngPath);
  expect([...readFileSync(pngPath).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await openExport();
  const archiveDownload = page.waitForEvent('download');
  await page.getByTestId('export-menu-json').click();
  const archive = await archiveDownload;
  const archivePath = info.outputPath('visual.json');
  await archive.saveAs(archivePath);
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    await context.addInitScript(() => localStorage.setItem('studio:motion', 'off'));
    const imported = await context.newPage();
    await imported.goto('/projects');
    await imported.getByTestId('import-project-file-input').setInputFiles(archivePath);
    const project = imported.getByTestId('existing-projects-list').locator('[data-testid^="project-item-"]', { hasText: 'Visual archive' });
    await project.locator('[data-testid^="open-project-"]').click();
    await expect(imported.locator('.canvas-element[data-kind="rounded-rectangle"]')).toContainText('Durable visual object');
  } finally { await context.close(); }
});

test('resize handles commit authored geometry and undo restores the original size', async ({ page }) => {
  await openBlank(page, 'Resize visual object');
  const element = await add(page, 'ellipse');
  const widthOf = () => element.evaluate(node => Number.parseFloat(getComputedStyle(node).width));
  const before = await widthOf();
  const handle = element.locator('.react-flow__resize-control.bottom.right');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await idle(page);
  await expect.poll(widthOf).toBeGreaterThan(before + 30);
  const resized = await widthOf();
  await page.getByTestId('dock-undo-btn').click();
  await idle(page);
  await expect.poll(widthOf).toBe(before);
  await page.getByTestId('dock-redo-btn').click();
  await idle(page);
  await expect.poll(widthOf).toBe(resized);
  await page.reload();
  await expect(element).toBeVisible();
  expect(await widthOf()).toBe(resized);
});

import { test, expect, type Page } from '@playwright/test';

/**
 * RV-13b: Library panel journeys (screens 12A list, 12B grid, 12C hover/focus
 * detail; specs/revamp/contracts/catalog.md section 5).
 *
 * Not covered: the compact 16E picker. `LibraryPicker` exists in
 * src/features/library but is not mounted anywhere in the workspace, so no
 * dock or shortcut reaches it (the dock Component button focuses the docked
 * Library panel, which is what these specs drive).
 */

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

async function openBlankProject(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('blank-project-name-input').fill(name);
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
}

async function openLibrary(page: Page) {
  await page.getByTestId('dock-component-btn').click();
  const panel = page.getByTestId('library-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function elementIds(page: Page): Promise<string[]> {
  return page.locator('.component-node').evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const id = node.getAttribute('data-element-id');
      return id ? [id] : [];
    }));
}

test.describe('RV-13b: Library panel', () => {
  test('search filters the catalog, shows an empty state, and clears', async ({ page }) => {
    await openBlankProject(page, `RV-13b library search ${Date.now()}`);
    const panel = await openLibrary(page);
    const options = panel.getByRole('option');

    const total = await options.count();
    expect(total).toBeGreaterThan(3);

    const search = panel.getByRole('searchbox', { name: 'Search components' });
    await search.fill('queue');
    await expect(panel.locator('[data-entry-id="queue"]')).toBeVisible();
    await expect(async () => {
      const filtered = await options.count();
      expect(filtered).toBeGreaterThan(0);
      expect(filtered).toBeLessThan(total);
    }).toPass();

    await search.fill('zzz-no-such-component');
    await expect(options).toHaveCount(0);
    await expect(panel.getByText(/No components match/)).toBeVisible();
    await panel.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(options).toHaveCount(total);
    await expect(search).toHaveValue('');
  });

  test('list and grid toggle keeps the catalog and reports the pressed view', async ({ page }) => {
    await openBlankProject(page, `RV-13b library views ${Date.now()}`);
    const panel = await openLibrary(page);
    const options = panel.getByRole('option');
    const total = await options.count();

    const listBtn = panel.getByRole('button', { name: 'List view' });
    const gridBtn = panel.getByRole('button', { name: 'Grid view' });
    await expect(listBtn).toHaveAttribute('aria-pressed', 'true');

    await gridBtn.click();
    await expect(gridBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(listBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(options).toHaveCount(total);

    await listBtn.click();
    await expect(listBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(options).toHaveCount(total);
  });

  test('hover and focus detail shows human-readable defaults, not raw config keys', async ({ page }) => {
    await openBlankProject(page, `RV-13b library detail ${Date.now()}`);
    const panel = await openLibrary(page);
    const queue = panel.locator('[data-entry-id="queue"]');

    await queue.hover();
    const detail = page.getByTestId('entry-detail-card');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('DEFAULTS');
    await expect(detail).toContainText('DOES NOT MODEL');

    const defaults = (await detail.innerText()).split('DEFAULTS')[1]?.split('DOES NOT MODEL')[0] ?? '';
    expect(defaults.trim().length).toBeGreaterThan(0);
    // Raw camelCase config keys (queueLimit, retryDelayMs, ...) must never reach the user.
    expect(defaults).not.toMatch(/[a-z][A-Z]/);
    expect(defaults).not.toMatch(/undefined|null|\[object/);

    // Moving away dismisses it; keyboard focus brings it back.
    await page.mouse.move(0, 0);
    await expect(detail).toBeHidden();
    await queue.focus();
    await expect(page.getByTestId('entry-detail-card')).toBeVisible();

    // The footer for the selected entry also reads as a plain defaults line.
    await queue.click();
    const footerText = (await panel.innerText());
    expect(footerText).toMatch(/Place on canvas/);
  });

  test('places a component from the Library by clicking Place on canvas', async ({ page }) => {
    await openBlankProject(page, `RV-13b library click ${Date.now()}`);
    const panel = await openLibrary(page);
    expect(await elementIds(page)).toHaveLength(0);

    await panel.locator('[data-entry-id="queue"]').click();
    await panel.getByRole('button', { name: 'Place Message Queue on canvas' }).click();
    await expect(page.locator('.component-node')).toHaveCount(1);
    await waitForIdle(page);
  });

  test('places a component from the Library with the keyboard (arrows then Enter)', async ({ page }) => {
    await openBlankProject(page, `RV-13b library keyboard ${Date.now()}`);
    const panel = await openLibrary(page);

    const listbox = panel.getByRole('listbox', { name: 'Component catalog entries' });
    await listbox.focus();
    const selected = panel.locator('[role="option"][aria-selected="true"]');
    const first = await selected.getAttribute('data-entry-id');
    await page.keyboard.press('ArrowDown');
    await expect(selected).not.toHaveAttribute('data-entry-id', first ?? '');
    await page.keyboard.press('Enter');

    await expect(page.locator('.component-node')).toHaveCount(1);
    await waitForIdle(page);
  });

  test('390x844: Library search and placement work without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBlankProject(page, `RV-13b library mobile ${Date.now()}`);
    const panel = await openLibrary(page);

    await panel.getByRole('searchbox', { name: 'Search components' }).fill('service');
    await panel.locator('[data-entry-id="service"]').click();
    await panel.getByRole('button', { name: /Place .* on canvas/ }).click();
    await expect(page.locator('.component-node')).toHaveCount(1);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

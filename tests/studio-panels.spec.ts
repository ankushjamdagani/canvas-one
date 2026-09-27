import { test, expect, type Page } from '@playwright/test';

/**
 * RV-12h: History and Library panels wired into the running workspace
 * through the panel system (PanelHost / panels.ts, RV-03a).
 *
 * Helpers mirror tests/studio-authoring.spec.ts (waitForIdle on the
 * save-status data-state, blank projects for authoring gestures, S05 for a
 * populated project).
 */

/** Waits until no authored command is in flight. */
async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

/** Waits until the canvas camera stops moving (the open-time fit runs after
 * a short delay), so screen coordinates read afterwards stay valid. */
async function waitForStableViewport(page: Page) {
  const viewport = page.locator('.react-flow__viewport');
  await expect(viewport).toHaveCount(1);
  let previous = await viewport.getAttribute('style');
  await expect
    .poll(async () => {
      const current = await viewport.getAttribute('style');
      const stable = current === previous;
      previous = current;
      return stable;
    }, { intervals: [150, 150, 250, 250, 500] })
    .toBe(true);
}

/** Opens the S05 example project (populated view, opens on its own draft
 * branch, so checkpoints/commits are available). */
async function openS05Project(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
  await waitForStableViewport(page);
}

/** Creates a brand-new blank project (opens on one empty view labelled
 * "Main"), used where a placement gesture needs an uncluttered canvas. */
async function openBlankProject(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('blank-project-name-input').fill(name);
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
  await waitForStableViewport(page);
}

async function elementIds(page: Page): Promise<string[]> {
  return page.locator('.component-node').evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const id = node.getAttribute('data-element-id');
      return id ? [id] : [];
    }));
}

async function newElementId(page: Page, before: string[]): Promise<string> {
  const known = new Set(before);
  let added: string[] = [];
  await expect
    .poll(async () => {
      added = (await elementIds(page)).filter((id) => !known.has(id));
      return added.length;
    })
    .toBe(1);
  await waitForIdle(page);
  await expect(page.locator(`[data-element-id="${added[0]}"]`)).toBeVisible();
  return added[0];
}

test.describe('RV-12h: History and Library panels', () => {
  test('opens History from the top bar and the ladder renders for an S05 project', async ({ page }) => {
    await openS05Project(page);

    await expect(page.locator('[data-panel-id="history"]')).toHaveCount(0);
    await page.getByTestId('topbar-history-btn').click();

    const historyPanel = page.locator('[data-panel-id="history"]');
    await expect(historyPanel).toBeVisible();
    await expect(page.getByTestId('history-ladder')).toBeVisible();
    // The ladder reads real branch/session state, not placeholder copy.
    await expect(page.getByTestId('branch-selector-row')).toBeVisible();
  });

  test('saves a checkpoint from the History panel', async ({ page }) => {
    await openS05Project(page);
    await page.getByTestId('topbar-history-btn').click();

    const ladder = page.getByTestId('history-ladder');
    await expect(ladder).toBeVisible();

    const label = `Before tweak ${Date.now()}`;
    await ladder.getByPlaceholder('Save checkpoint label').fill(label);
    await ladder.getByRole('button', { name: 'Save' }).click();

    await waitForIdle(page);
    await expect(ladder.getByText(label)).toBeVisible();
    // The inline form clears its label once the checkpoint is really saved.
    await expect(ladder.getByPlaceholder('Save checkpoint label')).toHaveValue('');
  });

  test('opens Library from the picker link and places a component from the panel', async ({ page }) => {
    await openBlankProject(page, `RV-12h library ${Date.now()}`);

    await expect(page.locator('[data-panel-id="library"]')).toHaveCount(0);

    // Open the compact picker from the dock, then follow its full-library link.
    await page.getByTestId('dock-component-btn').click();
    await expect(page.getByTestId('component-picker-anchor')).toBeVisible();
    await page.getByTestId('library-picker-full-library-btn').click();

    // Following the link closes the compact picker (D30 single instance)
    // and opens the docked Library panel instead.
    await expect(page.getByTestId('component-picker-anchor')).toHaveCount(0);
    const libraryPanel = page.locator('[data-panel-id="library"]');
    await expect(libraryPanel).toBeVisible();
    const panel = page.getByTestId('library-panel');
    await expect(panel).toBeVisible();

    // Place a catalog entry from the full panel through the same placement
    // path as the compact picker (CanvasView applyPlacement).
    const before = await elementIds(page);
    const card = panel.locator('[data-entry-id="gateway"]');
    await card.click();
    await panel.getByRole('button', { name: /Place .* on canvas/ }).click();

    await newElementId(page, before);
  });

  test('collapses and expands a panel', async ({ page }) => {
    await openS05Project(page);
    await page.getByTestId('topbar-history-btn').click();

    const historyPanel = page.locator('[data-panel-id="history"]');
    await expect(historyPanel).toBeVisible();

    await historyPanel.locator('[data-slot="panel-menu-trigger"]').click();
    await page.locator('[data-slot="menu-item-collapse"]').click();

    // Collapsed: the docked panel content is gone, replaced by a rail item.
    await expect(page.locator('[data-panel-id="history"][data-slot="panel-header"]')).toHaveCount(0);
    const railItem = page.locator('[data-slot="rail-item-button"][data-panel-id="history"]');
    await expect(railItem).toBeVisible();

    await railItem.click();

    await expect(page.getByTestId('history-ladder')).toBeVisible();
    await expect(page.locator('[data-slot="rail-item-button"][data-panel-id="history"]')).toHaveCount(0);
  });
});

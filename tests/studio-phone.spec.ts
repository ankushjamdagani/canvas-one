import { test, expect, devices } from '@playwright/test';

/**
 * RV-13 phone acceptance (D14 full phone editing; design.md "Touch targets";
 * requirements.md viewports). A 390×844 touch phone must keep every top-bar control
 * on screen — including the project menu — with coarse-pointer targets of at least
 * 44 px, and an expanded results panel must leave a usable canvas on short screens.
 */

const { defaultBrowserType: _ignored, ...iPhone } = devices['iPhone 13'];
test.use({ ...iPhone, viewport: { width: 390, height: 844 } });

for (const example of ['s04', 's05'] as const) test(`390×844 touch (${example}): top bar fits, project menu opens, and controls are at least 44 px`, async ({ page }) => {
  await page.goto('/');
  await page.getByTestId(`create-example-${example}`).click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');

  const topbar = page.getByTestId('workspace-topbar');
  const overflow = await topbar.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const ids = [
    'breadcrumb-project-btn',
    'breadcrumb-branch-btn',
    'topbar-quick-options-btn',
    'topbar-history-btn',
    'scenario-switcher-trigger',
    'scenario-run-btn',
    'results-details-toggle',
  ];
  for (const id of ids) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box!.x, `${id} left edge`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${id} right edge`).toBeLessThanOrEqual(390);
    expect(Math.min(box!.width, box!.height), `${id} touch size`).toBeGreaterThanOrEqual(44);
  }

  // The DRAFT/MAIN badge is the only branch-state cue on a phone; it must not be clipped.
  const chip = (await page.getByTestId('breadcrumb-chip').boundingBox())!;
  const badge = (await page.getByTestId('breadcrumb-branch-state').boundingBox())!;
  expect(badge.x + badge.width).toBeLessThanOrEqual(chip.x + chip.width - 1);
  await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('DRAFT');

  await page.getByTestId('breadcrumb-project-btn').tap();
  await expect(page.getByTestId('project-menu-popover')).toBeVisible();
});

test('short viewport: expanded results details leave a usable canvas', async ({ page }) => {
  await page.setViewportSize({ width: 756, height: 491 });
  await page.goto('/');
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
  await page.getByTestId('scenario-run-btn').tap();
  await expect(page.getByTestId('results-status-badge')).toContainText('completed', { timeout: 20000 });
  await page.getByTestId('results-details-toggle').tap();
  await expect(page.getByTestId('results-details-toggle')).toHaveAttribute('aria-expanded', 'true');

  const canvasHeight = await page.locator('.react-flow').evaluate((el) => el.getBoundingClientRect().height);
  expect(canvasHeight).toBeGreaterThanOrEqual(150);
});

test('390×844 touch: the 16E picker fits and places the selected entry with its Place button', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('blank-project-name-input').fill(`16E phone ${Date.now()}`);
  await page.getByTestId('create-blank-project-btn').tap();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');

  await page.getByTestId('dock-component-btn').tap();
  const picker = page.getByTestId('library-picker');
  await expect(picker).toBeVisible();
  const box = (await picker.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);

  await picker.locator('[data-entry-id="queue"]').tap();
  const place = page.getByTestId('library-picker-place-btn');
  await expect(place).toHaveText('Place Message Queue');
  expect((await place.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await place.tap();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('.component-node')).toHaveCount(1);
});

test('320×640 touch (WCAG 1.4.10 reflow): the top bar fits and History opens from Quick options as a modal that Escape closes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const id of ['breadcrumb-project-btn', 'breadcrumb-branch-btn', 'topbar-quick-options-btn', 'scenario-switcher-trigger', 'scenario-run-btn']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x, `${id} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${id} right edge`).toBeLessThanOrEqual(320);
  }
  // History's top-bar button steps back below 390 px; Quick options still lists it.
  await expect(page.getByTestId('topbar-history-btn')).toBeHidden();
  await page.getByTestId('topbar-quick-options-btn').tap();
  await page.getByTestId('quick-options-input').fill('history');
  await page.getByRole('option', { name: /Open history/ }).first().tap();

  const dialog = page.getByRole('dialog', { name: 'History' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-slot="panel-modal-overlay"] [data-slot="panel-header"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('topbar-quick-options-btn')).toBeFocused();
});

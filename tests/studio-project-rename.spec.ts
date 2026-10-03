import { test, expect } from '@playwright/test';

test('13A rename: blank projects default to Untitled, taken names are flagged, success offers Undo', async ({ page }) => {
  const suffix = Date.now();
  const taken = `Taken ${suffix}`;

  await page.goto('/');
  await page.getByTestId('blank-project-name-input').fill(taken);
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await page.getByTestId('breadcrumb-project-btn').click();
  await page.getByTestId('project-menu-all-projects').click();

  // Empty name field creates "Untitled".
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('breadcrumb-project-btn')).toContainText('Untitled');

  // Toggles keep their chevron and the DRAFT badge sits inside the branch toggle.
  const branchToggle = page.getByTestId('breadcrumb-branch-btn');
  await expect(branchToggle.getByTestId('breadcrumb-branch-state')).toBeVisible();
  await expect(page.getByTestId('breadcrumb-project-btn').locator('svg')).toHaveCount(1);
  await expect(branchToggle.locator('svg')).toHaveCount(2);
  const header = page.getByTestId('workspace-topbar');
  expect((await header.boundingBox())?.height).toBe(48);
  await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  // Name taken: popover with the three rows, Enter does not save.
  await page.getByTestId('breadcrumb-project-btn').click();
  await page.getByTestId('project-menu-rename').click();
  const input = page.getByTestId('project-title-input');
  await input.fill(taken.toUpperCase());
  const popover = page.getByTestId('rename-name-taken');
  await expect(popover).toContainText('Your team already has a project called');
  await expect(popover.getByTestId('rename-save-disabled')).toBeDisabled();
  await input.press('Enter');
  await expect(input).toBeVisible();
  await input.press('Escape');
  await expect(page.getByTestId('breadcrumb-project-btn')).toContainText('Untitled');
  await expect(popover).toHaveCount(0);

  // Success: saved notice, then Undo restores the old name.
  await page.getByTestId('breadcrumb-project-btn').click();
  await page.getByTestId('project-menu-rename').click();
  await page.getByTestId('project-title-input').fill(`Renamed ${suffix}`);
  await page.getByTestId('project-title-input').press('Enter');
  await expect(page.getByTestId('rename-saved')).toContainText(`Renamed to Renamed ${suffix}`);
  await page.getByTestId('rename-undo').click();
  await expect(page.getByTestId('breadcrumb-project-btn')).toContainText('Untitled');
});

test('14A quick options search matches whole words', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('blank-project-name-input').fill(`Search ${Date.now()}`);
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await page.getByTestId('topbar-quick-options-btn').click();
  await page.getByTestId('quick-options-input').fill('note');
  await expect(page.getByTestId('quick-option-canvas.add-note')).toBeVisible();
  await expect(page.locator('[data-testid^="quick-option-"][data-command-id]')).toHaveCount(1);
});

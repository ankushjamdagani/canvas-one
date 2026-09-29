import { expect, test } from '@playwright/test';

test('dock customization reorders, hides, restores and persists across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-example-s05').click();
  const workspace = page.getByTestId('workspace-root');
  await expect(workspace).toHaveAttribute('data-dock-preference-state', 'ready');
  const dock = page.getByTestId('canvas-floating-dock');
  await expect(dock.getByTestId('dock-note-btn')).toBeVisible();

  await dock.getByTestId('dock-more-btn').click();
  await page.getByRole('button', { name: 'Customize dock…' }).click();
  const tray = page.getByTestId('dock-customize-tray');
  await expect(tray).toBeVisible();
  await tray.getByRole('button', { name: 'Move Add note… left' }).click();
  await expect(workspace).toHaveAttribute('data-dock-preference-state', 'ready');
  await expect(tray.getByTestId('dock-customize-canvas.add-note')).toBeVisible();
  await tray.getByRole('button', { name: 'Hide Add note…' }).click();
  await expect(workspace).toHaveAttribute('data-dock-preference-state', 'ready');
  await expect(dock.getByTestId('dock-note-btn')).toHaveCount(0);
  await page.reload();
  const project = page.getByTestId('existing-projects-list').locator('[data-testid^="project-item-"]').first();
  await project.getByRole('button', { name: 'Open draft' }).click();
  await expect(workspace).toHaveAttribute('data-dock-preference-state', 'ready');
  await expect(dock.getByTestId('dock-note-btn')).toHaveCount(0);

  await page.getByTestId('topbar-quick-options-btn').click();
  await page.getByTestId('quick-options-input').fill('Add note');
  await expect(page.getByTestId('quick-option-canvas.add-note')).toBeVisible();
  await page.keyboard.press('Escape');

  await dock.getByTestId('dock-more-btn').click();
  await page.getByRole('button', { name: 'Customize dock…' }).click();
  await page.getByRole('button', { name: 'Restore defaults' }).last().click();
  await expect(workspace).toHaveAttribute('data-dock-preference-state', 'ready');
  await expect(dock.getByTestId('dock-note-btn')).toBeVisible();

  await page.getByTestId('dock-available-history.open').dragTo(dock);
  await expect(workspace).toHaveAttribute('data-dock-preference-state', 'ready');
  await expect(dock.getByTestId('dock-history.open')).toBeVisible();
});

test('narrow dock keeps primary tools and puts the rest in touch sized overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('create-example-s05').click();
  const dock = page.getByTestId('canvas-floating-dock');
  await expect(dock.getByTestId('dock-select-btn')).toBeVisible();
  await expect(dock.getByTestId('dock-pan-btn')).toBeVisible();
  await expect(dock.getByTestId('dock-component-btn')).toBeVisible();
  await expect(dock.getByTestId('dock-note-btn')).toBeHidden();
  await dock.getByTestId('dock-more-btn').click();
  const note = page.getByTestId('dock-overflow-canvas.add-note');
  await expect(note).toBeVisible();
  expect((await note.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await note.click();
  await page.getByTestId('dock-note-input').fill('Mobile note');
  await page.getByTestId('dock-note-input').press('Enter');
  await expect(page.locator('.note-card', { hasText: 'Mobile note' })).toBeVisible();
});

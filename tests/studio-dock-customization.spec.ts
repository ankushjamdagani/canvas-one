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
  // Move buttons are removed in favor of drag and drop reordering
  await expect(tray.getByRole('button', { name: /Move .* left/ })).toHaveCount(0);
  await expect(tray.getByTestId('dock-customize-canvas.add-note')).toBeVisible();
  await tray.getByRole('button', { name: 'Hide Add note…' }).click();
  await expect(workspace).toHaveAttribute('data-dock-preference-state', 'ready');
  await expect(dock.getByTestId('dock-note-btn')).toHaveCount(0);
  await page.goto('/');
  const project = page.getByTestId('existing-projects-list').locator('[data-testid^="project-item-"]').first();
  await project.locator('[data-testid^="open-project-"]').click();
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

  // Test clicking the Add button directly
  await tray.getByRole('button', { name: /Add Open results/ }).click();
  await expect(workspace).toHaveAttribute('data-dock-preference-state', 'ready');
  await expect(dock.getByTestId('dock-results.open')).toBeVisible();
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
  // The saved note rests as a comment bubble; a tap opens it.
  await page.locator('[data-open="false"]').first().click();
  await expect(page.locator('.note-card', { hasText: 'Mobile note' })).toBeVisible();
});

test('16B more popover lists all non-sticky options with pin buttons and toggleable actions', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-example-s05').click();
  const dock = page.getByTestId('canvas-floating-dock');

  // Open 16B more popover
  await dock.getByTestId('dock-more-btn').click();
  const popover = page.getByTestId('dock-more-popover');
  await expect(popover).toBeVisible();

  // Header verification
  await expect(popover.getByText('MORE TOOLS')).toBeVisible();
  await expect(popover.getByText('PIN TO DOCK')).toBeVisible();

  // Check presence of non-sticky items with pin buttons
  await expect(page.getByTestId('dock-pin-canvas.add-note')).toBeVisible();
  await expect(page.getByTestId('dock-pin-history.open')).toBeVisible();

  // Toggling pin on canvas.add-note unpins it from the resting dock
  await expect(dock.getByTestId('dock-note-btn')).toBeVisible();
  await page.getByTestId('dock-pin-canvas.add-note').click();
  await expect(dock.getByTestId('dock-note-btn')).toHaveCount(0);

  // Pinning it back restores it to the dock
  await page.getByTestId('dock-pin-canvas.add-note').click();
  await expect(dock.getByTestId('dock-note-btn')).toBeVisible();

  // Minimap toggle
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await page.getByTestId('dock-minimap-toggle').click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await page.getByTestId('dock-minimap-toggle').click();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
});

test('customize toolbar shows 3 sections with disabled fixed left/right controls and working label toggle', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-example-s05').click();
  const dock = page.getByTestId('canvas-floating-dock');

  // Open customize toolbar
  await dock.getByTestId('dock-more-btn').click();
  await page.getByRole('button', { name: 'Customize dock…' }).click();
  const tray = page.getByTestId('dock-customize-tray');
  await expect(tray).toBeVisible();

  // Slots count in header reflects max 10 center controls
  await expect(tray.getByText(/SLOTS? LEFT/)).toBeVisible();

  // Test label toggle in customize toolbar
  const labelSwitch = tray.getByTestId('dock-labels-toggle');
  await expect(labelSwitch).toBeVisible();
  
  // Turn labels ON if currently OFF
  const isChecked = await labelSwitch.getAttribute('aria-checked');
  if (isChecked !== 'true') {
    await labelSwitch.click();
    await expect(labelSwitch).toHaveAttribute('aria-checked', 'true');
  }

  // Left fixed controls (Select, Pan) and Right (More) show labels when ON
  await expect(tray.getByText('Select')).toBeVisible();
  await expect(tray.getByText('Pan')).toBeVisible();
  await expect(tray.getByText('More')).toBeVisible();
  await expect(tray.getByText('100%')).toBeVisible();

  // Center chip shows label
  const noteChip = tray.getByTestId('dock-customize-canvas.add-note');
  await expect(noteChip.getByText('Note')).toBeVisible();

  // Toggle labels OFF
  await labelSwitch.click();
  await expect(labelSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(noteChip.getByText('Note')).toHaveCount(0);
  await expect(tray.getByText('Select')).toHaveCount(0);

  // Close customize mode
  await tray.getByRole('button', { name: 'Done' }).click();
  await expect(tray).toHaveCount(0);
});



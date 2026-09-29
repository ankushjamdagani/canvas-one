import { test, expect } from '@playwright/test';

// RV-03q: 14A Quick options over the command registry (commands.md §1).
test.describe('Studio Quick options (RV-03q)', () => {
  test('button and F2 open it; search, nested rename, branch switch and registry undo', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('DRAFT');

    // Top-bar button opens the dialog; the key hint is F2, never ⌘K.
    const button = page.getByTestId('topbar-quick-options-btn');
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'F2');
    await button.click();
    const dialog = page.getByTestId('quick-options');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('quick-options-context')).toContainText('S05 Fullstack');
    for (const group of ['project', 'branch', 'run', 'review', 'export', 'edit']) {
      await expect(page.getByTestId(`quick-options-group-${group}`)).toBeVisible();
    }
    for (const excluded of ['⌘K', 'Duplicate project', 'Project settings', 'New branch from here']) {
      await expect(dialog.getByText(excluded)).toHaveCount(0);
    }
    // Disabled rows stay visible with their reason.
    await expect(page.getByTestId('quick-option-edit.undo')).toContainText('Nothing to undo');

    // Escape closes; F2 on the canvas reopens.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('F2');
    await expect(dialog).toBeVisible();

    // Search filters rows.
    const input = page.getByTestId('quick-options-input');
    await input.fill('mermaid');
    await expect(page.getByTestId('quick-option-export.mermaid')).toBeVisible();
    await expect(page.getByTestId('quick-option-history.open')).toHaveCount(0);

    // Nested rename: Escape goes back to the list, Enter renames.
    await input.fill('rename');
    await page.keyboard.press('Enter');
    const renameInput = page.getByTestId('quick-options-rename-input');
    await expect(renameInput).toHaveValue('S05 Fullstack');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('quick-options-list')).toBeVisible();
    await input.fill('rename');
    await page.keyboard.press('Enter');
    await renameInput.fill('Checkout path v2');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('breadcrumb-project-btn')).toHaveText('Checkout path v2');
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    // Registry undo shortcut: a node move is undone by Mod+Z.
    await page.waitForTimeout(400);
    const node = page.locator('.component-node').first();
    const before = await node.boundingBox();
    expect(before).not.toBeNull();
    await page.mouse.move(before!.x + 30, before!.y + 20);
    await page.mouse.down();
    await page.mouse.move(before!.x + 150, before!.y + 100, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId('dock-undo-btn')).toBeEnabled();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('dock-undo-btn')).toBeDisabled();
    await expect(page.getByTestId('dock-redo-btn')).toBeEnabled();
    // Mod+Shift+Z redoes through the same registry path.
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.getByTestId('dock-undo-btn')).toBeEnabled();
    await expect(page.getByTestId('dock-redo-btn')).toBeDisabled();

    // Branch switch from Quick options: current row is marked, main switches.
    await page.keyboard.press('F2');
    await expect(page.getByTestId('quick-options-group-branch')).toContainText('CURRENT');
    await page.getByTestId('quick-options-input').fill('main');
    const mainRow = page.locator('[data-command-id="branch.switch"]', { hasText: 'MAIN' });
    await mainRow.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('MAIN');
  });

  test('panel close, results close and cancel-run rows route through the registry', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');

    // Close rows exist only for surfaces that are open.
    await page.keyboard.press('F2');
    await expect(page.getByTestId('quick-option-history.close')).toHaveCount(0);
    await expect(page.getByTestId('quick-option-run.cancel')).toHaveCount(0);
    await page.getByTestId('quick-options-input').fill('open history');
    await page.getByTestId('quick-option-history.open').click();
    const historyPanel = page.locator('[data-panel-id="history"]');
    await expect(historyPanel).toBeVisible();

    // Quick options closes it again (history.close), reopened for the header X.
    await page.keyboard.press('F2');
    await page.getByTestId('quick-option-history.close').click();
    await expect(page.locator('[data-panel-id="history"]')).toHaveCount(0);
    await page.getByTestId('topbar-history-btn').click();
    await expect(historyPanel).toBeVisible();
    await page.locator('[data-slot="panel-close-button"]').first().click();
    await expect(page.locator('[data-panel-id="history"]')).toHaveCount(0);

    // A scenario is selected in S05, so the results region is on screen and
    // results.close hides it; results.open brings it back.
    await expect(page.getByRole('region', { name: 'Results' }).or(page.getByLabel('Results')).first()).toBeVisible();
    await page.keyboard.press('F2');
    await page.getByTestId('quick-option-results.close').click();
    await expect(page.getByLabel('Results')).toHaveCount(0);
    await page.keyboard.press('F2');
    await expect(page.getByTestId('quick-option-results.close')).toHaveCount(0);
    await page.getByTestId('quick-option-results.open').click();
    await expect(page.getByLabel('Results').first()).toBeVisible();
  });
});

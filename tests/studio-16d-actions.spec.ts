import { expect, test, type Page } from '@playwright/test';

/**
 * Board 16D overflow menu (commands.md "Selection-scoped actions", D46): Save as
 * component, Replace part…, Add flow probe, Changes on this part, Export selection.
 */

async function openExample(page: Page, id: 's04' | 's05') {
  await page.goto('/');
  await page.getByTestId(`create-example-${id}`).click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

const node = (page: Page, label: string) => page.locator('.component-node', { hasText: new RegExp(`^${label}`) }).first();

test.describe('16D selection overflow menu', () => {
  test('lists the board actions and shows why one is unavailable', async ({ page }) => {
    await openExample(page, 's04');
    await node(page, 'A').click();
    await node(page, 'B').click({ modifiers: ['Shift'] });
    await page.getByTestId('selection-overflow-btn').click();
    const menu = page.getByRole('menu');
    for (const label of ['Save as component', 'Replace part…', 'Add flow probe', 'Changes on this part', 'Export selection']) {
      await expect(menu.getByText(label, { exact: true })).toBeVisible();
    }
    const replace = page.getByTestId('selection-overflow-selection-replace-part');
    await expect(replace).toHaveAttribute('data-disabled', '');
    await expect(replace).toContainText('Select exactly one component to replace');
  });

  test('replace part previews the change, applies it, and undoes in one step', async ({ page }) => {
    await openExample(page, 's04');
    await node(page, 'A').click();
    await page.getByTestId('selection-overflow-btn').click();
    await page.getByTestId('selection-overflow-selection-replace-part').click();
    const dialog = page.getByTestId('replace-part-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-entry-id="service"]').dblclick();
    await expect(dialog.getByTestId('replace-part-preview')).toBeVisible();
    await dialog.getByTestId('replace-part-confirm').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
    // The catalog service entry (2 000 /s per slot) replaced A (10 /s), keeping its label.
    await expect(node(page, 'A')).toContainText('2 000 /s cap');

    await page.getByTestId('canvas-container').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
    await expect(node(page, 'A')).toContainText('10 /s cap');
  });

  test('add flow probe opens the scenario editor with the new check expanded and unsaved', async ({ page }) => {
    await openExample(page, 's04');
    await node(page, 'A').click();
    await page.getByTestId('selection-overflow-btn').click();
    await page.getByTestId('selection-overflow-selection-add-probe').click();
    const editor = page.getByTestId('scenario-editor');
    await expect(editor).toBeVisible();
    await expect(editor.getByRole('button', { expanded: true })).toHaveCount(1);
    await expect(page.getByTestId('canvas-run-waits-notice')).toBeVisible();
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(editor).toHaveCount(0);
  });

  test('changes on this part filters History with a clearable chip', async ({ page }) => {
    await openExample(page, 's05');
    await page.locator('.component-node').first().click();
    await page.getByTestId('selection-overflow-btn').click();
    await page.getByTestId('selection-overflow-history-show-changes').click();
    const chip = page.getByTestId('history-filter-chip');
    await expect(chip).toBeVisible();
    await chip.getByRole('button', { name: 'Clear history filter' }).click();
    await expect(chip).toHaveCount(0);
  });

  test('export selection downloads a part file without saving to the Library', async ({ page }) => {
    await openExample(page, 's05');
    await node(page, 'Checkout').click();
    await page.getByTestId('selection-overflow-btn').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('selection-overflow-selection-export').click();
    expect((await download).suggestedFilename()).toBe('checkout.system-studio-part.json');
  });

  test('export explains why a selection cannot be captured', async ({ page }) => {
    await openExample(page, 's04');
    await node(page, 'A').click();
    await page.getByTestId('selection-overflow-btn').click();
    await page.getByTestId('selection-overflow-selection-export').click();
    await expect(page.getByTestId('selection-overflow-error')).toContainText('deployed-on');
  });
});

import { expect, test, type Page } from '@playwright/test';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

test.describe('Studio selection actions and note dock (RV-04e)', () => {
  test('aligns, groups, undoes, and adds a note through registry commands', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const first = page.locator('.component-node').nth(0);
    const second = page.locator('.component-node').nth(1);
    await first.click();
    await second.click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-count')).toHaveText('2 PARTS');

    await page.getByTestId('selection-align-btn').click();
    await page.getByTestId('selection-align-left').click();
    await waitForIdle(page);
    const firstAfterAlign = await first.boundingBox();
    const secondAfterAlign = await second.boundingBox();
    expect(firstAfterAlign).not.toBeNull();
    expect(secondAfterAlign).not.toBeNull();
    expect(Math.abs(firstAfterAlign!.x - secondAfterAlign!.x)).toBeLessThan(0.5);

    await page.getByTestId('selection-group-btn').click();
    const groupInput = page.getByTestId('selection-group-input');
    await groupInput.fill('Checkout entry');
    await groupInput.press('Enter');
    await waitForIdle(page);
    await expect(page.locator('.group-boundary', { hasText: 'Checkout entry' })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');
    await waitForIdle(page);
    await expect(page.locator('.group-boundary', { hasText: 'Checkout entry' })).toHaveCount(0);

    await page.getByTestId('dock-note-btn').click();
    const noteInput = page.getByTestId('dock-note-input');
    await noteInput.fill('Watch the payment retry budget');
    await noteInput.press('Enter');
    await waitForIdle(page);
    await expect(page.locator('.note-card', { hasText: 'Watch the payment retry budget' })).toBeVisible();
  });

  test('Delete key and Quick options delete the selection through the registry', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    // "Checkout" is referenced by S05's scenarios, so every delete path shows
    // the dependency confirmation first (deletePlan.ts).
    const checkout = page.locator('.component-node', { hasText: 'Checkout' });
    await checkout.click();
    await expect(page.getByTestId('selection-count')).toHaveText('1 PART');

    // Quick options lists the registry command with its key hint and runs it.
    await page.getByTestId('topbar-quick-options-btn').click();
    const row = page.getByTestId('quick-option-selection.delete');
    await expect(row).toContainText('Delete selection');
    await expect(row).toContainText('Delete');
    await row.click();
    await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
    await expect(checkout).toHaveCount(1);

    // Delete and Backspace on canvas focus take the same command.
    for (const key of ['Delete', 'Backspace']) {
      await checkout.click();
      await page.keyboard.press(key);
      await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
      await expect(checkout).toHaveCount(1);
    }

    // Editable fields never delete: typing Backspace in the note input is native.
    await page.getByTestId('dock-note-btn').click();
    const noteInput = page.getByTestId('dock-note-input');
    await noteInput.fill('abc');
    await noteInput.press('Backspace');
    await expect(noteInput).toHaveValue('ab');
    await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
  });

  test('wraps two nodes in a refinement boundary and restores them with one undo', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const queue = page.locator('.component-node', { hasText: 'Fulfillment queue' });
    const worker = page.locator('.component-node', { hasText: 'Fulfillment worker' });
    await queue.click();
    await worker.click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-count')).toHaveText('2 PARTS');

    await page.getByTestId('selection-wrap-btn').click();
    const input = page.getByTestId('selection-wrap-input');
    await input.fill('Async fulfilment');
    await input.press('Enter');
    await waitForIdle(page);

    const frame = page.getByTestId(/boundary-frame-/).filter({ hasText: 'Async fulfilment' });
    await expect(frame).toBeVisible();
    await expect(queue).toBeVisible();
    await expect(worker).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');
    await waitForIdle(page);
    await expect(frame).toHaveCount(0);
    await expect(queue).toBeVisible();
    await expect(worker).toBeVisible();
  });
});

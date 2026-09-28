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
});

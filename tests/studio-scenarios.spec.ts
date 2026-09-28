import { expect, test } from '@playwright/test';

test.describe('Studio scenario authoring (RV-05d)', () => {
  test('opens stored logical replies with guards, bindings, paths, and draggable steps', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s01').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    await page.getByTestId('scenario-switcher-trigger').click();
    const popover = page.getByTestId('scenario-switcher-popover');
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: /^Edit / }).click();

    const editor = page.getByTestId('scenario-editor');
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('scenario-section-steps')).toBeVisible();
    await expect(editor.locator('[aria-label^="Drag step "]').first()).toHaveAttribute('draggable', 'true');
    await expect(editor.getByRole('button', { name: 'Move step down' }).first()).toBeVisible();

    const boundaries = editor.getByTestId('scenario-section-boundaries');
    await expect(boundaries).toContainText('Match condition');
    await expect(boundaries).toContainText('Payload bindings');
    await expect(boundaries).toContainText('From request');
    await expect(boundaries).toContainText('Into response');

    await boundaries.getByRole('button', { name: 'Add reply' }).click();
    await expect(boundaries.getByLabel('Reply source')).toBeVisible();
    await expect(boundaries.getByRole('button', { name: 'Add reply' }).last()).toBeDisabled();

    const name = editor.getByLabel('Scenario name');
    await name.fill(`${await name.inputValue()} revised`);
    const apply = editor.getByTestId('scenario-editor-apply');
    await expect(apply).toBeEnabled();
    const guardOperator = boundaries.getByLabel('Guard operator').first();
    await guardOperator.selectOption((await guardOperator.inputValue()) === 'equals' ? 'exists' : 'equals');
    await expect(apply).toBeDisabled();

    const visibleText = (await editor.textContent()) ?? '';
    expect(visibleText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });
});

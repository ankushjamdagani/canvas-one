import { expect, test } from './fixtures';

test.describe('Studio scenario authoring', () => {
  test('opens stored logical replies with guards, bindings, paths, and draggable steps', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('create-example-s01').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    await page.getByTestId('scenario-switcher-trigger').click();
    const popover = page.getByTestId('scenario-switcher-popover');
    await expect(popover).toBeVisible();
    await popover.locator('[data-selected="true"]').getByRole('button', { name: /^Edit scenario/ }).click();

    const editor = page.getByTestId('scenario-editor');
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('scenario-section-steps')).toBeVisible();
    await editor.getByTestId('scenario-section-steps').getByRole('button', { expanded: false }).first().click();
    await expect(editor.locator('[aria-label^="Drag step "]').first()).toHaveAttribute('draggable', 'true');
    await expect(editor.getByRole('button', { name: 'Move step down' }).first()).toBeVisible();

    const boundaries = editor.getByTestId('scenario-section-boundaries');
    await boundaries.getByRole('button', { expanded: false }).first().click();
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

  test('editing traffic tags the entry node and says Run waits for Apply or Cancel (board scenario_traffic_editor)', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await page.getByTestId('scenario-switcher-trigger').click();
    await page.getByTestId('scenario-switcher-popover').locator('[data-selected="true"]').getByRole('button', { name: /^Edit scenario/ }).click();
    const editor = page.getByTestId('scenario-editor');
    await expect(editor).toBeVisible();
    await expect(page.locator('[data-testid^="node-traffic-entry-"]')).toHaveCount(0);
    await expect(page.getByTestId('canvas-run-waits-notice')).toHaveCount(0);

    await editor.getByRole('button', { name: /Add traffic/ }).click();
    await expect(page.locator('[data-testid^="node-traffic-entry-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="node-traffic-entry-"]')).toHaveText(/traffic enters here/i);
    await expect(page.getByTestId('canvas-run-waits-notice')).toBeVisible();

    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('canvas-run-waits-notice')).toHaveCount(0);
    await expect(page.locator('[data-testid^="node-traffic-entry-"]')).toHaveCount(0);
  });

  test('traffic can burst; the burst fields start empty and must be filled', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await page.getByTestId('scenario-switcher-trigger').click();
    await page.getByTestId('scenario-switcher-popover').locator('[data-selected="true"]').getByRole('button', { name: /^Edit scenario/ }).click();
    const editor = page.getByTestId('scenario-editor');
    await editor.getByRole('button', { name: /Add traffic/ }).click();
    await editor.getByLabel('Sends').selectOption('stream');

    const shape = editor.getByTestId('traffic-profile-kind');
    await expect(shape).toHaveValue('steady');
    await shape.selectOption('burst');
    for (const id of ['traffic-burst-peak', 'traffic-burst-start', 'traffic-burst-end']) {
      await expect(editor.getByTestId(id)).toHaveValue('');
    }
    await expect(editor).toContainText('Enter the burst rate, start and end');
    await editor.getByTestId('traffic-burst-peak').fill('50');
    await editor.getByTestId('traffic-burst-start').fill('1000');
    await editor.getByTestId('traffic-burst-end').fill('2000');
    await expect(editor).not.toContainText('Enter the burst rate, start and end');
    await page.screenshot({ path: test.info().outputPath('d50-burst.png') });

    await shape.selectOption('ramp');
    await expect(editor.getByTestId('traffic-ramp-end')).toHaveValue('');
    await expect(editor).toContainText('Enter the ramp end rate');
    await editor.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a boundary reply can answer every matching request; the choice is saved', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('create-example-s01').click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    const openEditor = async () => {
      await page.getByTestId('scenario-switcher-trigger').click();
      await page.getByTestId('scenario-switcher-popover').locator('[data-selected="true"]').getByRole('button', { name: /^Edit scenario/ }).click();
      const editor = page.getByTestId('scenario-editor');
      await expect(editor).toBeVisible();
      const boundaries = editor.getByTestId('scenario-section-boundaries');
      await boundaries.getByRole('button', { expanded: false }).first().click();
      return { editor, answers: boundaries.getByTestId('boundary-response-repeat').first() };
    };

    const first = await openEditor();
    await expect(first.answers).toHaveValue('once');
    await first.answers.selectOption('every');
    const apply = first.editor.getByTestId('scenario-editor-apply');
    await expect(apply).toBeEnabled();
    await apply.click();
    // The editor stays open after Apply; the draft is clean again.
    await expect(apply).toBeDisabled();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await page.getByRole('button', { name: 'Close details panel', exact: true }).click();
    await expect(first.editor).toBeHidden();

    const second = await openEditor();
    await expect(second.answers).toHaveValue('every');
  });
});

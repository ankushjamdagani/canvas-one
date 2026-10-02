import { expect, test, type Page } from '@playwright/test';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

async function expectHeaderBelowTopBar(page: Page, name: string) {
  await expect
    .poll(async () => {
      const bar = await page.getByTestId('workspace-topbar').boundingBox();
      const toggle = await page.getByRole('button', { name }).boundingBox();
      return bar && toggle ? toggle.y - (bar.y + bar.height) : -Infinity;
    })
    .toBeGreaterThanOrEqual(0);
}

test.describe('Studio canvas collapse and expand (RV-04g)', () => {
  test('collapses a group, undoes, redoes and persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const nodes = page.locator('.component-node');
    const total = await nodes.count();
    await nodes.nth(0).click();
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await page.getByTestId('selection-group-btn').click();
    const groupInput = page.getByTestId('selection-group-input');
    await groupInput.fill('Entry pair');
    await groupInput.press('Enter');
    await waitForIdle(page);
    const boundary = page.locator('.group-boundary', { hasText: 'Entry pair' });
    await expect(boundary).toBeVisible();

    // Boundary header toggle collapses the group. RV-13a: the header must sit below the top bar
    // without any fit gesture first.
    await expectHeaderBelowTopBar(page, 'Collapse group Entry pair');
    await page.getByRole('button', { name: 'Collapse group Entry pair' }).click();
    await waitForIdle(page);
    await expect(nodes).toHaveCount(total - 2);
    await expect(boundary).toHaveAttribute('data-collapsed', 'true');
    await expect(boundary).toContainText('2 parts');

    // Undo restores the expanded boundary and member nodes; redo collapses again.
    await page.keyboard.press('ControlOrMeta+z');
    await waitForIdle(page);
    await expect(nodes).toHaveCount(total);
    await expect(boundary).not.toHaveAttribute('data-collapsed', 'true');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await waitForIdle(page);
    await expect(nodes).toHaveCount(total - 2);

    // Persisted state survives a reload.
    await page.reload();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await page
      .getByTestId('existing-projects-list')
      .locator('[data-testid^="project-item-"]')
      .first()
      .getByRole('button', { name: 'Open draft' })
      .click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.locator('.component-node')).toHaveCount(total - 2);
    const reloaded = page.locator('.group-boundary', { hasText: 'Entry pair' });
    await expect(reloaded).toHaveAttribute('data-collapsed', 'true');

    // Expand again from the boundary toggle (also reachable straight after reload).
    await expectHeaderBelowTopBar(page, 'Expand group Entry pair');
    await page.getByRole('button', { name: 'Expand group Entry pair' }).click();
    await waitForIdle(page);
    await expect(page.locator('.component-node')).toHaveCount(total);
  });

  test('toggles a single component from the node card expand toggle', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const node = page.locator('.component-node').first();
    const ports = node.locator('[data-testid^="node-ports-"]');
    const toggle = node.getByTestId(/node-expand-toggle-/);
    await expect(ports).toHaveCount(0);
    await toggle.click();
    await waitForIdle(page);
    await expect(ports).toHaveCount(1);
    await toggle.click();
    await waitForIdle(page);
    await expect(ports).toHaveCount(0);
  });

  test('a group frame grows to contain an expanded member (measured heights, not the 76px estimate)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);

    const nodes = page.locator('.component-node');
    await nodes.nth(0).click();
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await page.getByTestId('selection-group-btn').click();
    await page.getByTestId('selection-group-input').fill('Measured pair');
    await page.getByTestId('selection-group-input').press('Enter');
    await waitForIdle(page);
    const boundary = page.locator('.group-boundary', { hasText: 'Measured pair' });
    await expect(boundary).toBeVisible();

    const member = nodes.nth(0);
    await member.getByTestId(/node-expand-toggle-/).click();
    await waitForIdle(page);
    await expect(member.locator('[data-testid^="node-ports-"]')).toHaveCount(1);

    // The expanded card is taller than the estimate, and the frame still encloses it.
    const zoom = await page.evaluate(() => {
      const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null;
      return viewport ? new DOMMatrix(getComputedStyle(viewport).transform).a : 1;
    });
    const cardHeight = (await member.boundingBox())!.height / zoom;
    expect(cardHeight).toBeGreaterThan(76);
    await expect
      .poll(async () => {
        const frame = (await boundary.boundingBox())!;
        const card = (await member.boundingBox())!;
        return frame.y + frame.height - (card.y + card.height);
      })
      .toBeGreaterThan(0);
  });
});

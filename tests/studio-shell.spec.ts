import { test, expect } from '@playwright/test';

test.describe('Studio Shell E2E', () => {
  test('full user journey: boot, S01 example, drag node, undo/redo, branch resolution reload, blank project, rename, reload persistence, responsive', async ({
    page,
  }) => {
    // 1. Boot -> entry lists nothing
    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await expect(page.getByTestId('no-projects-notice')).toBeVisible();
    await expect(page.getByTestId('no-projects-notice')).toContainText('No saved projects yet');

    // 2. Create S01 example -> workspace shows its placed nodes and edges
    const s01CreateBtn = page.getByTestId('create-example-s01');
    await expect(s01CreateBtn).toBeVisible();
    await s01CreateBtn.click();

    // Verify lands in workspace
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('project-title-input')).toHaveValue('S01 Checkout');
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    // Placed nodes in S01: Checkout (state-machine) and Order boundary (thirdparty)
    const checkoutNode = page.locator('.component-node', { hasText: 'Checkout' });
    const orderBoundaryNode = page.locator('.component-node', { hasText: 'Order boundary' });
    await expect(checkoutNode).toBeVisible();
    await expect(orderBoundaryNode).toBeVisible();
    await expect(checkoutNode).toContainText('state-machine');
    await expect(orderBoundaryNode).toContainText('thirdparty');

    // RV-04c / D35: state-machine has no assigned layer -> neutral (no kind stripe)
    await expect(checkoutNode.locator('.node-category-strip')).toHaveCount(0);
    // thirdparty is operations layer -> has kind stripe
    await expect(orderBoundaryNode.locator('.node-category-strip')).toHaveCount(1);

    // Edge must be visible
    await expect(page.locator('.react-flow__edge').first()).toBeVisible();

    // 3. Drag a node -> Saved, undo -> back, redo
    const initialBox = await checkoutNode.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialX = initialBox!.x;
    const initialY = initialBox!.y;

    // Drag node by +120px X and +60px Y
    await page.mouse.move(initialX + 30, initialY + 30);
    await page.mouse.down();
    await page.mouse.move(initialX + 150, initialY + 90, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);

    const movedBox = await checkoutNode.boundingBox();
    expect(movedBox).not.toBeNull();
    expect(movedBox!.x).toBeGreaterThan(initialX + 50);

    // Verify save status shows Saved
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    // Undo -> back to original position
    const undoBtn = page.getByTestId('topbar-undo-btn');
    await expect(undoBtn).toBeEnabled();
    await undoBtn.click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    const undoneBox = await checkoutNode.boundingBox();
    expect(undoneBox).not.toBeNull();
    expect(Math.abs(undoneBox!.x - initialX)).toBeLessThan(15);

    // Redo -> forward to moved position
    const redoBtn = page.getByTestId('topbar-redo-btn');
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    const redoneBox = await checkoutNode.boundingBox();
    expect(redoneBox).not.toBeNull();
    expect(redoneBox!.x).toBeGreaterThan(initialX + 50);

    // 4. Reload -> each listed project shows its open branches (main and draft)
    await page.reload();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    // S01 Checkout project is listed under existing projects
    const projectList = page.getByTestId('existing-projects-list');
    await expect(projectList).toBeVisible();
    await expect(projectList.getByText('S01 Checkout')).toBeVisible();

    const s01Item = projectList.locator('[data-testid^="project-item-"]', { hasText: 'S01 Checkout' });

    // Item 1: Open main explicitly and see the original position
    const openMainBtn = s01Item.getByRole('button', { name: 'Open main' });
    await expect(openMainBtn).toBeVisible();
    await openMainBtn.click();

    // Workspace opens with original unedited position on main branch
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('project-title-input')).toHaveValue('S01 Checkout');

    const mainCheckoutNode = page.locator('.component-node', { hasText: 'Checkout' });
    await expect(mainCheckoutNode).toBeVisible();
    const mainBox = await mainCheckoutNode.boundingBox();
    expect(mainBox).not.toBeNull();
    expect(Math.abs(mainBox!.x - initialX)).toBeLessThan(15);

    // Back to projects
    await page.getByTestId('projects-back-btn').click();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    // Item 1: Open the draft branch explicitly and see the moved position
    const s01ItemReloaded = page.getByTestId('existing-projects-list').locator('[data-testid^="project-item-"]', { hasText: 'S01 Checkout' });
    const openDraftBtn = s01ItemReloaded.getByRole('button', { name: 'Open draft' });
    await expect(openDraftBtn).toBeVisible();
    await openDraftBtn.click();

    // Workspace opens with persisted moved position on draft branch
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('project-title-input')).toHaveValue('S01 Checkout');

    const draftCheckoutNode = page.locator('.component-node', { hasText: 'Checkout' });
    await expect(draftCheckoutNode).toBeVisible();
    const draftBox = await draftCheckoutNode.boundingBox();
    expect(draftBox).not.toBeNull();
    expect(draftBox!.x).toBeGreaterThan(initialX + 50);

    // 5. Create blank project -> empty-view state
    await page.getByTestId('projects-back-btn').click();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    const blankInput = page.getByTestId('blank-project-name-input');
    await blankInput.fill('My Blank Architecture');
    await page.getByTestId('create-blank-project-btn').click();

    // Lands in workspace with empty-view state
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('project-title-input')).toHaveValue('My Blank Architecture');
    const emptyState = page.getByTestId('empty-views-state');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('This project has no views yet');

    // 6. Rename project
    const titleInput = page.getByTestId('project-title-input');
    await titleInput.click();
    await titleInput.fill('Renamed System Architecture');
    await titleInput.press('Enter');

    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await expect(titleInput).toHaveValue('Renamed System Architecture');

    // Item 8: Reload -> assert renamed title persisted in entry list and workspace
    await page.reload();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    const renamedProjectList = page.getByTestId('existing-projects-list');
    await expect(renamedProjectList).toBeVisible();
    await expect(renamedProjectList.getByText('Renamed System Architecture')).toBeVisible();

    // Open the renamed project's draft branch explicitly
    const renamedItem = renamedProjectList.locator('[data-testid^="project-item-"]', { hasText: 'Renamed System Architecture' });
    const openRenamedDraftBtn = renamedItem.getByRole('button', { name: 'Open draft' });
    await expect(openRenamedDraftBtn).toBeVisible();
    await openRenamedDraftBtn.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('project-title-input')).toHaveValue('Renamed System Architecture');

    // 7. Mobile 390x844 no horizontal scroll
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const hasHorizontalScroll = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        document.body.scrollWidth > window.innerWidth
      );
    });
    expect(hasHorizontalScroll).toBe(false);

    // Also verify Entry screen on mobile has no horizontal scroll
    await page.getByTestId('projects-back-btn').click();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await page.waitForTimeout(300);

    const entryHorizontalScroll = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        document.body.scrollWidth > window.innerWidth
      );
    });
    expect(entryHorizontalScroll).toBe(false);
  });

  test('the S05 workspace at 1512x982 has every placed node fully inside the canvas viewport after open, and at 390x844 every dock button is within the viewport', async ({
    page,
  }) => {
    // 1. Desktop 1512x982: every placed node is fully inside the canvas viewport after open
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    const s05CreateBtn = page.getByTestId('create-example-s05');
    await expect(s05CreateBtn).toBeVisible();
    await s05CreateBtn.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('project-title-input')).toHaveValue('S05 Fullstack');
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    const canvasContainer = page.getByTestId('canvas-container');
    await expect(canvasContainer).toBeVisible();
    const canvasBox = await canvasContainer.boundingBox();
    expect(canvasBox).not.toBeNull();

    // S05 has 9 placed nodes
    const nodes = page.locator('.component-node');
    await expect(nodes).toHaveCount(9);

    // Wait briefly for ReactFlow fitView to settle
    await page.waitForTimeout(400);

    for (let i = 0; i < 9; i++) {
      const node = nodes.nth(i);
      await expect(node).toBeVisible();
      const nodeBox = await node.boundingBox();
      expect(nodeBox).not.toBeNull();
      // Fully inside canvas viewport
      expect(nodeBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
      expect(nodeBox!.y).toBeGreaterThanOrEqual(canvasBox!.y);
      expect(nodeBox!.x + nodeBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width);
      expect(nodeBox!.y + nodeBox!.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height);
    }

    // 2. Mobile 390x844: every dock button is within the viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const dockBtnTestIds = [
      'dock-select-btn',
      'dock-pan-btn',
      'dock-undo-btn',
      'dock-redo-btn',
      'dock-zoom-out-btn',
      'dock-zoom-in-btn',
      'dock-fit-view-btn',
      'dock-run-btn',
      'dock-pause-btn',
      'dock-reset-btn',
    ];

    for (const testId of dockBtnTestIds) {
      const btn = page.getByTestId(testId);
      await expect(btn).toBeVisible();
      const btnBox = await btn.boundingBox();
      expect(btnBox).not.toBeNull();
      // Bounding box within viewport 390x844
      expect(btnBox!.x).toBeGreaterThanOrEqual(0);
      expect(btnBox!.y).toBeGreaterThanOrEqual(0);
      expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(390);
      expect(btnBox!.y + btnBox!.height).toBeLessThanOrEqual(844);
    }
  });
});

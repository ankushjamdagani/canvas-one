import { test, expect } from '@playwright/test';

test.describe('Studio Shell E2E (RV-03s)', () => {
  test('entry two columns, create S05, breadcrumb, project menu rename persists, branch popover switches, drag on main auto-drafts, dock zoom, no rail, mobile no scroll', async ({
    page,
  }) => {
    // 1. Boot -> entry has two columns: "Your projects" + "Open an empty canvas" (left),
    // "Start from a template" (right). No prompt box, no "Bring in what exists".
    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await expect(page.getByTestId('no-projects-notice')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open an empty canvas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start from a template' })).toBeVisible();
    await expect(page.getByTestId('templates-list')).toBeVisible();
    await expect(page.getByText('Describe the system')).toHaveCount(0);
    await expect(page.getByText('Bring in what exists')).toHaveCount(0);

    // 2. Create S05 example -> workspace with the new top bar breadcrumb
    const s05CreateBtn = page.getByTestId('create-example-s05');
    await expect(s05CreateBtn).toBeVisible();
    await s05CreateBtn.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-project-btn')).toHaveText('S05 Fullstack');
    // Newly created projects open their starter draft branch, not main
    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('DRAFT');
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    // No permanent left activity rail
    await expect(page.getByTestId('workspace-activity-rail')).toHaveCount(0);

    // 3. Project menu: rename persists after reload
    await page.getByTestId('breadcrumb-project-btn').click();
    await expect(page.getByTestId('project-menu-popover')).toBeVisible();
    await expect(page.getByTestId('project-menu-popover')).toContainText('branches');
    await page.getByTestId('project-menu-rename').click();

    const titleInput = page.getByTestId('project-title-input');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('Renamed Fullstack System');
    await titleInput.press('Enter');

    await expect(page.getByTestId('breadcrumb-project-btn')).toHaveText('Renamed Fullstack System');
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    // Reload returns to the entry screen (session state is in-memory only);
    // the rename is durable there.
    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    const renamedItem = page
      .getByTestId('existing-projects-list')
      .locator('[data-testid^="project-item-"]', { hasText: 'Renamed Fullstack System' });
    await expect(renamedItem).toBeVisible();
    await renamedItem.getByRole('button', { name: 'Open draft' }).click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-project-btn')).toHaveText('Renamed Fullstack System');
    // Let the mount-time camera fit (fitView prop + the 50ms fit effect,
    // both clamped to maxZoom 1) settle before reading node positions below.
    await page.waitForTimeout(400);

    // 4. Branch popover lists main + draft, and switching works
    await page.getByTestId('breadcrumb-branch-btn').click();
    await expect(page.getByTestId('branch-popover')).toBeVisible();
    await expect(page.getByTestId('branch-current-row')).toBeVisible();
    const switchList = page.getByTestId('branch-switch-list');
    await expect(switchList).toBeVisible();
    await expect(switchList.getByText('main')).toBeVisible();

    const mainSwitchBtn = switchList.locator('[data-testid^="branch-switch-"]', { hasText: 'main' });
    await mainSwitchBtn.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('MAIN');

    // 5. Drag a node while on main -> D40 auto-drafts a new branch; main unchanged
    const node = page.locator('.component-node').first();
    await expect(node).toBeVisible();
    const initialBox = await node.boundingBox();
    expect(initialBox).not.toBeNull();

    await page.mouse.move(initialBox!.x + 30, initialBox!.y + 20);
    await page.mouse.down();
    await page.mouse.move(initialBox!.x + 140, initialBox!.y + 90, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('DRAFT');
    await expect(page.getByTestId('breadcrumb-branch-btn')).toContainText('Draft from main');
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    // Back to projects (via project menu "All projects"), reopen main -> unchanged position
    await page.getByTestId('breadcrumb-project-btn').click();
    await page.getByTestId('project-menu-all-projects').click();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    const projectList = page.getByTestId('existing-projects-list');
    const item = projectList.locator('[data-testid^="project-item-"]', {
      hasText: 'Renamed Fullstack System',
    });
    const openMainBtn = item.getByRole('button', { name: 'Open main' });
    await expect(openMainBtn).toBeVisible();
    await openMainBtn.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('MAIN');
    // Fresh mount here (Workspace/CanvasView were unmounted while on the entry
    // screen) -> let the camera fit settle before reading positions.
    await page.waitForTimeout(400);
    const mainNode = page.locator('.component-node').first();
    const mainBox = await mainNode.boundingBox();
    expect(mainBox).not.toBeNull();
    expect(Math.abs(mainBox!.x - initialBox!.x)).toBeLessThan(15);

    // 6. Dock: undo/redo moved off the top bar, zoom % is live, no run controls
    await expect(page.getByTestId('topbar-undo-btn')).toHaveCount(0);
    await expect(page.getByTestId('dock-run-btn')).toHaveCount(0);
    const zoomValue = page.getByTestId('dock-zoom-value');
    await expect(zoomValue).toBeVisible();
    const initialZoomText = await zoomValue.textContent();

    await page.getByTestId('dock-zoom-in-btn').click();
    await page.waitForTimeout(250);
    const zoomedInText = await zoomValue.textContent();
    expect(zoomedInText).not.toBe(initialZoomText);

    await page.getByTestId('dock-zoom-out-btn').click();
    await page.waitForTimeout(250);

    // 7. Create blank project via "Open an empty canvas" -> D43(a): opens
    //    straight onto its seeded "Main" view (canvas + dock, zero nodes),
    //    not the (now unreachable from this flow) empty-views-state.
    await page.getByTestId('breadcrumb-project-btn').click();
    await page.getByTestId('project-menu-all-projects').click();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    const blankInput = page.getByTestId('blank-project-name-input');
    await blankInput.fill('My Blank Architecture');
    await page.getByTestId('create-blank-project-btn').click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-project-btn')).toHaveText('My Blank Architecture');
    await expect(page.getByTestId('canvas-container')).toBeVisible();
    await expect(page.getByTestId('dock-component-btn')).toBeVisible();
    expect(await page.locator('.component-node').count()).toBe(0);

    // 8. Mobile 390x844: no horizontal scroll, dock fully visible
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const hasHorizontalScrollWorkspace = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        document.body.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalScrollWorkspace).toBe(false);

    await page.getByTestId('breadcrumb-project-btn').click();
    await page.getByTestId('project-menu-all-projects').click();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await page.waitForTimeout(300);

    const hasHorizontalScrollEntry = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        document.body.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalScrollEntry).toBe(false);
  });

  test('the S05 workspace at 1512x982 has every placed node inside the canvas, and at 390x844 the whole dock is visible with 44px touch targets', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    const s05CreateBtn = page.getByTestId('create-example-s05');
    await expect(s05CreateBtn).toBeVisible();
    await s05CreateBtn.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    const canvasContainer = page.getByTestId('canvas-container');
    await expect(canvasContainer).toBeVisible();
    const canvasBox = await canvasContainer.boundingBox();
    expect(canvasBox).not.toBeNull();

    const nodes = page.locator('.component-node');
    await expect(nodes).toHaveCount(9);
    await page.waitForTimeout(400);

    for (let i = 0; i < 9; i++) {
      const node = nodes.nth(i);
      await expect(node).toBeVisible();
      const nodeBox = await node.boundingBox();
      expect(nodeBox).not.toBeNull();
      expect(nodeBox!.x).toBeGreaterThanOrEqual(canvasBox!.x);
      expect(nodeBox!.y).toBeGreaterThanOrEqual(canvasBox!.y);
      expect(nodeBox!.x + nodeBox!.width).toBeLessThanOrEqual(canvasBox!.x + canvasBox!.width);
      expect(nodeBox!.y + nodeBox!.height).toBeLessThanOrEqual(canvasBox!.y + canvasBox!.height);
    }

    // Node card shows a kind icon + real-config caption (never p99/pressure)
    const firstCaption = page.locator('[data-testid^="node-caption-"]').first();
    await expect(firstCaption).toBeVisible();
    const captionText = (await firstCaption.textContent()) ?? '';
    expect(captionText).not.toMatch(/p99|p95|pressure|headroom/i);

    // The narrow dock keeps Select, Pan and Library; the rest are in More.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const dockBtnTestIds = [
      'dock-select-btn',
      'dock-pan-btn',
      'dock-component-btn',
      'dock-more-btn',
    ];

    for (const testId of dockBtnTestIds) {
      const btn = page.getByTestId(testId);
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
      // 44px touch targets on mobile
      expect(box!.height).toBeGreaterThanOrEqual(43);
    }

    await expect(page.getByTestId('dock-zoom-value')).toBeVisible();
    await page.getByTestId('dock-more-btn').click();
    for (const id of ['edit.undo', 'edit.redo']) {
      await expect(page.getByTestId(`dock-overflow-${id}`)).toBeVisible();
    }
    // Zoom and fit are fixed dock controls, not pinnable tools.
    for (const id of ['canvas.zoom-out', 'canvas.zoom-in', 'canvas.fit']) {
      await expect(page.getByTestId(`dock-overflow-${id}`)).toHaveCount(0);
    }
    await expect(page.getByTestId('canvas-floating-dock')).toBeVisible();
  });

  test('RV-12d review round 1: edge labels that would cover a node caption are hidden by default and reveal on hover', async ({
    page,
  }) => {
    await page.goto('/');
    const s05CreateBtn = page.getByTestId('create-example-s05');
    await expect(s05CreateBtn).toBeVisible();
    await s05CreateBtn.click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await page.waitForTimeout(400);

    const edgeGroups = page.locator('[data-testid^="edge-"]:not([data-testid^="edge-label-"])');
    const edgeCount = await edgeGroups.count();
    expect(edgeCount).toBeGreaterThan(0);

    // At least one edge on S05's tightly spaced layout has a label suppressed
    // by default (it would overlap a node rectangle) and reveals it on hover.
    let revealedOnHover = false;
    for (let i = 0; i < edgeCount; i++) {
      const group = edgeGroups.nth(i);
      const path = group.locator('.react-flow__edge-interaction, .react-flow__edge-path').first();
      const box = await path.boundingBox().catch(() => null);
      if (!box) continue;

      const labelsBefore = await page.locator('[data-testid^="edge-label-"]').count();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(150);
      const labelsAfterHover = await page.locator('[data-testid^="edge-label-"]').count();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      if (labelsAfterHover > labelsBefore) {
        revealedOnHover = true;
        break;
      }
    }
    expect(revealedOnHover).toBe(true);
  });
});

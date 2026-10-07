import { expect, test, type Page } from './fixtures';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

/** The Library panel may already be open (the layout is remembered), in which case the dock just focuses it. */
async function openLibrary(page: Page) {
  await page.getByTestId('dock-component-btn').click();
  if (!(await page.getByTestId('library-panel').isVisible())) await page.getByTestId('library-picker-full-library-btn').click();
  await expect(page.getByTestId('library-panel')).toBeVisible();
}

/** A blank project with one service whose HTTP type is exposed (D53: a project must expose a call connection type to be linked). */
async function createExposingProject(page: Page, name: string) {
  await page.goto('/projects');
  await page.getByRole('textbox', { name: 'Blank project name' }).fill(name);
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
  await openLibrary(page);
  const panel = page.getByTestId('library-panel');
  await panel.locator('[data-entry-id="service"]').click();
  await panel.getByRole('button', { name: /Place .* on canvas/ }).click();
  await waitForIdle(page);
  await page.getByTestId('breadcrumb-project-btn').click();
  await page.getByTestId('project-menu-exposed-endpoints').click();
  const dialog = page.getByTestId('exposed-endpoints-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('switch', { name: 'Expose HTTP / REST' }).click();
  await expect(dialog.getByRole('switch', { name: 'Expose HTTP / REST' })).toHaveAttribute('aria-checked', 'true');
  await waitForIdle(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test('a project can be linked into another as a read-only node that shows live details and opens it', async ({ page }) => {
  // Target project with a team and description.
  await createExposingProject(page, 'Orders system');
  await page.getByTestId('breadcrumb-project-btn').click();
  await page.getByTestId('project-menu-settings').click();
  await page.getByTestId('project-team-input').fill('Orders team');
  await page.getByTestId('project-description-input').fill('Takes and fulfils customer orders');
  await page.getByTestId('project-details-save').click();
  await expect(page.getByTestId('project-details-dialog')).toBeHidden();
  await waitForIdle(page);
  await page.getByTestId('breadcrumb-project-btn').click();
  await expect(page.getByTestId('project-menu-popover')).toContainText('Orders team');
  await page.keyboard.press('Escape');

  // Link it from another project through the Library's Projects tab.
  await page.goto('/projects');
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
  await openLibrary(page);
  await page.getByTestId('library-tab-projects').click();
  const row = page.getByTestId('library-linked-projects').locator('li', { hasText: 'Orders system' });
  await expect(row).toContainText('Orders team');
  await row.getByRole('button', { name: 'Link Orders system' }).click();
  await waitForIdle(page);

  const node = page.locator('.component-node', { hasText: 'Orders system' });
  await expect(node).toBeVisible();
  await expect(node.getByTestId(/node-linked-badge-/)).toHaveText('Linked');
  await expect(node.getByTestId(/node-linked-details-/)).toContainText('Orders team');
  await expect(node.getByTestId(/node-linked-details-/)).toContainText('Takes and fulfils customer orders');

  // Expanded, the node lists the endpoints (type and path) it can be connected with.
  await node.getByTestId(/node-expand-toggle-/).click();
  await expect(node.getByTestId(/node-ports-/)).toContainText('in: HTTP / REST');

  // Inspector is read-only for the linked node.
  await node.click();
  await expect(page.getByTestId('inspector-kind-tag')).toHaveText('LINKED PROJECT');
  await expect(page.getByTestId('inspector-panel').locator('input, textarea')).toHaveCount(0);

  // Open navigates to the linked project.
  await node.getByTestId(/node-linked-open-/).click();
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByTestId('breadcrumb-project-btn')).toContainText('Orders system');
});

test('a project can be dragged from the Library onto the canvas, and the logo returns home', async ({ page }) => {
  await createExposingProject(page, 'Billing system');

  // A second project with a service of its own to call from.
  await createExposingProject(page, 'Caller system');
  await openLibrary(page);
  await page.getByTestId('library-tab-projects').click();
  const row = page.getByTestId('library-linked-projects').locator('li', { hasText: 'Billing system' });
  await row.dragTo(page.locator('.react-flow__pane').first(), { targetPosition: { x: 1000, y: 640 } });
  await waitForIdle(page);
  const node = page.locator('.component-node', { hasText: 'Billing system' });
  await expect(node).toBeVisible();

  // Connecting to it offers only the connection types the project exposes (HTTP here), and works.
  const targetHandle = (await node.locator('[data-testid^="node-handle-target-"]').first().getAttribute('data-testid'))!;
  const linkedId = targetHandle.replace('node-handle-target-', '');
  const source = page.locator(`[data-testid^="node-handle-source-"]:not([data-testid="node-handle-source-${linkedId}"])`).first();
  // xyflow can swallow a drag while the layout is still settling after the placement, so retry like the authoring suite.
  for (let attempt = 0; attempt < 3 && (await page.getByTestId('connect-resource-form').count()) === 0; attempt += 1) {
    const s = (await source.boundingBox())!;
    const t = (await page.getByTestId(targetHandle).boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  }
  await expect(page.getByTestId('connect-resource-form')).toBeVisible();
  await expect(page.getByTestId('connect-form-protocol').locator('option')).toHaveText(['HTTP / REST']);
  await page.keyboard.press('Escape');

  // The back button goes to the project list.
  await page.getByTestId('topbar-back').click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('existing-projects-list')).toBeVisible();
});

test('a project that exposes nothing cannot be linked, and the Library says why', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('textbox', { name: 'Blank project name' }).fill('Quiet system');
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();

  await page.goto('/projects');
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
  await openLibrary(page);
  await page.getByTestId('library-tab-projects').click();
  const row = page.getByTestId('library-linked-projects').locator('li', { hasText: 'Quiet system' });
  await expect(row).toContainText('Exposes no call connection type');
  await expect(row.getByRole('button', { name: 'Link Quiet system' })).toBeDisabled();
});

test('the connect form offers a connection type and a service can be connected with gRPC', async ({ page }) => {
  await page.goto('/projects');
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);

  // Drag from the first node's out handle to the target handle of a node that is not yet its callee.
  const handles = page.locator('[data-testid^="node-handle-source-"]');
  const targets = page.locator('[data-testid^="node-handle-target-"]');
  const count = await handles.count();
  let formOpened = false;
  for (let i = 0; i < count && !formOpened; i += 1) {
    for (let j = 0; j < count && !formOpened; j += 1) {
      if (i === j) continue;
      const s = await handles.nth(i).boundingBox();
      const t = await targets.nth(j).boundingBox();
      if (!s || !t) continue;
      await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
      await page.mouse.down();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 });
      await page.mouse.up();
      formOpened = (await page.getByTestId('connect-resource-form').count()) > 0;
      if (!formOpened && (await page.getByTestId('connect-rejected-message').count()) > 0) {
        await page.keyboard.press('Escape');
      }
    }
  }
  expect(formOpened).toBe(true);
  const edgesBefore = await page.locator('.react-flow__edge').count();
  const select = page.getByTestId('connect-form-protocol');
  await expect(select).toBeVisible();
  await expect(select.locator('option[value="grpc"]')).toHaveCount(1);
  await expect(select.locator('option[value="kafka"]')).toHaveCount(0);
  await select.selectOption('grpc');
  await expect(select).toHaveValue('grpc');
  await page.getByTestId('connect-form-path').fill('/orders');
  await page.getByTestId('connect-form-confirm').click();
  await waitForIdle(page);
  await expect(page.locator('.react-flow__edge')).toHaveCount(edgesBefore + 1);
});

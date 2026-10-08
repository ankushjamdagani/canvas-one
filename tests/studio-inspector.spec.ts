import { test, expect } from './fixtures';

// specs/revamp/fixtures/s04.json element ids (stable UUIDs in the fixture).
const ROUTER_ELEMENT_ID = '816fe039-76dd-5b7b-a787-4d7666ff8d62';
const PROCESSOR_A_ELEMENT_ID = 'ec155572-83d4-5ad5-b77a-e26a2eaabdfb';

test.describe('Studio Inspector E2E (RV-05b)', () => {
  test('S04: router capacity draft -- invalid, valid Apply + Undo, dirty Run guard, navigation guard, measured metrics', async ({
    page,
  }) => {
    await page.goto('/projects');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    const routerNode = page.locator(`[data-element-id="${ROUTER_ELEMENT_ID}"]`);
    await expect(routerNode).toBeVisible();
    await routerNode.click();

    const inspector = page.getByTestId('inspector-panel');
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText('Router');
    await expect(page.getByTestId('inspector-kind-tag')).toContainText('Router');

    const capacityInput = page.getByTestId('inspector-field-config.capacity');
    await expect(capacityInput).toBeVisible();

    // Invalid value (out of [1,100000]): Apply shows the error and keeps the draft.
    await capacityInput.fill('999999');
    const applyBtn = page.getByTestId('inspector-apply');
    await applyBtn.click();
    await expect(page.getByTestId('inspector-field-config.capacity-error')).toBeVisible();
    await expect(capacityInput).toHaveValue('999999');

    // Dirty draft: Run is disabled with the exact contract reason.
    const runBtn = page.getByTestId('scenario-run-btn');
    await expect(runBtn).toBeDisabled();
    await runBtn.hover();
    await expect(runBtn).toHaveAttribute('title', 'Apply or Cancel configuration changes before running.');

    // Selecting another node while dirty -> guard dialog. Stay keeps the draft.
    const processorNode = page.locator(`[data-element-id="${PROCESSOR_A_ELEMENT_ID}"]`);
    await processorNode.click();
    const guardDialog = page.getByTestId('inspector-guard-dialog');
    await expect(guardDialog).toBeVisible();
    await page.getByTestId('guard-stay').click();
    await expect(guardDialog).toBeHidden();
    await expect(capacityInput).toHaveValue('999999'); // still the Router's draft

    // Discard switches to the newly clicked node.
    await processorNode.click();
    await expect(guardDialog).toBeVisible();
    await page.getByTestId('guard-discard').click();
    await expect(guardDialog).toBeHidden();
    await expect(inspector).toContainText('A');
    await expect(page.getByTestId('inspector-kind-tag')).toContainText('Processor');

    // Re-select the router and apply a valid capacity.
    await routerNode.click();
    await expect(inspector).toContainText('Router');
    await capacityInput.fill('500');
    await applyBtn.click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await expect(page.getByTestId('inspector-field-config.capacity-error')).toHaveCount(0);
    await expect(runBtn).toBeEnabled();

    // Undo restores the prior capacity value (one undo entry for the whole Apply).
    await page.getByTestId('dock-undo-btn').click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    // Re-open the router draft fresh to see the restored value.
    await page.getByTestId('inspector-close').click();
    await routerNode.click();
    await expect(page.getByTestId('inspector-field-config.capacity')).toHaveValue('10');

    // Run the scenario, then reselect the router: MEASURED shows only available metrics.
    await page.getByTestId('inspector-close').click();
    await routerNode.click();
    await capacityInput.fill('500');
    await applyBtn.click();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    await runBtn.click();
    await expect(page.getByTestId('playback-status')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('inspector-close').click();
    await routerNode.click();
    const measured = page.getByTestId('inspector-measured');
    await expect(measured).toBeVisible();
    // Either real rows or an explicit empty message -- never silently blank.
    const measuredText = (await measured.textContent()) ?? '';
    expect(measuredText.length).toBeGreaterThan(0);
    expect(measuredText).not.toMatch(/TIGHTEST LINK|HEADROOM|p99/i);

    await page.screenshot({
      path: test.info().outputPath('rv05b-desktop-inspector.png'),
    });
  });

  test('390x844: inspector renders as a bottom sheet, usable, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/projects');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();

    const routerNode = page.locator(`[data-element-id="${ROUTER_ELEMENT_ID}"]`);
    await expect(routerNode).toBeVisible();
    await routerNode.click();

    const sheet = page.getByTestId('inspector-sheet-overlay');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('inspector-panel')).toHaveAttribute('data-variant', 'sheet');
    await expect(sheet).toContainText('Router');

    const hasHorizontalScroll = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        document.body.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalScroll).toBe(false);

    await page.screenshot({
      path: test.info().outputPath('rv05b-mobile-sheet.png'),
    });
  });

  test('the inspector is a hosted panel: docks right, floats from its header menu, and closes with the draft', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await page.locator(`[data-element-id="${ROUTER_ELEMENT_ID}"]`).click();

    const dock = page.locator('[data-slot="dock-column"][data-side="right"]');
    await expect(dock.getByTestId('inspector-panel')).toBeVisible();
    await expect(dock.locator('[data-slot="panel-header"]').getByRole('heading', { name: 'Configuration', exact: true })).toBeVisible();

    await dock.locator('[data-slot="panel-menu-trigger"]').click();
    await page.getByRole('menuitem', { name: 'Float' }).click();
    const floating = page.locator('[data-slot="floating-panel"][data-panel-id="inspector"]');
    await expect(floating.getByTestId('inspector-panel')).toBeVisible();
    await expect(page.locator('[data-slot="dock-column"]')).toHaveCount(0);

    await page.getByTestId('inspector-close').click();
    await expect(page.getByTestId('inspector-panel')).toHaveCount(0);
    await expect(floating).toHaveCount(0);
  });
});

import { test, expect } from '@playwright/test';

test.describe('Studio Runs E2E (RV-12d)', () => {
  test('S01: switcher lists Not run yet, Run passes, Run all passes, drag keeps Passed with a stale notice', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    const s01CreateBtn = page.getByTestId('create-example-s01');
    await expect(s01CreateBtn).toBeVisible();
    await s01CreateBtn.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await expect(page.getByTestId('results-region')).toBeVisible();

    // Switcher lists all 3 scenarios, "Not run yet" before any run.
    const switcherTrigger = page.getByTestId('scenario-switcher-trigger');
    await expect(switcherTrigger).toBeVisible();
    await switcherTrigger.click();

    const popover = page.getByTestId('scenario-switcher-popover');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('SCENARIOS · 3');

    const rows = popover.locator('[data-testid^="scenario-row-"]');
    await expect(rows).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(rows.nth(i)).toContainText('Not run yet');
    }

    // Close the popover; the first scenario in document order is selected by default.
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // Run the selected scenario -> strip shows Completed, checks passed, Saved.
    const runBtn = page.getByTestId('scenario-run-btn');
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    await expect(page.getByTestId('results-status-badge')).toContainText('completed', {
      timeout: 15000,
    });
    await expect(page.getByTestId('results-region')).toContainText('Saved');
    const checksTextAfterFirstRun = await page.getByTestId('results-region').textContent();
    expect(checksTextAfterFirstRun ?? '').toMatch(/passed/i);

    // Switcher now shows that scenario Passed.
    await switcherTrigger.click();
    await expect(popover).toBeVisible();
    const firstRow = rows.first();
    await expect(firstRow).toContainText('Passed', { timeout: 5000 });

    // Run all -> all 3 scenarios end up Passed, commit line reflects 3 of 3.
    const runAllBtn = page.getByTestId('scenario-run-all-btn');
    await expect(runAllBtn).toBeEnabled();
    await runAllBtn.click();

    // Reopen popover after each scenario in the sequence to observe progress; poll until
    // all three read Passed (each scenario runs one after another per run.start-all).
    await expect(async () => {
      await switcherTrigger.click().catch(() => {});
      await expect(popover).toBeVisible();
      for (let i = 0; i < 3; i++) {
        await expect(rows.nth(i)).toContainText('Passed on this version');
      }
    }).toPass({ timeout: 30000 });

    await expect(popover.getByTestId('scenario-commit-line')).toContainText('3', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // Drag a node: the scenario's fingerprint is unaffected by view layout (view
    // positions are presentation, outside run-identity.md's fingerprint), so
    // scenarios STAY Passed, but the strip shows the run is on an earlier snapshot.
    const node = page.locator('.component-node').first();
    await expect(node).toBeVisible();
    const box = await node.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 20, box!.y + 15);
    await page.mouse.down();
    await page.mouse.move(box!.x + 90, box!.y + 70, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    await expect(page.getByTestId('results-stale-notice')).toContainText('Ran on an earlier version');

    await switcherTrigger.click();
    await expect(popover).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await expect(rows.nth(i)).toContainText('Passed on this version');
    }
    await page.keyboard.press('Escape');

    // Screenshots for visual comparison against the scenario_switcher.png /
    // 21B_running_simulation_expanded.png screens (desktop).
    await switcherTrigger.click();
    await expect(popover).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('rv12d-desktop-switcher.png'),
    });
    await page.keyboard.press('Escape');

    await page.getByTestId('results-details-toggle').click();
    await expect(page.getByTestId('results-region')).toContainText('General metrics');

    // Checks list shows the assertion's real label from the scenario that
    // ran ("Invalid cart" has "order-command" and "editing"), never
    // "Assertion <uuid>".
    const detailsRegionText = (await page.getByTestId('results-region').textContent()) ?? '';
    expect(detailsRegionText).toMatch(/order-command|editing/);
    expect(detailsRegionText).not.toMatch(/Assertion [0-9a-f-]{8,}/);

    // Event log is fed the controller's buffered trace events, not an empty list.
    await expect(page.getByTestId('results-region')).not.toContainText('No events recorded');
    expect(detailsRegionText).toMatch(/\d+ events recorded/);
    const eventsRecordedMatch = detailsRegionText.match(/(\d+) events recorded/);
    expect(Number(eventsRecordedMatch?.[1] ?? '0')).toBeGreaterThan(0);

    await page.screenshot({
      path: test.info().outputPath('rv12d-desktop-details.png'),
    });
  });

  test('S04: Run all completes every scenario with real measured counts', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    const s04CreateBtn = page.getByTestId('create-example-s04');
    await expect(s04CreateBtn).toBeVisible();
    await s04CreateBtn.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    const switcherTrigger = page.getByTestId('scenario-switcher-trigger');
    await switcherTrigger.click();
    const popover = page.getByTestId('scenario-switcher-popover');
    await expect(popover).toContainText('SCENARIOS · 3');

    const runAllBtn = page.getByTestId('scenario-run-all-btn');
    await expect(runAllBtn).toBeEnabled();
    await runAllBtn.click();

    const rows = popover.locator('[data-testid^="scenario-row-"]');
    await expect(async () => {
      await switcherTrigger.click().catch(() => {});
      await expect(popover).toBeVisible();
      for (let i = 0; i < 3; i++) {
        const text = (await rows.nth(i).textContent()) ?? '';
        expect(text).not.toMatch(/Not run yet|Can't run/);
      }
    }).toPass({ timeout: 30000 });
    await page.keyboard.press('Escape');

    // The last scenario's terminal is what the results strip shows; expand
    // Details and confirm real (non-"—") measured counts, not invented values.
    await expect(page.getByTestId('results-status-badge')).not.toContainText('invalid');
    await page.getByTestId('results-details-toggle').click();
    const detailsText = (await page.getByTestId('results-region').textContent()) ?? '';
    expect(detailsText).toMatch(/Consumed inputs:\s*\d/);
    expect(detailsText).toMatch(/Processed events:\s*\d/);
  });

  test('Blank project shows "No scenario" with Run disabled; 390x844 stays usable with no horizontal scroll', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    await page.getByTestId('blank-project-name-input').fill('RV-12d Blank');
    await page.getByTestId('create-blank-project-btn').click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    // D43(a): a blank project opens straight onto its seeded "Main" view
    // (canvas + dock, zero nodes), not the empty-views-state placeholder.
    await expect(page.getByTestId('canvas-container')).toBeVisible();
    expect(await page.locator('.component-node').count()).toBe(0);

    const switcherTrigger = page.getByTestId('scenario-switcher-trigger');
    await expect(switcherTrigger).toContainText('No scenario');

    const runBtn = page.getByTestId('scenario-run-btn');
    await expect(runBtn).toBeDisabled();
    await runBtn.hover();
    await expect(page.getByText('Add a scenario to run')).toBeVisible();

    // Mobile: control and strip usable, no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    const hasHorizontalScroll = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        document.body.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalScroll).toBe(false);

    await expect(page.getByTestId('scenario-switcher')).toBeVisible();
    // RV-12d review round 1: with no scenario and no run, ResultsRegion isn't
    // rendered at all -- the canvas takes the full height instead.
    await expect(page.getByTestId('results-region')).toHaveCount(0);
    await expect(page.getByTestId('canvas-container')).toBeVisible();

    // D41 integration: New opens an unsaved scenario in the mobile inspector
    // sheet. Cancel discards it, leaving the blank project unchanged.
    await switcherTrigger.click();
    await page.getByRole('button', { name: 'New scenario' }).click();
    await page.getByLabel('Name').fill('First traffic test');
    await page.getByTestId('new-scenario-create').click();
    await expect(page.getByTestId('scenario-inspector-sheet-overlay')).toBeVisible();
    await expect(page.getByLabel('Scenario name')).toHaveValue('First traffic test');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByTestId('scenario-inspector-sheet-overlay')).toHaveCount(0);
    await expect(switcherTrigger).toContainText('No scenario');

    await page.screenshot({
      path: test.info().outputPath('rv12d-mobile-blank.png'),
    });
  });

  test('D51: the S06 example runs both scenarios to Passed in the browser', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s06').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await expect(page.locator('.component-node')).toHaveCount(8);

    const switcherTrigger = page.getByTestId('scenario-switcher-trigger');
    const popover = page.getByTestId('scenario-switcher-popover');
    await switcherTrigger.click();
    await popover.getByTestId('scenario-run-all-btn').click();
    const rows = popover.locator('[data-testid^="scenario-row-"]');
    await expect
      .poll(async () => {
        if (!(await popover.isVisible())) await switcherTrigger.click();
        const texts = await rows.allTextContents();
        return texts.filter((t) => t.includes('Passed')).length;
      }, { timeout: 60000, intervals: [1000] })
      .toBe(2);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: test.info().outputPath('s06-passed.png') });
  });
});

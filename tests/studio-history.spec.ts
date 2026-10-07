import { test, expect, type Page } from './fixtures';
import { runAll, savedRunCount } from './simulation-support';

/**
 * RV-13b: History panel journeys (screens 22A-F; contracts/commands.md section 3,
 * contracts/transactions.md; decisions D20/D26/D27/D28/D40).
 *
 * S04 is the fixture used wherever a commit/publish is needed: it ships three
 * scenarios that all pass on "Run all" (see studio-runs.spec.ts) and its Router
 * has an editable numeric capacity, which gives both a draft edit and a
 * mergeable field conflict.
 */

const ROUTER_ELEMENT_ID = '816fe039-76dd-5b7b-a787-4d7666ff8d62';
const MAIN_COMMIT_REASON = 'Main never holds edits (D40): edit main directly to create a draft';

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

async function openS04(page: Page) {
  await page.goto('/projects');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
}

async function openHistory(page: Page) {
  await page.getByTestId('topbar-history-btn').click();
  const ladder = page.getByTestId('history-ladder');
  await expect(ladder).toBeVisible();
  return ladder;
}

async function editRouterCapacity(page: Page, value: string) {
  await page.locator(`[data-element-id="${ROUTER_ELEMENT_ID}"]`).click();
  await page.getByTestId('inspector-field-config.capacity').fill(value);
  await page.getByTestId('inspector-apply').click();
  await waitForIdle(page);
  await page.getByTestId('inspector-close').click();
}

async function runAllScenarios(page: Page) {
  const before = await savedRunCount(page);
  await runAll(page);
  await expect.poll(() => savedRunCount(page), { timeout: 60000 }).toBe(before + 3);
}

async function commitWith(page: Page, message: string) {
  await page.getByTestId('history-ladder').getByRole('button', { name: /^Commit/ }).click();
  const panel = page.getByTestId('commit-panel');
  await panel.getByRole('textbox', { name: 'Commit message' }).fill(message);
  await panel.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(page.getByTestId('history-ladder').getByText(message)).toBeVisible();
}

async function switchBranch(page: Page, label: string) {
  await page.getByTestId('breadcrumb-branch-btn').click();
  await page.locator('button[data-testid^="branch-switch-"]').filter({ hasText: label }).click();
  await expect(page.getByTestId('breadcrumb-branch-btn')).toContainText(label);
}

/** Runs the publish review dialog through to a confirmed publish of a major version. */
async function publishMajor(page: Page, title: string) {
  await page.getByTestId('open-publish-button').click();
  const dialog = page.getByTestId('publish-review-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('review-version-card-major').getByRole('radio').check();
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByTestId('publish-review-button').click();
  await dialog.getByTestId('publish-confirm-button').click();
  await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('MAIN');
}

test.describe('RV-13b: History panel', () => {
  test('22A: an empty draft ladder shows no commits and no checkpoint form', async ({ page }) => {
    await openS04(page);
    const ladder = await openHistory(page);
    await expect(ladder.getByText('No commits on this branch yet')).toBeVisible();
    await expect(ladder.getByText(/CHECKPOINTS/)).toHaveCount(0);
    await expect(ladder.getByPlaceholder('Save checkpoint label')).toHaveCount(0);
  });

  test('Commit is disabled with its reason on main', async ({ page }) => {
    await openS04(page);
    const ladder = await openHistory(page);
    await switchBranch(page, 'main');
    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('MAIN');

    const commit = ladder.getByRole('button', { name: /^Commit/ });
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveAttribute('title', MAIN_COMMIT_REASON);
    await expect(page.getByTestId('open-publish-button')).toBeDisabled();
  });

  test('Commit is disabled with its reason while a configuration draft is open', async ({ page }) => {
    await openS04(page);
    const ladder = await openHistory(page);
    const commit = ladder.getByRole('button', { name: /^Commit/ });
    await expect(commit).toBeEnabled();

    await page.locator(`[data-element-id="${ROUTER_ELEMENT_ID}"]`).click();
    await page.getByTestId('inspector-field-config.capacity').fill('77');
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveAttribute('title', 'Apply or Cancel configuration changes before committing.');
    await expect(page.getByTestId('open-publish-button')).toBeDisabled();

    await page.getByTestId('inspector-cancel').click();
    await expect(commit).toBeEnabled();
  });

  test('the commit gate blocks until every scenario passes, then a commit lands in the ladder', async ({ page }) => {
    await openS04(page);
    await editRouterCapacity(page, '77');
    const ladder = await openHistory(page);
    await expect(ladder.getByTestId('working-edits-count')).toHaveText('1 edit');
    await ladder.getByRole('button', { name: /^Commit/ }).click();

    const panel = page.getByTestId('commit-panel');
    await expect(panel.getByText('capacity 10 → 77')).toBeVisible();
    await expect(panel.getByTestId('passing-scenarios-summary')).toHaveText('0 of 3 passing');
    await expect(panel.getByTestId('commit-gate-notice')).toHaveText('Commit unlocks when all 3 scenarios pass.');
    await expect(panel.getByRole('button', { name: 'Commit', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: 'Cancel' }).click();

    await runAllScenarios(page);
    await commitWith(page, 'Raise router capacity');
    const card = page.getByTestId('history-ladder').locator('[data-testid^="commit-card-"]');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(/current/i);
    await expect(card.getByTestId('evidence-summary-text')).toContainText('3 scenarios passed');
    await expect(page.getByTestId('history-ladder').getByText('COMMITS (1)')).toBeVisible();
  });

  test('Run remaining inside the Commit panel updates its passing count live', async ({ page }) => {
    await openS04(page);
    const ladder = await openHistory(page);
    await ladder.getByRole('button', { name: /^Commit/ }).click();
    const panel = page.getByTestId('commit-panel');
    await panel.getByRole('button', { name: 'Run the 3 remaining' }).click();
    await expect(panel.getByTestId('passing-scenarios-summary')).toHaveText('3 of 3 passing', { timeout: 30000 });
  });

  test('22C/22D: publish review, publish, and the published state has no undo (D26)', async ({ page }) => {
    test.setTimeout(120000);
    await openS04(page);
    await editRouterCapacity(page, '77');
    await openHistory(page);
    await runAllScenarios(page);
    await commitWith(page, 'Raise router capacity');

    await page.getByTestId('open-publish-button').click();
    const dialog = page.getByTestId('publish-review-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/1 commit → main/)).toHaveCount(1);
    await expect(dialog.getByText('No conflicts with main.')).toBeVisible();
    await expect(dialog.getByText('Passed on exactly this version')).toHaveCount(3);
    // Nothing chosen yet: publishing is blocked and says why.
    await expect(dialog.getByTestId('publish-blocking-reason')).toHaveText('choose a version number');
    await expect(dialog.getByTestId('publish-review-button')).toBeDisabled();

    await dialog.getByTestId('review-version-card-major').getByRole('radio').check();
    await expect(dialog.getByTestId('publish-blocking-reason')).toHaveText('add a title');
    await dialog.getByLabel('Title').fill('Router capacity 77');
    await expect(dialog.getByTestId('publish-review-button')).toBeEnabled();
    await dialog.getByTestId('publish-review-button').click();
    await expect(dialog.getByTestId('publish-confirm-notice')).toContainText("Publications can't be undone");
    await dialog.getByTestId('publish-confirm-button').click();

    // Published state: on main at 1.0.0, listed as CURRENT, nothing to undo.
    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('MAIN');
    const ladder = page.getByTestId('history-ladder');
    await expect(ladder).toContainText('up to date · 1.0.0');
    await expect(ladder.getByText('PUBLISHED ON MAIN')).toBeVisible();
    await expect(ladder.locator('[data-testid^="publication-card-"]')).toContainText('Router capacity 77');
    await expect(ladder.getByRole('button', { name: /Start a new draft from 1\.0\.0/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /undo publish/i })).toHaveCount(0);
    await expect(page.getByText(/undo publish/i)).toHaveCount(0);
    await expect(page.getByTestId('publish-review-dialog')).toHaveCount(0);
  });

  test('published main offers a working "Start a new draft" action', async ({ page }) => {
    await openS04(page);
    await openHistory(page);
    await runAllScenarios(page);
    await commitWith(page, 'First commit');
    await publishMajor(page, 'First');
    const start = page.getByTestId('history-ladder').getByRole('button', { name: /Start a new draft from 1\.0\.0/ });
    await expect(start).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Edit main directly' })).toBeEnabled();
    await start.click();
    // D40: main never holds edits; the action creates and opens a draft.
    await expect(page.getByTestId('breadcrumb-branch-btn')).toContainText('Draft from main');
    await expect(page.getByTestId('breadcrumb-branch-state')).not.toHaveText('MAIN');
  });

  test('22D: the published notice names the version after publishing', async ({ page }) => {
    await openS04(page);
    await openHistory(page);
    await runAllScenarios(page);
    await commitWith(page, 'First commit');
    await publishMajor(page, 'First');
    await expect(page.getByTestId('publish-published')).toContainText('1.0.0 published');
  });

  test('22E/22F: a draft behind main shows the conflict, and keyboard resolution unblocks publishing', async ({ page }) => {
    test.setTimeout(180000);
    await openS04(page);
    await openHistory(page);

    // A second draft forks from the unpublished main and sets capacity to 55.
    await switchBranch(page, 'main');
    await editRouterCapacity(page, '55');
    await expect(page.getByTestId('breadcrumb-branch-btn')).toContainText('Draft from main');
    await runAllScenarios(page);
    await commitWith(page, 'Capacity 55');

    // The original draft sets it to 77 and is published first.
    await switchBranch(page, 'draft');
    await editRouterCapacity(page, '77');
    await runAllScenarios(page);
    await commitWith(page, 'Capacity 77');
    await publishMajor(page, 'Capacity 77');

    // Back on the second draft, main has moved: same field changed on both sides.
    await switchBranch(page, 'Draft from main');
    const banner = page.getByTestId('draft-behind-main-banner');
    await expect(banner).toContainText('Main has moved on · 1 conflict with your edits');
    await expect(page.getByTestId('ladder-behind-main')).toContainText('This draft is behind main');
    // Publishing is blocked until resolved, and the ladder says so.
    await expect(page.getByTestId('history-ladder')).toContainText('Publish draft to main — blocked until updated');

    await banner.getByRole('button', { name: 'Review and resolve' }).click();
    const dialog = page.getByTestId('publish-review-dialog');
    await expect(dialog.getByTestId('review-conflicts-callout')).toBeVisible();
    await expect(dialog.getByTestId('publish-blocking-reason')).toHaveText('resolve 1 conflict first');
    await expect(dialog.getByTestId('publish-review-button')).toBeDisabled();

    // 22F, keyboard only: tab to "use theirs" (main's value) and press Enter.
    await dialog.getByRole('button', { name: 'Open diff view' }).click();
    const compare = page.getByTestId('compare-and-resolve-panel');
    await expect(compare).toBeVisible();
    await expect(compare.getByTestId('resolve-progress')).toHaveText('0 of 1 resolved');
    const applyAndRun = compare.getByRole('button', { name: 'Apply and run' });
    await expect(applyAndRun).toBeDisabled();

    const useTheirs = compare.getByRole('button', { name: 'use theirs' });
    await useTheirs.focus();
    await expect(useTheirs).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(compare.locator('[data-testid^="field-resolved-"]')).toHaveCount(1);
    await expect(compare.getByTestId('resolve-progress')).toHaveText('1 of 1 resolved');

    // Applying the resolution re-runs the scenarios on the merged candidate.
    await expect(applyAndRun).toBeEnabled();
    await applyAndRun.focus();
    await page.keyboard.press('Enter');

    // Back on the review: no conflicts remain and a version can be published.
    await expect(dialog.getByText('No conflicts with main.')).toBeVisible({ timeout: 60000 });
    await expect(dialog.getByTestId('review-conflicts-callout')).toHaveCount(0);
    await dialog.getByTestId('review-version-card-major').getByRole('radio').check();
    await dialog.getByLabel('Title').fill('Capacity resolved');
    await expect(dialog.getByTestId('publish-review-button')).toBeEnabled();
    await dialog.getByTestId('publish-review-button').click();
    await dialog.getByTestId('publish-confirm-button').click();
    await expect(page.getByTestId('breadcrumb-branch-state')).toHaveText('MAIN');
    await expect(page.getByTestId('history-ladder')).toContainText('up to date · 2.0.0');
  });

  test('390x844: the History ladder is usable without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openS04(page);
    const ladder = await openHistory(page);
    await expect(ladder.getByRole('button', { name: /^Commit/ })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

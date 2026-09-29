import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * RV-13b: Entry screen (2A new system) journeys.
 *
 * Complements studio-transfer.spec.ts, which already covers the exported-S05
 * round trip and the unsupported-version (old app) rejection, so this spec
 * does not repeat those.
 */

const EXAMPLE_IDS = ['s01', 's02', 's03', 's04', 's05'] as const;

async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

async function openEntry(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
}

function writeImportFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'studio-entry-e2e-'));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

test.describe('RV-13b: Entry screen', () => {
  test('lists every template and requires a name for a blank project', async ({ page }) => {
    await openEntry(page);
    await expect(page.getByTestId('no-projects-notice')).toBeVisible();
    for (const id of EXAMPLE_IDS) {
      await expect(page.getByTestId(`template-row-${id}`)).toContainText(/\d+ components?/);
      await expect(page.getByTestId(`create-example-${id}`)).toBeEnabled();
    }
    const create = page.getByTestId('create-blank-project-btn');
    await expect(create).toBeDisabled();
    await page.getByRole('textbox', { name: 'Blank project name' }).fill('   ');
    await expect(create).toBeDisabled();
    await page.getByRole('textbox', { name: 'Blank project name' }).fill('Named');
    await expect(create).toBeEnabled();
  });

  test('a blank project opens editable and reappears under Your projects after reload', async ({ page }) => {
    await openEntry(page);
    await page.getByRole('textbox', { name: 'Blank project name' }).fill('RV-13b blank');
    await page.getByTestId('create-blank-project-btn').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);
    await expect(page.locator('.component-node')).toHaveCount(0);
    await expect(page.getByTestId('breadcrumb-branch-btn')).toBeVisible();

    // Editable: a Library placement adds a node and autosaves.
    await page.getByTestId('dock-component-btn').click();
    const library = page.getByTestId('library-panel');
    await library.locator('[data-entry-id="queue"]').click();
    await library.getByRole('button', { name: 'Place Message Queue on canvas' }).click();
    await expect(page.locator('.component-node')).toHaveCount(1);
    await expect(page.getByTestId('save-status')).toContainText('Saved');

    await page.reload();
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    const list = page.getByTestId('existing-projects-list');
    await expect(list).toContainText('RV-13b blank');
    // A new project opens on its draft branch, which holds the placed node.
    await list.getByRole('button', { name: 'Open draft' }).click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.locator('.component-node')).toHaveCount(1);
  });

  for (const id of EXAMPLE_IDS) {
    test(`template ${id.toUpperCase()} creates a populated, editable project`, async ({ page }) => {
      await openEntry(page);
      await page.getByTestId(`create-example-${id}`).click();
      await expect(page.getByTestId('workspace-root')).toBeVisible();
      await waitForIdle(page);
      await expect(page.getByTestId('save-status')).toContainText('Saved');
      await expect.poll(() => page.locator('.component-node').count()).toBeGreaterThan(0);
      const before = await page.locator('.component-node').count();

      await page.getByTestId('dock-component-btn').click();
      const library = page.getByTestId('library-panel');
      await library.locator('[data-entry-id="queue"]').click();
      await library.getByRole('button', { name: 'Place Message Queue on canvas' }).click();
      await expect(page.locator('.component-node')).toHaveCount(before + 1);
      await expect(page.getByTestId('save-status')).toContainText('Saved');
    });
  }

  test('rejects malformed import files with typed, non-raw errors and creates nothing', async ({ page }) => {
    const cases: ReadonlyArray<{ name: string; content: string }> = [
      { name: 'not-json.system-studio.json', content: 'this is definitely { not json' },
      { name: 'empty.system-studio.json', content: '' },
      { name: 'array.system-studio.json', content: JSON.stringify([1, 2, 3]) },
      { name: 'current-version-bad-project.system-studio.json', content: JSON.stringify({ format: 'system-studio', version: 9, project: {} }) },
    ];
    await openEntry(page);
    const banner = page.getByTestId('entry-error-banner');
    for (const c of cases) {
      await page.getByTestId('import-project-file-input').setInputFiles(writeImportFile(c.name, c.content));
      await expect(banner, c.name).toBeVisible();
      const text = (await banner.innerText()).trim();
      expect.soft(text.length, c.name).toBeGreaterThan(8);
      expect.soft(text, c.name).not.toMatch(/SyntaxError|Unexpected token|JSON\.parse|TypeError|undefined|\[object|\bat \S+:\d+/);
    }
    await expect(page.getByTestId('no-projects-notice')).toBeVisible();
    await expect(page.getByTestId('existing-projects-list')).toHaveCount(0);
  });

  test('rejects a JSON file that is not a portable bundle without leaking "undefined"', async ({ page }) => {
    await openEntry(page);
    await page.getByTestId('import-project-file-input').setInputFiles(
      writeImportFile('wrong-shape.system-studio.json', JSON.stringify({ hello: 'world' })),
    );
    const banner = page.getByTestId('entry-error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).not.toContainText('undefined');
  });

  test('390x844: the entry screen has no horizontal scroll and creating a project works', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEntry(page);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
    await expect(page.getByTestId('templates-list')).toBeVisible();
    await page.getByRole('textbox', { name: 'Blank project name' }).fill('RV-13b mobile');
    await page.getByTestId('create-blank-project-btn').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await waitForIdle(page);
  });
});

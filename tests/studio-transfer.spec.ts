import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'fake-indexeddb/auto';
import { test, expect } from '@playwright/test';
import { createStudioDatabase, DB_NAME } from '../src/persistence/studio/db';
import { LocalRepository } from '../src/persistence/studio/repository';
import type { Actor, ProjectCreateCommand } from '../src/persistence/studio/types';
import type { Document } from '../src/domain/studio/model';
import { exportProjectJson } from '../src/features/transfer/json-transfer';

/**
 * Studio Transfer E2E (RV-10b).
 *
 * Verifies project.import on the entry screen (2A): choosing an exported v9 JSON
 * bundle registers it with the repository's FileToken registry, imports it, and the
 * project appears in "Your projects" and can be opened -- the round trip the task
 * brief asks for ("import of an exported S05 bundle round trip via the entry
 * screen").
 *
 * The export half is produced in Node, through the real repository/exportProjectJson
 * code (not hand-authored JSON), against an isolated fake-indexeddb instance
 * entirely separate from the browser's own IndexedDB -- matching the task's "export
 * can be produced ... by fixture" option, using the actual S05 fixture document
 * (specs/revamp/fixtures/s05.json, the same file src/features/entry/fixtures.ts
 * loads) as its source. The fixture is read directly with `fs.readFileSync` here
 * (rather than importing entry/fixtures.ts) because Playwright's own Node-ESM test
 * runner -- unlike Vite, which the app itself builds with -- requires an explicit
 * `type: "json"` import attribute for a bare `.json` import, which that module
 * doesn't have.
 */

const testActor: Actor = {
  actorId: 'e2e-transfer-actor',
  kind: 'local-human',
  displayName: 'E2E Operator',
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadS05Fixture(): Document {
  const path = join(__dirname, '..', 'specs', 'revamp', 'fixtures', 's05.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as Document;
}

async function buildExportedS05BundleFile(s05: Document): Promise<string> {
  const dbName = `${DB_NAME}-e2e-transfer-${randomUUID()}`;
  const db = createStudioDatabase(dbName);
  const repo = new LocalRepository(db, { mintId: () => randomUUID() });

  const projectId = randomUUID();
  const createCmd: ProjectCreateCommand = {
    commandId: 'project.create',
    operationId: randomUUID(),
    actor: testActor,
    payload: {
      newProjectId: projectId,
      title: s05.title,
      initialDocument: s05,
      mainBranchId: randomUUID(),
      draftBranchId: randomUUID(),
    },
  };

  const createRes = await repo.execute(createCmd);
  if (createRes.status !== 'applied') {
    throw new Error(`Failed to seed S05 project for export: ${JSON.stringify(createRes)}`);
  }

  const project = await repo.loadProject(projectId);
  if (!project) throw new Error('Seeded S05 project was not found after create');

  const exportRes = await exportProjectJson({
    repository: repo,
    projectId,
    expectedProjectRevision: project.revision,
    mintId: () => randomUUID(),
  });
  db.close();

  if (!exportRes.ok) {
    throw new Error(`Failed to export S05 project bundle: ${exportRes.message}`);
  }

  const dir = mkdtempSync(join(tmpdir(), 'studio-transfer-e2e-'));
  const filePath = join(dir, exportRes.fileName);
  writeFileSync(filePath, exportRes.bytes);
  return filePath;
}

test.describe('Studio Transfer E2E (RV-10b)', () => {
  test('mounts Export under the project menu and enables CSV only for the displayed saved run', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('create-example-s01').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();

    const openExportMenu = async () => {
      await page.getByTestId('breadcrumb-project-btn').click();
      await page.getByTestId('export-menu-trigger').click();
      await expect(page.getByTestId('export-submenu')).toBeVisible();
    };

    await openExportMenu();
    const csvItem = page.getByTestId('export-menu-csv');
    await expect(csvItem).toBeDisabled();
    await expect(csvItem).toHaveAttribute(
      'title',
      'Select a saved run to export its results as CSV.',
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.getByTestId('scenario-run-btn').click();
    await expect(page.getByTestId('playback-status')).toContainText(/completed/i, { timeout: 15_000 });

    await openExportMenu();
    await expect(page.getByTestId('export-menu-csv')).toBeEnabled();
  });

  test('imports an exported S05 project bundle via the entry screen "Import project" action', async ({
    page,
  }) => {
    const s05 = loadS05Fixture();
    const bundleFilePath = await buildExportedS05BundleFile(s05);

    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();
    await expect(page.getByTestId('no-projects-notice')).toBeVisible();

    // Choose the exported bundle via the "Import project" action.
    await expect(page.getByTestId('import-project-btn')).toBeVisible();
    await page.getByTestId('import-project-file-input').setInputFiles(bundleFilePath);

    // Import succeeds -> no error banner, and the project appears in "Your projects".
    const projectList = page.getByTestId('existing-projects-list');
    await expect(projectList).toBeVisible();
    await expect(page.getByTestId('entry-error-banner')).toHaveCount(0);

    const importedItem = projectList.locator('[data-testid^="project-item-"]', {
      hasText: s05.title,
    });
    await expect(importedItem).toBeVisible();

    // The imported project can be opened.
    const openButton = importedItem.locator('[data-testid^="open-project-"]');
    await expect(openButton).toBeVisible();
    await openButton.click();

    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-project-btn')).toHaveText(s05.title);

    // Round trip: the imported document's placed components render on the canvas,
    // same count as the source S05 fixture's first view.
    await page.waitForTimeout(400);
    const expectedNodeCount = s05.views[0]?.placements.length ?? 0;
    expect(expectedNodeCount).toBeGreaterThan(0);
    await expect(page.locator('.component-node')).toHaveCount(expectedNodeCount);
  });

  test('rejects an old-app (unsupported version) file with a typed, non-raw error', async ({
    page,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-transfer-e2e-'));
    const oldFormatPath = join(dir, 'old-export.system-studio.json');
    writeFileSync(
      oldFormatPath,
      JSON.stringify({ format: 'system-studio', version: 7, project: {} }),
    );

    await page.goto('/');
    await expect(page.getByTestId('entry-screen-root')).toBeVisible();

    await page.getByTestId('import-project-file-input').setInputFiles(oldFormatPath);

    const errorBanner = page.getByTestId('entry-error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('old app');
    await expect(errorBanner).not.toContainText('Error:');
    await expect(errorBanner).not.toContainText('at ');

    // No project was created from the rejected file.
    await expect(page.getByTestId('no-projects-notice')).toBeVisible();
  });
});

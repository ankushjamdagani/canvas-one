import { test, expect, type Page } from '@playwright/test';
import type { SnapshotRecord } from '../src/persistence/studio/types';

const SCREENSHOT_DIR = new URL('../artifacts/rv-12e/', import.meta.url).pathname;

/** Waits until no authored command is in flight. Canvas gestures are ignored
 * while a save is pending (`nodesConnectable={!isSaving}`), so every gesture
 * starts from an idle session. */
async function waitForIdle(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}

/** Waits until the canvas camera stops moving (the open-time fit runs after
 * a short delay), so screen coordinates read afterwards stay valid. */
async function waitForStableViewport(page: Page) {
  const viewport = page.locator('.react-flow__viewport');
  await expect(viewport).toHaveCount(1);
  let previous = await viewport.getAttribute('style');
  await expect
    .poll(async () => {
      const current = await viewport.getAttribute('style');
      const stable = current === previous;
      previous = current;
      return stable;
    }, { intervals: [150, 150, 250, 250, 500] })
    .toBe(true);
}

/** Opens the S05 example project (populated view with scenario references). */
async function openS05Project(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
  await waitForStableViewport(page);
}

/**
 * Creates a brand-new blank project. D43(a): it opens on one empty view
 * labelled "Main", so the dock and Component/Connect/Delete work at once.
 * Authoring gestures run here rather than on S05, whose edge labels and
 * dense layout can cover the handles a drag targets.
 */
async function openBlankProject(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('blank-project-name-input').fill(name);
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await waitForIdle(page);
  await waitForStableViewport(page);
}

async function elementIds(page: Page): Promise<string[]> {
  return page.locator('.component-node').evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const id = node.getAttribute('data-element-id');
      return id ? [id] : [];
    }));
}

/** Resolves the one element ID that appeared since `before` (DOM order is
 * not insertion order, so the "last node" is not a reliable identity). */
async function newElementId(page: Page, before: string[]): Promise<string> {
  const known = new Set(before);
  let added: string[] = [];
  await expect
    .poll(async () => {
      added = (await elementIds(page)).filter((id) => !known.has(id));
      return added.length;
    })
    .toBe(1);
  await waitForIdle(page);
  await expect(page.locator(`[data-element-id="${added[0]}"]`)).toBeVisible();
  return added[0];
}

async function openLibrary(page: Page) {
  await waitForIdle(page);
  await page.getByTestId('dock-component-btn').click();
  await expect(page.getByTestId('library-panel')).toBeVisible();
}

/** Places a catalog entry at the viewport centre through the singleton Library. */
async function placeAtCentre(page: Page, entryId: string): Promise<string> {
  const before = await elementIds(page);
  await openLibrary(page);
  const panel = page.getByTestId('library-panel');
  const card = panel.locator(`[data-entry-id="${entryId}"]`);
  await card.click();
  await panel.getByRole('button', { name: /Place .* on canvas/ }).click();
  return newElementId(page, before);
}

/**
 * Places a catalog entry by dragging its Library card to a point given as a
 * fraction of the canvas. Placing selects the new node, which opens the
 * 320px inspector and narrows the canvas, so callers keep `fx` <= 0.5 to
 * stay inside the visible area either way.
 */
async function placeAtFraction(page: Page, entryId: string, fx: number, fy: number): Promise<string> {
  const before = await elementIds(page);
  await openLibrary(page);
  const card = page.getByTestId('library-panel').locator(`[data-entry-id="${entryId}"]`);
  const canvas = page.getByTestId('canvas-container');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas bounding box missing');
  await card.dragTo(canvas, { targetPosition: { x: box.width * fx, y: box.height * fy } });
  return newElementId(page, before);
}

type ConnectOutcome = 'form' | 'rejected' | 'edge' | 'none';

async function connectOutcome(page: Page, edgeCountBefore: number): Promise<ConnectOutcome> {
  if ((await page.getByTestId('connect-resource-form').count()) > 0) return 'form';
  if ((await page.getByTestId('connect-rejected-message').count()) > 0) return 'rejected';
  if ((await page.locator('.react-flow__edge').count()) > edgeCountBefore) return 'edge';
  return 'none';
}

/** One handle-to-handle drag. xyflow resolves the drop target from real
 * screen coordinates, so the pointer moves in steps and ends on the handle. */
async function dragConnectOnce(page: Page, sourceElementId: string, targetElementId: string) {
  const source = page.getByTestId(`node-handle-source-${sourceElementId}`);
  const target = page.getByTestId(`node-handle-target-${targetElementId}`);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sBox = await source.boundingBox();
  const tBox = await target.boundingBox();
  if (!sBox || !tBox) throw new Error('handle bounding box missing');
  await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
  await page.mouse.down();
  await page.mouse.move((sBox.x + tBox.x) / 2, (sBox.y + tBox.y) / 2, { steps: 8 });
  await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2, { steps: 16 });
  await page.mouse.up();
}

/**
 * Connects two elements and returns what the app did: opened the resource
 * form, showed a rejection, or added an edge. The gesture is repeated only
 * after the app has visibly done nothing, so a slow render can never turn
 * one intended connection into two; after three silent attempts it fails.
 */
async function dragConnect(page: Page, sourceElementId: string, targetElementId: string): Promise<ConnectOutcome> {
  const edgeCountBefore = await page.locator('.react-flow__edge').count();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await waitForIdle(page);
    await dragConnectOnce(page, sourceElementId, targetElementId);
    let outcome: ConnectOutcome = 'none';
    try {
      await expect
        .poll(async () => (outcome = await connectOutcome(page, edgeCountBefore)), { timeout: 3000 })
        .not.toBe('none');
    } catch {
      continue;
    }
    return outcome;
  }
  throw new Error(`connect gesture from ${sourceElementId} to ${targetElementId} had no effect after 3 attempts`);
}

test.describe('Studio Authoring E2E (RV-12e)', () => {
  test('D43(b): creates Order and reuses its persisted class ID on a second connection', async ({ page }) => {
    await openBlankProject(page, 'Request class labels');
    const gateway = await placeAtFraction(page, 'gateway', 0.1, 0.2);
    const serviceA = await placeAtFraction(page, 'service', 0.4, 0.2);
    const serviceB = await placeAtFraction(page, 'service', 0.4, 0.6);

    async function readResources(connectionCount: number) {
      await waitForIdle(page);
      return page.evaluate(async (count) => {
        const snapshots = await new Promise<SnapshotRecord[]>((resolve, reject) => {
          const open = indexedDB.open('system-studio-local-v1');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction('snapshots', 'readonly');
            const request: IDBRequest<SnapshotRecord[]> = transaction.objectStore('snapshots').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            transaction.oncomplete = () => db.close();
          };
        });
        const snapshot = snapshots.find((entry) => entry.document.connections.length === count);
        if (!snapshot) throw new Error('Expected authored snapshot is missing');
        return snapshot.document.connections.flatMap((connection) =>
          connection.kind !== 'data' && connection.config.resource ? [connection.config.resource] : []);
      }, connectionCount);
    }

    expect(await dragConnect(page, gateway, serviceA)).toBe('form');
    const classInput = page.getByTestId('connect-form-request-class');
    await expect(classInput).toHaveValue('');
    await expect(page.locator('datalist option')).toHaveCount(0);
    await classInput.fill('Order');
    await page.getByTestId('connect-form-op-read').check();
    await page.getByTestId('connect-form-deadline').fill('250');
    await page.getByTestId('connect-form-confirm').click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    const first = await readResources(1);
    expect(first).toHaveLength(1);
    expect(first[0].requestClassLabel).toBe('Order');
    expect(first[0].requestClassId).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);

    expect(await dragConnect(page, gateway, serviceB)).toBe('form');
    await expect(classInput).toHaveValue('');
    await expect(page.locator('datalist option')).toHaveAttribute('value', 'Order');
    await classInput.fill('Order');
    await page.getByTestId('connect-form-op-write').check();
    await page.getByTestId('connect-form-deadline').fill('250');
    await page.getByTestId('connect-form-confirm').click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    const second = await readResources(2);
    expect(second).toHaveLength(2);
    expect(second.map((resource) => resource.requestClassLabel)).toEqual(['Order', 'Order']);
    expect(second.map((resource) => resource.requestClassId)).toEqual([
      first[0].requestClassId, first[0].requestClassId,
    ]);
  });

  test('delete preview lists the scenarios that reference the node', async ({ page }) => {
    await openS05Project(page);
    // "Checkout" is referenced by S05's scenarios, so Delete asks first
    // (planDelete requiresConfirmation, commands.md §4). Cancelled here.
    await page.locator('.component-node', { hasText: 'Checkout' }).click();
    await page.getByTestId('selection-delete-btn').click();
    await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-delete-preview.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
    await expect(page.locator('.component-node', { hasText: 'Checkout' })).toHaveCount(1);

    // The Backspace key takes the same path; cancelling leaves the node on
    // the canvas (ReactFlow's own delete key must not remove it locally).
    await page.locator('.component-node', { hasText: 'Checkout' }).click();
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
    await expect(page.locator('.component-node', { hasText: 'Checkout' })).toBeVisible();
  });

  test('RV-13a: confirming the delete preview removes a scenario-referenced node; undo restores it', async ({ page }) => {
    await openS05Project(page);
    const checkout = page.locator('.component-node', { hasText: 'Checkout' });
    await checkout.click();
    await page.getByTestId('selection-delete-btn').click();
    await expect(page.getByTestId('delete-confirm-repairs')).toContainText('Accepted and fulfilled');
    await page.getByTestId('delete-confirm-btn').click();
    await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);
    await expect(checkout).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(checkout).toHaveCount(1);
  });

  test('place at centre shows the caption; undo and redo', async ({ page }) => {
    await openBlankProject(page, 'Place and undo');
    const before = await elementIds(page);
    await openLibrary(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-library-open.png` });
    const panel = page.getByTestId('library-panel');
    const card = panel.locator('[data-entry-id="service"]');
    await card.click();
    await panel.getByRole('button', { name: /Place .* on canvas/ }).click();
    await expect(page.getByTestId('library-panel')).toBeVisible();
    const serviceId = await newElementId(page, before);
    const serviceCaption = page.getByTestId(`node-caption-${serviceId}`);
    await expect(serviceCaption).toBeVisible();
    await expect(serviceCaption).toHaveText(/processor · 2\s?000 \/s cap/);

    await page.getByTestId('dock-undo-btn').click();
    await expect(page.locator(`[data-element-id="${serviceId}"]`)).toHaveCount(0);
    await waitForIdle(page);
    await page.getByTestId('dock-redo-btn').click();
    await expect(page.locator(`[data-element-id="${serviceId}"]`)).toHaveCount(1);
  });

  test('connect: ready pair adds an edge; incompatible channels are rejected', async ({ page }) => {
    await openBlankProject(page, 'Connect ready and rejected');
    // Handle-to-handle dragging works in Select mode (commands.md §4).
    await expect(page.getByTestId('dock-select-btn')).toHaveAttribute('aria-pressed', 'true');
    // Email is unmodeled, so a queue -> email message connects without the
    // resource form (catalog.md resolution 8 applies to resource targets only).
    const queueId = await placeAtFraction(page, 'queue', 0.1, 0.15);
    const emailId = await placeAtFraction(page, 'email', 0.4, 0.15);
    expect(await dragConnect(page, queueId, emailId)).toBe('edge');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect(page.getByTestId('connect-rejected-message')).toHaveCount(0);

    // A pipeline's data output can't enter a service's call entry port.
    const pipelineId = await placeAtFraction(page, 'data-pipeline', 0.1, 0.55);
    const serviceId = await placeAtFraction(page, 'service', 0.4, 0.55);
    expect(await dragConnect(page, pipelineId, serviceId)).toBe('rejected');
    await expect(page.getByTestId('connect-rejected-message')).toContainText(/channel/i);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('connect into a resource: the form blocks until class, operation and a valid deadline', async ({ page }) => {
    await openBlankProject(page, 'Resource form');
    const serviceId = await placeAtFraction(page, 'service', 0.1, 0.3);
    const databaseId = await placeAtFraction(page, 'database', 0.4, 0.3);
    expect(await dragConnect(page, serviceId, databaseId)).toBe('form');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-metadata-form.png` });

    // No contracted default for operation or deadline (catalog.md resolution 8).
    const confirm = page.getByTestId('connect-form-confirm');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('connect-form-request-class').fill('read-profile');
    await expect(confirm).toBeDisabled();
    await page.getByTestId('connect-form-op-read').check();
    await expect(confirm).toBeDisabled();
    await page.getByTestId('connect-form-deadline').fill('0');
    await expect(confirm).toBeDisabled();
    // Enter runs the same validation as the (disabled) button.
    await page.getByTestId('connect-form-deadline').press('Enter');
    await expect(page.getByTestId('connect-form-error')).toBeVisible();
    await expect(page.getByTestId('connect-resource-form')).toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);

    await page.getByTestId('connect-form-deadline').fill('500');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByTestId('connect-resource-form')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-after-connecting.png` });
  });

  test('a gateway connected to two targets keeps both connections (route ports)', async ({ page }) => {
    await openBlankProject(page, 'Route ports');
    const gatewayId = await placeAtFraction(page, 'gateway', 0.1, 0.35);
    const serviceAId = await placeAtFraction(page, 'service', 0.4, 0.15);
    const serviceBId = await placeAtFraction(page, 'service', 0.4, 0.6);

    for (const [targetId, label, operation, edges] of [
      [serviceAId, 'route-a', 'read', 1],
      [serviceBId, 'route-b', 'write', 2],
    ] as const) {
      expect(await dragConnect(page, gatewayId, targetId)).toBe('form');
      await page.getByTestId('connect-form-request-class').fill(label);
      await page.getByTestId(`connect-form-op-${operation}`).check();
      await page.getByTestId('connect-form-deadline').fill('250');
      await page.getByTestId('connect-form-confirm').click();
      await expect(page.locator('.react-flow__edge')).toHaveCount(edges);
    }
    await expect(page.getByTestId('connect-rejected-message')).toHaveCount(0);
  });

  test('select and delete a connected node; undo restores node and edge', async ({ page }) => {
    await openBlankProject(page, 'Select and delete');
    const queueId = await placeAtFraction(page, 'queue', 0.1, 0.3);
    const emailId = await placeAtFraction(page, 'email', 0.4, 0.3);
    expect(await dragConnect(page, queueId, emailId)).toBe('edge');
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);

    // The queue was placed here, so no scenario references it and Delete
    // needs no confirmation (the confirm path is the delete-preview test).
    await page.getByTestId('dock-select-btn').click();
    await page.locator(`[data-element-id="${queueId}"]`).click();
    await expect(page.getByTestId('selection-toolbar')).toBeVisible();
    await waitForIdle(page);
    await page.getByTestId('selection-delete-btn').click();
    await expect(page.locator(`[data-element-id="${queueId}"]`)).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);

    await waitForIdle(page);
    await page.getByTestId('dock-undo-btn').click();
    await expect(page.locator(`[data-element-id="${queueId}"]`)).toHaveCount(1);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('mobile 390x844: Library remains usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openS05Project(page);
    const before = await elementIds(page);

    await page.getByTestId('dock-component-btn').click();
    const library = page.getByTestId('library-panel');
    await expect(library).toBeVisible();
    const searchInput = library.locator('input[type="search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('service');
    const serviceCard = library.locator('[data-entry-id="service"]');
    await expect(serviceCard).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-mobile-library.png` });

    await serviceCard.click();
    await library.getByRole('button', { name: /Place .* on canvas/ }).click();
    await newElementId(page, before);
  });

  test('D43(a): a brand-new blank project opens on "Main" and Component works immediately', async ({ page }) => {
    await openBlankProject(page, 'RV-12e Blank Project');
    await expect(page.getByTestId('dock-component-btn')).toBeVisible();
    expect(await elementIds(page)).toHaveLength(0);
    const elementId = await placeAtCentre(page, 'service');
    await expect(page.locator(`[data-element-id="${elementId}"]`)).toBeVisible();
  });
});

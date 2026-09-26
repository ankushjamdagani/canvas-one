import { test, expect, type Page } from '@playwright/test';

const SCREENSHOT_DIR = new URL('../artifacts/rv-12e/', import.meta.url).pathname;

/**
 * Opens the S05 example project (ships with a real view), matching the
 * existing tests/studio-shell.spec.ts pattern, so the bulk of the authoring
 * flow (place/connect/delete against a populated view) can be exercised end
 * to end without every step re-placing from scratch.
 */
async function openS05Project(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('create-example-s05').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await page.waitForTimeout(400);
}

/**
 * Creates a brand-new blank project (EntryScreen "Open an empty canvas").
 * D43(a): SessionController.createProject seeds one empty view labelled
 * "Main" when the caller's initialDocument has none, so the dock and
 * Component/Connect/Delete are reachable immediately -- no separate
 * `view.create` command is needed.
 */
async function openBlankProject(page: Page, name: string) {
  await page.goto('/');
  await expect(page.getByTestId('entry-screen-root')).toBeVisible();
  await page.getByTestId('blank-project-name-input').fill(name);
  await page.getByTestId('create-blank-project-btn').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await page.waitForTimeout(400);
}

async function openComponentPicker(page: Page) {
  await page.getByTestId('dock-component-btn').click();
  await expect(page.getByTestId('component-picker-anchor')).toBeVisible();
}

/** Places a catalog entry at the viewport centre (second click = "Place",
 * matching LibraryPicker's "second tap on an already-selected entry places
 * it" and the footer hint "↵ place at centre"), and returns the new node's
 * elementId (read off the freshly-appended `.component-node`). */
async function placeAndGetElementId(page: Page, entryId: string): Promise<string> {
  const before = await page.locator('.component-node').count();
  await openComponentPicker(page);
  const card = page.locator(`[data-entry-id="${entryId}"]`);
  await card.click();
  await card.click();
  await expect(page.getByTestId('component-picker-anchor')).toHaveCount(0);
  await page.waitForFunction((n) => document.querySelectorAll('.component-node').length > n, before);
  const nodes = page.locator('.component-node');
  const count = await nodes.count();
  const last = nodes.nth(count - 1);
  await expect(last).toBeVisible();
  const elementId = await last.getAttribute('data-element-id');
  expect(elementId).toBeTruthy();
  return elementId as string;
}

/**
 * Places a catalog entry by dragging its picker card to a specific point on
 * the canvas (a fraction of the canvas container's width/height), exercising
 * the "drag to position" placement path and, just as importantly for this
 * test, giving each successive placement a distinct canvas position --
 * placing everything at the viewport centre (Enter/"Place") would stack every
 * node on top of the first one, since the centre point is the same every
 * time.
 *
 * Every placement also selects its new node (commands.md), which opens the
 * 320px right-hand Inspector dock and narrows the visible canvas -- so `fx`
 * is kept <= ~0.5 everywhere this is used, comfortably clear of that reserved
 * strip regardless of whether the inspector happens to be open yet when a
 * given node is placed.
 */
async function placeAtFraction(page: Page, entryId: string, fx: number, fy: number): Promise<string> {
  const before = await page.locator('.component-node').count();
  await openComponentPicker(page);
  const card = page.locator(`[data-entry-id="${entryId}"]`);
  const canvas = page.getByTestId('canvas-container');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas bounding box missing');
  await card.dragTo(canvas, { targetPosition: { x: box.width * fx, y: box.height * fy } });
  await page.waitForFunction((n) => document.querySelectorAll('.component-node').length > n, before);
  await page.waitForTimeout(150);
  const nodes = page.locator('.component-node');
  const last = nodes.nth((await nodes.count()) - 1);
  await expect(last).toBeVisible();
  const elementId = await last.getAttribute('data-element-id');
  expect(elementId).toBeTruthy();
  return elementId as string;
}

/** Drags from elementId's source handle to targetElementId's target handle
 * (a Connect gesture -- works in Select mode too per commands.md §4, and the
 * dock's Connect tool is exercised separately in the test body). */
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
  await page.waitForTimeout(150);
  await page.mouse.move((sBox.x + tBox.x) / 2, (sBox.y + tBox.y) / 2, { steps: 8 });
  await page.waitForTimeout(50);
  await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2, { steps: 16 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * Mouse-based handle-to-handle drag is inherently timing-sensitive (xyflow
 * resolves the drop target with `elementFromPoint` against real screen
 * coordinates, not element identity), so this retries the gesture itself a
 * couple of times before giving up, on top of Playwright's own test retries.
 */
async function dragConnect(
  page: Page,
  sourceElementId: string,
  targetElementId: string,
  edgeCountBefore?: number,
) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await dragConnectOnce(page, sourceElementId, targetElementId);
    const formOrReject =
      (await page.getByTestId('connect-resource-form').count()) > 0 ||
      (await page.getByTestId('connect-rejected-message').count()) > 0;
    const edgeAdded =
      edgeCountBefore !== undefined && (await page.locator('.react-flow__edge').count()) > edgeCountBefore;
    if (formOrReject || edgeAdded) return;
    if (attempt < 4) await page.waitForTimeout(250);
  }
}

test.describe('Studio Authoring E2E (RV-12e)', () => {
  // Handle-to-handle mouse drags resolve their drop target via real screen
  // hit-testing (xyflow's elementFromPoint), which is more timing-sensitive
  // than a click -- dragConnect() already retries the gesture itself; this is
  // a second line of defense for the rest of the flow.
  test.describe.configure({ retries: 2 });

  test('place, drag-place, connect (ready / metadata / rejected / route ports), delete', async ({ page }) => {
    test.setTimeout(60000);
    await openS05Project(page);

    // ------------------------------------------------------------------
    // 0. Delete dependency preview: an S05 fixture node ("Checkout") that a
    //    scenario references shows the confirmation dialog listing the
    //    affected scenario(s) (planDelete's requiresConfirmation, commands.md
    //    §4). Cancelled, not confirmed -- this is a screenshot fixture step,
    //    the rest of the test doesn't depend on Checkout being gone.
    // ------------------------------------------------------------------
    await page.locator('.component-node', { hasText: 'Checkout' }).click();
    await page.getByTestId('selection-delete-btn').click();
    await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-delete-preview.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('delete-confirm-dialog')).toHaveCount(0);

    // ------------------------------------------------------------------
    // 1. Component -> place Service at centre; caption; Undo; Redo
    // ------------------------------------------------------------------
    await page.getByTestId('dock-component-btn').click();
    await expect(page.getByTestId('component-picker-anchor')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-picker-open.png` });

    const serviceId = await placeAndGetElementId(page, 'service');
    const serviceCaption = page.getByTestId(`node-caption-${serviceId}`);
    await expect(serviceCaption).toBeVisible();
    await expect(serviceCaption).toHaveText(/processor · 2\s?000 \/s cap/);

    await page.getByTestId('dock-undo-btn').click();
    await expect(page.locator(`[data-element-id="${serviceId}"]`)).toHaveCount(0);

    await page.getByTestId('dock-redo-btn').click();
    await expect(page.locator(`[data-element-id="${serviceId}"]`)).toHaveCount(1);

    // ------------------------------------------------------------------
    // 2. Drag a Queue card onto the canvas at a point
    // ------------------------------------------------------------------
    const queueId = await placeAtFraction(page, 'queue', 0.5, 0.15);

    // ------------------------------------------------------------------
    // 3. Connect tool: Queue -> Email (message channel, non-resource target
    //    -> ready immediately). Per catalog.md, every resource-kind target
    //    (service/database/queue/gateway/...) requires the resource-metadata
    //    form (resolution 8) -- email is 'unmodeled' so this is the pair that
    //    demonstrates a plain "ready" message-channel connect.
    // ------------------------------------------------------------------
    await page.getByTestId('dock-connect-btn').click();
    const emailId = await placeAtFraction(page, 'email', 0.5, 0.35);

    const edgesBefore = await page.locator('.react-flow__edge').count();
    await dragConnect(page, queueId as string, emailId, edgesBefore);
    await page.waitForFunction((n) => document.querySelectorAll('.react-flow__edge').length > n, edgesBefore);
    await expect(page.getByTestId('connect-rejected-message')).toHaveCount(0);

    // ------------------------------------------------------------------
    // 4. Connect Service -> Database: resource target -> metadata form.
    //    Invalid deadline blocks; valid deadline completes the edge.
    // ------------------------------------------------------------------
    const databaseId = await placeAtFraction(page, 'database', 0.5, 0.55);
    await dragConnect(page, serviceId, databaseId);
    await expect(page.getByTestId('connect-resource-form')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-metadata-form.png` });

    // Neither operation nor deadline has a contracted default (catalog.md
    // resolution 8): Connect stays disabled until request class, an
    // operation, and a valid deadline are all filled in.
    await expect(page.getByTestId('connect-form-confirm')).toBeDisabled();
    await page.getByTestId('connect-form-request-class').fill('read-profile');
    await expect(page.getByTestId('connect-form-confirm')).toBeDisabled();
    await page.getByTestId('connect-form-op-read').check();
    await expect(page.getByTestId('connect-form-confirm')).toBeDisabled();
    await page.getByTestId('connect-form-deadline').fill('0');
    await expect(page.getByTestId('connect-form-confirm')).toBeDisabled();
    // The Connect button is disabled for this invalid state (deadline must be
    // > 0), so drive the same validation path the Enter shortcut uses instead
    // of clicking a disabled control.
    await page.getByTestId('connect-form-deadline').press('Enter');
    await expect(page.getByTestId('connect-form-error')).toBeVisible();
    await expect(page.getByTestId('connect-resource-form')).toBeVisible();

    const edgesBeforeDb = await page.locator('.react-flow__edge').count();
    await page.getByTestId('connect-form-deadline').fill('500');
    await expect(page.getByTestId('connect-form-confirm')).toBeEnabled();
    await page.getByTestId('connect-form-confirm').click();
    await expect(page.getByTestId('connect-resource-form')).toHaveCount(0);
    await page.waitForFunction((n) => document.querySelectorAll('.react-flow__edge').length > n, edgesBeforeDb);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-after-connecting.png` });

    // ------------------------------------------------------------------
    // 5. Rejected pair: data-pipeline's data-channel out -> a service's
    //    call-channel entry port. Shows the reason, adds nothing. Uses a
    //    fresh service placed in a clear corner (not the centre-placed
    //    `serviceId`, which by now sits in the busiest part of the S05
    //    diagram, where edge labels routinely cover its handles and make
    //    the drag land on a label instead -- xyflow resolves a connection's
    //    drop target with `elementFromPoint`, so real screen occlusion
    //    matters here, not just element identity).
    // ------------------------------------------------------------------
    const pipelineId = await placeAtFraction(page, 'data-pipeline', 0.15, 0.75);
    const rejectTargetServiceId = await placeAtFraction(page, 'service', 0.35, 0.9);
    const edgesBeforeReject = await page.locator('.react-flow__edge').count();
    await dragConnect(page, pipelineId, rejectTargetServiceId);
    await expect(page.getByTestId('connect-rejected-message')).toBeVisible();
    await expect(page.getByTestId('connect-rejected-message')).toContainText(/channel/i);
    expect(await page.locator('.react-flow__edge').count()).toBe(edgesBeforeReject);

    // ------------------------------------------------------------------
    // 6. Gateway with two connections gets two route ports: two distinct
    //    targets from the same gateway -> the source port is reused for the
    //    first, and a fresh route out port is minted for the second
    //    (catalog.md resolution 11) -- both surface as edges from the
    //    gateway (per-port handle rendering is out of this task's scope;
    //    connect.test.ts covers the port-minting logic directly).
    // ------------------------------------------------------------------
    const gatewayId = await placeAtFraction(page, 'gateway', 0.15, 0.15);
    const serviceAId = await placeAtFraction(page, 'service', 0.4, 0.15);
    const serviceBId = await placeAtFraction(page, 'service', 0.15, 0.55);

    await dragConnect(page, gatewayId, serviceAId);
    await expect(page.getByTestId('connect-resource-form')).toBeVisible();
    await page.getByTestId('connect-form-request-class').fill('route-a');
    await page.getByTestId('connect-form-op-read').check();
    await page.getByTestId('connect-form-deadline').fill('250');
    const edgesBeforeRouteA = await page.locator('.react-flow__edge').count();
    await page.getByTestId('connect-form-confirm').click();
    await page.waitForFunction((n) => document.querySelectorAll('.react-flow__edge').length > n, edgesBeforeRouteA);

    await dragConnect(page, gatewayId, serviceBId);
    await expect(page.getByTestId('connect-resource-form')).toBeVisible();
    await page.getByTestId('connect-form-request-class').fill('route-b');
    await page.getByTestId('connect-form-op-write').check();
    await page.getByTestId('connect-form-deadline').fill('250');
    const edgesBeforeRouteB = await page.locator('.react-flow__edge').count();
    await page.getByTestId('connect-form-confirm').click();
    await page.waitForFunction((n) => document.querySelectorAll('.react-flow__edge').length > n, edgesBeforeRouteB);
    await expect(page.getByTestId('connect-rejected-message')).toHaveCount(0);

    // Queue selection/deletion is covered by its own, minimal-state test
    // below (see "select and delete a connected node") -- by this point in
    // this test the canvas holds many nodes/edges from every step above, and
    // clicking a specific node by screen position is measurably less robust
    // the more the canvas has accumulated (the Inspector dock's width alone
    // changes which fraction of the canvas is visible each time a different
    // node gets selected). `void queueId;` keeps the earlier drag-place step
    // and its identifier meaningful without re-using it here.
    void queueId;
  });

  test('select and delete a connected node', async ({ page }) => {
    test.setTimeout(45000);
    await openS05Project(page);

    // A small, fresh scene: one Queue connected to one Email (ready connect,
    // see the message-channel note in the main test above).
    const queueId = await placeAtFraction(page, 'queue', 0.3, 0.3);
    const emailId = await placeAtFraction(page, 'email', 0.3, 0.6);
    const edgesBefore = await page.locator('.react-flow__edge').count();
    await dragConnect(page, queueId, emailId, edgesBefore);
    await page.waitForFunction((n) => document.querySelectorAll('.react-flow__edge').length > n, edgesBefore);

    // ------------------------------------------------------------------
    // Select the Queue -> Delete -> node and its edge gone; Undo restores
    // all. The Queue was placed by this test, so S05's existing scenario(s)
    // can't reference it -- `planDelete` requires no confirmation here. The
    // confirm-required path with a referencing scenario is covered directly
    // by deletePlan.test.ts.
    // ------------------------------------------------------------------
    await page.getByTestId('dock-select-btn').click();
    await page.waitForTimeout(150);
    const queueLoc = page.locator(`[data-element-id="${queueId}"]`);
    await expect(queueLoc).toBeVisible();
    await queueLoc.click();
    await expect(page.getByTestId('selection-toolbar')).toBeVisible();

    const nodesBeforeDelete = await page.locator('.component-node').count();
    const edgesBeforeDelete = await page.locator('.react-flow__edge').count();
    await page.getByTestId('selection-delete-btn').click();
    await page.waitForFunction((n) => document.querySelectorAll('.component-node').length < n, nodesBeforeDelete);
    await expect(page.locator(`[data-element-id="${queueId}"]`)).toHaveCount(0);
    expect(await page.locator('.react-flow__edge').count()).toBeLessThan(edgesBeforeDelete);

    await page.getByTestId('dock-undo-btn').click();
    await expect(page.locator(`[data-element-id="${queueId}"]`)).toHaveCount(1);
    await page.waitForFunction((n) => document.querySelectorAll('.react-flow__edge').length >= n, edgesBeforeDelete);
  });

  test('mobile 390x844: component picker is usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openS05Project(page);

    const before = await page.locator('.component-node').count();

    await page.getByTestId('dock-component-btn').click();
    const picker = page.getByTestId('library-picker');
    await expect(picker).toBeVisible();

    const searchInput = picker.locator('input[type="search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('service');
    const serviceCard = picker.locator('[data-entry-id="service"]');
    await expect(serviceCard).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/rv12e-mobile-picker.png` });

    await serviceCard.click();
    await serviceCard.click();
    await expect(page.getByTestId('library-picker')).toHaveCount(0);
    await page.waitForFunction((n) => document.querySelectorAll('.component-node').length > n, before);
  });

  test('D43(a): a brand-new blank project seeds a "Main" view -- Component is reachable immediately', async ({
    page,
  }) => {
    await openBlankProject(page, 'RV-12e Blank Project');

    // No "no views yet" state; the dock and Component picker work right away.
    await expect(page.getByTestId('dock-component-btn')).toBeVisible();
    const before = await page.locator('.component-node').count();
    expect(before).toBe(0);

    const elementId = await placeAndGetElementId(page, 'service');
    await expect(page.locator(`[data-element-id="${elementId}"]`)).toBeVisible();
  });
});

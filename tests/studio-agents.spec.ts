import { test, expect, type Page } from './fixtures';
import { startCollaborationServer, type ExecutionBackend, type LocalCollaborationServer } from '@canvas-one/agent-bridge/collaboration-server';
import type { AgentTool } from '@canvas-one/agent-bridge';
import type { Element, View } from '@canvas-one/system-design';
import type { CollaborationTask } from '@canvas-one/agents';

const ROUTER = '816fe039-76dd-5b7b-a787-4d7666ff8d62';
test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', error => { void testInfo.attach('browser-error', { body: error.stack ?? error.message, contentType: 'text/plain' }); console.error(error); });
});
type Context = Parameters<ExecutionBackend['launch']>[0];
type Inspection = { scope: { projectId: string; branchId: string }; revision: number; documentId: string; records: { id: string; type: string; data: Element | View }[] };
async function fixture(origin: string, deferredClose = false) {
  let service!: LocalCollaborationServer;
  const contexts = new Map<string, Context>(), finishes = new Map<string, (outcome?: 'succeeded' | 'cancelled') => void>();
  const backend: ExecutionBackend = { providerCapabilities: [{ id: 'claude', available: true, detail: 'Synthetic adapter; no model inference.' }], async launch(context) {
    contexts.set(context.identity.attemptId, context);
    let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; });
    let settled = false;
    const close = (outcome: 'succeeded' | 'cancelled' = 'succeeded') => { if (settled) return; settled = true; context.emit({ kind: 'provider-result', outcome, cancellationAcknowledged: outcome === 'cancelled' }); context.emit({ kind: 'attempt-ended', outcome, cancellationAcknowledged: outcome === 'cancelled' }); finish(); };
    finishes.set(context.identity.attemptId, close);
    return { process: { finished, cancel: async () => { if (!deferredClose) close('cancelled'); await finished; } }, send: async () => ({ delivered: true, acknowledged: true }) };
  } };
  service = await startCollaborationServer({ allowedOrigins: [origin], now: () => performance.now(), pairingTtlMs: 60000, sessionTtlMs: 600000, leaseMs: 15000, expiryIntervalMs: 1000, maxEventRecords: 2000, maxEventBytes: 4 * 1024 * 1024, requestTimeoutMs: 10000, maxBrowserRequests: 64, backend,
    authorize: async (identity, metadata) => await service.requestBrowser(identity, { kind: 'authorize', data: metadata }, new AbortController().signal) === true,
    relay: (identity, payload, signal) => service.requestBrowser(identity, { kind: 'tool', data: payload }, signal),
  });
  const tool = async <T>(context: Context, name: AgentTool, input: unknown): Promise<T> => {
    const requestId = crypto.randomUUID(); context.emit({ kind: 'tool', toolId: requestId, name, phase: 'started' });
    try {
      const result = await context.relay(context.capability, { requestId, tool: name, input });
      const failed = result !== null && typeof result === 'object' && ('status' in result && result.status === 'failed' || 'ok' in result && result.ok === false);
      context.emit({ kind: 'tool', toolId: requestId, name, phase: failed ? 'failed' : 'completed' }); return result as T;
    } catch (error) { context.emit({ kind: 'tool', toolId: requestId, name, phase: 'failed' }); throw error; }
  };
  const dispose = async () => { for (const close of finishes.values()) close('cancelled'); await service.close(); };
  return { service, contexts, finishes, tool, dispose };
}
async function openBoard(page: Page) {
  await page.goto('/projects'); await page.getByTestId('create-example-s04').click(); await expect(page.getByTestId('workspace-root')).toBeVisible(); await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
}
async function openComments(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('quick-options-input').fill('Comments');
  await page.getByTestId('quick-option-agents.open').click();
  const index = page.getByRole('region', { name: 'Comments', exact: true });
  await expect(index).toBeVisible();
  return index;
}
async function openAI(page: Page, newConversation = false, keepComments = false) {
  const existing = page.getByTestId('collaboration-panel');
  if (!newConversation && await existing.isVisible()) return existing;
  const index = await openComments(page);
  const earlier = page.getByRole('button', { name: 'Open earlier AI work', exact: true });
  const rows = index.getByRole('button', { name: /^Open / });
  const waitingRow = rows.filter({ hasText: 'Waiting to send' });
  let created = false;
  if (!newConversation && await waitingRow.count()) await waitingRow.first().click();
  else if (!newConversation && await rows.count()) await rows.first().click();
  else if (!newConversation && await earlier.isVisible()) await earlier.click();
  else {
    const count = await page.getByTestId('conversation-pin').count();
    await index.getByRole('button', { name: 'New conversation', exact: true }).click();
    await expect(page.getByTestId('conversation-pin')).toHaveCount(count + 1);
    created = true;
  }
  const expanded = page.getByTestId('canvas-conversation-expanded');
  await expect(expanded).toBeVisible();
  const askAI = expanded.getByRole('button', { name: 'Ask AI', exact: true });
  if (created) await expect(askAI).toBeVisible();
  if (await askAI.isVisible()) await askAI.click();
  await expect(existing).toBeVisible();
  const closeComments = page.getByRole('button', { name: 'Close Comments', exact: true });
  if (!keepComments && await closeComments.isVisible()) await closeComments.click();
  return existing;
}
async function connect(page: Page, service: LocalCollaborationServer, expectComposer = true) {
  const panel = await openAI(page);
  await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
  await panel.getByLabel('2. Paste connection details').fill(JSON.stringify({ url: service.url, pairingSecret: service.pairingSecret }));
  await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Agent', exact: true })).toBeVisible();
  if (expectComposer) {
    const draft = panel.getByRole('button', { name: 'Create a draft', exact: true });
    if (await draft.isVisible()) { await draft.click(); await expect(draft).not.toBeVisible(); }
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
  }
  return panel;
}
async function start(page: Page, f: Awaited<ReturnType<typeof fixture>>, instruction: string) {
  const panel = await connect(page, f.service); await panel.getByRole('textbox', { name: 'Message', exact: true }).fill(instruction); await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => f.contexts.size).toBe(1); await expect(panel.locator('summary').filter({ hasText: 'Write / Suggest · Request details' })).toBeVisible(); return { panel, context: [...f.contexts.values()][0]! };
}
async function taskState(page: Page, taskId: string): Promise<CollaborationTask | undefined> {
  return page.evaluate(id => new Promise<CollaborationTask | undefined>((resolve, reject) => {
    const request = indexedDB.open('system-studio-local-v1'); request.onerror = () => reject(new Error('Database unavailable'));
    request.onsuccess = () => { const db = request.result, tx = db.transaction('agentTaskLedgers', 'readonly'), rows = tx.objectStore('agentTaskLedgers').getAll(); rows.onsuccess = () => resolve(rows.result.flatMap(row => JSON.parse(row.serializedLedger).tasks).find((task: CollaborationTask) => task.id === id)); rows.onerror = () => reject(new Error('Task ledger unavailable')); tx.oncomplete = () => db.close(); };
  }), taskId);
}
async function journal(page: Page): Promise<{ taskId: string; binding: Record<string, unknown> }[]> {
  return page.evaluate(() => new Promise<{ taskId: string; binding: Record<string, unknown> }[]>((resolve, reject) => {
    const request = indexedDB.open('system-studio-local-v1'); request.onerror = () => reject(new Error('Database unavailable'));
    request.onsuccess = () => { const db = request.result, transaction = db.transaction('agentTaskActions', 'readonly'), rows = transaction.objectStore('agentTaskActions').getAll(); rows.onsuccess = () => resolve(rows.result); rows.onerror = () => reject(new Error('Store unavailable')); transaction.oncomplete = () => db.close(); };
  }));
}

test('canvas connection setup hides the composer through validation and retry while Comments uses shared panels', async ({ page, baseURL }, testInfo) => {
  const f = await fixture(new URL(baseURL!).origin);
  let releasePair!: () => void;
  const pairGate = new Promise<void>(resolve => { releasePair = resolve; });
  try {
    await openBoard(page); const panel = await openAI(page, false, true);
    const expanded = page.getByTestId('canvas-conversation-expanded');
    const comments = page.locator('[data-slot="floating-panel"][data-panel-id="comments"]');
    await expect(comments).toBeVisible();
    await expect(comments.getByRole('button', { name: 'New conversation', exact: true })).toBeVisible();
    await expect(comments.getByTestId('collaboration-panel')).toHaveCount(0);
    await expect(panel).toContainText('Connect your local agents');
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
    await expect(panel.locator('code')).toContainText(new URL(baseURL!).origin);
    const bounds = (await expanded.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1512); expect(bounds.y + bounds.height).toBeLessThanOrEqual(982);
    await page.screenshot({ path: testInfo.outputPath('desktop-connection-setup.png'), fullPage: true });
    await panel.getByLabel('2. Paste connection details').fill('invalid connection details');
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    const beforeResize = (await comments.boundingBox())!;
    await comments.getByRole('separator', { name: 'Resize Comments floating panel', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await comments.boundingBox())!.width).toBeGreaterThan(beforeResize.width);
    await comments.getByRole('button', { name: 'Close Comments', exact: true }).click();
    await expanded.getByRole('button', { name: 'Minimize conversation', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await page.getByTestId('conversation-pin').click();
    await expect(panel).toBeVisible();
    await page.route(`${f.service.url}/v1/pair`, async route => { await pairGate; await route.abort('failed'); });
    await panel.getByLabel('2. Paste connection details').fill(JSON.stringify({ url: f.service.url, pairingSecret: f.service.pairingSecret }));
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Connecting…', exact: true })).toBeDisabled();
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    releasePair();
    await expect(panel.getByRole('alert')).toContainText('Cannot reach the service');
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('desktop-connection-error.png'), fullPage: true });
    await page.unroute(`${f.service.url}/v1/pair`);
    await panel.getByLabel('2. Paste connection details').fill(JSON.stringify({ url: f.service.url, pairingSecret: 'b'.repeat(64) }));
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('The pairing secret expired or was already used.');
    await expect(panel.getByRole('alert')).not.toContainText('invalid-pairing');
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    await panel.locator('summary').filter({ hasText: 'Advanced: enter details manually' }).click();
    await panel.getByLabel('Service address', { exact: true }).fill(f.service.url);
    await panel.getByLabel('Pairing secret', { exact: true }).fill(f.service.pairingSecret);
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('combobox', { name: 'Agent', exact: true })).toBeVisible();
    await expect(panel.getByLabel('2. Paste connection details')).toHaveCount(0);
    await expect(comments).not.toBeVisible();
    expect(f.contexts.size).toBe(0);
  } finally { releasePair(); await f.dispose(); }
});

test('malformed invalid and stale proposals remain reviewable without crashing or writing', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin);
  let recoveredService: Awaited<ReturnType<typeof fixture>> | undefined;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await openBoard(page); const { panel, context } = await start(page, f, 'Propose a router change');
    const board = await f.tool<Inspection>(context, 'board_inspect', {});
    const changes = [null, {}, { kind: 'replace' }, { kind: 'insert', value: { recordKind: 'unknown', record: { id: ROUTER } } }, { kind: 'remove', recordKind: '__proto__', id: ROUTER }];
    for (const stale of [false, true]) {
      const label = stale ? 'Malformed stale proposal' : 'Malformed invalid proposal';
      expect(await f.tool(context, 'proposal_submit', { operationId: crypto.randomUUID(), scope: board.scope, expectedRevision: board.revision + (stale ? 1 : 0), label, changes })).toMatchObject({ ok: true, proposal: { status: stale ? 'conflict' : 'invalid' } });
      await expect(panel.getByRole('heading', { name: label, exact: true })).toBeVisible();
      await expect(panel.getByText('Changed: Invalid proposed change', { exact: true })).toHaveCount(changes.length);
      await expect(panel.getByRole('button', { name: 'Accept changes', exact: true })).toBeDisabled();
    }
    await page.reload(); await expect(page.getByTestId('workspace-root')).toBeVisible();
    recoveredService = await fixture(new URL(baseURL!).origin);
    const recovered = await connect(page, recoveredService.service, false);
    await expect(recovered.getByRole('heading', { name: /^Malformed (invalid|stale) proposal$/ })).toBeVisible();
    await expect(recovered.getByText('Changed: Invalid proposed change', { exact: true })).toHaveCount(changes.length);
    expect(await journal(page)).toHaveLength(0); expect(errors).toEqual([]);
  } finally { await f.dispose(); await recoveredService?.dispose(); }
});

test('phone requires desktop execution while a narrow desktop can connect', async ({ browser, page, baseURL }, testInfo) => {
  const mobile = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  try {
    const phone = await mobile.newPage(); await phone.addInitScript(() => localStorage.setItem('studio:motion', 'off')); await openBoard(phone);
    await phone.getByTestId('topbar-quick-options-btn').click(); await phone.getByTestId('quick-options-input').fill('Comments'); await phone.getByTestId('quick-option-agents.open').click();
    await phone.getByRole('button', { name: 'New conversation', exact: true }).click();
    await phone.getByTestId('canvas-conversation-expanded').getByRole('button', { name: 'Ask AI', exact: true }).click();
    const panel = phone.getByTestId('collaboration-panel'); await expect(panel).toBeVisible(); await expect(panel).toContainText('Continue on desktop'); await expect(panel.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0); await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0); await expect(panel.getByLabel('2. Paste connection details')).toHaveCount(0);
    const bounds = (await panel.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(391); expect(bounds.y + bounds.height).toBeLessThanOrEqual(845);
    await phone.screenshot({ path: testInfo.outputPath('mobile-desktop-required.png'), fullPage: true });
  } finally { await mobile.close(); }
  await page.setViewportSize({ width: 390, height: 844 }); await openBoard(page); await expect((await openAI(page)).getByLabel('2. Paste connection details')).toBeEnabled();
});

test('Suggest review applies once through the board mailbox with durable task provenance', async ({ page, baseURL }, testInfo) => {
  const f = await fixture(new URL(baseURL!).origin);
  try {
    await openBoard(page); const { panel, context } = await start(page, f, 'Rename the router'); const board = await f.tool<Inspection>(context, 'board_inspect', {}), original = board.records.find(record => record.id === ROUTER)!.data as Element;
    expect(await f.tool(context, 'proposal_submit', { operationId: crypto.randomUUID(), scope: board.scope, expectedRevision: board.revision, label: 'Reviewed router name', changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...original, label: 'Reviewed Router' } } }] })).toMatchObject({ ok: true });
    await expect(panel).toContainText('Reviewed router name'); await expect(page.locator(`[data-element-id="${ROUTER}"]`)).not.toContainText('Reviewed Router'); expect((await journal(page)).filter(row => row.taskId === context.identity.taskId)).toHaveLength(0);
    const sendBounds = (await panel.getByRole('button', { name: 'Stop request', exact: true }).boundingBox())!, panelBounds = (await panel.boundingBox())!;
    expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(panelBounds.y + panelBounds.height);
    await page.screenshot({ path: testInfo.outputPath('desktop-suggest-review.png'), fullPage: true });
    f.finishes.get(context.identity.attemptId)!(); await panel.getByRole('button', { name: 'Accept changes', exact: true }).click(); await expect(page.locator(`[data-element-id="${ROUTER}"]`)).toContainText('Reviewed Router');
    await expect.poll(async () => (await journal(page)).filter(row => row.taskId === context.identity.taskId).length).toBe(1);
    expect((await journal(page)).find(row => row.taskId === context.identity.taskId)!.binding).toMatchObject({ taskId: context.identity.taskId, attemptId: context.identity.attemptId, actorId: context.identity.actorId }); await expect(panel.getByRole('button', { name: 'Accept changes', exact: true })).toHaveCount(0);
  } finally { await f.dispose(); }
});

test('historical task Undo selects a new actionable review while accepted receipts stay terminal', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin);
  try {
    await openBoard(page);
    const { panel, context } = await start(page, f, 'Rename router for history undo');
    const board = await f.tool<Inspection>(context, 'board_inspect', {});
    const original = board.records.find(record => record.id === ROUTER)!.data as Element;
    const router = page.locator(`[data-element-id="${ROUTER}"]`);
    expect(await f.tool(context, 'proposal_submit', { operationId: crypto.randomUUID(), scope: board.scope, expectedRevision: board.revision, label: 'Historical router rename', changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...original, label: 'History Reviewed Router' } } }] })).toMatchObject({ ok: true });
    f.finishes.get(context.identity.attemptId)!();
    await panel.getByRole('button', { name: 'Accept changes', exact: true }).click();
    await expect(router).toContainText('History Reviewed Router');
    await expect.poll(async () => (await journal(page)).filter(row => row.taskId === context.identity.taskId).length).toBe(1);
    await expect.poll(async () => (await taskState(page, context.identity.taskId))?.status).toBe('completed');

    await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Wait without changing the board');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => f.contexts.size).toBe(2);
    await panel.getByRole('button', { name: 'Stop request', exact: true }).click();
    const second = [...f.contexts.values()][1]!;
    await expect.poll(async () => (await taskState(page, second.identity.taskId))?.cancellation).toBe('acknowledged');
    await panel.locator('summary').filter({ hasText: /^Earlier requests/ }).click();
    await panel.getByRole('button', { name: 'Claude · Rename router for history undo', exact: true }).click();
    const history = panel.getByRole('region', { name: 'Task proposal history' });
    const receipt = history.getByRole('button', { name: 'Historical router rename · accepted', exact: true });
    await receipt.click();
    await expect(panel.getByRole('button', { name: 'Accept changes', exact: true })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Review undo', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Review undo', exact: true })).toBeVisible();
    const accept = panel.getByRole('button', { name: 'Accept changes', exact: true });
    await expect(accept).toBeEnabled();
    await expect(router).toContainText('History Reviewed Router');
    await accept.click();
    await expect(router).toContainText(original.label);
    await expect(router).not.toContainText('History Reviewed Router');
    await receipt.click();
    await expect(panel.getByRole('heading', { name: 'Historical router rename', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Accept changes', exact: true })).toHaveCount(0);
    await expect(receipt).toBeVisible();
  } finally { await f.dispose(); }
});

test('Live overlap preserves human edits, independent work continues, and Stop offers reviewed Undo', async ({ page, baseURL }, testInfo) => {
  const f = await fixture(new URL(baseURL!).origin);
  try {
    await openBoard(page); const { panel, context } = await start(page, f, 'Organize the board');
    await panel.getByRole('button', { name: 'Write behavior: Suggest', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Allow Live for current request…', exact: true }).click();
    const grant = page.getByRole('dialog', { name: 'Allow Live for this request?' }); await expect(grant).toContainText('delete content'); await grant.getByRole('button', { name: 'Allow Live for this request', exact: true }).click(); await panel.locator('summary').filter({ hasText: 'Write / Live · Request details' }).click(); await expect(panel).toContainText('Whole board, including deletions');
    await page.screenshot({ path: testInfo.outputPath('desktop-live-task.png'), fullPage: true });
    const board = await f.tool<Inspection>(context, 'board_inspect', {}), original = board.records.find(record => record.id === ROUTER)!.data as Element;
    const view = board.records.find(record => record.type === 'views')!.data as View;
    const note: Element = { id: crypto.randomUUID(), label: 'Temporary live note', description: '', visualKind: 'host', ports: [], behavior: { kind: 'unmodeled', version: 1, reason: 'Annotation' } };
    const withNote: View = { ...view, placements: [...view.placements, { id: crypto.randomUUID(), elementId: note.id, x: (view.placements[0]?.x ?? 0) + 30, y: (view.placements[0]?.y ?? 0) + 30, width: 200, expanded: false }] };
    expect(await f.tool(context, 'action_submit', { operationId: crypto.randomUUID(), label: 'Create live annotation', changes: [{ kind: 'insert', value: { recordKind: 'element', record: note } }, { kind: 'replace', value: { recordKind: 'view', record: withNote } }], expectedRecords: [{ recordKind: 'element', id: note.id, before: null }, { recordKind: 'view', id: view.id, before: { recordKind: 'view', record: view } }] })).toMatchObject({ status: 'applied' });
    await expect(page.locator(`[data-element-id="${note.id}"]`)).toHaveCount(1);
    expect(await f.tool(context, 'action_submit', { operationId: crypto.randomUUID(), label: 'Delete live annotation', changes: [{ kind: 'remove', recordKind: 'element', id: note.id }, { kind: 'replace', value: { recordKind: 'view', record: view } }], expectedRecords: [{ recordKind: 'element', id: note.id, before: { recordKind: 'element', record: note } }, { recordKind: 'view', id: view.id, before: { recordKind: 'view', record: withNote } }] })).toMatchObject({ status: 'applied' });
    await expect(page.locator(`[data-element-id="${note.id}"]`)).toHaveCount(0);
    await page.locator(`[data-element-id="${ROUTER}"]`).click(); await page.getByTestId('inspector-field-config.capacity').fill('87'); await page.getByTestId('inspector-apply').click(); await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle'); await expect(panel).toBeVisible();
    expect(await f.tool(context, 'action_submit', { operationId: crypto.randomUUID(), label: 'Conflicting router edit', changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...original, label: 'Must not overwrite human' } } }], expectedRecords: [{ recordKind: 'element', id: original.id, before: { recordKind: 'element', record: original } }] })).toMatchObject({ status: 'failed', code: 'conflict' }); await expect(panel).toContainText('An affected action needs a decision');
    const current = await f.tool<Inspection>(context, 'board_inspect', {}), independent = current.records.find(record => record.type === 'elements' && record.id !== ROUTER)!.data as Element;
    expect(await f.tool(context, 'action_submit', { operationId: crypto.randomUUID(), label: 'Independent label edit', changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...independent, label: 'Independent Agent Edit' } } }], expectedRecords: [{ recordKind: 'element', id: independent.id, before: { recordKind: 'element', record: independent } }] })).toMatchObject({ status: 'applied' }); await expect(page.locator(`[data-element-id="${independent.id}"]`)).toContainText('Independent Agent Edit');
    await panel.getByRole('button', { name: 'Stop request', exact: true }).click(); await expect.poll(async () => (await taskState(page, context.identity.taskId))?.cancellation).toBe('acknowledged'); await panel.getByRole('button', { name: 'Review undo', exact: true }).click(); await expect(page.locator(`[data-element-id="${independent.id}"]`)).toContainText('Independent Agent Edit'); await panel.getByRole('button', { name: 'Accept changes', exact: true }).click(); await expect(page.locator(`[data-element-id="${independent.id}"]`)).toContainText(independent.label);
    await page.locator(`[data-element-id="${ROUTER}"]`).click(); await expect(page.getByTestId('inspector-field-config.capacity')).toHaveValue('87');
  } finally { await f.dispose(); }
});

test('canvas conversation and Configuration retain unfinished drafts across conversation minimize and reopen', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin);
  try {
    await openBoard(page); const panel = await connect(page, f.service);
    await panel.getByRole('textbox', { name: 'Message', exact: true }).fill('Unsent task draft');
    await page.locator(`[data-element-id="${ROUTER}"]`).click(); await page.getByTestId('inspector-field-config.capacity').fill('93');
    await expect(page.getByTestId('inspector-panel')).toBeVisible(); await expect(panel).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Unsent task draft');
    await expect(page.getByTestId('inspector-field-config.capacity')).toHaveValue('93'); expect(f.contexts.size).toBe(0);
    await page.getByTestId('inspector-cancel').click();
    await page.getByRole('button', { name: 'Minimize conversation', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await openAI(page); await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Unsent task draft'); expect(f.contexts.size).toBe(0);
  } finally { await f.dispose(); }
});

test('Stop fences writes before cancellation close evidence arrives', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin, true);
  try {
    await openBoard(page); const { panel, context } = await start(page, f, 'Wait for explicit cancellation');
    await panel.getByRole('button', { name: 'Stop request', exact: true }).click();
    await expect(panel).toContainText('Board writes stopped. Waiting for agent cancellation.');
    await expect.poll(async () => (await taskState(page, context.identity.taskId))?.cancellation).toBe('pending');
    await expect(f.tool(context, 'board_inspect', {})).rejects.toThrow('revoked');
    f.finishes.get(context.identity.attemptId)!('cancelled');
    await expect.poll(async () => (await taskState(page, context.identity.taskId))?.cancellation).toBe('acknowledged');
  } finally { await f.dispose(); }
});

test('Disconnect requires explicit Resume with a new attempt and Suggest permission', async ({ page, baseURL }) => {
  const first = await fixture(new URL(baseURL!).origin); let second: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await openBoard(page); const { panel, context } = await start(page, first, 'Continue after reconnecting');
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(panel).toContainText('Connect your local agents');
    await expect(panel.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    await first.dispose(); second = await fixture(new URL(baseURL!).origin);
    await connect(page, second.service, false); await expect.poll(() => second!.contexts.size).toBe(0);
    await expect(panel).toContainText('Work paused. Completed changes remain. Resume to continue.');
    await panel.getByRole('button', { name: 'Resume request', exact: true }).click();
    await expect.poll(() => second!.contexts.size).toBe(1);
    const resumed = [...second.contexts.values()][0]!;
    expect(resumed.identity.taskId).toBe(context.identity.taskId); expect(resumed.identity.attemptId).not.toBe(context.identity.attemptId); expect(resumed.identity.generation).toBeGreaterThan(context.identity.generation);
    await panel.locator('summary').filter({ hasText: 'Write / Suggest · Request details' }).click(); await expect(panel).toContainText('Review before applying');
    await expect(first.tool(context, 'board_inspect', {})).rejects.toThrow();
    await panel.getByRole('button', { name: 'Stop request', exact: true }).click(); await expect.poll(async () => (await taskState(page, resumed.identity.taskId))?.cancellation).toBe('acknowledged');
  } finally { await first.dispose(); await second?.dispose(); }
});

test('agent Markdown stays safe and new responses do not pull readers away from older messages', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin);
  const remoteImages: string[] = [];
  page.on('request', request => { if (request.url().includes('untrusted-image.invalid')) remoteImages.push(request.url()); });
  try {
    await openBoard(page); const { panel, context } = await start(page, f, 'Explain the board');
    context.emit({ kind: 'text', format: 'message', text: '## Board summary\n\n**Router** is the entry point.\n\n| Node | Role |\n| --- | --- |\n| Router | Entry |\n\n```ts\nconst safe = true;\n```\n\n[Documentation](https://example.com/docs)\n\n[Unsafe](javascript:alert(1))\n\n![remote diagram](https://untrusted-image.invalid/diagram.png)\n\n<script>window.markdownExecuted = true</script><iframe src="https://untrusted-image.invalid/frame"></iframe>' });
    const messages = panel.getByRole('list', { name: 'Messages', exact: true });
    await expect(messages.getByRole('heading', { name: 'Board summary' })).toBeVisible();
    await expect(messages.locator('strong')).toHaveText('Router');
    await expect(messages.getByRole('table')).toContainText('Entry');
    await expect(messages.locator('pre')).toHaveText('const safe = true;');
    await expect(messages.getByRole('button', { name: 'Copy code', exact: true })).toBeVisible();
    await expect(messages.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', 'https://example.com/docs');
    await expect(messages.getByRole('link', { name: 'Unsafe' })).toHaveCount(0);
    await expect(messages.locator('script,iframe,img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { markdownExecuted?: boolean }).markdownExecuted)).toBeUndefined();
    expect(remoteImages).toEqual([]);

    for (let i = 0; i < 30; i++) context.emit({ kind: 'text', format: 'message', text: `Earlier explanation ${i}. ${'Board details and rationale. '.repeat(12)}` });
    await expect(messages.getByText(/^Earlier explanation 29\./)).toBeAttached();
    const viewport = panel.getByRole('region', { name: 'Conversation and proposed changes' });
    await viewport.evaluate(element => { element.scrollTop = 80; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
    const before = await viewport.evaluate(element => element.scrollTop);
    context.emit({ kind: 'text', format: 'message', text: 'New response arrived while you read older messages.' });
    await expect(messages.getByText('New response arrived while you read older messages.')).toBeAttached();
    expect(await viewport.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
  } finally { await f.dispose(); }
});

test('Read in a second conversation cancels its own request and keeps background editing active', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin);
  try {
    await openBoard(page); const { panel, context } = await start(page, f, 'Keep editing in the background');
    const questionPanel = await openAI(page, true);
    await questionPanel.getByRole('button', { name: 'Read', exact: true }).click();
    await questionPanel.getByLabel('Message', { exact: true }).fill('Explain the router without changing it');
    await questionPanel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => f.contexts.size).toBe(2);
    const question = [...f.contexts.values()].find(item => item.identity.attemptId !== context.identity.attemptId)!;
    expect(await f.tool<Inspection>(question, 'board_inspect', {})).toMatchObject({ documentId: expect.any(String) });
    await expect(f.tool(question, 'proposal_submit', { operationId: crypto.randomUUID(), label: 'Forbidden Read preview', changes: [] })).rejects.toThrow(/read.only|cannot edit/i);
    await questionPanel.getByTestId('agent-send-controls').getByRole('button', { name: 'Stop request', exact: true }).click();
    await expect.poll(async () => (await taskState(page, question.identity.taskId))?.cancellation).toBe('acknowledged');
    expect((await taskState(page, context.identity.taskId))?.status).toBe('working');
    expect((await taskState(page, context.identity.taskId))?.attempts.at(-1)?.id).toBe(context.identity.attemptId);
    expect(await f.tool<Inspection>(context, 'board_inspect', {})).toMatchObject({ documentId: expect.any(String) });
    await expect(questionPanel.getByRole('button', { name: 'Write behavior: Suggest', exact: true })).toHaveCount(0);
  } finally { await f.dispose(); }
});

test('human Markdown comments survive reload and resolve through the shared Comments index', async ({ page }) => {
  await openBoard(page);
  const index = await openComments(page);
  await index.getByRole('button', { name: 'New conversation', exact: true }).click();
  let thread = page.getByTestId('canvas-conversation-expanded');
  await thread.getByLabel('Write a comment', { exact: true }).fill('## Review notes\n\n**Keep the router**\n\n- Measure latency\n- Compare capacity');
  await thread.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(thread.getByRole('heading', { name: 'Review notes', exact: true })).toBeVisible();
  await expect(thread.locator('strong')).toContainText('Keep the router');
  await expect(thread.getByTestId('collaboration-panel')).toHaveCount(0);
  await thread.getByLabel('Write a comment', { exact: true }).fill('Unsent human draft');
  await thread.getByRole('button', { name: 'Minimize conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Close Comments', exact: true }).click();
  await page.getByTestId('conversation-pin').click();
  await expect(thread.getByLabel('Write a comment', { exact: true })).toHaveValue('Unsent human draft');
  await page.reload();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  const restoredIndex = await openComments(page);
  await restoredIndex.getByRole('button', { name: /^Open Board conversation,/ }).click();
  thread = page.getByTestId('canvas-conversation-expanded');
  await expect(thread.getByRole('heading', { name: 'Review notes', exact: true })).toBeVisible();
  await expect(thread.getByRole('button', { name: 'Ask AI', exact: true })).toBeVisible();
  await thread.getByRole('button', { name: 'Resolve', exact: true }).click();
  await thread.getByRole('button', { name: 'Back to comments', exact: true }).click();
  await restoredIndex.getByRole('combobox', { name: 'Filter comments', exact: true }).selectOption('resolved');
  await restoredIndex.getByRole('button', { name: /^Open Board conversation, Resolved/ }).click();
  await expect(thread.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  await expect(thread.getByRole('heading', { name: 'Review notes', exact: true })).toBeVisible();
});

test('switching an active Write conversation to Read fences its attempt and removes mutation controls', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin, true);
  try {
    await openBoard(page);
    const { panel, context } = await start(page, f, 'Prepare an edit until I restrict permissions');
    await panel.getByRole('button', { name: 'Read', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Read', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('button', { name: 'Write behavior: Suggest', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Accept changes', exact: true })).toHaveCount(0);
    await expect.poll(async () => (await taskState(page, context.identity.taskId))?.cancellation).toBe('pending');
    await expect(f.tool(context, 'board_inspect', {})).rejects.toThrow('revoked');
    f.finishes.get(context.identity.attemptId)!('cancelled');
    await expect.poll(async () => (await taskState(page, context.identity.taskId))?.cancellation).toBe('acknowledged');
    expect(await journal(page)).toHaveLength(0);
  } finally { await f.dispose(); }
});

test('returning Live to Suggest stops the current grant before accepting another message', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin);
  try {
    await openBoard(page);
    const { panel, context } = await start(page, f, 'Work under an explicit Live grant');
    await panel.getByRole('button', { name: 'Write behavior: Suggest', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Allow Live for current request…', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Allow Live for this request', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Write behavior: Live', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Write behavior: Live', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Suggest · approve changes first', exact: true }).click();
    await expect.poll(async () => (await taskState(page, context.identity.taskId))?.cancellation).toBe('acknowledged');
    await expect(panel.getByRole('button', { name: 'Write behavior: Suggest', exact: true })).toBeVisible();
    await expect(f.tool(context, 'board_inspect', {})).rejects.toThrow('revoked');
    expect(await journal(page)).toHaveLength(0);
  } finally { await f.dispose(); }
});

test('conflicting conversations wait durably and require explicit sending after earlier work ends', async ({ page, baseURL }) => {
  const first = await fixture(new URL(baseURL!).origin);
  let recovered: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await openBoard(page);
    const { context } = await start(page, first, 'Keep the board writer until stopped');
    const secondPanel = await openAI(page, true);
    await secondPanel.getByLabel('Message', { exact: true }).fill('Rename the router after earlier work finishes');
    await secondPanel.getByRole('button', { name: 'Send', exact: true }).click();
    const waiting = page.getByTestId('canvas-conversation-expanded').getByRole('region', { name: 'Waiting requests', exact: true });
    await expect(waiting).toContainText('Rename the router after earlier work finishes');
    await expect(waiting.getByRole('button', { name: 'Send waiting request', exact: true })).toBeDisabled();
    expect(first.contexts.size).toBe(1);
    expect((await taskState(page, context.identity.taskId))?.status).toBe('working');

    await page.reload();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    recovered = await fixture(new URL(baseURL!).origin);
    await connect(page, recovered.service);
    await expect(waiting).toContainText('Rename the router after earlier work finishes');
    expect(recovered.contexts.size).toBe(0);
    await expect(waiting.getByRole('button', { name: 'Send waiting request', exact: true })).toBeEnabled();
    await waiting.getByRole('button', { name: 'Send waiting request', exact: true }).click();
    await expect.poll(() => recovered!.contexts.size).toBe(1);
    const next = [...recovered.contexts.values()][0]!;
    expect(next.identity.taskId).not.toBe(context.identity.taskId);
    await expect(waiting).toHaveCount(0);
    expect(await journal(page)).toHaveLength(0);
  } finally { await first.dispose(); await recovered?.dispose(); }
});

test('an object conversation rejects unrelated changes and approves only its captured scope', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin);
  try {
    await openBoard(page);
    await page.locator(`[data-element-id="${ROUTER}"]`).click();
    const { panel, context } = await start(page, f, 'Rename only the linked router');
    const board = await f.tool<Inspection & { task: { editingScope: { ids: string[]; wholeBoard: boolean } } }>(context, 'board_inspect', {});
    expect(board.task.editingScope).toMatchObject({ ids: [ROUTER], wholeBoard: false });
    const unrelated = board.records.find(record => record.type === 'elements' && record.id !== ROUTER)!.data as Element;
    await expect(f.tool(context, 'proposal_submit', { operationId: crypto.randomUUID(), scope: board.scope, expectedRevision: board.revision, label: 'Outside the linked scope', changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...unrelated, label: 'Forbidden rename' } } }] })).rejects.toThrow('Expand the conversation scope');
    expect(await journal(page)).toHaveLength(0);
    await expect(page.locator(`[data-element-id="${unrelated.id}"]`)).not.toContainText('Forbidden rename');
    const router = board.records.find(record => record.id === ROUTER)!.data as Element;
    expect(await f.tool(context, 'proposal_submit', { operationId: crypto.randomUUID(), scope: board.scope, expectedRevision: board.revision, label: 'Rename linked router', changes: [{ kind: 'replace', value: { recordKind: 'element', record: { ...router, label: 'Scoped router' } } }] })).toMatchObject({ ok: true, proposal: { status: 'pending' } });
    f.finishes.get(context.identity.attemptId)!();
    await expect(panel.getByRole('button', { name: 'Accept changes', exact: true })).toBeEnabled();
    await expect(page.locator(`[data-element-id="${ROUTER}"]`)).not.toContainText('Scoped router');
    await panel.getByRole('button', { name: 'Accept changes', exact: true }).click();
    await expect(page.locator(`[data-element-id="${ROUTER}"]`)).toContainText('Scoped router');
    expect(await journal(page)).toHaveLength(1);
  } finally { await f.dispose(); }
});

test('phone collaborator overflow stays compact and opens the same canvas conversation', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('studio:motion', 'off'));
    await openBoard(page);
    for (let index = 0; index < 4; index++) {
      const comments = await openComments(page);
      await comments.getByRole('button', { name: 'New conversation', exact: true }).click();
      await expect(page.getByTestId('conversation-pin')).toHaveCount(index + 1);
      const expanded = page.getByTestId('canvas-conversation-expanded');
      await expanded.getByRole('button', { name: 'Ask AI', exact: true }).click();
      await expect(expanded.getByTestId('collaboration-panel')).toBeVisible();
      await expanded.getByRole('button', { name: 'Minimize conversation', exact: true }).click();
    }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.getByTestId('workspace-topbar').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
      const trigger = page.getByRole('button', { name: /Collaborators:.*4 AI conversations/ });
      const box = (await trigger.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole('button', { name: /Collaborators:.*4 AI conversations/ }).click();
    const choices = page.getByRole('menuitem').filter({ hasText: 'Board conversation' });
    await expect(choices).toHaveCount(4);
    await choices.nth(2).click();
    await expect(page.getByTestId('canvas-conversation-expanded')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Comments', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

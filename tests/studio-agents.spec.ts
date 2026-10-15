import { test, expect, type Page } from './fixtures';
import { startCollaborationServer, type ExecutionBackend, type LocalCollaborationServer } from '@canvas-one/agent-bridge/collaboration-server';
import type { AgentTool } from '@canvas-one/agent-bridge';
import type { Element, View } from '@canvas-one/system-design';

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
async function openAI(page: Page) {
  await page.keyboard.press('ControlOrMeta+k'); await page.getByTestId('quick-options-input').fill('AI collaboration'); await page.getByTestId('quick-option-agents.open').click();
  const panel = page.getByTestId('collaboration-panel'); await expect(panel).toBeVisible(); return panel;
}
async function connect(page: Page, service: LocalCollaborationServer, expectComposer = true) {
  const panel = await openAI(page);
  await expect(panel.getByLabel('Task instruction')).toHaveCount(0);
  await panel.getByLabel('2. Paste connection details').fill(JSON.stringify({ url: service.url, pairingSecret: service.pairingSecret }));
  await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(panel).toContainText('Connected locally');
  if (expectComposer) {
    const draft = panel.getByRole('button', { name: 'Create a draft', exact: true });
    if (await draft.isVisible()) { await draft.click(); await expect(draft).not.toBeVisible(); }
    await expect(panel.getByLabel('Task instruction')).toBeEnabled();
  }
  return panel;
}
async function start(page: Page, f: Awaited<ReturnType<typeof fixture>>, instruction: string) {
  const panel = await connect(page, f.service); await panel.getByLabel('Task instruction').fill(instruction); await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => f.contexts.size).toBe(1); await expect(panel).toContainText('Suggest · review before applying'); return { panel, context: [...f.contexts.values()][0]! };
}
async function journal(page: Page): Promise<{ taskId: string; binding: Record<string, unknown> }[]> {
  return page.evaluate(() => new Promise<{ taskId: string; binding: Record<string, unknown> }[]>((resolve, reject) => {
    const request = indexedDB.open('system-studio-local-v1'); request.onerror = () => reject(new Error('Database unavailable'));
    request.onsuccess = () => { const db = request.result, transaction = db.transaction('agentTaskActions', 'readonly'), rows = transaction.objectStore('agentTaskActions').getAll(); rows.onsuccess = () => resolve(rows.result); rows.onerror = () => reject(new Error('Store unavailable')); transaction.oncomplete = () => db.close(); };
  }));
}

test('connection setup hides the composer through validation, connection and retry and floats independently', async ({ page, baseURL }, testInfo) => {
  const f = await fixture(new URL(baseURL!).origin);
  let releasePair!: () => void;
  const pairGate = new Promise<void>(resolve => { releasePair = resolve; });
  try {
    await openBoard(page); const panel = await openAI(page);
    const floating = page.getByTestId('ai-floating-panel');
    await expect(floating).toBeVisible();
    await expect(panel).toContainText('Connect your local agents');
    await expect(panel.getByLabel('Task instruction')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
    await expect(panel.locator('code')).toContainText(new URL(baseURL!).origin);
    const setupStyle = await panel.getByRole('region', { name: 'Connection setup' }).evaluate(element => ({ family: getComputedStyle(element).fontFamily, size: getComputedStyle(element).fontSize }));
    expect(setupStyle.family).toContain('IBM Plex Sans'); expect(setupStyle.size).toBe('13px');
    const bounds = (await floating.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1512); expect(bounds.y + bounds.height).toBeLessThanOrEqual(982);
    await page.screenshot({ path: testInfo.outputPath('desktop-connection-setup.png'), fullPage: true });
    await panel.getByLabel('2. Paste connection details').fill('invalid connection details');
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByLabel('Task instruction')).toHaveCount(0);
    await page.locator(`[data-element-id="${ROUTER}"]`).click();
    await expect(page.getByTestId('inspector-panel')).toBeVisible();
    const beforeMove = (await floating.boundingBox())!;
    await page.getByRole('button', { name: 'Move AI collaboration panel', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await floating.boundingBox())!.x).toBeLessThan(beforeMove.x);
    await page.getByRole('button', { name: 'Minimize AI collaboration', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await expect(page.getByTestId('inspector-panel')).toBeVisible();
    await page.getByRole('button', { name: 'Restore AI collaboration', exact: true }).click();
    await expect(panel).toBeVisible();
    await page.route(`${f.service.url}/v1/pair`, async route => { await pairGate; await route.abort('failed'); });
    await panel.getByLabel('2. Paste connection details').fill(JSON.stringify({ url: f.service.url, pairingSecret: f.service.pairingSecret }));
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Connecting…', exact: true })).toBeDisabled();
    await expect(panel.getByLabel('Task instruction')).toHaveCount(0);
    releasePair();
    await expect(panel.getByRole('alert')).toContainText('Cannot reach the service');
    await expect(panel.getByLabel('Task instruction')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('desktop-connection-error.png'), fullPage: true });
    await page.unroute(`${f.service.url}/v1/pair`);
    await panel.getByLabel('2. Paste connection details').fill(JSON.stringify({ url: f.service.url, pairingSecret: 'b'.repeat(64) }));
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('The pairing secret expired or was already used.');
    await expect(panel.getByRole('alert')).not.toContainText('invalid-pairing');
    await expect(panel.getByLabel('Task instruction')).toHaveCount(0);
    await panel.locator('summary').filter({ hasText: 'Advanced: enter details manually' }).click();
    await panel.getByLabel('Service address', { exact: true }).fill(f.service.url);
    await panel.getByLabel('Pairing secret', { exact: true }).fill(f.service.pairingSecret);
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel).toContainText('Connected locally');
    await expect(panel.getByLabel('2. Paste connection details')).toHaveCount(0);
    await expect(page.getByTestId('inspector-panel')).toBeVisible();
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
    await phone.getByTestId('topbar-quick-options-btn').click(); await phone.getByTestId('quick-options-input').fill('AI collaboration'); await phone.getByTestId('quick-option-agents.open').click();
    const panel = phone.getByTestId('collaboration-panel'); await expect(panel).toBeVisible(); await expect(panel).toContainText('Continue on desktop'); await expect(panel.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0); await expect(panel.getByLabel('Task instruction')).toHaveCount(0); await expect(panel.getByLabel('2. Paste connection details')).toHaveCount(0);
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
    await expect(panel).toContainText('completed');

    await panel.getByLabel('Task instruction').fill('Wait without changing the board');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => f.contexts.size).toBe(2);
    await panel.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(panel).toContainText('Agent cancellation acknowledged');
    await panel.locator('summary').filter({ hasText: /^Earlier tasks/ }).click();
    await panel.getByRole('button', { name: 'Claude · Rename router for history undo', exact: true }).click();
    const history = panel.getByRole('region', { name: 'Task proposal history' });
    const receipt = history.getByRole('button', { name: 'Historical router rename · accepted', exact: true });
    await receipt.click();
    await expect(panel.getByRole('button', { name: 'Accept changes', exact: true })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Undo task', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'Undo task', exact: true })).toBeVisible();
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
    await openBoard(page); const { panel, context } = await start(page, f, 'Organize the board'); await panel.getByRole('button', { name: 'Allow live edit for this task…', exact: true }).click();
    const grant = page.getByRole('dialog', { name: 'Allow live edit for this task?' }); await expect(grant).toContainText('delete content'); await grant.getByRole('button', { name: 'Allow live edit for this task', exact: true }).click(); await expect(panel).toContainText('Live edit · whole board, including deletions');
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
    await panel.getByRole('button', { name: 'Stop', exact: true }).click(); await expect(panel).toContainText('Agent cancellation acknowledged'); await panel.getByRole('button', { name: 'Undo task', exact: true }).click(); await expect(page.locator(`[data-element-id="${independent.id}"]`)).toContainText('Independent Agent Edit'); await panel.getByRole('button', { name: 'Accept changes', exact: true }).click(); await expect(page.locator(`[data-element-id="${independent.id}"]`)).toContainText(independent.label);
    await page.locator(`[data-element-id="${ROUTER}"]`).click(); await expect(page.getByTestId('inspector-field-config.capacity')).toHaveValue('87');
  } finally { await f.dispose(); }
});

test('independent AI and Inspector panels retain unfinished drafts across AI close and reopen', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin);
  try {
    await openBoard(page); const panel = await connect(page, f.service);
    await panel.getByLabel('Task instruction').fill('Unsent task draft');
    await page.locator(`[data-element-id="${ROUTER}"]`).click(); await page.getByTestId('inspector-field-config.capacity').fill('93');
    await expect(page.getByTestId('inspector-panel')).toBeVisible(); await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Task instruction')).toHaveValue('Unsent task draft');
    await expect(page.getByTestId('inspector-field-config.capacity')).toHaveValue('93'); expect(f.contexts.size).toBe(0);
    await page.getByTestId('inspector-cancel').click();
    await page.getByRole('button', { name: 'Close AI collaboration', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await openAI(page); await expect(panel.getByLabel('Task instruction')).toHaveValue('Unsent task draft'); expect(f.contexts.size).toBe(0);
  } finally { await f.dispose(); }
});

test('Stop fences writes before cancellation close evidence arrives', async ({ page, baseURL }) => {
  const f = await fixture(new URL(baseURL!).origin, true);
  try {
    await openBoard(page); const { panel, context } = await start(page, f, 'Wait for explicit cancellation');
    await panel.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(panel).toContainText('Further board writes are disabled');
    await expect(panel).toContainText('Agent cancellation has not been acknowledged');
    await expect(f.tool(context, 'board_inspect', {})).rejects.toThrow('revoked');
    f.finishes.get(context.identity.attemptId)!('cancelled');
    await expect(panel).toContainText('Agent cancellation acknowledged');
  } finally { await f.dispose(); }
});

test('Disconnect requires explicit Resume with a new attempt and Suggest permission', async ({ page, baseURL }) => {
  const first = await fixture(new URL(baseURL!).origin); let second: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    await openBoard(page); const { panel, context } = await start(page, first, 'Continue after reconnecting');
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(panel).toContainText('Connect your local agents');
    await expect(panel.getByLabel('Task instruction')).toHaveCount(0);
    await first.dispose(); second = await fixture(new URL(baseURL!).origin);
    await connect(page, second.service, false); await expect.poll(() => second!.contexts.size).toBe(0);
    await expect(panel).toContainText('interrupted');
    await panel.getByRole('button', { name: 'Resume task', exact: true }).click();
    await expect.poll(() => second!.contexts.size).toBe(1);
    const resumed = [...second.contexts.values()][0]!;
    expect(resumed.identity.taskId).toBe(context.identity.taskId); expect(resumed.identity.attemptId).not.toBe(context.identity.attemptId); expect(resumed.identity.generation).toBeGreaterThan(context.identity.generation);
    await expect(panel).toContainText('Suggest · review before applying');
    await expect(first.tool(context, 'board_inspect', {})).rejects.toThrow();
    await panel.getByRole('button', { name: 'Stop', exact: true }).click(); await expect(panel).toContainText('Agent cancellation acknowledged');
  } finally { await first.dispose(); await second?.dispose(); }
});

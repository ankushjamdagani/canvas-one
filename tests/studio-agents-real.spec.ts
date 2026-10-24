import { test, expect } from './fixtures';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createLocalExecutionBackend } from '@canvas-one/agent-bridge/runtime';
import { startCollaborationServer, type LocalCollaborationServer } from '@canvas-one/agent-bridge/collaboration-server';

const ROUTER = '816fe039-76dd-5b7b-a787-4d7666ff8d62';

// Explicitly opt in: this launches the signed-in local CLI and consumes model usage.
test('real Claude proposes and applies a node rename through local board authority', async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.CANVAS_ONE_REAL_PROVIDER !== 'claude', 'Set CANVAS_ONE_REAL_PROVIDER=claude to use the signed-in local CLI.');
  test.setTimeout(180000);
  const calls: { request: unknown; result?: unknown; error?: string }[] = [];
  const events: unknown[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  let service!: LocalCollaborationServer;
  const runtime = createLocalExecutionBackend({ mcpCommand: process.execPath, mcpArgs: [resolve('packages/cli/dist/main.js')], serviceUrl: () => service.url });
  const backend: typeof runtime = { ...runtime, launch: context => runtime.launch({ ...context, emit: event => { events.push(structuredClone(event)); context.emit(event); } }) };
  service = await startCollaborationServer({
    allowedOrigins: [new URL(baseURL!).origin], now: () => performance.now(), pairingTtlMs: 60000, sessionTtlMs: 600000,
    leaseMs: 15000, expiryIntervalMs: 1000, maxEventRecords: 2000, maxEventBytes: 4 * 1024 * 1024,
    requestTimeoutMs: 30000, maxBrowserRequests: 64, backend,
    authorize: async (identity, metadata) => await service.requestBrowser(identity, { kind: 'authorize', data: metadata }, new AbortController().signal) === true,
    relay: async (identity, payload, signal) => {
      const call: typeof calls[number] = { request: structuredClone(payload) }; calls.push(call);
      try { const result = await service.requestBrowser(identity, { kind: 'tool', data: payload }, signal); call.result = structuredClone(result); return result; }
      catch (error) { call.error = error instanceof Error ? error.message : String(error); throw error; }
    },
  });
  try {
    await page.goto('/projects');
    await page.getByTestId('create-example-s04').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'idle');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByTestId('quick-options-input').fill('AI collaboration');
    await page.getByTestId('quick-option-agents.open').click();
    const panel = page.getByTestId('collaboration-panel');
    await panel.getByLabel('2. Paste connection details').fill(JSON.stringify({ url: service.url, pairingSecret: service.pairingSecret }));
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('combobox', { name: 'Agent', exact: true })).toBeVisible();
    const draft = panel.getByRole('button', { name: 'Create a draft', exact: true });
    if (await draft.isVisible()) { await draft.click(); await expect(draft).not.toBeVisible(); }
    const router = page.locator(`[data-element-id="${ROUTER}"]`);
    await expect(router).toBeVisible();
    const original = await router.locator('strong').innerText();
    await panel.getByLabel('Task instruction').fill(`Rename the existing router node with id ${ROUTER} to "Real Claude Reviewed Router". Keep everything else unchanged and propose the change for my review.`);
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    const accept = panel.getByRole('button', { name: 'Accept changes', exact: true });
    await expect(accept).toBeEnabled({ timeout: 120000 });
    await expect(router.locator('strong')).toHaveText(original);
    expect(calls.some(call => (call.request as { tool?: string }).tool === 'board_inspect')).toBe(true);
    expect(calls.some(call => (call.request as { tool?: string }).tool === 'proposal_submit')).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('real-claude-rename-review.png'), fullPage: true });
    await accept.click();
    await expect(router).toContainText('Real Claude Reviewed Router');
    const rows = await page.evaluate(() => new Promise<unknown[]>((resolveRows, reject) => {
      const request = indexedDB.open('system-studio-local-v1'); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, transaction = db.transaction('agentTaskActions', 'readonly'), query = transaction.objectStore('agentTaskActions').getAll(); query.onsuccess = () => resolveRows(query.result); query.onerror = () => reject(query.error); transaction.oncomplete = () => db.close(); };
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schema: 'canvas-one/task-action/1', targets: [expect.objectContaining({ id: ROUTER, after: expect.objectContaining({ record: expect.objectContaining({ label: 'Real Claude Reviewed Router' }) }) })] });
    expect(browserErrors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('real-claude-rename-applied.png'), fullPage: true });
  } finally {
    await page.screenshot({ path: testInfo.outputPath('real-claude-final.png'), fullPage: true }).catch(() => {});
    const evidence = { calls, events, browserErrors, panel: await page.getByTestId('collaboration-panel').innerText({ timeout: 1000 }).catch(() => 'Panel unavailable') };
    const evidencePath = testInfo.outputPath('real-provider-evidence.json');
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    await testInfo.attach('real-provider-evidence', { path: evidencePath, contentType: 'application/json' });
    await service.close();
  }
});

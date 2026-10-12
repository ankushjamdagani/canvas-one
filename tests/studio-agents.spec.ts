import { test, expect } from './fixtures';
import { startLocalBridge, type LocalBridge } from '@canvas-one/agent-bridge/server';
import type { AgentTool, BridgeReply } from '@canvas-one/agent-bridge';

test('phone command palette opens reachable AI collaboration controls', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('/projects');
  await page.getByTestId('create-example-s04').click();
  await expect(page.getByTestId('workspace-root')).toBeVisible();
  await page.getByTestId('topbar-quick-options-btn').click();
  await page.getByTestId('quick-options-input').fill('AI collaboration');
  await page.getByTestId('quick-option-agents.open').click();
  const dialog = page.getByTestId('agent-collaboration-dialog');
  await expect(dialog).toBeVisible();
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await expect(dialog.getByLabel('Bridge address')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

async function request<T>(bridge: LocalBridge, tool: AgentTool, input: unknown): Promise<T> {
  const response = await fetch(`${bridge.url}/agent/request`, {
    method: 'POST', headers: { Authorization: `Bearer ${bridge.agentToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), tool, input }),
  });
  expect(response.ok).toBe(true);
  const reply = await response.json() as BridgeReply;
  expect(reply.error).toBeUndefined();
  return reply.result as T;
}

test('real paired agent diagrams remain reviewable, attributed, revision checked and undoable', async ({ page, baseURL }) => {
  const bridge = await startLocalBridge({ port: 0, allowedOrigins: [new URL(baseURL!).origin] });
  try {
    await page.goto('/projects');
    await page.getByTestId('create-example-s05').click();
    await expect(page.getByTestId('workspace-root')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText('Saved');
    await expect(page.locator('.component-node').first()).toBeVisible();
    const initialNodes = await page.locator('.component-node').count();

    // Cmd/Ctrl+K opens the same registered command palette used by toolbar actions.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('quick-options')).toBeVisible();
    await page.getByTestId('quick-options-input').fill('AI collaboration');
    await page.getByTestId('quick-option-agents.open').click();
    const dialog = page.getByTestId('agent-collaboration-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Bridge address').fill(bridge.url);
    await dialog.getByLabel('Pairing code').fill(bridge.pairingCode);
    await dialog.getByRole('button', { name: 'Pair agent', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Connected to Local agent');

    const context = await request<{ scope: { projectId: string; branchId: string }; revision: number; selection: { viewId: string } }>(bridge, 'board_inspect', {});
    const catalog = await request<{ schemas: { type: string }[] }>(bridge, 'component_schemas', {});
    expect(catalog.schemas.length).toBeGreaterThan(0);
    const propose = (operationId: string, label: string) => request<{ ok: boolean; proposal: { actor: { actorId: string; kind: string; displayName: string } } }>(bridge, 'diagram_create', {
      operationId, scope: context.scope, expectedRevision: context.revision, label,
      diagram: { viewId: context.selection.viewId, components: [{ id: 'architecture-explanation', type: catalog.schemas[0].type, label }] },
    });
    const first = await propose('browser-reviewed-diagram', 'Agent architecture explanation');
    expect(first.ok).toBe(true);
    expect(first.proposal.actor).toMatchObject({ kind: 'agent', displayName: 'Local agent' });
    await propose('browser-stale-diagram', 'Stale architecture explanation');
    const reviewed = dialog.locator('article').filter({ hasText: 'Agent architecture explanation' });
    const stale = dialog.locator('article').filter({ hasText: 'Stale architecture explanation' });
    await expect(reviewed).toContainText('Local agent');
    await expect(reviewed).toContainText('pending');
    await expect(reviewed.getByTestId('agent-proposal-preview')).toBeVisible();
    expect(decodeURIComponent((await reviewed.getByTestId('agent-proposal-preview').getAttribute('src'))!)).toContain('Agent architecture explanation');
    await expect(page.locator('.component-node')).toHaveCount(initialNodes);
    await reviewed.getByRole('button', { name: 'Accept changes' }).click();
    await expect(reviewed).toContainText('accepted');
    await expect(page.locator('.component-node')).toHaveCount(initialNodes + 1);
    const receipt = await request<{ status: string; receipt: { proposal: { operationId: string; actor: { actorId: string } } } }>(bridge, 'proposal_status', { operationId: 'browser-reviewed-diagram' });
    expect(receipt.status).toBe('accepted');
    expect(receipt.receipt.proposal).toMatchObject({ operationId: 'browser-reviewed-diagram', actor: { actorId: first.proposal.actor.actorId } });
    await stale.getByRole('button', { name: 'Accept changes' }).click();
    await expect(stale).toContainText('conflict');
    await expect(stale).toContainText('The board changed');
    await expect(page.locator('.component-node')).toHaveCount(initialNodes + 1);
    await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.getByTestId('dock-undo-btn').click();
    await expect(page.locator('.component-node')).toHaveCount(initialNodes);
    await expect(page.getByTestId('save-status')).toContainText('Saved');
  } finally { await bridge.close(); }
});

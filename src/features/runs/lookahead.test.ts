/**
 * The worker computes ahead of the playhead the main thread reports, up to LOOKAHEAD_MS, and then waits.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document, Emission } from '../../domain/studio/model';
import { DEFAULT_BUILD_VERSIONS } from '../../persistence/studio/types';
import { CHECKPOINT_MS, LOOKAHEAD_MS, WorkerProtocolHandler, type HostMessage } from './protocol';

const s06 = JSON.parse(readFileSync(join(process.cwd(), 'src/features/entry/examples/s06.json'), 'utf8')) as Document;
const withEmission = (emission: Emission): Document => ({
  ...s06,
  scenarios: s06.scenarios.map((s, i) => (i === 0 ? { ...s, workloads: s.workloads.map((w) => ({ ...w, emission })) } : s)),
});
const STREAM: Emission = { mode: 'stream', ratePerSecond: 100, profile: { kind: 'steady' } };
const BULK: Emission = { mode: 'bulk', requests: 300, arrival: { spreadMs: 3000 } };

async function start(doc: Document) {
  const messages: HostMessage[] = [];
  const handler = new WorkerProtocolHandler((m) => messages.push(m), { stepBatchSize: 500 });
  const scenarioId = doc.scenarios[0].id;
  await handler.handleMessage({ type: 'compile', requestId: 'r', snapshot: { id: 'snap', document: doc }, scenarioId, versions: DEFAULT_BUILD_VERSIONS });
  const compiled = messages[0];
  if (compiled.type !== 'compile-result' || compiled.result.status !== 'ready') throw new Error('compile failed');
  await handler.handleMessage({
    type: 'start', runId: 'run', snapshotId: 'snap', planId: compiled.result.plan.planId, workerSessionId: compiled.result.plan.workerSessionId, interactive: true,
  });
  const updates = () => messages.flatMap((m) => (m.type === 'update' ? [m.message] : []));
  const waitFor = async (what: () => unknown, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (!what() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  };
  const idle = () => updates().find((u) => u.kind === 'buffer' && u.state === 'idle');
  const terminal = () => updates().find((u) => u.kind === 'terminal');
  return { handler, updates, waitFor, idle, terminal };
}

describe('lookahead', () => {
  it('a stream computes only about LOOKAHEAD_MS ahead of the playhead, then goes idle', async () => {
    const run = await start(withEmission(STREAM));
    await run.waitFor(run.idle);
    const idle = run.idle();
    const computedMs = idle && idle.kind === 'buffer' ? idle.computedMs : -1;
    expect(computedMs).toBeGreaterThanOrEqual(LOOKAHEAD_MS - 2000);
    expect(computedMs).toBeLessThan(LOOKAHEAD_MS + 5000);
    expect(run.terminal()).toBeUndefined();
  }, 30000);

  it('moving the playhead lets it compute further; a Stop lifts the limit and it completes', async () => {
    const run = await start(withEmission(STREAM));
    await run.waitFor(run.idle);
    const checkpoints = () => run.updates().filter((u) => u.kind === 'checkpoint').length;
    const before = checkpoints();
    await run.handler.handleMessage({ type: 'playhead', runId: 'run', simulatedMs: 20_000 });
    await run.waitFor(() => checkpoints() > before + 1);
    expect(checkpoints()).toBeGreaterThan(before);
    expect(run.terminal()).toBeUndefined();
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'stop' });
    await run.waitFor(run.terminal, 20000);
    const t = run.terminal();
    expect(t && t.kind === 'terminal' ? t.status : null).toBe('completed');
  }, 30000);

  it('a far finite playhead lets a bulk run to its end by itself', async () => {
    const run = await start(withEmission(BULK));
    await run.handler.handleMessage({ type: 'playhead', runId: 'run', simulatedMs: 1_000_000_000 });
    await run.waitFor(run.terminal, 20000);
    const t = run.terminal();
    expect(t && t.kind === 'terminal' ? t.status : null).toBe('completed');
  }, 30000);

  it('posts every finished cycle once and a checkpoint about every CHECKPOINT_MS of simulated time', async () => {
    const doc = withEmission({ mode: 'bulk', requests: 300, arrival: { spreadMs: 12_000 } });
    const run = await start(doc);
    await run.handler.handleMessage({ type: 'playhead', runId: 'run', simulatedMs: 1_000_000_000 });
    await run.waitFor(run.terminal, 20000);
    const cycles = run.updates().flatMap((u) => (u.kind === 'cycles' ? u.cycles : []));
    expect(cycles.filter((c) => c.completedAtMs !== null)).toHaveLength(300);
    expect(new Set(cycles.map((c) => c.id)).size).toBe(300);
    const checkpoints = run.updates().flatMap((u) => (u.kind === 'checkpoint' ? [u.checkpoint] : []));
    expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    // The terminal checkpoint is an exact end snapshot, not another periodic interval.
    for (let i = 1; i < checkpoints.length - 1; i++) expect(checkpoints[i].atMs - checkpoints[i - 1].atMs).toBeGreaterThanOrEqual(CHECKPOINT_MS - 1);
    const t = run.terminal();
    expect(checkpoints.at(-1)?.atMs).toBe(t && t.kind === 'terminal' ? t.summary.elapsedMs : null);
    expect(t && t.kind === 'terminal' ? t.summary.cycles.total : 0).toBe(300);
  }, 30000);

  it('cancel still discards, with no results kept', async () => {
    const run = await start(withEmission(STREAM));
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'cancel' });
    await run.waitFor(run.terminal, 5000);
    const t = run.terminal();
    expect(t && t.kind === 'terminal' ? [t.status, t.measured] : null).toEqual(['cancelled', false]);
  });

  it('pause holds the worker; resume lets it go on', async () => {
    const run = await start(withEmission(BULK));
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'pause' });
    await run.handler.handleMessage({ type: 'playhead', runId: 'run', simulatedMs: 1_000_000_000 });
    await new Promise((r) => setTimeout(r, 100));
    const stalled = run.updates().length;
    await new Promise((r) => setTimeout(r, 100));
    expect(run.updates().length).toBe(stalled);
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'resume' });
    await run.waitFor(run.terminal, 20000);
    expect(run.terminal()).toBeDefined();
  }, 30000);
});

/**
 * D55: a run can be paced against the wall clock and stopped; an open-ended run is never unpaced.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '../../domain/studio/model';
import { DEFAULT_BUILD_VERSIONS } from '../../persistence/studio/types';
import { WorkerProtocolHandler, type HostMessage } from './protocol';

const s06 = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s06.json'), 'utf8')) as Document;

/** S06's first scenario with a different completion, so the test needs no network or storage. */
function withCompletion(completion: Document['scenarios'][number]['completion']): Document {
  return { ...s06, scenarios: s06.scenarios.map((s, i) => (i === 0 ? { ...s, completion } : s)) };
}

async function start(doc: Document, speed?: number) {
  const messages: HostMessage[] = [];
  const handler = new WorkerProtocolHandler((msg) => messages.push(msg));
  const scenarioId = doc.scenarios[0].id;
  await handler.handleMessage({ type: 'compile', requestId: 'r', snapshot: { id: 'snap', document: doc }, scenarioId, versions: DEFAULT_BUILD_VERSIONS });
  const compiled = messages[0];
  if (compiled.type !== 'compile-result' || compiled.result.status !== 'ready') throw new Error('compile failed');
  const t0 = Date.now();
  await handler.handleMessage({
    type: 'start', runId: 'run', snapshotId: 'snap', planId: compiled.result.plan.planId, workerSessionId: compiled.result.plan.workerSessionId,
    ...(speed !== undefined ? { speed } : {}),
  });
  const terminal = () => messages.find((m) => m.type === 'update' && m.message.kind === 'terminal');
  const waitFor = async (what: () => unknown, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (!what() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  };
  return { handler, messages, terminal, waitFor, elapsed: () => Date.now() - t0 };
}

const terminalOf = (run: Awaited<ReturnType<typeof start>>) => {
  const m = run.terminal();
  return m && m.type === 'update' && m.message.kind === 'terminal' ? m.message : null;
};

describe('paced runs (D55)', () => {
  it('an unpaced run finishes at once; a paced one takes simulated time divided by speed', async () => {
    const doc = withCompletion({ kind: 'horizon', horizonMs: 2000 });
    const fast = await start(doc);
    await fast.waitFor(fast.terminal, 20000);
    expect(terminalOf(fast)?.status).toBe('completed');
    const fastMs = fast.elapsed();

    // 2 simulated seconds at 4x: about half a second of wall clock.
    const paced = await start(doc, 4);
    await paced.waitFor(paced.terminal, 20000);
    expect(terminalOf(paced)?.status).toBe('completed');
    expect(paced.elapsed()).toBeGreaterThan(350);
    expect(paced.elapsed()).toBeLessThan(2500);
    expect(paced.elapsed()).toBeGreaterThan(fastMs);
  }, 60000);

  it('reports progress while it runs, not only at the end', async () => {
    const run = await start(withCompletion({ kind: 'horizon', horizonMs: 2000 }), 4);
    await run.waitFor(() => run.messages.some((m) => m.type === 'update' && m.message.kind === 'batch'), 5000);
    expect(run.terminal()).toBeUndefined();
    await run.waitFor(run.terminal, 20000);
    expect(terminalOf(run)).not.toBeNull();
  }, 60000);
});

describe('stopping a run (D55)', () => {
  it('an open run goes on until stopped, then drains and completes with its results', async () => {
    const run = await start(withCompletion({ kind: 'open' }), 50);
    await new Promise((r) => setTimeout(r, 300));
    expect(run.terminal()).toBeUndefined();
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'stop' });
    await run.waitFor(run.terminal, 20000);
    const terminal = terminalOf(run);
    expect(terminal?.status).toBe('completed');
    expect(terminal?.measured).toBe(true);
    expect(terminal?.summary.rootCounts.generated).toBeGreaterThan(0);
    expect(terminal?.summary.rootCounts.inFlight).toBe(0);
  }, 60000);

  it('an open run is never unpaced, even when Instant was chosen', async () => {
    const run = await start(withCompletion({ kind: 'open' }));
    await new Promise((r) => setTimeout(r, 300));
    // Unpaced it would have run to the 24-hour ceiling or a budget by now; paced it is still going.
    expect(run.terminal()).toBeUndefined();
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'cancel' });
    await run.waitFor(run.terminal, 5000);
    expect(terminalOf(run)?.status).toBe('cancelled');
  }, 60000);

  it('stop on a paused run resumes it to drain', async () => {
    const run = await start(withCompletion({ kind: 'open' }), 50);
    await new Promise((r) => setTimeout(r, 150));
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'pause' });
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'stop' });
    await run.waitFor(run.terminal, 20000);
    expect(terminalOf(run)?.status).toBe('completed');
  }, 60000);

  it('cancel still discards: no results are kept', async () => {
    const run = await start(withCompletion({ kind: 'open' }), 50);
    await new Promise((r) => setTimeout(r, 100));
    await run.handler.handleMessage({ type: 'control', runId: 'run', kind: 'cancel' });
    await run.waitFor(run.terminal, 5000);
    const terminal = terminalOf(run);
    expect(terminal?.status).toBe('cancelled');
    expect(terminal?.measured).toBe(false);
  }, 60000);
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Document } from '../../domain/studio/model';
import { DEFAULT_BUILD_VERSIONS } from '../../persistence/studio/types';
import {
  WorkerProtocolHandler,
  type HostMessage,
  type RunUpdateMessage,
} from './protocol';

const loadS01 = (): Document =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s01.json'), 'utf8'),
  ) as Document;

const s01Doc = loadS01();

describe('Worker Protocol and Handler (protocol.ts)', () => {
  it('records exact timed measurements and checkpoints the measured final summary', async () => {
    const document = JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures/s06.json'), 'utf8')) as Document;
    const source = document.scenarios[0];
    const snapshot = { id: 'measured', document: { ...document, scenarios: [{ ...source,
      workloads: source.workloads.map(w => ({ ...w, startDelayMs: 5000, emission: { mode: 'bulk' as const, requests: 2, arrival: 'instant' as const } })),
    }] } };
    const messages: HostMessage[] = [];
    let finished!: () => void;
    const terminalReady = new Promise<void>(resolve => { finished = resolve; });
    const handler = new WorkerProtocolHandler(message => {
      messages.push(message);
      if (message.type === 'update' && message.message.kind === 'terminal') finished();
    }, { stepBatchSize: 1 });
    await handler.handleMessage({ type: 'compile', requestId: 'metrics', snapshot, scenarioId: source.id, versions: DEFAULT_BUILD_VERSIONS });
    const compile = messages[0];
    if (compile.type !== 'compile-result' || compile.result.status !== 'ready') throw new Error('Compile failed');
    await handler.handleMessage({ type: 'start', runId: 'metrics', snapshotId: snapshot.id, ...compile.result.plan, interactive: true });
    await terminalReady;
    const updates = messages.flatMap(message => message.type === 'update' ? [message.message] : []);
    const checkpoints = updates.filter(message => message.kind === 'checkpoint');
    expect(checkpoints[0].checkpoint.rootCounts.generated).toBe(0);
    expect(checkpoints.find(message => message.checkpoint.atMs === 5000)?.checkpoint.rootCounts.generated).toBe(2);
    const terminal = updates.find(message => message.kind === 'terminal');
    if (!terminal || terminal.kind !== 'terminal') throw new Error('No terminal');
    expect(checkpoints.at(-1)?.checkpoint).toEqual({ atMs: terminal.summary.elapsedMs,
      rootCounts: terminal.summary.rootCounts, messageCounts: terminal.summary.messageCounts,
      cycles: terminal.summary.cycles, elementMetrics: terminal.summary.elementMetrics });
    const deltas = updates.flatMap(message => message.kind === 'results' ? message.records : []);
    expect(deltas.some(delta => !delta.rootCounts && !delta.messageCounts && delta.elementMetrics?.some(metric => metric.key === 'active' || metric.key === 'queued'))).toBe(true);
  });
  it('compile -> start -> batches -> one terminal for S01', async () => {
    const messages: HostMessage[] = [];
    const handler = new WorkerProtocolHandler((msg) => {
      messages.push(msg);
    });

    const scenarioId = s01Doc.scenarios[0].id;
    const snapshotId = 'test-snapshot-s01';

    // 1. Compile
    await handler.handleMessage({
      type: 'compile',
      requestId: 'req-1',
      snapshot: { id: snapshotId, document: s01Doc },
      scenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });

    expect(messages).toHaveLength(1);
    const compileMsg = messages[0];
    expect(compileMsg.type).toBe('compile-result');
    if (compileMsg.type !== 'compile-result') return;
    expect(compileMsg.result.status).toBe('ready');
    if (compileMsg.result.status !== 'ready') return;

    const planHandle = compileMsg.result.plan;
    expect(planHandle.workerSessionId).toBe(handler.sessionId);
    expect(typeof planHandle.planId).toBe('string');

    // 2. Start
    const runId = 'test-run-1';
    await handler.handleMessage({
      type: 'start',
      runId,
      snapshotId,
      planId: planHandle.planId,
      workerSessionId: planHandle.workerSessionId,
      interactive: true,
    });

    // Wait for stepping batches and terminal to complete
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const hasTerminal = messages.some(
          (m) => m.type === 'update' && m.message.kind === 'terminal',
        );
        if (hasTerminal) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    const updateMessages = messages
      .filter((m): m is RunUpdateMessage => m.type === 'update')
      .map((m) => m.message);

    // Initial state: running
    const stateMessages = updateMessages.filter((m) => m.kind === 'state');
    expect(stateMessages.length).toBeGreaterThanOrEqual(1);
    expect(stateMessages[0].state).toBe('running');

    // Bounded batches
    const batchMessages = updateMessages.filter((m) => m.kind === 'batch');
    expect(batchMessages.length).toBeGreaterThanOrEqual(1);
    expect(batchMessages[0].firstSequence).toBe(0);
    expect(batchMessages[0].events.length).toBeGreaterThan(0);
    expect(batchMessages[0].metrics).toBeNull();

    // Exactly one terminal message
    const terminalMessages = updateMessages.filter((m) => m.kind === 'terminal');
    expect(terminalMessages).toHaveLength(1);
    const term = terminalMessages[0];
    expect(term.status).toBe('completed');
    expect(term.checks.length).toBeGreaterThan(0);
    expect(term.summary.consumedInputs).toBeGreaterThanOrEqual(1);
  });

  it('plan handle single-use rejected', async () => {
    const messages: HostMessage[] = [];
    const handler = new WorkerProtocolHandler((msg) => {
      messages.push(msg);
    });

    const scenarioId = s01Doc.scenarios[0].id;
    const snapshotId = 'test-snapshot-s01';

    await handler.handleMessage({
      type: 'compile',
      requestId: 'req-single-use',
      snapshot: { id: snapshotId, document: s01Doc },
      scenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });

    const compileMsg = messages[0];
    if (compileMsg.type !== 'compile-result' || compileMsg.result.status !== 'ready') {
      throw new Error('Compile failed');
    }
    const plan = compileMsg.result.plan;

    // First start succeeds
    await handler.handleMessage({
      type: 'start',
      runId: 'run-first',
      snapshotId,
      planId: plan.planId,
      workerSessionId: plan.workerSessionId,
      interactive: true,
    });

    // Second start with same handle is rejected
    messages.length = 0;
    await handler.handleMessage({
      type: 'start',
      runId: 'run-second',
      snapshotId,
      planId: plan.planId,
      workerSessionId: plan.workerSessionId,
      interactive: true,
    });

    expect(messages).toHaveLength(1);
    const update = messages[0] as RunUpdateMessage;
    expect(update.message.kind).toBe('terminal');
    if (update.message.kind === 'terminal') {
      expect(update.message.status).toBe('invalid');
      expect(update.message.reason).toContain('already been used');
    }
  });

  it('forged or mismatched plan handle rejected', async () => {
    const messages: HostMessage[] = [];
    const handler = new WorkerProtocolHandler((msg) => {
      messages.push(msg);
    });

    // 1. Forged plan ID
    await handler.handleMessage({
      type: 'start',
      runId: 'run-forged',
      snapshotId: 'snap-1',
      planId: 'forged-plan-id',
      workerSessionId: handler.sessionId,
      interactive: true,
    });

    let update = messages[0] as RunUpdateMessage;
    expect(update.message.kind).toBe('terminal');
    if (update.message.kind === 'terminal') {
      expect(update.message.status).toBe('invalid');
      expect(update.message.reason).toContain('Unknown or expired plan handle');
    }

    // 2. Mismatched worker session
    messages.length = 0;
    await handler.handleMessage({
      type: 'start',
      runId: 'run-mismatched-session',
      snapshotId: 'snap-1',
      planId: 'any-plan-id',
      workerSessionId: 'different-session-id',
      interactive: true,
    });

    update = messages[0] as RunUpdateMessage;
    expect(update.message.kind).toBe('terminal');
    if (update.message.kind === 'terminal') {
      expect(update.message.status).toBe('invalid');
      expect(update.message.reason).toContain('Worker session mismatch');
    }
  });

  it('pause, resume, and cancel control handling', async () => {
    const messages: HostMessage[] = [];
    const handler = new WorkerProtocolHandler(
      (msg) => {
        messages.push(msg);
      },
      { stepBatchSize: 1 },
    );

    const scenarioId = s01Doc.scenarios[0].id;
    const snapshotId = 'test-snapshot-s01';

    await handler.handleMessage({
      type: 'compile',
      requestId: 'req-control',
      snapshot: { id: snapshotId, document: s01Doc },
      scenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });

    const compileMsg = messages[0];
    if (compileMsg.type !== 'compile-result' || compileMsg.result.status !== 'ready') {
      throw new Error('Compile failed');
    }
    const plan = compileMsg.result.plan;

    const runId = 'run-control';
    await handler.handleMessage({
      type: 'start',
      runId,
      snapshotId,
      planId: plan.planId,
      workerSessionId: plan.workerSessionId,
      interactive: true,
    });

    // Pause immediately
    handler.handleMessage({
      type: 'control',
      runId,
      kind: 'pause',
    });

    await new Promise((r) => setTimeout(r, 20));

    // Must have paused state
    const hasPausedState = messages.some(
      (m) => m.type === 'update' && m.message.kind === 'state' && m.message.state === 'paused',
    );
    expect(hasPausedState).toBe(true);

    // Resume
    handler.handleMessage({
      type: 'control',
      runId,
      kind: 'resume',
    });

    // Cancel while active
    handler.handleMessage({
      type: 'control',
      runId,
      kind: 'cancel',
    });

    // Terminal must be cancelled
    const cancelledTerminal = messages.find(
      (m) =>
        m.type === 'update' &&
        m.message.kind === 'terminal' &&
        m.message.status === 'cancelled',
    );
    expect(cancelledTerminal).toBeDefined();
  });

  it('runtime exception sanitized', async () => {
    const messages: HostMessage[] = [];
    const handler = new WorkerProtocolHandler((msg) => {
      messages.push(msg);
    });

    const doc = loadS01();
    // Compile valid scenario
    const scenarioId = doc.scenarios[0].id;
    const snapshotId = 'test-snapshot-s01';

    await handler.handleMessage({
      type: 'compile',
      requestId: 'req-error',
      snapshot: { id: snapshotId, document: doc },
      scenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });

    const compileMsg = messages[0];
    if (compileMsg.type !== 'compile-result' || compileMsg.result.status !== 'ready') {
      throw new Error('Compile failed');
    }
    const plan = compileMsg.result.plan;

    // Mutate the stored plan's document with invalid element behavior to force runtime exception
    (handler as any).plans.get(plan.planId).snapshot.document.elements[0].behavior = null;

    const runId = 'run-err';
    await handler.handleMessage({
      type: 'start',
      runId,
      snapshotId,
      planId: plan.planId,
      workerSessionId: plan.workerSessionId,
      interactive: true,
    });

    await new Promise((r) => setTimeout(r, 40));

    const term = messages.find(
      (m) => m.type === 'update' && m.message.kind === 'terminal',
    ) as RunUpdateMessage | undefined;

    expect(term).toBeDefined();
    if (term && term.message.kind === 'terminal') {
      expect(term.message.status).toBe('failed');
      // Sanitized: must NOT contain stack trace or raw node internal text
      expect(term.message.reason).toBeDefined();
      expect(term.message.reason).not.toContain('at ');
      expect(term.message.reason).not.toContain('.ts');
      expect(term.message.reason).not.toContain('.js');
      expect((term.message as any).measured).toBe(false);
    }
  });

  it('compile rejects scenario missing from snapshot document with invalid status', async () => {
    const messages: HostMessage[] = [];
    const handler = new WorkerProtocolHandler((msg) => {
      messages.push(msg);
    });

    const nonExistentScenarioId = 'non-existent-scenario-999';
    await handler.handleMessage({
      type: 'compile',
      requestId: 'req-missing-scenario',
      snapshot: { id: 'snap-1', document: s01Doc },
      scenarioId: nonExistentScenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });

    expect(messages).toHaveLength(1);
    const compileMsg = messages[0];
    expect(compileMsg.type).toBe('compile-result');
    if (compileMsg.type === 'compile-result') {
      expect(compileMsg.result.status).toBe('invalid');
      expect((compileMsg.result as any).issues[0]?.message).toContain(nonExistentScenarioId);
    }
  });

  it('start rejects plan whose scenario is missing from snapshot with terminal invalid and measured:false', async () => {
    const messages: HostMessage[] = [];
    const handler = new WorkerProtocolHandler((msg) => {
      messages.push(msg);
    });

    const scenarioId = s01Doc.scenarios[0].id;
    const snapshotId = 'test-snapshot-s01';

    await handler.handleMessage({
      type: 'compile',
      requestId: 'req-compile',
      snapshot: { id: snapshotId, document: s01Doc },
      scenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });

    const compileMsg = messages[0];
    if (compileMsg.type !== 'compile-result' || compileMsg.result.status !== 'ready') {
      throw new Error('Compile failed');
    }
    const plan = compileMsg.result.plan;

    // Mutate the stored plan's document so the scenario is missing
    const storedPlan = (handler as any).plans.get(plan.planId);
    storedPlan.snapshot = {
      ...storedPlan.snapshot,
      document: {
        ...storedPlan.snapshot.document,
        scenarios: [],
      },
    };

    messages.length = 0;
    await handler.handleMessage({
      type: 'start',
      runId: 'run-missing-scen-at-start',
      snapshotId,
      planId: plan.planId,
      workerSessionId: plan.workerSessionId,
      interactive: true,
    });

    expect(messages).toHaveLength(1);
    const update = messages[0] as RunUpdateMessage;
    expect(update.message.kind).toBe('terminal');
    if (update.message.kind === 'terminal') {
      expect(update.message.status).toBe('invalid');
      expect(update.message.reason).toContain(scenarioId);
      expect((update.message as any).measured).toBe(false);
    }
  });

  it('marks terminals as measured:true on normal completion and measured:false on cancel/failure without fabricated values', async () => {
    const messages: HostMessage[] = [];
    const handler = new WorkerProtocolHandler((msg) => {
      messages.push(msg);
    });

    const scenarioId = s01Doc.scenarios[0].id;
    const snapshotId = 'test-snapshot-s01';

    // 1. Normal completion -> measured: true
    await handler.handleMessage({
      type: 'compile',
      requestId: 'req-c1',
      snapshot: { id: snapshotId, document: s01Doc },
      scenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });
    const plan1 = (messages[0] as any).result.plan;

    await handler.handleMessage({
      type: 'start',
      runId: 'run-measure-true',
      snapshotId,
      planId: plan1.planId,
      workerSessionId: plan1.workerSessionId,
      interactive: true,
    });

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const hasTerminal = messages.some(
          (m) => m.type === 'update' && m.message.kind === 'terminal' && m.message.runId === 'run-measure-true',
        );
        if (hasTerminal) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });

    const normalTerm = messages.find(
      (m) => m.type === 'update' && m.message.kind === 'terminal' && m.message.runId === 'run-measure-true',
    ) as RunUpdateMessage;
    expect((normalTerm.message as any).measured).toBe(true);

    // 2. Cancellation -> measured: false, no mixed fallback summary
    messages.length = 0;
    await handler.handleMessage({
      type: 'compile',
      requestId: 'req-c2',
      snapshot: { id: snapshotId, document: s01Doc },
      scenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });
    const plan2 = (messages[0] as any).result.plan;

    await handler.handleMessage({
      type: 'start',
      runId: 'run-cancel-false',
      snapshotId,
      planId: plan2.planId,
      workerSessionId: plan2.workerSessionId,
      interactive: true,
    });

    await handler.handleMessage({
      type: 'control',
      runId: 'run-cancel-false',
      kind: 'cancel',
    });

    const cancelTerm = messages.find(
      (m) => m.type === 'update' && m.message.kind === 'terminal' && m.message.runId === 'run-cancel-false',
    ) as RunUpdateMessage;
    expect((cancelTerm.message as any).measured).toBe(false);
  });
});

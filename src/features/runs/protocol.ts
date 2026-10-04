/**
 * Plain serializable worker protocol and in-process handler (RV-12c4).
 *
 * Implements specs/revamp/contracts/model-and-runner.md §8:
 * - compile: prepares scenario, returns manifest, fingerprint and single-use plan handle.
 * - start: verifies handle (session, planId, snapshotId, unused), steps ScenarioRunner
 *   in bounded batches posting state, batch and exactly one terminal.
 * - control: pause at batch boundary, resume, cancel -> terminal 'cancelled'.
 * - Runtime exception -> terminal 'failed' with a sanitized reason (no stack/raw text).
 * - Handles die on cancel/terminal/worker restart.
 */

import type { Id } from '../../domain/studio/model';
import type { BuildManifestVersions, ExecutionManifest } from '../../domain/studio/manifest';
import {
  prepareScenario,
  type PrepareIssue,
} from '../../domain/studio/runner/compile';
import { ScenarioRunner } from '../../domain/studio/runner/scenario-runner';
import type {
  AuthoredSnapshot,
  CheckResult,
  Cycle,
  FlowRecord,
  ResultDelta,
  RunCheckpoint,
  RunControl,
  RunSummary,
  RunUpdate,
  TerminalStatus,
} from '../../domain/studio/runner/types';

// ============================================================================
// Protocol Message Definitions
// ============================================================================

export type CompileRequestMessage = {
  readonly type: 'compile';
  readonly requestId: string;
  readonly snapshot: AuthoredSnapshot;
  readonly scenarioId: Id;
  readonly versions: BuildManifestVersions;
};

export type CompileSuccessResult = {
  readonly status: 'ready';
  readonly manifest: ExecutionManifest;
  readonly fingerprint: string;
  readonly plan: {
    readonly workerSessionId: string;
    readonly planId: string;
  };
};

export type CompileFailureResult = {
  readonly status: 'invalid' | 'analysis-limit' | 'cancelled';
  readonly issues: readonly PrepareIssue[];
};

export type CompileResult = CompileSuccessResult | CompileFailureResult;

export type CompileResultMessage = {
  readonly type: 'compile-result';
  readonly requestId: string;
  readonly result: CompileResult;
};

export type StartRequestMessage = {
  readonly type: 'start';
  readonly runId: string;
  readonly snapshotId: string;
  readonly planId: string;
  readonly workerSessionId: string;
  /** Individual timed runs record interactively; batch/logical runs compute without a playhead allowance. */
  readonly interactive: boolean;
};

export type ControlRequestMessage = {
  readonly type: 'control';
  readonly runId: string;
  readonly kind: RunControl['kind'];
};

export type ProtocolTerminalUpdate = {
  readonly kind: 'terminal';
  readonly runId: string;
  readonly status: TerminalStatus;
  readonly checks: readonly CheckResult[];
  readonly summary: RunSummary;
  readonly reason: string | null;
  readonly measured: boolean;
};

/** Live canvas view: the packet steps since the last report; not part of the run's trace. */
export type ProtocolFlowUpdate = { readonly kind: 'flow'; readonly runId: string; readonly records: readonly FlowRecord[] };

/** D57: cycles that completed since the last report (a stream's cycles leave the worker once sent). */
export type ProtocolCyclesUpdate = { readonly kind: 'cycles'; readonly runId: string; readonly cycles: readonly Cycle[] };

/** D57: the run's cumulative summary at one simulated time, about every `CHECKPOINT_MS`. */
export type ProtocolCheckpointUpdate = { readonly kind: 'checkpoint'; readonly runId: string; readonly checkpoint: RunCheckpoint };
export type ProtocolResultsUpdate = { readonly kind: 'results'; readonly runId: string; readonly records: readonly ResultDelta[] };

/**
 * D57: what the worker is doing. `computing`: stepping; `idle`: waiting for the playhead because it is
 * `LOOKAHEAD_MS` ahead; `draining`: Stop was pressed and the limit is lifted.
 */
export type ProtocolBufferUpdate = {
  readonly kind: 'buffer';
  readonly runId: string;
  readonly state: 'computing' | 'idle' | 'draining';
  readonly computedMs: number;
};

export type ProtocolRunUpdate =
  | Exclude<RunUpdate, { kind: 'terminal' }>
  | ProtocolTerminalUpdate
  | ProtocolFlowUpdate
  | ProtocolCyclesUpdate
  | ProtocolCheckpointUpdate
  | ProtocolResultsUpdate
  | ProtocolBufferUpdate;

export type RunUpdateMessage = {
  readonly type: 'update';
  readonly message: ProtocolRunUpdate;
};

/**
 * D57: where the main thread's playhead is, in simulated ms (Infinity = no limit). The worker computes up to
 * `LOOKAHEAD_MS` beyond it and then waits; a larger value wakes it.
 */
export type PlayheadMessage = {
  readonly type: 'playhead';
  readonly runId: string;
  readonly simulatedMs: number;
};

export type WorkerMessage = CompileRequestMessage | StartRequestMessage | ControlRequestMessage | PlayheadMessage;
export type HostMessage = CompileResultMessage | RunUpdateMessage;

// ============================================================================
// Helper: Empty Summary for Non-Normal Terminals
// ============================================================================

import { createEmptySummary } from './summary';
export { createEmptySummary };

// ============================================================================
// Internal Types for Protocol Handler
// ============================================================================

type StoredPlan = {
  readonly planId: string;
  readonly workerSessionId: string;
  readonly snapshot: AuthoredSnapshot;
  readonly scenarioId: Id;
  readonly manifest: ExecutionManifest;
  readonly fingerprint: string;
  used: boolean;
};

/** D57: how far ahead of the playhead the worker computes, in simulated ms. */
export const LOOKAHEAD_MS = 30_000;
/** D57: how often (simulated ms) the worker posts a cumulative summary. */
export const CHECKPOINT_MS = 5_000;

type ActiveRun = {
  readonly runId: string;
  readonly planId: string;
  readonly runner: ScenarioRunner;
  readonly abortController: AbortController;
  readonly scenarioMode: 'logical' | 'timed';
  status: 'running' | 'paused' | 'cancelled';
  lastReportedEventCount: number;
  steppingPromise: Promise<void> | null;
  /** D57: the main thread's playhead (simulated ms); the worker computes up to `LOOKAHEAD_MS` beyond it. */
  playheadMs: number;
  /** D55: Stop was pressed; the lookahead limit is lifted so the run can drain. */
  stopping: boolean;
  /** D57: stepping has paused at the lookahead limit and waits for the playhead (or Stop). */
  idle: boolean;
  lastCheckpointMs: number;
  readonly interactive: boolean;
};

// ============================================================================
// Pure In-Process Worker Protocol Handler
// ============================================================================

export class WorkerProtocolHandler {
  private readonly workerSessionId: string;
  private readonly postMessageCallback: (msg: HostMessage) => void;
  private readonly stepBatchSize: number;

  private readonly plans = new Map<string, StoredPlan>();
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(
    postMessageCallback: (msg: HostMessage) => void,
    options: { stepBatchSize?: number; workerSessionId?: string } = {},
  ) {
    this.postMessageCallback = postMessageCallback;
    this.workerSessionId = options.workerSessionId ?? crypto.randomUUID();
    this.stepBatchSize = options.stepBatchSize ?? 50;
  }

  get sessionId(): string {
    return this.workerSessionId;
  }

  /**
   * Resets all state (cancels active runs, invalidates all plans).
   * Models a worker restart or explicit reset.
   */
  reset(): void {
    for (const [runId, active] of this.activeRuns.entries()) {
      active.abortController.abort();
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: 'cancelled',
          checks: [],
          summary: createEmptySummary(active.scenarioMode),
          reason: 'Worker reset',
          measured: false,
        },
      });
    }
    this.activeRuns.clear();
    this.plans.clear();
  }

  async handleMessage(msg: WorkerMessage): Promise<void> {
    switch (msg.type) {
      case 'compile':
        await this.handleCompile(msg);
        break;
      case 'start':
        await this.handleStart(msg);
        break;
      case 'control':
        this.handleControl(msg);
        break;
      case 'playhead':
        this.handlePlayhead(msg);
        break;
    }
  }

  private async handleCompile(msg: CompileRequestMessage): Promise<void> {
    const { requestId, snapshot, scenarioId, versions } = msg;

    const scenario = snapshot.document.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) {
      this.postMessageCallback({
        type: 'compile-result',
        requestId,
        result: {
          status: 'invalid',
          issues: [
            {
              code: 'missing-target',
              path: ['scenarios'],
              entityId: scenarioId,
              severity: 'error',
              message: `Scenario '${scenarioId}' not found in snapshot.`,
            },
          ],
        },
      });
      return;
    }

    const ac = new AbortController();

    try {
      const res = await prepareScenario(snapshot, scenarioId, ac.signal, versions);

      if (res.status === 'ready') {
        const planId = crypto.randomUUID();
        const storedPlan: StoredPlan = {
          planId,
          workerSessionId: this.workerSessionId,
          snapshot,
          scenarioId,
          manifest: res.manifest,
          fingerprint: res.fingerprint,
          used: false,
        };
        this.plans.set(planId, storedPlan);

        this.postMessageCallback({
          type: 'compile-result',
          requestId,
          result: {
            status: 'ready',
            manifest: res.manifest,
            fingerprint: res.fingerprint,
            plan: {
              workerSessionId: this.workerSessionId,
              planId,
            },
          },
        });
      } else {
        this.postMessageCallback({
          type: 'compile-result',
          requestId,
          result: {
            status: res.status,
            issues: res.issues,
          },
        });
      }
    } catch {
      // Runtime failure during compile -> sanitized issue
      this.postMessageCallback({
        type: 'compile-result',
        requestId,
        result: {
          status: 'invalid',
          issues: [
            {
              code: 'structural-rule',
              path: [],
              entityId: null,
              severity: 'error',
              message: 'Scenario compilation failed due to an unexpected error.',
            },
          ],
        },
      });
    }
  }

  private async handleStart(msg: StartRequestMessage): Promise<void> {
    const { runId, snapshotId, planId, workerSessionId } = msg;

    // 1. Verify worker session
    if (workerSessionId !== this.workerSessionId) {
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: 'invalid',
          checks: [],
          summary: createEmptySummary('logical'),
          reason: 'Worker session mismatch: plan handle is from a different worker session.',
          measured: false,
        },
      });
      return;
    }

    // 2. Verify plan exists
    const plan = this.plans.get(planId);
    if (!plan) {
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: 'invalid',
          checks: [],
          summary: createEmptySummary('logical'),
          reason: 'Unknown or expired plan handle.',
          measured: false,
        },
      });
      return;
    }

    // 3. Verify single-use
    if (plan.used) {
      // Handles die on cancel/terminal
      this.plans.delete(planId);
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: 'invalid',
          checks: [],
          summary: createEmptySummary('logical'),
          reason: 'Plan handle has already been used.',
          measured: false,
        },
      });
      return;
    }

    // 4. Verify snapshotId match
    if (plan.snapshot.id !== snapshotId) {
      this.plans.delete(planId);
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: 'invalid',
          checks: [],
          summary: createEmptySummary('logical'),
          reason: 'Snapshot ID does not match plan handle.',
          measured: false,
        },
      });
      return;
    }

    // Mark plan as used immediately
    plan.used = true;

    const scenario = plan.snapshot.document.scenarios.find((s) => s.id === plan.scenarioId);
    if (!scenario) {
      this.plans.delete(planId);
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: 'invalid',
          checks: [],
          summary: createEmptySummary('logical'),
          reason: `Scenario '${plan.scenarioId}' not found in snapshot.`,
          measured: false,
        },
      });
      return;
    }
    const scenarioMode = scenario.mode;
    const abortController = new AbortController();

    let runner: ScenarioRunner;
    try {
      runner = new ScenarioRunner(plan.snapshot.document, plan.scenarioId, runId, {
        signal: abortController.signal,
        streamOutCycles: true,
      });
    } catch {
      this.plans.delete(planId);
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: 'failed',
          checks: [],
          summary: createEmptySummary(scenarioMode),
          reason: 'Failed to initialize scenario runner.',
          measured: false,
        },
      });
      return;
    }

    const activeRun: ActiveRun = {
      runId,
      planId,
      runner,
      abortController,
      scenarioMode,
      status: 'running',
      lastReportedEventCount: 0,
      steppingPromise: null,
      playheadMs: 0,
      stopping: false,
      idle: false,
      lastCheckpointMs: 0,
      interactive: msg.interactive && scenarioMode === 'timed',
    };
    this.activeRuns.set(runId, activeRun);

    // Initial state: running
    this.postMessageCallback({
      type: 'update',
      message: {
        kind: 'state',
        runId,
        state: 'running',
      },
    });

    this.postMessageCallback({ type: 'update', message: { kind: 'buffer', runId, state: 'computing', computedMs: 0 } });
    if (scenarioMode === 'timed') {
      this.postMessageCallback({ type: 'update', message: { kind: 'checkpoint', runId, checkpoint: runner.checkpoint() } });
    }

    // Start stepping loop
    this.scheduleStepping(runId);
  }

  /** D57: the playhead moved; a worker waiting at the lookahead limit may have room to compute again. */
  private handlePlayhead(msg: PlayheadMessage): void {
    const active = this.activeRuns.get(msg.runId);
    if (!active || !Number.isFinite(msg.simulatedMs) || msg.simulatedMs < 0 || msg.simulatedMs === active.playheadMs) return;
    active.playheadMs = msg.simulatedMs;
    this.wakeIfRoom(active);
  }

  /** D57: the furthest simulated ms the worker may compute to right now. */
  private computeLimitMs(active: ActiveRun): number {
    return active.stopping || !active.interactive ? Infinity : active.playheadMs + LOOKAHEAD_MS;
  }

  private wakeIfRoom(active: ActiveRun): void {
    if (!active.idle || active.status !== 'running') return;
    const next = active.runner.nextEventAtMs();
    if (next !== null && next > this.computeLimitMs(active)) return;
    active.idle = false;
    this.postMessageCallback({
      type: 'update',
      message: { kind: 'buffer', runId: active.runId, state: active.stopping ? 'draining' : 'computing', computedMs: active.runner.simulatedMs },
    });
    this.scheduleStepping(active.runId);
  }

  private handleControl(msg: ControlRequestMessage): void {
    const { runId, kind } = msg;
    const active = this.activeRuns.get(runId);
    if (!active) {
      return;
    }

    if (kind === 'pause') {
      if (active.status === 'running') {
        active.status = 'paused';
        this.postMessageCallback({
          type: 'update',
          message: {
            kind: 'state',
            runId,
            state: 'paused',
          },
        });
      }
    } else if (kind === 'resume') {
      if (active.status === 'paused') {
        active.status = 'running';
        this.postMessageCallback({
          type: 'update',
          message: {
            kind: 'state',
            runId,
            state: 'running',
          },
        });
        this.scheduleStepping(runId);
      }
    } else if (kind === 'stop') {
      // D55: stop arrivals and drain; a paused run resumes to do so. D57: Stop lifts the lookahead limit.
      active.runner.requestStop();
      active.stopping = true;
      this.postMessageCallback({ type: 'update', message: { kind: 'buffer', runId, state: 'draining', computedMs: active.runner.simulatedMs } });
      if (active.status === 'paused') {
        active.status = 'running';
        this.postMessageCallback({ type: 'update', message: { kind: 'state', runId, state: 'running' } });
        this.scheduleStepping(runId);
      } else {
        this.wakeIfRoom(active);
      }
    } else if (kind === 'cancel') {
      active.status = 'cancelled';
      active.abortController.abort();
      this.cleanupTerminal(runId, active, { status: 'cancelled', reason: null });
    }
  }

  private scheduleStepping(runId: string, delayMs = 0): void {
    const active = this.activeRuns.get(runId);
    if (!active || active.status !== 'running') {
      return;
    }

    // Yield to the event loop so incoming control messages can be received
    setTimeout(() => {
      void this.stepRun(runId);
    }, delayMs);
  }

  private async stepRun(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (!active || active.status !== 'running') {
      return;
    }

    try {
      let stepsInBatch = 0;
      let hasMore = true;
      let reachedLimit = false;
      const resultDeltas: ResultDelta[] = [];

      while (stepsInBatch < this.stepBatchSize && active.status === 'running') {
        // D57: the worker computes only up to LOOKAHEAD_MS ahead of the playhead; Stop lifts the limit.
        const next = active.runner.nextEventAtMs();
        if (next !== null && next > this.computeLimitMs(active)) {
          reachedLimit = true;
          break;
        }
        hasMore = await active.runner.step();
        // All scheduler work at one rounded millisecond is one observable instant. Capture after its
        // final discrete step so same-ms changes are coalesced without repeatedly snapshotting the adapter.
        const nextAfterStep = active.runner.nextEventAtMs();
        const resultDelta = active.interactive && (!hasMore || nextAfterStep === null || nextAfterStep !== active.runner.simulatedMs)
          ? active.runner.captureResultDelta()
          : null;
        if (resultDelta) {
          const prior = resultDeltas[resultDeltas.length - 1];
          if (prior?.atMs === resultDelta.atMs) {
            const metrics = new Map((prior.elementMetrics ?? []).map((m) => [`${m.elementId ?? ''}\u0000${m.scope}\u0000${m.key}`, m]));
            for (const metric of resultDelta.elementMetrics ?? []) metrics.set(`${metric.elementId ?? ''}\u0000${metric.scope}\u0000${metric.key}`, metric);
            resultDeltas[resultDeltas.length - 1] = {
              atMs: resultDelta.atMs,
              rootCounts: resultDelta.rootCounts ?? prior.rootCounts,
              messageCounts: resultDelta.messageCounts ?? prior.messageCounts,
              occupancyRates: resultDelta.occupancyRates ?? prior.occupancyRates,
              ...((metrics.size > 0) ? { elementMetrics: [...metrics.values()] } : {}),
            };
          } else resultDeltas.push(resultDelta);
        }
        stepsInBatch++;
        if (!hasMore) {
          break;
        }
      }

      // Check if cancelled during batch
      const statusAfterBatch: string = active.status;
      if (statusAfterBatch === 'cancelled') {
        this.cleanupTerminal(runId, active, { status: 'cancelled', reason: null });
        return;
      }

      const flow = active.runner.drainFlow();
      if (flow.length > 0) {
        this.postMessageCallback({ type: 'update', message: { kind: 'flow', runId, records: flow } });
      }
      if (resultDeltas.length > 0) {
        this.postMessageCallback({ type: 'update', message: { kind: 'results', runId, records: resultDeltas } });
      }

      const finishedCycles = active.runner.drainCycles();
      if (finishedCycles.length > 0) {
        this.postMessageCallback({ type: 'update', message: { kind: 'cycles', runId, cycles: finishedCycles } });
      }
      if (hasMore && active.runner.simulatedMs >= active.lastCheckpointMs + CHECKPOINT_MS) {
        active.lastCheckpointMs = active.runner.simulatedMs;
        this.postMessageCallback({ type: 'update', message: { kind: 'checkpoint', runId, checkpoint: active.runner.checkpoint() } });
      }

      // Check for newly recorded events
      const allEvents = active.runner.getResult().events;
      if (allEvents.length > active.lastReportedEventCount) {
        const newEvents = allEvents.slice(active.lastReportedEventCount);
        active.lastReportedEventCount = allEvents.length;

        this.postMessageCallback({
          type: 'update',
          message: {
            kind: 'batch',
            runId,
            firstSequence: newEvents[0].sequence,
            events: newEvents,
            metrics: null,
          },
        });
      }

      // If paused at batch boundary
      if (statusAfterBatch === 'paused') {
        this.postMessageCallback({
          type: 'update',
          message: {
            kind: 'state',
            runId,
            state: 'paused',
          },
        });
        return;
      }

      // If runner has completed or terminated
      if (!hasMore) {
        const res = active.runner.getResult();
        this.cleanupTerminal(runId, active, null, res);
        return;
      }

      // D57: at the lookahead limit, report it once and wait for the playhead (or Stop) to wake the loop.
      if (reachedLimit) {
        active.idle = true;
        this.postMessageCallback({
          type: 'update',
          message: { kind: 'buffer', runId, state: 'idle', computedMs: active.runner.simulatedMs },
        });
        return;
      }

      // Continue to next batch
      this.scheduleStepping(runId);
    } catch {
      // Runtime exception -> terminal 'failed' with a sanitized reason (no stack/raw text)
      this.cleanupTerminal(
        runId,
        active,
        { status: 'failed', reason: 'Runtime exception during scenario execution' },
      );
    }
  }

  private cleanupTerminal(
    runId: string,
    active: ActiveRun,
    failure: { status: TerminalStatus; reason: string | null } | null,
    runnerResult?: {
      readonly status: TerminalStatus;
      readonly checks: readonly CheckResult[];
      readonly summary: RunSummary;
      readonly reason: string | null;
    },
  ): void {
    this.activeRuns.delete(runId);
    this.plans.delete(active.planId);

    if (runnerResult) {
      if (active.interactive) {
        const summary = runnerResult.summary;
        this.postMessageCallback({ type: 'update', message: { kind: 'checkpoint', runId, checkpoint: {
          atMs: summary.elapsedMs ?? active.runner.simulatedMs,
          rootCounts: summary.rootCounts, messageCounts: summary.messageCounts,
          cycles: summary.cycles, elementMetrics: summary.elementMetrics,
        } } });
      }
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: runnerResult.status,
          checks: runnerResult.checks,
          summary: runnerResult.summary,
          reason: runnerResult.reason,
          measured: true,
        },
      });
    } else {
      this.postMessageCallback({
        type: 'update',
        message: {
          kind: 'terminal',
          runId,
          status: failure?.status ?? 'failed',
          checks: [],
          summary: createEmptySummary(active.scenarioMode),
          reason: failure?.reason ?? null,
          measured: false,
        },
      });
    }
  }
}

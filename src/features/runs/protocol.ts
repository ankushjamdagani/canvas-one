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
  FlowRecord,
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
  /**
   * D55: how fast simulated time passes against the wall clock, in simulated seconds per real
   * second (1 = real time, 10 = ten times faster). Absent or 0 runs as fast as the machine can,
   * except that an open-ended run (which never ends by itself) is paced at least `OPEN_RUN_MIN_SPEED`.
   */
  readonly speed?: number;
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

export type ProtocolRunUpdate =
  | Exclude<RunUpdate, { kind: 'terminal' }>
  | ProtocolTerminalUpdate
  | ProtocolFlowUpdate;

export type RunUpdateMessage = {
  readonly type: 'update';
  readonly message: ProtocolRunUpdate;
};

export type WorkerMessage = CompileRequestMessage | StartRequestMessage | ControlRequestMessage;
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

type ActiveRun = {
  readonly runId: string;
  readonly planId: string;
  readonly runner: ScenarioRunner;
  readonly abortController: AbortController;
  readonly scenarioMode: 'logical' | 'timed';
  status: 'running' | 'paused' | 'cancelled';
  lastReportedEventCount: number;
  steppingPromise: Promise<void> | null;
  /** D55: simulated seconds per real second; 0 = unpaced. */
  readonly speed: number;
  /** D55: the wall clock and the simulated clock at the moment pacing was last anchored. */
  paceWallMs: number;
  paceSimMs: number;
};

/** D55: an open-ended run never ends by itself, so it is never unpaced. */
export const OPEN_RUN_MIN_SPEED = 10;

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

    const requestedSpeed = typeof msg.speed === 'number' && msg.speed > 0 ? msg.speed : 0;
    const speed =
      scenarioMode !== 'timed' ? 0 : scenario.completion.kind === 'open' ? Math.max(requestedSpeed, OPEN_RUN_MIN_SPEED) : requestedSpeed;
    const activeRun: ActiveRun = {
      runId,
      planId,
      runner,
      abortController,
      scenarioMode,
      status: 'running',
      lastReportedEventCount: 0,
      steppingPromise: null,
      speed,
      paceWallMs: Date.now(),
      paceSimMs: 0,
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

    // Start stepping loop
    this.scheduleStepping(runId);
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
        this.anchorPacing(active);
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
      // D55: stop arrivals and drain; a paused run resumes to do so.
      active.runner.requestStop();
      if (active.status === 'paused') {
        active.status = 'running';
        this.anchorPacing(active);
        this.postMessageCallback({ type: 'update', message: { kind: 'state', runId, state: 'running' } });
        this.scheduleStepping(runId);
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

  /** D55: measure paced simulated time from now (after a pause, or at the start). */
  private anchorPacing(active: ActiveRun): void {
    active.paceWallMs = Date.now();
    active.paceSimMs = active.runner.simulatedMs;
  }

  /** D55: how long to wait before the next event is due on the paced clock; 0 when unpaced or already due. */
  private paceDelayMs(active: ActiveRun): number {
    if (active.speed <= 0) return 0;
    const next = active.runner.nextEventAtMs();
    if (next === null) return 0;
    const dueWallMs = active.paceWallMs + (next - active.paceSimMs) / active.speed;
    return Math.max(0, dueWallMs - Date.now());
  }

  private async stepRun(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (!active || active.status !== 'running') {
      return;
    }

    try {
      let stepsInBatch = 0;
      let hasMore = true;
      let waitMs = 0;

      while (stepsInBatch < this.stepBatchSize && active.status === 'running') {
        // D55: a paced run waits until the next event is due on the wall clock, after reporting what it has done.
        waitMs = this.paceDelayMs(active);
        if (waitMs >= 1) break;
        waitMs = 0;
        hasMore = await active.runner.step();
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

      // Continue to next batch (after the pacing wait, if any)
      // (capped so a pause, stop or cancel is never more than a moment from being noticed)
      this.scheduleStepping(runId, Math.min(waitMs, 100));
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

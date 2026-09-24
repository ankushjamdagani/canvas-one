/**
 * Main-thread Run Controller (RV-12c4).
 *
 * Implements specs/revamp/contracts/model-and-runner.md §8 & storage.md §5:
 * - constructor takes { repository, mintId, transport, projectId-agnostic }.
 * - run({ projectId, branchId, snapshotId, document, scenarioId }) and runAll.
 * - Mints unforgeable start token (mintRunStartToken bound to
 *   projectId/runId/snapshotId/manifest/fingerprint/document).
 * - Buffers batches within trace caps (never drops terminal; truncation per trace envelope).
 * - saveRun on terminal. No durable pass shown until saved.
 * - Save failure keeps terminal visible "Not saved" + retrySave().
 * - Reset = cancel if running, then clear display (saved runs kept).
 * - Stale run IDs ignored.
 * - Reactive state via subscribe / getState.
 *
 * CONTRACT INVARIANT D25:
 * The caller guarantees that configuration drafts are clean before calling run() or runAll().
 * Run is disabled while a configuration draft is dirty per D25 / commands.md §6.
 * RunController itself does not inspect or validate editor draft state.
 */

import type { Document, Id } from '../../domain/studio/model';
import type { LocalRepository } from '../../persistence/studio/repository';
import { mapErrorToFailedResult } from '../../persistence/studio/errors';
import {
  mintRunStartToken,
  type RunStartToken,
} from '../../persistence/studio/token';
import {
  DEFAULT_BUILD_VERSIONS,
  type SaveRunResult,
} from '../../persistence/studio/types';
import {
  RUN_BUDGET_LIMITS,
  type CheckResult,
  type RunSummary,
  type TerminalStatus,
  type TraceEvent,
} from '../../domain/studio/runner/types';
import type { PrepareIssue } from '../../domain/studio/runner/compile';
import type { RunTransport } from './transport';
import {
  createEmptySummary,
  type CompileResultMessage,
  type HostMessage,
  type RunUpdateMessage,
} from './protocol';

// ============================================================================
// State and Result Types
// ============================================================================

export type RunPhase = 'idle' | 'compiling' | 'running' | 'paused' | 'saving' | 'done';

export type SaveStatus =
  | 'unsaved'
  | 'saving'
  | 'saved'
  | { readonly failed: true; readonly code: string };

export type TerminalResult = {
  readonly status: TerminalStatus;
  readonly checks: readonly CheckResult[];
  readonly summary: RunSummary;
  readonly reason: string | null;
  readonly measured: boolean;
};

export type CurrentRunState = {
  readonly scenarioId: Id;
  readonly runId: Id;
  readonly terminal: TerminalResult | null;
  readonly saveStatus: SaveStatus;
  readonly measured: boolean;
};

export type RunControllerState = {
  readonly phase: RunPhase;
  readonly queue: readonly Id[];
  readonly current: CurrentRunState | null;
  readonly issues: readonly PrepareIssue[];
};

export type RunParams = {
  readonly projectId: Id;
  readonly branchId: Id;
  readonly snapshotId: string;
  readonly document: Document;
  readonly scenarioId: Id;
};

export type RunAllParams = {
  readonly projectId: Id;
  readonly branchId: Id;
  readonly snapshotId: string;
  readonly document: Document;
  readonly scenarioIds: readonly Id[];
};

export interface RunControllerOptions {
  readonly repository: LocalRepository;
  readonly transport: RunTransport;
  readonly mintId: () => string;
}

// ============================================================================
// RunController
// ============================================================================

export class RunController {
  private readonly repository: LocalRepository;
  private readonly transport: RunTransport;
  private readonly mintId: () => string;

  private state: RunControllerState = {
    phase: 'idle',
    queue: [],
    current: null,
    issues: [],
  };

  private readonly listeners = new Set<(state: RunControllerState) => void>();
  private unsubscribeTransport: (() => void) | null = null;

  // Active execution context
  private activeRunId: Id | null = null;
  private activeStartToken: RunStartToken | null = null;
  private activeProjectId: Id | null = null;
  private activeDocument: Document | null = null;
  private activeTerminal: TerminalResult | null = null;
  private bufferedEvents: TraceEvent[] = [];

  // Sequential runAll state
  private runAllQueue: Id[] = [];
  private runAllContext: {
    projectId: Id;
    branchId: Id;
    snapshotId: string;
    document: Document;
  } | null = null;

  // Pending compile resolution
  private pendingCompilePromise: {
    requestId: string;
    resolve: (res: CompileResultMessage['result']) => void;
  } | null = null;

  constructor(options: RunControllerOptions) {
    if (!options.mintId) {
      throw new Error('RunController requires mintId option');
    }
    this.repository = options.repository;
    this.transport = options.transport;
    this.mintId = options.mintId;

    this.unsubscribeTransport = this.transport.onMessage((msg: HostMessage) => {
      this.handleHostMessage(msg);
    });
  }

  getState(): RunControllerState {
    return this.state;
  }

  subscribe(listener: (state: RunControllerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(partial: Partial<RunControllerState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  destroy(): void {
    if (this.unsubscribeTransport) {
      this.unsubscribeTransport();
      this.unsubscribeTransport = null;
    }
    this.listeners.clear();
  }

  // ==========================================================================
  // Execution Control
  // ==========================================================================

  /**
   * Runs a single scenario.
   * D25: Caller guarantees the draft is clean before calling run().
   */
  async run(params: RunParams): Promise<TerminalResult | null> {
    this.runAllQueue = [];
    this.runAllContext = null;
    this.setState({ queue: [] });
    return await this.runScenarioInternal(params);
  }

  /**
   * Runs multiple scenarios in document order.
   * A failing scenario doesn't stop the rest; pause/reset act on the whole sequence.
   * D25: Caller guarantees the draft is clean before calling runAll().
   */
  async runAll(params: RunAllParams): Promise<void> {
    const { document, scenarioIds } = params;

    // Filter and sort scenarioIds by document order
    const orderedIds = document.scenarios
      .map((s) => s.id)
      .filter((id) => scenarioIds.includes(id));

    if (orderedIds.length === 0) {
      this.setState({ phase: 'idle', queue: [] });
      return;
    }

    this.runAllContext = {
      projectId: params.projectId,
      branchId: params.branchId,
      snapshotId: params.snapshotId,
      document: params.document,
    };

    const [firstId, ...restIds] = orderedIds;
    this.runAllQueue = restIds;
    this.setState({ queue: restIds });

    await this.runScenarioInternal({
      projectId: params.projectId,
      branchId: params.branchId,
      snapshotId: params.snapshotId,
      document: params.document,
      scenarioId: firstId,
    });
  }

  pause(): void {
    if (this.activeRunId && (this.state.phase === 'running' || this.state.phase === 'compiling')) {
      this.transport.postMessage({
        type: 'control',
        runId: this.activeRunId,
        kind: 'pause',
      });
      this.setState({ phase: 'paused' });
    }
  }

  resume(): void {
    if (this.activeRunId && this.state.phase === 'paused') {
      this.transport.postMessage({
        type: 'control',
        runId: this.activeRunId,
        kind: 'resume',
      });
      this.setState({ phase: 'running' });
    }
  }

  cancel(): void {
    if (this.activeRunId) {
      this.transport.postMessage({
        type: 'control',
        runId: this.activeRunId,
        kind: 'cancel',
      });
    }
    this.runAllQueue = [];
    this.runAllContext = null;
    this.setState({ queue: [] });
  }

  /**
   * Reset = cancel if running, then clear display (saved runs kept).
   */
  reset(): void {
    if (this.activeRunId && (this.state.phase === 'running' || this.state.phase === 'paused' || this.state.phase === 'compiling')) {
      this.transport.postMessage({
        type: 'control',
        runId: this.activeRunId,
        kind: 'cancel',
      });
    }
    this.activeRunId = null;
    this.activeStartToken = null;
    this.activeProjectId = null;
    this.activeDocument = null;
    this.activeTerminal = null;
    this.bufferedEvents = [];
    this.runAllQueue = [];
    this.runAllContext = null;

    this.setState({
      phase: 'idle',
      queue: [],
      current: null,
      issues: [],
    });
  }

  /**
   * Retries saving the current terminal run if a previous save failed.
   */
  async retrySave(): Promise<SaveRunResult | null> {
    if (
      !this.state.current ||
      !this.activeTerminal ||
      !this.activeStartToken ||
      !this.activeProjectId
    ) {
      return null;
    }

    this.setState({
      phase: 'saving',
      current: {
        ...this.state.current,
        saveStatus: 'saving',
      },
    });

    return await this.persistTerminalRun(
      this.activeStartToken,
      this.activeTerminal,
      this.bufferedEvents,
      this.activeProjectId,
      this.activeDocument,
    );
  }

  // ==========================================================================
  // Internal Scenario Execution
  // ==========================================================================

  private async runScenarioInternal(params: RunParams): Promise<TerminalResult | null> {
    const { projectId, snapshotId, document, scenarioId } = params;
    const runId = this.mintId();

    this.activeRunId = runId;
    this.activeProjectId = projectId;
    this.activeDocument = document;
    this.activeTerminal = null;
    this.bufferedEvents = [];
    this.activeStartToken = null;

    this.setState({
      phase: 'compiling',
      current: {
        scenarioId,
        runId,
        terminal: null,
        saveStatus: 'unsaved',
        measured: false,
      },
      issues: [],
    });

    // 1. Request compilation in worker
    const requestId = this.mintId();
    const compilePromise = new Promise<CompileResultMessage['result']>((resolve) => {
      this.pendingCompilePromise = { requestId, resolve };
    });

    this.transport.postMessage({
      type: 'compile',
      requestId,
      snapshot: { id: snapshotId, document },
      scenarioId,
      versions: DEFAULT_BUILD_VERSIONS,
    });

    const compileResult = await compilePromise;

    // Check if run was superseded or reset while compiling
    if (this.activeRunId !== runId) {
      return null;
    }

    if (compileResult.status !== 'ready') {
      const compileReason = compileResult.issues[0]?.message ?? 'Scenario compilation failed';
      const terminalResult: TerminalResult = {
        status: 'invalid',
        checks: [],
        summary: createEmptySummary('logical'),
        reason: compileReason,
        measured: false,
      };
      this.activeTerminal = terminalResult;
      this.setState({
        phase: 'done',
        current: {
          scenarioId,
          runId,
          terminal: terminalResult,
          saveStatus: 'unsaved',
          measured: false,
        },
        issues: compileResult.issues,
      });
      this.advanceQueueIfPresent();
      return terminalResult;
    }

    // 2. Mint unforgeable run start token
    const token = mintRunStartToken({
      projectId,
      runId,
      snapshotId,
      manifest: compileResult.manifest,
      fingerprint: compileResult.fingerprint,
      document,
    });
    this.activeStartToken = token;

    // 3. Start scenario in worker
    this.setState({ phase: 'running' });

    this.transport.postMessage({
      type: 'start',
      runId,
      snapshotId,
      planId: compileResult.plan.planId,
      workerSessionId: compileResult.plan.workerSessionId,
    });

    // Wait until terminal completes
    return await new Promise<TerminalResult | null>((resolve) => {
      const unsubscribe = this.subscribe((updatedState) => {
        if (updatedState.current?.runId !== runId) {
          unsubscribe();
          resolve(null);
          return;
        }
        if (updatedState.phase === 'done') {
          unsubscribe();
          resolve(updatedState.current?.terminal ?? null);
        }
      });
    });
  }

  // ==========================================================================
  // Worker Message Handling
  // ==========================================================================

  private handleHostMessage(msg: HostMessage): void {
    if (msg.type === 'compile-result') {
      if (this.pendingCompilePromise && this.pendingCompilePromise.requestId === msg.requestId) {
        this.pendingCompilePromise.resolve(msg.result);
        this.pendingCompilePromise = null;
      }
      return;
    }

    if (msg.type === 'update') {
      this.handleRunUpdate(msg.message);
    }
  }

  private handleRunUpdate(update: RunUpdateMessage['message']): void {
    // Stale run IDs ignored (§8)
    if (!this.activeRunId || update.runId !== this.activeRunId) {
      return;
    }

    switch (update.kind) {
      case 'state': {
        if (update.state === 'paused') {
          this.setState({ phase: 'paused' });
        } else if (update.state === 'running') {
          this.setState({ phase: 'running' });
        }
        break;
      }

      case 'batch': {
        // Buffer batches within trace caps (storage.md §6)
        const cap = RUN_BUDGET_LIMITS.maxTraceRows.max;
        const availableSpace = Math.max(0, cap - this.bufferedEvents.length);
        if (availableSpace > 0) {
          const eventsToAdd = update.events.slice(0, availableSpace);
          this.bufferedEvents.push(...eventsToAdd);
        }
        break;
      }

      case 'terminal': {
        void this.handleTerminal(update);
        break;
      }
    }
  }

  private async handleTerminal(terminalMsg: {
    readonly status: TerminalStatus;
    readonly checks: readonly CheckResult[];
    readonly summary: RunSummary;
    readonly reason: string | null;
    readonly measured?: boolean;
  }): Promise<void> {
    const isMeasured = terminalMsg.measured ?? false;
    const terminalResult: TerminalResult = {
      status: terminalMsg.status,
      checks: terminalMsg.checks,
      summary: terminalMsg.summary,
      reason: terminalMsg.reason,
      measured: isMeasured,
    };
    this.activeTerminal = terminalResult;

    if (!this.state.current) {
      return;
    }

    const currentScenarioId = this.state.current.scenarioId;
    const currentRunId = this.state.current.runId;

    this.setState({
      phase: 'saving',
      current: {
        scenarioId: currentScenarioId,
        runId: currentRunId,
        terminal: terminalResult,
        saveStatus: 'saving',
        measured: isMeasured,
      },
    });

    if (this.activeStartToken && this.activeProjectId) {
      await this.persistTerminalRun(
        this.activeStartToken,
        terminalResult,
        this.bufferedEvents,
        this.activeProjectId,
        this.activeDocument,
      );
    } else {
      this.setState({
        phase: 'done',
        current: {
          scenarioId: currentScenarioId,
          runId: currentRunId,
          terminal: terminalResult,
          saveStatus: 'unsaved',
          measured: isMeasured,
        },
      });
      this.advanceQueueIfPresent();
    }
  }

  private async persistTerminalRun(
    startToken: RunStartToken,
    terminalResult: TerminalResult,
    events: readonly TraceEvent[],
    projectId: Id,
    document: Document | null,
  ): Promise<SaveRunResult> {
    try {
      const saveRes = await this.repository.saveRun(
        startToken,
        {
          runId: startToken.runId,
          fingerprint: startToken.fingerprint,
          status: terminalResult.status,
          checks: terminalResult.checks,
          summary: terminalResult.summary,
        },
        events,
        {
          projectId,
          ...(document ? { document } : {}),
        },
      );

      // Check if stale before updating state
      if (this.activeRunId !== startToken.runId || !this.state.current) {
        return saveRes;
      }

      if (saveRes.status === 'applied') {
        this.setState({
          phase: 'done',
          current: {
            ...this.state.current,
            saveStatus: 'saved',
          },
        });
      } else {
        const failureCode = saveRes.status === 'failed' ? saveRes.code : saveRes.status;
        this.setState({
          phase: 'done',
          current: {
            ...this.state.current,
            saveStatus: { failed: true, code: failureCode },
          },
        });
      }

      this.advanceQueueIfPresent();
      return saveRes;
    } catch (err: unknown) {
      const failed = mapErrorToFailedResult(err);
      if (this.activeRunId === startToken.runId && this.state.current) {
        this.setState({
          phase: 'done',
          current: {
            ...this.state.current,
            saveStatus: { failed: true, code: failed.code },
          },
        });
        this.advanceQueueIfPresent();
      }
      return failed;
    }
  }

  private advanceQueueIfPresent(): void {
    if (this.runAllQueue.length > 0 && this.runAllContext) {
      const nextScenarioId = this.runAllQueue.shift()!;
      this.setState({ queue: [...this.runAllQueue] });

      // Run next scenario in sequence
      void this.runScenarioInternal({
        projectId: this.runAllContext.projectId,
        branchId: this.runAllContext.branchId,
        snapshotId: this.runAllContext.snapshotId,
        document: this.runAllContext.document,
        scenarioId: nextScenarioId,
      });
    }
  }
}

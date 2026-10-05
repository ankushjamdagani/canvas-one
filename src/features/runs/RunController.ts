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

import type { Document, Fault, Id, Scenario } from '../../domain/studio/model';
import type { StudioRepository } from '../../persistence/studio/types';
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
import { HISTORY_MS, PlaybackStore, type PlaybackRange } from './playback';
import { createEmptySummary } from './summary';
import type {
  CompileResultMessage,
  HostMessage,
  RunUpdateMessage,
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
  /**
   * RV-12d review round 1: the bounded trace-event buffer the controller
   * already keeps internally (buffered within trace caps, per storage.md §6),
   * now surfaced read-only for the results UI's event log. Cleared when a new
   * run starts and on reset(); never mutated in place (each update replaces
   * the array so consumers can rely on reference identity for change checks).
   */
  readonly events: readonly TraceEvent[];
  /** D55: Stop was pressed and the run is draining (stops arrivals, lets work in flight finish). */
  readonly stopping: boolean;
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

/** D57: the timer the playhead runs on; tests inject a manual one. */
export type PlaybackClock = {
  readonly now: () => number;
  readonly schedule: (run: () => void, ms: number) => unknown;
  readonly cancel: (handle: unknown) => void;
};

const REAL_CLOCK: PlaybackClock = {
  now: () => performance.now(),
  schedule: (run, ms) => setTimeout(run, ms),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** D57: the worker is told where the playhead is when it has moved this far (simulated ms). */
const PLAYHEAD_REPORT_MS = 250;
/** D57: how often the playhead moves (real ms). */
const TICK_MS = 16;

export interface RunControllerOptions {
  readonly repository: StudioRepository;
  readonly transport: RunTransport;
  readonly mintId: () => string;
  readonly clock?: PlaybackClock;
}

// ============================================================================
// RunController
// ============================================================================

export class RunController {
  private readonly repository: StudioRepository;
  private readonly transport: RunTransport;
  private readonly mintId: () => string;

  private state: RunControllerState = {
    phase: 'idle',
    queue: [],
    current: null,
    issues: [],
    events: [],
    stopping: false,
  };

  /** Playback speed, simulated seconds per real second. */
  private speed = 1;
  private loop = false;
  private readonly clock: PlaybackClock;
  private playback: PlaybackStore | null = null;
  private playbackFaults: readonly Fault[] = [];
  private clockHandle: unknown = null;
  private lastTickAt = 0;
  private lastPlayheadPostMs = -Infinity;
  /** Trace events the worker has reported that the playhead has not reached yet. */
  private heldEvents: TraceEvent[] = [];
  private heldEventIndex = 0;
  /** The worker's final result, applied once the playhead reaches the end of the run. */
  private pendingTerminal: Parameters<RunController['handleTerminal']>[0] | null = null;
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
    this.clock = options.clock ?? REAL_CLOCK;

    this.unsubscribeTransport = this.transport.onMessage((msg: HostMessage) => {
      this.handleHostMessage(msg);
    });
  }

  getState(): RunControllerState {
    return this.state;
  }

  /** Subscribe to run lifecycle and playhead-released trace events. */
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

  /**
   * D57: how fast the playhead moves for the runs this controller starts, in simulated seconds per real second
   * (1 = real time). Only the seven supported finite speeds are accepted.
   */
  setPlaybackSpeed(speed: number): void {
    if (![0.25, 0.5, 1, 2, 4, 8, 16].includes(speed)) throw new RangeError('Unsupported playback speed');
    this.speed = speed;
    if (this.playback) this.playback.speed = speed;
  }

  getPlaybackSpeed(): number {
    return this.speed;
  }

  setLoop(loop: boolean): void { this.loop = loop; }
  getLoop(): boolean { return this.loop; }

  setPlaybackRange(range: PlaybackRange | null): void {
    const store = this.playback;
    if (!store) return;
    store.setSelection(range);
    this.seek(store.selection?.startMs ?? store.playheadMs);
  }

  seek(ms: number): void {
    const store = this.playback;
    if (!store) return;
    store.playing = false;
    if (this.activeRunId && !store.ended) this.transport.postMessage({ type: 'control', runId: this.activeRunId, kind: 'pause' });
    store.seek(ms);
    this.rebuildVisibleEvents();
    this.postPlayhead(store.playheadMs);
    if (this.state.phase === 'running') this.setState({ phase: 'paused' });
    else this.setState({});
  }

  stepCycle(direction: -1 | 1): void {
    const store = this.playback;
    if (!store) return;
    const target = store.cycleStep(store.playheadMs, direction);
    if (target !== null) this.seek(target);
  }

  goLive(): void {
    if (!this.playback?.isStream) return;
    this.playback.setSelection(null);
    this.seek(this.playback.computedMs);
    if (!this.playback.ended) this.resume();
  }

  /** D57: the current run's recording and playhead (timed runs), or null. */
  getPlayback(): PlaybackStore | null {
    return this.playback;
  }

  getPlaybackFaults(): readonly Fault[] {
    return this.playbackFaults;
  }

  /**
   * Stop ends emission and drains in-flight work before finalizing measured results.
   */
  stop(): void {
    if (this.activeRunId && (this.state.phase === 'running' || this.state.phase === 'paused') && !this.state.stopping) {
      this.transport.postMessage({ type: 'control', runId: this.activeRunId, kind: 'stop' });
      if (this.playback) {
        this.playback.setSelection(null);
        this.playback.playing = true;
        this.lastTickAt = this.clock.now();
        this.ensureClock();
      }
      this.setState({ stopping: true, ...(this.state.phase === 'paused' ? { phase: 'running' as const } : {}) });
    }
  }

  pause(): void {
    if (this.playback?.ended && (this.state.phase === 'done' || this.state.phase === 'saving')) {
      this.playback.playing = false;
      this.setState({});
      return;
    }
    if (this.activeRunId && (this.state.phase === 'running' || this.state.phase === 'compiling')) {
      this.transport.postMessage({
        type: 'control',
        runId: this.activeRunId,
        kind: 'pause',
      });
      if (this.playback) this.playback.playing = false;
      this.setState({ phase: 'paused' });
    }
  }

  resume(): void {
    const store = this.playback;
    const range = store?.selection;
    if (store && range && (store.playheadMs < range.startMs || store.playheadMs >= range.endMs)) {
      store.seek(range.startMs);
      this.rebuildVisibleEvents();
      this.postPlayhead(store.playheadMs);
    }
    if (this.playback?.ended && this.state.phase === 'done') {
      if (this.playback.atEnd()) {
        this.playback.seek(this.playback.windowStartMs);
        this.rebuildVisibleEvents();
      }
      this.playback.playing = true;
      this.lastTickAt = this.clock.now();
      this.ensureClock();
      this.setState({});
      return;
    }
    if (this.activeRunId && this.state.phase === 'paused') {
      this.transport.postMessage({
        type: 'control',
        runId: this.activeRunId,
        kind: 'resume',
      });
      if (this.playback) {
        this.playback.playing = true;
        this.lastTickAt = this.clock.now();
        this.ensureClock();
      }
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
    this.endPlayback(true);
    this.runAllQueue = [];
    this.runAllContext = null;

    this.setState({
      phase: 'idle',
      queue: [],
      current: null,
      issues: [],
      events: [],
      stopping: false,
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
    this.endPlayback(true);
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
      events: [],
      stopping: false,
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
        phase: 'done', stopping: false,
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

    const scenario = document.scenarios.find((s) => s.id === scenarioId);
    if (scenario?.mode === 'timed' && this.runAllContext === null) {
      this.beginPlayback(document, scenario.workloads);
      this.playbackFaults = structuredClone(scenario.faults);
    }

    this.transport.postMessage({
      type: 'start',
      runId,
      snapshotId,
      planId: compileResult.plan.planId,
      workerSessionId: compileResult.plan.workerSessionId,
      interactive: scenario?.mode === 'timed' && this.runAllContext === null,
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
        if (this.playback) {
          // D57: the worker is ahead of the playhead, so events wait until the playhead reaches them.
          const room = Math.max(0, cap - this.bufferedEvents.length - (this.heldEvents.length - this.heldEventIndex));
          this.heldEvents.push(...update.events.slice(0, room));
          for (const e of update.events) if (e.atMs !== null) this.playback.setComputedEdge(e.atMs);
          break;
        }
        const availableSpace = Math.max(0, cap - this.bufferedEvents.length);
        if (availableSpace > 0) {
          const eventsToAdd = update.events.slice(0, availableSpace);
          this.bufferedEvents.push(...eventsToAdd);
          // Surface a fresh array reference so subscribers relying on
          // identity (e.g. React) see the update.
          this.setState({ events: [...this.bufferedEvents] });
        }
        break;
      }

      case 'flow': {
        if (this.playback) {
          this.playback.ingestFlow(update.records);
          for (const r of update.records) this.playback.setComputedEdge(r.atMs);
        }
        break;
      }

      case 'cycles': {
        this.playback?.ingestCycles(update.cycles);
        break;
      }

      case 'results': {
        this.playback?.ingestResults(update.records);
        break;
      }

      case 'checkpoint': {
        this.playback?.ingestCheckpoint(update.checkpoint);
        this.playback?.setComputedEdge(update.checkpoint.atMs);
        break;
      }

      case 'buffer': {
        this.playback?.setComputedEdge(update.computedMs);
        break;
      }

      case 'terminal': {
        if (this.state.current?.terminal || this.pendingTerminal) break;
        if (this.playback && update.measured) {
          // D57: the run has finished computing, but the playhead may be far behind. Keep the result until it arrives.
          this.playback.setEnded(Math.max(this.playback.computedMs, update.summary.elapsedMs ?? 0));
          this.pendingTerminal = update;
          if (this.playback.atEnd()) this.tick();
          break;
        }
        this.endPlayback(false);
        void this.handleTerminal(update);
        break;
      }
    }
  }

  // ==========================================================================
  // Playback (D57)
  // ==========================================================================

  private beginPlayback(document: Document, workloads: Scenario['workloads']): void {
    this.endPlayback(true);
    const store = new PlaybackStore({
      connectionTargets: new Map(document.connections.map((c) => [c.id, c.target.elementId])),
      connectionChannels: new Map(document.connections.flatMap(c => {
        const port = document.elements.find(e => e.id === c.source.elementId)?.ports.find(p => p.id === c.source.portId);
        return port ? [[c.id, port.channel] as const] : [];
      })),
      workloadEntries: new Map(workloads.map(w => [w.id, w.entry.elementId])),
      historyMs: workloads.some(w => w.enabled && w.emission.mode === 'stream') ? HISTORY_MS : null,
    });
    store.speed = this.speed;
    store.playing = true;
    this.playback = store;
    this.lastTickAt = this.clock.now();
    this.lastPlayheadPostMs = -Infinity;
    this.heldEvents = [];
    this.heldEventIndex = 0;
    this.pendingTerminal = null;
    this.clockHandle = this.clock.schedule(() => this.tick(), TICK_MS);
  }

  /** Stops the clock; `discard` also drops the recording (a reset or a new run). */
  private endPlayback(discard: boolean): void {
    if (this.clockHandle !== null) this.clock.cancel(this.clockHandle);
    this.clockHandle = null;
    this.pendingTerminal = null;
    if (discard) {
      this.playback = null;
      this.playbackFaults = [];
      this.heldEvents = [];
      this.heldEventIndex = 0;
    }
  }

  private postPlayhead(simulatedMs: number): void {
    this.lastPlayheadPostMs = simulatedMs;
    if (!this.activeRunId) return;
    this.transport.postMessage({ type: 'playhead', runId: this.activeRunId, simulatedMs });
  }

  /** One step of the playhead: move it, hand out what it passed, tell the worker, and finish the run if it is over. */
  private tick(): void {
    const store = this.playback;
    if (!store) return;
    if (this.clockHandle !== null) this.clock.cancel(this.clockHandle);
    this.clockHandle = null;
    const now = this.clock.now();
    store.advance(now - this.lastTickAt);
    this.lastTickAt = now;

    let released = false;
    while (this.heldEventIndex < this.heldEvents.length) {
      const e = this.heldEvents[this.heldEventIndex];
      if (e.atMs !== null && e.atMs > store.playheadMs) break;
      this.bufferedEvents.push(e);
      this.heldEventIndex++;
      released = true;
    }
    if (released) this.setState({ events: [...this.bufferedEvents] });

    if (store.playheadMs - this.lastPlayheadPostMs >= PLAYHEAD_REPORT_MS) {
      this.lastPlayheadPostMs = store.playheadMs;
      this.postPlayhead(store.playheadMs);
    }

    if (store.atEnd() && this.pendingTerminal) {
      const terminal = this.pendingTerminal;
      this.pendingTerminal = null;
      // The playhead is at the end: whatever trace the worker reported is now visible, and the result applies.
      while (this.heldEventIndex < this.heldEvents.length) this.bufferedEvents.push(this.heldEvents[this.heldEventIndex++]);
      this.setState({ events: [...this.bufferedEvents] });
      void this.handleTerminal(terminal).then(() => {
        if (this.playback !== store) return;
        if (store.playing && this.loop && (!store.isStream || store.selection !== null)) {
          store.seek(store.selection?.startMs ?? store.windowStartMs);
          this.rebuildVisibleEvents();
          this.postPlayhead(store.playheadMs);
          this.lastTickAt = this.clock.now();
          this.ensureClock();
        } else {
          store.playing = false;
          this.setState({});
        }
      });
      return;
    }
    if (store.playing && store.atSelectionEnd() && !store.atEnd()) {
      if (this.loop) {
        store.seek(store.selection!.startMs);
        this.rebuildVisibleEvents();
        this.postPlayhead(store.playheadMs);
      } else this.pause();
    } else if (store.playing && store.atEnd() && store.ended && this.loop && (!store.isStream || store.selection !== null) && this.state.phase === 'done') {
      store.seek(store.selection?.startMs ?? store.windowStartMs);
      this.rebuildVisibleEvents();
      this.postPlayhead(store.playheadMs);
    } else if (store.atEnd() && store.ended && this.state.phase === 'done') {
      store.playing = false;
    }
    this.setState({});
    if (!store.ended || store.playing) this.ensureClock();
  }

  private ensureClock(): void {
    if (this.clockHandle === null) this.clockHandle = this.clock.schedule(() => this.tick(), TICK_MS);
  }

  private rebuildVisibleEvents(): void {
    const playhead = this.playback?.playheadMs ?? 0;
    this.bufferedEvents = this.heldEvents.filter((event) => event.atMs === null || event.atMs <= playhead);
    this.heldEventIndex = this.heldEvents.findIndex((event) => event.atMs !== null && event.atMs > playhead);
    if (this.heldEventIndex < 0) this.heldEventIndex = this.heldEvents.length;
    this.setState({ events: [...this.bufferedEvents] });
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
        phase: 'done', stopping: false,
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
          phase: 'done', stopping: false,
          current: {
            ...this.state.current,
            saveStatus: 'saved',
          },
        });
      } else {
        const failureCode = saveRes.status === 'failed' ? saveRes.code : saveRes.status;
        this.setState({
          phase: 'done', stopping: false,
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
          phase: 'done', stopping: false,
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

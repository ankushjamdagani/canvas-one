/**
 * Composed Scenario Runner for Logical and Timed scenarios (RV-14d-3).
 *
 * Implements specs/revamp/contracts/model-and-runner.md:
 * - §4 Behaviors: machine, pipeline, decision, resource, wiring.
 * - §5 Invocation semantics: frames, propagation, root accounting, control promotion,
 *   descendant data-edge reply settlement, message roots linked to parent.
 * - §6 Scenarios: logical (quiescent) and timed (horizon, drain), external inputs,
 *   completion policies, boundaries.
 * - §8 Runner interface: one global scheduler owning time and insertion sequence:
 *   order (atMs, phase, sequence); phase 1 retained kernel, phase 2 bridge dispatch /
 *   edge arrivals, phase 3 external input.
 * - §9 Results: RunSummary, Counts conserved separately for roots and messages,
 *   ElementMetrics, CheckResult.
 * - §11 Reference scenarios: S01 (checkout), S02 (order processing), S03 (records pipeline).
 */

import { canonicalJson, sha256Hex } from '../canonical';
import type {
  Boundary,
  BoundaryResponse,
  Connection,
  Document,
  Element,
  Endpoint,
  Id,
  Input,
  Json,
  MachineBehavior,
  PayloadSchema,
  Port,
  Scenario,
  Shape,
  TransportOutcome,
} from '../model';
import type { Issue, IssueCode } from '../validate';
import type {
  CheckResult,
  Counts,
  ElementMetric,
  ResourceInput,
  RowOutcome,
  RunSummary,
  TerminalStatus,
  TraceEvent,
  TraceEventKind,
} from './types';
import { WORKLOAD_PAYLOAD_REF, WORKLOAD_REQUEST_PAYLOAD } from './types';
import { rootId, traceEventId, PayloadTable } from './trace';
import { defaultEvaluator, readPath } from './expr';
import { isMissing } from './expr-api';
import { deepCloneJson, setPathInContext, stepMachine } from './machine';
import { runPipeline } from './pipeline';
import { runDecision } from './decision';
import { evaluateAssertions } from './assertions';
import { OPEN_RUN_CEILING_MS, ResourceAdapter, validateFaultsAndPlacements } from './resource-adapter';
import { validateSchemaValue } from './schema-value';
import { resolveRefinementRouting, type RefinementRouting } from '../refinementRouting';

// ============================================================================
// Types
// ============================================================================

export type ScenarioIssue = {
  readonly code: IssueCode | 'unsupported-rv14d' | string;
  readonly path: readonly (string | number)[];
  readonly entityId: Id | null;
  readonly severity: 'error' | 'warning';
  readonly message: string;
};

export type ScenarioRunResult = {
  readonly status: TerminalStatus;
  readonly events: readonly TraceEvent[];
  readonly summary: RunSummary;
  readonly checks: readonly CheckResult[];
  readonly reason: string | null;
  readonly issues?: readonly (Issue | ScenarioIssue)[];
};

export type ScenarioRunnerOptions = {
  readonly stepSize?: number;
  /** Checked at every scheduler batch boundary (each `step()` call, §12 "cancellation at
   * compiler and runner batch boundaries"). An aborted signal ends the run 'cancelled'
   * with no terminal success, mirroring `prepareScenario`'s compile-time cancellation. */
  readonly signal?: AbortSignal;
};

type InvocationContext = {
  readonly frameId: string | null;
  readonly rootId: string;
  readonly journeyId: Id;
  readonly parentEventId: string | null;
  readonly requestId: string | null;
  readonly outcome: TransportOutcome | null;
  readonly isExternalControlInput?: boolean;
};

type HeldBoundaryResponse = {
  readonly response: BoundaryResponse;
  readonly payload: Json;
  readonly callPortId: Id;
  readonly correlationRequestId: string;
  readonly initiatingFrameId: string;
  readonly machineElementId: Id;
  readonly rootId: string;
  readonly journeyId: Id;
};

export type MutableCounts = {
  generated: number;
  succeeded: number;
  rejected: number;
  failed: number;
  expired: number;
  inFlight: number;
};

export type SettlementState = {
  activeMessageRoots: Set<string>;
  activeUserRoots: Map<string, { openFrameCount: number; outcomes: TransportOutcome[] }>;
  deliveredUnitToMessageRoot: Map<string, string>;
  rootCounts: MutableCounts;
  messageCounts: MutableCounts;
};

export type SettlementResult =
  | { readonly ok: true; readonly matched: boolean }
  | { readonly ok: false; readonly status: 'failed'; readonly reason: string };

/**
 * Handles unit settlement with explicit outcome check and exact linkage (§8).
 * No success is inferred from aggregates: a settled event without an explicit outcome
 * fails the run with a sanitized diagnostic.
 */
export function handleSettlementEvent(
  te: Pick<TraceEvent, 'id' | 'kind' | 'code' | 'rootId' | 'outcome'>,
  state: SettlementState,
): SettlementResult {
  if (
    te.kind !== 'settled' ||
    (te.code !== 'succeeded' && te.code !== 'failed' && te.code !== 'rejected' && te.code !== 'expired')
  ) {
    return { ok: true, matched: false };
  }

  let matchedMsgId: string | null = null;
  if (state.deliveredUnitToMessageRoot.has(te.rootId)) {
    matchedMsgId = state.deliveredUnitToMessageRoot.get(te.rootId)!;
  }

  if (matchedMsgId) {
    if (!te.outcome) {
      return {
        ok: false,
        status: 'failed',
        reason: `Settled event '${te.id}' (root '${te.rootId}') has no explicit outcome`,
      };
    }
    state.activeMessageRoots.delete(matchedMsgId);
    state.deliveredUnitToMessageRoot.delete(te.rootId);
    state.messageCounts.inFlight = Math.max(0, state.messageCounts.inFlight - 1);
    state.messageCounts[te.outcome]++;
    return { ok: true, matched: true };
  }

  if (state.activeUserRoots.has(te.rootId)) {
    if (!te.outcome) {
      return {
        ok: false,
        status: 'failed',
        reason: `Settled event '${te.id}' (root '${te.rootId}') has no explicit outcome`,
      };
    }
    state.activeUserRoots.delete(te.rootId);
    state.rootCounts.inFlight = Math.max(0, state.rootCounts.inFlight - 1);
    state.rootCounts[te.outcome]++;
    return { ok: true, matched: true };
  }

  return { ok: true, matched: false };
}

type GlobalSchedulerEvent =
  | {
      readonly kind: 'external-input';
      readonly atMs: number;
      readonly phase: 3;
      readonly sequence: number;
      readonly input: Input;
    }
  | {
      readonly kind: 'admit-message';
      readonly atMs: number;
      readonly phase: 2;
      readonly sequence: number;
      readonly resourceInput: ResourceInput;
    }
  | {
      readonly kind: 'admit-resource-call';
      readonly atMs: number;
      readonly phase: 2;
      readonly sequence: number;
      readonly resourceInput: ResourceInput;
    }
  | {
      readonly kind: 'edge-dispatch';
      readonly atMs: number;
      readonly phase: 2;
      readonly sequence: number;
      readonly target: Endpoint;
      readonly payload: Json;
      readonly context: InvocationContext;
    }
  | {
      readonly kind: 'scheduled-machine-event';
      readonly atMs: number;
      readonly phase: 2;
      readonly sequence: number;
      readonly elementId: Id;
      readonly portId: Id;
      readonly payload: Json;
      readonly context: InvocationContext;
    }
  | {
      readonly kind: 'boundary-response';
      readonly atMs: number;
      readonly phase: 2;
      readonly sequence: number;
      readonly held: HeldBoundaryResponse;
    }
  | {
      /** A boundary's scripted reply to a resource's bridge call (§6 Boundaries, §8 frames). */
      readonly kind: 'resource-boundary-response';
      readonly atMs: number;
      readonly phase: 2;
      readonly sequence: number;
      readonly frameId: string;
      readonly source: Endpoint;
      readonly rootId: string;
      readonly journeyId: Id;
      readonly parentEventId: string | null;
      readonly payload: Json;
      readonly outcome: TransportOutcome;
    };

// ============================================================================
// Event Recorder (encapsulates monotonic sequences, row/byte budgets, PayloadTable)
// ============================================================================

class ScenarioEventRecorder {
  private readonly runId: string;
  private readonly budgets: { maxTraceRows: number; maxTraceBytes: number };
  private readonly payloads = new PayloadTable();
  private readonly recordedEvents: TraceEvent[] = [];
  private nextSeq = 0;
  private usedBytes = 0;
  /** Set only by an invalid event: the run can't continue. */
  public stopped = false;
  public stopReason: string | null = null;
  /**
   * The first trace cap reached (storage.md §6, D47). From then on rows aren't recorded,
   * but payloads still resolve and the run keeps running and counting.
   */
  public truncatedBy: 'trace-rows' | 'trace-bytes' | null = null;

  constructor(runId: string, budgets: { maxTraceRows: number; maxTraceBytes: number }) {
    this.runId = runId;
    this.budgets = budgets;
  }

  get events(): readonly TraceEvent[] {
    return this.recordedEvents;
  }

  get payloadTable(): PayloadTable {
    return this.payloads;
  }

  async append(input: {
    rootId: string;
    journeyId: Id;
    parentId: string | null;
    elementId: Id;
    portId: Id | null;
    kind: TraceEventKind;
    code: string;
    payload?: Json | null;
    payloadRef?: string | null;
    atMs: number | null;
    outcome: TransportOutcome | null;
  }): Promise<{ ok: boolean; event?: TraceEvent; recorded?: boolean }> {
    if (this.stopped) return { ok: false };

    let payloadRef = input.payloadRef ?? null;
    let payloadBytes = 0;
    let payloadCanonicalText: string | null = null;

    if (input.payload !== undefined && input.payload !== null) {
      const canon = canonicalJson(input.payload);
      if (!canon.ok) {
        this.stopped = true;
        this.stopReason = 'invalid-event';
        return { ok: false };
      }
      payloadRef = `sha256:${await sha256Hex(canon.text)}`;
      if (!this.payloads.has(payloadRef)) {
        payloadCanonicalText = canon.text;
        payloadBytes = canon.bytes;
      }
    }

    const sequence = this.nextSeq++;
    const event: TraceEvent = {
      id: traceEventId(this.runId, sequence),
      sequence,
      rootId: input.rootId,
      journeyId: input.journeyId,
      parentId: input.parentId,
      elementId: input.elementId,
      portId: input.portId,
      kind: input.kind,
      code: input.code,
      payloadRef,
      atMs: input.atMs,
      outcome: input.outcome,
    };

    const canonEvt = canonicalJson(event);
    if (!canonEvt.ok) {
      this.stopped = true;
      this.stopReason = 'invalid-event';
      return { ok: false };
    }

    const addedBytes = canonEvt.bytes + payloadBytes;

    if (this.truncatedBy === null && this.recordedEvents.length + 1 > this.budgets.maxTraceRows) {
      this.truncatedBy = 'trace-rows';
    } else if (this.truncatedBy === null && this.usedBytes + addedBytes > this.budgets.maxTraceBytes) {
      this.truncatedBy = 'trace-bytes';
    }

    if (this.truncatedBy !== null) {
      // Payloads stay resolvable after truncation (later steps read them back) and still
      // count against the byte budget, which keeps bounding memory; past it the run stops.
      if (payloadCanonicalText && payloadRef) {
        if (this.usedBytes + payloadBytes > this.budgets.maxTraceBytes) {
          this.stopped = true;
          this.stopReason = 'trace-bytes';
          return { ok: false };
        }
        this.usedBytes += payloadBytes;
        this.payloads.commitPrecomputed(payloadRef, payloadCanonicalText);
      }
      return { ok: true, event, recorded: false };
    }

    if (payloadCanonicalText && payloadRef) {
      this.payloads.commitPrecomputed(payloadRef, payloadCanonicalText);
    }

    this.usedBytes += addedBytes;
    this.recordedEvents.push(event);
    return { ok: true, event, recorded: true };
  }
}

// ============================================================================
// ScenarioRunner Class
// ============================================================================

/** D55: how long a stopped run may keep draining, in simulated ms. */
const STOP_DRAIN_MS = 60000;

/**
 * What the calls and messages a node the runner does not simulate (a client, a state machine)
 * send into the simulation look like: a read of the default class that waits 60 s. Such a node
 * has no editable request; use a workload to shape traffic.
 */
const UNSIMULATED_CALL_DEADLINE_MS = 60000;
const UNSIMULATED_CALL_REQUEST = { requestClassId: 'default-class', operation: 'read' as const, key: null, tags: [] as string[] };

export class ScenarioRunner {
  private readonly document: Document;
  private readonly scenario: Scenario;
  private readonly runId: string;

  private readonly schemasMap = new Map<Id, PayloadSchema>();
  private readonly fixturesMap = new Map<Id, Json>();
  private readonly elementsMap = new Map<Id, Element>();
  private readonly portsMap = new Map<Id, Port>();

  private readonly recorder: ScenarioEventRecorder;
  private readonly machineStates = new Map<Id, { stateId: Id; context: Json }>();
  private readonly outputsMap = new Map<string, { port: Endpoint; values: Json[] }>();
  private readonly emissionsByPortAndJourney = new Map<string, Json[]>();
  private readonly collectedRowOutcomes: RowOutcome[] = [];

  private readonly rootCounts: MutableCounts = {
    generated: 0,
    succeeded: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
    inFlight: 0,
  };

  private readonly messageCounts: MutableCounts = {
    generated: 0,
    succeeded: 0,
    rejected: 0,
    failed: 0,
    expired: 0,
    inFlight: 0,
  };

  // Open frames: frameId -> { userRootId }
  private readonly openFrames = new Map<string, { userRootId: string; settled: boolean }>();
  // Active user roots: rootId -> { openFrameCount, outcomes }
  private readonly activeUserRoots = new Map<string, { openFrameCount: number; outcomes: TransportOutcome[] }>();
  // Active message root IDs
  private readonly activeMessageRoots = new Set<string>();
  // Exact mapping of delivered unit ID -> studio message root ID (§8)
  private readonly deliveredUnitToMessageRoot = new Map<string, string>();
  // Bridge call frames (§8): a call-frame id handed to an external (non-resource)
  // business flow via a resource's bridge continuation. Its eventual reply settles the
  // resource's own waiting op (ResourceAdapter.settleCall) instead of root accounting.
  private readonly kernelBridgeFrames = new Set<string>();
  // A machine call routed directly into a resource entry, keyed by the resource
  // ResourceInput.rootId (the SAME id as the promoted user root, §5 "the bridge call and
  // everything synchronous under it share that root"): carries what's needed to deliver
  // the eventual settlement back to the calling machine's response port, mirroring a
  // HeldBoundaryResponse.
  private readonly resourceCallPending = new Map<
    string,
    {
      callPortId: Id;
      correlationRequestId: string;
      initiatingFrameId: string;
      machineElementId: Id;
      rootId: string;
      journeyId: Id;
    }
  >();
  // Issues collected during runner initialization / runtime
  private issues: ScenarioIssue[] = [];

  // Refinement selection (§6): elements excluded by the scenario's aggregate/refined
  // choices, and the connection list with crossings routed through port mappings.
  private refinementExcludedElementIds: Set<Id> = new Set();
  private effectiveConnections: readonly Connection[] = [];
  private refinementRouting!: RefinementRouting;

  // Logical mode causal queue and held responses
  private readonly logicalCausalQueue: HeldBoundaryResponse[] = [];
  private readonly heldBoundaryResponses: HeldBoundaryResponse[] = [];
  private readonly usedBoundaryResponseIds = new Set<Id>();
  private readonly finishedInputIds = new Set<Id>();
  private unconsumedInputs: Input[] = [];

  // Timed mode scheduler
  private adapter: ResourceAdapter | null = null;
  private readonly timedQueue: GlobalSchedulerEvent[] = [];
  private globalSequence = 0;
  private currentTimeMs = 0;

  private processedEvents = 0;
  private consumedInputs = 0;
  private requestIdCounter = 0;
  private frameCounter = 0;
  private messageCounter = 0;

  private isFinished = false;
  /** D55: set by requestStop(); applied at the next step boundary. */
  private stopRequested = false;
  /** D55: when a stop took effect (simulated ms), and the latest the stopped run may keep draining. */
  private stoppedAtMs: number | null = null;
  private stopDrainDeadlineMs: number | null = null;
  private terminalStatus: TerminalStatus = 'incomplete';
  private failureReason: string | null = null;
  // First budget stop (storage.md §6, run-identity.md: an exhausted step/trace budget ends
  // the run 'incomplete'). Errors that cascade from that stop must not turn it into 'failed'.
  private budgetStop: string | null = null;
  private readonly signal?: AbortSignal;

  constructor(document: Document, scenarioId: Id, runId: string, options: ScenarioRunnerOptions = {}) {
    this.document = document;
    this.runId = runId;
    this.signal = options.signal;

    const foundScenario = document.scenarios.find((s) => s.id === scenarioId);
    if (!foundScenario) {
      this.scenario = {
        id: scenarioId,
        label: 'missing',
        revision: 0,
        mode: 'logical',
        scopeElementIds: [],
        entryPorts: [],
        inputs: [],
        workloads: [],
        faults: [],
        boundaries: [],
        refinementSelections: [],
        initialContexts: [],
        assertions: [],
        seed: 1,
        budgets: {
          maxEvents: 100000,
          maxTraceRows: 10000,
          maxTraceBytes: 4194304,
          maxScheduledEvents: 100000,
          maxLiveRoots: 10000,
        },
        completion: { kind: 'quiescent' },
        assumptions: [],
      };
      this.terminalStatus = 'invalid';
      this.failureReason = 'Scenario not found';
      this.isFinished = true;
      this.recorder = new ScenarioEventRecorder(runId, { maxTraceRows: 10000, maxTraceBytes: 4194304 });
      return;
    }
    this.scenario = foundScenario;

    // Index document structures
    for (const s of document.schemas) this.schemasMap.set(s.id, s);
    for (const f of document.fixtures) this.fixturesMap.set(f.id, f.value);
    for (const e of document.elements) {
      this.elementsMap.set(e.id, e);
      for (const p of e.ports) this.portsMap.set(p.id, p);
    }

    this.recorder = new ScenarioEventRecorder(runId, {
      maxTraceRows: this.scenario.budgets.maxTraceRows,
      maxTraceBytes: this.scenario.budgets.maxTraceBytes,
    });

    // Validate faults and host placements (§6 & §8)
    const validationIssues = validateFaultsAndPlacements(
      this.scenario.faults,
      this.document.relations,
      this.scenario.id,
    );
    if (validationIssues.length > 0) {
      this.terminalStatus = 'invalid';
      this.failureReason = validationIssues[0].message;
      this.issues = validationIssues;
      this.isFinished = true;
      return;
    }

    // Bridge call frames (resource -> non-resource call continuation) are supported as of
    // RV-14f (§8 "Bridge call frames"); the former RV-14d 'unsupported-rv14d' guard for
    // this case is removed.

    // Refinement selection (§6): aggregate runs the owner and excludes members; refined
    // runs the members and excludes the owner, with crossing connections routed through
    // port mappings.
    const refinementRouting = resolveRefinementRouting(this.document, this.scenario);
    const refinementError = refinementRouting.selectionErrors[0] ?? refinementRouting.crossingViolations[0];
    if (refinementError) {
      this.terminalStatus = 'invalid';
      this.failureReason = refinementError.message;
      this.issues = [
        {
          code: 'invalid-refinement-selection',
          path: ['scenarios', this.scenario.id, 'refinementSelections'],
          entityId: null,
          severity: 'error',
          message: refinementError.message,
        },
      ];
      this.isFinished = true;
      return;
    }
    this.refinementRouting = refinementRouting;
    this.refinementExcludedElementIds = new Set(refinementRouting.excludedElementIds);
    this.effectiveConnections = refinementRouting.remapConnections(this.document.connections);

    // Initialize machine states & contexts
    for (const elId of this.scenario.scopeElementIds) {
      const el = this.elementsMap.get(elId);
      if (!el || el.behavior.kind !== 'machine') continue;
      const mb = el.behavior as MachineBehavior;
      const scContext = this.scenario.initialContexts.find((ic) => ic.elementId === elId);
      let ctxFixture: Json | undefined;
      if (scContext) {
        ctxFixture = this.fixturesMap.get(scContext.fixtureId);
      } else {
        ctxFixture = this.fixturesMap.get(mb.initialContextFixtureId);
      }
      const initialContext = ctxFixture !== undefined ? deepCloneJson(ctxFixture) : {};
      this.machineStates.set(elId, {
        stateId: mb.initialStateId,
        context: initialContext,
      });
    }

    // Initialize inputs
    this.unconsumedInputs = [...this.scenario.inputs];

    // Initialize mode-specific resources
    if (this.scenario.mode === 'timed') {
      const hasResourceElements = document.elements.some(
        (e) =>
          e.behavior.kind === 'resource' &&
          this.scenario.scopeElementIds.includes(e.id) &&
          !this.refinementExcludedElementIds.has(e.id),
      );
      if (hasResourceElements) {
        // Built from the refinement-resolved elements/connections (not {document,
        // scenarioId}) so an aggregate/refined selection changes which resource
        // configuration actually runs (§11 S05 "Aggregate and refined service
        // configurations are exclusive per scenario").
        const effectiveElements = this.refinementExcludedElementIds.size
          ? this.document.elements.filter((e) => !this.refinementExcludedElementIds.has(e.id))
          : this.document.elements;

        const disabledWorkloadIds = new Set<string>(
          this.scenario.workloads
            .filter((wl) => this.scenario.inputs.some((inp) => inp.entry.elementId === wl.entry.elementId))
            .map((wl) => wl.id),
        );

        let durationMs: number | undefined;
        let arrivalHorizonMs: number | undefined;
        let maxRootArrivals: number | undefined;
        if (this.scenario.completion.kind === 'horizon') durationMs = this.scenario.completion.horizonMs;
        else if (this.scenario.completion.kind === 'drain') {
          // §6: no arrivals after arrivalHorizonMs; the run continues to deadlineMs to drain.
          durationMs = this.scenario.completion.deadlineMs;
          arrivalHorizonMs = this.scenario.completion.arrivalHorizonMs;
        } else if (this.scenario.completion.kind === 'count') {
          // D55: arrivals stop after `requests` roots; the run continues to deadlineMs to drain.
          durationMs = this.scenario.completion.deadlineMs;
          maxRootArrivals = this.scenario.completion.requests;
        } else if (this.scenario.completion.kind === 'open') {
          // D55: no end until the user stops it.
          durationMs = OPEN_RUN_CEILING_MS;
        }

        this.adapter = new ResourceAdapter({
          elements: effectiveElements,
          connections: this.effectiveConnections,
          relations: this.document.relations,
          faults: this.scenario.faults,
          workloads: this.scenario.workloads,
          seed: this.scenario.seed,
          durationMs,
          arrivalHorizonMs,
          maxRootArrivals,
          runId: this.runId,
          disabledWorkloadIds,
        });
      }

      // Populate initial external inputs into timed scheduler
      for (const input of this.scenario.inputs) {
        this.timedQueue.push({
          kind: 'external-input',
          atMs: input.atMs ?? 0,
          phase: 3,
          sequence: ++this.globalSequence,
          input,
        });
      }
      this.sortTimedQueue();
    } else {
      // Logical mode check: logical scenarios reaching resources reject readiness (§6)
      const hasResourceElements = document.elements.some(
        (e) => e.behavior.kind === 'resource' && this.scenario.scopeElementIds.includes(e.id),
      );
      if (hasResourceElements) {
        this.terminalStatus = 'invalid';
        this.failureReason = 'Logical scenario cannot reach resource elements (§6)';
        this.isFinished = true;
      }
    }
  }

  private connectionsFromSource(sourceEndpoint: Endpoint): readonly Connection[] {
    const sourceKeys = new Set(
      this.refinementRouting
        .outboundEndpoints(sourceEndpoint.elementId, sourceEndpoint.portId)
        .map((endpoint) => `${endpoint.elementId}:${endpoint.portId}`),
    );
    const connections: Connection[] = [];
    const seenConnectionIds = new Set<Id>();
    for (const connection of this.effectiveConnections) {
      if (!sourceKeys.has(`${connection.source.elementId}:${connection.source.portId}`)) continue;
      if (seenConnectionIds.has(connection.id)) continue;
      seenConnectionIds.add(connection.id);
      connections.push(connection);
    }
    return connections;
  }

  private sortTimedQueue(): void {
    this.timedQueue.sort((a, b) => {
      if (a.atMs !== b.atMs) return a.atMs - b.atMs;
      if (a.phase !== b.phase) return a.phase - b.phase;
      return a.sequence - b.sequence;
    });
  }

  private recordPortEmission(port: Endpoint, journeyId: Id, payload: Json): void {
    const portKey = `${port.elementId}:${port.portId}`;
    let portOut = this.outputsMap.get(portKey);
    if (!portOut) {
      portOut = { port, values: [] };
      this.outputsMap.set(portKey, portOut);
    }
    portOut.values.push(payload);

    const journeyKey = `${port.elementId}:${port.portId}:${journeyId}`;
    let journeyList = this.emissionsByPortAndJourney.get(journeyKey);
    if (!journeyList) {
      journeyList = [];
      this.emissionsByPortAndJourney.set(journeyKey, journeyList);
    }
    journeyList.push(deepCloneJson(payload));
  }

  private async settleCallFrame(frameId: string, outcome: TransportOutcome, payloadRef?: string): Promise<boolean> {
    // Bridge call frames (§8): this frame was handed to an external (non-resource)
    // business flow by the resource adapter; settling it here resolves the resource's own
    // waiting op via ResourceAdapter.settleCall, rather than touching root accounting
    // directly (the resource's own eventual unit_settled — via routeSettlement — is what
    // ultimately settles the OUTER frame that shares the promoted user root).
    if (this.kernelBridgeFrames.has(frameId)) {
      this.kernelBridgeFrames.delete(frameId);
      if (!this.adapter) return false;
      this.adapter.settleCall({
        frameId,
        outcome,
        payloadRef: payloadRef ?? 'payload-bridge-reply',
        atMs: this.currentTimeMs,
      });
      return true;
    }

    const frameInfo = this.openFrames.get(frameId);
    if (!frameInfo || frameInfo.settled) {
      return false; // Double reply or unknown frame
    }
    frameInfo.settled = true;
    this.openFrames.delete(frameId);

    const userRoot = this.activeUserRoots.get(frameInfo.userRootId);
    if (userRoot) {
      userRoot.outcomes.push(outcome);
      userRoot.openFrameCount--;
      if (userRoot.openFrameCount === 0) {
        this.activeUserRoots.delete(frameInfo.userRootId);
        // Precedence: expired > failed > rejected > succeeded (§5)
        let finalOutcome: TransportOutcome = 'succeeded';
        if (userRoot.outcomes.includes('expired')) finalOutcome = 'expired';
        else if (userRoot.outcomes.includes('failed')) finalOutcome = 'failed';
        else if (userRoot.outcomes.includes('rejected')) finalOutcome = 'rejected';

        this.rootCounts.inFlight = Math.max(0, this.rootCounts.inFlight - 1);
        this.rootCounts[finalOutcome]++;
      }
    }
    return true;
  }

  /**
   * Picks a boundary's reply to one request (§6 Boundaries): the first matching response in
   * declared order, then its fixture with request bindings applied, checked against the
   * boundary's response schema. `consume` follows the contract for finite requests (each
   * response answers once; exhaustion is an error). Workload traffic is statistical, so
   * its requests reuse the first matching response (D47).
   */
  private answerBoundary(
    boundary: Boundary,
    request: Json,
    portId: Id,
    consume: boolean,
  ): { ok: true; response: BoundaryResponse; payload: Json } | { ok: false; error: string } {
    let matchedResponse: BoundaryResponse | null = null;
    for (const resp of boundary.responses) {
      if (consume && !resp.repeat && this.usedBoundaryResponseIds.has(resp.id)) continue;
      const matchRes = defaultEvaluator.evalGuard(resp.match, { input: request, context: {}, outcome: null });
      if (matchRes.ok && matchRes.value) {
        matchedResponse = resp;
        break;
      }
    }
    if (!matchedResponse) {
      return { ok: false, error: `Boundary exhaustion or no matching response on port '${portId}' (§6)` };
    }
    // D51: a repeating response answers every matching request.
    if (consume && !matchedResponse.repeat) this.usedBoundaryResponseIds.add(matchedResponse.id);

    const fixtureVal = this.fixturesMap.get(matchedResponse.responseFixtureId);
    if (fixtureVal === undefined) {
      return { ok: false, error: `Boundary response fixture '${matchedResponse.responseFixtureId}' not found` };
    }
    let responsePayload = deepCloneJson(fixtureVal);
    for (const binding of matchedResponse.payloadBindings) {
      const reqVal = readPath(request, binding.requestPath);
      if (isMissing(reqVal)) {
        return { ok: false, error: `Boundary payload binding: requestPath '${binding.requestPath.join('.')}' not found in request` };
      }
      const setRes = setPathInContext(responsePayload, binding.targetPath, reqVal);
      if (!setRes.ok) return { ok: false, error: `Boundary payload binding set failed: ${setRes.error}` };
      responsePayload = setRes.context;
    }

    const respSchema = this.schemasMap.get(boundary.schemaId);
    if (respSchema) {
      const valRes = validateSchemaValue(responsePayload, respSchema.shape, [], boundary.schemaId);
      if (!valRes.ok) return { ok: false, error: `Boundary response payload failed schema` };
    }
    return { ok: true, response: matchedResponse, payload: responsePayload };
  }

  /** The boundary that answers calls leaving `source` (on the port itself or on the call's target), if any. */
  private boundaryForCall(source: Endpoint): Boundary | undefined {
    return this.scenario.boundaries.find(
      (b) =>
        (b.source.elementId === source.elementId && b.source.portId === source.portId) ||
        this.connectionsFromSource(source).some(
          (c) => c.kind === 'call' && c.target.elementId === b.source.elementId && c.target.portId === b.source.portId,
        ),
    );
  }

  /**
   * Root counts for the whole run: finite-input and machine roots tracked here, plus the
   * roots the kernel generated from workloads, which only the adapter sees (§5, §9).
   */
  private totalRootCounts(): Counts {
    const w = this.adapter?.workloadRoots();
    if (!w) return { ...this.rootCounts };
    return {
      generated: this.rootCounts.generated + w.generated,
      succeeded: this.rootCounts.succeeded + w.succeeded,
      rejected: this.rootCounts.rejected + w.rejected,
      failed: this.rootCounts.failed + w.failed,
      expired: this.rootCounts.expired + w.expired,
      inFlight: this.rootCounts.inFlight + w.inFlight,
    };
  }

  /**
   * Routes a settled TraceEvent to the right accounting path (§5, §8): a resource unit
   * settling on behalf of a machine's direct call (resourceCallPending, keyed by the
   * SAME rootId as the promoted user root) is delivered back to the calling machine's
   * response port exactly like a boundary response, instead of being counted as a bare
   * root settlement by handleSettlementEvent. Every other settled event (workload/finite
   * resource traffic, message delivery) keeps the existing handleSettlementEvent path.
   */
  private routeSettlement(te: Pick<TraceEvent, 'id' | 'kind' | 'code' | 'rootId' | 'outcome' | 'atMs' | 'payloadRef'>): SettlementResult {
    if (
      te.kind === 'settled' &&
      (te.code === 'succeeded' || te.code === 'failed' || te.code === 'rejected' || te.code === 'expired')
    ) {
      const pending = this.resourceCallPending.get(te.rootId);
      if (pending) {
        this.resourceCallPending.delete(te.rootId);
        // §8 "No success is inferred": a settlement with no explicit outcome, or one whose
        // payload reference can't be resolved, fails the run — never a fabricated
        // 'succeeded' outcome or an empty payload standing in for the real one.
        if (!te.outcome) {
          return {
            ok: false,
            status: 'failed',
            reason: `Resource call settlement for root '${te.rootId}' carried no outcome`,
          };
        }
        if (!te.payloadRef) {
          return {
            ok: false,
            status: 'failed',
            reason: `Resource call settlement for root '${te.rootId}' carried no payload reference`,
          };
        }
        const payloadJson = this.recorder.payloadTable.get(te.payloadRef);
        if (payloadJson === undefined) {
          return {
            ok: false,
            status: 'failed',
            reason: `Resource call settlement for root '${te.rootId}' referenced an unresolvable payload '${te.payloadRef}'`,
          };
        }
        const held: HeldBoundaryResponse = {
          response: {
            id: `resource-call:${te.rootId}`,
            match: { op: 'exists', value: { kind: 'literal', value: true } },
            responseFixtureId: '',
            payloadBindings: [],
            delayMs: 0,
            afterInputId: null,
            outcome: te.outcome,
          },
          payload: payloadJson as Json,
          callPortId: pending.callPortId,
          correlationRequestId: pending.correlationRequestId,
          initiatingFrameId: pending.initiatingFrameId,
          machineElementId: pending.machineElementId,
          rootId: pending.rootId,
          journeyId: pending.journeyId,
        };
        this.timedQueue.push({
          kind: 'boundary-response',
          atMs: te.atMs ?? this.currentTimeMs,
          phase: 2,
          sequence: ++this.globalSequence,
          held,
        });
        this.sortTimedQueue();
        return { ok: true, matched: true };
      }
    }
    return handleSettlementEvent(te, {
      activeMessageRoots: this.activeMessageRoots,
      activeUserRoots: this.activeUserRoots,
      deliveredUnitToMessageRoot: this.deliveredUnitToMessageRoot,
      rootCounts: this.rootCounts,
      messageCounts: this.messageCounts,
    });
  }

  /**
   * Checks the adapter for a pending journey/parent resolution failure (§5/§8: every
   * TraceEvent carries its journey, and a message root links to its parent) after every
   * admit()/stepNext() call. Ends the run 'failed' with a sanitized diagnostic instead of
   * ever letting an unresolved journey surface as 'unknown'. Returns true when the run was
   * just ended so the caller can return immediately.
   */
  /** A trace row/byte cap refused an append: stop the run 'incomplete' (storage.md §6). */
  private recorderCapHit(): { readonly ok: false; readonly error: string } {
    this.budgetStop ??= `Budget exhausted: ${this.recorder.stopReason ?? 'trace limit reached'}`;
    this.terminalStatus = 'incomplete';
    this.failureReason = this.budgetStop;
    this.isFinished = true;
    return { ok: false, error: this.budgetStop };
  }

  private failOnUnresolvedJourney(): boolean {
    const failure = this.adapter?.takeJourneyFailure() ?? null;
    if (!failure) return false;
    this.terminalStatus = 'failed';
    this.failureReason = failure;
    this.isFinished = true;
    return true;
  }

  /**
   * Forwards an emission from an element's port to all connected downstream ports.
   * - Data edges: forward invocation context unchanged in zero modeled time.
   * - Message edges into resource entries: create linked message root and admit ResourceInput.
   * - Call edges: forward call with child frame.
   */
  private async forwardEmission(
    sourceEndpoint: Endpoint,
    payload: Json,
    context: InvocationContext,
    atMs: number | null,
  ): Promise<{ ok: boolean; error?: string }> {
    const outgoing = this.connectionsFromSource(sourceEndpoint);

    for (const conn of outgoing) {
      if (conn.kind === 'data') {
        // Data edges forward context unchanged in zero modeled time (§4 & §5)
        const res = await this.dispatchToElement(conn.target, payload, context, atMs);
        if (!res.ok) return res;
      } else if (conn.kind === 'message') {
        const targetEl = this.elementsMap.get(conn.target.elementId);
        const isBroadcastBroker =
          targetEl?.behavior.kind === 'resource' &&
          (targetEl.behavior.config as any)?.type === 'broker' &&
          (targetEl.behavior.config as any)?.delivery === 'broadcast';

        let msgRootId: string;
        if (!isBroadcastBroker) {
          // Message emission creates its own message root linked to its parent (§5)
          msgRootId = `msg_${++this.messageCounter}`;
          this.messageCounts.generated++;
          this.messageCounts.inFlight++;
          this.activeMessageRoots.add(msgRootId);
        } else {
          // Through a broadcast broker (D36), delivered consumer copies become individual message roots
          msgRootId = `pub_${++this.messageCounter}`;
        }

        if (targetEl && targetEl.behavior.kind === 'resource') {

          // Message into resource entry: build ResourceInput from connection resource metadata
          const duration = UNSIMULATED_CALL_DEADLINE_MS;
          const arrivalMs = (atMs ?? 0) + (this.scenario.mode === 'timed' ? (conn.config.latencyMs ?? 0) : 0);
          const deadlineMs = arrivalMs + duration;

          const canon = canonicalJson(payload);
          const payloadRef = canon.ok ? `sha256:${await sha256Hex(canon.text)}` : 'payload-msg';

          const resInput: ResourceInput = {
            rootId: msgRootId,
            journeyId: context.journeyId,
            parentEventId: context.parentEventId,
            entryElementId: conn.target.elementId,
            ...UNSIMULATED_CALL_REQUEST,
            payloadRef,
            atMs: arrivalMs,
            deadlineMs,
          };

          if (this.scenario.mode === 'timed') {
            this.timedQueue.push({
              kind: 'admit-message',
              atMs: arrivalMs,
              phase: 2,
              sequence: ++this.globalSequence,
              resourceInput: resInput,
            });
            this.sortTimedQueue();
          } else {
            return { ok: false, error: 'Logical scenario cannot reach resource elements' };
          }
        }
      } else if (conn.kind === 'call') {
        const targetEl = this.elementsMap.get(conn.target.elementId);
        if (targetEl && targetEl.behavior.kind !== 'resource') {
          const latency = this.scenario.mode === 'timed' ? (conn.config.latencyMs ?? 0) : 0;
          const arrivalMs = atMs !== null ? atMs + latency : null;
          const res = await this.dispatchToElement(conn.target, payload, context, arrivalMs);
          if (!res.ok) return res;
        }
      }
    }
    return { ok: true };
  }

  /**
   * Dispatches a payload to a target element's inbound port.
   */
  private async dispatchToElement(
    targetEndpoint: Endpoint,
    payload: Json,
    context: InvocationContext,
    atMs: number | null,
  ): Promise<{ ok: boolean; error?: string }> {
    const el = this.elementsMap.get(targetEndpoint.elementId);
    if (!el) {
      return { ok: false, error: `Target element '${targetEndpoint.elementId}' not found` };
    }

    if (el.behavior.kind === 'pipeline') {
      const inputRows = Array.isArray(payload) ? payload : [payload];
      const pipeRes = runPipeline(this.document, el, inputRows, context.parentEventId ?? 'evt-in', defaultEvaluator);
      if (!pipeRes.ok) {
        return { ok: false, error: `Pipeline '${el.id}' execution failed: ${pipeRes.reason}` };
      }
      this.collectedRowOutcomes.push(...pipeRes.rowOutcomes);

      for (const emission of pipeRes.emissions) {
        this.processedEvents++;
        if (this.processedEvents > this.scenario.budgets.maxEvents) {
          this.terminalStatus = 'incomplete';
          this.failureReason = this.budgetStop ??= 'Budget exhausted: maxEvents limit reached';
          this.isFinished = true;
          return { ok: false, error: this.failureReason };
        }

        this.recordPortEmission(emission.port, context.journeyId, emission.value as unknown as Json);

        const appendRes = await this.recorder.append({
          rootId: context.rootId,
          journeyId: context.journeyId,
          parentId: context.parentEventId,
          elementId: el.id,
          portId: emission.portId,
          kind: 'dispatch',
          code: 'pipeline-emit',
          payload: emission.value as unknown as Json,
          atMs,
          outcome: null,
        });
        if (!appendRes.ok) return this.recorderCapHit();

        const nextCtx: InvocationContext = {
          ...context,
          parentEventId: appendRes.event?.id ?? context.parentEventId,
        };
        const fRes = await this.forwardEmission(emission.port, emission.value as unknown as Json, nextCtx, atMs);
        if (!fRes.ok) return fRes;
      }
      return { ok: true };
    }

    if (el.behavior.kind === 'decision') {
      const decRes = runDecision(el, payload, {
        doc: this.document,
        schemas: this.schemasMap,
        evaluator: defaultEvaluator,
        context: {},
        outcome: context.outcome,
      });
      if (!decRes.ok) {
        return { ok: false, error: `Decision '${el.id}' failed [${decRes.errorCode}]: ${decRes.errorMessage}` };
      }

      this.processedEvents++;
      if (this.processedEvents > this.scenario.budgets.maxEvents) {
        this.terminalStatus = 'incomplete';
        this.failureReason = this.budgetStop ??= 'Budget exhausted: maxEvents limit reached';
        this.isFinished = true;
        return { ok: false, error: this.failureReason };
      }

      this.recordPortEmission(decRes.emission.port, context.journeyId, decRes.emission.value);

      const appendRes = await this.recorder.append({
        rootId: context.rootId,
        journeyId: context.journeyId,
        parentId: context.parentEventId,
        elementId: el.id,
        portId: decRes.emission.portId,
        kind: 'dispatch',
        code: 'decision-emit',
        payload: decRes.emission.value,
        atMs,
        outcome: null,
      });
      if (!appendRes.ok) return this.recorderCapHit();

      const nextCtx: InvocationContext = {
        ...context,
        parentEventId: appendRes.event?.id ?? context.parentEventId,
      };
      return await this.forwardEmission(decRes.emission.port, decRes.emission.value, nextCtx, atMs);
    }

    if (el.behavior.kind === 'machine') {
      return await this.invokeMachine(el.id, targetEndpoint.portId, payload, context, atMs);
    }

    return { ok: false, error: `Unsupported behavior '${el.behavior.kind}' on element '${el.id}'` };
  }

  /**
   * Invokes a machine element on an inbound port.
   */
  private async invokeMachine(
    machineElementId: Id,
    eventPortId: Id,
    eventPayload: Json,
    context: InvocationContext,
    atMs: number | null,
  ): Promise<{ ok: boolean; error?: string }> {
    const mEl = this.elementsMap.get(machineElementId);
    if (!mEl || mEl.behavior.kind !== 'machine') {
      return { ok: false, error: `Element '${machineElementId}' is not a machine` };
    }
    const mb = mEl.behavior as MachineBehavior;
    const curState = this.machineStates.get(machineElementId)!;

    const portSchemas = new Map<Id, Shape>();
    for (const p of mEl.ports) {
      const sch = this.schemasMap.get(p.schemaId);
      if (sch) portSchemas.set(p.id, sch.shape);
    }
    const contextSchema = mb.contextSchemaId ? this.schemasMap.get(mb.contextSchemaId)?.shape : null;

    const stepResult = stepMachine({
      machine: mb,
      currentStateId: curState.stateId,
      currentContext: curState.context,
      eventPortId,
      payload: eventPayload,
      rootId: context.rootId,
      currentRequestId: context.requestId,
      outcome: context.outcome,
      nextRequestIdCounter: () => ++this.requestIdCounter,
      evaluator: defaultEvaluator,
      contextSchema,
      portSchemas,
    });

    if (!stepResult.ok) {
      return { ok: false, error: `Machine execution error [${stepResult.errorCode}]: ${stepResult.errorMessage}` };
    }

    // Commit machine state & context
    this.machineStates.set(machineElementId, {
      stateId: stepResult.toStateId,
      context: stepResult.context,
    });

    // Control invocation root promotion on first call emission (§5)
    if (context.isExternalControlInput && stepResult.emissions.length > 0) {
      this.rootCounts.generated++;
      this.rootCounts.inFlight++;
      this.activeUserRoots.set(context.rootId, {
        openFrameCount: 0,
        outcomes: [],
      });
    }

    // Process traces
    for (const code of stepResult.traces) {
      this.processedEvents++;
      if (this.processedEvents > this.scenario.budgets.maxEvents) {
        this.terminalStatus = 'incomplete';
        this.failureReason = this.budgetStop ??= 'Budget exhausted: maxEvents limit reached';
        this.isFinished = true;
        return { ok: false, error: this.failureReason };
      }
      const appendRes = await this.recorder.append({
        rootId: context.rootId,
        journeyId: context.journeyId,
        parentId: context.parentEventId,
        elementId: machineElementId,
        portId: null,
        kind: 'state',
        code,
        payload: null,
        atMs,
        outcome: null,
      });
      if (!appendRes.ok) return this.recorderCapHit();
    }

    // Process emissions
    for (const emission of stepResult.emissions) {
      this.processedEvents++;
      if (this.processedEvents > this.scenario.budgets.maxEvents) {
        this.terminalStatus = 'incomplete';
        this.failureReason = this.budgetStop ??= 'Budget exhausted: maxEvents limit reached';
        this.isFinished = true;
        return { ok: false, error: this.failureReason };
      }

      this.recordPortEmission({ elementId: machineElementId, portId: emission.portId }, context.journeyId, emission.value);

      const appendRes = await this.recorder.append({
        rootId: context.rootId,
        journeyId: context.journeyId,
        parentId: context.parentEventId,
        elementId: machineElementId,
        portId: emission.portId,
        kind: 'dispatch',
        code: 'emit',
        payload: emission.value,
        atMs,
        outcome: null,
      });
      if (!appendRes.ok) return this.recorderCapHit();

      const emitContext: InvocationContext = {
        ...context,
        parentEventId: appendRes.event?.id ?? context.parentEventId,
        requestId: emission.correlationRequestId,
      };

      // Check if call port targets a boundary
      const callPort = this.portsMap.get(emission.portId);
      if (callPort && callPort.channel === 'call') {
        const frameId = `frame:${this.runId}:${++this.frameCounter}`;
        const userRootId = context.rootId;
        this.openFrames.set(frameId, { userRootId, settled: false });
        const userRoot = this.activeUserRoots.get(userRootId);
        if (userRoot) userRoot.openFrameCount++;

        const boundary = this.scenario.boundaries.find(
          (b) =>
            (b.source.elementId === machineElementId && b.source.portId === emission.portId) ||
            this.connectionsFromSource({ elementId: machineElementId, portId: emission.portId }).some(
              (c) =>
                c.kind === 'call' &&
                c.target.elementId === b.source.elementId &&
                c.target.portId === b.source.portId,
            ),
        );

        if (boundary) {
          const answer = this.answerBoundary(boundary, emission.value, emission.portId, true);
          if (!answer.ok) return answer;
          const { response: matchedResponse, payload: responsePayload } = answer;

          const held: HeldBoundaryResponse = {
            response: matchedResponse,
            payload: responsePayload,
            callPortId: emission.portId,
            correlationRequestId: emission.correlationRequestId,
            initiatingFrameId: frameId,
            machineElementId,
            rootId: context.rootId,
            journeyId: context.journeyId,
          };

          if (this.scenario.mode === 'timed') {
            const deliveryAtMs = (atMs ?? 0) + (matchedResponse.delayMs ?? 0);
            this.timedQueue.push({
              kind: 'boundary-response',
              atMs: deliveryAtMs,
              phase: 2,
              sequence: ++this.globalSequence,
              held,
            });
            this.sortTimedQueue();
          } else {
            if (matchedResponse.afterInputId === null || this.finishedInputIds.has(matchedResponse.afterInputId)) {
              this.logicalCausalQueue.push(held);
            } else {
              this.heldBoundaryResponses.push(held);
            }
          }
          continue;
        }

        // Direct call into a resource entry (§5 root accounting, §8 bridge call frames):
        // no boundary mocks this call, so if its connection targets a resource element,
        // admit it into the retained kernel using the SAME rootId as the promoted user
        // root ("the bridge call and everything synchronous under it share that root").
        // The frame created above is settled once the resource's own unit_settled fires
        // (directly, or via an internal bridge continuation resolved by settleCall) —
        // see routeSettlement()/resourceCallPending.
        const targetConn = this.connectionsFromSource({ elementId: machineElementId, portId: emission.portId }).find(
          (c) => c.kind === 'call',
        );
        const targetEl = targetConn ? this.elementsMap.get(targetConn.target.elementId) : undefined;
        if (targetConn && targetEl && targetEl.behavior.kind === 'resource') {
          if (this.scenario.mode !== 'timed') {
            return { ok: false, error: 'Logical scenario cannot reach resource elements (§6)' };
          }
          if (!this.adapter) {
            return { ok: false, error: 'Resource adapter not initialized for resource admission' };
          }
          const latencyMs = targetConn.kind === 'call' ? targetConn.config.latencyMs : 0;
          const arrivalMs = (atMs ?? 0) + latencyMs;
          const deadlineMs = arrivalMs + UNSIMULATED_CALL_DEADLINE_MS;
          const canon = canonicalJson(emission.value);
          const payloadRef = canon.ok ? `sha256:${await sha256Hex(canon.text)}` : 'payload-call';

          const resInput: ResourceInput = {
            rootId: context.rootId,
            journeyId: context.journeyId,
            parentEventId: appendRes.event?.id ?? context.parentEventId,
            entryElementId: targetEl.id,
            ...UNSIMULATED_CALL_REQUEST,
            payloadRef,
            atMs: arrivalMs,
            deadlineMs,
          };

          this.resourceCallPending.set(context.rootId, {
            callPortId: emission.portId,
            correlationRequestId: emission.correlationRequestId,
            initiatingFrameId: frameId,
            machineElementId,
            rootId: context.rootId,
            journeyId: context.journeyId,
          });

          this.timedQueue.push({
            kind: 'admit-resource-call',
            atMs: arrivalMs,
            phase: 2,
            sequence: ++this.globalSequence,
            resourceInput: resInput,
          });
          this.sortTimedQueue();
          continue;
        }
      }

      // Forward emission to downstream connections
      const fRes = await this.forwardEmission({ elementId: machineElementId, portId: emission.portId }, emission.value, emitContext, atMs);
      if (!fRes.ok) return fRes;
    }

    // Process replies
    for (const reply of stepResult.replies) {
      if (!context.frameId) {
        return { ok: false, error: 'Reply without active frame fails the run (§4 & §5)' };
      }
      const replyCanon = canonicalJson(reply.value);
      const replyPayloadRef = replyCanon.ok ? `sha256:${await sha256Hex(replyCanon.text)}` : undefined;
      const settledOk = await this.settleCallFrame(context.frameId, reply.outcome, replyPayloadRef);
      if (!settledOk) {
        return { ok: false, error: `Double reply on frame '${context.frameId}' fails the run (§4 & §5)` };
      }

      this.processedEvents++;
      const appendRes = await this.recorder.append({
        rootId: context.rootId,
        journeyId: context.journeyId,
        parentId: context.parentEventId,
        elementId: machineElementId,
        portId: null,
        kind: 'settled',
        code: 'reply',
        payload: reply.value,
        atMs,
        outcome: reply.outcome,
      });
      if (!appendRes.ok) return this.recorderCapHit();
    }

    return { ok: true };
  }

  /**
   * Prepares and validates an external input payload.
   */
  private prepareExternalInput(input: Input): { ok: true; payload: Json } | { ok: false; error: string; rejected: boolean } {
    const fixture = this.fixturesMap.get(input.fixtureId);
    if (fixture === undefined) {
      return { ok: false, error: `Input fixture '${input.fixtureId}' not found`, rejected: false };
    }
    let inputPayload = deepCloneJson(fixture);

    for (const binding of input.payloadBindings) {
      const srcKey = `${binding.source.port.elementId}:${binding.source.port.portId}:${binding.source.journeyId}`;
      const earlierList = this.emissionsByPortAndJourney.get(srcKey);
      if (!earlierList || binding.source.occurrence >= earlierList.length) {
        return {
          ok: false,
          error: `Input binding failed: missing earlier emission for ${srcKey} at occurrence ${binding.source.occurrence}`,
          rejected: false,
        };
      }
      const readVal = readPath(earlierList[binding.source.occurrence], binding.source.path);
      if (isMissing(readVal)) {
        return {
          ok: false,
          error: `Input binding failed: path '${binding.source.path.join('.')}' is missing in source emission`,
          rejected: false,
        };
      }
      const setRes = setPathInContext(inputPayload, binding.targetPath, readVal);
      if (!setRes.ok) {
        return { ok: false, error: `Input binding set failed: ${setRes.error}`, rejected: false };
      }
      inputPayload = setRes.context;
    }

    const entryPort = this.portsMap.get(input.entry.portId);
    if (entryPort) {
      const portSchema = this.schemasMap.get(entryPort.schemaId);
      if (portSchema) {
        const valRes = validateSchemaValue(inputPayload, portSchema.shape, [], entryPort.schemaId);
        if (!valRes.ok) {
          return { ok: false, error: `External input failed schema validation: ${valRes.issues.map((i) => i.message).join('; ')}`, rejected: true };
        }
      }
    }

    return { ok: true, payload: inputPayload };
  }

  /**
   * Steps the runner by one discrete scheduler event.
   * Returns true if more steps remain, false if execution has completed or terminated.
   */
  /**
   * D55: the latest simulated ms at which a draining run must be settled, or null while the run
   * is not draining (a horizon run, or an open run that has not been stopped). A stop shortens the
   * deadline of a drain or count run and starts the drain of a horizon or open run.
   */
  private drainDeadlineMs(): number | null {
    const completion = this.scenario.completion;
    const own = completion.kind === 'drain' || completion.kind === 'count' ? completion.deadlineMs : null;
    if (this.stopDrainDeadlineMs === null) return own;
    return own === null ? this.stopDrainDeadlineMs : Math.min(own, this.stopDrainDeadlineMs);
  }

  /** D55: ask a timed run to stop arrivals and drain; it takes effect at the next step boundary. */
  requestStop(): void {
    if (this.scenario.mode === 'timed' && !this.isFinished) this.stopRequested = true;
  }

  /** D55: the run's simulated clock, in ms. */
  get simulatedMs(): number {
    return this.currentTimeMs;
  }

  /** D55: when the next event is due in simulated ms, or null when none is pending; used to pace a run against the wall clock. */
  nextEventAtMs(): number | null {
    const kernel = this.adapter?.peekNext()?.atMs ?? null;
    const global = this.timedQueue[0]?.atMs ?? null;
    if (kernel === null) return global;
    if (global === null) return kernel;
    return Math.min(kernel, global);
  }

  async step(): Promise<boolean> {
    if (this.isFinished) return false;

    // Cancellation at a scheduler batch boundary (§12): ends the run 'cancelled' with no
    // terminal success, never mid-mutation (checked only between steps).
    if (this.signal?.aborted) {
      this.terminalStatus = 'cancelled';
      this.failureReason = null;
      this.isFinished = true;
      return false;
    }

    // Check budget limits
    if (this.recorder.stopped) {
      this.terminalStatus = 'incomplete';
      this.failureReason = this.budgetStop ??= `Budget exhausted: ${this.recorder.stopReason}`;
      this.isFinished = true;
      return false;
    }

    if (this.processedEvents >= this.scenario.budgets.maxEvents) {
      this.terminalStatus = 'incomplete';
      this.failureReason = this.budgetStop ??= 'Budget exhausted: maxEvents limit reached';
      this.isFinished = true;
      return false;
    }

    const liveRoots = this.totalRootCounts().inFlight + this.messageCounts.inFlight;
    if (liveRoots > this.scenario.budgets.maxLiveRoots) {
      this.terminalStatus = 'incomplete';
      this.failureReason = this.budgetStop ??= 'Budget exhausted: maxLiveRoots limit reached';
      this.isFinished = true;
      return false;
    }

    // ========================================================================
    // LOGICAL MODE STEP
    // ========================================================================
    if (this.scenario.mode === 'logical') {
      // 1. Drain logical causal queue first
      if (this.logicalCausalQueue.length > 0) {
        const held = this.logicalCausalQueue.shift()!;
        const mEl = this.elementsMap.get(held.machineElementId)!;
        const mb = mEl.behavior as MachineBehavior;
        const binding = mb.responseBindings.find((rb) => rb.callPortId === held.callPortId);
        if (!binding) {
          this.terminalStatus = 'failed';
          this.failureReason = `No response binding found for call port '${held.callPortId}'`;
          this.isFinished = true;
          return false;
        }

        this.processedEvents++;
        const appendRes = await this.recorder.append({
          rootId: held.rootId,
          journeyId: held.journeyId,
          parentId: null,
          elementId: held.machineElementId,
          portId: binding.eventPortId,
          kind: 'dispatch',
          code: 'boundary-response',
          payload: held.payload,
          atMs: null,
          outcome: held.response.outcome,
        });
        if (!appendRes.ok) {
          this.terminalStatus = 'incomplete';
          this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
          this.isFinished = true;
          return false;
        }

        await this.settleCallFrame(held.initiatingFrameId, held.response.outcome);

        const invContext: InvocationContext = {
          frameId: null,
          rootId: held.rootId,
          journeyId: held.journeyId,
          parentEventId: appendRes.event?.id ?? null,
          requestId: held.correlationRequestId,
          outcome: held.response.outcome,
        };

        const invRes = await this.invokeMachine(held.machineElementId, binding.eventPortId, held.payload, invContext, null);
        if (!invRes.ok) {
          this.terminalStatus = 'failed';
          this.failureReason = invRes.error ?? 'Machine invocation failed';
          this.isFinished = true;
          return false;
        }
        return true;
      }

      // 2. Consume next external input
      if (this.unconsumedInputs.length > 0) {
        const input = this.unconsumedInputs.shift()!;
        this.consumedInputs++;

        const prep = this.prepareExternalInput(input);
        if (!prep.ok) {
          if (prep.rejected) {
            this.rootCounts.generated++;
            this.rootCounts.rejected++;
          }
          this.terminalStatus = 'failed';
          this.failureReason = prep.error;
          this.isFinished = true;
          return false;
        }

        const inputRootId = rootId(input.id, 0);

        this.processedEvents++;
        const inputAppend = await this.recorder.append({
          rootId: inputRootId,
          journeyId: input.journeyId,
          parentId: null,
          elementId: input.entry.elementId,
          portId: input.entry.portId,
          kind: 'input',
          code: 'input',
          payload: prep.payload,
          atMs: null,
          outcome: null,
        });
        if (!inputAppend.ok) {
          this.terminalStatus = 'incomplete';
          this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
          this.isFinished = true;
          return false;
        }

        const entryEl = this.elementsMap.get(input.entry.elementId);
        const entryPort = this.portsMap.get(input.entry.portId);

        let frameId: string | null = null;
        if (entryEl?.behavior.kind === 'machine' && entryPort?.channel === 'call') {
          frameId = `frame:${this.runId}:${++this.frameCounter}`;
          this.rootCounts.generated++;
          this.rootCounts.inFlight++;
          this.openFrames.set(frameId, { userRootId: inputRootId, settled: false });
          this.activeUserRoots.set(inputRootId, { openFrameCount: 1, outcomes: [] });
        }

        const invContext: InvocationContext = {
          frameId,
          rootId: inputRootId,
          journeyId: input.journeyId,
          parentEventId: inputAppend.event?.id ?? null,
          requestId: (prep.payload as any)?.requestId ?? null,
          outcome: null,
          isExternalControlInput: entryPort?.channel !== 'call',
        };

        const dispRes = await this.dispatchToElement(input.entry, prep.payload, invContext, null);
        if (!dispRes.ok) {
          this.terminalStatus = 'failed';
          this.failureReason = dispRes.error ?? 'Input dispatch failed';
          this.isFinished = true;
          return false;
        }

        this.finishedInputIds.add(input.id);

        // Release any boundary responses held for this input
        for (let i = this.heldBoundaryResponses.length - 1; i >= 0; i--) {
          if (this.heldBoundaryResponses[i].response.afterInputId === input.id) {
            this.logicalCausalQueue.unshift(this.heldBoundaryResponses.splice(i, 1)[0]);
          }
        }

        return true;
      }

      // 3. Quiescent completion check
      const queueDrained = this.logicalCausalQueue.length === 0 && this.heldBoundaryResponses.length === 0;
      const allFramesSettled = this.openFrames.size === 0;

      this.isFinished = true;
      if (queueDrained && allFramesSettled) {
        this.terminalStatus = 'completed';
        this.failureReason = null;
      } else {
        this.terminalStatus = 'incomplete';
        this.failureReason = 'Logical run incomplete: unsettled frames or undrained work remaining';
      }
      return false;
    }

    // ========================================================================
    // TIMED MODE STEP (One global scheduler: atMs, phase, sequence)
    // ========================================================================

    // D55: a requested stop takes effect at a step boundary: no workload or input arrives again, and
    // what is in flight gets up to STOP_DRAIN_MS of simulated time to finish.
    if (this.stopRequested && this.stoppedAtMs === null) {
      this.stoppedAtMs = this.currentTimeMs;
      this.stopDrainDeadlineMs = this.currentTimeMs + STOP_DRAIN_MS;
      this.adapter?.stopArrivals();
      const kept = this.timedQueue.filter((evt) => evt.kind !== 'external-input');
      this.timedQueue.splice(0, this.timedQueue.length, ...kept);
    }

    // Check completion condition
    const completion = this.scenario.completion;
    // Horizon runs end at their horizon whether or not work is in flight.
    if (completion.kind === 'horizon' && this.currentTimeMs >= completion.horizonMs) {
      this.isFinished = true;
      this.terminalStatus = 'completed';
      this.failureReason = null;
      return false;
    }
    const drainDeadlineMs = this.drainDeadlineMs();
    if (drainDeadlineMs !== null) {
      // A pending kernel event at or before the scenario's own drain deadline might still
      // be, or lead to, real causal work (a queued/retrying attempt, a periodic sample
      // that happens to coincide with the deadline as its very last tick — the existing,
      // exact mechanism S02/S04 rely on for their own drain completion). A pending event
      // strictly AFTER the deadline can't matter to this run's outcome either way (the
      // scenario itself never observes past its own deadline), so it never blocks
      // detecting drainage from the studio-level counts alone. This is what keeps an
      // already-settled unit's own deadline-expiry timer (scheduled unconditionally,
      // becoming a harmless no-op once its unit is done) from blocking completion when it
      // merely happens to fall a little past the deadline — narrower than requiring the
      // raw kernel event heap to be empty (peekNext() === null) outright.
      // D55: a count or stopped run is drained as soon as nothing is live and nothing will arrive; a plain
      // drain run keeps the event-based rule above, which its recorded behavior depends on.
      const kernelPeek = this.adapter?.peekNext() ?? null;
      const legacyDrain = completion.kind === 'drain' && this.stoppedAtMs === null;
      const kernelMayStillMatter = legacyDrain
        ? !!kernelPeek && kernelPeek.atMs <= drainDeadlineMs
        : !(this.adapter?.isIdle() ?? true);
      const isDrained =
        this.timedQueue.length === 0 &&
        !kernelMayStillMatter &&
        this.totalRootCounts().inFlight === 0 &&
        this.messageCounts.inFlight === 0 &&
        this.openFrames.size === 0;

      if (isDrained) {
        this.isFinished = true;
        // A count run that ran out of time before sending every request did not do what it was asked.
        const sent = this.totalRootCounts().generated;
        if (completion.kind === 'count' && this.stoppedAtMs === null && sent < completion.requests) {
          this.terminalStatus = 'incomplete';
          this.failureReason = `Only ${sent} of ${completion.requests} requests arrived before the deadline`;
        } else {
          this.terminalStatus = 'completed';
          this.failureReason = null;
        }
        return false;
      }

      if (this.currentTimeMs >= drainDeadlineMs) {
        this.isFinished = true;
        this.terminalStatus = 'incomplete';
        this.failureReason =
          this.stoppedAtMs !== null && completion.kind !== 'drain' && completion.kind !== 'count'
            ? 'Stopped, but work was still in flight after the drain time'
            : 'Drain deadline reached before all causal work settled';
        return false;
      }
    }

    const kernelNext = this.adapter?.peekNext();
    const globalNext = this.timedQueue[0];

    if (!kernelNext && !globalNext) {
      // Nothing more to run
      this.isFinished = true;
      if (this.drainDeadlineMs() !== null) {
        const isDrained =
          this.totalRootCounts().inFlight === 0 &&
          this.messageCounts.inFlight === 0 &&
          this.openFrames.size === 0;
        this.terminalStatus = isDrained ? 'completed' : 'incomplete';
        this.failureReason = isDrained ? null : 'Unsettled work remaining at end of events';
      } else {
        this.terminalStatus = 'completed';
        this.failureReason = null;
      }
      return false;
    }

    // Compare priorities: (atMs, phase, sequence)
    let stepKernel = false;
    if (kernelNext && !globalNext) {
      stepKernel = true;
    } else if (kernelNext && globalNext) {
      if (kernelNext.atMs < globalNext.atMs) {
        stepKernel = true;
      } else if (kernelNext.atMs === globalNext.atMs) {
        // Phase 1 (kernel) has precedence over Phase 2 or 3 (§8)
        stepKernel = kernelNext.phase <= globalNext.phase;
      } else {
        stepKernel = false;
      }
    }

    if (stepKernel && kernelNext) {
      this.currentTimeMs = kernelNext.atMs;
      const delta = this.adapter!.stepNext();
      if (this.failOnUnresolvedJourney()) return false;

      for (const te of delta.events) {
        this.processedEvents++;
        const appendRes = await this.recorder.append({
          rootId: te.rootId,
          journeyId: te.journeyId,
          parentId: te.parentId,
          elementId: te.elementId,
          portId: te.portId,
          kind: te.kind,
          code: te.code,
          payloadRef: te.payloadRef,
          atMs: te.atMs,
          outcome: te.outcome,
        });
        if (!appendRes.ok) {
          this.terminalStatus = 'incomplete';
          this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
          this.isFinished = true;
          return false;
        }

        // Exact linkage: record delivered unit IDs when adapter reports message creation (§8 & D36)
        if (te.kind === 'dispatch' && te.code === 'message' && te.parentId) {
          if (this.activeMessageRoots.has(te.parentId)) {
            this.deliveredUnitToMessageRoot.set(te.rootId, te.parentId);
          } else {
            // A message dispatch whose parent isn't already a known message root (D36
            // broadcast: the runner doesn't pre-register a root for a broadcast publish,
            // only for the ordinary single-delivery case) mints one now. The adapter's
            // clean, deterministic rootId (never a parsed/matched identity string) is
            // used directly as this delivered copy's own conserved message root.
            this.messageCounts.generated++;
            this.messageCounts.inFlight++;
            this.activeMessageRoots.add(te.rootId);
            this.deliveredUnitToMessageRoot.set(te.rootId, te.rootId);
          }
        }

        // Handle unit settlement (no inferred success, exact linkage)
        const settlementRes = this.routeSettlement(te);
        if (!settlementRes.ok) {
          this.terminalStatus = settlementRes.status;
          this.failureReason = settlementRes.reason;
          this.isFinished = true;
          return false;
        }
      }

      // Process adapter outputs. A non-null frameId (§8 bridge call frames) marks this as
      // a bridge dispatch: the resource's call continuation reaches an external
      // (non-resource) target, carrying the real admitted payload (resolved from the
      // recorder's payload table, never the placeholder `{}`) and no transport outcome
      // yet (the call has only just been dispatched, not settled) — the eventual reply
      // resolves via settleCallFrame()/kernelBridgeFrames once it reaches a reply effect.
      for (const out of delta.outputs) {
        const outConnections = this.connectionsFromSource(out.source);
        const payload =
          out.payloadRef === WORKLOAD_PAYLOAD_REF ? WORKLOAD_REQUEST_PAYLOAD : this.recorder.payloadTable.get(out.payloadRef);
        if (payload === undefined) {
          // §8 "No success is inferred": never substitute a fabricated `{}` payload for
          // one that can't be resolved.
          this.terminalStatus = 'failed';
          this.failureReason = `Bridge dispatch from '${out.source.elementId}' referenced an unresolvable payload '${out.payloadRef}'`;
          this.isFinished = true;
          return false;
        }
        if (out.frameId) {
          this.kernelBridgeFrames.add(out.frameId);
          const boundary = this.boundaryForCall(out.source);
          if (boundary) {
            // A resource calling out past a boundary (e.g. a service calling a third party):
            // the boundary answers after its delay, and the reply settles the kernel's
            // waiting op through the bridge frame, adding the connection's return latency.
            const consume = out.payloadRef !== WORKLOAD_PAYLOAD_REF;
            if (!consume) {
              const outPort = this.portsMap.get(out.source.portId);
              const shape = outPort ? this.schemasMap.get(outPort.schemaId)?.shape : undefined;
              if (shape && !validateSchemaValue(WORKLOAD_REQUEST_PAYLOAD, shape, [], outPort!.schemaId).ok) {
                this.terminalStatus = 'failed';
                this.failureReason = `Traffic requests carry an empty payload, but the call from '${out.source.elementId}' requires fields; drive this call with inputs instead`;
                this.isFinished = true;
                return false;
              }
            }
            const answer = this.answerBoundary(boundary, payload, out.source.portId, consume);
            if (!answer.ok) {
              this.terminalStatus = 'failed';
              this.failureReason = answer.error;
              this.isFinished = true;
              return false;
            }
            this.timedQueue.push({
              kind: 'resource-boundary-response',
              atMs: (out.atMs ?? this.currentTimeMs) + (answer.response.delayMs ?? 0),
              phase: 2,
              sequence: ++this.globalSequence,
              frameId: out.frameId,
              source: out.source,
              rootId: out.rootId,
              journeyId: out.journeyId,
              parentEventId: out.parentEventId,
              payload: answer.payload,
              outcome: answer.response.outcome,
            });
            continue;
          }
        }
        for (const conn of outConnections) {
          const atMs = out.atMs ?? this.currentTimeMs;
          this.timedQueue.push({
            kind: 'edge-dispatch',
            atMs,
            phase: 2,
            sequence: ++this.globalSequence,
            target: conn.target,
            payload,
            context: {
              frameId: out.frameId,
              rootId: out.rootId,
              journeyId: out.journeyId,
              parentEventId: out.parentEventId,
              // A bridge dispatch (§8) carries the application request ID embedded in the
              // forwarded payload (e.g. checkout's own `requestId` field), so a
              // `correlation:{kind:'current'}` emission on the far side of the bridge can
              // still reuse it (there is no authored reverse edge to derive it from).
              requestId:
                payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as Record<string, Json>).requestId === 'string'
                  ? ((payload as Record<string, Json>).requestId as string)
                  : null,
              outcome: out.frameId ? null : out.outcome,
            },
          });
        }
      }
      this.sortTimedQueue();
      return true;
    }

    // Step next global event
    const evt = this.timedQueue.shift()!;
    this.currentTimeMs = evt.atMs;

    switch (evt.kind) {
      case 'external-input': {
        if (
          (this.scenario.completion.kind === 'drain' && evt.atMs > this.scenario.completion.arrivalHorizonMs) ||
          (this.stoppedAtMs !== null && evt.atMs > this.stoppedAtMs)
        ) {
          // No arrivals after arrivalHorizonMs (§6), or after a stop (D55)
          return true;
        }

        this.consumedInputs++;
        const prep = this.prepareExternalInput(evt.input);
        if (!prep.ok) {
          if (prep.rejected) {
            this.rootCounts.generated++;
            this.rootCounts.rejected++;
          }
          this.terminalStatus = 'failed';
          this.failureReason = prep.error;
          this.isFinished = true;
          return false;
        }

        const inputRootId = rootId(evt.input.id, 0);

        this.processedEvents++;
        const inputAppend = await this.recorder.append({
          rootId: inputRootId,
          journeyId: evt.input.journeyId,
          parentId: null,
          elementId: evt.input.entry.elementId,
          portId: evt.input.entry.portId,
          kind: 'input',
          code: 'input',
          payload: prep.payload,
          atMs: evt.atMs,
          outcome: null,
        });
        if (!inputAppend.ok) {
          this.terminalStatus = 'incomplete';
          this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
          this.isFinished = true;
          return false;
        }

        const entryEl = this.elementsMap.get(evt.input.entry.elementId);
        const entryPort = this.portsMap.get(evt.input.entry.portId);

        if (entryEl?.behavior.kind === 'resource') {
          if (!this.adapter) {
            this.terminalStatus = 'failed';
            this.failureReason = 'Resource adapter not initialized for resource admission';
            this.isFinished = true;
            return false;
          }
          const resMeta = evt.input.resource;
          const resInput: ResourceInput = {
            rootId: inputRootId,
            journeyId: evt.input.journeyId,
            parentEventId: inputAppend.event?.id ?? null,
            entryElementId: evt.input.entry.elementId,
            requestClassId: resMeta?.requestClassId ?? 'default-class',
            operation: resMeta?.operation ?? 'read',
            key: resMeta?.key ?? null,
            tags: resMeta?.tags ? [...resMeta.tags] : [],
            payloadRef: inputAppend.event?.payloadRef ?? 'payload-input',
            atMs: evt.atMs,
            deadlineMs: resMeta?.deadlineMs ?? (evt.atMs + 9000),
          };

          this.activeUserRoots.set(inputRootId, { openFrameCount: 0, outcomes: [] });
          this.rootCounts.generated++;
          this.rootCounts.inFlight++;

          const adm = this.adapter.admit(resInput);
          if (this.failOnUnresolvedJourney()) return false;
          for (const te of adm.events) {
            if (te.kind === 'input' && te.code === 'admit') {
              continue;
            }
            this.processedEvents++;
            const appendRes = await this.recorder.append({
              rootId: te.rootId,
              journeyId: te.journeyId,
              parentId: te.parentId,
              elementId: te.elementId,
              portId: te.portId,
              kind: te.kind,
              code: te.code,
              payloadRef: te.payloadRef,
              atMs: te.atMs,
              outcome: te.outcome,
            });
            if (!appendRes.ok) {
              this.terminalStatus = 'incomplete';
              this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
              this.isFinished = true;
              return false;
            }

            const settlementRes = this.routeSettlement(te);
            if (!settlementRes.ok) {
              this.terminalStatus = settlementRes.status;
              this.failureReason = settlementRes.reason;
              this.isFinished = true;
              return false;
            }
          }
          return true;
        }

        let frameId: string | null = null;
        if (entryEl?.behavior.kind === 'machine' && entryPort?.channel === 'call') {
          // Call entry creates one user root and a frame (§5 & BUILD)
          frameId = `frame:${this.runId}:${++this.frameCounter}`;
          this.rootCounts.generated++;
          this.rootCounts.inFlight++;
          this.openFrames.set(frameId, { userRootId: inputRootId, settled: false });
          this.activeUserRoots.set(inputRootId, { openFrameCount: 1, outcomes: [] });
        }

        const invContext: InvocationContext = {
          frameId,
          rootId: inputRootId,
          journeyId: evt.input.journeyId,
          parentEventId: inputAppend.event?.id ?? null,
          requestId: (prep.payload as any)?.requestId ?? null,
          outcome: null,
          isExternalControlInput: entryPort?.channel !== 'call',
        };

        const dispRes = await this.dispatchToElement(evt.input.entry, prep.payload, invContext, evt.atMs);
        if (!dispRes.ok) {
          this.terminalStatus = 'failed';
          this.failureReason = dispRes.error ?? 'Input dispatch failed';
          this.isFinished = true;
          return false;
        }
        return true;
      }

      case 'admit-message': {
        if (!this.adapter) {
          this.terminalStatus = 'failed';
          this.failureReason = 'Resource adapter not initialized for message admission';
          this.isFinished = true;
          return false;
        }

        const adm = this.adapter.admit(evt.resourceInput);
        if (this.failOnUnresolvedJourney()) return false;
        for (const te of adm.events) {
          this.processedEvents++;
          const appendRes = await this.recorder.append({
            rootId: te.rootId,
            journeyId: te.journeyId,
            parentId: te.parentId,
            elementId: te.elementId,
            portId: te.portId,
            kind: te.kind,
            code: te.code,
            payloadRef: te.payloadRef,
            atMs: te.atMs,
            outcome: te.outcome,
          });
          if (!appendRes.ok) {
            this.terminalStatus = 'incomplete';
            this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
            this.isFinished = true;
            return false;
          }

          if (te.kind === 'dispatch' && te.code === 'message' && te.parentId) {
            if (this.activeMessageRoots.has(te.parentId)) {
              this.deliveredUnitToMessageRoot.set(te.rootId, te.parentId);
            } else {
              // D36 broadcast: no pre-registered root for a broadcast publish. Mint one
              // now, using the adapter's clean, deterministic rootId directly — never a
              // parsed/matched identity string.
              this.messageCounts.generated++;
              this.messageCounts.inFlight++;
              this.activeMessageRoots.add(te.rootId);
              this.deliveredUnitToMessageRoot.set(te.rootId, te.rootId);
            }
          }
        }

        if (!adm.accepted) {
          this.activeMessageRoots.delete(evt.resourceInput.rootId);
          for (const [k, v] of this.deliveredUnitToMessageRoot.entries()) {
            if (v === evt.resourceInput.rootId) {
              this.deliveredUnitToMessageRoot.delete(k);
            }
          }
          this.messageCounts.inFlight = Math.max(0, this.messageCounts.inFlight - 1);
          this.messageCounts.rejected++;
        }
        return true;
      }

      case 'admit-resource-call': {
        // A machine's call routed directly into a resource entry (§5, §8): admission is
        // recorded via resourceCallPending (registered when the call was emitted), so
        // every settlement — including an immediate admission rejection, which the
        // kernel surfaces synchronously in adm.events — routes back to the calling
        // machine's response port via routeSettlement() instead of bare root counting.
        if (!this.adapter) {
          this.terminalStatus = 'failed';
          this.failureReason = 'Resource adapter not initialized for resource call admission';
          this.isFinished = true;
          return false;
        }

        const adm = this.adapter.admit(evt.resourceInput);
        if (this.failOnUnresolvedJourney()) return false;
        for (const te of adm.events) {
          if (te.kind === 'input' && te.code === 'admit') continue;
          this.processedEvents++;
          const appendRes = await this.recorder.append({
            rootId: te.rootId,
            journeyId: te.journeyId,
            parentId: te.parentId,
            elementId: te.elementId,
            portId: te.portId,
            kind: te.kind,
            code: te.code,
            payloadRef: te.payloadRef,
            atMs: te.atMs,
            outcome: te.outcome,
          });
          if (!appendRes.ok) {
            this.terminalStatus = 'incomplete';
            this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
            this.isFinished = true;
            return false;
          }

          const settlementRes = this.routeSettlement(te);
          if (!settlementRes.ok) {
            this.terminalStatus = settlementRes.status;
            this.failureReason = settlementRes.reason;
            this.isFinished = true;
            return false;
          }
        }
        return true;
      }

      case 'edge-dispatch': {
        const dispRes = await this.dispatchToElement(evt.target, evt.payload, evt.context, evt.atMs);
        if (!dispRes.ok) {
          this.terminalStatus = 'failed';
          this.failureReason = dispRes.error ?? 'Edge dispatch failed';
          this.isFinished = true;
          return false;
        }
        return true;
      }

      case 'scheduled-machine-event': {
        const invRes = await this.invokeMachine(evt.elementId, evt.portId, evt.payload, evt.context, evt.atMs);
        if (!invRes.ok) {
          this.terminalStatus = 'failed';
          this.failureReason = invRes.error ?? 'Scheduled machine event failed';
          this.isFinished = true;
          return false;
        }
        return true;
      }

      case 'resource-boundary-response': {
        this.processedEvents++;
        const appendRes = await this.recorder.append({
          rootId: evt.rootId,
          journeyId: evt.journeyId,
          parentId: evt.parentEventId,
          elementId: evt.source.elementId,
          portId: evt.source.portId,
          kind: 'dispatch',
          code: 'boundary-response',
          payload: evt.payload,
          atMs: evt.atMs,
          outcome: evt.outcome,
        });
        if (!appendRes.ok) {
          this.terminalStatus = 'incomplete';
          this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
          this.isFinished = true;
          return false;
        }
        await this.settleCallFrame(evt.frameId, evt.outcome, appendRes.event?.payloadRef ?? undefined);
        return true;
      }

      case 'boundary-response': {
        const { held } = evt;
        const mEl = this.elementsMap.get(held.machineElementId)!;
        const mb = mEl.behavior as MachineBehavior;
        const binding = mb.responseBindings.find((rb) => rb.callPortId === held.callPortId);
        if (!binding) {
          this.terminalStatus = 'failed';
          this.failureReason = `No response binding found for call port '${held.callPortId}'`;
          this.isFinished = true;
          return false;
        }

        this.processedEvents++;
        const appendRes = await this.recorder.append({
          rootId: held.rootId,
          journeyId: held.journeyId,
          parentId: null,
          elementId: held.machineElementId,
          portId: binding.eventPortId,
          kind: 'dispatch',
          code: 'boundary-response',
          payload: held.payload,
          atMs: evt.atMs,
          outcome: held.response.outcome,
        });
        if (!appendRes.ok) {
          this.terminalStatus = 'incomplete';
          this.failureReason = this.budgetStop ??= 'Budget exhausted: recorder cap hit';
          this.isFinished = true;
          return false;
        }

        await this.settleCallFrame(held.initiatingFrameId, held.response.outcome);

        const invContext: InvocationContext = {
          frameId: null,
          rootId: held.rootId,
          journeyId: held.journeyId,
          parentEventId: appendRes.event?.id ?? null,
          requestId: held.correlationRequestId,
          outcome: held.response.outcome,
        };

        const invRes = await this.invokeMachine(held.machineElementId, binding.eventPortId, held.payload, invContext, evt.atMs);
        if (!invRes.ok) {
          this.terminalStatus = 'failed';
          this.failureReason = invRes.error ?? 'Machine invocation failed';
          this.isFinished = true;
          return false;
        }
        return true;
      }
    }
  }

  /**
   * Runs the scenario to completion or until maxSteps.
   */
  async run(options: { maxSteps?: number } = {}): Promise<ScenarioRunResult> {
    const maxSteps = options.maxSteps ?? Infinity;
    let steps = 0;
    while (!this.isFinished && steps < maxSteps) {
      const hasMore = await this.step();
      steps++;
      if (!hasMore) break;
    }
    return this.getResult();
  }

  /**
   * Assembles the final ScenarioRunResult with RunSummary and CheckResults.
   */
  getResult(): ScenarioRunResult {
    let elapsedMs: number | null = null;
    let metrics: readonly ElementMetric[] = [];

    if (this.scenario.mode === 'timed') {
      const drainDeadline = this.drainDeadlineMs();
      if (drainDeadline !== null) {
        const isDrained =
          this.totalRootCounts().inFlight === 0 &&
          this.messageCounts.inFlight === 0 &&
          this.openFrames.size === 0;
        elapsedMs = isDrained ? this.currentTimeMs : Math.max(this.currentTimeMs, drainDeadline);
      } else if (this.scenario.completion.kind === 'horizon') {
        elapsedMs = this.scenario.completion.horizonMs;
      } else {
        elapsedMs = this.currentTimeMs;
      }

      if (this.adapter) {
        // Collect metrics from adapter snapshot
        metrics = this.adapter.snapshot().metrics;
      }
    }

    const summary: RunSummary = {
      mode: this.scenario.mode,
      consumedInputs: this.consumedInputs,
      rootCounts: this.totalRootCounts(),
      messageCounts: { ...this.messageCounts },
      elementMetrics: metrics,
      finalStates: Array.from(this.machineStates.entries()).map(([elementId, st]) => ({
        elementId,
        stateId: st.stateId,
        context: st.context,
      })),
      outputs: Array.from(this.outputsMap.values()).map((o) => ({
        port: o.port,
        values: o.values,
      })),
      coverage: {
        includedElementIds: this.scenario.scopeElementIds.filter(
          (id) => !this.refinementExcludedElementIds.has(id),
        ),
        // Refinement selection (§6): unselected elements (the excluded owner in refined
        // mode, or the excluded members in aggregate mode) stay uncovered here.
        excludedElementIds: this.scenario.scopeElementIds.filter((id) =>
          this.refinementExcludedElementIds.has(id),
        ),
      },
      processedEvents: this.processedEvents,
      elapsedMs,
      rowOutcomes: this.collectedRowOutcomes,
      trace: { recordedRows: this.recorder.events.length, truncatedBy: this.recorder.truncatedBy },
    };

    const checks = evaluateAssertions(this.scenario.assertions, summary, this.recorder.events);

    return {
      status: this.budgetStop !== null && this.terminalStatus === 'failed' ? 'incomplete' : this.terminalStatus,
      events: this.recorder.events,
      summary,
      checks,
      reason: this.budgetStop !== null && this.terminalStatus === 'failed' ? this.budgetStop : this.failureReason,
      issues: this.issues,
    };
  }
}

/**
 * Runs a logical or timed scenario to completion.
 */
export async function runScenario(
  document: Document,
  scenarioId: Id,
  runId: string,
  options: ScenarioRunnerOptions = {},
): Promise<ScenarioRunResult> {
  const runner = new ScenarioRunner(document, scenarioId, runId, options);
  if (options.stepSize !== undefined && options.stepSize > 0) {
    while (await runner.step()) {
      // Step chunked
    }
    return runner.getResult();
  }
  return await runner.run();
}

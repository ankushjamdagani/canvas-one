/**
 * Runner record shapes: RunUpdate, TraceEvent, retained adapter types, CheckResult,
 * RunSummary, Counts, the closed ElementMetric key catalog, MetricSample,
 * ResourceSummary, AuthoredSnapshot and row provenance, plus the run budget limits.
 *
 * SCOPE: pure type declarations and numeric constants only. No worker, no `startRun`,
 * no plan handles (see compile.ts's module comment).
 *
 * `Issue` (the validation-issue record) lives in ./validate.ts and is intentionally NOT
 * redeclared here; runner modules import it.
 */

import type { Document, Endpoint, Id, Json } from '@canvas-one/system-design/studio/model';
import type { Issue } from '@canvas-one/system-design/studio/validate';

// ============================================================================
// Run lifecycle
// ============================================================================

/** Non-terminal run states carried by `{kind:'state'}` RunUpdates. */
export const RUN_STATES = ['created', 'validating', 'running', 'paused'] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Terminal statuses, carried only by `{kind:'terminal'}` RunUpdates. */
export const TERMINAL_STATUSES = ['completed', 'invalid', 'failed', 'cancelled', 'incomplete'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/** `stop`: stop new arrivals and let work in flight finish, then complete (unlike `cancel`, which discards). */
export type RunControl = { readonly kind: 'pause' | 'resume' | 'cancel' | 'stop' };

export interface RunHandle {
  send(control: RunControl): void;
  readonly events: AsyncIterable<RunUpdate>;
}

// ============================================================================
// TraceEvent
// ============================================================================

const TRACE_EVENT_KINDS = [
  'input',
  'dispatch',
  'queued',
  'started',
  'settled',
  'state',
  'row',
  'fault',
  'ignored',
] as const;
export type TraceEventKind = (typeof TRACE_EVENT_KINDS)[number];

/** Transport outcome (also reused as `TraceEvent.outcome`, non-null case). */
const TRANSPORT_OUTCOMES = ['succeeded', 'rejected', 'failed', 'expired'] as const;
export type TransportOutcome = (typeof TRANSPORT_OUTCOMES)[number];

export type TraceEvent = {
  readonly id: string;
  readonly sequence: number;
  readonly rootId: string;
  readonly journeyId: Id;
  readonly parentId: string | null;
  readonly elementId: Id;
  readonly portId: Id | null;
  readonly kind: TraceEventKind;
  readonly code: string;
  readonly payloadRef: string | null;
  readonly atMs: number | null;
  readonly outcome: TransportOutcome | null;
};

// ============================================================================
// RunUpdate
// ============================================================================

export type CheckResult = {
  readonly assertionId: Id;
  readonly status: 'passed' | 'failed' | 'unevaluated' | 'error';
  readonly actual: Json | null;
  readonly reason: string | null;
};

export type Counts = {
  readonly generated: number;
  readonly succeeded: number;
  readonly rejected: number;
  readonly failed: number;
  readonly expired: number;
  readonly inFlight: number;
};

/**
 * Closed ElementMetric key catalog (the six counts, `acknowledged`, `throughput`,
 * `meanLatencyMs`, `p95LatencyMs`, `utilization`, `queued`, `active`,
 * `cacheHits/Misses/Entries/Evictions/Expirations`). Each key needs its own regression
 * fixture; this array is the single source of truth for the catalog.
 */
export const ELEMENT_METRIC_KEYS = [
  'generated',
  'succeeded',
  'rejected',
  'failed',
  'expired',
  'inFlight',
  'acknowledged',
  'throughput',
  'meanLatencyMs',
  'p95LatencyMs',
  'utilization',
  'queued',
  'active',
  'cacheHits',
  'cacheMisses',
  'cacheEntries',
  'cacheEvictions',
  'cacheExpirations',
] as const;
export type ElementMetricKey = (typeof ELEMENT_METRIC_KEYS)[number];

export const ELEMENT_METRIC_UNITS = ['count', 'ms', 'requests/s', 'ratio'] as const;
export type ElementMetricUnit = (typeof ELEMENT_METRIC_UNITS)[number];

export type ElementMetric = {
  readonly elementId: Id | null;
  readonly scope: 'root' | 'message' | 'element';
  readonly key: ElementMetricKey;
  readonly value: number | null;
  readonly unit: ElementMetricUnit;
  readonly available: boolean;
  readonly reason: string | null;
  readonly windowStartMs: number | null;
  readonly windowEndMs: number | null;
};

export type MetricSample = {
  readonly atMs: number | null;
  readonly metrics: readonly ElementMetric[];
};

/** Row provenance: `{inputEventId,index}` identifies one source row. */
export type RowRef = { readonly inputEventId: string; readonly index: number };

export type RowOutcome = {
  readonly elementId: Id;
  readonly operationId: Id;
  readonly inputRows: readonly RowRef[];
  readonly outcome: 'emitted' | 'filtered' | 'duplicate' | 'error';
  readonly outputIndex: number | null;
  readonly errorCode: 'schema-mismatch' | 'wrong-type' | 'missing-path' | 'integer-overflow' | null;
};

/** How one cycle ended, worst first when its units differ. `lost` is reserved for a lost leg. */
export type CycleOutcome = 'ok' | 'expired' | 'rejected' | 'timed-out' | 'failed' | 'lost' | 'stuck';

/**
 * One request from a source and everything it caused. The response reaches the source at
 * `responseAtMs`; the cycle is complete at `completedAtMs`, when its last descendant has settled.
 */
export type Cycle = {
  /** Observation time for streamed revisions, including a late descendant reopening a cycle. */
  readonly observedAtMs?: number;
  /** The root unit's identity: `${workloadId}-${ordinal}`. */
  readonly id: string;
  readonly workloadId: Id;
  readonly startedAtMs: number;
  readonly responseAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly outcome: CycleOutcome | null;
  /** Over the root and its descendant messages. */
  readonly counts: Readonly<Record<CycleOutcome, number>>;
};

export type CycleSummary = {
  readonly total: number;
  readonly open: number;
  readonly byOutcome: Readonly<Record<CycleOutcome, number>>;
  readonly responseLatencyMs: { readonly mean: number; readonly max: number } | null;
  readonly completionLatencyMs: { readonly mean: number; readonly max: number } | null;
};

/**
 * The run's cumulative summary at one simulated time, posted about every 5 s of simulated time so a
 * playhead can show "results as of now" without replaying the whole run.
 */
export type RunCheckpoint = {
  readonly atMs: number;
  readonly rootCounts: Counts;
  readonly messageCounts: Counts;
  readonly cycles: CycleSummary;
  readonly elementMetrics: readonly ElementMetric[];
};

/** Exact measured changes observed after one discrete timed scheduler step. */
export type ResultDelta = {
  readonly atMs: number;
  readonly rootCounts?: Counts;
  readonly messageCounts?: Counts;
  /** Replacement rows keyed by elementId/scope/key. */
  readonly elementMetrics?: readonly ElementMetric[];
  /** Occupied slot fractions immediately after the measurement; integrate until the next event. */
  readonly occupancyRates?: Readonly<Record<string, number>>;
};

export type RunSummary = {
  readonly cycles: CycleSummary;
  readonly mode: 'logical' | 'timed';
  readonly consumedInputs: number;
  readonly rootCounts: Counts;
  readonly messageCounts: Counts;
  readonly elementMetrics: readonly ElementMetric[];
  readonly finalStates: readonly { readonly elementId: Id; readonly stateId: Id; readonly context: Json }[];
  readonly outputs: readonly { readonly port: Endpoint; readonly values: readonly Json[] }[];
  readonly coverage: { readonly includedElementIds: readonly Id[]; readonly excludedElementIds: readonly Id[] };
  readonly processedEvents: number;
  readonly elapsedMs: number | null;
  readonly rowOutcomes: readonly RowOutcome[];
  /**
   * The trace covers the whole run unless `truncatedBy` names the cap it reached
   * Counts, metrics and checks always cover the whole run; checks
   * that read trace rows are unevaluated when the trace is truncated. Absent on older saved
   * runs, which stopped at the cap as `incomplete`, so their traces were never truncated.
   */
  readonly trace?: { readonly recordedRows: number; readonly truncatedBy: 'trace-rows' | 'trace-bytes' | null };
};

/**
 * One step in the life of a request or message on a connection, for the live canvas view only (never
 * stored in a run's trace). `key` identifies the packet; times are simulated ms.
 */
export type FlowRecord = {
  /** Additive presentation facts; the executable model and accounting are unchanged. */
  readonly ownerKey?: string;
  readonly targetElementId?: string;
  readonly trafficOutcome?: import('@canvas-one/playback/traffic').TrafficOutcomeKind;
  readonly retryAtMs?: number;
  readonly key: string;
  /** Explicit lifecycle identity for cycle inspection; absent in older in-memory recordings. */
  readonly cycleId?: string;
  readonly unitId?: string;
  readonly parentUnitId?: string | null;
  readonly category?: 'root' | 'message';
  readonly attempt?: number;
  /** Null for a workload admitted directly at a node, without an incoming connection. */
  readonly connectionId: Id | null;
  /** Node named by the lifecycle fact; present for direct and connection-backed activity. */
  readonly elementId?: Id;
  readonly phase: 'sent' | 'received' | 'queued' | 'processing' | 'settled' | 'response' | 'released' | 'await' | 'await_resolved' | 'retry' | 'outcome' | 'blocked' | 'unblocked' | 'reserved' | 'slot_released' | 'no_progress';
  readonly atMs: number;
  /** `sent` and `response`: when the leg ends; absent when the leg was lost. */
  readonly arriveAtMs: number | null;
  /** `settled` and `response`: how the work ended. */
  readonly outcome: TransportOutcome | null;
};

export type RunUpdate =
  | { readonly kind: 'state'; readonly runId: string; readonly state: RunState }
  | {
      readonly kind: 'batch';
      readonly runId: string;
      readonly firstSequence: number;
      readonly events: readonly TraceEvent[];
      readonly metrics: MetricSample | null;
    }
  | {
      readonly kind: 'terminal';
      readonly runId: string;
      readonly status: TerminalStatus;
      readonly checks: readonly CheckResult[];
      readonly summary: RunSummary;
      readonly reason: string | null;
    };

/**
 * The request a workload-generated root carries:
 * the empty record, the only value the catalog's generic request schema accepts.
 * A workload request that crosses to a boundary must satisfy that call's request schema.
 */
export const WORKLOAD_REQUEST_PAYLOAD: Json = Object.freeze({}) as Json;
/** Payload reference the adapter gives workload roots; resolves to WORKLOAD_REQUEST_PAYLOAD. */
export const WORKLOAD_PAYLOAD_REF = 'payload-workload';

// ============================================================================
// Retained adapter types
// ============================================================================

export type ResourceInput = {
  readonly rootId: string;
  readonly journeyId: Id;
  readonly parentEventId: string | null;
  readonly entryElementId: Id;
  readonly requestClassId: Id;
  readonly operation: 'read' | 'write';
  readonly key: string | null;
  readonly tags: readonly string[];
  readonly payloadRef: string;
  readonly atMs: number;
  readonly deadlineMs: number;
};

export type Admission = {
  readonly accepted: boolean;
  readonly events: readonly TraceEvent[];
  readonly response: { readonly outcome: 'rejected'; readonly payloadRef: string } | null;
};

export type PortEmission = {
  readonly source: Endpoint;
  readonly rootId: string;
  readonly journeyId: Id;
  readonly parentEventId: string | null;
  readonly payloadRef: string;
  readonly outcome: TransportOutcome;
  readonly atMs: number | null;
  readonly frameId: string | null;
};

export type KernelDelta = {
  readonly events: readonly TraceEvent[];
  readonly outputs: readonly PortEmission[];
};

export type ResourceSummary = {
  readonly atMs: number;
  readonly rootCounts: Counts;
  readonly messageCounts: Counts;
  readonly metrics: readonly ElementMetric[];
  readonly pendingEvents: number;
  readonly liveRoots: number;
};

// ============================================================================
// AuthoredSnapshot
// ============================================================================

export type AuthoredSnapshot = { readonly id: string; readonly document: Document };

// ============================================================================
// Run budget defaults and maxima
// ============================================================================

export const RUN_BUDGET_LIMITS = {
  maxEvents: { default: 100_000, max: 1_000_000 },
  maxTraceRows: { default: 10_000, max: 100_000 },
  maxTraceBytes: { default: 4 * 1024 * 1024, max: 16 * 1024 * 1024 },
  /** Single ceiling; there is no separate default. */
  maxScheduledEvents: 100_000,
  /** Single ceiling; there is no separate default. */
  maxLiveRoots: 10_000,
} as const;

/** Re-exported so runner call sites don't also need to import from ./validate. */
export type { Issue };

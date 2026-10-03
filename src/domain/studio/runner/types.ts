/**
 * Runner-start types (RV-14a).
 *
 * Implements the exact record shapes required by:
 * - specs/revamp/contracts/model-and-runner.md §8 (Runner interface: RunUpdate,
 *   TraceEvent, retained adapter types) and §9 (Results: Issue-adjacent records,
 *   CheckResult, RunSummary, Counts, ElementMetric closed key catalog, MetricSample,
 *   ResourceSummary, AuthoredSnapshot, row provenance).
 * - specs/revamp/contracts/storage.md §6 (run defaults/maxima table).
 *
 * SCOPE: pure type declarations and the storage.md numeric constants only. No worker,
 * no `startRun`, no plan handles — see compile.ts's module comment for why.
 *
 * `Issue` (model-and-runner.md §9's validation-issue record) already exists at
 * ./validate.ts and is intentionally NOT redeclared here; runner modules import it.
 */

import type { Document, Endpoint, Id, Json } from '../model';
import type { Issue } from '../validate';

// ============================================================================
// Run lifecycle (run-identity.md §4, model-and-runner.md §8)
// ============================================================================

/** Non-terminal run states carried by `{kind:'state'}` RunUpdates. */
export const RUN_STATES = ['created', 'validating', 'running', 'paused'] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Terminal statuses, carried only by `{kind:'terminal'}` RunUpdates. */
export const TERMINAL_STATUSES = ['completed', 'invalid', 'failed', 'cancelled', 'incomplete'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export type RunControl = { readonly kind: 'pause' | 'resume' | 'cancel' };

export interface RunHandle {
  send(control: RunControl): void;
  readonly events: AsyncIterable<RunUpdate>;
}

// ============================================================================
// TraceEvent (§8)
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
// RunUpdate (§8)
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
 * Closed ElementMetric key catalog (§9: "the six counts, `acknowledged`, `throughput`,
 * `meanLatencyMs`, `p95LatencyMs`, `utilization`, `queued`, `active`,
 * `cacheHits/Misses/Entries/Evictions/Expirations`"). Each key needs its own regression
 * fixture per the contract; this array is the single source of truth for the catalog.
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

/** §9 row provenance: `{inputEventId,index}` identifies one source row. */
export type RowRef = { readonly inputEventId: string; readonly index: number };

export type RowOutcome = {
  readonly elementId: Id;
  readonly operationId: Id;
  readonly inputRows: readonly RowRef[];
  readonly outcome: 'emitted' | 'filtered' | 'duplicate' | 'error';
  readonly outputIndex: number | null;
  readonly errorCode: 'schema-mismatch' | 'wrong-type' | 'missing-path' | 'integer-overflow' | null;
};

export type RunSummary = {
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
   * (storage.md §6, D47). Counts, metrics and checks always cover the whole run; checks
   * that read trace rows are unevaluated when the trace is truncated. Absent on runs saved
   * before D47: those stopped at the cap as `incomplete`, so their traces were never truncated.
   */
  readonly trace?: { readonly recordedRows: number; readonly truncatedBy: 'trace-rows' | 'trace-bytes' | null };
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
 * The request a workload-generated root carries (model-and-runner.md §6 Workloads):
 * the empty record, the only value the catalog's generic request schema accepts.
 * A workload request that crosses to a boundary must satisfy that call's request schema.
 */
export const WORKLOAD_REQUEST_PAYLOAD: Json = Object.freeze({}) as Json;
/** Payload reference the adapter gives workload roots; resolves to WORKLOAD_REQUEST_PAYLOAD. */
export const WORKLOAD_PAYLOAD_REF = 'payload-workload';

// ============================================================================
// Retained adapter types (§8 "Retained adapter")
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
// AuthoredSnapshot (§9)
// ============================================================================

export type AuthoredSnapshot = { readonly id: string; readonly document: Document };

// ============================================================================
// storage.md §6 run defaults/maxima
// ============================================================================

export const RUN_BUDGET_LIMITS = {
  maxEvents: { default: 100_000, max: 1_000_000 },
  maxTraceRows: { default: 10_000, max: 100_000 },
  maxTraceBytes: { default: 4 * 1024 * 1024, max: 16 * 1024 * 1024 },
  /** Single ceiling per storage.md §6; no separate "default" is stated. */
  maxScheduledEvents: 100_000,
  /** Single ceiling per storage.md §6; no separate "default" is stated. */
  maxLiveRoots: 10_000,
} as const;

/** Re-exported so runner call sites don't also need to import from ./validate. */
export type { Issue };

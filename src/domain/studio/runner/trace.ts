/**
 * Trace envelope: event/root ID derivation, the content-addressed payload
 * table, the trace recorder (row/byte budget enforcement + batch RunUpdates), and a
 * pure RunUpdate stream validity checker.
 *
 * The row and byte caps are independent; the run stops incomplete at the first cap hit,
 * with no sampling or hidden truncation.
 */

import { canonicalJson, sha256Hex } from '../canonical';
import type { Id, Json } from '../model';
import type { MetricSample, RunUpdate, TerminalStatus, TraceEvent, TraceEventKind, TransportOutcome } from './types';
import { TERMINAL_STATUSES } from './types';
import { deepFreeze } from '../freeze';

// ============================================================================
// ID derivation
// ============================================================================

/**
 * `TraceEvent.id` derivation (derived from runId + sequence). Format:
 * `${runId}:${sequence}` — colon-joined, since `sequence` is a non-negative integer and
 * `runId` is a UUID (never contains `:`), so the join is unambiguous and reversible by
 * splitting on the last `:`.
 */
export function traceEventId(runId: string, sequence: number): string {
  return `${runId}:${sequence}`;
}

/**
 * Root ID derivation (from the input or workload ID +
 * ordinal). Format: `${sourceId}#${ordinal}` — a distinct separator from
 * `traceEventId`'s `:` so the two ID families are visually distinguishable even though
 * they occupy separate namespaces (root IDs vs. trace event IDs) and are never compared
 * to each other.
 */
export function rootId(sourceId: Id, ordinal: number): string {
  return `${sourceId}#${ordinal}`;
}

// ============================================================================
// PayloadTable
// ============================================================================

export type PayloadRef = string;

/**
 * Computes a payload's content-addressed ref (`sha256:` + hex SHA-256 of its
 * `canonical-json-v1` text) without storing anything. Shared by `PayloadTable.put` and
 * `TraceRecorder.append` so a ref is only ever hashed once per call site, never twice
 * (once to check "is this new" and again to store).
 */
async function computePayloadRef(
  json: Json,
): Promise<{ readonly ref: PayloadRef; readonly canonicalText: string; readonly bytes: number }> {
  const canon = canonicalJson(json);
  if (!canon.ok) {
    throw new Error(`payload failed canonical-json-v1 validation: ${JSON.stringify(canon.issues)}`);
  }
  const ref: PayloadRef = `sha256:${await sha256Hex(canon.text)}`;
  return { ref, canonicalText: canon.text, bytes: canon.bytes };
}

/**
 * Immutable, content-addressed payload store for one run (`payloadRef` points into
 * it). `put` derives the ref from the
 * SHA-256 of the payload's `canonical-json-v1` text, so two payloads that differ only in
 * key order (or other canonicalization-invisible differences) dedupe to the same ref.
 * Stored values are deep-frozen copies parsed from that canonical text — never the
 * caller's own object reference — so mutating the argument after `put` (or mutating a
 * `get`/`snapshot` result) can never change what the table holds.
 *
 * `put` is async because it goes through Web Crypto (`sha256Hex`).
 */
export class PayloadTable {
  private readonly byRef = new Map<PayloadRef, Json>();

  async put(json: Json): Promise<PayloadRef> {
    const { ref, canonicalText } = await computePayloadRef(json);
    this.commitPrecomputed(ref, canonicalText);
    return ref;
  }

  get(ref: PayloadRef): Json | undefined {
    return this.byRef.get(ref);
  }

  has(ref: PayloadRef): boolean {
    return this.byRef.has(ref);
  }

  /** A frozen, independent snapshot copy — mutating it never affects the live table
   * (and its values are already deep-frozen, so they can't be mutated either). */
  snapshot(): Readonly<Record<PayloadRef, Json>> {
    return Object.freeze(Object.fromEntries(this.byRef));
  }

  /**
   * Internal seam for `TraceRecorder`: stores a payload under a ref/canonical-text pair
   * already computed elsewhere (via `computePayloadRef`), so a caller that must check
   * "is this ref already stored" before deciding whether to commit never re-hashes.
   * Not part of the table's documented public contract (`put`/`get`/`has`/`snapshot`).
   */
  commitPrecomputed(ref: PayloadRef, canonicalText: string): void {
    if (!this.byRef.has(ref)) {
      this.byRef.set(ref, deepFreeze(JSON.parse(canonicalText)) as Json);
    }
  }
}

// ============================================================================
// TraceRecorder
// ============================================================================

export type TraceBudgets = {
  readonly maxTraceRows: number;
  readonly maxTraceBytes: number;
};

export type TraceStopReason = 'trace-rows' | 'trace-bytes';

export type TraceStopInfo =
  | { readonly stopped: false }
  | { readonly stopped: true; readonly reason: TraceStopReason; readonly limit: number; readonly used: number };

/** Everything `TraceRecorder.append` needs to build one `TraceEvent`, minus the fields
 * the recorder itself assigns (`id`, `sequence`, `payloadRef`). */
export type TraceAppendInput = {
  readonly rootId: string;
  readonly journeyId: Id;
  readonly parentId: string | null;
  readonly elementId: Id;
  readonly portId: Id | null;
  readonly kind: TraceEventKind;
  readonly code: string;
  /** `null` = no payload for this event; otherwise stored in the run's PayloadTable. */
  readonly payload: Json | null;
  readonly atMs: number | null;
  readonly outcome: TransportOutcome | null;
};

/**
 * `'invalid-event'`: the event (or its payload) failed `canonical-json-v1` validation
 * (e.g. a non-finite `atMs`) — rejected outright rather than silently costing 0 bytes
 * toward the budget (see CONTRACT GAPS / task report: chosen over throwing so this
 * shares the same result channel as the budget-stop rejections below).
 */
export type TraceAppendResult =
  | { readonly ok: true; readonly event: TraceEvent }
  | { readonly ok: false; readonly reason: TraceStopReason | 'invalid-event' };

/**
 * Appends `TraceEvent`s for one run, assigning monotonic sequences starting at 0, and
 * enforcing `maxTraceRows` and `maxTraceBytes` independently (either cap alone can stop the run; 100k synthetic rows
 * exceed 16 MiB). Byte accounting
 * is conservative: UTF-8 bytes of the canonical JSON of each event, plus — only the
 * first time a given payload ref is newly stored by this recorder — the canonical JSON
 * bytes of that payload.
 *
 * The first cap hit stops recording (`status` reports it) and rejects that append and
 * every append after it with `{ok:false, reason}`. There is no sampling or hidden
 * truncation: a caller that ignores the `ok:false` result still sees no new event was
 * recorded, never a silently dropped one.
 */
export class TraceRecorder {
  private readonly runId: string;
  private readonly budgets: TraceBudgets;
  private readonly payloads = new PayloadTable();
  private readonly recordedEvents: TraceEvent[] = [];
  private pendingBatch: TraceEvent[] = [];
  private nextSequence = 0;
  private usedBytes = 0;
  private stopInfo: TraceStopInfo = { stopped: false };

  constructor(runId: string, budgets: TraceBudgets) {
    this.runId = runId;
    this.budgets = budgets;
  }

  get status(): TraceStopInfo {
    return this.stopInfo;
  }

  get events(): readonly TraceEvent[] {
    return this.recordedEvents;
  }

  /** The run's payload table, for callers (and tests) that need to check what was
   * actually committed — e.g. that a rejected append's payload never entered it. */
  get payloadTable(): PayloadTable {
    return this.payloads;
  }

  async append(input: TraceAppendInput): Promise<TraceAppendResult> {
    if (this.stopInfo.stopped) {
      return { ok: false, reason: this.stopInfo.reason };
    }

    // Compute (but do not yet store) the payload ref, hashing it exactly once. Whether
    // it's "new" is decided now, from the table's current contents, and re-checked
    // against nothing else before the eventual commit below.
    let payloadRef: string | null = null;
    let payloadCanonicalText: string | null = null;
    let payloadBytes = 0;
    let payloadIsNew = false;
    if (input.payload !== null) {
      let computed: { readonly ref: PayloadRef; readonly canonicalText: string; readonly bytes: number };
      try {
        computed = await computePayloadRef(input.payload);
      } catch {
        return { ok: false, reason: 'invalid-event' };
      }
      payloadRef = computed.ref;
      payloadIsNew = !this.payloads.has(payloadRef);
      if (payloadIsNew) {
        payloadCanonicalText = computed.canonicalText;
        payloadBytes = computed.bytes;
      }
    }

    const sequence = this.nextSequence;
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

    const canonEvent = canonicalJson(event);
    if (!canonEvent.ok) {
      // Reject outright rather than silently counting 0 bytes toward the budget — see
      // TraceAppendResult's 'invalid-event' doc comment. Nothing was stored above (the
      // payload, if any, was only hashed, never committed), so there's no orphan.
      return { ok: false, reason: 'invalid-event' };
    }

    const addedBytes = canonEvent.bytes + payloadBytes;

    const newRowCount = this.recordedEvents.length + 1;
    if (newRowCount > this.budgets.maxTraceRows) {
      this.stopInfo = {
        stopped: true,
        reason: 'trace-rows',
        limit: this.budgets.maxTraceRows,
        used: this.recordedEvents.length,
      };
      return { ok: false, reason: 'trace-rows' };
    }

    const newByteCount = this.usedBytes + addedBytes;
    if (newByteCount > this.budgets.maxTraceBytes) {
      this.stopInfo = {
        stopped: true,
        reason: 'trace-bytes',
        limit: this.budgets.maxTraceBytes,
        used: this.usedBytes,
      };
      return { ok: false, reason: 'trace-bytes' };
    }

    // Both caps passed: only now does the payload (if new) actually enter the table,
    // using the ref/text already computed above (no second hash pass).
    if (payloadIsNew && payloadRef !== null && payloadCanonicalText !== null) {
      this.payloads.commitPrecomputed(payloadRef, payloadCanonicalText);
    }
    this.recordedEvents.push(event);
    this.pendingBatch.push(event);
    this.usedBytes = newByteCount;
    this.nextSequence += 1;
    return { ok: true, event };
  }

  /**
   * Drains every event appended since the last call into one `{kind:'batch'}`
   * RunUpdate, with `firstSequence` set to that batch's first event's sequence (or the
   * next sequence to be assigned, if nothing is pending — an empty batch carries no
   * events either way).
   */
  drainBatch(metrics: MetricSample | null = null): Extract<RunUpdate, { kind: 'batch' }> {
    const firstSequence = this.pendingBatch.length > 0 ? this.pendingBatch[0].sequence : this.nextSequence;
    const events = this.pendingBatch;
    this.pendingBatch = [];
    return { kind: 'batch', runId: this.runId, firstSequence, events, metrics };
  }
}

// ============================================================================
// RunUpdateGuard
// ============================================================================

const TERMINAL_STATUS_SET = new Set<string>(TERMINAL_STATUSES);

export type GuardOutcome =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'stale'; readonly runId: string }
  | { readonly kind: 'violation'; readonly reason: string };

/**
 * A pure checker over a sequence of `RunUpdate`s for one run (exactly one terminal
 * message, with monotonic sequences; terminal statuses arrive only through that
 * message and `state` updates never carry them).
 *
 * Stateful across calls (it must be, to track sequence continuity and terminal
 * exclusivity), but every check is a pure function of the accumulated update history —
 * it never inspects or mutates anything outside itself.
 */
export class RunUpdateGuard {
  private readonly runId: string;
  private nextExpectedSequence = 0;
  private terminalSeen = false;

  constructor(runId: string) {
    this.runId = runId;
  }

  check(update: RunUpdate): GuardOutcome {
    if (update.runId !== this.runId) {
      return { kind: 'stale', runId: update.runId };
    }

    if (this.terminalSeen) {
      return { kind: 'violation', reason: 'update received after the terminal message' };
    }

    if (update.kind === 'state') {
      if (TERMINAL_STATUS_SET.has(update.state as unknown as TerminalStatus)) {
        return { kind: 'violation', reason: `state update carried a terminal status '${update.state}'` };
      }
      return { kind: 'accepted' };
    }

    if (update.kind === 'batch') {
      if (update.firstSequence !== this.nextExpectedSequence) {
        return {
          kind: 'violation',
          reason: `expected firstSequence ${this.nextExpectedSequence}, got ${update.firstSequence}`,
        };
      }
      let expected = update.firstSequence;
      for (const event of update.events) {
        if (event.sequence !== expected) {
          return {
            kind: 'violation',
            reason: `gap in event sequence: expected ${expected}, got ${event.sequence}`,
          };
        }
        expected += 1;
      }
      this.nextExpectedSequence = expected;
      return { kind: 'accepted' };
    }

    // update.kind === 'terminal'
    this.terminalSeen = true;
    return { kind: 'accepted' };
  }
}

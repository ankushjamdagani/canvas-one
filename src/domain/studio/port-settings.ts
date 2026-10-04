/**
 * Reading port settings (D53). A connection no longer carries its caller policy or its receiver's
 * terms: the caller's retry, deadline and request live on the source out-port, and the receiver's
 * acknowledgement and TTL live on the target in-port. These helpers resolve them for a connection.
 */

import type { CallRetryPolicy, Connection, Document, Element, Endpoint, Port } from './model';

/** A message acknowledges at once unless its receiving port says otherwise. */
export const DEFAULT_ACK_DELAY_MS = 0;

export function findPort(document: Pick<Document, 'elements'>, endpoint: Endpoint): { element: Element; port: Port } | null {
  const element = document.elements.find((e) => e.id === endpoint.elementId);
  const port = element?.ports.find((p) => p.id === endpoint.portId);
  return element && port ? { element, port } : null;
}

type OutSettingsView = {
  readonly retry?: CallRetryPolicy;
};

type InSettingsView = {
  readonly ackDelayMs?: number;
  readonly messageTtlMs?: number;
};

export function sourceSettings(document: Pick<Document, 'elements'>, connection: Connection): OutSettingsView {
  return (findPort(document, connection.source)?.port.settings ?? {}) as OutSettingsView;
}

export function targetSettings(document: Pick<Document, 'elements'>, connection: Connection): InSettingsView {
  return (findPort(document, connection.target)?.port.settings ?? {}) as InSettingsView;
}

/** The caller's retry policy for a call, or null for none. */
export function callRetryOf(document: Pick<Document, 'elements'>, connection: Connection): CallRetryPolicy | null {
  return connection.kind === 'call' ? (sourceSettings(document, connection).retry ?? null) : null;
}

export function ackDelayOf(document: Pick<Document, 'elements'>, connection: Connection): number {
  return targetSettings(document, connection).ackDelayMs ?? DEFAULT_ACK_DELAY_MS;
}

/** D56: null when the port sets no TTL, so a message never expires (unconsumed, it is reported stuck). */
export function messageTtlOf(document: Pick<Document, 'elements'>, connection: Connection): number | null {
  return targetSettings(document, connection).messageTtlMs ?? null;
}

// ----------------------------------------------------------------------------
// What a connection tells its two ends (D53)
// ----------------------------------------------------------------------------

type Settings = Readonly<Record<string, unknown>>;

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

/** The caller's terms for one endpoint, in one line, or '' when it sets none. */
export function describeCallerPolicy(port: Pick<Port, 'settings'>): string {
  const s = (port.settings ?? {}) as Settings;
  const parts: string[] = [];
  const retry = s.retry as CallRetryPolicy | undefined;
  if (retry && retry.maxAttempts > 1) parts.push(`${retry.maxAttempts} attempts`);
  if (retry?.attemptTimeoutMs != null) parts.push(`attempt timeout ${retry.attemptTimeoutMs} ms`);
  const breaker = s.circuitBreaker as { failureThreshold: number } | undefined;
  if (breaker) parts.push(`breaker after ${breaker.failureThreshold} failures`);
  if (num(s.maxInFlight) !== undefined) parts.push(`max ${s.maxInFlight} in flight`);
  const hedge = s.hedge as { afterMs: number } | undefined;
  if (hedge) parts.push(`hedge after ${hedge.afterMs} ms`);
  if (s.confirm === false) parts.push('fire and forget');
  const batch = s.batch as { size: number; windowMs: number } | undefined;
  if (batch) parts.push(`batches of ${batch.size} / ${batch.windowMs} ms`);
  return parts.join(' · ');
}

/** What the callee promises or enforces on one endpoint, in one line, or '' when it sets none. */
export function describeCalleeContract(port: Pick<Port, 'settings'>): string {
  const s = (port.settings ?? {}) as Settings;
  const parts: string[] = [];
  if (num(s.expectedP95Ms) !== undefined) parts.push(`p95 ${s.expectedP95Ms} ms`);
  if (num(s.availabilityPct) !== undefined) parts.push(`${s.availabilityPct}% available`);
  if (s.idempotent === true) parts.push('idempotent');
  if (s.idempotent === false) parts.push('not idempotent');
  const limit = s.rateLimit as { rps: number; burst: number } | undefined;
  if (limit) parts.push(`limit ${limit.rps}/s (burst ${limit.burst})`);
  if (num(s.maxConcurrency) !== undefined) parts.push(`max ${s.maxConcurrency} concurrent`);
  if (num(s.failureRate) !== undefined) parts.push(`${s.failureRate}% fail`);
  if (num(s.serviceTimeMs) !== undefined) parts.push(`serves in ${s.serviceTimeMs} ms`);
  if (num(s.ackDelayMs) !== undefined) parts.push(`ack ${s.ackDelayMs} ms`);
  if (num(s.messageTtlMs) !== undefined) parts.push(`TTL ${s.messageTtlMs} ms`);
  if (typeof s.delivery === 'string') parts.push(s.delivery);
  if (typeof s.ordering === 'string') parts.push(`${s.ordering} ordering`);
  if (num(s.throughputPerSec) !== undefined) parts.push(`${s.throughputPerSec}/s`);
  if (num(s.maxStalenessMs) !== undefined) parts.push(`stale ≤ ${s.maxStalenessMs} ms`);
  return parts.join(' · ');
}

/**
 * Things the caller's terms and the callee's declared contract disagree on. Advisory only: they
 * never block a run, because a contract is an expectation, not behavior.
 */
export function connectionAdvisories(document: Pick<Document, 'elements'>, connection: Connection): readonly string[] {
  if (connection.kind !== 'call') return [];
  const source = findPort(document, connection.source)?.port;
  const target = findPort(document, connection.target)?.port;
  if (!source || !target) return [];
  const out = (source.settings ?? {}) as Settings;
  const into = (target.settings ?? {}) as Settings;
  const advisories: string[] = [];
  const p95 = num(into.expectedP95Ms);
  const retry = out.retry as CallRetryPolicy | undefined;
  if (p95 !== undefined && retry?.attemptTimeoutMs != null && retry.attemptTimeoutMs < p95) {
    advisories.push(`The caller's attempt timeout (${retry.attemptTimeoutMs} ms) is below the callee's expected p95 (${p95} ms).`);
  }
  if (into.idempotent === false && retry && retry.maxAttempts > 1) {
    advisories.push('The caller retries an endpoint declared not idempotent.');
  }
  if (into.idempotent === false && out.hedge !== undefined) {
    advisories.push('The caller hedges calls to an endpoint declared not idempotent, so a request can run twice.');
  }
  return advisories;
}

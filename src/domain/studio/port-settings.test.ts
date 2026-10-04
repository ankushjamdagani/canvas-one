import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Element, Port } from './model';
import { validateDocument } from './validate';
import { buildManifest } from './manifest';
import { DEFAULT_BUILD_VERSIONS } from '../../persistence/studio/types';
import { connectionAdvisories, describeCalleeContract, describeCallerPolicy, callRetryOf, ackDelayOf, messageTtlOf, DEFAULT_ACK_DELAY_MS } from './port-settings';

const S05 = JSON.parse(readFileSync(resolve(__dirname, '../../../specs/revamp/fixtures/s06.json'), 'utf8')) as Document; // S06: workloads, an unmodeled call target and default-TTL messages

function withPortSettings(doc: Document, pick: (e: Element, p: Port) => boolean, settings: Record<string, unknown>): Document {
  let done = false;
  return {
    ...doc,
    elements: doc.elements.map((e) => ({
      ...e,
      ports: e.ports.map((p) => {
        if (!done && pick(e, p)) {
          done = true;
          return { ...p, settings: { ...(p.settings ?? {}), ...settings } };
        }
        return p;
      }),
    })),
  } as Document;
}

const resourceCallIn = (e: Element, p: Port) => e.behavior.kind === 'resource' && p.direction === 'in' && p.channel === 'call';
const unmodeledCallIn = (e: Element, p: Port) => e.behavior.kind === 'unmodeled' && p.direction === 'in' && p.channel === 'call';

describe('port settings validation (D53)', () => {
  it('accepts declared and simulated settings on a simulated call in-port', () => {
    const doc = withPortSettings(S05, resourceCallIn, {
      expectedP95Ms: 80, availabilityPct: 99.9, idempotent: false, maxConcurrency: 50,
      rateLimit: { rps: 100, burst: 20 }, failureRate: 1, serviceTimeMs: 5,
    });
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('allows only declared settings on a node the runner does not simulate', () => {
    expect(validateDocument(withPortSettings(S05, unmodeledCallIn, { expectedP95Ms: 200 })).ok).toBe(true);
    const bad = validateDocument(withPortSettings(S05, unmodeledCallIn, { failureRate: 5 }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.some((i) => i.path.at(-1) === 'failureRate')).toBe(true);
  });

  it('rejects settings that do not belong to the port, empty settings and out-of-range values', () => {
    for (const settings of [{ ackDelayMs: 5 }, {}, { expectedP95Ms: 0 }, { availabilityPct: 101 }, { rateLimit: { rps: 0, burst: 1 } }, { maxConcurrency: 1.5 }, { idempotent: 'yes' }]) {
      expect(validateDocument(withPortSettings(S05, resourceCallIn, settings)).ok).toBe(false);
    }
  });

  it('accepts message ack and TTL on a message in-port and rejects them on a call in-port', () => {
    const messageIn = (e: Element, p: Port) => p.direction === 'in' && p.channel === 'message';
    expect(validateDocument(withPortSettings(S05, messageIn, { ackDelayMs: 5, messageTtlMs: 10000, delivery: 'at-least-once', ordering: 'per-key' })).ok).toBe(true);
    expect(validateDocument(withPortSettings(S05, messageIn, { delivery: 'sometimes' })).ok).toBe(false);
  });
});

describe('port settings in the run manifest (D53)', () => {
  const fingerprint = async (doc: Document) => {
    const scenario = doc.scenarios.find((sc) => sc.workloads.length > 0)!;
    const result = await buildManifest(doc, scenario.id, DEFAULT_BUILD_VERSIONS);
    if (result.status !== 'ok') throw new Error(result.status);
    return result.fingerprint;
  };

  it('a declared expectation does not change a run; a simulated setting does', async () => {
    // The entry port of the first workload's target.
    const entry = S05.scenarios.find((sc) => sc.workloads.length > 0)!.workloads[0].entry;
    const atEntry = (e: Element, p: Port) => e.id === entry.elementId && p.id === entry.portId;
    const base = await fingerprint(S05);
    expect(await fingerprint(withPortSettings(S05, atEntry, { expectedP95Ms: 90, availabilityPct: 99, idempotent: true }))).toBe(base);
    expect(await fingerprint(withPortSettings(S05, atEntry, { failureRate: 5 }))).not.toBe(base);
    expect(await fingerprint(withPortSettings(S05, atEntry, { rateLimit: { rps: 10, burst: 1 } }))).not.toBe(base);
  });
});

describe('reading and describing port settings', () => {
  const connection = S05.connections.find((c) => c.kind === 'message')!;

  it('defaults when the receiving port sets none', () => {
    expect(ackDelayOf(S05, connection)).toBe(DEFAULT_ACK_DELAY_MS);
    expect(messageTtlOf(S05, connection)).toBeNull();
  });

  it('reads a receiver\'s ack and TTL and a caller\'s retry from the right ports', () => {
    const doc = withPortSettings(withPortSettings(S05, (e, p) => e.id === connection.target.elementId && p.id === connection.target.portId, { ackDelayMs: 7, messageTtlMs: 9000 }),
      (e, p) => e.id === connection.source.elementId && p.id === connection.source.portId, {});
    expect(ackDelayOf(doc, connection)).toBe(7);
    expect(messageTtlOf(doc, connection)).toBe(9000);
    // S06's gateway retries on the replica routes; the database write has no policy.
    const retrying = S05.connections.filter((c) => c.kind === 'call' && callRetryOf(S05, c) !== null);
    expect(retrying.length).toBeGreaterThan(0);
    expect(callRetryOf(S05, retrying[0])?.maxAttempts).toBeGreaterThan(1);
    expect(S05.connections.some((c) => c.kind === 'call' && callRetryOf(S05, c) === null)).toBe(true);
  });

  it('describes a caller and a callee in one line, and flags disagreements as advisories', () => {
    const call = S05.connections.find((c) => c.kind === 'call' && callRetryOf(S05, c) === null)!;
    const retry = { maxAttempts: 2, backoffMs: 1, backoffMultiplier: 1, maxBackoffMs: 1, jitter: false, attemptTimeoutMs: 40 };
    const doc = withPortSettings(
      withPortSettings(S05, (e, p) => e.id === call.source.elementId && p.id === call.source.portId, { retry }),
      (e, p) => e.id === call.target.elementId && p.id === call.target.portId,
      { expectedP95Ms: 50, idempotent: false, rateLimit: { rps: 10, burst: 2 } },
    );
    const source = doc.elements.find((e) => e.id === call.source.elementId)!.ports.find((p) => p.id === call.source.portId)!;
    const target = doc.elements.find((e) => e.id === call.target.elementId)!.ports.find((p) => p.id === call.target.portId)!;
    expect(describeCallerPolicy(source)).toBe('2 attempts · attempt timeout 40 ms');
    expect(describeCalleeContract(target)).toBe('p95 50 ms · not idempotent · limit 10/s (burst 2)');
    expect(connectionAdvisories(doc, call)).toHaveLength(2); // attempt timeout below p95, retries on a not-idempotent endpoint
    expect(connectionAdvisories(S05, call)).toEqual([]);
  });
});

describe('caller policies, payload sizes and link impairments (D54)', () => {
  const callOut = (e: Element, p: Port) => e.behavior.kind === 'resource' && p.direction === 'out' && p.channel === 'call';
  const messageOut = (e: Element, p: Port) => p.direction === 'out' && p.channel === 'message';
  const messageIn = (e: Element, p: Port) => p.direction === 'in' && p.channel === 'message';

  it('accepts the caller policies on a call out-port and confirm/batch on a message out-port', () => {
    const call = withPortSettings(S05, callOut, {
      circuitBreaker: { failureThreshold: 5, openMs: 30000, halfOpenProbes: 2 }, maxInFlight: 20, hedge: { afterMs: 80 }, requestBytes: 2048,
    });
    expect(validateDocument(call).ok).toBe(true);
    const message = withPortSettings(S05, messageOut, { confirm: false, batch: { size: 10, windowMs: 50 }, requestBytes: 512 });
    expect(validateDocument(message).ok).toBe(true);
  });

  it('rejects malformed or misplaced policies', () => {
    for (const settings of [
      { circuitBreaker: { failureThreshold: 0, openMs: 1000, halfOpenProbes: 1 } },
      { circuitBreaker: { failureThreshold: 3, openMs: 1000 } },
      { maxInFlight: 0 },
      { hedge: { afterMs: 0 } },
      { confirm: false },
      { batch: { size: 5, windowMs: 10 } },
    ]) {
      expect(validateDocument(withPortSettings(S05, callOut, settings)).ok).toBe(false);
    }
    for (const settings of [{ batch: { size: 1, windowMs: 10 } }, { batch: { size: 5, windowMs: 0 } }, { confirm: 'no' }, { maxInFlight: 5 }]) {
      expect(validateDocument(withPortSettings(S05, messageOut, settings)).ok).toBe(false);
    }
  });

  it('a concurrency cap and a response size are simulated, so only resource nodes may set them', () => {
    expect(validateDocument(withPortSettings(S05, resourceCallIn, { maxConcurrency: 10, responseBytes: 4096 })).ok).toBe(true);
    expect(validateDocument(withPortSettings(S05, unmodeledCallIn, { maxConcurrency: 10 })).ok).toBe(false);
    expect(validateDocument(withPortSettings(S05, unmodeledCallIn, { responseBytes: 10 })).ok).toBe(false);
    expect(validateDocument(withPortSettings(S05, messageIn, { ackDelayMs: 1 })).ok).toBe(true);
  });

  it('validates jitter, loss and bandwidth on a link', () => {
    const withLink = (patch: Record<string, unknown>) => ({
      ...S05,
      connections: S05.connections.map((c, i) => (i === 0 && c.kind !== 'data' ? { ...c, config: { ...c.config, ...patch } } : c)),
    }) as Document;
    expect(S05.connections[0].kind).not.toBe('data');
    expect(validateDocument(withLink({ jitterMs: 25, lossRate: 1.5, bandwidthKbps: 10000 })).ok).toBe(true);
    for (const patch of [{ jitterMs: -1 }, { lossRate: 101 }, { bandwidthKbps: 0 }, { bandwidthKbps: undefined }]) {
      expect(validateDocument(withLink(patch)).ok).toBe(false);
    }
  });

  it('describes the new caller policies and flags hedging a not-idempotent endpoint', () => {
    const call = S05.connections.find((c) => c.kind === 'call' && callRetryOf(S05, c) === null)!;
    const doc = withPortSettings(
      withPortSettings(S05, (e, p) => e.id === call.source.elementId && p.id === call.source.portId, {
        circuitBreaker: { failureThreshold: 4, openMs: 1000, halfOpenProbes: 1 }, maxInFlight: 8, hedge: { afterMs: 90 },
      }),
      (e, p) => e.id === call.target.elementId && p.id === call.target.portId,
      { idempotent: false },
    );
    const source = doc.elements.find((e) => e.id === call.source.elementId)!.ports.find((p) => p.id === call.source.portId)!;
    expect(describeCallerPolicy(source)).toBe('breaker after 4 failures · max 8 in flight · hedge after 90 ms');
    expect(connectionAdvisories(doc, call)).toEqual(['The caller hedges calls to an endpoint declared not idempotent, so a request can run twice.']);
    const messagePort = { settings: { confirm: false, batch: { size: 10, windowMs: 50 } } } as Pick<Port, 'settings'>;
    expect(describeCallerPolicy(messagePort)).toBe('fire and forget · batches of 10 / 50 ms');
  });
});

describe('the new simulated settings in the run manifest (D54)', () => {
  const fingerprint = async (doc: Document) => {
    const scenario = doc.scenarios.find((sc) => sc.workloads.length > 0)!;
    const result = await buildManifest(doc, scenario.id, DEFAULT_BUILD_VERSIONS);
    if (result.status !== 'ok') throw new Error(result.status);
    return result.fingerprint;
  };

  it('breaker, in-flight limit, hedge, sizes, confirm, batch, link impairments and concurrency change a run; the link class does not', async () => {
    const base = await fingerprint(S05);
    const call = S05.connections.find((c) => c.kind === 'call' && callRetryOf(S05, c) === null)!;
    const atSource = (e: Element, p: Port) => e.id === call.source.elementId && p.id === call.source.portId;
    const atTarget = (e: Element, p: Port) => e.id === call.target.elementId && p.id === call.target.portId;
    for (const settings of [
      { circuitBreaker: { failureThreshold: 2, openMs: 100, halfOpenProbes: 1 } }, { maxInFlight: 3 }, { hedge: { afterMs: 10 } }, { requestBytes: 100 },
    ]) {
      expect(await fingerprint(withPortSettings(S05, atSource, settings))).not.toBe(base);
    }
    for (const settings of [{ maxConcurrency: 2 }, { responseBytes: 100 }]) {
      expect(await fingerprint(withPortSettings(S05, atTarget, settings))).not.toBe(base);
    }
    const withConfig = (patch: Record<string, unknown>) => ({
      ...S05,
      connections: S05.connections.map((c) => (c.id === call.id && c.kind !== 'data' ? { ...c, config: { ...c.config, ...patch } } : c)),
    }) as Document;
    for (const patch of [{ jitterMs: 5 }, { lossRate: 1 }, { bandwidthKbps: 1000 }]) {
      expect(await fingerprint(withConfig(patch))).not.toBe(base);
    }
    expect(await fingerprint(withConfig({ linkClass: 'cross-region' }))).toBe(base);
  });
});

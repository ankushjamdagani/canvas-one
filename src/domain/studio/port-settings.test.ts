import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Document, Element, Port } from './model';
import { validateDocument } from './validate';
import { buildManifest } from './manifest';
import { DEFAULT_BUILD_VERSIONS } from '../../persistence/studio/types';
import { connectionAdvisories, describeCalleeContract, describeCallerPolicy, callRetryOf, ackDelayOf, messageTtlOf, DEFAULT_ACK_DELAY_MS, DEFAULT_MESSAGE_TTL_MS } from './port-settings';

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
    expect(messageTtlOf(S05, connection)).toBe(DEFAULT_MESSAGE_TTL_MS);
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
      withPortSettings(S05, (e, p) => e.id === call.source.elementId && p.id === call.source.portId, { retry, deadlineDurationMs: 30 }),
      (e, p) => e.id === call.target.elementId && p.id === call.target.portId,
      { expectedP95Ms: 50, idempotent: false, rateLimit: { rps: 10, burst: 2 } },
    );
    const source = doc.elements.find((e) => e.id === call.source.elementId)!.ports.find((p) => p.id === call.source.portId)!;
    const target = doc.elements.find((e) => e.id === call.target.elementId)!.ports.find((p) => p.id === call.target.portId)!;
    expect(describeCallerPolicy(source)).toBe('2 attempts · attempt timeout 40 ms · deadline 30 ms');
    expect(describeCalleeContract(target)).toBe('p95 50 ms · not idempotent · limit 10/s (burst 2)');
    expect(connectionAdvisories(doc, call)).toHaveLength(3);
    expect(connectionAdvisories(S05, call)).toEqual([]);
  });
});

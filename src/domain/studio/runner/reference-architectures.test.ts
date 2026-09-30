/**
 * Realism audit phase 3: reference architectures (specs/revamp/realism-audit.md,
 * "Phase 3"). Each architecture is built the way a user builds it — `placeEntry` and
 * `planConnection` from the catalog, so the element and connection defaults are the app's
 * own — then run through readiness and `runScenario`.
 *
 * These tests characterise what the app does today. The real-world expectation for each
 * architecture was written in the audit before the first run. Where today's behaviour
 * differs, the test is tagged with the audit ID ([gap Hn], [default]) and asserts the
 * current behaviour, so the change that fixes it has to rewrite the test to the
 * real-world expectation. Tests tagged [fixed Bn]/[fixed G1] assert a defect's fix (D47).
 *
 * `REF_REPORT=1` prints one line per run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompletionPolicy, Connection, Document, Element, Id, Scenario, Workload } from '../model';
import { applyRecordChanges } from '../../../persistence/studio/apply-records';
import { getEntry } from '../../../features/catalog/catalog';
import { placeEntry } from '../../../features/catalog/place';
import { completeConnection, planConnection } from '../../../features/catalog/connect';
import { DEFAULT_SCENARIO_BUDGETS } from '../../../features/scenarios/budgets';
import { checkReadiness } from '../readiness';
import { runScenario } from './scenario-runner';

// ============================================================================
// Building architectures the way the app does
// ============================================================================

function mintIds(): () => Id {
  let n = 1;
  return () => `00000000-0000-4000-8000-${(n++).toString(16).padStart(12, '0')}`;
}

class Arch {
  doc: Document;
  readonly viewId: Id;
  readonly mint = mintIds();
  /** Request class used by workloads and by bridge-call resource metadata. */
  readonly readClass = this.mint();

  constructor() {
    this.viewId = this.mint();
    this.doc = {
      schema: 'studio-model/1', id: this.mint(), title: 'Reference architecture',
      elements: [], connections: [], relations: [], schemas: [], fixtures: [], refinements: [], scenarios: [],
      views: [{ id: this.viewId, label: 'Main', placements: [], connectionIds: [], relationIds: [], groups: [], notes: [] }],
    };
  }

  private apply(changes: Parameters<typeof applyRecordChanges>[1]): void {
    const r = applyRecordChanges(this.doc, changes);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    this.doc = r.document;
  }

  private replaceElement(record: Element): void {
    this.apply([{ kind: 'replace', value: { recordKind: 'element', record } } as never]);
  }

  el(id: Id): Element {
    return this.doc.elements.find((e) => e.id === id)!;
  }

  place(entryId: string, label?: string): Id {
    const r = placeEntry({ document: this.doc, viewId: this.viewId, entryId, anchor: { x: 0, y: 0 }, mintId: this.mint });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    this.apply(r.changes);
    if (label) this.replaceElement({ ...this.el(r.elementId), label });
    return r.elementId;
  }

  /** Patches a resource element's config, as the inspector does. */
  set(id: Id, patch: Record<string, unknown>): void {
    const e = this.el(id);
    if (e.behavior.kind !== 'resource') throw new Error(`${e.label} is not a resource`);
    this.replaceElement({ ...e, behavior: { ...e.behavior, config: { ...e.behavior.config, ...patch } as never } });
  }

  /** Patches a connection's config, as the inspector does. */
  setConn(id: Id, patch: Record<string, unknown>): void {
    const c = this.doc.connections.find((x) => x.id === id)!;
    this.apply([{ kind: 'replace', value: { recordKind: 'connection', record: { ...c, config: { ...c.config, ...patch } } as Connection } } as never]);
  }

  /** Connects the way the canvas does (CanvasView handleConnectEnd): planConnection from the source's first non-event out port to the target element. */
  connect(from: Id, to: Id): Id {
    const out = this.el(from).ports.find((p) => p.direction === 'out' && p.channel !== 'event')!;
    const r = planConnection({ document: this.doc, viewId: this.viewId, source: { elementId: from, portId: out.id }, target: { elementId: to }, mintId: this.mint });
    if (r.kind === 'rejected') throw new Error(JSON.stringify(r.issues));
    if (r.kind === 'ready') {
      this.apply(r.changes);
      return r.connectionId;
    }
    const c = completeConnection(r.draft, { requestClassId: this.readClass, requestClassLabel: 'read', operation: 'read', deadlineDurationMs: 30000 });
    if (!c.ok) throw new Error(JSON.stringify(c.issues));
    this.apply(c.changes);
    return c.connectionId;
  }

  /** Tries a connection exactly as the canvas would, with no workaround; returns the rejection text. */
  tryConnect(from: Id, to: Id): string | null {
    const out = this.el(from).ports.find((p) => p.direction === 'out' && p.channel !== 'event')!;
    const r = planConnection({ document: this.doc, viewId: this.viewId, source: { elementId: from, portId: out.id }, target: { elementId: to }, mintId: this.mint });
    return r.kind === 'rejected' ? r.issues.map((i) => i.message).join('; ') : null;
  }
}

// ============================================================================
// Scenarios and results
// ============================================================================

type Run = Awaited<ReturnType<typeof runScenario>>;

const uniformKeys = { kind: 'uniform' as const, catalogSize: 1000, hotSubset: 1, hotShare: 100 };

/**
 * Timed scenario with one workload, workload timeout 30 s (TrafficSection's default).
 * Completion defaults to a horizon at `seconds`. Budgets are the contracted maxima
 * (storage.md §6) so the traces the tests read stay complete.
 */
function scenario(
  a: Arch,
  entry: Id,
  opts: { rate: number; seconds: number; timeoutMs?: number; classes?: Workload['classes']; seed?: number; completion?: CompletionPolicy },
): Id {
  const e = a.el(entry);
  const entryPortId = e.behavior.kind === 'resource' ? e.behavior.entryPortId : e.ports.find((p) => p.direction === 'in')!.id;
  const workload: Workload = {
    id: a.mint(), entry: { elementId: entry, portId: entryPortId }, enabled: true, rate: opts.rate, profile: { kind: 'steady' },
    timeoutMs: opts.timeoutMs ?? 30000, intervalMs: null,
    classes: opts.classes ?? [{ id: a.readClass, name: 'read', weight: 1, operation: 'read', tags: [], keyDistribution: uniformKeys }],
  };
  const scn: Scenario = {
    id: a.mint(), label: 'Reference run', revision: 0, mode: 'timed', scopeElementIds: a.doc.elements.map((x) => x.id),
    entryPorts: [workload.entry], inputs: [], workloads: [workload], faults: [], boundaries: [], refinementSelections: [], initialContexts: [],
    // Readiness needs one assertion; the tests read counts and metrics directly.
    assertions: [{ id: a.mint(), label: 'nothing failed', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'failed' }, operator: 'equals', expected: 0 }],
    seed: opts.seed ?? 7,
    budgets: { ...DEFAULT_SCENARIO_BUDGETS, maxEvents: 1_000_000, maxTraceRows: 100_000, maxTraceBytes: 16 * 1048576 },
    completion: opts.completion ?? { kind: 'horizon', horizonMs: opts.seconds * 1000 },
    assumptions: [],
  };
  a.doc = { ...a.doc, scenarios: [...a.doc.scenarios, scn] };
  return scn.id;
}

async function run(a: Arch, scenarioId: Id): Promise<Run> {
  const ready = checkReadiness(a.doc, scenarioId);
  if (!ready.ready) throw new Error(`not ready: ${JSON.stringify(ready.issues)}`);
  const r = await runScenario(a.doc, scenarioId, `run-${scenarioId}`);
  report(a, r);
  return r;
}

function metric(r: Run, key: string, elementId: Id | null = null, scope: 'root' | 'message' | 'element' = elementId ? 'element' : 'root'): number {
  const m = r.summary.elementMetrics.find((x) => x.key === key && x.elementId === elementId && x.scope === scope);
  if (!m) throw new Error(`no ${scope} metric ${key} for ${elementId}`);
  return m.value ?? NaN;
}

type Outcomes = { generated: number; succeeded: number; rejected: number; failed: number; expired: number; inFlight: number; meanMs: number };

/** Root (or message) outcomes from the adapter's metrics. */
function outcomes(r: Run, scope: 'root' | 'message' = 'root'): Outcomes {
  const m = (k: string) => metric(r, k, null, scope);
  return {
    generated: m('generated'), succeeded: m('succeeded'), rejected: m('rejected'), failed: m('failed'), expired: m('expired'), inFlight: m('inFlight'),
    meanMs: scope === 'root' ? m('meanLatencyMs') : NaN,
  };
}

/** Distinct roots with a final (non-attempt) settlement of `outcome`, from the trace; optionally only at one element. */
function rootsSettled(r: Run, outcome: string, elementId?: Id): number {
  return new Set(
    r.events
      .filter((e) => e.kind === 'settled' && !e.code.startsWith('attempt') && e.outcome === outcome && (elementId === undefined || e.elementId === elementId))
      .map((e) => e.rootId),
  ).size;
}

function report(a: Arch, r: Run): void {
  if (process.env.REF_REPORT !== '1') return;
  const els = a.doc.elements.filter((e) => e.behavior.kind === 'resource').map((e) => `${e.label} u=${metric(r, 'utilization', e.id).toFixed(2)}`).join(', ');
  console.info(`[ref] ${a.doc.title} | ${r.status}${r.reason ? ` (${r.reason})` : ''} | roots ${JSON.stringify(outcomes(r))} | msgs ${JSON.stringify(outcomes(r, 'message'))} | ${els} | rows ${r.events.length}`);
}

/** A linear call chain, each element placed from the catalog and optionally reconfigured. */
function chain(title: string, kinds: readonly string[], configs: readonly Record<string, unknown>[] = [], linkMs = 0): { a: Arch; ids: Id[] } {
  const a = new Arch();
  a.doc = { ...a.doc, title };
  const ids = kinds.map((k, i) => a.place(k, `${k}${i}`));
  configs.forEach((c, i) => Object.keys(c).length && a.set(ids[i], c));
  for (let i = 0; i + 1 < ids.length; i++) {
    const c = a.connect(ids[i], ids[i + 1]);
    if (linkMs) a.setConn(c, { latencyMs: linkMs, returnLatencyMs: linkMs });
  }
  return { a, ids };
}

const fixture = (name: string): Document => JSON.parse(readFileSync(join(process.cwd(), 'specs/revamp/fixtures', name), 'utf8'));

// ============================================================================
// A1-A12
// ============================================================================

describe('A1 cache in front of a database', () => {
  it('defaults: an 80% hit rate protects the database', async () => {
    const { a, ids } = chain('A1 defaults h80', ['service', 'cache', 'database'], [{}, { hitRate: 80 }]);
    const r = await run(a, scenario(a, ids[0], { rate: 800, seconds: 4 }));
    expect(r.status).toBe('completed');
    const o = outcomes(r);
    expect(o.rejected + o.failed + o.expired).toBe(0);
  });

  it('defaults: at 20% hits requests are rejected, but by the API service one-slot hold, not the database [gap H11]', async () => {
    const { a, ids } = chain('A1 defaults h20', ['service', 'cache', 'database'], [{}, { hitRate: 20 }]);
    const r = await run(a, scenario(a, ids[0], { rate: 800, seconds: 4 }));
    expect(r.status).toBe('completed');
    const rejected = rootsSettled(r, 'rejected');
    expect(rejected).toBeGreaterThan(500);
    expect(rootsSettled(r, 'rejected', ids[0])).toBe(rejected);
    // The database has headroom; the service in front of it fills its queue because it
    // holds its only slot for the whole miss path. Utilization counts held slots (B5 fixed),
    // so the service shows as the saturated element.
    expect(metric(r, 'utilization', ids[2])).toBeLessThan(0.85);
    expect(metric(r, 'utilization', ids[0])).toBeGreaterThan(0.95);
  });

  it('realistic: the database saturates when the hit rate drops from 80% to 40%', async () => {
    const cfg = (hit: number) => [{ concurrency: 16 }, { concurrency: 16, hitRate: hit }, { concurrency: 5, capacity: 100, writeCapacity: 100 }];
    const high = chain('A1 realistic h80', ['service', 'cache', 'database'], cfg(80));
    const low = chain('A1 realistic h40', ['service', 'cache', 'database'], cfg(40));
    const rh = await run(high.a, scenario(high.a, high.ids[0], { rate: 1000, seconds: 3 }));
    const rl = await run(low.a, scenario(low.a, low.ids[0], { rate: 1000, seconds: 3 }));
    expect([rh.status, rl.status]).toEqual(['completed', 'completed']);
    expect(rootsSettled(rh, 'rejected')).toBe(0);
    expect(metric(rh, 'utilization', high.ids[2])).toBeLessThan(0.6);
    expect(metric(rl, 'utilization', low.ids[2])).toBeGreaterThan(0.95);
    expect(outcomes(rl).meanMs).toBeGreaterThan(20 * outcomes(rh).meanMs);
  });
});

describe('A2 queue absorbs a burst', () => {
  function build(title: string, queue: Record<string, unknown>, message: Record<string, unknown>, worker: Record<string, unknown> = {}) {
    const a = new Arch();
    a.doc = { ...a.doc, title };
    const api = a.place('service', 'API');
    const q = a.place('queue', 'Queue');
    const wk = a.place('worker', 'Worker');
    if (Object.keys(queue).length) a.set(q, queue);
    if (Object.keys(worker).length) a.set(wk, worker);
    const publish = a.connect(api, q); // the message's TTL is set where it is published
    a.connect(q, wk);
    if (Object.keys(message).length) a.setConn(publish, message);
    return { a, api };
  }

  it('the canvas connects a service to a queue and a queue to a worker [fixed G1]', () => {
    const a = new Arch();
    const api = a.place('service');
    const q = a.place('queue');
    const wk = a.place('worker');
    expect(a.tryConnect(api, q)).toBeNull();
    a.connect(api, q);
    expect(a.tryConnect(q, wk)).toBeNull();
    a.connect(q, wk);
    const [publish, deliver] = a.doc.connections;
    expect([publish.kind, deliver.kind]).toEqual(['message', 'call']);
    expect(a.el(api).ports.find((p) => p.id === publish.source.portId)).toMatchObject({ label: 'publish', channel: 'message' });
    expect(a.el(q).ports.find((p) => p.id === deliver.source.portId)).toMatchObject({ direction: 'out', channel: 'call' });
    // A second identical link would double every message; brokers deliver only to processors.
    expect(a.tryConnect(api, q)).toMatch(/already connected/);
    expect(a.tryConnect(q, wk)).toMatch(/already connected/);
    expect(a.tryConnect(q, a.place('database'))).toMatch(/Channel mismatch/);
  });

  it('defaults: 2x the worker rate fills the 500-message queue limit and publishes fail [default]', async () => {
    const { a, api } = build('A2 defaults', {}, {});
    const r = await run(a, scenario(a, api, { rate: 400, seconds: 8 }));
    expect(r.status).toBe('completed');
    const m = outcomes(r, 'message');
    expect(m.rejected).toBeGreaterThan(500);
    expect(outcomes(r).failed).toBe(m.rejected); // a rejected publish fails the API request
  });

  it('defaults: with room in the queue, the 10 s message TTL still expires the backlog [gap H12]', async () => {
    const { a, api } = build('A2 TTL', { queueLimit: 10000 }, {}, { capacity: 10 });
    const r = await run(a, scenario(a, api, { rate: 40, seconds: 25 }));
    expect(r.status).toBe('completed');
    expect(outcomes(r, 'message').expired).toBeGreaterThan(50);
  });

  it('realistic: with a large queue and a 5-minute TTL nothing is lost; the backlog waits', async () => {
    const { a, api } = build('A2 realistic', { queueLimit: 10000 }, { messageTtlMs: 300000 });
    const r = await run(a, scenario(a, api, { rate: 400, seconds: 8 }));
    expect(r.status).toBe('completed');
    const m = outcomes(r, 'message');
    expect(m.rejected + m.failed + m.expired).toBe(0);
    expect(m.inFlight).toBeGreaterThan(1000);
    expect(outcomes(r).failed).toBe(0);
  });
});

describe('A3 retry storm', () => {
  it('overload rejections are never retried, so maxRetries changes nothing [gap H13]', async () => {
    const results = [];
    for (const maxRetries of [0, 3]) {
      const { a, ids } = chain(`A3 maxRetries ${maxRetries}`, ['service'], [{ capacity: 10, concurrency: 1, queueLimit: 5, maxRetries }]);
      const r = await run(a, scenario(a, ids[0], { rate: 20, seconds: 20 }));
      results.push({ rejected: rootsSettled(r, 'rejected'), retries: r.events.filter((e) => e.kind === 'started' && e.code !== 'attempt:1').length });
    }
    expect(results[0].rejected).toBeGreaterThan(100);
    expect(results[1]).toEqual(results[0]);
    expect(results[1].retries).toBe(0);
  });
});

describe('A4 balancer failover', () => {
  it('S04 topology with catalog defaults: errors during the detection delay match load-on-host x delay, then recovery', async () => {
    const counts: number[] = [];
    for (const seed of [1, 2, 3]) {
      const d = fixture('s04.json');
      const defaults = (kind: string) => getEntry(kind)!.defaultConfig as Record<string, unknown>;
      const elements = d.elements.map((e) =>
        e.behavior.kind === 'resource' ? { ...e, behavior: { ...e.behavior, config: defaults(e.visualKind === 'balancer' ? 'balancer' : 'service') } } : e,
      ) as Element[];
      const router = elements.find((e) => e.label === 'Router')!;
      const base = d.scenarios[0]; // H1 (route A) down 2-4 s, detection and recovery detection 1 s
      const workload: Workload = {
        id: '00000000-0000-4000-8000-0000000000aa', entry: { elementId: router.id, portId: (router.behavior as { entryPortId: Id }).entryPortId },
        enabled: true, rate: 100, profile: { kind: 'steady' }, timeoutMs: 30000, intervalMs: null,
        classes: [{ id: '00000000-0000-4000-8000-0000000000ab', name: 'read', weight: 1, operation: 'read', tags: [], keyDistribution: uniformKeys }],
      };
      const scn: Scenario = {
        ...base, inputs: [], workloads: [workload], seed, entryPorts: [workload.entry], completion: { kind: 'horizon', horizonMs: 6000 },
        assertions: base.assertions.filter((x) => x.subject.kind === 'count').slice(0, 1),
      };
      const doc = { ...d, title: `A4 seed ${seed}`, elements, scenarios: [scn] } as Document;
      expect(checkReadiness(doc, scn.id).ready).toBe(true);
      const r = await runScenario(doc, scn.id, `a4-${seed}`);
      expect(r.status).toBe('completed');
      const bad = r.events.filter((e) => e.kind === 'settled' && e.elementId === router.id && !e.code.startsWith('attempt') && e.outcome !== 'succeeded');
      for (const e of bad) {
        expect(e.atMs!).toBeGreaterThanOrEqual(2000);
        expect(e.atMs!).toBeLessThan(3000);
      }
      counts.push(bad.length);
    }
    // lambda_host * d = (100/s over 2 hosts) * 1 s = 50; Poisson SD ~7 per seed.
    const mean = counts.reduce((x, y) => x + y, 0) / counts.length;
    expect(Math.abs(mean - 50)).toBeLessThan(15);
  });
});

describe('A5 fan-out', () => {
  async function fanOut(kind: 'pubsub' | 'stream') {
    const a = new Arch();
    a.doc = { ...a.doc, title: `A5 ${kind}` };
    const api = a.place('service', 'API');
    const b = a.place(kind, kind);
    a.connect(api, b);
    for (const n of [1, 2, 3]) a.connect(b, a.place('worker', `Consumer ${n}`));
    const r = await run(a, scenario(a, api, { rate: 30, seconds: 10 }));
    expect(r.status).toBe('completed');
    // A few publishes are still in flight at the horizon, so compare per-root ratios.
    return outcomes(r, 'message').generated / outcomes(r).succeeded;
  }

  it('pub/sub delivers every event to each of three subscribers', async () => {
    expect(Math.abs((await fanOut('pubsub')) - 3)).toBeLessThan(0.03);
  });

  it('a stream splits events between its consumers instead of giving each consumer every event [gap H14]', async () => {
    expect(Math.abs((await fanOut('stream')) - 1)).toBeLessThan(0.02);
  });
});

describe('A6 write-heavy mix on a database', () => {
  async function mix(title: string, db: Record<string, unknown>, writeShare: number) {
    const { a, ids } = chain(title, ['service', 'database'], [{ concurrency: 16 }, db]);
    const r = await run(a, scenario(a, ids[0], {
      rate: 400, seconds: 5,
      classes: [
        { id: a.readClass, name: 'read', weight: 10 - writeShare * 10, operation: 'read', tags: [], keyDistribution: uniformKeys },
        { id: a.mint(), name: 'write', weight: writeShare * 10, operation: 'write', tags: [], keyDistribution: uniformKeys },
      ],
    }));
    expect(r.status).toBe('completed');
    return { rejected: rootsSettled(r, 'rejected'), util: metric(r, 'utilization', ids[1]) };
  }

  it('defaults: reads and writes cost the same, so the mix makes no difference [default]', async () => {
    expect(await mix('A6 defaults 80% writes', {}, 0.8)).toEqual(await mix('A6 defaults 20% writes', {}, 0.2));
  });

  it('realistic: with writes 5x as expensive, a write-heavy mix saturates the database', async () => {
    const db = { capacity: 1000, writeCapacity: 200 };
    const reads = await mix('A6 realistic 20% writes', db, 0.2);
    const writes = await mix('A6 realistic 80% writes', db, 0.8);
    expect(reads.rejected).toBe(0);
    expect(writes.rejected).toBeGreaterThan(100);
    expect(writes.util).toBeGreaterThan(0.95);
  });
});

describe('A7 synchronous chain', () => {
  const four = ['service', 'service', 'service', 'service'] as const;

  it('defaults: 0 ms links, so four hops add only service time [gap H2]', async () => {
    const { a, ids } = chain('A7 defaults 0 ms', four);
    const r = await run(a, scenario(a, ids[0], { rate: 100, seconds: 5 }));
    expect(outcomes(r).meanMs).toBeLessThan(3);
  });

  it('defaults with 5 ms links: one-slot services collapse at 100/s [gap H11]', async () => {
    const { a, ids } = chain('A7 defaults 5 ms', four, [], 5);
    const r = await run(a, scenario(a, ids[0], { rate: 100, seconds: 5 }));
    const o = outcomes(r);
    // The first service holds its only slot for the ~32 ms round trip: at most ~31/s pass,
    // and the rest wait in its queue.
    expect(metric(r, 'throughput')).toBeLessThan(35);
    expect(o.succeeded).toBeLessThan(0.5 * o.generated);
    expect(o.meanMs).toBeGreaterThan(1000);
  });

  it('realistic: latency is 2 x hops x link latency plus service time', async () => {
    const c16 = { concurrency: 16 };
    const { a, ids } = chain('A7 realistic 5 ms', four, [c16, c16, c16, c16], 5);
    const r = await run(a, scenario(a, ids[0], { rate: 100, seconds: 5 }));
    expect(outcomes(r).meanMs).toBeCloseTo(2 * 3 * 5 + 4 * 0.5, 1);
  });

  it('realistic: a timeout below the tail expires requests under load and not under light load', async () => {
    const c16 = { concurrency: 16 };
    const slow = { concurrency: 1, capacity: 100 }; // 10 ms per request, 100/s
    const expired: number[] = [];
    for (const rate of [20, 90]) {
      const { a, ids } = chain(`A7 timeout at ${rate}/s`, four, [c16, c16, c16, slow], 5);
      const r = await run(a, scenario(a, ids[0], { rate, seconds: 10, timeoutMs: 60 }));
      expect(r.status).toBe('completed');
      expired.push(outcomes(r).expired);
    }
    expect(expired[0]).toBe(0);
    expect(expired[1]).toBeGreaterThan(20);
  });
});

describe('A8 hot keys', () => {
  async function hitRatio(mode: 'fixed' | 'lru', hot: boolean) {
    const { a, ids } = chain(`A8 ${mode} ${hot ? 'hot' : 'uniform'}`, ['cache', 'database'], [{ mode, entries: 100 }, { concurrency: 16 }]);
    const keyDistribution = hot ? { kind: 'hot' as const, catalogSize: 10000, hotSubset: 50, hotShare: 90 } : { ...uniformKeys, catalogSize: 10000 };
    const r = await run(a, scenario(a, ids[0], { rate: 200, seconds: 10, classes: [{ id: a.readClass, name: 'read', weight: 1, operation: 'read', tags: [], keyDistribution }] }));
    const h = metric(r, 'cacheHits', ids[0]);
    return h / (h + metric(r, 'cacheMisses', ids[0]));
  }

  it('defaults: fixed mode ignores keys, so hot and uniform traffic hit equally [default]', async () => {
    expect(await hitRatio('fixed', true)).toBe(await hitRatio('fixed', false));
  });

  it('realistic: in LRU mode a hot set hits far more often than uniform keys', async () => {
    expect(await hitRatio('lru', true)).toBeGreaterThan(0.8);
    expect(await hitRatio('lru', false)).toBeLessThan(0.05);
  });
});

describe('A9 gateway in front of replicas', () => {
  async function throughput(gateway: Record<string, unknown>, replicas: number) {
    const a = new Arch();
    a.doc = { ...a.doc, title: `A9 ${JSON.stringify(gateway)} x${replicas}` };
    const g = a.place('gateway', 'Gateway');
    if (Object.keys(gateway).length) a.set(g, gateway);
    for (let i = 0; i < replicas; i++) {
      const s = a.place('service', `Replica ${i}`);
      a.set(s, { capacity: 50, concurrency: 1 });
      a.setConn(a.connect(g, s), { latencyMs: 1, returnLatencyMs: 1 });
    }
    const r = await run(a, scenario(a, g, { rate: 1000, seconds: 5 }));
    expect(r.status).toBe('completed');
    return metric(r, 'throughput');
  }

  it('defaults: throughput stays flat as replicas are added, capped by the gateway one-slot hold [gap H11]', async () => {
    const t = [await throughput({}, 1), await throughput({}, 4), await throughput({}, 8)];
    expect(t[0]).toBeGreaterThan(30);
    for (const x of t) expect(Math.abs(x - t[0])).toBeLessThan(0.05 * t[0]);
  });

  it('realistic: with 16 gateway slots throughput grows with the replica count', async () => {
    for (const n of [1, 2, 4, 8]) expect(Math.abs((await throughput({ concurrency: 16 }, n)) - 50 * n)).toBeLessThan(0.05 * 50 * n);
  });
});

describe('A10 async order flow (S05)', () => {
  it('checkout response time does not depend on the fulfilment worker speed', async () => {
    const uiAt: number[] = [];
    for (const capacity of [1000, 1]) {
      const d = fixture('s05.json');
      const doc = {
        ...d,
        elements: d.elements.map((e) => (e.label === 'Fulfillment worker' && e.behavior.kind === 'resource' ? { ...e, behavior: { ...e.behavior, config: { ...e.behavior.config, capacity } } } : e)),
      } as Document;
      const r = await runScenario(doc, doc.scenarios[0].id, `a10-${capacity}`);
      expect(r.status).toBe('completed');
      expect(r.checks.every((c) => c.status === 'passed')).toBe(true);
      uiAt.push(r.events.find((e) => e.code === 'ui-success')!.atMs!);
    }
    expect(uiAt[1]).toBe(uiAt[0]);
  });
});

describe('A11 batch into a pipeline (S03)', () => {
  it('a row that fails validation goes to the errors output; valid rows reach the totals', async () => {
    const d = fixture('s03.json');
    const r = await runScenario(d, d.scenarios[0].id, 'a11');
    expect(r.status).toBe('completed');
    expect(r.summary.rowOutcomes.filter((o) => o.outcome === 'error').map((o) => o.errorCode)).toEqual(['schema-mismatch']);
    const label = (portId: Id) => d.elements.flatMap((e) => e.ports).find((p) => p.id === portId)!.label;
    expect(Object.fromEntries(r.summary.outputs.map((o) => [label(o.port.portId), o.values.length]))).toEqual({ totals: 1, errors: 1 });
  });
});

describe('A12 service calling a third party', () => {
  async function callThirdParty(delayMs: number, outcome: 'succeeded' | 'failed') {
    const a = new Arch();
    a.doc = { ...a.doc, title: `A12 ${delayMs} ms ${outcome}` };
    const svc = a.place('service', 'Payments API');
    a.set(svc, { concurrency: 16 });
    a.connect(svc, a.place('thirdparty', 'Card processor'));
    const out = a.el(svc).ports.find((p) => p.direction === 'out')!;
    const schemaId = out.responseSchemaId!;
    const response = { id: a.mint(), schemaId, value: {} };
    const id = scenario(a, svc, { rate: 10, seconds: 5 });
    a.doc = {
      ...a.doc,
      fixtures: [...a.doc.fixtures, response],
      scenarios: a.doc.scenarios.map((x) => ({
        ...x,
        scopeElementIds: [svc],
        boundaries: [{
          id: a.mint(), source: { elementId: svc, portId: out.id }, schemaId,
          responses: [{ id: a.mint(), match: { op: 'exists', value: { kind: 'literal', value: true } }, responseFixtureId: response.id, payloadBindings: [], delayMs, afterInputId: null, outcome }],
        }],
      })),
    };
    const r = await run(a, id);
    expect(r.status).toBe('completed');
    return { r, o: outcomes(r) };
  }

  it('a slow third party shows up as caller latency [fixed B8]', async () => {
    const fast = await callThirdParty(10, 'succeeded');
    const slow = await callThirdParty(200, 'succeeded');
    expect(fast.o.succeeded).toBeGreaterThan(30);
    expect(slow.o.failed + slow.o.rejected).toBe(0);
    // One response answers every traffic request (D47); latency = service time + delay.
    expect(fast.o.meanMs).toBeCloseTo(10.5, 0);
    expect(slow.o.meanMs).toBeCloseTo(200.5, 0);
  });

  it('a failing third party fails the caller [fixed B8]', async () => {
    const { o } = await callThirdParty(50, 'failed');
    expect(o.generated).toBeGreaterThan(30);
    expect(o.succeeded).toBe(0);
    expect(o.failed).toBe(o.generated - o.inFlight);
  });
});

// ============================================================================
// Runner and metric defects found while building the architectures
// ============================================================================

describe('Runner defects in timed workload runs (B1-B4 fixed; tests assert the fix)', () => {
  it('a workload entering a queue runs; its messages reach the consumer [fixed B1]', async () => {
    const a = new Arch();
    const q = a.place('queue');
    a.connect(q, a.place('worker'));
    const r = await run(a, scenario(a, q, { rate: 10, seconds: 5 }));
    expect(r.status).toBe('completed');
    const roots = outcomes(r);
    const messages = outcomes(r, 'message');
    expect(roots.generated).toBeGreaterThan(30);
    expect(roots.failed + roots.rejected + roots.expired).toBe(0);
    expect(messages.succeeded).toBeGreaterThanOrEqual(roots.succeeded - 1);
  });

  it('drain completion stops arrivals at arrivalHorizonMs and runs on to drain [fixed B2]', async () => {
    const a = new Arch();
    const svc = a.place('service');
    const r = await run(a, scenario(a, svc, { rate: 50, seconds: 10, completion: { kind: 'drain', arrivalHorizonMs: 10000, deadlineMs: 20000 } }));
    expect(r.status).toBe('completed');
    const admissions = r.events.filter((e) => e.kind === 'dispatch' && e.code === 'admitted');
    expect(admissions.every((e) => e.atMs! <= 10000)).toBe(true);
    expect(Math.abs(outcomes(r).generated - 500)).toBeLessThan(100); // Poisson(500), SD ~22
    expect(r.summary.rootCounts.inFlight).toBe(0);
  });

  it('summary.rootCounts includes workload roots, so root-count assertions see them [fixed B3]', async () => {
    const a = new Arch();
    const svc = a.place('service');
    a.set(svc, { capacity: 10, queueLimit: 0 });
    const id = scenario(a, svc, { rate: 50, seconds: 4 });
    a.doc = {
      ...a.doc,
      scenarios: a.doc.scenarios.map((x) => ({ ...x, assertions: [{ ...x.assertions[0], label: 'nothing rejected', subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'rejected' } }] })),
    };
    const r = await run(a, id);
    const rejected = rootsSettled(r, 'rejected');
    expect(rejected).toBeGreaterThan(50);
    const c = r.summary.rootCounts;
    expect(c.rejected).toBe(rejected);
    expect(c.generated).toBe(outcomes(r).generated);
    expect(c.succeeded + c.rejected + c.failed + c.expired + c.inFlight).toBe(c.generated);
    expect(r.checks[0]).toMatchObject({ status: 'failed', actual: rejected });
  });

  it('a root rejected at admission is counted once, and root counts conserve [fixed B4]', async () => {
    const a = new Arch();
    const svc = a.place('service');
    a.set(svc, { capacity: 10, queueLimit: 0 });
    const r = await run(a, scenario(a, svc, { rate: 50, seconds: 4 }));
    const o = outcomes(r);
    expect(o.rejected).toBe(rootsSettled(r, 'rejected'));
    expect(o.succeeded + o.rejected + o.failed + o.expired + o.inFlight).toBe(o.generated);
  });

  it('metric checks evaluate element throughput and latency in timed runs [fixed B9]', async () => {
    const c16 = { concurrency: 16 };
    const { a, ids } = chain('B9 metrics', ['service', 'service', 'service', 'service'], [c16, c16, c16, c16], 5);
    const id = scenario(a, ids[0], { rate: 100, seconds: 5 });
    const check = (key: 'p95LatencyMs' | 'throughput', operator: 'at-most' | 'at-least', expected: number) => ({
      id: a.mint(), label: `${key} ${operator} ${expected}`, subject: { kind: 'metric' as const, elementId: ids[0], key }, operator, expected,
    });
    a.doc = {
      ...a.doc,
      scenarios: a.doc.scenarios.map((x) => ({
        ...x,
        assertions: [check('p95LatencyMs', 'at-most', 40), check('p95LatencyMs', 'at-most', 20), check('throughput', 'at-least', 80)],
      })),
    };
    const r = await run(a, id);
    // Each element's response time covers everything below it: 2 x 5 ms per remaining hop plus 0.5 ms per element.
    const mean = (i: number) => metric(r, 'meanLatencyMs', ids[i]);
    expect(mean(0)).toBeCloseTo(32, 0);
    expect(mean(1)).toBeCloseTo(21.5, 0);
    expect(mean(3)).toBeCloseTo(0.5, 1);
    expect(r.checks.map((c) => c.status)).toEqual(['passed', 'failed', 'passed']);
  });

  it('default budgets stop recording the trace, not the run: a 50/s, 30 s run completes [fixed B7]', async () => {
    const a = new Arch();
    const svc = a.place('service');
    a.connect(svc, a.place('database'));
    const id = scenario(a, svc, { rate: 50, seconds: 30 });
    a.doc = { ...a.doc, scenarios: a.doc.scenarios.map((x) => ({ ...x, budgets: DEFAULT_SCENARIO_BUDGETS })) };
    const r = await run(a, id);
    expect(r.status).toBe('completed');
    expect(r.summary.trace).toEqual({ recordedRows: DEFAULT_SCENARIO_BUDGETS.maxTraceRows, truncatedBy: 'trace-rows' });
    expect(r.events).toHaveLength(DEFAULT_SCENARIO_BUDGETS.maxTraceRows);
    const c = r.summary.rootCounts;
    // ~1,500 over 30 s (1,546 with this seed); the old cap stopped the run at ~1,400.
    expect(c.generated).toBeGreaterThan(1450);
    expect(c.succeeded + c.rejected + c.failed + c.expired + c.inFlight).toBe(c.generated);
  });
});

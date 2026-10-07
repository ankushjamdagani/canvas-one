import { describe, expect, it } from 'vitest';
import type { FlowRecord } from '../../domain/studio/runner/types';
import { PlaybackStore } from './playback';
import { readFileSync } from 'node:fs';
import type { Document } from '../../domain/studio/model';
import { checkReadiness } from '../../domain/studio/readiness';
import { ScenarioRunner } from '../../domain/studio/runner/scenario-runner';

const make = (historyMs: number | null = null) => new PlaybackStore({ historyMs,
  connectionTargets: new Map([['call', 'svc'], ['child', 'db']]),
  connectionEndpoints: new Map([['call', { source: 'entry', target: 'svc' }], ['child', { source: 'svc', target: 'db' }]]),
  connectionChannels: new Map([['call', 'call'], ['child', 'call']]),
  nodeNames: new Map([['entry', 'Entry'], ['svc', 'Service'], ['db', 'Database']]),
  nodeCapacities: new Map([['entry', 1], ['svc', 2], ['db', 3]]),
});
const record = (phase: FlowRecord['phase'], atMs: number, extra: Partial<FlowRecord> = {}): FlowRecord => ({
  key: 'unit', connectionId: 'call', phase, atMs, arriveAtMs: null, outcome: null, ...extra,
});

describe('Cells and lanes playback traffic', () => {
  it('records real local retry backoff and root deadlines at their owners', async () => {
    const source = JSON.parse(readFileSync('specs/revamp/fixtures/s06.json', 'utf8')) as Document;
    const service = source.elements.find(e => e.label === 'Checkout API A')!;
    if (service.behavior.kind !== 'resource') throw new Error('Missing S06 resource');
    const entryPortId = service.behavior.entryPortId;
    for (const deadline of [10, 10_000]) {
      const doc: Document = { ...source,
        elements: source.elements.map(e => e.id === service.id && e.behavior.kind === 'resource' ? { ...e,
          behavior: { ...e.behavior, config: { ...e.behavior.config, capacity: 20, failureRate: 100, maxRetries: 1, retryDelayMs: 100 } } } : e),
        scenarios: source.scenarios.slice(0,1).map(s => ({ ...s, workloads: s.workloads.map(w => ({ ...w,
          entry: { elementId: service.id, portId: entryPortId }, timeoutMs: deadline,
          emission: { mode: 'bulk' as const, requests: 6, arrival: 'instant' as const } })) })) };
      expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
      const runner = new ScenarioRunner(doc, doc.scenarios[0].id, `traffic-deadline-${deadline}`), records: FlowRecord[] = [];
      while (await runner.step()) records.push(...runner.drainFlow());
      records.push(...runner.drainFlow());
      const s = new PlaybackStore({ historyMs: null, connectionTargets: new Map(doc.connections.map(c => [c.id,c.target.elementId])),
        nodeCapacities: new Map([[service.id,64]]) });
      s.ingestFlow(records);
      const final = s.trafficAt(runner.simulatedMs + 1).nodes.get(service.id)!;
      expect(final.processing).toBe(0); expect(final.retry).toBe(0);
      if (deadline === 10) expect(final.outcomes).toContainEqual({ kind: 'timeout', rate: .6 });
      else {
        const retry = records.find(r => r.phase === 'retry')!;
        expect(retry).toBeDefined(); expect(retry.retryAtMs).toBeGreaterThan(retry.atMs);
        expect(s.trafficAt(retry.atMs).nodes.get(service.id)!.retry).toBeGreaterThan(0);
        expect(final.outcomes).toContainEqual({ kind: 'retryExhausted', rate: .6 });
      }
    }
  });
  it('maps real S06 fanout, bridge replies and broker delivery without changing run behavior', async () => {
    const source = JSON.parse(readFileSync('specs/revamp/fixtures/s06.json', 'utf8')) as Document;
    const doc: Document = { ...source, scenarios: source.scenarios.slice(0, 1).map(s => ({ ...s,
      workloads: s.workloads.map(w => ({ ...w, emission: { mode: 'bulk' as const, requests: 100, arrival: 'instant' as const } })) })) };
    expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, 'traffic-s06');
    const records: FlowRecord[] = [];
    while (await runner.step()) records.push(...runner.drainFlow());
    records.push(...runner.drainFlow());
    expect(runner.getResult().status).toBe('completed');
    const s = new PlaybackStore({ historyMs: null,
      connectionTargets: new Map(doc.connections.map(c => [c.id, c.target.elementId])),
      connectionEndpoints: new Map(doc.connections.map(c => [c.id, { source: c.source.elementId, target: c.target.elementId }])),
      connectionChannels: new Map(doc.connections.map(c => { const source = doc.elements.find(e => e.id === c.source.elementId)!; return [c.id, source.behavior.kind === 'resource' && source.behavior.config.type === 'broker' ? 'message' : source.ports.find(p => p.id === c.source.portId)!.channel]; })),
      nodeNames: new Map(doc.elements.map(e => [e.id, e.label])),
      nodeCapacities: new Map(doc.elements.map(e => [e.id, e.behavior.kind === 'resource' ? e.behavior.config.concurrency : 0])),
      nodeSlotHolds: new Map(doc.elements.map(e => [e.id, e.behavior.kind === 'resource' && !['source', 'router', 'broker'].includes(e.behavior.config.type)])),
    });
    s.ingestFlow(records);
    expect(records.some(r => r.phase === 'await')).toBe(true);
    expect(records.some(r => r.phase === 'blocked')).toBe(true);
    const card = doc.elements.find(e => e.label === 'Card processor')!;
    const bridge = doc.connections.find(c => c.target.elementId === card.id)!;
    expect(records.some(r => r.connectionId === bridge.id && r.phase === 'sent')).toBe(true);
    expect(records.some(r => r.connectionId === bridge.id && r.phase === 'response')).toBe(true);
    const times = [...new Set(records.filter(r => r.phase === 'await').map(r => r.atMs))].sort((a,b) => a-b);
    expect(times.some(t => [...s.trafficAt(t).nodes.values()].some(n => n.awaiting > 0 && n.processing > 0))).toBe(true);
    const done = s.trafficAt(runner.simulatedMs + 1);
    expect([...done.nodes.values()].every(n => n.processing === 0 && n.queued === 0 && n.awaiting === 0 && n.retry === 0)).toBe(true);
    expect([...done.connections.values()].every(c => c.forward === 0 && c.returning === 0 && !c.blocked)).toBe(true);
    expect([...done.nodes.values()].some(n => n.outcomes?.some(o => o.rate > 0))).toBe(true);
  });
  it('keeps independent processing and queue populations exact while seeking backwards', () => {
    const s = make();
    s.ingestFlow([record('processing', 10, { key: 'active' }), record('queued', 20, { key: 'queued' }),
      record('processing', 30, { key: 'queued' }), record('released', 40, { key: 'active' })]);
    expect(s.trafficAt(25).nodes.get('svc')).toMatchObject({ queued: 1, processing: 1, capacity: 2 });
    expect(s.trafficAt(35).nodes.get('svc')).toMatchObject({ queued: 0, processing: 2 });
    expect(s.trafficAt(45).nodes.get('svc')).toMatchObject({ queued: 0, processing: 1 });
    expect(s.trafficAt(25).nodes.get('svc')).toMatchObject({ queued: 1, processing: 1 });
  });

  it('counts directional transport only within each recorded departure and arrival interval', () => {
    const s = make();
    s.ingestFlow([record('sent', 10, { key: 'forward', arriveAtMs: 100 }),
      record('response', 20, { key: 'back', arriveAtMs: 200, outcome: 'failed' })]);
    expect(s.trafficAt(50).connections.get('call')).toMatchObject({ forward: 1, returning: 1, errors: 1 });
    expect(s.trafficAt(100).connections.get('call')?.forward ?? 0).toBe(0);
    expect(s.trafficAt(200).connections.get('call')?.returning ?? 0).toBe(0);
    expect(s.trafficAt(50).connections.get('call')).toMatchObject({ forward: 1, returning: 1 });
  });

  it('keeps awaiting calls, queued work and retries simultaneous and clears only the matching owner', () => {
    const s = make();
    s.ingestFlow([record('processing', 10, { key: 'parent' }), record('queued', 11, { key: 'queue' }),
      record('await', 20, { key: 'child-a', ownerKey: 'parent', connectionId: 'child', elementId: 'svc' }),
      record('await', 21, { key: 'child-b', ownerKey: 'other', connectionId: 'child', elementId: 'svc' }),
      record('retry', 22, { key: 'retry', ownerKey: 'parent', elementId: 'svc', retryAtMs: 100 }),
      record('await_resolved', 30, { key: 'child-a', ownerKey: 'parent', connectionId: 'child', elementId: 'svc' }),
      record('released', 40, { key: 'parent' })]);
    expect(s.trafficAt(25).nodes.get('svc')).toMatchObject({ processing: 1, queued: 1, awaiting: 2, retry: 1,
      services: [{ name: 'Database', pending: 2 }] });
    expect(s.trafficAt(35).nodes.get('svc')).toMatchObject({ processing: 1, awaiting: 1, retry: 1 });
    expect(s.trafficAt(45).nodes.get('svc')).toMatchObject({ processing: 0, queued: 1, awaiting: 1, retry: 0 });
    expect(s.trafficAt(25).nodes.get('svc')).toMatchObject({ processing: 1, awaiting: 2, retry: 1 });
  });

  it('keeps a successful settled slot until its recorded release', () => {
    const s = make();
    s.ingestFlow([record('processing', 10), record('settled', 20, { outcome: 'succeeded' }), record('released', 30)]);
    expect(s.trafficAt(25).nodes.get('svc')?.processing).toBe(1);
    expect(s.trafficAt(35).nodes.get('svc')?.processing).toBe(0);
  });

  it('shows no progress only for explicitly recorded unresolved calls', () => {
    const s = make();
    s.ingestFlow([record('await', 20, { ownerKey: 'caller', elementId: 'svc', connectionId: 'child' }),
      record('queued', 25, { key: 'queue', elementId: 'svc' }),
      record('no_progress', 100, { key: 'caller', ownerKey: 'caller', elementId: 'svc', connectionId: null }),
      record('await_resolved', 120, { ownerKey: 'caller', elementId: 'svc', connectionId: 'child' })]);
    expect(s.trafficAt(99).nodes.get('svc')?.noProgress).toBeUndefined();
    expect(s.trafficAt(100).nodes.get('svc')?.noProgress).toMatchObject({ count: 1, service: 'Database' });
    expect(s.trafficAt(120).nodes.get('svc')?.noProgress).toBeUndefined();
    expect(s.trafficAt(100).nodes.get('svc')?.noProgress?.count).toBe(1);
  });

  it('preserves high population counts without producing per-request output', () => {
    const s = make();
    s.ingestFlow(Array.from({ length: 10_000 }, (_, i) => record('sent', 10, { key: String(i), arriveAtMs: 1000 })));
    const frame = s.trafficAt(500);
    expect(frame.connections.get('call')?.forward).toBe(10_000);
    expect(frame.connections.size).toBeLessThanOrEqual(2);
    expect(JSON.stringify([...frame.connections]).length).toBeLessThan(2000);
  });

  it('holds the same traffic snapshot when playback is paused', () => {
    const s = make();
    s.ingestFlow([record('processing', 10), record('released', 100)]);
    s.setComputedEdge(200); s.seek(50);
    const before = s.trafficAt(s.playheadMs);
    s.advance(60_000);
    expect(s.trafficAt(s.playheadMs)).toEqual(before);
  });

  it('uses trailing simulation seconds for outcomes and replays their original rates after a seek', () => {
    const s = make();
    s.ingestFlow([record('outcome', 1000, { elementId: 'svc', trafficOutcome: 'error' }),
      record('outcome', 6000, { key: 'next', elementId: 'svc', trafficOutcome: 'error' }),
      record('outcome', 12000, { key: 'future', elementId: 'svc', trafficOutcome: 'success' })]);
    expect(s.trafficAt(7000).nodes.get('svc')?.outcomes).toContainEqual(expect.objectContaining({ kind: 'error', rate: 0.2 }));
    expect(s.trafficAt(11001).nodes.get('svc')?.outcomes).toContainEqual(expect.objectContaining({ kind: 'error', rate: 0.1 }));
    expect(s.trafficAt(17000).nodes.get('svc')?.outcomes?.some(v => v.kind === 'error')).toBe(false);
    expect(s.trafficAt(7000).nodes.get('svc')?.outcomes).toContainEqual(expect.objectContaining({ kind: 'error', rate: 0.2 }));
  });

  it('retains current processing across stream history eviction', () => {
    const s = make(1000);
    s.ingestFlow([record('processing', 10)]);
    s.setComputedEdge(3000); s.playing = true; s.advance(3000);
    expect(s.windowStartMs).toBe(2000);
    expect(s.trafficAt(2500).nodes.get('svc')?.processing).toBe(1);
    s.ingestFlow([record('released', 2800)]);
    expect(s.trafficAt(2900).nodes.get('svc')?.processing ?? 0).toBe(0);
  });
});

import type { TrafficNodeActivity, TrafficConnectionActivity, TrafficOutcomeKind } from '../../components/traffic/cells-and-lanes';
import type { FlowRecord } from '../../domain/studio/runner/types';
import type { PlaybackOptions } from './playback';

export type TrafficFrame = { nodes: ReadonlyMap<string, TrafficNodeActivity>; connections: ReadonlyMap<string, TrafficConnectionActivity> };
type State = { occupancy: Map<string, { node: string; phase: 'queued' | 'processing' }>; waits: Map<string, FlowRecord>; retries: Map<string, FlowRecord>; legs: Map<number, FlowRecord>; blocked: Map<string, FlowRecord>; noProgress: Map<string, FlowRecord>; outcomes: FlowRecord[]; outcomeCursor: number; outcomeCounts: Map<string, { record: FlowRecord; count: number }> };
const empty = (): State => ({ occupancy: new Map(), waits: new Map(), retries: new Map(), legs: new Map(), blocked: new Map(), noProgress: new Map(), outcomes: [], outcomeCursor: 0, outcomeCounts: new Map() });
const copy = (s: State): State => ({ occupancy: new Map(s.occupancy), waits: new Map(s.waits), retries: new Map(s.retries), legs: new Map(s.legs), blocked: new Map(s.blocked), noProgress: new Map(s.noProgress), outcomes: s.outcomes.slice(s.outcomeCursor), outcomeCursor: 0, outcomeCounts: new Map([...s.outcomeCounts].map(([k,v]) => [k, { ...v }])) });
const outcomeKey = (r: FlowRecord) => `${r.elementId ? `n:${r.elementId}` : `e:${r.connectionId}`}\u0000${r.trafficOutcome}`;
const kind = (outcome: FlowRecord['outcome']): TrafficOutcomeKind => outcome === 'succeeded' ? 'success' : outcome === 'rejected' ? 'rejected' : outcome === 'expired' ? 'expired' : 'error';

/** A separate presentation cursor preserves the legacy packet/flash API. Forward frames consume
 * only new facts; seeks reconstruct from a retained boundary checkpoint, never kernel state. */
export class TrafficIndex {
  private records: FlowRecord[] = [];
  private sorted = true;
  private cursor = 0;
  private at = -Infinity;
  private baseline = empty();
  private current = empty();
  constructor(private readonly options: PlaybackOptions) {}

  ingest(records: readonly FlowRecord[]): void {
    for (const r of records) {
      this.add(r);
      if (r.phase === 'settled' && r.outcome !== null) this.add({ ...r, phase: 'outcome', trafficOutcome: kind(r.outcome), connectionId: null });
      if (r.phase === 'sent' && r.arriveAtMs === null) this.add({ ...r, phase: 'outcome', trafficOutcome: 'lost', elementId: undefined });
      if (r.phase === 'response' && r.arriveAtMs !== null && r.outcome !== null && r.outcome !== 'succeeded') this.add({ ...r, atMs: r.arriveAtMs, phase: 'outcome', trafficOutcome: 'error', elementId: undefined });
    }
  }
  private add(r: FlowRecord): void {
    const last = this.records[this.records.length - 1];
    if (last && r.atMs < last.atMs) this.sorted = false;
    this.records.push(r);
    if (r.atMs <= this.at) this.reset();
  }
  private reset(): void { this.current = copy(this.baseline); this.cursor = 0; this.at = -Infinity; }
  private apply(r: FlowRecord, index: number): void {
    const s = this.current, owner = r.ownerKey ?? r.key, id = `${owner}\u0000${r.connectionId ?? ''}`;
    const node = r.elementId ?? (r.connectionId === null ? undefined : this.options.connectionTargets.get(r.connectionId));
    if ((r.phase === 'queued' || r.phase === 'processing' || r.phase === 'reserved') && node !== undefined) s.occupancy.set(r.key, { node, phase: r.phase === 'reserved' ? 'processing' : r.phase });
    if (r.phase === 'settled' && r.outcome !== 'succeeded') s.occupancy.delete(r.key);
    if (r.phase === 'slot_released') s.occupancy.delete(owner);
    if (r.phase === 'released') {
      s.noProgress.delete(r.key);
      s.occupancy.delete(r.key);
      for (const [key, v] of s.waits) if ((v.ownerKey ?? v.key) === r.key) s.waits.delete(key);
      for (const [key, v] of s.retries) if ((v.ownerKey ?? v.key) === r.key) s.retries.delete(key);
      for (const [key, v] of s.blocked) if ((v.ownerKey ?? v.key) === r.key) s.blocked.delete(key);
    }
    if (r.phase === 'await') {
      s.waits.set(id, r);
      if (node && this.options.nodeSlotHolds?.get(node) === false) s.occupancy.delete(owner);
    }
    if (r.phase === 'await_resolved') {
      if (r.connectionId === null) { for (const [key, v] of s.waits) if ((v.ownerKey ?? v.key) === owner) s.waits.delete(key); }
      else s.waits.delete(id);
    }
    if (r.phase === 'retry') { s.retries.set(id, r); if (r.connectionId === null) s.occupancy.delete(owner); }
    if (r.phase === 'sent' || r.phase === 'response') { if (r.arriveAtMs !== null) s.legs.set(index, r); }
    if (r.phase === 'blocked') s.blocked.set(id, r);
    if (r.phase === 'unblocked') s.blocked.delete(id);
    if (r.phase === 'no_progress') s.noProgress.set(owner, r);
    if (r.phase === 'outcome' && r.trafficOutcome) {
      s.outcomes.push(r);
      const k = outcomeKey(r), current = s.outcomeCounts.get(k);
      if (current) current.count++; else s.outcomeCounts.set(k, { record: r, count: 1 });
    }
  }
  private consume(at: number): void {
    if (!this.sorted) { this.records.sort((a, b) => a.atMs - b.atMs); this.sorted = true; this.reset(); }
    if (at < this.at) this.reset();
    while (this.cursor < this.records.length && this.records[this.cursor].atMs <= at) { this.apply(this.records[this.cursor], this.cursor); this.cursor++; }
    this.at = at;
    for (const [k, r] of this.current.legs) if (r.arriveAtMs! <= at) this.current.legs.delete(k);
    for (const [k, r] of this.current.retries) if (r.retryAtMs !== undefined && r.retryAtMs <= at) this.current.retries.delete(k);
    const s = this.current;
    while (s.outcomeCursor < s.outcomes.length && s.outcomes[s.outcomeCursor].atMs <= at - 10_000) {
      const k = outcomeKey(s.outcomes[s.outcomeCursor++]), entry = s.outcomeCounts.get(k);
      if (entry && --entry.count === 0) s.outcomeCounts.delete(k);
    }
    if (s.outcomeCursor > 2048 && s.outcomeCursor > s.outcomes.length / 2) { s.outcomes = s.outcomes.slice(s.outcomeCursor); s.outcomeCursor = 0; }
  }
  read(at: number): TrafficFrame {
    this.consume(at);
    const nodes = new Map<string, TrafficNodeActivity>(), connections = new Map<string, TrafficConnectionActivity>();
    const node = (id: string) => { let v = nodes.get(id); if (!v) { v = { queued: 0, processing: 0, capacity: this.options.nodeCapacities?.get(id) ?? 0, awaiting: 0, retry: 0 }; nodes.set(id, v); } return v; };
    const edge = (id: string) => { let v = connections.get(id); if (!v) { v = { forward: 0, returning: 0, asynchronous: this.options.connectionChannels?.get(id) === 'message' }; connections.set(id, v); } return v; };
    for (const id of this.options.nodeCapacities?.keys() ?? []) node(id);
    for (const { node: id, phase } of this.current.occupancy.values()) node(id)[phase === 'queued' ? 'queued' : 'processing']++;
    for (const r of this.current.waits.values()) {
      if (!r.elementId) continue;
      const n = node(r.elementId); n.awaiting++;
      const target = r.targetElementId ?? (r.connectionId ? this.options.connectionEndpoints?.get(r.connectionId)?.target ?? this.options.connectionTargets.get(r.connectionId) : undefined);
      const name = target ? this.options.nodeNames?.get(target) ?? target : 'External service';
      const service = (n.services ??= []).find(v => v.name === name);
      if (service) service.pending++; else n.services!.push({ name, pending: 1 });
      const stuck = this.current.noProgress.get(r.ownerKey ?? r.key);
      if (stuck) {
        const v = n.noProgress ??= { count: 0, service: name, age: `${Math.max(0, at - stuck.atMs)} ms since recording` };
        v.count++; if (v.service !== name) v.service = 'pending services';
      }
    }
    for (const r of this.current.retries.values()) if (r.elementId) {
      const n = node(r.elementId); n.retry++;
      if (r.retryAtMs !== undefined) { const remaining = `${Math.max(0, r.retryAtMs - at)} ms`; if (!n.retryIn || parseFloat(remaining) < parseFloat(n.retryIn)) n.retryIn = remaining; }
    }
    for (const r of this.current.legs.values()) if (r.connectionId) {
      const e = edge(r.connectionId); if (r.phase === 'sent') e.forward++; else { e.returning++; if (r.outcome && r.outcome !== 'succeeded') e.errors = (e.errors ?? 0) + 1; }
    }
    for (const r of this.current.blocked.values()) if (r.connectionId) { const e = edge(r.connectionId); e.blocked = (e.blocked ?? 0) + 1; }
    for (const { record: r, count } of this.current.outcomeCounts.values()) {
      // Explicit connection outcomes belong to the lane; local attempts belong to the node.
      const target = r.elementId ? node(r.elementId) : r.connectionId ? edge(r.connectionId) : null;
      if (!target || !r.trafficOutcome) continue;
      const list = target.outcomes ??= [];
      list.push({ kind: r.trafficOutcome, rate: count / 10 });
      if (r.connectionId && r.trafficOutcome === 'lost') edge(r.connectionId).loss = true;
      if (r.connectionId && r.trafficOutcome === 'redeliveryExhausted') edge(r.connectionId).exhausted = true;
    }
    return { nodes, connections };
  }
  evict(start: number): void {
    this.consume(start - 1);
    this.baseline = copy(this.current);
    // Baseline legs have independent negative keys after raw-array compaction.
    this.baseline.legs = new Map([...this.baseline.legs.values()].map((r, i) => [-i - 1, r]));
    this.records = this.records.filter(r => r.atMs >= start);
    this.reset();
  }
}

/**
 * Realism audit probes (specs/revamp/realism-audit.md, phase 1). Evidence, not a gate:
 * they print what the kernel does in a few familiar situations and assert nothing.
 * Skipped in the normal suite. Run:
 *   REALISM_PROBES=1 npx vitest run src/simulation/open/realism-probes.test.ts --silent=false
 */
import { describe, it as base } from 'vitest';
import type { ExecutionEdge, ExecutionNode } from '../../domain/execution';
import { defaultBehavior, defaultWorkload, defaultExecutionEdge } from '../../domain/behaviorDefaults';
import { OpenSimulation } from './kernel';

const it = (name: string, fn: () => void) => describe.skipIf(!process.env.REALISM_PROBES)('realism probe', () => base(name, fn));

type Kind = ExecutionNode['kind'];
const node = (id: string, kind: Kind, over: Record<string, unknown> = {}): ExecutionNode =>
  ({ id, kind, name: id, position: { x: 0, y: 0 }, behavior: { ...defaultBehavior(kind), ...over } as ExecutionNode['behavior'] });
const edge = (s: string, t: string, over: Partial<ExecutionEdge> = {}): ExecutionEdge => ({ ...defaultExecutionEdge(s, t), id: `${s}-${t}`, ...over });
function run(nodes: ExecutionNode[], edges: ExecutionEdge[], rate: number, duration: number, wlOver: Record<string, unknown> = {}, seed = 7) {
  const wl = { ...defaultWorkload(nodes[0].id), rate, ...wlOver };
  delete (wl as { intervalMs?: number }).intervalMs;
  const sim = new OpenSimulation({ executionVersion: 'open-system/1', nodes, edges, workloads: [wl as never], settings: { seed, duration } });
  return sim.advance(duration);
}
const show = (label: string, m: ReturnType<typeof run>) => {
  const r = m.roots;
  console.log(`${label}\n  roots gen=${r.generated} ok=${r.succeeded} rej=${r.rejected} fail=${r.failed} exp=${r.expired} thr=${r.throughput.toFixed(2)}/s mean=${(r.meanLatency).toFixed(3)} p95=${r.p95Latency.toFixed(3)}`);
  for (const [id, n] of Object.entries(m.nodes)) console.log(`  ${id}: arrived=${n.arrived} done=${n.completed} rej=${n.rejected} fail=${n.failed} exp=${n.expired} retries=${n.retries} util=${n.utilization.toFixed(2)}`);
};

it('E0 defaults', () => {
  for (const k of ['service', 'gateway', 'database', 'client', 'worker', 'queue', 'traffic'] as Kind[]) console.log(k, JSON.stringify(defaultBehavior(k)));
  console.log('call edge', JSON.stringify(defaultExecutionEdge('a', 'b')));
  console.log('workload', JSON.stringify({ ...defaultWorkload('x'), id: undefined, classes: undefined }));
});
it('E1 service time distribution (rho 0.8, S=100ms): M/D/1 W=0.300, M/M/1 W=0.500 p95=1.498', () => {
  const m = run([node('src', 'traffic'), node('svc', 'service', { capacity: 10, concurrency: 1, queueLimit: 10000 })], [edge('src', 'svc')], 8, 300, { timeoutMs: 3600000 });
  show('E1', m);
});
it('E2 gateway holds its slot while waiting downstream (defaults, 50 ms links, backend 200/s)', () => {
  const m = run([node('src', 'traffic'), node('gw', 'gateway'), node('svc', 'service', { capacity: 10, concurrency: 16 })],
    [edge('src', 'gw'), edge('gw', 'svc', { latencyMs: 50, returnLatencyMs: 50 })], 50, 60);
  show('E2', m);
});
it('E3 client node in the path (defaults, 50 ms link)', () => {
  const m = run([node('src', 'traffic'), node('cli', 'client'), node('svc', 'service', { capacity: 10, concurrency: 16 })],
    [edge('src', 'cli'), edge('cli', 'svc', { latencyMs: 50, returnLatencyMs: 50 })], 50, 60);
  show('E3', m);
});
it('E4 retries do not react to overload rejections', () => {
  const m = run([node('src', 'traffic'), node('svc', 'service', { capacity: 10, concurrency: 1, queueLimit: 5, maxRetries: 3 })], [edge('src', 'svc')], 20, 60);
  show('E4', m);
});
it('E5 queue absorbing a burst: message TTL default', () => {
  const m = run([node('src', 'traffic'), node('api', 'service'), node('q', 'queue'), node('wk', 'worker', { capacity: 10, concurrency: 2 })],
    [edge('src', 'api'), edge('api', 'q', { transport: 'message' }), edge('q', 'wk', { transport: 'message' })], 60, 20);
  show('E5', m);
  console.log('  message edge defaults', JSON.stringify(defaultExecutionEdge('a', 'b')));
});
it('E6 database default concurrency 1 vs read+write mix', () => {
  const m = run([node('src', 'traffic'), node('svc', 'service', { concurrency: 16 }), node('db', 'database')], [edge('src', 'svc'), edge('svc', 'db')], 450, 60);
  show('E6', m);
});
it('E1b M/D/1 over 8 seeds', () => {
  const ws: number[] = []; const p: number[] = [];
  for (let s = 1; s <= 8; s++) { const m = run([node('src', 'traffic'), node('svc', 'service', { capacity: 10, concurrency: 1, queueLimit: 10000 })], [edge('src', 'svc')], 8, 300, { timeoutMs: 3600000 }, s); ws.push(m.roots.meanLatency); p.push(m.roots.p95Latency); }
  console.log('E1b mean W per seed', ws.map((x) => x.toFixed(3)).join(' '), ' p95', p.map((x) => x.toFixed(3)).join(' '));
});
it('E2b gateway concurrency 16 at the cap', () => {
  const m = run([node('src', 'traffic'), node('gw', 'gateway', { concurrency: 16 }), node('svc', 'service', { capacity: 10, concurrency: 16 })],
    [edge('src', 'gw'), edge('gw', 'svc', { latencyMs: 50, returnLatencyMs: 50 })], 150, 60);
  show('E2b', m);
});

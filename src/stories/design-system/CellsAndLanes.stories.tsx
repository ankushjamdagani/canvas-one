import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CellsAndLanesNode, CellsAndLanesConnection, type TrafficNodeActivity, type TrafficConnectionActivity, type TrafficOutcomeKind, type TrafficOutcome } from '@/components/traffic';

const nodeStates = ['Idle', 'Processing', 'At capacity', 'Queued', 'Awaiting responses', 'Multiple downstreams', 'Retry scheduled', 'Simultaneous activity', 'No progress'];
const connectionStates = ['Idle', 'Forward request', 'Returning response', 'Both directions', 'Async message', 'Acknowledgement', 'Blocked', 'Error response', 'Late return', 'Delivery loss', 'Delivery exhausted'];
const outcomeStates: [TrafficOutcomeKind, string, string][] = [
  ['success', 'Success', 'Completed work, recorded at its completion location.'],
  ['error', 'Processing error', 'Local work failed; record at the processing node.'],
  ['rejected', 'Admission rejected', 'Work was refused before local processing.'],
  ['timeout', 'Caller timeout', 'The caller stopped waiting when its deadline passed.'],
  ['expired', 'Expired', 'Work exceeded its lifetime at the location holding it.'],
  ['cancelled', 'Cancelled', 'Recorded cancellation, separate from failure.'],
  ['retryExhausted', 'Retry exhausted', 'No more attempts; recorded at the scheduling caller.'],
  ['redeliveryExhausted', 'Redelivery exhausted', 'Message delivery attempts ended; recorded at delivery scope.'],
  ['lost', 'Delivery lost', 'Transport failed to deliver work; record on the connection.'],
  ['late', 'Late return', 'A response arrived after the caller stopped waiting; it does not reopen the wait.'],
];
function rateAt(t: number) { return t < 4 ? 1 : t < 10 ? 1500 : t < 15 ? 4000 + Math.floor(t) % 3 * 500 : t < 20 ? (20 - t) * 500 : 0; }
function nodeActivity(state: string, rate: number, recorded: number): TrafficNodeActivity {
  const active = rate > 0, high = rate > 50, mixed = state === 'Simultaneous activity';
  const a: TrafficNodeActivity = { queued: 0, processing: 0, capacity: 8, awaiting: 0, retry: 0, outcomes: recorded ? [{ kind: 'success', rate: Math.round(recorded * .9) }] : [] };
  if (active) {
    if (['Processing', 'At capacity', 'Queued'].includes(state) || mixed) a.processing = state === 'Processing' ? high ? 6 : 3 : 8;
    if (state === 'Queued' || mixed) a.queued = high ? Math.round(rate * .02) : 1;
    if (['Awaiting responses', 'Multiple downstreams', 'No progress'].includes(state) || mixed) {
      a.awaiting = high ? Math.round(rate * .12) : 6;
      const multiple = state === 'Multiple downstreams' || mixed;
      a.services = multiple ? [{ name: 'Payment', pending: Math.ceil(a.awaiting * .7) }, { name: 'Inventory', pending: a.awaiting - Math.ceil(a.awaiting * .7) }] : [{ name: 'Payment', pending: a.awaiting }];
    }
    if (state === 'Retry scheduled' || mixed) { a.retry = high ? Math.round(rate * .025) : 3; a.retryIn = '250 ms'; }
    if (state === 'No progress' || mixed) a.noProgress = { count: high ? 2 : 1, service: 'Payment', age: '3 s' };
  }
  return a;
}
function connectionActivity(state: string, rate: number, recorded: number): TrafficConnectionActivity {
  const n = rate > 50 ? Math.round(rate * .08) : rate ? 3 : 0;
  const a: TrafficConnectionActivity = { forward: 0, returning: 0 };
  if (['Forward request', 'Both directions', 'Async message', 'Blocked'].includes(state)) a.forward = n;
  if (['Returning response', 'Both directions', 'Acknowledgement', 'Error response', 'Late return'].includes(state)) a.returning = n;
  a.asynchronous = ['Async message', 'Acknowledgement', 'Delivery exhausted'].includes(state);
  if (state === 'Blocked') a.blocked = n;
  if (state === 'Error response') a.errors = n ? Math.max(1, Math.round(n * .1)) : 0;
  if (state === 'Late return') a.late = n ? 1 : 0;
  if (state === 'Delivery loss') { a.loss = !!rate; a.outcomes = [{ kind: 'lost', rate: recorded * .02 }]; }
  if (state === 'Delivery exhausted') { a.exhausted = !!rate; a.outcomes = [{ kind: 'redeliveryExhausted', rate: recorded * .01 }]; }
  return a;
}

function Fundamentals() {
  const [load, setLoad] = useState('low'), [time, setTime] = useState(0), [playing, setPlaying] = useState(true), [motion, setMotion] = useState(true);
  const [progress, setProgress] = useState(.4), [reduced, setReduced] = useState(false), [connection, setConnection] = useState('Forward request'), [outcome, setOutcome] = useState<TrafficOutcomeKind>('error');
  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => { if (load !== 'live' || !playing || time >= 32) return; const timer = setInterval(() => setTime(t => Math.min(32, t + .25)), 250); return () => clearInterval(timer); }, [load, playing, time >= 32]);
  useEffect(() => { if (!motion || reduced || load === 'live' && (!playing || time >= 32)) return; const timer = setInterval(() => setProgress(p => (p + .018) % 1), 50); return () => clearInterval(timer); }, [motion, reduced, playing, load, time >= 32]);
  const rate = load === 'live' ? rateAt(time) : load === 'high' ? 5000 : 1;
  // Integrate a fixed trailing ten-second cohort, not the viewport or zoom.
  const recorded = load === 'live' ? Math.round(Array.from({ length: 40 }, (_, i) => Math.max(0, time - i * .25)).reduce((sum, t, i) => sum + (time - i * .25 < 0 ? 0 : rateAt(t)), 0) / 40) : rate;
  const selectedOutcome = outcomeStates.find(o => o[0] === outcome)!;
  const detail: TrafficOutcome = { kind: outcome, rate: Math.round(recorded * .1 * 10) / 10, detail: selectedOutcome[2] };
  const caller = nodeActivity('Simultaneous activity', rate, recorded);
  caller.outcomes = outcomeStates.filter(o => !['lost','late','redeliveryExhausted'].includes(o[0])).map(([kind], i) => ({ kind, rate: Math.round(recorded * (i ? .01 : .9) * 10) / 10 }));
  const paymentPending = caller.services?.find(s => s.name === 'Payment')?.pending ?? 0;
  const transport: TrafficConnectionActivity = { forward: paymentPending ? Math.max(1, Math.floor(paymentPending * .15)) : 0, returning: paymentPending ? Math.max(1, Math.floor(paymentPending * .15)) : 0, errors: paymentPending ? 1 : 0, late: rate ? 1 : 0, blocked: paymentPending ? Math.min(14, Math.max(1, Math.floor(paymentPending * .05))) : 0, outcomes: [{ kind: 'lost', rate: recorded * .01 }, { kind: 'redeliveryExhausted', rate: recorded * .004 }, { kind: 'late', rate: recorded * .009 }] };
  const payment = nodeActivity('Idle', 0, recorded);
  payment.processing = paymentPending ? Math.min(8, Math.max(1, paymentPending - transport.forward - transport.returning - (transport.blocked ?? 0))) : 0;
  payment.queued = Math.max(0, paymentPending - transport.forward - transport.returning - (transport.blocked ?? 0) - payment.processing);
  return <main className="mx-auto min-h-screen max-w-5xl bg-shell p-4 text-ink">
    <header className="border-b border-divider pb-3"><div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-lg font-semibold">Cells and lanes</h1><p className="mt-1 text-xs text-secondary-text">Current populations in cells. Transport on lanes. Recorded outcomes in trays.</p></div><Segmented aria-label="Traffic load" options={['Low traffic','High traffic','Live traffic']} value={load === 'low' ? 'Low traffic' : load === 'high' ? 'High traffic' : 'Live traffic'} onChange={v => { setLoad(v === 'Low traffic' ? 'low' : v === 'High traffic' ? 'high' : 'live'); setTime(0); setPlaying(true); }} /></div>
      <label className="mt-3 flex items-center gap-2 text-xs"><Switch checked={motion} onCheckedChange={setMotion} />Motion{reduced && ' · reduced by device preference'}</label>
    </header>
    {load === 'live' && <div className="flex flex-wrap items-center gap-2 border-b border-divider py-2"><Button size="icon" variant="ghost" aria-label={playing && time < 32 ? 'Pause traffic' : 'Play traffic'} onClick={() => { if (time >= 32) { setTime(0); setPlaying(true); } else setPlaying(v => !v); }}>{playing && time < 32 ? <Pause /> : <Play />}</Button><Button size="icon" variant="ghost" aria-label="Restart traffic" onClick={() => { setTime(0); setPlaying(true); }}><RotateCcw /></Button><input type="range" aria-label="Traffic playhead" min={0} max={32} step={.25} value={time} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} className="min-w-24 flex-1" /><span className="text-xs font-mono">{time.toFixed(2)} s · {rate.toLocaleString()}/s</span></div>}
    <section className="py-4"><h2 className="text-sm font-semibold">Fundamentals</h2><p className="mt-2 max-w-prose text-xs text-secondary-text">Cells always keep their position: queued, processing, awaiting responses, retry scheduled. Counts describe separate work. Processing shows occupied slots. Awaiting responses counts outstanding calls; service dots count pending downstreams. No progress requires recorded evidence.</p><p className="mt-2 max-w-prose text-xs text-secondary-text">Forward work travels above the line; returns below. Filled chevrons are requests, hollow chevrons responses; purple squares are messages and hollow squares ACKs. Clay diamonds mark error returns; dashed rings mark late returns. Dense traffic uses a bounded aggregate band. Stop bars hold blocked work at the sender.</p><p className="mt-2 max-w-prose text-xs text-secondary-text">Trays show events per second over the last 10 simulation seconds. They can remain after current work reaches zero. Zoom changes neither counts nor rates. Hover, focus or tap to inspect; click or Enter pins, Escape releases. Transitions and historical totals remain future scope.</p></section>
    <section className="border-t border-divider py-4"><h2 className="text-sm font-semibold">Node states</h2><div className="mt-3 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))' }}>{nodeStates.map(state => <div key={state} data-node-state={state} className="min-w-0"><h3 className="mb-3 text-xs font-medium">{state}</h3><div style={{ minHeight: 110 }}><CellsAndLanesNode label="Checkout API" activity={nodeActivity(state, rate, state === 'Idle' ? 0 : recorded)} /></div></div>)}</div></section>
    <section className="border-t border-divider py-4"><h2 className="text-sm font-semibold">Connection states</h2><div className="my-3 flex flex-wrap gap-2"><label className="text-xs">State <select aria-label="Connection state" className="ml-2 rounded border border-divider bg-shell p-1" value={connection} onChange={e => setConnection(e.target.value)}>{connectionStates.map(s => <option key={s}>{s}</option>)}</select></label></div><div className="overflow-x-auto" style={{ paddingBottom: 12 }}><CellsAndLanesConnection activity={connectionActivity(connection, rate, recorded)} progress={progress} reducedMotion={reduced || !motion} label={['Async message','Delivery exhausted'].includes(connection) ? 'message · AMQP' : connection === 'Acknowledgement' ? 'ACK · AMQP' : 'call · HTTP / REST'} /></div><p className="text-xs text-secondary-text">Error returns belong to returning traffic. Late returns answer closed waits. Blocked and moving work are different populations; lost or exhausted delivery is terminal.</p></section>
    <section className="border-t border-divider py-4"><h2 className="text-sm font-semibold">Outcomes and placement</h2><label className="my-3 block text-xs">Outcome <select aria-label="Recorded outcome" className="ml-2 rounded border border-divider bg-shell p-1" value={outcome} onChange={e => setOutcome(e.target.value as TrafficOutcomeKind)}>{outcomeStates.map(([id,name]) => <option value={id} key={id}>{name}</option>)}</select></label><p className="mb-3 text-xs text-secondary-text">{selectedOutcome[2]}</p><div style={{ minHeight: 120 }}>{['lost','late','redeliveryExhausted'].includes(outcome) ? <CellsAndLanesConnection activity={{ forward: 0, returning: 0, outcomes: [detail] }} /> : <CellsAndLanesNode label={['timeout','retryExhausted'].includes(outcome) ? 'Caller' : 'Recorded location'} activity={{ queued: 0, processing: 0, capacity: 8, awaiting: 0, retry: 0, outcomes: [detail] }} />}</div></section>
    <section className="border-t border-divider py-4"><h2 className="text-sm font-semibold">Simultaneous activity</h2><p className="mt-1 text-xs text-secondary-text">Different work occupies each cell and lane. Payment’s pending calls equal blocked + forward + queued + processing + returning. Error returns are a subset; late returns do not count toward open waits.</p><div className="mt-3 overflow-x-auto"><div className="flex items-start" style={{ minWidth: 800, padding: '28px 12px', minHeight: 520 }}><CellsAndLanesNode label="Checkout API" activity={caller} /><CellsAndLanesConnection activity={transport} progress={progress} reducedMotion={reduced || !motion} width={340} /><CellsAndLanesNode label="Payment service" activity={payment} /></div></div></section>
    <section className="border-t border-divider py-4"><h2 className="text-sm font-semibold">Import and use</h2><pre className="mt-2 overflow-x-auto rounded bg-sunken p-3 text-xs">{`import { CellsAndLanesNode, CellsAndLanesConnection } from '@/components/traffic';

<CellsAndLanesNode label="Payment" activity={activity} />
<CellsAndLanesConnection activity={transport} progress={progress} />`}</pre><p className="mt-2 text-xs text-secondary-text">Supply current populations, capacity, pending services and trailing 10-second outcome rates. Drive progress from playback and freeze it when paused. Set reducedMotion for still directional cues. Components own no simulation clock or data aggregation. The existing design is exported from the same module as CurrentTrafficNode and CurrentTrafficConnection, with its context providers and styles.</p><p className="mt-2 text-xs text-secondary-text">All examples use illustrative data. Production workspace wiring is unchanged.</p></section>
  </main>;
}
const meta = { title: 'Design System/Cells and lanes', component: Fundamentals, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof Fundamentals>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Guide: Story = {};

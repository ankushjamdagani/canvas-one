import { useEffect, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Row = { label: string; value: string; tone: 'work' | 'wait' | 'queue' | 'error'; ratio?: number };
export type LiveFrame = { caller: Row[]; receiver: Row[]; forward: number; backward: number; summary: string };
const names = ['Idle', 'Travelling', 'Queued work', 'Processing', 'Awaiting responses', 'Response delivery', 'Asynchronous work', 'Failure / rejection', 'Retry', 'Deadline', 'Expiry / loss', 'Admission', 'Error response', 'Acknowledgement / redelivery', 'Recorded stuck work', 'Concurrent populations', 'Late response / cancellation', 'Retries exhausted'];

// Illustrative frames, not a simulation or measured runner output. Rates use a fixed
// one-second sample; counts are current populations and never cumulative totals.
function frameFor(state: number, time: number, peak: number): LiveFrame {
  const sample = Math.floor(time);
  const load = sample < 4 ? 1 / peak : sample < 10 ? 0.35 + 0.05 * Math.sin(sample * 2) : sample < 15 ? 0.85 + 0.15 * Math.sin(sample * 3) : sample < 20 ? (20 - sample) / 5 : 0;
  const rate = load > 0 ? Math.max(1, Math.round(peak * load)) : 0;
  const count = rate ? Math.max(1, Math.round(rate * 0.12)) : 0;
  const queued = rate ? Math.min(100, Math.round(count * 0.7)) : 0;
  const processing = Math.min(4, count);
  const row = (label: string, value: number, tone: Row['tone'], suffix = '', ratio?: number): Row[] => value > 0 ? [{ label, value: `${value.toLocaleString()}${suffix}`, tone, ratio }] : [];
  const wait = (n = count) => row('Awaiting responses', n, 'wait');
  const work = () => row('Processing', processing, 'work', ' / 4 slots', processing / 4);
  const queue = () => row('Queued', queued, 'queue', ' / 100', queued / 100);
  const eventRate = (label: string, tone: Row['tone'] = 'work', fraction = 1) => row(label, Math.max(rate ? 1 : 0, Math.round(rate * fraction)), tone, '/s');
  let caller: Row[] = [], receiver: Row[] = [], forward = 0, backward = 0;
  switch (state) {
    case 0: break;
    case 1: caller = wait(count * 2); forward = rate; backward = Math.round(rate * 0.8); break;
    case 2: caller = wait(queued + processing); receiver = [...queue(), ...work()]; break;
    case 3: caller = wait(processing); receiver = work(); break;
    case 4: caller = wait(); receiver = [...wait(), ...row('Fraud · pending calls', count, 'wait'), ...row('Orders · pending calls', Math.ceil(count / 2), 'wait')]; break;
    case 5: caller = [...wait(), ...eventRate('Responses delivered')]; backward = rate; break;
    case 6: receiver = [...work(), ...queue(), ...eventRate('Messages settled')]; forward = rate; break;
    case 7: receiver = [...work(), ...eventRate('Processing failures', 'error', 0.08), ...eventRate('Rejected', 'error', 0.03)]; forward = rate; break;
    case 8: caller = [...row('Retries scheduled', count, 'queue'), ...eventRate('Retry attempts', 'queue', 0.1)]; forward = Math.round(rate * 0.1); break;
    case 9: caller = eventRate('Deadlines elapsed', 'error', 0.05); receiver = work(); break;
    case 10: receiver = [...queue(), ...eventRate('TTL expiries', 'error', 0.05)]; break;
    case 11: caller = wait(queued + processing); receiver = [...queue(), ...work(), ...eventRate('Admitted')]; forward = rate; break;
    case 12: caller = [...wait(), ...eventRate('Error responses delivered', 'error', 0.08)]; backward = Math.round(rate * 0.08); break;
    case 13: caller = [...row('Unacknowledged messages', count, 'wait'), ...eventRate('Redeliveries', 'queue', 0.04)]; backward = rate; forward = Math.round(rate * 0.04); break;
    case 14: caller = wait(); receiver = row('Recorded blocked calls', count, 'error'); break;
    case 15: caller = wait(count + queued + processing); receiver = [...work(), ...queue(), ...wait()]; forward = rate; backward = Math.round(rate * 0.9); break;
    case 16: caller = eventRate('Late responses ignored', 'queue', 0.05); receiver = work(); backward = Math.round(rate * 0.05); break;
    case 17: caller = eventRate('Retries exhausted', 'error', 0.03); break;
  }
  const phase = time < 4 ? 'Sparse' : time < 10 ? 'Sustained' : time < 15 ? 'Burst' : time < 20 ? 'Draining' : 'Idle';
  if (time >= 15) forward = 0;
  return { caller, receiver, forward, backward, summary: `${phase} · ${state === 0 || time >= 15 ? 0 : rate.toLocaleString()} requests/s offered` };
}

export function StateLoadExample({ state, renderCanvas, children }: { state: number; renderCanvas: (frame: LiveFrame, progress: number) => ReactNode; children: ReactNode }) {
  const [live, setLive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [peak, setPeak] = useState(1000);
  const [direction, setDirection] = useState('forward');
  const [progress, setProgress] = useState(0.4);
  useEffect(() => {
    if (!live || !playing || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setProgress(p => (p + 0.015) % 1), 50);
    return () => clearInterval(timer);
  }, [live, playing]);
  useEffect(() => {
    if (!live || !playing) return;
    const timer = window.setInterval(() => setTime(t => Math.min(24, t + 0.25)), 250);
    return () => window.clearInterval(timer);
  }, [live, playing]);
  useEffect(() => { if (time >= 24) setPlaying(false); }, [time]);
  const frame = frameFor(state, time, peak);
  if (state === 1 && direction === 'forward') frame.backward = 0;
  if (state === 1 && direction === 'backward') frame.forward = 0;
  return <div className="border-b border-divider py-2" data-live-state={state + 1}>
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`${names[state]} example mode`}>
      <Button size="sm" variant={!live ? 'tint' : 'ghost'} aria-pressed={!live} onClick={() => { setLive(false); setPlaying(false); }}>Static frame</Button>
      <Button size="sm" variant={live ? 'tint' : 'ghost'} aria-pressed={live} onClick={() => { setLive(true); setPlaying(true); }}>Live load</Button>
    </div>
    {!live ? children : <section className="py-3">
      <h2 className="text-sm font-semibold">{String(state + 1).padStart(2, '0')} · {names[state]} under load</h2>
      <div className="my-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" aria-label={playing ? 'Pause live load' : 'Play live load'} onClick={() => { if (time >= 24) setTime(0); setPlaying(!playing); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>
        <Button size="sm" variant="ghost" aria-label="Restart live load" onClick={() => setTime(0)}><RotateCcw size={16} /></Button>
        <label className="text-xs">Peak <select className="border border-divider rounded px-2 py-1 bg-transparent" value={peak} onChange={event => setPeak(Number(event.target.value))}><option value={1000}>1,000/s</option><option value={5000}>5,000/s</option></select></label>
        <span className="text-xs font-mono">{time.toFixed(2)} s · {frame.summary}</span>
      </div>
      <label className="flex items-center gap-3 text-xs">Playhead <input aria-label={`${names[state]} load playhead`} className="min-w-0 flex-1" style={{ accentColor: 'var(--color-primary)' }} type="range" min="0" max="24" step="0.25" value={time} onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }} /></label>
      {state === 1 && <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Live transport direction">{['forward', 'backward', 'dual'].map(value => <Button key={value} size="sm" variant={direction === value ? 'tint' : 'ghost'} aria-pressed={direction === value} onClick={() => setDirection(value)}>{value === 'forward' ? 'Requests →' : value === 'backward' ? 'Responses ←' : 'Both directions'}</Button>)}</div>}
      <p className="mt-2 text-xs font-mono">{state === 6 ? 'Messages' : state === 13 ? 'Redeliveries' : 'Requests'} → {frame.forward.toLocaleString()}/s · {state === 13 ? 'Acknowledgements' : 'Responses'} ← {frame.backward.toLocaleString()}/s</p>
      {renderCanvas(frame, progress)}
      <p className="mt-2 text-xs text-secondary-text">Illustrative load fixture · sparse → sustained → burst → drain → idle. Rates use fixed one-second samples; footers show current populations. Repeated events update rates without per-request flashes. Hover a node for capacity details.</p>
      <p className="mt-1 text-xs text-secondary-text">{state === 0 ? 'Idle stays visually quiet, including after earlier traffic.' : state === 14 ? 'Blocked calls are explicitly recorded; silence alone never implies a stuck request.' : 'Motion shows direction, not request count. Current activity clears at idle; earlier events belong in historical inspection.'}</p>
    </section>}
  </div>;
}

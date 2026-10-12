import type { Meta, StoryObj } from '@storybook/react-vite';
import { createContext, useContext, useEffect, useId, useState } from 'react';
import { ReactFlow, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type EdgeProps, type NodeProps } from '@canvas-one/editor-reactflow/react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { PlaybackTrafficContext } from '@/features/workspace/usePlaybackTraffic';
import {
  ExampleContext, ExampleNode, ExampleEdge, CurrentPopulationContext, PendingContext, TrafficVisualStyles, FitIdleCanvas,
  idleNodes, idleEdges, fanoutNodes, fanoutEdges, nodeTypes, exampleNodeTypes, pendingNodeTypes, pendingEdgeTypes,
  type TravelDirection,
} from '../shared/traffic-visuals';

type Activity = 'idle' | 'queued' | 'processing' | 'awaiting' | 'combined' | 'retry';
const activities: { state: Activity; label: string; guide: string }[] = [
  { state: 'idle', label: 'Idle', guide: 'No current work. No footer.' },
  { state: 'queued', label: 'Queued', guide: 'Waiting for local capacity.' },
  { state: 'processing', label: 'Processing', guide: 'Occupied local processing slots.' },
  { state: 'awaiting', label: 'Awaiting responses', guide: 'Outstanding synchronous calls.' },
  { state: 'combined', label: 'Concurrent activity', guide: 'Separate populations can coexist.' },
  { state: 'retry', label: 'Retry scheduled', guide: 'Waiting for the next eligible attempt.' },
];
const outcomes = [
  ['Success', 'Work completed successfully.'],
  ['Error', 'Unsuccessful work; inspect the cause.'],
  ['Timeout', 'Response deadline elapsed; downstream work may continue.'],
  ['Expired', 'Work lifetime elapsed; remove it from the queue.'],
  ['Cancelled', 'Cancellation took effect; a request alone is insufficient.'],
] as const;

type LoadFrame = { rate: number; queued: number; processing: number; awaiting: number; retry: number; phase: string };
// Independent illustrative specimens, not one measured run. Counts are current;
// outcome rates use fixed one-second samples and do not depend on canvas zoom.
function loadFrame(mode: string, time: number): LoadFrame {
  const second = Math.floor(time);
  const phase = second < 4 ? 'Sparse' : second < 10 ? 'Sustained' : second < 15 ? 'Burst' : second < 20 ? 'Drain' : 'Idle';
  const rate = mode === 'low' ? 1 : mode === 'high' ? 5000 : second < 4 ? 1 : second < 10 ? 1500 + second % 3 * 250 : second < 15 ? 4000 + second % 3 * 500 : second < 20 ? (20 - second) * 500 : 0;
  return { rate, queued: rate ? Math.min(100, Math.max(1, Math.round(rate * 0.02))) : 0, processing: Math.min(4, rate), awaiting: Math.round(rate * 0.12) || (rate ? 1 : 0), retry: Math.round(rate * 0.025) || (rate ? 1 : 0), phase };
}

const failureExamples = [
  { id: 'processing', label: 'Processing error', scope: 'Receiver', note: 'Execution failed. Other work can continue on the same node.', fraction: 0.035 },
  { id: 'rejection', label: 'Admission rejection', scope: 'Receiver', note: 'Work was refused before processing; it does not join the queue.', fraction: 0.015 },
  { id: 'loss', label: 'Delivery loss', scope: 'Connection', note: 'Recorded transport loss. The lost work is no longer travelling.', fraction: 0.01 },
  { id: 'response', label: 'Error response', scope: 'Return transport', note: 'An error is returning. The caller awaits it until delivery.', fraction: 0.06 },
  { id: 'retry', label: 'Retries exhausted', scope: 'Caller', note: 'Final error outcome. No further attempt is scheduled for this work.', fraction: 0.008 },
  { id: 'redelivery', label: 'Redeliveries exhausted', scope: 'Message delivery', note: 'Delivery policy ended unsuccessfully; no synchronous response wait.', fraction: 0.006 },
  { id: 'late', label: 'Late response', scope: 'Return transport', note: 'Returning after timeout. It does not reopen the caller’s wait.', fraction: 0.004 },
  { id: 'stuck', label: 'Recorded stuck work', scope: 'Waiting work', note: 'Explicit no-progress evidence. Silence alone is not enough.', fraction: 0 },
  { id: 'timeout', label: 'Timeout', scope: 'Caller', note: 'Response deadline elapsed; downstream work may continue.', fraction: 0.02 },
  { id: 'expiry', label: 'Expired', scope: 'Receiver', note: 'Work lifetime elapsed; expired work leaves the queue.', fraction: 0.01 },
  { id: 'cancelled', label: 'Cancelled', scope: 'Receiver', note: 'Cancellation took effect at this node.', fraction: 0.01 },
] as const;
type FailureId = typeof failureExamples[number]['id'];
const FailureContext = createContext<{ kind: FailureId; frame: LoadFrame; metric: string }>({ kind: 'processing', frame: loadFrame('low', 0), metric: '1 event' });
function FailureNode(props: NodeProps) {
  const { kind, frame, metric } = useContext(FailureContext);
  const definition = failureExamples.find(item => item.id === kind)!;
  const returning = kind === 'response';
  const caller = props.id === 'idle-0';
  const awaiting = frame.rate && caller && (returning || kind === 'stuck') ? returning ? Math.max(1, Math.round(frame.awaiting * 0.06)) : frame.awaiting : 0;
  const processing = !caller && !['loss','late','response','stuck'].includes(kind) ? frame.processing : 0;
  const onNode = !['loss', 'redelivery', 'response', 'late'].includes(kind);
  const onCaller = ['timeout', 'retry', 'stuck'].includes(kind);
  const show = frame.rate > 0 && onNode && caller === onCaller;
  return <CurrentPopulationContext.Provider value={{ processing, queued: kind === 'expiry' && !caller ? frame.queued : 0, awaiting,
    outcome: show ? { label: kind === 'stuck' ? 'No progress recorded' : kind === 'timeout' ? 'Timeouts' : kind === 'cancelled' ? 'Cancelled' : kind === 'expiry' ? 'Expired' : 'Errors', metric, detail: definition.label, waiting: kind === 'stuck' } : undefined,
  }}><ExampleNode {...props} /></CurrentPopulationContext.Provider>;
}
const failureNodeTypes = { element: FailureNode };
function FailureEdge(props: EdgeProps) {
  const { kind, frame, metric } = useContext(FailureContext);
  const definition = failureExamples.find(item => item.id === kind)!;
  const transport = ['loss', 'redelivery', 'response', 'late'].includes(kind);
  const [, x, y] = getSmoothStepPath(props);
  return <><ExampleEdge {...props} />{transport && frame.rate > 0 && <EdgeLabelRenderer><div data-connection-outcome="" className="nodrag nopan absolute rounded border border-divider bg-shell px-2 py-1 text-xs" tabIndex={0} title={definition.note} style={{ pointerEvents: 'auto', color: kind === 'late' ? 'var(--color-secondary-text)' : 'var(--color-danger, #B91C1C)', transform: `translate(-50%, 0) translate(${x}px,${y + 12}px)` }}>{definition.label} · {metric}<div className="connection-outcome-detail mt-1 max-w-48 text-secondary-text">{definition.note}</div></div></EdgeLabelRenderer>}</>;
}
const failureEdgeTypes = { traffic: FailureEdge };
const BusyContext = createContext({ frame: loadFrame('high', 0), progress: 0.4, mode: 'high' });
function BusyNode(props: NodeProps) {
  const { frame, mode } = useContext(BusyContext);
  const busy = frame.rate > 0;
  const caller = props.id === 'idle-0';
  const payment = props.id === 'idle-1';
  const orders = props.id === 'idle-3';
  const rate = (fraction: number) => mode === 'low' ? '1 event' : `${Math.round(frame.rate * fraction).toLocaleString()}/s`;
  return <CurrentPopulationContext.Provider value={{
    processing: busy ? 4 : 0,
    queued: busy ? orders || caller ? frame.queued : payment ? Math.ceil(frame.queued / 2) : 0 : 0,
    awaiting: busy && (caller || payment) ? frame.awaiting : 0,
    services: caller ? [{ name: 'Payment service', count: frame.awaiting }] : [{ name: 'Fraud check', count: Math.ceil(frame.awaiting / 2) }, { name: 'Orders service', count: Math.floor(frame.awaiting / 2) }],
    retries: busy && caller ? frame.retry : 0,
    stuck: busy && caller ? Math.max(1, Math.round(frame.awaiting * 0.02)) : 0,
    outcome: busy ? { label: caller ? 'Outcomes' : 'Errors', metric: rate(caller ? 0.02 : 0.04), items: caller ? [{ label: 'Success', metric: rate(0.9) }, { label: 'Errors', metric: rate(0.04) }, { label: 'Timeouts', metric: rate(0.02) }, { label: 'Expired', metric: rate(0.01) }, { label: 'Cancelled', metric: rate(0.01) }] : undefined, detail: caller ? `Processing errors, admission rejection and exhausted retries contribute to errors. All rows are one-second outcome samples.` : orders ? `Expired: ${rate(0.01)} · Cancelled: ${rate(0.01)}` : `Processing errors: ${rate(0.025)} · Rejections: ${rate(0.015)}` } : undefined,
  }}><ExampleNode {...props} /></CurrentPopulationContext.Provider>;
}
function BusyEdge(props: EdgeProps) {
  const { frame, progress, mode } = useContext(BusyContext);
  const defaults = useContext(ExampleContext);
  const blocked = props.id === 'orders-call' && frame.rate > 0;
  const allStates = props.id === 'idle-call';
  const rate = (fraction: number) => mode === 'low' ? '1 event' : `${Math.round(frame.rate * fraction)}/s`;
  const [, x, y] = getSmoothStepPath(props);
  return <ExampleContext.Provider value={{ ...defaults, count: frame.awaiting, progress, direction: 'dual', phase: frame.rate && !blocked ? 'transport' : 'delivered' }}><PendingContext.Provider value={{ label: '', summary: '', edgeEvent: blocked ? 'Blocked' : undefined }}>
    <PendingEdgeForBusy {...props} />
    {frame.rate > 0 && !blocked && <EdgeLabelRenderer><div data-busy-transport-summary="" data-all-connection-states={allStates || undefined} className="absolute rounded-sm border border-divider bg-shell px-2 py-1 text-xs" title="Current deliveries and fixed one-second outcomes describe separate populations." style={{ width: allStates ? 180 : undefined, color: 'var(--color-secondary-text)', transform: `translate(-50%, 0) translate(${x}px,${y + 12}px)` }}>
      {allStates ? <>{[{ label: 'Requests →', value: Math.ceil(frame.awaiting / 2) }, { label: 'Responses ←', value: Math.floor(frame.awaiting / 2) }, { label: 'Error responses ←', value: Math.max(1, Math.round(frame.awaiting * 0.04)) }, { label: 'Late responses ←', value: Math.max(1, Math.round(frame.awaiting * 0.01)) }, { label: 'Blocked deliveries', value: Math.max(1, Math.round(frame.awaiting * 0.02)) }].map(item => <div key={item.label} className="flex justify-between gap-2"><span>{item.label}</span><span className="font-mono">{item.value}</span></div>)}<div className="mt-1 border-t border-divider pt-1" style={{ color: 'var(--color-danger, #B91C1C)' }}><div className="flex justify-between"><span>Delivery loss</span><span>{rate(0.01)}</span></div><div className="flex justify-between"><span>Attempts exhausted</span><span>{rate(0.006)}</span></div></div></> : <>Errors {rate(0.01)}</>}
    </div></EdgeLabelRenderer>}
  </PendingContext.Provider></ExampleContext.Provider>;
}
const PendingEdgeForBusy = pendingEdgeTypes.traffic;
const busyNodeTypes = { element: BusyNode };
const busyEdgeTypes = { traffic: BusyEdge };
function FitBusySystem() {
  const { fitBounds } = useReactFlow();
  useEffect(() => { void fitBounds({ x: 0, y: 0, width: 1060, height: 750 }, { padding: 0.12 }); }, [fitBounds]);
  return null;
}
function BusySystem({ frame, mode, progress }: { frame: LoadFrame; mode: string; progress: number }) {
  const id = `busy-system-${useId().replaceAll(':', '')}`;
  const nodes = fanoutNodes.map((node, index) => ({ ...node, position: { x: index < 2 ? index * 420 : 840, y: index < 2 ? 150 : index === 2 ? 0 : 350 } }));
  return <section className="border-t border-divider py-4" aria-labelledby="busy-system-heading" data-busy-system="">
    <h2 id="busy-system-heading" className="text-sm font-semibold">Simultaneous activity</h2>
    <p className="mt-1 text-xs text-secondary-text">Illustrative system · current populations coexist; outcome rates stay separate. Hover a node or footer for details.</p>
    <BusyContext.Provider value={{ frame, mode, progress }}><PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
      <div className="mt-3 overflow-x-auto border border-divider"><div id={id} style={{ height: 800, minWidth: 1200 }} className="bg-canvas"><ReactFlow nodes={nodes} edges={fanoutEdges} nodeTypes={busyNodeTypes} edgeTypes={busyEdgeTypes} minZoom={0.1} maxZoom={1} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}><FitBusySystem /></ReactFlow></div></div>
    </PlaybackTrafficContext.Provider></BusyContext.Provider>
    <p className="mt-2 text-xs text-secondary-text">Checkout API combines every activity and outcome. Its Payment connection combines both directions, affected deliveries and outcome rates. Idle is mutually exclusive with activity; blocked deliveries are separate from those moving.</p>
  </section>;
}
function FailurePreview({ frame, mode, progress }: { frame: LoadFrame; mode: string; progress: number }) {
  const [selected, setSelected] = useState<FailureId>('processing');
  const defaults = useContext(ExampleContext);
  const definition = failureExamples.find(item => item.id === selected)!;
  const returning = selected === 'response' || selected === 'late';
  const id = `failure-fundamental-${useId().replaceAll(':', '')}`;
  const current = selected === 'stuck' ? frame.awaiting : returning ? frame.rate ? Math.max(1, Math.round(frame.awaiting * definition.fraction)) : 0 : 0;
  const events = frame.rate ? Math.max(1, Math.round(frame.rate * definition.fraction)) : 0;
  const metric = returning || selected === 'stuck' ? `${current} ${returning ? 'in flight' : 'affected'}` : mode === 'low' ? '1 event' : `${events.toLocaleString()}/s`;
  return <div className="mt-3" data-failure-preview={selected}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="flex items-center gap-2 whitespace-nowrap text-xs">Failure detail <select aria-label="Failure example" className="min-w-0 rounded border border-divider bg-shell px-2 py-1 text-ink" value={selected} onChange={event => setSelected(event.target.value as FailureId)}>{failureExamples.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <span className="text-xs font-mono" style={{ color: returning || selected === 'stuck' ? 'var(--color-secondary-text)' : 'var(--color-danger, #B91C1C)' }} data-failure-metric="">{definition.scope} · {metric}</span>
    </div>
    <style>{`.connection-outcome-detail { display: none; } [data-connection-outcome]:hover .connection-outcome-detail, [data-connection-outcome]:focus .connection-outcome-detail { display: block; }`}</style>
    <FailureContext.Provider value={{ kind: selected, frame, metric }}><ExampleContext.Provider value={{ ...defaults, count: current, progress, phase: returning && frame.rate ? 'transport' : 'delivered', direction: returning ? 'backward' : 'forward', asynchronous: selected === 'redelivery' }}><PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
      <div id={id} className="mt-2 bg-canvas" style={{ height: 280 }} aria-label={`${definition.label} specimen`}><ReactFlow nodes={idleNodes} edges={idleEdges} nodeTypes={failureNodeTypes} edgeTypes={failureEdgeTypes} minZoom={0.1} maxZoom={1} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={id} reserveFooter={240} /></ReactFlow></div>
    </PlaybackTrafficContext.Provider></ExampleContext.Provider></FailureContext.Provider>
    <p className="mt-1 text-xs text-secondary-text">{definition.note}</p>
  </div>;
}

function Specimen({ activity, frame, progress, direction = 'forward', blocked = false, idle = false, asynchronous = false }: {
  activity?: Activity; frame: LoadFrame; progress: number; direction?: TravelDirection; blocked?: boolean; idle?: boolean; asynchronous?: boolean;
}) {
  const defaults = useContext(ExampleContext);
  const id = `traffic-fundamental-${useId().replaceAll(':', '')}`;
  const transport = !activity;
  const retry = activity === 'retry';
  const waiting = activity === 'awaiting';
  const combined = activity === 'combined';
  const count = activity === 'processing' ? frame.processing : activity === 'queued' ? frame.queued : frame.awaiting;
  const phase = activity === 'idle' || retry || blocked || idle || !frame.rate ? 'delivered' : waiting || combined ? 'dependency' : activity === 'processing' ? 'processing' : 'transport';
  const node = activity === 'idle' || waiting || retry ? idleNodes[0] : idleNodes[1];
  // Queue specimens require occupied slots, including under sparse arrivals;
  // these examples are independent current frames, not populations to add up.
  const populations = { queued: activity === 'queued' || combined ? frame.queued : 0, processing: activity === 'queued' || combined ? frame.queued ? 4 : frame.processing : activity === 'processing' ? frame.processing : 0, awaiting: waiting || combined ? frame.awaiting : 0, services: [{ name: 'Payment service', count: Math.ceil(frame.awaiting / 2) }, { name: 'Orders service', count: Math.floor(frame.awaiting / 2) }] };
  return <ExampleContext.Provider value={{ ...defaults, count, phase, progress, direction, queued: activity === 'queued', mixed: combined, asynchronous }}>
    <CurrentPopulationContext.Provider value={transport || retry ? null : populations}>
    <PendingContext.Provider value={{ label: '', summary: '', edgeEvent: blocked ? 'Blocked' : undefined, caller: retry && frame.retry > 0 ? [{ label: `${frame.retry} ${frame.retry > 1 ? 'retries' : 'retry'} scheduled`, detail: 'Next attempts pending', tone: 'queue' }] : undefined }}>
      <PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
        <div id={id} className="bg-canvas" style={{ height: transport ? 150 : combined ? 280 : 205 }} aria-label={transport ? 'Connection specimen' : `${activity} node specimen`}>
          <ReactFlow nodes={transport ? idleNodes : [{ ...node, position: { x: 0, y: 0 } }]} edges={transport ? idleEdges : []} nodeTypes={transport ? nodeTypes : retry ? pendingNodeTypes : exampleNodeTypes} edgeTypes={pendingEdgeTypes} defaultViewport={{ x: 20, y: 12, zoom: 1 }} minZoom={0.1} maxZoom={1} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={false} zoomOnScroll={false} zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }}>
            {transport && <FitIdleCanvas canvasId={id} reserveFooter={120} />}
          </ReactFlow>
        </div>
      </PlaybackTrafficContext.Provider>
    </PendingContext.Provider>
    </CurrentPopulationContext.Provider>
  </ExampleContext.Provider>;
}

function TrafficFundamentals() {
  const [load, setLoad] = useState('low');
  const [direction, setDirection] = useState('forward');
  const [motion, setMotion] = useState(true);
  const [progress, setProgress] = useState(0.4);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [asynchronous, setAsynchronous] = useState(false);
  const frame = loadFrame(load, time);
  useEffect(() => {
    if (load !== 'live' || !playing || time >= 24) return;
    const timer = setInterval(() => setTime(value => Math.min(24, value + 0.25)), 250);
    return () => clearInterval(timer);
  }, [load, playing, time >= 24]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      if (motion && !media.matches && (load !== 'live' || playing && time < 24)) timer = setInterval(() => setProgress(value => (value + 0.015) % 1), 50);
    };
    sync(); media.addEventListener('change', sync);
    return () => { clearInterval(timer); media.removeEventListener('change', sync); };
  }, [motion, load, playing, time >= 24]);
  return <main className="mx-auto min-h-screen max-w-5xl bg-shell p-4 text-ink">
    <TrafficVisualStyles />
    <style>{`.traffic-fundamental-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 16px; }`}</style>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-divider pb-3">
      <div><h1 className="text-lg font-semibold">Traffic visualization</h1><p className="mt-1 text-xs text-secondary-text">Current activity, transport and outcomes.</p></div>
      <div className="flex flex-wrap items-center gap-3"><Segmented aria-label="Traffic intensity" options={[{ id: 'low', label: 'Low load' }, { id: 'high', label: 'High load' }, { id: 'live', label: 'Live traffic' }]} value={load} onChange={value => { setLoad(value); if (value === 'live') { setTime(0); setPlaying(true); } }} /><label className="flex items-center gap-2 text-xs"><Switch checked={motion} onCheckedChange={setMotion} />Motion</label></div>
    </header>
    {load === 'live' && <div className="flex flex-wrap items-center gap-2 border-b border-divider py-2" data-live-controls="">
      <Button size="icon" variant="ghost" title={playing && time < 24 ? 'Pause live traffic' : 'Play live traffic'} aria-label={playing && time < 24 ? 'Pause live traffic' : 'Play live traffic'} onClick={() => { if (time >= 24) { setTime(0); setPlaying(true); } else setPlaying(value => !value); }}>{playing && time < 24 ? <Pause /> : <Play />}</Button>
      <Button size="icon" variant="ghost" title="Restart live traffic" aria-label="Restart live traffic" onClick={() => { setTime(0); setPlaying(true); }}><RotateCcw /></Button>
      <input type="range" aria-label="Live traffic playhead" min={0} max={24} step={0.25} value={time} onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }} className="min-w-24 flex-1" style={{ accentColor: 'var(--color-primary)' }} />
      <span className="text-xs font-mono" data-load-summary="">{time.toFixed(2)} s · {frame.phase} · {frame.rate.toLocaleString()}/s</span>
    </div>}
    <section className="py-4" aria-labelledby="traffic-node-heading">
      <h2 id="traffic-node-heading" className="mb-3 text-sm font-semibold">Node activity</h2>
      <div className="traffic-fundamental-grid">{activities.map(item => <div key={item.state} data-fundamental={item.state}>
        <h3 className="text-xs font-medium">{item.label}</h3>
        <Specimen activity={item.state} frame={frame} progress={progress} />
        <p className="text-xs text-secondary-text">{item.guide}</p>
      </div>)}</div>
    </section>
    <section className="border-t border-divider py-4" aria-labelledby="traffic-connection-heading">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="traffic-connection-heading" className="text-sm font-semibold">Connection activity</h2><Segmented aria-label="Connection direction" options={[{ id: 'idle', label: 'Idle' }, { id: 'forward', label: 'Forward' }, { id: 'backward', label: 'Return' }, { id: 'dual', label: 'Both' }, { id: 'blocked', label: 'Blocked' }]} value={direction} onChange={setDirection} /></div>
      <label className="mt-2 flex items-center gap-2 text-xs"><Switch checked={asynchronous} onCheckedChange={setAsynchronous} />Asynchronous transport</label>
      <Specimen frame={frame} progress={progress} direction={direction === 'blocked' || direction === 'idle' ? 'forward' : direction as TravelDirection} blocked={direction === 'blocked'} idle={direction === 'idle'} asynchronous={asynchronous} />
      <p className="text-xs text-secondary-text">Motion indicates direction, never request count. Blocked requires an explicit obstruction. Sync and async share transport; ACKs return, redelivery retries.</p>
    </section>
    <section className="border-t border-divider py-4" aria-labelledby="traffic-outcome-heading">
      <h2 id="traffic-outcome-heading" className="mb-2 text-sm font-semibold">Outcomes</h2>
      <dl>{outcomes.map(([name, meaning], index) => <div key={name} data-outcome={name} className="grid grid-cols-[90px_minmax(0,1fr)_60px] gap-3 py-1 text-xs"><dt className="font-medium">{name}</dt><dd className="text-secondary-text">{meaning}</dd><dd className="text-right font-mono" style={{ color: index === 0 ? '#047857' : index === 1 ? 'var(--color-danger, #B91C1C)' : index === 4 ? 'var(--color-secondary-text)' : 'var(--color-warning)' }}>{load === 'low' ? '1 event' : `${Math.round(frame.rate * [0.9,0.06,0.02,0.01,0.01][index]).toLocaleString()}/s`}</dd></div>)}</dl>
      <p className="mt-2 text-xs text-secondary-text">Illustrative events / one-second rates. Causes (rejection, loss, exhausted attempts) stay in inspection. “Stuck” needs evidence, not another state.</p>
      <FailurePreview frame={frame} mode={load} progress={progress} />
    </section>
      <BusySystem frame={frame} mode={load} progress={progress} />
    <section className="border-t border-divider py-3" aria-labelledby="traffic-guide-heading">
      <h2 id="traffic-guide-heading" className="mb-2 text-sm font-semibold">Usage</h2>
      <p className="mb-2 text-xs text-secondary-text">Import CurrentTrafficNode, CurrentTrafficConnection, CurrentTrafficActivityProvider and CurrentTrafficMotionProvider from @/components/traffic. Include CurrentTrafficStyles inside ReactFlow. Cells and lanes has its own design-system page.</p>
      <ul className="list-disc space-y-1 pl-4 text-xs text-secondary-text"><li>Hover node or footer to expand. Focus also expands; tap pins details.</li><li>Show current populations at the playhead. Historical totals stay separate; zoom changes neither.</li><li>Use shading for intensity and bounded motion for activity. Idle stays quiet; pause and reduced motion freeze cues.</li></ul>
    </section>
  </main>;
}

const meta = { title: 'Design System/Traffic visualization', component: TrafficFundamentals, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TrafficFundamentals>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Fundamentals: Story = {};

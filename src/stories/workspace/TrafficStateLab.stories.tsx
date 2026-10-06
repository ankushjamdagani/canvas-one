import type { Meta, StoryObj } from '@storybook/react-vite';
import { createContext, useContext, useEffect, useId, useState } from 'react';
import { ReactFlow, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type Node, type Edge, type NodeProps, type EdgeProps } from '@xyflow/react';
import { Pause, Play, Clock, ListOrdered, Cpu, Check, TriangleAlert, RotateCcw } from 'lucide-react';
import { NodeCard } from '@/features/workspace/NodeCard';
import { TrafficEdge } from '@/features/workspace/TrafficEdge';
import { PlaybackTrafficContext } from '@/features/workspace/usePlaybackTraffic';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { StateLoadExample, type LiveFrame } from './LiveTrafficState';

const nodeTypes = { element: NodeCard };
const edgeTypes = { traffic: TrafficEdge };
function FitIdleCanvas({ canvasId = 'idle-state-canvas', reserveFooter = 0 }: { canvasId?: string; reserveFooter?: number }) {
  const { fitBounds, getNodesBounds, getNodes } = useReactFlow();
  useEffect(() => {
    const element = document.getElementById(canvasId);
    if (!element) return;
    // xyflow updates its measured viewport after the outer ResizeObserver.
    // Fit after that render, rather than reusing the previous viewport width.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          // fitView queues a node update; these fixed controlled fixtures have
          // no onNodesChange. fitBounds updates the viewport directly.
          const bounds = getNodesBounds(getNodes());
          void fitBounds({ ...bounds, height: reserveFooter ? Math.max(reserveFooter, bounds.height) : bounds.height }, { padding: 0.2 });
        });
      });
    });
    observer.observe(element);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [fitBounds, getNodesBounds, getNodes, canvasId, reserveFooter]);
  return null;
}
const idleNodes: Node[] = ['Checkout API', 'Payment service'].map((label, index) => {
  const id = `idle-${index}`;
  return { id, type: 'element', position: { x: index * 360, y: 60 }, data: {
    kind: 'element', layer: 'compute', stripeColor: 'var(--color-primary)', connectable: false,
    placement: { id: `placement-${id}`, elementId: id, x: index * 360, y: 60, width: 220, height: 90 },
    element: { id, label, visualKind: 'service', description: '', attributes: {},
      behavior: { kind: 'resource', version: 1, entryPortId: `${id}-in`, config: { type: 'processor', capacity: 2000, concurrency: 4, queueLimit: 100, failureRate: 0, maxRetries: 0, retryDelayMs: 0 } },
      ports: [{ id: `${id}-in`, direction: 'in', channel: 'direct', label: 'HTTP' }, { id: `${id}-out`, direction: 'out', channel: 'direct', label: 'HTTP' }],
    },
  } };
});
const idleEdges: Edge[] = [{ id: 'idle-call', source: 'idle-0', target: 'idle-1', type: 'traffic', label: 'call · HTTP / REST', style: { stroke: 'var(--color-control-border)' }, data: { connection: { id: 'idle-call' } } }];
const fraudNode: Node = {
  ...idleNodes[1], id: 'idle-2', position: { x: 720, y: 60 },
  data: { ...idleNodes[1].data,
    placement: { id: 'placement-idle-2', elementId: 'idle-2', x: 720, y: 60, width: 220, height: 90 },
    element: { ...(idleNodes[1].data.element as Record<string, unknown>), id: 'idle-2', label: 'Fraud check service',
      behavior: { kind: 'resource', version: 1, entryPortId: 'idle-2-in', config: { type: 'processor', capacity: 2000, concurrency: 4, queueLimit: 100, failureRate: 0, maxRetries: 0, retryDelayMs: 0 } },
      ports: [{ id: 'idle-2-in', direction: 'in', channel: 'direct', label: 'HTTP' }, { id: 'idle-2-out', direction: 'out', channel: 'direct', label: 'HTTP' }],
    },
  },
};
const dependencyNodes = [...idleNodes, fraudNode];
const dependencyEdges: Edge[] = [...idleEdges, { ...idleEdges[0], id: 'fraud-call', source: 'idle-1', target: 'idle-2', data: { connection: { id: 'fraud-call' } } }];
const ordersNode: Node = {
  ...fraudNode, id: 'idle-3', position: { x: 720, y: 230 },
  data: { ...fraudNode.data, placement: { id: 'placement-idle-3', elementId: 'idle-3', x: 720, y: 230, width: 220, height: 90 },
    element: { ...(fraudNode.data.element as Record<string, unknown>), id: 'idle-3', label: 'Orders service',
      behavior: { kind: 'resource', version: 1, entryPortId: 'idle-3-in', config: { type: 'processor', capacity: 2000, concurrency: 4, queueLimit: 100, failureRate: 0, maxRetries: 0, retryDelayMs: 0 } },
      ports: [{ id: 'idle-3-in', direction: 'in', channel: 'direct', label: 'HTTP' }, { id: 'idle-3-out', direction: 'out', channel: 'direct', label: 'HTTP' }],
    },
  },
};
const fanoutNodes: Node[] = [...idleNodes, { ...fraudNode, position: { x: 720, y: -100 } }, ordersNode];
const fanoutEdges: Edge[] = [...dependencyEdges, { ...idleEdges[0], id: 'orders-call', source: 'idle-1', target: 'idle-3', data: { connection: { id: 'orders-call' } } }];

function IdleExample() {
  const [priorTraffic, setPriorTraffic] = useState(false);
  return <section className="border-b border-border py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">01 · Idle <span className="font-normal text-secondary-text">· visual for review</span></h2>
      <div className="flex gap-1" role="group" aria-label="Idle recording example">
        <Button size="sm" variant={!priorTraffic ? 'tint' : 'ghost'} aria-pressed={!priorTraffic} onClick={() => setPriorTraffic(false)}>Before traffic</Button>
        <Button size="sm" variant={priorTraffic ? 'tint' : 'ghost'} aria-pressed={priorTraffic} onClick={() => setPriorTraffic(true)}>After traffic</Button>
      </div>
    </div>
    <p className="my-2 text-xs text-secondary-text">{priorTraffic ? 'Playhead 00:30.000 · illustrative recording, all work settled' : 'Playhead 00:00.000 · no requests admitted'}</p>
    <PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: priorTraffic }}>
      <div id="idle-state-canvas" className="border border-divider bg-canvas" style={{ height: 260 }} aria-label="Idle nodes and connection">
        <ReactFlow nodes={idleNodes} edges={idleEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} minZoom={0.1} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas /></ReactFlow>
      </div>
    </PlaybackTrafficContext.Provider>
    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-secondary-text" aria-label="Cumulative summary through playhead">
      <span>Cumulative through playhead</span><span>{priorTraffic ? '12,000' : '0'} requests</span><span>{priorTraffic ? '11,940' : '0'} successful</span><span>{priorTraffic ? '60' : '0'} failed</span>
    </div>
    <p className="mt-3 text-sm text-secondary-text">No pulses, travelling markers, load shading or zero-count badges. The architecture stays legible. Switching to prior traffic changes the cumulative summary only; both nodes and the connection remain idle.</p>
  </section>;
}

// Design-only frames: no simulation accounting or production rendering changes.
type ExamplePhase = 'transport' | 'processing' | 'dependency' | 'delivered';
type TravelDirection = 'forward' | 'backward' | 'dual';
const ExampleContext = createContext({ count: 1, queued: false, progress: 0.4, phase: 'transport' as ExamplePhase, multiple: false, oneReturned: false, mixed: false, direction: 'forward' as TravelDirection, asynchronous: false, arrival: false, arrivalCount: 1, liveProcessing: -1 });
function DependencyFooter() {
  const { count, oneReturned, mixed } = useContext(ExampleContext);
  const fraudPending = count - (oneReturned ? 1 : 0);
  const ordersPending = count === 4 ? 3 : 1;
  const callsPending = fraudPending + ordersPending;
  return <div className="nodrag nopan border-t border-divider px-3 py-2 text-xs" data-dependency-footer="" style={{ pointerEvents: 'auto', color: '#4338CA', background: '#EEF2FF', borderRadius: mixed ? 0 : '0 0 8px 8px' }}>
    <div className="flex items-center justify-between gap-1">
      <span className="flex items-center gap-1 font-medium"><Clock size={14} />{count} awaiting responses</span>
    </div>
    <div className="mb-2 text-secondary-text">{callsPending} {callsPending === 1 ? 'call' : 'calls'} pending</div>
    {fraudPending > 0 && <div className="flex items-center justify-between gap-2 border-t pt-2" style={{ borderColor: '#C7D2FE' }}><span>Fraud check</span><span>{fraudPending} pending {fraudPending === 1 ? 'call' : 'calls'}</span></div>}
    <div className="mt-2 flex items-center justify-between gap-2"><span>Orders service</span><span>{ordersPending} pending {ordersPending === 1 ? 'call' : 'calls'}</span></div>
    <div className="mt-2 max-h-40 overflow-y-auto" aria-label="Dependency call breakdown">
      {Array.from({ length: count }, (_, index) => <div key={index} className="border-t border-divider py-2">
        <div className="font-mono font-medium">REQ-{String(index + 1).padStart(3, '0')}</div>
        {!(oneReturned && index === 0) && <div className="mt-1 flex justify-between gap-2"><span>Fraud check</span><span>Pending</span></div>}
        {index < ordersPending && <div className="mt-1 flex justify-between gap-2"><span>Orders service</span><span>Pending</span></div>}
      </div>)}
    </div>
  </div>;
}
function ExampleNode(props: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const { count, queued, progress, phase, multiple, oneReturned, mixed, direction, asynchronous, arrival, arrivalCount, liveProcessing } = useContext(ExampleContext);
  const receiver = props.id === 'idle-1';
  const dependency = phase === 'dependency';
  const localProcessing = dependency && mixed ? (count === 4 ? 2 : 1) : 0;
  const processCount = queued && receiver || multiple && props.id === 'idle-3' ? 4 : dependency && receiver ? localProcessing : liveProcessing >= 0 ? liveProcessing : multiple && props.id === 'idle-2' ? count - (oneReturned ? 1 : 0) : count;
  const processing = processCount > 0 && ((phase === 'processing' && receiver) || (dependency && (props.id === 'idle-2' || receiver)) || (queued && receiver) || (multiple && props.id === 'idle-3'));
  const awaiting = (!asynchronous && phase !== 'delivered' && props.id === 'idle-0') || (dependency && receiver);
  const awaitedService = dependency && receiver ? 'Fraud check service' : 'Payment service';
  const waiting = multiple && props.id === 'idle-3' ? (count === 4 ? 3 : 1) : queued && receiver ? count : 0;
  const pressure = waiting >= 50;
  const pending = queued ? count + 4 : count * (phase === 'transport' && direction === 'dual' ? 2 : 1) + (props.id === 'idle-0' ? localProcessing : 0);
  const pulse = 0.5 + Math.sin(progress * Math.PI * 2) * 0.5;
  const active = awaiting || processing || waiting > 0;
  return <div className="traffic-lab-node nodrag nopan" data-expanded={expanded} tabIndex={active ? 0 : undefined} role="group" aria-label={active ? 'Node activity; hover or focus for details, tap to keep expanded' : undefined}
    onClick={event => { if (!(event.target as HTMLElement).closest('button')) setExpanded(value => !value); }}
    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setExpanded(value => !value); } }}
    style={{ borderRadius: 8, pointerEvents: 'auto',
    background: 'var(--color-shell)',
  }}>
    <NodeCard {...props} />
    {arrival && props.id === 'idle-0' && <span className="absolute -top-3 right-2 flex items-center gap-1 rounded-sm bg-shell px-1 text-xs text-primary" data-response-delivered=""><Check size={14} />+{arrivalCount} delivered</span>}
    {awaiting && !(multiple && receiver) && <div data-waiting-footer="" className="border-t border-divider px-3 py-2 text-xs" style={{ color: '#4338CA', background: '#EEF2FF', borderRadius: processing ? 0 : '0 0 8px 8px' }} title={`Outstanding synchronous calls to ${awaitedService}. Awaiting response includes work in transit, queued and processing; it is not an in-flight count.`}>
      <div className="flex items-center gap-1 font-medium"><Clock size={14} />{pending} awaiting responses</div>
      <div className="mt-1 text-secondary-text">From {awaitedService}</div>
    </div>}
    {multiple && receiver && <DependencyFooter />}
    {waiting > 0 && <div className="px-3 py-2 text-xs" data-queue-footer="" style={{ color: 'var(--color-warning)', borderRadius: '0 0 8px 8px', background: `color-mix(in srgb, var(--color-warning) ${pressure ? 18 : 6}%, var(--color-shell))`, boxShadow: `inset 0 -3px color-mix(in srgb, var(--color-warning) ${pressure ? 40 + pulse * 40 : 35}%, transparent)` }}>
      <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1 font-medium"><ListOrdered size={14} />{waiting} queued</span><span className="font-mono">{waiting} / 100</span></div>
      <div className="mt-2 flex gap-1" role="img" aria-label={`${waiting} of 100 queue slots used; each segment represents 10 slots`}>
        {Array.from({ length: 10 }, (_, index) => <div key={index} className="relative h-5 flex-1 overflow-hidden rounded-sm" style={{ background: 'color-mix(in srgb, var(--color-warning) 10%, var(--color-canvas))', border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)' }}>
          <div style={{ width: `${Math.min(10, Math.max(0, waiting - index * 10)) * 10}%`, height: '100%', background: `color-mix(in srgb, var(--color-warning) ${pressure ? 90 : 55}%, var(--color-canvas))` }} />
        </div>)}
      </div>
    </div>}
    {processing && <div className="border-t border-divider px-3 py-2 text-xs" data-processing-footer="" style={{ color: '#047857', background: processCount === 4 ? '#D1FAE5' : '#ECFDF5', borderRadius: '0 0 8px 8px' }}>
      <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1 font-medium"><Cpu size={14} />{processCount} processing</span><span className="font-mono">{processCount} / 4 slots</span></div>
      <div className="mt-2 flex gap-1.5" role="img" aria-label={`${processCount} of 4 local processing slots occupied`}>
        {Array.from({ length: 4 }, (_, index) => <div key={index} data-processing-slot="" style={{ flex: 1, height: 20, borderRadius: 3, border: '1px solid #A7F3D0', background: index < processCount ? `rgba(5, 150, 105, ${0.55 + (0.5 + Math.sin((progress + index / 4) * Math.PI * 2) * 0.5) * 0.4})` : '#FFFFFF' }} />)}
      </div>
      <div className="mt-2 text-secondary-text">{dependency && receiver ? 'Other requests working locally' : waiting > 0 ? 'Separate local work · queued requests shown above' : 'Local work · 0 queued'}</div>
    </div>}
  </div>;
}
function ExampleEdge(props: EdgeProps & { labelOverride?: string }) {
  const { count, queued, progress, phase, direction, asynchronous } = useContext(ExampleContext);
  const [path, x, y] = getSmoothStepPath(props);
  const id = useId().replaceAll(':', '');
  const active = !queued && phase === 'transport';
  const span = props.targetX - props.sourceX;
  return <>
    <BaseEdge path={path} style={{ stroke: 'var(--color-control-border)', strokeWidth: 1.5 }} />
    {active && (direction === 'dual' ? ['forward', 'backward'] as const : [direction]).map(lane => {
      const reverse = lane === 'backward';
      const offset = direction === 'dual' ? (reverse ? 4 : -4) : 0;
      const color = reverse ? 'var(--color-secondary-text)' : 'var(--color-primary)';
      const gradientId = `travel-${id}-${lane}`;
      const phaseOffset = reverse ? 1 - progress : progress;
      return <g key={lane} data-travel-direction={lane} transform={`translate(0 ${offset})`}>
        <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={props.sourceX + phaseOffset * span} y1={props.sourceY} x2={props.sourceX + phaseOffset * span + span / 2} y2={props.sourceY} spreadMethod="repeat">
          <stop offset="0" stopColor={color} stopOpacity={0.12} />
          <stop offset="0.45" stopColor={color} stopOpacity={0.75} />
          <stop offset="0.65" stopColor={color} stopOpacity={0.9} />
          <stop offset="1" stopColor={color} stopOpacity={0.12} />
        </linearGradient></defs>
        <path d={path} fill="none" stroke={color} strokeOpacity={count > 1 ? 0.12 : 0.06} strokeWidth={count > 1 ? 7 : 5} strokeLinecap="round" />
        <path d={path} fill="none" stroke={`url(#${gradientId})`} strokeWidth={count > 1 ? 4 : 2.5} strokeLinecap="round" />
        <g data-traffic-dots="" aria-hidden="true">{Array.from({ length: 3 }, (_, index) => {
          const position = (progress + index / 3) % 1;
          const cx = props.sourceX + span * (reverse ? 1 - position : position);
          return <circle key={index} cx={cx} cy={props.sourceY} r={2.5} fill={color} stroke="var(--color-canvas)" strokeWidth={1} />;
        })}</g>
      </g>;
    })}
    <EdgeLabelRenderer><div className="absolute rounded-sm border border-divider bg-shell px-2 py-1 text-xs text-secondary-text" style={{ transform: `translate(-50%, -100%) translate(${x}px,${y - 16}px)` }}>
      {props.labelOverride ?? (asynchronous ? 'message · AMQP' : 'call · HTTP / REST')}
    </div></EdgeLabelRenderer>
  </>;
}
const exampleNodeTypes = { element: ExampleNode };
const exampleEdgeTypes = { traffic: ExampleEdge };
function ActiveExample({ queued = false, phase = 'transport' }: { queued?: boolean; phase?: ExamplePhase }) {
  const [direction, setDirection] = useState<TravelDirection>('forward');
  const [high, setHigh] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [oneReturned, setOneReturned] = useState(false);
  const [mixed, setMixed] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0.4);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!playing || reduced) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => { const elapsed = now - previous; previous = now; setProgress(value => (value + elapsed / 3500) % 1); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, reduced, queued]);
  const count = high ? (phase !== 'transport' ? 4 : queued ? 80 : 120) : 1;
  const localProcessing = phase === 'dependency' && mixed ? (high ? 2 : 1) : 0;
  const canvasId = phase === 'processing' ? 'processing-state-canvas' : phase === 'dependency' ? 'dependency-state-canvas' : queued ? 'queued-state-canvas' : 'travelling-state-canvas';
  const title = phase === 'processing' ? '04 · Node activity: processing' : phase === 'dependency' ? '05 · Node activity: awaiting responses' : queued ? '03 · Node activity: queued work' : '02 · Connection activity: travelling';
  const controlName = phase === 'processing' ? 'Processing traffic level' : phase === 'dependency' ? 'Dependency traffic level' : queued ? 'Queue traffic level' : 'Travelling traffic level';
  return <section className="border-b border-border py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex items-center gap-1" role="group" aria-label={controlName}>
        <Button size="sm" variant={!high ? 'tint' : 'ghost'} aria-pressed={!high} onClick={() => setHigh(false)}>Low traffic</Button>
        <Button size="sm" variant={high ? 'tint' : 'ghost'} aria-pressed={high} onClick={() => setHigh(true)}>High traffic</Button>
        <Button size="icon" variant="ghost" title={playing ? 'Pause illustrative motion' : 'Resume illustrative motion'} aria-label={playing ? 'Pause illustrative motion' : 'Resume illustrative motion'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause /> : <Play />}</Button>
      </div>
    </div>
    <p className="my-2 text-xs text-secondary-text">Illustrative current frame · {phase === 'processing' ? 'requests arrived; receiver working locally' : phase === 'dependency' ? multiple ? 'calls delivered; Payment service awaits Fraud and Orders' : 'calls delivered; Payment service awaits Fraud check service' : queued ? 'waiting for a local processing slot' : direction === 'forward' ? 'requests: caller → receiver' : direction === 'backward' ? 'responses: receiver → caller' : 'requests → and responses ← on separate lanes'}{reduced ? ' · reduced motion' : ''}</p>
    {phase === 'dependency' && <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="flex gap-1" role="group" aria-label="Dependency topology">
        <Button size="sm" variant={!multiple ? 'tint' : 'ghost'} aria-pressed={!multiple} onClick={() => { setMultiple(false); setOneReturned(false); }}>One downstream</Button>
        <Button size="sm" variant={multiple ? 'tint' : 'ghost'} aria-pressed={multiple} onClick={() => setMultiple(true)}>Multiple downstreams</Button>
      </div>
      {multiple && <label className="flex items-center gap-2 text-xs text-secondary-text"><Switch checked={oneReturned} onCheckedChange={setOneReturned} aria-label="One Fraud call returned" />One Fraud call returned</label>}
      <label className="flex items-center gap-2 text-xs text-secondary-text"><Switch checked={mixed} onCheckedChange={setMixed} aria-label="Processing + awaiting responses" />Processing + awaiting responses</label>
    </div>}
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-text" aria-label="Current state ownership">
      <span><strong>Caller:</strong> {queued ? count + 4 : count * (phase === 'transport' && direction === 'dual' ? 2 : 1) + localProcessing} awaiting responses</span>
      <span><strong>{phase === 'dependency' ? 'Connections' : 'Connection'}:</strong> {queued || phase !== 'transport' ? 'idle' : direction === 'dual' ? `${count} requests → · ${count} responses ←` : `${count} ${direction === 'backward' ? 'responses ←' : 'requests →'} in flight`}</span>
      <span><strong>{phase === 'dependency' ? 'Payment service' : 'Receiver'}:</strong> {localProcessing > 0 ? `${localProcessing} processing · ` : ''}{multiple ? `${count} awaiting responses · ${count + (count === 4 ? 3 : 1) - (oneReturned ? 1 : 0)} calls pending` : phase === 'dependency' ? `${count} awaiting responses` : phase === 'processing' ? `${count} processing · 0 queued` : queued ? `${count} queued · 4 processing` : direction === 'backward' ? 'idle; responses returning' : 'idle until arrival'}</span>
      {phase === 'dependency' && !multiple && <span><strong>Fraud check:</strong> {count} processing</span>}
    </div>
    {phase === 'transport' && !queued && <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Travel direction">
      {(['forward', 'backward', 'dual'] as const).map(value => <Button key={value} size="sm" variant={direction === value ? 'tint' : 'ghost'} aria-pressed={direction === value} onClick={() => setDirection(value)}>{value === 'forward' ? 'Forward · requests' : value === 'backward' ? 'Backward · responses' : 'Dual direction'}</Button>)}
    </div>}
    <ExampleContext.Provider value={{ count, queued, progress, phase, multiple, oneReturned, mixed, direction, asynchronous: false, arrival: false, arrivalCount: 1, liveProcessing: -1 }}>
      <PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
        <div id={canvasId} className="border border-divider bg-canvas" style={{ height: multiple ? 420 : mixed || queued ? 320 : 260 }}>
          <ReactFlow key={`${multiple ? 'fanout' : 'single'}-${mixed}`} nodes={multiple ? fanoutNodes : phase === 'dependency' ? dependencyNodes : idleNodes} edges={multiple ? fanoutEdges : phase === 'dependency' ? dependencyEdges : idleEdges} nodeTypes={exampleNodeTypes} edgeTypes={exampleEdgeTypes} minZoom={0.1} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={canvasId} reserveFooter={queued ? 280 : 0} /></ReactFlow>
        </div>
      </PlaybackTrafficContext.Provider>
    </ExampleContext.Provider>
    {phase === 'dependency' && <p className="mt-3 text-sm text-secondary-text">Only outstanding downstream services appear in the response-waiting summary; request-level pending calls appear inline below the service totals. {mixed ? 'Payment service also processes separate requests locally: green slots and violet response waits coexist. Caller pending responses include both populations.' : 'Enable Processing + awaiting responses to see independent populations on the same node.'}</p>}
    {multiple && <p className="mt-3 text-sm text-secondary-text">One waiting request can own several pending synchronous calls. In high traffic, four requests have seven calls: all four call Fraud, three also call Orders. In low traffic, one request calls both. Returning REQ-001’s Fraud call leaves it blocked on Orders. The inline response-waiting list shows each request’s remaining pending calls. Orders’ four occupied processing slots belong to other work; these selected calls are queued. All links remain still after delivery.</p>}
    {!multiple && <p className="mt-3 text-sm text-secondary-text">{phase === 'processing' ? 'Green processing slots softly pulse at the node doing local work. One or all four configured slots are occupied; these are slot counts, not request-completion percentages. All four busy can be healthy: no queue or error is implied. The caller awaits response, and the connection stays still until a response travels.' : phase === 'dependency' ? mixed ? 'Payment service processes some requests locally while other requests await Fraud check service. Green slots describe occupied local capacity; the violet footer describes outstanding dependency calls. Both connections stay still because calls have arrived.' : 'Payment service is waiting, not doing local processing. Its violet footer names the service whose response is pending; Fraud check service owns the green processing pulse. Both connections stay still because calls have arrived. In the high example, four root requests each have one downstream call: the two awaiting counts describe different hops of the same journeys, not eight root requests.' : queued ? 'The receiver owns queued and processing work. Its amber footer shows queue capacity; only the footer accent pulses under pressure. The caller still awaits responses for both populations: 80 queued + 4 processing = 84 pending in the high-traffic example. The connection is idle.' : 'The connection owns transport. Three small dots and a travelling tonal gradient communicate direction, never request count. The stream deepens under heavier traffic. Theme teal carries outbound requests; muted slate carries returning responses. Dual traffic uses two restrained streams with opposite motion. Rounded bands and bounded dots keep both directions readable. The caller remains waiting until its responses arrive; the receiver can be idle while responses travel back.'}</p>}
  </section>;
}

function CompletionExample({ asynchronous = false }: { asynchronous?: boolean }) {
  const [delivered, setDelivered] = useState(0);
  const [arrivalCount, setArrivalCount] = useState(1);
  const [high, setHigh] = useState(false);
  const [stage, setStage] = useState<'transport' | 'processing' | 'delivered'>(asynchronous ? 'processing' : 'delivered');
  const [arrival, setArrival] = useState(false);
  const [progress, setProgress] = useState(0.4);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!arrival || !playing) return;
    const timer = setTimeout(() => setArrival(false), 1200);
    return () => clearTimeout(timer);
  }, [arrival, arrivalCount, delivered, playing]);
  useEffect(() => {
    if (!playing || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => { setProgress(value => (value + (now - previous) / 3500) % 1); previous = now; frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const count = high ? (asynchronous ? 4 : 120) : 1;
  useEffect(() => {
    if (asynchronous || stage !== 'delivered' || !playing || delivered >= count) return;
    const timer = setTimeout(() => {
      const batch = Math.min(count - delivered, high ? [7, 12, 4, 18, 9][delivered % 5] : 1);
      setArrivalCount(batch); setArrival(true); setDelivered(value => value + batch);
    }, high ? 650 : 750);
    return () => clearTimeout(timer);
  }, [asynchronous, stage, playing, delivered, count, high]);
  const canvasId = asynchronous ? 'async-state-canvas' : 'delivered-state-canvas';
  const nodes = asynchronous ? idleNodes.map((node, index) => ({ ...node, data: { ...node.data, element: { ...(node.data.element as Record<string, unknown>), label: index === 0 ? 'Checkout API' : 'Fulfilment worker' } } })) : idleNodes;
  return <section className="border-b border-border py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{asynchronous ? '07 · Asynchronous work after response' : '06 · Event: response delivered'}</h2>
      <div className="flex items-center gap-1" role="group" aria-label={asynchronous ? 'Async traffic level' : 'Delivered traffic level'}>
        <Button size="sm" variant={!high ? 'tint' : 'ghost'} aria-pressed={!high} onClick={() => { setHigh(false); setDelivered(0); setArrival(false); }}>Low traffic</Button>
        <Button size="sm" variant={high ? 'tint' : 'ghost'} aria-pressed={high} onClick={() => { setHigh(true); setDelivered(0); setArrival(false); }}>High traffic</Button>
        <Button size="icon" variant="ghost" aria-label={playing ? 'Pause illustrative motion' : 'Resume illustrative motion'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause /> : <Play />}</Button>
      </div>
    </div>
    <div className="my-3 flex flex-wrap gap-1" role="group" aria-label={asynchronous ? 'Async stage' : 'Response stage'}>
      {(asynchronous ? ['transport', 'processing', 'delivered'] as const : ['transport', 'delivered'] as const).map(value => <Button key={value} size="sm" variant={stage === value ? 'tint' : 'ghost'} aria-pressed={stage === value} onClick={() => { setStage(value); setDelivered(0); setArrival(false); }}>{value === 'transport' ? asynchronous ? 'Message travelling' : 'Response travelling' : value === 'processing' ? 'Worker processing' : asynchronous ? 'Side effect settled' : 'Response delivered'}</Button>)}
    </div>
    <p className="mb-2 text-xs text-secondary-text">{asynchronous ? `Caller response already delivered · ${stage === 'delivered' ? 'side effect complete' : `${count} messages ${stage === 'transport' ? 'in transit' : 'processing locally'}`} · no synchronous dependency wait` : stage === 'transport' ? `${count} responses returning · caller still awaiting delivery` : `${delivered} / ${count} responses delivered · ${Math.max(0, count - delivered)} still returning`}</p>
    <ExampleContext.Provider value={{ count: !asynchronous && stage === 'delivered' ? Math.max(1, count - delivered) : count, queued: false, progress, phase: !asynchronous && stage === 'delivered' && delivered < count ? 'transport' : stage, multiple: false, oneReturned: false, mixed: false, direction: asynchronous ? 'forward' : 'backward', asynchronous, arrival, arrivalCount, liveProcessing: -1 }}>
      <PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
        <div id={canvasId} className="border border-divider bg-canvas" style={{ height: 260 }}>
          <ReactFlow nodes={nodes} edges={idleEdges} nodeTypes={exampleNodeTypes} edgeTypes={exampleEdgeTypes} minZoom={0.1} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={canvasId} /></ReactFlow>
        </div>
      </PlaybackTrafficContext.Provider>
    </ExampleContext.Provider>
    <p className="mt-3 text-sm text-secondary-text">{asynchronous ? 'The caller can be idle while asynchronous work travels or executes elsewhere. Delivery, worker processing and side-effect settlement are separate stages; none reopens the caller’s response wait. Acknowledgements, when recorded, will be a separate return.' : 'Responses arrive over time, not as one simultaneous batch. The caller shows a bounded arrival increment while its outstanding wait decreases. Delivered / total stays outside the node. After the final arrival the event cue clears, and the node is idle. Pause freezes the illustrative arrival sequence.'}</p>
  </section>;
}

const FaultContext = createContext({ retry: false, stage: 'failed', cause: 'Processing failure', high: false, variant: 'failure', liveAffected: -1 });
function FaultNode(props: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const { retry, stage, cause, high, variant, liveAffected } = useContext(FaultContext);
  const caller = props.id === 'idle-0';
  const affected = liveAffected >= 0 ? liveAffected : high ? 6 : 1;
  return <div className="traffic-lab-node nodrag nopan" tabIndex={0} data-expanded={expanded} onClick={() => { if (stage !== 'retrying') setExpanded(value => !value); }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setExpanded(value => !value); } }} style={{ pointerEvents: 'auto' }}>
    {stage === 'retrying' ? <ExampleNode {...props} /> : <NodeCard {...props} />}
    {caller && variant === 'timeout' && stage === 'waiting' && <div data-waiting-footer="" className="border-t border-divider px-3 py-2 text-xs" style={{ background: '#EEF2FF', color: '#4338CA' }}><div className="flex items-center gap-1"><Clock size={14} />{affected} awaiting responses</div><div className="mt-2">No response received · request deadline pending</div></div>}
    {!caller && variant === 'expiry' && stage === 'waiting' && <div data-waiting-footer="" className="border-t border-divider px-3 py-2 text-xs" style={{ background: '#FFF7ED', color: 'var(--color-warning)' }}><div className="flex items-center gap-1"><ListOrdered size={14} />{affected} messages queued</div><div className="mt-2">TTL still valid · waiting for local processing</div></div>}
    {caller && stage === 'backoff' && <div data-waiting-footer="" className="border-t border-divider px-3 py-2 text-xs" style={{ background: '#FFF7ED', color: 'var(--color-warning)' }}>
      <div className="flex items-center gap-1"><RotateCcw size={14} />{affected} retry scheduled</div>
      <div className="mt-2">Attempt 1 failed · attempt 2 not sent yet</div>
      <div className="mt-1">Waiting for retry delay · connection idle</div>
    </div>}
    {(variant === 'timeout' ? caller : !caller) && stage === 'failed' && <div data-waiting-footer="" className="border-t border-divider px-3 py-2 text-xs" style={{ background: '#FEF2F2', color: 'var(--color-danger, #B91C1C)' }}>
      <div className="flex items-center gap-1"><TriangleAlert size={14} />{affected} {high && cause === 'Message expiry' ? 'message expiries' : `${cause.toLowerCase()}${high ? 's' : ''}`}</div>
      <div className="mt-2">{retry ? 'Attempt failed; caller can retry' : 'Affected requests ended unsuccessfully'}</div>
    </div>}
    {!caller && variant === 'timeout' && <div className="border-t border-divider px-3 py-2 text-xs" style={{ color: '#047857', background: '#ECFDF5' }}><Cpu className="inline" size={14} /> {high ? '4 still processing · 2 queued' : '1 still processing'}</div>}
    {!caller && high && variant !== 'timeout' && <div className="border-t border-divider px-3 py-2 text-xs" style={{ color: '#047857', background: '#ECFDF5' }}><Cpu className="inline" size={14} /> 2 other requests processing</div>}
  </div>;
}
const faultNodeTypes = { element: FaultNode };
function FaultEdge(props: EdgeProps) {
  const { stage, high } = useContext(FaultContext);
  const [, x, y] = getSmoothStepPath(props);
  return <><ExampleEdge {...props} />{stage === 'lost' && <EdgeLabelRenderer><div className="absolute rounded-sm bg-shell px-2 py-1 text-xs" data-message-loss="" style={{ color: 'var(--color-danger, #B91C1C)', transform: `translate(-50%, 0) translate(${x}px, ${y + 8}px)` }}><TriangleAlert className="inline" size={14} /> {high ? 6 : 1} messages lost in delivery</div></EdgeLabelRenderer>}</>;
}
const faultEdgeTypes = { traffic: FaultEdge };
function FaultExample({ retry = false, variant = 'failure' }: { retry?: boolean; variant?: 'failure' | 'timeout' | 'expiry' }) {
  const defaults = useContext(ExampleContext);
  const [high, setHigh] = useState(false);
  const [stage, setStage] = useState(retry ? 'backoff' : variant === 'timeout' ? 'waiting' : 'failed');
  const [cause, setCause] = useState(variant === 'timeout' ? 'Deadline timeout' : variant === 'expiry' ? 'Message expiry' : 'Processing failure');
  const [progress, setProgress] = useState(0.4);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setProgress(value => (value + 0.015) % 1), 50);
    return () => clearInterval(timer);
  }, [playing]);
  const canvasId = retry ? 'retry-state-canvas' : variant === 'timeout' ? 'timeout-state-canvas' : variant === 'expiry' ? 'expiry-state-canvas' : 'failure-state-canvas';
  return <section className="border-b border-border py-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{retry ? '09 · Retry: delay and another attempt' : variant === 'timeout' ? '10 · Deadline elapsed; downstream work continues' : variant === 'expiry' ? '11 · Asynchronous message expiry and loss' : '08 · Outcome: individual failures amid traffic'}</h2>
      <div className="flex gap-1" role="group" aria-label={retry ? 'Retry traffic level' : variant === 'timeout' ? 'Timeout traffic level' : variant === 'expiry' ? 'Expiry traffic level' : 'Failure traffic level'}>
        <Button size="sm" variant={!high ? 'tint' : 'ghost'} aria-pressed={!high} onClick={() => setHigh(false)}>Low traffic</Button>
        <Button size="sm" variant={high ? 'tint' : 'ghost'} aria-pressed={high} onClick={() => setHigh(true)}>High traffic</Button>
        <Button size="icon" variant="ghost" aria-label={playing ? 'Pause illustrative motion' : 'Resume illustrative motion'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause /> : <Play />}</Button>
      </div>
    </div>
    {variant === 'failure' && <div className="my-3 flex flex-wrap gap-1" role="group" aria-label={retry ? 'Retry stage' : 'Failure cause'}>
      {retry ? [['failed', 'Attempt failed'], ['backoff', 'Retry delay'], ['retrying', 'Attempt 2 travelling'], ['recovered', 'Recovered']].map(([value, label]) => <Button key={value} size="sm" variant={stage === value ? 'tint' : 'ghost'} aria-pressed={stage === value} onClick={() => setStage(value)}>{label}</Button>) : ['Processing failure', 'Admission rejection'].map(value => <Button key={value} size="sm" variant={cause === value ? 'tint' : 'ghost'} aria-pressed={cause === value} onClick={() => setCause(value)}>{value}</Button>)}
    </div>}
    <p className="mb-2 text-xs text-secondary-text">{variant === 'timeout' ? `${high ? 6 : 1} caller deadlines; downstream work remains independent` : variant === 'expiry' ? `${high ? 6 : 1} affected messages${high ? '; 2 unrelated requests continue processing' : ''}` : high ? '6 affected requests; 2 unrelated requests continue processing' : '1 affected request'} · {retry ? 'retries belong to the same logical requests' : 'work outcome, not a node outage'}</p>
    {variant === 'timeout' && <div className="mb-3 flex gap-1" role="group" aria-label="Deadline stage"><Button size="sm" variant={stage === 'waiting' ? 'tint' : 'ghost'} aria-pressed={stage === 'waiting'} onClick={() => setStage('waiting')}>Before deadline</Button><Button size="sm" variant={stage === 'failed' ? 'tint' : 'ghost'} aria-pressed={stage === 'failed'} onClick={() => setStage('failed')}>Deadline elapsed</Button></div>}
    {variant === 'expiry' && <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Message TTL stage"><Button size="sm" variant={stage === 'waiting' ? 'tint' : 'ghost'} aria-pressed={stage === 'waiting'} onClick={() => setStage('waiting')}>Before expiry</Button><Button size="sm" variant={stage === 'failed' ? 'tint' : 'ghost'} aria-pressed={stage === 'failed'} onClick={() => setStage('failed')}>TTL elapsed</Button><Button size="sm" variant={stage === 'lost' ? 'tint' : 'ghost'} aria-pressed={stage === 'lost'} onClick={() => setStage('lost')}>Known delivery loss</Button></div>}
    {variant !== 'failure' && <p className="mb-2 text-xs text-secondary-text">{variant === 'timeout' ? 'A caller timeout does not cancel work already executing downstream. No response is fabricated.' : 'Expiry happens while waiting for local processing; recorded delivery loss belongs on the connection. Caller response remains complete; no synchronous wait is reopened.'}</p>}
    <FaultContext.Provider value={{ retry, stage, cause, high, variant, liveAffected: -1 }}>
      <ExampleContext.Provider value={{ ...defaults, count: high ? 6 : 1, phase: stage === 'retrying' ? 'transport' : 'delivered', progress, asynchronous: variant === 'expiry' }}>
        <PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
          <div id={canvasId} className="border border-divider bg-canvas" style={{ height: 280 }}>
            <ReactFlow nodes={idleNodes} edges={idleEdges} nodeTypes={faultNodeTypes} edgeTypes={faultEdgeTypes} minZoom={0.1} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={canvasId} /></ReactFlow>
          </div>
        </PlaybackTrafficContext.Provider>
      </ExampleContext.Provider>
    </FaultContext.Provider>
    {retry && stage === 'recovered' && <p className="mt-2 text-xs text-primary">{high ? 6 : 1} logical requests recovered on attempt 2; no additional logical requests created.</p>}
    <p className="mt-3 text-sm text-secondary-text">{retry ? 'The caller owns retry scheduling. Backoff has no moving traffic; the next attempt travels forward. Recovery clears the retry state. Attempt outcomes stay distinct from final request outcomes.' : variant === 'timeout' ? 'The deadline belongs to the caller. Work already admitted downstream is not automatically cancelled; late responses and cancellation need their own recorded events.' : variant === 'expiry' ? 'Expiry removes queued messages before processing. Known loss is an explicit recorded delivery outcome; absence of an arrival alone does not prove loss.' : 'Red marks affected work at its failure location. Rejection means work never entered local processing. Other requests can keep processing on the same node; its architecture colour remains unchanged.'}</p>
  </section>;
}

type LabPopulation = { label: string; detail: string; tone: 'wait' | 'process' | 'queue' | 'error' | 'event'; slots?: number };
type LabFrame = { label: string; summary: string; phase?: ExamplePhase; direction?: TravelDirection; count?: number; asynchronous?: boolean; caller?: LabPopulation[]; receiver?: LabPopulation[]; third?: LabPopulation[]; edgeEvent?: string; nodeEvent?: string; blockedEdge?: string };
type PendingCase = { id: string; title: string; note: string; frames: (high: boolean) => LabFrame[] };
const pendingCases: PendingCase[] = [
  { id: 'arrival', title: '12 · Request arrival and admission', note: 'Arrival and admission are different instants. A request can arrive and join a queue without starting processing. Event cues describe this frame, not cumulative arrivals.', frames: high => {
    const n = high ? 12 : 1;
    return [
      { label: 'Arriving', summary: `${n} requests travelling to the receiver`, phase: 'transport', count: n, caller: [{ label: `${n} awaiting responses`, detail: 'Requests still in transit', tone: 'wait' }] },
      { label: 'Admitted to queue', summary: 'Arrival recorded; no local slot available', nodeEvent: `+${n} arrived`, receiver: [{ label: `${n} queued`, detail: 'Admitted to local queue; not yet processing', tone: 'queue' }, { label: '4 processing', detail: 'Four slots occupied by other work', tone: 'process', slots: 4 }], caller: [{ label: `${n} awaiting responses`, detail: 'Arrival does not complete a call', tone: 'wait' }] },
      { label: 'Processing admitted', summary: 'A local processing slot became available', receiver: [{ label: `${high ? 4 : 1} processing`, detail: high ? '8 remain queued' : 'Queue is now empty', tone: 'process', slots: high ? 4 : 1 }, ...(high ? [{ label: '8 queued', detail: 'Waiting for a free slot', tone: 'queue' as const }] : [])], caller: [{ label: `${n} awaiting responses`, detail: 'Work admitted; response still pending', tone: 'wait' }] },
    ];
  } },
  { id: 'error-response', title: '13 · Error response returning', note: 'An error response travels back just like a successful response. Failure of a call does not imply a node outage. Delivered errors clear that caller’s pending response wait.', frames: high => {
    const n = high ? 6 : 1;
    return [
      { label: 'Error travelling', summary: `${n} error responses returning to the caller`, phase: 'transport', direction: 'backward', count: n, edgeEvent: `${n} error responses`, caller: [{ label: `${n} awaiting responses`, detail: 'The error has not arrived yet', tone: 'wait' }] },
      { label: 'Error delivered', summary: 'Terminal call outcome at the caller; nodes can be idle', nodeEvent: undefined, caller: [{ label: `${n} calls failed`, detail: 'Error response delivered in this frame; no response wait remains', tone: 'error' }] },
      { label: 'After event', summary: 'No current work; failure remains in inspection history' },
    ];
  } },
  { id: 'redelivery', title: '14 · Message acknowledgement and redelivery', note: 'Acknowledgement is a recorded return, not a synchronous API response or proof of business side-effect success. Redelivery retains the same logical message ID and can duplicate side effects unless the receiver handles duplicates. Missing acknowledgement alone does not prove loss.', frames: high => {
    const n = high ? 4 : 1;
    return [
      { label: 'Acknowledgement travelling', summary: `${n} acknowledgements returning to the publisher`, phase: 'transport', direction: 'backward', count: n, asynchronous: true, edgeEvent: 'Acknowledgement' },
      { label: 'Acknowledgement lost', summary: 'Recorded acknowledgement loss; sender has no settlement confirmation', asynchronous: true, edgeEvent: `${n} acknowledgements lost` },
      { label: 'Redelivery delay', summary: 'Settlement unconfirmed after recorded acknowledgement loss; messages scheduled again', asynchronous: true, caller: [{ label: `${n} redeliveries scheduled`, detail: 'Same message IDs; waiting for redelivery delay', tone: 'queue' }] },
      { label: 'Redelivery travelling', summary: 'Delivery attempt 2; no new logical messages', asynchronous: true, phase: 'transport', count: n, edgeEvent: 'Delivery attempt 2' },
      { label: 'Duplicate delivery observed', summary: 'Same message IDs delivered again; no idempotency assumed', asynchronous: true, receiver: [{ label: `${n} duplicate deliveries`, detail: 'Observed additional delivery attempts of the same messages; side effects may repeat', tone: 'event' }] },
      { label: 'Acknowledged', summary: 'Delivery acknowledged; no transport or pending redelivery', asynchronous: true },
    ];
  } },
  { id: 'stuck', title: '15 · Recorded stuck work', note: 'Stuck means the recording reports work that cannot progress. A long wait or lack of animation alone is insufficient. The affected work and its blocking location remain explicit.', frames: high => {
    const n = high ? 6 : 1;
    return [
      { label: 'Dependency blocked', summary: 'Recorded unavailable dependency route: Payment → Fraud check', caller: [{ label: `${n} awaiting responses`, detail: 'Payment service is blocked on its dependency', tone: 'wait' }], receiver: [{ label: `${n} requests stuck waiting`, detail: 'Recorded blocked route to Fraud check service', tone: 'error' }], third: [], blockedEdge: 'fraud-call', edgeEvent: 'Dependency route blocked' },
      { label: 'Delivery blocked', summary: 'Recorded message delivery cannot progress', asynchronous: true, edgeEvent: `${n} deliveries stuck` },
      { label: 'Unblocked', summary: 'Blocking condition cleared; actual work resumes', receiver: [{ label: `${high ? 4 : 1} processing`, detail: high ? '2 queued; resumed work is separate from its earlier stuck event' : 'Resumed local work', tone: 'process', slots: high ? 4 : 1 }, ...(high ? [{ label: '2 queued', detail: 'Awaiting a slot', tone: 'queue' as const }] : [])] },
    ];
  } },
  { id: 'concurrent', title: '16 · Processing, queued and waiting together', note: 'These are separate request populations. A waiting request is not also counted as a locally processing request in this frame. Counts on different hops are never summed as distinct root requests.', frames: high => {
    const p = high ? 4 : 1, q = high ? 80 : 1, w = high ? 20 : 1;
    return [{ label: 'Concurrent populations', summary: `${p + q + w} caller requests pending; receiver has three independent populations`, caller: [{ label: `${p + q + w} awaiting responses`, detail: `${p} processing + ${q} queued + ${w} aawaiting responses`, tone: 'wait' }], receiver: [{ label: `${p} processing`, detail: `${p} / 4 local slots occupied`, tone: 'process', slots: p }, { label: `${q} queued`, detail: `${q} / 100 queue capacity`, tone: 'queue' }, { label: `${w} awaiting responses`, detail: `Fraud check service · ${w} pending calls`, tone: 'wait' }], third: [{ label: `${high ? 4 : 1} processing`, detail: 'Local downstream work', tone: 'process', slots: high ? 4 : 1 }, ...(high ? [{ label: '16 queued', detail: 'Remaining downstream calls', tone: 'queue' as const }] : [])] }];
  } },
  { id: 'late-cancel', title: '17 · Late response and recorded cancellation', note: 'A late response does not reverse the caller’s timeout. Cancellation only changes downstream work when a cancellation event is recorded; a caller timeout is not cancellation.', frames: high => {
    const n = high ? 4 : 1;
    return [
      { label: 'Late response travelling', summary: 'Caller already timed out; late return does not reopen its wait', phase: 'transport', direction: 'backward', count: n, edgeEvent: `${n} late responses` },
      { label: 'Late response delivered', summary: 'Ignored late response at the caller, retained in inspection history', caller: [{ label: `${n} late responses ignored`, detail: 'Caller timeout remains terminal; no response wait reopened', tone: 'event' }] },
      { label: 'Cancellation requested', summary: 'Caller requested cancellation; downstream still processing', edgeEvent: 'Cancellation requested', receiver: [{ label: `${n} processing`, detail: 'No downstream cancellation recorded yet', tone: 'process', slots: n }] },
      { label: 'Cancellation recorded', summary: 'Affected work cancelled downstream; no fabricated response', receiver: [{ label: `${n} cancelled`, detail: 'Explicit recorded cancellation event in this frame', tone: 'event' }] },
      { label: 'After cancellation', summary: 'No affected work remains active' },
    ];
  } },
  { id: 'exhausted', title: '18 · Retry and redelivery exhausted', note: 'Attempt failure, retry scheduling and final logical failure are distinct. Exhaustion is terminal; no new attempt or retry delay remains. Cumulative attempt counts belong in inspection.', frames: high => {
    const n = high ? 6 : 1;
    return [
      { label: 'Retries exhausted', summary: 'Last allowed attempt failed; logical requests ended', caller: [{ label: `${n} retries exhausted`, detail: 'Final request failure; no more attempts scheduled', tone: 'error' }] },
      { label: 'Redeliveries exhausted', summary: 'Publisher-side message delivery policy exhausted; no synchronous caller wait', asynchronous: true, caller: [{ label: `${n} publisher delivery failures`, detail: 'Redeliveries exhausted; no dead-letter destination assumed', tone: 'error' }] },
      { label: 'After terminal event', summary: 'Current work is idle; final outcome remains inspectable' },
    ];
  } },
];
const PendingContext = createContext<LabFrame>({ label: '', summary: '' });
function PendingNode(props: NodeProps) {
  const frame = useContext(PendingContext);
  const [expanded, setExpanded] = useState(false);
  const populations = props.id === 'idle-0' ? frame.caller : props.id === 'idle-1' ? frame.receiver : frame.third;
  const colors = { wait: ['#4338CA', '#EEF2FF'], process: ['#047857', '#ECFDF5'], queue: ['var(--color-warning)', '#FFF7ED'], error: ['var(--color-danger, #B91C1C)', '#FEF2F2'], event: ['var(--color-secondary-text)', 'var(--color-sunken)'] };
  return <div className="traffic-lab-node nodrag nopan" tabIndex={populations?.length ? 0 : undefined} data-expanded={expanded} onClick={() => setExpanded(value => !value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(value => !value); } }} style={{ pointerEvents: 'auto' }}>
    <NodeCard {...props} />
    {populations?.map((population, index) => <div key={index} data-waiting-footer="" className="border-t border-divider px-3 py-2 text-xs" style={{ color: colors[population.tone][0], background: colors[population.tone][1] }}>
      <div className="flex items-center gap-1 font-medium">{population.tone === 'process' ? <Cpu size={14} /> : population.tone === 'queue' ? <ListOrdered size={14} /> : population.tone === 'error' ? <TriangleAlert size={14} /> : population.tone === 'event' ? <Check size={14} /> : <Clock size={14} />}{population.label}</div>
      <div className="mt-2">{population.detail}</div>
      {population.slots !== undefined && <div className="mt-2 flex gap-1" role="img" aria-label={`${population.slots} of 4 slots occupied`}>{Array.from({ length: 4 }, (_, i) => <span key={i} className="h-4 flex-1 rounded-sm" style={{ border: '1px solid #A7F3D0', background: i < population.slots! ? '#6EE7B7' : '#FFFFFF' }} />)}</div>}
    </div>)}
    {frame.nodeEvent && props.id === 'idle-1' && <span className="absolute -top-4 right-0 bg-shell px-1 text-xs text-primary">{frame.nodeEvent}</span>}
  </div>;
}
function PendingEdge(props: EdgeProps) {
  const frame = useContext(PendingContext);
  const [, x, y] = getSmoothStepPath(props);
  return <><ExampleEdge {...props} labelOverride={frame.asynchronous && frame.label.startsWith('Acknowledgement') ? 'acknowledgement · AMQP' : undefined} />{frame.edgeEvent && (!frame.blockedEdge || frame.blockedEdge === props.id) && <EdgeLabelRenderer><div className="absolute rounded-sm bg-shell px-2 py-1 text-xs" style={{ color: frame.edgeEvent.includes('attempt') || frame.edgeEvent === 'Acknowledgement' ? 'var(--color-primary)' : 'var(--color-danger, #B91C1C)', transform: `translate(-50%, 0) translate(${x}px, ${y + 8}px)` }}>{frame.edgeEvent}</div></EdgeLabelRenderer>}</>;
}
const pendingNodeTypes = { element: PendingNode };
const pendingEdgeTypes = { traffic: PendingEdge };
const LiveCanvasContext = createContext({ forward: 0, backward: 0 });
function SharedLiveEdge(props: EdgeProps) {
  const defaults = useContext(ExampleContext);
  const { forward, backward } = useContext(LiveCanvasContext);
  return <ExampleContext.Provider value={{ ...defaults, queued: false, phase: forward || backward ? 'transport' : 'delivered', direction: forward && backward ? 'dual' : backward ? 'backward' : 'forward' }}><PendingEdge {...props} /></ExampleContext.Provider>;
}
const sharedLiveEdgeTypes = { traffic: SharedLiveEdge };
function SharedLiveCanvas({ state, frame, progress }: { state: number; frame: LiveFrame; progress: number }) {
  const defaults = useContext(ExampleContext);
  const n = (rows: LiveFrame['caller'], label: string) => Number(rows.find(row => row.label === label)?.value.match(/^[\d,]+/)?.[0].replaceAll(',', '') ?? 0);
  const active = frame.caller.length > 0 || frame.receiver.length > 0 || frame.forward > 0 || frame.backward > 0;
  const queued = state === 2;
  const phase: ExamplePhase = state === 4 ? 'dependency' : state === 3 || state === 6 ? 'processing' : state === 5 ? 'transport' : 'transport';
  const count = queued ? n(frame.receiver, 'Queued') : state === 3 || state === 6 ? n(frame.receiver, 'Processing') : n(frame.caller, 'Awaiting responses') || n(frame.receiver, 'Awaiting responses') || Math.max(1, Math.round(frame.forward * 0.12));
  const populations = (rows: LiveFrame['caller']): LabPopulation[] => rows.map(row => ({
    label: `${row.value.replace(/ \/ (?:4 slots|100)$/, '')} ${row.label.toLowerCase()}`,
    detail: row.label === 'Awaiting responses' ? 'Outstanding synchronous calls' : row.label === 'Processing' ? `${n(rows, 'Processing')} / 4 local slots occupied` : row.label === 'Queued' ? `${n(rows, 'Queued')} / 100 queue capacity` : 'Fixed one-second event rate',
    tone: row.tone === 'work' ? row.label === 'Processing' ? 'process' : 'event' : row.tone,
    slots: row.label === 'Processing' ? n(rows, 'Processing') : undefined,
  }));
  const template = state >= 11 ? pendingCases[state - 11].frames(count > 1)[0] : undefined;
  const pending: LabFrame = { label: state === 13 ? 'Acknowledgement' : '', summary: '', caller: populations(frame.caller), receiver: populations(frame.receiver), asynchronous: state === 13,
    third: template?.third ? count > 0 && active ? [{ label: `${Math.min(4, count)} processing`, detail: 'Local downstream work', tone: 'process', slots: Math.min(4, count) }, ...(count > 4 ? [{ label: `${Math.min(100, count - 4)} queued`, detail: 'Waiting for a local slot', tone: 'queue' as const }] : [])] : [] : undefined,
    edgeEvent: state === 14 && active ? 'Dependency route blocked' : undefined, blockedEdge: state === 14 ? 'fraud-call' : undefined,
  };
  const variant = state === 9 ? 'timeout' : state === 10 ? 'expiry' : 'failure';
  const cause = state === 9 ? 'Deadline timeout' : state === 10 ? 'Message expiry' : 'Processing failure';
  const asynchronous = state === 6 || state === 10 || state === 13;
  const nodes = (state === 4 || pending.third ? dependencyNodes : idleNodes).map(node => asynchronous ? { ...node, data: { ...node.data, element: { ...(node.data.element as Record<string, unknown>), label: node.id === 'idle-0' ? 'Message publisher' : 'Message consumer' } } } : node);
  const canvasId = `live-state-canvas-${state}`;
  const affected = state === 8 ? n(frame.caller, 'Retries scheduled') : Number([...frame.caller, ...frame.receiver].find(row => row.tone === 'error')?.value.match(/^[\d,]+/)?.[0].replaceAll(',', '') ?? 0);
  return <PendingContext.Provider value={pending}><FaultContext.Provider value={{ retry: state === 8, stage: state === 8 ? 'backoff' : 'failed', cause, high: affected > 1, variant, liveAffected: affected }}><ExampleContext.Provider value={{ ...defaults, count, queued, phase, progress, asynchronous, direction: state === 5 ? 'backward' : 'forward', liveProcessing: Math.min(4, Math.max(1, count)) }}><LiveCanvasContext.Provider value={frame}><PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
    <div id={canvasId} className="mt-3 border border-divider bg-canvas" style={{ height: state >= 11 ? 400 : state === 4 || state === 2 ? 360 : 280 }}><ReactFlow nodes={nodes} edges={state === 4 || pending.third ? dependencyEdges : idleEdges} nodeTypes={!active ? nodeTypes : state >= 11 ? pendingNodeTypes : state >= 7 ? faultNodeTypes : exampleNodeTypes} edgeTypes={sharedLiveEdgeTypes} minZoom={0.1} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={canvasId} reserveFooter={state >= 11 ? 360 : state === 2 ? 280 : 220} /></ReactFlow></div>
  </PlaybackTrafficContext.Provider></LiveCanvasContext.Provider></ExampleContext.Provider></FaultContext.Provider></PendingContext.Provider>;
}
function PendingExample({ definition }: { definition: PendingCase }) {
  const defaults = useContext(ExampleContext);
  const [high, setHigh] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0.4);
  const frame = definition.frames(high)[index];
  useEffect(() => {
    if (!playing || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setProgress(value => (value + 0.015) % 1), 50);
    return () => clearInterval(timer);
  }, [playing]);
  const canvasId = `${definition.id}-state-canvas`;
  return <section className="border-b border-border py-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{definition.title}</h2><div className="flex gap-1" role="group" aria-label={`${definition.id} traffic level`}>
      <Button size="sm" variant={!high ? 'tint' : 'ghost'} aria-pressed={!high} onClick={() => setHigh(false)}>Low traffic</Button><Button size="sm" variant={high ? 'tint' : 'ghost'} aria-pressed={high} onClick={() => setHigh(true)}>High traffic</Button><Button size="icon" variant="ghost" aria-label={playing ? 'Pause illustrative motion' : 'Resume illustrative motion'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause /> : <Play />}</Button>
    </div></div>
    <div className="my-3 flex flex-wrap gap-1" role="group" aria-label={`${definition.id} stage`}>{definition.frames(high).map((item, i) => <Button key={item.label} size="sm" variant={index === i ? 'tint' : 'ghost'} aria-pressed={index === i} onClick={() => setIndex(i)}>{item.label}</Button>)}</div>
    <p className="mb-2 text-xs text-secondary-text">{frame.summary}</p>
    <PendingContext.Provider value={frame}><ExampleContext.Provider value={{ ...defaults, phase: frame.phase ?? 'delivered', direction: frame.direction ?? 'forward', asynchronous: frame.asynchronous ?? false, count: frame.count ?? 1, progress }}><PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
      <div id={canvasId} className="border border-divider bg-canvas" style={{ height: frame.third ? 360 : 280 }}><ReactFlow key={frame.third ? 'three' : 'two'} nodes={(frame.third ? dependencyNodes : idleNodes).map(node => frame.asynchronous ? { ...node, data: { ...node.data, element: { ...(node.data.element as Record<string, unknown>), label: node.id === 'idle-0' ? 'Message publisher' : 'Message consumer' } } } : node)} edges={frame.third ? dependencyEdges : idleEdges} nodeTypes={pendingNodeTypes} edgeTypes={pendingEdgeTypes} minZoom={0.1} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={canvasId} /></ReactFlow></div>
    </PlaybackTrafficContext.Provider></ExampleContext.Provider></PendingContext.Provider>
    <p className="mt-3 text-sm text-secondary-text">{definition.note}</p>
  </section>;
}

const groups = [
  { title: 'Node activity', rows: [
    ['Idle', 'No local processing, queued work or pending dependencies.'],
    ['Queued', 'Work waiting for local admission or a processing slot.'],
    ['Processing', 'Work executing locally.'],
    ['Awaiting responses', 'Requests with outstanding synchronous calls; one request can await several responses.'],
  ], note: 'A node can process some requests, queue others and await dependencies simultaneously. These are separate populations, not exclusive node modes.' },
  { title: 'Connection activity', rows: [
    ['Idle', 'No work travelling on this connection.'],
    ['Request travelling', 'Caller → receiver.'],
    ['Response travelling', 'Receiver → caller, including error responses.'],
    ['Message travelling', 'Asynchronous delivery → receiver; acknowledgement is a separate return if recorded.'],
  ], note: 'Both directions can be active simultaneously. Concurrency changes how activity is summarized, not its meaning.' },
  { title: 'Events and outcomes', rows: [
    ['Arrival / response delivered', 'An instant in a journey, not persistent node health.'],
    ['Success / failure', 'Outcome of a particular request, attempt or delivery.'],
    ['Rejected / timeout / expired / lost / stuck', 'Distinct causes; keep their affected work and location explicit.'],
    ['Retry / redelivery', 'A new attempt belonging to the same logical work.'],
  ], note: 'A failed request does not mean a node is down. A delivered response does not mean asynchronous side effects are finished.' },
] as const;

function TrafficStateLab() {
  return <main className="bg-shell text-ink min-h-screen p-4" style={{ maxWidth: 1000, margin: '0 auto' }}>
    <style>{`
      .traffic-lab-node { width: 220px; min-width: 0; overflow-wrap: anywhere; pointer-events: auto; }
      .traffic-lab-node > div { pointer-events: auto; }
      .traffic-lab-node > .component-node { position: relative; z-index: 1; }
      .traffic-lab-node > .component-node + div { margin-top: -8px; padding-top: 16px; border-top-width: 0; }
      .traffic-lab-node > div:last-child:not(.component-node):not(.traffic-lab-node) { border-radius: 0 0 8px 8px; }
      .traffic-lab-node:not(:hover):not(:focus-within):not([data-expanded="true"]) > :is([data-waiting-footer], [data-dependency-footer], [data-processing-footer], [data-queue-footer]) > :not(:first-child) { display: none; }
      .traffic-lab-node:focus-visible { outline: 2px solid #6366F1; outline-offset: 3px; }
    `}</style>
    <header className="border-b border-border pb-3">
      <h1 className="text-lg font-semibold">Traffic state lab</h1>
      <p className="mt-1 text-sm text-secondary-text">One state at a time. Current activity follows the playhead; cumulative summaries stay separate.</p>
      <p className="mt-2 text-sm text-secondary-text">Each example is a journey snapshot, not one shared state for the whole canvas. Nodes show local work and pending dependencies. Connections show transport. Those conditions coexist.</p>
    </header>
    {[
      <IdleExample />, <ActiveExample queued={false} />, <ActiveExample queued />,
      <ActiveExample phase="processing" />, <ActiveExample phase="dependency" />,
      <CompletionExample />, <CompletionExample asynchronous />, <FaultExample />,
      <FaultExample retry />, <FaultExample variant="timeout" />, <FaultExample variant="expiry" />,
      ...pendingCases.map(definition => <PendingExample key={definition.id} definition={definition} />),
    ].map((example, state) => <StateLoadExample key={state} state={state} renderCanvas={(frame, progress) => <SharedLiveCanvas state={state} frame={frame} progress={progress} />}>{example}</StateLoadExample>)}
    <section className="border-b border-border py-3 text-sm text-secondary-text">
      <p>Low and high traffic must share an understandable visual language. Shades, pulses and directional gradient animation are candidates for active states; motion freezes when playback pauses.</p>
      <p className="mt-2">Timeline zoom changes neither current activity nor cumulative totals. Historical spike placement on the canvas versus timeline inspection is deferred.</p>
    </section>
    {groups.map(group => <section key={group.title} className="border-b border-border py-4">
      <h2 className="text-sm font-semibold">{group.title} <span className="font-normal text-secondary-text">· proposed</span></h2>
      <dl className="mt-2 text-sm">
        {group.rows.map(([name, meaning]) => <div key={name} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 30%) minmax(0, 1fr)', gap: 12 }} className="py-2">
          <dt className="font-medium">{name}</dt><dd className="text-secondary-text">{meaning}</dd>
        </div>)}
      </dl>
      <p className="mt-2 text-xs text-secondary-text">{group.note}</p>
    </section>)}
    <section className="border-b border-border py-4 text-sm">
      <h2 className="font-semibold">Future scope</h2>
      <p className="mt-2 text-secondary-text">State transition design, including response-delivery acknowledgements, arrival count placement, repeated events under load and their timing, is deferred. Historical spike placement remains deferred.</p>
    </section>
    <section className="py-4 text-sm">
      <h2 className="font-semibold">Review sequence</h2>
      <p className="mt-2 text-secondary-text">Idle → one request travelling → queued → processing → awaiting responses → response travelling → response delivered → asynchronous work → concurrent traffic → failures and retries.</p>
      <p className="mt-2 text-secondary-text">Run lifecycle, playback, selection and traffic volume are shared context. They should not multiply the basic node and connection states.</p>
    </section>
  </main>;
}

const meta = { title: 'Workspace/Traffic state lab', component: TrafficStateLab, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TrafficStateLab>;
export default meta;
type Story = StoryObj<typeof meta>;
export const StateDefinitions: Story = {};

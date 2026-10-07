// Reusable current traffic presentation, independent of Storybook.
import { createContext, useContext, useEffect, useId, useMemo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type Node, type Edge, type NodeProps, type EdgeProps } from '@xyflow/react';
import { Clock, ListOrdered, Cpu, TriangleAlert } from 'lucide-react';
import { NodeCard } from '@/features/workspace/NodeCard';
import { TrafficEdge } from '@/features/workspace/TrafficEdge';

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

// Design-only frames: no simulation accounting or production rendering changes.
type ExamplePhase = 'transport' | 'processing' | 'dependency' | 'delivered';
type TravelDirection = 'forward' | 'backward' | 'dual';
export const currentTrafficMotionDefaults = { count: 1, queued: false, progress: 0.4, phase: 'transport' as ExamplePhase, multiple: false, oneReturned: false, mixed: false, direction: 'forward' as TravelDirection, asynchronous: false, liveProcessing: -1 };
const ExampleContext = createContext(currentTrafficMotionDefaults);
// Independent current populations for the design-system specimens.
export interface CurrentTrafficActivity {
  processing: number; queued: number; awaiting: number;
  services?: { name: string; count: number }[];
  retries?: number;
  outcome?: { label: string; metric: string; detail: string; waiting?: boolean; items?: { label: string; metric: string }[] };
  stuck?: number;
}
export const CurrentPopulationContext = createContext<CurrentTrafficActivity | null>(null);
function DependencyFooter() {
  const { count, oneReturned, mixed } = useContext(ExampleContext);
  const fraudPending = count - (oneReturned ? 1 : 0);
  const ordersPending = count === 4 ? 3 : 1;
  const callsPending = fraudPending + ordersPending;
  return <div className="nodrag nopan border-t border-divider px-3 py-2 text-xs" data-dependency-footer="" style={{ pointerEvents: 'auto', color: '#4338CA', background: '#EEF2FF', borderRadius: mixed ? 0 : '0 0 8px 8px' }}>
    <div className="flex items-center justify-between gap-1">
      <span className="flex items-center gap-1 font-medium"><Clock size={14} />{callsPending} awaiting responses</span>
    </div>
    {fraudPending > 0 && <div className="flex items-center justify-between gap-2 border-t pt-2" style={{ borderColor: '#C7D2FE' }}><span>Fraud check</span><span>{fraudPending} pending {fraudPending === 1 ? 'call' : 'calls'}</span></div>}
    <div className="mt-2 flex items-center justify-between gap-2"><span>Orders service</span><span>{ordersPending} pending {ordersPending === 1 ? 'call' : 'calls'}</span></div>

  </div>;
}
function ExampleNode(props: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const current = useContext(CurrentPopulationContext);
  const { count, queued, progress, phase, multiple, oneReturned, mixed, direction, asynchronous, liveProcessing } = useContext(ExampleContext);
  const receiver = props.id === 'idle-1';
  const dependency = phase === 'dependency';
  const localProcessing = dependency && mixed ? (count === 4 ? 2 : 1) : 0;
  const processCount = current?.processing ?? (queued && receiver ? liveProcessing >= 0 ? liveProcessing : 4 : multiple && props.id === 'idle-3' ? 4 : dependency && receiver ? localProcessing : liveProcessing >= 0 && receiver ? liveProcessing : multiple && props.id === 'idle-2' ? count - (oneReturned ? 1 : 0) : count);
  const processing = current ? processCount > 0 : processCount > 0 && ((phase === 'processing' && receiver) || (dependency && (props.id === 'idle-2' || receiver)) || (queued && receiver) || (multiple && props.id === 'idle-3'));
  const awaiting = current ? current.awaiting > 0 : (!asynchronous && phase !== 'delivered' && props.id === 'idle-0') || (dependency && receiver);
  const awaitedService = dependency && receiver ? 'Fraud check service' : 'Payment service';
  const waiting = current?.queued ?? (multiple && props.id === 'idle-3' ? (count === 4 ? 3 : 1) : queued && receiver ? count : 0);
  const pressure = waiting >= 50;
  const pending = current?.awaiting ?? (queued ? count + (liveProcessing >= 0 ? liveProcessing : 4) : count * (phase === 'transport' && direction === 'dual' ? 2 : 1) + (props.id === 'idle-0' ? localProcessing : 0));
  const pulse = 0.5 + Math.sin(progress * Math.PI * 2) * 0.5;
  const active = awaiting || processing || waiting > 0 || Boolean(current?.outcome) || Boolean(current?.retries);
  return <div className="traffic-lab-node nodrag nopan" data-expanded={expanded} tabIndex={active ? 0 : undefined} role="group" aria-label={active ? 'Node activity; hover or focus for details, tap to keep expanded' : undefined}
    onClick={event => { if (!(event.target as HTMLElement).closest('button')) setExpanded(value => !value); }}
    onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setExpanded(value => !value); } }}
    style={{ borderRadius: 8, pointerEvents: 'auto',
    background: 'var(--color-shell)',
  }}>
    <NodeCard {...props} />

    {awaiting && !(multiple && receiver) && <div data-waiting-footer="" className="border-t border-divider px-3 py-2 text-xs" style={{ color: '#4338CA', background: '#EEF2FF', borderRadius: processing ? 0 : '0 0 8px 8px' }} title={`Outstanding synchronous calls to ${awaitedService}. Awaiting response includes work in transit, queued and processing; it is not an in-flight count.`}>
      <div className="flex items-center gap-1 font-medium"><Clock size={14} />{pending} awaiting responses</div>
      {current?.services ? current.services.filter(service => service.count > 0).map(service => <div key={service.name} className="mt-1 flex justify-between gap-2 text-secondary-text"><span>{service.name}</span><span>{service.count} pending</span></div>) : <div className="mt-1 text-secondary-text">From {awaitedService}</div>}
      {!!current?.stuck && <div className="mt-1 text-secondary-text">{current.stuck} with recorded no progress</div>}
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

    </div>}
    {!!current?.retries && <div data-waiting-footer="" data-retry-footer="" className="px-3 py-2 text-xs" style={{ color: 'var(--color-warning)', background: '#FFF7ED' }}><div className="font-medium">{current.retries} retries scheduled</div><div className="mt-2 text-secondary-text">Waiting for next eligible attempts</div></div>}
    {current?.outcome && <div data-waiting-footer="" data-outcome-footer="" className="px-3 py-2 text-xs" style={{ color: current.outcome.waiting ? '#4338CA' : 'var(--color-danger, #B91C1C)', background: current.outcome.waiting ? '#EEF2FF' : '#FEF2F2' }}>
      <div>{(current.outcome.items ?? [{ label: current.outcome.label, metric: current.outcome.metric }]).map(item => <div key={item.label} className="flex items-center justify-between gap-2" style={{ color: item.label === 'Success' ? '#047857' : item.label === 'Cancelled' ? 'var(--color-secondary-text)' : ['Expired', 'Timeouts'].includes(item.label) ? 'var(--color-warning)' : undefined }}><span className="font-medium">{item.label}</span><span className="font-mono">{item.metric}</span></div>)}</div>
      <div className="mt-2 text-secondary-text">{current.outcome.detail}</div>
    </div>}
  </div>;
}
function ExampleEdge(props: EdgeProps & { labelOverride?: string }) {
  const { count, queued, progress, phase, direction, asynchronous } = useContext(ExampleContext);
  const [path, x, y] = getSmoothStepPath(props);
  const geometry = useMemo(() => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    element.setAttribute('d', path);
    return { element, length: element.getTotalLength() };
  }, [path]);
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
          const point = geometry.element.getPointAtLength(geometry.length * (reverse ? 1 - position : position));
          return <circle key={index} cx={point.x} cy={point.y} r={2.5} fill={color} stroke="var(--color-canvas)" strokeWidth={1} />;
        })}</g>
      </g>;
    })}
    <EdgeLabelRenderer><div className="absolute rounded-sm border border-divider bg-shell px-2 py-1 text-xs text-secondary-text" style={{ transform: `translate(-50%, -100%) translate(${x}px,${y - 16}px)` }}>
      {props.labelOverride ?? (asynchronous ? direction === 'backward' ? 'acknowledgement · AMQP' : 'message · AMQP' : 'call · HTTP / REST')}
    </div></EdgeLabelRenderer>
  </>;
}
const exampleNodeTypes = { element: ExampleNode };
const exampleEdgeTypes = { traffic: ExampleEdge };
type LabPopulation = { label: string; detail: string; tone: 'wait' | 'process' | 'queue' | 'error' | 'event'; slots?: number };
type LabFrame = { label: string; summary: string; phase?: ExamplePhase; direction?: TravelDirection; count?: number; asynchronous?: boolean; caller?: LabPopulation[]; receiver?: LabPopulation[]; third?: LabPopulation[]; edgeEvent?: string; blockedEdge?: string };
const PendingContext = createContext<LabFrame>({ label: '', summary: '' });
function PendingNode(props: NodeProps) {
  const frame = useContext(PendingContext);
  const [expanded, setExpanded] = useState(false);
  const populations = props.id === 'idle-0' ? frame.caller : props.id === 'idle-1' ? frame.receiver : frame.third;
  const colors = { wait: ['#4338CA', '#EEF2FF'], process: ['#047857', '#ECFDF5'], queue: ['var(--color-warning)', '#FFF7ED'], error: ['var(--color-danger, #B91C1C)', '#FEF2F2'], event: ['var(--color-secondary-text)', 'var(--color-sunken)'] };
  return <div className="traffic-lab-node nodrag nopan" tabIndex={populations?.length ? 0 : undefined} data-expanded={expanded} onClick={() => setExpanded(value => !value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(value => !value); } }} style={{ pointerEvents: 'auto' }}>
    <NodeCard {...props} />
    {populations?.map((population, index) => <div key={index} data-waiting-footer="" className="border-t border-divider px-3 py-2 text-xs" style={{ color: colors[population.tone][0], background: colors[population.tone][1] }}>
      <div className="flex items-center gap-1 font-medium">{population.tone === 'process' ? <Cpu size={14} /> : population.tone === 'queue' ? <ListOrdered size={14} /> : population.tone === 'error' ? <TriangleAlert size={14} /> : population.tone === 'event' ? <Clock size={14} /> : <Clock size={14} />}{population.label}</div>
      <div className="mt-2">{population.detail}</div>
      {population.slots !== undefined && <div className="mt-2 flex gap-1" role="img" aria-label={`${population.slots} of 4 slots occupied`}>{Array.from({ length: 4 }, (_, i) => <span key={i} className="h-4 flex-1 rounded-sm" style={{ border: '1px solid #A7F3D0', background: i < population.slots! ? '#6EE7B7' : '#FFFFFF' }} />)}</div>}
    </div>)}

  </div>;
}
function PendingEdge(props: EdgeProps) {
  const frame = useContext(PendingContext);
  const [, x, y] = getSmoothStepPath(props);
  return <><ExampleEdge {...props} />{frame.edgeEvent && <><rect x={x - 3} y={y - 5} width={6} height={10} rx={1} fill="var(--color-warning)" /><EdgeLabelRenderer><div className="absolute rounded-sm bg-shell px-2 py-1 text-xs" style={{ color: 'var(--color-warning)', transform: `translate(-50%, 0) translate(${x}px, ${y + 8}px)` }}>{frame.edgeEvent}</div></EdgeLabelRenderer></>}</>;
}
const pendingNodeTypes = { element: PendingNode };
const pendingEdgeTypes = { traffic: PendingEdge };

export function TrafficVisualStyles() { return <>
    <style>{`
      .traffic-lab-node { width: 220px; min-width: 0; overflow-wrap: anywhere; pointer-events: auto; }
      .traffic-lab-node > div { pointer-events: auto; }
      .traffic-lab-node > .component-node { position: relative; z-index: 1; }
      .traffic-lab-node > .component-node + div { margin-top: -8px; padding-top: 16px; border-top-width: 0; }
      .traffic-lab-node > div:last-child:not(.component-node):not(.traffic-lab-node) { border-radius: 0 0 8px 8px; }
      .traffic-lab-node:not(:hover):not(:focus-within):not([data-expanded="true"]) > :is([data-waiting-footer], [data-dependency-footer], [data-processing-footer], [data-queue-footer]) > :not(:first-child) { display: none; }
      .traffic-lab-node:focus-visible { outline: 2px solid #6366F1; outline-offset: 3px; }
    `}</style>
  </>; }
export { nodeTypes, edgeTypes, FitIdleCanvas, idleNodes, idleEdges, dependencyNodes, dependencyEdges, fanoutNodes, fanoutEdges, ExampleContext, ExampleNode, ExampleEdge, exampleNodeTypes, exampleEdgeTypes, PendingContext, PendingEdge, pendingNodeTypes, pendingEdgeTypes };
export type { ExamplePhase, TravelDirection, LabFrame };

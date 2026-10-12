import { nodeTypes, edgeTypes, FitIdleCanvas, idleNodes, idleEdges, dependencyNodes, dependencyEdges, fanoutNodes, fanoutEdges, ExampleContext, exampleNodeTypes, exampleEdgeTypes, PendingContext, PendingEdge, pendingNodeTypes, pendingEdgeTypes, TrafficVisualStyles, type ExamplePhase, type TravelDirection, type LabFrame } from '../shared/traffic-visuals';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { createContext, useContext, useEffect, useState } from 'react';
import { ReactFlow, type EdgeProps } from '@canvas-one/editor-reactflow/react';
import { Pause, Play } from 'lucide-react';
import { PlaybackTrafficContext } from '@/features/workspace/usePlaybackTraffic';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { StateLoadExample, type LiveFrame } from './LiveTrafficState';

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
    <p className="mt-3 text-sm text-secondary-text">No current activity means no activity footer or motion. Earlier totals remain in the separate cumulative summary.</p>
  </section>;
}

function ActiveExample({ queued = false, phase = 'transport' }: { queued?: boolean; phase?: ExamplePhase }) {
  const [asynchronous, setAsynchronous] = useState(false);
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
    {phase !== 'dependency' && <label className="my-2 flex items-center gap-2 text-xs"><Switch checked={asynchronous} onCheckedChange={setAsynchronous} />Asynchronous work</label>}
    <p className="my-2 text-xs text-secondary-text">Illustrative current frame · {phase === 'processing' ? 'receiver working locally' : phase === 'dependency' ? multiple ? 'Payment service awaits Fraud and Orders' : 'Payment service awaits Fraud check service' : queued ? 'waiting for a local processing slot' : direction === 'forward' ? asynchronous ? 'messages: sender → receiver' : 'requests: caller → receiver' : direction === 'backward' ? asynchronous ? 'acknowledgements: receiver → sender' : 'responses: receiver → caller' : 'both directions active'}{reduced ? ' · reduced motion' : ''}</p>
    {phase === 'dependency' && <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="flex gap-1" role="group" aria-label="Dependency topology">
        <Button size="sm" variant={!multiple ? 'tint' : 'ghost'} aria-pressed={!multiple} onClick={() => { setMultiple(false); setOneReturned(false); }}>One downstream</Button>
        <Button size="sm" variant={multiple ? 'tint' : 'ghost'} aria-pressed={multiple} onClick={() => setMultiple(true)}>Multiple downstreams</Button>
      </div>
      {multiple && <label className="flex items-center gap-2 text-xs text-secondary-text"><Switch checked={oneReturned} onCheckedChange={setOneReturned} aria-label="One Fraud call returned" />One Fraud call returned</label>}
      <label className="flex items-center gap-2 text-xs text-secondary-text"><Switch checked={mixed} onCheckedChange={setMixed} aria-label="Processing + awaiting responses" />Processing + awaiting responses</label>
    </div>}
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary-text" aria-label="Current state ownership">
      <span><strong>Caller:</strong> {asynchronous ? 'no synchronous response wait' : `${queued ? count + 4 : count * (phase === 'transport' && direction === 'dual' ? 2 : 1) + localProcessing} awaiting responses`}</span>
      <span><strong>{phase === 'dependency' ? 'Connections' : 'Connection'}:</strong> {queued || phase !== 'transport' ? 'idle' : direction === 'dual' ? `${count} requests → · ${count} responses ←` : `${count} ${direction === 'backward' ? 'responses ←' : 'requests →'} in flight`}</span>
      <span><strong>{phase === 'dependency' ? 'Payment service' : 'Receiver'}:</strong> {localProcessing > 0 ? `${localProcessing} processing · ` : ''}{multiple ? `${count + (count === 4 ? 3 : 1) - (oneReturned ? 1 : 0)} awaiting responses` : phase === 'dependency' ? `${count} awaiting responses` : phase === 'processing' ? `${count} processing · 0 queued` : queued ? `${count} queued · 4 processing` : direction === 'backward' ? 'idle; responses returning' : 'idle until arrival'}</span>
      {phase === 'dependency' && !multiple && <span><strong>Fraud check:</strong> {count} processing</span>}
    </div>
    {phase === 'transport' && !queued && <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Travel direction">
      {(['forward', 'backward', 'dual'] as const).map(value => <Button key={value} size="sm" variant={direction === value ? 'tint' : 'ghost'} aria-pressed={direction === value} onClick={() => setDirection(value)}>{value === 'forward' ? 'Forward · requests' : value === 'backward' ? 'Backward · responses' : 'Dual direction'}</Button>)}
    </div>}
    <ExampleContext.Provider value={{ count, queued, progress, phase, multiple, oneReturned, mixed, direction, asynchronous, liveProcessing: -1 }}>
      <PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
        <div id={canvasId} className="border border-divider bg-canvas" style={{ height: multiple ? 420 : mixed || queued ? 320 : 260 }}>
          <ReactFlow key={`${multiple ? 'fanout' : 'single'}-${mixed}`} nodes={multiple ? fanoutNodes : phase === 'dependency' ? dependencyNodes : idleNodes} edges={multiple ? fanoutEdges : phase === 'dependency' ? dependencyEdges : idleEdges} nodeTypes={exampleNodeTypes} edgeTypes={exampleEdgeTypes} minZoom={0.1} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={canvasId} reserveFooter={queued ? 280 : 0} /></ReactFlow>
        </div>
      </PlaybackTrafficContext.Provider>
    </ExampleContext.Provider>
    {phase === 'dependency' && <p className="mt-3 text-sm text-secondary-text">Only services with outstanding responses appear in the expanded waiting summary. {mixed ? 'Payment service also processes separate requests locally: green slots and violet response waits coexist. Caller pending responses include both populations.' : 'Enable Processing + awaiting responses to see independent populations on the same node.'}</p>}
    {multiple && <p className="mt-3 text-sm text-secondary-text">One request can await several calls. The footer summarizes outstanding calls by service; individual request IDs and call trees belong in request inspection.</p>}
    {!multiple && <p className="mt-3 text-sm text-secondary-text">{phase === 'processing' ? 'Processing shows occupied local slots. Full capacity can be healthy; it does not imply a queue or error.' : phase === 'dependency' ? 'Awaiting responses shows outstanding calls. It can coexist with local processing on the same node.' : queued ? 'Queued and processing are separate populations. Hover either footer or the node for capacity details.' : 'Transport uses bounded motion cues, never one dot per request. Direction changes motion; load changes intensity.'}</p>}
  </section>;
}

type PendingCase = { id: string; title: string; note: string; frames: (high: boolean) => LabFrame[] };
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
  const phase: ExamplePhase = state === 4 ? 'dependency' : state === 3 ? 'processing' : 'transport';
  const count = queued ? n(frame.receiver, 'Queued') : state === 3 ? n(frame.receiver, 'Processing') : n(frame.caller, 'Awaiting responses') || Math.max(frame.forward, frame.backward) * 0.12;
  const pending: LabFrame = { label: '', summary: '', caller: frame.caller.map(row => ({ label: `${row.value} retry scheduled`, detail: 'Waiting for the next attempt; transport starts when attempts are sent.', tone: 'queue' })) };
  const canvasId = `live-state-canvas-${state}`;
  return <PendingContext.Provider value={pending}><ExampleContext.Provider value={{ ...defaults, count, queued, phase, progress, asynchronous: frame.asynchronous ?? false, liveProcessing: n(frame.receiver, 'Processing') }}><LiveCanvasContext.Provider value={frame}><PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
    <div id={canvasId} className="mt-3 border border-divider bg-canvas" style={{ height: 360 }}><ReactFlow nodes={state === 4 ? dependencyNodes : idleNodes} edges={state === 4 ? dependencyEdges : idleEdges} nodeTypes={!active ? nodeTypes : state === 6 ? pendingNodeTypes : exampleNodeTypes} edgeTypes={sharedLiveEdgeTypes} minZoom={0.1} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={canvasId} reserveFooter={280} /></ReactFlow></div>
  </PlaybackTrafficContext.Provider></LiveCanvasContext.Provider></ExampleContext.Provider></PendingContext.Provider>;
}
function PendingExample({ definition }: { definition: PendingCase }) {
  const defaults = useContext(ExampleContext);
  const [high, setHigh] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0.4);
  const frame = definition.frames(high)[0];
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
    <p className="mb-2 text-xs text-secondary-text">{frame.summary}</p>
    <PendingContext.Provider value={frame}><ExampleContext.Provider value={{ ...defaults, phase: frame.phase ?? 'delivered', direction: frame.direction ?? 'forward', asynchronous: frame.asynchronous ?? false, count: frame.count ?? 1, progress }}><PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}>
      <div id={canvasId} className="border border-divider bg-canvas" style={{ height: frame.third ? 360 : 280 }}><ReactFlow key={frame.third ? 'three' : 'two'} nodes={(frame.third ? dependencyNodes : idleNodes).map(node => frame.asynchronous ? { ...node, data: { ...node.data, element: { ...(node.data.element as Record<string, unknown>), label: node.id === 'idle-0' ? 'Message publisher' : 'Message consumer' } } } : node)} edges={frame.third ? dependencyEdges : idleEdges} nodeTypes={pendingNodeTypes} edgeTypes={pendingEdgeTypes} minZoom={0.1} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId={canvasId} /></ReactFlow></div>
    </PlaybackTrafficContext.Provider></ExampleContext.Provider></PendingContext.Provider>
    <p className="mt-3 text-sm text-secondary-text">{definition.note}</p>
  </section>;
}

const issueKinds = [
  { name: 'Error', meaning: 'Work ended unsuccessfully.', boundary: 'Processing failure, admission rejection, delivery loss and exhausted attempts are causes in inspection, not separate canvas states.' },
  { name: 'Timeout', meaning: 'A response deadline elapsed.', boundary: 'The caller stops awaiting that response. Downstream processing may continue until it finishes or cancellation is recorded.' },
  { name: 'Expired', meaning: 'Queued work reached its lifetime limit.', boundary: 'Remove expired work from the queue. This differs from a caller’s response deadline.' },
  { name: 'Cancelled', meaning: 'Cancellation took effect.', boundary: 'A cancellation request alone does not remove downstream work. Only a recorded cancellation does.' },
  { name: 'Blocked', meaning: 'An explicit obstruction is preventing transport.', boundary: 'A current connection condition, not a failure outcome. Slow or quiet traffic alone is not evidence of blockage.' },
] as const;
function IssuesExample() {
  const [kind, setKind] = useState(0);
  const [high, setHigh] = useState(false);
  const [asynchronous, setAsynchronous] = useState(false);
  const issue = issueKinds[kind];
  const blocked = kind === 4;
  const defaults = useContext(ExampleContext);
  const frame: LabFrame = { label: issue.name, summary: '', edgeEvent: blocked ? 'Blocked' : undefined };
  return <section className="border-b border-border py-4" data-issues-example="">
    <h2 className="text-sm font-semibold">06 · Issues and outcomes</h2>
    <p className="mt-2 text-sm text-secondary-text">Keep current activity visible. Outcomes are summarized alongside it; a failed request does not turn the whole node into a failed node.</p>
    <div className="my-3 flex flex-wrap gap-1" role="group" aria-label="Issue type">{issueKinds.map((item, index) => <Button key={item.name} size="sm" variant={kind === index ? 'tint' : 'ghost'} aria-pressed={kind === index} onClick={() => setKind(index)}>{item.name}</Button>)}</div>
    <div className="mb-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs"><Switch checked={high} onCheckedChange={setHigh} />High load</label><label className="flex items-center gap-2 text-xs"><Switch checked={asynchronous} onCheckedChange={setAsynchronous} />Asynchronous work</label></div>
    <p className="mb-2 text-xs text-secondary-text">{issue.meaning} {issue.boundary}</p>
    <PendingContext.Provider value={frame}><ExampleContext.Provider value={{ ...defaults, phase: 'processing', count: high ? 4 : 1, asynchronous }}><PlaybackTrafficContext.Provider value={{ legs: new Map(), nodes: new Map(), connectionFlashes: new Map(), nodeFlashes: new Map(), reduced: true, hasRun: true }}><div id="issues-state-canvas" className="border border-divider bg-canvas" style={{ height: 320 }}><ReactFlow nodes={idleNodes} edges={idleEdges} nodeTypes={exampleNodeTypes} edgeTypes={pendingEdgeTypes} minZoom={0.1} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}><FitIdleCanvas canvasId="issues-state-canvas" reserveFooter={240} /></ReactFlow></div></PlaybackTrafficContext.Provider></ExampleContext.Provider></PendingContext.Provider>
    {!blocked && <div className="mt-2 border-l-2 pl-3 text-xs" style={{ borderColor: kind === 0 ? 'var(--color-danger)' : kind === 3 ? 'var(--color-secondary-text)' : 'var(--color-warning)' }} aria-label="Outcome summary"><strong>{high ? `${kind === 0 ? 80 : 12}/s` : '1 outcome at playhead'} · {issue.name}</strong><span className="ml-2 text-secondary-text">{high ? 'Fixed one-second sample · illustrative' : 'Recorded outcome · unaffected work remains active'}</span></div>}
    {!blocked && <p className="mt-2 text-xs text-secondary-text">{kind === 1 ? 'Recorded at caller · elapsed response deadline' : kind === 2 ? 'Recorded at queue · work lifetime elapsed' : kind === 3 ? 'Recorded where work was actually cancelled' : 'Recorded where the failure occurred; cause breakdown stays in inspection.'}</p>}
    {kind === 0 && <details className="mt-2 text-xs text-secondary-text"><summary className="cursor-pointer">Cause breakdown · inspection example</summary><p className="mt-2">{high ? '62/s execution errors · 18/s admission rejections' : 'Execution error · one recorded outcome'}. These remain distinguishable without separate node designs.</p></details>}
    <p className="mt-3 text-xs text-secondary-text">Error responses use the same return transport. ACKs use the same return transport; redelivery uses the same retry scheduling. “Stuck” is a diagnosis to inspect, not another animation or an inference from silence. Completed outcomes remain in inspection after current activity clears.</p>
  </section>;
}
const retryCase: PendingCase = { id: 'retry', title: '07 · Retry scheduled', note: 'Scheduled retries are a current waiting population. Attempts that are sent use normal transport; recovered or exhausted work leaves this population. Sync retries and async redeliveries share this presentation.', frames: high => [{ label: 'Scheduled', summary: 'Attempts are waiting for their next eligible send time.', caller: [{ label: `${high ? 120 : 1} retry scheduled`, detail: 'Waiting for next attempts · delays may differ across work', tone: 'queue' }] }] };

function TrafficStateLab() {
  return <main className="bg-shell text-ink min-h-screen p-4" style={{ maxWidth: 1000, margin: '0 auto' }}>
    <TrafficVisualStyles />
    <header className="border-b border-border pb-3">
      <h1 className="text-lg font-semibold">Traffic state lab</h1>
      <p className="mt-1 text-sm text-secondary-text">One state at a time. Current activity follows the playhead; cumulative summaries stay separate.</p>
      <p className="mt-2 text-sm text-secondary-text">Five core activities, one issues section and retry scheduling. Nodes show current populations; connections show transport. Hover for details. Outcomes and their causes belong to a separate summary and inspection.</p>
    </header>
    {[<IdleExample />, <ActiveExample queued={false} />, <ActiveExample queued />, <ActiveExample phase="processing" />, <ActiveExample phase="dependency" />].map((example, state) => <StateLoadExample key={state} state={state} renderCanvas={(frame, progress) => <SharedLiveCanvas state={state} frame={frame} progress={progress} />}>{example}</StateLoadExample>)}
    <IssuesExample />
    <StateLoadExample state={6} renderCanvas={(frame, progress) => <SharedLiveCanvas state={6} frame={frame} progress={progress} />}><PendingExample definition={retryCase} /></StateLoadExample>
    <section className="border-b border-border py-3 text-sm text-secondary-text">
      <p>Low and high traffic must share an understandable visual language. Shades, pulses and directional gradient animation are candidates for active states; motion freezes when playback pauses.</p>
      <p className="mt-2">Timeline zoom changes neither current activity nor cumulative totals. Historical spike placement on the canvas versus timeline inspection is deferred.</p>
    </section>
    <section className="border-b border-border py-4 text-sm">
      <h2 className="font-semibold">Future scope</h2>
      <p className="mt-2 text-secondary-text">State transition design, including response-delivery acknowledgements, arrival count placement, repeated events under load and their timing, is deferred. Historical spike placement remains deferred.</p>
    </section>
    <section className="py-4 text-sm">
      <h2 className="font-semibold">Review sequence</h2>
      <p className="mt-2 text-secondary-text">Idle → travelling → queued → processing → awaiting responses → issues → retry scheduled. Node populations coexist; direction and protocol are variants of transport, not additional states.</p>
      <p className="mt-2 text-secondary-text">Run lifecycle, playback, selection and traffic volume are shared context. They should not multiply the basic node and connection states.</p>
    </section>
  </main>;
}

const meta = { title: 'Workspace/Traffic state lab', component: TrafficStateLab, parameters: { layout: 'fullscreen' } } satisfies Meta<typeof TrafficStateLab>;
export default meta;
type Story = StoryObj<typeof meta>;
export const StateDefinitions: Story = {};

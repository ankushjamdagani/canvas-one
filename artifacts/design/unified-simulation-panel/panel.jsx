import React, { useEffect, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Play, Pause, Square, RotateCcw, SkipBack, SkipForward, Radio, Scissors, X, ChevronDown, ChevronUp, MousePointer2, Hand, Plus, Minus, Maximize, Database, Server, Globe, Workflow, Check, GitBranch, Activity } from 'lucide-react';
import { Button } from '../../../src/components/ui/button';
import { NativeSelect } from '../../../src/components/ui/native-select';
import { Switch } from '../../../src/components/ui/switch';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../../../src/components/ui/tooltip';
import '../../../src/styles.css';
import './panel.css';
import { CycleInspector, cycleHistory } from './cycles';
import { Rewind, FastForward, Repeat } from 'lucide-react';
import { MainTimeline } from './main-timeline';

const examples = ['Checkout under a traffic spike', 'Checkout · continuous traffic', 'Payment gateway latency spike', 'Cache warm-up at peak load'];
const states = [
  { id: 'ready', name: 'Ready to run', note: 'Run is the primary action. Only setup and execution are visible; transport appears after the first recorded frame.' },
  { id: 'live', name: 'Running live', note: 'Pause is primary while following the recording. Stop ends emission and drains in-flight work; it does not pause playback.' },
  { id: 'paused', name: 'Paused with a selected range', note: 'Play resumes within 00:15.000–00:32.500. Selection handles are independent of the playhead; Loop repeats this interval.' },
  { id: 'completed', name: 'Completed, ready to replay', note: 'Play is primary. Run starts a new simulation; Reset clears the recording and returns to authoring.' },
];
const initial = id => ({ mode: id, time: id === 'live' ? 43.2 : id === 'paused' ? 18.4 : 0, duration: id === 'live' ? 43.2 : id === 'ready' ? 0 : 72, range: id === 'paused' ? [15, 32.5] : null, loop: false, playing: id === 'live', live: id === 'live', speed: '1', expanded: true, inspecting: false, scenario: id === 'live' ? examples[1] : examples[0] });
const time = n => { const ms = Math.round(n * 1000); return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
function Tool({ label, icon: Icon, disabled, variant = 'ghost', onClick, pressed }) {
  return <Tooltip><TooltipTrigger asChild><span className="tool-wrap"><Button size="icon" variant={variant} disabled={disabled} aria-label={label} aria-pressed={pressed} onClick={onClick}><Icon size={16}/></Button></span></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
function Panel({ preset = 'ready', animated = false, onEvent }) {
  const [s, set] = useState(() => initial(preset));
  const [timelineWindow, setTimelineWindow] = useState(null);
  const id = useId();
  useEffect(() => { set(initial(preset)); onEvent?.(null); }, [preset]);
  const change = update => { if (update.time !== undefined || update.duration !== undefined || update.mode === 'draining') onEvent?.(null); if (update.duration !== undefined) setTimelineWindow(null); set(prev => ({ ...prev, ...update })); };
  const reset = scenario => { onEvent?.(null); set({ ...initial('ready'), scenario }); };
  const active = s.mode === 'live' || s.mode === 'draining';
  const streaming = s.scenario === examples[1];
  const status = s.mode === 'ready' ? 'Ready' : s.mode === 'draining' ? 'Draining' : s.mode === 'range-ended' ? 'Range ended' : active && s.playing && s.live ? 'Running' : s.playing ? 'Playing' : s.mode === 'completed' && (s.time === 0 || s.time === s.duration) ? 'Completed' : 'Paused';
  useEffect(() => {
    if (!animated || (!s.playing && s.mode !== 'draining' && !active)) return;
    const timer = setInterval(() => set(p => {
      if (p.mode === 'draining') return { ...p, mode: 'completed', playing: false, live: false, time: p.duration, range: null };
      const duration = p.mode === 'live' ? p.duration + .1 : p.duration;
      if (p.mode === 'live' && p.scenario !== examples[1] && duration >= 72) return { ...p, mode: 'completed', duration: 72, time: Math.min(72, p.live ? 72 : p.time), live: false, playing: false };
      if (!p.playing) return { ...p, duration };
      const end = p.range?.[1] ?? duration;
      const next = p.live ? duration : p.time + .1 * Number(p.speed);
      if (!p.live && next >= end) return { ...p, duration, time: p.loop ? p.range?.[0] ?? 0 : end, playing: p.loop, mode: p.loop ? p.mode : p.range ? 'range-ended' : 'completed' };
      return { ...p, time: next, duration };
    }), 100);
    return () => clearInterval(timer);
  }, [animated, s.playing, s.mode, active]);
  function togglePlay() {
    onEvent?.(null);
    const start = s.range?.[0] ?? 0, end = s.range?.[1] ?? s.duration;
    change({ playing: !s.playing, time: s.time >= end || s.time < start ? start : s.time, live: s.playing ? false : s.live, mode: s.mode === 'range-ended' ? 'paused' : s.mode });
  }
  function selectRange(range) { change({ range, time: range[0], playing: false, live: false, mode: active ? s.mode : 'paused' }); }
  const recorded = s.duration > 0;
  const speeds = [.25, .5, 1, 2, 4, 8, 16];
  const speedIndex = speeds.indexOf(Number(s.speed));
  function stepCycle(direction) {
    const starts = cycleHistory.map(c => c.start).filter(t => t <= s.duration).sort((a, b) => a - b);
    const target = direction < 0 ? starts.filter(t => t < s.time - .001).at(-1) ?? 0 : starts.find(t => t > s.time + .001) ?? s.duration;
    change({ time: target, playing: false, live: false });
  }
  function runOrStop() { change(active ? { mode: 'draining', range: null, loop: false, live: true } : { mode: 'live', duration: .1, time: .1, playing: true, live: true, range: null, loop: false, expanded: true }); }
  useEffect(() => setTimelineWindow(null), [preset, recorded]);
  return <TooltipProvider delayDuration={250}><section className={`simulation-panel ${recorded ? 'has-recording' : ''}`} aria-label="Simulation and playback">
    <div className="setup-row unified-bar">
      <div className="simulation-actions">
        <div className="scenario-run"><span className={`scenario-dot ${active ? 'is-running' : ''}`}/><Activity size={16}/><label className="scenario-field" htmlFor={`${id}-scenario`}><span className="sr-only">Simulation</span><NativeSelect id={`${id}-scenario`} disabled={active} value={s.scenario} onChange={e => reset(e.target.value)}>{examples.map(name => <option key={name}>{name}</option>)}</NativeSelect></label><Button className="run-button" variant={active ? 'destructive' : 'default'} disabled={s.mode === 'draining'} onClick={runOrStop}>{active ? <Square size={16}/> : <Play size={16}/ >}{active ? 'Stop' : 'Run'}</Button></div>
        <Tool label={active ? 'Reset unavailable while the simulation is active' : 'Reset · clear recording'} icon={RotateCcw} disabled={active || !recorded} onClick={() => reset(s.scenario)}/>
      </div>
      <div className={`status ${active ? 'active' : ''}`} role="status"><span className="status-dot"/>{status}</div>
      {recorded && <div className="desktop-playback" role="group" aria-label="Playback controls">
        <div className="transport" role="group" aria-label="Playback transport">
          <Tool label="Previous cycle" icon={SkipBack} disabled={s.time <= 0} onClick={() => stepCycle(-1)}/>
          <Tool label={`Slower speed · ${s.speed}×`} icon={Rewind} disabled={speedIndex === 0} onClick={() => change({ speed: String(speeds[speedIndex - 1]) })}/>
          <Tool label={s.playing ? 'Pause playback · simulation continues' : s.range ? 'Play selected range' : 'Play recording'} icon={s.playing ? Pause : Play} variant="default" onClick={togglePlay}/>
          <Tool label="Stop playback" icon={Square} disabled={!s.playing && s.time === (s.range?.[0] ?? 0)} onClick={() => change({ playing: false, live: false, time: s.range?.[0] ?? 0 })}/>
          <Tool label={`Faster speed · ${s.speed}×`} icon={FastForward} disabled={speedIndex === speeds.length - 1} onClick={() => change({ speed: String(speeds[speedIndex + 1]) })}/>
          <Tool label="Next cycle" icon={SkipForward} disabled={s.time >= s.duration} onClick={() => stepCycle(1)}/>
          <Tool label={s.range ? 'Loop selected range' : 'Loop recording'} icon={Repeat} pressed={s.loop} variant={s.loop ? 'tint' : 'ghost'} disabled={!s.range && active} onClick={() => change({ loop: !s.loop })}/>
        </div>
        <span className="speed-readout" aria-label="Playback speed">{s.speed}×</span>
        {streaming && <Tool label={s.live ? 'Following live' : 'Go Live'} icon={Radio} pressed={s.live} disabled={!active || s.mode === 'draining' || s.live} onClick={() => change({ time: s.duration, live: true, playing: true, range: null, loop: false })}/ >}
      </div>}
    </div>
    {recorded && <div className="recording-details">
      <MainTimeline duration={s.duration} playhead={s.time} selection={s.range} window={timelineWindow} onWindow={setTimelineWindow} onRange={selectRange} onClear={() => change({ range: null, loop: false })} onSeek={t => change({ time: t, playing: false, live: false, mode: active ? s.mode : 'paused' })}>
        <div className="clock"><strong>{time(s.time)}</strong><span className="muted">/</span><span>{time(s.duration)}</span><span className="muted duration-label">recorded</span></div>
      </MainTimeline>

    </div>}
    {recorded && <Button className="cycle-details-toggle" variant="ghost" aria-label="Inspect Request Cycles" aria-expanded={s.inspecting} aria-controls={`${id}-cycles`} onClick={() => change({ inspecting: !s.inspecting })}>Inspect Request Cycles{s.inspecting ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}</Button>}
    {recorded && s.inspecting && <div id={`${id}-cycles`} className="cycle-details-content"><CycleInspector window={timelineWindow} duration={s.duration} playhead={s.time} onInspect={event => { if (event) change({ time: event.time, playing: false, live: false, mode: active ? s.mode : 'paused' }); onEvent?.(event); }}/></div>}
  </section></TooltipProvider>;
}

function Canvas({ event }) {
  const nodes = [{ name: 'Storefront', meta: '600 req/s', icon: Globe, cls: 'client' }, { name: 'API gateway', meta: 'Round robin', icon: Workflow, cls: 'gateway' }, { name: 'Checkout API', meta: '8 workers', icon: Server, cls: 'service' }, { name: 'Orders DB', meta: 'Pool · 16', icon: Database, cls: 'database' }];
  return <div className={`canvas ${event?.kind === 'failure' ? 'inspecting-failure' : ''}`}><div className="canvas-top"><span>{event ? `Inspecting ${event.cycle} · ${time(event.time)}` : 'Checkout architecture'}</span><span className="branch"><GitBranch size={14}/>Main</span></div><div className="architecture">{nodes.map((node, i) => <React.Fragment key={node.name}>{i > 0 && <div className={`connection ${event && [event.source, event.target].includes(nodes[i - 1].name) && [event.source, event.target].includes(node.name) ? 'communication-selected' : ''}`}><span>{event?.target === 'Orders DB' && i === 3 ? event.detail : 'HTTP'}</span><i/></div>}<div className={`node ${node.cls} ${event && [event.source, event.target].includes(node.name) ? 'communication-selected' : ''}`}><div className="node-title"><node.icon size={16}/><strong>{node.name}</strong></div><p>{node.meta}</p><small>{i === 3 ? 'Resource' : i === 0 ? 'Client' : i === 1 ? 'Router' : 'Service'}</small></div></React.Fragment>)}</div><div className="canvas-note">Traffic spike<br/><span>00:15–00:35 · 3× baseline</span></div><div className="canvas-tools"><MousePointer2 size={16}/><Hand size={16}/><Plus size={16}/><Minus size={16}/><Maximize size={16}/><span>100%</span></div></div>;
}
function App() {
  const [preset, setPreset] = useState('paused');
  const [event, setEvent] = useState(null);
  return <main className="design-review"><header className="review-header"><div><p className="review-eyebrow">System Studio / Interaction design</p><h1>Simulation & playback</h1><p className="subtitle">One panel, from first run to focused replay.</p></div><span className="proposal">Design prototype</span></header>
    <div className="review-switcher"><span>Preview state</span><div role="group" aria-label="Preview state">{states.map(s => <Button key={s.id} variant={preset === s.id ? 'tint' : 'ghost'} aria-pressed={preset === s.id} onClick={() => setPreset(s.id)}>{s.name.split(',')[0]}</Button>)}</div></div>
    <div className="workspace-preview"><div className="workspace-header"><strong>System Studio</strong><span>Checkout service</span><span className="saved"><Check size={14}/>Saved locally</span></div><Canvas event={event}/><Panel preset={preset} animated onEvent={setEvent}/></div>
    <p className="inspection-annotation"><strong>Density → cycles → events.</strong> Zoom or pinch directly on the main timeline; its time window also controls the cycle lanes. Select a cycle row to expand its flows inline. Hover opens a visual summary popover. Selecting an event holds the playhead and highlights its endpoints on the canvas. Filters and the inspection window leave the playback range intact.</p>
    <div className="annotation-grid"><p><strong>A single reading order.</strong> Simulation setup → execution → playback → timeline. Thin dividers group purposes without creating nested cards.</p><p><strong>Canvas first.</strong> Ready uses one compact row. Recordings reveal a fixed-height detail area; pause, completion, and range-ended status never resize it.</p><p><strong>Execution ≠ transport.</strong> Green Run or Play/Pause is primary. Clay Stop drains the run. Ghost Reset clears it. Disabled tools explain availability on hover.</p></div>
    <div className="section-title"><h2>Four states, one control surface</h2><span>Same slots. Different primary action.</span></div>
    <div className="state-specimens">{states.map((state, i) => <article key={state.id}><div className="specimen-heading"><h3><span>{i + 1}.</span> {state.name}</h3><p>{state.note}</p></div><Panel preset={state.id}/></article>)}</div>
    <section className="responsive-review"><div><h2>Narrow screen</h2><p>Scenario, Run/Stop, and Reset stay together. Playback moves to its own row, preserving the desktop action order and touch targets.</p><p>Drag empty timeline space to select a range; drag its handles to adjust it. Drag the playhead to scrub. Pinch to zoom; use Hand to pan. Start and end timestamps sit directly on the range handles.</p><p>The timeline stays full width. The upward chevron reveals cycle details in a bounded scrolling area, preserving space for the canvas.</p><p><strong>At the range end:</strong> playback pauses at the exact end and shows “Range ended.” Play restarts the selected range. With Loop on, playback returns to the start automatically.</p><p><strong>Two Stop actions:</strong> the simulation Stop ends emission and drains work. The transport Stop pauses replay and returns to the range start. Go Live clears the selection and rejoins the streaming edge.</p></div><div className="phone"><div className="phone-top">Checkout service <GitBranch size={14}/></div><div className="phone-canvas"><div className="node service"><div className="node-title"><Server size={16}/><strong>Checkout API</strong></div><p>8 workers</p></div></div><Panel preset="paused"/><div className="phone-caption">320 px · recording available</div></div></section>
    <footer>Uses the app’s actual Button, NativeSelect, Switch, Slider, Tooltip, Lucide icons, font files, and Evergreen CSS tokens. Timeline data is illustrative; controls demonstrate local playback behavior.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);

import React, { useId, useState } from 'react';
import { Activity, ArrowUpRight, Check, X, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../../src/components/ui/button';
import { NativeSelect } from '../../../src/components/ui/native-select';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../src/components/ui/tooltip';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '../../../src/components/ui/hover-card';

export const formatTime = n => { const ms = Math.round(n * 1000); return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
function cycle(index, start, spike = false) {
  const failed = spike && index % 5 === 0;
  const id = `C-${String(index + (spike ? 840 : 1)).padStart(4, '0')}`;
  const events = [
    { time: start, kind: 'send', source: 'Storefront', target: 'API gateway', detail: 'POST /checkout', latency: '—' },
    { time: start + .08, kind: 'arrival', source: 'API gateway', target: 'Checkout API', detail: 'Request admitted', latency: '80 ms' },
    { time: start + .2, kind: 'send', source: 'Checkout API', target: 'Orders DB', detail: 'INSERT order', latency: '—' },
    { time: start + (failed ? .74 : .48), kind: failed ? 'failure' : 'arrival', source: 'Checkout API', target: 'Orders DB', detail: failed ? 'Database request timed out' : 'Order committed', latency: failed ? '540 ms' : '280 ms' },
    { time: start + (failed ? .9 : .64), kind: failed ? 'retry' : 'complete', source: 'Checkout API', target: failed ? 'Orders DB' : 'Storefront', detail: failed ? 'Retry attempt 2' : 'Checkout completed · HTTP 200', latency: failed ? '160 ms backoff' : '640 ms total' },
  ].map(event => ({ ...event, flow: 'sync', cycle: id, key: `${id}-${event.kind}-${event.time}` }));
  const response = start + (failed ? 1.02 : .64);
  if (failed) events.push({ time: response, kind: 'complete', flow: 'sync', source: 'Checkout API', target: 'Storefront', detail: 'Checkout completed after retry · HTTP 200', latency: '1,020 ms total', cycle: id, key: `${id}-response` });
  const asyncFailed = spike && index === 3;
  const branches = [
    { name: 'Receipt email', start: start + .4, end: start + 1.38, failed: false },
    { name: 'Analytics export', start: start + .46, end: start + 1.82, failed: asyncFailed },
  ];
  branches.forEach(branch => {
    events.push({ time: branch.start, kind: 'send', flow: 'async', source: 'Checkout API', target: branch.name, detail: `${branch.name} queued`, latency: '—', cycle: id, key: `${id}-${branch.name}-send` });
    events.push({ time: branch.end, kind: branch.failed ? 'failure' : 'complete', flow: 'async', source: 'Checkout API', target: branch.name, detail: branch.failed ? 'Analytics export failed · response already returned' : `${branch.name} settled`, latency: `${Math.round((branch.end - branch.start) * 1000)} ms background`, cycle: id, key: `${id}-${branch.name}-settled` });
  });
  return { id, start, response, end: start + 1.82, failed: failed || asyncFailed, syncFailed: failed, asyncFailed, branches, events: events.sort((a, b) => a.time - b.time) };
}
// Deterministic illustrative history: ordinary traffic plus overlapping spike cycles.
export const cycleHistory = [...Array.from({ length: 130 }, (_, i) => cycle(i, i * .54)), ...Array.from({ length: 14 }, (_, i) => cycle(i, 18.2 + i * .06, true))];
export const failureTimes = cycleHistory.flatMap(c => c.events.filter(e => e.kind === 'failure').map(e => e.time));
const icons = { send: ArrowUpRight, arrival: Activity, failure: X, retry: RotateCcw, complete: Check };
function Summary({ cycle: c, duration }) {
  return <><div className="flow-summary"><span>Response <strong>{c.response <= duration ? `${Math.round((c.response - c.start) * 1000)} ms · HTTP 200` : 'Pending'}</strong></span><span>All work settled <strong>{c.end <= duration ? `${Math.round((c.end - c.start) * 1000)} ms` : 'Pending'}</strong></span></div>{c.asyncFailed && c.end <= duration && <p className="failure">Background failure · response succeeded</p>}</>;
}
function CycleFlow({ cycle: c, duration, onInspect }) {
  return <div className="expanded-cycle"><div className="expanded-heading"><strong>{c.id}</strong><span>Selected cycle</span></div><Summary cycle={c} duration={duration}/>
        <div className="expanded-flow-scroll"><div className="expanded-flow-inner">{[{ name: 'Request / response', start: c.start, end: c.response, flow: 'sync' }, ...c.branches.map(b => ({ ...b, flow: 'async' }))].map(branch => <div className="flow-row" key={branch.name}><span>{branch.name}</span><div className="flow-track"><div className={`flow-band ${branch.flow}`} style={{ left: `${(branch.start - c.start) / 1.82 * 100}%`, width: `${Math.max(0, Math.min(duration, branch.end) - branch.start) / 1.82 * 100}%` }}/>{c.events.filter(e => e.flow === branch.flow && (branch.flow === 'sync' || e.target === branch.name) && e.time <= duration).map(e => { const Icon = icons[e.kind]; return <Tooltip key={e.key}><TooltipTrigger asChild><button className={`flow-event ${e.kind}`} style={{ left: `${(e.time - c.start) / 1.82 * 100}%` }} aria-label={`${c.id} ${branch.name}: ${e.detail} at ${formatTime(e.time)}`} onClick={() => { onInspect(e); }}><Icon size={12}/></button></TooltipTrigger><TooltipContent>{formatTime(e.time)} · {e.detail}<br/>{e.source} → {e.target}</TooltipContent></Tooltip>; })}</div></div>)}<div className="flow-axis"><span>{formatTime(c.start)}</span><span>{formatTime(c.response)} response</span><span>{formatTime(c.end)} settled</span></div></div></div>
  </div>;
}
export function CycleInspector({ duration, playhead, onInspect, window }) {
  const [filter, setFilter] = useState('all'), [node, setNode] = useState('all');
  const [event, setEvent] = useState(null), [selectedCycle, setSelectedCycle] = useState(null), [expandedId, setExpandedId] = useState(null), [hovered, setHovered] = useState(null);
  const id = useId();
  const start = window?.[0] ?? 0, end = window?.[1] ?? duration;
  const visible = cycleHistory.filter(c => c.start <= end && c.end >= start && c.start < duration && (filter === 'all' || c.failed) && (node === 'all' || c.events.some(e => e.source === node || e.target === node)));
  const dense = visible.length > 40;
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const groups = [...visible.reduce((map, c) => { const bucket = Math.max(0, Math.min(11, Math.floor((c.start - start) / (end - start) * 12))); map.set(bucket, [...(map.get(bucket) ?? []), c]); return map; }, new Map()).entries()].sort(([a], [b]) => a - b).map(([bucket, cycles]) => ({ key: `${start}-${end}-${bucket}`, cycles, start: Math.max(start, Math.min(...cycles.map(c => c.start))), end: Math.min(end, Math.max(...cycles.map(c => c.end))), failures: cycles.filter(c => c.failed).length, asyncFailures: cycles.filter(c => c.asyncFailed).length, responses: cycles.filter(c => c.response <= duration).length, latency: Math.round(cycles.reduce((n, c) => n + (c.response - c.start) * 1000, 0) / cycles.length) }));
  const pos = t => Math.max(0, Math.min(100, (t - start) / (end - start) * 100));
  function select(c) { setSelectedCycle(c.id); setExpandedId(prev => prev === c.id ? null : c.id); setHovered(null); }
  function inspect(e) { setEvent(e); setSelectedCycle(e.cycle); setExpandedId(e.cycle); setHovered(null); onInspect(e); }
  function clear() { setEvent(null); onInspect(null); }
  const renderCycle = c => (<React.Fragment key={c.id}>
          <HoverCard open={hovered === c.id} onOpenChange={open => setHovered(open ? c.id : null)} openDelay={250} closeDelay={150}>
            <HoverCardTrigger asChild><div className={`cycle-lane ${c.syncFailed ? 'has-failure' : ''} ${c.asyncFailed ? 'has-background-failure' : ''} ${selectedCycle === c.id ? 'selected-row' : ''}`} role="row" tabIndex={0} aria-label={`Cycle ${c.id}`} aria-selected={selectedCycle === c.id} aria-expanded={expandedId === c.id} onFocus={() => setHovered(c.id)} onClick={e => { if (!e.target.closest('button')) select(c); }} onKeyDown={e => { if (e.target === e.currentTarget && ['Enter', ' '].includes(e.key)) { e.preventDefault(); select(c); } }}>
              <div role="gridcell"><button className="cycle-id" aria-label={`Expand ${c.id}`} aria-expanded={expandedId === c.id} onClick={() => select(c)}>{expandedId === c.id ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}{c.id}</button></div>
              <div className="cycle-track" role="gridcell">
                <div className="cycle-span sync-span" style={{ left: `${pos(c.start)}%`, right: `${100 - pos(c.response)}%` }}/><div className="async-tail" style={{ left: `${pos(c.response)}%`, right: `${100 - pos(c.end)}%` }}/>
                {c.response >= start && c.response <= end && <span className="response-marker" style={{ left: `${pos(c.response)}%` }}/>}
                {playhead >= start && playhead <= end && <div className="lane-playhead" style={{ left: `${pos(playhead)}%` }}/>}
                {c.events.filter(e => e.flow === 'sync' && e.time >= start && e.time <= end && e.time <= duration).map(e => { const Icon = icons[e.kind]; return <Tooltip key={e.key}><TooltipTrigger asChild><button className={`cycle-event ${e.kind} ${event?.key === e.key ? 'selected' : ''}`} aria-label={`${c.id} ${e.kind} at ${formatTime(e.time)}: ${e.source} to ${e.target}`} style={{ left: `${pos(e.time)}%` }} onClick={() => inspect(e)}><Icon size={12}/></button></TooltipTrigger><TooltipContent>{formatTime(e.time)} · {e.detail}</TooltipContent></Tooltip>; })}
              </div>
            </div></HoverCardTrigger>
            <HoverCardContent className="cycle-summary-popover" side="top" align="start" collisionPadding={8} aria-label={`Summary ${c.id}`}>
              <strong>{c.id} · checkout</strong><Summary cycle={c} duration={duration}/>
              <div className="summary-mini-flow"><span>Response</span><i style={{ width: `${(c.response - c.start) / (c.end - c.start) * 100}%` }}/><span>Background</span><i className="async" style={{ width: '100%' }}/></div>
              <p>{c.branches.length} async branches · {c.events.length} events</p>
            </HoverCardContent>
          </HoverCard>
          {expandedId === c.id && <div className="cycle-inline-detail" role="row"><div role="gridcell" aria-colspan={2}><CycleFlow cycle={c} duration={duration} onInspect={inspect}/></div></div>}
        </React.Fragment>);
  return <section className="cycle-inspector" aria-label="Cycle inspector" onKeyDown={e => { if (e.key === 'Escape') { setExpandedId(null); setHovered(null); setExpandedGroup(null); setHoveredGroup(null); } }}>
    <div className="inspector-controls">
      <div className="cycle-filter" role="group" aria-label="Cycle filter"><Button variant={filter === 'all' ? 'tint' : 'ghost'} aria-pressed={filter === 'all'} onClick={() => { setFilter('all'); clear(); }}>All cycles</Button><Button variant={filter === 'failures' ? 'tint' : 'ghost'} aria-pressed={filter === 'failures'} onClick={() => { setFilter('failures'); clear(); }}>Failures</Button></div>
      <label htmlFor={`${id}-node`}>Node<NativeSelect id={`${id}-node`} value={node} onChange={e => { setNode(e.target.value); clear(); }}><option value="all">All nodes</option>{['Storefront', 'API gateway', 'Checkout API', 'Orders DB', 'Receipt email', 'Analytics export'].map(n => <option key={n}>{n}</option>)}</NativeSelect></label>
      <span className="shared-window">{formatTime(start)}–{formatTime(end)}</span>
    </div>
    <div className="cycle-summary"><span>{visible.length} cycles · {visible.filter(c => c.failed).length} with failures</span><span>Uses the main timeline scale</span></div>
    {
      <div className="cycle-lanes" role="grid" aria-label="Concurrent cycle lanes"><div className="lanes-inner" role="rowgroup">
        <div className="lane-axis" role="row"><span role="columnheader">Cycle</span><div role="columnheader"><span>{formatTime(start)}</span><span>{formatTime((start + end) / 2)}</span><span>{formatTime(end)}</span></div></div>
        {visible.length === 0 && <p className="cycle-empty">No matching cycles in this window.</p>}
        {dense ? groups.map(group => group.cycles.length <= 12 ? group.cycles.map(renderCycle) : <React.Fragment key={group.key}>
          <HoverCard open={hoveredGroup === group.key} onOpenChange={open => setHoveredGroup(open ? group.key : null)} openDelay={250} closeDelay={150}>
            <HoverCardTrigger asChild><div className="cycle-group-row" role="row" tabIndex={0} aria-label={`Cycle group ${formatTime(group.start)}`} aria-expanded={expandedGroup === group.key} onClick={() => { setExpandedGroup(prev => prev === group.key ? null : group.key); setHoveredGroup(null); }} onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); setExpandedGroup(prev => prev === group.key ? null : group.key); setHoveredGroup(null); } }}>
              <div role="gridcell" className="cycle-group-title">{expandedGroup === group.key ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}<strong>{group.cycles.length} cycles</strong><span>{group.responses} responses · {group.failures} with failures</span></div>
              <div role="gridcell" className="cycle-group-track"><div className="group-duration" style={{ left: `${pos(group.start)}%`, right: `${100 - pos(group.end)}%` }}/><span>{group.latency} ms avg response{group.asyncFailures > 0 ? ` · ${group.asyncFailures} background failure` : ''}</span></div>
            </div></HoverCardTrigger>
            <HoverCardContent className="cycle-summary-popover" side="top" align="start" collisionPadding={8}><strong>{group.cycles.length} checkout cycles</strong><div className="flow-summary"><span>{formatTime(group.start)}–{formatTime(group.end)}</span><span>{group.responses} successful responses · {group.latency} ms average</span><span>{group.failures} cycles with recorded failures</span><span>{group.asyncFailures} background failures</span></div><div className="summary-mini-flow"><span>Responses</span><i style={{ width: `${group.responses / group.cycles.length * 100}%` }}/><span>Async work</span><i className="async" style={{ width: '100%' }}/></div></HoverCardContent>
          </HoverCard>
          {expandedGroup === group.key && group.cycles.map(renderCycle)}
        </React.Fragment>) : visible.map(renderCycle)}
      </div></div>}
    <div className="event-legend"><span><ArrowUpRight size={12}/>Send</span><span><Activity size={12}/>Arrival</span><span><RotateCcw size={12}/>Retry</span><span className="failure"><X size={12}/>Failure</span><span><Check size={12}/>Complete</span></div>
    <div className="event-details" aria-live="polite">{event ? <><div><strong>{event.cycle} · {formatTime(event.time)}</strong><span className={event.kind === 'failure' ? 'failure' : ''}>{event.detail}</span></div><div><span>{event.source} → {event.target}</span><span>{event.latency}</span></div></> : <p>Select a cycle row to expand; select an event to inspect its communication.</p>}</div>
  </section>;
}

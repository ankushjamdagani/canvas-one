import type { TrafficOutcome, TrafficNodeActivity, TrafficConnectionActivity } from '@canvas-one/playback/traffic';
export type { TrafficOutcomeKind, TrafficOutcome, TrafficNodeActivity, TrafficConnectionActivity } from '@canvas-one/playback/traffic';
import { useId, useState, useRef, useLayoutEffect, type CSSProperties, type ReactNode } from 'react';
import { Server, Cpu, ListOrdered, Hourglass, TimerReset, PauseCircle, Check, TriangleAlert, Ban, Timer, TimerOff, CircleX, RotateCcw, MailX, Unlink, Clock, Pin } from 'lucide-react';
export interface CellsAndLanesNodeProps { label: string; metadata?: string; activity: TrafficNodeActivity; style?: CSSProperties; className?: string; /** Attach cells below an existing host card without replacing its controls. */ activityOnly?: boolean }

export interface CellsAndLanesConnectionProps { activity: TrafficConnectionActivity; width?: number; progress?: number; reducedMotion?: boolean; label?: string; /** SVG host path, with the same bounded lane vocabulary as the guide. */ path?: string }
const ink = 'var(--foreground)', body = 'var(--body)', muted = 'var(--secondary-text)', off = 'var(--secondary-text)', green = 'var(--action-text)', purple = 'var(--branch-text)', clay = 'var(--risk-text)';
const mono: CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
const outcomes = {
  success: ['Success', Check, muted], error: ['Processing error', TriangleAlert, clay], rejected: ['Admission rejected', Ban, clay],
  timeout: ['Caller timeout', Timer, clay], expired: ['Expired', TimerOff, clay], cancelled: ['Cancelled', CircleX, muted],
  retryExhausted: ['Retry exhausted', RotateCcw, clay], redeliveryExhausted: ['Redelivery exhausted', MailX, clay],
  lost: ['Delivery lost', Unlink, clay], late: ['Late return', Clock, muted],
} as const;
// Counts remain exact; density changes the marks, never the reported population.
const fmt = (n: number) => String(n);
function OutcomeTray({ values = [], stuck }: { values?: TrafficOutcome[]; stuck?: number }) {
  const visible = values.filter(v => v.rate > 0), limit = stuck ? 2 : 3;
  return <div data-traffic-outcome-tray="" style={{ display: 'flex', gap: 8, alignItems: 'center', height: 24, padding: '0 9px', background: 'var(--sunken)', border: '1px solid var(--hairline)', borderTop: 0, borderRadius: '0 0 7px 7px', fontSize: 9, ...mono }}>
    {!!stuck && <span title="Open waits with recorded no progress" style={{ color: clay, display: 'flex', gap: 3 }}><PauseCircle size={11} />{stuck} waits</span>}
    {visible.slice(0, limit).map(v => { const [name, Icon, color] = outcomes[v.kind]; return <span key={v.kind} title={`${name}: ${v.rate}/s · last 10s${v.detail ? ` · ${v.detail}` : ''}`} style={{ color, display: 'flex', alignItems: 'center', gap: 3 }}><Icon size={11} />{fmt(v.rate)}/s</span>; })}
    {visible.length > limit && <span style={{ color: muted }}>+{visible.length - limit}</span>}
    {!visible.length && !stuck && <span style={{ color: muted }}>No events · last 10s</span>}
  </div>;
}
export function CellsAndLanesNode({ label, metadata, activity: a, style, className, activityOnly = false }: CellsAndLanesNodeProps) {
  const [hover, setHover] = useState(false), [focus, setFocus] = useState(false), [pinned, setPinned] = useState(false);
  const pointerType = useRef('mouse');
  const touchOrigin = useRef({ x: 0, y: 0 });
  const open = hover || focus || pinned, full = a.capacity > 0 && a.processing >= a.capacity;
  const cells = [
    { name: 'Queued', count: a.queued, text: fmt(a.queued), Icon: ListOrdered, color: purple },
    { name: 'Processing', count: a.processing, text: `${fmt(a.processing)}/${fmt(a.capacity)}`, Icon: Cpu, color: full ? 'var(--accent-foreground)' : ink },
    { name: 'Awaiting responses', count: a.awaiting, text: fmt(a.awaiting), Icon: Hourglass, color: ink },
    { name: 'Retry scheduled', count: a.retry, text: fmt(a.retry), Icon: TimerReset, color: clay },
  ];
  return <div role="button" tabIndex={0} aria-label={`${label}. ${cells.map(c => `${c.name}: ${c.text}`).join('. ')}`} aria-expanded={open}
    className={`nodrag nopan ${className ?? ''}`} data-cells-lanes-node="" data-queued={a.queued} data-processing={a.processing} data-awaiting={a.awaiting} data-retry={a.retry} onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(false); }}
    onPointerDown={e => { pointerType.current = e.pointerType; touchOrigin.current = { x: e.clientX, y: e.clientY }; if (e.pointerType !== 'mouse') { setHover(false); setFocus(false); } }}
    onPointerUp={e => { if (e.pointerType === 'mouse') return; const box = e.currentTarget.getBoundingClientRect(); if (e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom && Math.hypot(e.clientX - touchOrigin.current.x, e.clientY - touchOrigin.current.y) < 8) { e.stopPropagation(); setHover(false); setFocus(false); setPinned(v => !v); } }}
    onFocus={e => { setFocus(pointerType.current === 'mouse' && e.currentTarget.matches(':focus-visible')); }} onBlur={() => { pointerType.current = 'mouse'; setFocus(false); }} onClick={e => { e.stopPropagation(); if (pointerType.current !== 'mouse' && e.detail !== 0) return; setPinned(v => !v); }}
    onKeyDown={e => { e.stopPropagation(); pointerType.current = 'mouse'; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned(v => !v); } if (e.key === 'Escape') { setPinned(false); setHover(false); setFocus(false); e.currentTarget.blur(); } }}
    style={{ position: 'relative', width: 208, flex: '0 0 208px', fontFamily: 'var(--font-sans)', textAlign: 'left', color: ink, cursor: 'pointer', outline: 'none', zIndex: open ? 10 : 1, ...style }}>
    <div style={{ border: `1px solid ${pinned ? green : hover ? 'var(--hover-border)' : 'var(--control-border)'}`, borderRadius: 9, overflow: 'hidden', background: 'var(--background)', boxShadow: focus ? 'var(--ring-strong)' : undefined }}>
      {!activityOnly && <><div style={{ height: 3, background: green }} />
      <div style={{ height: 40, display: 'flex', gap: 9, alignItems: 'center', padding: '0 10px' }}>
        <Server size={13} style={{ background: 'var(--sunken)', border: '1px solid var(--control-border)', borderRadius: 6, boxSizing: 'content-box', padding: 4, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div><div style={{ fontSize: 8.5, color: muted, ...mono }}>{metadata ?? `Service · ${a.capacity} slots`}</div></div>{pinned && <Pin size={12} color={green} />}
      </div></>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', height: 32, borderTop: '1px solid var(--hairline-soft)' }}>
        {cells.map((c, index) => <div key={c.name} title={`${c.name}: ${c.text}`} aria-label={`${c.name}: ${c.text}`} style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderLeft: index ? '1px solid var(--hairline-soft)' : undefined, color: c.count ? c.color : off, background: index === 1 && full ? 'var(--accent)' : undefined }}>
          <c.Icon size={12} style={{ flexShrink: 0 }} /><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 10.5, fontWeight: c.count ? 600 : 400, ...mono }}>{c.text}</span>
          {index === 1 && <div style={{ position: 'absolute', left: 6, right: 6, bottom: 3, display: 'flex', gap: 1.5 }}>{Array.from({ length: Math.min(8, a.capacity) }, (_, i) => <span key={i} style={{ height: 2, flex: 1, background: i < Math.round(a.processing / Math.max(1, a.capacity) * Math.min(8, a.capacity)) ? c.color : 'var(--hairline)' }} />)}</div>}
          {index === 2 && <div style={{ position: 'absolute', bottom: 3, display: 'flex', gap: 3 }}>{a.services?.filter(s => s.pending > 0).slice(0, 4).map(s => <span key={s.name} style={{ width: 3, height: 3, background: body, borderRadius: '50%' }} />)}</div>}
          {index === 2 && a.noProgress && <span title="Recorded no progress" style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, background: clay }} />}
        </div>)}
      </div>
    </div>
    <OutcomeTray values={a.outcomes} stuck={a.noProgress?.count} />
    {open && <div data-traffic-inspection="" onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: 0, paddingTop: 6, width: 240, cursor: 'default' }}>
      <div style={{ background: 'var(--canvas)', border: '1px solid var(--control-border)', borderRadius: 11, padding: 12, boxShadow: 'var(--tw-shadow-popover)', fontSize: 11.5 }}>
        <div style={{ color: muted, fontSize: 9, ...mono }}>Current populations</div>
        {cells.filter(c => c.count).map(c => <div key={c.name} style={{ marginTop: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{c.name}</span><span style={mono}>{c.name === 'Processing' ? `${a.processing} of ${a.capacity} slots` : `${c.count} ${c.name === 'Awaiting responses' ? 'calls' : 'items'}`}</span></div>
          {c.name === 'Awaiting responses' && a.services?.filter(s => s.pending > 0).map(s => <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', color: muted, paddingTop: 4 }}><span>{s.name}</span><span style={mono}>{s.pending}</span></div>)}
          {c.name === 'Retry scheduled' && a.retryIn && <div style={{ color: muted, marginTop: 4 }}>Next attempt in {a.retryIn}</div>}
        </div>)}
        {!cells.some(c => c.count) && <div style={{ color: muted, marginTop: 8 }}>No current activity.</div>}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--hairline)', color: muted, fontSize: 9, ...mono }}>Recorded outcomes · per second · last 10s</div>
        {a.outcomes?.filter(v => v.rate > 0).map(v => { const [name, Icon, color] = outcomes[v.kind]; return <div key={v.kind} title={v.detail} style={{ marginTop: 6, color }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Icon size={12} /><span>{name}</span><span style={{ marginLeft: 'auto', ...mono }}>{v.rate}/s</span></div>{v.detail && <div style={{ color: muted, marginTop: 3 }}>{v.detail}</div>}</div>; })}
        {!a.outcomes?.some(v => v.rate > 0) && <div style={{ color: muted, marginTop: 6 }}>No events in the last 10s.</div>}
        {a.noProgress && <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 10, paddingTop: 8, color: clay }}>No progress · {a.noProgress.count} open waits on {a.noProgress.service}, unchanged for {a.noProgress.age}.</div>}
        <div style={{ marginTop: 10, color: muted, fontSize: 9 }}>{pinned ? 'Pinned · click or Escape to release' : 'Click or Enter to pin'}</div>
      </div>
    </div>}
  </div>;
}

/** Host supplies simulation progress in [0,1); this component does not own a clock. */
export function CellsAndLanesConnection(props: CellsAndLanesConnectionProps) {
  return props.path !== undefined ? <RoutedConnection {...props} path={props.path} /> : <StraightConnection {...props} />;
}

function StraightConnection({ activity: a, width = 320, progress = 0.4, reducedMotion = false, label = 'call · HTTP / REST' }: CellsAndLanesConnectionProps) {
  const id = useId().replace(/:/g, ''), end = width - 12;
  const markers = (count: number, reverse: boolean) => {
    const total = Math.min(12, Math.max(1, Math.ceil(count / 2))), y = reverse ? 52 : 40;
    return Array.from({ length: total }, (_, i) => {
      const fraction = reducedMotion ? (i + .5) / total : ((progress + i / total) % 1 + 1) % 1;
      const start = !reverse && a.blocked ? 42 : 12;
      const finish = !reverse && a.loss ? width / 2 - 12 : end;
      const x = start + (finish - start) * (reverse ? 1 - fraction : fraction);
      const isError = reverse && i === 0 && !!a.errors;
      const color = isError ? clay : a.asynchronous ? purple : body;
      const shape = isError ? 'M0 -4L4 0L0 4L-4 0Z' : a.asynchronous ? 'M-3 -3H3V3H-3Z' : 'M4 0L-3 -3L-3 3Z';
      return <path key={i} data-traffic-marker="" d={shape} transform={`translate(${x} ${y})${reverse && !isError && !a.asynchronous ? ' rotate(180)' : ''}`} fill={reverse && !isError ? 'var(--background)' : color} stroke={color} strokeWidth={1.2} />;
    });
  };
  const chip: CSSProperties = { position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', background: 'var(--background)', border: '1px solid var(--hairline)', borderRadius: 4, padding: '2px 5px', fontSize: 9, ...mono };
  return <div data-cells-lanes-connection="" style={{ position: 'relative', width, flex: `0 0 ${width}px`, color: ink, fontFamily: 'var(--font-sans)' }}>
    <div style={{ textAlign: 'center', fontSize: 10, color: muted }}>{label}</div>
    <svg width={width} height={100} viewBox={`0 0 ${width} 100`} role="img" aria-label={`${a.forward} ${a.asynchronous ? 'messages' : 'requests'} forward; ${a.returning} ${a.asynchronous ? 'acknowledgements' : 'responses'} returning; ${a.blocked ?? 0} blocked`}>
      <defs><marker id={`${id}-arrow`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0L5 2.5L0 5Z" fill="var(--control-border)" /></marker></defs>
      <path d={a.loss ? `M0 46H${width / 2 - 9}M${width / 2 + 9} 46H${width - 4}` : `M0 46H${width - 4}`} fill="none" stroke={a.asynchronous ? purple : a.forward || a.returning ? 'var(--secondary-text)' : 'var(--control-border)'} strokeDasharray={a.asynchronous ? '4 3' : undefined} markerEnd={`url(#${id}-arrow)`} />
      {([{ count: a.forward, reverse: false }, { count: a.returning, reverse: true }]).map(({ count, reverse }, i) => count > 0 && <g key={i}>
        {count > 50 && <path d={`M${!reverse && a.blocked ? 42 : 12} ${reverse ? 52 : 40}H${!reverse && a.loss ? width / 2 - 12 : end}`} stroke={a.asynchronous ? purple : body} strokeWidth={reverse ? 1.4 : 2.4} strokeDasharray={reverse ? '5 4' : '0.01 6'} strokeDashoffset={reducedMotion ? 0 : (reverse ? 1 : -1) * progress * 46} strokeLinecap="round" />}
        {markers(count, reverse)}
      </g>)}
      {!!a.blocked && <g><path d="M33 28V44" stroke={ink} strokeWidth={2} />{[0,1,2].map(i => <path key={i} d="M4 0L-3 -3L-3 3Z" transform={`translate(${25 - i * 8} 40)`} fill={body} />)}<text x={20} y={94} fontSize={9} fill={body}>{a.blocked} held at sending end</text></g>}
      {!!a.late && <path d="M8 47V57" stroke={muted} strokeWidth={1.5} />}
      {!!a.late && <circle data-late-return="" cx={12 + (end - 12) * (reducedMotion ? .5 : 1 - ((progress + .17) % 1))} cy={52} r={3} fill="var(--background)" stroke={muted} strokeWidth={1.2} strokeDasharray="1.6 1.3" />}
      {a.loss && <g transform={`translate(${width / 2 - 6} 40)`}><circle cx={6} cy={6} r={8} fill="var(--background)" /><Unlink size={12} color={clay} /></g>}
      {a.exhausted && <g transform={`translate(${width / 2 - 6} 40)`}><circle cx={6} cy={6} r={8} fill="var(--background)" /><MailX size={12} color={clay} /></g>}
    </svg>
    {!!a.forward && <span style={{ ...chip, top: 24 }}>→ {fmt(a.forward)} {a.asynchronous ? 'messages' : 'in flight'}</span>}
    {!!a.returning && <span style={{ ...chip, top: 80 }}>← {fmt(a.returning)} {a.asynchronous ? 'ACKs' : 'returning'}{a.errors ? ` · ${fmt(a.errors)} error` : ''}{a.late ? ` · ${fmt(a.late)} late` : ''}</span>}
    {!!a.outcomes?.length && <OutcomeTray values={a.outcomes} />}
  </div>;
}

/** Orthogonal and curved canvas paths retain their geometry and separate opposing lanes. */
function RoutedConnection({ activity: a, path, progress = 0, reducedMotion = false }: CellsAndLanesConnectionProps & { path: string }) {
  const ref = useRef<SVGPathElement>(null);
  const [marks, setMarks] = useState<ReactNode[]>([]);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const length = svg.getTotalLength();
    const point = (fraction: number, offset: number) => {
      const distance = length * Math.max(0, Math.min(1, fraction));
      const p = svg.getPointAtLength(distance);
      const before = svg.getPointAtLength(Math.max(0, distance - 1));
      const after = svg.getPointAtLength(Math.min(length, distance + 1));
      const angle = Math.atan2(after.y - before.y, after.x - before.x);
      return { x: p.x - Math.sin(angle) * offset, y: p.y + Math.cos(angle) * offset, angle: angle * 180 / Math.PI };
    };
    const next: ReactNode[] = [];
    for (const reverse of [false, true]) {
      const count = reverse ? a.returning : a.forward;
      if (count <= 0) continue;
      const total = Math.min(12, Math.max(1, Math.ceil(count / 2)));
      for (let i = 0; i < total; i++) {
        const f = reducedMotion ? (i + .5) / total : ((progress + i / total) % 1 + 1) % 1;
        const p = point(.04 + .92 * (reverse ? 1 - f : f), reverse ? 6 : -6);
        const error = reverse && !!a.errors && i === 0;
        const late = reverse && !!a.late && i === total - 1;
        const color = error ? clay : a.asynchronous ? purple : body;
        const shape = error ? 'M0 -4L4 0L0 4L-4 0Z' : a.asynchronous ? 'M-3 -3H3V3H-3Z' : 'M4 0L-3 -3L-3 3Z';
        next.push(late && !error ? <circle key={`${reverse}-${i}`} data-traffic-marker="" data-late-return="" data-direction="back" cx={p.x} cy={p.y} r={3} fill="var(--background)" stroke={muted} strokeWidth={1.2} strokeDasharray="1.6 1.3" /> : <path key={`${reverse}-${i}`} data-traffic-marker="" data-direction={reverse ? 'back' : 'out'} d={shape} transform={`translate(${p.x} ${p.y}) rotate(${p.angle + (reverse ? 180 : 0)})`} fill={reverse && !error ? 'var(--background)' : color} stroke={color} strokeWidth={1.2} strokeDasharray={late ? '1.6 1.3' : undefined} />);
      }
    }
    if (a.blocked) {
      const p = point(.04, 0);
      next.push(<path key="blocked" d="M0 -9V9" stroke={ink} strokeWidth={2} transform={`translate(${p.x} ${p.y}) rotate(${p.angle})`} />);
    }
    setMarks(next);
  }, [a.forward, a.returning, a.errors, a.late, a.asynchronous, a.blocked, path, progress, reducedMotion]);
  return <g data-cells-lanes-connection="" data-progress={progress} data-forward={a.forward} data-returning={a.returning} aria-label={`${a.forward} forward; ${a.returning} returning; ${a.blocked ?? 0} held at sending end`} pointerEvents="none">
    <path ref={ref} d={path} fill="none" stroke={a.asynchronous ? purple : 'var(--control-border)'} strokeDasharray={a.asynchronous ? '4 3' : undefined} />
    {([false, true]).map(reverse => (reverse ? a.returning : a.forward) > 50 && <path key={String(reverse)} data-traffic-band="" d={path} fill="none" stroke={a.asynchronous ? purple : body} strokeWidth={2} strokeDasharray={reverse ? '5 4' : '0.01 6'} strokeLinecap="round" strokeDashoffset={reducedMotion ? 0 : (reverse ? 1 : -1) * progress * 46} transform={`translate(0 ${reverse ? 6 : -6})`} />)}
    {marks}
  </g>;
}

/** HTML inspection for SVG hosts; the host positions it with its label portal. */
export function CellsAndLanesConnectionInspection({ activity: a, label }: { activity: TrafficConnectionActivity; label: string }) {
  const [hover, setHover] = useState(false), [focus, setFocus] = useState(false), [pinned, setPinned] = useState(false);
  const pointerType = useRef('mouse');
  const touchOrigin = useRef({ x: 0, y: 0 });
  const open = hover || focus || pinned;
  return <div role="button" tabIndex={0} aria-label={`${label}: ${a.forward} forward, ${a.returning} returning, ${a.blocked ?? 0} blocked`} aria-expanded={open}
    className="nodrag nopan" data-traffic-connection-inspection="" onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(false); }}
    onPointerDown={e => { pointerType.current = e.pointerType; touchOrigin.current = { x: e.clientX, y: e.clientY }; if (e.pointerType !== 'mouse') { setHover(false); setFocus(false); } }}
    onPointerUp={e => { if (e.pointerType === 'mouse') return; const box = e.currentTarget.getBoundingClientRect(); if (e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom && Math.hypot(e.clientX - touchOrigin.current.x, e.clientY - touchOrigin.current.y) < 8) { e.stopPropagation(); setHover(false); setFocus(false); setPinned(v => !v); } }}
    onFocus={e => { setFocus(pointerType.current === 'mouse' && e.currentTarget.matches(':focus-visible')); }} onBlur={() => { pointerType.current = 'mouse'; setFocus(false); }}
    onClick={e => { e.stopPropagation(); if (pointerType.current !== 'mouse' && e.detail !== 0) return; setPinned(v => !v); }} onKeyDown={e => { e.stopPropagation(); pointerType.current = 'mouse'; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned(v => !v); } if (e.key === 'Escape') { setPinned(false); setHover(false); setFocus(false); e.currentTarget.blur(); } }}
    style={{ position: 'relative', background: 'var(--background)', color: ink, border: `1px solid ${pinned ? green : 'var(--control-border)'}`, borderRadius: 5, padding: '3px 6px', cursor: 'pointer', whiteSpace: 'nowrap', outline: focus ? `2px solid ${green}` : undefined, fontSize: 9, ...mono }}>
    <span>→ {a.forward} · ← {a.returning}{a.blocked ? ` · ${a.blocked} held` : ''}</span>
    {!!a.outcomes?.some(o => o.rate > 0) && <OutcomeTray values={a.outcomes} />}
    {open && <div data-traffic-inspection="" onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '100%', left: 0, width: 240, paddingTop: 6, whiteSpace: 'normal', cursor: 'default' }}>
      <div style={{ background: 'var(--canvas)', border: '1px solid var(--control-border)', borderRadius: 8, padding: 12, boxShadow: 'var(--tw-shadow-popover)' }}>
        <div style={{ marginBottom: 8 }}>{label}</div>
        <div>{a.forward} {a.asynchronous ? 'messages' : 'requests'} in flight</div><div>{a.returning} {a.asynchronous ? 'acknowledgements' : 'responses'} returning</div>
        {!!a.errors && <div>{a.errors} error returns (included in returning)</div>}{!!a.late && <div>{a.late} late returns (included in returning)</div>}
        {!!a.blocked && <div>{a.blocked} held at sending end</div>}
        <div style={{ marginTop: 10, color: muted }}>Recorded outcomes · /s · last 10s</div>
        {a.outcomes?.filter(o => o.rate > 0).map(o => <div key={o.kind} style={{ marginTop: 6 }}><span>{outcomes[o.kind][0]}: {o.rate}/s</span>{o.detail && <div style={{ color: muted }}>{o.detail}</div>}</div>)}
        {!a.outcomes?.some(o => o.rate > 0) && <div>No events in the last 10s.</div>}
      </div>
    </div>}
  </div>;
}

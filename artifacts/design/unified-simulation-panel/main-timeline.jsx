import React, { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Hand, MousePointer2, X } from 'lucide-react';
import { Button } from '../../../src/components/ui/button';
import { Slider } from '../../../src/components/ui/slider';
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../src/components/ui/tooltip';
import { cycleHistory, failureTimes, formatTime } from './cycles';

export function MainTimeline({ duration, playhead, selection, window, onWindow, onSeek, onRange, onClear, children }) {
  const surface = useRef(null);
  const points = useRef(new Map());
  const gesture = useRef(null);
  const [pan, setPan] = useState(false);
  const [hoverBin, setHoverBin] = useState(null);
  const start = Math.min(window?.[0] ?? 0, Math.max(0, duration - .1));
  const end = Math.max(start + .1, Math.min(window?.[1] ?? duration, duration));
  const span = end - start;
  const position = t => (t - start) / span * 100;
  function fit(left, width) { width = Math.min(duration, Math.max(Math.min(.5, duration), width)); left = Math.max(0, Math.min(duration - width, left)); onWindow([left, left + width]); }
  function zoom(factor, anchor = .5) { const width = Math.min(duration, Math.max(.5, span * factor)); fit(start + span * anchor - width * anchor, width); }
  useEffect(() => {
    const el = surface.current;
    function wheel(e) {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); const rect = el.getBoundingClientRect(); zoom(Math.exp(e.deltaY * .01), Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))); }
      else if (Math.abs(e.deltaX) > 0) { e.preventDefault(); fit(start + e.deltaX / el.clientWidth * span, span); }
    }
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [start, end, duration]);
  function down(e) {
    if (e.target.closest('[data-slot="slider-thumb"]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const touches = [...points.current.values()];
    if (touches.length === 1) gesture.current = { range: [start, end], x: e.clientX, left: rect.left, width: rect.width, seek: Boolean(e.target.closest('.playhead')), pan: pan || e.shiftKey, moved: false, multi: false };
    if (touches.length === 2) { const [a, b] = touches; gesture.current = { ...gesture.current, range: [start, end], distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), anchor: ((a.x + b.x) / 2 - rect.left) / rect.width, multi: true }; }
  }
  function move(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverBin(Math.max(0, Math.min(99, Math.floor((e.clientX - rect.left) / rect.width * 100))));
    if (!points.current.has(e.pointerId) || !gesture.current) return;
    points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current, touches = [...points.current.values()];
    if (Math.abs(e.clientX - g.x) > 3) g.moved = true;
    if (touches.length === 2 && g.distance) { const [a, b] = touches; const width = Math.min(duration, Math.max(.5, (g.range[1] - g.range[0]) * g.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)))); fit(g.range[0] + g.anchor * (g.range[1] - g.range[0]) - (((a.x + b.x) / 2 - g.left) / g.width) * width, width); }
    else if (g.pan && !g.multi) fit(g.range[0] - (e.clientX - g.x) / g.width * (g.range[1] - g.range[0]), g.range[1] - g.range[0]);
    else if (!g.multi && g.seek) onSeek(Math.max(start, Math.min(end, start + (e.clientX - rect.left) / rect.width * span)));
    else if (!g.multi && g.moved) { const a = Math.max(start, Math.min(end, start + (g.x - rect.left) / rect.width * span)), b = Math.max(start, Math.min(end, start + (e.clientX - rect.left) / rect.width * span)); if (Math.abs(a - b) >= .1) onRange([Math.min(a, b), Math.max(a, b)]); }
  }
  function up(e) {
    const g = gesture.current;
    if (g && !g.multi && !g.pan && (!g.moved || g.seek) && points.current.has(e.pointerId)) onSeek(Math.max(start, Math.min(end, start + (e.clientX - g.left) / g.width * span)));
    points.current.delete(e.pointerId);
    if (points.current.size === 0) gesture.current = null;
  }
  const bins = Array.from({ length: 100 }, (_, i) => { const left = start + i / 100 * span, right = start + (i + 1) / 100 * span; return cycleHistory.filter(c => c.start < right && c.end > left && c.start < duration).length; });
  const peak = Math.max(1, ...bins);
  const groups = [...failureTimes.filter(t => t >= start && t <= end).reduce((map, t) => { const bin = Math.floor(position(t) / 4); map.set(bin, [...(map.get(bin) ?? []), t]); return map; }, new Map()).values()];
  const visibleRange = selection ? [Math.max(start, selection[0]), Math.min(end, selection[1])] : null;
  const rangeVisible = visibleRange && visibleRange[0] < visibleRange[1];
  return <div className="main-timeline" data-window-start={start} data-window-end={end} data-selection={selection ? JSON.stringify(selection) : ''}>
    <div className="timeline-heading"><span className="timeline-label">Activity density</span><div className="main-timeline-tools">
      {[[MousePointer2, 'Seek on timeline', !pan, () => setPan(false)], [Hand, 'Pan timeline', pan, () => setPan(true)], [ZoomIn, 'Zoom in timeline', undefined, () => zoom(.5, Math.max(0, Math.min(1, (playhead - start) / span)))], [ZoomOut, 'Zoom out timeline', undefined, () => zoom(2)], [Maximize, 'Fit recording', undefined, () => onWindow(null)]].map(([Icon, label, pressed, action]) => <Tooltip key={label}><TooltipTrigger asChild><Button size="icon" variant={pressed ? 'tint' : 'ghost'} aria-label={label} aria-pressed={pressed} onClick={action}><Icon size={16}/></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>)}{children}
      {selection && <Tooltip><TooltipTrigger asChild><Button size="icon" variant="ghost" aria-label="Clear Selection" onClick={onClear}><X size={16}/></Button></TooltipTrigger><TooltipContent>Clear Selection</TooltipContent></Tooltip>}
    </div></div>
    <div className={`timeline main-zoom-surface ${pan ? 'pan-mode' : ''}`} ref={surface} role="slider" tabIndex={0} aria-label="Recording playhead" aria-valuemin={start} aria-valuemax={end} aria-valuenow={Math.max(start, Math.min(end, playhead))} aria-valuetext={formatTime(playhead)} title={hoverBin === null ? 'Pinch to zoom; use Hand or Shift-drag to pan' : `${formatTime(start + hoverBin / 100 * span)}–${formatTime(start + (hoverBin + 1) / 100 * span)} · ${bins[hoverBin]} active cycles`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={e => { points.current.delete(e.pointerId); gesture.current = null; }} onKeyDown={e => { if (e.target !== e.currentTarget) return; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); onSeek(e.key === 'Home' ? start : e.key === 'End' ? end : Math.max(start, Math.min(end, playhead + (e.key === 'ArrowLeft' ? -.1 : .1)))); } }}>
      <div className="density" aria-hidden="true">{bins.map((count, i) => <i key={i} style={{ height: `${count / peak * 100}%`, background: 'var(--primary)', opacity: selection && (start + (i + .5) / 100 * span < selection[0] || start + (i + .5) / 100 * span > selection[1]) ? .22 : .6 }}/>)}</div>
      {rangeVisible && <div className="range-fill" style={{ left: `${position(visibleRange[0])}%`, width: `${position(visibleRange[1]) - position(visibleRange[0])}%` }}/ >}
      {playhead >= start && playhead <= end && <div className="playhead" style={{ left: `${position(playhead)}%` }}><span/></div>}
      {selection && selection[0] >= start && selection[1] <= end && <Slider className="range-slider" aria-label="Playback range" thumbLabels={['Range start', 'Range end']} thumbValueTexts={selection.map(formatTime)} min={start} max={end} step={.1} minStepsBetweenThumbs={1} value={selection} onPointerDown={e => { if (e.target.closest('[data-slot="slider-thumb"]')) e.stopPropagation(); }} onValueChange={onRange}/>}
      {selection && selection.map((t, i) => t >= start && t <= end && <span key={i} className={`range-handle-time range-${i ? 'end' : 'start'}`} style={{ left: `${position(t)}%` }}>{formatTime(t)}</span>)}
    </div>
    <div className="failure-overview" aria-label="Failure track"><span>Failures</span><div>{groups.map(group => { const t = group[Math.floor(group.length / 2)]; return <Tooltip key={t}><TooltipTrigger asChild><button aria-label={`Inspect ${group.length} failures near ${formatTime(t)}`} style={{ left: `${position(t)}%` }} onClick={() => onSeek(t)}><span>× {group.length}</span></button></TooltipTrigger><TooltipContent>{group.length} failures · {formatTime(group[0])}–{formatTime(group.at(-1))}</TooltipContent></Tooltip>; })}</div></div>
    <div className="ticks"><span>{formatTime(start)}</span><span>{formatTime(start + span / 3)}</span><span>{formatTime(start + span * 2 / 3)}</span><span>{formatTime(end)}</span></div>
  </div>;
}

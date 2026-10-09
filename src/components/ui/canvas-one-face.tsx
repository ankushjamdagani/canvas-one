import * as React from 'react';
import { cn } from '@/lib/utils';
import './canvas-one-face.css';

export const FACE_EXPRESSIONS = { base: 'Ready', wink: 'Thinking', look: 'Reading', squint: 'Working', pixel: 'Checking', thought: 'Brainstorming', reply: 'Suggestion ready', round: 'Chat', antenna: 'Connecting', listen: 'Listening', wait: 'Your turn', happy: 'Done', error: 'Error', sleep: 'Offline', empty: 'Empty board' } as const;
export type FaceExpression = keyof typeof FACE_EXPRESSIONS;
export type CanvasOneFaceProps = React.ComponentProps<'svg'> & { expression?:FaceExpression; size?:number; tone?:'ink'|'icon'; animate?:boolean; transition?:boolean; paused?:boolean };

function bubble(x:number, y:number, w:number, h:number, r:number) {
  const R = x + w, B = y + h;
  return `M${x+r} ${y} H${R-r} A${r} ${r} 0 0 1 ${R} ${y+r} V${B-r} A${r} ${r} 0 0 1 ${R-r} ${B} H${x} V${y+r} A${r} ${r} 0 0 1 ${x+r} ${y} Z`;
}

/** Geometry and idle choreography from the supplied brand reference. */
function CanvasOneFaceGeometry({expression='base', size=48, tone='ink', animate:enabled=true, transition:transitionEnabled=enabled, paused=false, className, style, ...props}: CanvasOneFaceProps) {
  const [shown, setShown] = React.useState(expression);
  const [closing, setClosing] = React.useState(false);
  const shownRef = React.useRef(expression);
  const requested = React.useRef(expression);
  requested.current = expression;
  const scheduleRef = React.useRef<(() => void) | undefined>(undefined);
  React.useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let phase: 'open' | 'closing' | 'opening' = 'open';
    let heldSince = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0, reopenFrame = 0;
    let disposed = false;
    const clear = () => { clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(reopenFrame); };
    const instant = () => {
      clear(); phase = 'open';
      shownRef.current = requested.current;
      setShown(requested.current); setClosing(false);
    };
    const schedule = () => {
      if (disposed) return;
      if (!transitionEnabled || media.matches) { instant(); return; }
      // Requests during closure/reopening only replace the pending expression.
      // The in-flight blink always completes before starting the next one.
      if (phase !== 'open') return;
      clearTimeout(timer);
      if (requested.current === shownRef.current) return;
      timer = setTimeout(() => {
        phase = 'closing'; setClosing(true);
        timer = setTimeout(() => {
          shownRef.current = requested.current; setShown(requested.current);
          frame = requestAnimationFrame(() => {
            reopenFrame = requestAnimationFrame(() => {
              phase = 'opening'; setClosing(false);
              timer = setTimeout(() => {
                phase = 'open'; heldSince = performance.now(); schedule();
              }, 180);
            });
          });
        }, 120);
      }, Math.max(0, 600 - (performance.now() - heldSince)));
    };
    scheduleRef.current = schedule;
    media.addEventListener('change', schedule);
    schedule();
    return () => { disposed = true; clear(); media.removeEventListener('change', schedule); scheduleRef.current = undefined; };
  }, [transitionEnabled]);
  React.useEffect(() => { scheduleRef.current?.(); }, [expression]);

  const e = React.createElement;
  const anim = enabled && !paused;
  const dur = 2.4;
  const icon = tone === 'icon';
  const ink = icon ? 'var(--primary-foreground)' : 'var(--face-ink, currentColor)';
  const kn = icon ? 'var(--primary)' : 'var(--face-paper, var(--shell))';
  const ai = icon ? 'var(--primary)' : 'var(--face-ai, var(--branch-solid))';
  const risk = 'var(--face-risk, var(--risk-text))';
  const cb: React.CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };
  const A = (name:string, d:number, delay=0):React.CSSProperties|undefined => anim ? { animation: `${name} ${d}s ease-in-out ${delay}s infinite`, ...cb } : undefined;
  const blink = A('cf-blink', dur * 1.4), pulse = A('cf-pulse', dur / 1.5);
  const look = anim ? { animation: `cf-look ${dur * 1.5}s cubic-bezier(.6,0,.2,1) infinite` } : undefined;
  const head = bubble(6, 6, 36, 36, 11);
  const H = () => e('path', { key:'head', d:head, fill:ink });
  const eye = (cx:number, cy:number, r:number, fill:string, style?:React.CSSProperties, key:string|number=cx) => e('circle', { key, cx, cy, r, fill, style });
  let kids: React.ReactNode[];
    switch (shown) {
      case 'base': kids = [H(), eye(18, 22, 4.2, kn, blink), eye(30, 22, 4.2, kn, blink)]; break;
      case 'wink': kids = [H(), eye(18, 22, 4.5, kn, blink), e('circle', { key: 'r', cx: 30, cy: 22, r: 4, fill: 'none', stroke: ai, strokeWidth: 3, style: pulse })]; break;
      case 'look': kids = [H(), eye(18, 23, 5.5, kn), eye(30, 23, 5.5, kn), e('g', { key: 'p', style: look }, eye(19.6, 21.4, 2.6, ink), eye(31.6, 21.4, 2.6, ai))]; break;
      case 'squint': kids = [H(), e('rect', { key: 1, x: 15.5, y: 16, width: 5.5, height: 12, rx: 2.75, fill: kn, style: blink }), e('rect', { key: 2, x: 26, y: 20, width: 9, height: 4.5, rx: 2.25, fill: ai })]; break;
      case 'pixel': kids = [e('path', { key: 'h', d: bubble(6, 6, 36, 36, 6), fill: ink }), e('g', { key: 'g', style: anim ? { animation: `cf-scan ${dur}s ease-in-out infinite` } : undefined }, e('rect', { x: 14, y: 18, width: 7, height: 7, rx: 1.5, fill: kn }), e('rect', { x: 27, y: 18, width: 7, height: 7, rx: 1.5, fill: ai }))]; break;
      case 'thought': kids = [e('path', { key: 'h', d: bubble(4, 13, 31, 31, 10), fill: ink }), e('g', { key: 'e', style: look }, eye(15, 27, 3.6, kn), eye(25, 27, 3.6, kn)), eye(38, 12, 3.4, ai, A('cf-tp', dur, 0.2), 't1'), eye(43.5, 5, 2.4, ai, A('cf-tp', dur, 0.4), 't2')]; break;
      case 'reply': kids = [e('path', { key: 1, d: bubble(5, 5, 28, 28, 8), fill: ink }), e('path', { key: 2, d: `M23 15 H35 A8 8 0 0 1 43 23 V43 H23 A8 8 0 0 1 15 35 V23 A8 8 0 0 1 23 15 Z`, fill: ai, stroke: icon ? 'none' : kn, strokeWidth: 3, paintOrder: 'stroke' }), eye(24, 28, 3.4, kn, blink), e('circle', { key: 4, cx: 34, cy: 28, r: 3, fill: 'none', stroke: kn, strokeWidth: 2.4, style: pulse })]; break;
      case 'round': kids = [e('path', { key: 1, d: 'M24 6 A18 18 0 1 1 24 42 A18 18 0 1 1 24 6 Z M6 42 V31 L17 42 Z', fill: ink }), eye(18, 23, 4.5, kn, blink), e('circle', { key: 'r', cx: 30, cy: 23, r: 4, fill: 'none', stroke: ai, strokeWidth: 3, style: pulse })]; break;
      case 'antenna': kids = [e('line', { key: 0, x1: 24, y1: 6, x2: 24, y2: 13, stroke: ink, strokeWidth: 3, strokeLinecap: 'round' }), eye(24, 5, 3.6, ai, pulse, 'a'), e('path', { key: 'h', d: bubble(6, 12, 36, 31, 10), fill: ink }), eye(18, 26, 4, kn, blink), eye(30, 26, 4, kn, blink)]; break;
      case 'listen': kids = [H(), eye(18, 19, 4.2, kn), eye(30, 19, 4.2, kn), ...[19, 24, 29].map((x, i) => e('rect', { key: 'b' + i, x: x - 1.4, y: 26, width: 2.8, height: 9, rx: 1.4, fill: ai, style: anim ? Object.assign({ animation: `cf-eq ${dur / 3}s ease-in-out ${i * 0.12}s infinite` }, cb) : Object.assign({ transform: `scaleY(${[0.55, 1, 0.7][i]})` }, cb) }))]; break;
      case 'wait': kids = [H(), eye(18, 22, 5.5, kn), eye(30, 22, 5.5, kn), e('g', { key: 'p', style: blink }, eye(16.2, 23.8, 2.6, ink), eye(28.2, 23.8, 2.6, ink))]; break;
      case 'happy': kids = [H(), e('g', { key: 'g', style: anim ? { animation: `cf-hop ${dur}s ease-out infinite` } : undefined }, ...[18, 30].map(x => e('path', { key: x, d: `M${x - 4} 24 Q${x} 17.5 ${x + 4} 24`, fill: 'none', stroke: kn, strokeWidth: 3.2, strokeLinecap: 'round' })))]; break;
      case 'error': kids = [e('g', { key: 'g', style: anim ? { animation: `cf-shake ${dur}s ease-in-out infinite` } : undefined }, e('path', { d: head, fill: icon ? ink : risk }), ...[18, 30].map(x => e('path', { key: x, d: `M${x - 3.2} 18.8 L${x + 3.2} 25.2 M${x + 3.2} 18.8 L${x - 3.2} 25.2`, stroke: kn, strokeWidth: 3, strokeLinecap: 'round' })))]; break;
      case 'sleep': kids = [e('g', { key: 'g', opacity: anim ? undefined : 0.45, style: anim ? { animation: `cf-fade ${dur * 1.6}s ease-in-out infinite` } : undefined }, e('path', { d: head, fill: ink }), e('path', { d: 'M14.5 23 H21.5 M26.5 23 H33.5', stroke: kn, strokeWidth: 3, strokeLinecap: 'round' }))]; break;
      case 'empty': kids = [e('path', { key: 'h', d: bubble(7.5, 7.5, 33, 33, 10), fill: 'none', stroke: ink, strokeWidth: 3.2, strokeLinejoin: 'round', strokeDasharray: '5 3.5' }), eye(18, 22, 3.6, ink, blink), eye(30, 22, 3.6, ink, blink, 'r2')]; break;
    }
  // Exclude each head from the closure so expression changes remain legible.
  // Error/sleep have whole-face idle wrappers; their eye paths still blink inside.
  const blinkStyle: React.CSSProperties = { transformOrigin:'24px 22px', transform:`scaleY(${closing ? 0.08 : 1})`, transition:transitionEnabled ? `transform ${closing ? 120 : 180}ms cubic-bezier(.3,0,.2,1)` : 'none' };
  const blinkGroup = (children:React.ReactNode[]) => e('g', { key:'blink', 'data-face-blink':true, style:blinkStyle }, children);
  let contents: React.ReactNode[];
  if (shown === 'error' || shown === 'sleep') {
    const group = kids[0] as React.ReactElement<{children:React.ReactNode[]}>;
    const [headShape, ...eyes] = React.Children.toArray(group.props.children);
    contents = [React.cloneElement(group, undefined, headShape, blinkGroup(eyes))];
  } else {
    const eyeStart = shown === 'antenna' ? 3 : shown === 'reply' ? 2 : 1;
    const fixed = kids.slice(0, eyeStart);
    const eyeEnd = shown === 'thought' ? eyeStart + 1 : shown === 'listen' ? eyeStart + 2 : kids.length;
    contents = [...fixed, blinkGroup(kids.slice(eyeStart, eyeEnd)), ...kids.slice(eyeEnd)];
  }
  return <svg aria-hidden="true" focusable="false" {...props} width={size} height={size} viewBox="0 0 48 48" data-expression={shown} data-closing={closing} data-animate={enabled} data-transition={transitionEnabled} data-paused={paused} className={cn('canvas-one-face',className)} style={{display:'block',width:size,height:size,overflow:'visible',flexShrink:0,...style}}>{contents}</svg>;
}

export const CanvasOneFace = React.memo(CanvasOneFaceGeometry);

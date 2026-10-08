import * as React from 'react';
import { cn } from '@/lib/utils';
import './canvas-one-face.css';

export const FACE_EXPRESSIONS = { base: 'Ready', wink: 'Thinking', look: 'Reading', squint: 'Working', pixel: 'Checking', thought: 'Brainstorming', reply: 'Suggestion ready', round: 'Chat', antenna: 'Connecting', listen: 'Listening', wait: 'Your turn', happy: 'Done', error: 'Error', sleep: 'Offline', empty: 'Empty board' } as const;
export type FaceExpression = keyof typeof FACE_EXPRESSIONS;
type Eye = { cx:number; cy:number; w:number; h:number; rx:number; fill:string; stroke:string; sw:number };
type FaceColors = { ink:string; kn:string; ai:string; risk:string };
type FaceSpec = { head:string; headOp:number; headRx:number; headStroke:string; headX:number; headY:number; headW:number; headH:number; tail:number; L:Eye; R:Eye; pup:number; pdx:number; pdy:number; pR:string; mouth:number; ant:number; thought:number; badge:number; xeyes:number; happy:number; idleL:string|null; idleR:string|null; idleG:string|null };
export type CanvasOneFaceProps = React.ComponentProps<'svg'> & { expression?:FaceExpression; size?:number; tone?:'ink'|'icon'; animate?:boolean; transition?:boolean; paused?:boolean };
function faceSpec(x: FaceExpression, c: FaceColors) {
    const eye = (cx: number, cy: number, w: number, h: number, rx: number, fill: string, stroke?: string, sw?: number) => ({ cx, cy, w, h, rx, fill, stroke: stroke || fill, sw: sw || 0 });
    const s: FaceSpec = { head: c.ink, headOp: 1, headRx: 11, headStroke: 'transparent', headX:6, headY:6, headW:36, headH:36, tail: 1, L: eye(18, 22, 8.4, 8.4, 4.2, c.kn), R: eye(30, 22, 8.4, 8.4, 4.2, c.kn), pup: 0, pdx: 0, pdy: 0, pR: c.ink, mouth: 0, ant: 0, thought: 0, badge: 0, xeyes: 0, happy: 0, idleL: 'blink', idleR: 'blink', idleG: null };
    switch (x) {
      case 'wink': case 'round':
        s.L = eye(18, 22, 9, 9, 4.5, c.kn); s.R = eye(30, 22, 8, 8, 4, 'transparent', c.ai, 3); s.idleR = 'pulse';
        if (x === 'round') s.headRx = 18; break;
      case 'look': s.L = eye(18, 23, 11, 11, 5.5, c.kn); s.R = eye(30, 23, 11, 11, 5.5, c.kn); s.pup = 1; s.pdx = 1.6; s.pdy = -1.6; s.pR = c.ai; s.idleL = s.idleR = null; s.idleG = 'look'; break;
      case 'squint': s.L = eye(18.25, 22, 5.5, 12, 2.75, c.kn); s.R = eye(30.5, 22.25, 9, 4.5, 2.25, c.ai); s.idleR = null; break;
      case 'pixel': s.headRx = 6; s.L = eye(17.5, 21.5, 7, 7, 1.5, c.kn); s.R = eye(30.5, 21.5, 7, 7, 1.5, c.ai); s.idleL = s.idleR = null; s.idleG = 'scan'; break;
      case 'thought': s.headX=4; s.headY=13; s.headW=s.headH=31; s.headRx=10; s.L = eye(15, 27, 7.2, 7.2, 3.6, c.kn); s.R = eye(25, 27, 7.2, 7.2, 3.6, c.kn); s.idleL = s.idleR = null; s.idleG='look'; s.thought = 1; break;
      case 'reply': s.headX=s.headY=5; s.headW=s.headH=28; s.headRx=8; s.L = eye(24, 28, 6.8, 6.8, 3.4, c.kn); s.R = eye(34, 28, 6, 6, 3, 'transparent', c.kn, 2.4); s.idleR='pulse'; s.badge = 1; break;
      case 'antenna': s.headY=12; s.headH=31; s.headRx=10; s.L = eye(18, 26, 8, 8, 4, c.kn); s.R = eye(30, 26, 8, 8, 4, c.kn); s.ant = 1; break;
      case 'listen': s.L = eye(18, 19, 8, 8, 4, c.kn); s.R = eye(30, 19, 8, 8, 4, c.kn); s.mouth = 1; s.idleL = s.idleR = null; break;
      case 'wait': s.L = eye(18, 22, 11, 11, 5.5, c.kn); s.R = eye(30, 22, 11, 11, 5.5, c.kn); s.pup = 1; s.pdx = -1.8; s.pdy = 1.8; s.idleL = s.idleR = null; s.idleG = 'blink'; break;
      case 'happy': s.L = eye(18, 22, 8, 0, 0, c.kn); s.R = eye(30, 22, 8, 0, 0, c.kn); s.happy = 1; s.idleL = s.idleR = null; s.idleG = 'hop'; break;
      case 'error': s.head = c.risk; s.L = eye(18, 22, 8, 0, 0, c.kn); s.R = eye(30, 22, 8, 0, 0, c.kn); s.xeyes = 1; s.idleL = s.idleR = null; s.idleG = 'shake'; break;
      case 'sleep': s.headOp = 0.45; s.L = eye(18, 23, 7, 3, 1.5, c.kn); s.R = eye(30, 23, 7, 3, 1.5, c.kn); s.idleL = s.idleR = null; s.idleG = 'fade'; break;
      case 'empty': s.headX=s.headY=7.5; s.headW=s.headH=33; s.headRx=10; s.head = 'transparent'; s.headStroke = c.ink; s.tail = 0; s.L = eye(18, 22, 7.2, 7.2, 3.6, c.ink); s.R = eye(30, 22, 7.2, 7.2, 3.6, c.ink); break;
    }
    return s;
  }

/** Native geometry from the supplied Canvas One face; colours inherit the host surface. */
function CanvasOneFaceGeometry({expression='base', size=48, tone='ink', animate:anim=true, transition:transitionEnabled=anim, paused=false, className, style, ...props}: CanvasOneFaceProps) {
 const [shown,setShown] = React.useState(expression);
 const [closing,setClosing] = React.useState(false);
 const shownRef = React.useRef(expression);
 const changedAt = React.useRef(0);
 React.useEffect(() => {
   if (shownRef.current === expression) { setClosing(false); return; }
   if (!transitionEnabled || matchMedia('(prefers-reduced-motion: reduce)').matches) {
     shownRef.current = expression; setShown(expression); setClosing(false); return;
   }
   // A new request must not strand a cancelled reopen frame with shut eyes.
   setClosing(false);
   let closeTimer: ReturnType<typeof setTimeout>;
   let frame = 0;
   let reopenFrame = 0;
   const holdTimer = setTimeout(() => {
     setClosing(true);
     closeTimer = setTimeout(() => {
       // Swap geometry only with the eyes shut. Reopen on a later painted frame.
       shownRef.current = expression;
       changedAt.current = performance.now() + 180;
       setShown(expression);
       frame = requestAnimationFrame(() => {
         reopenFrame = requestAnimationFrame(() => setClosing(false));
       });
     }, 120);
   }, Math.max(0, 600 - (performance.now() - changedAt.current)));
   return () => { clearTimeout(holdTimer); clearTimeout(closeTimer); cancelAnimationFrame(frame); cancelAnimationFrame(reopenFrame); };
 },[expression,transitionEnabled]);
 const e = React.createElement;
 const icon = tone === 'icon';
 const c: FaceColors = icon ? {ink:'var(--primary-foreground)',kn:'var(--primary)',ai:'var(--primary)',risk:'var(--primary-foreground)'} : {ink:'var(--face-ink, currentColor)',kn:'var(--face-paper, var(--shell))',ai:'var(--face-ai, var(--branch-solid))',risk:'var(--face-risk, var(--risk-text))'};

    const s = faceSpec(shown, c);
    if (closing) s.idleL = s.idleR = s.idleG = null;
    // Head and expression geometry swap behind the blink, never morph in view.
    const T = 'none';
    const cb: React.CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };
    const idle = (k: string | null, extra?: React.CSSProperties) => {
      if (!anim || paused || !k) return undefined;
      const m: Record<string, string> = { blink: 'cf-blink 3.4s ease-in-out infinite', pulse: 'cf-pulse 1.6s ease-in-out infinite', look: 'cf-look 3.6s cubic-bezier(.6,0,.2,1) infinite', scan: 'cf-scan 2.4s ease-in-out infinite', hop: 'cf-hop 2.4s ease-out infinite', shake: 'cf-shake 2.4s ease-in-out 1', fade: 'cf-fade 3.8s ease-in-out infinite' };
      return Object.assign({ animation: m[k] }, cb, extra || {});
    };
    const eyeEl = (E: Eye, k: string) => e('rect', { key: k, style: { x: E.cx - E.w / 2, y: E.cy - E.h / 2, width: E.w, height: Math.max(E.h, 0.01), rx: E.rx, fill: E.fill, stroke: E.stroke, strokeWidth: E.sw, transition: T } });
    const pup = (cx: number, cy: number, fill: string, k: string) => e('circle', { key: k, r: 2.5, fill, style: { cx: cx + s.pdx, cy: cy + s.pdy, opacity: s.pup, transition: T } });
    const kids = [
      e('g', { key: 'ant', style: { opacity: s.ant, transform: `translateY(${s.ant ? 0 : 5}px)`, transition: T } },
        e('line', { x1: 24, y1: 6, x2: 24, y2: 13, stroke: c.ink, strokeWidth: 3, strokeLinecap: 'round' }),
        e('circle', { cx: 24, cy: 5, r: 3.6, fill: c.ai, style: s.ant ? idle('pulse') : undefined })),
      e('g', { key: 'head', style: { opacity: s.headOp, transition: T, animation: anim && s.idleG === 'fade' ? 'cf-fade 3.8s ease-in-out infinite' : undefined } },
        e('path', { d: `M${s.headX+s.headRx} ${s.headY} H${s.headX+s.headW-s.headRx} A${s.headRx} ${s.headRx} 0 0 1 ${s.headX+s.headW} ${s.headY+s.headRx} V${s.headY+s.headH-s.headRx} A${s.headRx} ${s.headRx} 0 0 1 ${s.headX+s.headW-s.headRx} ${s.headY+s.headH} H${s.headX} V${s.headY+s.headRx} A${s.headRx} ${s.headRx} 0 0 1 ${s.headX+s.headRx} ${s.headY} Z`, style: { fill: s.head, stroke: s.headStroke, strokeWidth: 3.2, strokeDasharray: s.tail ? 'none' : '5 3.5', transition: T } })),
      e('path', { key: 'badge', d:'M23 15 H35 A8 8 0 0 1 43 23 V43 H23 A8 8 0 0 1 15 35 V23 A8 8 0 0 1 23 15 Z', style: { fill: c.ai, stroke: icon ? 'none' : c.kn, strokeWidth: 3, paintOrder: 'stroke', opacity: s.badge, transition: T } }),
      e('g', { key: 'blink', 'data-face-blink': true, style: { transformOrigin: '24px 22px', transform: `scaleY(${closing ? 0.08 : 1})`, transition: transitionEnabled ? `transform ${closing ? 120 : 180}ms cubic-bezier(.3,0,.2,1)` : 'none' } },
      e('g', { key: 'face', style: idle(s.idleG === 'fade' ? null : s.idleG) },
        e('g', { key: 'L', style: idle(s.idleL) }, eyeEl(s.L, 'l')),
        e('g', { key: 'R', style: idle(s.idleR) }, eyeEl(s.R, 'r')),
        pup(s.L.cx, s.L.cy, c.ink, 'pl'), pup(s.R.cx, s.R.cy, s.pR, 'pr'),
        e('g', { key: 'hp', style: { opacity: s.happy, transition: T } }, ...[18, 30].map(x => e('path', { key: x, d: `M${x - 4} 24 Q${x} 17.5 ${x + 4} 24`, fill: 'none', stroke: c.kn, strokeWidth: 3.2, strokeLinecap: 'round' }))),
        e('g', { key: 'xe', style: { opacity: s.xeyes, transition: T } }, ...[18, 30].map(x => e('path', { key: x, d: `M${x - 3.2} 18.8 L${x + 3.2} 25.2 M${x + 3.2} 18.8 L${x - 3.2} 25.2`, stroke: c.kn, strokeWidth: 3, strokeLinecap: 'round' })))
      )),
      e('g', { key: 'mouth', style: { opacity: s.mouth, transition: T } }, ...[19, 24, 29].map((x, i) => e('rect', { key: i, x: x - 1.4, y: 26, width: 2.8, height: 9, rx: 1.4, fill: c.ai, style: anim && s.mouth ? Object.assign({ animation: `cf-eq 0.8s ease-in-out ${i * 0.12}s infinite` }, cb) : Object.assign({ transform: `scaleY(${[0.55, 1, 0.7][i]})` }, cb) }))),
      e('g', { key: 'th', style: { opacity: s.thought, transition: T } },
        e('circle', { cx: 38, cy: 12, r: 3.4, fill: c.ai, style: s.thought && anim ? Object.assign({ animation: 'cf-tp 2.4s ease-in-out 0.2s infinite' }, cb) : undefined }),
        e('circle', { cx: 43.5, cy: 5, r: 2.4, fill: c.ai, style: s.thought && anim ? Object.assign({ animation: 'cf-tp 2.4s ease-in-out 0.4s infinite' }, cb) : undefined }))
    ];

 return <svg aria-hidden="true" focusable="false" {...props} width={size} height={size} viewBox="0 0 48 48" data-expression={shown} data-closing={closing} data-animate={anim} data-transition={transitionEnabled} data-paused={paused} className={cn('canvas-one-face',className)} style={{display:'block',width:size,height:size,overflow:'visible',flexShrink:0,...style}}>{kids}</svg>;
}

export const CanvasOneFace = React.memo(CanvasOneFaceGeometry);

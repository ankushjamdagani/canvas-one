import * as React from 'react';
import { GripHorizontal, Minus, X, Maximize2 } from 'lucide-react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

/** Independent nonmodal tool surface; its content remains mounted while hidden/minimized. */
export function FloatingToolPanel({ title, icon, open, minimized, onMinimizedChange, onClose, children, rightInset = 0 }: {
  title: string; icon?: React.ReactNode; open: boolean; minimized: boolean;
  onMinimizedChange: (value: boolean) => void; onClose: () => void; children: React.ReactNode; rightInset?: number;
}) {
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [position, setPosition] = React.useState<{ x: number; y: number }>();
  const headerRef = React.useRef<HTMLButtonElement>(null);
  const drag = React.useRef<{ x: number; y: number; startX: number; startY: number } | undefined>(undefined);
  const width = Math.min(380, Math.max(0, viewport.width - 24));
  const height = Math.min(640, Math.max(0, viewport.height - 96));
  const clamp = (x: number, y: number) => ({ x: Math.max(12, Math.min(x, viewport.width - width - 12)), y: Math.max(64, Math.min(y, viewport.height - (minimized ? 48 : height) - 12)) });
  const point = clamp(position?.x ?? viewport.width - width - 20 - (viewport.width >= 1000 ? rightInset : 0), position?.y ?? (viewport.width < 768 ? viewport.height - height - 12 : 80));
  React.useLayoutEffect(() => {
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure);
  }, []);
  React.useEffect(() => { if (open) headerRef.current?.focus({ preventScroll: true }); }, [open]);
  const action = (label: string, onClick: () => void, glyph: React.ReactNode) => <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={label} onClick={onClick}>{glyph}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
  return <aside hidden={!open} aria-label={`${title} floating panel`} data-testid="ai-floating-panel" className={`fixed z-floating flex flex-col overflow-hidden rounded-card border border-control-border bg-panel font-tool text-tool text-foreground shadow-floating ${!open ? 'hidden' : ''}`} style={{ left: point.x, top: point.y, width, height: minimized ? 48 : height, maxWidth: 'calc(100vw - 24px)' }}>
    <TooltipProvider><header className="flex h-12 shrink-0 items-center gap-1 border-b border-hairline pl-3 pr-1">
      {icon}
      <button ref={headerRef} type="button" aria-label={`Move ${title} panel`} className="flex h-11 min-w-0 flex-1 touch-none items-center gap-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: point.x, y: point.y, startX: event.clientX, startY: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const start = drag.current; if (start) setPosition(clamp(start.x + event.clientX - start.startX, start.y + event.clientY - start.startY)); }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onKeyDown={event => { const step = event.shiftKey ? 4 : 16; const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]; if (delta) { event.preventDefault(); setPosition(clamp(point.x + delta[0], point.y + delta[1])); } }}><span className="truncate">{title}</span><GripHorizontal aria-hidden="true" className="size-3 shrink-0 text-secondary-text" /></button>
      {action(minimized ? `Restore ${title}` : `Minimize ${title}`, () => onMinimizedChange(!minimized), minimized ? <Maximize2 aria-hidden="true" /> : <Minus aria-hidden="true" />)}
      {action(`Close ${title}`, onClose, <X aria-hidden="true" />)}
    </header></TooltipProvider>
    <div hidden={minimized} className={`min-h-0 flex-1 ${minimized ? 'hidden' : ''}`}>{children}</div>
  </aside>;
}

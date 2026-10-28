import * as React from 'react';
import { Square, RectangleHorizontal, Circle, Diamond, Minus, ArrowRight, Type, Shapes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { CanvasElementKind } from '../../domain/studio/model';

export const CANVAS_ELEMENT_TOOLS = [
  { kind: 'rectangle', label: 'Rectangle', Icon: Square },
  { kind: 'rounded-rectangle', label: 'Rounded rectangle', Icon: RectangleHorizontal },
  { kind: 'ellipse', label: 'Ellipse', Icon: Circle },
  { kind: 'diamond', label: 'Diamond', Icon: Diamond },
  { kind: 'line', label: 'Line', Icon: Minus },
  { kind: 'arrow', label: 'Arrow', Icon: ArrowRight },
  { kind: 'text', label: 'Text', Icon: Type },
] as const;

export function CanvasElementPicker({ disabled, onPlace }: { disabled: boolean; onPlace: (kind: CanvasElementKind) => void }) {
  const [open, setOpen] = React.useState(false);
  return <Popover open={open} onOpenChange={setOpen}><Tooltip><TooltipTrigger asChild><PopoverTrigger asChild><Button className="size-11 md:size-7 shrink-0" size="icon" variant="ghost" aria-label="Shapes and text" data-testid="dock-shapes-btn" disabled={disabled}><Shapes className="size-4" /></Button></PopoverTrigger></TooltipTrigger><TooltipContent>Shapes and text</TooltipContent></Tooltip>
    <PopoverContent side="top" align="start" className="w-52 p-1.5" aria-label="Shapes and text">
      {CANVAS_ELEMENT_TOOLS.map(({ kind, label, Icon }) => <Button key={kind} variant="ghost" className="w-full justify-start gap-2 h-11 md:h-8" data-testid={`add-canvas-${kind}`} onClick={() => { setOpen(false); onPlace(kind); }}><Icon className="size-4" />{label}</Button>)}
    </PopoverContent>
  </Popover>;
}

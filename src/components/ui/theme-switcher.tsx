import * as React from 'react';
import * as Radio from '@radix-ui/react-radio-group';
import { Check, Moon, Palette, Sun } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Segmented } from './segmented';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { PALETTES } from '@/lib/theme/palettes';
import { useTheme } from '@/lib/theme/ThemeContext';

const MODES = [
  { id: 'light', label: <><Sun size={13} />Light</> },
  { id: 'dark', label: <><Moon size={13} />Dark</> },
];
function navigateRadios(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const current = radios.findIndex(radio => radio === event.target);
  if (current < 0) return;
  event.preventDefault();
  const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (current + direction + radios.length) % radios.length;
  radios[index].focus();
  radios[index].click();
}
export function ThemePopover({ className }: { className?: string }) {
  const { paletteId, mode, setPaletteId, setMode } = useTheme();
  const [open, setOpen] = React.useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="icon" aria-label="Change theme"
        title="Change theme" className={cn('shrink-0', className)} data-testid="theme-trigger"><Palette /></Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} collisionPadding={28} aria-label="Theme" data-testid="theme-popover"
      className="w-[480px] max-w-[calc(100vw-56px)] max-h-[min(680px,var(--radix-popover-content-available-height))] overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-meta font-mono text-secondary-text">Mode</span>
        <Segmented options={MODES} value={mode} aria-label="Color mode"
          onChange={(value) => { if (value === 'light' || value === 'dark') setMode(value); }} />
      </div>
      <span className="mb-2 block text-meta font-mono text-secondary-text">Colour</span>
      <Radio.Root value={paletteId} onValueChange={setPaletteId} aria-label="Color palette"
        onKeyDown={navigateRadios}
        className="grid grid-cols-2 gap-1 max-[479px]:grid-cols-1">
        {PALETTES.map((palette) => {
          const tokens = palette[mode];
          return <React.Fragment key={palette.id}>
            <Radio.Item value={palette.id} aria-label={palette.name} data-testid={`theme-swatch-${palette.id}`}
              className="group flex min-h-11 min-w-0 items-center gap-2 rounded-control border border-transparent p-2 text-left hover:bg-sunken data-[state=checked]:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
              <span aria-hidden="true" className="flex h-6 w-10 shrink-0 overflow-hidden rounded-sm border border-control-border">
                {[tokens.panel, tokens.action, tokens.branch].map((color, part) => <span key={part} className={part ? 'w-2.5' : 'flex-1'} style={{ background: color }} />)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-ink group-data-[state=checked]:text-accent-foreground">{palette.name}</span>
                <span className="block text-micro font-mono text-secondary-text group-data-[state=checked]:text-accent-foreground">{palette.note.charAt(0) + palette.note.slice(1).toLowerCase()}</span>
              </span>
              <Radio.Indicator className="shrink-0 text-accent-foreground"><Check size={13} /></Radio.Indicator>
            </Radio.Item>
          </React.Fragment>;
        })}
      </Radio.Root>
    </PopoverContent>
  </Popover>;
}
export const ThemeButton = ThemePopover;

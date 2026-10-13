import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThemeProvider, ThemePopover, PALETTES } from '@/lib/theme';
import { getTokens } from '@/lib/theme/palettes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Segmented } from '@/components/ui/segmented';
import { Toggle } from '@/components/ui/toggle';

const meta: Meta = {
  title: 'UI/ThemeSwitcher',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
};

export default meta;

export const InteractionStates: StoryObj = {
  name: 'Theme interaction states',
  render: () => <div className="min-h-screen bg-shell p-6 text-foreground space-y-4">
    <div className="flex justify-end"><ThemePopover /></div>
    <div className="flex flex-wrap gap-3">
      {(['default', 'destructive', 'outline', 'secondary', 'tint', 'ghost', 'link'] as const).map(variant =>
        <Button key={variant} variant={variant} data-testid={`state-button-${variant}`}>{variant} action</Button>)}
      <Button disabled>Unavailable action</Button>
    </div>
    <div className="flex flex-wrap gap-3">
      {(['neutral', 'accent', 'branch', 'risk', 'warning'] as const).map(variant => <Badge key={variant} variant={variant}>{variant} status</Badge>)}
    </div>
    <Input aria-label="Project name" placeholder="Project name" className="max-w-80" />
    <Input aria-label="Invalid name" aria-invalid placeholder="Correct this name" className="max-w-80" />
    <div className="flex gap-4 items-center">
      <Checkbox aria-label="Unchecked option" /><Checkbox checked aria-label="Checked option" />
      <Checkbox checked="indeterminate" aria-label="Mixed option" />
      <Switch aria-label="Setting off" /><Switch checked aria-label="Setting on" />
      <RadioGroup defaultValue="selected" aria-label="Selection">
        <RadioGroupItem value="selected" aria-label="Selected option" />
        <RadioGroupItem value="other" aria-label="Other option" />
      </RadioGroup>
      <Toggle pressed aria-label="Selected tool">Tool</Toggle>
    </div>
    <Segmented options={['First', 'Second']} value="First" aria-label="View mode" />
    <p className="text-body">Body text <span className="text-secondary-text">and secondary text.</span></p>
  </div>,
};

export const PopoverClosed: StoryObj = {
  name: 'Trigger (closed)',
  render: () => (
    <div className="flex items-center justify-end p-4 bg-shell">
      <ThemePopover />
    </div>
  ),
};

export const PopoverOpen: StoryObj = {
  name: 'Popover (open preview)',
  render: () => (
    <div className="flex items-center justify-end p-4 bg-shell" style={{ minHeight: 260 }}>
      <ThemePopover />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const btn = canvasElement.querySelector<HTMLButtonElement>('[data-testid="theme-trigger"]');
    btn?.click();
  },
};

/** Static swatch palette grid — all 14 schemes × 2 modes without popover chrome. */
export const SwatchGrid: StoryObj = {
  name: 'All 14 swatches',
  render: () => (
    <ThemeProvider>
      <div className="p-4 space-y-4">
        {(['light', 'dark'] as const).map((mode) => (
          <div key={mode}>
            <p className="font-mono text-[10px] uppercase tracking-widest text-secondary-text mb-2">
              {mode} mode
            </p>
            <div className="flex flex-wrap gap-2">
              {PALETTES.map((p) => {
                const t = getTokens(p.id, mode)!;
                return (
                  <div key={p.id} className="flex flex-col items-center gap-1">
                    <div
                      title={`${p.name} — ${p.note}`}
                      className="size-9 rounded-lg border border-border overflow-hidden"
                      style={{
                        backgroundImage: `linear-gradient(to right, ${t.shell} 50%, ${t.action} 50%)`,
                      }}
                    />
                    <span className="font-mono text-[9px] text-secondary-text">{p.id}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </ThemeProvider>
  ),
};

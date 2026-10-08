/**
 * New scenario dialog.
 *
 * Produces the scenario.new payload
 * `{mode:'timed'|'logical', from:{kind:'empty'}|{kind:'copy',scenarioId}, label}`.
 *
 * The mode must equal the copied scenario's mode, so when a copy source is
 * selected the mode radios lock to that source's mode (Duplicate uses this dialog's copy
 * path with a preselected, undismissable source -- see ScenarioSwitcher.tsx).
 */

import * as React from 'react';
import { Activity, Copy, GitCommitHorizontal, Plus } from 'lucide-react';
import type { Id, ScenarioMode } from '../../domain/studio/model';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select';
import { cn } from '../../lib/utils';

export type CopySourceOption = {
  readonly scenarioId: Id;
  readonly label: string;
  readonly mode: ScenarioMode;
};

export interface NewScenarioDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly copySources: readonly CopySourceOption[];
  /** Preselects a copy source (and locks "Start from" to Copy) -- used by Duplicate. */
  readonly initialCopySourceId?: Id | null;
  readonly onCreate: (params: { readonly mode: ScenarioMode; readonly from: { readonly kind: 'empty' } | { readonly kind: 'copy'; readonly scenarioId: Id }; readonly label: string }) => void;
}

export function NewScenarioDialog({ open, onOpenChange, copySources, initialCopySourceId, onCreate }: NewScenarioDialogProps) {
  const [name, setName] = React.useState('');
  const [mode, setMode] = React.useState<ScenarioMode>('timed');
  const [startFrom, setStartFrom] = React.useState<'copy' | 'empty'>(copySources.length > 0 ? 'copy' : 'empty');
  const [copySourceId, setCopySourceId] = React.useState<Id | null>(initialCopySourceId ?? copySources[0]?.scenarioId ?? null);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    const preselected = initialCopySourceId ?? copySources[0]?.scenarioId ?? null;
    setCopySourceId(preselected);
    setStartFrom(preselected ? 'copy' : 'empty');
    const source = preselected ? copySources.find((c) => c.scenarioId === preselected) : null;
    setMode(source ? source.mode : 'timed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedSource = copySourceId ? copySources.find((c) => c.scenarioId === copySourceId) : null;
  const modeLocked = startFrom === 'copy' && !!selectedSource;
  const effectiveMode = modeLocked && selectedSource ? selectedSource.mode : mode;

  const canCreate = name.trim().length > 0 && (startFrom === 'empty' || !!selectedSource);

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate({
      mode: effectiveMode,
      from: startFrom === 'copy' && selectedSource ? { kind: 'copy', scenarioId: selectedSource.scenarioId } : { kind: 'empty' },
      label: name.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-scenario-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New scenario</DialogTitle>
          <DialogDescription>Same system, a new situation to test it against.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-scenario-name">Name</Label>
            <Input
              id="new-scenario-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Black Friday peak"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>How does it run?</Label>
            <RadioGroup
              value={effectiveMode}
              onValueChange={(v) => setMode(v as ScenarioMode)}
              className="grid grid-cols-2 gap-2"
            >
              <RadioCardOption
                id="mode-timed"
                value="timed"
                selected={effectiveMode === 'timed'}
                disabled={modeLocked}
                icon={<Activity className="size-4" aria-hidden="true" />}
                title="Traffic over time"
                description="Requests per second into an entry point. Measures latency, throughput and failures."
              />
              <RadioCardOption
                id="mode-logical"
                value="logical"
                selected={effectiveMode === 'logical'}
                disabled={modeLocked}
                icon={<GitCommitHorizontal className="size-4" aria-hidden="true" />}
                title="Step by step"
                description="A sequence of events, like a user clicking. Checks states and outputs; no timing."
              />
            </RadioGroup>
          </div>

          <div className="space-y-1.5">
            <Label>Start from</Label>
            <RadioGroup
              value={startFrom}
              onValueChange={(v) => setStartFrom(v as 'copy' | 'empty')}
              className="grid grid-cols-2 gap-2"
            >
              <RadioCardOption
                id="start-copy"
                value="copy"
                selected={startFrom === 'copy'}
                disabled={copySources.length === 0}
                icon={<Copy className="size-4" aria-hidden="true" />}
                title={selectedSource ? `A copy of ${selectedSource.label}` : 'A copy'}
                description="Same traffic, outages and checks. Change what differs."
              />
              <RadioCardOption
                id="start-empty"
                value="empty"
                selected={startFrom === 'empty'}
                icon={<Plus className="size-4" aria-hidden="true" />}
                title="Empty"
                description="Nothing yet. You add traffic and checks."
              />
            </RadioGroup>
            {startFrom === 'copy' && copySources.length > 1 && (
              <NativeSelect
                value={copySourceId ?? ''}
                onChange={(e) => setCopySourceId(e.target.value)}
                aria-label="Copy source scenario"
              >
                {copySources.map((c) => (
                  <NativeSelectOption key={c.scenarioId} value={c.scenarioId}>
                    {c.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </div>

          <p className="text-[11px] text-secondary-text">
            A new scenario hasn't run yet, so commits wait until it passes.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!canCreate} data-testid="new-scenario-create">
            Create and edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RadioCardOption({
  id,
  value,
  selected,
  disabled,
  icon,
  title,
  description,
}: {
  readonly id: string;
  readonly value: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start gap-2 rounded-control border p-3 text-xs cursor-pointer',
        selected ? 'border-selected-edge bg-selected-tint' : 'border-control-border',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" />
      <div className="space-y-0.5">
        <div className={cn('flex items-center gap-1.5 font-semibold', selected ? 'text-accent-foreground' : 'text-foreground')}>
          {icon}
          {title}
        </div>
        <p className={selected ? 'text-accent-foreground' : 'text-secondary-text'}>{description}</p>
      </div>
    </label>
  );
}

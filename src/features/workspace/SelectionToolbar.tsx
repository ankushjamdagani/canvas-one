/** 16D selection-scoped actions, routed through the command registry. */

import * as React from 'react';
import { ChevronDown, Copy, Group, Trash2, Ungroup } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  getAvailability,
  type CommandContext,
  type CommandPayloads,
  type ExecuteResult,
} from './commands/registry';

export type CanvasAuthoringCommandId =
  | 'selection.duplicate'
  | 'selection.delete'
  | 'selection.group'
  | 'selection.ungroup'
  | 'selection.align'
  | 'selection.distribute'
  | 'canvas.add-note';

export type CanvasCommandExecutor = <K extends CanvasAuthoringCommandId>(
  id: K,
  payload: CommandPayloads[K],
) => Promise<ExecuteResult>;

export interface SelectionToolbarProps {
  readonly context: CommandContext;
  readonly executeCommand: CanvasCommandExecutor;
}

function commandSucceeded(result: ExecuteResult): boolean {
  if (result.status !== 'done') return false;
  if (result.value && typeof result.value === 'object' && 'ok' in result.value) {
    return (result.value as { readonly ok: boolean }).ok;
  }
  return true;
}

function commandError(result: ExecuteResult): string | null {
  if (result.status === 'disabled') return result.reason;
  if (result.value && typeof result.value === 'object' && 'ok' in result.value) {
    const outcome = result.value as { readonly ok: boolean; readonly message?: string };
    return outcome.ok ? null : (outcome.message ?? 'Could not apply this canvas change');
  }
  return null;
}

export function SelectionToolbar({ context, executeCommand }: SelectionToolbarProps) {
  const [groupOpen, setGroupOpen] = React.useState(false);
  const [groupLabel, setGroupLabel] = React.useState('');
  const [groupError, setGroupError] = React.useState<string | null>(null);
  const groupAvailability = getAvailability('selection.group', context, { label: groupLabel });
  const ungroupAvailability = getAvailability('selection.ungroup', context, {
    groupIds: context.selectedGroupIds,
  });
  const duplicateAvailability = getAvailability('selection.duplicate', context, {});
  const deleteAvailability = getAvailability('selection.delete', context, {});
  const count = context.selectedElementIds.length;

  async function submitGroup() {
    const label = groupLabel.trim();
    if (!groupAvailability.enabled) return;
    if (label.length === 0) {
      setGroupError('Enter a group name');
      return;
    }
    if (Array.from(label).length > 80) {
      setGroupError('Use 80 characters or fewer');
      return;
    }
    const result = await executeCommand('selection.group', { label });
    if (commandSucceeded(result)) {
      setGroupOpen(false);
      setGroupLabel('');
      setGroupError(null);
    } else {
      setGroupError(commandError(result));
    }
  }

  const alignItems = [
    ['left', 'Align left'],
    ['center-x', 'Align center horizontally'],
    ['right', 'Align right'],
    ['top', 'Align top'],
    ['center-y', 'Align center vertically'],
    ['bottom', 'Align bottom'],
  ] as const;
  const distributeItems = [
    ['x', 'Distribute horizontally'],
    ['y', 'Distribute vertically'],
  ] as const;

  return (
    <div
      data-testid="selection-toolbar"
      className="absolute top-3 right-3 z-10 flex items-center gap-1 px-1.5 py-1 rounded-control bg-panel border border-control-border shadow-raised"
    >
      <span
        data-testid="selection-count"
        className="h-7 px-2 inline-flex items-center rounded-tag bg-sunken font-mono text-[10px] font-semibold tracking-wide text-secondary-text"
      >
        {count} {count === 1 ? 'PART' : 'PARTS'}
      </span>

      <Popover
        open={groupOpen}
        onOpenChange={(open) => {
          setGroupOpen(open);
          if (!open) setGroupError(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            data-testid="selection-group-btn"
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={!groupAvailability.enabled}
            title={groupAvailability.enabled ? undefined : groupAvailability.reason}
          >
            <Group className="size-3.5" /> Group
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <form
            data-testid="selection-group-popover"
            onSubmit={(event) => {
              event.preventDefault();
              void submitGroup();
            }}
          >
            <label className="block text-xs font-medium text-ink mb-1.5" htmlFor="selection-group-label">
              Group name
            </label>
            <Input
              id="selection-group-label"
              data-testid="selection-group-input"
              autoFocus
              value={groupLabel}
              placeholder="Name this group…"
              onChange={(event) => {
                setGroupLabel(event.target.value);
                setGroupError(null);
              }}
            />
            {groupError && <p role="alert" className="mt-1.5 text-xs text-risk-text">{groupError}</p>}
            <div className="mt-2 flex justify-end">
              <Button type="submit" size="sm" variant="tint" disabled={groupLabel.trim().length === 0}>
                Group
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      {context.selectedGroupIds.length === 1 && (
        <Button
          data-testid="selection-ungroup-btn"
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={!ungroupAvailability.enabled}
          title={ungroupAvailability.enabled ? undefined : ungroupAvailability.reason}
          onClick={() => void executeCommand('selection.ungroup', { groupIds: context.selectedGroupIds })}
        >
          <Ungroup className="size-3.5" /> Ungroup
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="selection-align-btn" type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs">
            Align <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Align</DropdownMenuLabel>
          {alignItems.map(([edge, label]) => {
            const availability = getAvailability('selection.align', context, { edge });
            return (
              <DropdownMenuItem
                key={edge}
                data-testid={`selection-align-${edge}`}
                disabled={!availability.enabled}
                title={availability.enabled ? undefined : availability.reason}
                onSelect={() => void executeCommand('selection.align', { edge })}
                className="text-xs"
              >
                <span>{label}</span>
                {!availability.enabled && <span className="ml-auto text-[10px]">{availability.reason}</span>}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Distribute</DropdownMenuLabel>
          {distributeItems.map(([axis, label]) => {
            const availability = getAvailability('selection.distribute', context, { axis });
            return (
              <DropdownMenuItem
                key={axis}
                data-testid={`selection-distribute-${axis}`}
                disabled={!availability.enabled}
                title={availability.enabled ? undefined : availability.reason}
                onSelect={() => void executeCommand('selection.distribute', { axis })}
                className="text-xs"
              >
                <span>{label}</span>
                {!availability.enabled && <span className="ml-auto text-[10px]">{availability.reason}</span>}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        data-testid="selection-duplicate-btn"
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Duplicate selection"
        disabled={!duplicateAvailability.enabled}
        title={duplicateAvailability.enabled ? undefined : duplicateAvailability.reason}
        onClick={() => void executeCommand('selection.duplicate', {})}
      >
        <Copy className="size-4" />
      </Button>

      <Button
        data-testid="selection-delete-btn"
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-destructive hover:text-destructive"
        aria-label="Delete selection"
        disabled={!deleteAvailability.enabled}
        title={deleteAvailability.enabled ? undefined : deleteAvailability.reason}
        onClick={() => void executeCommand('selection.delete', {})}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

import * as React from 'react';
import { Search, Check, GitBranch, Plus, RotateCcw } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BranchRecord, ProjectRecord } from '../../persistence/studio/types';

export interface BranchPopoverProps {
  project: ProjectRecord;
  branches: readonly BranchRecord[];
  currentBranchId: string;
  children: React.ReactNode;
  onSwitchBranch: (branchId: string) => void;
  onCreateBranch: (
    label: string,
    source: 'working' | 'head',
  ) => Promise<BranchActionOutcome>;
  onReopenBranch: (branchId: string) => Promise<BranchActionOutcome>;
  createDisabledReason?: string | null;
  isSaving?: boolean;
}

export type BranchActionOutcome =
  | { readonly status: 'done' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'cancelled' };

function branchLabel(project: ProjectRecord, branch: BranchRecord): string {
  return branch.id === project.mainBranchId ? 'main' : branch.label;
}

/**
 * 13B "Branch popover".
 *
 * Branch creation and reopening use the command registry. Switching, creating
 * and reopening are navigation actions, so the workspace resolves dirty
 * inspector/scenario drafts before the session changes branches.
 */
export function BranchPopover({
  project,
  branches,
  currentBranchId,
  children,
  onSwitchBranch,
  onCreateBranch,
  onReopenBranch,
  createDisabledReason = null,
  isSaving = false,
}: BranchPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [source, setSource] = React.useState<'working' | 'head'>('working');
  const [actionPending, setActionPending] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const current = branches.find((b) => b.id === currentBranchId) ?? null;
  const others = branches
    .filter((b) => b.id !== currentBranchId)
    .filter((b) => {
      if (!query.trim()) return true;
      return branchLabel(project, b).toLowerCase().includes(query.trim().toLowerCase());
    })
    .sort((a, b) => branchLabel(project, a).localeCompare(branchLabel(project, b)));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery('');
          setCreating(false);
          setActionError(null);
        }
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        data-testid="branch-popover"
        align="start"
        sideOffset={6}
        className="w-80 p-0 rounded-popover border-control-border bg-panel shadow-popover"
      >
        <div className="p-2 border-b border-border flex items-center gap-1.5">
          <Search size={13} className="text-secondary-text shrink-0" />
          <Input
            data-testid="branch-find-input"
            aria-label="Find a branch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a branch"
            className="h-7 px-1.5 text-xs border-transparent bg-transparent focus:border-ring"
          />
        </div>

        {creating ? (
          <form
            data-testid="branch-create-form"
            className="p-3 border-b border-border space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = label.trim();
              if (!trimmed || trimmed.length > 80 || actionPending || createDisabledReason) return;
              setActionPending(true);
              setActionError(null);
              void onCreateBranch(trimmed, source).then((outcome) => {
                if (outcome.status === 'failed') setActionError(outcome.message);
                if (outcome.status === 'done') {
                  setCreating(false);
                  setLabel('');
                  setOpen(false);
                }
              }).finally(() => setActionPending(false));
            }}
          >
            <div>
              <label htmlFor="new-branch-label" className="block text-xs font-medium text-ink mb-1">
                Branch name
              </label>
              <Input
                id="new-branch-label"
                data-testid="branch-create-label"
                autoFocus
                maxLength={80}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="e.g. cache experiment"
                className="h-8 text-xs"
                required
                disabled={actionPending || isSaving}
              />
            </div>
            <fieldset className="space-y-1.5" disabled={actionPending || isSaving}>
              <legend className="text-xs font-medium text-ink mb-1">Start from</legend>
              <label className="flex items-start gap-2 rounded-control border border-control-border px-2.5 py-2 cursor-pointer has-[:checked]:border-branch has-[:checked]:bg-branch-tint">
                <input
                  type="radio"
                  name="branch-source"
                  value="working"
                  checked={source === 'working'}
                  onChange={() => setSource('working')}
                  className="mt-0.5 accent-branch"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-ink">Current work</span>
                  <span className="block text-[11px] text-secondary-text">Copy the latest saved version of this branch</span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-control border border-control-border px-2.5 py-2 cursor-pointer has-[:checked]:border-branch has-[:checked]:bg-branch-tint">
                <input
                  type="radio"
                  name="branch-source"
                  value="head"
                  checked={source === 'head'}
                  onChange={() => setSource('head')}
                  className="mt-0.5 accent-branch"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-ink">
                    {current?.headCommitId ? 'Last committed version' : 'Original project version'}
                  </span>
                  <span className="block text-[11px] text-secondary-text">
                    {current?.headCommitId
                      ? 'Start from this branch’s latest commit'
                      : 'Start from the blank canvas or starter template'}
                  </span>
                </span>
              </label>
            </fieldset>
            {createDisabledReason && (
              <p className="text-xs text-secondary-text" role="status">{createDisabledReason}</p>
            )}
            {actionError && <p className="text-xs text-destructive" role="alert">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={actionPending} onClick={() => { setCreating(false); setActionError(null); }}>
                Cancel
              </Button>
              <Button
                type="submit"
                data-testid="branch-create-submit"
                size="sm"
                variant="tint"
                disabled={!label.trim() || label.trim().length > 80 || actionPending || isSaving || Boolean(createDisabledReason)}
              >
                {actionPending ? 'Creating…' : 'Create branch'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="px-3 pt-2">
            {actionError && <p className="mb-2 text-xs text-destructive" role="alert">{actionError}</p>}
            <Button
              type="button"
              data-testid="branch-create-open"
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-xs"
              disabled={isSaving || Boolean(createDisabledReason)}
              title={createDisabledReason ?? undefined}
              onClick={() => { setCreating(true); setActionError(null); }}
            >
              <Plus size={13} aria-hidden="true" />
              Create branch
            </Button>
          </div>
        )}

        {current && (
          <div className="px-3 pt-2.5 pb-1.5">
            <div className="text-[10px] font-mono uppercase tracking-wide text-secondary-text mb-1">
              On this branch
            </div>
            <div
              data-testid="branch-current-row"
              className="flex items-center justify-between gap-2 px-2 py-2 rounded-control bg-branch-tint"
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <GitBranch size={13} className="text-branch shrink-0" />
                <span className="text-xs font-semibold text-branch truncate">
                  {branchLabel(project, current)}
                </span>
                <Badge
                  variant="risk"
                  className="text-[9px] px-1 py-0 h-4 normal-case"
                >
                  {current.id === project.mainBranchId ? 'MAIN' : 'DRAFT'}
                </Badge>
              </div>
              <Check size={13} className="text-branch shrink-0" />
            </div>
          </div>
        )}

        <div className="px-3 pt-1 pb-2">
          <div className="text-[10px] font-mono uppercase tracking-wide text-secondary-text mb-1">
            Switch to
          </div>
          <div
            data-testid="branch-switch-list"
            className="flex flex-col gap-0.5 max-h-64 overflow-y-auto"
          >
            {others.length === 0 ? (
              <div className="text-xs text-secondary-text px-2 py-2">
                No other branches
              </div>
            ) : (
              others.map((b) => (
                <div
                  key={b.id}
                  role="group"
                  aria-label={`Branch ${branchLabel(project, b)}`}
                  className="flex items-center gap-1 rounded-control hover:bg-accent"
                >
                  <button
                    type="button"
                    data-testid={`branch-switch-${b.id}`}
                    className={cn('flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-2 rounded-control text-left')}
                    onClick={() => {
                      setOpen(false);
                      onSwitchBranch(b.id);
                    }}
                  >
                    <span className="text-xs font-medium text-ink truncate">{branchLabel(project, b)}</span>
                    {b.state === 'closed' && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">CLOSED</Badge>
                    )}
                  </button>
                  {b.state === 'closed' && (
                    <Button
                      type="button"
                      data-testid={`branch-reopen-${b.id}`}
                      aria-label={`Reopen and switch to ${branchLabel(project, b)}`}
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 px-2 text-[11px]"
                      disabled={isSaving || actionPending}
                      onClick={() => {
                        setActionPending(true);
                        setActionError(null);
                        void onReopenBranch(b.id).then((outcome) => {
                          if (outcome.status === 'failed') setActionError(outcome.message);
                          if (outcome.status === 'done') setOpen(false);
                        }).finally(() => setActionPending(false));
                      }}
                    >
                      <RotateCcw size={12} className="mr-1" aria-hidden="true" />
                      Reopen
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

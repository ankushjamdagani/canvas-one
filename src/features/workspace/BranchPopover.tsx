import * as React from 'react';
import { Search, Check, GitBranch, Plus, RotateCcw, Home } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import type { BranchRecord, ProjectRecord } from '../../persistence/studio/types';
import { formatRelativeTime } from './timeUtils';

export interface BranchPopoverProps {
  project: ProjectRecord;
  branches: readonly BranchRecord[];
  currentBranchId: string;
  children: React.ReactNode | ((isOpen: boolean) => React.ReactNode);
  onSwitchBranch: (branchId: string) => void;
  onCreateBranch: (
    label: string,
    source: 'working' | 'head',
  ) => Promise<BranchActionOutcome>;
  onReopenBranch: (branchId: string) => Promise<BranchActionOutcome>;
  createDisabledReason?: string | null;
  isSaving?: boolean;
  onOpenHistory?: () => void;
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
 * Implements specifications and aesthetics from Screen 13B (Branch switch):
 * - 392px width popover with subtle border and elevation shadow
 * - Top search bar with "Find or create a branch" and ⌘B hint
 * - "ON THIS BRANCH" section with current branch, status badge, last edited timestamp, and checkmark
 * - "SWITCH TO" section with branches list, last edited timestamp, and hover state
 * - Bottom action bar with "New branch from here" and "Manage branches"
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
  onOpenHistory,
}: BranchPopoverProps) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handleDismiss = () => setOpen(false);
    window.addEventListener('studio:dismiss-transients', handleDismiss);
    return () => window.removeEventListener('studio:dismiss-transients', handleDismiss);
  }, []);
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
    .sort((a, b) => {
      // Put main first if in switch-to list, otherwise alphabetical
      if (a.id === project.mainBranchId) return -1;
      if (b.id === project.mainBranchId) return 1;
      return branchLabel(project, a).localeCompare(branchLabel(project, b));
    });

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
      <PopoverTrigger asChild>
        {typeof children === 'function' ? children(open) : children}
      </PopoverTrigger>
      <PopoverContent
        data-testid="branch-popover"
        align="start"
        sideOffset={6}
        className="w-[392px] max-w-[calc(100vw-24px)] p-0 rounded-popover border border-border bg-background shadow-popover overflow-hidden outline-none flex flex-col"
      >
        <div className="px-3 py-2.5 border-b border-hairline flex items-center gap-2 bg-panel select-none">
          <Search size={14} className="text-secondary-text shrink-0" aria-hidden="true" />
          <Input
            data-testid="branch-find-input"
            aria-label="Find a branch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find or create a branch"
            className="h-6 px-0 text-[12.5px] border-0 shadow-none bg-transparent placeholder:text-secondary-text/70 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 text-ink"
          />
          <Kbd className="font-mono text-[9.5px] text-secondary-text bg-transparent border-0 p-0">⌘B</Kbd>
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
              void onCreateBranch(trimmed, source)
                .then((outcome) => {
                  if (outcome.status === 'failed') setActionError(outcome.message);
                  if (outcome.status === 'done') {
                    setCreating(false);
                    setLabel('');
                    setOpen(false);
                  }
                })
                .finally(() => setActionPending(false));
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={actionPending}
                onClick={() => {
                  setCreating(false);
                  setActionError(null);
                }}
              >
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
          <>
            {/* ON THIS BRANCH */}
            {current && (
              <div className="px-2 pt-2.5 pb-1.5 flex flex-col gap-1">
                <div className="flex items-center gap-2 px-1.5 pb-1">
                  <span className="font-mono text-[9px] font-semibold tracking-[0.12em] text-secondary-text uppercase">
                    On this branch
                  </span>
                  <span className="flex-1 h-px bg-[#EFEBE3]" />
                </div>
                <div
                  data-testid="branch-current-row"
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-control bg-[#F7F4FC] border border-[#C9B9E4]"
                >
                  <GitBranch size={14} className="text-[#7C5FC0] shrink-0" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-[#7C5FC0] truncate">
                        {branchLabel(project, current)}
                      </span>
                      <Badge
                        variant={current.id === project.mainBranchId ? 'accent' : 'risk'}
                        className="text-[9px] font-mono tracking-[0.1em] px-1 py-0 h-4 shrink-0"
                      >
                        {current.id === project.mainBranchId ? 'LIVE' : 'DRAFT'}
                      </Badge>
                    </div>
                    <div className="font-mono text-[9.5px] text-secondary-text mt-0.5">
                      edited {formatRelativeTime(project.updatedAt ? Math.max(current.createdAt, project.updatedAt) : current.createdAt)}
                    </div>
                  </div>
                  <Check size={14} className="text-[#7C5FC0] shrink-0" aria-hidden="true" />
                </div>
              </div>
            )}

            {/* SWITCH TO */}
            <div className="px-2 pt-1 pb-1 flex flex-col gap-1">
              <div className="flex items-center gap-2 px-1.5 pb-1">
                <span className="font-mono text-[9px] font-semibold tracking-[0.12em] text-secondary-text uppercase">
                  Switch to
                </span>
                <span className="flex-1 h-px bg-[#EFEBE3]" />
                <span className="font-mono text-[9px] text-secondary-text">{others.length}</span>
              </div>

              <div
                data-testid="branch-switch-list"
                className="flex flex-col gap-0.5 max-h-60 overflow-y-auto"
              >
                {others.length === 0 ? (
                  <div className="text-xs text-secondary-text px-3 py-2.5 text-center">
                    No other branches
                  </div>
                ) : (
                  others.map((b) => {
                    const isMain = b.id === project.mainBranchId;
                    const isClosed = b.state === 'closed';
                    return (
                      <div
                        key={b.id}
                        role="group"
                        aria-label={`Branch ${branchLabel(project, b)}`}
                        className="flex items-center gap-1 rounded-[8px] hover:bg-[#F2EFE9] transition-colors group"
                      >
                        <button
                          type="button"
                          data-testid={`branch-switch-${b.id}`}
                          disabled={isClosed}
                          title={isClosed ? 'Reopen this branch before switching to it' : undefined}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 rounded-[8px] text-left cursor-pointer',
                            isClosed && 'cursor-default opacity-60',
                          )}
                          onClick={() => {
                            setOpen(false);
                            onSwitchBranch(b.id);
                          }}
                        >
                          {isMain ? (
                            <Home size={13} className="text-[#0B5C54] shrink-0" aria-hidden="true" />
                          ) : (
                            <GitBranch size={13} className="text-secondary-text shrink-0" aria-hidden="true" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-semibold text-ink truncate">
                                {branchLabel(project, b)}
                              </span>
                              {isMain && (
                                <Badge
                                  variant="accent"
                                  className="text-[9px] font-mono tracking-[0.1em] px-1 py-0 h-4 shrink-0"
                                >
                                  LIVE
                                </Badge>
                              )}
                              {isClosed && (
                                <Badge
                                  variant="secondary"
                                  className="text-[9px] font-mono tracking-[0.1em] px-1 py-0 h-4 shrink-0"
                                >
                                  MERGED
                                </Badge>
                              )}
                            </div>
                            <div className="font-mono text-[9.5px] text-secondary-text mt-0.5">
                              edited {formatRelativeTime(b.createdAt)}
                            </div>
                          </div>
                          <span className="font-mono text-[9.5px] text-secondary-text opacity-0 group-hover:opacity-100 transition-opacity">
                            ↵
                          </span>
                        </button>
                        {isClosed && (
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
                              void onReopenBranch(b.id)
                                .then((outcome) => {
                                  if (outcome.status === 'failed') setActionError(outcome.message);
                                  if (outcome.status === 'done') setOpen(false);
                                })
                                .finally(() => setActionPending(false));
                            }}
                          >
                            <RotateCcw size={12} className="mr-1" aria-hidden="true" />
                            Reopen
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Bottom bar */}
            <div className="border-t border-hairline bg-panel px-3 py-2.5 flex items-center justify-between select-none mt-auto">
              <button
                type="button"
                data-testid="branch-create-open"
                disabled={isSaving || Boolean(createDisabledReason)}
                title={createDisabledReason ?? undefined}
                onClick={() => {
                  setCreating(true);
                  setActionError(null);
                }}
                className="flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:text-primary-hover disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <Plus size={14} aria-hidden="true" />
                <span>New branch from here</span>
              </button>
              <button
                type="button"
                data-testid="branch-manage-btn"
                onClick={() => {
                  setOpen(false);
                  onOpenHistory?.();
                }}
                className="text-xs text-secondary-text hover:text-ink cursor-pointer"
              >
                Manage branches
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

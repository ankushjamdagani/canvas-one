import * as React from 'react';
import { Search, Check, GitBranch } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BranchRecord, ProjectRecord } from '../../persistence/studio/types';

export interface BranchPopoverProps {
  project: ProjectRecord;
  branches: readonly BranchRecord[];
  currentBranchId: string;
  children: React.ReactNode;
  onSwitchBranch: (branchId: string) => void;
}

function branchLabel(project: ProjectRecord, branch: BranchRecord): string {
  return branch.id === project.mainBranchId ? 'main' : branch.label;
}

/**
 * 13B "Branch popover".
 *
 * Screen also shows an "unsaved run" warning and "New branch from here" /
 * "Manage branches" — omitted per brief (runs arrive later; no branch
 * creation/management contract for this popover yet). Switching goes straight
 * through `session.openProject`, no navigation-guard warning.
 */
export function BranchPopover({
  project,
  branches,
  currentBranchId,
  children,
  onSwitchBranch,
}: BranchPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

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
        if (!next) setQuery('');
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
                <button
                  key={b.id}
                  type="button"
                  data-testid={`branch-switch-${b.id}`}
                  className={cn(
                    'flex items-center justify-between gap-2 px-2 py-2 rounded-control text-left',
                    'hover:bg-accent transition-colors',
                  )}
                  onClick={() => {
                    setOpen(false);
                    onSwitchBranch(b.id);
                  }}
                >
                  <span className="text-xs font-medium text-ink truncate">
                    {branchLabel(project, b)}
                  </span>
                  {b.state === 'closed' && (
                    <Badge
                      variant="secondary"
                      className="text-[9px] px-1 py-0 h-4 shrink-0"
                    >
                      CLOSED
                    </Badge>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

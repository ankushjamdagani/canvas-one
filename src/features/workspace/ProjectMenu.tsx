import * as React from 'react';
import { Pencil, FolderOpen } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { ExportMenu, type TransferActions } from '../transfer';

export interface ProjectMenuProps {
  projectTitle: string;
  branchCount: number;
  children: React.ReactNode;
  onRenameProject: () => void;
  onAllProjects: () => void;
  transferActions: TransferActions;
}

/**
 * 13A "Project menu open".
 *
 * Screen shows Duplicate project / Move to team… / Project settings / Archive
 * project too, but those aren't contracted (design-revalidation.md §2: no
 * team/sharing; §3 gap 8: settings/duplicate/archive undecided) so they are
 * left out entirely rather than rendered disabled or fake. "All projects"
 * (gap 6's recommendation, D-decided via the entry screen) replaces them.
 */
export function ProjectMenu({
  projectTitle,
  branchCount,
  children,
  onRenameProject,
  onAllProjects,
  transferActions,
}: ProjectMenuProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        data-testid="project-menu-popover"
        align="start"
        sideOffset={6}
        className="w-72 p-0 rounded-popover border-control-border bg-panel shadow-popover"
      >
        <div className="px-3.5 pt-3 pb-2.5 border-b border-border">
          <div className="text-[10px] font-mono uppercase tracking-wide text-secondary-text">
            Project
          </div>
          <div className="text-sm font-semibold text-ink mt-0.5 truncate">
            {projectTitle}
          </div>
          <div className="text-[11px] text-secondary-text mt-0.5">
            {branchCount} {branchCount === 1 ? 'branch' : 'branches'}
          </div>
        </div>

        <div className="p-1.5 flex flex-col">
          <button
            type="button"
            data-testid="project-menu-rename"
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-control text-xs font-medium text-left',
              'text-primary hover:bg-accent transition-colors',
            )}
            onClick={() => {
              setOpen(false);
              onRenameProject();
            }}
          >
            <Pencil size={13} className="shrink-0" />
            Rename project
          </button>

          <ExportMenu actions={transferActions} align="start" />

          <button
            type="button"
            data-testid="project-menu-all-projects"
            className={cn(
              'flex items-center gap-2 px-2 py-1.5 rounded-control text-xs font-medium text-left',
              'text-body hover:bg-accent transition-colors',
            )}
            onClick={() => {
              setOpen(false);
              onAllProjects();
            }}
          >
            <FolderOpen size={13} className="shrink-0" />
            All projects
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

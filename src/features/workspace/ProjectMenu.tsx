import * as React from 'react';
import {
  Pencil,
  Copy,
  ArrowLeftRight,
  Settings,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExportMenu, type TransferActions } from '../transfer';

export interface ProjectMenuProps {
  projectTitle: string;
  branchCount: number;
  children: React.ReactNode | ((isOpen: boolean) => React.ReactNode);
  onRenameProject: () => void;
  onAllProjects: () => void;
  transferActions: TransferActions;
}

/**
 * 13A "Project menu open" & 18B "Export submenu".
 *
 * Implements specs and aesthetics from Screens 13A & 18B:
 * - 268px width menu with subtle border and elevation shadow
 * - Uppercase mono category and metadata subtitle (platform team · N branches)
 * - Rename project with shortcut hint (⌘R)
 * - Duplicate, Move to team, Settings, Export (submenu opening to the right), All projects, Archive
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
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        {typeof children === 'function' ? children(open) : children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid="project-menu-popover"
        align="start"
        sideOffset={6}
        className="w-[268px]"
      >
        <div role="presentation" className="px-2.5 pt-2 pb-1.5 select-none">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-secondary-text">
            PROJECT
          </div>
          <div className="text-[13.5px] font-semibold text-ink mt-0.5 truncate">
            {projectTitle}
          </div>
          <div className="font-mono text-[9.5px] text-secondary-text mt-0.5">
            platform team · {branchCount} {branchCount === 1 ? 'branch' : 'branches'}
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* Rename project */}
        <DropdownMenuItem
          data-testid="project-menu-rename"
          className="text-primary bg-[#EAEFEC] hover:bg-[#DFE8E4] focus:bg-[#DFE8E4] data-[highlighted]:bg-[#DFE8E4] font-semibold cursor-pointer"
          onSelect={() => {
            onRenameProject();
          }}
        >
          <Pencil size={12} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="flex-1">Rename project</span>
          <DropdownMenuShortcut className="text-primary font-mono text-[10px]">⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>

        {/* Duplicate project */}
        <DropdownMenuItem
          data-testid="project-menu-duplicate"
          onSelect={() => {}}
        >
          <Copy size={12} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>Duplicate project</span>
        </DropdownMenuItem>

        {/* Move to team... */}
        <DropdownMenuItem
          data-testid="project-menu-move-team"
          onSelect={() => {}}
        >
          <ArrowLeftRight size={12} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>Move to team…</span>
        </DropdownMenuItem>

        {/* Project settings */}
        <DropdownMenuItem
          data-testid="project-menu-settings"
          onSelect={() => {}}
        >
          <Settings size={12} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>Project settings</span>
        </DropdownMenuItem>

        {/* Export project (submenu opening to the right) */}
        <ExportMenu
          actions={transferActions}
          asSubmenu
        />

        {/* All projects */}
        <DropdownMenuItem
          data-testid="project-menu-all-projects"
          onSelect={() => {
            onAllProjects();
          }}
        >
          <FolderOpen size={12} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>All projects</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Archive project */}
        <DropdownMenuItem
          data-testid="project-menu-archive"
          variant="destructive"
          onSelect={() => {}}
        >
          <Trash2 size={12} className="shrink-0 text-destructive" aria-hidden="true" />
          <span>Archive project</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

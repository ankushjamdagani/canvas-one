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
  DropdownMenuHeader,
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
 * - Standardized faded gray top header with uppercase mono category and metadata subtitle
 * - Pure white body section with standardized 14px icon sizing and consistent row spacing
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

  React.useEffect(() => {
    const handleDismiss = () => setOpen(false);
    window.addEventListener('studio:dismiss-transients', handleDismiss);
    return () => window.removeEventListener('studio:dismiss-transients', handleDismiss);
  }, []);

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
        <DropdownMenuHeader className="flex-col items-start gap-0.5 px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-secondary-text">
            PROJECT
          </div>
          <div className="text-[13.5px] font-semibold text-ink truncate w-full">
            {projectTitle}
          </div>
          <div className="font-mono text-[9.5px] text-secondary-text">
            platform team · {branchCount} {branchCount === 1 ? 'branch' : 'branches'}
          </div>
        </DropdownMenuHeader>

        {/* Rename project */}
        <DropdownMenuItem
          data-testid="project-menu-rename"
          className="text-primary bg-[#EAEFEC] hover:bg-[#DFE8E4] focus:bg-[#DFE8E4] data-[highlighted]:bg-[#DFE8E4] font-semibold cursor-pointer"
          onSelect={() => {
            onRenameProject();
          }}
        >
          <Pencil size={14} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="flex-1">Rename project</span>
          <DropdownMenuShortcut className="text-primary font-mono text-[10px]">⌘R</DropdownMenuShortcut>
        </DropdownMenuItem>

        {/* Duplicate project */}
        <DropdownMenuItem
          data-testid="project-menu-duplicate"
          onSelect={() => {}}
        >
          <Copy size={14} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>Duplicate project</span>
        </DropdownMenuItem>

        {/* Move to team... */}
        <DropdownMenuItem
          data-testid="project-menu-move-team"
          onSelect={() => {}}
        >
          <ArrowLeftRight size={14} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>Move to team…</span>
        </DropdownMenuItem>

        {/* Project settings */}
        <DropdownMenuItem
          data-testid="project-menu-settings"
          onSelect={() => {}}
        >
          <Settings size={14} className="shrink-0 text-secondary-text" aria-hidden="true" />
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
          <FolderOpen size={14} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>All projects</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Archive project */}
        <DropdownMenuItem
          data-testid="project-menu-archive"
          variant="destructive"
          onSelect={() => {}}
        >
          <Trash2 size={14} className="shrink-0 text-destructive" aria-hidden="true" />
          <span>Archive project</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

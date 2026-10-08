import * as React from 'react';
import { useHeaderSideOffset } from '@/lib/useHeaderSideOffset';
import {
  Pencil,
  Copy,
  ArrowLeftRight,
  Settings,
  FolderOpen,
  Link2,
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
  team: string;
  children: React.ReactNode | ((isOpen: boolean) => React.ReactNode);
  onRenameProject: () => void;
  onOpenSettings: () => void;
  onOpenExposedEndpoints: () => void;
  onAllProjects: () => void;
  onDeleteProject: () => void;
  transferActions: TransferActions;
}

/**
 * 13A "Project menu open" & 18B "Export submenu".
 *
 * Implements specs and aesthetics from Screens 13A & 18B:
 * - 268px width menu with subtle border and elevation shadow
 * - Standardized faded gray top header with mono category and metadata subtitle
 * - Pure white body section with standardized 14px icon sizing and consistent row spacing
 * - Rename project with shortcut hint (⌘R)
 * - Duplicate, Move to team, Settings, Export (submenu opening to the right), All projects, Delete
 */
export function ProjectMenu({
  projectTitle,
  branchCount,
  team,
  children,
  onRenameProject,
  onOpenSettings,
  onOpenExposedEndpoints,
  onAllProjects,
  onDeleteProject,
  transferActions,
}: ProjectMenuProps) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handleDismiss = () => setOpen(false);
    window.addEventListener('studio:dismiss-transients', handleDismiss);
    return () => window.removeEventListener('studio:dismiss-transients', handleDismiss);
  }, []);

  const sideOffset = useHeaderSideOffset(open);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        {typeof children === 'function' ? children(open) : children}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid="project-menu-popover"
        align="start"
        sideOffset={sideOffset}
        className="w-[268px]"
      >
        <DropdownMenuHeader className="flex-col items-start gap-0.5 px-3 py-2.5">
          <div className="font-mono text-micro tracking-normal text-secondary-text">
            Project
          </div>
          <div className="text-ui font-semibold text-ink truncate w-full">
            {projectTitle}
          </div>
          <div className="font-mono text-micro tracking-normal text-secondary-text">
            {team ? `${team} · ` : ''}{branchCount} {branchCount === 1 ? 'branch' : 'branches'}
          </div>
        </DropdownMenuHeader>

        {/* Rename project */}
        <DropdownMenuItem
          data-testid="project-menu-rename"
          className="text-accent-foreground bg-accent hover:bg-tint-hover focus:bg-tint-hover data-[highlighted]:bg-tint-hover font-semibold cursor-pointer"
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
          onSelect={() => {
            onOpenSettings();
          }}
        >
          <Settings size={14} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>Project settings</span>
        </DropdownMenuItem>

        {/* Exposed endpoints (D53) */}
        <DropdownMenuItem
          data-testid="project-menu-exposed-endpoints"
          onSelect={() => {
            onOpenExposedEndpoints();
          }}
        >
          <Link2 size={14} className="shrink-0 text-secondary-text" aria-hidden="true" />
          <span>Exposed endpoints…</span>
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

        {/* Delete project */}
        <DropdownMenuItem
          data-testid="project-menu-delete"
          variant="destructive"
          onSelect={() => onDeleteProject()}
        >
          <Trash2 size={14} className="shrink-0 text-destructive" aria-hidden="true" />
          <span>Delete project…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

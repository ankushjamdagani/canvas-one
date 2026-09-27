import * as React from 'react';
import { ChevronDown, GitBranch, History as HistoryIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BranchRecord, ProjectRecord } from '../../persistence/studio/types';
import { ProjectMenu } from './ProjectMenu';
import { BranchPopover } from './BranchPopover';
import type { TransferActions } from '../transfer';

export interface TopBarProps {
  project: ProjectRecord;
  branches: readonly BranchRecord[];
  branchId: string;
  onRenameProject: (title: string) => Promise<unknown>;
  onSwitchBranch: (branchId: string) => void;
  onAllProjects: () => void;
  saveStatusText: string;
  isSaving: boolean;
  hasError: boolean;
  /**
   * D38: Run and the scenario switcher live in the top bar, but that UI
   * belongs to the runs lane (RV-04/RV-07), not this shell package. This slot
   * is where it mounts; empty until that lane wires it in.
   */
  runControl?: React.ReactNode;
  /**
   * RV-12h (D38, 22A): History is a top-bar command, never a dock item.
   * Dispatches history.open (panel reducer OPEN 'history') in the caller.
   */
  onOpenHistory?: () => void;
  /** Highlights the History button while the History panel is open/focused. */
  historyActive?: boolean;
  transferActions: TransferActions;
}

/**
 * 22A "nav live" top bar.
 *
 * Per D38/brief: Quick options (no command registry yet) and the "…" menu
 * (nothing real to put in it) are absent, not fake. Undo/redo moved to the
 * canvas dock (16A). History (RV-12h) opens the History panel.
 */
export function TopBar({
  project,
  branches,
  branchId,
  onRenameProject,
  onSwitchBranch,
  onAllProjects,
  saveStatusText,
  isSaving,
  hasError,
  runControl,
  onOpenHistory,
  historyActive,
  transferActions,
}: TopBarProps) {
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(project.title);

  React.useEffect(() => {
    if (!isRenaming) setTitleDraft(project.title);
  }, [project.title, isRenaming]);

  const currentBranch = branches.find((b) => b.id === branchId) ?? null;
  const isMainBranch = branchId === project.mainBranchId;
  const branchLabel = currentBranch
    ? isMainBranch
      ? 'main'
      : currentBranch.label
    : '';

  const commitRename = async () => {
    const trimmed = titleDraft.trim();
    if (trimmed.length > 0 && trimmed.length <= 80 && trimmed !== project.title) {
      await onRenameProject(trimmed);
    } else {
      setTitleDraft(project.title);
    }
    setIsRenaming(false);
  };

  return (
    <header
      data-testid="workspace-topbar"
      className={cn(
        'relative shrink-0 flex items-center justify-between px-3 sm:px-4 h-[52px] min-h-[52px]',
        'border-b border-border bg-shell select-none z-chrome w-full max-w-full overflow-hidden gap-2',
      )}
      role="banner"
    >
      <div className="flex items-center gap-2.5 min-w-0 shrink">
        {/* Brand mark */}
        <div
          data-testid="brand"
          className="flex items-center gap-2 font-semibold text-[14px] tracking-[-0.01em] text-foreground shrink-0 select-none"
        >
          <svg
            className="size-5 shrink-0"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="brand-mark-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0B5C54" />
                <stop offset="100%" stopColor="#2E7D6B" />
              </linearGradient>
            </defs>
            <rect width="20" height="20" rx="5" fill="url(#brand-mark-gradient)" />
          </svg>
          <span className="hidden sm:inline">System studio</span>
        </div>

        {/* Breadcrumb chip: Project / branch [DRAFT|MAIN] */}
        <div
          data-testid="breadcrumb-chip"
          className="flex items-center gap-1 sm:gap-1.5 min-w-0 rounded-control border border-control-border bg-panel pl-2 pr-1.5 h-7 overflow-hidden"
        >
          {isRenaming ? (
            <Input
              autoFocus
              data-testid="project-title-input"
              aria-label="Project title"
              className="h-6 px-1.5 text-xs w-28 sm:w-40 bg-canvas border-control-border"
              value={titleDraft}
              maxLength={80}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                  void commitRename();
                } else if (e.key === 'Escape') {
                  setTitleDraft(project.title);
                  setIsRenaming(false);
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => void commitRename()}
            />
          ) : (
            <ProjectMenu
              projectTitle={project.title}
              branchCount={branches.length}
              onRenameProject={() => setIsRenaming(true)}
              onAllProjects={onAllProjects}
              transferActions={transferActions}
            >
              <button
                type="button"
                data-testid="breadcrumb-project-btn"
                // RV-05b review round 1: min-w-[6ch] keeps at least ~6 characters of
                // the project name visible (ellipsis included) on narrow widths --
                // without it, this flex child could shrink past its truncate ellipsis
                // down to a single character as the branch chip and badge (both
                // shrink-0) claimed the rest of the breadcrumb's width.
                className="text-xs font-semibold text-ink hover:text-primary transition-colors truncate min-w-[6ch] max-w-[120px] sm:max-w-[220px] shrink"
                title={project.title}
              >
                {project.title}
              </button>
            </ProjectMenu>
          )}

          {/* RV-05b review round 1: dropped below sm along with the chevron so a
              390px top bar has room for the project name, the branch icon and the
              MAIN/DRAFT badge without any of them getting clipped. */}
          <span className="hidden sm:inline text-secondary-text text-xs select-none shrink-0" aria-hidden="true">
            /
          </span>

          <BranchPopover
            project={project}
            branches={branches}
            currentBranchId={branchId}
            onSwitchBranch={onSwitchBranch}
          >
            <button
              type="button"
              data-testid="breadcrumb-branch-btn"
              className="flex items-center gap-1 min-w-0 shrink-0"
              title={branchLabel}
            >
              <GitBranch size={12} className="text-branch shrink-0" />
              {/* RV-05b review round 1: the branch label text drops below sm so the
                  project name keeps its room on a narrow top bar; the icon plus the
                  MAIN/DRAFT badge still identify the branch. */}
              <span className="hidden sm:inline text-xs font-semibold text-branch truncate max-w-[110px] sm:max-w-[180px]">
                {branchLabel}
              </span>
            </button>
          </BranchPopover>

          <Badge
            data-testid="breadcrumb-branch-state"
            variant="risk"
            className="text-[9px] px-1 sm:px-1 py-0 h-4 shrink-0 normal-case max-[400px]:px-0.5"
          >
            {isMainBranch ? 'MAIN' : 'DRAFT'}
          </Badge>

          <ChevronDown size={12} className="hidden sm:block text-secondary-text shrink-0" aria-hidden="true" />
        </div>

        {/* Save Status */}
        <span
          data-testid="save-status"
          data-state={isSaving ? 'saving' : 'idle'}
          className="text-xs text-secondary-text hidden md:flex items-center gap-1.5 ml-1 shrink-0 whitespace-nowrap"
          role="status"
          aria-label={saveStatusText}
          title={saveStatusText}
        >
          <span
            aria-hidden="true"
            className={cn(
              'inline-block size-1.5 rounded-full shrink-0',
              isSaving ? 'bg-primary animate-pulse' : hasError ? 'bg-risk' : 'bg-primary',
            )}
          />
          <span className="truncate max-w-[160px]">{saveStatusText}</span>
        </span>
      </div>

      {/* D38: Run + scenario switcher slot, owned by the runs lane */}
      <div data-slot="run-control" className="flex items-center gap-2 shrink-0">
        {onOpenHistory && (
          <Button
            type="button"
            data-testid="topbar-history-btn"
            variant={historyActive ? 'tint' : 'outline'}
            size="sm"
            className="h-7 px-2.5 text-xs font-medium"
            onClick={onOpenHistory}
          >
            <HistoryIcon className="size-3.5 mr-1" />
            History
          </Button>
        )}
        {runControl ?? null}
      </div>
    </header>
  );
}

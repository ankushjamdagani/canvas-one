import * as React from 'react';
import {
  FolderOpen,
  Check,
  Undo2,
  Redo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface TopBarProps {
  projectTitle: string;
  onRenameProject: (title: string) => Promise<unknown>;
  onBackToProjects: () => void;
  saveStatusText: string;
  isSaving: boolean;
  hasError: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function TopBar({
  projectTitle,
  onRenameProject,
  onBackToProjects,
  saveStatusText,
  isSaving,
  hasError,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: TopBarProps) {
  const [titleDraft, setTitleDraft] = React.useState(projectTitle);
  const [isEditing, setIsEditing] = React.useState(false);

  React.useEffect(() => {
    setTitleDraft(projectTitle);
  }, [projectTitle]);

  const handleCommitRename = async () => {
    const trimmed = titleDraft.trim();
    if (trimmed.length > 0 && trimmed.length <= 80 && trimmed !== projectTitle) {
      await onRenameProject(trimmed);
    } else {
      setTitleDraft(projectTitle);
    }
    setIsEditing(false);
  };

  return (
    <TooltipProvider delayDuration={250}>
      <header
        data-testid="workspace-topbar"
        className={cn(
          'relative shrink-0 flex items-center justify-between px-3 sm:px-4 h-[52px] min-h-[52px]',
          'border-b border-border bg-shell select-none z-chrome w-full max-w-full overflow-hidden',
        )}
        role="banner"
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
          {/* Brand mark */}
          <div
            data-testid="brand"
            className="flex items-center gap-2 font-semibold text-[14px] sm:text-[14.5px] tracking-[-0.01em] text-foreground shrink-0 select-none"
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
            <span className="hidden sm:inline">System Studio</span>
          </div>

          <Separator orientation="vertical" className="h-5 bg-border shrink-0" />

          {/* Projects navigation button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="projects-back-btn"
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs font-medium text-foreground hover:bg-accent flex items-center gap-1.5 shrink-0 rounded-control"
                onClick={onBackToProjects}
                aria-label="Back to projects"
              >
                <FolderOpen size={14} className="text-secondary-text shrink-0" />
                <span>Projects</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Switch or open other projects</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-5 bg-border shrink-0" />

          {/* Inline Project Title Rename */}
          <div className="flex items-center gap-1 min-w-0">
            <Input
              data-testid="project-title-input"
              aria-label="Project title"
              className={cn(
                'h-7 px-2 text-xs w-24 sm:w-44 md:w-56 border-transparent hover:border-control-border focus:border-ring',
                'bg-transparent hover:bg-canvas focus:bg-canvas transition-colors truncate',
              )}
              value={titleDraft}
              onChange={(e) => {
                setTitleDraft(e.target.value);
                setIsEditing(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                  void handleCommitRename();
                } else if (e.key === 'Escape') {
                  setTitleDraft(projectTitle);
                  setIsEditing(false);
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => {
                void handleCommitRename();
              }}
              maxLength={80}
              placeholder="Project title"
              title="Click to rename project"
            />
            {isEditing && titleDraft.trim() !== projectTitle && titleDraft.trim().length > 0 && (
              <Button
                data-testid="project-save-btn"
                type="button"
                variant="default"
                size="sm"
                className="h-7 px-2 text-xs flex items-center gap-1 shrink-0"
                onClick={() => {
                  void handleCommitRename();
                }}
                aria-label="Save project title"
              >
                <Check size={12} />
                <span className="hidden sm:inline">Save</span>
              </Button>
            )}
          </div>

          {/* Save Status text */}
          <span
            data-testid="save-status"
            className="text-xs text-secondary-text flex items-center gap-1.5 ml-1 shrink-0 whitespace-nowrap"
            role="status"
            aria-label={saveStatusText}
            title={saveStatusText}
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-block size-2 rounded-full shrink-0',
                isSaving ? 'bg-primary animate-pulse' : hasError ? 'bg-risk' : 'bg-primary',
              )}
            />
            <span className="hidden sm:inline truncate max-w-[120px] sm:max-w-[200px]">{saveStatusText}</span>
            <span className="sr-only sm:hidden">{saveStatusText}</span>
          </span>
        </div>

        {/* Undo / Redo controls in topbar */}
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="topbar-undo-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-body hover:text-foreground disabled:text-secondary-text"
                disabled={!canUndo}
                onClick={onUndo}
                aria-label="Undo"
              >
                <Undo2 size={15} className="stroke-current" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Undo (Mod+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="topbar-redo-btn"
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-body hover:text-foreground disabled:text-secondary-text"
                disabled={!canRedo}
                onClick={onRedo}
                aria-label="Redo"
              >
                <Redo2 size={15} className="stroke-current" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Redo (Mod+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}

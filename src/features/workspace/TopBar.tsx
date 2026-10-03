import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Command as CommandIcon,
  GitBranch,
  History as HistoryIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type {
  BranchRecord,
  ProjectRecord,
} from "../../persistence/studio/types";
import { projectDetails } from "../../persistence/studio/types";
import { ProjectMenu } from "./ProjectMenu";
import type { ProjectDetails } from "./ProjectDetailsDialog";
import type { EndpointCandidate } from "./ExposedEndpointsDialog";
import { lazyComponent } from "@/lib/lazyComponent";
import { RenameConflictPopover, RenamedNotice } from "./ProjectRenameFeedback";
import { BranchPopover, type BranchActionOutcome } from "./BranchPopover";
import type { TransferActions } from "../transfer";

export interface TopBarProps {
  project: ProjectRecord;
  branches: readonly BranchRecord[];
  branchId: string;
  onRenameProject: (title: string) => Promise<unknown>;
  /** Other projects (id + title) so a rename can flag a name that is already taken. */
  otherProjects?: readonly { readonly id: string; readonly title: string }[];
  onOpenProject?: (projectId: string) => void;
  onSwitchBranch: (branchId: string) => void;
  onCreateBranch: (
    label: string,
    source: "working" | "head",
  ) => Promise<BranchActionOutcome>;
  onReopenBranch: (branchId: string) => Promise<BranchActionOutcome>;
  createBranchDisabledReason?: string | null;
  onAllProjects: () => void;
  onDeleteProject: () => void;
  /** Saves the project's description and team; resolves to an error message, or null on success. */
  onUpdateProjectDetails: (details: ProjectDetails) => Promise<string | null>;
  /** D53: inbound ports of this project and whether each is exposed to projects that link it. */
  endpointCandidates: readonly EndpointCandidate[];
  onToggleEndpointExposed: (candidate: EndpointCandidate, exposed: boolean) => Promise<string | null>;
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
  /**
   * RV-03q (14A): opens Quick options (registry commands.open). The visible
   * button covers the case where the OS captures F2.
   */
  onOpenQuickOptions?: () => void;
  /** Key hint from the registry (commands.open), e.g. "F2". */
  quickOptionsShortcut?: string;
  quickOptionsActive?: boolean;
  transferActions: TransferActions;
}

/**
 * 22A "nav live" top bar.
 *
 * Implements specifications from Screen 22A / 13A / 13B:
 * - Two targets quiet at rest: Project rename target and Branch switch target
 * - Warm neutral on hover, teal on press for project name
 * - Violet family with live down caret on hover and flipped up caret while menu open for branch
 * - Inline rename with save (↵) and cancel (esc) hints
 */
// Rarely opened dialogs load on demand so the workspace chunk stays under the size limit.
const ProjectDetailsDialog = lazyComponent(
  () => import("./ProjectDetailsDialog").then((m) => m.ProjectDetailsDialog),
  null,
);
const ExposedEndpointsDialog = lazyComponent(
  () => import("./ExposedEndpointsDialog").then((m) => m.ExposedEndpointsDialog),
  null,
);

export function TopBar({
  project,
  branches,
  branchId,
  onRenameProject,
  otherProjects = [],
  onOpenProject,
  onSwitchBranch,
  onCreateBranch,
  onReopenBranch,
  createBranchDisabledReason,
  onAllProjects,
  onDeleteProject,
  onUpdateProjectDetails,
  endpointCandidates,
  onToggleEndpointExposed,
  saveStatusText,
  isSaving,
  hasError,
  runControl,
  onOpenHistory,
  historyActive,
  onOpenQuickOptions,
  quickOptionsShortcut,
  quickOptionsActive,
  transferActions,
}: TopBarProps) {
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [exposedOpen, setExposedOpen] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(project.title);

  React.useEffect(() => {
    if (!isRenaming) setTitleDraft(project.title);
  }, [project.title, isRenaming]);

  // Global ⌘R / Ctrl+R shortcut to rename project (13A annotation)
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        const target = event.target as HTMLElement | null;
        const isInput =
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (!isInput) {
          event.preventDefault();
          setIsRenaming(true);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const currentBranch = branches.find((b) => b.id === branchId) ?? null;
  const isMainBranch = branchId === project.mainBranchId;
  const branchLabel = currentBranch
    ? isMainBranch
      ? "main"
      : currentBranch.label
    : "";

  const [renamedNotice, setRenamedNotice] = React.useState<{
    from: string;
    to: string;
  } | null>(null);
  React.useEffect(() => {
    if (!renamedNotice) return;
    const timer = window.setTimeout(() => setRenamedNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [renamedNotice]);

  const normalizedDraft = titleDraft.trim().toLowerCase();
  const nameConflict =
    isRenaming && normalizedDraft.length > 0
      ? (otherProjects.find(
          (p) => p.title.trim().toLowerCase() === normalizedDraft,
        ) ?? null)
      : null;

  const cancelRename = () => {
    setTitleDraft(project.title);
    setIsRenaming(false);
  };

  const commitRename = async () => {
    const trimmed = titleDraft.trim();
    if (nameConflict) {
      cancelRename();
      return;
    }
    if (
      trimmed.length > 0 &&
      trimmed.length <= 80 &&
      trimmed !== project.title
    ) {
      const previous = project.title;
      const result = await onRenameProject(trimmed);
      if ((result as { status?: string } | null)?.status === "applied") {
        setRenamedNotice({ from: previous, to: trimmed });
      }
    } else {
      setTitleDraft(project.title);
    }
    setIsRenaming(false);
  };

  const undoRename = async () => {
    if (!renamedNotice) return;
    const { from } = renamedNotice;
    setRenamedNotice(null);
    await onRenameProject(from);
  };

  return (
    <header
      data-testid="workspace-topbar"
      className={cn(
        "relative shrink-0 flex items-center justify-between px-2 min-[400px]:px-3 sm:px-4 h-12 min-h-12",
        "border-b border-border bg-background select-none z-chrome w-full max-w-full overflow-hidden gap-1.5 sm:gap-2",
      )}
      role="banner"
    >
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 max-sm:min-w-min shrink">
        {/* Brand mark */}
        <button
          type="button"
          data-testid="brand"
          aria-label="All projects"
          title="All projects"
          onClick={onAllProjects}
          className="flex cursor-pointer items-center gap-2 rounded-control font-semibold text-[14px] text-foreground shrink-0 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:pointer-coarse:hidden"
        >
          <svg
            className="size-5 shrink-0"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id="brand-mark-gradient"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#0B5C54" />
                <stop offset="100%" stopColor="#2E7D6B" />
              </linearGradient>
            </defs>
            <rect
              width="20"
              height="20"
              rx="5"
              fill="url(#brand-mark-gradient)"
            />
          </svg>
          <span className="hidden sm:inline">System studio</span>
        </button>

        {/* Vertical divider from brand mark */}
        <div
          className="hidden sm:block w-px h-[22px] bg-border shrink-0 mx-0.5"
          aria-hidden="true"
        />

        {/* Breadcrumb chip: Project / branch [DRAFT|MAIN] (13A toggle sizing) */}
        <RenamedNotice
          open={renamedNotice !== null && !isRenaming}
          title={renamedNotice?.to ?? ""}
          onUndo={() => void undoRename()}
          onDismiss={() => setRenamedNotice(null)}
        >
          <div
            data-testid="breadcrumb-chip"
            className="flex items-center gap-0.5 sm:gap-1 min-w-0 max-sm:min-w-min h-7 pointer-coarse:h-12 shrink-0"
          >
            {isRenaming ? (
              <RenameConflictPopover
                open={nameConflict !== null}
                conflictTitle={nameConflict?.title ?? ""}
                currentTitle={project.title}
                onKeep={cancelRename}
                onOpenExisting={() => {
                  const target = nameConflict;
                  cancelRename();
                  if (target) onOpenProject?.(target.id);
                }}
              >
                <input
                  autoFocus
                  data-testid="project-title-input"
                  aria-label="Project title"
                  aria-invalid={nameConflict !== null || undefined}
                  className={cn(
                    "h-7 px-2.5 text-[13px] font-medium text-ink bg-background border rounded-[6px] outline-none focus:outline-none w-28 sm:w-44 truncate",
                    nameConflict
                      ? "border-risk-text shadow-[0_0_0_2px_rgba(176,72,40,0.15)]"
                      : "border-primary shadow-[0_0_0_2px_rgba(11,92,84,0.15)]",
                  )}
                  value={titleDraft}
                  maxLength={80}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (nameConflict) return;
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      cancelRename();
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={() => void commitRename()}
                />
              </RenameConflictPopover>
            ) : (
              <ProjectMenu
                projectTitle={project.title}
                branchCount={branches.length}
                team={projectDetails(project).team}
                onRenameProject={() => setIsRenaming(true)}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenExposedEndpoints={() => setExposedOpen(true)}
                onAllProjects={onAllProjects}
                onDeleteProject={onDeleteProject}
                transferActions={transferActions}
              >
                {(isOpen) => (
                  <button
                    type="button"
                    data-testid="breadcrumb-project-btn"
                    className={cn(
                      "group flex cursor-pointer items-center gap-1.5 h-7 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors min-w-[6ch] max-w-[120px] max-[400px]:max-w-[64px] max-[359px]:max-w-[48px] sm:max-w-[220px] shrink pointer-coarse:self-stretch pointer-coarse:min-w-11 pointer-coarse:min-h-11",
                      isOpen
                        ? "bg-accent border-selected-edge text-primary"
                        : "border-transparent text-ink hover:bg-[#F2EFE9] hover:border-[#E7E3DB]",
                    )}
                    title={project.title}
                  >
                    <span className="truncate">{project.title}</span>
                    {isOpen ? (
                      <ChevronUp
                        size={11}
                        className="text-primary shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronDown
                        size={11}
                        className="text-secondary-text shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                )}
              </ProjectMenu>
            )}

            {/* RV-05b review round 1: dropped below sm so a 390px top bar has room
                for the project name and the branch toggle without clipping. */}
            <span
              className="hidden sm:inline text-[#C0C6C1] text-[11px] select-none shrink-0"
              aria-hidden="true"
            >
              /
            </span>

            <BranchPopover
              project={project}
              branches={branches}
              currentBranchId={branchId}
              onSwitchBranch={onSwitchBranch}
              onCreateBranch={onCreateBranch}
              onReopenBranch={onReopenBranch}
              createDisabledReason={createBranchDisabledReason}
              isSaving={isSaving}
              onOpenHistory={onOpenHistory}
            >
              {(isOpen) => (
                <button
                  type="button"
                  data-testid="breadcrumb-branch-btn"
                  className={cn(
                    "group flex cursor-pointer items-center gap-1.5 h-7 px-2.5 rounded-[6px] border text-[13px] font-medium transition-colors min-w-0 shrink-0 pointer-coarse:self-stretch pointer-coarse:min-w-11 pointer-coarse:min-h-11",
                    isOpen
                      ? "bg-[#E9DFF8] border-[#C7B4EA] text-[#5B3E9B]"
                      : "border-transparent text-[#7C5FC0] hover:bg-[#F3EEFB] hover:border-[#E0D5F2]",
                  )}
                  title={branchLabel}
                >
                  <GitBranch
                    size={12}
                    className={cn(
                      "shrink-0",
                      isOpen ? "text-[#5B3E9B]" : "text-[#7C5FC0]",
                    )}
                  />
                  <span className="hidden sm:inline font-semibold truncate max-w-[110px] sm:max-w-[180px]">
                    {branchLabel}
                  </span>
                  <Badge
                    data-testid="breadcrumb-branch-state"
                    variant={isMainBranch ? "accent" : "risk"}
                    className="text-[9.5px] font-mono tracking-[0.1em] px-1.5 py-0 h-4 shrink-0 normal-case max-[400px]:px-0.5"
                  >
                    {isMainBranch ? "MAIN" : "DRAFT"}
                  </Badge>
                  {isOpen ? (
                    <ChevronUp
                      size={11}
                      className="text-[#5B3E9B] shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <ChevronDown
                      size={11}
                      className="text-secondary-text shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
              )}
            </BranchPopover>

            {isRenaming && (
              <div className="hidden sm:flex items-center gap-2 text-[10.5px] font-mono text-secondary-text select-none shrink-0 pl-2">
                <span>↵ save</span>
                <span>esc cancel</span>
              </div>
            )}
          </div>
        </RenamedNotice>

        {settingsOpen ? (
          <ProjectDetailsDialog
            open
            projectTitle={project.title}
            initial={projectDetails(project)}
            onSave={onUpdateProjectDetails}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}

        {exposedOpen ? (
          <ExposedEndpointsDialog
            open
            projectTitle={project.title}
            candidates={endpointCandidates}
            onToggle={onToggleEndpointExposed}
            onClose={() => setExposedOpen(false)}
        />
        ) : null}

        {/* Save Status */}
        <span
          data-testid="save-status"
          data-state={isSaving ? "saving" : "idle"}
          className="text-xs text-secondary-text hidden md:flex items-center gap-1.5 ml-1 shrink-0 whitespace-nowrap"
          role="status"
          aria-label={saveStatusText}
          title={saveStatusText}
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-block size-1.5 rounded-full shrink-0",
              isSaving
                ? "bg-primary animate-pulse"
                : hasError
                  ? "bg-risk"
                  : "bg-primary",
            )}
          />
          <span className="truncate max-w-[160px]">{saveStatusText}</span>
        </span>
      </div>

      {/* D38: Run + scenario switcher slot, owned by the runs lane */}
      <div
        data-slot="run-control"
        className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0 max-sm:shrink"
      >
        {onOpenQuickOptions && (
          <Button
            type="button"
            data-testid="topbar-quick-options-btn"
            variant={quickOptionsActive ? "tint" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs font-medium shrink-0 pointer-coarse:min-w-11"
            aria-label="Quick options"
            aria-keyshortcuts={quickOptionsShortcut}
            onClick={onOpenQuickOptions}
          >
            <CommandIcon className="size-3.5 sm:mr-1" aria-hidden="true" />
            <span className="hidden sm:inline">Quick options</span>
            {quickOptionsShortcut && (
              <Kbd className="hidden lg:inline-flex ml-1.5 h-4 text-[10px]">
                {quickOptionsShortcut}
              </Kbd>
            )}
          </Button>
        )}
        {onOpenHistory && (
          <Button
            type="button"
            data-testid="topbar-history-btn"
            variant={historyActive ? "tint" : "outline"}
            size="sm"
            // Below 390 px the bar can't hold every control at 320 px (WCAG 1.4.10), so
            // History steps back to Quick options, where it is always listed.
            className="h-7 px-2.5 text-xs font-medium shrink-0 pointer-coarse:min-w-11 max-[389px]:hidden"
            aria-label="History"
            onClick={onOpenHistory}
          >
            <HistoryIcon className="size-3.5 sm:mr-1" aria-hidden="true" />
            <span className="hidden sm:inline">History</span>
          </Button>
        )}
        {runControl ?? null}
      </div>
    </header>
  );
}

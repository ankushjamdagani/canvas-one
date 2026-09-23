import * as React from "react";
import {
  FolderOpen,
  ChevronDown,
  Check,
  Play,
  Pause,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  projectName: string;
  isReadOnly: boolean;
  projectNameInput: string;
  setProjectNameInput: (name: string) => void;
  onSaveProjectName: () => void;
  projectMenuOpen: boolean;
  onToggleProjectMenu: () => void;
  saved: string;
  simulationRunning: boolean;
  simulationFinished?: boolean;
  simulationTime?: number;
  simulationError?: string | null;
  onToggleSimulation: () => void;
  onResetSimulation: () => void;
  canRun: boolean;
  canReset: boolean;
}

export function TopBar({
  projectName,
  isReadOnly,
  projectNameInput,
  setProjectNameInput,
  onSaveProjectName,
  projectMenuOpen,
  onToggleProjectMenu,
  saved,
  simulationRunning,
  simulationFinished,
  simulationTime,
  onToggleSimulation,
  onResetSimulation,
  canRun,
  canReset,
}: TopBarProps) {
  return (
    <TooltipProvider delayDuration={250}>
      <header
        data-testid="topbar"
        className={cn(
          "canvas-first-topbar studio-header experiment-heading",
          "relative shrink-0 flex items-center justify-between px-4 h-[52px] min-h-[52px] pointer-events-auto [&_*]:pointer-events-auto",
          "border-b border-border bg-shell select-none z-chrome",
          "max-[560px]:h-auto max-[560px]:min-h-0 max-[560px]:flex-col max-[560px]:items-stretch max-[560px]:py-1 max-[560px]:px-2 max-[560px]:gap-1"
        )}
        role="banner"
      >
        <div className="canvas-first-topbar-row canvas-first-topbar-row-main flex items-center gap-2.5 min-w-0 max-[560px]:w-full max-[560px]:justify-between max-[560px]:gap-1">
          <div
            data-testid="brand"
            className="canvas-first-brand brand flex items-center gap-2 font-semibold text-[14.5px] tracking-[-0.01em] text-foreground shrink-0 select-none"
          >
            <div
              className="size-5 rounded-[5px] shrink-0"
              style={{ background: "linear-gradient(140deg, #0B5C54, #2E7D6B)" }}
              aria-hidden="true"
            />
            <span className="flex items-center">
              System studio<span className="brand-dot text-primary hidden">.</span>
            </span>
          </div>

          <Separator orientation="vertical" className="h-5 bg-border hidden sm:block shrink-0" />

          <div className="canvas-first-project-switcher-group flex items-center gap-1.5 min-w-0 shrink">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="project-switch-btn"
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "canvas-first-btn subtle project-switch workspace-switch project-menu-btn",
                    "h-7 pointer-coarse:h-11 px-2 text-xs font-medium text-foreground hover:bg-accent flex items-center gap-1.5 shrink min-w-0 max-w-[120px] sm:max-w-none rounded-control",
                    "max-[560px]:max-w-[110px] max-[560px]:px-1.5 max-[560px]:text-[11px]",
                    projectMenuOpen && "active bg-accent font-semibold"
                  )}
                  onClick={onToggleProjectMenu}
                  aria-expanded={projectMenuOpen}
                  aria-label={projectName}
                >
                  <FolderOpen size={14} className="text-secondary-text shrink-0" />
                  <span className="project-switch-name font-medium truncate">{projectName}</span>
                  <ChevronDown
                    size={12}
                    className={cn(
                      "project-switch-chevron transition-transform duration-150 text-secondary-text shrink-0",
                      projectMenuOpen && "open rotate-180"
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Switch or manage projects: {projectName}</TooltipContent>
            </Tooltip>

            <Input
              data-testid="project-name-input"
              aria-label="Project name"
              className="canvas-first-project-name-input pointer-fine:!h-7 pointer-coarse:h-11 px-2 text-xs w-20 min-w-0 sm:w-36 md:w-44 border-transparent hover:border-input focus:border-ring bg-transparent hover:bg-background focus:bg-background transition-colors shrink"
              value={projectNameInput}
              onChange={(e) => setProjectNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                  onSaveProjectName();
                }
              }}
              onBlur={onSaveProjectName}
              disabled={isReadOnly}
              maxLength={80}
              placeholder="Project name"
              title="Click to rename project"
            />
            {projectNameInput.trim() !== projectName &&
              projectNameInput.trim().length > 0 && (
                <Button
                  data-testid="project-save-btn"
                  type="button"
                  variant="default"
                  size="sm"
                  className="canvas-first-btn canvas-first-project-save-btn h-7 pointer-coarse:h-11 px-2 text-xs flex items-center gap-1 shrink-0"
                  onClick={onSaveProjectName}
                  aria-label="Save project name"
                  disabled={isReadOnly || !projectNameInput.trim()}
                >
                  <Check size={12} />
                  <span>Save</span>
                </Button>
              )}
          </div>

          <span
            data-testid="save-status"
            className="save-status text-xs text-secondary-text flex items-center gap-1.5 ml-1 shrink-0 whitespace-nowrap max-[560px]:text-[10.5px] max-[560px]:ml-0"
            role="status"
          >
            <span
              className={cn(
                "save-dot inline-block size-1.5 rounded-full bg-primary",
                saved === "Save failed" && "failed bg-destructive"
              )}
            />
            {saved}
          </span>
        </div>

        <div className="canvas-first-topbar-row canvas-first-topbar-row-tools flex items-center gap-2 shrink-0 max-[560px]:self-start max-[560px]:gap-1.5 max-[560px]:overflow-x-auto max-[560px]:scrollbar-none">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="run-button"
                variant="default"
                size="sm"
                className="canvas-first-btn primary h-7 pointer-coarse:h-11 px-3 text-xs font-semibold flex items-center gap-1.5 shrink-0 max-[560px]:px-2 max-[560px]:text-[11px] max-[560px]:gap-1"
                disabled={!canRun}
                onClick={onToggleSimulation}
              >
                {simulationRunning ? (
                  <Pause size={13} />
                ) : (
                  <Play size={13} fill="currentColor" />
                )}
                <span>
                  {simulationRunning
                    ? "Pause"
                    : simulationFinished
                      ? "Replay"
                      : simulationTime
                        ? "Resume"
                        : "Run"}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {simulationRunning ? "Pause simulation" : "Run simulation"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="reset-button"
                variant="secondary"
                size="sm"
                onClick={onResetSimulation}
                disabled={!canReset}
                className="canvas-first-btn reset-button h-7 pointer-coarse:h-11 px-2.5 text-xs flex items-center gap-1 text-secondary-text hover:text-foreground shrink-0 max-[560px]:px-2 max-[560px]:text-[11px]"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Reset simulation clock</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}

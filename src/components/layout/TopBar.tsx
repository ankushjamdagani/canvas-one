import * as React from "react";
import {
  Workflow,
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
          "flex flex-wrap items-center justify-between px-3 py-1.5 border-b border-border bg-background/95 backdrop-blur-md z-30 select-none"
        )}
        role="banner"
      >
        <div className="canvas-first-topbar-row canvas-first-topbar-row-main flex items-center gap-2">
          <div
            data-testid="brand"
            className="canvas-first-brand brand flex items-center gap-1.5 font-bold text-sm tracking-tight text-foreground"
          >
            <Workflow size={18} className="text-teal-600 dark:text-teal-400" />
            <span>
              System studio<span className="brand-dot text-teal-600 dark:text-teal-400">.</span>
            </span>
          </div>

          <Separator orientation="vertical" className="h-4 mx-1 bg-border hidden sm:block" />

          <div className="canvas-first-project-switcher-group flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="project-switch-btn"
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "canvas-first-btn subtle project-switch workspace-switch project-menu-btn h-7 px-2 text-xs font-medium text-foreground hover:bg-accent flex items-center gap-1.5",
                    projectMenuOpen && "active bg-accent font-semibold"
                  )}
                  onClick={onToggleProjectMenu}
                  aria-expanded={projectMenuOpen}
                  aria-label={projectName}
                >
                  <FolderOpen size={14} className="text-muted-foreground" />
                  <span className="project-switch-name font-medium">{projectName}</span>
                  <ChevronDown
                    size={12}
                    className={cn(
                      "project-switch-chevron transition-transform duration-150 text-muted-foreground",
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
              className="canvas-first-project-name-input h-7 px-2 text-xs w-36 sm:w-44 border-transparent hover:border-input focus:border-ring transition-colors"
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
                  size="sm"
                  className="canvas-first-btn canvas-first-project-save-btn h-7 px-2 text-xs bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1"
                  onClick={onSaveProjectName}
                  aria-label="Save project name"
                  disabled={isReadOnly || !projectNameInput.trim()}
                >
                  <Check size={12} />
                  <span>Save</span>
                </Button>
              )}
          </div>

          <span data-testid="save-status" className="save-status text-[11px] text-muted-foreground flex items-center gap-1 ml-1" role="status">
            <span
              className={cn(
                "save-dot inline-block w-1.5 h-1.5 rounded-full bg-emerald-500",
                saved === "Save failed" && "failed bg-rose-500"
              )}
            />
            {saved}
          </span>
        </div>

        <div className="canvas-first-topbar-row canvas-first-topbar-row-tools flex items-center gap-1.5 mt-1 sm:mt-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="run-button"
                size="sm"
                className={cn(
                  "canvas-first-btn primary h-7 px-2.5 text-xs font-semibold flex items-center gap-1.5",
                  simulationRunning
                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                    : "bg-teal-600 hover:bg-teal-700 text-white"
                )}
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
                variant="outline"
                size="sm"
                onClick={onResetSimulation}
                disabled={!canReset}
                className="canvas-first-btn reset-button h-7 px-2 text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground"
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

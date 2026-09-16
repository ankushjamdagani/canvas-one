import * as React from "react";
import {
  Plus,
  SlidersHorizontal,
  GitBranch,
  BarChart3,
  Download,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface ActivityRailProps {
  leftDrawerMode: "components" | "revisions" | null;
  onToggleComponents: () => void;
  inspectorMode: "workloads" | "tutorial" | null;
  onToggleWorkloads: () => void;
  onToggleRevisions: () => void;
  resultsOpen: boolean;
  onToggleResults: () => void;
  onOpenExport: () => void;
  hasGuide: boolean;
  onToggleGuide: () => void;
}

export function ActivityRail({
  leftDrawerMode,
  onToggleComponents,
  inspectorMode,
  onToggleWorkloads,
  onToggleRevisions,
  resultsOpen,
  onToggleResults,
  onOpenExport,
  hasGuide,
  onToggleGuide,
}: ActivityRailProps) {
  return (
    <TooltipProvider delayDuration={250}>
      <aside
        data-testid="activity-rail"
        className={cn(
          "canvas-first-left-rail",
          "flex flex-col justify-between items-center py-2.5 px-1 border-r border-border bg-background/95 backdrop-blur-md select-none z-20"
        )}
        role="toolbar"
        aria-label="Workspace controls"
      >
        <div className="canvas-first-rail-group flex flex-col items-center gap-1.5 w-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="rail-add-component-btn"
                type="button"
                variant="ghost"
                className={cn(
                  "canvas-first-rail-btn flex flex-col items-center justify-center w-11 h-12 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                  leftDrawerMode === "components" && "active bg-teal-500/15 text-teal-700 dark:text-teal-300 font-semibold border border-teal-500/30"
                )}
                onClick={onToggleComponents}
                aria-expanded={leftDrawerMode === "components"}
                aria-label="Add component"
              >
                <Plus size={18} />
                <span className="canvas-first-rail-label text-[10px] mt-0.5 leading-none">Add</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Add component (Components catalog)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="rail-workloads-btn"
                type="button"
                variant="ghost"
                className={cn(
                  "canvas-first-rail-btn flex flex-col items-center justify-center w-11 h-12 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                  inspectorMode === "workloads" && "active bg-teal-500/15 text-teal-700 dark:text-teal-300 font-semibold border border-teal-500/30"
                )}
                onClick={onToggleWorkloads}
                aria-expanded={inspectorMode === "workloads"}
                aria-label="Workloads"
              >
                <SlidersHorizontal size={18} />
                <span className="canvas-first-rail-label text-[10px] mt-0.5 leading-none">Workloads</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Workloads configuration</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="rail-revisions-btn"
                type="button"
                variant="ghost"
                className={cn(
                  "canvas-first-rail-btn flex flex-col items-center justify-center w-11 h-12 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                  leftDrawerMode === "revisions" && "active bg-teal-500/15 text-teal-700 dark:text-teal-300 font-semibold border border-teal-500/30"
                )}
                onClick={onToggleRevisions}
                aria-expanded={leftDrawerMode === "revisions"}
                aria-label="Architecture Revisions"
              >
                <GitBranch size={18} />
                <span className="canvas-first-rail-label text-[10px] mt-0.5 leading-none">Revisions</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Revisions & Checkpoints</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="rail-runs-btn"
                type="button"
                variant="ghost"
                className={cn(
                  "canvas-first-rail-btn flex flex-col items-center justify-center w-11 h-12 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                  resultsOpen && "active bg-teal-500/15 text-teal-700 dark:text-teal-300 font-semibold border border-teal-500/30"
                )}
                onClick={onToggleResults}
                aria-expanded={resultsOpen}
                aria-label="Saved runs"
              >
                <BarChart3 size={18} />
                <span className="canvas-first-rail-label text-[10px] mt-0.5 leading-none">Runs</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Saved runs & comparisons</TooltipContent>
          </Tooltip>
        </div>

        <div className="canvas-first-rail-bottom flex flex-col items-center gap-1.5 w-full">
          <Separator className="my-1.5 w-8 bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-testid="rail-export-btn"
                type="button"
                variant="ghost"
                className="canvas-first-rail-btn flex flex-col items-center justify-center w-11 h-12 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={onOpenExport}
                aria-label="Export options"
              >
                <Download size={18} />
                <span className="canvas-first-rail-label text-[10px] mt-0.5 leading-none">Export</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Export canvas or JSON</TooltipContent>
          </Tooltip>

          {hasGuide && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="rail-guide-btn"
                  type="button"
                  variant="ghost"
                  className={cn(
                    "canvas-first-rail-btn flex flex-col items-center justify-center w-11 h-12 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                    inspectorMode === "tutorial" && "active bg-teal-500/15 text-teal-700 dark:text-teal-300 font-semibold border border-teal-500/30"
                  )}
                  aria-label="Show experiment guide"
                  onClick={onToggleGuide}
                >
                  <Info size={16} />
                  <span className="canvas-first-rail-label text-[10px] mt-0.5 leading-none">Guide</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Experiment guide</TooltipContent>
            </Tooltip>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

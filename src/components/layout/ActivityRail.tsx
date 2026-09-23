import * as React from "react";
import {
  Plus,
  SlidersHorizontal,
  GitBranch,
  BarChart3,
  Download,
  Info,
} from "lucide-react";
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

interface RailItemProps {
  glyph: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  "data-testid": string;
  "aria-label": string;
  tooltip: string;
}

function RailItem({
  glyph,
  label,
  active = false,
  disabled = false,
  onClick,
  "data-testid": testId,
  "aria-label": ariaLabel,
  tooltip,
}: RailItemProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-slot="button"
          data-testid={testId}
          aria-label={ariaLabel}
          aria-pressed={active}
          aria-expanded={active}
          disabled={disabled}
          onClick={disabled ? undefined : onClick}
          className={cn(
            "canvas-first-rail-btn relative flex flex-col items-center justify-center cursor-pointer select-none transition-colors",
            "w-11 h-11 min-h-11 max-[560px]:w-auto max-[560px]:px-2.5 max-[560px]:h-11 max-[560px]:min-h-11",
            "rounded-control font-sans",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            active
              ? "active bg-accent text-primary font-semibold"
              : "text-secondary-text hover:text-foreground hover:bg-sunken",
            disabled && "opacity-40 cursor-not-allowed pointer-events-none"
          )}
        >
          {active && (
            <span
              className={cn(
                "absolute bg-primary rounded-xs pointer-events-none",
                "left-0 top-2.5 bottom-2.5 w-0.5",
                "max-[560px]:left-2 max-[560px]:right-2 max-[560px]:top-auto max-[560px]:bottom-0 max-[560px]:w-auto max-[560px]:h-0.5"
              )}
              aria-hidden="true"
            />
          )}
          <span className="size-4 shrink-0 flex items-center justify-center [&>svg]:size-4">
            {glyph}
          </span>
          <span
            className={cn(
              "canvas-first-rail-label font-mono text-[9.5px] leading-none uppercase tracking-wide mt-1 shrink-0",
              active ? "text-primary font-semibold" : "text-secondary-text"
            )}
          >
            {label}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
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
          "flex flex-col justify-between items-center py-2 px-0",
          "w-11 min-w-[44px] max-w-[44px] h-full",
          "border-r border-border bg-shell select-none z-chrome",
          "max-[560px]:w-full max-[560px]:max-w-none max-[560px]:min-w-0 max-[560px]:h-auto max-[560px]:min-h-[48px]",
          "max-[560px]:flex-row max-[560px]:justify-between max-[560px]:px-2 max-[560px]:py-0.5",
          "max-[560px]:border-r-0 max-[560px]:border-b max-[560px]:overflow-x-auto"
        )}
        role="toolbar"
        aria-label="Workspace controls"
      >
        <div className="canvas-first-rail-group flex flex-col items-center gap-1 w-full max-[560px]:flex-row max-[560px]:w-auto max-[560px]:gap-1">
          <RailItem
            data-testid="rail-add-component-btn"
            aria-label="Add component"
            glyph={<Plus size={16} />}
            label="Add"
            active={leftDrawerMode === "components"}
            onClick={onToggleComponents}
            tooltip="Add component (Components catalog)"
          />

          <RailItem
            data-testid="rail-workloads-btn"
            aria-label="Workloads"
            glyph={<SlidersHorizontal size={16} />}
            label="Workloads"
            active={inspectorMode === "workloads"}
            onClick={onToggleWorkloads}
            tooltip="Workloads configuration"
          />

          <RailItem
            data-testid="rail-revisions-btn"
            aria-label="Architecture Revisions"
            glyph={<GitBranch size={16} />}
            label="Revisions"
            active={leftDrawerMode === "revisions"}
            onClick={onToggleRevisions}
            tooltip="Revisions & Checkpoints"
          />

          <RailItem
            data-testid="rail-runs-btn"
            aria-label="Saved runs"
            glyph={<BarChart3 size={16} />}
            label="Runs"
            active={resultsOpen}
            onClick={onToggleResults}
            tooltip="Saved runs & comparisons"
          />
        </div>

        <div className="canvas-first-rail-bottom flex flex-col items-center gap-1 w-full max-[560px]:flex-row max-[560px]:w-auto max-[560px]:gap-1">
          <Separator className="my-1.5 w-6 bg-border max-[560px]:hidden" />
          <Separator orientation="vertical" className="h-6 mx-1 bg-border hidden max-[560px]:block" />

          <RailItem
            data-testid="rail-export-btn"
            aria-label="Export options"
            glyph={<Download size={16} />}
            label="Export"
            active={false}
            onClick={onOpenExport}
            tooltip="Export canvas or JSON"
          />

          {hasGuide && (
            <RailItem
              data-testid="rail-guide-btn"
              aria-label="Show experiment guide"
              glyph={<Info size={16} />}
              label="Guide"
              active={inspectorMode === "tutorial"}
              onClick={onToggleGuide}
              tooltip="Experiment guide"
            />
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

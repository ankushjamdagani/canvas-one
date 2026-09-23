import * as React from "react";
import { BookmarkPlus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface ResultsStripProps {
  simulationTime: number;
  simulationRunning: boolean;
  simulationFinished?: boolean;
  simulationError?: string | null;
  incomplete?: boolean | string;
  duration: number;
  throughput?: number;
  p95Latency?: number | null;
  failures: number;
  nodeCount: number;
  workloadCount: number;
  errors: string[];
  ready: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
  savedRunsCount: number;
  onOpenSavedRuns: () => void;
  canSaveResult: boolean;
  resultSaved: boolean;
  onSaveResultClick: () => void;
  onOpenExport: () => void;
}

/** Text label + badge tone for the current run state. Color is always paired with this text. */
function runStateLabel(
  simulationError: string | null | undefined,
  incomplete: boolean | string | undefined,
  simulationRunning: boolean,
  simulationFinished: boolean | undefined,
): { text: string; variant: "risk" | "success" | "neutral" | "accent" } {
  if (simulationError) return { text: "Simulation stopped", variant: "risk" };
  if (incomplete) return { text: "Resource boundary", variant: "risk" };
  if (simulationRunning) return { text: "Running", variant: "accent" };
  if (simulationFinished) return { text: "Completed", variant: "success" };
  return { text: "Paused", variant: "neutral" };
}

export function ResultsStrip({
  simulationTime,
  simulationRunning,
  simulationFinished,
  simulationError,
  incomplete,
  duration,
  throughput,
  p95Latency,
  failures,
  nodeCount,
  workloadCount,
  errors,
  ready,
  showDetails,
  onToggleDetails,
  savedRunsCount,
  onOpenSavedRuns,
  canSaveResult,
  resultSaved,
  onSaveResultClick,
  onOpenExport,
}: ResultsStripProps) {
  const state = runStateLabel(simulationError, incomplete, simulationRunning, simulationFinished);

  return (
    <div
      data-testid="results-strip"
      className="flex flex-col md:flex-row md:items-center md:justify-between min-h-9 px-4 py-1.5 md:py-1 bg-background/95 backdrop-blur-md border-t border-border text-xs gap-2 md:gap-3 shrink-0 shadow-xs z-20 select-none"
      role="region"
      aria-label="Simulation status and results"
    >
      <div className="w-full md:w-auto flex items-center gap-3 overflow-x-auto whitespace-nowrap md:flex-1 scrollbar-none">
        {simulationTime > 0 ? (
          <>
            <Badge
              variant={state.variant}
              className="gap-1.5 normal-case tracking-normal font-sans text-xs"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "w-1.5 h-1.5 rounded-full inline-block shrink-0",
                  simulationRunning
                    ? "bg-primary animate-pulse motion-reduce:animate-none"
                    : simulationFinished && !simulationError && !incomplete
                      ? "bg-primary"
                      : simulationError || incomplete
                        ? "bg-risk-text"
                        : "bg-secondary-text",
                )}
              />
              {state.text}
            </Badge>
            <Separator orientation="vertical" className="h-4" />
            <span className="inline-flex items-baseline gap-1.5 text-secondary-text">
              <span>Elapsed</span>
              <strong className="font-mono text-foreground tabular-nums">{simulationTime.toFixed(1)}</strong>
              <span className="text-secondary-text/80">s / {duration}s</span>
            </span>
            <span className="inline-flex items-baseline gap-1.5 text-secondary-text">
              <span>Throughput</span>
              <strong data-testid="throughput" className="font-mono text-foreground tabular-nums">
                {throughput !== undefined ? throughput.toFixed(1) : "0"}
              </strong>
              <span className="text-secondary-text/80">req/s</span>
            </span>
            <span className="inline-flex items-baseline gap-1.5 text-secondary-text">
              <span>p95</span>
              <strong data-testid="p95" className="font-mono text-foreground tabular-nums">
                {p95Latency !== undefined && p95Latency !== null ? p95Latency.toFixed(1) : "—"}
              </strong>
              {p95Latency !== undefined && p95Latency !== null && (
                <span className="text-secondary-text/80">ms</span>
              )}
            </span>
            <span
              className={cn(
                "inline-flex items-baseline gap-1.5",
                failures > 0 ? "text-risk-text" : "text-secondary-text",
              )}
            >
              <span>Failures</span>
              <strong
                data-testid="failures"
                className={cn("font-mono tabular-nums", failures > 0 ? "text-risk-text font-bold" : "text-foreground")}
              >
                {failures}
              </strong>
            </span>
          </>
        ) : (
          <div className="flex items-center">
            {nodeCount === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-secondary-text">
                <span className="w-1.5 h-1.5 rounded-full bg-secondary-text/50 shrink-0" />
                <span>Empty canvas · Add components or load an example to begin</span>
              </span>
            ) : errors.length > 0 ? (
              <span
                className="inline-flex items-center gap-1.5 text-risk-text font-medium cursor-help"
                title={errors.join("\n")}
              >
                <TriangleAlert size={14} className="shrink-0" />
                <strong>
                  {errors.length} draft error{errors.length > 1 ? "s" : ""}
                </strong>
                <span className="text-xs ml-1 opacity-80">({errors[0]})</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-secondary-text">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    ready ? "bg-primary" : "bg-secondary-text/50",
                  )}
                />
                <span>
                  Ready to simulate · {nodeCount} components, {workloadCount} workloads
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="w-full md:w-auto flex items-center flex-wrap md:flex-nowrap gap-1.5 shrink-0">
        {simulationTime > 0 && (
          <>
            <Button
              data-testid="details-btn"
              variant={showDetails ? "tint" : "ghost"}
              size="sm"
              className="text-xs"
              aria-expanded={showDetails}
              onClick={onToggleDetails}
            >
              {showDetails ? "Hide details" : "Details"}
            </Button>
            <Button
              data-testid="compare-btn"
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={onOpenSavedRuns}
            >
              Compare ({savedRunsCount})
            </Button>
            {canSaveResult && (
              <Button
                data-testid="save-result-btn"
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                disabled={resultSaved}
                onClick={onSaveResultClick}
              >
                <BookmarkPlus size={14} />
                {resultSaved ? "Result saved" : "Save result"}
              </Button>
            )}
          </>
        )}
        <Button
          data-testid="export-canvas-btn"
          variant="ghost"
          size="sm"
          className="text-xs text-secondary-text hover:text-foreground"
          onClick={onOpenExport}
        >
          Export canvas
        </Button>
      </div>
    </div>
  );
}

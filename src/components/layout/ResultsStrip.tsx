import * as React from "react";
import { BookmarkPlus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  return (
    <div
      data-testid="results-strip"
      className="canvas-first-strip flex items-center justify-between h-9 min-h-[36px] px-4 bg-background/95 backdrop-blur-md border-t border-border text-xs gap-3 shrink-0 shadow-xs z-20 select-none"
      role="region"
      aria-label="Simulation status and results"
    >
      <div className="canvas-first-strip-info flex items-center gap-4 overflow-x-auto whitespace-nowrap flex-1">
        {simulationTime > 0 ? (
          <>
            <span className="canvas-first-strip-stat inline-flex items-center gap-1.5 text-xs text-foreground">
              <span
                className={cn(
                  "canvas-first-strip-dot w-2 h-2 rounded-full inline-block shrink-0",
                  simulationRunning
                    ? "running bg-teal-500 animate-pulse"
                    : simulationFinished
                      ? "finished bg-teal-600 dark:text-teal-400"
                      : "stopped bg-amber-500"
                )}
              />
              <strong>
                {simulationError
                  ? "Simulation stopped"
                  : incomplete
                    ? "Resource boundary"
                    : simulationRunning
                      ? "Running"
                      : simulationFinished
                        ? "Completed"
                        : "Paused"}
              </strong>
            </span>
            <span className="canvas-first-strip-stat inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Time:</span>
              <strong className="text-foreground tabular-nums">{simulationTime.toFixed(1)}s</strong>
              <span className="text-muted-foreground/70">/ {duration}s</span>
            </span>
            <span className="canvas-first-strip-stat inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Throughput:</span>
              <strong data-testid="throughput" className="text-foreground tabular-nums">
                {throughput !== undefined ? `${throughput.toFixed(1)} req/s` : "0 req/s"}
              </strong>
            </span>
            <span className="canvas-first-strip-stat inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>p95:</span>
              <strong data-testid="p95" className="text-foreground tabular-nums">
                {p95Latency !== undefined && p95Latency !== null
                  ? `${p95Latency.toFixed(1)}ms`
                  : "—"}
              </strong>
            </span>
            <span
              className={cn(
                "canvas-first-strip-stat inline-flex items-center gap-1.5 text-xs text-muted-foreground",
                failures > 0 ? "danger text-destructive" : ""
              )}
            >
              <span>Failures:</span>
              <strong data-testid="failures" className={cn("tabular-nums", failures > 0 ? "text-destructive font-bold" : "text-foreground")}>
                {failures}
              </strong>
            </span>
            {incomplete && (
              <span className="canvas-first-strip-stat incomplete inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
                <strong>Incomplete run</strong>
              </span>
            )}
          </>
        ) : (
          <div className="canvas-first-readiness flex items-center">
            {nodeCount === 0 ? (
              <span className="canvas-first-strip-stat muted inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="canvas-first-strip-dot idle w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
                <span>
                  Empty canvas · Add components or load an example to begin
                </span>
              </span>
            ) : errors.length > 0 ? (
              <span
                className="canvas-first-strip-stat danger inline-flex items-center gap-1.5 text-xs text-destructive font-medium cursor-help"
                title={errors.join("\n")}
              >
                <TriangleAlert size={14} className="shrink-0" />
                <strong>
                  {errors.length} draft error{errors.length > 1 ? "s" : ""}
                </strong>
                <span className="text-[11px] ml-1 opacity-80">
                  ({errors[0]})
                </span>
              </span>
            ) : (
              <span className="canvas-first-strip-stat muted inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "canvas-first-strip-dot w-2 h-2 rounded-full shrink-0",
                    ready ? "ready bg-teal-600" : "idle bg-muted-foreground/40"
                  )}
                />
                <span>
                  Ready to simulate · {nodeCount} components, {workloadCount}{" "}
                  workloads
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="canvas-first-strip-actions flex items-center gap-1.5 shrink-0">
        {simulationTime > 0 && (
          <>
            <Button
              data-testid="details-btn"
              variant={showDetails ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "canvas-first-btn subtle h-7 px-2.5 text-xs",
                showDetails && "active bg-accent font-semibold"
              )}
              onClick={onToggleDetails}
            >
              {showDetails ? "Hide details" : "Details"}
            </Button>
            <Button
              data-testid="compare-btn"
              variant="ghost"
              size="sm"
              className="canvas-first-btn subtle h-7 px-2.5 text-xs"
              onClick={onOpenSavedRuns}
            >
              Compare ({savedRunsCount})
            </Button>
            {canSaveResult && (
              <Button
                data-testid="save-result-btn"
                variant="outline"
                size="sm"
                className="canvas-first-btn h-7 px-2.5 text-xs gap-1.5"
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
          className="canvas-first-btn subtle h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onOpenExport}
        >
          Export canvas
        </Button>
      </div>
    </div>
  );
}

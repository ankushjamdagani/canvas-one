import * as React from "react";
import { BookmarkPlus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      className="canvas-first-strip"
      role="region"
      aria-label="Simulation status and results"
    >
      <div className="canvas-first-strip-info">
        {simulationTime > 0 ? (
          <>
            <span className="canvas-first-strip-stat">
              <span
                className={`canvas-first-strip-dot ${
                  simulationRunning
                    ? "running"
                    : simulationFinished
                      ? "finished"
                      : "stopped"
                }`}
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
            <span className="canvas-first-strip-stat">
              <span>Time:</span>
              <strong>{simulationTime.toFixed(1)}s</strong>
              <span className="muted">/ {duration}s</span>
            </span>
            <span className="canvas-first-strip-stat">
              <span>Throughput:</span>
              <strong data-testid="throughput">
                {throughput !== undefined ? `${throughput.toFixed(1)} req/s` : "0 req/s"}
              </strong>
            </span>
            <span className="canvas-first-strip-stat">
              <span>p95:</span>
              <strong data-testid="p95">
                {p95Latency !== undefined && p95Latency !== null
                  ? `${p95Latency.toFixed(1)}ms`
                  : "—"}
              </strong>
            </span>
            <span
              className={`canvas-first-strip-stat ${
                failures > 0 ? "danger" : ""
              }`}
            >
              <span>Failures:</span>
              <strong data-testid="failures">{failures}</strong>
            </span>
            {incomplete && (
              <span className="canvas-first-strip-stat incomplete">
                <strong>Incomplete run</strong>
              </span>
            )}
          </>
        ) : (
          <div className="canvas-first-readiness">
            {nodeCount === 0 ? (
              <span className="canvas-first-strip-stat muted">
                <span className="canvas-first-strip-dot idle" />
                <span>
                  Empty canvas · Add components or load an example to begin
                </span>
              </span>
            ) : errors.length > 0 ? (
              <span
                className="canvas-first-strip-stat danger"
                title={errors.join("\n")}
                style={{ cursor: "help" }}
              >
                <TriangleAlert size={14} />
                <strong>
                  {errors.length} draft error{errors.length > 1 ? "s" : ""}
                </strong>
                <span
                  className="muted"
                  style={{ fontSize: "11px", marginLeft: "4px" }}
                >
                  ({errors[0]})
                </span>
              </span>
            ) : (
              <span className="canvas-first-strip-stat muted">
                <span
                  className={`canvas-first-strip-dot ${ready ? "ready" : "idle"}`}
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

      <div className="canvas-first-strip-actions">
        {simulationTime > 0 && (
          <>
            <Button
              data-testid="details-btn"
              variant={showDetails ? "secondary" : "ghost"}
              size="sm"
              className={`canvas-first-btn subtle h-7 px-2 text-xs ${showDetails ? "active" : ""}`}
              onClick={onToggleDetails}
            >
              {showDetails ? "Hide details" : "Details"}
            </Button>
            <Button
              data-testid="compare-btn"
              variant="ghost"
              size="sm"
              className="canvas-first-btn subtle h-7 px-2 text-xs"
              onClick={onOpenSavedRuns}
            >
              Compare ({savedRunsCount})
            </Button>
            {canSaveResult && (
              <Button
                data-testid="save-result-btn"
                variant="outline"
                size="sm"
                className="canvas-first-btn h-7 px-2 text-xs gap-1.5"
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
          className="canvas-first-btn subtle h-7 px-2 text-xs"
          onClick={onOpenExport}
        >
          Export canvas
        </Button>
      </div>
    </div>
  );
}

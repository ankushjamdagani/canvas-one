/**
 * Results region bottom strip and expandable inspection drawer (RV-12c4).
 *
 * Implements specs/revamp/contracts/model-and-runner.md §8 & §9,
 * and matches screens:
 * - specs/revamp/screens/7A_branching_history.png (compact resting footer strip)
 * - specs/revamp/screens/21B_running_simulation_expanded.png (expanded General + event log)
 * - specs/revamp/screens/21D_running_expanded_component_first.png (expanded Components)
 *
 * Design constraints (design-revalidation.md §2):
 * - Excludes Stop run, p99, bottleneck/pressure/headroom labels, "vs run" deltas,
 *   predictions, Save result button.
 * - Shows measured values only; unavailable telemetry displays "Unavailable" + reason.
 * - Progress rule for timed runs from modeled time vs horizon.
 * - Accessible: aria-live region on status badge, labels, responsive 1512x982 and 390x844.
 */

import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Id } from '../../domain/studio/model';
import type {
  CheckResult,
  TraceEvent,
} from '../../domain/studio/runner/types';
import { Separator } from '../../components/ui/separator';
import type { RunPhase, SaveStatus, TerminalResult } from './RunController';
import {
  calculateProgressPercent,
  formatChecksSummary,
  formatElapsed,
  formatMetricDisplay,
  formatRootCountsSummary,
  formatStatusBadge,
} from './view-models';

// ============================================================================
// Props
// ============================================================================

export interface ResultsRegionProps {
  readonly scenarioName?: string | null;
  /** Required: the caller always knows the scenario's mode; never defaulted. */
  readonly scenarioMode: 'logical' | 'timed';
  readonly runId?: string | null;
  readonly runPhase: RunPhase;
  readonly terminal: TerminalResult | null;
  readonly events?: readonly TraceEvent[];
  readonly saveStatus?: SaveStatus;
  readonly onRetrySave?: () => void;
  readonly timedHorizonMs?: number | null;
  readonly currentTimeMs?: number | null;
  readonly isExpanded?: boolean;
  readonly onToggleExpanded?: () => void;
  /** Required: every element referenced by a metric or event must resolve to a label. Raw ids are never shown. */
  readonly elementLabels: Record<Id, string>;
  /**
   * RV-12d review round 1: every check's assertion label, looked up by the
   * caller from the scenario that ran (assertionId -> Assertion.label).
   * Required alongside elementLabels for the same reason: a check's raw
   * assertionId is never shown, only "Unlabelled check" when a label is
   * missing (e.g. the assertion was deleted after the run that references it).
   */
  readonly assertionLabels: Record<Id, string>;
  readonly measured?: boolean;
  /**
   * RV-12d: true when the session's working snapshot has moved on since this run
   * started (e.g. a canvas layout edit after the run completed). Shown as "Ran on
   * an earlier version" next to the status; the caller decides staleness (view
   * layout edits are presentation-only per run-identity.md and don't change the
   * scenario fingerprint, but the run was still against an earlier snapshot).
   */
  readonly staleRun?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function ResultsRegion({
  scenarioName,
  scenarioMode,
  runId,
  runPhase,
  terminal,
  events = [],
  saveStatus = 'unsaved',
  onRetrySave,
  timedHorizonMs,
  currentTimeMs,
  isExpanded: controlledExpanded,
  onToggleExpanded,
  elementLabels,
  assertionLabels,
  measured: controlledMeasured,
  staleRun = false,
}: ResultsRegionProps) {
  const [internalExpanded, setInternalExpanded] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'general' | 'components'>('general');

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const toggleExpanded = () => {
    if (onToggleExpanded) {
      onToggleExpanded();
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

  const isMeasured =
    controlledMeasured !== undefined
      ? controlledMeasured
      : (terminal?.measured ?? false);

  const mode = scenarioMode;
  const statusBadge = formatStatusBadge(runPhase, terminal?.status, scenarioName, runId);
  const checksSummary = isMeasured ? formatChecksSummary(terminal?.checks) : '—';
  const elapsedText =
    terminal
      ? isMeasured
        ? formatElapsed(mode, terminal.summary?.elapsedMs ?? null, currentTimeMs, timedHorizonMs)
        : '—'
      : mode === 'logical'
        ? 'logical'
        : currentTimeMs != null
          ? formatElapsed(mode, null, currentTimeMs, timedHorizonMs)
          : '—';

  const progressPercent =
    mode === 'timed'
      ? calculateProgressPercent(
          currentTimeMs ?? (isMeasured ? terminal?.summary?.elapsedMs : null),
          timedHorizonMs,
        )
      : 0;

  const rootCountsInfo = isMeasured
    ? formatRootCountsSummary(terminal?.summary?.rootCounts)
    : { rootsLabel: '—', failuresCount: '—' };
  const messageCounts = isMeasured ? terminal?.summary?.messageCounts : null;
  const elementMetrics = isMeasured ? (terminal?.summary?.elementMetrics ?? []) : [];
  const generalMetrics = elementMetrics.filter((m) => m.elementId === null);
  const componentMetrics = elementMetrics.filter((m) => m.elementId !== null);

  return (
    <footer
      data-testid="results-region"
      className="relative flex flex-col border-t border-divider bg-shell w-full text-foreground select-none"
      role="region"
      aria-label="Simulation results and telemetry"
    >
      {/* ================================================================== */}
      {/* Timed Simulation Top Progress Rule                                 */}
      {/* ================================================================== */}
      {mode === 'timed' && progressPercent > 0 && (
        <div
          className="absolute top-0 left-0 h-[2px] bg-primary transition-all duration-200 z-10"
          style={{ width: `${progressPercent}%` }}
          role="progressbar"
          aria-valuenow={Math.round(progressPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Simulation progress"
        />
      )}

      {/* ================================================================== */}
      {/* Compact Resting Footer Strip (7A screen look)                      */}
      {/* ================================================================== */}
      <div className="h-12 px-4 flex items-center justify-between text-xs overflow-x-auto gap-4">
        {/* Left Side: Status Dot + Run Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            data-testid="results-status-badge"
            className="flex items-center gap-2"
            aria-live="polite"
            aria-atomic="true"
          >
            <span
              className={cn('size-2 rounded-full shrink-0', statusBadge.dotClass)}
              aria-hidden="true"
            />
            <span className="font-semibold text-foreground text-xs">
              {statusBadge.text}
            </span>
            {terminal && !isMeasured && terminal.reason && (
              <span className="text-secondary-text text-xs font-mono">
                — {terminal.reason}
              </span>
            )}
            {terminal && staleRun && (
              <span
                data-testid="results-stale-notice"
                className="text-secondary-text text-xs font-mono"
              >
                · Ran on an earlier version
              </span>
            )}
          </div>

          {/* Metric Columns: only show when running or measured terminal */}
          {(!terminal || isMeasured) && (
            <>
              <Separator orientation="vertical" className="h-4 bg-control-border" />

              <div className="flex items-center gap-4 text-xs font-mono">
                {/* CHECKS */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-1.5">
                  <span className="text-[10px] text-secondary-text uppercase tracking-wider font-sans">
                    CHECKS
                  </span>
                  <span className="font-medium text-foreground">{checksSummary}</span>
                </div>

                <Separator orientation="vertical" className="h-4 bg-control-border hidden sm:block" />

                {/* TIME / MODE */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-1.5">
                  <span className="text-[10px] text-secondary-text uppercase tracking-wider font-sans">
                    TIME
                  </span>
                  <span className="font-medium text-foreground">{elapsedText}</span>
                </div>

                <Separator orientation="vertical" className="h-4 bg-control-border hidden sm:block" />

                {/* ROOTS */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-1.5">
                  <span className="text-[10px] text-secondary-text uppercase tracking-wider font-sans">
                    ROOTS
                  </span>
                  <span className="font-medium text-foreground">{rootCountsInfo.rootsLabel}</span>
                </div>

                <Separator orientation="vertical" className="h-4 bg-control-border hidden md:block" />

                {/* FAILURES */}
                <div className="hidden md:flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-1.5">
                  <span className="text-[10px] text-secondary-text uppercase tracking-wider font-sans">
                    FAILURES
                  </span>
                  <span className="font-medium text-foreground">{rootCountsInfo.failuresCount}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Side: Persistence Status & Details Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Save Status Indicator */}
          <div className="text-xs font-mono">
            {saveStatus === 'saved' && (
              <span className="text-secondary-text">Saved</span>
            )}
            {saveStatus === 'saving' && (
              <span className="text-secondary-text inline-flex items-center gap-1">
                <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
                Saving…
              </span>
            )}
            {typeof saveStatus === 'object' && saveStatus.failed && (
              <div className="inline-flex items-center gap-1.5">
                <span className="text-risk-text font-medium">Not saved</span>
                {onRetrySave && (
                  <button
                    type="button"
                    onClick={onRetrySave}
                    className="text-primary hover:underline font-sans cursor-pointer text-xs"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            {saveStatus === 'unsaved' && (
              <span className="text-secondary-text">Unsaved</span>
            )}
          </div>

          {/* Details Button */}
          <button
            type="button"
            data-testid="results-details-toggle"
            onClick={toggleExpanded}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-control border border-control-border bg-background hover:bg-sunken text-xs font-medium cursor-pointer transition-colors"
            aria-expanded={isExpanded}
            aria-controls="results-details-panel"
          >
            <span>Details</span>
            {isExpanded ? (
              <ChevronDown className="size-3 text-secondary-text" aria-hidden="true" />
            ) : (
              <ChevronUp className="size-3 text-secondary-text" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* Expanded Details Section (21B & 21D screens)                       */}
      {/* ================================================================== */}
      {isExpanded && (
        <div
          id="results-details-panel"
          className="border-t border-divider bg-panel max-h-[380px] overflow-y-auto flex flex-col"
        >
          {terminal && !isMeasured ? (
            <div className="p-4 space-y-2">
              <div className="p-3 rounded-control border border-control-border bg-background space-y-1">
                <div className="font-medium text-foreground text-xs">
                  Status: <span className="font-mono font-semibold">{terminal.status}</span>
                </div>
                {terminal.reason && (
                  <div className="text-secondary-text text-xs">
                    Reason: <span className="text-foreground">{terminal.reason}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Tabs Bar */}
              <div className="flex items-center justify-between px-4 border-b border-divider bg-panel text-xs font-medium">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab('general')}
                    className={cn(
                      'py-2 border-b-2 transition-colors cursor-pointer',
                      activeTab === 'general'
                        ? 'border-primary text-primary font-semibold'
                        : 'border-transparent text-secondary-text hover:text-foreground',
                    )}
                  >
                    General metrics
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('components')}
                    className={cn(
                      'py-2 border-b-2 transition-colors cursor-pointer',
                      activeTab === 'components'
                        ? 'border-primary text-primary font-semibold'
                        : 'border-transparent text-secondary-text hover:text-foreground',
                    )}
                  >
                    Components
                  </button>
                </div>
                <span className="text-[11px] font-mono text-secondary-text">
                  {events.length} events recorded
                </span>
              </div>

              {/* Tab Content */}
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeTab === 'general' ? (
                  <>
                    {/* Left Column: Summary Metrics & Assertions */}
                    <div className="space-y-4">
                      {/* Counts Card */}
                      <div className="p-3 rounded-control border border-control-border bg-background space-y-2">
                        <span className="font-mono text-[10px] tracking-wider text-secondary-text uppercase font-semibold">
                          EXECUTION SUMMARY
                        </span>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-secondary-text">Consumed inputs: </span>
                            <span className="font-mono font-medium">
                              {isMeasured && terminal?.summary?.consumedInputs != null
                                ? terminal.summary.consumedInputs
                                : '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-secondary-text">Processed events: </span>
                            <span className="font-mono font-medium">
                              {isMeasured && terminal?.summary?.processedEvents != null
                                ? terminal.summary.processedEvents
                                : '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-secondary-text">Roots succeeded: </span>
                            <span className="font-mono font-medium text-primary">
                              {isMeasured && terminal?.summary?.rootCounts.succeeded != null
                                ? terminal.summary.rootCounts.succeeded
                                : '—'}
                            </span>
                          </div>
                          <div>
                            <span className="text-secondary-text">Roots failed: </span>
                            <span className="font-mono font-medium text-risk-text">
                              {isMeasured && terminal?.summary?.rootCounts.failed != null
                                ? terminal.summary.rootCounts.failed
                                : '—'}
                            </span>
                          </div>
                          {isMeasured && messageCounts && (
                            <>
                              <div>
                                <span className="text-secondary-text">Messages succeeded: </span>
                                <span className="font-mono font-medium">
                                  {messageCounts.succeeded}
                                </span>
                              </div>
                              <div>
                                <span className="text-secondary-text">Messages failed: </span>
                                <span className="font-mono font-medium text-risk-text">
                                  {messageCounts.failed}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Run-level Metrics (elementId === null) */}
                      {generalMetrics.length > 0 && (
                        <div className="p-3 rounded-control border border-control-border bg-background space-y-2">
                          <span className="font-mono text-[10px] tracking-wider text-secondary-text uppercase font-semibold">
                            RUN METRICS
                          </span>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {generalMetrics.map((m, idx) => {
                              const display = formatMetricDisplay(m);
                              return (
                                <div key={`general-${m.key}-${idx}`}>
                                  <span className="text-secondary-text">{m.key}: </span>
                                  <span className="font-mono font-medium">
                                    {display.available ? display.valueText : `Unavailable (${display.reason})`}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Assertion Checks List */}
                      <div className="p-3 rounded-control border border-control-border bg-background space-y-2">
                        <span className="font-mono text-[10px] tracking-wider text-secondary-text uppercase font-semibold">
                          CHECKS {isMeasured && terminal ? `(${terminal.checks.length})` : '(—)'}
                        </span>
                        <div className="space-y-1.5 max-h-44 overflow-y-auto">
                          {isMeasured &&
                            terminal?.checks.map((check) => (
                              <div
                                key={check.assertionId}
                                className="flex items-start gap-2 p-1.5 rounded-sm bg-sunken/40 text-xs"
                              >
                                {check.status === 'passed' && (
                                  <CheckCircle2 className="size-3.5 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                                )}
                                {check.status === 'failed' && (
                                  <XCircle className="size-3.5 text-risk-text shrink-0 mt-0.5" aria-hidden="true" />
                                )}
                                {(check.status === 'unevaluated' || check.status === 'error') && (
                                  <AlertCircle className="size-3.5 text-[#8A6A1F] shrink-0 mt-0.5" aria-hidden="true" />
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium text-foreground truncate">
                                    {assertionLabels[check.assertionId] ?? 'Unlabelled check'} · {check.status}
                                  </div>
                                  {check.actual !== null && (
                                    <div className="text-[11px] font-mono text-secondary-text">
                                      actual: {JSON.stringify(check.actual)}
                                    </div>
                                  )}
                                  {check.reason && (
                                    <div className="text-[11px] text-risk-text">
                                      {check.reason}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          {(!isMeasured || !terminal?.checks || terminal.checks.length === 0) && (
                            <div className="text-xs text-secondary-text">
                              {!isMeasured ? 'Checks not evaluated.' : 'No checks configured for this scenario.'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Event Log (21B look) */}
                    <div className="p-3 rounded-control border border-control-border bg-background flex flex-col h-full max-h-72">
                      <span className="font-mono text-[10px] tracking-wider text-secondary-text uppercase font-semibold mb-2">
                        EVENT LOG ({events.length})
                      </span>
                      <div className="flex-1 overflow-y-auto space-y-1 text-xs font-mono">
                        {events.map((evt) => {
                          const timeStr =
                            evt.atMs != null
                              ? `${(evt.atMs / 1000).toFixed(1)} s`
                              : `#${evt.sequence}`;

                          return (
                            <div
                              key={evt.id}
                              className="flex items-center justify-between py-0.5 px-1 hover:bg-sunken rounded text-[11px]"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="text-secondary-text shrink-0">{timeStr}</span>
                                <span className="text-secondary-text text-[10px] uppercase shrink-0">
                                  {evt.kind}
                                </span>
                                <span className="font-medium text-foreground">{evt.code}</span>
                                {evt.elementId && (
                                  <span className="text-secondary-text text-[10px]">
                                    [{elementLabels[evt.elementId] ?? 'Unknown element'}]
                                  </span>
                                )}
                              </div>
                              {evt.outcome && (
                                <span
                                  className={cn(
                                    'text-[10px] uppercase font-semibold px-1 rounded',
                                    evt.outcome === 'succeeded' && 'bg-primary/10 text-primary',
                                    (evt.outcome === 'failed' || evt.outcome === 'rejected') &&
                                      'bg-risk-tint text-risk-text',
                                    evt.outcome === 'expired' && 'bg-[#8A6A1F]/15 text-[#8A6A1F]',
                                  )}
                                >
                                  {evt.outcome}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {events.length === 0 && (
                          <div className="text-secondary-text text-xs py-4 text-center">
                            No events recorded yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  /* Components Tab View (21D screen look) */
                  <div className="col-span-1 md:col-span-2 space-y-2">
                    <span className="font-mono text-[10px] tracking-wider text-secondary-text uppercase font-semibold">
                      ELEMENT METRICS
                    </span>

                    <div className="border border-control-border rounded-control bg-background overflow-hidden">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-sunken border-b border-control-border font-mono text-[10px] text-secondary-text uppercase">
                          <tr>
                            <th className="py-1.5 px-3">Element</th>
                            <th className="py-1.5 px-3">Metric</th>
                            <th className="py-1.5 px-3 text-right">Value</th>
                            <th className="py-1.5 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-control-border font-mono">
                          {componentMetrics.map((m, idx) => {
                            const display = formatMetricDisplay(m);
                            const label = m.elementId ? (elementLabels[m.elementId] ?? 'Unknown element') : 'Unknown element';
                            return (
                              <tr key={`${m.elementId}-${m.key}-${idx}`} className="hover:bg-sunken/40">
                                <td className="py-1.5 px-3 font-semibold text-foreground">
                                  {label}
                                </td>
                                <td className="py-1.5 px-3 text-secondary-text">{m.key}</td>
                                <td className="py-1.5 px-3 text-right font-medium">
                                  {display.valueText}
                                </td>
                                <td className="py-1.5 px-3 text-[11px]">
                                  {display.available ? (
                                    <span className="text-primary">Measured</span>
                                  ) : (
                                    <span className="text-risk-text" title={display.reason ?? ''}>
                                      Unavailable ({display.reason})
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {componentMetrics.length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-4 text-center text-secondary-text font-sans">
                                No component metrics recorded for this run.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </footer>
  );
}

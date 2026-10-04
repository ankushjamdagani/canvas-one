/**
 * Pure view-model functions and formatters for Run UI (RV-12c4).
 *
 * Implements Evergreen tokens and design-revalidation.md §2:
 * - Status dot and text mappings.
 * - Formats checks, elapsed time, root counts, and metrics without invented values.
 * - Progress bar calculation for timed simulations.
 */

import type {
  CheckResult,
  Counts,
  ElementMetric,
  TerminalStatus,
} from '../../domain/studio/runner/types';
import type { RunPhase } from './RunController';
import type { ScenarioStatus } from './scenarioStatus';

export type StatusColorToken = {
  readonly dotClass: string;
  readonly textClass: string;
  readonly label: string;
};

/**
 * Returns color classes and labels for scenario status dots and text.
 */
export function getScenarioStatusColor(status: ScenarioStatus): StatusColorToken {
  switch (status.kind) {
    case 'passed':
      return {
        dotClass: 'bg-primary',
        textClass: 'text-primary',
        label: 'Passed on this version',
      };
    case 'needs-rerun':
      return {
        dotClass: 'bg-[#8A6A1F]',
        textClass: 'text-[#8A6A1F]',
        label: 'Needs a rerun · edited since its last run',
      };
    case 'failed':
      return {
        dotClass: 'bg-risk-text',
        textClass: 'text-risk-text',
        label: `Failed · ${status.passedChecks} of ${status.totalChecks} checks`,
      };
    case 'not-run':
      return {
        dotClass: 'bg-[#8A938F]',
        textClass: 'text-secondary-text',
        label: 'Not run yet',
      };
    case 'not-ready':
      return {
        dotClass: 'bg-risk-text',
        textClass: 'text-risk-text',
        label: `Can't run · ${status.issues.length} issue${status.issues.length === 1 ? '' : 's'}`,
      };
  }
}

/**
 * Formats scenario mode label.
 */
export function formatScenarioMode(mode: 'logical' | 'timed'): string {
  return mode === 'timed' ? 'Traffic' : 'Step by step';
}

/**
 * Item 6 (commands.md "Status"): Run all is disabled while any scenario is not-ready.
 * Returns the first not-ready scenario's first issue message as the reason, or null when
 * every scenario can be run.
 */
export function findRunAllDisabledReason(
  scenarios: readonly { readonly status: ScenarioStatus }[],
): string | null {
  const notReady = scenarios.find((s) => s.status.kind === 'not-ready');
  if (!notReady || notReady.status.kind !== 'not-ready') {
    return null;
  }
  return notReady.status.issues[0]?.message ?? "Can't run this scenario";
}

/**
 * Formats the commit requirement line banner text per commands.md.
 */
export function formatCommitLineText(total: number, passing: number): string {
  if (total === 0) {
    return 'Commits need at least one scenario';
  }
  if (passing === total) {
    return `All ${total} scenarios passing · ready to commit`;
  }
  return `Commit needs all ${total} passing · ${passing} of ${total} passing now`;
}

/**
 * Formats the footer status badge for active or completed runs.
 */
export function formatStatusBadge(
  phase: RunPhase,
  terminalStatus?: TerminalStatus | null,
  scenarioName?: string | null,
  runId?: string | null,
): { text: string; dotClass: string } {
  const shortId = runId ? runId.slice(0, 8) : '';
  const name = scenarioName || 'Scenario';

  if (phase === 'running') {
    return {
      text: runId ? `Run ${shortId} running · ${name}` : `Running · ${name}`,
      dotClass: 'bg-primary animate-pulse',
    };
  }

  if (phase === 'paused') {
    return {
      text: runId ? `Run ${shortId} paused · ${name}` : `Paused · ${name}`,
      dotClass: 'bg-[#8A6A1F]',
    };
  }

  if (phase === 'compiling') {
    return {
      text: `Compiling · ${name}`,
      dotClass: 'bg-primary animate-pulse',
    };
  }

  if (phase === 'saving') {
    return {
      text: `Saving · ${name}`,
      dotClass: 'bg-[#8A6A1F]',
    };
  }

  switch (terminalStatus) {
    case 'completed':
      return {
        text: `${name} · completed`,
        dotClass: 'bg-primary',
      };
    case 'failed':
      return {
        text: `${name} · failed`,
        dotClass: 'bg-risk-text',
      };
    case 'invalid':
      return {
        text: `${name} · invalid`,
        dotClass: 'bg-risk-text',
      };
    case 'cancelled':
      return {
        text: `${name} · cancelled`,
        dotClass: 'bg-[#8A938F]',
      };
    case 'incomplete':
      return {
        text: `${name} · incomplete`,
        dotClass: 'bg-[#8A6A1F]',
      };
    default:
      return {
        text: name,
        dotClass: 'bg-[#8A938F]',
      };
  }
}

/**
 * Formats the checks summary string: "k of n passed" or "No checks", or "—" if not available.
 */
export function formatChecksSummary(checks?: readonly CheckResult[] | null): string {
  if (checks === undefined || checks === null) {
    return '—';
  }
  if (checks.length === 0) {
    return 'No checks';
  }
  const passed = checks.filter((c) => c.status === 'passed').length;
  const total = checks.length;
  return `${passed} of ${total} passed`;
}

/**
 * Formats elapsed time for logical vs timed modes.
 * Returns '—' when time is not available (never fabricated '0.0 s').
 */
export function formatElapsed(
  mode: 'logical' | 'timed',
  elapsedMs: number | null,
  currentTimeMs?: number | null,
): string {
  if (mode === 'logical') {
    return 'logical';
  }

  if (currentTimeMs != null) {
    return `${(currentTimeMs / 1000).toFixed(1)} s`;
  }

  if (elapsedMs != null) {
    return `${(elapsedMs / 1000).toFixed(1)} s`;
  }

  return '—';
}

/**
 * Formats root counts summary string without invented metrics.
 * Missing counts return '—' for both rootsLabel and failuresCount.
 *
 * RV-12d review round 1: `rootsLabel` is the bare count, not "n roots" -- the
 * caller (ResultsRegion's "ROOTS" column) already carries the unit as its
 * heading, so appending it again read as "ROOTS 2 roots".
 */
export function formatRootCountsSummary(rootCounts?: Counts | null): {
  readonly rootsLabel: string;
  readonly failuresCount: number | string;
} {
  if (!rootCounts) {
    return { rootsLabel: '—', failuresCount: '—' };
  }
  const totalRoots = rootCounts.generated;
  const failures = rootCounts.failed + rootCounts.rejected;
  return {
    rootsLabel: `${totalRoots}`,
    failuresCount: failures,
  };
}

/**
 * Formats an ElementMetric value with unit, or returns "Unavailable" with reason.
 * Strict per model-and-runner.md §9 and design-revalidation.md §2 (no invented values).
 */
export function formatMetricDisplay(metric: ElementMetric): {
  readonly valueText: string;
  readonly available: boolean;
  readonly reason: string | null;
} {
  if (!metric.available || metric.value === null) {
    return {
      valueText: 'Unavailable',
      available: false,
      reason: metric.reason ?? 'Metric unavailable',
    };
  }

  let text: string;
  switch (metric.unit) {
    case 'ms':
      text = `${metric.value.toFixed(1)} ms`;
      break;
    case 'requests/s':
      text = `${metric.value.toFixed(1)} req/s`;
      break;
    case 'ratio':
      text = `${(metric.value * 100).toFixed(1)}%`;
      break;
    case 'count':
      text = `${Math.round(metric.value)}`;
      break;
    default:
      text = `${metric.value}`;
  }

  return {
    valueText: text,
    available: true,
    reason: null,
  };
}

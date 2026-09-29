/**
 * MEASURED · LAST RUN selection (RV-05b).
 *
 * Implements the brief's inspector item 3 and model-and-runner.md §9 (ElementMetric).
 * Reads the latest saved run for the currently selected scenario -- already exposed by
 * `loadScenarioStatuses` (features/runs/scenarioStatus.ts) as `ScenarioWithStatus.latestRun`
 * -- and picks out the rows for one element: value + unit when available, "Unavailable ·
 * reason" otherwise, never an invented value. design-revalidation.md §2 rules out
 * TIGHTEST LINK / HEADROOM / bottleneck-pressure labels / p99 / a queue-depth sparkline
 * (no real per-run time series exists), so this only ever renders the closed
 * ElementMetric key catalog's labels and values.
 */

import type { Id } from '../../domain/studio/model';
import type { ElementMetric, ElementMetricKey } from '../../domain/studio/runner/types';
import type { RunRecord } from '../../persistence/studio/types';
import { formatMetricDisplay } from '../runs/view-models';

export type MeasuredRow = {
  readonly key: ElementMetricKey;
  readonly label: string;
  readonly valueText: string;
  readonly available: boolean;
  readonly reason: string | null;
};

export type MeasuredSection = {
  readonly rows: readonly MeasuredRow[];
  /** Set when there is nothing to show at all (no run, or a run with no rows for this element). */
  readonly emptyMessage: string | null;
};

const METRIC_LABELS: Partial<Record<ElementMetricKey, string>> = {
  generated: 'Generated',
  succeeded: 'Succeeded',
  rejected: 'Rejected',
  failed: 'Failed',
  expired: 'Expired',
  inFlight: 'In flight',
  acknowledged: 'Acknowledged',
  throughput: 'Throughput',
  meanLatencyMs: 'Mean latency',
  p95LatencyMs: 'P95 latency',
  utilization: 'Utilization',
  queued: 'Queued',
  active: 'Active',
  cacheHits: 'Cache hits',
  cacheMisses: 'Cache misses',
  cacheEntries: 'Cache entries',
  cacheEvictions: 'Cache evictions',
  cacheExpirations: 'Cache expirations',
};

/** Brief item 3: "logical runs → no latency/throughput." Defense-in-depth filter. */
const TIMED_ONLY_KEYS: ReadonlySet<ElementMetricKey> = new Set(['throughput', 'meanLatencyMs', 'p95LatencyMs']);

export function selectMeasuredSection(
  elementId: Id,
  latestRun: Pick<RunRecord, 'summary'> | null,
  scenarioLabel: string,
  scenarioMode: 'logical' | 'timed',
): MeasuredSection {
  if (!latestRun) {
    return { rows: [], emptyMessage: `No run yet for ${scenarioLabel}` };
  }

  const allMetrics: readonly ElementMetric[] = latestRun.summary?.elementMetrics ?? [];
  let metrics = allMetrics.filter((m) => m.elementId === elementId && m.scope === 'element');

  if (scenarioMode === 'logical') {
    metrics = metrics.filter((m) => !TIMED_ONLY_KEYS.has(m.key));
  }

  if (metrics.length === 0) {
    return { rows: [], emptyMessage: 'No measurements for this element' };
  }

  const rows = metrics.map((m) => {
    const display = formatMetricDisplay(m);
    return {
      key: m.key,
      label: METRIC_LABELS[m.key] ?? m.key,
      valueText: display.valueText,
      available: display.available,
      reason: display.reason,
    };
  });

  return { rows, emptyMessage: null };
}

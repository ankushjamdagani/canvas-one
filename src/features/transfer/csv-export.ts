/**
 * CSV v1 Run Metrics Exporter (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("CSV v1")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 *
 * Rules:
 * - Export one explicitly selected immutable saved run, not mutable editor state
 * - Snapshot labels come from that run (or provided snapshot document)
 * - Fixed 16 columns in exact order
 * - Check status: passing | failing | no-checks | incomplete
 * - Units: count, ms, requests/s, ratio
 * - Missing metric value is empty with available=false and reason; never zero. Real zero is 0 with available=true
 * - Logical runs export measured counts, but no synthesized elapsed time/latency/rate; sample times empty
 * - UTF-8 BOM, comma delimiter, CRLF row endings, final CRLF
 * - Quote every cell with "; embedded " doubles
 * - Text CR/LF/tab controls become visible spaces in CSV text cells
 * - Formula-injection defense: prefix ASCII apostrophe before quoting when first non-whitespace
 *   code point is =, +, -, @, U+FF1D, U+FF0B, U+FF0D, U+FF20, or original has leading CR/LF/tab
 * - Ceilings: <= 100,000 rows and <= 16 MiB output
 * - If run has no metrics, explain "No measured metrics for this run"
 */

import type { Id } from '../../domain/studio/model';
import type { Counts, ElementMetric } from '../../domain/studio/runner/types';
import { csvFileName } from './filename';
import { CSV_EXPORT_LIMITATIONS } from './limitations';
import type { CsvExportOptions, CsvExportResult } from './types';

export type MalformedRunErrorCode =
  | 'missing-scenario-id'
  | 'missing-element'
  | 'missing-snapshot'
  | 'malformed-run';

export class MalformedRunError extends Error {
  readonly code: MalformedRunErrorCode;
  readonly elementId?: Id | null;

  constructor(
    message: string,
    code: MalformedRunErrorCode = 'malformed-run',
    elementId?: Id | null,
  ) {
    super(message);
    this.name = 'MalformedRunError';
    this.code = code;
    this.elementId = elementId;
  }
}

const MAX_CSV_ROWS = 100_000;
const MAX_CSV_BYTES = 16 * 1024 * 1024; // 16 MiB

const CSV_HEADERS = [
  'run_id',
  'scenario_id',
  'fingerprint',
  'provenance',
  'run_status',
  'check_status',
  'scope',
  'element_id',
  'element_label',
  'metric',
  'value',
  'unit',
  'available',
  'reason',
  'sample_start_ms',
  'sample_end_ms',
] as const;

/**
 * Formats a text cell with formula-injection defense and quoting.
 * Prefix ASCII apostrophe before quoting when:
 * 1. the first non-whitespace code point is '=', '+', '-', '@'
 *    or fullwidth U+FF1D ('＝'), U+FF0B ('＋'), U+FF0D ('－'), U+FF20 ('＠'), OR
 * 2. the original contains leading CR/LF/tab controls.
 * Replaces CR/LF/tab with visible spaces.
 * Quotes cell and doubles any internal quotes.
 */
export function formatCsvTextCell(text: string | null | undefined): string {
  if (text == null || text === '') {
    return '""';
  }

  let s = String(text);

  // Check if original has leading CR/LF/tab controls
  const hasLeadingControls = /^[\r\n\t]/.test(s);

  // Find first non-whitespace code point
  const trimmed = s.replace(/^\s+/u, '');
  const firstCp = trimmed.length > 0 ? trimmed.codePointAt(0) : undefined;

  const isFormulaTrigger =
    firstCp === 0x3d || // '='
    firstCp === 0x2b || // '+'
    firstCp === 0x2d || // '-'
    firstCp === 0x40 || // '@'
    firstCp === 0xff1d || // '＝' Fullwidth equals
    firstCp === 0xff0b || // '＋' Fullwidth plus
    firstCp === 0xff0d || // '－' Fullwidth hyphen-minus
    firstCp === 0xff20 || // '＠' Fullwidth at
    hasLeadingControls;

  if (isFormulaTrigger) {
    s = "'" + s;
  }

  // Text CR/LF/tab controls become visible spaces in CSV text cells
  s = s.replace(/[\r\n\t]/g, ' ');

  // Quote cell and double embedded quotes
  return `"${s.replace(/"/g, '""')}"`;
}

function formatCsvNumberCell(
  value: number | null | undefined,
  available: boolean,
): string {
  if (!available || value == null || !Number.isFinite(value)) {
    return '""';
  }
  return `"${value}"`;
}

function formatCsvBooleanCell(value: boolean): string {
  return `"${value ? 'true' : 'false'}"`;
}

/**
 * Derives check_status: 'passing' | 'failing' | 'no-checks' | 'incomplete'
 */
function deriveCheckStatus(
  runStatus: string,
  checks: readonly { status: string }[] | undefined,
): 'passing' | 'failing' | 'no-checks' | 'incomplete' {
  if (runStatus === 'incomplete' || runStatus === 'cancelled') {
    return 'incomplete';
  }

  if (!checks || checks.length === 0) {
    return 'no-checks';
  }

  if (checks.some((c) => c.status === 'unevaluated')) {
    return 'incomplete';
  }

  if (checks.every((c) => c.status === 'passed')) {
    return 'passing';
  }

  return 'failing';
}

function hasManifestScenarioId(
  manifest: unknown,
): manifest is { readonly scenario: { readonly id: string } } {
  return (
    typeof manifest === 'object' &&
    manifest !== null &&
    'scenario' in manifest &&
    typeof manifest.scenario === 'object' &&
    manifest.scenario !== null &&
    'id' in manifest.scenario &&
    typeof manifest.scenario.id === 'string' &&
    manifest.scenario.id.trim().length > 0
  );
}

const COUNT_KEYS: readonly (keyof Counts)[] = [
  'generated',
  'succeeded',
  'rejected',
  'failed',
  'expired',
  'inFlight',
] as const;

/**
 * Exports a stored terminal run's summary metrics as CSV v1.
 */
export function exportRunCsv(options: CsvExportOptions): CsvExportResult {
  const { run, snapshotDocument } = options;

  if (!run || !run.summary) {
    throw new Error('No measured metrics for this run');
  }

  const summary = run.summary;

  // Resolve scenario_id via real ExecutionManifest shape (run-identity.md §3)
  if (!hasManifestScenarioId(run.manifest)) {
    throw new MalformedRunError(
      'Malformed run: manifest is missing required scenario.id',
      'missing-scenario-id',
    );
  }
  const scenarioId = run.manifest.scenario.id;

  // Resolve element labels from run's snapshot document
  const snapshotElementLabels = new Map<Id, string>();
  if (snapshotDocument?.elements) {
    for (const el of snapshotDocument.elements) {
      snapshotElementLabels.set(el.id, el.label);
    }
  }

  const checkStatus = deriveCheckStatus(run.status, run.checks);

  // Collect rows from elementMetrics
  const metrics: ElementMetric[] = [...summary.elementMetrics];

  // Emit root and message count rows for EVERY run unless those same keys
  // already appear as root/message-scope elementMetrics (no duplicates)
  const rootKeysInMetrics = new Set(
    metrics.filter((m) => m.scope === 'root').map((m) => m.key),
  );
  for (const k of COUNT_KEYS) {
    if (!rootKeysInMetrics.has(k)) {
      metrics.push({
        elementId: null,
        scope: 'root',
        key: k,
        value: summary.rootCounts[k],
        unit: 'count',
        available: true,
        reason: null,
        windowStartMs: null,
        windowEndMs: null,
      });
    }
  }

  const messageKeysInMetrics = new Set(
    metrics.filter((m) => m.scope === 'message').map((m) => m.key),
  );
  for (const k of COUNT_KEYS) {
    if (!messageKeysInMetrics.has(k)) {
      metrics.push({
        elementId: null,
        scope: 'message',
        key: k,
        value: summary.messageCounts[k],
        unit: 'count',
        available: true,
        reason: null,
        windowStartMs: null,
        windowEndMs: null,
      });
    }
  }

  if (metrics.length === 0) {
    throw new Error('No measured metrics for this run');
  }

  if (metrics.length > MAX_CSV_ROWS) {
    throw new Error(`CSV metrics count (${metrics.length}) exceeds the 100,000 rows limit`);
  }

  const rows: string[] = [];

  // Header row
  rows.push(CSV_HEADERS.map((h) => `"${h}"`).join(','));

  const isLogical = summary.mode === 'logical';

  for (const m of metrics) {
    let elementId = '';
    let elementLabel = '';

    if (m.scope === 'element') {
      if (!m.elementId) {
        throw new MalformedRunError(
          'Malformed run: element-scoped metric missing elementId',
          'missing-element',
        );
      }
      const label = snapshotElementLabels.get(m.elementId);
      if (label === undefined) {
        throw new MalformedRunError(
          `Malformed run: element '${m.elementId}' is missing from snapshot document`,
          'missing-element',
          m.elementId,
        );
      }
      elementId = m.elementId;
      elementLabel = label;
    }

    const sampleStartMs =
      !isLogical && m.windowStartMs != null && Number.isFinite(m.windowStartMs)
        ? m.windowStartMs
        : null;
    const sampleEndMs =
      !isLogical && m.windowEndMs != null && Number.isFinite(m.windowEndMs)
        ? m.windowEndMs
        : null;

    const rowCells = [
      formatCsvTextCell(run.id),
      formatCsvTextCell(scenarioId),
      formatCsvTextCell(run.fingerprint),
      formatCsvTextCell(run.provenance),
      formatCsvTextCell(run.status),
      formatCsvTextCell(checkStatus),
      formatCsvTextCell(m.scope),
      formatCsvTextCell(elementId),
      formatCsvTextCell(elementLabel),
      formatCsvTextCell(m.key),
      formatCsvNumberCell(m.value, m.available),
      formatCsvTextCell(m.unit),
      formatCsvBooleanCell(m.available),
      formatCsvTextCell(m.reason),
      formatCsvNumberCell(sampleStartMs, sampleStartMs != null),
      formatCsvNumberCell(sampleEndMs, sampleEndMs != null),
    ];

    rows.push(rowCells.join(','));
  }

  // UTF-8 BOM, CRLF row endings, final CRLF
  const csv = '\uFEFF' + rows.join('\r\n') + '\r\n';

  const byteLength = new TextEncoder().encode(csv).byteLength;
  if (byteLength > MAX_CSV_BYTES) {
    throw new Error(`CSV output size (${byteLength} bytes) exceeds the 16 MiB limit`);
  }

  const fileName = csvFileName(scenarioId);

  return {
    csv,
    fileName,
    rowCount: metrics.length,
    byteLength,
    limitations: CSV_EXPORT_LIMITATIONS,
  };
}

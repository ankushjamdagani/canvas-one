/**
 * Tests for CSV v1 Run Metrics Exporter (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("CSV v1")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 *
 * Verification:
 * - CSV formula-injection defense (=, +, -, @, tab, CR prefixes, fullwidth U+FF1D/U+FF0B/U+FF0D/U+FF20)
 * - User leading apostrophe remains literal
 * - Unicode, long names, emojis
 * - Empty measurements: value empty with available=false and reason (never 0); real 0 has value "0" with available=true
 * - Check status: passing, failing, no-checks, incomplete
 * - UTF-8 BOM, comma delimiter, CRLF row endings, final CRLF, quoted cells
 * - "No measured metrics for this run" error
 */

import { describe, expect, it } from 'vitest';
import type { Document, Id } from '../../domain/studio/model';
import type { ElementMetric, RunSummary } from '../../domain/studio/runner/types';
import type { RunRecord } from '../../persistence/studio/types';
import { exportRunCsv, formatCsvTextCell, MalformedRunError } from './csv-export';
import { emptyCycleSummary } from '../../domain/studio/runner/cycles';

function makeSnapshotDocument(elements: readonly { id: Id; label: string }[] = []): Document {
  return {
    schema: 'studio-model/1',
    id: 'doc-1',
    title: 'Test Document',
    elements: elements.map((e) => ({
      id: e.id,
      label: e.label,
      kind: 'service',
      ports: [],
      properties: {},
      behavior: { kind: 'stateless' },
    })) as unknown as Document['elements'],
    connections: [],
    relations: [],
    schemas: [],
    fixtures: [],
    refinements: [],
    scenarios: [],
    views: [],
  };
}

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  const defaultSummary: RunSummary = {
    mode: 'timed',
    cycles: emptyCycleSummary(),
    consumedInputs: 10,
    rootCounts: { generated: 10, succeeded: 8, rejected: 1, failed: 1, expired: 0, inFlight: 0 },
    messageCounts: { generated: 20, succeeded: 18, rejected: 0, failed: 2, expired: 0, inFlight: 0 },
    elementMetrics: [
      {
        elementId: 'el-1',
        scope: 'element',
        key: 'throughput',
        value: 125.5,
        unit: 'requests/s',
        available: true,
        reason: null,
        windowStartMs: 0,
        windowEndMs: 1000,
      },
    ],
    finalStates: [],
    outputs: [],
    coverage: { includedElementIds: ['el-1'], excludedElementIds: [] },
    processedEvents: 50,
    elapsedMs: 1000,
    rowOutcomes: [],
  };

  return {
    projectId: 'test-project',
    id: 'run-uuid-1',
    snapshotId: 'a'.repeat(64),
    manifest: { scenario: { id: 'scenario-test' } },
    fingerprint: 'ss-run-v1:' + 'b'.repeat(64),
    status: 'completed',
    provenance: 'local',
    checks: [{ assertionId: 'a1', status: 'passed', actual: true, reason: null }],
    summary: defaultSummary,
    traceState: 'complete',
    createdAt: 1000,
    completedAt: 2000,
    ...overrides,
  };
}

describe('CSV v1 Export (exportRunCsv)', () => {
  describe('Formula-injection defense (formatCsvTextCell)', () => {
    it('prefixes ASCII apostrophe for formula triggers (=, +, -, @)', () => {
      expect(formatCsvTextCell('=SUM(A1:B1)')).toBe("\"'=SUM(A1:B1)\"");
      expect(formatCsvTextCell('+12345')).toBe("\"'+12345\"");
      expect(formatCsvTextCell('-54321')).toBe("\"'-54321\"");
      expect(formatCsvTextCell('@EXT(1)')).toBe("\"'@EXT(1)\"");
    });

    it('prefixes ASCII apostrophe when leading whitespace precedes formula triggers', () => {
      expect(formatCsvTextCell('   =CMD("calc")')).toBe("\"'   =CMD(\"\"calc\"\")\"");
      expect(formatCsvTextCell('  +payload')).toBe("\"'  +payload\"");
      expect(formatCsvTextCell('   -99')).toBe("\"'   -99\"");
      expect(formatCsvTextCell(' @admin')).toBe("\"' @admin\"");
    });

    it('prefixes ASCII apostrophe for fullwidth forms (U+FF1D, U+FF0B, U+FF0D, U+FF20)', () => {
      expect(formatCsvTextCell('\uFF1D1+1')).toBe("\"'\uFF1D1+1\"");
      expect(formatCsvTextCell('\uFF0B2+2')).toBe("\"'\uFF0B2+2\"");
      expect(formatCsvTextCell('\uFF0D3-3')).toBe("\"'\uFF0D3-3\"");
      expect(formatCsvTextCell('\uFF20SUM(A1)')).toBe("\"'\uFF20SUM(A1)\"");
    });

    it('prefixes ASCII apostrophe for leading CR/LF/tab controls and normalizes controls to visible spaces', () => {
      expect(formatCsvTextCell('\tLeadingTab')).toBe("\"' LeadingTab\"");
      expect(formatCsvTextCell('\nLeadingNewline')).toBe("\"' LeadingNewline\"");
      expect(formatCsvTextCell('\rLeadingCR')).toBe("\"' LeadingCR\"");
      expect(formatCsvTextCell('\r\n=FormulaAfterCRLF')).toBe("\"'  =FormulaAfterCRLF\"");
    });

    it('leaves literal user apostrophe unchanged if not a formula trigger', () => {
      expect(formatCsvTextCell("'Regular text")).toBe("\"'Regular text\"");
      expect(formatCsvTextCell("'O'Connor")).toBe("\"'O'Connor\"");
    });

    it('normalizes internal CR/LF/tab controls to spaces without prefixing apostrophe', () => {
      expect(formatCsvTextCell('Hello\nWorld\tTest')).toBe('"Hello World Test"');
    });

    it('preserves Unicode and emojis safely', () => {
      expect(formatCsvTextCell('Service 🚀 [Production]')).toBe('"Service 🚀 [Production]"');
      expect(formatCsvTextCell('日本語データベース')).toBe('"日本語データベース"');
    });
  });

  describe('Full CSV run metrics export', () => {
    it('exports CSV with UTF-8 BOM, CRLF row endings, exact headers, and quoted cells', () => {
      const run = makeRunRecord();
      const snapshot = makeSnapshotDocument([{ id: 'el-1', label: 'Payment Processor' }]);
      const res = exportRunCsv({ run, snapshotDocument: snapshot });

      // Starts with UTF-8 BOM
      expect(res.csv.startsWith('\uFEFF')).toBe(true);
      // Row endings are CRLF and ends with CRLF
      expect(res.csv.includes('\r\n')).toBe(true);
      expect(res.csv.endsWith('\r\n')).toBe(true);

      const lines = res.csv.slice(1).trimEnd().split('\r\n');
      expect(lines.length).toBe(14); // Header + 1 element metric + 6 root counts + 6 message counts

      const header = lines[0];
      expect(header).toBe(
        '"run_id","scenario_id","fingerprint","provenance","run_status","check_status","scope","element_id","element_label","metric","value","unit","available","reason","sample_start_ms","sample_end_ms"',
      );

      const dataRow = lines[1];
      expect(dataRow).toContain('"run-uuid-1"');
      expect(dataRow).toContain('"scenario-test"');
      expect(dataRow).toContain('"local"');
      expect(dataRow).toContain('"completed"');
      expect(dataRow).toContain('"passing"');
      expect(dataRow).toContain('"element"');
      expect(dataRow).toContain('"el-1"');
      expect(dataRow).toContain('"Payment Processor"');
      expect(dataRow).toContain('"throughput"');
      expect(dataRow).toContain('"125.5"');
      expect(dataRow).toContain('"requests/s"');
      expect(dataRow).toContain('"true"');
      expect(dataRow).toContain('"0"');
      expect(dataRow).toContain('"1000"');

      expect(res.fileName).toMatch(/\.csv$/);
      expect(res.limitations).toContain('Whole-run summary metrics only');
    });

    it('handles empty/unavailable measurements: empty value with available=false and reason, never 0', () => {
      const metric: ElementMetric = {
        elementId: 'el-2',
        scope: 'element',
        key: 'utilization',
        value: null,
        unit: 'ratio',
        available: false,
        reason: 'No arrival traffic during measurement window',
        windowStartMs: 0,
        windowEndMs: 1000,
      };

      const run = makeRunRecord({
        summary: {
          ...makeRunRecord().summary!,
          elementMetrics: [metric],
        },
      });

      const snapshot = makeSnapshotDocument([{ id: 'el-2', label: 'Worker Queue' }]);
      const res = exportRunCsv({ run, snapshotDocument: snapshot });
      const lines = res.csv.slice(1).trimEnd().split('\r\n');
      const row = lines[1];

      // Value must be empty quoted string "", NOT 0!
      // Format: ...,"utilization","","ratio","false","No arrival traffic during measurement window",...
      expect(row).toContain('"utilization","","ratio","false","No arrival traffic during measurement window"');
    });

    it('handles real zero as value "0" with available=true', () => {
      const metric: ElementMetric = {
        elementId: 'el-3',
        scope: 'element',
        key: 'failed',
        value: 0,
        unit: 'count',
        available: true,
        reason: null,
        windowStartMs: 0,
        windowEndMs: 1000,
      };

      const run = makeRunRecord({
        summary: {
          ...makeRunRecord().summary!,
          elementMetrics: [metric],
        },
      });

      const snapshot = makeSnapshotDocument([{ id: 'el-3', label: 'Cache Layer' }]);
      const res = exportRunCsv({ run, snapshotDocument: snapshot });
      const lines = res.csv.slice(1).trimEnd().split('\r\n');
      const row = lines[1];

      expect(row).toContain('"failed","0","count","true",""');
    });

    it('correctly maps check_status for failing, no-checks, and incomplete runs', () => {
      const snapshot = makeSnapshotDocument([{ id: 'el-1', label: 'Processor' }]);

      // 1. Failing
      const failingRun = makeRunRecord({
        checks: [
          { assertionId: 'a1', status: 'passed', actual: 1, reason: null },
          { assertionId: 'a2', status: 'failed', actual: 2, reason: 'exceeded latency' },
        ],
      });
      const resFail = exportRunCsv({ run: failingRun, snapshotDocument: snapshot });
      expect(resFail.csv).toContain('"failing"');

      // 2. No checks
      const noChecksRun = makeRunRecord({ checks: [] });
      const resNoChecks = exportRunCsv({ run: noChecksRun, snapshotDocument: snapshot });
      expect(resNoChecks.csv).toContain('"no-checks"');

      // 3. Incomplete
      const incompleteRun = makeRunRecord({
        status: 'incomplete',
        checks: [{ assertionId: 'a1', status: 'unevaluated', actual: null, reason: null }],
      });
      const resIncomplete = exportRunCsv({ run: incompleteRun, snapshotDocument: snapshot });
      expect(resIncomplete.csv).toContain('"incomplete"');
    });

    it('exports measured counts for logical runs with empty sample times', () => {
      const logicalSummary: RunSummary = {
        mode: 'logical',
        cycles: emptyCycleSummary(),
        consumedInputs: 5,
        rootCounts: { generated: 5, succeeded: 5, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
        messageCounts: { generated: 10, succeeded: 10, rejected: 0, failed: 0, expired: 0, inFlight: 0 },
        elementMetrics: [], // empty element metrics in logical run
        finalStates: [],
        outputs: [],
        coverage: { includedElementIds: [], excludedElementIds: [] },
        processedEvents: 15,
        elapsedMs: null,
        rowOutcomes: [],
      };

      const logicalRun = makeRunRecord({ summary: logicalSummary });
      const res = exportRunCsv({ run: logicalRun });

      // Should export root and message counts
      expect(res.rowCount).toBe(12); // 6 root counts + 6 message counts
      const lines = res.csv.slice(1).trimEnd().split('\r\n');
      const rootRow = lines[1];
      // Root scope has empty element_id and element_label, and empty sample times at the end ("","")
      expect(rootRow).toContain('"root","",""');
      expect(rootRow.endsWith(',"",""')).toBe(true);
    });

    it('throws "No measured metrics for this run" if run has no metrics', () => {
      const emptyRun = makeRunRecord({ summary: null as unknown as RunSummary });
      expect(() => exportRunCsv({ run: emptyRun })).toThrow('No measured metrics for this run');
    });
  });

  describe('Item 2: Scenario ID from manifest shape', () => {
    it('throws MalformedRunError when manifest is missing or null', () => {
      const run = makeRunRecord({ manifest: null });
      expect(() => exportRunCsv({ run, snapshotDocument: makeSnapshotDocument() })).toThrow(
        MalformedRunError,
      );
      try {
        exportRunCsv({ run, snapshotDocument: makeSnapshotDocument() });
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedRunError);
        expect((err as MalformedRunError).code).toBe('missing-scenario-id');
      }
    });

    it('throws MalformedRunError when manifest is missing scenario.id', () => {
      const run = makeRunRecord({ manifest: { identityVersion: 1 } });
      expect(() => exportRunCsv({ run, snapshotDocument: makeSnapshotDocument() })).toThrow(
        MalformedRunError,
      );
    });

    it('throws MalformedRunError when manifest uses legacy/loose scenarioId field instead of scenario.id', () => {
      const run = makeRunRecord({ manifest: { scenarioId: 'legacy-loose-scenario' } });
      expect(() => exportRunCsv({ run, snapshotDocument: makeSnapshotDocument() })).toThrow(
        MalformedRunError,
      );
    });

    it('never emits an empty cell for scenario_id', () => {
      const run = makeRunRecord({ manifest: { scenario: { id: '' } } });
      expect(() => exportRunCsv({ run, snapshotDocument: makeSnapshotDocument() })).toThrow(
        MalformedRunError,
      );
    });
  });

  describe('Item 3: Element labels strictly from run snapshot document', () => {
    it('throws MalformedRunError naming the elementId when element-scoped metric is missing from snapshot document', () => {
      const run = makeRunRecord({
        summary: {
          ...makeRunRecord().summary!,
          elementMetrics: [
            {
              elementId: 'missing-el-id',
              scope: 'element',
              key: 'throughput',
              value: 100,
              unit: 'requests/s',
              available: true,
              reason: null,
              windowStartMs: 0,
              windowEndMs: 1000,
            },
          ],
        },
      });

      const snapshot = makeSnapshotDocument([{ id: 'other-el', label: 'Other' }]);
      expect(() => exportRunCsv({ run, snapshotDocument: snapshot })).toThrow(MalformedRunError);
      try {
        exportRunCsv({ run, snapshotDocument: snapshot });
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedRunError);
        expect((err as MalformedRunError).code).toBe('missing-element');
        expect((err as MalformedRunError).elementId).toBe('missing-el-id');
        expect((err as Error).message).toContain('missing-el-id');
      }
    });

    it('throws MalformedRunError when snapshotDocument is null/omitted for element-scoped metric', () => {
      const run = makeRunRecord(); // has el-1 metric
      expect(() => exportRunCsv({ run })).toThrow(MalformedRunError);
      try {
        exportRunCsv({ run });
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedRunError);
        expect((err as MalformedRunError).elementId).toBe('el-1');
      }
    });

    it('resolves element labels from snapshot document, never allowing blank label for element-scoped metric', () => {
      const run = makeRunRecord();
      const snapshot = makeSnapshotDocument([{ id: 'el-1', label: 'Snapshot Payment Processor' }]);
      const res = exportRunCsv({ run, snapshotDocument: snapshot });
      expect(res.csv).toContain('"el-1","Snapshot Payment Processor"');
    });
  });

  describe('Item 4: Summary count rows for every run', () => {
    it('emits root and message count rows for EVERY run even when elementMetrics is non-empty', () => {
      const run = makeRunRecord(); // 1 element metric + 6 rootCounts + 6 messageCounts
      const snapshot = makeSnapshotDocument([{ id: 'el-1', label: 'Processor' }]);
      const res = exportRunCsv({ run, snapshotDocument: snapshot });

      // 1 element metric + 6 root + 6 message = 13 rows
      expect(res.rowCount).toBe(13);
      // Verify root count rows exist
      expect(res.csv).toContain('"root","","","generated","10","count","true"');
      expect(res.csv).toContain('"root","","","succeeded","8","count","true"');
      // Verify message count rows exist
      expect(res.csv).toContain('"message","","","generated","20","count","true"');
      expect(res.csv).toContain('"message","","","failed","2","count","true"');
    });

    it('deduplicates count rows if same keys already appear in elementMetrics', () => {
      const run = makeRunRecord({
        summary: {
          ...makeRunRecord().summary!,
          elementMetrics: [
            {
              elementId: null,
              scope: 'root',
              key: 'generated',
              value: 99,
              unit: 'count',
              available: true,
              reason: null,
              windowStartMs: null,
              windowEndMs: null,
            },
          ],
        },
      });
      const snapshot = makeSnapshotDocument();
      const res = exportRunCsv({ run, snapshotDocument: snapshot });

      // 1 root (already in elementMetrics) + 5 other root + 6 message = 12 rows
      expect(res.rowCount).toBe(12);
      // 'generated' appears only once for root scope with value 99
      const matches = res.csv.match(/"root","","","generated"/g);
      expect(matches?.length).toBe(1);
      expect(res.csv).toContain('"root","","","generated","99","count","true"');
    });

    it('reads counts directly from rootCounts and messageCounts without fallbacks', () => {
      const run = makeRunRecord({
        summary: {
          ...makeRunRecord().summary!,
          rootCounts: { generated: 42, succeeded: 40, rejected: 1, failed: 1, expired: 0, inFlight: 0 },
          messageCounts: { generated: 84, succeeded: 80, rejected: 2, failed: 2, expired: 0, inFlight: 0 },
          elementMetrics: [],
        },
      });
      const res = exportRunCsv({ run, snapshotDocument: makeSnapshotDocument() });
      expect(res.csv).toContain('"root","","","generated","42","count","true"');
      expect(res.csv).toContain('"message","","","generated","84","count","true"');
    });
  });
});

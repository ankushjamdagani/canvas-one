import { describe, expect, it } from 'vitest';
import type { ElementMetric } from '../../domain/studio/runner/types';
import {
  calculateProgressPercent,
  findRunAllDisabledReason,
  formatChecksSummary,
  formatCommitLineText,
  formatElapsed,
  formatMetricDisplay,
  formatRootCountsSummary,
  formatScenarioMode,
  formatStatusBadge,
  getScenarioStatusColor,
} from './view-models';

describe('View-Model Formatters and Helpers', () => {
  it('formats scenario status colors and labels accurately', () => {
    const passed = getScenarioStatusColor({ kind: 'passed' });
    expect(passed.dotClass).toBe('bg-primary');
    expect(passed.label).toContain('Passed');

    const rerun = getScenarioStatusColor({ kind: 'needs-rerun' });
    expect(rerun.dotClass).toBe('bg-[#8A6A1F]');
    expect(rerun.label).toContain('Needs a rerun');

    const failed = getScenarioStatusColor({ kind: 'failed', passedChecks: 1, totalChecks: 3 });
    expect(failed.dotClass).toBe('bg-risk-text');
    expect(failed.label).toBe('Failed · 1 of 3 checks');

    const notRun = getScenarioStatusColor({ kind: 'not-run' });
    expect(notRun.dotClass).toBe('bg-[#8A938F]');
    expect(notRun.label).toBe('Not run yet');
  });

  it('Item 6: formats not-ready status as "Can\'t run · n issues"', () => {
    const oneIssue = getScenarioStatusColor({
      kind: 'not-ready',
      issues: [
        { code: 'structural-rule', path: [], entityId: null, severity: 'error', message: 'Missing workload entry.' },
      ],
    });
    expect(oneIssue.label).toBe("Can't run · 1 issue");

    const twoIssues = getScenarioStatusColor({
      kind: 'not-ready',
      issues: [
        { code: 'structural-rule', path: [], entityId: null, severity: 'error', message: 'Missing workload entry.' },
        { code: 'missing-property', path: [], entityId: null, severity: 'error', message: 'Missing completion.' },
      ],
    });
    expect(twoIssues.label).toBe("Can't run · 2 issues");
  });

  it('Item 6: findRunAllDisabledReason surfaces the first not-ready scenario\'s first issue, or null when all can run', () => {
    expect(
      findRunAllDisabledReason([
        { status: { kind: 'not-run' } },
        { status: { kind: 'passed' } },
      ]),
    ).toBeNull();

    expect(
      findRunAllDisabledReason([
        { status: { kind: 'not-run' } },
        {
          status: {
            kind: 'not-ready',
            issues: [
              { code: 'structural-rule', path: [], entityId: null, severity: 'error', message: 'Scenario references a deleted element.' },
            ],
          },
        },
      ]),
    ).toBe('Scenario references a deleted element.');
  });

  it('formats scenario mode text correctly', () => {
    expect(formatScenarioMode('timed')).toBe('Traffic');
    expect(formatScenarioMode('logical')).toBe('Step by step');
  });

  it('formats commit requirement banner text per commands.md', () => {
    expect(formatCommitLineText(4, 1)).toBe('Commit needs all 4 passing · 1 of 4 passing now');
    expect(formatCommitLineText(4, 4)).toBe('All 4 scenarios passing · ready to commit');
    expect(formatCommitLineText(0, 0)).toBe('Commits need at least one scenario');
  });

  it('formats status badge across phases and terminal statuses', () => {
    const running = formatStatusBadge('running', null, 'Burst 7x', '12345678-abcd');
    expect(running.text).toBe('Run 12345678 running · Burst 7x');
    expect(running.dotClass).toContain('animate-pulse');

    const paused = formatStatusBadge('paused', null, 'Burst 7x', '12345678-abcd');
    expect(paused.text).toBe('Run 12345678 paused · Burst 7x');

    const completed = formatStatusBadge('done', 'completed', 'Burst 7x');
    expect(completed.text).toBe('Burst 7x · completed');
    expect(completed.dotClass).toBe('bg-primary');

    const failed = formatStatusBadge('done', 'failed', 'Burst 7x');
    expect(failed.text).toBe('Burst 7x · failed');
    expect(failed.dotClass).toBe('bg-risk-text');

    const cancelled = formatStatusBadge('done', 'cancelled', 'Burst 7x');
    expect(cancelled.text).toBe('Burst 7x · cancelled');
  });

  it('formats checks summary', () => {
    expect(formatChecksSummary(null)).toBe('—');
    expect(formatChecksSummary([])).toBe('No checks');
    expect(
      formatChecksSummary([
        { assertionId: 'c1', status: 'passed', actual: null, reason: null },
        { assertionId: 'c2', status: 'passed', actual: null, reason: null },
        { assertionId: 'c3', status: 'failed', actual: null, reason: null },
      ]),
    ).toBe('2 of 3 passed');
  });

  it('formats elapsed time for logical and timed modes without fabricated 0', () => {
    expect(formatElapsed('logical', 1234)).toBe('logical');
    expect(formatElapsed('timed', 30000)).toBe('30.0 s');
    expect(formatElapsed('timed', null, 18600, 30000)).toBe('18.6 s / 30 s');
    expect(formatElapsed('timed', null, null, 30000)).toBe('—');
    expect(formatElapsed('timed', null, null, null)).toBe('—');
  });

  it('computes progress percentage accurately', () => {
    expect(calculateProgressPercent(15000, 30000)).toBe(50);
    expect(calculateProgressPercent(30000, 30000)).toBe(100);
    expect(calculateProgressPercent(45000, 30000)).toBe(100);
    expect(calculateProgressPercent(null, 30000)).toBe(0);
    expect(calculateProgressPercent(10000, 0)).toBe(0);
  });

  it('formats root counts and failures correctly without fabricated 0', () => {
    const summary = formatRootCountsSummary({
      generated: 10,
      succeeded: 8,
      rejected: 1,
      failed: 1,
      expired: 0,
      inFlight: 0,
    });
    expect(summary.rootsLabel).toBe('10');
    expect(summary.failuresCount).toBe(2);

    const empty = formatRootCountsSummary(null);
    expect(empty.rootsLabel).toBe('—');
    expect(empty.failuresCount).toBe('—');
  });

  it('formats metrics with units, and shows Unavailable + reason for unmeasured metrics', () => {
    const throughputMetric: ElementMetric = {
      elementId: 'gateway',
      scope: 'element',
      key: 'throughput',
      value: 98.7,
      unit: 'requests/s',
      available: true,
      reason: null,
      windowStartMs: 0,
      windowEndMs: 30000,
    };
    const display1 = formatMetricDisplay(throughputMetric);
    expect(display1.available).toBe(true);
    expect(display1.valueText).toBe('98.7 req/s');

    const latencyMetric: ElementMetric = {
      elementId: 'gateway',
      scope: 'element',
      key: 'meanLatencyMs',
      value: 12.34,
      unit: 'ms',
      available: true,
      reason: null,
      windowStartMs: 0,
      windowEndMs: 30000,
    };
    const display2 = formatMetricDisplay(latencyMetric);
    expect(display2.available).toBe(true);
    expect(display2.valueText).toBe('12.3 ms');

    const unavailableMetric: ElementMetric = {
      elementId: 'gateway',
      scope: 'element',
      key: 'utilization',
      value: null,
      unit: 'ratio',
      available: false,
      reason: 'Logical mode does not compute utilization',
      windowStartMs: null,
      windowEndMs: null,
    };
    const display3 = formatMetricDisplay(unavailableMetric);
    expect(display3.available).toBe(false);
    expect(display3.valueText).toBe('Unavailable');
    expect(display3.reason).toBe('Logical mode does not compute utilization');
  });
});

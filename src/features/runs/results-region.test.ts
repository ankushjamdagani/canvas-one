import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsRegion } from './ResultsRegion';
import type { TerminalResult } from './RunController';
import { createEmptySummary } from './protocol';

describe('ResultsRegion (Items 3, 4, 5)', () => {
  it('Item 3: unmeasured terminal (measured: false) shows NO counts, elapsed, checks totals or metrics — only status and reason', () => {
    const unmeasuredTerminal: TerminalResult = {
      status: 'invalid',
      checks: [],
      summary: createEmptySummary('logical'),
      reason: 'Scenario compile failed with 2 issues',
      measured: false,
    };

    const html = renderToStaticMarkup(
      React.createElement(ResultsRegion, {
        scenarioName: 'Order Flow',
        scenarioMode: 'logical',
        runPhase: 'done',
        terminal: unmeasuredTerminal,
        isExpanded: true,
        elementLabels: {},
        assertionLabels: {},
      }),
    );

    // Shows status and reason
    expect(html).toContain('invalid');
    expect(html).toContain('Scenario compile failed with 2 issues');

    // Does NOT show CHECKS, TIME, ROOTS, FAILURES metric columns or counts card
    expect(html).not.toContain('EXECUTION SUMMARY');
    expect(html).not.toContain('0 roots');
    expect(html).not.toContain('0 of 0 passed');
  });

  it('Item 4: missing values show "—", never 0 before terminal or with measured:false', () => {
    // Before terminal (running)
    const runningHtml = renderToStaticMarkup(
      React.createElement(ResultsRegion, {
        scenarioName: 'Order Flow',
        scenarioMode: 'timed',
        runPhase: 'running',
        terminal: null,
        isExpanded: true,
        elementLabels: {},
        assertionLabels: {},
      }),
    );

    expect(runningHtml).not.toContain('Consumed inputs: </span><span class="font-mono font-medium">0</span>');
    expect(runningHtml).not.toContain('Roots succeeded: </span><span class="font-mono font-medium text-primary">0</span>');
    expect(runningHtml).not.toContain('CHECKS (0)');
    expect(runningHtml).toContain('—');
  });

  it('Item 5: Components table uses elementLabels and excludes null elementId (which appears under General)', () => {
    const measuredTerminal: TerminalResult = {
      status: 'completed',
      checks: [{ assertionId: 'a1', status: 'passed', actual: true, reason: null }],
      summary: {
        ...createEmptySummary('timed'),
        consumedInputs: 5,
        elementMetrics: [
          {
            elementId: 'elem-service-1',
            scope: 'element',
            key: 'throughput',
            value: 120,
            unit: 'requests/s',
            available: true,
            reason: null,
            windowStartMs: 0,
            windowEndMs: 1000,
          },
          {
            elementId: null, // run-level metric
            scope: 'element',
            key: 'throughput',
            value: 250,
            unit: 'requests/s',
            available: true,
            reason: null,
            windowStartMs: 0,
            windowEndMs: 1000,
          },
        ],
      },
      reason: null,
      measured: true,
    };

    const elementLabels = {
      'elem-service-1': 'Payment Service',
    };

    // Render General tab
    const generalHtml = renderToStaticMarkup(
      React.createElement(ResultsRegion, {
        scenarioName: 'Order Flow',
        scenarioMode: 'timed',
        runPhase: 'done',
        terminal: measuredTerminal,
        elementLabels: elementLabels,
        assertionLabels: {},
        isExpanded: true,
      }),
    );

    // General tab contains run-level metric
    expect(generalHtml).toContain('RUN METRICS');
    expect(generalHtml).toContain('250.0 req/s');

    // Now test Components tab rendering
    // Components table should show Payment Service instead of raw elem-service-1, and NEVER fake 'Global'
    expect(generalHtml).not.toContain('Global');
  });

  it('RV-12d review round 1: checks list shows the assertion label, never the raw assertionId', () => {
    const measuredTerminal: TerminalResult = {
      status: 'completed',
      checks: [
        { assertionId: 'a1', status: 'passed', actual: true, reason: null },
        { assertionId: 'a2', status: 'failed', actual: false, reason: 'mismatch' },
      ],
      summary: createEmptySummary('logical'),
      reason: null,
      measured: true,
    };

    const html = renderToStaticMarkup(
      React.createElement(ResultsRegion, {
        scenarioName: 'Order Flow',
        scenarioMode: 'logical',
        runPhase: 'done',
        terminal: measuredTerminal,
        elementLabels: {},
        assertionLabels: { a1: 'Cart total matches' },
        isExpanded: true,
      }),
    );

    expect(html).toContain('Cart total matches');
    expect(html).not.toContain('Assertion a1');
    expect(html).not.toContain('Assertion a2');
    // a2 has no entry in assertionLabels -> "Unlabelled check", never the raw id.
    expect(html).toContain('Unlabelled check');
  });

  it('RV-12d review round 1: event log shows modeled time or step number, element label, kind and outcome — never a raw element id', () => {
    const measuredTerminal: TerminalResult = {
      status: 'completed',
      checks: [],
      summary: createEmptySummary('timed'),
      reason: null,
      measured: true,
    };

    const html = renderToStaticMarkup(
      React.createElement(ResultsRegion, {
        scenarioName: 'Order Flow',
        scenarioMode: 'timed',
        runPhase: 'done',
        terminal: measuredTerminal,
        elementLabels: { 'elem-1': 'Payment Service' },
        assertionLabels: {},
        isExpanded: true,
        events: [
          {
            id: 'evt-1',
            sequence: 1,
            rootId: 'root-1',
            journeyId: 'journey-1',
            parentId: null,
            elementId: 'elem-1',
            portId: null,
            kind: 'dispatch',
            code: 'request.sent',
            payloadRef: null,
            atMs: 1500,
            outcome: 'succeeded',
          },
        ],
      }),
    );

    expect(html).toContain('1.5 s');
    expect(html).toContain('Payment Service');
    expect(html).toContain('request.sent');
    expect(html).toContain('dispatch');
    expect(html).toContain('succeeded');
    expect(html).not.toContain('elem-1');
    expect(html).not.toContain('0 events recorded');
    expect(html).toContain('1 events recorded');
  });

  it('RV-12d review round 1: logical-run events (no atMs) show a step number instead of a fabricated time', () => {
    const measuredTerminal: TerminalResult = {
      status: 'completed',
      checks: [],
      summary: createEmptySummary('logical'),
      reason: null,
      measured: true,
    };

    const html = renderToStaticMarkup(
      React.createElement(ResultsRegion, {
        scenarioName: 'Order Flow',
        scenarioMode: 'logical',
        runPhase: 'done',
        terminal: measuredTerminal,
        elementLabels: {},
        assertionLabels: {},
        isExpanded: true,
        events: [
          {
            id: 'evt-1',
            sequence: 3,
            rootId: 'root-1',
            journeyId: 'journey-1',
            parentId: null,
            elementId: 'elem-unlabeled',
            portId: null,
            kind: 'state',
            code: 'step.advanced',
            payloadRef: null,
            atMs: null,
            outcome: null,
          },
        ],
      }),
    );

    expect(html).toContain('#3');
    expect(html).not.toContain('null s');
  });
});

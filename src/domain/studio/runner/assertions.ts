/**
 * Assertion evaluator (RV-14b).
 *
 * Implements specs/revamp/contracts/model-and-runner.md §6 ("Assertions and assumptions")
 * and §9 ("Results: CheckResult"):
 * - Evaluates Assertion subjects: final-state, context, output, count, trace-count against the run result.
 * - Canonical-JSON equality for 'equals'.
 * - Numeric operators ('at-most', 'at-least') apply strictly to numbers; wrong types return 'error'.
 * - Missing/unsupported subjects return status 'unevaluated' or 'error' with a reason, never zero.
 * - The 'metric' subject reads the element's metric from a timed run; logical runs and
 *   missing or unavailable metrics are 'unevaluated' (§6 & §9, D48).
 * - Pure function without side effects.
 */

import { canonicalJson } from '../canonical';
import type { Assertion, Json } from '../model';
import type { CheckResult, RunSummary, TraceEvent } from './types';
import { readPath } from './expr';
import { isMissing } from './expr-api';

/**
 * Evaluates a single assertion against a run summary and recorded trace events.
 */
export function evaluateAssertion(
  assertion: Assertion,
  summary: RunSummary,
  events: readonly TraceEvent[],
): CheckResult {
  const { subject, operator, expected } = assertion;

  let actual: Json;

  switch (subject.kind) {
    case 'final-state': {
      const stateEntry = summary.finalStates.find((fs) => fs.elementId === subject.elementId);
      if (!stateEntry) {
        return {
          assertionId: assertion.id,
          status: 'unevaluated',
          actual: null,
          reason: `Element '${subject.elementId}' final state not found in run summary`,
        };
      }
      actual = stateEntry.stateId;
      break;
    }

    case 'context': {
      const stateEntry = summary.finalStates.find((fs) => fs.elementId === subject.elementId);
      if (!stateEntry) {
        return {
          assertionId: assertion.id,
          status: 'unevaluated',
          actual: null,
          reason: `Element '${subject.elementId}' not found in run summary`,
        };
      }
      const readRes = readPath(stateEntry.context, subject.path);
      if (isMissing(readRes)) {
        return {
          assertionId: assertion.id,
          status: 'error',
          actual: null,
          reason: `Path '${subject.path.join('.')}' is missing in element '${subject.elementId}' context`,
        };
      }
      actual = readRes;
      break;
    }

    case 'output': {
      const portOutput = summary.outputs.find(
        (out) => out.port.elementId === subject.port.elementId && out.port.portId === subject.port.portId,
      );
      const values: readonly Json[] = portOutput ? portOutput.values : [];
      if (subject.path.length === 0) {
        actual = values;
      } else {
        const readRes = readPath(values, subject.path);
        if (isMissing(readRes)) {
          return {
            assertionId: assertion.id,
            status: 'error',
            actual: null,
            reason: `Path '${subject.path.join('.')}' cannot be resolved in port outputs`,
          };
        }
        actual = readRes;
      }
      break;
    }

    case 'count': {
      if (subject.scope === 'root') {
        actual = summary.rootCounts[subject.outcome];
      } else if (subject.scope === 'message') {
        actual = summary.messageCounts[subject.outcome];
      } else {
        return {
          assertionId: assertion.id,
          status: 'unevaluated',
          actual: null,
          reason: 'Element scope counts are unavailable in logical mode',
        };
      }
      break;
    }

    // Assertions that read trace rows must check `summary.trace?.truncatedBy`: after a
    // trace cap the rows are partial while counts and metrics cover the whole run (D47).
    case 'trace-count': {
      const truncatedBy = summary.trace?.truncatedBy ?? null;
      if (truncatedBy !== null) {
        return {
          assertionId: assertion.id,
          status: 'unevaluated',
          actual: null,
          reason: `The trace stopped recording at its ${truncatedBy === 'trace-rows' ? 'row' : 'byte'} budget, so trace counts would be partial`,
        };
      }
      let count = 0;
      for (const ev of events) {
        if (ev.elementId === subject.elementId && ev.code === subject.code) {
          count++;
        }
      }
      actual = count;
      break;
    }

    case 'metric': {
      if (summary.mode === 'logical') {
        return {
          assertionId: assertion.id,
          status: 'unevaluated',
          actual: null,
          reason: 'Logical runs have no timing, so metric checks are unavailable (§6)',
        };
      }
      const metric = summary.elementMetrics.find(
        (m) => m.scope === 'element' && m.elementId === subject.elementId && m.key === subject.key,
      );
      // §6: a missing or unavailable metric is an unevaluated failure, never zero.
      if (!metric) {
        return {
          assertionId: assertion.id,
          status: 'unevaluated',
          actual: null,
          reason: `Element '${subject.elementId}' has no '${subject.key}' metric in this run (only simulated components have metrics)`,
        };
      }
      if (!metric.available || metric.value === null) {
        return {
          assertionId: assertion.id,
          status: 'unevaluated',
          actual: null,
          reason: metric.reason ?? `Metric '${subject.key}' is unavailable for element '${subject.elementId}'`,
        };
      }
      actual = metric.value;
      break;
    }

    default:
      return {
        assertionId: assertion.id,
        status: 'error',
        actual: null,
        reason: `Unsupported assertion subject kind '${(subject as { kind?: string }).kind}'`,
      };
  }

  // Operator evaluation
  if (operator === 'equals') {
    const actualCanon = canonicalJson(actual);
    const expectedCanon = canonicalJson(expected);
    if (!actualCanon.ok || !expectedCanon.ok) {
      return {
        assertionId: assertion.id,
        status: 'error',
        actual,
        reason: 'Failed to serialize values to canonical JSON for comparison',
      };
    }
    if (actualCanon.text === expectedCanon.text) {
      return { assertionId: assertion.id, status: 'passed', actual, reason: null };
    }
    return {
      assertionId: assertion.id,
      status: 'failed',
      actual,
      reason: `Expected ${expectedCanon.text}, got ${actualCanon.text}`,
    };
  }

  if (operator === 'at-most' || operator === 'at-least') {
    if (typeof actual !== 'number' || typeof expected !== 'number') {
      return {
        assertionId: assertion.id,
        status: 'error',
        actual,
        reason: `Numeric operator '${operator}' requires numbers; got actual=${typeof actual}, expected=${typeof expected}`,
      };
    }
    const passed = operator === 'at-most' ? actual <= expected : actual >= expected;
    return {
      assertionId: assertion.id,
      status: passed ? 'passed' : 'failed',
      actual,
      reason: passed ? null : `Value ${actual} is not ${operator} ${expected}`,
    };
  }

  return {
    assertionId: assertion.id,
    status: 'error',
    actual,
    reason: `Unknown assertion operator '${operator}'`,
  };
}

/**
 * Evaluates a list of assertions against a run summary and recorded trace events.
 */
export function evaluateAssertions(
  assertions: readonly Assertion[],
  summary: RunSummary,
  events: readonly TraceEvent[],
): CheckResult[] {
  return assertions.map((a) => evaluateAssertion(a, summary, events));
}

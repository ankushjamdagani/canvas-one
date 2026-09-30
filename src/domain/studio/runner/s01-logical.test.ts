import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScenario } from './scenario-runner';
import type { Document } from '../model';
import { canonicalJson } from '../canonical';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');

function loadFixture(name: string): Document {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

/**
 * S01 logical-mode facts through the production runner (runScenario). Migrated from the
 * RV-14b logical interpreter's tests when that interpreter was retired: authored
 * assertions, §11 trace facts, determinism and budget exhaustion.
 */
describe('logical mode: S01 reference fixture through runScenario', () => {
  const s01Doc = loadFixture('s01.json');

  it('runs scenario 1 (Invalid cart): passes all authored assertions', async () => {
    const scenarioId = '63096c28-fb95-589b-ac92-178597be9c0d';
    const runId = '00000000-0000-0000-0000-000000000001';

    const result = await runScenario(s01Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();
    expect(result.checks.length).toBe(2);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // Verify final state is editing
    const machineState = result.summary.finalStates.find(
      (fs) => fs.elementId === '04f1d18c-7a82-5986-aae6-ca2fe393b135',
    );
    expect(machineState?.stateId).toBe('fbab72a9-a716-5746-a644-cb97080902e1'); // editing

    // Zero commands emitted
    expect(result.summary.outputs.length).toBe(0);
    // 0 user requests generated (control input did not emit call)
    expect(result.summary.rootCounts.generated).toBe(0);
    expect(result.summary.consumedInputs).toBe(1);
  });

  it('runs scenario 2 (Duplicate submit): passes all authored assertions & §11 facts', async () => {
    const scenarioId = '425ec755-23cd-56f9-ab2f-1b1ae8ab18d6';
    const runId = '00000000-0000-0000-0000-000000000002';

    const result = await runScenario(s01Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();
    expect(result.checks.length).toBe(4);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // Final state is succeeded
    const machineState = result.summary.finalStates.find(
      (fs) => fs.elementId === '04f1d18c-7a82-5986-aae6-ca2fe393b135',
    );
    expect(machineState?.stateId).toBe('47d8e10f-7c32-5ca4-b0e3-6493394efe86'); // succeeded

    // §11 trace-level facts: duplicate submit -> 1 command, 1 request ID
    const commandEvents = result.events.filter((e) => e.code === 'order-command');
    expect(commandEvents.length).toBe(1);

    const ignoredDuplicateEvents = result.events.filter((e) => e.code === 'ignored-duplicate');
    expect(ignoredDuplicateEvents.length).toBe(1);

    const emitEvents = result.events.filter((e) => e.kind === 'dispatch' && e.code === 'emit');
    expect(emitEvents.length).toBe(1);

    // Root accounting: 1 user root generated, 1 succeeded, 2 inputs consumed
    expect(result.summary.rootCounts.generated).toBe(1);
    expect(result.summary.rootCounts.succeeded).toBe(1);
    expect(result.summary.consumedInputs).toBe(2);
  });

  it('runs scenario 3 (Timeout retry stale response): passes all authored assertions & §11 facts', async () => {
    const scenarioId = 'c90abfe5-387e-556c-85cc-a246dd3aeec4';
    const runId = '00000000-0000-0000-0000-000000000003';

    const result = await runScenario(s01Doc, scenarioId, runId);

    expect(result.status).toBe('completed');
    expect(result.reason).toBeNull();
    expect(result.checks.length).toBe(4);
    for (const check of result.checks) {
      expect(check.status).toBe('passed');
    }

    // Final state is succeeded
    const machineState = result.summary.finalStates.find(
      (fs) => fs.elementId === '04f1d18c-7a82-5986-aae6-ca2fe393b135',
    );
    expect(machineState?.stateId).toBe('47d8e10f-7c32-5ca4-b0e3-6493394efe86'); // succeeded

    // §11 trace-level facts: timeout case -> 2 distinct request IDs and the late first response traced as stale
    const orderCommands = result.events.filter((e) => e.code === 'order-command');
    expect(orderCommands.length).toBe(2);

    const staleResponses = result.events.filter((e) => e.code === 'stale-response');
    expect(staleResponses.length).toBe(1);

    // Check emitted commands: 2 calls with 2 distinct request IDs
    const emittedValues = result.summary.outputs[0]?.values ?? [];
    expect(emittedValues.length).toBe(2);
    const reqId1 = (emittedValues[0] as any).requestId;
    const reqId2 = (emittedValues[1] as any).requestId;
    expect(reqId1).toBeDefined();
    expect(reqId2).toBeDefined();
    expect(reqId1).not.toBe(reqId2);

    // Root accounting: 2 user roots generated, 2 succeeded, 3 inputs consumed
    expect(result.summary.rootCounts.generated).toBe(2);
    expect(result.summary.rootCounts.succeeded).toBe(2);
    expect(result.summary.consumedInputs).toBe(3);
  });

  it('determinism: running the same scenario twice yields bit-for-bit identical canonical JSON', async () => {
    const scenarioId = 'c90abfe5-387e-556c-85cc-a246dd3aeec4';
    const runId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

    const run1 = await runScenario(s01Doc, scenarioId, runId);
    const run2 = await runScenario(s01Doc, scenarioId, runId);

    const canonEvents1 = canonicalJson(run1.events);
    const canonEvents2 = canonicalJson(run2.events);
    expect(canonEvents1.ok).toBe(true);
    expect(canonEvents2.ok).toBe(true);
    if (canonEvents1.ok && canonEvents2.ok) {
      expect(canonEvents1.text).toBe(canonEvents2.text);
    }

    const canonSummary1 = canonicalJson(run1.summary);
    const canonSummary2 = canonicalJson(run2.summary);
    expect(canonSummary1.ok).toBe(true);
    expect(canonSummary2.ok).toBe(true);
    if (canonSummary1.ok && canonSummary2.ok) {
      expect(canonSummary1.text).toBe(canonSummary2.text);
    }
  });


  it('honours maxEvents budget and returns incomplete', async () => {
    const budgetDoc: Document = {
      ...s01Doc,
      scenarios: [
        {
          ...s01Doc.scenarios[1], // Duplicate submit scenario
          id: 'sc-budget',
          budgets: {
            ...s01Doc.scenarios[1].budgets,
            maxEvents: 2, // low budget!
          },
        },
      ],
    };

    const res = await runScenario(budgetDoc, 'sc-budget', 'run-budget');
    expect(res.status).toBe('incomplete');
    expect(res.reason).toContain('Budget exhausted');
  });

  it('stops recording at maxTraceRows but finishes the run; trace-count checks are unevaluated (D47)', async () => {
    const budgetDoc: Document = {
      ...s01Doc,
      scenarios: [
        {
          ...s01Doc.scenarios[1],
          id: 'sc-rows-budget',
          budgets: {
            ...s01Doc.scenarios[1].budgets,
            maxTraceRows: 2, // will stop after 2 trace rows!
          },
        },
      ],
    };

    const res = await runScenario(budgetDoc, 'sc-rows-budget', 'run-rows-budget');
    expect(res.status).toBe('completed');
    expect(res.events).toHaveLength(2);
    expect(res.summary.trace).toEqual({ recordedRows: 2, truncatedBy: 'trace-rows' });
    const traceChecks = budgetDoc.scenarios[0].assertions.filter((a) => a.subject.kind === 'trace-count').map((a) => a.id);
    expect(traceChecks.length).toBeGreaterThan(0);
    for (const c of res.checks.filter((c) => traceChecks.includes(c.assertionId))) expect(c.status).toBe('unevaluated');
    for (const c of res.checks.filter((c) => !traceChecks.includes(c.assertionId))) expect(c.status).toBe('passed');
  });
});

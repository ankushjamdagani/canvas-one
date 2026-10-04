import { describe, expect, it } from 'vitest';
import type { Document, Id, Scenario } from '../../domain/studio/model';
import type { AuthoredResult, RecordChange } from '../../persistence/studio/types';
import { buildMockDocument, makeCounterMintId } from './mockDocument';
import { DEFAULT_SCENARIO_BUDGETS } from './budgets';
import { remapScenarioForCopy } from './idRemap';
import {
  applyScenarioDraft,
  buildEmptyScenario,
  changeScenarioDraft,
  computeScenarioIssues,
  deleteScenario,
  openScenarioDraft,
} from './draft';
import { toStorableScenario, UNSET_EMISSION, type DraftEmission, type DraftScenario, type DraftWorkload } from './draftScenario';
import type { ScenarioDraftHandle, ScenarioDraftSession, ScenarioDraftTarget } from './types';

const fixedRandom = () => 0.25; // deterministic: seed = floor(0.25 * (2^32-1) + ...)

function inboundPort(document: Document): { elementId: Id; portId: Id } {
  const element = document.elements.find((e) => e.ports.some((p) => p.direction === 'in'));
  if (!element) throw new Error('no inbound port in mock document');
  const port = element.ports.find((p) => p.direction === 'in')!;
  return { elementId: element.id, portId: port.id };
}

/**
 * Turns an empty timed draft into a minimally runnable one: one workload (with a fully
 * filled-in request class), one assertion, and a stream. Test-only
 * convenience for the "Apply succeeds" tests -- NOT how a real user session works
 * (that's exactly what the "blocks Apply" tests below exercise field by field).
 */
function makeReady(handle: ScenarioDraftHandle, document: Document, mintId: () => Id): ScenarioDraftHandle {
  const entry = inboundPort(document);
  return changeScenarioDraft(handle, document, (s) => ({
    ...s,
    workloads: [
      {
        id: mintId(),
        entry,
        enabled: true,
        startDelayMs: 0,
        emission: { mode: 'stream', ratePerSecond: 10, profile: { kind: 'steady' } },
        timeoutMs: 30000,
        classes: [],
      },
    ],
    assertions: [
      {
        id: mintId(),
        label: 'No failures',
        subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' },
        operator: 'at-least',
        expected: 0,
      },
    ],
  }));
}

function fakeSession(document: Document, workingRevision: number, applyImpl?: ScenarioDraftSession['apply']): ScenarioDraftSession {
  let doc = document;
  let rev = workingRevision;
  return {
    getState: () => ({ workingRevision: rev, document: doc }),
    apply:
      applyImpl ??
      (async (changes: readonly RecordChange[]): Promise<AuthoredResult> => {
        for (const change of changes) {
          if (change.kind === 'insert' && change.value.recordKind === 'scenario') {
            doc = { ...doc, scenarios: [...doc.scenarios, change.value.record] };
          } else if (change.kind === 'replace' && change.value.recordKind === 'scenario') {
            const record = change.value.record;
            doc = { ...doc, scenarios: doc.scenarios.map((s) => (s.id === record.id ? record : s)) };
          } else if (change.kind === 'remove' && change.recordKind === 'scenario') {
            doc = { ...doc, scenarios: doc.scenarios.filter((s) => s.id !== change.id) };
          }
        }
        rev += 1;
        return {
          status: 'applied',
          operationId: 'op-1' as Id,
          projectRevision: 1,
          branchRevision: rev,
          changedIds: [],
          undo: { entryId: 'undo-1' as Id, label: 'test' },
          value: { kind: 'none' },
        };
      }),
  };
}

/** A fully-authored logical Scenario (every draft-only field is trivially complete
 * for an empty logical draft: completion is always quiescent, no workloads/assertions
 * to leave unset), for tests that need a real stored `Scenario` fixture rather than a
 * `DraftScenario`. */
function logicalSourceScenario(document: Document, mintId: () => Id, label: string): Scenario {
  const draft = buildEmptyScenario({ mintId, randomSource: fixedRandom, mode: 'logical', label, document });
  const stored = toStorableScenario(draft);
  if (!stored) throw new Error('test fixture: an empty logical draft must always be storable');
  return stored;
}

describe('buildEmptyScenario', () => {
  it('invents nothing for a fresh timed draft: no completion, empty arrays, full scope, contracted budget defaults, a random seed -- and nothing else', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(1);
    const scenario = buildEmptyScenario({
      mintId,
      randomSource: fixedRandom,
      mode: 'timed',
      label: 'New one',
      document,
    });

    expect(scenario.label).toBe('New one');
    expect(scenario.mode).toBe('timed');
    expect(scenario.revision).toBe(0);
    expect(scenario.workloads).toEqual([]);
    expect(scenario.inputs).toEqual([]);
    expect(scenario.faults).toEqual([]);
    expect(scenario.boundaries).toEqual([]);
    expect(scenario.assertions).toEqual([]);
    expect(scenario.assumptions).toEqual([]);
    expect(scenario.entryPorts).toEqual([]);
    expect(scenario.refinementSelections).toEqual([]);
    expect(scenario.initialContexts).toEqual([]);
    expect(scenario.scopeElementIds).toEqual(document.elements.map((e) => e.id));
    expect(scenario.budgets).toEqual(DEFAULT_SCENARIO_BUDGETS);
    // Exhaustive: nothing beyond the contract's three allowed prefills (budgets, seed,
    // scope) plus the caller-supplied id/label/mode/revision is present with a
    // non-empty/non-default value.
    const allowedNonEmptyKeys = new Set(['id', 'label', 'mode', 'revision', 'scopeElementIds', 'budgets', 'seed']);
    for (const [key, value] of Object.entries(scenario)) {
      if (allowedNonEmptyKeys.has(key)) continue;
      expect(Array.isArray(value) ? value.length : value, `unexpected prefilled field '${key}'`).toBe(
        Array.isArray(value) ? 0 : value,
      );
      if (Array.isArray(value)) expect(value).toEqual([]);
    }
  });

  it('invents nothing for a fresh logical draft', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(2);
    const scenario = buildEmptyScenario({
      mintId,
      randomSource: fixedRandom,
      mode: 'logical',
      label: 'Logical one',
      document,
    });
    expect(scenario.workloads).toEqual([]);
    expect(scenario.inputs).toEqual([]);
    expect(scenario.boundaries).toEqual([]);
    expect(scenario.assertions).toEqual([]);
  });

  it('draws the seed from the injected random source, within the contracted uint32 range', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(3);
    const scenario = buildEmptyScenario({
      mintId,
      randomSource: () => 0,
      mode: 'timed',
      label: 'Zero seed',
      document,
    });
    expect(scenario.seed).toBe(0);

    const scenario2 = buildEmptyScenario({
      mintId,
      randomSource: () => 0.999999,
      mode: 'timed',
      label: 'High seed',
      document,
    });
    expect(scenario2.seed).toBeGreaterThan(0);
    expect(scenario2.seed).toBeLessThanOrEqual(4294967295);
  });
});

describe('toStorableScenario', () => {
  const unsetWorkload = (mintId: () => Id, document: Document): DraftWorkload => ({
    id: mintId(), entry: inboundPort(document), enabled: true, startDelayMs: 0, emission: UNSET_EMISSION, timeoutMs: 30000, classes: [],
  });

  it('returns null while a workload has no emission chosen', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(4);
    const draft: DraftScenario = {
      ...buildEmptyScenario({ mintId, randomSource: fixedRandom, mode: 'timed', label: 'X', document }),
      workloads: [unsetWorkload(mintId, document)],
    };
    expect(toStorableScenario(draft)).toBeNull();
  });

  it('returns null while a chosen emission still misses a value', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(6);
    const base = buildEmptyScenario({ mintId, randomSource: fixedRandom, mode: 'timed', label: 'X', document });
    const withEmission = (emission: DraftEmission): DraftScenario => ({ ...base, workloads: [{ ...unsetWorkload(mintId, document), emission }] });
    expect(toStorableScenario(withEmission({ mode: 'bulk', requests: null, arrival: 'instant' }))).toBeNull();
    expect(toStorableScenario(withEmission({ mode: 'bulk', requests: 10, arrival: null }))).toBeNull();
    expect(toStorableScenario(withEmission({ mode: 'bulk', requests: 10, arrival: { spreadMs: null } }))).toBeNull();
    expect(toStorableScenario(withEmission({ mode: 'stream', ratePerSecond: null, profile: { kind: 'steady' } }))).toBeNull();
    expect(toStorableScenario(withEmission({ mode: 'stream', ratePerSecond: 5, profile: { kind: 'ramp', endRate: 9, rampMs: null } }))).toBeNull();
  });

  it('returns a real Scenario once every emission is filled', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(5);
    const base = buildEmptyScenario({ mintId, randomSource: fixedRandom, mode: 'timed', label: 'X', document });
    const draft: DraftScenario = {
      ...base,
      workloads: [{ ...unsetWorkload(mintId, document), emission: { mode: 'bulk', requests: 100, arrival: { ramp: { spreadMs: 2000 } } } }],
    };
    const stored = toStorableScenario(draft);
    expect(stored?.workloads[0].emission).toEqual({ mode: 'bulk', requests: 100, arrival: { ramp: { spreadMs: 2000 } } });
  });
});

describe('remapScenarioForCopy', () => {
  it('remaps every nested ID with fresh UUIDs and keeps document references unchanged', () => {
    const document = buildMockDocument();
    const buildMintId = makeCounterMintId(10);
    const entry = inboundPort(document);

    const source: Scenario = {
      ...logicalSourceScenario(document, buildMintId, 'Source'),
      inputs: [
        {
          id: buildMintId(),
          entry,
          fixtureId: document.fixtures[0].id,
          journeyId: buildMintId(),
          atMs: null,
          payloadBindings: [],
          resource: null,
        },
      ],
    };
    const journeyId = source.inputs[0].journeyId;
    const secondInput = {
      ...source.inputs[0],
      id: buildMintId(),
      journeyId, // same journey as the first input
      payloadBindings: [
        { targetPath: ['a'], source: { port: entry, journeyId, occurrence: 0, path: ['x'] } },
      ],
    };
    const withTwoInputs: Scenario = { ...source, inputs: [source.inputs[0], secondInput] };

    const mintCopy = makeCounterMintId(20);
    const copy = remapScenarioForCopy(withTwoInputs, mintCopy, 'Copy of Source');

    expect(copy.id).not.toBe(withTwoInputs.id);
    expect(copy.label).toBe('Copy of Source');
    expect(copy.revision).toBe(0);
    expect(copy.mode).toBe(withTwoInputs.mode);

    expect(copy.inputs).toHaveLength(2);
    expect(copy.inputs[0].id).not.toBe(withTwoInputs.inputs[0].id);
    expect(copy.inputs[1].id).not.toBe(withTwoInputs.inputs[1].id);
    // Shared journey grouping is preserved after remapping.
    expect(copy.inputs[0].journeyId).toBe(copy.inputs[1].journeyId);
    expect(copy.inputs[0].journeyId).not.toBe(journeyId);
    // The binding's journeyId reference tracks the same remap.
    expect(copy.inputs[1].payloadBindings[0].source.journeyId).toBe(copy.inputs[0].journeyId);
    // Document references (entry, fixtureId) are untouched by a same-document copy.
    expect(copy.inputs[0].entry).toEqual(entry);
    expect(copy.inputs[0].fixtureId).toBe(document.fixtures[0].id);
  });

  it('remaps boundary responses and their afterInputId back-reference', () => {
    const document = buildMockDocument();
    const buildMintId = makeCounterMintId(30);
    const inputId = buildMintId();
    const responseSchema = document.schemas[1];
    const source: Scenario = {
      ...logicalSourceScenario(document, buildMintId, 'S'),
      inputs: [
        {
          id: inputId,
          entry: inboundPort(document),
          fixtureId: document.fixtures[0].id,
          journeyId: buildMintId(),
          atMs: null,
          payloadBindings: [],
          resource: null,
        },
      ],
      boundaries: [
        {
          id: buildMintId(),
          source: { elementId: document.elements[0].id, portId: document.elements[0].ports[0].id },
          schemaId: responseSchema.id,
          responses: [
            {
              id: buildMintId(),
              match: { op: 'exists', value: { kind: 'literal', value: true } },
              responseFixtureId: document.fixtures[1].id,
              payloadBindings: [],
              delayMs: null,
              afterInputId: inputId,
              outcome: 'succeeded',
            },
          ],
        },
      ],
    };

    const mintCopy = makeCounterMintId(40);
    const copy = remapScenarioForCopy(source, mintCopy, 'Copy');

    expect(copy.boundaries[0].id).not.toBe(source.boundaries[0].id);
    expect(copy.boundaries[0].responses[0].id).not.toBe(source.boundaries[0].responses[0].id);
    expect(copy.boundaries[0].responses[0].afterInputId).toBe(copy.inputs[0].id);
    expect(copy.boundaries[0].responses[0].afterInputId).not.toBe(inputId);
  });
});

describe('openScenarioDraft', () => {
  it('kind:"new"/"empty" opens a clean draft with no validator issues, but with readiness issues (unrunnable, not invalid)', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(100);
    const target: ScenarioDraftTarget = { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'Traffic test' };
    const handle = openScenarioDraft({
      draftId: mintId(),
      target,
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });

    expect(handle.isNew).toBe(true);
    expect(handle.status).toBe('clean');
    expect(handle.dirty).toBe(false);
    expect(handle.scenario?.label).toBe('Traffic test');
    // An empty timed scenario is storable but not runnable yet (model-and-runner.md §1:
    // readiness errors never block saving a structurally valid design) -- readiness
    // issues are still surfaced and linked, ready for the editor to show, but they are
    // not a storable ("invalid") problem.
    expect(handle.allIssues.length).toBeGreaterThan(0);
    expect(handle.issuesBySection.assertions.length).toBeGreaterThan(0);
    // Nothing to send yet: readiness says so.
    expect(handle.allIssues.some((i) => i.message.includes('finite input or enabled workload'))).toBe(true);
  });

  it('kind:"new"/"copy" throws if the mode does not match the copy source (contract violation)', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(101);
    const source = logicalSourceScenario(document, mintId, 'Original');
    const docWithScenario: Document = { ...document, scenarios: [source] };

    expect(() =>
      openScenarioDraft({
        draftId: mintId(),
        target: { kind: 'new', mode: 'timed', from: { kind: 'copy', scenarioId: source.id }, label: 'Copy' },
        document: docWithScenario,
        baseWorkingRevision: 0,
        mintId,
        randomSource: fixedRandom,
      }),
    ).toThrow(/mode/);
  });

  it('kind:"new"/"copy" carries over a fully-authored source scenario\'s completion/keyDistribution/paths as already complete', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(103);
    const entry = inboundPort(document);
    const source: Scenario = {
      ...logicalSourceScenario(document, mintId, 'Original'),
      mode: 'timed',
      workloads: [
        {
          id: mintId(),
          entry,
          enabled: true,
          startDelayMs: 0,
          emission: { mode: 'stream', ratePerSecond: 5, profile: { kind: 'steady' } },
          timeoutMs: 30000,
          classes: [
            {
              id: mintId(),
              name: 'Reads',
              weight: 1,
              operation: 'read',
              tags: [],
              keyDistribution: { kind: 'uniform', catalogSize: 10, hotSubset: 1, hotShare: 0 },
            },
          ],
        },
      ],
    };
    const docWithScenario: Document = { ...document, scenarios: [source] };

    const handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'copy', scenarioId: source.id }, label: 'Copy of Original' },
      document: docWithScenario,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });

    expect(handle.scenario?.workloads[0].emission).toEqual({ mode: 'stream', ratePerSecond: 5, profile: { kind: 'steady' } });
    expect(handle.scenario?.workloads[0].classes[0].keyDistribution).toEqual({
      kind: 'uniform',
      catalogSize: 10,
      hotSubset: 1,
      hotShare: 0,
    });
    // No "unset" completeness issues -- everything came from an already-complete source.
    expect(
      handle.allIssues.some(
        (i) => i.message === 'Choose when the run ends' || i.message.startsWith('Choose how keys are distributed'),
      ),
    ).toBe(false);
  });

  it('kind:"edit" against a missing scenario returns a missing handle', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(102);
    const handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'edit', scenarioId: 'ffffffff-0000-4000-8000-000000000000' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    expect(handle.status).toBe('missing');
    expect(handle.scenario).toBeNull();
  });
});

describe('changeScenarioDraft / computeScenarioIssues', () => {
  it('marks the draft dirty and links a storable error to the header section', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(200);
    let handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'Ok' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });

    handle = changeScenarioDraft(handle, document, (s) => ({ ...s, label: '' }));

    expect(handle.dirty).toBe(true);
    expect(handle.status).toBe('editing');
    expect(handle.issuesBySection.header.length).toBeGreaterThan(0);
    expect(handle.allIssues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('links a readiness error (no assertions) once storable is clean', () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(210);
    const entry = inboundPort(document);
    let handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'Traffic' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });

    handle = changeScenarioDraft(handle, document, (s) => ({
      ...s,
      workloads: [
        {
          id: mintId(),
          entry,
          enabled: true,
          startDelayMs: 0,
          emission: { mode: 'stream', ratePerSecond: 10, profile: { kind: 'steady' } },
          timeoutMs: 30000,
          classes: [],
        },
      ],
    }));

    // Runnable per model-and-runner.md §6: "A qualifying scenario needs >=1 assertion" --
    // storable is clean (a workload alone is valid), so readiness now reports the
    // missing-assertion issue, linked to the 'assertions' section.
    const result = computeScenarioIssues(document, handle.scenario!, null);
    expect(result.issuesBySection.assertions.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Review round item 7: each "invents nothing" field blocks Apply until supplied.
// ============================================================================

describe('Apply is blocked until the user supplies each draft-only field (no invented defaults)', () => {
  it('workload emission: blocked while unset, then unblocked once bulk and its values are chosen', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(500);
    let handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'Emission test' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    const workload = (emission: DraftEmission): DraftWorkload => ({
      id: mintId(), entry: inboundPort(document), enabled: true, startDelayMs: 0, emission, timeoutMs: 30000, classes: [],
    });
    const assertion = {
      id: mintId(),
      label: 'ok',
      subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' } as const,
      operator: 'at-least' as const,
      expected: 0,
    };
    // Everything readiness needs, but the workload's emission is unset.
    handle = changeScenarioDraft(handle, document, (s) => ({ ...s, workloads: [workload(UNSET_EMISSION)], assertions: [assertion] }));
    expect(handle.scenario?.workloads[0].emission).toEqual({ mode: null });

    const session1 = fakeSession(document, 0);
    const blocked = await applyScenarioDraft(handle, session1);
    expect(blocked.status).toBe('invalid');
    expect(blocked.issuesBySection.traffic.some((i) => i.message === 'Choose whether this traffic is a bulk of requests or a stream')).toBe(true);
    expect(session1.getState().document?.scenarios).toHaveLength(0);

    // Choosing "bulk" but not yet typing its requests still blocks.
    const halfChosen = changeScenarioDraft(handle, document, (s) => ({
      ...s,
      workloads: [workload({ mode: 'bulk', requests: null, arrival: null })],
    }));
    const session2 = fakeSession(document, 0);
    const stillBlocked = await applyScenarioDraft(halfChosen, session2);
    expect(stillBlocked.status).toBe('invalid');
    expect(stillBlocked.issuesBySection.traffic.some((i) => i.message === 'Enter how many requests the bulk sends')).toBe(true);
    expect(stillBlocked.issuesBySection.traffic.some((i) => i.message === 'Choose how the bulk is spread')).toBe(true);

    // Filling the values unblocks Apply.
    const filled = changeScenarioDraft(halfChosen, document, (s) => ({
      ...s,
      workloads: [workload({ mode: 'bulk', requests: 100, arrival: { spreadMs: 10000 } })],
    }));
    const session3 = fakeSession(document, 0);
    const applied = await applyScenarioDraft(filled, session3);
    expect(applied.status).toBe('clean');
    expect(session3.getState().document?.scenarios[0]?.workloads[0].emission).toEqual({ mode: 'bulk', requests: 100, arrival: { spreadMs: 10000 } });
  });

  it('workload request-class keyDistribution: blocked while any of kind/catalogSize/hotSubset/hotShare is unset', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(510);
    let handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'KD test' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    handle = changeScenarioDraft(handle, document, (s) => ({
      ...s,
      workloads: [
        {
          id: mintId(),
          entry: inboundPort(document),
          enabled: true,
          startDelayMs: 0,
          emission: { mode: 'stream', ratePerSecond: 10, profile: { kind: 'steady' } },
          timeoutMs: 30000,
          classes: [
            {
              id: mintId(),
              name: 'Reads',
              weight: 1,
              operation: 'read',
              tags: [],
              keyDistribution: { kind: null, catalogSize: null, hotSubset: null, hotShare: null },
            },
          ],
        },
      ],
      assertions: [
        {
          id: mintId(),
          label: 'ok',
          subject: { kind: 'count', scope: 'root', elementId: null, outcome: 'succeeded' },
          operator: 'at-least',
          expected: 0,
        },
      ],
    }));

    const session1 = fakeSession(document, 0);
    const blocked = await applyScenarioDraft(handle, session1);
    expect(blocked.status).toBe('invalid');
    expect(blocked.issuesBySection.traffic.some((i) => i.message.startsWith('Choose how keys are distributed'))).toBe(true);

    // Partially filled (kind + catalogSize, missing hotSubset/hotShare) still blocks.
    const partial = changeScenarioDraft(handle, document, (s) => ({
      ...s,
      workloads: s.workloads.map((w) => ({
        ...w,
        classes: w.classes.map((c) => ({ ...c, keyDistribution: { kind: 'uniform' as const, catalogSize: 5, hotSubset: null, hotShare: null } })),
      })),
    }));
    const session2 = fakeSession(document, 0);
    const stillBlocked = await applyScenarioDraft(partial, session2);
    expect(stillBlocked.status).toBe('invalid');

    // Fully filled unblocks.
    const filled = changeScenarioDraft(partial, document, (s) => ({
      ...s,
      workloads: s.workloads.map((w) => ({
        ...w,
        classes: w.classes.map((c) => ({ ...c, keyDistribution: { kind: 'uniform' as const, catalogSize: 5, hotSubset: 1, hotShare: 0 } })),
      })),
    }));
    const session3 = fakeSession(document, 0);
    const applied = await applyScenarioDraft(filled, session3);
    expect(applied.status).toBe('clean');
    expect(session3.getState().document?.scenarios[0]?.workloads[0].classes[0].keyDistribution).toEqual({
      kind: 'uniform',
      catalogSize: 5,
      hotSubset: 1,
      hotShare: 0,
    });
  });

  it('assertion output/context path: blocked while unset, "Whole value" ([]) is a legitimate explicit choice', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(520);
    let handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'logical', from: { kind: 'empty' }, label: 'Path test' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    const machineElement = document.elements.find((e) => e.behavior.kind === 'machine');
    // The mock document has no machine element; use a 'context' subject pointed at any
    // element id (readiness/storable will still validate the completeness gate itself,
    // which is a draft-layer concern independent of whether the element is a machine).
    const elementId = machineElement?.id ?? document.elements[0].id;

    handle = changeScenarioDraft(handle, document, (s) => ({
      ...s,
      assertions: [
        {
          id: mintId(),
          label: 'context check',
          subject: { kind: 'context', elementId, path: null },
          operator: 'equals',
          expected: 0,
        },
      ],
    }));

    const session1 = fakeSession(document, 0);
    const blocked = await applyScenarioDraft(handle, session1);
    expect(blocked.status).toBe('invalid');
    expect(blocked.issuesBySection.assertions.some((i) => i.message.startsWith('Choose which part of the value'))).toBe(true);

    // Explicitly choosing "Whole value" ([]) is legitimate and unblocks the
    // completeness gate (readiness may still separately reject an unmodeled element,
    // which is a different, expected concern from this draft-layer test).
    const wholeValue = changeScenarioDraft(handle, document, (s) => ({
      ...s,
      assertions: s.assertions.map((a) => (a.subject.kind === 'context' ? { ...a, subject: { ...a.subject, path: [] } } : a)),
    }));
    expect(
      wholeValue.allIssues.some((i) => i.message.startsWith('Choose which part of the value')),
    ).toBe(false);
  });
});

describe('applyScenarioDraft', () => {
  it('inserts a new scenario via one model.apply-records command and returns a clean handle', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(300);
    let handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'Applied' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    handle = makeReady(handle, document, mintId);

    const session = fakeSession(document, 0);
    const result = await applyScenarioDraft(handle, session);

    expect(result.status).toBe('clean');
    expect(result.dirty).toBe(false);
    expect(result.isNew).toBe(false);
    expect(session.getState().document?.scenarios).toHaveLength(1);
    expect(session.getState().document?.scenarios[0].label).toBe('Applied');
  });

  it('blocks Apply with linked field errors when the candidate is invalid', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(310);
    let handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'Bad' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    handle = changeScenarioDraft(handle, document, (s) => ({ ...s, label: '' }));

    const session = fakeSession(document, 0);
    const result = await applyScenarioDraft(handle, session);

    expect(result.status).toBe('invalid');
    expect(result.issuesBySection.header.length).toBeGreaterThan(0);
    expect(session.getState().document?.scenarios).toHaveLength(0);
  });

  it('reports stale when the session working revision moved under the draft', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(320);
    let handle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'Stale test' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    handle = makeReady(handle, document, mintId);

    const session = fakeSession(document, 5); // baseWorkingRevision (0) != session revision (5)
    const result = await applyScenarioDraft(handle, session);

    expect(result.status).toBe('stale');
  });

  it('edit: bumps revision from the current session record, not the stale draft snapshot', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(330);
    let newHandle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'V0' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    newHandle = makeReady(newHandle, document, mintId);
    const session = fakeSession(document, 0);
    const inserted = await applyScenarioDraft(newHandle, session);
    expect(inserted.scenario?.revision).toBe(0);

    const docWithScenario = session.getState().document!;
    let editHandle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'edit', scenarioId: inserted.scenario!.id },
      document: docWithScenario,
      baseWorkingRevision: session.getState().workingRevision!,
      mintId,
      randomSource: fixedRandom,
    });
    editHandle = changeScenarioDraft(editHandle, docWithScenario, (s) => ({ ...s, label: 'V1' }));

    const editSession = fakeSession(docWithScenario, session.getState().workingRevision!);
    const editResult = await applyScenarioDraft(editHandle, editSession);

    expect(editResult.status).toBe('clean');
    expect(editResult.scenario?.revision).toBe(1);
    expect(editResult.scenario?.label).toBe('V1');
  });

  it('edit: reports stale when the target was deleted elsewhere', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(340);
    let newHandle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'To delete' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    newHandle = makeReady(newHandle, document, mintId);
    const session = fakeSession(document, 0);
    const inserted = await applyScenarioDraft(newHandle, session);
    const docWithScenario = session.getState().document!;

    let editHandle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'edit', scenarioId: inserted.scenario!.id },
      document: docWithScenario,
      baseWorkingRevision: session.getState().workingRevision!,
      mintId,
      randomSource: fixedRandom,
    });
    editHandle = changeScenarioDraft(editHandle, docWithScenario, (s) => ({ ...s, label: 'Renamed' }));

    // Simulate a concurrent deletion inside the session apply (still passes the
    // pre-check because baseWorkingRevision matches, but the scenario is gone by the
    // time apply reads the document).
    const docWithoutScenario: Document = { ...docWithScenario, scenarios: [] };
    const deletingSession: ScenarioDraftSession = {
      getState: () => ({ workingRevision: session.getState().workingRevision, document: docWithoutScenario }),
      apply: async () => ({ status: 'missing', ids: [inserted.scenario!.id] }),
    };

    const result = await applyScenarioDraft(editHandle, deletingSession);
    expect(result.status).toBe('stale');
  });
});

describe('deleteScenario', () => {
  it('submits one model.apply-records remove', async () => {
    const document = buildMockDocument();
    const mintId = makeCounterMintId(400);
    let newHandle = openScenarioDraft({
      draftId: mintId(),
      target: { kind: 'new', mode: 'timed', from: { kind: 'empty' }, label: 'Delete me' },
      document,
      baseWorkingRevision: 0,
      mintId,
      randomSource: fixedRandom,
    });
    newHandle = makeReady(newHandle, document, mintId);
    const session = fakeSession(document, 0);
    const inserted = await applyScenarioDraft(newHandle, session);
    expect(session.getState().document?.scenarios).toHaveLength(1);

    const result = await deleteScenario(inserted.scenario!.id, inserted.scenario!.label, session);
    expect(result.status).toBe('applied');
    expect(session.getState().document?.scenarios).toHaveLength(0);
  });
});

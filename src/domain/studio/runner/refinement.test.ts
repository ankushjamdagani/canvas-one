/**
 * Refinement selection (RV-14f, model-and-runner.md §6 "Refinement").
 *
 * "Aggregate runs the owner and excludes members; refined runs the members and excludes
 * the owner (port mappings route crossings). Nesting within budgets. Unselected elements
 * stay uncovered in RunSummary.coverage. Running both paths, or mismatched mappings, is
 * invalid. View expand/collapse never changes the trace or the fingerprint."
 *
 * Test-local document variants (§11: "The fixture has NO refinements: cover refinement
 * with test-local document variants") — a small logical document with a "Caller" decision
 * driving a refined subsystem (an "Owner" decision, aggregate-selected, or a "Member"
 * decision reached through a port mapping, refined-selected), so aggregate vs refined
 * coverage/outcome is observable directly from which element's output port received the
 * value.
 *
 * CONTRACT GAP (narrowed reading): the runner's port-remap (scenario-runner.ts
 * `resolveRefinements`) resolves one level of outer -> inner mapping; a doubly-nested
 * refinement (a member that is itself an owner of a further refinement) is not
 * chain-resolved here. Full nested resolution belongs to `computeClosure`'s reachability
 * walk (closure.ts, off limits for this task); S05 carries no refinements to exercise
 * nesting against, so this narrower single-level resolution is what's tested.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runScenario } from './scenario-runner';
import { prepareScenario } from './compile';
import { buildManifest, type BuildManifestVersions } from '../manifest';
import { canonicalJson } from '../canonical';
import { computeClosure } from '../closure';
import type { AuthoredSnapshot } from './types';
import type { Document, Element, Connection, Scenario, Refinement, Selection } from '../model';

const FIXTURES_DIR = join(process.cwd(), 'specs/revamp/fixtures');
function loadFixture(name: string): Document {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

const VERSIONS: BuildManifestVersions = {
  compilerVersion: '0.1.0',
  runnerVersions: [
    { runnerId: 'resource-kernel', version: '0.1.0' },
    { runnerId: 'bridge', version: '0.1.0' },
  ],
};

// ============================================================================
// A tiny logical document: Caller -> (Owner | Member, via refinement) echoes its input.
// ============================================================================

const INT_SCHEMA_ID = 'schema-int';

function decisionElement(id: string, inPort: string, outPort: string): Element {
  return {
    id,
    label: id,
    description: '',
    visualKind: 'service',
    ports: [
      { id: inPort, label: 'in', direction: 'in', channel: 'data', schemaId: INT_SCHEMA_ID, responseSchemaId: null },
      { id: outPort, label: 'out', direction: 'out', channel: 'data', schemaId: INT_SCHEMA_ID, responseSchemaId: null },
    ],
    behavior: {
      kind: 'decision',
      version: 1,
      inputSchemaId: INT_SCHEMA_ID,
      inputPortId: inPort,
      cases: [
        {
          id: `${id}-case`,
          guard: { op: 'exists', value: { kind: 'read', source: 'input', path: [] } },
          outputPortId: outPort,
          value: { kind: 'read', source: 'input', path: [] },
        },
      ],
      fallback: { outputPortId: outPort, value: { kind: 'read', source: 'input', path: [] } },
    },
  };
}

function dataConnection(id: string, sourceEl: string, sourcePort: string, targetEl: string, targetPort: string): Connection {
  return {
    id,
    label: id,
    kind: 'data',
    source: { elementId: sourceEl, portId: sourcePort },
    target: { elementId: targetEl, portId: targetPort },
    config: {},
  };
}

function baseDocument(refinements: Refinement[], connections: Connection[]): Document {
  const caller = decisionElement('caller', 'caller-in', 'caller-out');
  const owner = decisionElement('owner', 'owner-in', 'owner-out');
  const member = decisionElement('member', 'member-in', 'member-out');

  return {
    schema: 'studio-model/1',
    id: 'doc-refinement-test',
    title: 'Refinement test document',
    elements: [caller, owner, member],
    connections,
    relations: [],
    schemas: [{ id: INT_SCHEMA_ID, label: 'int', shape: { type: 'integer', nullable: false } }],
    fixtures: [{ id: 'fixture-1', schemaId: INT_SCHEMA_ID, value: 7 }],
    refinements,
    scenarios: [],
    views: [],
  };
}

function scenarioFor(refinementSelections: Selection[]): Scenario {
  return {
    id: 'scenario-1',
    label: 'refinement test',
    revision: 1,
    mode: 'logical',
    scopeElementIds: ['caller', 'owner', 'member'],
    entryPorts: [{ elementId: 'caller', portId: 'caller-in' }],
    inputs: [
      {
        id: 'input-1',
        entry: { elementId: 'caller', portId: 'caller-in' },
        fixtureId: 'fixture-1',
        journeyId: 'journey-1',
        atMs: null,
        payloadBindings: [],
        resource: null,
      },
    ],
    workloads: [],
    faults: [],
    boundaries: [],
    refinementSelections,
    initialContexts: [],
    assertions: [],
    seed: 1,
    budgets: { maxEvents: 1000, maxTraceRows: 1000, maxTraceBytes: 1_000_000, maxScheduledEvents: 1000, maxLiveRoots: 1000 },
    completion: { kind: 'quiescent' },
    assumptions: [],
  };
}

const refinement: Refinement = {
  id: 'refinement-1',
  ownerElementId: 'owner',
  memberElementIds: ['member'],
  portMappings: [{ id: 'pm-1', outer: { elementId: 'owner', portId: 'owner-in' }, inner: { elementId: 'member', portId: 'member-in' } }],
};

function docWith(selections: Selection[]): { document: Document; scenario: Scenario } {
  const connections = [dataConnection('caller-to-owner', 'caller', 'caller-out', 'owner', 'owner-in')];
  const document = baseDocument([refinement], connections);
  const scenario = scenarioFor(selections);
  return { document: { ...document, scenarios: [scenario] }, scenario };
}

function outputValueAt(outputs: readonly { port: { elementId: string; portId: string }; values: readonly unknown[] }[], elementId: string) {
  return outputs.find((o) => o.port.elementId === elementId)?.values ?? [];
}

function nestedDocument(selections: Selection[], includeThirdLevel = false): Document {
  const elementIds = includeThirdLevel
    ? ['caller', 'outer-owner', 'inner-owner', 'deep-owner', 'deep-member', 'sink']
    : ['caller', 'outer-owner', 'inner-owner', 'deep-owner', 'sink'];
  const elements = elementIds.map((id) => decisionElement(id, `${id}-in`, `${id}-out`));
  const makeRefinement = (id: string, ownerId: string, memberId: string): Refinement => ({
    id,
    ownerElementId: ownerId,
    memberElementIds: [memberId],
    portMappings: [
      {
        id: `${id}-in-map`,
        outer: { elementId: ownerId, portId: `${ownerId}-in` },
        inner: { elementId: memberId, portId: `${memberId}-in` },
      },
      {
        id: `${id}-out-map`,
        outer: { elementId: ownerId, portId: `${ownerId}-out` },
        inner: { elementId: memberId, portId: `${memberId}-out` },
      },
    ],
  });
  const refinements = [
    makeRefinement('outer-refinement', 'outer-owner', 'inner-owner'),
    makeRefinement('inner-refinement', 'inner-owner', 'deep-owner'),
  ];
  if (includeThirdLevel) {
    refinements.push(makeRefinement('deep-refinement', 'deep-owner', 'deep-member'));
  }
  const nestedScenario: Scenario = {
    ...scenarioFor(selections),
    scopeElementIds: elementIds,
  };
  return {
    schema: 'studio-model/1',
    id: 'nested-refinement-document',
    title: 'Nested refinement test',
    elements,
    connections: [
      dataConnection('caller-to-outer', 'caller', 'caller-out', 'outer-owner', 'outer-owner-in'),
      dataConnection('outer-to-sink', 'outer-owner', 'outer-owner-out', 'sink', 'sink-in'),
    ],
    relations: [],
    schemas: [{ id: INT_SCHEMA_ID, label: 'int', shape: { type: 'integer', nullable: false } }],
    fixtures: [{ id: 'fixture-1', schemaId: INT_SCHEMA_ID, value: 7 }],
    refinements,
    scenarios: [nestedScenario],
    views: [],
  };
}

describe('Refinement selection (RV-14f, §6)', () => {
  it('aggregate mode runs the owner and excludes the member: coverage and outputs reflect the owner only', async () => {
    const { document, scenario } = docWith([{ refinementId: 'refinement-1', mode: 'aggregate' }]);
    const result = await runScenario(document, scenario.id, 'run-aggregate');

    expect(result.status).toBe('completed');
    expect(outputValueAt(result.summary.outputs, 'owner')).toEqual([7]);
    expect(outputValueAt(result.summary.outputs, 'member')).toEqual([]);

    expect(result.summary.coverage.excludedElementIds).toEqual(['member']);
    expect(result.summary.coverage.includedElementIds).toEqual(expect.arrayContaining(['caller', 'owner']));
    expect(result.summary.coverage.includedElementIds).not.toContain('member');
  });

  it('refined mode runs the member (through the port mapping) and excludes the owner: coverage and outputs reflect the member only', async () => {
    const { document, scenario } = docWith([{ refinementId: 'refinement-1', mode: 'refined' }]);
    const result = await runScenario(document, scenario.id, 'run-refined');

    expect(result.status).toBe('completed');
    expect(outputValueAt(result.summary.outputs, 'member')).toEqual([7]);
    expect(outputValueAt(result.summary.outputs, 'owner')).toEqual([]);

    expect(result.summary.coverage.excludedElementIds).toEqual(['owner']);
    expect(result.summary.coverage.includedElementIds).toEqual(expect.arrayContaining(['caller', 'member']));
    expect(result.summary.coverage.includedElementIds).not.toContain('owner');
  });

  it('an unselected refinement leaves both the owner and members as ordinary elements (neither aggregate nor refined applies)', async () => {
    const { document, scenario } = docWith([]);
    const result = await runScenario(document, scenario.id, 'run-unselected');

    expect(result.status).toBe('completed');
    // No selection: the connection into the owner runs the owner directly, unaffected by
    // the refinement's existence, and nothing is marked excluded.
    expect(outputValueAt(result.summary.outputs, 'owner')).toEqual([7]);
    expect(result.summary.coverage.excludedElementIds).toEqual([]);
  });

  it('running both paths for the same refinement (two selections) is invalid', async () => {
    const { document, scenario } = docWith([
      { refinementId: 'refinement-1', mode: 'aggregate' },
      { refinementId: 'refinement-1', mode: 'refined' },
    ]);
    const result = await runScenario(document, scenario.id, 'run-both-paths');

    expect(result.status).toBe('invalid');
    expect(result.reason).toMatch(/running both paths is invalid/i);
  });

  it('an unknown refinement selection keeps the existing invalid-selection error', async () => {
    const { document, scenario } = docWith([{ refinementId: 'missing-refinement', mode: 'refined' }]);
    const result = await runScenario(document, scenario.id, 'run-unknown-refinement');

    expect(result.status).toBe('invalid');
    expect(result.reason).toBe("Refinement selection references unknown refinement 'missing-refinement'");
  });

  it('a refined selection whose owner has a crossing connection with no compatible port mapping is invalid', async () => {
    const mismatchedRefinement: Refinement = { ...refinement, portMappings: [] };
    const connections = [dataConnection('caller-to-owner', 'caller', 'caller-out', 'owner', 'owner-in')];
    const document: Document = { ...baseDocument([mismatchedRefinement], connections), scenarios: [] };
    const scenario = scenarioFor([{ refinementId: 'refinement-1', mode: 'refined' }]);
    const fullDocument: Document = { ...document, scenarios: [scenario] };

    const result = await runScenario(fullDocument, scenario.id, 'run-mismatched');

    expect(result.status).toBe('invalid');
    expect(result.reason).toMatch(/no compatible port mapping/i);
  });

  it.each([
    ['aggregate', 'aggregate', 'outer-owner'],
    ['aggregate', 'refined', 'outer-owner'],
    ['refined', 'aggregate', 'inner-owner'],
    ['refined', 'refined', 'deep-owner'],
  ] as const)(
    'keeps runner execution equal to closure for outer %s and inner %s',
    async (outerMode, innerMode, executedOwner) => {
      const document = nestedDocument([
        { refinementId: 'outer-refinement', mode: outerMode },
        { refinementId: 'inner-refinement', mode: innerMode },
      ]);
      const closure = computeClosure(document, 'scenario-1');
      const result = await runScenario(document, 'scenario-1', `run-${outerMode}-${innerMode}`);

      expect(closure.status).toBe('ok');
      expect(result.status).toBe('completed');
      if (closure.status === 'ok') {
        expect([...result.summary.coverage.includedElementIds].sort()).toEqual(closure.includedElementIds);
      }
      expect(outputValueAt(result.summary.outputs, executedOwner)).toEqual([7]);
      expect(outputValueAt(result.summary.outputs, 'sink')).toEqual([7]);
    },
  );

  it('executes the deepest member through three refinement levels and mirrors its outer-authored emission', async () => {
    const document = nestedDocument(
      [
        { refinementId: 'outer-refinement', mode: 'refined' },
        { refinementId: 'inner-refinement', mode: 'refined' },
        { refinementId: 'deep-refinement', mode: 'refined' },
      ],
      true,
    );
    const closure = computeClosure(document, 'scenario-1');
    const result = await runScenario(document, 'scenario-1', 'run-three-level');

    expect(closure.status).toBe('ok');
    expect(result.status).toBe('completed');
    if (closure.status === 'ok') {
      expect([...result.summary.coverage.includedElementIds].sort()).toEqual(closure.includedElementIds);
    }
    expect(outputValueAt(result.summary.outputs, 'deep-member')).toEqual([7]);
    expect(outputValueAt(result.summary.outputs, 'sink')).toEqual([7]);
  });

  it('keeps the event budget cumulative across three refinement levels', async () => {
    const document = nestedDocument(
      [
        { refinementId: 'outer-refinement', mode: 'refined' },
        { refinementId: 'inner-refinement', mode: 'refined' },
        { refinementId: 'deep-refinement', mode: 'refined' },
      ],
      true,
    );
    const budgeted: Document = {
      ...document,
      scenarios: document.scenarios.map((candidate) => ({
        ...candidate,
        budgets: { ...candidate.budgets, maxEvents: 2 },
      })),
    };
    const nearLimit: Document = {
      ...document,
      scenarios: document.scenarios.map((candidate) => ({
        ...candidate,
        budgets: { ...candidate.budgets, maxEvents: 5 },
      })),
    };

    const result = await runScenario(budgeted, 'scenario-1', 'run-three-level-budget');
    const nearLimitResult = await runScenario(nearLimit, 'scenario-1', 'run-three-level-near-budget');

    expect(result.status).toBe('incomplete');
    expect(result.reason).toMatch(/maxEvents limit reached/i);
    // The terminating over-budget attempt is counted, while no fresh budget is created
    // as routing descends through refinement levels.
    expect(result.summary.processedEvents).toBe(3);
    expect(nearLimitResult.status).toBe('completed');
    expect(nearLimitResult.summary.processedEvents).toBe(4);
  });

  it('reports an unmapped crossing at depth two through invalid-refinement-selection', async () => {
    const document = nestedDocument([
      { refinementId: 'outer-refinement', mode: 'refined' },
      { refinementId: 'inner-refinement', mode: 'refined' },
    ]);
    const inner = document.refinements.find((candidate) => candidate.id === 'inner-refinement')!;
    const withoutInnerMappings: Document = {
      ...document,
      refinements: document.refinements.map((candidate) =>
        candidate.id === inner.id ? { ...candidate, portMappings: [] } : candidate,
      ),
    };
    const result = await runScenario(withoutInnerMappings, 'scenario-1', 'run-depth-two-unmapped');

    expect(result.status).toBe('invalid');
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid-refinement-selection' })]),
    );
    expect(result.reason).toMatch(/inner-refinement.*no compatible port mapping/i);
  });

  it('a views-only change (expand/collapse) never changes the trace or the fingerprint', async () => {
    const doc = loadFixture('s02.json');
    const allowScenarioId = doc.scenarios.find((s) => s.label === 'allow')!.id;

    const cloned = structuredClone(doc);
    const expanded: Document = {
      ...cloned,
      views: cloned.views.map((v, vi) =>
        vi === 0 ? { ...v, placements: v.placements.map((p, pi) => (pi === 0 ? { ...p, expanded: true } : p)) } : v,
      ),
    };

    const controller = new AbortController();
    const snapshotA: AuthoredSnapshot = { id: 'snap-a', document: doc };
    const snapshotB: AuthoredSnapshot = { id: 'snap-b', document: expanded };

    const resultA = await prepareScenario(snapshotA, allowScenarioId, controller.signal, VERSIONS);
    const resultB = await prepareScenario(snapshotB, allowScenarioId, controller.signal, VERSIONS);
    expect(resultA.status).toBe('ready');
    expect(resultB.status).toBe('ready');
    if (resultA.status === 'ready' && resultB.status === 'ready') {
      expect(resultB.fingerprint).toBe(resultA.fingerprint);
    }

    const directA = await buildManifest(doc, allowScenarioId, VERSIONS);
    const directB = await buildManifest(expanded, allowScenarioId, VERSIONS);
    expect(directA.status).toBe('ok');
    expect(directB.status).toBe('ok');
    if (directA.status === 'ok' && directB.status === 'ok') {
      expect(directB.fingerprint).toBe(directA.fingerprint);
    }

    const runA = await runScenario(doc, allowScenarioId, '00000000-0000-0000-0000-0000000000e1');
    const runB = await runScenario(expanded, allowScenarioId, '00000000-0000-0000-0000-0000000000e1');

    const canonA = canonicalJson(runA.events);
    const canonB = canonicalJson(runB.events);
    expect(canonA.ok && canonB.ok).toBe(true);
    if (canonA.ok && canonB.ok) {
      expect(canonB.text).toBe(canonA.text);
    }
    expect(runA.status).toBe(runB.status);
    expect(canonicalJson(runA.summary)).toEqual(canonicalJson(runB.summary));
  });
});

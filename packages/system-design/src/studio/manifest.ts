/**
 * Execution manifest v1 builder and run fingerprint.
 *
 * Assumes `doc` already passed `validateDocument` (storable level); `buildManifest`
 * calls `checkReadiness` itself, which computes the scope closure.
 *
 * Projection approach: every manifest record is built by allow-listing the E (execution)
 * fields of the authored record and not copying the A (presentation) fields. Because
 * TypeScript's structural types don't stop an `as any`-widened record from carrying a
 * new, unclassified field, each record kind that has at least one A field to drop is also
 * checked at runtime against a closed key set (`assertClosedKeys`) listing every field
 * known to be A or E for that record. An unrecognized key throws instead of silently
 * landing on either side of the projection. Fixture, Refinement and Behavior have no A
 * fields (every field is E), so they are copied whole with no closed-key check.
 */

import type {
  Document,
  Id,
  Json,
  Endpoint,
  Element,
  Port,
  PortDirection,
  PortChannel,
  PayloadSchema,
  Shape,
  Connection,
  ConnectionKind,
  DataConnectionConfig,
  CallConnectionConfig,
  MessageConnectionConfig,
  PortSettings,
  Relation,
  Refinement,
  PortMapping,
  Fixture,
  Assertion,
  AssertionSubject,
  AssertionOperator,
  Assumption,
  AssumptionSource,
  RequestClass,
  KeyDistribution,
  Workload,
  Fault,
  Boundary,
  Selection,
  InitialContext,
  Input,
  ScenarioMode,
  ScenarioBudgets,
  Emission,
} from './model.js';
import { checkReadiness, type ReadinessIssue } from './readiness.js';
import { canonicalJson, sha256Hex } from './canonical.js';

// ============================================================================
// Execution manifest v1 shape
// ============================================================================

export type ManifestRunnerVersion = {
  readonly runnerId: string;
  readonly version: string;
};

export type ManifestPort = {
  readonly id: Id;
  readonly direction: PortDirection;
  readonly channel: PortChannel;
  readonly schemaId: Id;
  readonly responseSchemaId: Id | null;
  /** Only the settings that change what a run does (see `manifestSettings`). */
  readonly settings?: Record<string, unknown>;
};

export type ManifestElement = {
  readonly id: Id;
  readonly ports: readonly ManifestPort[];
  readonly behavior: Element['behavior'];
};

export type ManifestSchema = {
  readonly id: Id;
  readonly shape: Shape;
};

export type ManifestConnection = {
  readonly id: Id;
  readonly kind: ConnectionKind;
  readonly source: Endpoint;
  readonly target: Endpoint;
  readonly config: DataConnectionConfig | Omit<CallConnectionConfig, 'linkClass'> | Omit<MessageConnectionConfig, 'linkClass'>;
};

export type ManifestStructuralConstraint =
  | { readonly id: Id; readonly kind: 'contains'; readonly parentId: Id; readonly childId: Id }
  | { readonly id: Id; readonly kind: 'deployed-on'; readonly elementId: Id; readonly hostId: Id };

export type ManifestRefinement = {
  readonly refinementId: Id;
  readonly mode: Selection['mode'];
  readonly ownerElementId: Id;
  readonly memberElementIds: readonly Id[];
  readonly portMappings: readonly PortMapping[];
};

export type ManifestFixture = {
  readonly id: Id;
  readonly schemaId: Id;
  readonly value: Json;
  readonly sha256: string;
};

export type ManifestAssertion = {
  readonly id: Id;
  readonly subject: AssertionSubject;
  readonly operator: AssertionOperator;
  readonly expected: Json;
};

export type ManifestAssumption = {
  readonly key: string;
  readonly value: Json;
  readonly source: AssumptionSource;
};

export type ManifestRequestClass = {
  readonly id: Id;
  readonly weight: number;
  readonly operation: 'read' | 'write';
  readonly tags: readonly string[];
  readonly keyDistribution: KeyDistribution;
};

export type ManifestWorkload = {
  readonly id: Id;
  readonly entry: Endpoint;
  readonly enabled: boolean;
  readonly startDelayMs: number;
  readonly emission: Emission;
  readonly timeoutMs: number;
  readonly classes: readonly ManifestRequestClass[];
};

export type ManifestScenario = {
  readonly id: Id;
  readonly revision: number;
  readonly mode: ScenarioMode;
  readonly scopeElementIds: readonly Id[];
  readonly entryPorts: readonly Endpoint[];
  readonly inputs: readonly Input[];
  readonly workloads: readonly ManifestWorkload[];
  readonly faults: readonly Fault[];
  readonly boundaries: readonly Boundary[];
  readonly refinementSelections: readonly Selection[];
  readonly initialContexts: readonly InitialContext[];
  readonly assertions: readonly ManifestAssertion[];
  readonly seed: number;
  readonly budgets: ScenarioBudgets;
  readonly assumptions: readonly ManifestAssumption[];
};

export type ManifestScope = {
  readonly declaredElementIds: readonly Id[];
  readonly includedElementIds: readonly Id[];
  readonly includedConnectionIds: readonly Id[];
  readonly boundaryIds: readonly Id[];
  readonly excludedElementIds: readonly Id[];
};

export type ExecutionManifest = {
  readonly identityVersion: 1;
  readonly modelSchemaVersion: 'studio-model/1';
  readonly compilerVersion: string;
  readonly runnerVersions: readonly ManifestRunnerVersion[];
  readonly scenario: ManifestScenario;
  readonly scope: ManifestScope;
  readonly elements: readonly ManifestElement[];
  readonly schemas: readonly ManifestSchema[];
  readonly connections: readonly ManifestConnection[];
  readonly structuralConstraints: readonly ManifestStructuralConstraint[];
  readonly refinements: readonly ManifestRefinement[];
  readonly fixtures: readonly ManifestFixture[];
};

// ============================================================================
// buildManifest
// ============================================================================

export type BuildManifestVersions = {
  readonly compilerVersion: string;
  readonly runnerVersions: readonly ManifestRunnerVersion[];
};

export type BuildManifestResult =
  | { readonly status: 'ok'; readonly manifest: ExecutionManifest; readonly fingerprint: string }
  | { readonly status: 'not-ready'; readonly issues: readonly ReadinessIssue[] }
  | { readonly status: 'identity-unavailable' }
  | { readonly status: 'analysis-limit' }
  | { readonly status: 'cancelled' };

// ----------------------------------------------------------------------------
// Closed key-set classification guard: adding an unclassified field fails loudly.
// ----------------------------------------------------------------------------

/**
 * Throws if `obj` carries any key not in `knownKeys`. Every key here — whether it ends
 * up on the A (dropped) or E (kept) side of the projection — must be listed; an
 * unrecognized key means the projection hasn't classified it yet, so the
 * manifest builder refuses to guess and fails loudly instead.
 */
function assertClosedKeys(obj: Record<string, unknown>, knownKeys: readonly string[], recordLabel: string, entityId: string | number | null): void {
  const known = new Set(knownKeys);
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) {
      throw new Error(
        `buildManifest: unclassified field '${key}' on ${recordLabel} record` +
          (entityId !== null ? ` '${entityId}'` : '') +
          ` — classify it as A (drop) or E (keep) in the projection inventory and this builder before compiling`,
      );
    }
  }
}

// Element / Port: label, description and visualKind are A on Element; label is A on Port; the rest is E.
// `linkedProjectId` is a drop-class key too, so a link never changes a run's identity.
const ELEMENT_KEYS = ['id', 'label', 'description', 'visualKind', 'ports', 'behavior', 'linkedProjectId', 'component'] as const;
const PORT_KEYS = ['id', 'label', 'direction', 'channel', 'schemaId', 'responseSchemaId', 'protocol', 'path', 'settings'] as const;

// Port settings. E (kept in the manifest) changes what a run does; A (dropped) is a declared
// expectation or presentation. Anything not listed here throws, like every other record.
const SETTINGS_KEPT: Readonly<Record<string, readonly string[]>> = {
  'in:call': ['rateLimit', 'failureRate', 'serviceTimeMs', 'maxConcurrency', 'responseBytes'],
  'in:message': ['ackDelayMs', 'messageTtlMs'],
  'in:data': [],
  'out:call': ['retry', 'circuitBreaker', 'maxInFlight', 'hedge', 'requestBytes'],
  'out:message': ['confirm', 'batch', 'requestBytes'],
};
const SETTINGS_DROPPED: Readonly<Record<string, readonly string[]>> = {
  'in:call': ['expectedP95Ms', 'availabilityPct', 'idempotent'],
  'in:message': ['delivery', 'ordering'],
  'in:data': ['throughputPerSec', 'maxStalenessMs'],
  'out:call': [],
  'out:message': [],
};

function manifestSettings(port: Port): Record<string, unknown> | undefined {
  if (port.settings === undefined) return undefined;
  const group = `${port.direction}:${port.channel}`;
  const kept = SETTINGS_KEPT[group] ?? [];
  const dropped = SETTINGS_DROPPED[group] ?? [];
  const settings = port.settings as Record<string, unknown>;
  assertClosedKeys(settings, [...kept, ...dropped], 'PortSettings', port.id);
  const result: Record<string, unknown> = {};
  for (const key of kept) {
    if (settings[key] !== undefined) result[key] = settings[key];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
// PayloadSchema: label is A; everything else, including IDs, is E.
const PAYLOAD_SCHEMA_KEYS = ['id', 'label', 'shape'] as const;
// Connection / Relation: label is A, and descriptive relations are dropped entirely; executable fields are E.
const CONNECTION_KEYS = ['id', 'kind', 'source', 'target', 'config'] as const;
const CONTAINS_RELATION_KEYS = ['id', 'label', 'kind', 'parentId', 'childId'] as const;
const DEPLOYED_ON_RELATION_KEYS = ['id', 'label', 'kind', 'elementId', 'hostId'] as const;
// Assertion / Assumption: label / description are A; everything else is E.
const ASSERTION_KEYS = ['id', 'label', 'subject', 'operator', 'expected'] as const;
const ASSUMPTION_KEYS = ['id', 'key', 'value', 'source', 'description'] as const;
// Workload / RequestClass: class name is A; everything else is E, including enablement, tags and class order.
const WORKLOAD_KEYS = ['id', 'entry', 'enabled', 'startDelayMs', 'emission', 'timeoutMs', 'classes'] as const;
const REQUEST_CLASS_KEYS = ['id', 'name', 'weight', 'operation', 'tags', 'keyDistribution'] as const;
// Scenario: label is A; everything else is E. Scope lists are sorted as sets; inputs, faults,
// operations and transitions stay ordered.
const SCENARIO_KEYS = [
  'id', 'label', 'revision', 'mode', 'scopeElementIds', 'entryPorts', 'inputs', 'workloads',
  'faults', 'boundaries', 'refinementSelections', 'initialContexts', 'assertions', 'seed',
  'budgets', 'assumptions',
] as const;

function byId(a: { readonly id: Id }, b: { readonly id: Id }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Builds the execution manifest v1 for one scenario of an (already storable-valid)
 * document, and computes its fingerprint (`ss-run-v1:` + lowercase
 * hex SHA-256 of canonical-json-v1(manifest)).
 *
 * Readiness (unresolved crossings, missing targets and unsupported
 * relation kinds fail before fingerprinting) is checked first via
 * `checkReadiness`, which also computes the scope closure this manifest is built from.
 */
export async function buildManifest(
  doc: Document,
  scenarioId: Id,
  versions: BuildManifestVersions,
): Promise<BuildManifestResult> {
  const readiness = checkReadiness(doc, scenarioId);

  if (!readiness.ready) {
    // computeClosure surfaces 'analysis-limit'/'cancelled' through
    // checkReadiness as single-issue not-ready results with these specific codes; widen
    // them back out to their own top-level statuses per this function's contract.
    if (readiness.issues.length === 1 && readiness.issues[0].code === 'compiler-analysis-limit') {
      return { status: 'analysis-limit' };
    }
    if (readiness.issues.length === 1 && readiness.issues[0].code === 'compiler-cancelled') {
      return { status: 'cancelled' };
    }
    return { status: 'not-ready', issues: readiness.issues };
  }

  const closure = readiness.closure;
  const scenario = doc.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) {
    // Unreachable in practice: checkReadiness would already have failed to find the
    // scenario and returned not-ready via computeClosure's 'missing-target'.
    return {
      status: 'not-ready',
      issues: [{ code: 'missing-target', path: ['scenarios'], entityId: scenarioId, severity: 'error', message: `Scenario '${scenarioId}' not found` }],
    };
  }

  // --------------------------------------------------------------------------
  // elements: [{ id, ports: [{id, direction, channel, schemaId, responseSchemaId}], behavior }]
  // --------------------------------------------------------------------------
  const elementsById = new Map<Id, Element>(doc.elements.map((e) => [e.id, e]));
  const elements: ManifestElement[] = closure.includedElementIds.map((id) => {
    const el = elementsById.get(id);
    if (!el) throw new Error(`buildManifest: included element '${id}' missing from document (invariant violated)`);
    assertClosedKeys(el as unknown as Record<string, unknown>, ELEMENT_KEYS, 'Element', el.id);
    const ports: ManifestPort[] = el.ports.map((p: Port) => {
      assertClosedKeys(p as unknown as Record<string, unknown>, PORT_KEYS, 'Port', p.id);
      const settings = manifestSettings(p);
      return {
        id: p.id,
        direction: p.direction,
        channel: p.channel,
        schemaId: p.schemaId,
        responseSchemaId: p.responseSchemaId,
        ...(settings ? { settings } : {}),
      };
    });
    return { id: el.id, ports, behavior: el.behavior };
  }).sort(byId);

  // --------------------------------------------------------------------------
  // schemas: [{ id, shape }] (field ids kept, labels dropped)
  // --------------------------------------------------------------------------
  const schemasById = new Map<Id, PayloadSchema>(doc.schemas.map((s) => [s.id, s]));
  const schemas: ManifestSchema[] = closure.schemaIds.map((id) => {
    const sc = schemasById.get(id);
    if (!sc) throw new Error(`buildManifest: referenced schema '${id}' missing from document (invariant violated)`);
    assertClosedKeys(sc as unknown as Record<string, unknown>, PAYLOAD_SCHEMA_KEYS, 'PayloadSchema', sc.id);
    return { id: sc.id, shape: sc.shape };
  }).sort(byId);

  // --------------------------------------------------------------------------
  // connections: [{ id, kind, source, target, config }]
  // --------------------------------------------------------------------------
  const connectionsById = new Map<Id, Connection>(doc.connections.map((c) => [c.id, c]));
  const connections: ManifestConnection[] = closure.includedConnectionIds.map((id) => {
    const c = connectionsById.get(id);
    if (!c) throw new Error(`buildManifest: included connection '${id}' missing from document (invariant violated)`);
    assertClosedKeys(c as unknown as Record<string, unknown>, CONNECTION_KEYS, 'Connection', c.id);
    // linkClass is the preset the latencies came from: presentation, dropped.
    let config: ManifestConnection['config'] = c.config;
    if (c.kind !== 'data') {
      const { linkClass: _linkClass, ...rest } = c.config;
      config = rest;
    }
    return { id: c.id, kind: c.kind, source: c.source, target: c.target, config };
  }).sort(byId);

  // --------------------------------------------------------------------------
  // structuralConstraints: only relations interpreted by compiler rules (closure has
  // already restricted structuralRelationIds to 'contains'-when-refined and
  // 'deployed-on'-when-placement-used); descriptive relations never appear here.
  // --------------------------------------------------------------------------
  const relationsById = new Map<Id, Relation>(doc.relations.map((r) => [r.id, r]));
  const structuralConstraints: ManifestStructuralConstraint[] = closure.structuralRelationIds.map((id) => {
    const r = relationsById.get(id);
    if (!r) throw new Error(`buildManifest: included relation '${id}' missing from document (invariant violated)`);
    if (r.kind === 'contains') {
      assertClosedKeys(r as unknown as Record<string, unknown>, CONTAINS_RELATION_KEYS, 'ContainsRelation', r.id);
      return { id: r.id, kind: 'contains' as const, parentId: r.parentId, childId: r.childId };
    }
    if (r.kind === 'deployed-on') {
      assertClosedKeys(r as unknown as Record<string, unknown>, DEPLOYED_ON_RELATION_KEYS, 'DeployedOnRelation', r.id);
      return { id: r.id, kind: 'deployed-on' as const, elementId: r.elementId, hostId: r.hostId };
    }
    throw new Error(`buildManifest: closure included an unsupported structural relation kind '${(r as { kind: string }).kind}' (invariant violated)`);
  }).sort(byId);

  // --------------------------------------------------------------------------
  // refinements: one aggregate/refined choice per selected element (Refinement has no A
  // fields, so
  // ownerElementId/memberElementIds/portMappings are copied through whole).
  // --------------------------------------------------------------------------
  const refinementsById = new Map<Id, Refinement>(doc.refinements.map((r) => [r.id, r]));
  const refinements: ManifestRefinement[] = scenario.refinementSelections.map((sel) => {
    const ref = refinementsById.get(sel.refinementId);
    if (!ref) throw new Error(`buildManifest: refinement selection '${sel.refinementId}' missing from document (invariant violated)`);
    return {
      refinementId: sel.refinementId,
      mode: sel.mode,
      ownerElementId: ref.ownerElementId,
      memberElementIds: ref.memberElementIds,
      portMappings: ref.portMappings,
    };
  }).sort((a, b) => (a.refinementId < b.refinementId ? -1 : a.refinementId > b.refinementId ? 1 : 0));

  // --------------------------------------------------------------------------
  // fixtures: [{ id, schemaId, value, sha256 }] -- content-addressed (Fixture has no A
  // fields either, so id/schemaId/value are copied through whole).
  // --------------------------------------------------------------------------
  const fixturesById = new Map<Id, Fixture>(doc.fixtures.map((f) => [f.id, f]));
  const sortedFixtureIds = [...closure.fixtureIds].sort();
  let fixtures: ManifestFixture[];
  try {
    fixtures = await Promise.all(
      sortedFixtureIds.map(async (id) => {
        const f = fixturesById.get(id);
        if (!f) throw new Error(`buildManifest: referenced fixture '${id}' missing from document (invariant violated)`);
        const canon = canonicalJson(f.value);
        if (!canon.ok) {
          throw new Error(`buildManifest: fixture '${id}' value failed canonical-json-v1 encoding (should be unreachable post-validation)`);
        }
        const sha256 = await sha256Hex(canon.text);
        return { id: f.id, schemaId: f.schemaId, value: f.value, sha256 };
      }),
    );
  } catch (err) {
    if (err instanceof Error && /Web Crypto/.test(err.message)) {
      return { status: 'identity-unavailable' };
    }
    throw err;
  }
  fixtures.sort(byId);

  // --------------------------------------------------------------------------
  // scenario projection. Scope lists are sorted as sets; inputs, faults, operations and
  // transitions stay ordered. scopeElementIds and entryPorts are sorted as sets; inputs,
  // workloads, faults, boundaries, refinementSelections, initialContexts stay in
  // authored order.
  // --------------------------------------------------------------------------
  assertClosedKeys(scenario as unknown as Record<string, unknown>, SCENARIO_KEYS, 'Scenario', scenario.id);

  for (const a of scenario.assertions) {
    assertClosedKeys(a as unknown as Record<string, unknown>, ASSERTION_KEYS, 'Assertion', a.id);
  }
  const assertions: ManifestAssertion[] = scenario.assertions.map((a: Assertion) => ({
    id: a.id,
    subject: a.subject,
    operator: a.operator,
    expected: a.expected,
  }));

  for (const a of scenario.assumptions) {
    assertClosedKeys(a as unknown as Record<string, unknown>, ASSUMPTION_KEYS, 'Assumption', a.id);
  }
  const assumptions: ManifestAssumption[] = scenario.assumptions.map((a: Assumption) => ({
    key: a.key,
    value: a.value,
    source: a.source,
  }));

  const workloads: ManifestWorkload[] = scenario.workloads.map((w: Workload) => {
    assertClosedKeys(w as unknown as Record<string, unknown>, WORKLOAD_KEYS, 'Workload', w.id);
    const classes: ManifestRequestClass[] = w.classes.map((c: RequestClass) => {
      assertClosedKeys(c as unknown as Record<string, unknown>, REQUEST_CLASS_KEYS, 'RequestClass', c.id);
      return {
        id: c.id,
        weight: c.weight,
        operation: c.operation,
        tags: c.tags,
        keyDistribution: c.keyDistribution,
      };
    });
    return {
      id: w.id,
      entry: w.entry,
      enabled: w.enabled,
      startDelayMs: w.startDelayMs,
      emission: w.emission,
      timeoutMs: w.timeoutMs,
      classes,
    };
  });

  const scenarioManifest: ManifestScenario = {
    id: scenario.id,
    revision: scenario.revision,
    mode: scenario.mode,
    scopeElementIds: [...scenario.scopeElementIds].sort(),
    // A set (user decision 2026-09-29): the runner ignores entry-port order, so reordering
    // must not change the fingerprint. Sorted by elementId, then portId (UTF-16 code units).
    entryPorts: [...scenario.entryPorts].sort((x, y) =>
      x.elementId < y.elementId ? -1 : x.elementId > y.elementId ? 1 : x.portId < y.portId ? -1 : x.portId > y.portId ? 1 : 0,
    ),
    inputs: scenario.inputs,
    workloads,
    faults: scenario.faults,
    boundaries: scenario.boundaries,
    refinementSelections: scenario.refinementSelections,
    initialContexts: scenario.initialContexts,
    assertions,
    seed: scenario.seed,
    // Scenario.budgets is a required, always-materialized field on the
    // authored type (no omission path exists), so it is copied through as-is rather than
    // defaulted.
    budgets: scenario.budgets,
    assumptions,
  };

  const scope: ManifestScope = {
    declaredElementIds: [...closure.declaredScope].sort(),
    includedElementIds: [...closure.includedElementIds].sort(),
    includedConnectionIds: [...closure.includedConnectionIds].sort(),
    boundaryIds: [...closure.boundaryIds].sort(),
    excludedElementIds: [...closure.excludedElementIds].sort(),
  };

  const runnerVersions = [...versions.runnerVersions].sort((a, b) => (a.runnerId < b.runnerId ? -1 : a.runnerId > b.runnerId ? 1 : 0));

  const manifest: ExecutionManifest = {
    identityVersion: 1,
    modelSchemaVersion: 'studio-model/1',
    compilerVersion: versions.compilerVersion,
    runnerVersions,
    scenario: scenarioManifest,
    scope,
    elements,
    schemas,
    connections,
    structuralConstraints,
    refinements,
    fixtures,
  };

  const canonManifest = canonicalJson(manifest as unknown as Json);
  if (!canonManifest.ok) {
    // Should be unreachable: every value above derives from an already storable-valid
    // document plus plain builder-generated strings/numbers.
    throw new Error('buildManifest: manifest failed canonical-json-v1 encoding (should be unreachable post-validation)');
  }

  let fingerprint: string;
  try {
    fingerprint = `ss-run-v1:${await sha256Hex(canonManifest.text)}`;
  } catch {
    // Hash unavailable: if Web Crypto is unavailable or fails, report
    // identity-unavailable. There is deliberately no weaker fallback hash.
    return { status: 'identity-unavailable' };
  }

  return { status: 'ok', manifest, fingerprint };
}

/**
 * Runnable-level readiness checks (RV-02e).
 *
 * Implements the "Runnable" validation level described in:
 * - specs/revamp/contracts/model-and-runner.md §1 ("Two validation levels, one schema.
 *   Runnable: also requires complete scope, supported behavior, compatible ports,
 *   nonempty inputs and an explicit completion policy. Readiness errors never block
 *   saving a structurally valid design.")
 * - specs/revamp/contracts/model-and-runner.md §2 (Synchronous call cycles are rejected)
 * - specs/revamp/contracts/model-and-runner.md §3 (Port compatibility)
 * - specs/revamp/contracts/model-and-runner.md §5 (Readiness rejects)
 * - specs/revamp/contracts/model-and-runner.md §6 (Scenario mode/completion/boundary rules)
 * - specs/revamp/contracts/run-identity.md §3 (Scope closure; unresolved crossings fail
 *   readiness before fingerprinting)
 * - specs/revamp/contracts/storage.md §6 (Time limits)
 *
 * SCOPE: this module assumes `doc` already passed `validateDocument` (storable level).
 * It re-derives some rules that this codebase's `validate.ts` already enforces at the
 * storable level (e.g. call-port response schema, input atMs/mode, boundary delay/mode,
 * completion/mode, time-limit ranges) so that `checkReadiness` is self-sufficient and can
 * be exercised directly against a document that has not been (or no longer is) freshly
 * re-validated. This is intentional defense in depth, not a contract gap.
 *
 * NOT COVERED (explicitly out of scope for this task; see final report for citations):
 * - Path-dependent double settlement (runtime-only concern).
 * - Static type inference of Value/Guard expressions beyond the trivial, statically
 *   knowable checks implemented here (port/shape compatibility). Guard/Value expression
 *   type-checking against payload shapes is not implemented.
 * - The trace envelope (model-and-runner.md §8/§9 TraceEvent, RunUpdate, etc).
 * - Full §4 "Wiring" completeness (decision/pipeline/machine port-kind wiring beyond what
 *   is exercised by the reference fixtures), machine response-binding uniqueness/coverage,
 *   "unbound call responses" and "effect lists that could reply twice" (§5) — these need a
 *   dedicated wiring/effect-flow analysis pass beyond this task's scope.
 */

import type {
  Document,
  Id,
  Scenario,
  Element,
  Port,
  Shape,
  Json,
} from './model';
import type { Issue } from './validate';
import { canonicalJson } from './canonical';
import { computeClosure, type ClosureResultOk } from './closure';

// ============================================================================
// Readiness issue codes
// ============================================================================

/**
 * Readiness-only issue codes. Kept separate from `validate.ts`'s `ISSUE_CODES`
 * (storable-level) per this task's brief: "if you need a new issue code, define
 * readiness codes as a separate exported const array in readiness.ts". The `Issue`
 * shape itself (model-and-runner.md §8: `{code,path,entityId,severity,message}`)
 * is reused unchanged.
 */
export const READINESS_ISSUE_CODES = [
  /** §3: "Call ports need a non-null response schema; other channels need null." */
  'call-port-missing-response-schema',
  /** §3: "other channels need null" (the converse of the above). */
  'non-call-port-has-response-schema',
  /** §3: "Port compatibility = identical normalized shapes ...". */
  'incompatible-port-shapes',
  /** §2: "Synchronous call cycles are rejected." */
  'sync-call-cycle',
  /** §6 Inputs: "Logical mode: atMs is null ... Timed mode: atMs >= 0." */
  'invalid-input-timing',
  /** §6 Inputs: "Logical scenarios that reach resources reject readiness." */
  'logical-reaches-resource',
  /** §6 Workloads: "Pure logical scenarios need empty workloads and faults." */
  'logical-scenario-not-empty',
  /**
   * §1/§6: Runnable requires "nonempty inputs"; "Timed scenarios need at least
   * one finite input or enabled workload."
   */
  'no-arrivals',
  /** §6 Completion: quiescent is logical-only; horizon/drain are timed-only. */
  'completion-mode-mismatch',
  /** storage.md §6: timed horizon 1-300s; drain deadline > arrival horizon and <=600s. */
  'time-limit-out-of-range',
  /** §6 Boundaries: logical delayMs null; timed delayMs required, afterInputId null. */
  'boundary-timing-mode-mismatch',
  /** §6 Assertions: "A qualifying scenario needs >=1 assertion". */
  'no-assertions',
  /** §6 Assertions: "Assertion subjects must be in compiled scope." */
  'assertion-subject-out-of-scope',
  /** §6 Workloads: "They can target only resource entry ports." */
  'workload-target-not-resource-entry',
  /** run-identity.md §3: compiler returned 'analysis-limit' instead of a closure. */
  'compiler-analysis-limit',
  /** run-identity.md §3: compilation was cancelled before a closure could be computed. */
  'compiler-cancelled',
] as const;

export type ReadinessIssueCode = (typeof READINESS_ISSUE_CODES)[number];

/**
 * `Issue` (model-and-runner.md §8) with its `code` widened to also admit readiness-only
 * codes and closure issue codes, mirroring the `ClosureIssue` pattern already used in
 * `closure.ts`.
 */
export type ReadinessIssue = Omit<Issue, 'code'> & {
  readonly code: Issue['code'] | ReadinessIssueCode | (typeof CLOSURE_CODE_PASSTHROUGH)[number];
};

// Re-declared locally (not imported/re-exported) purely so the type above documents which
// closure codes can flow through unchanged; see closure.ts CLOSURE_ISSUE_CODES.
const CLOSURE_CODE_PASSTHROUGH = [
  'unresolved-crossing',
  'missing-target',
  'recursive-refinement',
  'unsupported-relation',
] as const;

export type ReadinessResult =
  | { readonly ready: true; readonly closure: ClosureResultOk }
  | { readonly ready: false; readonly issues: readonly ReadinessIssue[] };

// ============================================================================
// §3: normalizeShape / shapesCompatible
// ============================================================================

/**
 * A shape normalized per model-and-runner.md §3: "identical normalized shapes
 * (ignore field IDs/labels, sort record fields by key)". Represented as plain JSON
 * so it can be compared via `canonicalJson` string equality.
 */
type NormalizedShape =
  | { readonly type: 'string' | 'boolean' | 'number' | 'integer'; readonly nullable: boolean }
  | {
      readonly type: 'record';
      readonly nullable: boolean;
      readonly fields: readonly { readonly key: string; readonly optional: boolean; readonly shape: NormalizedShape }[];
    }
  | { readonly type: 'list'; readonly nullable: boolean; readonly maxItems: number; readonly items: NormalizedShape }
  | { readonly type: 'scalar-union'; readonly nullable: boolean; readonly types: readonly string[] };

/**
 * Normalizes a Shape per model-and-runner.md §3, dropping field `id`/`label` and
 * sorting record fields by key. Implemented iteratively with an explicit stack and a
 * WeakMap memo (rather than direct recursion) per this task's requirement to avoid
 * recursing over untrusted depth, even though shape depth is already bounded to 8 by
 * the storable validator (storage.md §6).
 */
export function normalizeShape(root: Shape): NormalizedShape {
  const memo = new WeakMap<object, NormalizedShape>();
  const stack: { node: Shape; visited: boolean }[] = [{ node: root, visited: false }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (!frame.visited) {
      frame.visited = true;
      if (frame.node.type === 'record') {
        for (const f of frame.node.fields) {
          stack.push({ node: f.shape, visited: false });
        }
      } else if (frame.node.type === 'list') {
        stack.push({ node: frame.node.items, visited: false });
      }
      continue;
    }
    stack.pop();
    const node = frame.node;
    let normalized: NormalizedShape;
    if (node.type === 'record') {
      const fields = node.fields
        .map((f) => ({
          key: f.key,
          optional: f.optional,
          shape: memo.get(f.shape as object)!,
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      normalized = { type: 'record', nullable: node.nullable, fields };
    } else if (node.type === 'list') {
      normalized = {
        type: 'list',
        nullable: node.nullable,
        maxItems: node.maxItems,
        items: memo.get(node.items as object)!,
      };
    } else if (node.type === 'scalar-union') {
      normalized = { type: 'scalar-union', nullable: node.nullable, types: [...node.types].sort() };
    } else {
      normalized = { type: node.type, nullable: node.nullable };
    }
    memo.set(node as object, normalized);
  }

  return memo.get(root as object)!;
}

/**
 * model-and-runner.md §3: "Port compatibility = identical normalized shapes (ignore
 * field IDs/labels, sort record fields by key)."
 */
export function shapesCompatible(a: Shape, b: Shape): boolean {
  const na = canonicalJson(normalizeShape(a) as unknown as Json);
  const nb = canonicalJson(normalizeShape(b) as unknown as Json);
  if (!na.ok || !nb.ok) return false;
  return na.text === nb.text;
}

// ============================================================================
// checkReadiness
// ============================================================================

function issue(
  code: ReadinessIssue['code'],
  path: readonly (string | number)[],
  entityId: Id | null,
  message: string,
): ReadinessIssue {
  return { code, path, entityId, severity: 'error', message };
}

/**
 * model-and-runner.md §1/§2/§3/§5/§6; run-identity.md §3.
 *
 * Assumes `doc` already passed `validateDocument` (storable level). Computes the
 * scenario's scope closure first (run-identity.md §3), then layers readiness-only
 * checks on top of it.
 */
export function checkReadiness(doc: Document, scenarioId: Id): ReadinessResult {
  const closureResult = computeClosure(doc, scenarioId);

  if (closureResult.status === 'analysis-limit') {
    // run-identity.md §3: "returns analysis-limit or cancelled rather than freezing
    // or accepting partial closure."
    return {
      ready: false,
      issues: [
        issue(
          'compiler-analysis-limit',
          ['scenarios'],
          scenarioId,
          'Scope closure exceeded compiler limits (storage.md §6: <=2,000 expanded entities, <=10,000 references)',
        ),
      ],
    };
  }
  if (closureResult.status === 'cancelled') {
    return {
      ready: false,
      issues: [issue('compiler-cancelled', ['scenarios'], scenarioId, 'Scope closure computation was cancelled')],
    };
  }
  if (closureResult.status === 'not-ready') {
    // run-identity.md §3: "Unresolved crossings, missing targets and unsupported
    // relation kinds fail readiness before fingerprinting." Propagate as-is.
    return { ready: false, issues: closureResult.issues };
  }

  const closure: ClosureResultOk = closureResult;
  const issues: ReadinessIssue[] = [];

  const scenarioIndex = doc.scenarios.findIndex((s) => s.id === scenarioId);
  const scenario: Scenario = doc.scenarios[scenarioIndex];
  const scenarioPath: (string | number)[] = ['scenarios', scenarioIndex];

  const elementsMap = new Map<Id, Element>();
  for (const el of doc.elements) elementsMap.set(el.id, el);

  const portsMap = new Map<string, Port>();
  for (const el of doc.elements) {
    for (const p of el.ports) portsMap.set(`${el.id}:${p.id}`, p);
  }

  const schemaShapeMap = new Map<Id, Shape>();
  for (const sch of doc.schemas) schemaShapeMap.set(sch.id, sch.shape);

  const includedElementSet = new Set(closure.includedElementIds);
  const includedConnectionSet = new Set(closure.includedConnectionIds);

  // --------------------------------------------------------------------------
  // §3: call ports need non-null responseSchemaId, others need null.
  // --------------------------------------------------------------------------
  for (const elId of closure.includedElementIds) {
    const el = elementsMap.get(elId);
    if (!el) continue;
    el.ports.forEach((p, pIdx) => {
      const elIdx = doc.elements.findIndex((e) => e.id === elId);
      const path = ['elements', elIdx, 'ports', pIdx, 'responseSchemaId'];
      if (p.channel === 'call' && p.responseSchemaId === null) {
        issues.push(
          issue('call-port-missing-response-schema', path, p.id, `Call port '${p.id}' on element '${elId}' must have a non-null responseSchemaId`),
        );
      } else if (p.channel !== 'call' && p.responseSchemaId !== null) {
        issues.push(
          issue('non-call-port-has-response-schema', path, p.id, `Non-call port '${p.id}' on element '${elId}' must have a null responseSchemaId`),
        );
      }
    });
  }

  // --------------------------------------------------------------------------
  // §3: port compatibility across every included connection.
  // --------------------------------------------------------------------------
  const sortedIncludedConnections = doc.connections
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => includedConnectionSet.has(c.id));

  for (const { c, idx } of sortedIncludedConnections) {
    const srcPort = portsMap.get(`${c.source.elementId}:${c.source.portId}`);
    const tgtPort = portsMap.get(`${c.target.elementId}:${c.target.portId}`);
    if (!srcPort || !tgtPort) continue; // dangling references are a storable-level concern
    const srcShape = schemaShapeMap.get(srcPort.schemaId);
    const tgtShape = schemaShapeMap.get(tgtPort.schemaId);
    if (srcShape && tgtShape && !shapesCompatible(srcShape, tgtShape)) {
      issues.push(
        issue(
          'incompatible-port-shapes',
          ['connections', idx, 'target', 'portId'],
          c.id,
          `Connection '${c.id}' joins incompatible payload shapes between '${c.source.elementId}:${c.source.portId}' and '${c.target.elementId}:${c.target.portId}'`,
        ),
      );
    }
    if (c.kind === 'call' && srcPort.responseSchemaId && tgtPort.responseSchemaId) {
      const srcRespShape = schemaShapeMap.get(srcPort.responseSchemaId);
      const tgtRespShape = schemaShapeMap.get(tgtPort.responseSchemaId);
      if (srcRespShape && tgtRespShape && !shapesCompatible(srcRespShape, tgtRespShape)) {
        issues.push(
          issue(
            'incompatible-port-shapes',
            ['connections', idx, 'target', 'portId'],
            c.id,
            `Call connection '${c.id}' has incompatible response payload shapes`,
          ),
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // §2: "Synchronous call cycles are rejected." Detect cycles among included
  // 'call'-kind connections restricted to the compiled scope.
  // --------------------------------------------------------------------------
  {
    const adjacency = new Map<Id, Id[]>();
    for (const { c } of sortedIncludedConnections) {
      if (c.kind !== 'call') continue;
      const list = adjacency.get(c.source.elementId) ?? [];
      list.push(c.target.elementId);
      adjacency.set(c.source.elementId, list);
    }
    const color = new Map<Id, 'gray' | 'black'>();
    let cycleFound: Id | null = null;
    for (const startId of includedElementSet) {
      if (color.has(startId)) continue;
      // Iterative DFS with explicit stack of {id, neighborIndex}.
      const stack: { id: Id; idx: number }[] = [{ id: startId, idx: 0 }];
      color.set(startId, 'gray');
      while (stack.length > 0 && !cycleFound) {
        const top = stack[stack.length - 1];
        const neighbors = adjacency.get(top.id) ?? [];
        if (top.idx < neighbors.length) {
          const next = neighbors[top.idx];
          top.idx++;
          const state = color.get(next);
          if (state === 'gray') {
            cycleFound = next;
            break;
          }
          if (!state) {
            color.set(next, 'gray');
            stack.push({ id: next, idx: 0 });
          }
        } else {
          color.set(top.id, 'black');
          stack.pop();
        }
      }
      if (cycleFound) break;
    }
    if (cycleFound) {
      issues.push(
        issue('sync-call-cycle', scenarioPath, cycleFound, `Synchronous call cycle detected involving element '${cycleFound}'`),
      );
    }
  }

  // --------------------------------------------------------------------------
  // §6: pure logical scenarios need empty workloads and faults.
  // --------------------------------------------------------------------------
  if (scenario.mode === 'logical' && (scenario.workloads.length > 0 || scenario.faults.length > 0)) {
    issues.push(
      issue(
        'logical-scenario-not-empty',
        [...scenarioPath, scenario.workloads.length > 0 ? 'workloads' : 'faults'],
        scenario.id,
        'Pure logical scenarios need empty workloads and faults',
      ),
    );
  }

  // --------------------------------------------------------------------------
  // §6: input atMs must match mode; "Logical scenarios that reach resources
  // reject readiness."
  // --------------------------------------------------------------------------
  scenario.inputs.forEach((inp, i) => {
    if (scenario.mode === 'logical' && inp.atMs !== null) {
      issues.push(
        issue('invalid-input-timing', [...scenarioPath, 'inputs', i, 'atMs'], inp.id, 'Logical mode inputs must have atMs null'),
      );
    } else if (scenario.mode === 'timed' && (inp.atMs === null || inp.atMs < 0)) {
      issues.push(
        issue('invalid-input-timing', [...scenarioPath, 'inputs', i, 'atMs'], inp.id, 'Timed mode inputs must have atMs >= 0'),
      );
    }
  });

  if (scenario.mode === 'logical') {
    const reachedResource = closure.includedElementIds.find((id) => elementsMap.get(id)?.behavior.kind === 'resource');
    if (reachedResource) {
      issues.push(
        issue('logical-reaches-resource', scenarioPath, reachedResource, `Logical scenario reaches resource '${reachedResource}'; readiness is rejected`),
      );
    }
  }

  // --------------------------------------------------------------------------
  // §1/§6: nonempty inputs; timed scenarios need >=1 finite input or enabled workload.
  // --------------------------------------------------------------------------
  const hasEnabledWorkload = scenario.workloads.some((w) => w.enabled);
  if (scenario.mode === 'logical' && scenario.inputs.length === 0) {
    issues.push(issue('no-arrivals', [...scenarioPath, 'inputs'], scenario.id, 'Logical scenarios need nonempty inputs'));
  } else if (scenario.mode === 'timed' && scenario.inputs.length === 0 && !hasEnabledWorkload) {
    issues.push(
      issue('no-arrivals', [...scenarioPath, 'inputs'], scenario.id, 'Timed scenarios need at least one finite input or enabled workload'),
    );
  }

  // --------------------------------------------------------------------------
  // §6: workloads can target only resource entry ports.
  // --------------------------------------------------------------------------
  scenario.workloads.forEach((w, i) => {
    const targetEl = elementsMap.get(w.entry.elementId);
    const isResourceEntry =
      targetEl?.behavior.kind === 'resource' && targetEl.behavior.entryPortId === w.entry.portId;
    if (!isResourceEntry) {
      issues.push(
        issue(
          'workload-target-not-resource-entry',
          [...scenarioPath, 'workloads', i, 'entry'],
          w.id,
          `Workload '${w.id}' must target a resource entry port`,
        ),
      );
    }
  });

  // --------------------------------------------------------------------------
  // §6: completion policy kind must match scenario mode.
  // --------------------------------------------------------------------------
  const completion = scenario.completion;
  if (scenario.mode === 'logical' && completion.kind !== 'quiescent') {
    issues.push(
      issue('completion-mode-mismatch', [...scenarioPath, 'completion', 'kind'], scenario.id, "Logical scenarios must use 'quiescent' completion"),
    );
  } else if (scenario.mode === 'timed' && completion.kind === 'quiescent') {
    issues.push(
      issue('completion-mode-mismatch', [...scenarioPath, 'completion', 'kind'], scenario.id, "Timed scenarios must use 'horizon' or 'drain' completion"),
    );
  }

  // --------------------------------------------------------------------------
  // storage.md §6: timed horizon 1-300s; drain deadline > arrival horizon and <=600s.
  // --------------------------------------------------------------------------
  if (completion.kind === 'horizon') {
    if (completion.horizonMs < 1000 || completion.horizonMs > 300000) {
      issues.push(
        issue(
          'time-limit-out-of-range',
          [...scenarioPath, 'completion', 'horizonMs'],
          scenario.id,
          'Timed horizon must be within 1-300 seconds (storage.md §6)',
        ),
      );
    }
  } else if (completion.kind === 'drain') {
    if (completion.arrivalHorizonMs < 1000 || completion.arrivalHorizonMs > 300000) {
      issues.push(
        issue(
          'time-limit-out-of-range',
          [...scenarioPath, 'completion', 'arrivalHorizonMs'],
          scenario.id,
          'Drain arrival horizon must be within 1-300 seconds (storage.md §6)',
        ),
      );
    }
    if (completion.deadlineMs <= completion.arrivalHorizonMs || completion.deadlineMs > 600000) {
      issues.push(
        issue(
          'time-limit-out-of-range',
          [...scenarioPath, 'completion', 'deadlineMs'],
          scenario.id,
          'Drain deadline must be greater than the arrival horizon and at most 600 seconds (storage.md §6)',
        ),
      );
    }
  }

  // --------------------------------------------------------------------------
  // §6 Boundaries: logical delayMs null; timed delayMs required, afterInputId null.
  // --------------------------------------------------------------------------
  scenario.boundaries.forEach((b, bi) => {
    b.responses.forEach((r, ri) => {
      const path = [...scenarioPath, 'boundaries', bi, 'responses', ri, 'delayMs'];
      if (scenario.mode === 'logical' && r.delayMs !== null) {
        issues.push(issue('boundary-timing-mode-mismatch', path, r.id, 'Logical mode boundary responses must have delayMs null'));
      } else if (scenario.mode === 'timed') {
        if (r.delayMs === null) {
          issues.push(issue('boundary-timing-mode-mismatch', path, r.id, 'Timed mode boundary responses must have a non-null delayMs'));
        }
        if (r.afterInputId !== null) {
          issues.push(
            issue(
              'boundary-timing-mode-mismatch',
              [...scenarioPath, 'boundaries', bi, 'responses', ri, 'afterInputId'],
              r.id,
              'Timed mode boundary responses must have afterInputId null',
            ),
          );
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // §6 Assertions: >=1 assertion; every subject must be in compiled scope.
  // --------------------------------------------------------------------------
  if (scenario.assertions.length === 0) {
    issues.push(issue('no-assertions', [...scenarioPath, 'assertions'], scenario.id, 'A qualifying scenario needs at least one assertion'));
  }

  scenario.assertions.forEach((a, ai) => {
    const subject = a.subject;
    let subjectElementId: Id | null = null;
    if (subject.kind === 'final-state' || subject.kind === 'context' || subject.kind === 'trace-count' || subject.kind === 'metric') {
      subjectElementId = subject.elementId;
    } else if (subject.kind === 'output') {
      subjectElementId = subject.port.elementId;
    } else if (subject.kind === 'count') {
      subjectElementId = subject.elementId; // may be null (aggregate scope), which is valid
    }
    if (subjectElementId !== null && !includedElementSet.has(subjectElementId)) {
      issues.push(
        issue(
          'assertion-subject-out-of-scope',
          [...scenarioPath, 'assertions', ai, 'subject'],
          a.id,
          `Assertion '${a.id}' subject references element '${subjectElementId}' outside compiled scope`,
        ),
      );
    }
  });

  if (issues.length > 0) {
    return { ready: false, issues };
  }

  return { ready: true, closure };
}

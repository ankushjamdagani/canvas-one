/**
 * Runnable-level readiness checks (RV-02e).
 *
 * Implements the "Runnable" validation level described in:
 * - specs/revamp/contracts/model-and-runner.md §1 ("Two validation levels, one schema.
 *   Runnable: also requires complete scope, supported behavior, compatible ports,
 *   nonempty inputs. Readiness errors never block
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
 * CONTRACT GAPS / INTERPRETATIONS:
 * - "missing pipeline outputs" (specs/revamp/contracts/model-and-runner.md §5):
 *   Interpreted as meaning the pipeline's declared outputPortId or errorPortId does not
 *   resolve to a port on the same element (defensive check; the storable validator normally
 *   catches it). An unconnected output port is legal (as demonstrated by reference fixture S03,
 *   which passes with zero connections); connection/assertion coverage is not required.
 *
 * NOT COVERED (explicitly out of scope for this task; see final report for citations):
 * - Path-dependent double settlement (runtime-only concern; model-and-runner.md §5:
 *   "Path-dependent double settlement and budget-exhausting message cycles fail or end
 *   incomplete at runtime").
 * - Value-dependent errors (optional/missing reads, nullable values, scalar unions),
 *   and response schemas of replies whose initiating frame is not locally knowable.
 * - The trace envelope (model-and-runner.md §8/§9 TraceEvent, RunUpdate, etc).
 */

import type {
  Document,
  Id,
  Scenario,
  Element,
  Port,
  Shape,
  Json,
  MachineBehavior,
  PipelineBehavior,
  DecisionBehavior,
  ResourceBehavior,
  Effect,
  Value,
  Guard,
  Path,
  ScalarType,
} from './model';
import type { Issue } from './validate';
import { canonicalJson } from './canonical';
import { computeClosure, type ClosureResultOk } from './closure';
import { resolveRefinementRouting } from './refinementRouting';
import { callRetryOf } from './port-settings';

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
const READINESS_ISSUE_CODES = [
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
  /** D56: only timed scenarios have workloads; a logical scenario is driven by its inputs. */
  'workload-in-logical',
  /** D56: a bulk needs a whole number of requests and a positive spread; an enabled stream needs a rate above zero. */
  'workload-emission-range',
  /** §6 Boundaries: logical delayMs null; timed delayMs required, afterInputId null. */
  'boundary-timing-mode-mismatch',
  /** §6 Assertions: "A qualifying scenario needs >=1 assertion". */
  'no-assertions',
  /** §6 Assertions: "Assertion subjects must be in compiled scope." */
  'assertion-subject-out-of-scope',
  /** §6 Workloads: "They can target only resource entry ports." */
  'workload-target-not-resource-entry',
  /** D50: a broker's delivery route redelivers after a backoff; it has no attempt timeout. */
  'broker-route-attempt-timeout',
  /** run-identity.md §3: compiler returned 'analysis-limit' instead of a closure. */
  'compiler-analysis-limit',
  /** run-identity.md §3: compilation was cancelled before a closure could be computed. */
  'compiler-cancelled',
  /** §4 Wiring: "maps each outbound call port to exactly one inbound event port on the same machine, with a compatible shape" / §5: "Readiness rejects: unbound call responses". */
  'unbound-call-response',
  /** §4 Behaviors / §5: "Readiness rejects: ... effect lists that could reply twice". */
  'reply-twice',
  /** §4 Wiring / §5: "Readiness rejects: ... mismatched schemas". */
  'mismatched-schema',
  /** §5: "Readiness rejects: ... missing pipeline outputs". */
  'missing-pipeline-output',
  /** §4 Behaviors: "unmodeled: reachable in a runnable scenario only behind a boundary fixture". */
  'unmodeled-element',
  /** §4: "A statically knowable type error rejects readiness". */
  'expression-type-error',
  /** §8 Bridge call frames: "a non-router resource with a bridge call continuation may have no other selectable call continuation". */
  'bridge-continuation-conflict',
  /** §8 Bridge call frames: a router's routes must reach resources. A router shares load by capacity, and a machine, pipeline or unmodeled element has none (RV-18 dropped, 2026-09-30). */
  'router-route-needs-resource',
  /** §6 Refinement: duplicate/unknown selections and crossings without a compatible mapping are not runnable. */
  'invalid-refinement-selection',
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

const NON_RESOURCE_NOUN: Readonly<Record<string, string>> = {
  machine: 'a state machine',
  pipeline: 'a data pipeline',
  decision: 'a decision',
  host: 'a host',
  unmodeled: 'not simulated',
};

/** Guidance for a router route that reaches a non-resource element (§8). */
function routerRouteMessage(routerLabel: string, target: Element | undefined, targetId: Id): string {
  const targetLabel = target?.label ?? targetId;
  const noun = target ? NON_RESOURCE_NOUN[target.behavior.kind] : undefined;
  const what = noun ? ` (${noun})` : '';
  return `Router '${routerLabel}' routes straight to '${targetLabel}'${what}, which has no capacity to share load. Put a component with capacity, such as a Service, between them: '${routerLabel}' → Service → '${targetLabel}' (specs/revamp/contracts/model-and-runner.md §8)`;
}

// Possible value types, not a new authored union grammar. Constructed list items
// are kept separately; mixed runtime scalar data is never coerced or narrowed.
type StaticValue =
  | { kind: 'unknown' | 'missing' | 'null' }
  | { kind: 'scalar'; types: readonly ScalarType[]; nullable: boolean; number?: number }
  | { kind: 'record'; nullable: boolean; fields: ReadonlyMap<string, { value: StaticValue; optional: boolean }> }
  | { kind: 'list'; nullable: boolean; items: readonly StaticValue[]; length?: number };
type ExpressionScope = { input: StaticValue; context: StaticValue };
const UNKNOWN: StaticValue = { kind: 'unknown' };
const MISSING: StaticValue = { kind: 'missing' };
const EMPTY_CONTEXT: StaticValue = { kind: 'record', nullable: false, fields: new Map() };
const STRING_VALUE: StaticValue = { kind: 'scalar', types: ['string'], nullable: false };

function schemaValue(shape: Shape | undefined): StaticValue {
  if (!shape) return UNKNOWN;
  if (shape.type === 'record') return {
    kind: 'record', nullable: shape.nullable,
    fields: new Map(shape.fields.map((f) => [f.key, { value: schemaValue(f.shape), optional: f.optional }])),
  };
  if (shape.type === 'list') return { kind: 'list', nullable: shape.nullable, items: [schemaValue(shape.items)] };
  return { kind: 'scalar', types: shape.type === 'scalar-union' ? shape.types : [shape.type], nullable: shape.nullable };
}

function literalValue(value: Json): StaticValue {
  if (value === null) return { kind: 'null' };
  if (Array.isArray(value)) return { kind: 'list', nullable: false, items: value.map(literalValue), length: value.length };
  if (typeof value === 'object') return {
    kind: 'record', nullable: false,
    fields: new Map(Object.entries(value).map(([key, v]) => [key, { value: literalValue(v), optional: false }])),
  };
  if (typeof value === 'number') return {
    kind: 'scalar', nullable: false, types: [Number.isSafeInteger(value) ? 'integer' : 'number'], number: value,
  };
  return { kind: 'scalar', nullable: false, types: [typeof value as 'string' | 'boolean'] };
}

function readStatic(root: StaticValue, path: Path): StaticValue {
  let current = root;
  for (const step of path) {
    if (current.kind === 'unknown') return UNKNOWN;
    if (current.kind === 'record' && typeof step === 'string') {
      current = current.fields.get(step)?.value ?? MISSING;
    } else if (current.kind === 'list' && typeof step === 'number') {
      current = current.length === undefined ? current.items[0] ?? UNKNOWN : current.items[step] ?? MISSING;
    } else return MISSING;
  }
  return current;
}

// Preserve effect order: context writes can change the type read by later effects.
// A schema-derived list has unknown length; writing one index does not change the
// types of every item. Such writes deliberately make that list unknown here.
function writeStatic(root: StaticValue, path: Path, value: StaticValue): StaticValue {
  if (path.length === 0) return value;
  const [step, ...rest] = path;
  if (root.kind === 'record' && typeof step === 'string') {
    const fields = new Map(root.fields);
    fields.set(step, { value: writeStatic(fields.get(step)?.value ?? UNKNOWN, rest, value), optional: false });
    return { ...root, fields };
  }
  if (root.kind === 'list' && root.length !== undefined && typeof step === 'number' && step < root.length) {
    return { ...root, items: root.items.map((item, i) => i === step ? writeStatic(item, rest, value) : item) };
  }
  return UNKNOWN;
}

// Only a disjoint type is a definite failure. Nullable and scalar-union reads can
// produce valid values, and optional/missing assignments remain modeled errors (§4).
function cannotMatch(value: StaticValue, shape: Shape): boolean {
  if (value.kind === 'unknown' || value.kind === 'missing') return false;
  if (value.kind === 'null') return !shape.nullable;
  if ('nullable' in value && value.nullable && shape.nullable) return false;
  if (shape.type === 'record') {
    if (value.kind !== 'record') return true;
    if ([...value.fields].some(([key, field]) => !field.optional && !shape.fields.some((f) => f.key === key))) return true;
    return shape.fields.some((field) => {
      const source = value.fields.get(field.key);
      if (!source) return !field.optional;
      return !source.optional && cannotMatch(source.value, field.shape);
    });
  }
  if (shape.type === 'list') {
    if (value.kind !== 'list') return true;
    if (value.length !== undefined && value.length > shape.maxItems) return true;
    // A schema-derived list may be empty even if its item type is disjoint.
    return value.length !== undefined && value.items.some((item) => cannotMatch(item, shape.items));
  }
  if (value.kind !== 'scalar') return true;
  const targets = shape.type === 'scalar-union' ? shape.types : [shape.type];
  return !value.types.some((type) => targets.some((target) =>
    type === target || (type === 'integer' && target === 'number') ||
    (type === 'number' && target === 'integer' && (value.number === undefined || Number.isSafeInteger(value.number))),
  ));
}

/** Recursion is bounded by the storable expression, path, JSON and schema budgets. */
function checkExpressions(
  doc: Document, scenario: Scenario, included: ReadonlySet<Id>, schemas: ReadonlyMap<Id, Shape>, issues: ReadinessIssue[],
): void {
  const fail = (path: Path, entityId: Id, message: string) => {
    issues.push(issue('expression-type-error', path, entityId, message));
  };
  const checkTarget = (value: StaticValue, shape: Shape | undefined, path: Path, id: Id) => {
    if (shape && cannotMatch(value, shape)) fail(path, id, 'Expression cannot satisfy the target payload schema');
  };
  const infer = (value: Value, scope: ExpressionScope, path: Path, id: Id): StaticValue => {
    switch (value.kind) {
      case 'literal': return literalValue(value.value);
      case 'read': return readStatic(scope[value.source], value.path);
      case 'outcome': return { kind: 'scalar', types: ['string'], nullable: true };
      case 'record': {
        const fields = new Map<string, { value: StaticValue; optional: boolean }>();
        value.fields.forEach((field, i) => {
          const fieldPath = [...path, 'fields', i, 'value'];
          const type = infer(field.value, scope, fieldPath, id);
          if (type.kind === 'missing') fail(fieldPath, id, 'A record constructor cannot contain a missing value');
          fields.set(field.key, { value: type, optional: false });
        });
        return { kind: 'record', nullable: false, fields };
      }
      case 'list': return {
        kind: 'list', nullable: false, length: value.items.length,
        items: value.items.map((item, i) => {
          const type = infer(item, scope, [...path, 'items', i], id);
          if (type.kind === 'missing') fail([...path, 'items', i], id, 'A list constructor cannot contain a missing value');
          return type;
        }),
      };
    }
  };
  const checkGuard = (guard: Guard, scope: ExpressionScope, path: Path, id: Id): void => {
    if (guard.op === 'all' || guard.op === 'any') {
      guard.guards.forEach((child, i) => checkGuard(child, scope, [...path, 'guards', i], id));
      return;
    }
    if (guard.op === 'equals' || guard.op === 'notEquals') {
      for (const side of ['left', 'right'] as const) {
        if (infer(guard[side], scope, [...path, side], id).kind === 'missing') {
          fail([...path, side], id, 'Only exists can test a missing read');
        }
      }
      // Unlike port compatibility, JSON equality between different types is legal.
      return;
    }
    if (!('value' in guard)) return;
    const value = infer(guard.value, scope, [...path, 'value'], id);
    if (guard.op === 'exists' || value.kind === 'unknown') return;
    const valid = guard.op === 'every' ? value.kind === 'list'
      : guard.op === 'nonEmpty' ? value.kind === 'record' || value.kind === 'list' ||
        (value.kind === 'scalar' && value.types.includes('string'))
      : value.kind === 'scalar' && value.types.some((t) => t === 'integer' || t === 'number') &&
        (value.number === undefined || Number.isSafeInteger(value.number));
    if (!valid) {
      fail([...path, 'value'], id, value.kind === 'missing' ? 'Only exists can test a missing read' : `Invalid value type for ${guard.op}`);
      return;
    }
    if (guard.op === 'every' && value.kind === 'list') {
      value.items.forEach((item) => checkGuard(guard.itemGuard, { ...scope, input: item }, [...path, 'itemGuard'], id));
    }
  };
  const shapeAt = (shape: Shape | undefined, path: Path): Shape | undefined => {
    for (const step of path) {
      if (shape?.type === 'record' && typeof step === 'string') shape = shape.fields.find((f) => f.key === step)?.shape;
      else if (shape?.type === 'list' && typeof step === 'number') shape = shape.items;
      else return undefined;
    }
    return shape;
  };
  const portShape = (element: Element, portId: Id) => schemas.get(element.ports.find((p) => p.id === portId)?.schemaId ?? '');
  doc.elements.forEach((element, index) => {
    if (!included.has(element.id)) return;
    const behavior = element.behavior;
    const path: Path = ['elements', index, 'behavior'];
    if (behavior.kind === 'machine') {
      const contextShape = schemas.get(behavior.contextSchemaId);
      behavior.transitions.forEach((transition, ti) => {
        const scope = { input: schemaValue(portShape(element, transition.eventPortId)), context: schemaValue(contextShape) };
        const tp = [...path, 'transitions', ti];
        if (transition.guard) checkGuard(transition.guard, scope, [...tp, 'guard'], transition.id);
        transition.effects.forEach((effect, ei) => {
          const ep = [...tp, 'effects', ei];
          if (effect.kind === 'trace') return;
          if (effect.kind === 'request-id') {
            scope.context = writeStatic(scope.context, effect.path, STRING_VALUE);
            return;
          }
          const type = infer(effect.value, scope, [...ep, 'value'], effect.id);
          if (effect.kind === 'assign') scope.context = writeStatic(scope.context, effect.path, type);
          if (effect.kind === 'emit' || effect.kind === 'schedule-event') {
            checkTarget(type, portShape(element, effect.kind === 'emit' ? effect.portId : effect.eventPortId), [...ep, 'value'], effect.id);
          }
          if (effect.kind === 'emit' && effect.correlation.kind === 'context-request') {
            checkTarget(readStatic(scope.context, effect.correlation.path), { type: 'string', nullable: false }, [...ep, 'correlation'], effect.id);
          }
          if (effect.kind === 'reply') {
            const entry = element.ports.find((p) => p.id === transition.eventPortId);
            // Data descendants inherit a call frame whose response type need not
            // match their local input type. Leave those replies to the runner.
            checkTarget(type, schemas.get(entry?.responseSchemaId ?? ''), [...ep, 'value'], effect.id);
          }
        });
        // Context is validated atomically after the ordered effects, not after
        // each assignment: a temporarily invalid value can be overwritten.
        checkTarget(scope.context, contextShape, [...tp, 'effects'], transition.id);
      });
    } else if (behavior.kind === 'decision') {
      const scope = { input: schemaValue(schemas.get(behavior.inputSchemaId)), context: EMPTY_CONTEXT };
      behavior.cases.forEach((entry, ci) => {
        const cp = [...path, 'cases', ci];
        checkGuard(entry.guard, scope, [...cp, 'guard'], entry.id);
        checkTarget(infer(entry.value, scope, [...cp, 'value'], entry.id), portShape(element, entry.outputPortId), [...cp, 'value'], entry.id);
      });
      const fp = [...path, 'fallback', 'value'];
      checkTarget(infer(behavior.fallback.value, scope, fp, element.id), portShape(element, behavior.fallback.outputPortId), fp, element.id);
    } else if (behavior.kind === 'pipeline') {
      const input = schemas.get(behavior.inputSchemaId);
      let row = schemaValue(input?.type === 'list' ? input.items : undefined);
      let constructsRows = false;
      behavior.operations.forEach((operation, oi) => {
        const op = [...path, 'operations', oi];
        const scope = { input: row, context: EMPTY_CONTEXT };
        if (operation.kind === 'validate') row = schemaValue(schemas.get(operation.schemaId));
        if (operation.kind === 'filter') checkGuard(operation.guard, scope, [...op, 'guard'], operation.id);
        if (operation.kind === 'map') {
          constructsRows = true;
          row = infer({ kind: 'record', fields: operation.fields.map((field) => ({ key: field.targetKey, value: field.value })) }, scope, op, operation.id);
        }
        if (operation.kind === 'group-sum') {
          constructsRows = true;
          row = {
            kind: 'record', nullable: false,
            fields: new Map([
              [operation.keyName, { value: STRING_VALUE, optional: false }],
              [operation.sumName, { value: { kind: 'scalar', types: ['integer'], nullable: false } as StaticValue, optional: false }],
            ]),
          };
        }
      });
      const output = schemas.get(behavior.outputSchemaId);
      // Authored constructors must be capable of emitting the declared row type.
      // Original error rows, row counts and runtime branch selection stay dynamic.
      if (constructsRows && output?.type === 'list') {
        checkTarget(row, output.items, [...path, 'outputSchemaId'], element.id);
      }
    }
  });
  const si = doc.scenarios.indexOf(scenario);
  scenario.boundaries.forEach((boundary, bi) => {
    const source = doc.elements.find((el) => el.id === boundary.source.elementId)?.ports.find((p) => p.id === boundary.source.portId);
    const scope = { input: schemaValue(schemas.get(source?.schemaId ?? '')), context: EMPTY_CONTEXT };
    boundary.responses.forEach((response, ri) => {
      const path = ['scenarios', si, 'boundaries', bi, 'responses', ri];
      checkGuard(response.match, scope, [...path, 'match'], response.id);
      response.payloadBindings.forEach((binding, i) => {
        checkTarget(readStatic(scope.input, binding.requestPath), shapeAt(schemas.get(boundary.schemaId), binding.targetPath), [...path, 'payloadBindings', i], response.id);
      });
    });
  });
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

  const refinementRouting = resolveRefinementRouting(doc, scenario);
  const refinementIssues: ReadinessIssue[] = [
    ...refinementRouting.selectionErrors.map((error) =>
      issue(
        'invalid-refinement-selection',
        [...scenarioPath, 'refinementSelections'],
        error.refinementId,
        error.message,
      ),
    ),
    ...refinementRouting.crossingViolations.map((violation) =>
      issue(
        'invalid-refinement-selection',
        [...scenarioPath, 'refinementSelections'],
        violation.refinementId,
        violation.message,
      ),
    ),
  ];
  if (refinementIssues.length > 0) {
    return { ready: false, issues: refinementIssues };
  }

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
    const at = [...scenarioPath, 'workloads', i];
    if (scenario.mode === 'logical') {
      issues.push(issue('workload-in-logical', at, w.id, 'Logical scenarios are driven by inputs; workloads belong to timed scenarios'));
      return;
    }
    const e = w.emission;
    if (e.mode === 'bulk') {
      if (!Number.isInteger(e.requests) || e.requests < 1) {
        issues.push(issue('workload-emission-range', [...at, 'emission', 'requests'], w.id, 'A bulk needs a whole number of requests, at least 1'));
      }
      const spread = e.arrival === 'instant' ? null : 'spreadMs' in e.arrival ? e.arrival.spreadMs : e.arrival.ramp.spreadMs;
      if (spread !== null && !(spread >= 1)) {
        issues.push(issue('workload-emission-range', [...at, 'emission', 'arrival'], w.id, 'A bulk spread needs at least 1 ms'));
      }
    } else if (w.enabled && !(e.ratePerSecond > 0)) {
      issues.push(issue('workload-emission-range', [...at, 'emission', 'ratePerSecond'], w.id, 'A stream needs a rate above 0 per second'));
    }
  });
  doc.connections.forEach((conn, ci) => {
    const src = elementsMap.get(conn.source.elementId);
    if (
      conn.kind === 'call' &&
      callRetryOf(doc, conn)?.attemptTimeoutMs != null &&
      src?.behavior.kind === 'resource' &&
      src.behavior.config.type === 'broker' &&
      closure.includedConnectionIds.includes(conn.id)
    ) {
      issues.push(
        issue(
          'broker-route-attempt-timeout',
          ['elements', doc.elements.findIndex((e) => e.id === conn.source.elementId), 'ports', (src?.ports.findIndex((p) => p.id === conn.source.portId) ?? 0), 'settings', 'retry', 'attemptTimeoutMs'],
          conn.id,
          `'${src.label}' redelivers after the backoff; a delivery route has no attempt timeout`,
        ),
      );
    }
  });
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

  // --------------------------------------------------------------------------
  // §4 Behaviors: unmodeled elements reachable only behind boundary fixtures.
  // "unmodeled: reachable in a runnable scenario only behind a boundary fixture"
  // "so reject any unmodeled element present in the closure's includedElementIds."
  // --------------------------------------------------------------------------
  for (const elId of closure.includedElementIds) {
    const el = elementsMap.get(elId);
    if (!el) continue;
    const elIdx = doc.elements.findIndex((e) => e.id === elId);
    if (el.behavior.kind === 'unmodeled') {
      issues.push(
        issue(
          'unmodeled-element',
          ['elements', elIdx, 'behavior', 'kind'],
          el.id,
          `Element '${el.id}' has unmodeled behavior; reachable in a runnable scenario only behind a boundary fixture (specs/revamp/contracts/model-and-runner.md §4)`,
        ),
      );
    }
  }

  // --------------------------------------------------------------------------
  // §4 Wiring / §5: Machine checks
  // 1. Unbound call responses:
  //    §4 Wiring: "A machine response binding maps each outbound call port to exactly one
  //    inbound event port on the same machine, with a compatible shape."
  //    §5: "Readiness rejects: unbound call responses"
  // 2. Effect lists that could reply twice:
  //    §4 Behaviors: "{id,kind:'reply',value:Value,outcome:'succeeded'|'rejected'|'failed'|'expired'}
  //    — settles the current initiating call frame exactly once"
  //    §5: "Readiness rejects: ... effect lists that could reply twice ... Path-dependent
  //    double settlement and budget-exhausting message cycles fail or end incomplete at runtime."
  // 3. Machine transition eventPortId:
  //    §4 Transitions and effects: "eventPortId may be any inbound event/call/message/data
  //    port on the machine."
  // --------------------------------------------------------------------------
  for (const elId of closure.includedElementIds) {
    const el = elementsMap.get(elId);
    if (!el || el.behavior.kind !== 'machine') continue;
    const mb = el.behavior as MachineBehavior;
    const elIdx = doc.elements.findIndex((e) => e.id === elId);

    // 1. Unbound call responses:
    // Every outbound call port of an included machine that is used (emit effect portId
    // or wired connection) must appear in exactly one responseBinding whose eventPortId
    // is an inbound event port on the same machine with a shape compatible with the call
    // port's responseSchemaId.
    el.ports.forEach((p, pIdx) => {
      if (p.direction === 'out' && p.channel === 'call') {
        const isEmitted = mb.transitions.some((t) =>
          t.effects.some((eff) => eff.kind === 'emit' && eff.portId === p.id),
        );
        const isWired = doc.connections.some(
          (c) => c.source.elementId === el.id && c.source.portId === p.id,
        );
        if (isEmitted || isWired) {
          const matchingBindings = mb.responseBindings.filter((rb) => rb.callPortId === p.id);
          if (matchingBindings.length === 0) {
            issues.push(
              issue(
                'unbound-call-response',
                ['elements', elIdx, 'ports', pIdx],
                p.id,
                `Outbound call port '${p.id}' on machine '${el.id}' is used but has no response binding (specs/revamp/contracts/model-and-runner.md §4, §5)`,
              ),
            );
          } else if (matchingBindings.length > 1) {
            issues.push(
              issue(
                'unbound-call-response',
                ['elements', elIdx, 'behavior', 'responseBindings'],
                el.id,
                `Outbound call port '${p.id}' on machine '${el.id}' has multiple response bindings; expected exactly one (specs/revamp/contracts/model-and-runner.md §4, §5)`,
              ),
            );
          } else {
            const rb = matchingBindings[0];
            const rbIdx = mb.responseBindings.indexOf(rb);
            const eventPort = el.ports.find((ep) => ep.id === rb.eventPortId);
            if (!eventPort || eventPort.direction !== 'in' || eventPort.channel !== 'event') {
              issues.push(
                issue(
                  'unbound-call-response',
                  ['elements', elIdx, 'behavior', 'responseBindings', rbIdx, 'eventPortId'],
                  rb.id,
                  `Response binding '${rb.id}' eventPortId '${rb.eventPortId}' must be an inbound event port on machine '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
                ),
              );
            } else if (p.responseSchemaId) {
              const callRespShape = schemaShapeMap.get(p.responseSchemaId);
              const eventShape = schemaShapeMap.get(eventPort.schemaId);
              if (callRespShape && eventShape && !shapesCompatible(callRespShape, eventShape)) {
                issues.push(
                  issue(
                    'unbound-call-response',
                    ['elements', elIdx, 'behavior', 'responseBindings', rbIdx, 'eventPortId'],
                    rb.id,
                    `Response binding '${rb.id}' event port '${eventPort.id}' shape is incompatible with call port '${p.id}' response schema (specs/revamp/contracts/model-and-runner.md §4)`,
                  ),
                );
              }
            }
          }
        }
      }
    });

    // 2. Effect lists that could reply twice:
    // Within one transition's ordered effects, more than one 'reply' effect is a reject.
    mb.transitions.forEach((t, tIdx) => {
      const replyEffects: { eff: Effect; effIdx: number }[] = [];
      t.effects.forEach((eff, effIdx) => {
        if (eff.kind === 'reply') {
          replyEffects.push({ eff, effIdx });
        }
      });
      if (replyEffects.length > 1) {
        for (let i = 1; i < replyEffects.length; i++) {
          issues.push(
            issue(
              'reply-twice',
              ['elements', elIdx, 'behavior', 'transitions', tIdx, 'effects', replyEffects[i].effIdx],
              replyEffects[i].eff.id,
              `Transition '${t.id}' has multiple reply effects; an effect list cannot reply twice (specs/revamp/contracts/model-and-runner.md §5)`,
            ),
          );
        }
      }
    });

    // 3. Machine transition eventPortId:
    // Machine transition eventPortId is an inbound event/call/message/data port on the same machine.
    mb.transitions.forEach((t, tIdx) => {
      const evPort = el.ports.find((p) => p.id === t.eventPortId);
      if (!evPort || evPort.direction !== 'in') {
        issues.push(
          issue(
            'mismatched-schema',
            ['elements', elIdx, 'behavior', 'transitions', tIdx, 'eventPortId'],
            t.eventPortId,
            `Machine transition '${t.id}' eventPortId '${t.eventPortId}' must be an inbound port on machine '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
          ),
        );
      }
    });
  }

  // --------------------------------------------------------------------------
  // §4 Wiring / §5: Decision checks
  // §4 Wiring: "A decision's inputPortId is an inbound data port matching inputSchemaId.
  // Case/fallback ports are outbound data ports..."
  // §5: "Readiness rejects: ... mismatched schemas"
  // --------------------------------------------------------------------------
  for (const elId of closure.includedElementIds) {
    const el = elementsMap.get(elId);
    if (!el || el.behavior.kind !== 'decision') continue;
    const db = el.behavior as DecisionBehavior;
    const elIdx = doc.elements.findIndex((e) => e.id === elId);

    const inPort = el.ports.find((p) => p.id === db.inputPortId);
    const inPortShape = inPort ? schemaShapeMap.get(inPort.schemaId) : null;
    const expectedInShape = schemaShapeMap.get(db.inputSchemaId);
    if (
      !inPort ||
      inPort.direction !== 'in' ||
      inPort.channel !== 'data' ||
      !inPortShape ||
      !expectedInShape ||
      !shapesCompatible(inPortShape, expectedInShape)
    ) {
      issues.push(
        issue(
          'mismatched-schema',
          ['elements', elIdx, 'behavior', 'inputPortId'],
          db.inputPortId,
          `Decision inputPortId '${db.inputPortId}' must be an inbound data port whose schema matches inputSchemaId on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
        ),
      );
    }

    db.cases.forEach((c, cIdx) => {
      const cPort = el.ports.find((p) => p.id === c.outputPortId);
      if (!cPort || cPort.direction !== 'out' || cPort.channel !== 'data') {
        issues.push(
          issue(
            'mismatched-schema',
            ['elements', elIdx, 'behavior', 'cases', cIdx, 'outputPortId'],
            c.outputPortId,
            `Decision case outputPortId '${c.outputPortId}' must be an outbound data port on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
          ),
        );
      }
    });

    const fbPort = el.ports.find((p) => p.id === db.fallback.outputPortId);
    if (!fbPort || fbPort.direction !== 'out' || fbPort.channel !== 'data') {
      issues.push(
        issue(
          'mismatched-schema',
          ['elements', elIdx, 'behavior', 'fallback', 'outputPortId'],
          db.fallback.outputPortId,
          `Decision fallback outputPortId '${db.fallback.outputPortId}' must be an outbound data port on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
        ),
      );
    }
  }

  // --------------------------------------------------------------------------
  // §4 Wiring / §5: Resource checks
  // §4 Wiring: "A resource entryPortId is an inbound call/message port."
  // §5: "Readiness rejects: ... mismatched schemas"
  // --------------------------------------------------------------------------
  for (const elId of closure.includedElementIds) {
    const el = elementsMap.get(elId);
    if (!el || el.behavior.kind !== 'resource') continue;
    const rb = el.behavior as ResourceBehavior;
    const elIdx = doc.elements.findIndex((e) => e.id === elId);

    const entryPort = el.ports.find((p) => p.id === rb.entryPortId);
    if (!entryPort || entryPort.direction !== 'in' || (entryPort.channel !== 'call' && entryPort.channel !== 'message')) {
      issues.push(
        issue(
          'mismatched-schema',
          ['elements', elIdx, 'behavior', 'entryPortId'],
          rb.entryPortId,
          `Resource entryPortId '${rb.entryPortId}' must be an inbound call or message port on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
        ),
      );
    }
  }

  // --------------------------------------------------------------------------
  // §8 Bridge call frames: a call continuation from a resource to a non-resource target.
  // "A non-router resource with a bridge call continuation may have no other selectable
  // call continuation (routers select exactly one route)." A router's routes must reach
  // resources: it shares load by capacity, and a non-resource target has none, so the
  // modelled pattern is router -> resource (e.g. a Service) -> bridge -> machine.
  // --------------------------------------------------------------------------
  for (const elId of closure.includedElementIds) {
    const el = elementsMap.get(elId);
    if (!el || el.behavior.kind !== 'resource') continue;
    const rb = el.behavior as ResourceBehavior;
    const elIdx = doc.elements.findIndex((e) => e.id === elId);

    const calls = doc.connections.filter(
      (c) => c.kind === 'call' && c.source.elementId === elId && includedElementSet.has(c.target.elementId),
    );
    const bridges = calls.filter((c) => elementsMap.get(c.target.elementId)?.behavior.kind !== 'resource');
    if (bridges.length === 0) continue;

    if (rb.config.type === 'router') {
      issues.push(
        issue(
          'router-route-needs-resource',
          ['elements', elIdx, 'behavior', 'config', 'type'],
          el.id,
          routerRouteMessage(el.label, elementsMap.get(bridges[0].target.elementId), bridges[0].target.elementId),
        ),
      );
    } else if (calls.length > 1) {
      issues.push(
        issue(
          'bridge-continuation-conflict',
          ['elements', elIdx, 'behavior'],
          el.id,
          `Resource '${el.label}' calls non-resource '${elementsMap.get(bridges[0].target.elementId)?.label ?? bridges[0].target.elementId}' and has another call continuation; a resource with a bridge call may have no other call continuation (specs/revamp/contracts/model-and-runner.md §8)`,
        ),
      );
    }
  }

  // --------------------------------------------------------------------------
  // §4 Wiring / §5: Pipeline checks
  // §4 Wiring: "A pipeline's inputPortId, outputPortId and errorPortId must be data-channel
  // ports whose shapes match its input, output and error schemas."
  // §5: "Readiness rejects: ... mismatched schemas; missing pipeline outputs."
  // --------------------------------------------------------------------------
  for (const elId of closure.includedElementIds) {
    const el = elementsMap.get(elId);
    if (!el || el.behavior.kind !== 'pipeline') continue;
    const pb = el.behavior as PipelineBehavior;
    const elIdx = doc.elements.findIndex((e) => e.id === elId);

    const inPort = el.ports.find((p) => p.id === pb.inputPortId);
    const inShape = inPort ? schemaShapeMap.get(inPort.schemaId) : null;
    const expectedInShape = schemaShapeMap.get(pb.inputSchemaId);
    if (
      !inPort ||
      inPort.direction !== 'in' ||
      inPort.channel !== 'data' ||
      !inShape ||
      !expectedInShape ||
      !shapesCompatible(inShape, expectedInShape)
    ) {
      issues.push(
        issue(
          'mismatched-schema',
          ['elements', elIdx, 'behavior', 'inputPortId'],
          pb.inputPortId,
          `Pipeline inputPortId '${pb.inputPortId}' must be an inbound data port matching inputSchemaId on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
        ),
      );
    }

    const outPort = el.ports.find((p) => p.id === pb.outputPortId);
    if (outPort) {
      const outShape = schemaShapeMap.get(outPort.schemaId);
      const expectedOutShape = schemaShapeMap.get(pb.outputSchemaId);
      if (
        outPort.direction !== 'out' ||
        outPort.channel !== 'data' ||
        !outShape ||
        !expectedOutShape ||
        !shapesCompatible(outShape, expectedOutShape)
      ) {
        issues.push(
          issue(
            'mismatched-schema',
            ['elements', elIdx, 'behavior', 'outputPortId'],
            pb.outputPortId,
            `Pipeline outputPortId '${pb.outputPortId}' must be an outbound data port matching outputSchemaId on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
          ),
        );
      }
    }

    const errPort = el.ports.find((p) => p.id === pb.errorPortId);
    if (errPort) {
      const errShape = schemaShapeMap.get(errPort.schemaId);
      const expectedErrShape = schemaShapeMap.get(pb.errorSchemaId);
      if (
        errPort.direction !== 'out' ||
        errPort.channel !== 'data' ||
        !errShape ||
        !expectedErrShape ||
        !shapesCompatible(errShape, expectedErrShape)
      ) {
        issues.push(
          issue(
            'mismatched-schema',
            ['elements', elIdx, 'behavior', 'errorPortId'],
            pb.errorPortId,
            `Pipeline errorPortId '${pb.errorPortId}' must be an outbound data port matching errorSchemaId on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §4)`,
          ),
        );
      }
    }

    // Check 4: Missing pipeline outputs (§5)
    // Fires only when outputPortId or errorPortId does not resolve to a port on the same
    // element (defensive check; the storable validator normally catches it).
    if (!outPort) {
      issues.push(
        issue(
          'missing-pipeline-output',
          ['elements', elIdx, 'behavior', 'outputPortId'],
          pb.outputPortId,
          `Pipeline '${el.id}' outputPortId '${pb.outputPortId}' does not resolve to a port on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §5)`,
        ),
      );
    }
    if (!errPort) {
      issues.push(
        issue(
          'missing-pipeline-output',
          ['elements', elIdx, 'behavior', 'errorPortId'],
          pb.errorPortId,
          `Pipeline '${el.id}' errorPortId '${pb.errorPortId}' does not resolve to a port on element '${el.id}' (specs/revamp/contracts/model-and-runner.md §5)`,
        ),
      );
    }
  }

  checkExpressions(doc, scenario, includedElementSet, schemaShapeMap, issues);

  if (issues.length > 0) {
    return { ready: false, issues };
  }

  return { ready: true, closure };
}

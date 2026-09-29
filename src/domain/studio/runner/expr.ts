/**
 * Value and Guard evaluator (RV-14b).
 *
 * Implements specs/revamp/contracts/model-and-runner.md §4 ("Values and guards")
 * and the Evaluator interface from runner/expr-api.ts:
 * - Path reads over input/context, returning `missingValue` for missing reads.
 * - Only `exists` can test `missingValue`; other operations produce a modeled EvalError.
 * - Record/list constructors with unique keys and no missing values.
 * - `outcome` reads the current invocation's transport outcome.
 * - Canonical-JSON equality with no coercion.
 * - `all`/`any` nonempty.
 * - `positiveInteger` checks integer > 0; non-integers yield a modeled wrong-type EvalError.
 * - `nonEmpty` checks length/keys > 0 on string, list, or record; other types yield wrong-type EvalError.
 * - `every` iterates a list (input = item, context unchanged; empty list is true).
 * - Modeled EvalErrors are returned as values, never thrown, never coerced.
 */

import { canonicalJson } from '../canonical';
import type { Guard, Json, Path, Value } from '../model';
import type {
  Evaluator,
  EvalError,
  EvalResult,
  EvalScope,
  GuardOutcome,
  ValueOutcome,
} from './expr-api';
import { isMissing, missingValue } from './expr-api';

/**
 * Traverses a JSON tree along a Path.
 * Returns `missingValue(path)` if any step is not traversable, index out of range,
 * property absent, or accesses prototype keys.
 */
export function readPath(root: unknown, path: Path): EvalResult {
  let current: unknown = root;
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (current === null || current === undefined || typeof current !== 'object') {
      return missingValue(path);
    }
    if (Array.isArray(current)) {
      if (typeof step !== 'number' || !Number.isInteger(step) || step < 0 || step >= current.length) {
        return missingValue(path);
      }
      current = current[step];
    } else {
      if (typeof step !== 'string') {
        return missingValue(path);
      }
      if (step === '__proto__' || step === 'prototype' || step === 'constructor') {
        return missingValue(path);
      }
      if (!Object.prototype.hasOwnProperty.call(current, step)) {
        return missingValue(path);
      }
      current = (current as Record<string, unknown>)[step];
    }
  }
  if (current === undefined) {
    return missingValue(path);
  }
  return current as Json;
}

export class ExprEvaluator implements Evaluator {
  evalValue(value: Value, scope: EvalScope): ValueOutcome {
    switch (value.kind) {
      case 'literal':
        return { ok: true, value: value.value };

      case 'read': {
        const root = value.source === 'input' ? scope.input : scope.context;
        const res = readPath(root, value.path);
        return { ok: true, value: res };
      }

      case 'outcome':
        return { ok: true, value: scope.outcome };

      case 'record': {
        const seenKeys = new Set<string>();
        const rec: Record<string, Json> = {};
        for (const field of value.fields) {
          if (seenKeys.has(field.key)) {
            return {
              ok: false,
              error: {
                code: 'duplicate-key',
                path: [field.key],
                message: `Duplicate key '${field.key}' in record constructor`,
              },
            };
          }
          seenKeys.add(field.key);
          const fieldRes = this.evalValue(field.value, scope);
          if (!fieldRes.ok) return fieldRes;
          if (isMissing(fieldRes.value)) {
            return {
              ok: false,
              error: {
                code: 'missing-value',
                path: [field.key],
                message: `Record field '${field.key}' evaluated to missing value`,
              },
            };
          }
          rec[field.key] = fieldRes.value;
        }
        return { ok: true, value: Object.freeze(rec) };
      }

      case 'list': {
        const arr: Json[] = [];
        for (let i = 0; i < value.items.length; i++) {
          const itemRes = this.evalValue(value.items[i], scope);
          if (!itemRes.ok) return itemRes;
          if (isMissing(itemRes.value)) {
            return {
              ok: false,
              error: {
                code: 'missing-value',
                path: [i],
                message: `List item at index ${i} evaluated to missing value`,
              },
            };
          }
          arr.push(itemRes.value);
        }
        return { ok: true, value: Object.freeze(arr) };
      }

      default:
        return {
          ok: false,
          error: {
            code: 'unknown-value-kind',
            path: [],
            message: `Unknown value kind '${(value as { kind?: string }).kind}'`,
          },
        };
    }
  }

  evalGuard(guard: Guard, scope: EvalScope): GuardOutcome {
    switch (guard.op) {
      case 'exists': {
        const valRes = this.evalValue(guard.value, scope);
        if (!valRes.ok) return valRes;
        return { ok: true, value: !isMissing(valRes.value) };
      }

      case 'equals':
      case 'notEquals': {
        const leftRes = this.evalValue(guard.left, scope);
        if (!leftRes.ok) return leftRes;
        if (isMissing(leftRes.value)) {
          return {
            ok: false,
            error: {
              code: 'missing-value',
              path: guard.left.kind === 'read' ? guard.left.path : [],
              message: 'Left operand in equals/notEquals evaluated to missing value',
            },
          };
        }
        const rightRes = this.evalValue(guard.right, scope);
        if (!rightRes.ok) return rightRes;
        if (isMissing(rightRes.value)) {
          return {
            ok: false,
            error: {
              code: 'missing-value',
              path: guard.right.kind === 'read' ? guard.right.path : [],
              message: 'Right operand in equals/notEquals evaluated to missing value',
            },
          };
        }

        const leftCanon = canonicalJson(leftRes.value);
        const rightCanon = canonicalJson(rightRes.value);
        if (!leftCanon.ok || !rightCanon.ok) {
          return {
            ok: false,
            error: {
              code: 'canonical-json-error',
              path: [],
              message: 'Failed to canonicalize JSON in equality comparison',
            },
          };
        }
        const eq = leftCanon.text === rightCanon.text;
        return { ok: true, value: guard.op === 'equals' ? eq : !eq };
      }

      case 'all': {
        if (guard.guards.length === 0) {
          return {
            ok: false,
            error: {
              code: 'empty-guards',
              path: [],
              message: "'all' guard requires a non-empty guards array",
            },
          };
        }
        for (const sub of guard.guards) {
          const res = this.evalGuard(sub, scope);
          if (!res.ok) return res;
          if (!res.value) return { ok: true, value: false };
        }
        return { ok: true, value: true };
      }

      case 'any': {
        if (guard.guards.length === 0) {
          return {
            ok: false,
            error: {
              code: 'empty-guards',
              path: [],
              message: "'any' guard requires a non-empty guards array",
            },
          };
        }
        for (const sub of guard.guards) {
          const res = this.evalGuard(sub, scope);
          if (!res.ok) return res;
          if (res.value) return { ok: true, value: true };
        }
        return { ok: true, value: false };
      }

      case 'positiveInteger': {
        const valRes = this.evalValue(guard.value, scope);
        if (!valRes.ok) return valRes;
        if (isMissing(valRes.value)) {
          return {
            ok: false,
            error: {
              code: 'missing-value',
              path: guard.value.kind === 'read' ? guard.value.path : [],
              message: 'Value in positiveInteger evaluated to missing value',
            },
          };
        }
        const v = valRes.value;
        if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
          return {
            ok: false,
            error: {
              code: 'wrong-type',
              path: guard.value.kind === 'read' ? guard.value.path : [],
              message: `positiveInteger requires safe integer, got ${v === null ? 'null' : typeof v}`,
            },
          };
        }
        return { ok: true, value: v > 0 };
      }

      case 'nonEmpty': {
        const valRes = this.evalValue(guard.value, scope);
        if (!valRes.ok) return valRes;
        if (isMissing(valRes.value)) {
          return {
            ok: false,
            error: {
              code: 'missing-value',
              path: guard.value.kind === 'read' ? guard.value.path : [],
              message: 'Value in nonEmpty evaluated to missing value',
            },
          };
        }
        const v = valRes.value;
        if (typeof v === 'string') {
          return { ok: true, value: v.length > 0 };
        }
        if (Array.isArray(v)) {
          return { ok: true, value: v.length > 0 };
        }
        if (v !== null && typeof v === 'object') {
          return { ok: true, value: Object.keys(v).length > 0 };
        }
        return {
          ok: false,
          error: {
            code: 'wrong-type',
            path: guard.value.kind === 'read' ? guard.value.path : [],
            message: `nonEmpty requires string, list, or record, got ${v === null ? 'null' : typeof v}`,
          },
        };
      }

      case 'every': {
        const valRes = this.evalValue(guard.value, scope);
        if (!valRes.ok) return valRes;
        if (isMissing(valRes.value)) {
          return {
            ok: false,
            error: {
              code: 'missing-value',
              path: guard.value.kind === 'read' ? guard.value.path : [],
              message: 'Value in every evaluated to missing value',
            },
          };
        }
        const v = valRes.value;
        if (!Array.isArray(v)) {
          return {
            ok: false,
            error: {
              code: 'wrong-type',
              path: guard.value.kind === 'read' ? guard.value.path : [],
              message: `every requires list, got ${v === null ? 'null' : typeof v}`,
            },
          };
        }
        if (v.length === 0) {
          return { ok: true, value: true };
        }
        for (const item of v) {
          const itemScope: EvalScope = {
            input: item,
            context: scope.context,
            outcome: scope.outcome,
          };
          const itemRes = this.evalGuard(guard.itemGuard, itemScope);
          if (!itemRes.ok) return itemRes;
          if (!itemRes.value) return { ok: true, value: false };
        }
        return { ok: true, value: true };
      }

      default:
        return {
          ok: false,
          error: {
            code: 'unknown-guard-op',
            path: [],
            message: `Unknown guard op '${(guard as { op?: string }).op}'`,
          },
        };
    }
  }
}

export const defaultEvaluator = new ExprEvaluator();

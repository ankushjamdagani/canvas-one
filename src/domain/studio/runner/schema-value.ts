/**
 * Schema value validator (RV-14c).
 *
 * Validates a runtime Json value against a document PayloadSchema shape per
 * specs/revamp/contracts/model-and-runner.md §3 "Payload schemas":
 * - Scalar shapes ('string' | 'boolean' | 'number' | 'integer', nullable)
 * - Record shape (nullable, closed records: unknown payload fields rejected,
 *   prototype keys rejected, optional fields may be omitted, missing != null)
 * - List shape (nullable, maxItems, items shape, no sparse arrays)
 * - Scalar-union shape (nullable, 2-4 distinct scalar types)
 * - Numbers must be finite double; integers must be safe integer
 * - Nullability is explicit on every shape
 */

import type { Id, Shape, ScalarType } from '../model';
import type { Issue } from '../validate';

const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Checks whether a string contains any unpaired Unicode surrogates.
 */
function isSurrogateValid(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= str.length) return false;
      const next = str.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function matchesScalarType(value: unknown, scalarType: ScalarType): boolean {
  switch (scalarType) {
    case 'string':
      return typeof value === 'string' && isSurrogateValid(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
  }
}

/**
 * Validates a JSON value against a document schema Shape.
 * Returns { ok: true } on success, or { ok: false, issues: Issue[] } on mismatch.
 */
export function validateSchemaValue(
  value: unknown,
  shape: Shape,
  basePath: readonly (string | number)[] = [],
  entityId: Id | null = null,
): { ok: true } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];

  function validate(val: unknown, currentShape: Shape, path: readonly (string | number)[]): void {
    if (val === undefined) {
      issues.push({
        code: 'wrong-type',
        path,
        entityId,
        severity: 'error',
        message: 'Expected a defined JSON value, got undefined',
      });
      return;
    }

    if (val === null) {
      if (!currentShape.nullable) {
        issues.push({
          code: 'wrong-type',
          path,
          entityId,
          severity: 'error',
          message: 'Expected non-null value for non-nullable schema',
        });
      }
      return;
    }

    switch (currentShape.type) {
      case 'string': {
        if (typeof val !== 'string') {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: `Expected string, got ${typeof val}`,
          });
        } else if (!isSurrogateValid(val)) {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: 'String contains unpaired Unicode surrogates',
          });
        }
        break;
      }

      case 'boolean': {
        if (typeof val !== 'boolean') {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: `Expected boolean, got ${typeof val}`,
          });
        }
        break;
      }

      case 'number': {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: `Expected finite number, got ${typeof val === 'number' ? String(val) : typeof val}`,
          });
        }
        break;
      }

      case 'integer': {
        if (typeof val !== 'number' || !Number.isSafeInteger(val)) {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: `Expected safe integer, got ${typeof val === 'number' ? String(val) : typeof val}`,
          });
        }
        break;
      }

      case 'scalar-union': {
        const matches = currentShape.types.some((t) => matchesScalarType(val, t));
        if (!matches) {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: `Value does not match any of scalar union types: [${currentShape.types.join(', ')}]`,
          });
        }
        break;
      }

      case 'list': {
        if (!Array.isArray(val)) {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: `Expected array for list shape, got ${typeof val}`,
          });
          return;
        }

        // Check for holes in array
        for (let i = 0; i < val.length; i++) {
          if (!Object.hasOwn(val, i)) {
            issues.push({
              code: 'wrong-type',
              path: [...path, i],
              entityId,
              severity: 'error',
              message: `Sparse array hole at index ${i} is disallowed`,
            });
            return;
          }
        }

        if (val.length > currentShape.maxItems) {
          issues.push({
            code: 'too-many',
            path,
            entityId,
            severity: 'error',
            message: `List length ${val.length} exceeds maxItems ceiling of ${currentShape.maxItems}`,
          });
        }

        for (let i = 0; i < val.length; i++) {
          validate(val[i], currentShape.items, [...path, i]);
        }
        break;
      }

      case 'record': {
        if (typeof val !== 'object' || val === null || Array.isArray(val)) {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: `Expected plain object for record shape, got ${Array.isArray(val) ? 'array' : typeof val}`,
          });
          return;
        }

        const proto = Object.getPrototypeOf(val);
        if (proto !== Object.prototype && proto !== null) {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: 'Non-plain object disallowed in record payload',
          });
          return;
        }

        if (Object.getOwnPropertySymbols(val).length > 0) {
          issues.push({
            code: 'wrong-type',
            path,
            entityId,
            severity: 'error',
            message: 'Disallowed Symbol property in record payload',
          });
          return;
        }

        const obj = val as Record<string, unknown>;
        const keys = Object.keys(obj);

        // Check prototype pollution keys
        for (const k of keys) {
          if (PROTOTYPE_KEYS.has(k)) {
            issues.push({
              code: 'prototype-key',
              path: [...path, k],
              entityId,
              severity: 'error',
              message: `Disallowed prototype key '${k}' in payload`,
            });
          }
        }

        // Closed records: reject unknown payload fields
        const declaredFields = new Map<string, (typeof currentShape.fields)[number]>();
        for (const f of currentShape.fields) {
          declaredFields.set(f.key, f);
        }

        for (const k of keys) {
          if (!declaredFields.has(k)) {
            issues.push({
              code: 'unknown-property',
              path: [...path, k],
              entityId,
              severity: 'error',
              message: `Unknown property '${k}' on closed record`,
            });
          }
        }

        // Validate declared fields
        for (const f of currentShape.fields) {
          if (Object.hasOwn(obj, f.key)) {
            validate(obj[f.key], f.shape, [...path, f.key]);
          } else if (!f.optional) {
            issues.push({
              code: 'missing-property',
              path: [...path, f.key],
              entityId,
              severity: 'error',
              message: `Missing required property '${f.key}'`,
            });
          }
        }
        break;
      }
    }
  }

  validate(value, shape, basePath);

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true };
}

/**
 * Convenient boolean check for schema value validity.
 */
export function isSchemaValueValid(value: unknown, shape: Shape): boolean {
  return validateSchemaValue(value, shape).ok;
}

/**
 * Schema value validator.
 *
 * Validates a runtime Json value against a document PayloadSchema shape:
 * - Scalar shapes ('string' | 'boolean' | 'number' | 'integer', nullable)
 * - Record shape (nullable, closed records: unknown payload fields rejected,
 *   prototype keys rejected, optional fields may be omitted, missing != null)
 * - List shape (nullable, maxItems, items shape, no sparse arrays)
 * - Scalar-union shape (nullable, 2-4 distinct scalar types)
 * - Numbers must be finite double; integers must be safe integer
 * - Nullability is explicit on every shape
 */

import type { Id, Shape, ScalarType } from '@canvas-one/system-design/studio/model';
import type { Issue } from '@canvas-one/system-design/studio/validate';
import { PROTOTYPE_KEYS, isSurrogateValid } from '@canvas-one/system-design/studio/text';
import { errorIssue } from '@canvas-one/system-design/studio/issue';

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
      issues.push(errorIssue('wrong-type', path, entityId, 'Expected a defined JSON value, got undefined'));
      return;
    }

    if (val === null) {
      if (!currentShape.nullable) {
        issues.push(errorIssue('wrong-type', path, entityId, 'Expected non-null value for non-nullable schema'));
      }
      return;
    }

    switch (currentShape.type) {
      case 'string': {
        if (typeof val !== 'string') {
          issues.push(errorIssue('wrong-type', path, entityId, `Expected string, got ${typeof val}`));
        } else if (!isSurrogateValid(val)) {
          issues.push(errorIssue('wrong-type', path, entityId, 'String contains unpaired Unicode surrogates'));
        }
        break;
      }

      case 'boolean': {
        if (typeof val !== 'boolean') {
          issues.push(errorIssue('wrong-type', path, entityId, `Expected boolean, got ${typeof val}`));
        }
        break;
      }

      case 'number': {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          issues.push(
            errorIssue(
              'wrong-type',
              path,
              entityId,
              `Expected finite number, got ${typeof val === 'number' ? String(val) : typeof val}`,
            ),
          );
        }
        break;
      }

      case 'integer': {
        if (typeof val !== 'number' || !Number.isSafeInteger(val)) {
          issues.push(
            errorIssue(
              'wrong-type',
              path,
              entityId,
              `Expected safe integer, got ${typeof val === 'number' ? String(val) : typeof val}`,
            ),
          );
        }
        break;
      }

      case 'scalar-union': {
        const matches = currentShape.types.some((t) => matchesScalarType(val, t));
        if (!matches) {
          issues.push(
            errorIssue(
              'wrong-type',
              path,
              entityId,
              `Value does not match any of scalar union types: [${currentShape.types.join(', ')}]`,
            ),
          );
        }
        break;
      }

      case 'list': {
        if (!Array.isArray(val)) {
          issues.push(
            errorIssue(
              'wrong-type',
              path,
              entityId,
              `Expected array for list shape, got ${typeof val}`,
            ),
          );
          return;
        }

        // Check for holes in array
        for (let i = 0; i < val.length; i++) {
          if (!Object.hasOwn(val, i)) {
            issues.push(
              errorIssue(
                'wrong-type',
                [...path, i],
                entityId,
                `Sparse array hole at index ${i} is disallowed`,
              ),
            );
            return;
          }
        }

        if (val.length > currentShape.maxItems) {
          issues.push(
            errorIssue(
              'too-many',
              path,
              entityId,
              `List length ${val.length} exceeds maxItems ceiling of ${currentShape.maxItems}`,
            ),
          );
        }

        for (let i = 0; i < val.length; i++) {
          validate(val[i], currentShape.items, [...path, i]);
        }
        break;
      }

      case 'record': {
        if (typeof val !== 'object' || val === null || Array.isArray(val)) {
          issues.push(
            errorIssue(
              'wrong-type',
              path,
              entityId,
              `Expected plain object for record shape, got ${Array.isArray(val) ? 'array' : typeof val}`,
            ),
          );
          return;
        }

        const proto = Object.getPrototypeOf(val);
        if (proto !== Object.prototype && proto !== null) {
          issues.push(errorIssue('wrong-type', path, entityId, 'Non-plain object disallowed in record payload'));
          return;
        }

        if (Object.getOwnPropertySymbols(val).length > 0) {
          issues.push(errorIssue('wrong-type', path, entityId, 'Disallowed Symbol property in record payload'));
          return;
        }

        const obj = val as Record<string, unknown>;
        const keys = Object.keys(obj);

        // Check prototype pollution keys
        for (const k of keys) {
          if (PROTOTYPE_KEYS.has(k)) {
            issues.push(
              errorIssue(
                'prototype-key',
                [...path, k],
                entityId,
                `Disallowed prototype key '${k}' in payload`,
              ),
            );
          }
        }

        // Closed records: reject unknown payload fields
        const declaredFields = new Map<string, (typeof currentShape.fields)[number]>();
        for (const f of currentShape.fields) {
          declaredFields.set(f.key, f);
        }

        for (const k of keys) {
          if (!declaredFields.has(k)) {
            issues.push(
              errorIssue(
                'unknown-property',
                [...path, k],
                entityId,
                `Unknown property '${k}' on closed record`,
              ),
            );
          }
        }

        // Validate declared fields
        for (const f of currentShape.fields) {
          if (Object.hasOwn(obj, f.key)) {
            validate(obj[f.key], f.shape, [...path, f.key]);
          } else if (!f.optional) {
            issues.push(
              errorIssue(
                'missing-property',
                [...path, f.key],
                entityId,
                `Missing required property '${f.key}'`,
              ),
            );
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

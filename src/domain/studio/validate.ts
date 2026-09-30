/**
 * Storable-level studio-model/1 document validator (RV-02b).
 *
 * Enforces §1 ground rules, §2 records, §3 payload schemas, §4 behaviors, §6 scenarios,
 * and storage.md §6 limits checkable without canonical bytes.
 *
 * SCOPE: STORABLE validation only (§1: "types, bounds, IDs and references are correct").
 *
 * Runnable readiness (model-and-runner.md §1–§3, §5, §6) is readiness.ts; the trace envelope
 * (§8) is runner/trace.ts.
 */

import { canonicalJson } from './canonical';
import type {
  Document,
  Id,
} from './model';
import {
  DOCUMENT_FIELDS,
  VISUAL_KINDS,
  PORT_DIRECTIONS,
  PORT_CHANNELS,
  CONNECTION_KINDS,
  RELATION_KINDS,
  SCALAR_TYPES,
  BEHAVIOR_KINDS,
  ROUTE_CONDITION_FIELDS,
  GUARD_OPS,
  VALUE_KINDS,
  TRANSPORT_OUTCOMES,
  OPERATION_KINDS,
  COMPLETION_KINDS,
  ASSERTION_SUBJECT_KINDS,
  ASSERTION_OPERATORS,
  COUNT_SUBJECT_SCOPES,
  COUNT_SUBJECT_OUTCOMES,
  METRIC_SUBJECT_KEYS,
  ASSUMPTION_SOURCES,
  NOTE_TONES,
} from './model';

/**
 * Closed set of schema validation issue codes.
 */
export const ISSUE_CODES = [
  /** Property is not recognized on a closed record. */
  'unknown-property',
  /** Required property is absent on a record. */
  'missing-property',
  /** Value has an unexpected JavaScript/JSON type or non-finite number. */
  'wrong-type',
  /** ID does not conform to the canonical lowercase UUID format (8-4-4-4-12 hex). */
  'invalid-id',
  /** ID is duplicated within the document. */
  'duplicate-id',
  /** Referenced ID does not exist in the document or scope. */
  'dangling-reference',
  /** Referenced entity exists but is not of the expected kind or behavior. */
  'wrong-reference-kind',
  /** Numeric value or string length is outside allowed bounds. */
  'out-of-range',
  /** Number of items in a collection exceeds the schema or storage ceiling. */
  'too-many',
  /** String code-point length exceeds maximum allowed limit. */
  'too-long',
  /** Byte size of a document, fixture, or string exceeds storage limits. */
  'too-large',
  /** Nesting depth exceeds allowed raw document or semantic depth ceiling. */
  'too-deep',
  /** Enumerated literal or discriminant does not match allowed values. */
  'invalid-literal',
  /** Duplicate key found in a record shape, record value, map operation, or scenario assumptions. */
  'duplicate-key',
  /** Disallowed prototype pollution key (__proto__, prototype, constructor). */
  'prototype-key',
  /** Violation of a domain-specific structural constraint or wiring invariant. */
  'structural-rule',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

/**
 * Validation issue matching model-and-runner.md §8 exactly.
 */
export type Issue = {
  readonly code: IssueCode;
  readonly path: readonly (string | number)[];
  readonly entityId: Id | null;
  readonly severity: 'error' | 'warning';
  readonly message: string;
};

// ============================================================================
// Constants and Regexes
// ============================================================================

/** Canonical lowercase UUID format: 8-4-4-4-12 lowercase hex with version 1-5 and variant [89ab]. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// ============================================================================
// Iterative Helper Functions
// ============================================================================

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

function codePointLength(str: string): number {
  return [...str].length;
}

/**
 * Checks raw container depth iteratively using an explicit stack.
 * storage.md §6: raw document depth 32. Root container is depth 1.
 */
function checkRawDepth(input: unknown, issues: Issue[], maxDepth = 32): void {
  if (input === null || typeof input !== 'object') return;

  interface DepthFrame {
    readonly node: unknown;
    readonly depth: number;
    readonly path: readonly (string | number)[];
  }

  const stack: DepthFrame[] = [{ node: input, depth: 1, path: [] }];
  const seen = new Set<unknown>();

  while (stack.length > 0) {
    const { node, depth, path } = stack.pop()!;

    if (depth > maxDepth) {
      issues.push({
        code: 'too-deep',
        path,
        entityId: null,
        severity: 'error',
        message: `Raw document depth ${depth} exceeds maximum limit of ${maxDepth}`,
      });
      continue;
    }

    if (node === null || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (item !== null && typeof item === 'object') {
          stack.push({ node: item, depth: depth + 1, path: [...path, i] });
        }
      }
    } else {
      const rec = node as Record<string, unknown>;
      const keys = Object.keys(rec);
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        const val = rec[k];
        if (val !== null && typeof val === 'object') {
          stack.push({ node: val, depth: depth + 1, path: [...path, k] });
        }
      }
    }
  }
}

/**
 * Iteratively checks that string values inside fixture values do not exceed 16 KiB (UTF-8 bytes).
 * storage.md §6: string fixture values <= 16 KiB.
 */
function checkFixtureStrings(
  root: unknown,
  basePath: readonly (string | number)[],
  issues: Issue[],
  maxStringBytes = 16384,
): void {
  if (root === null || typeof root !== 'object') {
    if (typeof root === 'string') {
      const bytes = new TextEncoder().encode(root).length;
      if (bytes > maxStringBytes) {
        issues.push({
          code: 'too-large',
          path: basePath,
          entityId: null,
          severity: 'error',
          message: `Fixture string value byte length ${bytes} exceeds maximum limit of 16 KiB (${maxStringBytes} bytes)`,
        });
      }
    }
    return;
  }

  const stack: { val: unknown; path: readonly (string | number)[] }[] = [{ val: root, path: basePath }];
  const seen = new Set<unknown>();
  const encoder = new TextEncoder();

  while (stack.length > 0) {
    const { val, path } = stack.pop()!;
    if (typeof val === 'string') {
      const bytes = encoder.encode(val).length;
      if (bytes > maxStringBytes) {
        issues.push({
          code: 'too-large',
          path,
          entityId: null,
          severity: 'error',
          message: `Fixture string value byte length ${bytes} exceeds maximum limit of 16 KiB (${maxStringBytes} bytes)`,
        });
      }
    } else if (val !== null && typeof val === 'object') {
      if (seen.has(val)) continue;
      seen.add(val);

      if (Array.isArray(val)) {
        for (let i = val.length - 1; i >= 0; i--) {
          stack.push({ val: val[i], path: [...path, i] });
        }
      } else {
        const keys = Object.keys(val as Record<string, unknown>);
        for (let i = keys.length - 1; i >= 0; i--) {
          const k = keys[i];
          stack.push({ val: (val as Record<string, unknown>)[k], path: [...path, k] });
        }
      }
    }
  }
}

/**
 * Validates closed record properties on an object.
 */
function checkRecord(
  obj: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
  recordName: string,
): obj is Record<string, unknown> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Expected object for ${recordName}, got ${obj === null ? 'null' : Array.isArray(obj) ? 'array' : typeof obj}`,
    });
    return false;
  }

  const rec = obj as Record<string, unknown>;
  const ownKeys = Object.getOwnPropertyNames(rec);

  // Prototype keys
  for (const k of ownKeys) {
    if (PROTOTYPE_KEYS.has(k)) {
      issues.push({
        code: 'prototype-key',
        path: [...path, k],
        entityId,
        severity: 'error',
        message: `Disallowed prototype key '${k}' on ${recordName}`,
      });
    }
  }

  // Unknown properties
  for (const k of ownKeys) {
    if (PROTOTYPE_KEYS.has(k)) continue;
    if (!allowedKeys.includes(k)) {
      issues.push({
        code: 'unknown-property',
        path: [...path, k],
        entityId,
        severity: 'error',
        message: `Unknown property '${k}' on ${recordName}`,
      });
    }
  }

  // Missing required properties
  for (const k of requiredKeys) {
    if (!Object.hasOwn(rec, k) || rec[k] === undefined) {
      issues.push({
        code: 'missing-property',
        path: [...path, k],
        entityId,
        severity: 'error',
        message: `Missing required property '${k}' on ${recordName}`,
      });
    }
  }

  return true;
}

function validateString(
  val: unknown,
  minCodePoints: number,
  maxCodePoints: number,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
  name: string,
): val is string {
  if (typeof val !== 'string') {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Expected string for ${name}, got ${typeof val}`,
    });
    return false;
  }

  if (!isSurrogateValid(val)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `String for ${name} contains lone surrogates`,
    });
    return false;
  }

  const len = codePointLength(val);
  if (len < minCodePoints) {
    issues.push({
      code: 'out-of-range',
      path,
      entityId,
      severity: 'error',
      message: `${name} length ${len} code points is less than minimum ${minCodePoints}`,
    });
    return false;
  }
  if (len > maxCodePoints) {
    issues.push({
      code: 'too-long',
      path,
      entityId,
      severity: 'error',
      message: `${name} length ${len} code points exceeds maximum ${maxCodePoints}`,
    });
    return false;
  }

  return true;
}

function validateId(
  val: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
): val is Id {
  if (typeof val !== 'string') {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Expected string for ID, got ${typeof val}`,
    });
    return false;
  }

  if (!UUID_REGEX.test(val)) {
    issues.push({
      code: 'invalid-id',
      path,
      entityId,
      severity: 'error',
      message: `Invalid ID '${val}': must be a lowercase canonical UUID`,
    });
    return false;
  }

  return true;
}

function validateNumber(
  val: unknown,
  min: number,
  max: number,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
  name: string,
  integerOnly = false,
  minExclusive = false,
): val is number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Expected finite number for ${name}, got ${String(val)}`,
    });
    return false;
  }

  if (integerOnly && !Number.isSafeInteger(val)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Expected safe integer for ${name}, got ${val}`,
    });
    return false;
  }

  const tooSmall = minExclusive ? val <= min : val < min;
  if (tooSmall || val > max) {
    issues.push({
      code: 'out-of-range',
      path,
      entityId,
      severity: 'error',
      message: `${name} ${val} is out of allowed range ${minExclusive ? `(${min}, ${max}]` : `[${min}, ${max}]`}`,
    });
    return false;
  }

  return true;
}

function validateBoolean(
  val: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
  name: string,
): val is boolean {
  if (typeof val !== 'boolean') {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Expected boolean for ${name}, got ${typeof val}`,
    });
    return false;
  }
  return true;
}

function validateArray(
  val: unknown,
  maxItems: number,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
  name: string,
): val is unknown[] {
  if (!Array.isArray(val)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Expected array for ${name}, got ${val === null ? 'null' : typeof val}`,
    });
    return false;
  }

  if (val.length > maxItems) {
    issues.push({
      code: 'too-many',
      path,
      entityId,
      severity: 'error',
      message: `Array for ${name} count ${val.length} exceeds maximum limit of ${maxItems}`,
    });
  }

  return true;
}

function validatePath(
  val: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
): val is readonly (string | number)[] {
  if (!Array.isArray(val)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Path must be an array of literal keys or non-negative list indices`,
    });
    return false;
  }

  for (let i = 0; i < val.length; i++) {
    const item = val[i];
    const itemPath = [...path, i];
    if (typeof item === 'string') {
      if (PROTOTYPE_KEYS.has(item)) {
        issues.push({
          code: 'prototype-key',
          path: itemPath,
          entityId,
          severity: 'error',
          message: `Disallowed prototype key in path: ${item}`,
        });
      } else {
        validateString(item, 1, 80, itemPath, entityId, issues, 'Path segment');
      }
    } else if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || item < 0) {
        issues.push({
          code: 'out-of-range',
          path: itemPath,
          entityId,
          severity: 'error',
          message: `Path index must be a non-negative integer`,
        });
      }
    } else {
      issues.push({
        code: 'wrong-type',
        path: itemPath,
        entityId,
        severity: 'error',
        message: `Path element must be a string or non-negative integer`,
      });
    }
  }

  return true;
}

/**
 * Validates a JSON value (finite numbers, plain objects/arrays, no prototype keys, surrogate-valid strings).
 * Iterative stack-based walk. Checks payload depth <= 8 and list items <= 10,000.
 */
function validateJsonValue(
  root: unknown,
  basePath: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
  maxDepth = 8,
  maxListItems = 10000,
): void {
  interface JsonFrame {
    readonly val: unknown;
    readonly depth: number;
    readonly path: readonly (string | number)[];
  }

  const stack: JsonFrame[] = [{ val: root, depth: 0, path: basePath }];
  const seenObjects = new Set<unknown>();

  while (stack.length > 0) {
    const { val, depth, path } = stack.pop()!;

    if (val === null || typeof val === 'boolean') {
      continue;
    }

    if (typeof val === 'number') {
      if (!Number.isFinite(val)) {
        issues.push({
          code: 'wrong-type',
          path,
          entityId,
          severity: 'error',
          message: `Expected finite number in JSON value, got ${String(val)}`,
        });
      }
      continue;
    }

    if (typeof val === 'string') {
      if (!isSurrogateValid(val)) {
        issues.push({
          code: 'wrong-type',
          path,
          entityId,
          severity: 'error',
          message: `JSON string contains lone surrogates`,
        });
      }
      continue;
    }

    if (Array.isArray(val)) {
      if (seenObjects.has(val)) {
        issues.push({
          code: 'structural-rule',
          path,
          entityId,
          severity: 'error',
          message: 'Circular structure in JSON value',
        });
        continue;
      }
      seenObjects.add(val);

      const nextDepth = depth + 1;
      if (nextDepth > maxDepth) {
        issues.push({
          code: 'too-deep',
          path,
          entityId,
          severity: 'error',
          message: `Payload depth ${nextDepth} exceeds maximum limit of ${maxDepth}`,
        });
        continue;
      }

      if (val.length > maxListItems) {
        issues.push({
          code: 'too-many',
          path,
          entityId,
          severity: 'error',
          message: `List items count ${val.length} exceeds maximum limit of ${maxListItems}`,
        });
      }

      for (let i = val.length - 1; i >= 0; i--) {
        stack.push({ val: val[i], depth: nextDepth, path: [...path, i] });
      }
      continue;
    }

    if (typeof val === 'object') {
      if (Object.prototype.toString.call(val) !== '[object Object]') {
        issues.push({
          code: 'wrong-type',
          path,
          entityId,
          severity: 'error',
          message: `Expected plain object in JSON value`,
        });
        continue;
      }

      if (seenObjects.has(val)) {
        issues.push({
          code: 'structural-rule',
          path,
          entityId,
          severity: 'error',
          message: 'Circular structure in JSON value',
        });
        continue;
      }
      seenObjects.add(val);

      const nextDepth = depth + 1;
      if (nextDepth > maxDepth) {
        issues.push({
          code: 'too-deep',
          path,
          entityId,
          severity: 'error',
          message: `Payload depth ${nextDepth} exceeds maximum limit of ${maxDepth}`,
        });
        continue;
      }

      const rec = val as Record<string, unknown>;
      const ownKeys = Object.getOwnPropertyNames(rec);

      for (const k of ownKeys) {
        if (PROTOTYPE_KEYS.has(k)) {
          issues.push({
            code: 'prototype-key',
            path: [...path, k],
            entityId,
            severity: 'error',
            message: `Disallowed prototype key in JSON value: ${k}`,
          });
        }
      }

      for (let i = ownKeys.length - 1; i >= 0; i--) {
        const k = ownKeys[i];
        stack.push({ val: rec[k], depth: nextDepth, path: [...path, k] });
      }
      continue;
    }

    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: `Disallowed JSON value type: ${typeof val}`,
    });
  }
}

/**
 * Validates a schema shape tree iteratively using an explicit stack.
 * Checks shape depth <= 8, nullable required, record field uniqueness, scalar union rules.
 */
function validateShape(
  rootShape: unknown,
  basePath: readonly (string | number)[],
  entityId: Id | null,
  allIds: Map<string, (string | number)[]>,
  issues: Issue[],
): void {
  interface ShapeFrame {
    readonly node: unknown;
    readonly depth: number;
    readonly path: readonly (string | number)[];
  }

  const stack: ShapeFrame[] = [{ node: rootShape, depth: 1, path: basePath }];

  while (stack.length > 0) {
    const { node, depth, path } = stack.pop()!;

    if (depth > 8) {
      issues.push({
        code: 'too-deep',
        path,
        entityId,
        severity: 'error',
        message: `Shape depth ${depth} exceeds maximum limit of 8`,
      });
      continue;
    }

    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      issues.push({
        code: 'wrong-type',
        path,
        entityId,
        severity: 'error',
        message: `Shape must be an object`,
      });
      continue;
    }

    const rec = node as Record<string, unknown>;
    const type = rec.type;

    if (typeof type !== 'string') {
      issues.push({
        code: 'wrong-type',
        path: [...path, 'type'],
        entityId,
        severity: 'error',
        message: `Shape type must be a string`,
      });
      continue;
    }

    // Nullable is required on EVERY shape
    if (typeof rec.nullable !== 'boolean') {
      if (!Object.hasOwn(rec, 'nullable') || rec.nullable === undefined) {
        issues.push({
          code: 'missing-property',
          path: [...path, 'nullable'],
          entityId,
          severity: 'error',
          message: `Shape missing required boolean 'nullable'`,
        });
      } else {
        issues.push({
          code: 'wrong-type',
          path: [...path, 'nullable'],
          entityId,
          severity: 'error',
          message: `Shape 'nullable' must be boolean`,
        });
      }
    }

    if (SCALAR_TYPES.includes(type as (typeof SCALAR_TYPES)[number])) {
      checkRecord(rec, ['type', 'nullable'], ['type'], path, entityId, issues, `${type} scalar shape`);
    } else if (type === 'scalar-union') {
      if (checkRecord(rec, ['type', 'nullable', 'types'], ['type', 'types'], path, entityId, issues, 'scalar-union shape')) {
        if (!Array.isArray(rec.types)) {
          issues.push({
            code: 'wrong-type',
            path: [...path, 'types'],
            entityId,
            severity: 'error',
            message: `scalar-union 'types' must be an array`,
          });
        } else {
          const typesArr = rec.types as unknown[];
          const typeSet = new Set<string>();
          let hasNumber = false;
          let hasInteger = false;
          let validTypes = true;

          for (let i = 0; i < typesArr.length; i++) {
            const t = typesArr[i];
            if (typeof t !== 'string' || !SCALAR_TYPES.includes(t as (typeof SCALAR_TYPES)[number])) {
              issues.push({
                code: 'invalid-literal',
                path: [...path, 'types', i],
                entityId,
                severity: 'error',
                message: `Invalid scalar-union type member: ${String(t)}`,
              });
              validTypes = false;
            } else {
              if (t === 'number') hasNumber = true;
              if (t === 'integer') hasInteger = true;
              typeSet.add(t);
            }
          }

          if (validTypes) {
            if (typesArr.length < 2 || typesArr.length > 4 || typeSet.size !== typesArr.length) {
              issues.push({
                code: 'structural-rule',
                path: [...path, 'types'],
                entityId,
                severity: 'error',
                message: `scalar-union must specify 2–4 distinct scalar types`,
              });
            }
            if (hasNumber && hasInteger) {
              issues.push({
                code: 'structural-rule',
                path: [...path, 'types'],
                entityId,
                severity: 'error',
                message: `scalar-union cannot combine 'number' and 'integer'`,
              });
            }
          }
        }
      }
    } else if (type === 'list') {
      if (checkRecord(rec, ['type', 'nullable', 'items', 'maxItems'], ['type', 'items', 'maxItems'], path, entityId, issues, 'list shape')) {
        validateNumber(rec.maxItems, 1, Number.MAX_SAFE_INTEGER, [...path, 'maxItems'], entityId, issues, 'list maxItems', true);
        stack.push({ node: rec.items, depth: depth + 1, path: [...path, 'items'] });
      }
    } else if (type === 'record') {
      if (checkRecord(rec, ['type', 'nullable', 'fields'], ['type', 'fields'], path, entityId, issues, 'record shape')) {
        if (validateArray(rec.fields, 100, [...path, 'fields'], entityId, issues, 'record fields')) {
          const fields = rec.fields as unknown[];
          const fieldKeys = new Set<string>();

          for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            const fPath = [...path, 'fields', i];
            if (checkRecord(f, ['id', 'key', 'optional', 'shape'], ['id', 'key', 'optional', 'shape'], fPath, entityId, issues, 'record field')) {
              if (validateId(f.id, [...fPath, 'id'], entityId, issues)) {
                registerId(f.id, [...fPath, 'id'], allIds, issues);
              }
              if (typeof f.key === 'string') {
                if (PROTOTYPE_KEYS.has(f.key)) {
                  issues.push({
                    code: 'prototype-key',
                    path: [...fPath, 'key'],
                    entityId,
                    severity: 'error',
                    message: `Disallowed prototype key in record field: ${f.key}`,
                  });
                } else if (validateString(f.key, 1, 80, [...fPath, 'key'], entityId, issues, 'Record field key')) {
                  if (fieldKeys.has(f.key)) {
                    issues.push({
                      code: 'duplicate-key',
                      path: [...fPath, 'key'],
                      entityId,
                      severity: 'error',
                      message: `Duplicate key '${f.key}' in record fields`,
                    });
                  } else {
                    fieldKeys.add(f.key);
                  }
                }
              } else {
                issues.push({
                  code: 'wrong-type',
                  path: [...fPath, 'key'],
                  entityId,
                  severity: 'error',
                  message: `Record field key must be a string`,
                });
              }
              validateBoolean(f.optional, [...fPath, 'optional'], entityId, issues, 'Record field optional');
              stack.push({ node: f.shape, depth: depth + 1, path: [...fPath, 'shape'] });
            }
          }
        }
      }
    } else {
      issues.push({
        code: 'invalid-literal',
        path: [...path, 'type'],
        entityId,
        severity: 'error',
        message: `Unknown shape type: '${type}'`,
      });
    }
  }
}

/**
 * Validates an expression tree (Guard or Value) iteratively using an explicit stack.
 * Checks expression depth <= 8 and total nodes <= 1,000.
 */
function validateExpression(
  root: unknown,
  basePath: readonly (string | number)[],
  entityId: Id | null,
  isGuardRoot: boolean,
  issues: Issue[],
): void {
  interface ExprFrame {
    readonly node: unknown;
    readonly depth: number;
    readonly path: readonly (string | number)[];
    readonly isGuard: boolean;
  }

  const stack: ExprFrame[] = [{ node: root, depth: 1, path: basePath, isGuard: isGuardRoot }];
  let nodeCount = 0;

  while (stack.length > 0) {
    const { node, depth, path, isGuard } = stack.pop()!;
    nodeCount++;

    if (nodeCount > 1000) {
      issues.push({
        code: 'too-many',
        path,
        entityId,
        severity: 'error',
        message: `Expression tree exceeds maximum limit of 1,000 nodes`,
      });
      return;
    }

    if (depth > 8) {
      issues.push({
        code: 'too-deep',
        path,
        entityId,
        severity: 'error',
        message: `Expression depth ${depth} exceeds maximum limit of 8`,
      });
      continue;
    }

    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      issues.push({
        code: 'wrong-type',
        path,
        entityId,
        severity: 'error',
        message: `Expected object for ${isGuard ? 'Guard' : 'Value'}, got ${node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node}`,
      });
      continue;
    }

    const rec = node as Record<string, unknown>;

    if (isGuard) {
      const op = rec.op;
      if (typeof op !== 'string' || !GUARD_OPS.includes(op as (typeof GUARD_OPS)[number])) {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'op'],
          entityId,
          severity: 'error',
          message: `Unknown Guard operator: '${String(op)}'`,
        });
        continue;
      }

      if (op === 'equals' || op === 'notEquals') {
        if (checkRecord(rec, ['op', 'left', 'right'], ['op', 'left', 'right'], path, entityId, issues, `${op} guard`)) {
          stack.push({ node: rec.right, depth: depth + 1, path: [...path, 'right'], isGuard: false });
          stack.push({ node: rec.left, depth: depth + 1, path: [...path, 'left'], isGuard: false });
        }
      } else if (op === 'exists' || op === 'positiveInteger' || op === 'nonEmpty') {
        if (checkRecord(rec, ['op', 'value'], ['op', 'value'], path, entityId, issues, `${op} guard`)) {
          stack.push({ node: rec.value, depth: depth + 1, path: [...path, 'value'], isGuard: false });
        }
      } else if (op === 'all' || op === 'any') {
        if (checkRecord(rec, ['op', 'guards'], ['op', 'guards'], path, entityId, issues, `${op} guard`)) {
          if (!Array.isArray(rec.guards) || rec.guards.length === 0) {
            issues.push({
              code: 'out-of-range',
              path: [...path, 'guards'],
              entityId,
              severity: 'error',
              message: `${op} guard requires a non-empty array of guards`,
            });
          } else {
            const guardsArr = rec.guards as unknown[];
            for (let i = guardsArr.length - 1; i >= 0; i--) {
              stack.push({ node: guardsArr[i], depth: depth + 1, path: [...path, 'guards', i], isGuard: true });
            }
          }
        }
      } else if (op === 'every') {
        if (checkRecord(rec, ['op', 'value', 'itemGuard'], ['op', 'value', 'itemGuard'], path, entityId, issues, 'every guard')) {
          stack.push({ node: rec.itemGuard, depth: depth + 1, path: [...path, 'itemGuard'], isGuard: true });
          stack.push({ node: rec.value, depth: depth + 1, path: [...path, 'value'], isGuard: false });
        }
      }
    } else {
      // Value
      const kind = rec.kind;
      if (typeof kind !== 'string' || !VALUE_KINDS.includes(kind as (typeof VALUE_KINDS)[number])) {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'kind'],
          entityId,
          severity: 'error',
          message: `Unknown Value kind: '${String(kind)}'`,
        });
        continue;
      }

      if (kind === 'literal') {
        if (checkRecord(rec, ['kind', 'value'], ['kind', 'value'], path, entityId, issues, 'literal value')) {
          validateJsonValue(rec.value, [...path, 'value'], entityId, issues);
        }
      } else if (kind === 'read') {
        if (checkRecord(rec, ['kind', 'source', 'path'], ['kind', 'source', 'path'], path, entityId, issues, 'read value')) {
          if (rec.source !== 'input' && rec.source !== 'context') {
            issues.push({
              code: 'invalid-literal',
              path: [...path, 'source'],
              entityId,
              severity: 'error',
              message: `Read value source must be 'input' or 'context'`,
            });
          }
          validatePath(rec.path, [...path, 'path'], entityId, issues);
        }
      } else if (kind === 'outcome') {
        checkRecord(rec, ['kind'], ['kind'], path, entityId, issues, 'outcome value');
      } else if (kind === 'list') {
        if (checkRecord(rec, ['kind', 'items'], ['kind', 'items'], path, entityId, issues, 'list value')) {
          if (!Array.isArray(rec.items)) {
            issues.push({
              code: 'wrong-type',
              path: [...path, 'items'],
              entityId,
              severity: 'error',
              message: `List value items must be an array`,
            });
          } else {
            const items = rec.items as unknown[];
            for (let i = items.length - 1; i >= 0; i--) {
              stack.push({ node: items[i], depth: depth + 1, path: [...path, 'items', i], isGuard: false });
            }
          }
        }
      } else if (kind === 'record') {
        if (checkRecord(rec, ['kind', 'fields'], ['kind', 'fields'], path, entityId, issues, 'record value')) {
          if (!Array.isArray(rec.fields)) {
            issues.push({
              code: 'wrong-type',
              path: [...path, 'fields'],
              entityId,
              severity: 'error',
              message: `Record value fields must be an array`,
            });
          } else {
            const fields = rec.fields as unknown[];
            const fieldKeys = new Set<string>();

            for (let i = 0; i < fields.length; i++) {
              const f = fields[i];
              const fPath = [...path, 'fields', i];
              if (checkRecord(f, ['key', 'value'], ['key', 'value'], fPath, entityId, issues, 'record value field')) {
                if (typeof f.key === 'string') {
                  if (PROTOTYPE_KEYS.has(f.key)) {
                    issues.push({
                      code: 'prototype-key',
                      path: [...fPath, 'key'],
                      entityId,
                      severity: 'error',
                      message: `Disallowed prototype key in record value: ${f.key}`,
                    });
                  } else if (validateString(f.key, 1, 80, [...fPath, 'key'], entityId, issues, 'Record value key')) {
                    if (fieldKeys.has(f.key)) {
                      issues.push({
                        code: 'duplicate-key',
                        path: [...fPath, 'key'],
                        entityId,
                        severity: 'error',
                        message: `Duplicate key '${f.key}' in record value fields`,
                      });
                    } else {
                      fieldKeys.add(f.key);
                    }
                  }
                } else {
                  issues.push({
                    code: 'wrong-type',
                    path: [...fPath, 'key'],
                    entityId,
                    severity: 'error',
                    message: `Record value field key must be a string`,
                  });
                }
                stack.push({ node: f.value, depth: depth + 1, path: [...fPath, 'value'], isGuard: false });
              }
            }
          }
        }
      }
    }
  }
}

function registerId(
  id: Id,
  path: readonly (string | number)[],
  allIds: Map<string, (string | number)[]>,
  issues: Issue[],
): void {
  if (allIds.has(id)) {
    issues.push({
      code: 'duplicate-id',
      path,
      entityId: id,
      severity: 'error',
      message: `Duplicate ID '${id}'`,
    });
  } else {
    allIds.set(id, [...path]);
  }
}

// ============================================================================
// Main Validation Function
// ============================================================================

export function validateDocument(
  input: unknown,
): { ok: true; document: Document } | { ok: false; issues: Issue[] } {
  const issues: Issue[] = [];

  // Step 1: Base document object check
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        {
          code: 'wrong-type',
          path: [],
          entityId: null,
          severity: 'error',
          message: `Expected Document object, got ${input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input}`,
        },
      ],
    };
  }

  // Step 2: Byte size limits (storage.md §6) before other inventory walks
  // Whole document <= 2 MiB (2*1048576 bytes).
  const docByteResult = canonicalJson(input, 2 * 1048576);
  if (!docByteResult.ok) {
    // If the document byte check fails, return immediately with that issue (no further walks).
    return {
      ok: false,
      issues: docByteResult.issues,
    };
  }

  const doc = input as Record<string, unknown>;

  // Fixtures byte limits (storage.md §6) before other inventory walks:
  // aggregate of all fixture values <= 1 MiB; each fixture value <= 256 KiB;
  // string values inside fixture values <= 16 KiB (UTF-8 bytes).
  if (Array.isArray(doc.fixtures)) {
    let aggregateFixtureBytes = 0;
    const maxFixtureAggregateBytes = 1048576; // 1 MiB
    const maxFixtureValueBytes = 262144; // 256 KiB
    const maxFixtureStringBytes = 16384; // 16 KiB

    for (let fIdx = 0; fIdx < doc.fixtures.length; fIdx++) {
      const f = doc.fixtures[fIdx];
      if (f !== null && typeof f === 'object' && !Array.isArray(f) && 'value' in f) {
        const fVal = (f as Record<string, unknown>).value;
        const fValPath = ['fixtures', fIdx, 'value'];

        const valResult = canonicalJson(fVal, maxFixtureValueBytes, fValPath);
        if (!valResult.ok) {
          issues.push(...valResult.issues);
        } else {
          aggregateFixtureBytes += valResult.bytes;
        }

        checkFixtureStrings(fVal, fValPath, issues, maxFixtureStringBytes);
      }
    }

    if (aggregateFixtureBytes > maxFixtureAggregateBytes) {
      issues.push({
        code: 'too-large',
        path: ['fixtures'],
        entityId: null,
        severity: 'error',
        message: `Aggregate fixture values size ${aggregateFixtureBytes} bytes exceeds maximum limit of 1 MiB (${maxFixtureAggregateBytes} bytes)`,
      });
    }
  }

  // Step 3: Raw depth check (must be iterative, after byte check)
  checkRawDepth(input, issues, 32);

  // Step 4: Closed record check on Document root
  checkRecord(doc, DOCUMENT_FIELDS, DOCUMENT_FIELDS, [], null, issues, 'Document');

  // Document schema literal check
  if (doc.schema !== 'studio-model/1') {
    issues.push({
      code: 'invalid-literal',
      path: ['schema'],
      entityId: null,
      severity: 'error',
      message: `Document schema must be 'studio-model/1', got '${String(doc.schema)}'`,
    });
  }

  // Document ID
  let docId: Id | null = null;
  if (validateId(doc.id, ['id'], null, issues)) {
    docId = doc.id;
  }

  // Document title
  validateString(doc.title, 1, 80, ['title'], docId, issues, 'Document title');

  // Registries for references and IDs
  const allIds = new Map<string, (string | number)[]>();
  if (docId) {
    allIds.set(docId, ['id']);
  }

  const elementsMap = new Map<Id, { rec: Record<string, unknown>; index: number }>();
  const elementPortsMap = new Map<Id, Map<Id, { rec: Record<string, unknown>; index: number }>>();
  const schemasMap = new Map<Id, { rec: Record<string, unknown>; index: number }>();
  const fixturesMap = new Map<Id, { rec: Record<string, unknown>; index: number }>();
  const connectionsMap = new Map<Id, { rec: Record<string, unknown>; index: number }>();
  const relationsMap = new Map<Id, { rec: Record<string, unknown>; index: number }>();
  const refinementsMap = new Map<Id, { rec: Record<string, unknown>; index: number }>();

  // Intermediate collectors for cross-reference checking in phase 2
  interface PendingEndpoint {
    endpoint: Record<string, unknown>;
    path: readonly (string | number)[];
    entityId: Id | null;
  }
  const pendingEndpoints: PendingEndpoint[] = [];

  interface PendingSchemaRef {
    schemaId: unknown;
    path: readonly (string | number)[];
    entityId: Id | null;
  }
  const pendingSchemaRefs: PendingSchemaRef[] = [];

  interface PendingFixtureRef {
    fixtureId: unknown;
    path: readonly (string | number)[];
    entityId: Id | null;
  }
  const pendingFixtureRefs: PendingFixtureRef[] = [];

  // ==========================================================================
  // Section A: Schemas (§3)
  // ==========================================================================
  if (validateArray(doc.schemas, 100, ['schemas'], docId, issues, 'Document schemas')) {
    const schemas = doc.schemas as unknown[];
    for (let i = 0; i < schemas.length; i++) {
      const s = schemas[i];
      const sPath = ['schemas', i];
      if (checkRecord(s, ['id', 'label', 'shape'], ['id', 'label', 'shape'], sPath, docId, issues, 'PayloadSchema')) {
        let sId: Id | null = null;
        if (validateId(s.id, [...sPath, 'id'], null, issues)) {
          sId = s.id;
          registerId(s.id, [...sPath, 'id'], allIds, issues);
          schemasMap.set(s.id, { rec: s, index: i });
        }
        validateString(s.label, 1, 80, [...sPath, 'label'], sId, issues, 'Schema label');
        validateShape(s.shape, [...sPath, 'shape'], sId, allIds, issues);
      }
    }
  }

  // ==========================================================================
  // Section B: Elements and Ports (§2 & §4)
  // ==========================================================================
  if (validateArray(doc.elements, 100, ['elements'], docId, issues, 'Document elements')) {
    const elements = doc.elements as unknown[];
    for (let eIdx = 0; eIdx < elements.length; eIdx++) {
      const el = elements[eIdx];
      const elPath = ['elements', eIdx];
      if (checkRecord(el, ['id', 'label', 'description', 'visualKind', 'ports', 'behavior'], ['id', 'label', 'description', 'visualKind', 'ports', 'behavior'], elPath, docId, issues, 'Element')) {
        let elId: Id | null = null;
        if (validateId(el.id, [...elPath, 'id'], null, issues)) {
          elId = el.id;
          registerId(el.id, [...elPath, 'id'], allIds, issues);
          elementsMap.set(el.id, { rec: el, index: eIdx });
        }

        validateString(el.label, 1, 80, [...elPath, 'label'], elId, issues, 'Element label');
        validateString(el.description, 0, 4000, [...elPath, 'description'], elId, issues, 'Element description');

        if (typeof el.visualKind !== 'string' || !VISUAL_KINDS.includes(el.visualKind as (typeof VISUAL_KINDS)[number])) {
          issues.push({
            code: 'invalid-literal',
            path: [...elPath, 'visualKind'],
            entityId: elId,
            severity: 'error',
            message: `Invalid visualKind: '${String(el.visualKind)}'`,
          });
        }

        // Ports
        const portsMap = new Map<Id, { rec: Record<string, unknown>; index: number }>();
        if (elId) {
          elementPortsMap.set(elId, portsMap);
        }

        if (validateArray(el.ports, 16, [...elPath, 'ports'], elId, issues, 'Element ports')) {
          const ports = el.ports as unknown[];
          for (let pIdx = 0; pIdx < ports.length; pIdx++) {
            const p = ports[pIdx];
            const pPath = [...elPath, 'ports', pIdx];
            if (checkRecord(p, ['id', 'label', 'direction', 'channel', 'schemaId', 'responseSchemaId'], ['id', 'label', 'direction', 'channel', 'schemaId', 'responseSchemaId'], pPath, elId, issues, 'Port')) {
              let pId: Id | null = null;
              if (validateId(p.id, [...pPath, 'id'], elId, issues)) {
                pId = p.id;
                registerId(p.id, [...pPath, 'id'], allIds, issues);
                portsMap.set(p.id, { rec: p, index: pIdx });
              }

              validateString(p.label, 1, 80, [...pPath, 'label'], pId ?? elId, issues, 'Port label');

              if (typeof p.direction !== 'string' || !PORT_DIRECTIONS.includes(p.direction as (typeof PORT_DIRECTIONS)[number])) {
                issues.push({
                  code: 'invalid-literal',
                  path: [...pPath, 'direction'],
                  entityId: pId ?? elId,
                  severity: 'error',
                  message: `Invalid port direction: '${String(p.direction)}'`,
                });
              }

              if (typeof p.channel !== 'string' || !PORT_CHANNELS.includes(p.channel as (typeof PORT_CHANNELS)[number])) {
                issues.push({
                  code: 'invalid-literal',
                  path: [...pPath, 'channel'],
                  entityId: pId ?? elId,
                  severity: 'error',
                  message: `Invalid port channel: '${String(p.channel)}'`,
                });
              }

              pendingSchemaRefs.push({ schemaId: p.schemaId, path: [...pPath, 'schemaId'], entityId: pId ?? elId });

              // Call ports need non-null responseSchemaId, other channels null
              if (p.channel === 'call') {
                if (p.responseSchemaId === null || p.responseSchemaId === undefined) {
                  issues.push({
                    code: 'structural-rule',
                    path: [...pPath, 'responseSchemaId'],
                    entityId: pId ?? elId,
                    severity: 'error',
                    message: `Call ports must specify a non-null responseSchemaId`,
                  });
                } else {
                  pendingSchemaRefs.push({ schemaId: p.responseSchemaId, path: [...pPath, 'responseSchemaId'], entityId: pId ?? elId });
                }
              } else {
                if (p.responseSchemaId !== null) {
                  issues.push({
                    code: 'structural-rule',
                    path: [...pPath, 'responseSchemaId'],
                    entityId: pId ?? elId,
                    severity: 'error',
                    message: `Non-call ports must have null responseSchemaId`,
                  });
                }
              }
            }
          }
        }

        // Behavior (§4)
        validateBehavior(el.behavior, [...elPath, 'behavior'], elId, portsMap, allIds, pendingSchemaRefs, pendingFixtureRefs, issues);
      }
    }
  }

  // ==========================================================================
  // Section C: Fixtures (§2)
  // ==========================================================================
  if (validateArray(doc.fixtures, Number.MAX_SAFE_INTEGER, ['fixtures'], docId, issues, 'Document fixtures')) {
    const fixtures = doc.fixtures as unknown[];
    for (let fIdx = 0; fIdx < fixtures.length; fIdx++) {
      const f = fixtures[fIdx];
      const fPath = ['fixtures', fIdx];
      if (checkRecord(f, ['id', 'schemaId', 'value'], ['id', 'schemaId', 'value'], fPath, docId, issues, 'Fixture')) {
        let fId: Id | null = null;
        if (validateId(f.id, [...fPath, 'id'], null, issues)) {
          fId = f.id;
          registerId(f.id, [...fPath, 'id'], allIds, issues);
          fixturesMap.set(f.id, { rec: f, index: fIdx });
        }
        pendingSchemaRefs.push({ schemaId: f.schemaId, path: [...fPath, 'schemaId'], entityId: fId });
        validateJsonValue(f.value, [...fPath, 'value'], fId, issues, 8, 10000);
      }
    }
  }

  // ==========================================================================
  // Section D: Connections (§2 & §4)
  // ==========================================================================
  if (validateArray(doc.connections, 200, ['connections'], docId, issues, 'Document connections')) {
    const requestClassLabels = new Map<string, string>();
    const connections = doc.connections as unknown[];
    for (let cIdx = 0; cIdx < connections.length; cIdx++) {
      const c = connections[cIdx];
      const cPath = ['connections', cIdx];
      if (checkRecord(c, ['id', 'label', 'kind', 'source', 'target', 'config'], ['id', 'label', 'kind', 'source', 'target', 'config'], cPath, docId, issues, 'Connection')) {
        let cId: Id | null = null;
        if (validateId(c.id, [...cPath, 'id'], null, issues)) {
          cId = c.id;
          registerId(c.id, [...cPath, 'id'], allIds, issues);
          connectionsMap.set(c.id, { rec: c, index: cIdx });
        }

        validateString(c.label, 1, 80, [...cPath, 'label'], cId, issues, 'Connection label');

        if (typeof c.kind !== 'string' || !CONNECTION_KINDS.includes(c.kind as (typeof CONNECTION_KINDS)[number])) {
          issues.push({
            code: 'invalid-literal',
            path: [...cPath, 'kind'],
            entityId: cId,
            severity: 'error',
            message: `Invalid connection kind: '${String(c.kind)}'`,
          });
        }

        // Endpoint source and target
        if (checkRecord(c.source, ['elementId', 'portId'], ['elementId', 'portId'], [...cPath, 'source'], cId, issues, 'Connection source endpoint')) {
          pendingEndpoints.push({ endpoint: c.source as Record<string, unknown>, path: [...cPath, 'source'], entityId: cId });
        }
        if (checkRecord(c.target, ['elementId', 'portId'], ['elementId', 'portId'], [...cPath, 'target'], cId, issues, 'Connection target endpoint')) {
          pendingEndpoints.push({ endpoint: c.target as Record<string, unknown>, path: [...cPath, 'target'], entityId: cId });
        }

        // Connection config
        validateConnectionConfig(c.kind, c.config, [...cPath, 'config'], cId, issues);
        if ((c.kind === 'call' || c.kind === 'message') &&
            c.config !== null && typeof c.config === 'object' && 'resource' in c.config) {
          const resource = c.config.resource;
          if (resource !== null && typeof resource === 'object' &&
              'requestClassId' in resource && typeof resource.requestClassId === 'string' &&
              'requestClassLabel' in resource && typeof resource.requestClassLabel === 'string') {
            const previous = requestClassLabels.get(resource.requestClassId);
            if (previous !== undefined && previous !== resource.requestClassLabel) {
              issues.push({
                code: 'structural-rule',
                path: [...cPath, 'config', 'resource', 'requestClassLabel'],
                entityId: cId,
                severity: 'error',
                message: 'Connections with the same request class must use the same label',
              });
            } else {
              requestClassLabels.set(resource.requestClassId, resource.requestClassLabel);
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // Section E: Relations (§2)
  // ==========================================================================
  if (validateArray(doc.relations, 200, ['relations'], docId, issues, 'Document relations')) {
    const relations = doc.relations as unknown[];
    for (let rIdx = 0; rIdx < relations.length; rIdx++) {
      const r = relations[rIdx];
      const rPath = ['relations', rIdx];
      if (r === null || typeof r !== 'object' || Array.isArray(r)) {
        issues.push({
          code: 'wrong-type',
          path: rPath,
          entityId: null,
          severity: 'error',
          message: 'Expected relation object',
        });
        continue;
      }

      const rec = r as Record<string, unknown>;
      let rId: Id | null = null;
      if (validateId(rec.id, [...rPath, 'id'], null, issues)) {
        rId = rec.id as string;
        registerId(rId, [...rPath, 'id'], allIds, issues);
        relationsMap.set(rId, { rec, index: rIdx });
      }

      validateString(rec.label, 1, 80, [...rPath, 'label'], rId, issues, 'Relation label');

      if (typeof rec.kind !== 'string' || !RELATION_KINDS.includes(rec.kind as (typeof RELATION_KINDS)[number])) {
        issues.push({
          code: 'invalid-literal',
          path: [...rPath, 'kind'],
          entityId: rId,
          severity: 'error',
          message: `Invalid relation kind: '${String(rec.kind)}'`,
        });
        continue;
      }

      if (rec.kind === 'contains') {
        checkRecord(rec, ['id', 'label', 'kind', 'parentId', 'childId'], ['id', 'label', 'kind', 'parentId', 'childId'], rPath, rId, issues, 'Contains relation');
      } else if (rec.kind === 'deployed-on') {
        checkRecord(rec, ['id', 'label', 'kind', 'elementId', 'hostId'], ['id', 'label', 'kind', 'elementId', 'hostId'], rPath, rId, issues, 'Deployed-on relation');
      } else if (rec.kind === 'descriptive') {
        checkRecord(rec, ['id', 'label', 'kind', 'sourceId', 'targetId'], ['id', 'label', 'kind', 'sourceId', 'targetId'], rPath, rId, issues, 'Descriptive relation');
      }
    }
  }

  // ==========================================================================
  // Section F: Refinements (§6)
  // ==========================================================================
  if (validateArray(doc.refinements, Number.MAX_SAFE_INTEGER, ['refinements'], docId, issues, 'Document refinements')) {
    const refinements = doc.refinements as unknown[];
    for (let refIdx = 0; refIdx < refinements.length; refIdx++) {
      const ref = refinements[refIdx];
      const refPath = ['refinements', refIdx];
      if (checkRecord(ref, ['id', 'ownerElementId', 'memberElementIds', 'portMappings'], ['id', 'ownerElementId', 'memberElementIds', 'portMappings'], refPath, docId, issues, 'Refinement')) {
        let refId: Id | null = null;
        if (validateId(ref.id, [...refPath, 'id'], null, issues)) {
          refId = ref.id;
          registerId(ref.id, [...refPath, 'id'], allIds, issues);
          refinementsMap.set(ref.id, { rec: ref, index: refIdx });
        }

        if (validateArray(ref.memberElementIds, Number.MAX_SAFE_INTEGER, [...refPath, 'memberElementIds'], refId, issues, 'Refinement memberElementIds')) {
          const members = ref.memberElementIds as unknown[];
          for (let mIdx = 0; mIdx < members.length; mIdx++) {
            validateId(members[mIdx], [...refPath, 'memberElementIds', mIdx], refId, issues);
          }
        }

        if (validateArray(ref.portMappings, Number.MAX_SAFE_INTEGER, [...refPath, 'portMappings'], refId, issues, 'Refinement portMappings')) {
          const mappings = ref.portMappings as unknown[];
          for (let mIdx = 0; mIdx < mappings.length; mIdx++) {
            const m = mappings[mIdx];
            const mPath = [...refPath, 'portMappings', mIdx];
            if (checkRecord(m, ['id', 'outer', 'inner'], ['id', 'outer', 'inner'], mPath, refId, issues, 'PortMapping')) {
              if (validateId(m.id, [...mPath, 'id'], refId, issues)) {
                registerId(m.id, [...mPath, 'id'], allIds, issues);
              }
              if (checkRecord(m.outer, ['elementId', 'portId'], ['elementId', 'portId'], [...mPath, 'outer'], refId, issues, 'PortMapping outer')) {
                pendingEndpoints.push({ endpoint: m.outer as Record<string, unknown>, path: [...mPath, 'outer'], entityId: refId });
              }
              if (checkRecord(m.inner, ['elementId', 'portId'], ['elementId', 'portId'], [...mPath, 'inner'], refId, issues, 'PortMapping inner')) {
                pendingEndpoints.push({ endpoint: m.inner as Record<string, unknown>, path: [...mPath, 'inner'], entityId: refId });
              }
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // Section G: Views (§2)
  // ==========================================================================
  const viewElementsPlaced = new Map<Id, Set<Id>>();
  if (validateArray(doc.views, 10, ['views'], docId, issues, 'Document views')) {
    const views = doc.views as unknown[];
    for (let vIdx = 0; vIdx < views.length; vIdx++) {
      const v = views[vIdx];
      const vPath = ['views', vIdx];
      if (checkRecord(v, ['id', 'label', 'placements', 'connectionIds', 'relationIds', 'groups', 'notes'], ['id', 'label', 'placements', 'connectionIds', 'relationIds', 'groups', 'notes'], vPath, docId, issues, 'View')) {
        let vId: Id | null = null;
        if (validateId(v.id, [...vPath, 'id'], null, issues)) {
          vId = v.id;
          registerId(v.id, [...vPath, 'id'], allIds, issues);
        }

        validateString(v.label, 1, 80, [...vPath, 'label'], vId, issues, 'View label');

        // Placements
        const placedSet = new Set<Id>();
        if (vId) viewElementsPlaced.set(vId, placedSet);

        if (validateArray(v.placements, 100, [...vPath, 'placements'], vId, issues, 'View placements')) {
          const placements = v.placements as unknown[];
          for (let pIdx = 0; pIdx < placements.length; pIdx++) {
            const p = placements[pIdx];
            const pPath = [...vPath, 'placements', pIdx];
            if (checkRecord(p, ['id', 'elementId', 'x', 'y', 'width', 'expanded'], ['id', 'elementId', 'x', 'y', 'width', 'expanded'], pPath, vId, issues, 'Placement')) {
              let pId: Id | null = null;
              if (validateId(p.id, [...pPath, 'id'], vId, issues)) {
                pId = p.id;
                registerId(p.id, [...pPath, 'id'], allIds, issues);
              }
              if (validateId(p.elementId, [...pPath, 'elementId'], pId ?? vId, issues)) {
                if (placedSet.has(p.elementId)) {
                  issues.push({
                    code: 'structural-rule',
                    path: [...pPath, 'elementId'],
                    entityId: pId ?? vId,
                    severity: 'error',
                    message: `Element '${p.elementId}' placed more than once in view`,
                  });
                } else {
                  placedSet.add(p.elementId);
                }
              }
              validateNumber(p.x, -1e6, 1e6, [...pPath, 'x'], pId ?? vId, issues, 'Placement x');
              validateNumber(p.y, -1e6, 1e6, [...pPath, 'y'], pId ?? vId, issues, 'Placement y');
              validateNumber(p.width, 80, 2000, [...pPath, 'width'], pId ?? vId, issues, 'Placement width');
              validateBoolean(p.expanded, [...pPath, 'expanded'], pId ?? vId, issues, 'Placement expanded');
            }
          }
        }

        // ConnectionIds
        if (validateArray(v.connectionIds, Number.MAX_SAFE_INTEGER, [...vPath, 'connectionIds'], vId, issues, 'View connectionIds')) {
          const connIds = v.connectionIds as unknown[];
          for (let i = 0; i < connIds.length; i++) {
            validateId(connIds[i], [...vPath, 'connectionIds', i], vId, issues);
          }
        }

        // RelationIds
        if (validateArray(v.relationIds, Number.MAX_SAFE_INTEGER, [...vPath, 'relationIds'], vId, issues, 'View relationIds')) {
          const relIds = v.relationIds as unknown[];
          for (let i = 0; i < relIds.length; i++) {
            validateId(relIds[i], [...vPath, 'relationIds', i], vId, issues);
          }
        }

        // Groups
        const groupedInView = new Set<Id>();
        if (validateArray(v.groups, 50, [...vPath, 'groups'], vId, issues, 'View groups')) {
          const groups = v.groups as unknown[];
          for (let gIdx = 0; gIdx < groups.length; gIdx++) {
            const g = groups[gIdx];
            const gPath = [...vPath, 'groups', gIdx];
            if (checkRecord(g, ['id', 'label', 'elementIds', 'collapsed'], ['id', 'label', 'elementIds', 'collapsed'], gPath, vId, issues, 'Group')) {
              let gId: Id | null = null;
              if (validateId(g.id, [...gPath, 'id'], vId, issues)) {
                gId = g.id;
                registerId(g.id, [...gPath, 'id'], allIds, issues);
              }
              validateString(g.label, 1, 80, [...gPath, 'label'], gId ?? vId, issues, 'Group label');
              validateBoolean(g.collapsed, [...gPath, 'collapsed'], gId ?? vId, issues, 'Group collapsed');

              if (validateArray(g.elementIds, Number.MAX_SAFE_INTEGER, [...gPath, 'elementIds'], gId ?? vId, issues, 'Group elementIds')) {
                const eIds = g.elementIds as unknown[];
                for (let eIdx = 0; eIdx < eIds.length; eIdx++) {
                  const elemId = eIds[eIdx];
                  const ePath = [...gPath, 'elementIds', eIdx];
                  if (validateId(elemId, ePath, gId ?? vId, issues)) {
                    if (groupedInView.has(elemId)) {
                      issues.push({
                        code: 'structural-rule',
                        path: ePath,
                        entityId: gId ?? vId,
                        severity: 'error',
                        message: `Element '${elemId}' appears in multiple groups in view (groups must be non-overlapping)`,
                      });
                    } else {
                      groupedInView.add(elemId);
                    }
                  }
                }
              }
            }
          }
        }

        // Notes
        if (validateArray(v.notes, 50, [...vPath, 'notes'], vId, issues, 'View notes')) {
          const notes = v.notes as unknown[];
          for (let nIdx = 0; nIdx < notes.length; nIdx++) {
            const n = notes[nIdx];
            const nPath = [...vPath, 'notes', nIdx];
            if (checkRecord(n, ['id', 'text', 'x', 'y', 'width', 'tone', 'attachedElementIds'], ['id', 'text', 'x', 'y', 'width', 'tone', 'attachedElementIds'], nPath, vId, issues, 'Note')) {
              let nId: Id | null = null;
              if (validateId(n.id, [...nPath, 'id'], vId, issues)) {
                nId = n.id;
                registerId(n.id, [...nPath, 'id'], allIds, issues);
              }
              validateString(n.text, 0, 4000, [...nPath, 'text'], nId ?? vId, issues, 'Note text');
              validateNumber(n.x, -1e6, 1e6, [...nPath, 'x'], nId ?? vId, issues, 'Note x');
              validateNumber(n.y, -1e6, 1e6, [...nPath, 'y'], nId ?? vId, issues, 'Note y');
              validateNumber(n.width, 80, 2000, [...nPath, 'width'], nId ?? vId, issues, 'Note width');

              if (typeof n.tone !== 'string' || !NOTE_TONES.includes(n.tone as (typeof NOTE_TONES)[number])) {
                issues.push({
                  code: 'invalid-literal',
                  path: [...nPath, 'tone'],
                  entityId: nId ?? vId,
                  severity: 'error',
                  message: `Invalid note tone: '${String(n.tone)}'`,
                });
              }

              if (validateArray(n.attachedElementIds, Number.MAX_SAFE_INTEGER, [...nPath, 'attachedElementIds'], nId ?? vId, issues, 'Note attachedElementIds')) {
                const attIds = n.attachedElementIds as unknown[];
                for (let aIdx = 0; aIdx < attIds.length; aIdx++) {
                  validateId(attIds[aIdx], [...nPath, 'attachedElementIds', aIdx], nId ?? vId, issues);
                }
              }
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // Section H: Scenarios (§6)
  // ==========================================================================
  if (validateArray(doc.scenarios, 20, ['scenarios'], docId, issues, 'Document scenarios')) {
    const scenarios = doc.scenarios as unknown[];
    for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
      const s = scenarios[sIdx];
      const sPath = ['scenarios', sIdx];
      validateScenario(s, sPath, allIds, pendingEndpoints, pendingSchemaRefs, pendingFixtureRefs, issues);
    }
  }

  // ==========================================================================
  // Phase 2: References and Invariant Checking
  // ==========================================================================

  // 1. Pending Endpoints
  for (const { endpoint, path, entityId } of pendingEndpoints) {
    const elemId = endpoint.elementId as string;
    const portId = endpoint.portId as string;

    if (typeof elemId === 'string' && UUID_REGEX.test(elemId)) {
      if (!elementsMap.has(elemId)) {
        issues.push({
          code: 'dangling-reference',
          path: [...path, 'elementId'],
          entityId,
          severity: 'error',
          message: `Endpoint elementId '${elemId}' does not exist`,
        });
      } else {
        const ports = elementPortsMap.get(elemId);
        if (typeof portId === 'string' && UUID_REGEX.test(portId)) {
          if (!ports || !ports.has(portId)) {
            issues.push({
              code: 'dangling-reference',
              path: [...path, 'portId'],
              entityId,
              severity: 'error',
              message: `Endpoint portId '${portId}' does not exist on element '${elemId}'`,
            });
          }
        }
      }
    }
  }

  // 2. Pending Schema references
  for (const { schemaId, path, entityId } of pendingSchemaRefs) {
    if (typeof schemaId === 'string' && UUID_REGEX.test(schemaId)) {
      if (!schemasMap.has(schemaId)) {
        issues.push({
          code: 'dangling-reference',
          path,
          entityId,
          severity: 'error',
          message: `Schema reference '${schemaId}' does not exist`,
        });
      }
    }
  }

  // 3. Pending Fixture references
  for (const { fixtureId, path, entityId } of pendingFixtureRefs) {
    if (typeof fixtureId === 'string' && UUID_REGEX.test(fixtureId)) {
      if (!fixturesMap.has(fixtureId)) {
        issues.push({
          code: 'dangling-reference',
          path,
          entityId,
          severity: 'error',
          message: `Fixture reference '${fixtureId}' does not exist`,
        });
      }
    }
  }

  // 4. Connection endpoint channel and structural invariants
  if (Array.isArray(doc.connections)) {
    const seenPairs = new Set<string>();
    const conns = doc.connections as unknown[];
    for (let cIdx = 0; cIdx < conns.length; cIdx++) {
      const c = conns[cIdx] as Record<string, unknown>;
      if (!c || typeof c !== 'object') continue;
      const cPath = ['connections', cIdx];
      const cId = typeof c.id === 'string' ? c.id : null;
      const src = c.source as Record<string, unknown> | undefined;
      const tgt = c.target as Record<string, unknown> | undefined;

      if (src && tgt && typeof src.elementId === 'string' && typeof src.portId === 'string' && typeof tgt.elementId === 'string' && typeof tgt.portId === 'string') {
        const srcPortInfo = elementPortsMap.get(src.elementId)?.get(src.portId);
        const tgtPortInfo = elementPortsMap.get(tgt.elementId)?.get(tgt.portId);

        if (srcPortInfo && tgtPortInfo) {
          const srcPort = srcPortInfo.rec;
          const tgtPort = tgtPortInfo.rec;

          if (srcPort.direction !== 'out') {
            issues.push({
              code: 'structural-rule',
              path: [...cPath, 'source'],
              entityId: cId,
              severity: 'error',
              message: `Connection source port must have direction 'out'`,
            });
          }
          if (tgtPort.direction !== 'in') {
            issues.push({
              code: 'structural-rule',
              path: [...cPath, 'target'],
              entityId: cId,
              severity: 'error',
              message: `Connection target port must have direction 'in'`,
            });
          }

          if (srcPort.channel !== c.kind || tgtPort.channel !== c.kind) {
            issues.push({
              code: 'structural-rule',
              path: [...cPath, 'kind'],
              entityId: cId,
              severity: 'error',
              message: `Connection kind '${String(c.kind)}' must match source channel '${String(srcPort.channel)}' and target channel '${String(tgtPort.channel)}'`,
            });
          }

          if (srcPort.channel === 'event' || tgtPort.channel === 'event') {
            issues.push({
              code: 'structural-rule',
              path: cPath,
              entityId: cId,
              severity: 'error',
              message: `Outbound event ports cannot be wired by connections`,
            });
          }

          const pairKey = `${String(c.kind)}:${src.portId}:${tgt.portId}`;
          if (seenPairs.has(pairKey)) {
            issues.push({
              code: 'structural-rule',
              path: cPath,
              entityId: cId,
              severity: 'error',
              message: `Duplicate connection (kind, source port, target port)`,
            });
          } else {
            seenPairs.add(pairKey);
          }
        }
      }
    }
  }

  // 5. Relations structural invariants (forest and single host)
  if (Array.isArray(doc.relations)) {
    const childToParent = new Map<Id, { parentId: Id; index: number }>();
    const elementToHost = new Map<Id, number>();
    const rels = doc.relations as unknown[];

    for (let rIdx = 0; rIdx < rels.length; rIdx++) {
      const r = rels[rIdx] as Record<string, unknown>;
      if (!r || typeof r !== 'object') continue;
      const rPath = ['relations', rIdx];
      const rId = typeof r.id === 'string' ? r.id : null;

      if (r.kind === 'contains') {
        const parentId = r.parentId as string;
        const childId = r.childId as string;

        if (typeof parentId === 'string' && UUID_REGEX.test(parentId) && !elementsMap.has(parentId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...rPath, 'parentId'],
            entityId: rId,
            severity: 'error',
            message: `Contains relation parentId '${parentId}' does not exist`,
          });
        }
        if (typeof childId === 'string' && UUID_REGEX.test(childId) && !elementsMap.has(childId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...rPath, 'childId'],
            entityId: rId,
            severity: 'error',
            message: `Contains relation childId '${childId}' does not exist`,
          });
        }

        if (typeof parentId === 'string' && typeof childId === 'string' && elementsMap.has(parentId) && elementsMap.has(childId)) {
          if (childToParent.has(childId)) {
            issues.push({
              code: 'structural-rule',
              path: [...rPath, 'childId'],
              entityId: rId,
              severity: 'error',
              message: `Element '${childId}' already has a parent in contains relations (single-parent forest required)`,
            });
          } else {
            childToParent.set(childId, { parentId, index: rIdx });
            // Cycle check
            let curr: Id | undefined = parentId;
            const visitedAncestors = new Set<Id>();
            while (curr) {
              if (curr === childId) {
                issues.push({
                  code: 'structural-rule',
                  path: rPath,
                  entityId: rId,
                  severity: 'error',
                  message: `Cycle detected in contains relations involving '${childId}'`,
                });
                break;
              }
              if (visitedAncestors.has(curr)) break;
              visitedAncestors.add(curr);
              curr = childToParent.get(curr)?.parentId;
            }
          }
        }
      } else if (r.kind === 'deployed-on') {
        const elemId = r.elementId as string;
        const hostId = r.hostId as string;

        if (typeof elemId === 'string' && UUID_REGEX.test(elemId) && !elementsMap.has(elemId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...rPath, 'elementId'],
            entityId: rId,
            severity: 'error',
            message: `Deployed-on relation elementId '${elemId}' does not exist`,
          });
        }
        if (typeof hostId === 'string' && UUID_REGEX.test(hostId) && !elementsMap.has(hostId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...rPath, 'hostId'],
            entityId: rId,
            severity: 'error',
            message: `Deployed-on relation hostId '${hostId}' does not exist`,
          });
        }

        if (typeof elemId === 'string' && typeof hostId === 'string') {
          if (elementToHost.has(elemId)) {
            issues.push({
              code: 'structural-rule',
              path: [...rPath, 'elementId'],
              entityId: rId,
              severity: 'error',
              message: `Element '${elemId}' already deployed on a host (at most one host allowed)`,
            });
          } else {
            elementToHost.set(elemId, rIdx);
          }

          const hostInfo = elementsMap.get(hostId);
          if (hostInfo) {
            const hostBehavior = hostInfo.rec.behavior as Record<string, unknown> | undefined;
            if (hostBehavior?.kind !== 'host') {
              issues.push({
                code: 'wrong-reference-kind',
                path: [...rPath, 'hostId'],
                entityId: rId,
                severity: 'error',
                message: `Deployed-on host '${hostId}' must have behavior kind 'host'`,
              });
            }
          }
        }
      } else if (r.kind === 'descriptive') {
        const srcId = r.sourceId as string;
        const tgtId = r.targetId as string;
        if (typeof srcId === 'string' && UUID_REGEX.test(srcId) && !elementsMap.has(srcId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...rPath, 'sourceId'],
            entityId: rId,
            severity: 'error',
            message: `Descriptive relation sourceId '${srcId}' does not exist`,
          });
        }
        if (typeof tgtId === 'string' && UUID_REGEX.test(tgtId) && !elementsMap.has(tgtId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...rPath, 'targetId'],
            entityId: rId,
            severity: 'error',
            message: `Descriptive relation targetId '${tgtId}' does not exist`,
          });
        }
      }
    }
  }

  // 6. View references (placements, connectionIds, relationIds, group/note attached elements)
  if (Array.isArray(doc.views)) {
    const views = doc.views as unknown[];
    for (let vIdx = 0; vIdx < views.length; vIdx++) {
      const v = views[vIdx] as Record<string, unknown>;
      if (!v || typeof v !== 'object') continue;
      const vPath = ['views', vIdx];
      const vId = typeof v.id === 'string' ? v.id : null;
      const placedSet = (vId ? viewElementsPlaced.get(vId) : null) ?? new Set<Id>();

      // Placements elementId -> element
      if (Array.isArray(v.placements)) {
        for (let pIdx = 0; pIdx < v.placements.length; pIdx++) {
          const p = v.placements[pIdx] as Record<string, unknown>;
          if (p && typeof p.elementId === 'string' && UUID_REGEX.test(p.elementId)) {
            if (!elementsMap.has(p.elementId)) {
              issues.push({
                code: 'dangling-reference',
                path: [...vPath, 'placements', pIdx, 'elementId'],
                entityId: typeof p.id === 'string' ? p.id : vId,
                severity: 'error',
                message: `Placement elementId '${p.elementId}' does not exist`,
              });
            }
          }
        }
      }

      // connectionIds -> connections
      if (Array.isArray(v.connectionIds)) {
        for (let i = 0; i < v.connectionIds.length; i++) {
          const cId = v.connectionIds[i];
          if (typeof cId === 'string' && UUID_REGEX.test(cId)) {
            if (!connectionsMap.has(cId)) {
              issues.push({
                code: 'dangling-reference',
                path: [...vPath, 'connectionIds', i],
                entityId: vId,
                severity: 'error',
                message: `View connectionId '${cId}' does not exist`,
              });
            }
          }
        }
      }

      // relationIds -> relations
      if (Array.isArray(v.relationIds)) {
        for (let i = 0; i < v.relationIds.length; i++) {
          const rId = v.relationIds[i];
          if (typeof rId === 'string' && UUID_REGEX.test(rId)) {
            if (!relationsMap.has(rId)) {
              issues.push({
                code: 'dangling-reference',
                path: [...vPath, 'relationIds', i],
                entityId: vId,
                severity: 'error',
                message: `View relationId '${rId}' does not exist`,
              });
            }
          }
        }
      }

      // Groups -> placed elements in view
      if (Array.isArray(v.groups)) {
        for (let gIdx = 0; gIdx < v.groups.length; gIdx++) {
          const g = v.groups[gIdx] as Record<string, unknown>;
          if (g && Array.isArray(g.elementIds)) {
            const gId = typeof g.id === 'string' ? g.id : vId;
            for (let eIdx = 0; eIdx < g.elementIds.length; eIdx++) {
              const elemId = g.elementIds[eIdx];
              if (typeof elemId === 'string' && UUID_REGEX.test(elemId)) {
                if (!elementsMap.has(elemId)) {
                  issues.push({
                    code: 'dangling-reference',
                    path: [...vPath, 'groups', gIdx, 'elementIds', eIdx],
                    entityId: gId,
                    severity: 'error',
                    message: `Group elementId '${elemId}' does not exist`,
                  });
                } else if (!placedSet.has(elemId)) {
                  issues.push({
                    code: 'structural-rule',
                    path: [...vPath, 'groups', gIdx, 'elementIds', eIdx],
                    entityId: gId,
                    severity: 'error',
                    message: `Group element '${elemId}' must be placed in this view`,
                  });
                }
              }
            }
          }
        }
      }

      // Notes -> placed elements in view
      if (Array.isArray(v.notes)) {
        for (let nIdx = 0; nIdx < v.notes.length; nIdx++) {
          const n = v.notes[nIdx] as Record<string, unknown>;
          if (n && Array.isArray(n.attachedElementIds)) {
            const nId = typeof n.id === 'string' ? n.id : vId;
            for (let eIdx = 0; eIdx < n.attachedElementIds.length; eIdx++) {
              const elemId = n.attachedElementIds[eIdx];
              if (typeof elemId === 'string' && UUID_REGEX.test(elemId)) {
                if (!elementsMap.has(elemId)) {
                  issues.push({
                    code: 'dangling-reference',
                    path: [...vPath, 'notes', nIdx, 'attachedElementIds', eIdx],
                    entityId: nId,
                    severity: 'error',
                    message: `Note attachedElementId '${elemId}' does not exist`,
                  });
                } else if (!placedSet.has(elemId)) {
                  issues.push({
                    code: 'structural-rule',
                    path: [...vPath, 'notes', nIdx, 'attachedElementIds', eIdx],
                    entityId: nId,
                    severity: 'error',
                    message: `Note attached element '${elemId}' must be placed in this view`,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  // 7. Refinement owner and members
  if (Array.isArray(doc.refinements)) {
    const refs = doc.refinements as unknown[];
    for (let refIdx = 0; refIdx < refs.length; refIdx++) {
      const ref = refs[refIdx] as Record<string, unknown>;
      if (!ref || typeof ref !== 'object') continue;
      const refPath = ['refinements', refIdx];
      const refId = typeof ref.id === 'string' ? ref.id : null;

      if (typeof ref.ownerElementId === 'string' && UUID_REGEX.test(ref.ownerElementId) && !elementsMap.has(ref.ownerElementId)) {
        issues.push({
          code: 'dangling-reference',
          path: [...refPath, 'ownerElementId'],
          entityId: refId,
          severity: 'error',
          message: `Refinement ownerElementId '${ref.ownerElementId}' does not exist`,
        });
      }

      if (Array.isArray(ref.memberElementIds)) {
        for (let mIdx = 0; mIdx < ref.memberElementIds.length; mIdx++) {
          const mId = ref.memberElementIds[mIdx];
          if (typeof mId === 'string' && UUID_REGEX.test(mId) && !elementsMap.has(mId)) {
            issues.push({
              code: 'dangling-reference',
              path: [...refPath, 'memberElementIds', mIdx],
              entityId: refId,
              severity: 'error',
              message: `Refinement memberElementId '${mId}' does not exist`,
            });
          }
        }
      }
    }
  }

  // 7b. D33: Recursive refinement ownership is a storable structural error, like a
  // `contains` cycle: reject a refinement whose owner is, transitively, a member of a
  // refinement it owns (self-membership included). Checked iteratively (explicit stack,
  // no recursion) over the ownerElementId -> memberElementIds graph.
  if (Array.isArray(doc.refinements)) {
    const refs = doc.refinements as unknown[];

    // Union all memberElementIds authored under each ownerElementId, so the reachability
    // walk below follows every ownership edge even if an owner appears on more than one
    // (possibly malformed) refinement record.
    const ownerToMembers = new Map<Id, Id[]>();
    for (const r of refs) {
      const rr = r as Record<string, unknown>;
      if (!rr || typeof rr !== 'object') continue;
      const ownerId = typeof rr.ownerElementId === 'string' ? rr.ownerElementId : null;
      if (!ownerId) continue;
      const members = Array.isArray(rr.memberElementIds)
        ? (rr.memberElementIds.filter((m): m is Id => typeof m === 'string') as Id[])
        : [];
      const existing = ownerToMembers.get(ownerId) ?? [];
      ownerToMembers.set(ownerId, existing.concat(members));
    }

    for (let refIdx = 0; refIdx < refs.length; refIdx++) {
      const ref = refs[refIdx] as Record<string, unknown>;
      if (!ref || typeof ref !== 'object') continue;
      const refPath = ['refinements', refIdx];
      const refId = typeof ref.id === 'string' ? ref.id : null;
      const ownerId = typeof ref.ownerElementId === 'string' ? ref.ownerElementId : null;
      if (!ownerId) continue;
      const members = Array.isArray(ref.memberElementIds)
        ? (ref.memberElementIds.filter((m): m is Id => typeof m === 'string') as Id[])
        : [];

      // Is `ownerId` reachable by walking from this refinement's own members through the
      // ownerElementId -> memberElementIds chain (i.e. is the owner transitively a member
      // of a refinement it owns)?
      const visited = new Set<Id>();
      const stack: Id[] = [...members];
      let cyclic = false;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur === ownerId) {
          cyclic = true;
          break;
        }
        if (visited.has(cur)) continue;
        visited.add(cur);
        const next = ownerToMembers.get(cur);
        if (next) stack.push(...next);
      }

      if (cyclic) {
        issues.push({
          code: 'structural-rule',
          path: refPath,
          entityId: refId,
          severity: 'error',
          message: `Recursive refinement ownership: element '${ownerId}' is transitively a member of a refinement it owns`,
        });
      }
    }
  }

  // 8. Refinement selections in scenarios -> refinements
  if (Array.isArray(doc.scenarios)) {
    const scenarios = doc.scenarios as unknown[];
    for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
      const s = scenarios[sIdx] as Record<string, unknown>;
      if (!s || typeof s !== 'object') continue;
      const sPath = ['scenarios', sIdx];
      const sId = typeof s.id === 'string' ? s.id : null;

      if (Array.isArray(s.refinementSelections)) {
        for (let rIdx = 0; rIdx < s.refinementSelections.length; rIdx++) {
          const sel = s.refinementSelections[rIdx] as Record<string, unknown>;
          if (sel && typeof sel.refinementId === 'string' && UUID_REGEX.test(sel.refinementId)) {
            if (!refinementsMap.has(sel.refinementId)) {
              issues.push({
                code: 'dangling-reference',
                path: [...sPath, 'refinementSelections', rIdx, 'refinementId'],
                entityId: sId,
                severity: 'error',
                message: `Refinement selection '${sel.refinementId}' does not exist`,
              });
            }
          }
        }
      }

      // 9. Scenario scopeElementIds -> elements
      if (Array.isArray(s.scopeElementIds)) {
        for (let i = 0; i < s.scopeElementIds.length; i++) {
          const id = s.scopeElementIds[i];
          if (typeof id === 'string' && UUID_REGEX.test(id) && !elementsMap.has(id)) {
            issues.push({
              code: 'dangling-reference',
              path: [...sPath, 'scopeElementIds', i],
              entityId: sId,
              severity: 'error',
              message: `Scenario scopeElementId '${id}' does not exist`,
            });
          }
        }
      }

      // 10. Scenario faults -> hostId
      if (Array.isArray(s.faults)) {
        for (let fIdx = 0; fIdx < s.faults.length; fIdx++) {
          const f = s.faults[fIdx] as Record<string, unknown>;
          if (f && typeof f.hostId === 'string' && UUID_REGEX.test(f.hostId)) {
            const fId = typeof f.id === 'string' ? f.id : sId;
            const elInfo = elementsMap.get(f.hostId);
            if (!elInfo) {
              issues.push({
                code: 'dangling-reference',
                path: [...sPath, 'faults', fIdx, 'hostId'],
                entityId: fId,
                severity: 'error',
                message: `Fault hostId '${f.hostId}' does not exist`,
              });
            } else {
              const b = elInfo.rec.behavior as Record<string, unknown> | undefined;
              if (b?.kind !== 'host') {
                issues.push({
                  code: 'wrong-reference-kind',
                  path: [...sPath, 'faults', fIdx, 'hostId'],
                  entityId: fId,
                  severity: 'error',
                  message: `Fault hostId '${f.hostId}' must reference an element with behavior kind 'host'`,
                });
              }
            }
          }
        }
      }

      // 11. Scenario initialContexts -> elements
      if (Array.isArray(s.initialContexts)) {
        for (let icIdx = 0; icIdx < s.initialContexts.length; icIdx++) {
          const ic = s.initialContexts[icIdx] as Record<string, unknown>;
          if (ic && typeof ic.elementId === 'string' && UUID_REGEX.test(ic.elementId)) {
            if (!elementsMap.has(ic.elementId)) {
              issues.push({
                code: 'dangling-reference',
                path: [...sPath, 'initialContexts', icIdx, 'elementId'],
                entityId: sId,
                severity: 'error',
                message: `Scenario initialContext elementId '${ic.elementId}' does not exist`,
              });
            }
          }
        }
      }

      // 12. Scenario assertion subjects -> elements
      if (Array.isArray(s.assertions)) {
        for (let aIdx = 0; aIdx < s.assertions.length; aIdx++) {
          const a = s.assertions[aIdx] as Record<string, unknown>;
          if (!a || typeof a !== 'object') continue;
          const aId = typeof a.id === 'string' ? a.id : sId;
          const subj = a.subject as Record<string, unknown> | undefined;
          if (subj && typeof subj === 'object') {
            if (typeof subj.elementId === 'string' && UUID_REGEX.test(subj.elementId)) {
              if (!elementsMap.has(subj.elementId)) {
                issues.push({
                  code: 'dangling-reference',
                  path: [...sPath, 'assertions', aIdx, 'subject', 'elementId'],
                  entityId: aId,
                  severity: 'error',
                  message: `Assertion subject elementId '${subj.elementId}' does not exist`,
                });
              }
            }
          }
        }
      }
    }
  }

  if (issues.length > 0) {
    const seen = new Set<string>();
    const uniqueIssues: Issue[] = [];
    for (const iss of issues) {
      const key = `${iss.code}:${iss.path.join('/')}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueIssues.push(iss);
      }
    }
    return { ok: false, issues: uniqueIssues };
  }

  return { ok: true, document: input as Document };
}

// ============================================================================
// Sub-Validators for Behaviors and Scenarios
// ============================================================================

function validateBehavior(
  b: unknown,
  path: readonly (string | number)[],
  elementId: Id | null,
  portsMap: Map<Id, { rec: Record<string, unknown>; index: number }>,
  allIds: Map<string, (string | number)[]>,
  pendingSchemaRefs: { schemaId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  pendingFixtureRefs: { fixtureId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  issues: Issue[],
): void {
  const entityId = elementId;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: 'Behavior must be an object',
    });
    return;
  }

  const rec = b as Record<string, unknown>;
  const kind = rec.kind;

  if (typeof kind !== 'string' || !BEHAVIOR_KINDS.includes(kind as (typeof BEHAVIOR_KINDS)[number])) {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'kind'],
      entityId,
      severity: 'error',
      message: `Invalid behavior kind: '${String(kind)}'`,
    });
    return;
  }

  if (rec.version !== 1) {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'version'],
      entityId,
      severity: 'error',
      message: `Behavior version must be 1, got ${String(rec.version)}`,
    });
  }

  if (kind === 'unmodeled') {
    if (checkRecord(rec, ['kind', 'version', 'reason'], ['kind', 'version', 'reason'], path, entityId, issues, 'unmodeled behavior')) {
      validateString(rec.reason, 0, 4000, [...path, 'reason'], entityId, issues, 'Unmodeled reason');
    }
  } else if (kind === 'host') {
    checkRecord(rec, ['kind', 'version'], ['kind', 'version'], path, entityId, issues, 'host behavior');
  } else if (kind === 'resource') {
    if (checkRecord(rec, ['kind', 'version', 'config', 'entryPortId'], ['kind', 'version', 'config', 'entryPortId'], path, entityId, issues, 'resource behavior')) {
      if (validateId(rec.entryPortId, [...path, 'entryPortId'], entityId, issues)) {
        if (!portsMap.has(rec.entryPortId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...path, 'entryPortId'],
            entityId,
            severity: 'error',
            message: `Resource entryPortId '${rec.entryPortId}' does not exist on this element`,
          });
        }
      }
      validateResourceConfig(rec.config, [...path, 'config'], entityId, issues);
    }
  } else if (kind === 'machine') {
    validateMachineBehavior(rec, path, entityId, portsMap, allIds, pendingSchemaRefs, pendingFixtureRefs, issues);
  } else if (kind === 'pipeline') {
    validatePipelineBehavior(rec, path, entityId, portsMap, allIds, pendingSchemaRefs, issues);
  } else if (kind === 'decision') {
    validateDecisionBehavior(rec, path, entityId, portsMap, allIds, pendingSchemaRefs, issues);
  }
}

function validateResourceConfig(
  cfg: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
): void {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: 'Resource config must be an object',
    });
    return;
  }

  const rec = cfg as Record<string, unknown>;
  const t = rec.type;

  const commonAllowed = ['type', 'capacity', 'concurrency', 'queueLimit', 'failureRate', 'maxRetries', 'retryDelayMs', 'serviceTime', 'serviceTimeCv'];
  const commonRequired = ['type', 'capacity', 'concurrency', 'queueLimit', 'failureRate', 'maxRetries', 'retryDelayMs'];

  let allowed = commonAllowed;
  if (t === 'storage') {
    allowed = [...commonAllowed, 'writeCapacity'];
  } else if (t === 'router') {
    allowed = [...commonAllowed, 'strategy'];
  } else if (t === 'cache') {
    allowed = [...commonAllowed, 'mode', 'hitRate', 'entries', 'ttlMs'];
  } else if (t === 'broker') {
    allowed = [...commonAllowed, 'delivery'];
  } else if (t === 'source' || t === 'processor') {
    allowed = commonAllowed;
  } else {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'type'],
      entityId,
      severity: 'error',
      message: `Invalid resource config type: '${String(t)}'`,
    });
    return;
  }

  const required = allowed.filter((k) => k !== 'serviceTime' && k !== 'serviceTimeCv');
  if (checkRecord(rec, allowed, required, path, entityId, issues, `ResourceConfig (${String(t)})`)) {
    validateNumber(rec.capacity, 1, 100000, [...path, 'capacity'], entityId, issues, 'capacity');
    validateNumber(rec.concurrency, 1, 1024, [...path, 'concurrency'], entityId, issues, 'concurrency', true);
    if (rec.serviceTime !== undefined && rec.serviceTime !== 'fixed' && rec.serviceTime !== 'exponential' && rec.serviceTime !== 'lognormal') {
      issues.push({
        code: 'invalid-literal',
        path: [...path, 'serviceTime'],
        entityId,
        severity: 'error',
        message: `serviceTime must be 'fixed', 'exponential' or 'lognormal'`,
      });
    }
    if (rec.serviceTime === 'lognormal') {
      validateNumber(rec.serviceTimeCv, 0.1, 10, [...path, 'serviceTimeCv'], entityId, issues, 'serviceTimeCv');
    } else if (rec.serviceTimeCv !== undefined) {
      issues.push({
        code: 'structural-rule',
        path: [...path, 'serviceTimeCv'],
        entityId,
        severity: 'error',
        message: 'serviceTimeCv applies to lognormal service time only',
      });
    }
    validateNumber(rec.queueLimit, 0, 10000, [...path, 'queueLimit'], entityId, issues, 'queueLimit', true);
    validateNumber(rec.failureRate, 0, 100, [...path, 'failureRate'], entityId, issues, 'failureRate');
    validateNumber(rec.maxRetries, 0, 5, [...path, 'maxRetries'], entityId, issues, 'maxRetries', true);
    validateNumber(rec.retryDelayMs, 0, 10000, [...path, 'retryDelayMs'], entityId, issues, 'retryDelayMs');

    if (t === 'storage') {
      validateNumber(rec.writeCapacity, 1, 100000, [...path, 'writeCapacity'], entityId, issues, 'writeCapacity');
    } else if (t === 'router') {
      if (rec.strategy !== 'round-robin' && rec.strategy !== 'weighted' && rec.strategy !== 'conditional') {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'strategy'],
          entityId,
          severity: 'error',
          message: `Router strategy must be 'round-robin', 'weighted', or 'conditional'`,
        });
      }
    } else if (t === 'cache') {
      if (rec.mode !== 'fixed' && rec.mode !== 'lru') {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'mode'],
          entityId,
          severity: 'error',
          message: `Cache mode must be 'fixed' or 'lru'`,
        });
      }
      validateNumber(rec.hitRate, 0, 100, [...path, 'hitRate'], entityId, issues, 'hitRate');
      validateNumber(rec.entries, 1, 100000, [...path, 'entries'], entityId, issues, 'entries', true);
      validateNumber(rec.ttlMs, 1, 3600000, [...path, 'ttlMs'], entityId, issues, 'ttlMs');
    } else if (t === 'broker') {
      if (rec.delivery !== 'competing' && rec.delivery !== 'broadcast') {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'delivery'],
          entityId,
          severity: 'error',
          message: `Broker delivery must be 'competing' or 'broadcast'`,
        });
      }
    }
  }
}

function validateConnectionConfig(
  kind: unknown,
  cfg: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
): void {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: 'Connection config must be an object',
    });
    return;
  }

  const rec = cfg as Record<string, unknown>;

  if (kind === 'data') {
    checkRecord(rec, [], [], path, entityId, issues, 'DataConnectionConfig');
  } else if (kind === 'call') {
    const allowed = ['latencyMs', 'returnLatencyMs', 'weight', 'condition', 'fallback', 'resource', 'retry'];
    const required = ['latencyMs', 'returnLatencyMs', 'weight', 'condition', 'fallback', 'resource'];
    if (checkRecord(rec, allowed, required, path, entityId, issues, 'CallConnectionConfig')) {
      validateCallRetryPolicy(rec.retry, [...path, 'retry'], entityId, issues);
      validateNumber(rec.latencyMs, 0, 60000, [...path, 'latencyMs'], entityId, issues, 'latencyMs');
      validateNumber(rec.returnLatencyMs, 0, 60000, [...path, 'returnLatencyMs'], entityId, issues, 'returnLatencyMs');
      validateNumber(rec.weight, 0, 1e6, [...path, 'weight'], entityId, issues, 'weight', false, true);
      validateBoolean(rec.fallback, [...path, 'fallback'], entityId, issues, 'fallback');
      validateRouteCondition(rec.condition, [...path, 'condition'], entityId, issues);
      validateResourceCallMetadata(rec.resource, [...path, 'resource'], entityId, issues);
    }
  } else if (kind === 'message') {
    const allowed = ['latencyMs', 'ackDelayMs', 'messageTtlMs', 'weight', 'condition', 'fallback', 'resource'];
    if (checkRecord(rec, allowed, allowed, path, entityId, issues, 'MessageConnectionConfig')) {
      validateNumber(rec.latencyMs, 0, 60000, [...path, 'latencyMs'], entityId, issues, 'latencyMs');
      validateNumber(rec.ackDelayMs, 0, 60000, [...path, 'ackDelayMs'], entityId, issues, 'ackDelayMs');
      validateNumber(rec.messageTtlMs, 1, 3600000, [...path, 'messageTtlMs'], entityId, issues, 'messageTtlMs');
      validateNumber(rec.weight, 0, 1e6, [...path, 'weight'], entityId, issues, 'weight', false, true);
      validateBoolean(rec.fallback, [...path, 'fallback'], entityId, issues, 'fallback');
      validateRouteCondition(rec.condition, [...path, 'condition'], entityId, issues);
      validateResourceCallMetadata(rec.resource, [...path, 'resource'], entityId, issues);
    }
  }
}

function validateRouteCondition(
  cond: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
): void {
  if (cond === null) return;
  if (checkRecord(cond, ['field', 'value'], ['field', 'value'], path, entityId, issues, 'RouteCondition')) {
    const rec = cond as Record<string, unknown>;
    if (typeof rec.field !== 'string' || !ROUTE_CONDITION_FIELDS.includes(rec.field as (typeof ROUTE_CONDITION_FIELDS)[number])) {
      issues.push({
        code: 'invalid-literal',
        path: [...path, 'field'],
        entityId,
        severity: 'error',
        message: `RouteCondition field must be 'class', 'operation', or 'tag'`,
      });
    }
    validateString(rec.value, 1, 80, [...path, 'value'], entityId, issues, 'RouteCondition value');
  }
}



/** D50: steady, burst ({peakRate, startMs < endMs}) or ramp ({endRate}). */
function validateWorkloadProfile(value: unknown, path: (string | number)[], entityId: Id | null, issues: Issue[]): void {
  const kind = (value as { kind?: unknown } | null)?.kind;
  const keys = kind === 'burst' ? ['kind', 'peakRate', 'startMs', 'endMs'] : kind === 'ramp' ? ['kind', 'endRate'] : ['kind'];
  if (!checkRecord(value, keys, keys, path, entityId, issues, 'Workload profile')) return;
  const p = value as Record<string, unknown>;
  if (kind === 'burst') {
    validateNumber(p.peakRate, 0, 10000, [...path, 'peakRate'], entityId, issues, 'peakRate', false, true);
    validateNumber(p.startMs, 0, 300000, [...path, 'startMs'], entityId, issues, 'startMs');
    validateNumber(p.endMs, 0, 300000, [...path, 'endMs'], entityId, issues, 'endMs');
    if (typeof p.startMs === 'number' && typeof p.endMs === 'number' && p.startMs >= p.endMs) {
      issues.push({ code: 'structural-rule', path: [...path, 'endMs'], entityId, severity: 'error', message: 'A burst must end after it starts' });
    }
  } else if (kind === 'ramp') {
    validateNumber(p.endRate, 0, 10000, [...path, 'endRate'], entityId, issues, 'endRate', false, true);
  } else if (kind !== 'steady') {
    issues.push({ code: 'invalid-literal', path: [...path, 'kind'], entityId, severity: 'error', message: `Workload profile kind must be 'steady', 'burst' or 'ramp'` });
  }
}

/** D49: caller retry policy on a call connection; absent or null means no retries. */
function validateCallRetryPolicy(value: unknown, path: (string | number)[], entityId: Id | null, issues: Issue[]): void {
  if (value === undefined || value === null) return;
  const keys = ['maxAttempts', 'backoffMs', 'backoffMultiplier', 'maxBackoffMs', 'jitter', 'attemptTimeoutMs'];
  if (!checkRecord(value, keys, keys, path, entityId, issues, 'CallRetryPolicy')) return;
  const r = value as Record<string, unknown>;
  validateNumber(r.maxAttempts, 1, 10, [...path, 'maxAttempts'], entityId, issues, 'maxAttempts', true);
  validateNumber(r.backoffMs, 0, 60000, [...path, 'backoffMs'], entityId, issues, 'backoffMs');
  validateNumber(r.backoffMultiplier, 1, 10, [...path, 'backoffMultiplier'], entityId, issues, 'backoffMultiplier');
  validateNumber(r.maxBackoffMs, 0, 600000, [...path, 'maxBackoffMs'], entityId, issues, 'maxBackoffMs');
  validateBoolean(r.jitter, [...path, 'jitter'], entityId, issues, 'jitter');
  if (r.attemptTimeoutMs !== null) {
    validateNumber(r.attemptTimeoutMs, 1, 600000, [...path, 'attemptTimeoutMs'], entityId, issues, 'attemptTimeoutMs');
  }
}

function validateResourceCallMetadata(
  res: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
): void {
  if (res === null) return;
  if (checkRecord(res, ['requestClassId', 'requestClassLabel', 'operation', 'key', 'tags', 'deadlineDurationMs'], ['requestClassId', 'requestClassLabel', 'operation', 'key', 'tags', 'deadlineDurationMs'], path, entityId, issues, 'ResourceCallMetadata')) {
    const rec = res as Record<string, unknown>;
    // requestClassId is a classification token, not a reference
    validateId(rec.requestClassId, [...path, 'requestClassId'], entityId, issues);
    validateString(rec.requestClassLabel, 1, 60, [...path, 'requestClassLabel'], entityId, issues, 'Request class label');
    if (rec.operation !== 'read' && rec.operation !== 'write') {
      issues.push({
        code: 'invalid-literal',
        path: [...path, 'operation'],
        entityId,
        severity: 'error',
        message: `ResourceCallMetadata operation must be 'read' or 'write'`,
      });
    }
    if (rec.key !== null) {
      validateString(rec.key, 1, 80, [...path, 'key'], entityId, issues, 'ResourceCallMetadata key');
    }
    if (validateArray(rec.tags, 20, [...path, 'tags'], entityId, issues, 'ResourceCallMetadata tags')) {
      const tags = rec.tags as unknown[];
      for (let i = 0; i < tags.length; i++) {
        validateString(tags[i], 0, 80, [...path, 'tags', i], entityId, issues, 'tag');
      }
    }
    validateNumber(rec.deadlineDurationMs, 0, 600000, [...path, 'deadlineDurationMs'], entityId, issues, 'deadlineDurationMs', false, true);
  }
}

function validateMachineBehavior(
  rec: Record<string, unknown>,
  path: readonly (string | number)[],
  entityId: Id | null,
  portsMap: Map<Id, { rec: Record<string, unknown>; index: number }>,
  allIds: Map<string, (string | number)[]>,
  pendingSchemaRefs: { schemaId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  pendingFixtureRefs: { fixtureId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  issues: Issue[],
): void {
  const elementId = entityId;
  const allowed = ['kind', 'version', 'states', 'initialStateId', 'contextSchemaId', 'initialContextFixtureId', 'transitions', 'responseBindings'];
  if (!checkRecord(rec, allowed, allowed, path, entityId, issues, 'machine behavior')) return;

  const statesMap = new Map<Id, Record<string, unknown>>();
  if (validateArray(rec.states, Number.MAX_SAFE_INTEGER, [...path, 'states'], elementId, issues, 'Machine states')) {
    const states = rec.states as unknown[];
    for (let sIdx = 0; sIdx < states.length; sIdx++) {
      const s = states[sIdx];
      const sPath = [...path, 'states', sIdx];
      if (checkRecord(s, ['id', 'label'], ['id', 'label'], sPath, elementId, issues, 'MachineState')) {
        let sId: Id | null = null;
        if (validateId(s.id, [...sPath, 'id'], elementId, issues)) {
          sId = s.id;
          registerId(s.id, [...sPath, 'id'], allIds, issues);
          statesMap.set(s.id, s);
        }
        validateString(s.label, 1, 80, [...sPath, 'label'], sId ?? elementId, issues, 'MachineState label');
      }
    }
  }

  // initialStateId
  if (validateId(rec.initialStateId, [...path, 'initialStateId'], elementId, issues)) {
    if (!statesMap.has(rec.initialStateId)) {
      issues.push({
        code: 'dangling-reference',
        path: [...path, 'initialStateId'],
        entityId: elementId,
        severity: 'error',
        message: `Machine initialStateId '${rec.initialStateId}' does not exist in machine states`,
      });
    }
  }

  pendingSchemaRefs.push({ schemaId: rec.contextSchemaId, path: [...path, 'contextSchemaId'], entityId: elementId });
  pendingFixtureRefs.push({ fixtureId: rec.initialContextFixtureId, path: [...path, 'initialContextFixtureId'], entityId: elementId });

  // Transitions (storage.md §6: 100 transitions/machine)
  if (validateArray(rec.transitions, 100, [...path, 'transitions'], elementId, issues, 'Machine transitions')) {
    const transitions = rec.transitions as unknown[];
    for (let tIdx = 0; tIdx < transitions.length; tIdx++) {
      const t = transitions[tIdx];
      const tPath = [...path, 'transitions', tIdx];
      if (checkRecord(t, ['id', 'fromStateId', 'eventPortId', 'guard', 'toStateId', 'effects'], ['id', 'fromStateId', 'eventPortId', 'guard', 'toStateId', 'effects'], tPath, elementId, issues, 'Transition')) {
        let tId: Id | null = null;
        if (validateId(t.id, [...tPath, 'id'], elementId, issues)) {
          tId = t.id;
          registerId(t.id, [...tPath, 'id'], allIds, issues);
        }

        if (validateId(t.fromStateId, [...tPath, 'fromStateId'], tId ?? elementId, issues)) {
          if (!statesMap.has(t.fromStateId)) {
            issues.push({
              code: 'dangling-reference',
              path: [...tPath, 'fromStateId'],
              entityId: tId ?? elementId,
              severity: 'error',
              message: `Transition fromStateId '${t.fromStateId}' does not exist in machine states`,
            });
          }
        }

        if (validateId(t.toStateId, [...tPath, 'toStateId'], tId ?? elementId, issues)) {
          if (!statesMap.has(t.toStateId)) {
            issues.push({
              code: 'dangling-reference',
              path: [...tPath, 'toStateId'],
              entityId: tId ?? elementId,
              severity: 'error',
              message: `Transition toStateId '${t.toStateId}' does not exist in machine states`,
            });
          }
        }

        if (validateId(t.eventPortId, [...tPath, 'eventPortId'], tId ?? elementId, issues)) {
          if (!portsMap.has(t.eventPortId)) {
            issues.push({
              code: 'dangling-reference',
              path: [...tPath, 'eventPortId'],
              entityId: tId ?? elementId,
              severity: 'error',
              message: `Transition eventPortId '${t.eventPortId}' does not exist on this element`,
            });
          }
        }

        if (t.guard !== null) {
          validateExpression(t.guard, [...tPath, 'guard'], tId ?? elementId, true, issues);
        }

        // Effects
        if (validateArray(t.effects, Number.MAX_SAFE_INTEGER, [...tPath, 'effects'], tId ?? elementId, issues, 'Transition effects')) {
          const effects = t.effects as unknown[];
          for (let effIdx = 0; effIdx < effects.length; effIdx++) {
            validateEffect(effects[effIdx], [...tPath, 'effects', effIdx], tId ?? elementId, portsMap, allIds, issues);
          }
        }
      }
    }
  }

  // Response bindings
  if (validateArray(rec.responseBindings, Number.MAX_SAFE_INTEGER, [...path, 'responseBindings'], elementId, issues, 'Machine responseBindings')) {
    const bindings = rec.responseBindings as unknown[];
    for (let bIdx = 0; bIdx < bindings.length; bIdx++) {
      const bnd = bindings[bIdx];
      const bPath = [...path, 'responseBindings', bIdx];
      if (checkRecord(bnd, ['id', 'callPortId', 'eventPortId'], ['id', 'callPortId', 'eventPortId'], bPath, elementId, issues, 'MachineResponseBinding')) {
        let bId: Id | null = null;
        if (validateId(bnd.id, [...bPath, 'id'], elementId, issues)) {
          bId = bnd.id;
          registerId(bnd.id, [...bPath, 'id'], allIds, issues);
        }

        if (validateId(bnd.callPortId, [...bPath, 'callPortId'], bId ?? elementId, issues)) {
          if (!portsMap.has(bnd.callPortId)) {
            issues.push({
              code: 'dangling-reference',
              path: [...bPath, 'callPortId'],
              entityId: bId ?? elementId,
              severity: 'error',
              message: `ResponseBinding callPortId '${bnd.callPortId}' does not exist on this element`,
            });
          }
        }

        if (validateId(bnd.eventPortId, [...bPath, 'eventPortId'], bId ?? elementId, issues)) {
          if (!portsMap.has(bnd.eventPortId)) {
            issues.push({
              code: 'dangling-reference',
              path: [...bPath, 'eventPortId'],
              entityId: bId ?? elementId,
              severity: 'error',
              message: `ResponseBinding eventPortId '${bnd.eventPortId}' does not exist on this element`,
            });
          }
        }
      }
    }
  }
}

function validateEffect(
  eff: unknown,
  path: readonly (string | number)[],
  parentEntityId: Id | null,
  portsMap: Map<Id, { rec: Record<string, unknown>; index: number }>,
  allIds: Map<string, (string | number)[]>,
  issues: Issue[],
): void {
  if (eff === null || typeof eff !== 'object' || Array.isArray(eff)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId: parentEntityId,
      severity: 'error',
      message: 'Effect must be an object',
    });
    return;
  }

  const rec = eff as Record<string, unknown>;
  let effId: Id | null = null;
  if (validateId(rec.id, [...path, 'id'], parentEntityId, issues)) {
    effId = rec.id;
    registerId(rec.id, [...path, 'id'], allIds, issues);
  }

  const kind = rec.kind;
  if (kind === 'assign') {
    if (checkRecord(rec, ['id', 'kind', 'path', 'value'], ['id', 'kind', 'path', 'value'], path, effId ?? parentEntityId, issues, 'assign effect')) {
      validatePath(rec.path, [...path, 'path'], effId ?? parentEntityId, issues);
      validateExpression(rec.value, [...path, 'value'], effId ?? parentEntityId, false, issues);
    }
  } else if (kind === 'request-id') {
    if (checkRecord(rec, ['id', 'kind', 'path'], ['id', 'kind', 'path'], path, effId ?? parentEntityId, issues, 'request-id effect')) {
      validatePath(rec.path, [...path, 'path'], effId ?? parentEntityId, issues);
    }
  } else if (kind === 'emit') {
    if (checkRecord(rec, ['id', 'kind', 'portId', 'value', 'correlation'], ['id', 'kind', 'portId', 'value', 'correlation'], path, effId ?? parentEntityId, issues, 'emit effect')) {
      if (validateId(rec.portId, [...path, 'portId'], effId ?? parentEntityId, issues)) {
        if (!portsMap.has(rec.portId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...path, 'portId'],
            entityId: effId ?? parentEntityId,
            severity: 'error',
            message: `Emit effect portId '${rec.portId}' does not exist on this element`,
          });
        }
      }
      validateExpression(rec.value, [...path, 'value'], effId ?? parentEntityId, false, issues);
      validateEmitCorrelation(rec.correlation, [...path, 'correlation'], effId ?? parentEntityId, issues);
    }
  } else if (kind === 'reply') {
    if (checkRecord(rec, ['id', 'kind', 'value', 'outcome'], ['id', 'kind', 'value', 'outcome'], path, effId ?? parentEntityId, issues, 'reply effect')) {
      validateExpression(rec.value, [...path, 'value'], effId ?? parentEntityId, false, issues);
      if (typeof rec.outcome !== 'string' || !TRANSPORT_OUTCOMES.includes(rec.outcome as (typeof TRANSPORT_OUTCOMES)[number])) {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'outcome'],
          entityId: effId ?? parentEntityId,
          severity: 'error',
          message: `Invalid reply outcome: '${String(rec.outcome)}'`,
        });
      }
    }
  } else if (kind === 'schedule-event') {
    if (checkRecord(rec, ['id', 'kind', 'delayMs', 'eventPortId', 'value'], ['id', 'kind', 'delayMs', 'eventPortId', 'value'], path, effId ?? parentEntityId, issues, 'schedule-event effect')) {
      validateNumber(rec.delayMs, 0, 600000, [...path, 'delayMs'], effId ?? parentEntityId, issues, 'delayMs');
      if (validateId(rec.eventPortId, [...path, 'eventPortId'], effId ?? parentEntityId, issues)) {
        if (!portsMap.has(rec.eventPortId)) {
          issues.push({
            code: 'dangling-reference',
            path: [...path, 'eventPortId'],
            entityId: effId ?? parentEntityId,
            severity: 'error',
            message: `Schedule-event effect eventPortId '${rec.eventPortId}' does not exist on this element`,
          });
        }
      }
      validateExpression(rec.value, [...path, 'value'], effId ?? parentEntityId, false, issues);
    }
  } else if (kind === 'trace') {
    if (checkRecord(rec, ['id', 'kind', 'code'], ['id', 'kind', 'code'], path, effId ?? parentEntityId, issues, 'trace effect')) {
      validateString(rec.code, 1, 80, [...path, 'code'], effId ?? parentEntityId, issues, 'Trace code');
    }
  } else {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'kind'],
      entityId: effId ?? parentEntityId,
      severity: 'error',
      message: `Unknown effect kind: '${String(kind)}'`,
    });
  }
}

function validateEmitCorrelation(
  corr: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
): void {
  if (corr === null || typeof corr !== 'object' || Array.isArray(corr)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId,
      severity: 'error',
      message: 'Emit correlation must be an object',
    });
    return;
  }

  const rec = corr as Record<string, unknown>;
  if (rec.kind === 'current') {
    checkRecord(rec, ['kind'], ['kind'], path, entityId, issues, 'current correlation');
  } else if (rec.kind === 'context-request') {
    if (checkRecord(rec, ['kind', 'path'], ['kind', 'path'], path, entityId, issues, 'context-request correlation')) {
      validatePath(rec.path, [...path, 'path'], entityId, issues);
    }
  } else {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'kind'],
      entityId,
      severity: 'error',
      message: `Unknown emit correlation kind: '${String(rec.kind)}'`,
    });
  }
}

function validatePipelineBehavior(
  rec: Record<string, unknown>,
  path: readonly (string | number)[],
  entityId: Id | null,
  portsMap: Map<Id, { rec: Record<string, unknown>; index: number }>,
  allIds: Map<string, (string | number)[]>,
  pendingSchemaRefs: { schemaId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  issues: Issue[],
): void {
  const elementId = entityId;
  const allowed = ['kind', 'version', 'inputSchemaId', 'outputSchemaId', 'errorSchemaId', 'inputPortId', 'outputPortId', 'errorPortId', 'operations'];
  if (!checkRecord(rec, allowed, allowed, path, entityId, issues, 'pipeline behavior')) return;

  pendingSchemaRefs.push({ schemaId: rec.inputSchemaId, path: [...path, 'inputSchemaId'], entityId: elementId });
  pendingSchemaRefs.push({ schemaId: rec.outputSchemaId, path: [...path, 'outputSchemaId'], entityId: elementId });
  pendingSchemaRefs.push({ schemaId: rec.errorSchemaId, path: [...path, 'errorSchemaId'], entityId: elementId });

  for (const portField of ['inputPortId', 'outputPortId', 'errorPortId'] as const) {
    if (validateId(rec[portField], [...path, portField], elementId, issues)) {
      if (!portsMap.has(rec[portField] as string)) {
        issues.push({
          code: 'dangling-reference',
          path: [...path, portField],
          entityId: elementId,
          severity: 'error',
          message: `Pipeline ${portField} '${rec[portField]}' does not exist on this element`,
        });
      }
    }
  }

  // Operations (storage.md §6: 100 operations/pipeline)
  if (validateArray(rec.operations, 100, [...path, 'operations'], elementId, issues, 'Pipeline operations')) {
    const ops = rec.operations as unknown[];
    for (let opIdx = 0; opIdx < ops.length; opIdx++) {
      validateOperation(ops[opIdx], [...path, 'operations', opIdx], elementId, allIds, pendingSchemaRefs, issues);
    }
  }
}

function validateOperation(
  op: unknown,
  path: readonly (string | number)[],
  elementId: Id | null,
  allIds: Map<string, (string | number)[]>,
  pendingSchemaRefs: { schemaId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  issues: Issue[],
): void {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId: elementId,
      severity: 'error',
      message: 'Operation must be an object',
    });
    return;
  }

  const rec = op as Record<string, unknown>;
  let opId: Id | null = null;
  if (validateId(rec.id, [...path, 'id'], elementId, issues)) {
    opId = rec.id;
    registerId(rec.id, [...path, 'id'], allIds, issues);
  }

  const kind = rec.kind;
  if (typeof kind !== 'string' || !OPERATION_KINDS.includes(kind as (typeof OPERATION_KINDS)[number])) {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'kind'],
      entityId: opId ?? elementId,
      severity: 'error',
      message: `Invalid operation kind: '${String(kind)}'`,
    });
    return;
  }

  if (kind === 'validate') {
    if (checkRecord(rec, ['id', 'kind', 'schemaId'], ['id', 'kind', 'schemaId'], path, opId ?? elementId, issues, 'validate operation')) {
      pendingSchemaRefs.push({ schemaId: rec.schemaId, path: [...path, 'schemaId'], entityId: opId ?? elementId });
    }
  } else if (kind === 'trim' || kind === 'deduplicate') {
    if (checkRecord(rec, ['id', 'kind', 'path'], ['id', 'kind', 'path'], path, opId ?? elementId, issues, `${kind} operation`)) {
      validatePath(rec.path, [...path, 'path'], opId ?? elementId, issues);
    }
  } else if (kind === 'filter') {
    if (checkRecord(rec, ['id', 'kind', 'guard'], ['id', 'kind', 'guard'], path, opId ?? elementId, issues, 'filter operation')) {
      validateExpression(rec.guard, [...path, 'guard'], opId ?? elementId, true, issues);
    }
  } else if (kind === 'group-sum') {
    const allowed = ['id', 'kind', 'keyPath', 'valuePath', 'keyName', 'sumName'];
    if (checkRecord(rec, allowed, allowed, path, opId ?? elementId, issues, 'group-sum operation')) {
      validatePath(rec.keyPath, [...path, 'keyPath'], opId ?? elementId, issues);
      validatePath(rec.valuePath, [...path, 'valuePath'], opId ?? elementId, issues);
      validateString(rec.keyName, 1, 80, [...path, 'keyName'], opId ?? elementId, issues, 'group-sum keyName');
      validateString(rec.sumName, 1, 80, [...path, 'sumName'], opId ?? elementId, issues, 'group-sum sumName');
    }
  } else if (kind === 'map') {
    if (checkRecord(rec, ['id', 'kind', 'fields'], ['id', 'kind', 'fields'], path, opId ?? elementId, issues, 'map operation')) {
      if (validateArray(rec.fields, Number.MAX_SAFE_INTEGER, [...path, 'fields'], opId ?? elementId, issues, 'map operation fields')) {
        const fields = rec.fields as unknown[];
        const targetKeys = new Set<string>();

        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          const fPath = [...path, 'fields', i];
          if (checkRecord(f, ['id', 'targetKey', 'value'], ['id', 'targetKey', 'value'], fPath, opId ?? elementId, issues, 'MapOperationField')) {
            let fId: Id | null = null;
            if (validateId(f.id, [...fPath, 'id'], opId ?? elementId, issues)) {
              fId = f.id;
              registerId(f.id, [...fPath, 'id'], allIds, issues);
            }
            if (typeof f.targetKey === 'string') {
              if (PROTOTYPE_KEYS.has(f.targetKey)) {
                issues.push({
                  code: 'prototype-key',
                  path: [...fPath, 'targetKey'],
                  entityId: fId ?? opId ?? elementId,
                  severity: 'error',
                  message: `Disallowed prototype key in MapOperationField: ${f.targetKey}`,
                });
              } else if (validateString(f.targetKey, 1, 80, [...fPath, 'targetKey'], fId ?? opId ?? elementId, issues, 'targetKey')) {
                if (targetKeys.has(f.targetKey)) {
                  issues.push({
                    code: 'duplicate-key',
                    path: [...fPath, 'targetKey'],
                    entityId: fId ?? opId ?? elementId,
                    severity: 'error',
                    message: `Duplicate targetKey '${f.targetKey}' in map operation`,
                  });
                } else {
                  targetKeys.add(f.targetKey);
                }
              }
            } else {
              issues.push({
                code: 'wrong-type',
                path: [...fPath, 'targetKey'],
                entityId: fId ?? opId ?? elementId,
                severity: 'error',
                message: 'MapOperationField targetKey must be a string',
              });
            }
            validateExpression(f.value, [...fPath, 'value'], fId ?? opId ?? elementId, false, issues);
          }
        }
      }
    }
  }
}

function validateDecisionBehavior(
  rec: Record<string, unknown>,
  path: readonly (string | number)[],
  entityId: Id | null,
  portsMap: Map<Id, { rec: Record<string, unknown>; index: number }>,
  allIds: Map<string, (string | number)[]>,
  pendingSchemaRefs: { schemaId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  issues: Issue[],
): void {
  const elementId = entityId;
  const allowed = ['kind', 'version', 'inputSchemaId', 'inputPortId', 'cases', 'fallback'];
  if (!checkRecord(rec, allowed, allowed, path, entityId, issues, 'decision behavior')) return;

  pendingSchemaRefs.push({ schemaId: rec.inputSchemaId, path: [...path, 'inputSchemaId'], entityId: elementId });

  if (validateId(rec.inputPortId, [...path, 'inputPortId'], elementId, issues)) {
    if (!portsMap.has(rec.inputPortId)) {
      issues.push({
        code: 'dangling-reference',
        path: [...path, 'inputPortId'],
        entityId: elementId,
        severity: 'error',
        message: `Decision inputPortId '${rec.inputPortId}' does not exist on this element`,
      });
    }
  }

  // Cases
  if (validateArray(rec.cases, Number.MAX_SAFE_INTEGER, [...path, 'cases'], elementId, issues, 'Decision cases')) {
    const cases = rec.cases as unknown[];
    for (let cIdx = 0; cIdx < cases.length; cIdx++) {
      const c = cases[cIdx];
      const cPath = [...path, 'cases', cIdx];
      if (checkRecord(c, ['id', 'guard', 'outputPortId', 'value'], ['id', 'guard', 'outputPortId', 'value'], cPath, elementId, issues, 'DecisionCase')) {
        let cId: Id | null = null;
        if (validateId(c.id, [...cPath, 'id'], elementId, issues)) {
          cId = c.id;
          registerId(c.id, [...cPath, 'id'], allIds, issues);
        }
        validateExpression(c.guard, [...cPath, 'guard'], cId ?? elementId, true, issues);
        if (validateId(c.outputPortId, [...cPath, 'outputPortId'], cId ?? elementId, issues)) {
          if (!portsMap.has(c.outputPortId)) {
            issues.push({
              code: 'dangling-reference',
              path: [...cPath, 'outputPortId'],
              entityId: cId ?? elementId,
              severity: 'error',
              message: `Decision case outputPortId '${c.outputPortId}' does not exist on this element`,
            });
          }
        }
        validateExpression(c.value, [...cPath, 'value'], cId ?? elementId, false, issues);
      }
    }
  }

  // Fallback
  if (checkRecord(rec.fallback, ['outputPortId', 'value'], ['outputPortId', 'value'], [...path, 'fallback'], elementId, issues, 'Decision fallback')) {
    const fb = rec.fallback as Record<string, unknown>;
    if (validateId(fb.outputPortId, [...path, 'fallback', 'outputPortId'], elementId, issues)) {
      if (!portsMap.has(fb.outputPortId)) {
        issues.push({
          code: 'dangling-reference',
          path: [...path, 'fallback', 'outputPortId'],
          entityId: elementId,
          severity: 'error',
          message: `Decision fallback outputPortId '${fb.outputPortId}' does not exist on this element`,
        });
      }
    }
    validateExpression(fb.value, [...path, 'fallback', 'value'], elementId, false, issues);
  }
}

function validateScenario(
  s: unknown,
  sPath: readonly (string | number)[],
  allIds: Map<string, (string | number)[]>,
  pendingEndpoints: { endpoint: Record<string, unknown>; path: readonly (string | number)[]; entityId: Id | null }[],
  pendingSchemaRefs: { schemaId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  pendingFixtureRefs: { fixtureId: unknown; path: readonly (string | number)[]; entityId: Id | null }[],
  issues: Issue[],
): void {
  const allowed = [
    'id', 'label', 'revision', 'mode', 'scopeElementIds', 'entryPorts',
    'inputs', 'workloads', 'faults', 'boundaries', 'refinementSelections',
    'initialContexts', 'assertions', 'seed', 'budgets', 'completion', 'assumptions',
  ];

  if (!checkRecord(s, allowed, allowed, sPath, null, issues, 'Scenario')) return;
  const rec = s as Record<string, unknown>;

  let sId: Id | null = null;
  if (validateId(rec.id, [...sPath, 'id'], null, issues)) {
    sId = rec.id;
    registerId(rec.id, [...sPath, 'id'], allIds, issues);
  }

  validateString(rec.label, 1, 80, [...sPath, 'label'], sId, issues, 'Scenario label');
  validateNumber(rec.revision, 0, Number.MAX_SAFE_INTEGER, [...sPath, 'revision'], sId, issues, 'Scenario revision', true);
  validateNumber(rec.seed, 0, 4294967295, [...sPath, 'seed'], sId, issues, 'Scenario seed', true);

  const mode = rec.mode;
  if (mode !== 'logical' && mode !== 'timed') {
    issues.push({
      code: 'invalid-literal',
      path: [...sPath, 'mode'],
      entityId: sId,
      severity: 'error',
      message: `Scenario mode must be 'logical' or 'timed'`,
    });
  }

  // ScopeElementIds
  if (validateArray(rec.scopeElementIds, Number.MAX_SAFE_INTEGER, [...sPath, 'scopeElementIds'], sId, issues, 'Scenario scopeElementIds')) {
    const scopeIds = rec.scopeElementIds as unknown[];
    for (let i = 0; i < scopeIds.length; i++) {
      validateId(scopeIds[i], [...sPath, 'scopeElementIds', i], sId, issues);
    }
  }

  // EntryPorts
  if (validateArray(rec.entryPorts, Number.MAX_SAFE_INTEGER, [...sPath, 'entryPorts'], sId, issues, 'Scenario entryPorts')) {
    const entries = rec.entryPorts as unknown[];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const ePath = [...sPath, 'entryPorts', i];
      if (checkRecord(e, ['elementId', 'portId'], ['elementId', 'portId'], ePath, sId, issues, 'Scenario entryPort')) {
        pendingEndpoints.push({ endpoint: e as Record<string, unknown>, path: ePath, entityId: sId });
      }
    }
  }

  // Inputs collector for afterInputId resolution within this scenario
  const scenarioInputIds = new Set<Id>();

  // Inputs (storage.md §6: 1,000 inputs)
  if (validateArray(rec.inputs, 1000, [...sPath, 'inputs'], sId, issues, 'Scenario inputs')) {
    const inputs = rec.inputs as unknown[];
    for (let iIdx = 0; iIdx < inputs.length; iIdx++) {
      const inp = inputs[iIdx];
      const iPath = [...sPath, 'inputs', iIdx];
      if (checkRecord(inp, ['id', 'entry', 'fixtureId', 'journeyId', 'atMs', 'payloadBindings', 'resource'], ['id', 'entry', 'fixtureId', 'journeyId', 'atMs', 'payloadBindings', 'resource'], iPath, sId, issues, 'Scenario Input')) {
        let inpId: Id | null = null;
        if (validateId(inp.id, [...iPath, 'id'], sId, issues)) {
          inpId = inp.id;
          scenarioInputIds.add(inp.id);
          registerId(inp.id, [...iPath, 'id'], allIds, issues);
        }

        if (checkRecord(inp.entry, ['elementId', 'portId'], ['elementId', 'portId'], [...iPath, 'entry'], inpId ?? sId, issues, 'Input entry')) {
          pendingEndpoints.push({ endpoint: inp.entry as Record<string, unknown>, path: [...iPath, 'entry'], entityId: inpId ?? sId });
        }

        pendingFixtureRefs.push({ fixtureId: inp.fixtureId, path: [...iPath, 'fixtureId'], entityId: inpId ?? sId });
        validateId(inp.journeyId, [...iPath, 'journeyId'], inpId ?? sId, issues);

        // D32: mode coherence (atMs null vs number by scenario mode) is a readiness rule
        // (readiness.ts), not storable. The storable check is per-field only: atMs is
        // either null or a finite number >= 0.
        if (inp.atMs !== null) {
          validateNumber(inp.atMs, 0, Number.MAX_SAFE_INTEGER, [...iPath, 'atMs'], inpId ?? sId, issues, 'input atMs');
        }

        // PayloadBindings
        if (validateArray(inp.payloadBindings, Number.MAX_SAFE_INTEGER, [...iPath, 'payloadBindings'], inpId ?? sId, issues, 'Input payloadBindings')) {
          const bindings = inp.payloadBindings as unknown[];
          for (let bIdx = 0; bIdx < bindings.length; bIdx++) {
            const b = bindings[bIdx];
            const bPath = [...iPath, 'payloadBindings', bIdx];
            if (checkRecord(b, ['targetPath', 'source'], ['targetPath', 'source'], bPath, inpId ?? sId, issues, 'InputBinding')) {
              validatePath(b.targetPath, [...bPath, 'targetPath'], inpId ?? sId, issues);
              if (checkRecord(b.source, ['port', 'journeyId', 'occurrence', 'path'], ['port', 'journeyId', 'occurrence', 'path'], [...bPath, 'source'], inpId ?? sId, issues, 'InputBindingSource')) {
                if (checkRecord(b.source.port, ['elementId', 'portId'], ['elementId', 'portId'], [...bPath, 'source', 'port'], inpId ?? sId, issues, 'InputBinding source port')) {
                  pendingEndpoints.push({ endpoint: b.source.port as Record<string, unknown>, path: [...bPath, 'source', 'port'], entityId: inpId ?? sId });
                }
                validateId(b.source.journeyId, [...bPath, 'source', 'journeyId'], inpId ?? sId, issues);
                validateNumber(b.source.occurrence, 0, Number.MAX_SAFE_INTEGER, [...bPath, 'source', 'occurrence'], inpId ?? sId, issues, 'occurrence', true);
                validatePath(b.source.path, [...bPath, 'source', 'path'], inpId ?? sId, issues);
              }
            }
          }
        }

        // Resource metadata
        validateResourceMetadata(inp.resource, [...iPath, 'resource'], inpId ?? sId, issues);
      }
    }
  }

  // Workloads (storage.md §6: 20 workloads)
  if (validateArray(rec.workloads, 20, [...sPath, 'workloads'], sId, issues, 'Scenario workloads')) {
    const workloads = rec.workloads as unknown[];
    for (let wIdx = 0; wIdx < workloads.length; wIdx++) {
      validateWorkload(workloads[wIdx], [...sPath, 'workloads', wIdx], sId, allIds, pendingEndpoints, issues);
    }
  }

  // Faults (storage.md §6: 100 faults)
  if (validateArray(rec.faults, 100, [...sPath, 'faults'], sId, issues, 'Scenario faults')) {
    const faults = rec.faults as unknown[];
    const hostIntervals = new Map<Id, { down: number; up: number; fIdx: number }[]>();

    for (let fIdx = 0; fIdx < faults.length; fIdx++) {
      const f = faults[fIdx];
      const fPath = [...sPath, 'faults', fIdx];
      const allowedF = ['id', 'hostId', 'downAtMs', 'upAtMs', 'detectionDelayMs', 'recoveryDetectionDelayMs', 'activePolicy', 'queuedPolicy', 'routeReset'];
      if (checkRecord(f, allowedF, allowedF, fPath, sId, issues, 'Fault')) {
        let fId: Id | null = null;
        if (validateId(f.id, [...fPath, 'id'], sId, issues)) {
          fId = f.id;
          registerId(f.id, [...fPath, 'id'], allIds, issues);
        }

        validateId(f.hostId, [...fPath, 'hostId'], fId ?? sId, issues);
        validateNumber(f.downAtMs, 0, Number.MAX_SAFE_INTEGER, [...fPath, 'downAtMs'], fId ?? sId, issues, 'downAtMs');
        validateNumber(f.upAtMs, 0, Number.MAX_SAFE_INTEGER, [...fPath, 'upAtMs'], fId ?? sId, issues, 'upAtMs');
        validateNumber(f.detectionDelayMs, 0, 600000, [...fPath, 'detectionDelayMs'], fId ?? sId, issues, 'detectionDelayMs');
        validateNumber(f.recoveryDetectionDelayMs, 0, 600000, [...fPath, 'recoveryDetectionDelayMs'], fId ?? sId, issues, 'recoveryDetectionDelayMs');

        if (typeof f.downAtMs === 'number' && typeof f.upAtMs === 'number') {
          if (f.upAtMs <= f.downAtMs) {
            issues.push({
              code: 'structural-rule',
              path: [...fPath, 'upAtMs'],
              entityId: fId ?? sId,
              severity: 'error',
              message: `Fault upAtMs must be strictly greater than downAtMs`,
            });
          } else if (typeof f.hostId === 'string') {
            const intervals = hostIntervals.get(f.hostId) ?? [];
            for (const existing of intervals) {
              if (Math.max(f.downAtMs, existing.down) < Math.min(f.upAtMs, existing.up)) {
                issues.push({
                  code: 'structural-rule',
                  path: fPath,
                  entityId: fId ?? sId,
                  severity: 'error',
                  message: `Overlapping fault intervals on host '${f.hostId}'`,
                });
                break;
              }
            }
            intervals.push({ down: f.downAtMs, up: f.upAtMs, fIdx });
            hostIntervals.set(f.hostId, intervals);
          }
        }

        if (f.activePolicy !== 'fail') {
          issues.push({
            code: 'invalid-literal',
            path: [...fPath, 'activePolicy'],
            entityId: fId ?? sId,
            severity: 'error',
            message: `Fault activePolicy must be 'fail'`,
          });
        }
        if (f.queuedPolicy !== 'reject') {
          issues.push({
            code: 'invalid-literal',
            path: [...fPath, 'queuedPolicy'],
            entityId: fId ?? sId,
            severity: 'error',
            message: `Fault queuedPolicy must be 'reject'`,
          });
        }
        if (f.routeReset !== 'first-healthy') {
          issues.push({
            code: 'invalid-literal',
            path: [...fPath, 'routeReset'],
            entityId: fId ?? sId,
            severity: 'error',
            message: `Fault routeReset must be 'first-healthy'`,
          });
        }
      }
    }
  }

  // Boundaries (storage.md §6: 100 boundaries)
  if (validateArray(rec.boundaries, 100, [...sPath, 'boundaries'], sId, issues, 'Scenario boundaries')) {
    const boundaries = rec.boundaries as unknown[];
    for (let bIdx = 0; bIdx < boundaries.length; bIdx++) {
      const b = boundaries[bIdx];
      const bPath = [...sPath, 'boundaries', bIdx];
      if (checkRecord(b, ['id', 'source', 'schemaId', 'responses'], ['id', 'source', 'schemaId', 'responses'], bPath, sId, issues, 'Boundary')) {
        let bId: Id | null = null;
        if (validateId(b.id, [...bPath, 'id'], sId, issues)) {
          bId = b.id;
          registerId(b.id, [...bPath, 'id'], allIds, issues);
        }

        if (checkRecord(b.source, ['elementId', 'portId'], ['elementId', 'portId'], [...bPath, 'source'], bId ?? sId, issues, 'Boundary source')) {
          pendingEndpoints.push({ endpoint: b.source as Record<string, unknown>, path: [...bPath, 'source'], entityId: bId ?? sId });
        }

        pendingSchemaRefs.push({ schemaId: b.schemaId, path: [...bPath, 'schemaId'], entityId: bId ?? sId });

        if (validateArray(b.responses, 100, [...bPath, 'responses'], bId ?? sId, issues, 'Boundary responses')) {
          const responses = b.responses as unknown[];
          for (let rIdx = 0; rIdx < responses.length; rIdx++) {
            const r = responses[rIdx];
            const rPath = [...bPath, 'responses', rIdx];
            const allowedR = ['id', 'match', 'responseFixtureId', 'payloadBindings', 'delayMs', 'afterInputId', 'outcome', 'repeat'];
            const requiredR = allowedR.filter((k) => k !== 'repeat');
            if (checkRecord(r, allowedR, requiredR, rPath, bId ?? sId, issues, 'BoundaryResponse')) {
              if (r.repeat !== undefined) validateBoolean(r.repeat, [...rPath, 'repeat'], bId ?? sId, issues, 'repeat');
              let rId: Id | null = null;
              if (validateId(r.id, [...rPath, 'id'], bId ?? sId, issues)) {
                rId = r.id;
                registerId(r.id, [...rPath, 'id'], allIds, issues);
              }

              validateExpression(r.match, [...rPath, 'match'], rId ?? bId ?? sId, true, issues);
              pendingFixtureRefs.push({ fixtureId: r.responseFixtureId, path: [...rPath, 'responseFixtureId'], entityId: rId ?? bId ?? sId });

              if (validateArray(r.payloadBindings, Number.MAX_SAFE_INTEGER, [...rPath, 'payloadBindings'], rId ?? bId ?? sId, issues, 'Boundary payloadBindings')) {
                const pbs = r.payloadBindings as unknown[];
                for (let pbIdx = 0; pbIdx < pbs.length; pbIdx++) {
                  const pb = pbs[pbIdx];
                  const pbPath = [...rPath, 'payloadBindings', pbIdx];
                  if (checkRecord(pb, ['targetPath', 'requestPath'], ['targetPath', 'requestPath'], pbPath, rId ?? bId ?? sId, issues, 'BoundaryPayloadBinding')) {
                    validatePath(pb.targetPath, [...pbPath, 'targetPath'], rId ?? bId ?? sId, issues);
                    validatePath(pb.requestPath, [...pbPath, 'requestPath'], rId ?? bId ?? sId, issues);
                  }
                }
              }

              // D32: mode coherence (delayMs/afterInputId vs scenario mode) is a readiness
              // rule (readiness.ts), not storable. The storable checks are per-field only:
              // delayMs is null or 0-600000ms; afterInputId, if present, must reference an
              // input in this scenario.
              if (r.delayMs !== null) {
                validateNumber(r.delayMs, 0, 600000, [...rPath, 'delayMs'], rId ?? bId ?? sId, issues, 'delayMs');
              }
              if (r.afterInputId !== null) {
                if (validateId(r.afterInputId, [...rPath, 'afterInputId'], rId ?? bId ?? sId, issues)) {
                  if (!scenarioInputIds.has(r.afterInputId)) {
                    issues.push({
                      code: 'dangling-reference',
                      path: [...rPath, 'afterInputId'],
                      entityId: rId ?? bId ?? sId,
                      severity: 'error',
                      message: `Boundary response afterInputId '${r.afterInputId}' does not exist in this scenario`,
                    });
                  }
                }
              }

              if (typeof r.outcome !== 'string' || !TRANSPORT_OUTCOMES.includes(r.outcome as (typeof TRANSPORT_OUTCOMES)[number])) {
                issues.push({
                  code: 'invalid-literal',
                  path: [...rPath, 'outcome'],
                  entityId: rId ?? bId ?? sId,
                  severity: 'error',
                  message: `Invalid boundary response outcome: '${String(r.outcome)}'`,
                });
              }
            }
          }
        }
      }
    }
  }

  // RefinementSelections
  if (validateArray(rec.refinementSelections, Number.MAX_SAFE_INTEGER, [...sPath, 'refinementSelections'], sId, issues, 'Scenario refinementSelections')) {
    const sels = rec.refinementSelections as unknown[];
    for (let i = 0; i < sels.length; i++) {
      const sel = sels[i];
      const selPath = [...sPath, 'refinementSelections', i];
      if (checkRecord(sel, ['refinementId', 'mode'], ['refinementId', 'mode'], selPath, sId, issues, 'Selection')) {
        validateId(sel.refinementId, [...selPath, 'refinementId'], sId, issues);
        if (sel.mode !== 'aggregate' && sel.mode !== 'refined') {
          issues.push({
            code: 'invalid-literal',
            path: [...selPath, 'mode'],
            entityId: sId,
            severity: 'error',
            message: `Selection mode must be 'aggregate' or 'refined'`,
          });
        }
      }
    }
  }

  // InitialContexts
  if (validateArray(rec.initialContexts, Number.MAX_SAFE_INTEGER, [...sPath, 'initialContexts'], sId, issues, 'Scenario initialContexts')) {
    const ics = rec.initialContexts as unknown[];
    for (let i = 0; i < ics.length; i++) {
      const ic = ics[i];
      const icPath = [...sPath, 'initialContexts', i];
      if (checkRecord(ic, ['elementId', 'fixtureId'], ['elementId', 'fixtureId'], icPath, sId, issues, 'InitialContext')) {
        validateId(ic.elementId, [...icPath, 'elementId'], sId, issues);
        pendingFixtureRefs.push({ fixtureId: ic.fixtureId, path: [...icPath, 'fixtureId'], entityId: sId });
      }
    }
  }

  // Assertions (storage.md §6: 100 assertions)
  if (validateArray(rec.assertions, 100, [...sPath, 'assertions'], sId, issues, 'Scenario assertions')) {
    const assertions = rec.assertions as unknown[];
    for (let aIdx = 0; aIdx < assertions.length; aIdx++) {
      const a = assertions[aIdx];
      const aPath = [...sPath, 'assertions', aIdx];
      if (checkRecord(a, ['id', 'label', 'subject', 'operator', 'expected'], ['id', 'label', 'subject', 'operator', 'expected'], aPath, sId, issues, 'Assertion')) {
        let aId: Id | null = null;
        if (validateId(a.id, [...aPath, 'id'], sId, issues)) {
          aId = a.id;
          registerId(a.id, [...aPath, 'id'], allIds, issues);
        }
        validateString(a.label, 1, 80, [...aPath, 'label'], aId ?? sId, issues, 'Assertion label');
        if (typeof a.operator !== 'string' || !ASSERTION_OPERATORS.includes(a.operator as (typeof ASSERTION_OPERATORS)[number])) {
          issues.push({
            code: 'invalid-literal',
            path: [...aPath, 'operator'],
            entityId: aId ?? sId,
            severity: 'error',
            message: `Invalid assertion operator: '${String(a.operator)}'`,
          });
        }
        validateJsonValue(a.expected, [...aPath, 'expected'], aId ?? sId, issues);
        validateAssertionSubject(a.subject, [...aPath, 'subject'], aId ?? sId, pendingEndpoints, issues);
      }
    }
  }

  // Budgets (storage.md §6: events 1M, trace rows 100k, trace bytes 16 MiB, scheduled events 100k, live roots 10k)
  validateScenarioBudgets(rec.budgets, [...sPath, 'budgets'], sId, issues);

  // Completion
  validateCompletionPolicy(rec.completion, [...sPath, 'completion'], sId, issues);

  // Assumptions
  if (validateArray(rec.assumptions, Number.MAX_SAFE_INTEGER, [...sPath, 'assumptions'], sId, issues, 'Scenario assumptions')) {
    const assumptions = rec.assumptions as unknown[];
    const assumptionKeys = new Set<string>();

    for (let aIdx = 0; aIdx < assumptions.length; aIdx++) {
      const asm = assumptions[aIdx];
      const aPath = [...sPath, 'assumptions', aIdx];
      if (checkRecord(asm, ['id', 'key', 'value', 'source', 'description'], ['id', 'key', 'value', 'source', 'description'], aPath, sId, issues, 'Assumption')) {
        let asmId: Id | null = null;
        if (validateId(asm.id, [...aPath, 'id'], sId, issues)) {
          asmId = asm.id;
          registerId(asm.id, [...aPath, 'id'], allIds, issues);
        }
        if (typeof asm.key === 'string') {
          if (PROTOTYPE_KEYS.has(asm.key)) {
            issues.push({
              code: 'prototype-key',
              path: [...aPath, 'key'],
              entityId: asmId ?? sId,
              severity: 'error',
              message: `Disallowed prototype key in assumption: ${asm.key}`,
            });
          } else if (validateString(asm.key, 1, 80, [...aPath, 'key'], asmId ?? sId, issues, 'Assumption key')) {
            if (assumptionKeys.has(asm.key)) {
              issues.push({
                code: 'duplicate-key',
                path: [...aPath, 'key'],
                entityId: asmId ?? sId,
                severity: 'error',
                message: `Duplicate assumption key '${asm.key}' in scenario`,
              });
            } else {
              assumptionKeys.add(asm.key);
            }
          }
        } else {
          issues.push({
            code: 'wrong-type',
            path: [...aPath, 'key'],
            entityId: asmId ?? sId,
            severity: 'error',
            message: 'Assumption key must be a string',
          });
        }
        validateJsonValue(asm.value, [...aPath, 'value'], asmId ?? sId, issues);
        if (typeof asm.source !== 'string' || !ASSUMPTION_SOURCES.includes(asm.source as (typeof ASSUMPTION_SOURCES)[number])) {
          issues.push({
            code: 'invalid-literal',
            path: [...aPath, 'source'],
            entityId: asmId ?? sId,
            severity: 'error',
            message: `Invalid assumption source: '${String(asm.source)}'`,
          });
        }
        validateString(asm.description, 0, 4000, [...aPath, 'description'], asmId ?? sId, issues, 'Assumption description');
      }
    }
  }
}

function validateResourceMetadata(
  res: unknown,
  path: readonly (string | number)[],
  entityId: Id | null,
  issues: Issue[],
): void {
  if (res === null) return;
  if (checkRecord(res, ['requestClassId', 'operation', 'key', 'tags', 'deadlineMs'], ['requestClassId', 'operation', 'key', 'tags', 'deadlineMs'], path, entityId, issues, 'ResourceMetadata')) {
    const rec = res as Record<string, unknown>;
    // requestClassId is a classification token, not a reference
    validateId(rec.requestClassId, [...path, 'requestClassId'], entityId, issues);
    if (rec.operation !== 'read' && rec.operation !== 'write') {
      issues.push({
        code: 'invalid-literal',
        path: [...path, 'operation'],
        entityId,
        severity: 'error',
        message: `ResourceMetadata operation must be 'read' or 'write'`,
      });
    }
    if (rec.key !== null) {
      validateString(rec.key, 1, 80, [...path, 'key'], entityId, issues, 'ResourceMetadata key');
    }
    if (validateArray(rec.tags, 20, [...path, 'tags'], entityId, issues, 'ResourceMetadata tags')) {
      const tags = rec.tags as unknown[];
      for (let i = 0; i < tags.length; i++) {
        validateString(tags[i], 0, 80, [...path, 'tags', i], entityId, issues, 'tag');
      }
    }
    validateNumber(rec.deadlineMs, 0, Number.MAX_SAFE_INTEGER, [...path, 'deadlineMs'], entityId, issues, 'deadlineMs');
  }
}

function validateWorkload(
  w: unknown,
  path: readonly (string | number)[],
  scenarioId: Id | null,
  allIds: Map<string, (string | number)[]>,
  pendingEndpoints: { endpoint: Record<string, unknown>; path: readonly (string | number)[]; entityId: Id | null }[],
  issues: Issue[],
): void {
  const allowed = ['id', 'entry', 'enabled', 'rate', 'profile', 'timeoutMs', 'intervalMs', 'classes'];
  if (!checkRecord(w, allowed, allowed, path, scenarioId, issues, 'Workload')) return;

  const rec = w as Record<string, unknown>;
  let wId: Id | null = null;
  if (validateId(rec.id, [...path, 'id'], scenarioId, issues)) {
    wId = rec.id;
    registerId(rec.id, [...path, 'id'], allIds, issues);
  }

  if (checkRecord(rec.entry, ['elementId', 'portId'], ['elementId', 'portId'], [...path, 'entry'], wId ?? scenarioId, issues, 'Workload entry')) {
    pendingEndpoints.push({ endpoint: rec.entry as Record<string, unknown>, path: [...path, 'entry'], entityId: wId ?? scenarioId });
  }

  validateBoolean(rec.enabled, [...path, 'enabled'], wId ?? scenarioId, issues, 'Workload enabled');
  validateNumber(rec.rate, 0, 10000, [...path, 'rate'], wId ?? scenarioId, issues, 'Workload rate', false, true);

  validateWorkloadProfile(rec.profile, [...path, 'profile'], wId ?? scenarioId, issues);

  validateNumber(rec.timeoutMs, 1, 3600000, [...path, 'timeoutMs'], wId ?? scenarioId, issues, 'Workload timeoutMs');

  if (rec.intervalMs !== null) {
    issues.push({
      code: 'structural-rule',
      path: [...path, 'intervalMs'],
      entityId: wId ?? scenarioId,
      severity: 'error',
      message: `Workload intervalMs must be null`,
    });
  }

  // Classes (storage.md §6: 20 classes per workload)
  if (validateArray(rec.classes, 20, [...path, 'classes'], wId ?? scenarioId, issues, 'Workload classes')) {
    const classes = rec.classes as unknown[];
    for (let cIdx = 0; cIdx < classes.length; cIdx++) {
      validateRequestClass(classes[cIdx], [...path, 'classes', cIdx], wId ?? scenarioId, allIds, issues);
    }
  }
}

function validateRequestClass(
  c: unknown,
  path: readonly (string | number)[],
  workloadId: Id | null,
  allIds: Map<string, (string | number)[]>,
  issues: Issue[],
): void {
  const allowed = ['id', 'name', 'weight', 'operation', 'tags', 'keyDistribution'];
  if (!checkRecord(c, allowed, allowed, path, workloadId, issues, 'RequestClass')) return;

  const rec = c as Record<string, unknown>;
  let cId: Id | null = null;
  if (validateId(rec.id, [...path, 'id'], workloadId, issues)) {
    cId = rec.id;
    registerId(rec.id, [...path, 'id'], allIds, issues);
  }

  validateString(rec.name, 1, 80, [...path, 'name'], cId ?? workloadId, issues, 'RequestClass name');
  validateNumber(rec.weight, 0, Number.MAX_VALUE, [...path, 'weight'], cId ?? workloadId, issues, 'RequestClass weight', false, true);

  if (rec.operation !== 'read' && rec.operation !== 'write') {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'operation'],
      entityId: cId ?? workloadId,
      severity: 'error',
      message: `RequestClass operation must be 'read' or 'write'`,
    });
  }

  if (validateArray(rec.tags, 20, [...path, 'tags'], cId ?? workloadId, issues, 'RequestClass tags')) {
    const tags = rec.tags as unknown[];
    for (let i = 0; i < tags.length; i++) {
      validateString(tags[i], 0, 80, [...path, 'tags', i], cId ?? workloadId, issues, 'tag');
    }
  }

  // KeyDistribution
  if (checkRecord(rec.keyDistribution, ['kind', 'catalogSize', 'hotSubset', 'hotShare'], ['kind', 'catalogSize', 'hotSubset', 'hotShare'], [...path, 'keyDistribution'], cId ?? workloadId, issues, 'KeyDistribution')) {
    const kd = rec.keyDistribution as Record<string, unknown>;
    if (kd.kind !== 'uniform' && kd.kind !== 'hot') {
      issues.push({
        code: 'invalid-literal',
        path: [...path, 'keyDistribution', 'kind'],
        entityId: cId ?? workloadId,
        severity: 'error',
        message: `KeyDistribution kind must be 'uniform' or 'hot'`,
      });
    }
    validateNumber(kd.catalogSize, 1, 100000, [...path, 'keyDistribution', 'catalogSize'], cId ?? workloadId, issues, 'catalogSize', true);
    const catSize = typeof kd.catalogSize === 'number' ? kd.catalogSize : 100000;
    validateNumber(kd.hotSubset, 1, catSize, [...path, 'keyDistribution', 'hotSubset'], cId ?? workloadId, issues, 'hotSubset', true);
    validateNumber(kd.hotShare, 0, 100, [...path, 'keyDistribution', 'hotShare'], cId ?? workloadId, issues, 'hotShare');
  }
}

function validateAssertionSubject(
  subj: unknown,
  path: readonly (string | number)[],
  assertionId: Id | null,
  pendingEndpoints: { endpoint: Record<string, unknown>; path: readonly (string | number)[]; entityId: Id | null }[],
  issues: Issue[],
): void {
  if (subj === null || typeof subj !== 'object' || Array.isArray(subj)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId: assertionId,
      severity: 'error',
      message: 'Assertion subject must be an object',
    });
    return;
  }

  const rec = subj as Record<string, unknown>;
  const kind = rec.kind;

  if (typeof kind !== 'string' || !ASSERTION_SUBJECT_KINDS.includes(kind as (typeof ASSERTION_SUBJECT_KINDS)[number])) {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'kind'],
      entityId: assertionId,
      severity: 'error',
      message: `Invalid assertion subject kind: '${String(kind)}'`,
    });
    return;
  }

  if (kind === 'final-state') {
    if (checkRecord(rec, ['kind', 'elementId'], ['kind', 'elementId'], path, assertionId, issues, 'final-state subject')) {
      validateId(rec.elementId, [...path, 'elementId'], assertionId, issues);
    }
  } else if (kind === 'context') {
    if (checkRecord(rec, ['kind', 'elementId', 'path'], ['kind', 'elementId', 'path'], path, assertionId, issues, 'context subject')) {
      validateId(rec.elementId, [...path, 'elementId'], assertionId, issues);
      validatePath(rec.path, [...path, 'path'], assertionId, issues);
    }
  } else if (kind === 'output') {
    if (checkRecord(rec, ['kind', 'port', 'path'], ['kind', 'port', 'path'], path, assertionId, issues, 'output subject')) {
      if (checkRecord(rec.port, ['elementId', 'portId'], ['elementId', 'portId'], [...path, 'port'], assertionId, issues, 'output subject port')) {
        pendingEndpoints.push({ endpoint: rec.port as Record<string, unknown>, path: [...path, 'port'], entityId: assertionId });
      }
      validatePath(rec.path, [...path, 'path'], assertionId, issues);
    }
  } else if (kind === 'count') {
    if (checkRecord(rec, ['kind', 'scope', 'elementId', 'outcome'], ['kind', 'scope', 'elementId', 'outcome'], path, assertionId, issues, 'count subject')) {
      if (typeof rec.scope !== 'string' || !COUNT_SUBJECT_SCOPES.includes(rec.scope as (typeof COUNT_SUBJECT_SCOPES)[number])) {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'scope'],
          entityId: assertionId,
          severity: 'error',
          message: `Invalid count scope: '${String(rec.scope)}'`,
        });
      }
      if (rec.elementId !== null) {
        validateId(rec.elementId, [...path, 'elementId'], assertionId, issues);
      }
      if (typeof rec.outcome !== 'string' || !COUNT_SUBJECT_OUTCOMES.includes(rec.outcome as (typeof COUNT_SUBJECT_OUTCOMES)[number])) {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'outcome'],
          entityId: assertionId,
          severity: 'error',
          message: `Invalid count outcome: '${String(rec.outcome)}'`,
        });
      }
    }
  } else if (kind === 'trace-count') {
    if (checkRecord(rec, ['kind', 'elementId', 'code'], ['kind', 'elementId', 'code'], path, assertionId, issues, 'trace-count subject')) {
      validateId(rec.elementId, [...path, 'elementId'], assertionId, issues);
      validateString(rec.code, 1, 80, [...path, 'code'], assertionId, issues, 'Trace count code');
    }
  } else if (kind === 'metric') {
    if (checkRecord(rec, ['kind', 'elementId', 'key'], ['kind', 'elementId', 'key'], path, assertionId, issues, 'metric subject')) {
      validateId(rec.elementId, [...path, 'elementId'], assertionId, issues);
      if (typeof rec.key !== 'string' || !METRIC_SUBJECT_KEYS.includes(rec.key as (typeof METRIC_SUBJECT_KEYS)[number])) {
        issues.push({
          code: 'invalid-literal',
          path: [...path, 'key'],
          entityId: assertionId,
          severity: 'error',
          message: `Invalid metric subject key: '${String(rec.key)}'`,
        });
      }
    }
  }
}

function validateScenarioBudgets(
  budgets: unknown,
  path: readonly (string | number)[],
  scenarioId: Id | null,
  issues: Issue[],
): void {
  const allowed = ['maxEvents', 'maxTraceRows', 'maxTraceBytes', 'maxScheduledEvents', 'maxLiveRoots'];
  if (!checkRecord(budgets, allowed, allowed, path, scenarioId, issues, 'Scenario budgets')) return;

  const rec = budgets as Record<string, unknown>;
  validateNumber(rec.maxEvents, 1, 1000000, [...path, 'maxEvents'], scenarioId, issues, 'maxEvents', true);
  validateNumber(rec.maxTraceRows, 1, 100000, [...path, 'maxTraceRows'], scenarioId, issues, 'maxTraceRows', true);
  validateNumber(rec.maxTraceBytes, 1, 16777216, [...path, 'maxTraceBytes'], scenarioId, issues, 'maxTraceBytes', true);
  validateNumber(rec.maxScheduledEvents, 1, 100000, [...path, 'maxScheduledEvents'], scenarioId, issues, 'maxScheduledEvents', true);
  validateNumber(rec.maxLiveRoots, 1, 10000, [...path, 'maxLiveRoots'], scenarioId, issues, 'maxLiveRoots', true);
}

function validateCompletionPolicy(
  completion: unknown,
  path: readonly (string | number)[],
  scenarioId: Id | null,
  issues: Issue[],
): void {
  if (completion === null || typeof completion !== 'object' || Array.isArray(completion)) {
    issues.push({
      code: 'wrong-type',
      path,
      entityId: scenarioId,
      severity: 'error',
      message: 'Completion policy must be an object',
    });
    return;
  }

  const rec = completion as Record<string, unknown>;
  const kind = rec.kind;

  if (typeof kind !== 'string' || !COMPLETION_KINDS.includes(kind as (typeof COMPLETION_KINDS)[number])) {
    issues.push({
      code: 'invalid-literal',
      path: [...path, 'kind'],
      entityId: scenarioId,
      severity: 'error',
      message: `Invalid completion policy kind: '${String(kind)}'`,
    });
    return;
  }

  // D32: completion kind vs scenario mode is a readiness rule (readiness.ts), not
  // storable. The storable check only confirms `kind` is a valid literal (above) and
  // validates each kind's own per-field bounds (below).

  if (kind === 'quiescent') {
    checkRecord(rec, ['kind'], ['kind'], path, scenarioId, issues, 'quiescent completion policy');
  } else if (kind === 'horizon') {
    if (checkRecord(rec, ['kind', 'horizonMs'], ['kind', 'horizonMs'], path, scenarioId, issues, 'horizon completion policy')) {
      // storage.md §6: timed horizon 1–300 s (1,000..300,000 ms)
      validateNumber(rec.horizonMs, 1000, 300000, [...path, 'horizonMs'], scenarioId, issues, 'horizonMs');
    }
  } else if (kind === 'drain') {
    if (checkRecord(rec, ['kind', 'arrivalHorizonMs', 'deadlineMs'], ['kind', 'arrivalHorizonMs', 'deadlineMs'], path, scenarioId, issues, 'drain completion policy')) {
      // storage.md §6: arrival horizon 1–300 s (1,000..300,000 ms), drain deadline > arrival horizon and <= 600 s (600,000 ms)
      validateNumber(rec.arrivalHorizonMs, 1000, 300000, [...path, 'arrivalHorizonMs'], scenarioId, issues, 'arrivalHorizonMs');
      validateNumber(rec.deadlineMs, 1000, 600000, [...path, 'deadlineMs'], scenarioId, issues, 'deadlineMs');
      if (typeof rec.arrivalHorizonMs === 'number' && typeof rec.deadlineMs === 'number') {
        if (rec.deadlineMs <= rec.arrivalHorizonMs) {
          issues.push({
            code: 'structural-rule',
            path: [...path, 'deadlineMs'],
            entityId: scenarioId,
            severity: 'error',
            message: `Drain deadlineMs (${rec.deadlineMs}) must be strictly greater than arrivalHorizonMs (${rec.arrivalHorizonMs})`,
          });
        }
      }
    }
  }
}

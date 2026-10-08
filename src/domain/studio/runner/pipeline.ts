/**
 * Pipeline behavior interpreter and data operations (validate, trim, map, filter,
 * deduplicate, group-sum).
 *
 * A pipeline emits ordered success/error arrays only when nonempty; an empty branch
 * emits nothing, and row outcomes stay available. Row provenance is
 * `{inputEventId, index}`.
 */

import { canonicalJson } from '../canonical';
import type {
  Document,
  Element,
  Endpoint,
  Id,
  Json,
  Path,
  PipelineBehavior,
} from '../model';
import type { Evaluator, EvalScope } from './expr-api';
import { isMissing } from './expr-api';
import { validateSchemaValue } from './schema-value';
import type { Issue, RowOutcome, RowRef } from './types';

// ============================================================================
// Public Result Types
// ============================================================================

export type PipelineEmission = {
  readonly portId: Id;
  readonly port: Endpoint;
  readonly value: readonly Json[];
};

export type PipelineSuccessResult = {
  readonly ok: true;
  readonly status: 'succeeded';
  readonly success: readonly Json[];
  readonly errors: readonly Json[];
  readonly rowOutcomes: readonly RowOutcome[];
  readonly provenance: readonly (readonly RowRef[])[];
  readonly emissions: readonly PipelineEmission[];
};

export type PipelineFailureResult = {
  readonly ok: false;
  readonly status: 'failed';
  readonly reason: string;
  readonly schemaId?: Id;
  readonly issues?: readonly Issue[];
};

export type PipelineRunResult = PipelineSuccessResult | PipelineFailureResult;

export function isPipelineSuccess(result: PipelineRunResult): result is PipelineSuccessResult {
  return result.ok;
}

// ============================================================================
// Internal Tracking Types & Helpers
// ============================================================================

interface PipelineItem {
  readonly originalRow: Json;
  readonly row: Json;
  readonly inputRows: readonly RowRef[];
}

/**
 * Deep clones a Json value so caller input objects are never mutated.
 */
function cloneJson<T extends Json>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

/**
 * Looks up a value at Path in a JSON structure.
 */
function getPathValue(
  root: unknown,
  path: Path,
): { readonly found: true; readonly value: unknown } | { readonly found: false } {
  if (path.length === 0) {
    return { found: true, value: root };
  }

  let cur: unknown = root;
  for (const segment of path) {
    if (cur === null || typeof cur !== 'object') {
      return { found: false };
    }

    if (Array.isArray(cur)) {
      if (typeof segment !== 'number' || !Number.isInteger(segment) || segment < 0 || segment >= cur.length) {
        return { found: false };
      }
      cur = cur[segment];
    } else {
      const key = String(segment);
      if (!Object.hasOwn(cur as Record<string, unknown>, key)) {
        return { found: false };
      }
      cur = (cur as Record<string, unknown>)[key];
    }
  }

  return { found: true, value: cur };
}

/**
 * Immutably sets a value at Path in a JSON structure.
 */
function setPathValue(root: Json, path: Path, newValue: Json): Json {
  if (path.length === 0) {
    return newValue;
  }

  const [head, ...tail] = path;

  if (Array.isArray(root)) {
    const idx = Number(head);
    const copy = [...root];
    copy[idx] = setPathValue(copy[idx], tail, newValue);
    return copy;
  }

  if (root !== null && typeof root === 'object') {
    const key = String(head);
    const copy = { ...root } as Record<string, Json>;
    copy[key] = setPathValue(copy[key], tail, newValue);
    return copy;
  }

  return root;
}

/**
 * Appends source row refs to target maintaining ordered union (no duplicates).
 */
function appendOrderedUnion(target: RowRef[], source: readonly RowRef[]): void {
  for (const src of source) {
    if (!target.some((t) => t.inputEventId === src.inputEventId && t.index === src.index)) {
      target.push(src);
    }
  }
}

// ============================================================================
// Pipeline Runner
// ============================================================================

/**
 * Runs a pipeline element over input rows.
 *
 * Operations are executed sequentially, preserving row provenance:
 * 1. validate: Failing rows are diverted unchanged to error output (errorCode 'schema-mismatch').
 * 2. trim: Wrong-type is 'wrong-type', missing path is 'missing-path', strings are trimmed.
 * 3. map: Injected Evaluator maps target fields, evaluation error is 'wrong-type'.
 * 4. filter: Evaluator evaluates guard, false rows are dropped as 'filtered' (null errorCode).
 * 5. deduplicate: Canonical JSON comparison, later duplicates dropped as 'duplicate' (null errorCode).
 * 6. group-sum: Grouped by string key, safe-integer sum with overflow check ('integer-overflow'),
 *    keys sorted by UTF-16 code unit, provenance = ordered union of contributing rows.
 *
 * Whole-pipeline schema validation covers output and error arrays. If either fails,
 * returns a distinct failure result. Empty branches emit nothing.
 */
export function runPipeline(
  doc: Document,
  pipelineElement: Element,
  inputRows: readonly Json[],
  inputEventId: string,
  evaluator: Evaluator,
): PipelineRunResult {
  if (pipelineElement.behavior.kind !== 'pipeline') {
    return {
      ok: false,
      status: 'failed',
      reason: `Element ${pipelineElement.id} has behavior kind '${pipelineElement.behavior.kind}', expected 'pipeline'`,
    };
  }

  const behavior = pipelineElement.behavior as PipelineBehavior;
  const schemaMap = new Map(doc.schemas.map((s) => [s.id, s]));

  // Input rows are cloned so callers never observe mutations
  let activeItems: PipelineItem[] = inputRows.map((row, index) => {
    const cloned = cloneJson(row);
    return {
      originalRow: cloned,
      row: cloneJson(row),
      inputRows: [{ inputEventId, index }],
    };
  });

  const errors: Json[] = [];
  const rowOutcomes: RowOutcome[] = [];

  // Sequential execution of pipeline operations
  for (const op of behavior.operations) {
    switch (op.kind) {
      case 'validate': {
        const schema = schemaMap.get(op.schemaId);
        if (!schema) {
          return {
            ok: false,
            status: 'failed',
            reason: `Schema ${op.schemaId} referenced by validate operation not found in document`,
            schemaId: op.schemaId,
          };
        }

        const nextItems: PipelineItem[] = [];
        for (const item of activeItems) {
          const valRes = validateSchemaValue(item.row, schema.shape, [], op.schemaId);
          if (valRes.ok) {
            nextItems.push(item);
          } else {
            // A failing row goes to the error output UNCHANGED as its original input row
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'schema-mismatch',
            });
          }
        }
        activeItems = nextItems;
        break;
      }

      case 'trim': {
        const nextItems: PipelineItem[] = [];
        for (const item of activeItems) {
          const lookup = getPathValue(item.row, op.path);
          if (!lookup.found) {
            // Missing path: explicit row error 'missing-path'
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'missing-path',
            });
            continue;
          }

          if (typeof lookup.value !== 'string') {
            // Wrong type: explicit row error 'wrong-type'
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'wrong-type',
            });
            continue;
          }

          const trimmed = lookup.value.trim();
          const updatedRow = setPathValue(item.row, op.path, trimmed);
          nextItems.push({
            originalRow: item.originalRow,
            row: updatedRow,
            inputRows: item.inputRows,
          });
        }
        activeItems = nextItems;
        break;
      }

      case 'map': {
        const nextItems: PipelineItem[] = [];
        for (const item of activeItems) {
          const scope: EvalScope = {
            input: item.row,
            context: {},
            outcome: null,
          };

          let fieldError = false;
          const mappedRecord: Record<string, Json> = {};

          for (const field of op.fields) {
            const evalRes = evaluator.evalValue(field.value, scope);
            if (!evalRes.ok || isMissing(evalRes.value)) {
              fieldError = true;
              break;
            }
            mappedRecord[field.targetKey] = evalRes.value;
          }

          if (fieldError) {
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'wrong-type',
            });
          } else {
            nextItems.push({
              originalRow: item.originalRow,
              row: mappedRecord,
              inputRows: item.inputRows,
            });
          }
        }
        activeItems = nextItems;
        break;
      }

      case 'filter': {
        const nextItems: PipelineItem[] = [];
        for (const item of activeItems) {
          const scope: EvalScope = {
            input: item.row,
            context: {},
            outcome: null,
          };

          const guardRes = evaluator.evalGuard(op.guard, scope);
          if (!guardRes.ok) {
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'wrong-type',
            });
          } else if (guardRes.value) {
            nextItems.push(item);
          } else {
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'filtered',
              outputIndex: null,
              errorCode: null,
            });
          }
        }
        activeItems = nextItems;
        break;
      }

      case 'deduplicate': {
        const seenCanonicalKeys = new Set<string>();
        const nextItems: PipelineItem[] = [];

        for (const item of activeItems) {
          const lookup = getPathValue(item.row, op.path);
          if (!lookup.found) {
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'missing-path',
            });
            continue;
          }

          const cJson = canonicalJson(lookup.value);
          if (!cJson.ok) {
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'wrong-type',
            });
            continue;
          }

          const key = cJson.text;
          if (seenCanonicalKeys.has(key)) {
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'duplicate',
              outputIndex: null,
              errorCode: null,
            });
          } else {
            seenCanonicalKeys.add(key);
            nextItems.push(item);
          }
        }
        activeItems = nextItems;
        break;
      }

      case 'group-sum': {
        interface GroupAccumulator {
          sum: number;
          inputRows: RowRef[];
        }

        const groups = new Map<string, GroupAccumulator>();

        for (const item of activeItems) {
          const keyLookup = getPathValue(item.row, op.keyPath);
          if (!keyLookup.found) {
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'missing-path',
            });
            continue;
          }

          if (typeof keyLookup.value !== 'string') {
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'wrong-type',
            });
            continue;
          }

          const valLookup = getPathValue(item.row, op.valuePath);
          if (!valLookup.found) {
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'missing-path',
            });
            continue;
          }

          if (typeof valLookup.value !== 'number' || !Number.isSafeInteger(valLookup.value)) {
            errors.push(item.originalRow);
            rowOutcomes.push({
              elementId: pipelineElement.id,
              operationId: op.id,
              inputRows: item.inputRows,
              outcome: 'error',
              outputIndex: null,
              errorCode: 'wrong-type',
            });
            continue;
          }

          const groupKey = keyLookup.value;
          const groupVal = valLookup.value;
          const existing = groups.get(groupKey);

          if (!existing) {
            groups.set(groupKey, {
              sum: groupVal,
              inputRows: [...item.inputRows],
            });
          } else {
            const nextSum = existing.sum + groupVal;
            if (!Number.isSafeInteger(nextSum)) {
              // Overflow check -> 'integer-overflow'
              errors.push(item.originalRow);
              rowOutcomes.push({
                elementId: pipelineElement.id,
                operationId: op.id,
                inputRows: item.inputRows,
                outcome: 'error',
                outputIndex: null,
                errorCode: 'integer-overflow',
              });
            } else {
              existing.sum = nextSum;
              appendOrderedUnion(existing.inputRows, item.inputRows);
            }
          }
        }

        // Keys sorted strictly by UTF-16 code units (plain < / > comparison)
        const sortedKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const nextItems: PipelineItem[] = [];

        for (const k of sortedKeys) {
          const grp = groups.get(k)!;
          const groupedRow: Record<string, Json> = {
            [op.keyName]: k,
            [op.sumName]: grp.sum,
          };
          nextItems.push({
            originalRow: groupedRow,
            row: groupedRow,
            inputRows: grp.inputRows,
          });
        }
        activeItems = nextItems;
        break;
      }
    }
  }

  // Construct final success rows and record emitted row outcomes
  const success: Json[] = [];
  const provenance: (readonly RowRef[])[] = [];

  const lastOpId =
    behavior.operations.length > 0
      ? behavior.operations[behavior.operations.length - 1].id
      : pipelineElement.id;

  for (let outputIndex = 0; outputIndex < activeItems.length; outputIndex++) {
    const item = activeItems[outputIndex];
    success.push(item.row);
    provenance.push(item.inputRows);
    rowOutcomes.push({
      elementId: pipelineElement.id,
      operationId: lastOpId,
      inputRows: item.inputRows,
      outcome: 'emitted',
      outputIndex,
      errorCode: null,
    });
  }

  // Whole-pipeline schema validation of the output and error arrays against
  // outputSchemaId/errorSchemaId; a mismatch fails the run (return a distinct failure result, not rows)
  const outputSchema = schemaMap.get(behavior.outputSchemaId);
  if (!outputSchema) {
    return {
      ok: false,
      status: 'failed',
      reason: `Output schema ${behavior.outputSchemaId} not found in document`,
      schemaId: behavior.outputSchemaId,
    };
  }

  const errorSchema = schemaMap.get(behavior.errorSchemaId);
  if (!errorSchema) {
    return {
      ok: false,
      status: 'failed',
      reason: `Error schema ${behavior.errorSchemaId} not found in document`,
      schemaId: behavior.errorSchemaId,
    };
  }

  const outputValRes = validateSchemaValue(success, outputSchema.shape, [], behavior.outputSchemaId);
  if (!outputValRes.ok) {
    return {
      ok: false,
      status: 'failed',
      reason: `Pipeline success output failed schema validation against schema ${behavior.outputSchemaId}`,
      schemaId: behavior.outputSchemaId,
      issues: outputValRes.issues,
    };
  }

  const errorValRes = validateSchemaValue(errors, errorSchema.shape, [], behavior.errorSchemaId);
  if (!errorValRes.ok) {
    return {
      ok: false,
      status: 'failed',
      reason: `Pipeline error output failed schema validation against schema ${behavior.errorSchemaId}`,
      schemaId: behavior.errorSchemaId,
      issues: errorValRes.issues,
    };
  }

  // Emissions: which ports emit (only nonempty arrays)
  const emissions: PipelineEmission[] = [];

  if (success.length > 0) {
    emissions.push({
      portId: behavior.outputPortId,
      port: {
        elementId: pipelineElement.id,
        portId: behavior.outputPortId,
      },
      value: success,
    });
  }

  if (errors.length > 0) {
    emissions.push({
      portId: behavior.errorPortId,
      port: {
        elementId: pipelineElement.id,
        portId: behavior.errorPortId,
      },
      value: errors,
    });
  }

  return {
    ok: true,
    status: 'succeeded',
    success,
    errors,
    rowOutcomes,
    provenance,
    emissions,
  };
}

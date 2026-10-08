import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPipeline, isPipelineSuccess } from './pipeline';
import { canonicalJson } from '../canonical';
import type {
  Document,
  Element,
  Guard,
  Id,
  Json,
  PayloadSchema,
  PipelineBehavior,
  Value,
} from '../model';
import type {
  Evaluator,
  EvalScope,
  GuardOutcome,
  ValueOutcome,
} from './expr-api';
import { missingValue } from './expr-api';

const FIXTURES_DIR = join(process.cwd(), 'src/features/entry/examples');

function loadS03Document(): Document {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 's03.json'), 'utf8')) as Document;
}

/**
 * Hand-written stub Evaluator supporting only literal, read, and equals
 * for testing map and filter operations. S03 itself uses no map/filter.
 */
class StubEvaluator implements Evaluator {
  evalValue(value: Value, scope: EvalScope): ValueOutcome {
    switch (value.kind) {
      case 'literal':
        return { ok: true, value: value.value };
      case 'read': {
        const sourceObj = scope[value.source];
        if (value.path.length === 0) {
          return { ok: true, value: sourceObj };
        }
        let cur: unknown = sourceObj;
        for (const seg of value.path) {
          if (cur === null || typeof cur !== 'object') {
            return { ok: true, value: missingValue(value.path) };
          }
          const key = String(seg);
          if (!Object.hasOwn(cur as Record<string, unknown>, key)) {
            return { ok: true, value: missingValue(value.path) };
          }
          cur = (cur as Record<string, unknown>)[key];
        }
        return { ok: true, value: cur as Json };
      }
      default:
        return {
          ok: false,
          error: {
            code: 'unsupported-value',
            path: [],
            message: `StubEvaluator does not support value kind '${value.kind}'`,
          },
        };
    }
  }

  evalGuard(guard: Guard, scope: EvalScope): GuardOutcome {
    if (guard.op === 'equals') {
      const left = this.evalValue(guard.left, scope);
      const right = this.evalValue(guard.right, scope);
      if (!left.ok || !right.ok) {
        return {
          ok: false,
          error: {
            code: 'guard-eval-error',
            path: [],
            message: 'Failed to eval operands',
          },
        };
      }
      const leftJson = canonicalJson(left.value);
      const rightJson = canonicalJson(right.value);
      if (!leftJson.ok || !rightJson.ok) {
        return {
          ok: false,
          error: {
            code: 'canonical-error',
            path: [],
            message: 'Failed to canonicalize guard operands',
          },
        };
      }
      return { ok: true, value: leftJson.text === rightJson.text };
    }

    return {
      ok: false,
      error: {
        code: 'unsupported-guard',
        path: [],
        message: `StubEvaluator does not support guard op '${guard.op}'`,
      },
    };
  }
}

describe('runPipeline', () => {
  const stubEvaluator = new StubEvaluator();

  it('runs S03 reference records pipeline matching assertions, accounting, provenance, and rowOutcomes', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];
    const inputFixture = doc.fixtures[0];
    const inputRows = inputFixture.value as readonly Json[];
    const inputEventId = 'evt-s03-input';

    const result = runPipeline(doc, pipelineElement, inputRows, inputEventId, stubEvaluator);
    expect(isPipelineSuccess(result)).toBe(true);
    if (!isPipelineSuccess(result)) return;

    // 1. Errors = [r4 original row]
    // r4 is { orderId: 'c', region: 'EU', amountMinor: 'bad' }
    expect(result.errors).toEqual([
      {
        orderId: 'c',
        region: 'EU',
        amountMinor: 'bad',
      },
    ]);

    // Error output equals fixture's 'errors' assertion expected value
    const errorsAssertion = doc.scenarios[0].assertions.find((a) => a.label === 'errors')!;
    const canonicalErrorsResult = canonicalJson([result.errors]);
    const canonicalErrorsExpected = canonicalJson(errorsAssertion.expected);
    expect(canonicalErrorsResult.ok).toBe(true);
    expect(canonicalErrorsExpected.ok).toBe(true);
    if (canonicalErrorsResult.ok && canonicalErrorsExpected.ok) {
      expect(canonicalErrorsResult.text).toBe(canonicalErrorsExpected.text);
    }

    // 2. Success output equals fixture's 'totals' assertion expected value
    // Retained = [r1, r3, r5]; r2 is duplicate
    // Aggregated: EU=1500 (r1=1000 + r5=500), US=2500 (r3=2500)
    expect(result.success).toEqual([
      { region: 'EU', amountMinor: 1500 },
      { region: 'US', amountMinor: 2500 },
    ]);

    const totalsAssertion = doc.scenarios[0].assertions.find((a) => a.label === 'totals')!;
    const canonicalTotalsResult = canonicalJson([result.success]);
    const canonicalTotalsExpected = canonicalJson(totalsAssertion.expected);
    expect(canonicalTotalsResult.ok).toBe(true);
    expect(canonicalTotalsExpected.ok).toBe(true);
    if (canonicalTotalsResult.ok && canonicalTotalsExpected.ok) {
      expect(canonicalTotalsResult.text).toBe(canonicalTotalsExpected.text);
    }

    // 3. Accounting: 5 = 1 invalid + 1 duplicate + 3 retained
    // 5 total input rows:
    // - 1 invalid (r4, index 3)
    // - 1 duplicate (r2, index 1)
    // - 3 retained (r1 index 0, r3 index 2, r5 index 4)
    const invalidOutcomes = result.rowOutcomes.filter((o) => o.outcome === 'error');
    const duplicateOutcomes = result.rowOutcomes.filter((o) => o.outcome === 'duplicate');
    const emittedOutcomes = result.rowOutcomes.filter((o) => o.outcome === 'emitted');

    expect(invalidOutcomes.length).toBe(1);
    expect(duplicateOutcomes.length).toBe(1);
    // Emitted outcomes are the 2 aggregated groups representing the 3 retained rows
    expect(emittedOutcomes.length).toBe(2);

    const contributingIndices = emittedOutcomes.flatMap((o) => o.inputRows.map((r) => r.index));
    expect(contributingIndices).toEqual([0, 4, 2]); // r1, r5, r3 = 3 retained rows

    // 4. Every aggregate lists its source rows (EU <- r1, r5; US <- r3)
    expect(result.provenance).toEqual([
      [
        { inputEventId, index: 0 },
        { inputEventId, index: 4 },
      ],
      [{ inputEventId, index: 2 }],
    ]);

    // 5. rowOutcomes exact shape
    const behavior = pipelineElement.behavior as PipelineBehavior;
    const validateOpId = behavior.operations[0].id;
    const dedupOpId = behavior.operations[2].id;
    const groupSumOpId = behavior.operations[3].id;

    expect(result.rowOutcomes).toEqual([
      {
        elementId: pipelineElement.id,
        operationId: validateOpId,
        inputRows: [{ inputEventId, index: 3 }],
        outcome: 'error',
        outputIndex: null,
        errorCode: 'schema-mismatch',
      },
      {
        elementId: pipelineElement.id,
        operationId: dedupOpId,
        inputRows: [{ inputEventId, index: 1 }],
        outcome: 'duplicate',
        outputIndex: null,
        errorCode: null,
      },
      {
        elementId: pipelineElement.id,
        operationId: groupSumOpId,
        inputRows: [
          { inputEventId, index: 0 },
          { inputEventId, index: 4 },
        ],
        outcome: 'emitted',
        outputIndex: 0,
        errorCode: null,
      },
      {
        elementId: pipelineElement.id,
        operationId: groupSumOpId,
        inputRows: [{ inputEventId, index: 2 }],
        outcome: 'emitted',
        outputIndex: 1,
        errorCode: null,
      },
    ]);

    // 6. Emissions: both output and error ports emitted
    expect(result.emissions).toEqual([
      {
        portId: behavior.outputPortId,
        port: {
          elementId: pipelineElement.id,
          portId: behavior.outputPortId,
        },
        value: result.success,
      },
      {
        portId: behavior.errorPortId,
        port: {
          elementId: pipelineElement.id,
          portId: behavior.errorPortId,
        },
        value: result.errors,
      },
    ]);
  });

  it('an empty branch emits nothing', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];
    const behavior = pipelineElement.behavior as PipelineBehavior;

    // Case 1: Input with only valid rows (no errors) -> error branch emits nothing
    const validOnlyRows: readonly Json[] = [
      { orderId: 'a', region: 'EU', amountMinor: 100 },
      { orderId: 'b', region: 'US', amountMinor: 200 },
    ];
    const res1 = runPipeline(doc, pipelineElement, validOnlyRows, 'evt-1', stubEvaluator);
    expect(isPipelineSuccess(res1)).toBe(true);
    if (!isPipelineSuccess(res1)) return;

    expect(res1.errors).toEqual([]);
    expect(res1.emissions.length).toBe(1);
    expect(res1.emissions[0].portId).toBe(behavior.outputPortId);

    // Case 2: Input with only invalid rows (no success) -> success branch emits nothing
    const invalidOnlyRows: readonly Json[] = [
      { orderId: 'a', region: 'EU', amountMinor: 'bad1' },
      { orderId: 'b', region: 'US', amountMinor: 'bad2' },
    ];
    const res2 = runPipeline(doc, pipelineElement, invalidOnlyRows, 'evt-2', stubEvaluator);
    expect(isPipelineSuccess(res2)).toBe(true);
    if (!isPipelineSuccess(res2)) return;

    expect(res2.success).toEqual([]);
    expect(res2.emissions.length).toBe(1);
    expect(res2.emissions[0].portId).toBe(behavior.errorPortId);

    // Case 3: Empty input array -> neither branch emits
    const res3 = runPipeline(doc, pipelineElement, [], 'evt-3', stubEvaluator);
    expect(isPipelineSuccess(res3)).toBe(true);
    if (!isPipelineSuccess(res3)) return;

    expect(res3.success).toEqual([]);
    expect(res3.errors).toEqual([]);
    expect(res3.emissions).toEqual([]);
  });

  it('handles group-sum overflow with errorCode integer-overflow', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];

    const overflowRows: readonly Json[] = [
      { orderId: 'x1', region: 'EU', amountMinor: Number.MAX_SAFE_INTEGER },
      { orderId: 'x2', region: 'EU', amountMinor: 1 }, // Adding 1 overflows safe integer!
    ];

    const res = runPipeline(doc, pipelineElement, overflowRows, 'evt-overflow', stubEvaluator);
    expect(isPipelineSuccess(res)).toBe(true);
    if (!isPipelineSuccess(res)) return;

    // The second row must fail with integer-overflow
    expect(res.errors).toEqual([{ orderId: 'x2', region: 'EU', amountMinor: 1 }]);
    const overflowOutcome = res.rowOutcomes.find((o) => o.errorCode === 'integer-overflow');
    expect(overflowOutcome).toBeDefined();
    expect(overflowOutcome).toMatchObject({
      outcome: 'error',
      errorCode: 'integer-overflow',
      inputRows: [{ inputEventId: 'evt-overflow', index: 1 }],
      outputIndex: null,
    });

    // The first row is retained and emitted
    expect(res.success).toEqual([{ region: 'EU', amountMinor: Number.MAX_SAFE_INTEGER }]);
  });

  it('handles wrong-type trim with explicit row error wrong-type', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];

    // Row has region as a number instead of string
    // Passes validate (since amountMinor is integer, orderId is string, but wait:
    // validated row schema has region as string! So let's customize validate or pass doc where validate permits or bypasses)
    // Let's create a custom element where validate is not present, only trim:
    const trimErrorSchemaId: Id = 'trim-error-schema-uuid-2222';
    const trimErrorSchema: PayloadSchema = {
      id: trimErrorSchemaId,
      label: 'Trim error rows',
      shape: {
        type: 'list',
        nullable: false,
        maxItems: 100,
        items: {
          type: 'record',
          nullable: false,
          fields: [
            {
              id: 'te-1',
              key: 'orderId',
              optional: false,
              shape: { type: 'string', nullable: false },
            },
            {
              id: 'te-2',
              key: 'region',
              optional: false,
              shape: {
                type: 'scalar-union',
                nullable: false,
                types: ['string', 'number'],
              },
            },
            {
              id: 'te-3',
              key: 'amountMinor',
              optional: false,
              shape: { type: 'integer', nullable: false },
            },
          ],
        },
      },
    };

    const docWithTrimSchema: Document = {
      ...doc,
      schemas: [...doc.schemas, trimErrorSchema],
    };

    const baseBehavior = pipelineElement.behavior as PipelineBehavior;

    const trimOnlyElement: Element = {
      ...pipelineElement,
      id: 'trim-element-id',
      behavior: {
        kind: 'pipeline',
        version: 1,
        inputSchemaId: baseBehavior.inputSchemaId,
        outputSchemaId: baseBehavior.inputSchemaId,
        errorSchemaId: trimErrorSchemaId,
        inputPortId: baseBehavior.inputPortId,
        outputPortId: baseBehavior.outputPortId,
        errorPortId: baseBehavior.errorPortId,
        operations: [
          {
            id: 'trim-op-id',
            kind: 'trim',
            path: ['region'],
          },
        ],
      },
    };

    const wrongTypeRows: readonly Json[] = [
      { orderId: 'r1', region: 12345, amountMinor: 100 },
    ];

    const res = runPipeline(docWithTrimSchema, trimOnlyElement, wrongTypeRows, 'evt-trim', stubEvaluator);
    expect(isPipelineSuccess(res)).toBe(true);
    if (!isPipelineSuccess(res)) return;

    expect(res.errors).toEqual([{ orderId: 'r1', region: 12345, amountMinor: 100 }]);
    expect(res.rowOutcomes).toEqual([
      {
        elementId: 'trim-element-id',
        operationId: 'trim-op-id',
        inputRows: [{ inputEventId: 'evt-trim', index: 0 }],
        outcome: 'error',
        outputIndex: null,
        errorCode: 'wrong-type',
      },
    ]);
  });

  it('handles missing path in trim with explicit row error missing-path', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];
    const baseBehavior = pipelineElement.behavior as PipelineBehavior;

    const trimOnlyElement: Element = {
      ...pipelineElement,
      id: 'trim-element-id',
      behavior: {
        kind: 'pipeline',
        version: 1,
        inputSchemaId: baseBehavior.inputSchemaId,
        outputSchemaId: baseBehavior.inputSchemaId,
        errorSchemaId: baseBehavior.errorSchemaId,
        inputPortId: baseBehavior.inputPortId,
        outputPortId: baseBehavior.outputPortId,
        errorPortId: baseBehavior.errorPortId,
        operations: [
          {
            id: 'trim-op-id',
            kind: 'trim',
            path: ['nonExistentField'],
          },
        ],
      },
    };

    const missingPathRows: readonly Json[] = [
      { orderId: 'r1', region: 'EU', amountMinor: 100 },
    ];

    const res = runPipeline(doc, trimOnlyElement, missingPathRows, 'evt-missing', stubEvaluator);
    expect(isPipelineSuccess(res)).toBe(true);
    if (!isPipelineSuccess(res)) return;

    expect(res.errors).toEqual([{ orderId: 'r1', region: 'EU', amountMinor: 100 }]);
    expect(res.rowOutcomes).toEqual([
      {
        elementId: 'trim-element-id',
        operationId: 'trim-op-id',
        inputRows: [{ inputEventId: 'evt-missing', index: 0 }],
        outcome: 'error',
        outputIndex: null,
        errorCode: 'missing-path',
      },
    ]);
  });

  it('sorts group-sum keys strictly by UTF-16 code unit (not locale)', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];

    // In UTF-16 code unit order:
    // '1' = 49
    // 'B' = 66
    // 'a' = 97
    // 'ä' = 228
    // In many European locales, 'a' < 'B' or 'ä' is near 'a'.
    // UTF-16 code unit comparison: '1' < 'B' < 'a' < 'ä'.
    const baseBehavior = pipelineElement.behavior as PipelineBehavior;
    const groupSumElement: Element = {
      ...pipelineElement,
      behavior: {
        kind: 'pipeline',
        version: 1,
        inputSchemaId: baseBehavior.inputSchemaId,
        outputSchemaId: baseBehavior.outputSchemaId,
        errorSchemaId: baseBehavior.errorSchemaId,
        inputPortId: baseBehavior.inputPortId,
        outputPortId: baseBehavior.outputPortId,
        errorPortId: baseBehavior.errorPortId,
        operations: [
          {
            id: 'gs-op',
            kind: 'group-sum',
            keyPath: ['region'],
            valuePath: ['amountMinor'],
            keyName: 'region',
            sumName: 'amountMinor',
          },
        ],
      },
    };

    const rows: readonly Json[] = [
      { orderId: '1', region: 'ä', amountMinor: 10 },
      { orderId: '2', region: 'a', amountMinor: 20 },
      { orderId: '3', region: 'B', amountMinor: 30 },
      { orderId: '4', region: '1', amountMinor: 40 },
    ];

    const res = runPipeline(doc, groupSumElement, rows, 'evt-sort', stubEvaluator);
    expect(isPipelineSuccess(res)).toBe(true);
    if (!isPipelineSuccess(res)) return;

    const resultKeys = res.success.map((r) => (r as Record<string, Json>).region);
    expect(resultKeys).toEqual(['1', 'B', 'a', 'ä']);
  });

  it('executes map and filter operations via the stub Evaluator', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];
    const baseBehavior = pipelineElement.behavior as PipelineBehavior;

    // Define custom schema for mapped rows
    const mappedSchemaId: Id = 'mapped-schema-uuid-1111-1111';
    const mappedSchema: PayloadSchema = {
      id: mappedSchemaId,
      label: 'Mapped rows',
      shape: {
        type: 'list',
        nullable: false,
        maxItems: 100,
        items: {
          type: 'record',
          nullable: false,
          fields: [
            {
              id: 'f1-id',
              key: 'code',
              optional: false,
              shape: { type: 'string', nullable: false },
            },
            {
              id: 'f2-id',
              key: 'total',
              optional: false,
              shape: { type: 'integer', nullable: false },
            },
          ],
        },
      },
    };

    const docWithMappedSchema: Document = {
      ...doc,
      schemas: [...doc.schemas, mappedSchema],
    };

    const mapFilterElement: Element = {
      ...pipelineElement,
      id: 'map-filter-element',
      behavior: {
        kind: 'pipeline',
        version: 1,
        inputSchemaId: baseBehavior.inputSchemaId,
        outputSchemaId: mappedSchemaId,
        errorSchemaId: baseBehavior.errorSchemaId,
        inputPortId: baseBehavior.inputPortId,
        outputPortId: baseBehavior.outputPortId,
        errorPortId: baseBehavior.errorPortId,
        operations: [
          // Filter out rows where region == 'DROP'
          {
            id: 'filter-op',
            kind: 'filter',
            guard: {
              op: 'equals',
              left: { kind: 'read', source: 'input', path: ['region'] },
              right: { kind: 'literal', value: 'KEEP' },
            },
          },
          // Map to { code: region, total: amountMinor }
          {
            id: 'map-op',
            kind: 'map',
            fields: [
              {
                id: 'm1',
                targetKey: 'code',
                value: { kind: 'read', source: 'input', path: ['region'] },
              },
              {
                id: 'm2',
                targetKey: 'total',
                value: { kind: 'read', source: 'input', path: ['amountMinor'] },
              },
            ],
          },
        ],
      },
    };

    const rows: readonly Json[] = [
      { orderId: '1', region: 'DROP', amountMinor: 100 },
      { orderId: '2', region: 'KEEP', amountMinor: 200 },
    ];

    const res = runPipeline(docWithMappedSchema, mapFilterElement, rows, 'evt-mf', stubEvaluator);
    expect(isPipelineSuccess(res)).toBe(true);
    if (!isPipelineSuccess(res)) return;

    expect(res.success).toEqual([{ code: 'KEEP', total: 200 }]);
    expect(res.errors).toEqual([]);

    expect(res.rowOutcomes).toEqual([
      {
        elementId: 'map-filter-element',
        operationId: 'filter-op',
        inputRows: [{ inputEventId: 'evt-mf', index: 0 }],
        outcome: 'filtered',
        outputIndex: null,
        errorCode: null,
      },
      {
        elementId: 'map-filter-element',
        operationId: 'map-op',
        inputRows: [{ inputEventId: 'evt-mf', index: 1 }],
        outcome: 'emitted',
        outputIndex: 0,
        errorCode: null,
      },
    ]);
  });

  it('guarantees determinism: two runs produce identical canonical JSON', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];
    const inputFixture = doc.fixtures[0];
    const inputRows = inputFixture.value as readonly Json[];

    const run1 = runPipeline(doc, pipelineElement, inputRows, 'evt-det', stubEvaluator);
    const run2 = runPipeline(doc, pipelineElement, inputRows, 'evt-det', stubEvaluator);

    const c1 = canonicalJson(run1);
    const c2 = canonicalJson(run2);

    expect(c1.ok).toBe(true);
    expect(c2.ok).toBe(true);
    if (c1.ok && c2.ok) {
      expect(c1.text).toBe(c2.text);
    }
  });

  it('guarantees input rows are never mutated', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];

    const row1 = { orderId: 'a', region: ' EU ', amountMinor: 1000 };
    const row2 = { orderId: 'b', region: 'US', amountMinor: 2500 };
    const inputRows: readonly Json[] = [row1, row2];

    // Deep freeze input rows
    Object.freeze(row1);
    Object.freeze(row2);
    Object.freeze(inputRows);

    // Running pipeline over frozen objects must not throw
    const res = runPipeline(doc, pipelineElement, inputRows, 'evt-freeze', stubEvaluator);
    expect(isPipelineSuccess(res)).toBe(true);

    // row1.region remains untrimmed
    expect(row1.region).toBe(' EU ');
  });

  it('fails the run on whole-pipeline output schema mismatch', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];
    const baseBehavior = pipelineElement.behavior as PipelineBehavior;

    // Alter outputSchemaId to a schema requiring strings, but group-sum emits integers
    const mismatchElement: Element = {
      ...pipelineElement,
      behavior: {
        ...baseBehavior,
        outputSchemaId: '1bd74ce9-d2b7-5971-a0ed-6a782edb8237', // A record schema, whereas success is a list
      },
    };

    const res = runPipeline(
      doc,
      mismatchElement,
      [{ orderId: 'a', region: 'EU', amountMinor: 100 }],
      'evt-mismatch',
      stubEvaluator,
    );

    expect(res.ok).toBe(false);
    expect(res.status).toBe('failed');
    if (!res.ok) {
      expect(res.reason).toContain('failed schema validation');
    }
  });

  it('fails the run on whole-pipeline error schema mismatch', () => {
    const doc = loadS03Document();
    const pipelineElement = doc.elements[0];
    const baseBehavior = pipelineElement.behavior as PipelineBehavior;

    // Alter errorSchemaId to a record schema (1bd74ce9-d2b7-5971-a0ed-6a782edb8237) instead of list
    const mismatchElement: Element = {
      ...pipelineElement,
      behavior: {
        ...baseBehavior,
        errorSchemaId: '1bd74ce9-d2b7-5971-a0ed-6a782edb8237',
      },
    };

    // Row 'c' produces an error row
    const res = runPipeline(
      doc,
      mismatchElement,
      [{ orderId: 'c', region: 'EU', amountMinor: 'bad' }],
      'evt-err-mismatch',
      stubEvaluator,
    );

    expect(res.ok).toBe(false);
    expect(res.status).toBe('failed');
    if (!res.ok) {
      expect(res.reason).toContain('error output failed schema validation');
    }
  });
});

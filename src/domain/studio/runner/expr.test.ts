import { describe, it, expect } from 'vitest';
import { defaultEvaluator, readPath } from './expr';
import { isMissing, type EvalScope } from './expr-api';
import type { Guard, Value } from '../model';

describe('expr: readPath', () => {
  it('reads shallow and deep object paths', () => {
    const data = { a: { b: { c: 42 } } };
    expect(readPath(data, ['a', 'b', 'c'])).toBe(42);
    expect(readPath(data, ['a', 'b'])).toEqual({ c: 42 });
    expect(readPath(data, [])).toEqual(data);
  });

  it('reads array indices', () => {
    const data = { items: [{ id: 'x' }, { id: 'y' }] };
    expect(readPath(data, ['items', 0, 'id'])).toBe('x');
    expect(readPath(data, ['items', 1, 'id'])).toBe('y');
  });

  it('returns missingValue on non-existent object key', () => {
    const res = readPath({ a: 1 }, ['b']);
    expect(isMissing(res)).toBe(true);
    if (isMissing(res)) {
      expect(res.path).toEqual(['b']);
    }
  });

  it('returns missingValue on out of bounds array index', () => {
    const res = readPath([1, 2], [5]);
    expect(isMissing(res)).toBe(true);
  });

  it('returns missingValue on negative array index', () => {
    const res = readPath([1, 2], [-1]);
    expect(isMissing(res)).toBe(true);
  });

  it('returns missingValue on primitive stepping', () => {
    const res = readPath('string', ['prop']);
    expect(isMissing(res)).toBe(true);
  });

  it('returns missingValue on null stepping', () => {
    const res = readPath(null, ['prop']);
    expect(isMissing(res)).toBe(true);
  });

  it('preserves null as a valid JSON leaf value', () => {
    const res = readPath({ a: null }, ['a']);
    expect(res).toBeNull();
    expect(isMissing(res)).toBe(false);
  });

  it('prevents prototype key traversal', () => {
    expect(isMissing(readPath({}, ['__proto__']))).toBe(true);
    expect(isMissing(readPath({}, ['prototype']))).toBe(true);
    expect(isMissing(readPath({}, ['constructor']))).toBe(true);
  });
});

describe('expr: evalValue', () => {
  const evaluator = defaultEvaluator;
  const baseScope: EvalScope = {
    input: { requestId: 'req-1', count: 5 },
    context: { active: 'req-1', items: [{ sku: 'A', quantity: 2 }] },
    outcome: 'succeeded',
  };

  it('evaluates literal values', () => {
    expect(evaluator.evalValue({ kind: 'literal', value: 'hello' }, baseScope)).toEqual({
      ok: true,
      value: 'hello',
    });
    expect(evaluator.evalValue({ kind: 'literal', value: 123 }, baseScope)).toEqual({
      ok: true,
      value: 123,
    });
    expect(evaluator.evalValue({ kind: 'literal', value: null }, baseScope)).toEqual({
      ok: true,
      value: null,
    });
  });

  it('evaluates read values from input and context', () => {
    expect(
      evaluator.evalValue({ kind: 'read', source: 'input', path: ['requestId'] }, baseScope),
    ).toEqual({ ok: true, value: 'req-1' });

    expect(
      evaluator.evalValue({ kind: 'read', source: 'context', path: ['items', 0, 'quantity'] }, baseScope),
    ).toEqual({ ok: true, value: 2 });
  });

  it('evaluates read missing value as missingValue (does not throw or fail evalValue)', () => {
    const res = evaluator.evalValue(
      { kind: 'read', source: 'input', path: ['nonExistent'] },
      baseScope,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(isMissing(res.value)).toBe(true);
    }
  });

  it('evaluates outcome value', () => {
    expect(evaluator.evalValue({ kind: 'outcome' }, baseScope)).toEqual({
      ok: true,
      value: 'succeeded',
    });
    expect(evaluator.evalValue({ kind: 'outcome' }, { ...baseScope, outcome: null })).toEqual({
      ok: true,
      value: null,
    });
  });

  it('evaluates record constructor', () => {
    const val: Value = {
      kind: 'record',
      fields: [
        { key: 'reqId', value: { kind: 'read', source: 'input', path: ['requestId'] } },
        { key: 'static', value: { kind: 'literal', value: true } },
      ],
    };
    expect(evaluator.evalValue(val, baseScope)).toEqual({
      ok: true,
      value: { reqId: 'req-1', static: true },
    });
  });

  it('rejects duplicate keys in record constructor with modeled EvalError', () => {
    const val: Value = {
      kind: 'record',
      fields: [
        { key: 'dup', value: { kind: 'literal', value: 1 } },
        { key: 'dup', value: { kind: 'literal', value: 2 } },
      ],
    };
    const res = evaluator.evalValue(val, baseScope);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('duplicate-key');
      expect(res.error.path).toEqual(['dup']);
    }
  });

  it('rejects missing value in record field with modeled EvalError', () => {
    const val: Value = {
      kind: 'record',
      fields: [
        { key: 'missingField', value: { kind: 'read', source: 'input', path: ['missingKey'] } },
      ],
    };
    const res = evaluator.evalValue(val, baseScope);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('missing-value');
    }
  });

  it('evaluates list constructor', () => {
    const val: Value = {
      kind: 'list',
      items: [
        { kind: 'literal', value: 10 },
        { kind: 'read', source: 'input', path: ['count'] },
      ],
    };
    expect(evaluator.evalValue(val, baseScope)).toEqual({
      ok: true,
      value: [10, 5],
    });
  });

  it('rejects missing value in list items with modeled EvalError', () => {
    const val: Value = {
      kind: 'list',
      items: [{ kind: 'read', source: 'input', path: ['missing'] }],
    };
    const res = evaluator.evalValue(val, baseScope);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('missing-value');
      expect(res.error.path).toEqual([0]);
    }
  });
});

describe('expr: evalGuard', () => {
  const evaluator = defaultEvaluator;
  const baseScope: EvalScope = {
    input: { requestId: 'req-1', count: 5, emptyStr: '', zero: 0 },
    context: { active: 'req-1', items: [{ sku: 'A', quantity: 2 }] },
    outcome: 'succeeded',
  };

  it('exists guard returns true for existing values including null, false for missing', () => {
    expect(
      evaluator.evalGuard(
        { op: 'exists', value: { kind: 'read', source: 'input', path: ['requestId'] } },
        baseScope,
      ),
    ).toEqual({ ok: true, value: true });

    expect(
      evaluator.evalGuard(
        { op: 'exists', value: { kind: 'literal', value: null } },
        baseScope,
      ),
    ).toEqual({ ok: true, value: true });

    expect(
      evaluator.evalGuard(
        { op: 'exists', value: { kind: 'read', source: 'input', path: ['notHere'] } },
        baseScope,
      ),
    ).toEqual({ ok: true, value: false });
  });

  it('equals/notEquals uses canonical JSON equality without coercion', () => {
    // String vs number: no coercion!
    expect(
      evaluator.evalGuard(
        {
          op: 'equals',
          left: { kind: 'literal', value: '5' },
          right: { kind: 'literal', value: 5 },
        },
        baseScope,
      ),
    ).toEqual({ ok: true, value: false });

    // Object key order independence:
    expect(
      evaluator.evalGuard(
        {
          op: 'equals',
          left: { kind: 'literal', value: { a: 1, b: 2 } },
          right: { kind: 'literal', value: { b: 2, a: 1 } },
        },
        baseScope,
      ),
    ).toEqual({ ok: true, value: true });

    // notEquals:
    expect(
      evaluator.evalGuard(
        {
          op: 'notEquals',
          left: { kind: 'literal', value: 1 },
          right: { kind: 'literal', value: 2 },
        },
        baseScope,
      ),
    ).toEqual({ ok: true, value: true });
  });

  it('equals rejects missing values with modeled EvalError', () => {
    const res = evaluator.evalGuard(
      {
        op: 'equals',
        left: { kind: 'read', source: 'input', path: ['missing'] },
        right: { kind: 'literal', value: 'x' },
      },
      baseScope,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('missing-value');
    }
  });

  it('all and any guards require non-empty guards list', () => {
    const allRes = evaluator.evalGuard({ op: 'all', guards: [] }, baseScope);
    expect(allRes.ok).toBe(false);
    if (!allRes.ok) expect(allRes.error.code).toBe('empty-guards');

    const anyRes = evaluator.evalGuard({ op: 'any', guards: [] }, baseScope);
    expect(anyRes.ok).toBe(false);
    if (!anyRes.ok) expect(anyRes.error.code).toBe('empty-guards');
  });

  it('all guard evaluates sub-guards and short-circuits', () => {
    const guard: Guard = {
      op: 'all',
      guards: [
        { op: 'equals', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 1 } },
        { op: 'equals', left: { kind: 'literal', value: 2 }, right: { kind: 'literal', value: 2 } },
      ],
    };
    expect(evaluator.evalGuard(guard, baseScope)).toEqual({ ok: true, value: true });

    const failingGuard: Guard = {
      op: 'all',
      guards: [
        { op: 'equals', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 2 } },
        { op: 'equals', left: { kind: 'literal', value: 2 }, right: { kind: 'literal', value: 2 } },
      ],
    };
    expect(evaluator.evalGuard(failingGuard, baseScope)).toEqual({ ok: true, value: false });
  });

  it('any guard evaluates sub-guards and short-circuits', () => {
    const guard: Guard = {
      op: 'any',
      guards: [
        { op: 'equals', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 2 } },
        { op: 'equals', left: { kind: 'literal', value: 2 }, right: { kind: 'literal', value: 2 } },
      ],
    };
    expect(evaluator.evalGuard(guard, baseScope)).toEqual({ ok: true, value: true });

    const allFail: Guard = {
      op: 'any',
      guards: [
        { op: 'equals', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 2 } },
        { op: 'equals', left: { kind: 'literal', value: 3 }, right: { kind: 'literal', value: 4 } },
      ],
    };
    expect(evaluator.evalGuard(allFail, baseScope)).toEqual({ ok: true, value: false });
  });

  it('positiveInteger returns true for > 0, false for <= 0, and wrong-type for non-integers', () => {
    expect(
      evaluator.evalGuard(
        { op: 'positiveInteger', value: { kind: 'literal', value: 1 } },
        baseScope,
      ),
    ).toEqual({ ok: true, value: true });

    expect(
      evaluator.evalGuard(
        { op: 'positiveInteger', value: { kind: 'literal', value: 0 } },
        baseScope,
      ),
    ).toEqual({ ok: true, value: false });

    expect(
      evaluator.evalGuard(
        { op: 'positiveInteger', value: { kind: 'literal', value: -5 } },
        baseScope,
      ),
    ).toEqual({ ok: true, value: false });

    // String: wrong-type
    const strRes = evaluator.evalGuard(
      { op: 'positiveInteger', value: { kind: 'literal', value: '1' } },
      baseScope,
    );
    expect(strRes.ok).toBe(false);
    if (!strRes.ok) expect(strRes.error.code).toBe('wrong-type');

    // Float: wrong-type
    const floatRes = evaluator.evalGuard(
      { op: 'positiveInteger', value: { kind: 'literal', value: 1.5 } },
      baseScope,
    );
    expect(floatRes.ok).toBe(false);
    if (!floatRes.ok) expect(floatRes.error.code).toBe('wrong-type');
  });

  it('nonEmpty checks string, list, and record length, returning wrong-type for other types', () => {
    // String
    expect(
      evaluator.evalGuard({ op: 'nonEmpty', value: { kind: 'literal', value: 'abc' } }, baseScope),
    ).toEqual({ ok: true, value: true });
    expect(
      evaluator.evalGuard({ op: 'nonEmpty', value: { kind: 'literal', value: '' } }, baseScope),
    ).toEqual({ ok: true, value: false });

    // List
    expect(
      evaluator.evalGuard({ op: 'nonEmpty', value: { kind: 'literal', value: [1] } }, baseScope),
    ).toEqual({ ok: true, value: true });
    expect(
      evaluator.evalGuard({ op: 'nonEmpty', value: { kind: 'literal', value: [] } }, baseScope),
    ).toEqual({ ok: true, value: false });

    // Record
    expect(
      evaluator.evalGuard({ op: 'nonEmpty', value: { kind: 'literal', value: { x: 1 } } }, baseScope),
    ).toEqual({ ok: true, value: true });
    expect(
      evaluator.evalGuard({ op: 'nonEmpty', value: { kind: 'literal', value: {} } }, baseScope),
    ).toEqual({ ok: true, value: false });

    // Number: wrong-type
    const numRes = evaluator.evalGuard({ op: 'nonEmpty', value: { kind: 'literal', value: 123 } }, baseScope);
    expect(numRes.ok).toBe(false);
    if (!numRes.ok) expect(numRes.error.code).toBe('wrong-type');
  });

  it('every on an empty list is true (§4)', () => {
    const guard: Guard = {
      op: 'every',
      value: { kind: 'literal', value: [] },
      itemGuard: {
        op: 'positiveInteger',
        value: { kind: 'read', source: 'input', path: ['quantity'] },
      },
    };
    expect(evaluator.evalGuard(guard, baseScope)).toEqual({ ok: true, value: true });
  });

  it('every passes each item as input while keeping context unchanged', () => {
    const guard: Guard = {
      op: 'every',
      value: {
        kind: 'literal',
        value: [
          { sku: 'A', quantity: 1 },
          { sku: 'B', quantity: 2 },
        ],
      },
      itemGuard: {
        op: 'all',
        guards: [
          {
            op: 'positiveInteger',
            value: { kind: 'read', source: 'input', path: ['quantity'] },
          },
          {
            op: 'equals',
            left: { kind: 'read', source: 'context', path: ['active'] },
            right: { kind: 'literal', value: 'req-1' },
          },
        ],
      },
    };
    expect(evaluator.evalGuard(guard, baseScope)).toEqual({ ok: true, value: true });

    // Failing item:
    const failingGuard: Guard = {
      op: 'every',
      value: {
        kind: 'literal',
        value: [
          { sku: 'A', quantity: 1 },
          { sku: 'B', quantity: 0 },
        ],
      },
      itemGuard: {
        op: 'positiveInteger',
        value: { kind: 'read', source: 'input', path: ['quantity'] },
      },
    };
    expect(evaluator.evalGuard(failingGuard, baseScope)).toEqual({ ok: true, value: false });
  });

  it('every on a non-list returns wrong-type error', () => {
    const res = evaluator.evalGuard(
      {
        op: 'every',
        value: { kind: 'literal', value: 'not-a-list' },
        itemGuard: { op: 'exists', value: { kind: 'read', source: 'input', path: [] } },
      },
      baseScope,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('wrong-type');
  });
});

import { describe, it, expect } from 'vitest';
import { validateSchemaValue, isSchemaValueValid } from './schema-value';
import type { Shape } from '../model';

describe('schema-value validator', () => {
  it('validates scalar shapes', () => {
    const stringShape: Shape = { type: 'string', nullable: false };
    expect(isSchemaValueValid('hello', stringShape)).toBe(true);
    expect(isSchemaValueValid(123, stringShape)).toBe(false);
    expect(isSchemaValueValid(null, stringShape)).toBe(false);

    const nullableString: Shape = { type: 'string', nullable: true };
    expect(isSchemaValueValid(null, nullableString)).toBe(true);
    expect(isSchemaValueValid('world', nullableString)).toBe(true);

    const intShape: Shape = { type: 'integer', nullable: false };
    expect(isSchemaValueValid(42, intShape)).toBe(true);
    expect(isSchemaValueValid(42.5, intShape)).toBe(false);
    expect(isSchemaValueValid(NaN, intShape)).toBe(false);
    expect(isSchemaValueValid(Infinity, intShape)).toBe(false);

    const numberShape: Shape = { type: 'number', nullable: false };
    expect(isSchemaValueValid(42.5, numberShape)).toBe(true);
    expect(isSchemaValueValid(NaN, numberShape)).toBe(false);
    expect(isSchemaValueValid('10', numberShape)).toBe(false);

    const boolShape: Shape = { type: 'boolean', nullable: false };
    expect(isSchemaValueValid(true, boolShape)).toBe(true);
    expect(isSchemaValueValid(false, boolShape)).toBe(true);
    expect(isSchemaValueValid(1, boolShape)).toBe(false);
  });

  it('validates scalar-union shape', () => {
    const unionShape: Shape = {
      type: 'scalar-union',
      nullable: false,
      types: ['integer', 'string'],
    };

    expect(isSchemaValueValid(1000, unionShape)).toBe(true);
    expect(isSchemaValueValid('EU', unionShape)).toBe(true);
    expect(isSchemaValueValid(true, unionShape)).toBe(false);
    expect(isSchemaValueValid(10.5, unionShape)).toBe(false);
    expect(isSchemaValueValid(null, unionShape)).toBe(false);

    const nullableUnion: Shape = {
      type: 'scalar-union',
      nullable: true,
      types: ['integer', 'string'],
    };
    expect(isSchemaValueValid(null, nullableUnion)).toBe(true);
  });

  it('validates record shapes and rejects unknown properties (closed records)', () => {
    const recordShape: Shape = {
      type: 'record',
      nullable: false,
      fields: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          key: 'name',
          optional: false,
          shape: { type: 'string', nullable: false },
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          key: 'age',
          optional: true,
          shape: { type: 'integer', nullable: false },
        },
      ],
    };

    expect(isSchemaValueValid({ name: 'Alice', age: 30 }, recordShape)).toBe(true);
    expect(isSchemaValueValid({ name: 'Alice' }, recordShape)).toBe(true);

    // Missing required field
    const missingRes = validateSchemaValue({ age: 30 }, recordShape);
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.issues[0].code).toBe('missing-property');
      expect(missingRes.issues[0].path).toEqual(['name']);
    }

    // Unknown property rejected
    const unknownRes = validateSchemaValue({ name: 'Alice', extra: 'foo' }, recordShape);
    expect(unknownRes.ok).toBe(false);
    if (!unknownRes.ok) {
      expect(unknownRes.issues[0].code).toBe('unknown-property');
      expect(unknownRes.issues[0].path).toEqual(['extra']);
    }

    // Optional field present but null when not nullable
    const nullOptRes = validateSchemaValue({ name: 'Alice', age: null }, recordShape);
    expect(nullOptRes.ok).toBe(false);
    if (!nullOptRes.ok) {
      expect(nullOptRes.issues[0].code).toBe('wrong-type');
    }
  });

  it('validates list shapes and maxItems', () => {
    const listShape: Shape = {
      type: 'list',
      nullable: false,
      maxItems: 2,
      items: { type: 'string', nullable: false },
    };

    expect(isSchemaValueValid([], listShape)).toBe(true);
    expect(isSchemaValueValid(['a'], listShape)).toBe(true);
    expect(isSchemaValueValid(['a', 'b'], listShape)).toBe(true);

    const tooMany = validateSchemaValue(['a', 'b', 'c'], listShape);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.issues[0].code).toBe('too-many');
    }

    const wrongItem = validateSchemaValue(['a', 123], listShape);
    expect(wrongItem.ok).toBe(false);
    if (!wrongItem.ok) {
      expect(wrongItem.issues[0].code).toBe('wrong-type');
      expect(wrongItem.issues[0].path).toEqual([1]);
    }
  });
});

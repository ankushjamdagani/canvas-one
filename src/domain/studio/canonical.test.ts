import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalJson, sha256Hex } from './canonical';

/**
 * Note: Manifest-level vectors (layout-only change, entity storage reorder,
 * omitted vs materialized default, reordered input events) wait for the manifest builder
 * as specified in run-identity.md §2 and §3.
 */

describe('canonical-json-v1 golden vectors and encoding', () => {
  it('produces equal canonical output and hash for reordered keys', async () => {
    const obj1 = { z: 1, a: 2, m: 3 };
    const obj2 = { a: 2, m: 3, z: 1 };
    const obj3 = { m: 3, z: 1, a: 2 };

    // Hand-crafted expected canonical JSON string (keys sorted by UTF-16 code units: a, m, z)
    const expectedText = '{"a":2,"m":3,"z":1}';
    const expectedHash = createHash('sha256').update(expectedText, 'utf8').digest('hex');

    const res1 = canonicalJson(obj1);
    const res2 = canonicalJson(obj2);
    const res3 = canonicalJson(obj3);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res3.ok).toBe(true);

    if (res1.ok && res2.ok && res3.ok) {
      expect(res1.text).toBe(expectedText);
      expect(res2.text).toBe(expectedText);
      expect(res3.text).toBe(expectedText);

      expect(res1.bytes).toBe(expectedText.length);
      expect(res2.bytes).toBe(expectedText.length);
      expect(res3.bytes).toBe(expectedText.length);

      expect(await sha256Hex(res1.text)).toBe(expectedHash);
      expect(await sha256Hex(res2.text)).toBe(expectedHash);
      expect(await sha256Hex(res3.text)).toBe(expectedHash);
    }
  });

  it('serializes -0 and 0 identically', async () => {
    const objNegZero = { zero: -0 };
    const objPosZero = { zero: 0 };

    const expectedText = '{"zero":0}';
    const expectedHash = createHash('sha256').update(expectedText, 'utf8').digest('hex');

    const resNeg = canonicalJson(objNegZero);
    const resPos = canonicalJson(objPosZero);

    expect(resNeg.ok).toBe(true);
    expect(resPos.ok).toBe(true);

    if (resNeg.ok && resPos.ok) {
      expect(resNeg.text).toBe(expectedText);
      expect(resPos.text).toBe(expectedText);
      expect(await sha256Hex(resNeg.text)).toBe(expectedHash);
      expect(await sha256Hex(resPos.text)).toBe(expectedHash);
    }
  });

  it('sorts keys strictly by UTF-16 code units (plain < / > comparison, NOT localeCompare)', async () => {
    // UTF-16 code unit values:
    // 'B'  = 0x0042 (66)
    // 'a'  = 0x0061 (97)
    // 'b'  = 0x0062 (98)
    // 'é'  = 0x00E9 (233)
    // '😀' = 0xD83D (55357), 0xDE00 (56832)
    // 'ﬁ'  = 0xFB01 (64257)
    // Expected order: 'B' < 'a' < 'b' < 'é' < '😀' < 'ﬁ'
    const input = {
      b: 1,
      a: 2,
      B: 3,
      é: 4,
      '😀': 5,
      'ﬁ': 6,
    };

    const expectedText = '{"B":3,"a":2,"b":1,"é":4,"😀":5,"ﬁ":6}';
    const expectedHash = createHash('sha256').update(expectedText, 'utf8').digest('hex');

    const res = canonicalJson(input);
    expect(res.ok).toBe(true);

    if (res.ok) {
      expect(res.text).toBe(expectedText);
      expect(res.bytes).toBe(new TextEncoder().encode(expectedText).length);
      expect(await sha256Hex(res.text)).toBe(expectedHash);
    }
  });

  it('preserves array order and differentiates reordered array elements', async () => {
    const arr1 = [1, 2, 3];
    const arr2 = [3, 2, 1];

    const expected1 = '[1,2,3]';
    const expected2 = '[3,2,1]';

    const hash1 = createHash('sha256').update(expected1, 'utf8').digest('hex');
    const hash2 = createHash('sha256').update(expected2, 'utf8').digest('hex');

    const res1 = canonicalJson(arr1);
    const res2 = canonicalJson(arr2);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);

    if (res1.ok && res2.ok) {
      expect(res1.text).toBe(expected1);
      expect(res2.text).toBe(expected2);
      expect(res1.text).not.toBe(res2.text);

      expect(await sha256Hex(res1.text)).toBe(hash1);
      expect(await sha256Hex(res2.text)).toBe(hash2);
      expect(hash1).not.toBe(hash2);
    }
  });

  it('matches JSON.stringify escaping for quotes, backslash, control chars, and emoji', async () => {
    const val = {
      backslash: 'path\\to\\file',
      control: '\b\f\n\r\t',
      emoji: '😀🎉',
      quote: 'hello "world"',
    };

    // Expected keys alphabetically sorted: backslash, control, emoji, quote
    const expectedText =
      '{"backslash":"path\\\\to\\\\file","control":"\\b\\f\\n\\r\\t","emoji":"😀🎉","quote":"hello \\"world\\""}';
    const expectedHash = createHash('sha256').update(expectedText, 'utf8').digest('hex');

    const res = canonicalJson(val);
    expect(res.ok).toBe(true);

    if (res.ok) {
      expect(res.text).toBe(expectedText);
      expect(res.bytes).toBe(new TextEncoder().encode(expectedText).length);
      expect(await sha256Hex(res.text)).toBe(expectedHash);
    }
  });

  it('rejects disallowed types and malformed structures', () => {
    // NaN
    const resNaN = canonicalJson({ v: NaN });
    expect(resNaN.ok).toBe(false);
    if (!resNaN.ok) {
      expect(resNaN.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // Infinity
    const resInf = canonicalJson({ v: Infinity });
    expect(resInf.ok).toBe(false);
    if (!resInf.ok) {
      expect(resInf.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // -Infinity
    const resNegInf = canonicalJson({ v: -Infinity });
    expect(resNegInf.ok).toBe(false);
    if (!resNegInf.ok) {
      expect(resNegInf.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // BigInt
    const resBigInt = canonicalJson({ v: 12345678901234567890n });
    expect(resBigInt.ok).toBe(false);
    if (!resBigInt.ok) {
      expect(resBigInt.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // undefined property
    const resUndefProp = canonicalJson({ v: undefined });
    expect(resUndefProp.ok).toBe(false);
    if (!resUndefProp.ok) {
      expect(resUndefProp.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // function
    const resFunc = canonicalJson({ v: () => 42 });
    expect(resFunc.ok).toBe(false);
    if (!resFunc.ok) {
      expect(resFunc.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // lone surrogate \uD800
    const resSurrogate = canonicalJson({ v: 'hello \uD800 world' });
    expect(resSurrogate.ok).toBe(false);
    if (!resSurrogate.ok) {
      expect(resSurrogate.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // sparse array
    const sparse = [1, , 3]; // eslint-disable-line no-sparse-arrays
    const resSparse = canonicalJson(sparse);
    expect(resSparse.ok).toBe(false);
    if (!resSparse.ok) {
      expect(resSparse.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: [1] }),
      ]);
    }

    // Date
    const resDate = canonicalJson({ v: new Date() });
    expect(resDate.ok).toBe(false);
    if (!resDate.ok) {
      expect(resDate.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // Map
    const resMap = canonicalJson({ v: new Map() });
    expect(resMap.ok).toBe(false);
    if (!resMap.ok) {
      expect(resMap.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }

    // class instance
    class CustomClass {
      readonly prop = 'value';
    }
    const resClass = canonicalJson({ v: new CustomClass() });
    expect(resClass.ok).toBe(false);
    if (!resClass.ok) {
      expect(resClass.issues).toEqual([
        expect.objectContaining({ code: 'wrong-type', path: ['v'] }),
      ]);
    }
  });

  it('handles 200,000-deep nested array iteratively without call stack overflow', () => {
    // Build 200,000 deep nested array
    let deep: unknown[] = [];
    for (let i = 0; i < 200000; i++) {
      deep = [deep];
    }

    // Must not throw, returns ok
    const res = canonicalJson(deep);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // 200001 '[' and 200001 ']'
      expect(res.bytes).toBe(400002);
    }

    // With maxBytes, fails with too-large without building the full string
    const resMax = canonicalJson(deep, 100);
    expect(resMax.ok).toBe(false);
    if (!resMax.ok) {
      expect(resMax.issues).toEqual([
        expect.objectContaining({ code: 'too-large', path: [] }),
      ]);
    }
  });

  it('stops early with too-large when maxBytes exceeded', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ id: i, label: `item-${i}` }));
    const res = canonicalJson(items, 60);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toEqual([
        expect.objectContaining({ code: 'too-large', path: [] }),
      ]);
    }
  });

  it('matches frozen vector for sha256Hex of empty string', async () => {
    const hash = await sha256Hex('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

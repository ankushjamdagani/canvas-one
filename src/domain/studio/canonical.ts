/**
 * canonical-json-v1 encoder and cryptographic utilities.
 *
 * Rules:
 * 1. Object keys sorted by UTF-16 code units (plain < / > comparison, NOT localeCompare), no whitespace.
 * 2. Strings use JSON.stringify escaping. Unpaired surrogates are rejected; valid Unicode is preserved exactly.
 * 3. Numbers must be finite, serialized with JSON.stringify, with -0 -> 0.
 *    Rejects NaN, Infinity, BigInt, undefined, functions, symbols, sparse arrays, and non-plain objects.
 *
 * Manifest entity-set sorting and default materialization live in manifest.ts.
 */

import type { Issue } from './validate';
import { errorIssue } from './issue';

/**
 * Checks whether a string contains any unpaired Unicode surrogates.
 */
function hasUnpairedSurrogate(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= str.length) return true;
      const next = str.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Computes UTF-8 byte length for a string token without allocating a Uint8Array.
 * Precondition: string contains no unpaired surrogates.
 */
function getUtf8ByteLength(str: string): number {
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

interface ArrayFrame {
  readonly kind: 'array';
  readonly arr: unknown[];
  index: number;
}

interface ObjectFrame {
  readonly kind: 'object';
  readonly obj: Record<string, unknown>;
  readonly keys: readonly string[];
  index: number;
  state: 'key' | 'value';
}

type StackFrame = ArrayFrame | ObjectFrame;

/**
 * Serializes a value into canonical-json-v1 format.
 *
 * Iterative implementation using an explicit stack to support arbitrary nesting
 * depths (e.g. 200,000 deep) without call-stack overflow.
 *
 * If maxBytes is provided, terminates early with 'too-large' issue as soon as
 * accumulated bytes exceed maxBytes without constructing the full string.
 */
export function canonicalJson(
  value: unknown,
  maxBytes?: number,
  basePath: readonly (string | number)[] = [],
): { ok: true; text: string; bytes: number } | { ok: false; issues: Issue[] } {
  const chunks: string[] = [];
  let accumulatedBytes = 0;
  const currentPath: (string | number)[] = [...basePath];
  const activeAncestors = new Set<unknown>();
  const stack: StackFrame[] = [];

  function appendToken(token: string): boolean {
    const tokenBytes = getUtf8ByteLength(token);
    if (maxBytes !== undefined && accumulatedBytes + tokenBytes > maxBytes) {
      return false;
    }
    accumulatedBytes += tokenBytes;
    chunks.push(token);
    return true;
  }

  function makeTooLargeIssue(): { ok: false; issues: Issue[] } {
    return {
      ok: false,
      issues: [
        errorIssue('too-large', [...basePath], null, `Canonical JSON byte length exceeds maximum limit of ${maxBytes} bytes`),
      ],
    };
  }

  function processValue(val: unknown): 'ok' | 'too-large' | Issue {
    if (val === undefined) {
      return errorIssue('wrong-type', [...currentPath], null, 'Disallowed undefined value in canonical JSON');
    }

    if (val === null) {
      if (!appendToken('null')) return 'too-large';
      return 'ok';
    }

    if (typeof val === 'boolean') {
      if (!appendToken(val ? 'true' : 'false')) return 'too-large';
      return 'ok';
    }

    if (typeof val === 'number') {
      if (!Number.isFinite(val)) {
        return errorIssue('wrong-type', [...currentPath], null, `Disallowed non-finite number: ${val}`);
      }
      const str = Object.is(val, -0) ? '0' : JSON.stringify(val);
      if (!appendToken(str)) return 'too-large';
      return 'ok';
    }

    if (typeof val === 'string') {
      if (hasUnpairedSurrogate(val)) {
        return errorIssue('wrong-type', [...currentPath], null, 'String contains unpaired Unicode surrogates');
      }
      const str = JSON.stringify(val);
      if (!appendToken(str)) return 'too-large';
      return 'ok';
    }

    if (typeof val === 'bigint') {
      return errorIssue('wrong-type', [...currentPath], null, 'Disallowed BigInt value in canonical JSON');
    }

    if (typeof val === 'symbol') {
      return errorIssue('wrong-type', [...currentPath], null, 'Disallowed Symbol value in canonical JSON');
    }

    if (typeof val === 'function') {
      return errorIssue('wrong-type', [...currentPath], null, 'Disallowed Function value in canonical JSON');
    }

    if (typeof val === 'object') {
      if (activeAncestors.has(val)) {
        return errorIssue('structural-rule', [...currentPath], null, 'Circular structure detected in canonical JSON value');
      }

      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (!Object.hasOwn(val, i)) {
            return errorIssue('wrong-type', [...currentPath, i], null, `Sparse array with hole at index ${i} is not allowed`);
          }
        }

        if (!appendToken('[')) return 'too-large';

        if (val.length === 0) {
          if (!appendToken(']')) return 'too-large';
          return 'ok';
        }

        activeAncestors.add(val);
        stack.push({ kind: 'array', arr: val, index: 0 });
        return 'ok';
      } else {
        const proto = Object.getPrototypeOf(val);
        if (proto !== Object.prototype && proto !== null) {
          return errorIssue('wrong-type', [...currentPath], null, 'Disallowed non-plain object in canonical JSON');
        }

        if (Object.getOwnPropertySymbols(val).length > 0) {
          return errorIssue('wrong-type', [...currentPath], null, 'Disallowed Symbol property in canonical JSON object');
        }

        const keys = Object.keys(val as Record<string, unknown>);
        // Sort keys strictly by UTF-16 code units using plain < / >
        keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        for (const k of keys) {
          if (hasUnpairedSurrogate(k)) {
            return errorIssue('wrong-type', [...currentPath, k], null, `Object key '${k}' contains unpaired Unicode surrogates`);
          }
        }

        if (!appendToken('{')) return 'too-large';

        if (keys.length === 0) {
          if (!appendToken('}')) return 'too-large';
          return 'ok';
        }

        activeAncestors.add(val);
        stack.push({
          kind: 'object',
          obj: val as Record<string, unknown>,
          keys,
          index: 0,
          state: 'key',
        });
        return 'ok';
      }
    }

    return errorIssue('wrong-type', [...currentPath], null, `Disallowed value of type ${typeof val} in canonical JSON`);
  }

  // Process root value
  const rootRes = processValue(value);
  if (rootRes === 'too-large') {
    return makeTooLargeIssue();
  }
  if (rootRes !== 'ok') {
    return { ok: false, issues: [rootRes] };
  }

  // Process container frames iteratively
  while (stack.length > 0) {
    const top = stack[stack.length - 1];

    if (top.kind === 'array') {
      if (top.index >= top.arr.length) {
        if (!appendToken(']')) {
          return makeTooLargeIssue();
        }
        activeAncestors.delete(top.arr);
        stack.pop();
        if (stack.length > 0) {
          currentPath.pop();
          const parent = stack[stack.length - 1];
          if (parent.kind === 'array') {
            parent.index++;
          } else {
            parent.index++;
            parent.state = 'key';
          }
        }
        continue;
      }

      if (top.index > 0) {
        if (!appendToken(',')) {
          return makeTooLargeIssue();
        }
      }

      currentPath.push(top.index);
      const child = top.arr[top.index];
      const res = processValue(child);

      if (res === 'too-large') {
        return makeTooLargeIssue();
      }
      if (res !== 'ok') {
        return { ok: false, issues: [res] };
      }

      if (stack[stack.length - 1] === top) {
        currentPath.pop();
        top.index++;
      }
    } else {
      if (top.index >= top.keys.length) {
        if (!appendToken('}')) {
          return makeTooLargeIssue();
        }
        activeAncestors.delete(top.obj);
        stack.pop();
        if (stack.length > 0) {
          currentPath.pop();
          const parent = stack[stack.length - 1];
          if (parent.kind === 'array') {
            parent.index++;
          } else {
            parent.index++;
            parent.state = 'key';
          }
        }
        continue;
      }

      if (top.index > 0) {
        if (!appendToken(',')) {
          return makeTooLargeIssue();
        }
      }

      const k = top.keys[top.index];
      if (!appendToken(JSON.stringify(k) + ':')) {
        return makeTooLargeIssue();
      }

      currentPath.push(k);
      top.state = 'value';
      const child = top.obj[k];
      const res = processValue(child);

      if (res === 'too-large') {
        return makeTooLargeIssue();
      }
      if (res !== 'ok') {
        return { ok: false, issues: [res] };
      }

      if (stack[stack.length - 1] === top) {
        currentPath.pop();
        top.index++;
        top.state = 'key';
      }
    }
  }

  const text = chunks.join('');
  const bytes = new TextEncoder().encode(text).length;
  return { ok: true, text, bytes };
}

/**
 * Computes lowercase hex SHA-256 digest of UTF-8 encoded text using Web Crypto API.
 */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto (crypto.subtle) is unavailable');
  }
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

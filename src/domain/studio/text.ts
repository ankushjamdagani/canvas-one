/** Keys that must never be accepted as own properties of authored or run data. */
export const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

/** True when `str` has no unpaired UTF-16 surrogates. */
export function isSurrogateValid(str: string): boolean {
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

/** Length in Unicode code points (not UTF-16 units). */
export function codePointLength(str: string): number {
  return [...str].length;
}

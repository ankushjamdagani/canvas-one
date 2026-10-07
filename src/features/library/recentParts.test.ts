import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECENT_PARTS_LIMIT, readRecentParts, rememberPart } from './recentParts';

const store = new Map<string, string>();

describe('recentParts', () => {
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('puts the latest placement first and de-duplicates', () => {
    rememberPart('a');
    rememberPart('b');
    expect(rememberPart('a')).toEqual(['a', 'b']);
    expect(readRecentParts()).toEqual(['a', 'b']);
  });

  it('caps the list', () => {
    for (let i = 0; i < RECENT_PARTS_LIMIT + 3; i++) rememberPart(`p${i}`);
    expect(readRecentParts()).toHaveLength(RECENT_PARTS_LIMIT);
  });

  it('tolerates corrupt or unavailable storage', () => {
    store.set('studio.recentParts', '{not json');
    expect(readRecentParts()).toEqual([]);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(readRecentParts()).toEqual([]);
    expect(rememberPart('x')).toEqual(['x']);
  });
});

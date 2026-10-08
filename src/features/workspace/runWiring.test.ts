import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeSessionRunDisabledReason,
  readScenarioSelection,
  resolveSelectedScenarioId,
  scenarioSelectionStorageKey,
  writeScenarioSelection,
} from './runWiring';

/**
 * The vitest config runs these tests in a plain node environment (no jsdom),
 * so there is no global `localStorage`. Install a minimal in-memory
 * implementation for these tests only; production code runs in the browser
 * where the real Web Storage API is present.
 */
function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('resolveSelectedScenarioId (selection fallback)', () => {
  it('keeps the stored id when it is still present', () => {
    expect(resolveSelectedScenarioId('b', ['a', 'b', 'c'])).toBe('b');
  });

  it('falls back to the first scenario in document order when the stored id is missing', () => {
    expect(resolveSelectedScenarioId('deleted-id', ['a', 'b', 'c'])).toBe('a');
  });

  it('falls back to the first scenario in document order when nothing is stored', () => {
    expect(resolveSelectedScenarioId(null, ['a', 'b', 'c'])).toBe('a');
  });

  it('returns no selection when the document has no scenarios', () => {
    expect(resolveSelectedScenarioId('a', [])).toBeNull();
    expect(resolveSelectedScenarioId(null, [])).toBeNull();
  });
});

describe('scenario selection storage (per-browser, keyed by project+branch)', () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it('round-trips through localStorage keyed by project and branch', () => {
    writeScenarioSelection('proj-1', 'branch-1', 'scn-1');
    expect(readScenarioSelection('proj-1', 'branch-1')).toBe('scn-1');
    // A different branch on the same project has its own preference.
    expect(readScenarioSelection('proj-1', 'branch-2')).toBeNull();
  });

  it('uses a key namespaced by project and branch', () => {
    expect(scenarioSelectionStorageKey('p', 'b')).toBe('system-studio.scenario-selection.p.b');
  });

  it('never throws when storage access fails', () => {
    const original = globalThis.localStorage;
    // @ts-expect-error -- simulate storage being unavailable (private browsing, etc.)
    globalThis.localStorage = {
      getItem() {
        throw new Error('storage disabled');
      },
      setItem() {
        throw new Error('storage disabled');
      },
    };
    try {
      expect(() => writeScenarioSelection('p', 'b', 's')).not.toThrow();
      expect(readScenarioSelection('p', 'b')).toBeNull();
    } finally {
      globalThis.localStorage = original;
    }
  });
});

describe('computeSessionRunDisabledReason', () => {
  it('is null when the session is ready and does not need a reload', () => {
    expect(computeSessionRunDisabledReason('ready', false)).toBeNull();
  });

  it('reports a reason while the session is saving', () => {
    expect(computeSessionRunDisabledReason('saving', false)).toBe('Saving…');
  });

  it('reports a reason while the session is loading', () => {
    expect(computeSessionRunDisabledReason('loading', false)).toBe('Loading…');
  });

  it('needsReload takes priority over other statuses', () => {
    expect(computeSessionRunDisabledReason('ready', true)).toBe('Reload the project before running');
    expect(computeSessionRunDisabledReason('saving', true)).toBe('Reload the project before running');
  });
});

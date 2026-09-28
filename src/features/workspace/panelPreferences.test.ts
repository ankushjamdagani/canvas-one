import { describe, expect, it, vi } from 'vitest';
import type { PreferenceRecord, SavePreferencesResult } from '../../persistence/studio/types';
import { createInitialPanelState, type WorkspacePanelPreferences } from './panels';
import {
  hydratePanelState,
  isLatestPanelPreferenceRequest,
  panelPreferencesFromState,
  readWorkspacePanelPreferences,
  WorkspacePanelPreferenceStore,
} from './panelPreferences';

const savedPanels: WorkspacePanelPreferences = {
  panels: {
    library: {
      open: true,
      placement: 'right',
      collapsed: false,
      floatRect: { x: 20, y: 60, width: 360, height: 480 },
      stackOrder: 1,
    },
    history: {
      open: false,
      placement: 'left',
      collapsed: true,
      floatRect: { x: 30, y: 70, width: 360, height: 480 },
      stackOrder: 0,
    },
  },
  sideWidths: { left: 300, right: 420 },
};

function preferenceRecord(revision: number, value: unknown): PreferenceRecord {
  return { key: 'user', schema: 'studio-preferences/1', revision, value };
}

describe('workspace panel preferences', () => {
  it('accepts the contracted panel fields and rejects incomplete or out-of-range values', () => {
    expect(readWorkspacePanelPreferences(savedPanels)).toEqual(savedPanels);
    expect(readWorkspacePanelPreferences({ panels: savedPanels.panels })).toBeNull();
    expect(readWorkspacePanelPreferences({ ...savedPanels, sideWidths: { left: 279, right: 320 } })).toBeNull();
  });

  it('hydrates only persistent fields and retains runtime state', () => {
    const state = createInitialPanelState({
      focusedPanel: 'history',
      activeOverlay: 'history',
      viewport: { width: 390, height: 844 },
      lastFocusedSequence: { library: 4, history: 7 },
    });
    const hydrated = hydratePanelState(state, savedPanels);
    expect(panelPreferencesFromState(hydrated)).toEqual(savedPanels);
    expect(hydrated.focusedPanel).toBe('history');
    expect(hydrated.activeOverlay).toBe('history');
    expect(hydrated.viewport).toEqual({ width: 390, height: 844 });
    expect(hydrated.lastFocusedSequence).toEqual({ library: 4, history: 7 });
  });

  it('rolls back only the latest outstanding request', () => {
    const requestA = 1;
    const requestB = 2;
    expect(isLatestPanelPreferenceRequest(requestA, requestB)).toBe(false);
    expect(isLatestPanelPreferenceRequest(requestB, requestB)).toBe(true);
  });

  it('serializes saves and preserves unrelated preference fields', async () => {
    let record: PreferenceRecord | null = preferenceRecord(2, {
      dock: { orderedCommandIds: ['canvas.fit'], hiddenCommandIds: [] },
      cameras: [{ projectId: 'project', viewId: 'view', x: 0, y: 0, zoom: 1 }],
    });
    let active = 0;
    let maxActive = 0;
    const values: unknown[] = [];
    const repository = {
      loadPreferences: async () => structuredClone(record),
      savePreferences: async (expectedRevision: number, value: unknown): Promise<SavePreferencesResult> => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        values.push(structuredClone(value));
        record = preferenceRecord(expectedRevision + 1, value);
        active -= 1;
        return { status: 'applied', revision: expectedRevision + 1, value };
      },
    };
    const store = new WorkspacePanelPreferenceStore(repository);
    await store.load();
    await Promise.all([store.save(savedPanels), store.save({ ...savedPanels, sideWidths: { left: 340, right: 360 } })]);

    expect(maxActive).toBe(1);
    expect(values).toHaveLength(2);
    expect(values[1]).toMatchObject({
      dock: { orderedCommandIds: ['canvas.fit'], hiddenCommandIds: [] },
      cameras: [{ projectId: 'project', viewId: 'view', x: 0, y: 0, zoom: 1 }],
      sideWidths: { left: 340, right: 360 },
    });
  });

  it('adopts durable state on stale and discards writes already queued behind it', async () => {
    const durable = { ...savedPanels, sideWidths: { left: 440, right: 280 } };
    let loads = 0;
    let saves = 0;
    const repository = {
      loadPreferences: async () => {
        loads += 1;
        return loads === 1 ? preferenceRecord(1, savedPanels) : preferenceRecord(2, durable);
      },
      savePreferences: async (): Promise<SavePreferencesResult> => {
        saves += 1;
        return { status: 'stale', scope: 'preferences', expected: 1, actual: 2 };
      },
    };
    const store = new WorkspacePanelPreferenceStore(repository);
    await store.load();
    const first = store.save({ ...savedPanels, sideWidths: { left: 300, right: 300 } });
    const queued = store.save({ ...savedPanels, sideWidths: { left: 320, right: 320 } });

    await expect(first).resolves.toEqual({ status: 'stale', preferences: durable });
    store.acknowledgeCurrentDisplayed();
    await expect(queued).resolves.toEqual({ status: 'superseded' });
    expect(saves).toBe(1);
  });

  it('blocks an action submitted while the stale durable state is still loading', async () => {
    const durable = { ...savedPanels, sideWidths: { left: 440, right: 280 } };
    let resolveReload!: (record: PreferenceRecord) => void;
    const reload = new Promise<PreferenceRecord>((resolve) => {
      resolveReload = resolve;
    });
    let loads = 0;
    let saves = 0;
    const repository = {
      loadPreferences: async () => {
        loads += 1;
        return loads === 1 ? preferenceRecord(1, savedPanels) : reload;
      },
      savePreferences: async (): Promise<SavePreferencesResult> => {
        saves += 1;
        return { status: 'stale', scope: 'preferences', expected: 1, actual: 2 };
      },
    };
    const store = new WorkspacePanelPreferenceStore(repository);
    await store.load();
    const stale = store.save({ ...savedPanels, sideWidths: { left: 300, right: 300 } });
    await vi.waitFor(() => expect(loads).toBe(2));
    const duringReload = store.save({ ...savedPanels, sideWidths: { left: 320, right: 320 } });
    resolveReload(preferenceRecord(2, durable));

    await expect(stale).resolves.toEqual({ status: 'stale', preferences: durable });
    store.acknowledgeCurrentDisplayed();
    await expect(duringReload).resolves.toEqual({ status: 'superseded' });
    expect(saves).toBe(1);
  });

  it('reports the last durable layout on save failure and retries a rejected initial load', async () => {
    let loads = 0;
    const repository = {
      loadPreferences: async () => {
        loads += 1;
        if (loads === 1) throw new Error('unavailable');
        return preferenceRecord(3, savedPanels);
      },
      savePreferences: async (): Promise<SavePreferencesResult> => ({
        status: 'failed',
        code: 'quota',
        issues: [],
      }),
    };
    const store = new WorkspacePanelPreferenceStore(repository);
    await expect(store.load()).rejects.toThrow('unavailable');

    const recovered = await store.save({ ...savedPanels, sideWidths: { left: 300, right: 300 } });
    expect(recovered).toEqual({ status: 'stale', preferences: savedPanels });
    store.acknowledgeCurrentDisplayed();

    const failed = await store.save({ ...savedPanels, sideWidths: { left: 300, right: 300 } });
    expect(failed).toEqual({
      status: 'failed',
      result: { status: 'failed', code: 'quota', issues: [] },
      preferences: savedPanels,
    });
    expect(loads).toBe(2);
  });
});

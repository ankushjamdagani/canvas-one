import type {
  PreferenceRecord,
  SavePreferencesResult,
  StudioRepository,
} from '../../persistence/studio/types';
import {
  MAX_SIDE_WIDTH,
  MIN_SIDE_WIDTH,
  type PanelPreference,
  type WorkspacePanelPreferences,
  type WorkspacePanelState,
} from './panels';

type PreferenceValue = Readonly<Record<string, unknown>>;

export type PanelPreferenceLoad = {
  readonly revision: number;
  readonly preferences: WorkspacePanelPreferences | null;
};

export type PanelPreferenceSave =
  | { readonly status: 'applied'; readonly revision: number }
  | { readonly status: 'stale'; readonly preferences: WorkspacePanelPreferences | null }
  | {
      readonly status: 'failed';
      readonly result: Exclude<SavePreferencesResult, { status: 'applied' } | { status: 'stale' }>;
      readonly preferences: WorkspacePanelPreferences | null;
    }
  | { readonly status: 'superseded' }
  | { readonly status: 'invalid-stored-value' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readPanelPreference(value: unknown): PanelPreference | null {
  if (!isRecord(value)) return null;
  if (typeof value.open !== 'boolean' || typeof value.collapsed !== 'boolean') return null;
  if (value.placement !== 'left' && value.placement !== 'right' && value.placement !== 'floating') {
    return null;
  }
  if (!isNonNegativeSafeInteger(value.stackOrder)) return null;
  if (!isRecord(value.floatRect)) return null;
  const { x, y, width, height } = value.floatRect;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    open: value.open,
    placement: value.placement,
    collapsed: value.collapsed,
    floatRect: { x, y, width, height },
    stackOrder: value.stackOrder,
  };
}

/** Reads only the panel-owned fields from the shared preference value. */
export function readWorkspacePanelPreferences(value: unknown): WorkspacePanelPreferences | null {
  if (!isRecord(value) || !isRecord(value.panels) || !isRecord(value.sideWidths)) return null;
  const library = readPanelPreference(value.panels.library);
  const history = readPanelPreference(value.panels.history);
  const { left, right } = value.sideWidths;
  if (
    !library ||
    !history ||
    !isFiniteNumber(left) ||
    !isFiniteNumber(right) ||
    left < MIN_SIDE_WIDTH ||
    left > MAX_SIDE_WIDTH ||
    right < MIN_SIDE_WIDTH ||
    right > MAX_SIDE_WIDTH
  ) {
    return null;
  }
  return {
    panels: { library, history },
    sideWidths: { left, right },
  };
}

export function panelPreferencesFromState(state: WorkspacePanelState): WorkspacePanelPreferences {
  return structuredClone({ panels: state.panels, sideWidths: state.sideWidths });
}

export function isLatestPanelPreferenceRequest(
  requestSequence: number,
  latestRequestSequence: number,
): boolean {
  return requestSequence === latestRequestSequence;
}

/** Replaces persistent fields while retaining viewport, focus and gesture state. */
export function hydratePanelState(
  state: WorkspacePanelState,
  preferences: WorkspacePanelPreferences,
): WorkspacePanelState {
  return {
    ...state,
    panels: structuredClone(preferences.panels),
    sideWidths: structuredClone(preferences.sideWidths),
  };
}

function mergePreferenceValue(
  current: unknown,
  preferences: WorkspacePanelPreferences,
): PreferenceValue | null {
  if (current !== null && !isRecord(current)) return null;
  return {
    ...(current ?? {}),
    panels: structuredClone(preferences.panels),
    sideWidths: structuredClone(preferences.sideWidths),
  };
}

/**
 * Serializes the independent preference CAS stream. A stale result establishes
 * a barrier: writes already queued behind it are discarded, and only a later
 * user action may save again after the durable state has been displayed.
 */
export class WorkspacePanelPreferenceStore {
  private revision = 0;
  private value: unknown = null;
  private durablePreferences: WorkspacePanelPreferences | null = null;
  private loaded = false;
  private loadPromise: Promise<PanelPreferenceLoad> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private sequence = 0;
  private discardThrough = 0;
  private conflictPendingDisplay = false;

  constructor(private readonly repository: Pick<StudioRepository, 'loadPreferences' | 'savePreferences'>) {}

  load(): Promise<PanelPreferenceLoad> {
    if (!this.loadPromise) {
      const request = this.readCurrent();
      this.loadPromise = request;
      void request.catch(() => {
        if (this.loadPromise === request) this.loadPromise = null;
      });
    }
    return this.loadPromise;
  }

  acknowledgeCurrentDisplayed(): void {
    if (!this.conflictPendingDisplay) return;
    this.discardThrough = this.sequence;
    this.conflictPendingDisplay = false;
  }

  save(preferences: WorkspacePanelPreferences): Promise<PanelPreferenceSave> {
    const sequence = ++this.sequence;
    const requested = structuredClone(preferences);
    const task = this.queue.then(async () => {
      const wasLoaded = this.loaded;
      const loaded = await this.load();
      if (!wasLoaded) {
        this.conflictPendingDisplay = true;
        return { status: 'stale', preferences: loaded.preferences } as const;
      }
      if (this.conflictPendingDisplay || sequence <= this.discardThrough) {
        return { status: 'superseded' } as const;
      }

      const nextValue = mergePreferenceValue(this.value, requested);
      if (!nextValue) return { status: 'invalid-stored-value' } as const;

      const result = await this.repository.savePreferences(this.revision, nextValue);
      if (result.status === 'applied') {
        this.revision = result.revision;
        this.value = nextValue;
        this.durablePreferences = requested;
        return { status: 'applied', revision: result.revision } as const;
      }
      if (result.status === 'stale') {
        this.conflictPendingDisplay = true;
        try {
          const current = await this.readCurrent();
          return { status: 'stale', preferences: current.preferences } as const;
        } catch (error) {
          this.loaded = false;
          this.loadPromise = null;
          throw error;
        }
      }
      return { status: 'failed', result, preferences: this.durablePreferences } as const;
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async readCurrent(): Promise<PanelPreferenceLoad> {
    const record: Readonly<PreferenceRecord> | null = await this.repository.loadPreferences();
    this.loaded = true;
    this.revision = record?.revision ?? 0;
    this.value = record ? structuredClone(record.value) : null;
    this.durablePreferences = readWorkspacePanelPreferences(record?.value);
    return {
      revision: this.revision,
      preferences: this.durablePreferences,
    };
  }
}

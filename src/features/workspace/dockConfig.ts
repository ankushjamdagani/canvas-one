/** The closed dock inventory. These IDs are never persisted with payloads. */
export const DOCK_COMMAND_IDS = [
  'canvas.select-tool', 'canvas.pan-tool', 'library.open', 'canvas.add-note',
  'selection.group', 'edit.undo', 'edit.redo', 'canvas.zoom-out',
  'canvas.zoom-in', 'canvas.fit', 'history.open', 'results.open',
  'run.start', 'run.pause', 'run.resume', 'run.reset',
] as const;

export type DockCommandId = (typeof DOCK_COMMAND_IDS)[number];

export interface DockConfig {
  readonly orderedCommandIds: readonly DockCommandId[];
  readonly hiddenCommandIds: readonly DockCommandId[];
}

export const DEFAULT_DOCK_CONFIG: DockConfig = {
  orderedCommandIds: DOCK_COMMAND_IDS.slice(0, 10),
  hiddenCommandIds: DOCK_COMMAND_IDS.slice(10),
};

export function readDockConfig(value: unknown): DockConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const ordered = record.orderedCommandIds;
  const hidden = record.hiddenCommandIds;
  if (!Array.isArray(ordered) || !Array.isArray(hidden) || ordered.length > 16) return null;
  const inventory = new Set<string>(DOCK_COMMAND_IDS);
  const all = [...ordered, ...hidden];
  if (all.length !== DOCK_COMMAND_IDS.length || new Set(all).size !== all.length ||
      !all.every((id) => typeof id === 'string' && inventory.has(id))) return null;
  return { orderedCommandIds: ordered as DockCommandId[], hiddenCommandIds: hidden as DockCommandId[] };
}

export function changeDockConfig(config: DockConfig, id: DockCommandId, action: 'left' | 'right' | 'hide' | 'show'): DockConfig {
  const ordered = [...config.orderedCommandIds];
  const hidden = [...config.hiddenCommandIds];
  const index = ordered.indexOf(id);
  if (action === 'hide' && index >= 0) {
    ordered.splice(index, 1);
    hidden.push(id);
  } else if (action === 'show' && hidden.includes(id)) {
    hidden.splice(hidden.indexOf(id), 1);
    ordered.push(id);
  } else if (action === 'left' && index > 0) {
    [ordered[index - 1], ordered[index]] = [ordered[index], ordered[index - 1]];
  } else if (action === 'right' && index >= 0 && index < ordered.length - 1) {
    [ordered[index + 1], ordered[index]] = [ordered[index], ordered[index + 1]];
  }
  return { orderedCommandIds: ordered, hiddenCommandIds: hidden };
}

/** Pointer drops use the same exact inventory as keyboard/button moves. */
export function insertDockCommand(config: DockConfig, id: DockCommandId, beforeId?: DockCommandId): DockConfig {
  if (!DOCK_COMMAND_IDS.includes(id) ||
      (!config.orderedCommandIds.includes(id) && !config.hiddenCommandIds.includes(id))) return config;
  if (config.hiddenCommandIds.includes(id) && config.orderedCommandIds.length >= 16) return config;
  if (id === beforeId) return config;
  const ordered = config.orderedCommandIds.filter((command) => command !== id);
  const targetIndex = beforeId ? ordered.indexOf(beforeId) : -1;
  ordered.splice(targetIndex < 0 ? ordered.length : targetIndex, 0, id);
  return { orderedCommandIds: ordered, hiddenCommandIds: config.hiddenCommandIds.filter((command) => command !== id) };
}

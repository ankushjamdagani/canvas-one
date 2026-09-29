import { describe, expect, it } from 'vitest';
import { changeDockConfig, DEFAULT_DOCK_CONFIG, DOCK_COMMAND_IDS, insertDockCommand, readDockConfig } from './dockConfig';

describe('dock customization contract', () => {
  it('keeps a unique, exact inventory and defaults to the first ten visible', () => {
    expect(DEFAULT_DOCK_CONFIG.orderedCommandIds).toEqual(DOCK_COMMAND_IDS.slice(0, 10));
    expect(readDockConfig(DEFAULT_DOCK_CONFIG)).toEqual(DEFAULT_DOCK_CONFIG);
    expect(readDockConfig({ orderedCommandIds: ['canvas.fit'], hiddenCommandIds: [] })).toBeNull();
    expect(readDockConfig({ orderedCommandIds: [...DOCK_COMMAND_IDS, 'canvas.fit'], hiddenCommandIds: [] })).toBeNull();
  });

  it('reorders, hides, adds, and restores without losing a command', () => {
    const left = changeDockConfig(DEFAULT_DOCK_CONFIG, 'canvas.add-note', 'left');
    expect(left.orderedCommandIds.indexOf('canvas.add-note')).toBe(2);
    const hidden = changeDockConfig(left, 'canvas.add-note', 'hide');
    expect(hidden.hiddenCommandIds).toContain('canvas.add-note');
    const shown = changeDockConfig(hidden, 'canvas.add-note', 'show');
    expect(shown.orderedCommandIds.at(-1)).toBe('canvas.add-note');
    expect(readDockConfig(shown)).toEqual(shown);
    expect(readDockConfig(DEFAULT_DOCK_CONFIG)).toEqual(DEFAULT_DOCK_CONFIG);
  });

  it('inserts a dragged tray command at a drop target', () => {
    const inserted = insertDockCommand(DEFAULT_DOCK_CONFIG, 'history.open', 'canvas.add-note');
    expect(inserted.orderedCommandIds[3]).toBe('history.open');
    expect(inserted.hiddenCommandIds).not.toContain('history.open');
    expect(readDockConfig(inserted)).toEqual(inserted);
  });
});

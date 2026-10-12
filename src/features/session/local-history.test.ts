import { describe, expect, it, vi } from 'vitest';
import { LocalUndoHistory } from '@canvas-one/history';

vi.mock('dexie', () => { throw new Error('History imported Dexie'); });
vi.mock('react', () => { throw new Error('History imported React'); });

const entry = (label: string) => ({ label, forwardChanges: [{ value: label }], inverseChanges: [{ value: `before ${label}` }] });

describe('headless local history', () => {
  it('does not use a history instance as the receiver of the platform cloning function', () => {
    const original = globalThis.structuredClone;
    vi.stubGlobal('structuredClone', function(this: unknown, value: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return original(value);
    });
    try {
      const history = new LocalUndoHistory<{value: string}>();
      history.recordAccepted(entry('browser edit'));
      expect(history.getSnapshot().undo[0].label).toBe('browser edit');
    } finally { vi.unstubAllGlobals(); }
  });
  it('moves history only when an authoritative receipt is acknowledged', () => {
    const history = new LocalUndoHistory<{ value: string }>();
    history.recordAccepted(entry('edit'));
    const ticket = history.prepare('undo')!;
    // Host write fails: it deliberately does not acknowledge the ticket.
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.commit(ticket)).toBe(true);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.commit(ticket)).toBe(false);
    expect(history.commit(history.prepare('redo')!)).toBe(true);
    expect(history.getSnapshot().undo.map(({ label }) => label)).toEqual(['edit']);
  });

  it('invalidates stale and foreign receipts; a new edit clears redo', () => {
    const history = new LocalUndoHistory<{ value: string }>();
    const other = new LocalUndoHistory<{ value: string }>();
    history.recordAccepted(entry('first'));
    other.recordAccepted(entry('other'));
    const stale = history.prepare('undo')!;
    history.recordAccepted(entry('second'));
    expect(history.commit(stale)).toBe(false);
    expect(history.commit(other.prepare('undo')!)).toBe(false);
    history.commit(history.prepare('undo')!);
    const redo = history.prepare('redo')!;
    history.recordAccepted(entry('third'));
    expect(history.canRedo).toBe(false);
    expect(history.commit(redo)).toBe(false);
    const pending = history.prepare('undo')!;
    history.clear();
    expect(history.commit(pending)).toBe(false);
    expect(history.getSnapshot()).toMatchObject({ undo: [], redo: [], canUndo: false, canRedo: false });
  });

  it('bounds retention and protects retained changes from caller and preview mutation', () => {
    const history = new LocalUndoHistory<{ value: string }>();
    for (let i = 0; i < 101; i++) history.recordAccepted(entry(`${i}`));
    expect(history.getSnapshot().undo).toHaveLength(100);
    expect(history.getSnapshot().undo[0].label).toBe('1');
    const authored = entry('latest');
    history.recordAccepted(authored);
    authored.inverseChanges[0].value = 'caller mutation';
    const preview = history.prepare('undo')!;
    preview.entry.inverseChanges[0].value = 'preview mutation';
    const snapshot = history.getSnapshot();
    snapshot.undo[99].forwardChanges[0].value = 'snapshot mutation';
    const retained = history.prepare('undo')!.entry;
    expect(retained.inverseChanges[0].value).toBe('before latest');
    expect(retained.forwardChanges[0].value).toBe('latest');
  });

  it('rejects invalid bounds and supports explicit retention policy', () => {
    expect(() => new LocalUndoHistory({ maxEntries: 0 })).toThrow(RangeError);
    const history = new LocalUndoHistory({ maxEntries: 1 });
    history.recordAccepted(entry('first'));
    history.recordAccepted(entry('second'));
    expect(history.getSnapshot().undo.map(({ label }) => label)).toEqual(['second']);
  });
});

/**
 * Pure logic tests for CompareAndResolvePanel's field-edit helper: building the edited-field resolution's
 * record from a deeply nested field path, matching how
 * resolve.ts/applySideAtConflictPath addresses conflict paths elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { setAtPath } from './CompareAndResolvePanel';

describe('setAtPath (edited conflict resolution record builder)', () => {
  it('rejects missing paths, type changes, empty paths and non-finite numbers', () => {
    const record = { config: { capacity: 10 }, label: 'Worker' };
    expect(() => setAtPath(record, ['missing', 'capacity'], 2)).toThrow();
    expect(() => setAtPath(record, ['config', 'capacity'], '2')).toThrow();
    expect(() => setAtPath(record, [], 'label')).toThrow();
    expect(() => setAtPath(record, ['config', 'capacity'], Infinity)).toThrow();
    expect(record.config.capacity).toBe(10);
  });
  it('sets a nested scalar field without touching sibling fields', () => {
    const record = {
      id: 'elem-1',
      label: 'Fulfillment worker',
      ports: [{ id: 'port-1', label: 'in' }],
      behavior: {
        kind: 'resource',
        config: { type: 'processor', capacity: 10, concurrency: 1, queueLimit: 0 },
      },
    };

    const edited = setAtPath(record, ['behavior', 'config', 'capacity'], 25);

    expect(edited).toEqual({
      id: 'elem-1',
      label: 'Fulfillment worker',
      ports: [{ id: 'port-1', label: 'in' }],
      behavior: {
        kind: 'resource',
        config: { type: 'processor', capacity: 25, concurrency: 1, queueLimit: 0 },
      },
    });
    // The source record is never mutated.
    expect(record.behavior.config.capacity).toBe(10);
  });

  it('sets a top-level scalar field', () => {
    const record = { id: 'elem-1', label: 'Old label', ports: [] };
    const edited = setAtPath(record, ['label'], 'New label');
    expect(edited).toEqual({ id: 'elem-1', label: 'New label', ports: [] });
  });

  it('navigates into an id-keyed array member before setting a field', () => {
    const record = {
      id: 'elem-1',
      label: 'Router',
      ports: [
        { id: 'port-a', label: 'in', direction: 'in' },
        { id: 'port-b', label: 'out', direction: 'out' },
      ],
    };

    const edited = setAtPath(record, ['ports', 'port-b', 'label'], 'renamed-out');

    expect(edited.ports).toEqual([
      { id: 'port-a', label: 'in', direction: 'in' },
      { id: 'port-b', label: 'renamed-out', direction: 'out' },
    ]);
    // Sibling port untouched.
    expect(record.ports[1].label).toBe('out');
  });
});

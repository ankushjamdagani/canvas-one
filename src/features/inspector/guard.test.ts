import { describe, expect, it } from 'vitest';
import { decideNavigation, RUN_DISABLED_DIRTY_DRAFT_REASON } from './guard';
import type { DraftHandle } from './types';

function draft(overrides: Partial<DraftHandle> = {}): DraftHandle {
  return {
    draftId: 'd1',
    target: { kind: 'element', ids: ['e1'] },
    baseWorkingRevision: 1,
    baseValues: {},
    fields: [],
    values: {},
    dirty: false,
    issues: {},
    status: 'clean',
    missing: false,
    multi: false,
    count: 1,
    label: 'x',
    kindTag: '',
    notSimulated: false,
    ...overrides,
  };
}

describe('decideNavigation', () => {
  it('no draft -> proceed', () => {
    expect(decideNavigation(null)).toBe('proceed');
  });

  it('clean draft -> proceed', () => {
    expect(decideNavigation(draft({ dirty: false }))).toBe('proceed');
  });

  it('dirty draft -> ask', () => {
    expect(decideNavigation(draft({ dirty: true }))).toBe('ask');
  });
});

describe('RUN_DISABLED_DIRTY_DRAFT_REASON', () => {
  it('is the exact contract string', () => {
    expect(RUN_DISABLED_DIRTY_DRAFT_REASON).toBe('Apply or Cancel configuration changes before running.');
  });
});

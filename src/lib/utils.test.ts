import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('foundation class merging', () => {
  it('preserves semantic badge colors when applying custom typography', () => {
    expect(cn('text-xs text-risk-text', 'text-micro')).toBe('text-risk-text text-micro');
    expect(cn('text-accent-foreground text-xs', 'text-ui')).toBe('text-accent-foreground text-ui');
  });
  it('still replaces colors and font sizes within their own roles', () => {
    expect(cn('text-risk-text text-micro', 'text-branch text-title')).toBe('text-branch text-title');
  });
});

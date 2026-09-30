import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './timeUtils';

describe('formatRelativeTime', () => {
  const baseTime = 1_700_000_000_000;

  it('formats less than 1 minute as just now', () => {
    expect(formatRelativeTime(baseTime - 30_000, baseTime)).toBe('just now');
  });

  it('formats minutes ago', () => {
    expect(formatRelativeTime(baseTime - 4 * 60_000, baseTime)).toBe('4m ago');
  });

  it('formats hours ago', () => {
    expect(formatRelativeTime(baseTime - 2 * 3600_000, baseTime)).toBe('2h ago');
  });

  it('formats 1 day ago as yesterday', () => {
    expect(formatRelativeTime(baseTime - 25 * 3600_000, baseTime)).toBe('yesterday');
  });

  it('formats multiple days ago', () => {
    expect(formatRelativeTime(baseTime - 3 * 86400_000, baseTime)).toBe('3d ago');
  });

  it('handles invalid or non-positive timestamps gracefully', () => {
    expect(formatRelativeTime(0, baseTime)).toBe('recently');
    expect(formatRelativeTime(NaN, baseTime)).toBe('recently');
  });
});

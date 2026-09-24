import { describe, expect, it } from 'vitest';
import { formatStudioError } from './formatError';
import { RepositoryError } from '../../persistence/studio/errors';

describe('formatStudioError', () => {
  it('formats RepositoryError with quota code', () => {
    const err = new RepositoryError({ code: 'quota', message: 'disk full' });
    expect(formatStudioError(err)).toBe('Storage quota exceeded. Please free up disk space.');
  });

  it('formats RepositoryError with unavailable code', () => {
    const err = new RepositoryError({ code: 'unavailable', message: 'connection dropped' });
    expect(formatStudioError(err)).toBe('Storage is currently unavailable.');
  });

  it('formats RepositoryError with not-found code', () => {
    const err = new RepositoryError({ code: 'not-found', message: 'project missing' });
    expect(formatStudioError(err)).toBe('Requested project or resource not found.');
  });

  it('formats RepositoryError with structured issues', () => {
    const err = new RepositoryError({
      code: 'invalid',
      message: 'invalid entity',
      issues: [
        { code: 'missing-property', path: ['title'], message: 'Title is required', severity: 'error', entityId: null },
      ],
    });
    expect(formatStudioError(err)).toBe('Title is required');
  });

  it('formats typed invalid result with issues array', () => {
    const res = {
      status: 'invalid' as const,
      issues: [
        { code: 'invalid-id', path: ['id'], message: 'ID is malformed', severity: 'error', entityId: null },
      ],
    };
    expect(formatStudioError(res)).toBe('ID is malformed');
  });

  it('formats typed missing result with IDs', () => {
    const res = {
      status: 'missing' as const,
      ids: ['branch-42', 'snapshot-99'],
    };
    expect(formatStudioError(res)).toBe('Resource missing: branch-42, snapshot-99');
  });

  it('formats typed stale result with scope', () => {
    const res = {
      status: 'stale' as const,
      scope: 'branch' as const,
      expected: 1,
      actual: 2,
    };
    expect(formatStudioError(res)).toBe('Conflict: branch revision is stale. Please reload.');
  });

  it('formats typed busy result', () => {
    const res = {
      status: 'busy' as const,
      message: 'ignored raw message',
    };
    expect(formatStudioError(res)).toBe('An operation is currently in progress. Please wait.');
  });

  it('never outputs raw exception text for arbitrary thrown Error', () => {
    const rawError = new Error('Raw secret exception text: stack trace at file.ts:123');
    const formatted = formatStudioError(rawError);
    expect(formatted).toBe('An unexpected error occurred');
    expect(formatted).not.toContain('Raw secret exception');
    expect(formatted).not.toContain('stack trace');
  });

  it('uses custom fallback generic text when provided', () => {
    const rawError = new Error('Database explode');
    expect(formatStudioError(rawError, 'Failed to open project')).toBe('Failed to open project');
  });
});

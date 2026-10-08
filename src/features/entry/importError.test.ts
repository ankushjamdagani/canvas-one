/**
 * Tests for entry-screen import error mapping: typed errors, never raw exception text.
 * `importProjectJson` (json-transfer.ts) already returns typed, non-raw failure messages
 * (the "made with the old app, not supported" message for v7/v8, the byte-cap message,
 * validation issue text); this only verifies the presentation
 * fallback picks the right text for each failure `kind`.
 */

import { describe, expect, it } from 'vitest';
import type { ImportProjectJsonFailure } from '../transfer';
import { formatImportError } from './importError';

describe('formatImportError', () => {
  it('uses the old-app message for unsupported-version (old app v7/v8) failures', () => {
    const failure: ImportProjectJsonFailure = {
      ok: false,
      kind: 'unsupported-version',
      message: 'File was made with the old app, not supported',
      issues: [],
    };
    expect(formatImportError(failure)).toBe('File was made with the old app, not supported');
  });

  it('uses the byte-cap message for too-large failures', () => {
    const failure: ImportProjectJsonFailure = {
      ok: false,
      kind: 'too-large',
      message: 'File size 70000000 bytes exceeds the 64 MiB (67108864 bytes) transfer limit',
      issues: [],
    };
    expect(formatImportError(failure)).toContain('64 MiB');
  });

  it('uses message when present for invalid failures', () => {
    const failure: ImportProjectJsonFailure = {
      ok: false,
      kind: 'invalid',
      message: 'Malformed JSON',
      issues: [{ code: 'wrong-type', path: [], entityId: null, severity: 'error', message: 'Malformed JSON' }],
    };
    expect(formatImportError(failure)).toBe('Malformed JSON');
  });

  it('falls back to joined issue messages when invalid has no top-level message', () => {
    const failure: ImportProjectJsonFailure = {
      ok: false,
      kind: 'invalid',
      issues: [
        { code: 'wrong-type', path: ['project'], entityId: null, severity: 'error', message: 'project is missing' },
        { code: 'wrong-type', path: ['project', 'title'], entityId: null, severity: 'error', message: 'title must be a string' },
      ],
    };
    expect(formatImportError(failure)).toBe('project is missing; title must be a string');
  });

  it('throws when a failure has neither a message nor issues (contract violation)', () => {
    const failure: ImportProjectJsonFailure = {
      ok: false,
      kind: 'invalid',
      issues: [],
    };
    expect(() => formatImportError(failure)).toThrow(/contract violation/);
  });

  it('uses the quota message for quota failures', () => {
    const failure: ImportProjectJsonFailure = {
      ok: false,
      kind: 'quota',
      message: 'Storage quota exceeded',
      issues: [],
    };
    expect(formatImportError(failure)).toBe('Storage quota exceeded');
  });
});

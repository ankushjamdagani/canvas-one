/**
 * Typed import-error formatting for the entry screen (RV-10b).
 *
 * `importProjectJson` (RV-10a, src/features/transfer/json-transfer.ts) never throws
 * for an expected failure -- it returns a typed `ImportProjectJsonFailure` whose
 * `message` is already a non-raw, user-facing string (D19's "made with the old app,
 * not supported" for unsupported v7/v8, the byte-cap message, validation issue
 * text, ...). This just picks the right field for each failure `kind`, with the
 * same "join issue messages" fallback `formatStudioError` (session/formatError.ts)
 * uses when `message` is absent, so the entry screen never shows a raw exception.
 */

import type { ImportProjectJsonFailure } from '../transfer';

export function formatImportError(failure: ImportProjectJsonFailure): string {
  if (failure.message) return failure.message;
  const issueText = failure.issues.map((issue) => issue.message).filter(Boolean).join('; ');
  return issueText || 'The project file could not be imported.';
}

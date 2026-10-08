/**
 * Bounded ASCII-safe filename sanitization for System Studio exports.
 *
 * The download filename stem comes from a bounded ASCII-safe title (fallback
 * `system-studio`) and never contains directory syntax.
 */

/**
 * Sanitizes a title string into a bounded ASCII-safe filename stem.
 * Replaces any non-alphanumeric character (and directory separators) with hyphens,
 * trims leading/trailing hyphens, folds to lowercase, slices to max 72 characters,
 * and falls back to 'system-studio' if empty.
 */
export function sanitizeFilenameStem(title: string | null | undefined): string {
  if (!title) return 'system-studio';
  const stem = title
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 72)
    .replace(/-+$/g, '');

  return stem || 'system-studio';
}

export function jsonFileName(title: string | null | undefined): string {
  return `${sanitizeFilenameStem(title)}.system-studio.json`;
}

export function svgFileName(title: string | null | undefined): string {
  return `${sanitizeFilenameStem(title)}.svg`;
}

export function pngFileName(title: string | null | undefined): string {
  return `${sanitizeFilenameStem(title)}.png`;
}

export function mermaidFileName(title: string | null | undefined): string {
  return `${sanitizeFilenameStem(title)}.mmd`;
}

export function csvFileName(title: string | null | undefined): string {
  return `${sanitizeFilenameStem(title)}.csv`;
}

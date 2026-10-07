/**
 * Recently placed catalog entries for the picker's "Recent" chip. A per-viewer
 * convenience kept in localStorage, never project data; every access is
 * guarded because storage can be blocked or full.
 */
const KEY = 'studio.recentParts';
export const RECENT_PARTS_LIMIT = 8;

export function readRecentParts(): readonly string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string').slice(0, RECENT_PARTS_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function rememberPart(entryId: string): readonly string[] {
  const next = [entryId, ...readRecentParts().filter((id) => id !== entryId)].slice(0, RECENT_PARTS_LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the list simply doesn't persist.
  }
  return next;
}

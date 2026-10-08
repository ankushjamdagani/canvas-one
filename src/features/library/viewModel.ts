/**
 * Library pure view models: filtering, grouping, keyboard navigation and detail formatting,
 * with no DOM or React dependency.
 */

import { GROUP_STRIPE_COLORS, type CatalogEntry, type CatalogGroup } from '../catalog/catalog';
import { defaultsLine } from '../catalog/caption';
import type { CatalogGroupSection } from './types';

/**
 * Canonical layer group order matching architecture and catalog specifications.
 */
export const CANONICAL_GROUP_ORDER: readonly CatalogGroup[] = Object.freeze([
  'Clients',
  'Edge',
  'Compute',
  'Messaging',
  'Data',
  'Operations',
  'State Machine',
  'Data Pipeline',
  'Host',
  'Other',
]);

/**
 * Case-insensitive search filtering across:
 * - label
 * - tags
 * - group
 * - models
 * - visualKind
 */
export function filterEntries(
  entries: readonly CatalogEntry[],
  query: string,
): CatalogEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...entries];
  }

  return entries.filter((entry) => {
    if (entry.label.toLowerCase().includes(normalized)) return true;
    if (entry.group.toLowerCase().includes(normalized)) return true;
    if (entry.models.toLowerCase().includes(normalized)) return true;
    if (entry.visualKind.toLowerCase().includes(normalized)) return true;
    if (entry.tags.some((tag) => tag.toLowerCase().includes(normalized))) return true;
    return false;
  });
}

/**
 * Filters entries by group, or returns all entries if group is 'All'.
 */
export function filterEntriesByGroup(
  entries: readonly CatalogEntry[],
  group: CatalogGroup | 'All',
): CatalogEntry[] {
  if (group === 'All') {
    return [...entries];
  }
  return entries.filter((entry) => entry.group === group);
}

/**
 * Groups catalog entries by their catalog group in canonical layer order,
 * including per-group counts and stripe colors. Empty groups are excluded.
 */
export function groupCatalogEntries(
  entries: readonly CatalogEntry[],
): CatalogGroupSection[] {
  const sections: CatalogGroupSection[] = [];

  for (const group of CANONICAL_GROUP_ORDER) {
    const groupEntries = entries.filter((e) => e.group === group);
    if (groupEntries.length > 0) {
      sections.push({
        group,
        stripeColor: GROUP_STRIPE_COLORS[group] ?? null,
        entries: groupEntries,
        count: groupEntries.length,
      });
    }
  }

  return sections;
}

/**
 * Checks whether an entry is unmodeled (a diagram label that the simulation ignores).
 */
export function isUnmodeledEntry(entry: CatalogEntry): boolean {
  return (
    entry.behaviorKind === 'unmodeled' ||
    entry.caption.line2template === 'Not simulated'
  );
}

/**
 * Structured detail row data for the entry detail popover.
 * It never includes Owner, Used in, Platform team, Failures go to or Open docs.
 */
export interface FormattedEntryDetail {
  readonly group: CatalogGroup;
  readonly label: string;
  readonly badge: 'STANDARD';
  readonly models: string;
  readonly defaults: string;
  readonly doesNotModel: string;
  readonly stripeColor: string | null;
  readonly isUnmodeled: boolean;
}

export function getFormattedEntryDetail(
  entry: CatalogEntry,
): FormattedEntryDetail {
  const rawDefaults = defaultsLine(entry);
  const cleanDefaults = rawDefaults.replace(/^DEFAULTS\s*·\s*/, '');

  return {
    group: entry.group,
    label: entry.label,
    badge: 'STANDARD',
    models: entry.models,
    defaults: cleanDefaults,
    doesNotModel: entry.doesNotModel,
    stripeColor: GROUP_STRIPE_COLORS[entry.group] ?? null,
    isUnmodeled: isUnmodeledEntry(entry),
  };
}

// ============================================================================
// Keyboard Navigation Reducer
// ============================================================================

export type NavigationAction =
  | { type: 'ARROW_UP'; columns?: number }
  | { type: 'ARROW_DOWN'; columns?: number }
  | { type: 'ARROW_LEFT' }
  | { type: 'ARROW_RIGHT' }
  | { type: 'HOME' }
  | { type: 'END' }
  | { type: 'SET_INDEX'; index: number };

export interface NavigationState {
  selectedIndex: number;
}

/**
 * Pure keyboard navigation reducer for 1D lists (columns=1),
 * 2-column panel grids (columns=2), and 4-column picker grids (columns=4).
 */
export function keyboardNavigationReducer(
  state: NavigationState,
  action: NavigationAction,
  totalItems: number,
): NavigationState {
  if (totalItems <= 0) {
    return { selectedIndex: -1 };
  }

  const current = state.selectedIndex < 0 ? 0 : state.selectedIndex;

  switch (action.type) {
    case 'ARROW_DOWN': {
      const cols = action.columns ?? 1;
      const next = Math.min(totalItems - 1, current + cols);
      return { selectedIndex: next };
    }
    case 'ARROW_UP': {
      const cols = action.columns ?? 1;
      const prev = Math.max(0, current - cols);
      return { selectedIndex: prev };
    }
    case 'ARROW_RIGHT': {
      const next = Math.min(totalItems - 1, current + 1);
      return { selectedIndex: next };
    }
    case 'ARROW_LEFT': {
      const prev = Math.max(0, current - 1);
      return { selectedIndex: prev };
    }
    case 'HOME': {
      return { selectedIndex: 0 };
    }
    case 'END': {
      return { selectedIndex: totalItems - 1 };
    }
    case 'SET_INDEX': {
      const clamped = Math.max(0, Math.min(totalItems - 1, action.index));
      return { selectedIndex: clamped };
    }
    default:
      return state;
  }
}

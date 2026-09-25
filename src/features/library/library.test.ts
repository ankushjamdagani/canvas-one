/**
 * Library Tests (RV-06b).
 *
 * Covers:
 * 1. Pure view-model functions:
 *    - filtering/search (incl. no-results and case-insensitivity)
 *    - grouping/order/counts and stripe colors
 *    - detail rows content (asserting excluded fields never appear)
 *    - keyboard navigation reducer (1D list, 2-column grid, 4-column picker)
 * 2. Static render checks with react-dom/server `renderToStaticMarkup`:
 *    - LibraryPanel (list view & grid view)
 *    - LibraryPicker (compact dock picker)
 *    - EntryDetailCard (12C detail view)
 *    - Empty search results state ("Clear search" way out)
 *    - Strict assertions that excluded fields (Owner, Used in, Platform team, Failures go to, Open docs) NEVER appear.
 */

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CATALOG_ENTRIES,
  GROUP_STRIPE_COLORS,
  getEntry,
} from '../catalog/catalog';
import { libraryCaption, defaultsLine } from '../catalog/caption';
import {
  filterEntries,
  filterEntriesByGroup,
  groupCatalogEntries,
  getFormattedEntryDetail,
  isUnmodeledEntry,
  keyboardNavigationReducer,
  CANONICAL_GROUP_ORDER,
} from './viewModel';
import { LibraryPanel } from './LibraryPanel';
import { LibraryPicker } from './LibraryPicker';
import { EntryDetailCard } from './EntryDetailCard';
import { CATALOG_ENTRY_MIME_TYPE } from './types';

describe('Library Feature (RV-06b)', () => {
  // ==========================================================================
  // 1. Pure View-Model Functions
  // ==========================================================================

  describe('filterEntries (Search)', () => {
    it('returns all entries when query is empty or only whitespace', () => {
      expect(filterEntries(CATALOG_ENTRIES, '').length).toBe(CATALOG_ENTRIES.length);
      expect(filterEntries(CATALOG_ENTRIES, '   ').length).toBe(CATALOG_ENTRIES.length);
    });

    it('matches case-insensitively on label', () => {
      const results = filterEntries(CATALOG_ENTRIES, 'SERVICE');
      expect(results.some((e) => e.entryId === 'service')).toBe(true);
    });

    it('matches on tags', () => {
      const results = filterEntries(CATALOG_ENTRIES, 'competing');
      expect(results.some((e) => e.entryId === 'queue')).toBe(true);
    });

    it('matches on catalog group name', () => {
      const results = filterEntries(CATALOG_ENTRIES, 'messaging');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((e) => e.group === 'Messaging' || e.label.toLowerCase().includes('messaging') || e.models.toLowerCase().includes('messaging'))).toBe(true);
    });

    it('matches on models text', () => {
      const results = filterEntries(CATALOG_ENTRIES, 'synchronous request handler');
      expect(results.some((e) => e.entryId === 'service')).toBe(true);
    });

    it('returns an empty array when no entries match (way out tested separately)', () => {
      const results = filterEntries(CATALOG_ENTRIES, 'xyzNonExistentQuery123');
      expect(results.length).toBe(0);
    });
  });

  describe('filterEntriesByGroup', () => {
    it('returns all entries when group is "All"', () => {
      expect(filterEntriesByGroup(CATALOG_ENTRIES, 'All').length).toBe(CATALOG_ENTRIES.length);
    });

    it('filters strictly by the specified CatalogGroup', () => {
      const computeEntries = filterEntriesByGroup(CATALOG_ENTRIES, 'Compute');
      expect(computeEntries.length).toBeGreaterThan(0);
      expect(computeEntries.every((e) => e.group === 'Compute')).toBe(true);
    });
  });

  describe('groupCatalogEntries (Grouping, Order, Counts)', () => {
    it('groups entries in canonical layer order', () => {
      const grouped = groupCatalogEntries(CATALOG_ENTRIES);
      const groupNames = grouped.map((g) => g.group);

      // Verify each group appears in the canonical order sequence
      let lastIndex = -1;
      for (const name of groupNames) {
        const canonicalIndex = CANONICAL_GROUP_ORDER.indexOf(name);
        expect(canonicalIndex).toBeGreaterThan(lastIndex);
        lastIndex = canonicalIndex;
      }
    });

    it('accurately computes count and sum equals total entries', () => {
      const grouped = groupCatalogEntries(CATALOG_ENTRIES);
      const sum = grouped.reduce((acc, g) => acc + g.count, 0);
      expect(sum).toBe(CATALOG_ENTRIES.length);

      for (const section of grouped) {
        expect(section.count).toBe(section.entries.length);
        expect(section.count).toBeGreaterThan(0);
        expect(section.stripeColor).toBe(GROUP_STRIPE_COLORS[section.group]);
      }
    });

    it('excludes empty groups when filtered', () => {
      const singleEntryList = CATALOG_ENTRIES.filter((e) => e.entryId === 'queue');
      const grouped = groupCatalogEntries(singleEntryList);
      expect(grouped.length).toBe(1);
      expect(grouped[0].group).toBe('Messaging');
      expect(grouped[0].count).toBe(1);
    });
  });

  describe('isUnmodeledEntry & unmodeled tagging', () => {
    it('correctly identifies unmodeled entries per Resolution 7 and Resolution 12', () => {
      // Resolution 7
      expect(isUnmodeledEntry(getEntry('email')!)).toBe(true);
      expect(isUnmodeledEntry(getEntry('monitoring')!)).toBe(true);
      expect(isUnmodeledEntry(getEntry('analytics')!)).toBe(true);
      expect(isUnmodeledEntry(getEntry('secrets')!)).toBe(true);

      // Resolution 12
      expect(isUnmodeledEntry(getEntry('traffic')!)).toBe(true);
      expect(isUnmodeledEntry(getEntry('client')!)).toBe(true);
      expect(isUnmodeledEntry(getEntry('mobile')!)).toBe(true);
      expect(isUnmodeledEntry(getEntry('device')!)).toBe(true);
      expect(isUnmodeledEntry(getEntry('scheduler')!)).toBe(true);

      // Resolution 2 / custom / thirdparty
      expect(isUnmodeledEntry(getEntry('thirdparty')!)).toBe(true);
      expect(isUnmodeledEntry(getEntry('custom')!)).toBe(true);

      // Simulated entries
      expect(isUnmodeledEntry(getEntry('service')!)).toBe(false);
      expect(isUnmodeledEntry(getEntry('queue')!)).toBe(false);
      expect(isUnmodeledEntry(getEntry('database')!)).toBe(false);
    });
  });

  describe('getFormattedEntryDetail & exclusions (design-revalidation.md §2)', () => {
    it('formats structured details with required fields and excludes forbidden ones', () => {
      for (const entry of CATALOG_ENTRIES) {
        const detail = getFormattedEntryDetail(entry);

        expect(detail.label).toBe(entry.label);
        expect(detail.group).toBe(entry.group);
        expect(detail.badge).toBe('STANDARD');
        expect(detail.models).toBe(entry.models);
        expect(detail.doesNotModel).toBe(entry.doesNotModel);
        expect(detail.defaults).toBeDefined();

        // Verify that forbidden keys are NEVER present on the detail object
        const keys = Object.keys(detail);
        expect(keys).not.toContain('owner');
        expect(keys).not.toContain('usedIn');
        expect(keys).not.toContain('failuresGoTo');
        expect(keys).not.toContain('openDocs');
        expect(keys).not.toContain('platformTeam');
      }
    });
  });

  describe('keyboardNavigationReducer', () => {
    it('handles 1D list navigation (columns=1)', () => {
      let state = { selectedIndex: 0 };
      const total = 5;

      // Down
      state = keyboardNavigationReducer(state, { type: 'ARROW_DOWN', columns: 1 }, total);
      expect(state.selectedIndex).toBe(1);

      // Down to bottom clamp
      state = keyboardNavigationReducer({ selectedIndex: 4 }, { type: 'ARROW_DOWN', columns: 1 }, total);
      expect(state.selectedIndex).toBe(4);

      // Up
      state = keyboardNavigationReducer(state, { type: 'ARROW_UP', columns: 1 }, total);
      expect(state.selectedIndex).toBe(3);

      // Up to top clamp
      state = keyboardNavigationReducer({ selectedIndex: 0 }, { type: 'ARROW_UP', columns: 1 }, total);
      expect(state.selectedIndex).toBe(0);

      // Home and End
      state = keyboardNavigationReducer(state, { type: 'END' }, total);
      expect(state.selectedIndex).toBe(4);

      state = keyboardNavigationReducer(state, { type: 'HOME' }, total);
      expect(state.selectedIndex).toBe(0);
    });

    it('handles 2-column grid navigation (columns=2)', () => {
      const total = 6;
      let state = { selectedIndex: 0 };

      // Right
      state = keyboardNavigationReducer(state, { type: 'ARROW_RIGHT' }, total);
      expect(state.selectedIndex).toBe(1);

      // Down (jumps 2 slots)
      state = keyboardNavigationReducer(state, { type: 'ARROW_DOWN', columns: 2 }, total);
      expect(state.selectedIndex).toBe(3);

      // Left
      state = keyboardNavigationReducer(state, { type: 'ARROW_LEFT' }, total);
      expect(state.selectedIndex).toBe(2);

      // Up (jumps 2 slots)
      state = keyboardNavigationReducer(state, { type: 'ARROW_UP', columns: 2 }, total);
      expect(state.selectedIndex).toBe(0);
    });

    it('handles 4-column picker grid navigation (columns=4)', () => {
      const total = 10;
      let state = { selectedIndex: 1 };

      // Down 4
      state = keyboardNavigationReducer(state, { type: 'ARROW_DOWN', columns: 4 }, total);
      expect(state.selectedIndex).toBe(5);

      // Down 4 again
      state = keyboardNavigationReducer(state, { type: 'ARROW_DOWN', columns: 4 }, total);
      expect(state.selectedIndex).toBe(9);

      // Down at bottom clamps
      state = keyboardNavigationReducer(state, { type: 'ARROW_DOWN', columns: 4 }, total);
      expect(state.selectedIndex).toBe(9);

      // Up 4
      state = keyboardNavigationReducer(state, { type: 'ARROW_UP', columns: 4 }, total);
      expect(state.selectedIndex).toBe(5);
    });

    it('returns -1 when totalItems is 0', () => {
      const state = keyboardNavigationReducer({ selectedIndex: 0 }, { type: 'ARROW_DOWN' }, 0);
      expect(state.selectedIndex).toBe(-1);
    });
  });

  // ==========================================================================
  // 2. Static Render Checks with renderToStaticMarkup
  // ==========================================================================

  describe('Static HTML Rendering', () => {
    it('renders LibraryPanel in list view (12A) with group headers, captions, and footer', () => {
      const html = renderToStaticMarkup(
        React.createElement(LibraryPanel, {
          onPlace: () => {},
          onClose: () => {},
          view: 'list',
          onViewChange: () => {},
          selectedEntryId: 'service',
        }),
      );

      // Header
      expect(html).toContain('Library');
      expect(html).toContain('aria-label="Close library"');

      // Search input
      expect(html).toContain('aria-label="Search components"');

      // Group headers & counts
      expect(html).toContain('COMPUTE');
      expect(html).toContain('DATA');
      expect(html).toContain('MESSAGING');

      // Specific entries and captions
      expect(html).toContain('Service');
      expect(html).toContain(libraryCaption(getEntry('service')!));
      expect(html).toContain('Queue');
      expect(html).toContain(libraryCaption(getEntry('queue')!));

      // "Not simulated" tag for unmodeled entries
      expect(html).toContain('Not simulated');

      // Footer
      expect(html).toContain('Place on canvas');
      expect(html).toContain(defaultsLine(getEntry('service')!));

      // Drag MIME type constant presence
      expect(CATALOG_ENTRY_MIME_TYPE).toBe('application/x-studio-catalog-entry');

      // Strictly assert absence of excluded design elements per §2
      expect(html).not.toMatch(/owner/i);
      expect(html).not.toMatch(/used in/i);
      expect(html).not.toMatch(/failures go to/i);
      expect(html).not.toMatch(/open docs/i);
      expect(html).not.toMatch(/platform team/i);
    });

    it('renders LibraryPanel in grid view (12B)', () => {
      const html = renderToStaticMarkup(
        React.createElement(LibraryPanel, {
          onPlace: () => {},
          onClose: () => {},
          view: 'grid',
          onViewChange: () => {},
          selectedEntryId: 'queue',
        }),
      );

      expect(html).toContain('Library');
      expect(html).toContain('Queue');
      expect(html).toContain(libraryCaption(getEntry('queue')!));
      expect(html).toContain('Place on canvas');

      // Exclusions check
      expect(html).not.toMatch(/owner/i);
      expect(html).not.toMatch(/used in/i);
      expect(html).not.toMatch(/failures go to/i);
      expect(html).not.toMatch(/open docs/i);
      expect(html).not.toMatch(/platform team/i);
    });

    it('renders LibraryPicker (16E) with group filter chips, 4-col grid, and footer hints', () => {
      const html = renderToStaticMarkup(
        React.createElement(LibraryPicker, {
          onPlace: () => {},
          onOpenFullLibrary: () => {},
          onClose: () => {},
          selectedEntryId: 'service',
        }),
      );

      // Search & chips
      expect(html).toContain('aria-label="Search components"');
      expect(html).toContain('Filter by All');
      expect(html).toContain('Filter by Compute');
      expect(html).toContain('Filter by Data');
      expect(html).toContain('Filter by Messaging');

      // Cards
      expect(html).toContain('Service');
      expect(html).toContain(libraryCaption(getEntry('service')!));

      // Footer
      expect(html).toContain('↵ place at centre · drag to position');
      expect(html).toContain('Browse full library');

      // Strictly assert absence of excluded design elements
      expect(html).not.toMatch(/owner/i);
      expect(html).not.toMatch(/used in/i);
      expect(html).not.toMatch(/failures go to/i);
      expect(html).not.toMatch(/open docs/i);
      expect(html).not.toMatch(/platform team/i);
    });

    it('renders EntryDetailCard (12C) with models, DEFAULTS, and DOES NOT MODEL rows', () => {
      const queueEntry = getEntry('queue')!;
      const html = renderToStaticMarkup(
        React.createElement(EntryDetailCard, {
          entry: queueEntry,
        }),
      );

      // Badges & title
      expect(html).toContain('MESSAGING');
      expect(html).toContain('STANDARD');
      expect(html).toContain('Queue');

      // models text
      expect(html).toContain(queueEntry.models);

      // DEFAULTS and DOES NOT MODEL sections
      expect(html).toContain('DEFAULTS');
      expect(html).toContain('DOES NOT MODEL');
      expect(html).toContain(queueEntry.doesNotModel);

      // Footnote shortcut hints
      expect(html).toContain('↵ place · drag to position');

      // Strictly assert absence of excluded design elements
      expect(html).not.toMatch(/owner/i);
      expect(html).not.toMatch(/used in/i);
      expect(html).not.toMatch(/failures go to/i);
      expect(html).not.toMatch(/open docs/i);
      expect(html).not.toMatch(/platform team/i);
    });

    it('renders LibraryPreview composite without errors and free of forbidden fields', async () => {
      const { LibraryPreview } = await import('./LibraryPreview');
      const html = renderToStaticMarkup(React.createElement(LibraryPreview));

      expect(html).toContain('System Studio Library Preview');
      expect(html).toContain('Screen 12A');
      expect(html).toContain('Screen 12B');
      expect(html).toContain('Screen 12C');
      expect(html).toContain('Screen 16E');

      expect(html).not.toMatch(/owner/i);
      expect(html).not.toMatch(/used in/i);
      expect(html).not.toMatch(/failures go to/i);
      expect(html).not.toMatch(/open docs/i);
      expect(html).not.toMatch(/platform team/i);
    });

    it('verifies ALL 32 catalog entries in EntryDetailCard exclude forbidden terms', () => {
      for (const entry of CATALOG_ENTRIES) {
        const html = renderToStaticMarkup(
          React.createElement(EntryDetailCard, {
            entry,
          }),
        );

        expect(html).not.toMatch(/owner/i);
        expect(html).not.toMatch(/used in/i);
        expect(html).not.toMatch(/failures go to/i);
        expect(html).not.toMatch(/open docs/i);
        expect(html).not.toMatch(/platform team/i);
      }
    });

    it('verifies empty search renders a clear way out with a Clear search button in LibraryPanel', () => {
      const results = filterEntries(CATALOG_ENTRIES, 'nonexistent');
      expect(results.length).toBe(0);

      // Render LibraryPanel with initialSearchQuery set to a query that matches nothing
      const html = renderToStaticMarkup(
        React.createElement(LibraryPanel, {
          onPlace: () => {},
          onClose: () => {},
          view: 'list',
          onViewChange: () => {},
          initialSearchQuery: 'nonexistent',
        }),
      );

      // Panel renders empty message and Clear search button
      expect(html).toContain('No components match');
      expect(html).toContain('Clear search');
    });
  });
});


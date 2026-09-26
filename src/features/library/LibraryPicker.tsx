/**
 * LibraryPicker Component (RV-06b / Screen 16E).
 *
 * Implements the compact catalog component picker opened from the dock:
 * - Search field filtering across label, tags, group, and models.
 * - Horizontal filter chips for catalog groups (All, Compute, Data, Messaging, Edge, Clients, Operations, ...).
 *   (Strictly excludes Platform team, team chips, Ours/patterns, and Recent per design-revalidation.md §2).
 * - 4-column card grid with visual previews, kind icons, labels, library captions, and "Not simulated" tags.
 * - Drag-and-drop support setting 'application/x-studio-catalog-entry' MIME type.
 * - Footer hints: "↵ place at centre · drag to position" and "Browse full library" button.
 * - Keyboard navigation (arrow keys across 4 columns, Enter to place, Escape to close).
 *
 * Single-Instance Rule (D30 / R07):
 * Library entry points focus/expand the single existing Library instance. Single-instance
 * coordination and closing/replacing existing pickers is the caller's / dock's job.
 */

import * as React from 'react';
import { Search, X, ExternalLink } from 'lucide-react';
import {
  CATALOG_ENTRIES,
  GROUP_STRIPE_COLORS,
  type CatalogEntry,
  type CatalogGroup,
} from '../catalog/catalog';
import { libraryCaption } from '../catalog/caption';
import { getNodeIcon } from '../workspace/nodeVisuals';
import {
  CATALOG_ENTRY_MIME_TYPE,
  type LibraryPickerProps,
} from './types';
import {
  CANONICAL_GROUP_ORDER,
  filterEntries,
  filterEntriesByGroup,
  isUnmodeledEntry,
  keyboardNavigationReducer,
} from './viewModel';

export function LibraryPicker({
  onPlace,
  onOpenFullLibrary,
  onClose,
  selectedEntryId: controlledSelectedEntryId,
  onSelect,
  className,
}: LibraryPickerProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [activeGroup, setActiveGroup] = React.useState<CatalogGroup | 'All'>('All');
  const [internalSelectedId, setInternalSelectedId] = React.useState<string | null>(
    () => controlledSelectedEntryId ?? CATALOG_ENTRIES[0]?.entryId ?? null,
  );

  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const gridContainerRef = React.useRef<HTMLDivElement>(null);

  // Sync controlled selection
  React.useEffect(() => {
    if (controlledSelectedEntryId !== undefined) {
      setInternalSelectedId(controlledSelectedEntryId);
    }
  }, [controlledSelectedEntryId]);

  // Available filter groups (canonical order with existing entries)
  const filterChips: (CatalogGroup | 'All')[] = React.useMemo(() => {
    return ['All', ...CANONICAL_GROUP_ORDER];
  }, []);

  // Filter entries based on search and selected group chip
  const filteredEntries = React.useMemo(() => {
    let result = filterEntries(CATALOG_ENTRIES, searchQuery);
    if (activeGroup !== 'All') {
      result = filterEntriesByGroup(result, activeGroup);
    }
    return result;
  }, [searchQuery, activeGroup]);

  // Selected entry
  const selectedEntry = React.useMemo(() => {
    if (internalSelectedId) {
      const found = filteredEntries.find((e) => e.entryId === internalSelectedId);
      if (found) return found;
    }
    return filteredEntries[0] ?? null;
  }, [filteredEntries, internalSelectedId]);

  const handleSelect = React.useCallback(
    (entryId: string) => {
      setInternalSelectedId(entryId);
      onSelect?.(entryId);
    },
    [onSelect],
  );

  const handleEntryClick = React.useCallback(
    (entry: CatalogEntry) => {
      if (selectedEntry?.entryId === entry.entryId) {
        // Second tap on already selected entry places it
        onPlace(entry.entryId);
      } else {
        handleSelect(entry.entryId);
      }
    },
    [selectedEntry, handleSelect, onPlace],
  );

  const handleDragStart = React.useCallback(
    (e: React.DragEvent, entryId: string) => {
      e.dataTransfer.setData(CATALOG_ENTRY_MIME_TYPE, entryId);
      e.dataTransfer.effectAllowed = 'copyMove';
    },
    [],
  );

  // Keyboard navigation (4 columns)
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }

      if (filteredEntries.length === 0) return;

      const currentIndex = filteredEntries.findIndex(
        (entry) => entry.entryId === selectedEntry?.entryId,
      );

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = keyboardNavigationReducer(
          { selectedIndex: currentIndex },
          { type: 'ARROW_DOWN', columns: 4 },
          filteredEntries.length,
        );
        const nextEntry = filteredEntries[next.selectedIndex];
        if (nextEntry) handleSelect(nextEntry.entryId);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = keyboardNavigationReducer(
          { selectedIndex: currentIndex },
          { type: 'ARROW_UP', columns: 4 },
          filteredEntries.length,
        );
        const prevEntry = filteredEntries[prev.selectedIndex];
        if (prevEntry) handleSelect(prevEntry.entryId);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = keyboardNavigationReducer(
          { selectedIndex: currentIndex },
          { type: 'ARROW_RIGHT' },
          filteredEntries.length,
        );
        const nextEntry = filteredEntries[next.selectedIndex];
        if (nextEntry) handleSelect(nextEntry.entryId);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = keyboardNavigationReducer(
          { selectedIndex: currentIndex },
          { type: 'ARROW_LEFT' },
          filteredEntries.length,
        );
        const prevEntry = filteredEntries[prev.selectedIndex];
        if (prevEntry) handleSelect(prevEntry.entryId);
      } else if (e.key === 'Enter') {
        if (selectedEntry && document.activeElement !== searchInputRef.current) {
          e.preventDefault();
          onPlace(selectedEntry.entryId);
        }
      }
    },
    [filteredEntries, selectedEntry, handleSelect, onPlace, onClose],
  );

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Component Picker"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`flex flex-col w-full max-w-[640px] rounded-xl border border-[var(--color-border,#E7E3DB)] bg-[var(--color-panel,#F7F5F1)] shadow-[0_20px_44px_-18px_rgba(22,32,29,0.38),0_2px_6px_rgba(22,32,29,0.06)] p-3.5 text-[var(--color-foreground,#16201D)] font-sans select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary,#0B5C54)] ${className ?? ''}`}
      data-testid="library-picker"
    >
      {/* Search Bar */}
      <div className="relative flex items-center mb-2.5">
        <Search className="absolute left-2.5 w-4 h-4 text-secondary-text pointer-events-none" />
        <input
          ref={searchInputRef}
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (searchQuery) {
                e.stopPropagation();
                setSearchQuery('');
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              gridContainerRef.current?.focus();
            }
          }}
          placeholder="Search components, tags, groups..."
          aria-label="Search components"
          className="w-full h-8 pl-8 pr-16 text-xs rounded-md bg-white border border-[var(--color-control-border,#DCD7CD)] text-[var(--color-foreground,#16201D)] placeholder:text-secondary-text focus:border-[var(--color-control-border-strong,#948D80)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary,#0B5C54)] transition-all"
        />
        {searchQuery.trim().length > 0 && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search query"
            className="absolute right-2 p-1 text-secondary-text hover:text-[var(--color-foreground,#16201D)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Group Filter Chips (Horizontal Row) */}
      <div
        role="tablist"
        aria-label="Filter by group"
        className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-none"
      >
        {filterChips.map((chip) => {
          const isActive = activeGroup === chip;
          return (
            <button
              key={chip}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`Filter by ${chip}`}
              onClick={() => setActiveGroup(chip)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors border cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#0B5C54)] focus-visible:outline-none ${
                isActive
                  ? 'bg-[var(--color-accent,#EAEFEC)] border-[var(--color-primary,#0B5C54)] text-[var(--color-primary,#0B5C54)] font-semibold shadow-2xs'
                  : 'bg-white border-[var(--color-control-border,#DCD7CD)] text-secondary-text hover:bg-[var(--color-sunken,#F2EFE9)] hover:text-[var(--color-foreground,#16201D)]'
              }`}
            >
              {chip}
            </button>
          );
        })}
      </div>

      {/* 4-Column Card Grid (16E) */}
      <div
        ref={gridContainerRef}
        role="listbox"
        aria-label="Component grid"
        tabIndex={0}
        className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-2.5 max-h-[300px] overflow-y-auto p-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary,#0B5C54)]"
      >
        {filteredEntries.length === 0 ? (
          <div className="col-span-full py-8 text-center">
            <p className="text-xs text-secondary-text mb-2">
              No matching components found
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActiveGroup('All');
              }}
              aria-label="Clear filters"
              className="text-xs font-medium text-[var(--color-primary,#0B5C54)] hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isSelected = selectedEntry?.entryId === entry.entryId;
            const unmodeled = isUnmodeledEntry(entry);
            const Icon = getNodeIcon(entry.visualKind);
            const stripeColor = GROUP_STRIPE_COLORS[entry.group];

            return (
              <div
                key={entry.entryId}
                role="option"
                aria-selected={isSelected}
                aria-label={`${entry.label}: ${libraryCaption(entry)}`}
                tabIndex={isSelected ? 0 : -1}
                draggable
                onDragStart={(e) => handleDragStart(e, entry.entryId)}
                onClick={() => handleEntryClick(entry)}
                onDoubleClick={() => onPlace(entry.entryId)}
                className={`group relative flex flex-col p-2 rounded-lg border transition-all cursor-pointer select-none ${
                  isSelected
                    ? 'border-[var(--color-primary,#0B5C54)] bg-[var(--color-accent,#EAEFEC)]/60 ring-1 ring-[var(--color-primary,#0B5C54)]'
                    : 'border-[var(--color-border,#E7E3DB)] bg-white hover:border-[var(--color-control-border-strong,#948D80)] hover:bg-[var(--color-sunken,#F2EFE9)]/50'
                }`}
                data-entry-id={entry.entryId}
              >
                {/* Visual Preview Box */}
                <div className="h-12 w-full rounded bg-[var(--color-sunken,#F2EFE9)] border border-[var(--color-border,#E7E3DB)]/60 flex items-center justify-center relative overflow-hidden mb-1.5">
                  {stripeColor && (
                    <div
                      className="absolute top-0 left-0 right-0 h-[3px]"
                      style={{ backgroundColor: stripeColor }}
                    />
                  )}
                  <Icon className="w-4 h-4 text-[var(--color-foreground,#16201D)]/80" />
                </div>

                {/* Title and tags */}
                <div className="text-xs font-semibold text-[var(--color-foreground,#16201D)] truncate leading-tight">
                  {entry.label}
                </div>
                <div className="text-[10px] font-mono text-secondary-text truncate mt-0.5">
                  {entry.behaviorKind === 'unmodeled' ? entry.models : libraryCaption(entry)}
                </div>

                {unmodeled && (
                  <div className="mt-1">
                    <span className="inline-block text-[9px] font-mono px-1 py-0.2 rounded bg-[var(--color-sunken,#F2EFE9)] text-secondary-text border border-[var(--color-border,#E7E3DB)]">
                      Not simulated
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer (16E) */}
      <div className="pt-2 border-t border-[var(--color-border,#E7E3DB)] flex items-center justify-between text-xs">
        <div className="text-[11px] font-mono text-secondary-text">
          ↵ place at centre · drag to position
        </div>
        {/*
          RV-12e: the docked Library panel is a later task (D30's "single
          instance" is this picker for now) -- rendered disabled with the
          reason, per this task's brief, rather than wired to a panel that
          doesn't exist yet. `onOpenFullLibrary` is intentionally unused.
        */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          aria-label="Browse full library (unavailable): Library panel arrives with panel docking"
          title="Library panel arrives with panel docking"
          className="flex items-center gap-1 font-medium text-secondary-text cursor-not-allowed rounded px-1 py-0.5"
        >
          <span>Browse full library</span>
          <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

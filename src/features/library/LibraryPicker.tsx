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
 * Single-instance coordination (D30 / R07) is the caller's / dock's job.
 */

import * as React from 'react';
import { Search, X, ExternalLink } from 'lucide-react';
import { CATALOG_ENTRIES, type CatalogGroup } from '../catalog/catalog';
import { cn } from '../../lib/utils';
import type { LibraryPickerProps } from './types';
import {
  CANONICAL_GROUP_ORDER,
  filterEntries,
  filterEntriesByGroup,
} from './viewModel';
import { CatalogEntryCard } from './CatalogEntryCard';
import { useCatalogSelection } from './useCatalogSelection';

const FILTER_CHIPS: readonly (CatalogGroup | 'All')[] = ['All', ...CANONICAL_GROUP_ORDER];

export function LibraryPicker({
  onPlace,
  onOpenFullLibrary,
  actionLabel = 'Place',
  onClose,
  selectedEntryId,
  onSelect,
  className,
}: LibraryPickerProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [activeGroup, setActiveGroup] = React.useState<CatalogGroup | 'All'>('All');

  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const gridContainerRef = React.useRef<HTMLDivElement>(null);

  const filteredEntries = React.useMemo(() => {
    const result = filterEntries(CATALOG_ENTRIES, searchQuery);
    return activeGroup === 'All' ? result : filterEntriesByGroup(result, activeGroup);
  }, [searchQuery, activeGroup]);

  const { selectedEntry, activate, onDragStart, onKeyDown } = useCatalogSelection({
    entries: filteredEntries,
    controlledSelectedId: selectedEntryId,
    onSelect,
    onPlace,
    onClose,
    columns: 4,
    searchInputRef,
  });

  return (
    <div
      role="dialog"
      aria-label="Component Picker"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'flex flex-col w-full max-w-[640px] rounded-popover border border-border bg-background shadow-popover overflow-hidden text-foreground font-sans select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-primary',
        className,
      )}
      data-testid="library-picker"
    >
      {/* Header: Search Bar & Group Filter Chips */}
      <div className="bg-panel border-b border-hairline p-3 shrink-0">
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
            className="w-full h-8 pointer-coarse:h-11 pl-8 pr-16 text-xs rounded-md bg-white border border-control-border text-foreground placeholder:text-secondary-text focus:border-control-border-strong focus:outline-none focus:ring-1 focus:ring-primary transition-all"
          />
          {searchQuery.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search query"
              className="absolute right-2 p-1 pointer-coarse:size-11 pointer-coarse:right-0 inline-flex items-center justify-center text-secondary-text hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div
          role="tablist"
          aria-label="Filter by group"
          className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none"
        >
          {FILTER_CHIPS.map((chip) => {
            const isActive = activeGroup === chip;
            return (
              <button
                key={chip}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Filter by ${chip}`}
                onClick={() => setActiveGroup(chip)}
                className={cn(
                  'shrink-0 px-2.5 py-1 pointer-coarse:min-h-11 pointer-coarse:min-w-11 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors border cursor-pointer focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
                  isActive
                    ? 'bg-accent border-primary text-primary font-semibold shadow-2xs'
                    : 'bg-white border-control-border text-secondary-text hover:bg-sunken hover:text-foreground',
                )}
              >
                {chip}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4-Column Card Grid (16E) */}
      <div
        ref={gridContainerRef}
        role="listbox"
        aria-label="Component grid"
        tabIndex={0}
        className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 max-h-[300px] overflow-y-auto bg-background focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {filteredEntries.length === 0 ? (
          <div className="col-span-full py-8 text-center">
            <p className="text-xs text-secondary-text mb-2">No matching components found</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActiveGroup('All');
              }}
              aria-label="Clear filters"
              className="text-xs font-medium text-primary hover:underline"
            >
              Clear filters
            </button>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <CatalogEntryCard
              key={entry.entryId}
              entry={entry}
              variant="card"
              compact
              selected={selectedEntry?.entryId === entry.entryId}
              onActivate={activate}
              onPlace={onPlace}
              onDragStart={onDragStart}
            />
          ))
        )}
      </div>

      {/* Footer (16E) */}
      <div className="px-3.5 py-2.5 bg-panel border-t border-hairline flex items-center justify-between text-xs shrink-0">
        <div className="text-[11px] font-mono text-secondary-text pointer-coarse:hidden">
          {actionLabel === 'Place' ? '↵ place at centre · drag to position' : `↵ ${actionLabel.toLowerCase()} selected`}
        </div>
        {/* Touch has no Enter key or reliable double-tap, so coarse pointers get an
            explicit Place action for the selected entry (D14). */}
        {selectedEntry && (
          <button
            type="button"
            data-testid="library-picker-place-btn"
            onClick={() => onPlace(selectedEntry.entryId)}
            className="hidden pointer-coarse:inline-flex items-center min-h-11 px-3 rounded-md bg-primary text-primary-foreground font-medium"
          >
            {actionLabel} {selectedEntry.label}
          </button>
        )}
        {onOpenFullLibrary ? (
          <button
            type="button"
            data-testid="library-picker-full-library-btn"
            onClick={onOpenFullLibrary}
            aria-label="Browse full library"
            title="Browse full library"
            className="flex items-center gap-1 font-medium text-primary hover:underline rounded px-1 py-0.5 pointer-coarse:min-h-11"
          >
            <span>Browse full library</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

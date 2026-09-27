/**
 * LibraryPanel Component (RV-06b / Screens 12A, 12B, 12C).
 *
 * Implements the standard component catalog library panel:
 * - 12A: List view with kind icon, label, libraryCaption, and "Not simulated" tags.
 * - 12B: 2-column Grid view with cards, previews, and group headers with counts.
 * - 12C: Hover/focus detail popover strictly adhering to exclusions in design-revalidation.md §2.
 * - Footer bar with "<label> · DEFAULTS · ..." and "Place on canvas" primary action.
 * - Drag-and-drop: sets 'application/x-studio-catalog-entry' MIME type.
 * - Keyboard navigation (arrow keys, Enter, Escape) & touch (tap to select, second tap or footer button to place).
 * - Responsive: adapts between 320px and 440px widths, filling width at 390x844.
 */

import * as React from 'react';
import {
  X,
  Search,
  List as ListIcon,
  LayoutGrid,
  CornerDownLeft,
} from 'lucide-react';
import {
  CATALOG_ENTRIES,
  GROUP_STRIPE_COLORS,
  type CatalogEntry,
} from '../catalog/catalog';
import { defaultsLine, libraryCaption } from '../catalog/caption';
import { getNodeIcon } from '../workspace/nodeVisuals';
import {
  CATALOG_ENTRY_MIME_TYPE,
  type LibraryPanelProps,
  type LibraryView,
} from './types';
import {
  filterEntries,
  groupCatalogEntries,
  isUnmodeledEntry,
  keyboardNavigationReducer,
} from './viewModel';
import { EntryDetailCard } from './EntryDetailCard';
import { cn } from '../../lib/utils';

export function LibraryPanel({
  onPlace,
  onClose,
  view,
  onViewChange,
  selectedEntryId: controlledSelectedEntryId,
  onSelect,
  initialSearchQuery = '',
  className,
  hosted = false,
}: LibraryPanelProps) {
  const [searchQuery, setSearchQuery] = React.useState(initialSearchQuery);
  const [internalSelectedId, setInternalSelectedId] = React.useState<string | null>(
    () => controlledSelectedEntryId ?? CATALOG_ENTRIES[0]?.entryId ?? null,
  );
  const [hoveredEntryId, setHoveredEntryId] = React.useState<string | null>(null);
  const [popoverPosition, setPopoverPosition] = React.useState<{ top: number } | null>(null);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const listContainerRef = React.useRef<HTMLDivElement>(null);

  // Sync controlled selection
  React.useEffect(() => {
    if (controlledSelectedEntryId !== undefined) {
      setInternalSelectedId(controlledSelectedEntryId);
    }
  }, [controlledSelectedEntryId]);

  // Filter entries based on search query
  const filteredEntries = React.useMemo(() => {
    return filterEntries(CATALOG_ENTRIES, searchQuery);
  }, [searchQuery]);

  // Group filtered entries by catalog group
  const groupedSections = React.useMemo(() => {
    return groupCatalogEntries(filteredEntries);
  }, [filteredEntries]);

  // Effective selected entry
  const selectedEntry = React.useMemo(() => {
    if (internalSelectedId) {
      const found = filteredEntries.find((e) => e.entryId === internalSelectedId);
      if (found) return found;
    }
    return filteredEntries[0] ?? null;
  }, [filteredEntries, internalSelectedId]);

  const activeDetailEntry = React.useMemo(() => {
    if (hoveredEntryId) {
      return CATALOG_ENTRIES.find((e) => e.entryId === hoveredEntryId) ?? null;
    }
    return null;
  }, [hoveredEntryId]);

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
        // Second tap on the same selected entry places it
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

  // Keyboard navigation
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (filteredEntries.length === 0) return;

      const currentIndex = filteredEntries.findIndex(
        (entry) => entry.entryId === selectedEntry?.entryId,
      );
      const columns = view === 'grid' ? 2 : 1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = keyboardNavigationReducer(
          { selectedIndex: currentIndex },
          { type: 'ARROW_DOWN', columns },
          filteredEntries.length,
        );
        const nextEntry = filteredEntries[next.selectedIndex];
        if (nextEntry) handleSelect(nextEntry.entryId);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = keyboardNavigationReducer(
          { selectedIndex: currentIndex },
          { type: 'ARROW_UP', columns },
          filteredEntries.length,
        );
        const prevEntry = filteredEntries[prev.selectedIndex];
        if (prevEntry) handleSelect(prevEntry.entryId);
      } else if (e.key === 'ArrowRight' && view === 'grid') {
        e.preventDefault();
        const next = keyboardNavigationReducer(
          { selectedIndex: currentIndex },
          { type: 'ARROW_RIGHT' },
          filteredEntries.length,
        );
        const nextEntry = filteredEntries[next.selectedIndex];
        if (nextEntry) handleSelect(nextEntry.entryId);
      } else if (e.key === 'ArrowLeft' && view === 'grid') {
        e.preventDefault();
        const prev = keyboardNavigationReducer(
          { selectedIndex: currentIndex },
          { type: 'ARROW_LEFT' },
          filteredEntries.length,
        );
        const prevEntry = filteredEntries[prev.selectedIndex];
        if (prevEntry) handleSelect(prevEntry.entryId);
      } else if (e.key === 'Enter') {
        // Place selected entry if not actively typing inside the search input
        if (selectedEntry && document.activeElement !== searchInputRef.current) {
          e.preventDefault();
          onPlace(selectedEntry.entryId);
        }
      }
    },
    [filteredEntries, selectedEntry, view, handleSelect, onPlace, onClose],
  );

  const handleMouseEnterEntry = React.useCallback(
    (e: React.MouseEvent<HTMLElement>, entryId: string) => {
      setHoveredEntryId(entryId);
      if (containerRef.current) {
        const targetRect = e.currentTarget.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        setPopoverPosition({
          top: Math.max(8, targetRect.top - containerRect.top),
        });
      }
    },
    [],
  );

  const handleMouseLeaveEntry = React.useCallback(() => {
    setHoveredEntryId(null);
  }, []);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Component Library"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative flex flex-col h-full w-full bg-panel text-foreground font-sans select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        hosted ? 'min-w-0 max-w-none border-0' : 'min-w-[320px] max-w-[440px] border-l border-border',
        className,
      )}
      data-testid="library-panel"
    >
      {/* 1. Header (12A/12B): "Library" + Close Button */}
      {!hosted && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-base font-semibold text-foreground tracking-tight">Library</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="p-1 rounded-control text-secondary-text hover:text-foreground hover:bg-sunken transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Search Field (12A/12B) */}
      <div className="p-3 pb-2">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-4 h-4 text-[var(--color-secondary-text,#626D68)] pointer-events-none" />
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
                // Move focus to list
                listContainerRef.current?.focus();
              }
            }}
            placeholder="Search parts, tags, models..."
            aria-label="Search components"
            className="w-full h-8 pl-8 pr-18 text-xs rounded-md bg-[var(--color-sunken,#F2EFE9)] border border-[var(--color-control-border,#DCD7CD)] text-[var(--color-foreground,#16201D)] placeholder:text-[var(--color-secondary-text,#626D68)] focus:border-[var(--color-control-border-strong,#948D80)] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-primary,#0B5C54)] transition-all"
          />
          {searchQuery.trim().length > 0 && (
            <div className="absolute right-2.5 flex items-center gap-1.5 text-[11px] font-mono text-[var(--color-secondary-text,#626D68)]">
              <span>
                {filteredEntries.length} {filteredEntries.length === 1 ? 'match' : 'matches'}
              </span>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
                className="p-0.5 rounded hover:bg-[var(--color-border,#E7E3DB)] text-[var(--color-secondary-text,#626D68)]"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 3. Filter Bar & List/Grid Toggle (12A/12B) */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border,#E7E3DB)]/60 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-[var(--color-foreground,#16201D)] pb-0.5 border-b-2 border-[var(--color-primary,#0B5C54)]">
            Standard
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--color-primary,#0B5C54)] text-white font-medium">
            {CATALOG_ENTRIES.length}
          </span>
        </div>

        {/* List / Grid segmented toggle */}
        <div
          role="group"
          aria-label="View mode toggle"
          className="flex items-center p-0.5 rounded-md bg-[var(--color-sunken,#F2EFE9)] border border-[var(--color-control-border,#DCD7CD)]"
        >
          <button
            type="button"
            onClick={() => onViewChange('list')}
            aria-label="List view"
            aria-pressed={view === 'list'}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
              view === 'list'
                ? 'bg-white text-[var(--color-foreground,#16201D)] shadow-sm'
                : 'text-[var(--color-secondary-text,#626D68)] hover:text-[var(--color-foreground,#16201D)]'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            <span>List</span>
          </button>
          <button
            type="button"
            onClick={() => onViewChange('grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
              view === 'grid'
                ? 'bg-white text-[var(--color-foreground,#16201D)] shadow-sm'
                : 'text-[var(--color-secondary-text,#626D68)] hover:text-[var(--color-foreground,#16201D)]'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Grid</span>
          </button>
        </div>
      </div>

      {/* 4. Entries Scroll Area */}
      <div
        ref={listContainerRef}
        role="listbox"
        aria-label="Component catalog entries"
        tabIndex={0}
        className="flex-1 overflow-y-auto p-3 space-y-4 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary,#0B5C54)]"
      >
        {filteredEntries.length === 0 ? (
          /* Empty state: clear search way out */
          <div className="py-12 px-4 text-center">
            <p className="text-xs text-[var(--color-secondary-text,#626D68)] mb-3">
              No components match &ldquo;{searchQuery}&rdquo;
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--color-control-border,#DCD7CD)] bg-white hover:bg-[var(--color-sunken,#F2EFE9)] text-[var(--color-primary,#0B5C54)] shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#0B5C54)] focus-visible:outline-none"
            >
              Clear search
            </button>
          </div>
        ) : (
          groupedSections.map((section) => (
            <div key={section.group} className="space-y-2">
              {/* Group header with line and count */}
              <div className="flex items-center gap-2 text-[10.5px] font-mono uppercase tracking-widest text-[var(--color-secondary-text,#626D68)]">
                <span
                  style={section.stripeColor ? { color: section.stripeColor } : undefined}
                  className="font-medium"
                >
                  {section.group.toUpperCase()}
                </span>
                <div className="flex-1 h-px bg-[var(--color-border,#E7E3DB)]" />
                <span className="text-[10px] text-[var(--color-secondary-text,#626D68)]">
                  {section.count}
                </span>
              </div>

              {/* Entries: List view vs Grid view */}
              {view === 'list' ? (
                <div className="space-y-1.5">
                  {section.entries.map((entry) => {
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
                        onMouseEnter={(e) => handleMouseEnterEntry(e, entry.entryId)}
                        onMouseLeave={handleMouseLeaveEntry}
                        onFocus={(e) => handleMouseEnterEntry(e as unknown as React.MouseEvent<HTMLElement>, entry.entryId)}
                        onBlur={handleMouseLeaveEntry}
                        className={`group relative flex items-center gap-2.5 p-2 rounded-lg border transition-all cursor-pointer select-none ${
                          isSelected
                            ? 'border-[var(--color-primary,#0B5C54)] bg-[var(--color-accent,#EAEFEC)]/60 ring-1 ring-[var(--color-primary,#0B5C54)]'
                            : 'border-[var(--color-border,#E7E3DB)] bg-white hover:border-[var(--color-control-border-strong,#948D80)] hover:bg-[var(--color-sunken,#F2EFE9)]/50'
                        }`}
                        data-entry-id={entry.entryId}
                      >
                        {/* Kind Icon Box */}
                        <div
                          className="w-8 h-8 rounded-md bg-[var(--color-sunken,#F2EFE9)] border border-[var(--color-border,#E7E3DB)] flex items-center justify-center flex-shrink-0 text-[var(--color-foreground,#16201D)] relative overflow-hidden"
                          style={stripeColor ? { borderLeftColor: stripeColor, borderLeftWidth: 3 } : undefined}
                        >
                          <Icon className="w-4 h-4" />
                        </div>

                        {/* Label & Caption */}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-[var(--color-foreground,#16201D)] leading-tight truncate">
                            {entry.label}
                          </div>
                          <div className="text-[11px] font-mono text-[var(--color-secondary-text,#626D68)] truncate mt-0.5">
                            {entry.behaviorKind === 'unmodeled' ? entry.models : libraryCaption(entry)}
                          </div>
                        </div>

                        {/* Unmodeled Tag & Drag Hint */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {unmodeled && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-sunken,#F2EFE9)] text-[var(--color-secondary-text,#626D68)] border border-[var(--color-border,#E7E3DB)]">
                              Not simulated
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-[var(--color-secondary-text,#626D68)] opacity-0 group-hover:opacity-100 transition-opacity">
                            drag
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 min-w-0">
                  {section.entries.map((entry) => {
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
                        onMouseEnter={(e) => handleMouseEnterEntry(e, entry.entryId)}
                        onMouseLeave={handleMouseLeaveEntry}
                        onFocus={(e) => handleMouseEnterEntry(e as unknown as React.MouseEvent<HTMLElement>, entry.entryId)}
                        onBlur={handleMouseLeaveEntry}
                        className={`group relative flex flex-col min-w-0 p-2 rounded-lg border transition-all cursor-pointer select-none ${
                          isSelected
                            ? 'border-[var(--color-primary,#0B5C54)] bg-[var(--color-accent,#EAEFEC)]/60 ring-1 ring-[var(--color-primary,#0B5C54)]'
                            : 'border-[var(--color-border,#E7E3DB)] bg-white hover:border-[var(--color-control-border-strong,#948D80)] hover:bg-[var(--color-sunken,#F2EFE9)]/50'
                        }`}
                        data-entry-id={entry.entryId}
                      >
                        {/* Visual Preview Box */}
                        <div className="h-14 w-full rounded-md bg-[var(--color-sunken,#F2EFE9)] border border-[var(--color-border,#E7E3DB)]/60 flex items-center justify-center relative overflow-hidden mb-1.5">
                          {stripeColor && (
                            <div
                              className="absolute top-0 left-0 right-0 h-[3px]"
                              style={{ backgroundColor: stripeColor }}
                            />
                          )}
                          <Icon className="w-5 h-5 text-[var(--color-foreground,#16201D)]/80" />
                        </div>

                        {/* Title and tags */}
                        <div className="text-xs font-semibold text-[var(--color-foreground,#16201D)] truncate leading-tight">
                          {entry.label}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--color-secondary-text,#626D68)] truncate mt-0.5">
                          {entry.behaviorKind === 'unmodeled' ? entry.models : libraryCaption(entry)}
                        </div>

                        {unmodeled && (
                          <div className="mt-1">
                            <span className="inline-block text-[9px] font-mono px-1 py-0.2 rounded bg-[var(--color-sunken,#F2EFE9)] text-[var(--color-secondary-text,#626D68)] border border-[var(--color-border,#E7E3DB)]">
                              Not simulated
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Floating Hover/Focus Detail Popover (Screen 12C) */}
      {activeDetailEntry && (
        <div
          className="hidden md:block absolute right-[102%] z-50 pointer-events-none"
          style={{ top: popoverPosition?.top ?? 60 }}
        >
          <EntryDetailCard entry={activeDetailEntry} />
        </div>
      )}

      {/* 5. Sticky Footer Bar (12A/12B/12C) */}
      <div className="p-3 border-t border-[var(--color-border,#E7E3DB)] bg-[var(--color-panel,#F7F5F1)] flex items-center justify-between gap-3">
        {selectedEntry ? (
          <>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {(() => {
                const Icon = getNodeIcon(selectedEntry.visualKind);
                return (
                  <div className="w-7 h-7 rounded bg-white border border-[var(--color-border,#E7E3DB)] flex items-center justify-center flex-shrink-0 text-[var(--color-foreground,#16201D)]">
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                );
              })()}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--color-foreground,#16201D)] leading-tight truncate">
                  {selectedEntry.label}
                </div>
                <div className="text-[10.5px] font-mono text-[var(--color-secondary-text,#626D68)] truncate mt-0.5">
                  {defaultsLine(selectedEntry)}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onPlace(selectedEntry.entryId)}
              aria-label={`Place ${selectedEntry.label} on canvas`}
              className="px-3 py-1.5 rounded-md bg-[var(--color-primary,#0B5C54)] hover:bg-[var(--color-primary-hover,#0A4E47)] text-white text-xs font-medium shadow-xs transition-colors flex-shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#0B5C54)] focus-visible:ring-offset-1 focus-visible:outline-none flex items-center gap-1.5"
            >
              <span>Place on canvas</span>
              <CornerDownLeft className="w-3 h-3 opacity-70" />
            </button>
          </>
        ) : (
          <div className="text-xs text-[var(--color-secondary-text,#626D68)]">
            Select an entry to place
          </div>
        )}
      </div>
    </div>
  );
}

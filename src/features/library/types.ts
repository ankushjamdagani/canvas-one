/**
 * Library Feature Types (RV-06b).
 *
 * Implements specifications from:
 * - specs/revamp/screens/12A_Library_list_view.png
 * - specs/revamp/screens/12B_Library_grid_view.png
 * - specs/revamp/screens/12C_Library_hover_detail.png
 * - specs/revamp/screens/16E_Library_picker_from_dock.png
 * - specs/revamp/contracts/catalog.md (§5 Library display mapping)
 * - specs/revamp/decisions.md (D30, D35, D42)
 * - specs/revamp/requirements.md (R07)
 */

import type { CatalogEntry, CatalogGroup } from '../catalog/catalog';

/** View mode for LibraryPanel: list rows vs 2-column cards */
export type LibraryView = 'list' | 'grid';

/** Drag-and-drop MIME type for studio catalog entries */
export const CATALOG_ENTRY_MIME_TYPE = 'application/x-studio-catalog-entry';

/** Props for the full LibraryPanel (12A/12B/12C) */
export interface LibraryPanelProps {
  /** Called when the user confirms placing a catalog entry */
  onPlace: (entryId: string) => void;
  /** Called when the user clicks the close button or presses Escape */
  onClose: () => void;
  /** Current view mode: 'list' or 'grid' */
  view: LibraryView;
  /** Callback when the user toggles between list and grid views */
  onViewChange: (view: LibraryView) => void;
  /** Currently selected entry ID (controlled) */
  selectedEntryId?: string | null;
  /** Callback when user selects an entry */
  onSelect?: (entryId: string) => void;
  /** Optional initial search query (e.g. for testing empty results or deep links) */
  initialSearchQuery?: string;
  /** Optional container class name */
  className?: string;
  /** PanelHost already supplies the panel title, controls, and outer chrome. */
  hosted?: boolean;
  renderSavedParts?: (searchQuery: string, view: LibraryView) => import('react').ReactNode;
}

/**
 * Props for the compact LibraryPicker from the dock (16E).
 *
 * Note on D30: Library entry points focus/expand the single existing Library instance.
 * Single-instance coordination is the caller's / dock's responsibility.
 */
export interface LibraryPickerProps {
  /** Called when the user confirms placing a catalog entry */
  onPlace: (entryId: string) => void;
  /** Called when the user clicks "Browse full library" */
  onOpenFullLibrary: () => void;
  /** Called when the user closes the picker (e.g. Escape) */
  onClose?: () => void;
  /** Currently selected entry ID (controlled) */
  selectedEntryId?: string | null;
  /** Callback when user selects an entry */
  onSelect?: (entryId: string) => void;
  /** Optional container class name */
  className?: string;
}

/** Detail popover content shape */
export interface EntryDetailProps {
  entry: CatalogEntry;
  className?: string;
}

/** Pure grouping section view model */
export interface CatalogGroupSection {
  readonly group: CatalogGroup;
  readonly stripeColor: string | null;
  readonly entries: readonly CatalogEntry[];
  readonly count: number;
}

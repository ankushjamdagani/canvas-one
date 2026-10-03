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

/** Drag-and-drop MIME type for a project dragged out of the Library's Projects tab (JSON `{projectId, title}`) */
export const LINKED_PROJECT_MIME_TYPE = 'application/x-studio-linked-project';

export type LibraryTab = 'standard' | 'ours' | 'projects';

/** D52: what the Library shows about a project it can link to. */
export interface LinkedProjectSummary {
  readonly id: string;
  readonly title: string;
  readonly team: string;
  readonly description: string;
}

export interface LinkedProjectsRenderContext {
  readonly searchQuery: string;
  readonly active: boolean;
  readonly onCountChange: (count: number) => void;
}

export interface SavedPartsRenderContext {
  readonly searchQuery: string;
  readonly view: LibraryView;
  readonly active: boolean;
  readonly onCountChange: (count: number) => void;
}

/** Props for the full LibraryPanel (12A/12B/12C) */
export interface LibraryPanelProps {
  /** Called when the user confirms placing a catalog entry */
  onPlace: (entryId: string) => void;
  /** Called when the user presses Escape */
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
  /**
   * Renders the saved-parts ("Ours") content. It stays mounted while the Standard
   * tab is showing (`active` false) so its count and a requested capture survive.
   */
  renderSavedParts?: (context: SavedPartsRenderContext) => import('react').ReactNode;
  /** Renders the linked-projects ("Projects") content; the tab is absent without it. */
  renderLinkedProjects?: (context: LinkedProjectsRenderContext) => import('react').ReactNode;
  /** Increments when a capture is requested from outside; switches to the Ours tab. */
  captureRequested?: number;
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
  /** Called when the user clicks "Browse full library"; the link is hidden when absent. */
  onOpenFullLibrary?: () => void;
  /** Verb on the confirm button ("Place" by default; "Use" when choosing a replacement). */
  actionLabel?: string;
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
